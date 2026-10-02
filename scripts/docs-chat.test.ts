// 문서 챗봇의 서버 쪽(/__chat). gemini 대신 가짜를 띄워서, 도구 제한이 실제로 넘어가는지와
// 스트림·오류·동시 실행 제한을 본다. 진짜 gemini 왕복은 55 에서만 된다(ADR-0001).
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
import { createChat } from './docs-chat.mjs'

const ROOT = resolve(__dirname, '..')
const dir = mkdtempSync(join(tmpdir(), 'docs-chat-'))
const fake = join(dir, 'fake-gemini.mjs')
const argsOut = join(dir, 'args.json')
writeFileSync(fake, `
import { writeFileSync } from 'node:fs'
const a = process.argv.slice(2)
if (a[0] === '--version') { console.log('0.0.0-fake'); process.exit(0) }
writeFileSync(${JSON.stringify(argsOut)}, JSON.stringify({ args: a, cwd: process.cwd(), trust: process.env.GEMINI_CLI_TRUST_WORKSPACE }))
const p = a[a.indexOf('-p') + 1]
if (p.includes('FAIL')) { console.error('Error: quota exceeded'); process.exit(1) }
const out = ev => console.log(JSON.stringify(ev))
out({ type: 'init', session_id: 's', model: 'fake' })
out({ type: 'message', role: 'user', content: p })
out({ type: 'tool_use', tool_name: 'mcp_docs_docs_search', tool_id: 't1', parameters: { query: '내력벽' } })
out({ type: 'tool_result', tool_id: 't1', status: 'success', output: '...' })
out({ type: 'message', role: 'assistant', content: '모름이면 ', delta: true })
if (p.includes('SLOW')) await new Promise(r => setTimeout(r, 1500))
out({ type: 'message', role: 'assistant', content: '편집할 수 있다.', delta: true })
out({ type: 'result', status: 'success', stats: {} })
`)

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

  it('gemini 에 도구 제한을 넘기고, 스트림을 창 이벤트로 바꾼다', async () => {
    const res = await ask({ question: '내력벽 모름이면?', history: [{ role: 'user', text: '안녕' }, { role: 'assistant', text: '네' }, { role: 'system', text: '무시' }] })
    expect(res.headers.get('content-type')).toContain('ndjson')
    const ev = await events(res)
    expect(ev.filter(e => e.type === 'tool')).toEqual([{ type: 'tool', name: 'docs_search', args: { query: '내력벽' } }])
    expect(ev.filter(e => e.type === 'text').map(e => e.text).join('')).toBe('모름이면 편집할 수 있다.')
    expect(ev.at(-1).type).toBe('done')
    expect(ev.some(e => e.text?.includes('내력벽 모름이면?'))).toBe(false) // 사용자 메시지 메아리는 안 보낸다

    const { args, cwd, trust } = JSON.parse(readFileSync(argsOut, 'utf8'))
    expect(args).toContain('--admin-policy')
    expect(args[args.indexOf('--admin-policy') + 1]).toBe(join(ROOT, 'scripts/docs-chat.policy.toml'))
    expect(args[args.indexOf('--allowed-mcp-server-names') + 1]).toBe('docs')
    expect(args[args.indexOf('-o') + 1]).toBe('stream-json')
    expect(args).not.toContain('--yolo')
    expect(resolve(cwd)).toBe(join(ROOT, 'run', 'docs-chat')) // repo 루트가 아니다 — CLAUDE.md·소스를 맥락으로 안 읽게
    expect(trust).toBe('true')
    const prompt = args[args.indexOf('-p') + 1]
    expect(prompt).toContain('사용자: 안녕')
    expect(prompt).toContain('챗봇: 네')
    expect(prompt).not.toContain('무시')
  })

  it('작업 폴더에 docs MCP 서버만 등록한다', () => {
    const s = JSON.parse(readFileSync(join(ROOT, 'run/docs-chat/.gemini/settings.json'), 'utf8'))
    expect(Object.keys(s.mcpServers)).toEqual(['docs'])
    expect(s.mcpServers.docs.args[0]).toBe(join(ROOT, 'scripts/docs-mcp.mjs'))
  })

  it('정책은 docs 서버 밖을 전부 막는다', () => {
    const toml = readFileSync(join(ROOT, 'scripts/docs-chat.policy.toml'), 'utf8')
    expect(toml).toMatch(/toolName = "\*"\s*\ndecision = "deny"\s*\npriority = 100/)
    expect(toml).toMatch(/mcpName = "docs"\s*\ntoolName = "\*"\s*\ndecision = "allow"\s*\npriority = 900/)
  })

  it('빈 질문 400, 긴 질문 413', async () => {
    expect((await ask({ question: '  ' })).status).toBe(400)
    expect((await ask({ question: 'ㄱ'.repeat(2001) })).status).toBe(413)
  })

  it('gemini 가 실패하면 그 이유를 error 로 준다', async () => {
    const ev = await events(await ask({ question: 'FAIL' }))
    expect(ev.find(e => e.type === 'error').message).toMatch(/1 로 끝났다: Error: quota exceeded/)
    expect(logs.at(-1)).toMatchObject({ msg: 'chat', ok: false })
    expect(JSON.stringify(logs.at(-1))).not.toContain('FAIL') // 질문 내용은 로그에 안 남긴다
  })

  it('동시 실행이 한도를 넘으면 429', async () => {
    const slow = ask({ question: 'SLOW' })
    await new Promise(r => setTimeout(r, 300))
    expect((await ask({ question: '둘째' })).status).toBe(429)
    expect((await events(await slow)).at(-1).type).toBe('done')
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
