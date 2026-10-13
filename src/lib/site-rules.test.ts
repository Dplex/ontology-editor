// 규칙 기반 경고(OE-P3-01~04). mep.ifc 1F 사무실(10×8, 설비 넷)을 x=9 에서 나누면 1×8 = 8㎡ 조각이 생기고 그 조각에는 설비가 없다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { splitSpace } from './edit'
import { createZoneFromSpaces, zoneChecks } from './hvac-zone'
import { DEFAULT_SITE_RULES, siteWarnings } from './site-rules'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const split = () => {
  const m = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
  const office = m.storeys[0].spaces[0]
  const done = splitSpace(m, office.id, [9, -1], [9, 9])
  if (!done || 'refused' in done) throw new Error('나누지 못함')
  return { m, office, piece: done.created[0] }
}
const rules = (ws: ReturnType<typeof siteWarnings>) => ws.map((w) => [w.rule, w.items.map((x) => x.id)])

describe('규칙 기반 경고 (OE-P3)', () => {
  it('W-01 은 사이트 설정 N㎡ 미만 물리존이고, N 을 바꾸면 대상이 바뀐다 [OE-P3-02#1] [OE-P3-01#1~]', () => {
    const { m, piece } = split()
    expect(siteWarnings(m, { ...DEFAULT_SITE_RULES, emptySpace: false }).find((w) => w.rule === 'W-01')).toBeUndefined()
    expect(rules(siteWarnings(m, { ...DEFAULT_SITE_RULES, minAreaM2: 10, emptySpace: false }))).toEqual([['W-01', [piece]]])
    expect(siteWarnings(m, { ...DEFAULT_SITE_RULES, minAreaM2: 10 }).find((w) => w.rule === 'W-01')!.items[0].label).toContain('8.00㎡')
  })

  it('W-02 는 설비 없는 물리존이고, 끄면 사라진다 [OE-P3-03#1]', () => {
    const { m, piece } = split()
    expect(rules(siteWarnings(m))).toEqual([['W-02', [piece]]])
    expect(siteWarnings(m, { ...DEFAULT_SITE_RULES, emptySpace: false })).toEqual([])
  })

  it('W-03 은 Z-01 과 같은 물리존이고, 끄면 사라진다 [OE-P3-04#1]', () => {
    const { m, office, piece } = split()
    createZoneFromSpaces(m, { spaceIds: [office.id], name: '사무실 존' })
    const z01 = zoneChecks(m, { space: (id) => id, equipment: (id) => id }).checks.find((c) => c.rule === 'Z-01')!.items.map((x) => x.id)
    const w03 = siteWarnings(m, { ...DEFAULT_SITE_RULES, emptySpace: false }).find((w) => w.rule === 'W-03')!.items.map((x) => x.id)
    expect(w03).toEqual(z01)
    expect(w03).toEqual([piece])
    expect(siteWarnings(m, { ...DEFAULT_SITE_RULES, emptySpace: false, unmappedSpace: false })).toEqual([])
  })
})
