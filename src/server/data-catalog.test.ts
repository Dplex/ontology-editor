import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as WebIFC from 'web-ifc'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes } from '../lib/ifc/import'
import { inferFlowByRules } from '../lib/flow-rules'
import { profileOf } from '../lib/profile'
import { createDataCatalog } from './data-catalog'

// 파일 목록의 등급 칩(OE-BIM-16). 목록 칩은 서버가 파일을 읽어 잰 것(`?profile`)이고, 검토 화면 칩은 브라우저가 연 모델로 잰 것이다.
// 화면은 워커에서 importIfcWithMeshes 로 읽고 규칙 방향을 한 번 더 돌린다(App.vue 의 load). 둘이 같은 수치여야 목록에서 고른 파일을
// 열었을 때 놀라지 않는다. e2e 는 data/ 목록을 붙이지 않아(vite.config.ts) 여기서 HTTP 로 부른다.
const FILES = ['src/lib/ifc/fixtures/mep.ifc', 'src/lib/ifc/fixtures/two-rooms.ifc', 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'].filter((f) => existsSync(f))

let root: string
let server: Server
let base: string
let api: WebIFC.IfcAPI
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'catalog-'))
  for (const f of FILES) copyFileSync(f, join(root, f.split('/').pop()!))
  const catalog = createDataCatalog(root)
  server = createServer((req, res) => {
    req.url = req.url!.slice('/__data'.length) || '/'
    catalog(req, res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('파일 목록과 검토 화면의 등급 칩', () => {
  it('목록이 잰 칩과 그 파일을 화면처럼 연 모델의 칩이 같은 수치다 [OE-BIM-16#1]', async () => {
    expect(FILES.length).toBeGreaterThanOrEqual(2)
    for (const f of FILES) {
      const name = f.split('/').pop()!
      const served = (await (await fetch(`${base}/__data/${name}?profile`)).json()) as { profile: ReturnType<typeof profileOf> }
      const opened = importIfcWithMeshes(api, new Uint8Array(readFileSync(f))).model
      inferFlowByRules(opened)
      const mine = profileOf(opened)
      expect(served.profile.tiers.map((t) => [t.key, t.figure, t.level]), name).toEqual(mine.tiers.map((t) => [t.key, t.figure, t.level]))
      expect(served.profile.tiers.length, name).toBeGreaterThan(0)
    }
  }, 120_000)
})

describe('IDF 도 목록에 보이고 내준다', () => {
  it('IDF 는 등급 대신 공조존·바닥·설비 수를 내고, 파일을 그대로 내주며, 바로 열기 묶음에도 넣을 수 있다', async () => {
    const { writeFileSync } = await import('node:fs')
    copyFileSync('src/lib/idf/fixtures/two-zones.idf', join(root, 'two-zones.idf'))
    writeFileSync(join(root, 'notes.txt'), 'x')
    const files = (await (await fetch(`${base}/__data/`)).json()) as { path: string }[]
    expect(files.map((f) => f.path)).toContain('two-zones.idf')
    expect(files.map((f) => f.path)).not.toContain('notes.txt')
    expect(await (await fetch(`${base}/__data/two-zones.idf?profile`)).json()).toEqual({ idf: { zones: 2, floors: 1, equipment: 4 } })
    expect(await (await fetch(`${base}/__data/two-zones.idf`)).text()).toContain('1F:OFFICE')
    expect((await fetch(`${base}/__data/notes.txt`)).status).toBe(404)
    const one = FILES[0].split('/').pop()!
    writeFileSync(join(root, '.open-sets.json'), JSON.stringify([{ title: 'IFC + IDF', paths: [one, 'two-zones.idf'] }]))
    expect(await (await fetch(`${base}/__data/__sets`)).json()).toEqual([{ title: 'IFC + IDF', paths: [one, 'two-zones.idf'] }])
  })
})

describe('[바로 열기] 묶음(data/.open-sets.json)', () => {
  it('파일이 다 있는 묶음만 내고, data/ 밖·없는 파일·틀린 모양은 뺀다', async () => {
    const { writeFileSync } = await import('node:fs')
    const one = FILES[0].split('/').pop()!
    const two = FILES[1].split('/').pop()!
    writeFileSync(join(root, '.open-sets.json'), JSON.stringify([
      { title: '둘 같이', paths: [one, two] },
      { title: '없는 파일', paths: [one, '없다.ifc'] },
      { title: '밖', paths: ['../x.ifc'] },
      { title: 3, paths: [one] },
      { title: '빈 묶음', paths: [] },
    ]))
    const r = await fetch(`${base}/__data/__sets`)
    expect(await r.json()).toEqual([{ title: '둘 같이', paths: [one, two] }])
    writeFileSync(join(root, '.open-sets.json'), '{틀린 JSON')
    expect(await (await fetch(`${base}/__data/__sets`)).json()).toEqual([])
    rmSync(join(root, '.open-sets.json'))
    expect(await (await fetch(`${base}/__data/__sets`)).json()).toEqual([])
  })
})
