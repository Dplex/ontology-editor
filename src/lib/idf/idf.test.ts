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
import type { Model, Space, Vec2 } from '../model'
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
    // 바닥 조각 셋 중 창고(가운데 x=12.1)만 BIM 방 범위(0..10, ±2m) 밖이다. 반을 넘으니 좌표계 경고는 없다.
    expect(report.alignment).toBeCloseTo(2 / 3)
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

  it('다른 자리의 IDF 는 좌표계가 다르다고 알린다', () => {
    const far = text.replace('Zone, 1F:STORE, 0, 10.2, 0, 0', 'Zone, 1F:STORE, 0, 910.2, 0, 0').replace(/BuildingSurface:Detailed, 1F:OFFICE_Floor_(\d), Floor, Ground floor, 1F:OFFICE/g, 'BuildingSurface:Detailed, 1F:OFFICE_Floor_$1, Floor, Ground floor, 1F:STORE')
    const { report, model } = attachIdf(mep, readIdf(far), 'far.idf')
    expect(report.alignment).toBeLessThan(0.5)
    expect(model.warnings.some((w) => w.includes('좌표계'))).toBe(true)
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
