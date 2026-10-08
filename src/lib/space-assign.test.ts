import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import {
  addEquipment,
  baselineOf,
  createSpace,
  deleteSpace,
  moveEquipment,
  restore,
  setEquipmentSpace,
  snapshotEquipment,
  snapshotStoreySpaces,
} from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import { spaceSetState } from './mapping'
import { splitByStorey, joinParts } from './storey-drafts'
import type { Equipment, Model } from './model'

// 사람의 소속 지정(OE-MAP-01 "사람의 소속 지정", K17)과 편집 파일(OE-HIST-03). mep.ifc 의 1F 사무실은 (0..10 × 0..8) 이다.
// 사무실 밖 (12, 4) 에 설비를 하나 더해 "소속 없음" 설비로 쓰고, 사무실 오른쪽 (12..16) 에 창고를 만들어 지정할 곳으로 쓴다.

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
const storey = (m: Model) => m.storeys[0]
const office = (m: Model) => storey(m).spaces[0]
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!

let model: Model
let loose: Equipment
let near: Equipment
let store: string
beforeEach(() => {
  model = read()
  // 창고는 (13..16 × 0..8). (12, 4) 는 사무실·창고 어디에도 들지 않는다(소속 없음, 7단계).
  store = createSpace(model, storey(model).id, { name: '102', longName: '창고', footprint: [[13, 0], [16, 0], [16, 8], [13, 8]] })!.created[0]
  loose = addEquipment(model, storey(model).id, { name: 'LOOSE', kind: null, position: [12, 4, 1], id: 'U_loose' })!
  // 사무실 외곽선에서 3cm 밖은 소속 허용 거리(5cm)로 사무실에 붙는다(5단계).
  near = addEquipment(model, storey(model).id, { name: 'NEAR', kind: null, position: [10.03, 6, 1], id: 'U_near' })!
})

describe('사람의 소속 지정 (OE-MAP-01 · K17)', () => {
  it('소속 없음·허용 거리로 붙은 설비는 지정할 수 있고, 출처가 편집이며 TTL·GeoJSON 에 그 방으로 나간다', () => {
    expect(loose.spaceId).toBe(null)
    expect(near.spaceId).toBe(office(model).id)
    expect(setEquipmentSpace(model, loose.id, store)).toBe(true)
    expect(setEquipmentSpace(model, near.id, store)).toBe(true)
    expect(loose).toMatchObject({ spaceId: store, spaceSource: 'edit', spaceSet: store })
    expect(near).toMatchObject({ spaceId: store, spaceSource: 'edit' })
    expect(modelToTTL(model)).toMatch(/U_loose[\s\S]*?brick:hasLocation[^;.]*U_/)
    const feature = modelToGeoJSON(model).flatMap((f) => f.collection.features).find((f) => f.id === loose.id)!
    expect(feature.properties).toMatchObject({ spaceId: store, spaceSource: 'edit' })
  })

  it('미배치·BIM 명시 소속·외곽선 안 설비는 지정하지 않고 까닭을 돌려준다', () => {
    expect(setEquipmentSpace(model, equip(model, 'TEMP-101-01').id, store)).toEqual({ refused: expect.stringContaining('미배치') })
    expect(setEquipmentSpace(model, equip(model, 'LIGHT-101-01').id, store)).toEqual({ refused: expect.stringContaining('BIM 이 적은 소속') })
    expect(setEquipmentSpace(model, equip(model, 'AHU-1').id, store)).toEqual({ refused: expect.stringContaining('외곽선 안') })
  })

  it('지정한 설비 자리에 외곽선을 그리면 그 물리존에 속하고 "사람 지정 해제(외곽선 안)" 가 되며, 되돌리면 지정이 다시 쓰인다', () => {
    setEquipmentSpace(model, loose.id, store)
    const snap = snapshotStoreySpaces(model, storey(model).id)!
    const lobby = createSpace(model, storey(model).id, { name: '103', longName: '로비', footprint: [[11, 3], [12.5, 3], [12.5, 5], [11, 5]] })!.created[0]
    expect(loose).toMatchObject({ spaceId: lobby, spaceSource: 'computed', spaceSet: store })
    expect(spaceSetState(loose, storey(model).spaces)).toEqual({ state: 'released', from: store, reason: 'inside' })
    restore(model, snap)
    expect(loose).toMatchObject({ spaceId: store, spaceSource: 'edit' })
  })

  it('지정한 물리존을 지우면 "지정한 물리존이 없어짐" 으로 해제된다', () => {
    setEquipmentSpace(model, loose.id, store)
    deleteSpace(model, store)
    expect(loose.spaceId).toBe(null)
    expect(spaceSetState(loose, storey(model).spaces)).toEqual({ state: 'released', from: store, reason: 'gone' })
  })

  it('지정한 설비를 옮기면 지정이 지워지고 좌표로 다시 판정하며, 되돌리면 지정이 돌아온다', () => {
    setEquipmentSpace(model, loose.id, store)
    const snap = snapshotEquipment(model, loose.id)!
    moveEquipment(model, loose.id, [12, 2, 1])
    expect(loose.spaceSet).toBeUndefined()
    expect(loose.spaceId).toBe(null)
    restore(model, snap)
    expect(loose).toMatchObject({ spaceId: store, spaceSource: 'edit', spaceSet: store })
  })

  it('지정을 지우면 좌표 판정으로 돌아간다', () => {
    setEquipmentSpace(model, near.id, store)
    expect(setEquipmentSpace(model, near.id, null)).toBe(true)
    expect(near).toMatchObject({ spaceId: office(model).id, spaceSource: 'computed' })
    expect(near.spaceSet).toBeUndefined()
  })
})

describe('사람 지정과 편집 파일 (OE-HIST-03)', () => {
  it('지정한 소속이 저장·불러오기(층 조각을 거쳐도) 뒤에도 유지되고 TTL·GeoJSON 이 같다', () => {
    const base = baselineOf(model)
    // 연 때를 "창고·두 설비가 있는 모델" 로 둔다. 같은 것을 새로 연 모델에도 만든다.
    const again = () => {
      const m = read()
      createSpace(m, storey(m).id, { name: '102', longName: '창고', footprint: [[13, 0], [16, 0], [16, 8], [13, 8]], id: store })
      addEquipment(m, storey(m).id, { name: 'LOOSE', kind: null, position: [12, 4, 1], id: 'U_loose' })
      addEquipment(m, storey(m).id, { name: 'NEAR', kind: null, position: [10.03, 6, 1], id: 'U_near' })
      return m
    }
    setEquipmentSpace(model, loose.id, store)
    const file = exportEdits(model, base, 'mep.ifc')
    expect(file.assignedSpaces).toEqual([{ id: 'U_loose', spaceId: store }])
    const parsed = parseEditFile(JSON.stringify(joinParts(splitByStorey(file, () => storey(model).id).values(), file)))
    if (typeof parsed === 'string') throw new Error(parsed)
    const fresh = again()
    const result = applyEdits(fresh, parsed)
    expect(result.assignReleased).toBeUndefined()
    expect(equip(fresh, 'LOOSE')).toMatchObject({ spaceId: store, spaceSource: 'edit', spaceSet: store })
    expect(modelToTTL(fresh)).toBe(modelToTTL(model))
    expect(JSON.stringify(modelToGeoJSON(fresh))).toBe(JSON.stringify(modelToGeoJSON(model)))
  })

  it('다시 연 판본에서 그 설비가 외곽선 안에 들면 지정을 쓰지 않고 "사람 지정 해제" 로 알린다', () => {
    const base = baselineOf(model)
    setEquipmentSpace(model, loose.id, store)
    const file = exportEdits(model, base, 'mep.ifc')
    // 다시 연 판본에는 그 자리를 품는 방(로비)이 있다.
    const fresh = read()
    createSpace(fresh, storey(fresh).id, { name: '102', longName: '창고', footprint: [[13, 0], [16, 0], [16, 8], [13, 8]], id: store })
    const lobby = createSpace(fresh, storey(fresh).id, { name: '103', longName: '로비', footprint: [[11, 3], [12.5, 3], [12.5, 5], [11, 5]] })!.created[0]
    addEquipment(fresh, storey(fresh).id, { name: 'LOOSE', kind: null, position: [12, 4, 1], id: 'U_loose' })
    const result = applyEdits(fresh, file)
    expect(result.assignReleased).toEqual([{ id: 'U_loose', name: 'LOOSE', from: store, to: lobby, reason: 'inside' }])
    expect(equip(fresh, 'LOOSE')).toMatchObject({ spaceId: lobby, spaceSource: 'computed' })
  })
})
