import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf, createSpace, deleteSpace, diffBaseline, mergeSpaces, restore, snapshotHvacZones, snapshotStoreySpaces, splitSpace } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { splitByStorey } from './storey-drafts'
import { createZoneFromOutline, createZoneFromSpaces, deleteHvacZone, findHvacZone, flowSpacesOfZones, hvacZonesOf, reshapeHvacZone, setZoneServedBy, setZoneSpaces, zoneChecks } from './hvac-zone'
import { escapeLocalName, modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { readGeoJSON } from './export/read-export'
import type { HvacZone, Model } from './model'

// 수동 공조존(OE-ZON-01·02, OE-MAN-05, OE-OBJ-13). mep.ifc 의 1F 사무실은 (0..10 × 0..8)이고 공조기 AHU-1 과 디퓨저 둘이 있다.
// 옆에 창고(10.2..14 × 0..8)를 만들어 물리존 둘을 고를 수 있게 한다.

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))

let model: Model
let store: string
beforeEach(() => {
  model = read()
  store = createSpace(model, model.storeys[0].id, { name: '102', longName: '창고', footprint: [[10.2, 0], [14, 0], [14, 8], [10.2, 8]] })!.created[0]
})
const office = () => model.storeys[0].spaces[0]
const equip = (name: string, m = model) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
/** TTL 에서 주어 블록 하나. */
const block = (ttl: string, id: string) => {
  const head = `ex:${escapeLocalName(id)} a `
  const at = ttl.indexOf(head)
  return at < 0 ? '' : ttl.slice(at, ttl.indexOf('\n\n', at))
}

describe('수동 공조존 (OE-ZON-01·02)', () => {
  it('물리존을 골라 만들면 고른 물리존이 담당이고 바닥은 합집합이며, 담당 설비가 공조존을 feeds 한다 — 계통도의 서비스 영역', () => {
    const zone = createZoneFromSpaces(model, { spaceIds: [office().id, store], servedBy: [equip('AHU-1').id] })
    if (!zone || 'refused' in zone) throw new Error('zone')
    expect(zone).toMatchObject({ name: '공조존 1', storeyId: model.storeys[0].id, spaceIds: [office().id, store], source: 'edit' })
    // 사무실(80㎡)과 창고(30.4㎡) 사이 벽 틈(0.2m)까지 하나로 합친다.
    expect(zone.footprint).toHaveLength(1)
    expect(zone.areaM2).toBeCloseTo(80 + 30.4 + 0.2 * 8, 1)
    const ttl = modelToTTL(model)
    const z = block(ttl, zone.id)
    expect(z).toContain('a brick:HVAC_Zone')
    expect(z).toContain(`brick:hasPart ex:${escapeLocalName(office().id)}, ex:${escapeLocalName(store)}`)
    expect(block(ttl, equip('AHU-1').id)).toMatch(new RegExp(`brick:feeds [^;]*ex:${escapeLocalName(zone.id).replace(/[$\\]/g, '\\$&')}`))
    // GeoJSON 에 바닥이 있고 출처는 편집, 담당 설비를 적는다. 받는 쪽 검사를 통과한다.
    const floor = modelToGeoJSON(model)[0]
    const f = floor.collection.features.find((x) => x.id === zone.id)!
    expect(f.properties).toMatchObject({ kind: 'hvacZone', source: 'edit', servedBy: [equip('AHU-1').id], spaceIds: [office().id, store] })
    expect(readGeoJSON(floor.fileName, JSON.stringify(floor.collection)).problems).toEqual([])
  })

  it('물리존 하나를 두 공조존으로 나눠 그리면 각 공조존이 그 물리존을 담당 물리존으로 가진다', () => {
    const east = createZoneFromOutline(model, model.storeys[0].id, { name: '외주', footprint: [[0, 0], [5, 0], [5, 8], [0, 8]] })
    const west = createZoneFromOutline(model, model.storeys[0].id, { name: '내주', footprint: [[5, 0], [10, 0], [10, 8], [5, 8]] })
    if (!east || 'refused' in east || !west || 'refused' in west) throw new Error('zones')
    expect(east.spaceIds).toEqual([office().id])
    expect(west.spaceIds).toEqual([office().id])
    expect(east.spaceShares![office().id]).toBeCloseTo(0.5)
    // 맞닿기만 한 창고는 담당이 아니다.
    expect(west.spaceIds).not.toContain(store)
    expect(createZoneFromOutline(model, model.storeys[0].id, { footprint: [[0, 0], [5, 5], [5, 0], [0, 5]] })).toEqual({ refused: '변이 서로 엇갈립니다. 꼭짓점을 차례대로 찍으세요.' })
  })

  it('한 층의 물리존만 고를 수 있고, 하나도 안 고르면 막는다', () => {
    expect(createZoneFromSpaces(model, { spaceIds: [] })).toEqual({ refused: '담당 물리존을 하나 이상 고르세요.' })
  })

  it('지우기·담당 설비 바꾸기는 되돌리면 그 전과 같고, 연 때와 견준 차이에 남는다', () => {
    const base = baselineOf(model)
    const before = modelToTTL(model)
    const snap = snapshotHvacZones(model, model.storeys[0].id)!
    const zone = createZoneFromSpaces(model, { spaceIds: [office().id] })
    if (!zone || 'refused' in zone) throw new Error('zone')
    expect(diffBaseline(model, base).hvacZones).toEqual([{ id: zone.id, name: zone.name, storeyId: model.storeys[0].id, change: 'added' }])
    expect(setZoneServedBy(model, zone.id, [equip('AHU-1').id, 'no-such-id'])).toBe(true)
    expect(zone.servedBy).toEqual([equip('AHU-1').id])
    expect(deleteHvacZone(model, zone.id)).toBe(true)
    expect(hvacZonesOf(model)).toEqual([])
    restore(model, snap)
    expect(modelToTTL(model)).toBe(before)
  })

  it('편집 파일과 층별 조각을 거쳐도, GUID 가 바뀐 판본에서도 같은 공조존이 된다', () => {
    // 창고도 편집으로 만든 것이어야 다시 연 모델에 들어간다. 연 때(기준)부터 다시 잡는다.
    model = read()
    const base = baselineOf(model)
    store = createSpace(model, model.storeys[0].id, { name: '102', longName: '창고', footprint: [[10.2, 0], [14, 0], [14, 8], [10.2, 8]] })!.created[0]
    createZoneFromSpaces(model, { spaceIds: [office().id, store], servedBy: [equip('AHU-1').id] })
    createZoneFromOutline(model, model.storeys[0].id, { name: '외주', footprint: [[0, 0], [5, 0], [5, 8], [0, 8]], servedBy: [equip('AT-101-01').id] })
    const parsed = parseEditFile(JSON.stringify(exportEdits(model, base, 'mep.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.hvacZones?.[0].zones).toHaveLength(2)

    const again = read()
    applyEdits(again, parsed)
    expect(modelToTTL(again)).toBe(modelToTTL(model))
    const parts = splitByStorey(parsed, () => null)
    const fromParts = read()
    for (const part of parts.values()) applyEdits(fromParts, part)
    expect(modelToTTL(fromParts)).toBe(modelToTTL(model))

    // 같은 BIM 을 다시 내보냈는데 GUID 가 전부 새로 나온 판본.
    const fresh = read()
    let json = JSON.stringify(fresh)
    for (const id of [...fresh.storeys.flatMap((s) => [s.id, ...s.spaces.map((sp) => sp.id), ...s.equipment.map((e) => e.id)]), ...fresh.systems.map((s) => s.id)])
      json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
    const reexported: Model = JSON.parse(json)
    applyEdits(reexported, parsed)
    const zones = hvacZonesOf(reexported)
    expect(zones).toHaveLength(2)
    expect(zones[0].servedBy).toEqual([equip('AHU-1', reexported).id])
    expect(zones[0].spaceIds[0]).toBe(reexported.storeys[0].spaces[0].id)
  })
})

describe('공조존 검증과 담당 물리존 고치기 (OE-ZON-05 · OE-ZON-04)', () => {
  const names = { space: (id: string) => model.storeys.flatMap((s) => s.spaces).find((s) => s.id === id)?.longName ?? id, equipment: (id: string) => equip2(id) }
  const equip2 = (id: string) => model.storeys.flatMap((s) => s.equipment).find((e) => e.id === id)?.name ?? id
  const rule = (r: string) => zoneChecks(model, names).checks.find((c) => c.rule === r)!.items.map((x) => x.label)

  it('공조존이 없는 층은 공백(Z-01)을 세지 않고, 만들면 담당 없는 물리존이 Z-01 이다. 공조존을 지우면 그 물리존이 Z-01 이 된다', () => {
    expect(zoneChecks(model, names).untouched).toEqual(['1F'])
    expect(rule('Z-01')).toEqual([])
    const zone = createZoneFromSpaces(model, { spaceIds: [office().id], servedBy: [equip('AHU-1').id] }) as HvacZone
    expect(rule('Z-01')).toEqual(['1F 창고'])
    const other = createZoneFromSpaces(model, { spaceIds: [store] }) as HvacZone
    expect(rule('Z-01')).toEqual([])
    deleteHvacZone(model, other.id)
    expect(rule('Z-01')).toEqual(['1F 창고'])
    expect(zone.id).toBeTruthy()
  })

  it('Z-02 두 공조존이 같은 영역을 담당, Z-04 담당 설비 없음, Z-05 토출구 없음, Z-06 실내기가 담당 물리존 밖', () => {
    const a = createZoneFromSpaces(model, { spaceIds: [office().id], name: '가', servedBy: [equip('AHU-1').id] }) as HvacZone
    createZoneFromOutline(model, model.storeys[0].id, { name: '나', footprint: [[1, 1], [4, 1], [4, 4], [1, 4]] })
    createZoneFromSpaces(model, { spaceIds: [store], name: '다' })
    expect(rule('Z-02')).toEqual(['가 · 나 9.0㎡'])
    expect(rule('Z-04')).toEqual(['나', '다'])
    // 디퓨저 둘은 사무실 안이라 가에는 토출구가 있다. 창고에는 없다.
    expect(rule('Z-05')).toContain('다')
    expect(rule('Z-05')).not.toContain('가')
    // 사무실 위쪽만 그린 공조존은 사무실에 디퓨저(y 4)가 있어도 바닥 안에 토출구가 없으니 Z-05 다.
    createZoneFromOutline(model, model.storeys[0].id, { name: '라', footprint: [[5, 5], [9.8, 5], [9.8, 7.8], [5, 7.8]] })
    expect(rule('Z-05')).toContain('라')
    // 사무실의 AHU-1 을 실내기로 보고 창고 공조존의 담당 설비로 고르면 Z-06 이다.
    equip('AHU-1').kind = 'indoor_unit'
    setZoneServedBy(model, (findHvacZone(model, hvacZonesOf(model).find((z) => z.name === '다')!.id)!).zone.id, [equip('AHU-1').id])
    expect(rule('Z-06')).toEqual(['AHU-1 — 사무실 에 있고 다 담당'])
    expect(a.servedBy).toEqual([equip('AHU-1').id])
  })

  it('담당 물리존을 더하고 빼면 골라 만든 공조존은 바닥이 다시 합집합이 되고, 그린 공조존은 바닥을 두고 담당만 바뀐다. 다 빼면 막는다', () => {
    const picked = createZoneFromSpaces(model, { spaceIds: [office().id] }) as HvacZone
    expect(setZoneSpaces(model, picked.id, [office().id, store])).toBe(true)
    expect(picked.areaM2).toBeCloseTo(80 + 30.4 + 1.6, 1)
    expect(setZoneSpaces(model, picked.id, [])).toEqual({ refused: '담당 물리존을 하나 이상 남기세요. 공조존을 없애려면 [지우기] 를 누릅니다.' })
    const drawn = createZoneFromOutline(model, model.storeys[0].id, { footprint: [[0, 0], [5, 0], [5, 8], [0, 8]] }) as HvacZone
    expect(setZoneSpaces(model, drawn.id, [office().id, store])).toBe(true)
    expect(drawn.areaM2).toBeCloseTo(40)
    expect(drawn.spaceShares).toEqual({ [office().id]: 0.5, [store]: 0 })
  })
})

describe('공조존 경계 다시 그리기 (OE-ZON-04)', () => {
  it('골라 만든 공조존도 경계를 다시 그리면 새 경계와 겹치는 물리존이 담당이 되고, 되돌리면 그 전과 같다', () => {
    const zone = createZoneFromSpaces(model, { spaceIds: [office().id] }) as HvacZone
    const snap = snapshotHvacZones(model, model.storeys[0].id)!
    const before = modelToTTL(model)
    // 사무실 오른쪽 끝(8..10)과 창고 왼쪽(10.2..12)에 걸친 경계.
    expect(reshapeHvacZone(model, zone.id, [[8, 0], [12, 0], [12, 8], [8, 8]])).toBe(true)
    expect(zone.drawn).toBe(true)
    expect(zone.areaM2).toBeCloseTo(32)
    expect(zone.spaceIds).toEqual([office().id, store])
    expect(zone.spaceShares![office().id]).toBeCloseTo(16 / 80, 2)
    expect(zone.spaceShares![store]).toBeCloseTo(14.4 / 30.4, 2)
    expect(block(modelToTTL(model), zone.id)).toContain(`ex:${escapeLocalName(store)}`)
    restore(model, snap)
    expect(modelToTTL(model)).toBe(before)
  })

  it('겹치는 물리존이 없거나 변이 엇갈리면 막고 공조존은 그대로다. 다시 그린 경계는 편집 파일을 거쳐도 같다', () => {
    model = read()
    const base = baselineOf(model)
    const zone = createZoneFromSpaces(model, { spaceIds: [office().id] }) as HvacZone
    const footprint = JSON.stringify(zone.footprint)
    expect(reshapeHvacZone(model, zone.id, [[20, 20], [22, 20], [22, 22], [20, 22]])).toEqual({ refused: '경계와 겹치는 물리존이 없습니다. 담당 물리존 위에 그리세요.' })
    expect(reshapeHvacZone(model, zone.id, [[0, 0], [4, 4], [4, 0], [0, 4]])).toEqual({ refused: '변이 서로 엇갈립니다. 꼭짓점을 차례대로 찍으세요.' })
    expect(JSON.stringify(zone.footprint)).toBe(footprint)
    expect(reshapeHvacZone(model, zone.id, [[0, 0], [6, 0], [6, 8], [0, 8]])).toBe(true)
    const parsed = parseEditFile(JSON.stringify(exportEdits(model, base, 'mep.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)
    const again = read()
    applyEdits(again, parsed)
    expect(modelToTTL(again)).toBe(modelToTTL(model))
    expect(hvacZonesOf(again)[0]).toMatchObject({ drawn: true, areaM2: 48 })
  })
})

describe('연결 기준 후보와 경고 (OE-MAP-02)', () => {
  // mep.ifc: AHU-1 → DUCT-01 → AT-101-01 은 포트가 말한 방향이고, DUCT-01 → AT-101-02 는 확정 전 규칙 방향이다.
  // AT-101-02 를 창고로 옮겨, 확정 전 규칙 방향으로만 닿는 방이 후보에 드는지 본다.
  const names = { space: (id: string) => model.storeys.flatMap((s) => s.spaces).find((s) => s.id === id)?.longName ?? id, equipment: (id: string) => id }
  const rule = () => zoneChecks(model, names).checks.find((c) => c.rule === '연결')!.items.map((x) => x.label)
  const toStore = () => {
    const at = equip('AT-101-02')
    at.position = [12, 4, 2.7]
    at.spaceId = store
  }
  const confirm = () => {
    const c = model.connections.find((x) => x.inferred && x.to === equip('AT-101-02').id)!
    c.inferred!.confirmed = true
  }

  it('담당 설비에서 확정된 흐름으로 닿는 말단의 물리존만 후보이고, 규칙 방향을 확정하면 후보가 늘며 담당에서 빠진 방이 경고다', () => {
    toStore()
    const a = createZoneFromSpaces(model, { spaceIds: [office().id], servedBy: [equip('AHU-1').id] }) as HvacZone
    expect(flowSpacesOfZones(model).get(a.id)).toEqual([office().id])
    expect(rule()).toEqual([])
    confirm()
    expect(flowSpacesOfZones(model).get(a.id)).toEqual([office().id, store])
    expect(rule()).toEqual(['공조존 1 — 담당에서 빠짐: 창고'])
    // 같은 공조기가 창고를 담당하는 공조존도 공급하면, 공조존 1 에 창고가 없는 것은 정상이다.
    const b = createZoneFromSpaces(model, { spaceIds: [store], servedBy: [equip('AHU-1').id] }) as HvacZone
    expect(rule()).toEqual([])
    setZoneServedBy(model, b.id, [])
    expect(rule()).toEqual(['공조존 1 — 담당에서 빠짐: 창고'])
    // 후보를 담당에 더하면 경고가 사라진다.
    setZoneSpaces(model, a.id, [office().id, store])
    expect(rule()).toEqual([])
  })

  it('담당 물리존에 담당 설비의 말단이 하나도 없으면 경고다. 말단을 담당 설비로 고르면 그 말단의 방이고, 흐름이 없는 설비는 기준을 쓰지 않는다', () => {
    const z = createZoneFromSpaces(model, { spaceIds: [store], servedBy: [equip('AHU-1').id] }) as HvacZone
    expect(rule()).toEqual(['공조존 1 — 담당 물리존에 말단 없음(말단: 사무실)'])
    setZoneServedBy(model, z.id, [equip('AT-101-01').id])
    expect(flowSpacesOfZones(model).get(z.id)).toEqual([office().id])
    // 조명은 공기가 흐르지 않고, 덕트에 이어진 것도 아니다.
    setZoneServedBy(model, z.id, [equip('LIGHT-101-01').id])
    expect(flowSpacesOfZones(model).has(z.id)).toBe(false)
    expect(rule()).toEqual([])
  })
})

describe('물리존을 나누고 합치고 지우면 공조존 담당이 따라간다 (OE-MAP-02)', () => {
  it('물리존을 분할하면 두 조각 모두 원래 공조존의 담당 물리존이 되고, 되돌리면 돌아온다', () => {
    const zone = createZoneFromSpaces(model, { spaceIds: [office().id] }) as HvacZone
    const snap = snapshotStoreySpaces(model, model.storeys[0].id)!
    const done = splitSpace(model, office().id, [5, -1], [5, 9])
    if (!done || 'refused' in done) throw new Error('split')
    expect(zone.spaceIds).toEqual([office().id, done.created[0]])
    expect(zone.areaM2).toBeCloseTo(80)
    restore(model, snap)
    expect(hvacZonesOf(model)[0].spaceIds).toEqual([office().id])
  })

  it('합치면 없어진 방 대신 남는 방이고 바닥이 넓어지며, 지우면 담당에서 빠진다', () => {
    const zone = createZoneFromSpaces(model, { spaceIds: [store] }) as HvacZone
    const merged = mergeSpaces(model, office().id, store)
    if (!merged || 'refused' in merged) throw new Error('merge')
    expect(zone.spaceIds).toEqual([office().id])
    expect(zone.areaM2).toBeCloseTo(80 + 30.4 + 1.6, 1)
    const extra = createSpace(model, model.storeys[0].id, { name: '103', longName: '휴게', footprint: [[20, 0], [24, 0], [24, 4], [20, 4]] })!.created[0]
    setZoneSpaces(model, zone.id, [office().id, extra])
    deleteSpace(model, extra)
    expect(zone.spaceIds).toEqual([office().id])
  })
})
