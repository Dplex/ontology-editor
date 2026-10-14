import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EDIT_FORMAT } from '../lib/edit-file'
import { floorState } from './floor-state'
import { projects, type ProjectRow } from './projects'
import { dataKeyPaths } from './saved-edits'

// 프로젝트(OE-UI-02·03). 사람은 머리 `X-OE-User` 그대로 받는 흉내(역할 검사는 users.test.ts).

let root: string
let server: Server
let base: string
const as = (name: string): Record<string, string> => ({ 'X-OE-User': encodeURIComponent(name), 'Content-Type': 'application/json' })
const part = JSON.stringify({ format: EDIT_FORMAT, version: 1, source: 'a.ifc', savedAt: 'x', equipment: [{ id: 'E1', position: [1, 0, 0] }], spaces: [], kinds: [], flows: [], confirmedSystems: [] })
const create = (body: unknown, who = '편집자') => fetch(`${base}/__projects`, { method: 'POST', headers: as(who), body: JSON.stringify(body) })
const list = async () => (await (await fetch(`${base}/__projects`)).json()) as ProjectRow[]

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'projects-'))
  writeFileSync(join(root, 'a.ifc'), 'ISO-10303-21;')
  writeFileSync(join(root, 'b.ifc'), 'ISO-10303-21;')
  const writer = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const name = decodeURIComponent(String(req.headers['x-oe-user'] ?? ''))
    if (name === '보기 전용') {
      res.writeHead(403).end('{}')
      return null
    }
    return { name }
  }
  const store = projects(root, writer, () => new Date('2026-10-13T12:00:00Z'))
  const { drafts } = floorState(root, writer)
  server = createServer((req, res) => {
    const [path, query] = (req.url ?? '').split('?')
    if (path === '/__projects') store.handle(req, res, query ?? '')
    else if (path === '/__upload') store.upload(req, res, query ?? '')
    else if (path === '/__drafts') drafts(req, res, query ?? '')
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

describe('프로젝트 (OE-UI-02)', () => {
  it('이름·사이트·IFC 가 있어야 만들고, 보기 전용은 못 만든다', async () => {
    expect((await create({ name: '', site: 'S', paths: ['a.ifc'] })).status).toBe(400)
    expect((await create({ name: 'P', site: '', paths: ['a.ifc'] })).status).toBe(400)
    // 프로젝트는 반드시 IFC 를 쓴다. data/ 에 없는 파일·IFC 가 아닌 파일은 받지 않는다.
    expect((await create({ name: 'P', site: 'S', paths: [] })).status).toBe(400)
    expect((await create({ name: 'P', site: 'S', paths: ['없음.ifc'] })).status).toBe(400)
    expect((await create({ name: 'P', site: 'S', paths: ['../a.ifc'] })).status).toBe(400)
    expect((await create({ name: 'P', site: 'S', paths: ['a.ifc'] }, '보기 전용')).status).toBe(403)
    expect(await list()).toEqual([])
  })

  it('같은 IFC 로 프로젝트를 둘 만들면 열쇠가 달라 임시 저장본이 섞이지 않는다 [OE-UI-02#4]', async () => {
    const a = (await (await create({ name: '본관 구축', site: 'SR 캠퍼스', paths: ['a.ifc', 'b.ifc'] })).json()) as ProjectRow
    const b = (await (await create({ name: '본관 다시', site: 'SR 캠퍼스', paths: ['a.ifc', 'b.ifc'] })).json()) as ProjectRow
    expect(a.key).toBe(`@${a.id}|a.ifc|b.ifc`)
    expect(a.key).not.toBe(b.key)
    // 열쇠는 그 프로젝트가 있어야 받는다.
    expect(dataKeyPaths(root, a.key)).toEqual(['a.ifc', 'b.ifc'])
    expect(dataKeyPaths(root, '@p000000000000|a.ifc')).toBeNull()
    expect(dataKeyPaths(root, '@../x|a.ifc')).toBeNull()

    const put = await fetch(`${base}/__drafts?${new URLSearchParams({ key: a.key, floor: 'L1' })}`, { method: 'PUT', headers: as('편집자'), body: part })
    expect(put.status).toBe(200)
    const rows = await list()
    expect(rows.find((r) => r.id === a.id)?.drafts).toEqual([{ floor: 'L1', by: '편집자', savedAt: expect.any(String) }])
    expect(rows.find((r) => r.id === b.id)?.drafts).toEqual([])
    expect(rows.every((r) => r.built === null)).toBe(true)
    expect(rows.find((r) => r.id === b.id)).toMatchObject({ name: '본관 다시', site: 'SR 캠퍼스', createdBy: '편집자', paths: ['a.ifc', 'b.ifc'] })
  })

  it('화면이 센 층 구성을 받아 두고, 모양이 맞지 않으면 받지 않는다 [OE-UI-03#1~]', async () => {
    const p = (await list()).find((r) => r.name === '본관 구축')!
    const summary = { buildings: [{ name: 'A동', storeys: [{ key: 'L1', name: '1F', elevation: 0 }, { key: 'B1', name: 'B1F', elevation: -4 }] }] }
    expect((await fetch(`${base}/__projects?id=${p.id}&summary`, { method: 'PUT', body: JSON.stringify(summary) })).status).toBe(200)
    expect((await list()).find((r) => r.id === p.id)?.summary).toEqual(summary)
    expect((await fetch(`${base}/__projects?id=${p.id}&summary`, { method: 'PUT', body: JSON.stringify({ buildings: [{ name: 'A', storeys: [{ key: 1 }] }] }) })).status).toBe(400)
    expect((await fetch(`${base}/__projects?id=p999999999999&summary`, { method: 'PUT', body: JSON.stringify(summary) })).status).toBe(404)
  })
})

describe('IFC 올리기', () => {
  it('data/uploads 아래 시각을 붙인 이름으로 두고, 그 경로로 프로젝트를 만든다', async () => {
    const r = await fetch(`${base}/__upload?name=${encodeURIComponent('본관 건축.ifc')}`, { method: 'POST', headers: as('편집자'), body: 'ISO-10303-21;\nEND-ISO-10303-21;' })
    expect(r.status).toBe(200)
    const { path } = (await r.json()) as { path: string }
    expect(path).toBe('uploads/20261013-120000-본관 건축.ifc')
    expect(readFileSync(join(root, path), 'utf-8')).toContain('ISO-10303-21')
    expect((await create({ name: '올린 것', site: 'S', paths: [path] })).status).toBe(200)
  })

  it('IFC 가 아니거나 빈 파일, 보기 전용은 받지 않고 반쯤 쓴 파일을 남기지 않는다', async () => {
    expect((await fetch(`${base}/__upload?name=x.txt`, { method: 'POST', headers: as('편집자'), body: 'x' })).status).toBe(400)
    expect((await fetch(`${base}/__upload?name=x.ifc`, { method: 'POST', headers: as('편집자'), body: '' })).status).toBe(400)
    expect((await fetch(`${base}/__upload?name=x.ifc`, { method: 'POST', headers: as('보기 전용'), body: 'x' })).status).toBe(403)
    mkdirSync(join(root, 'uploads'), { recursive: true })
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(join(root, 'uploads')).filter((n) => n.endsWith('.part'))).toEqual([])
  })
})
