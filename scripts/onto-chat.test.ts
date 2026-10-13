// 온톨로지 질의 챗봇(ADR-0050)의 서버 쪽 전 구간: 반영본 찾기 → MCP 도구 → 챗봇(createChat) → 답.
// 진짜 gemini 대신 fixtures/fake-gemini-acp.mjs 가 ACP 로 말하고, 설정 파일의 MCP 서버를 실제로 띄워 도구를 부른다.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as WebIFC from 'web-ifc'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from '../src/lib/ifc/import'
import { modelToTTL } from '../src/lib/export/ttl'
// @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
import { createChat } from './docs-chat.mjs'
// @ts-expect-error — 위와 같다
import { sources } from './onto-sources.mjs'

const ROOT = resolve(__dirname, '..')
const data = mkdtempSync(join(tmpdir(), 'onto-'))

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const ttl = modelToTTL(importIfc(api, new Uint8Array(readFileSync(resolve(ROOT, 'src/lib/ifc/fixtures/mep.ifc')))))
  // 반영본 한 벌: data/.layouts/<열쇠>/current.json → v2/ontology.ttl (src/server/layouts.ts 와 같은 모양)
  const base = join(data, '.layouts', '0123456789abcdef0123')
  mkdirSync(join(base, 'v2'), { recursive: true })
  writeFileSync(join(base, 'key.json'), JSON.stringify({ key: 'mep/mep.ifc', paths: ['mep/mep.ifc'] }))
  writeFileSync(join(base, 'current.json'), JSON.stringify({ version: 2 }))
  writeFileSync(join(base, 'v2', 'meta.json'), JSON.stringify({ version: 2, at: '2026-10-11T00:00:00Z', by: '시험' }))
  writeFileSync(join(base, 'v2', 'ontology.ttl'), ttl)
}, 60_000)

/** MCP 서버를 띄우고 요청들을 차례로 보내 답을 모은다. */
function mcp(requests: object[]): Promise<{ id: number; result?: { content: { text: string }[]; isError: boolean }; error?: unknown }[]> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(ROOT, 'scripts/onto-mcp.mjs')], { env: { ...process.env, ONTO_DATA: data }, stdio: ['pipe', 'pipe', 'ignore'] })
    const out: never[] = []
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d
      for (let nl; (nl = buf.indexOf('\n')) >= 0; buf = buf.slice(nl + 1)) out.push(JSON.parse(buf.slice(0, nl)) as never)
      if (out.length === requests.length) { child.kill(); done(out) }
    })
    for (const r of requests) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...r })}\n`)
  })
}
const call = (id: number, name: string, args: object) => ({ id, method: 'tools/call', params: { name, arguments: args } })
const body = (r: { result?: { content: { text: string }[] } }) => JSON.parse(r.result!.content[0].text)

describe('반영본 찾기', () => {
  it('data/.layouts 의 현재 버전 TTL — source 는 열쇠 폴더 앞 12자', () => {
    expect(sources(data).map(({ file, ...s }: { file: string }) => s)).toEqual([{ source: '0123456789ab', title: 'mep.ifc', version: 2, at: '2026-10-11T00:00:00Z', by: '시험', key: 'mep/mep.ifc' }])
  })
})

describe('MCP 도구', () => {
  it('도구는 읽기만 — 목록·찾기·관계·질의(받는 쪽 결과 수 같이)', async () => {
    const [init, list, src, found, q, bad] = await mcp([
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      { id: 2, method: 'tools/list' },
      call(3, 'onto_sources', {}),
      call(4, 'onto_find', { text: 'AHU' }),
      call(5, 'onto_query', { patterns: [['?r', 'ex:roomNumber', '"101"']] }),
      call(6, 'onto_describe', { id: '없는것' }),
    ])
    expect((init.result as unknown as { serverInfo: { name: string } }).serverInfo.name).toBe('ontology-editor-onto')
    const names = (list.result as unknown as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names).toEqual(['onto_sources', 'onto_overview', 'onto_find', 'onto_describe', 'onto_walk', 'onto_query'])
    expect(names.some((n) => /write|edit|set|delete/.test(n))).toBe(false)
    expect(body(src).sources[0].source).toBe('0123456789ab')
    expect(body(found).results[0]).toMatchObject({ label: 'AHU-1', in: { label: '사무실' } })
    // 방번호는 우리 TTL 에만 있다 — 받는 쪽 파서는 ex: 속성을 버린다
    expect(body(q)).toMatchObject({ total: 1, receiver: { total: 0 }, version: 2 })
    expect(bad.result!.isError).toBe(true)
  })
})

describe('챗봇(가짜 gemini)', () => {
  // createChat 은 만들 때 gemini 가 있는지 확인하므로 가짜를 먼저 둔다
  process.env.DOCS_CHAT_GEMINI = resolve(ROOT, 'scripts/fixtures/fake-gemini-acp.mjs')
  const live = createChat({
    root: ROOT,
    name: 'onto',
    mcp: { script: 'scripts/onto-mcp.mjs', env: { ONTO_DATA: data } },
    policyFile: 'scripts/onto-chat.policy.toml',
    systemFile: 'scripts/onto-chat.md',
    context: (b: { source?: string }) => (b.source ? `[건물] source="${b.source}"` : ''),
  })
  afterAll(() => live.close())

  it('onto 정책·onto MCP 하나만 허용해 띄우고, 고른 건물을 질문 앞에 붙이며, 도구 결과로 답한다', async () => {
    const r = await live.ask('AHU 어디 있어?', { body: { source: '0123456789ab' } })
    expect(r.ok).toBe(true)
    expect(r.tools).toEqual([{ name: 'onto_find', args: { text: 'AHU' } }])
    expect(r.text).toContain('server=onto')
    expect(r.text).toContain('--allowed-mcp-server-names onto')
    expect(r.text).toMatch(/--admin-policy \S*onto-chat\.policy\.toml/)
    expect(r.text).toContain('source=0123456789ab')
    expect(r.text).toContain('AHU-1 (`ex:0MEP$Equip$AHU1$0000`) @ 사무실')
    // 작업 폴더의 설정에는 onto 서버 하나뿐이다
    const settings = JSON.parse(readFileSync(resolve(ROOT, 'run/onto-chat/.gemini/settings.json'), 'utf8'))
    expect(Object.keys(settings.mcpServers)).toEqual(['onto'])
  }, 60_000)
})

// "지금 화면 (반영 전)"(ADR-0050). 화면이 올린 TTL 은 OS 임시 폴더에 토큰 이름으로 두고(onto-screen.mjs), 도구가 ONTO_SCREENS 로 읽는다.
describe('지금 화면 (반영 전)', () => {
  const screens = mkdtempSync(join(tmpdir(), 'onto-screen-'))
  const token = 'abcdefghij0123456789wxyz'
  let base = ''
  let server: import('node:http').Server

  beforeAll(async () => {
    const { createServer } = await import('node:http')
    // @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
    const { createScreenStore } = await import('./onto-screen.mjs')
    server = createServer(createScreenStore({ dir: screens }))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`
  })
  afterAll(() => server.close())

  const ttl = () => readFileSync(join(data, '.layouts', '0123456789abcdef0123', 'v2', 'ontology.ttl'), 'utf8')

  it('올리면 토큰 이름으로 두고 source 를 돌려준다 — 토큰이 틀리면 받지 않는다', async () => {
    const bad = await fetch(`${base}/__ask/screen?token=짧다`, { method: 'POST', body: 'x' })
    expect(bad.status).toBe(400)
    const r = await fetch(`${base}/__ask/screen?token=${token}&title=mep.ifc&by=${encodeURIComponent('시험')}`, { method: 'POST', body: ttl() })
    expect(await r.json()).toMatchObject({ source: `screen-${token}` })
    const all = sources(data, '', screens)
    expect(all.find((s: { screen?: boolean }) => s.screen)).toMatchObject({ source: `screen-${token}`, title: 'mep.ifc · 지금 화면(반영 전)', by: '시험', screen: true })
    // 화면 기준 폴더를 안 주면 반영본만이다
    expect(sources(data).some((s: { screen?: boolean }) => s.screen)).toBe(false)
  })

  it('도구는 화면 기준을 목록에 내지 않지만 source 로 주면 읽는다. source 를 안 주면 반영본이다', async () => {
    const [src, found, overview, missing] = await new Promise<{ result?: { content: { text: string }[] } }[]>((done) => {
      const child = spawn(process.execPath, [resolve(ROOT, 'scripts/onto-mcp.mjs')], { env: { ...process.env, ONTO_DATA: data, ONTO_SCREENS: screens }, stdio: ['pipe', 'pipe', 'ignore'] })
      const out: never[] = []
      let buf = ''
      child.stdout.on('data', (d) => {
        buf += d
        for (let nl; (nl = buf.indexOf('\n')) >= 0; buf = buf.slice(nl + 1)) out.push(JSON.parse(buf.slice(0, nl)) as never)
        if (out.length === 4) { child.kill(); done(out) }
      })
      for (const r of [call(1, 'onto_sources', {}), call(2, 'onto_find', { text: 'AHU', source: `screen-${token}` }), call(3, 'onto_overview', {}), call(4, 'onto_find', { text: 'AHU', source: 'duplex' })])
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...r })}\n`)
    })
    expect(body(src).sources.map((s: { source: string }) => s.source)).toEqual(['0123456789ab'])
    expect(body(found).results[0]).toMatchObject({ label: 'AHU-1' })
    expect(JSON.stringify(body(overview))).toContain('0123456789ab')
    // 없는 건물을 물었을 때 "있는 것" 에 화면 토큰을 내지 않는다 — 냈더니 gemini 가 다른 탭의 반영 전 화면으로 답했다
    expect(missing.result!.content[0].text).toContain('0123456789ab')
    expect(missing.result!.content[0].text).not.toContain('screen-')
  })

  it('두 시간 넘게 안 올린 화면은 다음에 누가 올릴 때 지운다', async () => {
    const { utimesSync, existsSync } = await import('node:fs')
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
    utimesSync(join(screens, `${token}.ttl`), old, old)
    await fetch(`${base}/__ask/screen?token=zzzzzzzzzzzzzzzzzzzzzzzz`, { method: 'POST', body: ttl() })
    expect(existsSync(join(screens, `${token}.ttl`))).toBe(false)
    expect(existsSync(join(screens, `${token}.json`))).toBe(false)
    expect(existsSync(join(screens, 'zzzzzzzzzzzzzzzzzzzzzzzz.ttl'))).toBe(true)
  })
})
