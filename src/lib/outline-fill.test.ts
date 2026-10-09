import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf, createSpace, drawSpaceFootprint } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { outlinelessSpaces, outlineWarnings } from './outline-fill'
import { modelToTTL } from './export/ttl'
import type { Model } from './model'

// 외곽선 없는 물리존에 외곽선 채우기(OE-MAN-03). mep.ifc 의 1F 사무실(0..10 × 0..8)에서 외곽선을 지워, BIM 에서 이름·번호는 왔지만
// 바닥 다각형이 없는 방으로 만든다. AHU-1 은 사무실 안 (1, 1) 이다.

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
/** 연 직후의 모델. 사무실 외곽선을 지워 둔다(BIM 에 바닥 다각형이 없는 방). */
const read = (): Model => {
  const m = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
  const office = m.storeys[0].spaces[0]
  office.footprint = []
  office.areaM2 = 0
  for (const e of m.storeys[0].equipment) if (e.spaceId === office.id && e.spaceSource !== 'bim') e.spaceId = null
  return m
}
const RING: [number, number][] = [[0, 0], [10, 0], [10, 8], [0, 8]]

let model: Model
beforeEach(() => {
  model = read()
})
const office = (m = model) => m.storeys[0].spaces[0]
const equip = (name: string, m = model) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!

describe('외곽선 없는 물리존 채우기 (OE-MAN-03)', () => {
  it('외곽선 없는 물리존이 목록에 있고, 그리면 같은 id 에 외곽선이 생기며 물리존 수는 늘지 않는다. 이름·번호·종류는 그대로다 [OE-MAN-03#1,2]', () => {
    expect(outlinelessSpaces(model).map((x) => x.space.id)).toEqual([office().id])
    const before = { count: model.storeys[0].spaces.length, id: office().id, name: office().name, longName: office().longName, kind: office().kind, src: office().kindSource }
    expect(equip('AHU-1').spaceId).toBe(null)
    drawSpaceFootprint(model, office().id, RING)
    expect(model.storeys[0].spaces).toHaveLength(before.count)
    expect(office()).toMatchObject({ id: before.id, name: before.name, longName: before.longName, kind: before.kind, kindSource: before.src })
    expect(office().areaM2).toBeCloseTo(80)
    expect(outlinelessSpaces(model)).toEqual([])
    // 그린 외곽선 안의 설비가 그 물리존에 속한다. TTL 은 층이 아니라 그 방을 위치로 적는다.
    expect(equip('AHU-1').spaceId).toBe(office().id)
  })

  it('BIM 면적과 20% 넘게 다르거나 다른 물리존과 겹치면 경고한다(막지 않는다)', () => {
    office().bimArea = { m2: 80, property: 'BaseQuantities.NetFloorArea' }
    drawSpaceFootprint(model, office().id, RING)
    expect(outlineWarnings(model, office().id)).toEqual([])
    // 절반만 그리면 넓이가 다르다.
    drawSpaceFootprint(model, office().id, [[0, 0], [5, 0], [5, 8], [0, 8]])
    expect(outlineWarnings(model, office().id)).toEqual(['그린 넓이 40.0㎡ 가 BIM 면적 80.0㎡ 와 50% 다릅니다.'])
    // 옆 방과 겹치게 그린다. 맞닿기만 한 것은 겹침이 아니다.
    createSpace(model, model.storeys[0].id, { name: '102', longName: '창고', footprint: [[5, 0], [9, 0], [9, 8], [5, 8]] })
    expect(outlineWarnings(model, office().id)).toEqual(['그린 넓이 40.0㎡ 가 BIM 면적 80.0㎡ 와 50% 다릅니다.'])
    drawSpaceFootprint(model, office().id, [[0, 0], [7, 0], [7, 8], [0, 8]])
    expect(outlineWarnings(model, office().id)).toEqual(['그린 넓이 56.0㎡ 가 BIM 면적 80.0㎡ 와 30% 다릅니다.', '다른 물리존과 겹칩니다: 창고 16.0㎡.'])
  })

  it('저장한 편집 파일을 다시 불러오면 같은 외곽선이 들어가고, GUID 가 바뀐 판본에도 다시 붙는다 [OE-MAN-03#5]', () => {
    const base = baselineOf(model)
    drawSpaceFootprint(model, office().id, RING)
    const parsed = parseEditFile(JSON.stringify(exportEdits(model, base, 'mep.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)

    const again = read()
    applyEdits(again, parsed)
    expect(office(again).footprint).toEqual(office().footprint)
    expect(modelToTTL(again)).toBe(modelToTTL(model))

    // 같은 BIM 을 다시 내보냈는데 GUID 가 전부 새로 나온 판본.
    const fresh = read()
    let json = JSON.stringify(fresh)
    for (const id of [...fresh.storeys.flatMap((s) => [s.id, ...s.spaces.map((sp) => sp.id), ...s.equipment.map((e) => e.id)]), ...fresh.systems.map((s) => s.id)])
      json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
    const reexported: Model = JSON.parse(json)
    const result = applyEdits(reexported, parsed)
    expect(result.missing.spaces).toBe(0)
    expect(office(reexported).footprint).toEqual(office().footprint)
    expect(equip('AHU-1', reexported).spaceId).toBe(office(reexported).id)
  })
})
