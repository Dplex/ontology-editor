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
