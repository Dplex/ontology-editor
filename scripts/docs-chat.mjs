// 8084 의 문서 챗봇(Alt+Shift+K) 서버 쪽. serve.mjs 가 /__chat 에 붙인다(ADR-0001).
//
//   GET  /__chat         → { enabled, reason? }   창을 열 때 쓸 수 있는지 본다
//   POST /__chat         ← { question, history: [{ role: 'user'|'assistant', text }] }
//                        → NDJSON 스트림: {type:'tool', name, args} · {type:'text', text} · {type:'done', ms} · {type:'error', message}
//
// gemini CLI 를 headless 로 부른다. gemini 가 쓸 수 있는 도구는 scripts/docs-mcp.mjs(문서 읽기) 하나다 —
// 8084 는 사내망 누구나 열어서, 셸·파일 도구가 열려 있으면 질문 한 줄로 55 에서 아무 명령이나 돈다.
// 막는 곳은 둘이다: admin 정책(scripts/docs-chat.policy.toml)이 docs 서버 밖 도구를 전부 deny 하고,
// --allowed-mcp-server-names 가 다른 MCP 서버를 안 띄운다. 정책 파일이 없으면 아예 켜지 않는다.
//
// 작업 폴더는 run/docs-chat/ 이다(gitignore). 거기에 .gemini/settings.json(MCP 서버 등록)과 GEMINI.md(답하는 법)를
// 기동할 때 만든다 — repo 루트에서 돌리면 gemini 가 CLAUDE.md·소스까지 맥락으로 읽어 간다.
//
// 환경:
//   DOCS_CHAT=0                 끈다
//   DOCS_CHAT_GEMINI=gemini     gemini 실행 파일(테스트는 가짜를 넣는다)
//   GOOGLE_CLOUD_PROJECT        55 의 사내 계정은 이게 없으면 gemini 가 바로 죽는다. run.sh 가 ~/.bashrc 에서 옮겨 준다
//   DOCS_CHAT_MAX=2             동시에 도는 gemini 수. 넘으면 429
//   DOCS_CHAT_TIMEOUT=150       초. 넘으면 죽이고 error
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BODY = 64 * 1024
const MAX_QUESTION = 2000
const MAX_TURNS = 6 // 앞선 대화는 마지막 6개 말까지만 붙인다
const MAX_TURN_CHARS = 1500

export function createChat({ root, log = () => {} }) {
  const gemini = process.env.DOCS_CHAT_GEMINI || 'gemini'
  // .mjs·.js 를 주면 node 로 띄운다(테스트의 가짜 gemini). 셸은 거치지 않는다 — 질문이 인자로 가서 셸이 끼면 쪼개지고 풀린다.
  const run = (args, opt) => (/\.m?js$/.test(gemini) ? [process.execPath, [gemini, ...args], opt] : [gemini, args, opt])
  const policy = join(root, 'scripts/docs-chat.policy.toml')
  const max = Number(process.env.DOCS_CHAT_MAX) || 2
  const timeoutMs = (Number(process.env.DOCS_CHAT_TIMEOUT) || 150) * 1000

  let reason = null
  if (process.env.DOCS_CHAT === '0') reason = 'DOCS_CHAT=0 으로 꺼 두었다'
  else if (!existsSync(policy)) reason = `도구 제한 정책이 없다(${policy})`
  else if (spawnSync(...run(['--version'], { encoding: 'utf8', timeout: 20000 })).status !== 0) {
    reason = `이 서버에 gemini CLI 가 없다(${gemini})`
  }

  const work = join(root, 'run/docs-chat')
  if (!reason) {
    mkdirSync(join(work, '.gemini'), { recursive: true })
    writeFileSync(join(work, '.gemini/settings.json'), JSON.stringify({
      mcpServers: {
        docs: { command: process.execPath, args: [join(root, 'scripts/docs-mcp.mjs')], env: { DOCS_ROOT: root }, trust: true, timeout: 30000 },
      },
    }, null, 2))
    writeFileSync(join(work, 'GEMINI.md'), readFileSync(join(root, 'scripts/docs-chat.md'), 'utf8'))
  }
  log({ msg: 'docs-chat', enabled: !reason, reason, gemini })

  let running = 0

  function prompt(question, history) {
    const turns = (Array.isArray(history) ? history : []).slice(-MAX_TURNS)
      .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string')
      .map(t => `${t.role === 'user' ? '사용자' : '챗봇'}: ${t.text.slice(0, MAX_TURN_CHARS)}`)
    return [
      turns.length ? `[앞선 대화]\n${turns.join('\n\n')}\n` : '',
      `[지금 질문]\n${question}`,
    ].join('\n')
  }

  /** gemini stream-json 한 줄 → 창에 보낼 이벤트(없으면 null). 칸 이름이 판마다 조금씩 달라 넓게 받는다. */
  function translate(ev) {
    if (ev.type === 'message' && (ev.role === 'assistant' || ev.role === 'model') && ev.content) {
      return { type: 'text', text: String(ev.content), delta: ev.delta !== false }
    }
    if (ev.type === 'tool_use') {
      const name = String(ev.tool_name || ev.name || '').replace(/^mcp_docs_/, '')
      return { type: 'tool', name, args: ev.parameters || ev.args || {} }
    }
    if (ev.type === 'tool_result' && (ev.status === 'error' || ev.error)) {
      return { type: 'tool_error', message: String(ev.error?.message || ev.output || '도구 실패').slice(0, 300) }
    }
    if (ev.type === 'error') return { type: 'warn', message: String(ev.message || '').slice(0, 300) }
    if (ev.type === 'result' && ev.status === 'error') return { type: 'error', message: String(ev.error?.message || '실패') }
    return null
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
    const started = Date.now()
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    const emit = ev => { if (!res.writableEnded) res.write(`${JSON.stringify(ev)}\n`) }

    const args = ['-p', prompt(question, body.history), '-o', 'stream-json',
      '--admin-policy', policy, '--allowed-mcp-server-names', 'docs', '--approval-mode', 'default']
    const child = spawn(...run(args, {
      cwd: work,
      env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: 'true', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
    const tools = []
    let buf = ''
    let stderr = ''
    let failed = false
    child.stdout.on('data', d => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('{')) continue
        let ev
        try { ev = JSON.parse(line) } catch { continue }
        const out = translate(ev)
        if (!out) continue
        if (out.type === 'tool') tools.push(out.name)
        if (out.type === 'error') failed = true
        emit(out)
      }
    })
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000) })
    const timer = setTimeout(() => { emit({ type: 'error', message: `${timeoutMs / 1000}초 안에 답이 안 왔다` }); failed = true; child.kill('SIGKILL') }, timeoutMs)
    // 창을 닫거나 새 질문을 하면 끊는다 — 아무도 안 읽는 답에 할당량을 쓰지 않게
    res.on('close', () => { if (child.exitCode === null) child.kill('SIGTERM') })

    child.on('close', code => {
      clearTimeout(timer)
      running--
      if (code !== 0 && !failed) {
        const last = stderr.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('at ')).slice(-2).join(' / ')
        emit({ type: 'error', message: `gemini 가 ${code} 로 끝났다${last ? `: ${last.slice(0, 300)}` : ''}` })
        failed = true
      }
      const ms = Date.now() - started
      emit({ type: 'done', ms })
      res.end()
      // 질문 내용은 남기지 않는다. 길이·도구·시간만
      log({ msg: 'chat', q_len: question.length, turns: Array.isArray(body.history) ? body.history.length : 0, tools, ms, ok: !failed, code })
    })
    child.on('error', e => { emit({ type: 'error', message: `gemini 를 못 띄웠다: ${e.message}` }); failed = true })
  }
}
