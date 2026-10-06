// 문서 챗봇의 서버 쪽(/__chat). gemini 대신 ACP 를 흉내 내는 가짜를 띄워서, 도구 제한이 실제로 넘어가는지와
// 프로세스 하나를 여러 질문이 나눠 쓰는지, 스트림·오류·동시 실행 제한을 본다. 진짜 gemini 왕복은 55 에서만 된다(ADR-0001).
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
import { createChat, parseToolTitle } from './docs-chat.mjs'

const ROOT = resolve(__dirname, '..')
const dir = mkdtempSync(join(tmpdir(), 'docs-chat-'))
const fake = join(dir, 'fake-gemini.mjs')
const startsOut = join(dir, 'starts.jsonl')
const promptsOut = join(dir, 'prompts.jsonl')
const repliesOut = join(dir, 'replies.jsonl')
// gemini --acp 흉내: initialize · session/new · session/prompt · session/cancel 을 받고 session/update 를 보낸다.
// 질문에 PERM 이 있으면 이쪽에 권한을 묻고, CRASH 가 있으면 처음 한 번은 죽는다, FAIL 이면 prompt 를 오류로 답한다.
writeFileSync(fake, `
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
const a = process.argv.slice(2)
if (a[0] === '--version') { console.log('0.0.0-fake'); process.exit(0) }
appendFileSync(${JSON.stringify(startsOut)}, JSON.stringify({ args: a, cwd: process.cwd(), trust: process.env.GEMINI_CLI_TRUST_WORKSPACE, system: process.env.GEMINI_SYSTEM_MD }) + '\\n')
const out = m => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
const update = (sessionId, u) => out({ method: 'session/update', params: { sessionId, update: u } })
const cancelled = new Set()
let n = 0, buf = ''
console.log('경고: stdout 에 섞여 나오는 글')
process.stdin.on('data', async d => {
  buf += d
  let nl
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1)
    if (m.method === 'initialize') out({ id: m.id, result: { protocolVersion: 1 } })
    else if (m.method === 'session/new') out({ id: m.id, result: { sessionId: 's' + (++n) } })
    else if (m.method === 'session/cancel') cancelled.add(m.params.sessionId)
    else if (m.method === undefined) appendFileSync(${JSON.stringify(repliesOut)}, JSON.stringify(m) + '\\n')
    else if (m.method === 'session/prompt') {
      const s = m.params.sessionId, p = m.params.prompt[0].text
      appendFileSync(${JSON.stringify(promptsOut)}, JSON.stringify({ s, p }) + '\\n')
      if (p.includes('CRASH') && !existsSync(${JSON.stringify(join(dir, 'crashed'))})) { writeFileSync(${JSON.stringify(join(dir, 'crashed'))}, ''); process.exit(3) }
      if (p.includes('FAIL')) { out({ id: m.id, error: { code: -1, message: 'quota exceeded' } }); continue }
      if (p.includes('PERM')) out({ id: 900, method: 'session/request_permission', params: { sessionId: s } })
      update(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '생각' } })
      update(s, { sessionUpdate: 'tool_call', toolCallId: 'mcp_docs_docs_search__call_1', status: 'in_progress', title: 'docs_search(query: 내력벽, 모름)', kind: 'other' })
      update(s, { sessionUpdate: 'tool_call_update', toolCallId: 'mcp_docs_docs_search__call_1', status: 'completed' })
      update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '모름이면 ' } })
      if (p.includes('SLOW')) await new Promise(r => setTimeout(r, 1500))
      update(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '편집할 수 있다.' } })
      out({ id: m.id, result: { stopReason: cancelled.has(s) ? 'cancelled' : 'end_turn', _meta: { quota: { token_count: { input_tokens: 100, output_tokens: 7 } } } } })
    }
  }
})
`)

const lines = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])

let server: Server
let base = ''
const logs: any[] = []

beforeAll(async () => {
  process.env.DOCS_CHAT_GEMINI = fake
  process.env.DOCS_CHAT_MAX = '1'
  const chat = createChat({ root: ROOT, log: (f: object) => logs.push(f) })
  server = createServer((req, res) => { chat(req, res) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/__chat`
})
afterAll(() => {
  server?.close()
  delete process.env.DOCS_CHAT_GEMINI
  delete process.env.DOCS_CHAT_MAX
})

const ask = (body: object) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const events = async (res: Response) => (await res.text()).trim().split('\n').map(l => JSON.parse(l))

describe('/__chat', () => {
  it('GET 은 쓸 수 있는지 답한다', async () => {
    expect(await (await fetch(base)).json()).toEqual({ enabled: true })
  })

  it('gemini --acp 를 도구 제한과 함께 띄우고, 세션 갱신을 창 이벤트로 바꾼다', async () => {
    const res = await ask({ question: '내력벽 모름이면?', history: [{ role: 'user', text: '안녕' }, { role: 'assistant', text: '네' }, { role: 'system', text: '무시' }] })
    expect(res.headers.get('content-type')).toContain('ndjson')
    const ev = await events(res)
    expect(ev.filter(e => e.type === 'tool')).toEqual([{ type: 'tool', name: 'docs_search', args: { query: '내력벽, 모름' } }])
    expect(ev.filter(e => e.type === 'text').map(e => e.text).join('')).toBe('모름이면 편집할 수 있다.')
    expect(ev.some(e => JSON.stringify(e).includes('생각'))).toBe(false) // 생각 조각은 창에 안 보낸다
    expect(ev.at(-1).type).toBe('done')

    const [{ args, cwd, trust, system }] = lines(startsOut)
    expect(args[0]).toBe('--acp')
    expect(args[args.indexOf('--admin-policy') + 1]).toBe(join(ROOT, 'scripts/docs-chat.policy.toml'))
    expect(args[args.indexOf('--allowed-mcp-server-names') + 1]).toBe('docs')
    expect(args).not.toContain('--yolo')
    expect(resolve(cwd)).toBe(join(ROOT, 'run', 'docs-chat')) // repo 루트가 아니다 — CLAUDE.md·소스를 맥락으로 안 읽게
    expect(trust).toBe('true')
    // 시스템 프롬프트를 답하는 법으로 갈아 끼운다
    expect(readFileSync(system, 'utf8')).toContain(readFileSync(join(ROOT, 'scripts/docs-chat.md'), 'utf8').trim())

    const { p } = lines(promptsOut).at(-1)
    expect(p).toContain('사용자: 안녕')
    expect(p).toContain('챗봇: 네')
    expect(p).toContain('[지금 질문]\n내력벽 모름이면?')
    expect(p).not.toContain('무시')
    expect(logs.at(-1)).toMatchObject({ msg: 'chat', ok: true, tools: ['docs_search'], tokens: { in: 100, out: 7 } })
  })

  it('두 번째 질문은 떠 있는 gemini 에 새 세션으로 묻는다', async () => {
    await events(await ask({ question: '둘째 질문' }))
    expect(lines(startsOut)).toHaveLength(1)
    const ps = lines(promptsOut)
    expect(new Set(ps.map(x => x.s)).size).toBe(ps.length)
  })

  it('작업 폴더에 docs MCP 서버만 등록하고 thinking 을 LOW 로 둔다', () => {
    const s = JSON.parse(readFileSync(join(ROOT, 'run/docs-chat/.gemini/settings.json'), 'utf8'))
    expect(Object.keys(s.mcpServers)).toEqual(['docs'])
    expect(s.mcpServers.docs.args[0]).toBe(join(ROOT, 'scripts/docs-mcp.mjs'))
    expect(s.modelConfigs.customAliases['chat-base-3'].modelConfig.generateContentConfig.thinkingConfig.thinkingLevel).toBe('LOW')
    expect(existsSync(join(ROOT, 'run/docs-chat/GEMINI.md'))).toBe(false)
  })

  it('정책은 docs 서버 밖을 전부 막는다', () => {
    const toml = readFileSync(join(ROOT, 'scripts/docs-chat.policy.toml'), 'utf8')
    expect(toml).toMatch(/toolName = "\*"\s*\ndecision = "deny"\s*\npriority = 100/)
    // docs 허용 줄에 toolName 을 붙이면 --acp 에서 docs 도구까지 막힌다(55 실측)
    expect(toml).toMatch(/\[\[rule\]\]\s*\nmcpName = "docs"\s*\ndecision = "allow"\s*\npriority = 900/)
  })

  it('gemini 가 권한을 물으면 cancelled 로 답한다', async () => {
    await events(await ask({ question: 'PERM' }))
    expect(lines(repliesOut)).toContainEqual({ jsonrpc: '2.0', id: 900, result: { outcome: { outcome: 'cancelled' } } })
  })

  it('빈 질문 400, 긴 질문 413', async () => {
    expect((await ask({ question: '  ' })).status).toBe(400)
    expect((await ask({ question: 'ㄱ'.repeat(2001) })).status).toBe(413)
  })

  it('gemini 가 실패하면 그 이유를 error 로 준다', async () => {
    const ev = await events(await ask({ question: 'FAIL' }))
    expect(ev.find(e => e.type === 'error').message).toMatch(/quota exceeded/)
    expect(logs.at(-1)).toMatchObject({ msg: 'chat', ok: false })
    expect(JSON.stringify(logs.at(-1))).not.toContain('FAIL') // 질문 내용은 로그에 안 남긴다
  })

  it('답하기 전에 gemini 가 죽으면 새로 띄워 한 번 더 묻는다', async () => {
    const before = lines(startsOut).length
    const ev = await events(await ask({ question: 'CRASH' }))
    expect(ev.filter(e => e.type === 'text').map(e => e.text).join('')).toBe('모름이면 편집할 수 있다.')
    expect(ev.some(e => e.type === 'error')).toBe(false)
    expect(lines(startsOut)).toHaveLength(before + 1)
  })

  it('동시 실행이 한도를 넘으면 429', async () => {
    const slow = ask({ question: 'SLOW' })
    await new Promise(r => setTimeout(r, 300))
    expect((await ask({ question: '둘째' })).status).toBe(429)
    expect((await events(await slow)).at(-1).type).toBe('done')
  })
})

describe('parseToolTitle', () => {
  it('ACP 제목에서 도구 이름과 인자를 꺼낸다', () => {
    expect(parseToolTitle('docs_ticket(id: ADR-0007)')).toEqual({ name: 'docs_ticket', args: { id: 'ADR-0007' } })
    expect(parseToolTitle('docs_read(path: docs/adr/README.md, section: 목록)')).toEqual({ name: 'docs_read', args: { path: 'docs/adr/README.md', section: '목록' } })
    expect(parseToolTitle('docs_map')).toEqual({ name: 'docs_map', args: {} })
  })
})

describe('gemini 가 없으면', () => {
  it('꺼진 채로 이유를 준다', async () => {
    process.env.DOCS_CHAT_GEMINI = join(dir, 'no-such-gemini')
    const chat = createChat({ root: ROOT })
    delete process.env.DOCS_CHAT_GEMINI
    const s = createServer((req, res) => { chat(req, res) })
    await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()))
    const addr = s.address()
    const url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`
    const j = await (await fetch(url)).json()
    expect(j.enabled).toBe(false)
    expect(j.reason).toMatch(/gemini CLI 가 없다/)
    expect((await fetch(url, { method: 'POST', body: '{"question":"x"}' })).status).toBe(503)
    s.close()
  })
})
