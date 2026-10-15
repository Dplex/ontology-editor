import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from '../ifc/import'
import { modelToTTL } from '../export/ttl'
import { modelToGeoJSON } from '../export/geojson'
import { parseIdf } from './parse'
import { readIdf } from './read'
import { attachIdf, modelFromIdf, nameKey } from './attach'
import { matchLevels, storeyHint } from './place'
import type { Equipment, Model, Space, Vec2 } from '../model'
import type { IdfModel } from './read'

// 픽스처는 손으로 쓴 IDF 다(fixtures/two-zones.idf). mep.ifc 와 같은 자리에 공조존 둘과 담당 사슬 둘이 있다.
const text = readFileSync(fileURLToPath(new URL('./fixtures/two-zones.idf', import.meta.url)), 'utf8')
let mep: Model

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  mep = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('../ifc/fixtures/mep.ifc', import.meta.url)))))
}, 60_000)

describe('parseIdf', () => {
  it('주석을 떼고 객체를 클래스·값으로 나눈다', () => {
    const objs = parseIdf('Zone, A, 0; ! 주석, 이것은 값이 아니다\nNodeList, L, n1,\n  n2;')
    expect(objs).toEqual([
      { cls: 'Zone', key: 'zone', fields: ['A', '0'] },
      { cls: 'NodeList', key: 'nodelist', fields: ['L', 'n1', 'n2'] },
    ])
  })
})

describe('readIdf — 공조존과 담당 관계', () => {
  const idf = readIdf(text)

  it('존마다 바닥면을 모으고, 상대 좌표를 존 원점으로 옮긴다', () => {
    expect(idf.version).toBe('22.2')
    const office = idf.zones.find((z) => z.name === '1F:OFFICE')!
    expect(office.floors).toHaveLength(2)
    expect(office.declaredArea).toBe(76)
    const store = idf.zones.find((z) => z.name === '1F:STORE')!
    // 상대 좌표 (0..3.8) 가 원점 x=10.2 만큼 옮겨진다.
    expect(Math.min(...store.floors[0].ring.map((p) => p[0]))).toBeCloseTo(10.2)
  })

  it('공조기 → VAV → 존, 실외기 → 실내기 → 존의 사슬을 노드로 찾고, 이상 부하 장치는 뺀다', () => {
    const byName = new Map(idf.equipment.map((e) => [e.name, e]))
    expect(byName.get('AHU 1')).toMatchObject({ kind: 'ahu', feeds: [{ equipment: 'VAV-101' }] })
    expect(byName.get('VAV-101')).toMatchObject({ kind: 'vav', feeds: [{ zone: '1F:OFFICE' }] })
    expect(byName.get('VRF ODU-1')).toMatchObject({ kind: 'outdoor_unit', feeds: [{ equipment: '1F:STORE IDU' }] })
    expect(byName.get('1F:STORE IDU')).toMatchObject({ kind: 'indoor_unit', feeds: [{ zone: '1F:STORE' }] })
    expect(byName.has('1F:STORE Ideal')).toBe(false)
    expect(idf.warnings.some((w) => w.includes('IdealLoadsAirSystem'))).toBe(true)
  })
})

describe('attachIdf — BIM 에 얹기', () => {
  it('층은 바닥 높이로, 방은 자리로, 설비는 이름으로 잇는다', () => {
    const { model, report } = attachIdf(mep, readIdf(text), 'two-zones.idf')
    const zones = model.hvac!.zones
    const office = zones.find((z) => z.name === '1F:OFFICE')!
    // 두 조각이 변을 맞대어 하나가 된다.
    expect(office.footprint).toHaveLength(1)
    expect(office.areaM2).toBeCloseTo(80)
    expect(office.storeyId).toBe(mep.storeys[0].id)
    expect(office.spaceIds).toEqual([mep.storeys[0].spaces[0].id])
    expect(zones.find((z) => z.name === '1F:STORE')!.spaceIds).toEqual([])
    expect(report).toMatchObject({ zones: 2, zonesOnStoreys: 2, createdStoreys: 0, zonesWithSpaces: 1, spacesInZones: 1, matchedEquipment: 1, equipment: 4 })
    // 합친 바닥 둘(사무실 한 장 · 창고) 중 창고(가운데 x=12.1)만 BIM 방 범위(0..10, ±2m) 밖이다. 좌표계 경고는 없다.
    expect(report.alignment).toBeCloseTo(1 / 2)
    // 제자리에서 이미 존 넓이의 절반 넘게 방과 겹쳐 옮기지 않는다.
    expect(report.placement).toMatchObject({ dx: 0, dy: 0, rotation: 0, source: 'auto' })
    expect(model.warnings.some((w) => w.includes('좌표계'))).toBe(false)

    // IDF 의 "AHU 1" 은 BIM 의 AHU-1 이다(기호·공백을 뗀 이름이 하나에만 맞는다).
    const ahu = model.hvac!.equipment.find((e) => e.name === 'AHU 1')!
    expect(ahu.bimId).toBe(mep.storeys[0].equipment.find((e) => e.name === 'AHU-1')!.id)
    expect(nameKey('AHU 1')).toBe(nameKey('AHU-1'))
    // 말단은 담당 존의 층에 있다고 본다. 공조기·실외기는 층을 모른다.
    expect(model.hvac!.equipment.find((e) => e.name === 'VAV-101')!.storeyId).toBe(mep.storeys[0].id)
    expect(model.hvac!.equipment.find((e) => e.name === 'VRF ODU-1')!.storeyId).toBeUndefined()
  })

  it('TTL 에 공조존과 담당 관계가 나가고, BIM 과 이어진 공조기는 BIM 설비 블록에 적힌다', () => {
    const { model } = attachIdf(mep, readIdf(text), 'two-zones.idf')
    const ttl = modelToTTL(model)
    expect(ttl).toMatch(/ex:Z_1F_OFFICE a brick:HVAC_Zone ;\n {4}rdfs:label "1F:OFFICE" ;\n {4}brick:hasPart ex:\S+ ;/)
    const ahuBlock = ttl.split('\n\n').find((b) => b.includes('rdfs:label "AHU-1"'))!
    expect(ahuBlock).toContain('ex:I_VAV_101')
    const vav = ttl.split('\n\n').find((b) => b.startsWith('ex:I_VAV_101 '))!
    expect(vav).toContain('a brick:Variable_Air_Volume_Box')
    expect(vav).toContain('brick:feeds ex:Z_1F_OFFICE')
    expect(vav).toContain(`brick:hasLocation ex:${mep.storeys[0].id.replace(/\$/g, '\\$')}`)
    // 좌표는 TTL 에 들어가지 않는다. 공조존 바닥은 GeoJSON 에만 있다.
    expect(ttl).not.toMatch(/10\.2|3\.8/)
    const floor = modelToGeoJSON(model)[0].collection.features.filter((f) => f.properties.kind === 'hvacZone')
    expect(floor.map((f) => f.properties.name)).toEqual(['1F:OFFICE', '1F:STORE'])
  })

  // 성수 IDF 는 건물 모서리를 원점에 두고 그려 BIM 과 16.76m · 18.08m 어긋났다. 같은 일을 사무실을 900m 옮겨 흉내 낸다.
  const far = text.replace('Zone, 1F:STORE, 0, 10.2, 0, 0', 'Zone, 1F:STORE, 0, 910.2, 0, 0').replace(/BuildingSurface:Detailed, 1F:OFFICE_Floor_(\d), Floor, Ground floor, 1F:OFFICE/g, 'BuildingSurface:Detailed, 1F:OFFICE_Floor_$1, Floor, Ground floor, 1F:STORE')

  it('[OE-IDF-05] 원점이 다른 IDF 는 겹친 넓이가 가장 큰 자리로 옮겨 놓고 그 값을 알린다', () => {
    const { report, model } = attachIdf(mep, readIdf(far), 'far.idf')
    expect(report.placement).toMatchObject({ dx: -910.2, dy: 0, rotation: 0, source: 'auto' })
    expect(report.placement!.before).toBe(0)
    expect(report.placement!.overlap).toBeGreaterThan(0.5)
    expect(report.alignment).toBe(1)
    expect(model.hvac!.placement).toMatchObject({ dx: -910.2, source: 'auto' })
    expect(model.hvac!.zones.find((z) => z.name === '1F:STORE')!.spaceIds).toEqual([mep.storeys[0].spaces[0].id])
    expect(model.warnings.some((w) => w.includes('x -910.2m'))).toBe(true)
    expect(model.warnings.some((w) => w.includes('좌표계'))).toBe(false)
  })

  it('[OE-IDF-05] 사람이 정한 놓는 법을 주면 찾지 않고 그대로 쓴다 — 틀린 값이면 좌표계 경고가 남는다', () => {
    const wrong = attachIdf(mep, readIdf(far), 'far.idf', { placement: { dx: 0, dy: 0, rotation: 0 } })
    expect(wrong.report.placement).toMatchObject({ dx: 0, source: 'edit', overlap: 0 })
    expect(wrong.report.alignment).toBeLessThan(0.5)
    expect(wrong.model.warnings.some((w) => w.includes('좌표계'))).toBe(true)
    // 90° 돌린 뒤 옮기는 값도 받는다: (x, y) → (-y, x) + (dx, dy).
    const turned = attachIdf(mep, readIdf(far), 'far.idf', { placement: { dx: 8, dy: -910.2, rotation: 90 } })
    const ring = turned.model.hvac!.zones.find((z) => z.name === '1F:STORE')!.footprint.flat()
    expect(Math.min(...ring.map((p) => p[0]))).toBeCloseTo(0)
    expect(Math.min(...ring.map((p) => p[1]))).toBeCloseTo(0)
  })
})

describe('attachIdf — 공조존과 물리존을 겹친 넓이로 잇기', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
  const room = (id: string, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: 0, boundedBy: [] })
  const zone = (name: string, ring: Vec2[]): IdfModel['zones'][number] => ({ name, floors: [{ ring, z: 0 }], declaredArea: null, multiplier: 1 })
  const bim = (spaces: Space[]): Model => ({
    schema: 'IFC4', siteName: '', buildingId: 'B', buildingName: '', systems: [], connections: [], warnings: [],
    storeys: [{ id: 'S1', name: '1F', elevation: 0, spaces, walls: [], openings: [], equipment: [] }],
  })

  it('벽 중심선까지 그린 존과 벽 안쪽까지 그린 방: 옆 존으로 조금 삐친 방은 걸친 것으로 세지 않고, 두 존을 잇는 복도만 센다', () => {
    // DesignBuilder 는 존을 벽 중심선(x=5, 벽 0.2m)까지 그리고, Revit 방은 벽 안쪽 면까지다.
    const idf: IdfModel = { version: null, warnings: [], equipment: [], zones: [zone('A', sq(0, 0, 5, 8)), zone('B', sq(5, 0, 10, 8))] }
    const { model, report } = attachIdf(
      bim([
        room('office', sq(0.1, 0.1, 4.9, 5.9)),
        // 방 경계를 벽 중심선 너머 5cm 까지 그린 방. 옆 존에 1% 걸친다 — 걸친 방이 아니다.
        room('meeting', sq(4.95, 0.1, 9.9, 5.9)),
        // 두 존을 잇는 복도. 71% 가 A 다.
        room('corridor', sq(0.1, 6.1, 7, 7.9)),
      ]),
      idf,
      'x.idf',
    )
    const [a, b] = model.hvac!.zones
    expect(a.spaceIds).toEqual(['office', 'corridor'])
    expect(b.spaceIds).toEqual(['meeting'])
    expect(a.spaceShares!.corridor).toBeCloseTo(4.9 / 6.9, 3)
    expect(report).toMatchObject({ spacesInZones: 3, straddling: 1, partial: 0 })
  })

  it('두 존에 반씩 걸친 방은 어느 존에도 넣지 않는다 — 안쪽 점으로 재면 가운데 점이 놓인 쪽에 우연히 들어간다', () => {
    const idf: IdfModel = { version: null, warnings: [], equipment: [], zones: [zone('A', sq(0, 0, 5, 8)), zone('B', sq(5, 0, 10, 8))] }
    const { model, report } = attachIdf(bim([room('hall', sq(2, 1, 8, 3))]), idf, 'x.idf')
    expect(model.hvac!.zones.flatMap((z) => z.spaceIds)).toEqual([])
    expect(report).toMatchObject({ straddling: 1, partial: 1 })
    expect(model.warnings.some((w) => w.includes('절반을 덮지 않아'))).toBe(true)
  })

  it('오목한 존의 빈 모서리에 놓인 방은 존에 들지 않는다 — 안쪽 점이 존 바깥 모서리에 걸쳐도', () => {
    // ㄱ자 존. 오른쪽 위 (5..10, 5..10) 이 비었다.
    const ell: Vec2[] = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0]]
    const idf: IdfModel = { version: null, warnings: [], equipment: [], zones: [zone('L', ell)] }
    const { model } = attachIdf(bim([room('notch', sq(5.5, 5.5, 9.5, 9.5)), room('arm', sq(1, 6, 4, 9))]), idf, 'x.idf')
    expect(model.hvac!.zones[0].spaceIds).toEqual(['arm'])
  })

  it('자기 교차한 방은 넓이를 못 재 안쪽 점으로 정한다', () => {
    const idf: IdfModel = { version: null, warnings: [], equipment: [], zones: [zone('A', sq(0, 0, 10, 10))] }
    // 셋째 변이 첫 변을 가로지른다.
    const bow: Vec2[] = [[1, 1], [5, 1], [5, 5], [3, 0.5], [1, 5], [1, 1]]
    const { report } = attachIdf(bim([room('bow', bow)]), idf, 'x.idf')
    expect(report.byPoint).toBe(1)
  })
})

describe('modelFromIdf — IDF 만 열기', () => {
  it('바닥 높이마다 층을 세우고 존을 얹는다', () => {
    const { model, report } = modelFromIdf(readIdf(text), 'two-zones.idf')
    expect(model.storeys.map((s) => s.name)).toEqual(['IDF 바닥 0.00m'])
    expect(report).toMatchObject({ zones: 2, zonesOnStoreys: 2, createdStoreys: 1, matchedEquipment: 0 })
    expect(modelToTTL(model)).toContain('a brick:HVAC_Zone')
  })
})

// 성수(Factorial.idf + 건축·기계 IFC)에서 본 모양을 줄여 옮긴다. 성수 IDF 는 3F 위로 층고 3m, BIM 은 4.3m 다. 기준층은 방 하나
// (Business Facility)를 창가 띠 넷(N·E·S·W)과 안쪽(C), 존 다섯이 나누고, 창가 존마다 IDF FCU 한 대가 BIM FCU 여러 대를 뭉쳐 계산한다.
describe('matchLevels — 층고가 다른 IDF 를 층에 맞추기', () => {
  const st = (name: string, elevation: number) => ({ id: name, elevation })
  const bim = [st('-', -24.9), st('B1F', -6), st('1F', 0), st('2F', 5), st('3F', 10), st('4F', 14.3), st('5F', 18.6), st('6F', 22.9), st('7F', 27.2), st('8F', 31.5), st('9F', 35.8), st('10F', 40.1), st('RFT', 44.6), st('RF', 49.6)]

  it('[OE-IDF-04] 높이가 맞는 층을 닻으로 삼고 그 위는 순서로 맞춘다(성수: 높이 4 · 순서 7)', () => {
    const idf = [-6, 0, 5, 10, 13, 16, 19, 22, 25, 28, 31]
    const { storeyOf, byHeight, byOrder } = matchLevels(idf, bim, 0.5)
    expect({ byHeight, byOrder }).toEqual({ byHeight: 4, byOrder: 7 })
    expect(idf.map((z) => storeyOf.get(z))).toEqual(['B1F', '1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F'])
  })

  it('[OE-IDF-04] 닻 사이의 바닥 수와 층 수가 다르면 그 사이는 맞추지 않는다 — 한 층을 빼고 그린 IDF 를 한 칸씩 밀지 않는다', () => {
    // 1F(0)·5F(18.6) 가 닻. 그 사이 IDF 바닥은 둘인데 BIM 층은 셋(2F·3F·4F)이다.
    const { storeyOf, byOrder } = matchLevels([0, 4, 8, 18.6], bim, 0.5)
    expect(storeyOf.get(0)).toBe('1F')
    expect(storeyOf.get(18.6)).toBe('5F')
    expect(storeyOf.has(4)).toBe(false)
    expect(storeyOf.has(8)).toBe(false)
    expect(byOrder).toBe(0)
  })

  it('[OE-IDF-04] 위층에서 우연히 높이가 맞은 층은 닻으로 쓰지 않는다 — 10F(31m)가 BIM 8F(31.5m)에 붙지 않는다', () => {
    const idf = [-6, 0, 5, 10, 13, 16, 19, 22, 25, 28, 31.4]
    const { storeyOf, byHeight, byOrder } = matchLevels(idf, bim, 0.5)
    expect({ byHeight, byOrder }).toEqual({ byHeight: 4, byOrder: 7 })
    expect(storeyOf.get(31.4)).toBe('10F')
  })

  it('[OE-IDF-04] 높이가 맞는 층이 하나도 없으면 아무것도 맞추지 않는다', () => {
    expect(matchLevels([100, 103], bim, 0.5).storeyOf.size).toBe(0)
  })

  it('존 이름의 층은 대 보는 데만 읽는다', () => {
    expect(['4F_office-C_AHU_a', 'B1F_kitchen_AHU.GSHP.SAC', '1F:OFFICE', '10F_aux_AHU', 'Office', 'F4 room'].map(storeyHint)).toEqual(['4F', 'B1F', '1F', '10F', null, null])
  })
})

describe('attachIdf — 성수 모양: 방 하나를 존 다섯이 나누고, FCU 는 존 안의 여러 대다', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
  const zone = (name: string, ring: Vec2[], z = 0): IdfModel['zones'][number] => ({ name, floors: [{ ring, z }], declaredArea: null, multiplier: 1 })
  const device = (id: string, kind: string, x: number, y: number): Equipment => ({
    id, name: id, kind, ifcClass: 'UnitaryEquipment', role: 'conversion', position: [x, y, 2.7], capacity: null, capacityProperty: null, systemId: null, spaceId: null, spaceSource: null,
  })
  // 20 x 10 방 하나. 창가 2m 띠 넷과 안쪽.
  const office: Space = { id: 'office', name: 'office', longName: 'Business Facility', footprint: sq(0, 0, 20, 10), areaM2: 200, boundedBy: [] }
  // 3F 는 높이가 맞고(10m) 4F 는 다르다(IDF 13m · BIM 14.3m). 3F 가 닻이 되어 4F 를 순서로 맞춘다.
  const bim = (equipment: Equipment[]): Model => ({
    schema: 'IFC2X3', siteName: '', buildingId: 'B', buildingName: '', systems: [], connections: [], warnings: [],
    storeys: [
      { id: '3F', name: '3F', elevation: 10, spaces: [], walls: [], openings: [], equipment: [] },
      { id: '4F', name: '4F', elevation: 14.3, spaces: [office], walls: [], openings: [], equipment },
    ],
  })
  // IDF 는 원점이 (-5, -5) 어긋났고 높이는 13m(층고 3m 로 다듬음)다.
  const shift = (r: Vec2[]) => r.map(([x, y]) => [x - 5, y - 5] as Vec2)
  const zones = [
    zone('3F_aux_AHU', shift(sq(0, 0, 4, 4)), 10),
    zone('4F_office-C_AHU_a', shift(sq(2, 2, 18, 8)), 13),
    zone('4F_office-S_FCU_a', shift(sq(0, 0, 20, 2)), 13),
    zone('4F_office-N_FCU_a', shift(sq(0, 8, 20, 10)), 13),
    zone('4F_office-W_FCU_a', shift(sq(0, 2, 2, 8)), 13),
    zone('4F_office-E_FCU_a', shift(sq(18, 2, 20, 8)), 13),
  ]
  const idf: IdfModel = {
    version: '24.2',
    warnings: [],
    zones,
    equipment: [
      { name: '4F_office-N_FCU_a_FCU', idfClass: 'ZoneHVAC:FourPipeFanCoil', kind: 'fcu', feeds: [{ zone: '4F_office-N_FCU_a' }], airflow: 1.5 },
      { name: '4F_office-S_FCU_a_FCU', idfClass: 'ZoneHVAC:FourPipeFanCoil', kind: 'fcu', feeds: [{ zone: '4F_office-S_FCU_a' }], airflow: null },
      { name: 'Air Terminal Single Duct VAV No Reheat 1', idfClass: 'AirTerminal:SingleDuct:VAV:NoReheat', kind: 'vav', feeds: [{ zone: '4F_office-C_AHU_a' }], airflow: null },
      { name: 'AirLoopHVAC_4F', idfClass: 'AirLoopHVAC', kind: 'ahu', feeds: [{ equipment: 'Air Terminal Single Duct VAV No Reheat 1' }], airflow: 6.69 },
    ],
  }
  const fcus = [device('fcu_n1', 'fcu', 3, 9), device('fcu_n2', 'fcu', 10, 9), device('fcu_n3', 'fcu', 17, 9), device('fcu_c', 'fcu', 10, 5)]
  const ahu = device('ahu2', 'ahu', 25, 5)

  it('[OE-IDF-04][OE-IDF-05] 층은 순서로, 평면은 겹친 넓이로 찾아 방 하나와 존 다섯이 맞물린다', () => {
    const { model, report } = attachIdf(bim([...fcus, ahu]), idf, 'f.idf')
    expect(report).toMatchObject({ zonesOnStoreys: 6, zonesByOrder: 5, storeyNameMismatch: [] })
    expect(report.placement).toMatchObject({ dx: 5, dy: 5, rotation: 0, source: 'auto' })
    expect(report.placement!.overlap).toBeCloseTo(1)
    expect(model.hvac!.zones.map((z) => z.storeyId)).toEqual(['3F', '4F', '4F', '4F', '4F', '4F'])
    expect(model.warnings.some((w) => w.includes('순서로 층을 맞췄습니다'))).toBe(true)
  })

  it('[OE-IDF-06] 방 하나를 나눈 존 다섯이 모두 그 방과의 겹친 몫을 갖고, 절반 넘게 덮는 존이 없으면 어느 존의 일부도 아니다', () => {
    const { model, report } = attachIdf(bim(fcus), idf, 'f.idf')
    const zs = model.hvac!.zones.filter((z) => z.storeyId === '4F')
    expect(zs.map((z) => z.overlaps?.map((o) => o.spaceId))).toEqual([['office'], ['office'], ['office'], ['office'], ['office']])
    const c = zs.find((z) => z.name.includes('-C_'))!
    expect(c.overlaps![0]).toEqual({ spaceId: 'office', spaceShare: 0.48, zoneShare: 1 })
    expect(zs.reduce((n, z) => n + z.overlaps![0].spaceShare, 0)).toBeCloseTo(1)
    // 48% 는 절반이 안 된다 — 지어내지 않는다.
    expect(zs.flatMap((z) => z.spaceIds)).toEqual([])
    expect(report).toMatchObject({ straddling: 1, partial: 1 })
    const feature = modelToGeoJSON(model).flatMap((f) => f.collection.features).find((f) => f.id === c.id)!
    expect(feature.properties).toMatchObject({ overlaps: [{ spaceId: 'office', spaceShare: 0.48, zoneShare: 1 }], overlapsSource: 'calc' })
  })

  it('[OE-IDF-08] IDF FCU 한 대는 그 존 안의 BIM FCU 여럿으로 풀리고, 그 FCU 들이 존을 담당하며 IDF 풍량은 존에 남는다', () => {
    const { model, report } = attachIdf(bim(fcus), idf, 'f.idf')
    const n = model.hvac!.equipment.find((e) => e.name === '4F_office-N_FCU_a_FCU')!
    expect(n).toMatchObject({ bimIds: ['fcu_n1', 'fcu_n2', 'fcu_n3'], pairedBy: 'zone', bimId: null, airflowCMH: 5400 })
    // S 존 안에는 BIM FCU 가 없다 — IDF 설비로 남는다. 안쪽(C)의 FCU 는 어느 IDF FCU 에도 들지 않는다.
    expect(model.hvac!.equipment.find((e) => e.name === '4F_office-S_FCU_a_FCU')!.bimIds).toBeUndefined()
    expect(report).toMatchObject({ byZone: 1, bimInZones: 3 })
    const nZone = model.hvac!.zones.find((z) => z.name === '4F_office-N_FCU_a')!
    expect(nZone.idfAirflowCMH).toBe(5400)

    const ttl = modelToTTL(model)
    const block = (id: string) => ttl.split('\n\n').find((b) => b.startsWith(`ex:${id} `)) ?? ''
    for (const id of ['fcu_n1', 'fcu_n2', 'fcu_n3']) expect(block(id)).toContain(`brick:feeds ex:${nZone.id}`)
    expect(block('fcu_c')).not.toContain('brick:feeds')
    // 풀린 IDF FCU 는 따로 나가지 않는다. 풀리지 않은 S 존 FCU 는 IDF 설비로 나간다.
    expect(ttl).not.toContain('ex:I_4F_office_N_FCU_a_FCU ')
    expect(ttl).toContain('ex:I_4F_office_S_FCU_a_FCU a ')
    expect(block(nZone.id)).toContain('ex:nominalAirFlowRate 5400 ;')
  })

  it('[OE-IDF-08] 공조기는 담당하는 존이 한 층뿐이고 그 층의 같은 종류 BIM 기기가 하나뿐이면 잇는다 — 층은 위치로 적지 않는다', () => {
    const one = attachIdf(bim([...fcus, ahu]), idf, 'f.idf')
    const loop = one.model.hvac!.equipment.find((e) => e.name === 'AirLoopHVAC_4F')!
    expect(loop).toMatchObject({ bimId: 'ahu2', pairedBy: 'storey', airflowCMH: 24084 })
    // 공조기가 놓인 곳(공조실·옥상)은 담당 층과 다를 수 있다.
    expect(loop.storeyId).toBeUndefined()
    expect(one.report.byStorey).toBe(1)
    const ttl = modelToTTL(one.model)
    expect(ttl.split('\n\n').find((b) => b.startsWith('ex:ahu2 '))).toContain('brick:feeds ex:I_Air_Terminal_Single_Duct_VAV_No_Reheat_1')

    // 같은 층에 공조기가 둘(성수 B1F 의 AHU1·OHU1)이면 고르지 않는다.
    const two = attachIdf(bim([...fcus, ahu, device('ohu1', 'ahu', 26, 5)]), idf, 'f.idf')
    expect(two.model.hvac!.equipment.find((e) => e.name === 'AirLoopHVAC_4F')!.bimId).toBeNull()
  })

  it('이름이 맞으면 이름이 먼저다 — 존 안의 같은 종류로 다시 풀지 않는다', () => {
    const named = attachIdf(bim([...fcus, { ...device('x', 'fcu', 30, 30), name: '4F office-N FCU a FCU' }]), idf, 'f.idf')
    expect(named.model.hvac!.equipment.find((e) => e.name === '4F_office-N_FCU_a_FCU')).toMatchObject({ bimId: 'x', pairedBy: 'name' })
    expect(named.model.hvac!.equipment.find((e) => e.name === '4F_office-N_FCU_a_FCU')!.bimIds).toBeUndefined()
  })
})

describe('readIdf — 설계 풍량', () => {
  it('숫자로 적힌 풍량만 읽고 Autosize 는 비운다', () => {
    const idf = readIdf(text)
    // 픽스처의 VAV 는 최대 풍량이 autosize 다.
    expect(idf.equipment.find((e) => e.name === 'VAV-101')!.airflow).toBeNull()
    const fcu = readIdf(`Version, 24.2;
Zone, Z1, 0, 0, 0, 0, 1, 1;
ZoneHVAC:EquipmentConnections, Z1, Z1 Eq, , , Z1 Node, ;
ZoneHVAC:EquipmentList, Z1 Eq, SequentialLoad, ZoneHVAC:FourPipeFanCoil, Z1 FCU, 1, 1, , ;
ZoneHVAC:FourPipeFanCoil, Z1 FCU, Always On, CyclingFan, 1.5066666666666668, , , 0;`)
    expect(fcu.equipment[0]).toMatchObject({ kind: 'fcu', airflow: 1.5066666666666668 })
  })
})
