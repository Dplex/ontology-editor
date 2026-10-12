import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EDIT_FORMAT } from '../lib/edit-file'
import { createDataCatalog } from './data-catalog'
import { DEFAULT_USERS } from './users'

// 사람·역할(OE-COM-01·02)과 시스템 로그(OE-COM-04, OE-XPRD-01). `/__data` 전체(data-catalog.ts)를 띄워 화면이 부르는 경로 그대로 잰다.

let root: string
let server: Server
let base: string
const as = (name: string | null): Record<string, string> => (name ? { 'X-OE-User': encodeURIComponent(name) } : {})
const editFile = { format: EDIT_FORMAT, version: 1, source: 'a.ifc', savedAt: '2026-10-10T00:00:00Z', equipment: [{ id: 'E1', position: [1, 0, 0] }], spaces: [], kinds: [], flows: [], confirmedSystems: [] }
const saveEdits = (who: string | null) => fetch(`${base}/__data/__edits?key=a.ifc`, { method: 'PUT', headers: as(who), body: JSON.stringify(editFile) })
async function publish(who: string) {
  const q = (x: Record<string, string>) => `${base}/__data/__layouts?${new URLSearchParams({ key: 'a.ifc', ...x })}`
  for (const file of ['ontology.ttl', 'edits.json', 'tree.json', 'geojson/1F.geojson'])
    await fetch(q({ stage: 'stage00001', file }), { method: 'PUT', headers: as(who), body: '{}' })
  return fetch(q({ stage: 'stage00001', publish: '' }), { method: 'POST', headers: as(who), body: JSON.stringify({ by: '몸통의 이름은 쓰지 않는다', floors: ['1F'] }) })
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'users-'))
  writeFileSync(join(root, 'a.ifc'), 'ISO-10303-21;')
  const catalog = createDataCatalog(root)
  server = createServer((req, res) => {
    if (!req.url?.startsWith('/__data')) return res.writeHead(404).end()
    req.url = req.url.slice('/__data'.length) || '/'
    catalog(req, res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('사람·역할', () => {
  it('처음 띄우면 data/.users.json 에 기본 목록을 만들고 돌려준다. 숨은 파일이라 샘플 목록에는 없다', async () => {
    expect(await (await fetch(`${base}/__data/__users`)).json()).toEqual(DEFAULT_USERS)
    expect(JSON.parse(readFileSync(join(root, '.users.json'), 'utf-8'))).toEqual(DEFAULT_USERS)
    expect((await (await fetch(`${base}/__data/`)).json()).map((f: { path: string }) => f.path)).toEqual(['a.ifc'])
  })

  it('사람을 고르지 않았거나 보기 전용(Viewer)이면 저장·반영을 받지 않는다 [OE-COM-01#2]', async () => {
    expect((await saveEdits(null)).status).toBe(401)
    const viewer = await saveEdits('보기 전용')
    expect(viewer.status).toBe(403)
    expect((await viewer.json()).error).toBe('보기 전용은(는) 보기 전용(Viewer)이라 편집·저장·반영할 수 없습니다')
    expect((await saveEdits('없는 사람')).status).toBe(401)
    expect((await publish('보기 전용')).status).toBe(403)
  })

  it('편집할 수 있는 사람이 직접 반영하고, 반영자는 고른 사람이다 — 승인 단계는 없다 [OE-COM-02#1]', async () => {
    expect((await saveEdits('편집자')).status).toBe(200)
    const r = await publish('관리자')
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ version: 1, by: '관리자' })
  })
})

describe('시스템 로그', () => {
  it('저장·반영은 서버가, 편집 시작·종료는 화면이 남기고, 그 건물의 것을 새것부터 읽는다 [OE-COM-04#1]', async () => {
    const post = (who: string | null, body: unknown) => fetch(`${base}/__data/__log`, { method: 'POST', headers: as(who), body: JSON.stringify(body) })
    expect((await post('편집자', { type: 'edit-start', key: 'a.ifc', floors: ['1F'] })).status).toBe(200)
    expect((await post('보기 전용', { type: 'edit-start', key: 'a.ifc', floors: [] })).status).toBe(403)
    expect((await post('편집자', { type: 'publish', key: 'a.ifc' })).status).toBe(400)
    const log = (await (await fetch(`${base}/__data/__log?key=a.ifc`)).json()) as { type: string; user: string; version?: number; floors: string[] }[]
    expect(log.map((e) => [e.type, e.user, e.version ?? null])).toEqual([
      ['edit-start', '편집자', null],
      ['publish', '관리자', 1],
      ['save', '편집자', null],
    ])
    expect(log[1].floors).toEqual(['1F'])
  })
})
