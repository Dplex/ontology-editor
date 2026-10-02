import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EDIT_FORMAT } from '../lib/edit-file'
import { savedEdits } from './saved-edits'

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
