import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDataCatalog } from './data-catalog'

// 첫 화면 인트로의 장면(/__data/__intro, intro.ts). 장면은 data/.intro/ 에만 있고 data/ 의 다른 파일을 내주는 길이 되면 안 된다.
let root: string
let server: Server
let base: string
const scene = (name: string) => ({ name, building: name, files: [`${name}.ifc`], bakedAt: '2026-10-21T00:00:00Z', storeys: [] })

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'intro-'))
  mkdirSync(join(root, '.intro'))
  for (const n of ['duplex', 'seongsu', 'abc']) writeFileSync(join(root, '.intro', `${n}.json`), JSON.stringify(scene(n)))
  writeFileSync(join(root, '.users.json'), '[{"name":"비밀"}]')
  const catalog = createDataCatalog(root)
  server = createServer((req, res) => {
    req.url = req.url!.slice('/__data'.length) || '/'
    catalog(req, res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/__data/__intro`
})
afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('인트로 장면', () => {
  it('목록은 성수를 맨 앞에 두고 나머지는 이름 순이다', async () => {
    const list = (await (await fetch(base)).json()) as { name: string }[]
    expect(list.map((s) => s.name)).toEqual(['seongsu', 'abc', 'duplex'])
  })

  it('이름으로 장면 JSON 을 그대로 내준다', async () => {
    const r = await fetch(`${base}?name=duplex`)
    expect(r.status).toBe(200)
    expect(((await r.json()) as { name: string }).name).toBe('duplex')
  })

  it('없는 이름·경로를 넘는 이름은 404 다(.intro 밖 파일을 내주지 않는다)', async () => {
    for (const name of ['none', '../.users', '..%2F.users', '.users']) expect((await fetch(`${base}?name=${name}`)).status).toBe(404)
  })

  it('장면 폴더가 없으면 빈 목록이다', async () => {
    rmSync(join(root, '.intro'), { recursive: true })
    expect(await (await fetch(base)).json()).toEqual([])
  })
})
