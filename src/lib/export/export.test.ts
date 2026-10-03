import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from '../ifc/import'
import type { Model } from '../model'
import { modelToGeoJSON, storeyToGeoJSON } from './geojson'
import { escapeLocalName, modelToTTL } from './ttl'
import { NUMERIC_OK, numericPredicates } from './read-export'

let model: Model
let mep: Model

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const load = (name: string) =>
    importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`../ifc/fixtures/${name}`, import.meta.url)))))
  model = load('two-rooms.ifc')
  mep = load('mep.ifc')
}, 60_000)

describe('GeoJSON', () => {
  it('층마다 파일 하나가 나온다', () => {
    expect(modelToGeoJSON(model).map((f) => f.fileName)).toEqual(['floor-1F.geojson', 'floor-2F.geojson'])
  })

  it('다각형 고리를 닫아서 내보낸다', () => {
    const fc = storeyToGeoJSON(model.storeys[0])
    const meeting = fc.features.find((f) => f.properties.name === '101')!
    const ring = (meeting.geometry as { coordinates: number[][][] }).coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring).toHaveLength(5)
  })

  it('외곽선이 없는 공간도 geometry: null 로 남긴다', () => {
    // 빼 버리면 온톨로지에는 있는데 지도에는 없는 공간이 생긴다.
    const spaces = storeyToGeoJSON(model.storeys[1]).features.filter((f) => f.properties.kind === 'space')
    expect(spaces).toHaveLength(1)
    expect(spaces[0].geometry).toBe(null)
  })

  it('벽·문·창은 GeoJSON 에만 나가고, 문이 잇는 방은 TTL 주어를 가리킨다', () => {
    // Brick 에는 건축 부재 클래스가 없다. 벽·문·창은 3D Map·로봇 경로가 쓰는 기하 층이다.
    const walled: Model = structuredClone(model)
    const storey = walled.storeys[0]
    const [a, b] = storey.spaces
    storey.walls = [{ id: 'w1', name: 'W', thickness: 0.2, loadBearing: null, footprint: [[[0, 0], [5, 0], [5, 0.2], [0, 0.2], [0, 0]]] }]
    storey.openings = [
      { id: 'd1', kind: 'door', name: 'D', width: 0.9, height: 2.1, wallId: 'w1', passable: true, position: [2, 0.1, 0], connects: [a.id, b.id], connectsSource: 'calc' },
    ]
    const features = storeyToGeoJSON(storey).features
    const wall = features.find((f) => f.id === 'w1')!
    expect(wall.geometry?.type).toBe('Polygon')
    // IsExternal 이 없어 건물 바깥에 닿는지로 계산한다(OE-EXT-01). 방 둘의 아래 변을 따라 놓인 벽이라 외벽이다.
    expect(wall.properties).toMatchObject({ kind: 'wall', loadBearing: null, external: true, externalSource: 'calc', thickness: 0.2, passable: false })
    const door = features.find((f) => f.id === 'd1')!
    expect(door.geometry).toEqual({ type: 'Point', coordinates: [2, 0.1, 0] })
    expect(door.properties).toMatchObject({ kind: 'door', connects: [a.id, b.id], connectsSource: 'calc', passable: true })

    const ttl = modelToTTL(walled)
    expect(ttl).not.toContain(`ex:${escapeLocalName('w1')} a`)
    expect(ttl).not.toContain(`ex:${escapeLocalName('d1')} a`)
    for (const id of [a.id, b.id]) expect(ttl).toContain(`ex:${escapeLocalName(id)} a brick:`)
  })
})

describe('Brick TTL', () => {
  it('IFC GUID 의 $ 를 이스케이프한다', () => {
    // 안 하면 그 줄만 다르게 읽혀서 주어가 조용히 갈라진다.
    expect(escapeLocalName('0PoC$Space$Meeting$000')).toBe('0PoC\\$Space\\$Meeting\\$000')
  })

  it('이스케이프로 못 살리는 문자는 _ 로 바꾼다', () => {
    // 공백은 Turtle 지역 이름에 들어갈 방법이 없다. 그대로 두면 파일이 통째로 깨진다.
    expect(escapeLocalName('MEP Building')).toBe('MEP_Building')
  })

  it('건물 주어로 이름이 아니라 GlobalId 를 쓴다', () => {
    // 이름에는 공백이 들어간다. id 자리에 이름을 쓰면 재임포트 때 주어도 같이 바뀐다.
    expect(modelToTTL(model)).toContain('ex:0PoC\\$Building\\$0000000 a brick:Building ;')
    expect(modelToTTL(model)).not.toContain('ex:PoC Building')
  })

  it('계층을 hasPart 로 잇는다', () => {
    const ttl = modelToTTL(model)
    expect(ttl).toContain('a brick:Building ;')
    expect(ttl).toContain('a brick:Floor ;')
    // 방 이름으로 종류를 알면 Brick 방 하위 클래스로 나간다(kinds.ts). 회의실은 Conference_Room 이다.
    expect(ttl).toContain('a brick:Conference_Room ;')
    expect(ttl).toContain('brick:hasPart ex:0PoC\\$Storey\\$1F\\$00000, ex:0PoC\\$Storey\\$2F\\$00000 ;')
  })

  it('기하를 담지 않는다', () => {
    // WKT 문자열로 새어 들어가면 이 PoC 의 전제가 깨진다.
    const ttl = modelToTTL(model)
    expect(ttl).not.toMatch(/POLYGON|coordinates|wkt/i)
  })

  it('한글 이름을 라벨로 넣는다', () => {
    expect(modelToTTL(model)).toContain('rdfs:label "회의실" ;')
  })
})

describe('두 파일을 잇는 id', () => {
  it('GeoJSON feature id 가 TTL 주어와 같다', () => {
    const ttl = modelToTTL(model)
    // 벽·문·창은 기하 층이라 TTL 에 주어가 없다(위 GeoJSON 테스트). 물리존·설비만 짝을 본다.
    const ids = modelToGeoJSON(model).flatMap((f) =>
      f.collection.features.filter((x) => x.properties.kind === 'space' || x.properties.kind === 'equipment').map((x) => x.id),
    )

    expect(ids).toHaveLength(3)
    for (const id of ids) {
      expect(ttl).toContain(`ex:${escapeLocalName(id)} a brick:`)
    }
  })
})

// --- 설비까지 내보낸다 --------------------------------------------------------
describe('설비 내보내기', () => {
  it('Brick 에 있는 클래스는 brick:, 없으면 ex: 로 뺀다', () => {
    const ttl = modelToTTL(mep)
    expect(ttl).toContain('a brick:Air_Handling_Unit ;')
    expect(ttl).toContain('a brick:Air_Diffuser ;')
  })

  it('덕트·배관 구간은 Brick 이 아니라 FSO 로 뺀다', () => {
    // Brick 은 기기의 어휘이지 덕트 한 토막의 어휘가 아니다. ex:DuctSegment 로 두면 읽는
    // 쪽에서 기기와 구별할 수 없고, 설비 대수를 세면 실측 기준 여섯 배로 부푼다.
    const ttl = modelToTTL(mep)
    expect(ttl).toContain('@prefix fso: <http://www.w3id.org/fso#> .')
    expect(ttl).toContain('a fso:Segment ;')
    expect(ttl).not.toContain('a ex:DuctSegment ;')
  })

  it('소속 물리존을 hasLocation 으로 잇는다', () => {
    const office = mep.storeys[0].spaces[0]
    expect(modelToTTL(mep)).toContain(`brick:hasLocation ex:${escapeLocalName(office.id)} ;`)
  })

  it('방을 못 찾은 설비는 BIM 이 말한 층을 hasLocation 으로 적는다', () => {
    // 층까지 비우면 설비가 계층 어디에도 걸리지 않아 이상 알림에 위치가 없다. 층은 BIM 이 말한 것이고,
    // 목적어가 brick:Floor 라 방과 갈린다(받는 쪽 공간 장면 도구도 같은 관례다).
    const sensor = mep.storeys[0].equipment.find((e) => e.name === 'TEMP-101-01')!
    expect(sensor.spaceId).toBeNull()
    const ttl = modelToTTL(mep)
    const block = ttl.split('\n\n').find((b) => b.startsWith(`ex:${escapeLocalName(sensor.id)} `))!
    expect(block).toContain(`brick:hasLocation ex:${escapeLocalName(mep.storeys[0].id)} ;`)
    expect(ttl).toContain(`ex:${escapeLocalName(mep.storeys[0].id)} a brick:Floor ;`)
  })

  it('용량은 양의 종류마다 다른 술어로 나간다', () => {
    // 한때 전부 ex:nominalAirFlowRate 였다. 냉동기의 NominalCapacity(W)나 배관의 Revit Flow(물)가 풍량으로 나갔다.
    const ttl = modelToTTL(mep)
    expect(ttl).toContain('ex:nominalAirFlowRate 1.6667 ;')
    expect(ttl).toContain('ex:nominalAirFlowRate 0.25 ;')

    const m = structuredClone(mep)
    const ahu = m.storeys[0].equipment.find((e) => e.name === 'AHU-1')!
    Object.assign(ahu, { capacity: 350000, capacityProperty: 'NominalCapacity' })
    const at = m.storeys[0].equipment.find((e) => e.name === 'AT-101-01')!
    Object.assign(at, { capacity: 2, capacityProperty: 'Flow' })
    const out = modelToTTL(m)
    expect(out).toContain('ex:nominalCapacity 350000 ;')
    expect(out).toContain('ex:nominalFlowRate 2 ;')
    expect(out).not.toContain('ex:nominalAirFlowRate')
  })

  it('계통을 hasPart 로 묶고, 종류를 알면 Brick 계통 클래스로 적는다', () => {
    const ttl = modelToTTL(mep)
    // AIRCONDITIONING + SUP 는 급기다. Brick 에는 급기만의 계통 클래스가 없어 공기 계통이고, 급기는 따로 적는다.
    expect(ttl).toMatch(/a brick:Air_System ;\n {4}ex:systemKind "supply_air" ;\n {4}brick:hasPart ex:\S+/)
    expect(ttl).toContain('rdfs:label "AHU-1 급기 계통" .')
  })

  it('종류를 모르는 계통은 ex:Distribution_System 으로 둔다', () => {
    const m = structuredClone(mep)
    for (const s of m.systems) s.kind = null
    const ttl = modelToTTL(m)
    expect(ttl).toContain('a ex:Distribution_System ;')
    expect(ttl).not.toContain('ex:systemKind')
  })

  it('설비는 GeoJSON 에 Point 로, 좌표 없으면 null 로 들어간다', () => {
    const fc = storeyToGeoJSON(mep.storeys[0])
    const ahu = fc.features.find((f) => f.properties.name === 'AHU-1')!
    expect(ahu.geometry).toEqual({ type: 'Point', coordinates: [1, 1, 3.2] })

    const sensor = fc.features.find((f) => f.properties.name === 'TEMP-101-01')!
    expect(sensor.geometry).toBe(null)
  })

  it('물리존과 설비가 같은 파일에 들어간다', () => {
    const kinds = storeyToGeoJSON(mep.storeys[0]).features.map((f) => f.properties.kind)
    expect(kinds.filter((k) => k === 'space')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'equipment')).toHaveLength(6)
  })

  it('설비도 두 파일이 같은 id 로 이어진다', () => {
    const ttl = modelToTTL(mep)
    for (const f of storeyToGeoJSON(mep.storeys[0]).features) {
      expect(ttl).toContain(`ex:${escapeLocalName(String(f.id))} a `)
    }
  })

  it('흐름 방향을 아는 연결만 brick:feeds 로 나간다', () => {
    const ttl = modelToTTL(mep)
    const eq = (name: string) =>
      `ex:${escapeLocalName(mep.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!.id)}`

    // 공조기 → 덕트 → 토출구. ieum-pipeline 의 파서가 읽는 네 술어 중 하나다.
    //
    // **주어의 블록 안에 있어야 한다.** ttl.go 는 `ex:X a 클래스` 로 시작하는 블록만 읽는다.
    // 이 테스트가 한때 `ex:A brick:feeds ex:B .` 라는 독립 문장을 정답으로 박아 두어서,
    // 받는 쪽에서 흐름 연결이 전부 사라지는 것을 지켜 주지 못했다. 받는 쪽 규칙으로 다시 읽는
    // 검사는 read-export.test.ts 와 check:sample 의 "받는 쪽 규칙으로 다시 읽는가" 에 있다.
    const block = (name: string) => ttl.split('\n\n').find((b) => b.startsWith(`${eq(name)} a `))!
    expect(block('DUCT-01')).toContain(`brick:feeds ${eq('AT-101-01')} ;`)
    expect(ttl).not.toMatch(/^ex:\S+ brick:feeds/m)

    // 공조기 블록에는 덕트를 건너뛴 토출구도 적힌다. 덕트는 fso: 라 ttl.go 가 버리므로,
    // 이게 없으면 받는 쪽에서 공조기가 토출구에 닿지 못한다.
    // 그 토출구가 든 방도 적힌다 — 공조기가 급기를 보내는 방(담당 공간). 포트가 방향을 말한 길로만 닿은 방이다.
    const office = `ex:${escapeLocalName(mep.storeys.flatMap((s) => s.spaces).find((s) => s.longName === '사무실' || s.name === '사무실')!.id)}`
    expect(block('AHU-1')).toContain(`brick:feeds ${eq('DUCT-01')}, ${eq('AT-101-01')}, ${office} ;`)

    // 방향을 모르는 연결(SOURCEANDSINK 포트)은 한 줄도 나가지 않는다. 방향을 찍으면
    // 읽는 쪽이 BIM 이 말한 것과 우리가 찍은 것을 구별할 수 없다.
    expect(ttl.match(/brick:feeds/g)).toHaveLength(2)
    expect(ttl).not.toContain(`brick:feeds ${eq('AT-101-02')}`)
  })

  it('기하는 여전히 TTL 로 새지 않는다', () => {
    expect(modelToTTL(mep)).not.toMatch(/POLYGON|coordinates|wkt/i)
  })

  it('숫자를 담는 술어는 넓이·바닥 높이·용량뿐이다 — 좌표가 새 술어로 새어도 잡는다 (OE-INT-02)', () => {
    // 낱말(POLYGON·coordinates)만 막으면 `ex:x 12.3` 같은 숫자 술어로 새는 것을 못 잡는다. 숫자 값이 붙는 술어를 허용 목록으로 본다.
    const outside = (ttl: string) => [...numericPredicates(ttl)].filter((p) => !NUMERIC_OK.has(p))
    expect(outside(modelToTTL(mep))).toEqual([])
    expect(outside(modelToTTL(model))).toEqual([])
    // 숫자는 실제로 나간다 — 검사가 빈 손으로 통과하는 것이 아니다.
    expect([...numericPredicates(modelToTTL(model))]).toContain('ex:areaM2')
    // 좌표 줄을 끼워 넣으면 걸린다. 따옴표 안의 숫자(이름 "01.0001.00")는 값이 아니라 글자라 세지 않는다.
    const leaked = modelToTTL(mep).replace('a brick:Floor ;', ['a brick:Floor ;', '    ex:x 12.5 ;', '    rdfs:label "01.0001.00" ;'].join('\n'))
    expect(outside(leaked)).toEqual(['ex:x'])
  })
})

// 가진 BIM 에는 없지만 들어오면 파일 전체가 파서에서 떨어지는 경우들. 한 줄만 틀려도 받는 쪽은 아무것도 못 읽는다.
describe('내보내기가 깨지지 않는다', () => {
  it('목적어 없는 hasPart 를 쓰지 않는다 — 층이 없는 파일, 구성원이 없는 계통', () => {
    const m = structuredClone(mep)
    m.storeys = []
    m.systems[0].memberIds = []
    const ttl = modelToTTL(m)
    expect(ttl).not.toMatch(/brick:hasPart\s*[;.]/)
    // 블록마다 마침표로 끝난다.
    for (const block of ttl.split('\n\n').filter((b) => b.startsWith('ex:'))) expect(block.trimEnd().endsWith('.')).toBe(true)
  })

  it('이름의 CR 도 이스케이프한다 — 날것이면 Turtle 문자열이 끊긴다', () => {
    const m = structuredClone(model)
    m.storeys[0].spaces[0].longName = '회의실\r\n"A"\\B'
    const ttl = modelToTTL(m)
    expect(ttl).toContain('rdfs:label "회의실\\r\\n\\"A\\"\\\\B" ;')
    expect(ttl).not.toContain('\r')
  })

  it('층 파일 이름이 겹치지 않는다 — 이름이 같은 층, 특수문자만 다른 층', () => {
    const m = structuredClone(model)
    m.storeys[0].name = 'B1/B2'
    m.storeys[1].name = 'B1 B2'
    m.storeys.push({ ...structuredClone(m.storeys[1]), id: 'third' })
    const names = modelToGeoJSON(m).map((f) => f.fileName)
    expect(names).toEqual(['floor-B1_B2.geojson', 'floor-B1_B2-2.geojson', 'floor-B1_B2-3.geojson'])
  })

  it('GeoJSON 의 용량에 무엇의 양인지 붙인다', () => {
    const features = storeyToGeoJSON(mep.storeys[0]).features
    const props = (name: string) => features.find((f) => f.properties.name === name)!.properties
    expect(props('AHU-1')).toMatchObject({ capacity: 1.6667, capacityQuantity: 'airflow' })
    expect(props('AT-101-02')).toMatchObject({ capacity: null, capacityQuantity: null })
  })
})
