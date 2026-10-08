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
  deleteSpaceVertex,
  insertSpaceVertex,
  mergeSpaces,
  moveSpaceVertex,
  renameSpace,
  restore,
  snapshotOf,
  snapshotSpace,
  snapshotStoreySpaces,
  splitSpace,
} from './edit'
import { applyEdits, exportEdits } from './edit-file'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import type { Model, Space } from './model'

// 물리존 편집(OE-SPC-01~04)의 수용 기준 중 시험이 없던 것과, 사람이 경계를 고치거나 나눈 물리존의 BIM 명시 소속을 좌표로 다시
// 판정하는 규칙(OE-MAP-01 3단계, Q13). mep.ifc 의 1F 사무실은 (0..10 × 0..8) 이고, LIGHT-101-01 은 좌표가 (50, 50) 으로 밖인데
// IFC 가 사무실에 담아 두었다(BIM 명시 소속).

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))

let model: Model
beforeEach(() => {
  model = read()
})
const storey = () => model.storeys[0]
const office = () => storey().spaces[0]
const equip = (name: string, m = model) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
/** 모든 층 GeoJSON 의 feature. */
const features = (m: Model) => modelToGeoJSON(m).flatMap((f) => f.collection.features)
const space = (id: string, m = model): Space => m.storeys.flatMap((s) => s.spaces).find((s) => s.id === id)!

describe('BIM 명시 소속과 사람의 경계 편집 (Q13)', () => {
  it('꼭짓점을 옮기면 BIM 이 담아 둔 설비도 좌표로 다시 판정하고, 되돌리면 BIM 소속이 돌아온다', () => {
    const light = equip('LIGHT-101-01')
    const snap = snapshotSpace(model, office().id)!
    moveSpaceVertex(model, office().id, 1, [9, 1])
    expect(light).toMatchObject({ spaceId: null, spaceSource: null })
    restore(model, snap)
    expect(light).toMatchObject({ spaceId: office().id, spaceSource: 'bim' })
  })

  it('되돌렸다 다시 하면 다시 풀린다 — 다시 하기가 되돌리기 전 상태 그대로다', () => {
    const light = equip('LIGHT-101-01')
    const snap = snapshotSpace(model, office().id)!
    moveSpaceVertex(model, office().id, 1, [9, 1])
    // 다시 하기는 되돌리기 직전에 뜬 상태(snapshotOf)를 놓는다(App.vue 의 undo·redo).
    const again = snapshotOf(model, snap)!
    restore(model, snap)
    expect(light).toMatchObject({ spaceId: office().id, spaceSource: 'bim' })
    restore(model, again)
    expect(light).toMatchObject({ spaceId: null, spaceSource: null })
  })

  it('변 위에 꼭짓점을 넣는 것(Insert)은 모양이 같아서 BIM 소속을 풀지 않는다. 그 꼭짓점을 옮기면 푼다', () => {
    const light = equip('LIGHT-101-01')
    insertSpaceVertex(model, office().id, 0)
    expect(light).toMatchObject({ spaceId: office().id, spaceSource: 'bim' })
    moveSpaceVertex(model, office().id, 1, [5, -1])
    expect(light.spaceSource).toBe(null)
  })

  it('나누면 BIM 이 담아 둔 설비도 좌표로 다시 판정한다 — 두 조각 밖이면 소속 없음이 되고, 되돌리면 돌아온다', () => {
    const light = equip('LIGHT-101-01')
    const snap = snapshotStoreySpaces(model, storey().id)!
    const done = splitSpace(model, office().id, [6, -1], [6, 9])
    if (!done || 'refused' in done) throw new Error('split')
    expect(light).toMatchObject({ spaceId: null, spaceSource: null })
    restore(model, snap)
    expect(light).toMatchObject({ spaceId: office().id, spaceSource: 'bim' })
  })

  it('BIM 이 담아 둔 물리존을 나누면 좁은 쪽 조각 안의 설비는 좁은 조각에 속한다', () => {
    // 사무실 안 (8, 4) 에 BIM 이 사무실에 담은 설비를 하나 둔다.
    const e = addEquipment(model, storey().id, { name: 'BIM-SENSOR', kind: null, position: [8, 4, 1] })!
    e.spaceId = office().id
    e.spaceSource = 'bim'
    const done = splitSpace(model, office().id, [6, -1], [6, 9])
    if (!done || 'refused' in done) throw new Error('split')
    expect(e.spaceId).toBe(done.created[0])
    expect(e.spaceSource).toBe('computed')
  })
})

describe('물리존 편집 수용 기준 (OE-SPC-01~04)', () => {
  it('공간명을 바꾸면 TTL label · GeoJSON 이름 · 방 종류가 함께 바뀐다 (OE-SPC-01)', () => {
    expect(office().kind).toBe('office')
    renameSpace(model, office().id, '회의실')
    const ttl = modelToTTL(model)
    expect(ttl).toContain('rdfs:label "회의실"')
    expect(ttl).not.toContain('rdfs:label "사무실"')
    // GeoJSON 의 공간명은 longName 이다(name 은 방번호).
    const feature = features(model).find((f) => f.id === office().id)!
    expect(feature.properties!.longName).toBe('회의실')
    expect(office().kind).toBe('conference')
  })

  it('벽 두께만큼 떨어진 두 방을 합치면 사이 벽 자리의 설비가 합친 방에 속한다 (OE-SPC-02)', () => {
    const store = createSpace(model, storey().id, { name: '102', longName: '창고', footprint: [[10.2, 0], [14, 0], [14, 8], [10.2, 8]] })!.created[0]
    // 벽 자리(x 10..10.2) 가운데의 설비는 어느 방에도 들지 않는다(두 방 외곽선에서 0.1m, 소속 허용 거리 0.05m 밖).
    const inWall = addEquipment(model, storey().id, { name: 'IN-WALL', kind: 'receptacle', position: [10.1, 4, 0.3] })!
    expect(inWall.spaceId).toBe(null)
    const done = mergeSpaces(model, office().id, store)
    if (!done || 'refused' in done) throw new Error('merge')
    expect(inWall.spaceId).toBe(office().id)
  })

  it('합친 뒤 남는 방의 외곽선을 고치고 저장·불러오면, 합치기가 into 로 되살아나고 고친 외곽선과 문이 그대로다 (OE-SPC-02 · OE-HIST-03)', () => {
    const base = baselineOf(model)
    const store = createSpace(model, storey().id, { name: '102', longName: '창고', footprint: [[10.2, 0], [14, 0], [14, 8], [10.2, 8]] })!.created[0]
    storey().openings.push({ id: 'door', kind: 'door', name: '', width: null, height: null, wallId: null, passable: true, connects: [office().id, store] })
    const done = mergeSpaces(model, office().id, store)
    if (!done || 'refused' in done) throw new Error('merge')
    moveSpaceVertex(model, office().id, 0, [-1, -1])
    const file = exportEdits(model, base, 'mep.ifc')
    expect(file.spacesRemoved).toBeUndefined() // 만든 방을 합친 것이라 연 때 없던 방이다 — 만들기·합치기가 끝 모양 하나로 남는다
    const fresh = read()
    fresh.storeys[0].openings.push({ id: 'door', kind: 'door', name: '', width: null, height: null, wallId: null, passable: true, connects: [fresh.storeys[0].spaces[0].id] })
    applyEdits(fresh, file)
    expect(space(office().id, fresh).footprint).toEqual(office().footprint)
    expect(features(fresh).filter((f) => f.properties?.kind === 'space').map((f) => f.id)).toEqual([office().id])
  })

  it('연 때 있던 두 방을 합친 뒤 외곽선을 고치고 저장·불러오면 into 로 되살아나고 문은 남는 방만 잇는다 (OE-SPC-02 · OE-HIST-03)', () => {
    // 연 때 방을 둘로 만든다(나누기 → 그 상태를 연 때로).
    const done = splitSpace(model, office().id, [6, -1], [6, 9])
    if (!done || 'refused' in done) throw new Error('split')
    const piece = done.created[0]
    storey().openings.push({ id: 'door', kind: 'door', name: '', width: null, height: null, wallId: null, passable: true, connects: [office().id, piece] })
    const opened = structuredClone(model)
    const base = baselineOf(model)
    const merged = mergeSpaces(model, office().id, piece)
    if (!merged || 'refused' in merged) throw new Error('merge')
    moveSpaceVertex(model, office().id, 0, [-1, -1])
    const file = exportEdits(model, base, 'mep.ifc')
    expect(file.spacesRemoved).toEqual([{ id: piece, into: office().id }])
    applyEdits(opened, file)
    expect(opened.storeys[0].spaces.map((s) => s.id)).toEqual([office().id])
    expect(space(office().id, opened).footprint).toEqual(office().footprint)
    const door = features(opened).find((f) => f.id === 'door')!
    expect(door.properties!.connects).toEqual([office().id])
  })

  it('꼭짓점이 4개인 물리존에서 하나를 지우면 삼각형이 되고 넓이가 다시 계산되며, 3개 남으면 더 지우지 않는다 (OE-SPC-03)', () => {
    expect(office().footprint.length).toBe(5) // 닫힌 고리(꼭짓점 4 + 닫는 점)
    const change = deleteSpaceVertex(model, office().id, 2)!
    expect(change.toAreaM2).toBeCloseTo(40)
    expect(office().footprint.length).toBe(4)
    expect(deleteSpaceVertex(model, office().id, 0)).toBeNull()
    expect(office().footprint.length).toBe(4)
  })

  it('방을 지우면 그 안의 설비가 그 방을 품은 이웃 방으로 간다 (OE-SPC-04)', () => {
    const small = createSpace(model, storey().id, { name: '102', longName: '접수대', footprint: [[6, 3], [8, 3], [8, 5], [6, 5]] })!.created[0]
    expect(equip('AT-101-02').spaceId).toBe(small)
    deleteSpace(model, small)
    expect(equip('AT-101-02').spaceId).toBe(office().id)
  })
})
