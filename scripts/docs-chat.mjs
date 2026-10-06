// 8084 의 문서 챗봇(Alt+Shift+K) 서버 쪽. serve.mjs 가 /__chat 에 붙인다(ADR-0001).
//
//   GET  /__chat         → { enabled, reason? }   창을 열 때 쓸 수 있는지 본다
//   POST /__chat         ← { question, history: [{ role: 'user'|'assistant', text }] }
//                        → NDJSON 스트림: {type:'tool', name, args} · {type:'text', text} · {type:'done', ms} · {type:'error', message}
//
// gemini CLI 를 질문마다 띄우지 않는다. `gemini -p` 는 기동(로그인 갱신·설정 읽기)만 질문마다 3~10초였다. 대신
// `gemini --acp`(편집기가 gemini 를 띄워 두고 쓰는 방식, stdin·stdout 위 JSON-RPC) 하나를 띄워 두고 질문마다 세션을 새로 연다.
// 정문(ieum-gateway assistant.Gemini)과 같은 방식이다. 55 실측: 기동 3.6초는 첫 질문만, 세션 열기 0.7~0.9초, 도구 한 번 쓰는 답이
// 7.6초(첫 글자 6.9초). 질문마다 세션이 새로라 프로세스에 쌓이는 것이 없고, 앞선 대화는 질문 글에 붙여 보낸다.
// 프로세스 하나가 약 380MB 라 IDLE_MS 동안 안 쓰이면 내린다.
//
// gemini 가 쓸 수 있는 도구는 scripts/docs-mcp.mjs(문서 읽기) 하나다 — 8084 는 사내망 누구나 열어서, 셸·파일 도구가 열려 있으면
// 질문 한 줄로 55 에서 아무 명령이나 돈다. 막는 곳은 셋이다: admin 정책(scripts/docs-chat.policy.toml)이 docs 서버 밖 도구를 전부
// deny 하고, --allowed-mcp-server-names 가 다른 MCP 서버를 안 띄우고, gemini 가 이쪽에 권한을 물으면(session/request_permission)
// 언제나 cancelled 로 답한다. 정책 파일이 없으면 아예 켜지 않는다.
//
// 시스템 프롬프트는 GEMINI_SYSTEM_MD 로 갈아 끼운다(scripts/docs-chat.md + 아래 NOTE). gemini 기본 프롬프트는 코딩 에이전트용이라
// 길고, 답하는 법과 섞인다. thinking 은 LOW 다 — gemini-3 기본 HIGH 는 문서 찾아 읽는 질문에 과하다. 55 실측으로 MEDIUM 11~12초,
// LOW 6~7초였고 답은 같은 문서를 찾아 근거를 붙였다(정문도 LOW).
//
// 작업 폴더는 run/docs-chat/ 이다(gitignore). 거기에 .gemini/settings.json(MCP 서버 등록·thinking)과 system.md 를 기동할 때
// 만든다 — repo 루트에서 돌리면 gemini 가 CLAUDE.md·소스까지 맥락으로 읽어 간다.
//
// 환경:
//   DOCS_CHAT=0                 끈다
//   DOCS_CHAT_GEMINI=gemini     gemini 실행 파일(테스트는 가짜를 넣는다)
//   GOOGLE_CLOUD_PROJECT        55 의 사내 계정은 이게 없으면 gemini 가 바로 죽는다. run.sh 가 ~/.bashrc 에서 옮겨 준다
//   DOCS_CHAT_MAX=2             동시에 답하는 질문 수. 넘으면 429
//   DOCS_CHAT_TIMEOUT=150       초. 질문 하나(첫 질문이면 기동 포함)가 넘으면 끊고 error
//   DOCS_CHAT_THINKING=LOW      gemini-3 thinkingLevel (LOW·MEDIUM·HIGH)
//   DOCS_CHAT_IDLE=1800         초. 이만큼 질문이 없으면 gemini 를 내린다
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BODY = 64 * 1024
const MAX_QUESTION = 2000
const MAX_TURNS = 6 // 앞선 대화는 마지막 6개 말까지만 붙인다
const MAX_TURN_CHARS = 1500
const START_MS = 60_000 // 기동은 4초 안팎이다. 1분이면 로그인 같은 데서 멈춘 것이다

// 질문이 대화 기록 꼴로 와서, 어디가 지금 질문인지 알려 준다.
const NOTE = `
## 질문의 꼴

- 질문은 \`[앞선 대화]\`(있으면)와 \`[지금 질문]\` 으로 온다. "사용자:" 가 묻는 사람, "챗봇:" 이 너의 앞선 답이다.
  \`[지금 질문]\` 에 답한다.
`

/** ACP 의 tool_call 제목("docs_ticket(id: ADR-0007)")을 창에 보낼 이름·인자로. ACP 는 인자를 따로 주지 않는다. */
export function parseToolTitle(title) {
  const m = /^([\w-]+)\s*(?:\((.*)\))?\s*$/s.exec(String(title || ''))
  if (!m) return { name: String(title || ''), args: {} }
  const args = {}
  // "query: 내력벽, 모름, limit: 5" — 값 안의 쉼표는 다음 "이름:" 이 나올 때까지 값에 붙인다
  for (const part of (m[2] || '').split(/,\s*(?=[\w-]+:\s)/)) {
    const kv = /^([\w-]+):\s*(.*)$/s.exec(part.trim())
    if (kv) args[kv[1]] = kv[2]
  }
  return { name: m[1].replace(/^mcp_docs_/, ''), args }
}

export function createChat({ root, log = () => {} }) {
  const gemini = process.env.DOCS_CHAT_GEMINI || 'gemini'
  // .mjs·.js 를 주면 node 로 띄운다(테스트의 가짜 gemini). 셸은 거치지 않는다.
  const run = (args, opt) => (/\.m?js$/.test(gemini) ? [process.execPath, [gemini, ...args], opt] : [gemini, args, opt])
  const policy = join(root, 'scripts/docs-chat.policy.toml')
  const max = Number(process.env.DOCS_CHAT_MAX) || 2
  const timeoutMs = (Number(process.env.DOCS_CHAT_TIMEOUT) || 150) * 1000
  const idleMs = (Number(process.env.DOCS_CHAT_IDLE) || 1800) * 1000
  const thinking = (process.env.DOCS_CHAT_THINKING || 'LOW').toUpperCase()

  let reason = null
  if (process.env.DOCS_CHAT === '0') reason = 'DOCS_CHAT=0 으로 꺼 두었다'
  else if (!existsSync(policy)) reason = `도구 제한 정책이 없다(${policy})`
  else if (spawnSync(...run(['--version'], { encoding: 'utf8', timeout: 20000 })).status !== 0) {
    reason = `이 서버에 gemini CLI 가 없다(${gemini})`
  }

  const work = join(root, 'run/docs-chat')
  const system = join(work, 'system.md')
  if (!reason) {
    mkdirSync(join(work, '.gemini'), { recursive: true })
    writeFileSync(join(work, '.gemini/settings.json'), JSON.stringify({
      general: { disableAutoUpdate: true, disableUpdateNag: true },
      mcpServers: {
        docs: { command: process.execPath, args: [join(root, 'scripts/docs-mcp.mjs')], env: { DOCS_ROOT: root }, trust: true, timeout: 30000 },
      },
      modelConfigs: {
        customAliases: {
          'chat-base-3': { extends: 'chat-base', modelConfig: { generateContentConfig: { thinkingConfig: { thinkingLevel: thinking } } } },
        },
      },
    }, null, 2))
    writeFileSync(system, readFileSync(join(root, 'scripts/docs-chat.md'), 'utf8') + NOTE)
    // 예전 판(gemini -p)이 맥락 파일로 두던 것. 시스템 프롬프트와 같은 글이 두 번 실리지 않게 지운다.
    rmSync(join(work, 'GEMINI.md'), { force: true })
  }
  log({ msg: 'docs-chat', enabled: !reason, reason, gemini, thinking })

  let running = 0
  /** 떠 있는 gemini --acp. 없거나 죽었으면 다음 질문이 띄운다. */
  let agent = null
  let lastUsed = Date.now()

  function startAgent() {
    const a = { ready: null, calls: new Map(), sessions: new Map(), nextId: 0, exited: false, stderr: '', pid: 0 }
    const began = Date.now()
    const args = ['--acp', '--admin-policy', policy, '--allowed-mcp-server-names', 'docs']
    const child = spawn(...run(args, {
      cwd: work,
      env: { ...process.env, GEMINI_SYSTEM_MD: system, GEMINI_CLI_TRUST_WORKSPACE: 'true', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      // 자기 프로세스 그룹으로 띄워서, 내릴 때 docs MCP 서버까지 같이 내린다
      detached: true,
    }))
    a.child = child
    a.pid = child.pid
    const write = m => { if (!a.exited) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`) }
    a.write = write
    a.call = (method, params) => new Promise((resolve, reject) => {
      if (a.exited) return reject(Object.assign(new Error('gemini 가 꺼져 있다'), { gone: true }))
      const id = ++a.nextId
      a.calls.set(id, { resolve, reject })
      write({ id, method, params })
    })
    a.stop = () => { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }

    let buf = ''
    child.stdout.on('data', d => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('{')) continue // gemini 가 stdout 에 가끔 경고를 글로 찍는다
        let m
        try { m = JSON.parse(line) } catch { continue }
        if (m.method === 'session/update') {
          a.sessions.get(m.params?.sessionId)?.(m.params.update)
        } else if (m.method && m.id != null) {
          // gemini 가 이쪽에 무엇을 요청한다. 아무것도 들어주지 않는다 — 권한 요청은 도구가 돌고 싶다는 뜻이다.
          log({ msg: 'docs-chat refused', method: m.method })
          if (m.method === 'session/request_permission') write({ id: m.id, result: { outcome: { outcome: 'cancelled' } } })
          else write({ id: m.id, error: { code: -32601, message: 'not offered by this client' } })
        } else if (m.id != null && a.calls.has(m.id)) {
          const c = a.calls.get(m.id)
          a.calls.delete(m.id)
          if (m.error) c.reject(new Error(m.error.message || 'gemini 오류'))
          else c.resolve(m.result)
        }
      }
    })
    child.stderr.on('data', d => { a.stderr = (a.stderr + d).slice(-4000) })
    const gone = why => {
      if (a.exited) return
      a.exited = true
      const err = Object.assign(new Error(why), { gone: true })
      for (const c of a.calls.values()) c.reject(err)
      a.calls.clear()
      for (const s of a.sessions.values()) s({ sessionUpdate: '__gone', message: why })
    }
    child.on('error', e => gone(`gemini 를 못 띄웠다: ${e.message}`))
    child.on('close', code => {
      const last = a.stderr.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('at ')).slice(-2).join(' / ')
      gone(`gemini 가 ${code} 로 끝났다${last ? `: ${last.slice(0, 300)}` : ''}`)
      log({ msg: 'docs-chat agent exited', pid: a.pid, code })
      if (agent === a) agent = null
    })

    a.ready = Promise.race([
      a.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`gemini 가 ${START_MS / 1000}초 안에 안 떴다`)), START_MS)),
    ]).then(() => log({ msg: 'docs-chat agent started', pid: a.pid, ms: Date.now() - began }))
    a.ready.catch(() => { a.stop(); if (agent === a) agent = null })
    return a
  }

  function getAgent() {
    if (!agent || agent.exited) agent = startAgent()
    return agent
  }

  // 오래 안 쓰인 gemini 를 내린다. 다음 질문이 다시 띄운다(기동 4초 안팎).
  const reaper = setInterval(() => {
    if (agent && running === 0 && Date.now() - lastUsed > idleMs) {
      log({ msg: 'docs-chat agent stopped, idle', pid: agent.pid })
      agent.stop()
      agent = null
    }
  }, Math.min(60_000, idleMs))
  reaper.unref()

  function prompt(question, history) {
    const turns = (Array.isArray(history) ? history : []).slice(-MAX_TURNS)
      .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
      .map(t => `${t.role === 'user' ? '사용자' : '챗봇'}: ${t.text.slice(0, MAX_TURN_CHARS)}`)
    return [
      turns.length ? `[앞선 대화]\n${turns.join('\n\n')}\n` : '',
      `[지금 질문]\n${question}`,
    ].join('\n')
  }

  /**
   * 세션 하나를 열어 묻고, 갱신을 창 이벤트로 바꿔 emit 한다. 끝나면 { usage } 를, gemini 가 죽었으면 gone 오류를 던진다.
   * ctl.aborted 가 서면(창을 닫거나 시간을 넘겼을 때) 묻지 않거나, 묻는 중이면 ctl.cancel 로 세션을 취소한다.
   */
  async function askOnce(a, text, emit, ctl) {
    await a.ready
    const { sessionId } = await a.call('session/new', { cwd: work, mcpServers: [] })
    if (!sessionId) throw new Error('gemini 가 세션 id 를 안 줬다')
    if (ctl.aborted) throw new Error('취소했다')
    let gone = null
    a.sessions.set(sessionId, u => {
      if (u.sessionUpdate === '__gone') { gone = u.message; return }
      if (u.sessionUpdate === 'agent_message_chunk' && u.content?.text) emit({ type: 'text', text: u.content.text, delta: true })
      else if (u.sessionUpdate === 'tool_call') emit({ type: 'tool', ...parseToolTitle(u.title) })
      else if ((u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') && u.status === 'failed') {
        const msg = (u.content || []).map(c => c?.content?.text).filter(Boolean).join(' ')
        emit({ type: 'tool_error', message: (msg || '도구 실패').slice(0, 300) })
      }
    })
    ctl.cancel = () => a.write({ method: 'session/cancel', params: { sessionId } })
    try {
      const result = await a.call('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
      if (gone) throw Object.assign(new Error(gone), { gone: true })
      const t = result?._meta?.quota?.token_count || {}
      return { stop: result?.stopReason, usage: { in: t.input_tokens, out: t.output_tokens } }
    } finally {
      a.sessions.delete(sessionId)
    }
  }

  async function readBody(req) {
    let size = 0
    const chunks = []
    for await (const c of req) {
      size += c.length
      if (size > MAX_BODY) throw Object.assign(new Error('질문이 너무 길다'), { status: 413 })
      chunks.push(c)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw Object.assign(new Error('JSON 이 아니다'), { status: 400 }) }
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  return async function handle(req, res) {
    if (req.method === 'GET') return json(res, 200, { enabled: !reason, ...(reason ? { reason } : {}) })
    if (req.method !== 'POST') return json(res, 405, { error: 'GET 이나 POST' })
    if (reason) return json(res, 503, { error: reason })

    let body
    try { body = await readBody(req) } catch (e) { return json(res, e.status || 400, { error: e.message }) }
    const question = String(body.question || '').trim()
    if (!question) return json(res, 400, { error: '질문이 비었다' })
    if (question.length > MAX_QUESTION) return json(res, 413, { error: `질문은 ${MAX_QUESTION}자까지` })
    if (running >= max) return json(res, 429, { error: `지금 ${running}개가 답하는 중이다. 잠시 뒤에 다시` })

    running++
    lastUsed = Date.now()
    const started = Date.now()
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    const tools = []
    let emitted = 0
    const emit = ev => {
      if (ev.type === 'tool') tools.push(ev.name)
      if (ev.type === 'text' || ev.type === 'tool') emitted++
      if (!res.writableEnded) res.write(`${JSON.stringify(ev)}\n`)
    }
    const ctl = { aborted: false, cancel: () => {} }
    const abort = () => { ctl.aborted = true; ctl.cancel() }
    // 창을 닫거나 새 질문을 하면 끊는다 — 아무도 안 읽는 답에 할당량을 쓰지 않게
    res.on('close', () => { if (!res.writableFinished) abort() })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; abort() }, timeoutMs)

    const text = prompt(question, body.history)
    let failed = false
    let out = {}
    let pid = 0
    for (let attempt = 0; ; attempt++) {
      const a = getAgent()
      pid = a.pid
      try {
        out = await askOnce(a, text, emit, ctl)
        break
      } catch (e) {
        // 답을 하나도 안 보냈는데 gemini 가 죽었으면 한 번은 새로 띄워 다시 묻는다
        if (e.gone && emitted === 0 && attempt === 0 && !ctl.aborted) { log({ msg: 'docs-chat retry', error: e.message }); continue }
        failed = true
        if (!ctl.aborted) emit({ type: 'error', message: e.message })
        break
      }
    }
    clearTimeout(timer)
    if (timedOut) { failed = true; emit({ type: 'error', message: `${timeoutMs / 1000}초 안에 답이 안 왔다` }) }
    running--
    lastUsed = Date.now()
    const ms = Date.now() - started
    emit({ type: 'done', ms })
    res.end()
    // 질문 내용은 남기지 않는다. 길이·도구·시간·토큰만
    log({ msg: 'chat', q_len: question.length, turns: Array.isArray(body.history) ? body.history.length : 0, tools, ms, ok: !failed, stop: out.stop, tokens: out.usage, pid })
  }
}
