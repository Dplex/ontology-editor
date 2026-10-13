import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EDIT_FORMAT } from '../lib/edit-file'
import { floorState, LOCK_MS } from './floor-state'

// 층마다의 임시 저장본·편집 잠금(OE-WF-01~05, OE-COM-03·05·06). 사람은 머리 `X-OE-User` 그대로 받는 흉내(역할 검사는 users.test.ts).

let root: string
let server: Server
let base: string
let clock = new Date('2026-10-10T09:00:00Z')
const KEY = 'a.ifc'
const as = (name: string): Record<string, string> => ({ 'X-OE-User': encodeURIComponent(name) })
const url = (path: string, q: Record<string, string> = {}) => `${base}/${path}?${new URLSearchParams({ key: KEY, ...q })}`
const part = (n: number) => JSON.stringify({ format: EDIT_FORMAT, version: 1, source: 'a.ifc', savedAt: 'x', equipment: Array.from({ length: n }, (_, i) => ({ id: `E${i}`, position: [i, 0, 0] })), spaces: [], kinds: [], flows: [], confirmedSystems: [] })
const lock = (who: string, floor: string) => fetch(url('__locks', { floor }), { method: 'PUT', headers: as(who) })

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'floor-state-'))
  writeFileSync(join(root, 'a.ifc'), 'ISO-10303-21;')
  const writer = (req: import('node:http').IncomingMessage) => ({ name: decodeURIComponent(String(req.headers['x-oe-user'] ?? '')) })
  const { drafts, locks } = floorState(root, writer, () => clock)
  server = createServer((req, res) => {
    const [path, query] = (req.url ?? '').split('?')
    if (path === '/__drafts') drafts(req, res, query ?? '')
    else if (path === '/__locks') locks(req, res, query ?? '')
    else res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('층마다 임시 저장본', () => {
  it('층마다 하나이고 다시 저장하면 덮으며, 다른 사람이 받아 이어 편집한다 [OE-WF-03#1] [OE-COM-03#1~]', async () => {
    expect(await (await fetch(url('__drafts'))).json()).toEqual({})
    expect((await fetch(url('__drafts', { floor: '1F' }), { method: 'PUT', headers: as('A'), body: part(1) })).status).toBe(200)
    expect((await fetch(url('__drafts', { floor: '1F' }), { method: 'PUT', headers: as('A'), body: part(2) })).status).toBe(200)
    expect((await fetch(url('__drafts', { floor: '*' }), { method: 'PUT', headers: as('A'), body: part(1) })).status).toBe(200)
    const got = (await (await fetch(url('__drafts'))).json()) as Record<string, { by: string; file: { equipment: unknown[] } }>
    expect(Object.keys(got).sort()).toEqual(['*', '1F'])
    expect([got['1F'].by, got['1F'].file.equipment.length]).toEqual(['A', 2])
    // 편집 파일이 아니면 받지 않는다.
    expect((await fetch(url('__drafts', { floor: '1F' }), { method: 'PUT', headers: as('A'), body: '{}' })).status).toBe(400)
  })

  it('폐기는 그 층만, 반영 뒤에는 전부 지운다 [OE-WF-04#1~]', async () => {
    await fetch(url('__drafts', { floor: '1F' }), { method: 'DELETE', headers: as('B') })
    expect(Object.keys(await (await fetch(url('__drafts'))).json())).toEqual(['*'])
    await fetch(url('__drafts'), { method: 'DELETE', headers: as('B') })
    expect(await (await fetch(url('__drafts'))).json()).toEqual({})
  })
})

describe('층 잠금', () => {
  it('같은 층은 한 사람만, 다른 층은 동시에. 남이 잡은 층은 그 사람 이름과 거절된다 [OE-COM-05#1] [OE-COM-05#2]', async () => {
    expect((await lock('A', '1F')).status).toBe(200)
    const r = await lock('B', '1F')
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ error: 'A님이 편집 중입니다', by: 'A' })
    expect((await lock('B', '2F')).status).toBe(200)
    // 같은 사람이 다시 잡으면 늘인다.
    expect((await lock('A', '1F')).status).toBe(200)
    expect(((await (await fetch(url('__locks'))).json()) as { floor: string; by: string }[]).map((l) => [l.floor, l.by]).sort()).toEqual([
      ['1F', 'A'],
      ['2F', 'B'],
    ])
  })

  it('잡은 사람이 풀면 바로 다른 사람이 들어가고, 남의 잠금은 풀지 못한다 [OE-COM-06#1] [OE-COM-06#2~] [OE-WF-05#1]', async () => {
    await fetch(url('__locks', { floor: '1F' }), { method: 'DELETE', headers: as('B') })
    expect((await lock('B', '1F')).status).toBe(409)
    await fetch(url('__locks', { floor: '1F' }), { method: 'DELETE', headers: as('A') })
    expect((await lock('B', '1F')).status).toBe(200)
  })

  it('풀지 못하고 떠난 잠금은 2분 뒤 저절로 풀린다', async () => {
    expect((await lock('C', '1F')).status).toBe(409)
    clock = new Date(clock.getTime() + LOCK_MS + 1000)
    expect(await (await fetch(url('__locks'))).json()).toEqual([])
    expect((await lock('C', '1F')).status).toBe(200)
  })
})
