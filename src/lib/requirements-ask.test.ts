import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { isConduit, type Model } from './model'
import { requirementsReport } from './requirements'

// OE-BIM-17 "고객사에 할 요청". 가진 fixture 는 줄마다 표준·다른 자리·없음 중 하나로 갈려서, 섞인 줄(일부는 다른 자리, 일부는 없음)과
// 형상 중심으로 옮긴 좌표(계산)를 손으로 만들어 본다.
let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (name: string): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))
const row = (m: Model, id: string) => requirementsReport(m).find((r) => r.id === id)!

describe('요구사항 보고서의 요청 — 섞인 줄 (OE-BIM-17)', () => {
  it('일부는 다른 자리, 일부는 없으면 설정 요청에 "나머지는 값을 넣어 달라" 를 잇는다', () => {
    const m = read('proxy.ifc')
    expect(row(m, 'R24')).toMatchObject({ state: 'elsewhere', counts: { standard: 0, elsewhere: 3, of: 3 } })
    // 하나를 이름으로도 모르게 하면 다른 자리 2 · 없음 1 이다.
    m.storeys.flatMap((s) => s.equipment).find((e) => e.kind)!.kind = null
    const r24 = row(m, 'R24')
    expect(r24).toMatchObject({ state: 'partial', counts: { standard: 0, elsewhere: 2, of: 3 } })
    expect(r24.ask).toMatch(/^내보내기 설정을 바꿔 달라 — 설비 종류를 PredefinedType으로\(IfcExportType\)\. 나머지는 값을 넣어 달라/)
  })

  it('형상 중심으로 옮긴 좌표는 다른 자리가 아니라 계산이다 — 설정으로 고칠 일이 아니라 삽입점을 고쳐 달라는 요청이다', () => {
    const m = read('mep.ifc')
    const placed = m.storeys.flatMap((s) => s.equipment).filter((e) => e.position && !isConduit(e.role))
    const before = row(m, 'R11').counts!
    placed[0].positionSource = 'geometry'
    const r11 = row(m, 'R11')
    expect(r11.counts).toEqual({ standard: before.standard - 1, elsewhere: 0, of: before.of })
    expect(r11.ask).not.toContain('내보내기 설정을 바꿔 달라')
    expect(r11.ask).toContain('삽입점을 형상 위로 고쳐 달라')
  })
})
