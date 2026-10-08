import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf, createSpace, diffBaseline, restore, snapshotHvacZones } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { splitByStorey } from './storey-drafts'
import { createZoneFromOutline, createZoneFromSpaces, deleteHvacZone, hvacZonesOf, setZoneServedBy } from './hvac-zone'
import { escapeLocalName, modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { readGeoJSON } from './export/read-export'
import type { Model } from './model'

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
