import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EDIT_FORMAT } from '../lib/edit-file'
import { recordWork, savedEdits, type Work } from './saved-edits'

// OE-COM-08 "저장 시 변경사항을 웹에서 바로 확인". 8084 가 편집 파일을 받아 두고 같은 파일을 여는 사람에게 돌려준다.
// 실제 HTTP 로 잰다 — 몸통을 조각으로 받는 것과 상태 코드가 화면이 기대하는 그대로인지.

let root: string
let server: Server
let base: string

const editFile = (n: number) => ({
  format: EDIT_FORMAT,
  version: 1,
  source: 'a.ifc',
  savedAt: new Date().toISOString(),
  equipment: Array.from({ length: n }, (_, i) => ({ id: `E${i}`, position: [i, 0, 0] })),
  spaces: [],
  kinds: [],
  flows: [],
  confirmedSystems: [],
})
const url = (key?: string) => `${base}/__edits${key ? `?key=${encodeURIComponent(key)}` : ''}`
const put = (key: string, body: unknown) => fetch(url(key), { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'saved-edits-'))
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'a.ifc'), 'ISO-10303-21;')
  writeFileSync(join(root, 'sub', 'b.ifc'), 'ISO-10303-21;')
  writeFileSync(join(root, 'z.idf'), 'Version, 24.2;')
  const handle = savedEdits(root)
  server = createServer((req, res) => {
    const [path, query] = (req.url ?? '').split('?')
    if (path === '/__edits') handle(req, res, query ?? '')
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

describe('8084 에 남기는 편집', () => {
  it('저장한 편집을 같은 열쇠로 돌려주고, 목록에 건수·시각이 뜬다', async () => {
    expect((await fetch(url('a.ifc'))).status).toBe(404)
    const r = await put('a.ifc', editFile(3))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ key: 'a.ifc', paths: ['a.ifc'], count: 3 })
    const got = await (await fetch(url('a.ifc'))).json()
    expect(got.equipment).toHaveLength(3)
    expect(await (await fetch(url())).json()).toEqual([expect.objectContaining({ key: 'a.ifc', count: 3 })])
  })

  it('합쳐 연 판은 경로 목록이 열쇠다 — 한 파일 판과 섞이지 않는다', async () => {
    expect((await put('a.ifc|sub/b.ifc', editFile(1))).status).toBe(200)
    expect((await (await fetch(url('a.ifc'))).json()).equipment).toHaveLength(3)
    expect((await (await fetch(url('a.ifc|sub/b.ifc'))).json()).equipment).toHaveLength(1)
  })

  it('IDF 만 연 판·IFC 에 IDF 를 덧붙인 판도 열쇠가 된다', async () => {
    expect((await put('z.idf', editFile(2))).status).toBe(200)
    expect((await put('a.ifc|z.idf', editFile(1))).status).toBe(200)
    expect((await (await fetch(url('z.idf'))).json()).equipment).toHaveLength(2)
  })

  it('덮어쓰면 앞 판을 history 에 남긴다', async () => {
    await put('a.ifc', editFile(5))
    expect((await (await fetch(url('a.ifc'))).json()).equipment).toHaveLength(5)
    expect(readdirSync(join(root, '.edits', 'history')).length).toBeGreaterThanOrEqual(1)
  })

  it('data/ 에 없는 파일·밖을 가리키는 경로·편집 파일이 아닌 몸통은 받지 않는다', async () => {
    expect((await put('none.ifc', editFile(1))).status).toBe(404)
    expect((await put('../a.ifc', editFile(1))).status).toBe(404)
    expect((await put('a.txt', editFile(1))).status).toBe(404)
    expect((await put('a.ifc', '{"format":"other"}')).status).toBe(400)
    expect((await put('a.ifc', 'not json')).status).toBe(400)
    expect((await fetch(url(), { method: 'PUT', body: '{}' })).status).toBe(405)
    expect((await fetch(url('a.ifc'), { method: 'DELETE' })).status).toBe(405)
    // 거절한 요청이 저장본을 건드리지 않았다
    expect((await (await fetch(url('a.ifc'))).json()).equipment).toHaveLength(5)
  })
})

describe('저장이 속한 작업 (OE-HIST-03 · OE-PIP-15)', () => {
  const save = (key: string, n: number, work: string, kind: 'floor' | 'multi', storeys: string[], by?: string) =>
    fetch(`${url(key)}&work=${work}&kind=${kind}&storeys=${storeys.map(encodeURIComponent).join(',')}`, {
      method: 'PUT',
      headers: by ? { 'X-OE-User': encodeURIComponent(by) } : {},
      body: JSON.stringify(editFile(n)),
    })
  const works = async (key: string) => (await (await fetch(`${url(key)}&works`)).json()) as Work[]

  it('층 작업과 다중층 세션은 다른 작업이고, 세션 안에서 여러 층·여러 번 저장해도 작업은 하나다 [OE-HIST-03#3~] [OE-PIP-15#8~]', async () => {
    const key = 'sub/b.ifc'
    expect(await works(key)).toEqual([])
    // 층 편집을 저장(다중층 진입 전) → 다중층 세션에서 1층·2층을 따로 두 번 저장 → 종료 저장 → 다시 층 편집.
    expect(await (await save(key, 2, 'floorA', 'floor', ['1F'], '김구축')).json()).toMatchObject({ work: 'floorA', count: 2 })
    await save(key, 3, 'multi1', 'multi', ['1F'])
    await save(key, 4, 'multi1', 'multi', ['2F'])
    await save(key, 5, 'multi1', 'multi', ['1F', '2F'], '이편집')
    await save(key, 6, 'floorB', 'floor', ['2F'])
    const got = await works(key)
    expect(got.map((w) => [w.id, w.kind, w.storeys, w.saves, w.base, w.edits])).toEqual([
      ['floorA', 'floor', ['1F'], 1, 0, 2],
      ['multi1', 'multi', ['1F', '2F'], 3, 2, 5],
      ['floorB', 'floor', ['2F'], 1, 5, 6],
    ])
    expect(got[0].by).toBe('김구축')
    expect(got[1].by).toBe('이편집')
    // 저장본은 마지막 저장 하나다(작업 목록은 저장본 곁에 붙는다).
    expect((await (await fetch(url(key))).json()).equipment).toHaveLength(6)
  })

  it('다시 다중층을 열면 별도 세션이다 — 같은 종류라도 id 가 다르면 새 작업이다', () => {
    let w: Work[] = []
    w = recordWork(w, { id: 'm1', kind: 'multi', storeys: ['1F'], at: 't1', edits: 1 })
    w = recordWork(w, { id: 'm2', kind: 'multi', storeys: ['1F'], at: 't2', edits: 1 })
    expect(w.map((x) => x.id)).toEqual(['m1', 'm2'])
    expect(w[1]).toMatchObject({ base: 1, edits: 1, saves: 1, startedAt: 't2' })
  })

  it('작업 칸 없이 온 저장은 그 저장 하나를 층 작업으로 치고, 틀린 작업 칸은 받지 않는다', async () => {
    const before = (await works('a.ifc')).length
    const r = await put('a.ifc', editFile(5))
    expect((await r.json()).work).toMatch(/^w/)
    const after = await works('a.ifc')
    expect(after).toHaveLength(before + 1)
    expect(after.at(-1)).toMatchObject({ kind: 'floor', saves: 1 })
    expect((await fetch(`${url('a.ifc')}&work=bad id`, { method: 'PUT', body: JSON.stringify(editFile(1)) })).status).toBe(400)
    expect((await fetch(`${url('a.ifc')}&work=ok&kind=other`, { method: 'PUT', body: JSON.stringify(editFile(1)) })).status).toBe(400)
    expect(await works('a.ifc')).toHaveLength(before + 1)
  })
})
