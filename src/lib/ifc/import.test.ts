import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { anchorToGeometry, importIfc, numbers, UnreadableIfcError, type MeshMap } from './import'
import { countOf, type Equipment, type Model } from '../model'
import { trace } from '../topology'
import { requirementsReport } from '../requirements'
import { mergeModels } from '../merge'

// 픽스처는 손으로 쓴 최소 IFC4 다(fixtures/two-rooms.ifc). 무엇이 들어가면 무엇이 나오는지
// 파일 하나만 열어 보면 다 보이도록, 바깥에서 받아 온 큰 모델 대신 이걸 기준으로 삼는다.
// 실제 BIM 으로 맞춰 보는 것은 scripts/check-sample.ts 가 한다.
let model: Model

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const path = fileURLToPath(new URL('./fixtures/two-rooms.ifc', import.meta.url))
  model = importIfc(api, new Uint8Array(readFileSync(path)))
}, 60_000)

describe('importIfc', () => {
  it('스키마와 대지·건물 이름을 읽는다', () => {
    expect(model.schema).toBe('IFC4')
    expect(model.buildingName).toBe('PoC Building')
  })

  it('PRD #6 매핑표의 개수가 맞는다', () => {
    expect(countOf(model)).toEqual({
      storeys: 2,
      spaces: 3,
      walls: 4,
      doors: 1,
      windows: 2,
      loadBearingWalls: 1,
      unknownLoadBearingWalls: 2,
      // 건축만 있는 모델이다. 설비·계통이 0 인 것이 이 픽스처의 성질이다.
      equipment: 0,
      devices: 0,
      conduits: 0,
      unplacedEquipment: 0,
      equipmentWithoutCapacity: 0,
      systems: 0,
      unlocatedEquipment: 0,
      connections: 0,
      directedConnections: 0,
    })
  })

  it('층을 낮은 것부터 정렬한다', () => {
    expect(model.storeys.map((s) => [s.name, s.elevation])).toEqual([
      ['1F', 0],
      ['2F', 3],
    ])
  })

  it('id 는 IfcGlobalId 를 그대로 쓴다', () => {
    const meeting = model.storeys[0].spaces.find((s) => s.name === '101')
    expect(meeting?.id).toBe('0PoC$Space$Meeting$000')
  })

  // 픽스처의 한글 이름은 IFC 의 \\X2\\…\\X0\\ 인코딩으로 들어 있다. 여기서 한글이 나오면
  // 파서가 그걸 풀었다는 뜻이다. 국내 BIM 은 방 이름이 대부분 한글이라 이게 중요하다.
  it('LongName 을 사람이 부르는 이름으로 삼는다', () => {
    expect(model.storeys[0].spaces.map((s) => s.longName).sort()).toEqual(['복도', '회의실'])
  })

  it('방 분류(OmniClass)를 표준 분류 관계에서 읽고, 방 종류는 이름이 먼저다', () => {
    const byName = new Map(model.storeys.flatMap((s) => s.spaces).map((s) => [s.longName, s]))
    expect(byName.get('창고')).toMatchObject({ omniclass: '13-75 11 11', kind: 'storage', kindSource: 'dict' })
    // 분류는 사무실이라고 하지만 이름이 회의실이라고 더 좁게 말한다.
    expect(byName.get('회의실')).toMatchObject({ omniclass: '13-15 11 34 11', kind: 'conference', kindSource: 'dict' })
    expect(byName.get('복도')).toMatchObject({ omniclass: null, kind: 'hallway' })
  })
})

describe('배치 사슬', () => {
  const spaceNamed = (name: string) => model.storeys.flatMap((s) => s.spaces).find((s) => s.name === name)!

  it('이동만 있는 방은 그만큼 옮겨진다', () => {
    // 회의실은 (2,1) 에 놓인 4x3 방이다.
    const s = spaceNamed('101')
    expect(s.footprint[0]).toEqual([2, 1])
    expect(s.areaM2).toBeCloseTo(12, 9)
  })

  it('회전이 있는 방은 돌아간 자리에 놓인다', () => {
    // 복도는 (10,8) 에서 -90도 돌아간 6x2 방이다. 국소 (6,0) 이 세계 (10, 8-6) 으로 간다.
    const s = spaceNamed('102')
    expect(s.footprint[0][0]).toBeCloseTo(10, 9)
    expect(s.footprint[0][1]).toBeCloseTo(8, 9)
    expect(s.footprint[1][0]).toBeCloseTo(10, 9)
    expect(s.footprint[1][1]).toBeCloseTo(2, 9)
    expect(s.areaM2).toBeCloseTo(12, 9)
  })

  it('두 방이 서로 다른 자리에 있다', () => {
    // 사슬을 안 타면 모든 방이 원점에 겹쳐 쌓이는데, 넓이는 맞아서 눈치채기 어렵다.
    expect(spaceNamed('101').footprint[0]).not.toEqual(spaceNamed('102').footprint[0])
  })
})

describe('빠진 것을 조용히 넘기지 않는다', () => {
  it('FootPrint 가 없는 공간은 경고로 남는다', () => {
    const store = model.storeys[1].spaces[0]
    expect(store.footprint).toEqual([])
    expect(store.areaM2).toBe(0)
    expect(model.warnings.some((w) => w.includes('FootPrint'))).toBe(true)
  })

  it('Structural 속성이 없는 벽 수를 경고로 남긴다', () => {
    expect(model.warnings.some((w) => w.includes('LoadBearing'))).toBe(true)
  })

  it('명시적 false 와 속성 없음을 구별한다', () => {
    const walls = model.storeys.flatMap((s) => s.walls)
    expect(walls.find((w) => w.name === 'W-1F-01')?.loadBearing).toBe(true)
    expect(walls.find((w) => w.name === 'W-1F-02')?.loadBearing).toBe(false)
    expect(walls.find((w) => w.name === 'W-1F-03')?.loadBearing).toBe(null)
    // 외벽 여부(IsExternal)도 같은 모양이다. 선언이 없으면 모름이다(OE-OBJ-07).
    expect(walls.map((w) => [w.name, w.external])).toEqual(expect.arrayContaining([['W-1F-01', true], ['W-1F-02', false], ['W-1F-03', null]]))
  })
})

// --- 설비(MEP) ---------------------------------------------------------------
//
// 입력은 fixtures/mep.ifc 다. 공개 BIM 샘플 넷을 뒤져도 MEP 계통이 든 것이 없어서
// (전부 건축 모델이고, 설비처럼 보이는 것은 타월디스펜서·거울 같은 욕실 액세서리였다)
// "DT 가 쓸 만한 BIM" 이 무엇을 담아야 하는지를 픽스처로 직접 적었다.
// 고객사에 요구할 최소 사양이 이 파일이다.
describe('MEP 임포트', () => {
  let mep: Model

  beforeAll(async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const path = fileURLToPath(new URL('./fixtures/mep.ifc', import.meta.url))
    mep = importIfc(api, new Uint8Array(readFileSync(path)))
  }, 60_000)

  const byName = (name: string) => mep.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!

  it('설비를 종류별로 읽는다', () => {
    const counts = countOf(mep)
    expect(counts.equipment).toBe(6)
    expect(counts.systems).toBe(1)

    const classes = mep.storeys.flatMap((s) => s.equipment.map((e) => e.ifcClass)).sort()
    expect(classes).toEqual([
      'AirTerminal',
      'AirTerminal',
      'DuctSegment',
      'LightFixture',
      'Sensor',
      'UnitaryEquipment',
    ])

    // 역할은 IFC 클래스 계층에서 읽는다. 덕트 한 토막만 도관이고 나머지 다섯은 기기다.
    expect(counts.devices).toBe(5)
    expect(counts.conduits).toBe(1)
    expect(byName('AHU-1').role).toBe('conversion')
    expect(byName('AT-101-01').role).toBe('terminal')
    expect(byName('DUCT-01').role).toBe('segment')
    expect(byName('TEMP-101-01').role).toBe('sensing')
  })

  it('층이 아니라 공간에 매달린 설비도 읽는다', () => {
    // 층만 보면 이 설비가 0 으로 읽힌다. Duplex 의 COBie 판본이 133대를 이렇게 담았다.
    const light = byName('LIGHT-101-01')
    expect(light).toBeDefined()
    expect(mep.storeys[0].equipment).toContain(light)
  })

  it('BIM 이 말한 소속이 좌표 판정을 이긴다', () => {
    // 이 조명은 좌표가 사무실 밖(50,50)인데 IFC 가 사무실에 담아 두었다. 설계자가 정한
    // 소속이 좌표보다 정확하므로 BIM 쪽을 따른다.
    const light = byName('LIGHT-101-01')
    expect(light.position).toEqual([50, 50, 2.7])
    expect(light.spaceId).toBe(mep.storeys[0].spaces[0].id)
    expect(light.spaceSource).toBe('bim')
  })

  it('좌표로 판정한 것은 출처가 computed 다', () => {
    expect(byName('AHU-1').spaceSource).toBe('computed')
    expect(byName('TEMP-101-01').spaceSource).toBe(null)
  })

  it('설비 좌표를 x·y·z 로 읽는다', () => {
    // 천장 토출구는 높이가 의미를 갖는다(PRD #13 설치면).
    expect(byName('AT-101-01').position).toEqual([3, 4, 2.7])
    expect(byName('AHU-1').position).toEqual([1, 1, 3.2])
  })

  it('좌표 없는 설비는 원점이 아니라 null 이다', () => {
    // 0,0,0 으로 채우면 "모르는 것" 이 "원점에 있는 것" 으로 바뀌어 조용히 틀린다.
    expect(byName('TEMP-101-01').position).toBe(null)
    expect(countOf(mep).unplacedEquipment).toBe(1)
  })

  it('용량 파라미터를 읽고, 없는 것은 null 로 둔다', () => {
    expect(byName('AHU-1').capacity).toBe(1.6667)
    expect(byName('AHU-1').capacityProperty).toBe('NominalAirFlowRate')
    // 타입 객체의 표준 Pset, 범위 값(설정값이 없어 위 끝)
    expect(byName('AT-101-01').capacity).toBe(0.25)
    expect(byName('AT-101-01').capacityProperty).toBe('AirFlowrateRange')
    expect(byName('AT-101-02').capacity).toBe(null)
  })

  it('계통으로 설비를 묶는다', () => {
    expect(mep.systems[0].name).toBe('AHU-1 급기 계통')
    expect(mep.systems[0].memberIds).toHaveLength(4)
    // 공조기와 토출구가 같은 계통에 있어야 담당 관계를 판정할 수 있다(PRD #11).
    expect(byName('AHU-1').systemId).toBe(mep.systems[0].id)
    expect(byName('AT-101-01').systemId).toBe(mep.systems[0].id)
    expect(byName('TEMP-101-01').systemId).toBe(null)
  })

  it('계통 그룹에 든 포트는 구성원으로 받지 않는다 (Revit, 성수)', async () => {
    // 성수 기계는 계통 그룹에 기기와 그 기기의 포트를 같이 넣었다. 포트를 받으면 TTL 의 hasPart 가 없는 주어를 가리킨다.
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const path = fileURLToPath(new URL('./fixtures/mep.ifc', import.meta.url))
    const text = readFileSync(path, 'utf8').replace('(#33,#43,#47,#53),$,#70)', '(#33,#43,#47,#53,#80,#82),$,#70)')
    expect(text).toContain('#53,#80,#82')
    const withPorts = importIfc(api, new TextEncoder().encode(text))
    expect(withPorts.systems[0].memberIds).toEqual(mep.systems[0].memberIds)
  })

  it('포트 연결을 읽고, SOURCE→SINK 를 흐름 방향으로 쓴다', () => {
    // 공조기 → 덕트 → 토출구. 이 방향이 있어야 상류·하류를 물을 수 있다(PRD #11).
    const ahu = byName('AHU-1')
    const duct = byName('DUCT-01')
    const at1 = byName('AT-101-01')

    const directed = mep.connections.filter((c) => c.directed)
    expect(directed.map((c) => [c.from, c.to])).toEqual([
      [ahu.id, duct.id],
      [duct.id, at1.id],
    ])
    expect(directed.every((c) => c.source === 'port')).toBe(true)
  })

  it('SOURCEANDSINK 는 방향 없는 연결로 둔다', () => {
    // Revit 이 배관·피팅 포트를 이렇게 내보낸다. 이어진 것만 알고 흐름은 모른다.
    // 여기서 방향을 지어내면 온톨로지의 feeds 가 거짓이 된다.
    const undirected = mep.connections.filter((c) => !c.directed)
    expect(undirected).toHaveLength(1)
    expect([undirected[0].from, undirected[0].to].sort()).toEqual(
      [byName('DUCT-01').id, byName('AT-101-02').id].sort(),
    )
    expect(undirected[0].source).toBe('port')
  })

  it('상류와 하류를 따라간다', () => {
    const t = trace(mep.connections, byName('DUCT-01').id)
    expect([...t.upstream]).toEqual([byName('AHU-1').id])
    expect([...t.downstream]).toEqual([byName('AT-101-01').id])
    // 방향 없는 포트로 붙은 토출구는 어느 쪽인지 모르는 채로 남는다.
    expect([...t.linked]).toEqual([byName('AT-101-02').id])
  })

  it('좌표로 소속 물리존을 판정한다', () => {
    // BIM 은 "이 공조기가 사무실에 있다" 는 말을 하지 않는다. 그 관계는 우리가 만든다.
    const office = mep.storeys[0].spaces[0]
    expect(byName('AHU-1').spaceId).toBe(office.id)
    expect(byName('AT-101-01').spaceId).toBe(office.id)
    // 좌표가 없으면 소속도 없다. 원점으로 채워 사무실에 넣어 버리면 안 된다.
    expect(byName('TEMP-101-01').spaceId).toBe(null)
    expect(countOf(mep).unlocatedEquipment).toBe(1)
  })

  it('빠진 것을 경고로 남긴다', () => {
    expect(mep.warnings.some((w) => w.includes('좌표가 없습니다'))).toBe(true)
    expect(mep.warnings.some((w) => w.includes('용량 파라미터가 없습니다'))).toBe(true)
  })
})

// --- F4·F5·F6: 벽 두께, 개구부 치수와 소속, 공간 경계 ---------------------------
describe('벽 두께 (F4)', () => {
  const wall = (name: string) => model.storeys.flatMap((s) => s.walls).find((w) => w.name === name)!

  it('재료층 두께를 합해서 읽는다', () => {
    // IFC 는 벽 두께를 기하가 아니라 재료 구성에 둔다. 형상만 봐서는 알 수 없다.
    expect(wall('W-1F-01').thickness).toBeCloseTo(0.2, 9)
  })

  it('여러 층이면 합이 두께다', () => {
    // 석고보드 100mm + 단열재 50mm = 150mm.
    expect(wall('W-1F-02').thickness).toBeCloseTo(0.15, 9)
  })

  it('재료 구성이 없으면 null 이다', () => {
    // 0 으로 채우면 두께 없는 벽과 모르는 벽이 섞인다.
    expect(wall('W-1F-03').thickness).toBe(null)
  })
})

describe('개구부 (F4 · F5 · F15)', () => {
  const opening = (name: string) => model.storeys.flatMap((s) => s.openings).find((o) => o.name === name)!

  it('치수를 읽는다', () => {
    expect(opening('D-1F-01').width).toBeCloseTo(0.9, 9)
    expect(opening('D-1F-01').height).toBeCloseTo(2.1, 9)
  })

  it('어느 벽에 뚫렸는지 두 단계를 타고 찾는다', () => {
    // RelVoids 가 벽에 구멍을 내고 RelFills 가 그 구멍을 채운다. 한 단계만 보면 안 이어진다.
    const walls = model.storeys.flatMap((s) => s.walls)
    expect(opening('D-1F-01').wallId).toBe(walls.find((w) => w.name === 'W-1F-01')!.id)
    expect(opening('WD-1F-01').wallId).toBe(walls.find((w) => w.name === 'W-1F-02')!.id)
  })

  it('관계가 없는 개구부는 null 이다', () => {
    expect(opening('WD-2F-01').wallId).toBe(null)
  })

  it('문은 지나갈 수 있고 창문은 못 한다', () => {
    expect(opening('D-1F-01').passable).toBe(true)
    expect(opening('WD-1F-01').passable).toBe(false)
  })
})

describe('공간 경계 (F6)', () => {
  it('물리존을 둘러싼 부재를 BIM 에서 그대로 받는다', () => {
    // 기하 연산으로 유추하지 않는다. IfcRelSpaceBoundary 가 직접 말해 준다.
    const meeting = model.storeys[0].spaces.find((s) => s.name === '101')!
    const walls = model.storeys.flatMap((s) => s.walls)
    const w1 = walls.find((w) => w.name === 'W-1F-01')!
    const w2 = walls.find((w) => w.name === 'W-1F-02')!

    expect(meeting.boundedBy).toContain(w1.id)
    expect(meeting.boundedBy).toContain(w2.id)
  })

  it('같은 부재가 여러 면으로 걸려도 한 번만 센다', () => {
    // 한 벽이 공간의 여러 면을 이룰 수 있다. 목록이 중복되면 영향 범위가 부풀려진다.
    const meeting = model.storeys[0].spaces.find((s) => s.name === '101')!
    expect(new Set(meeting.boundedBy).size).toBe(meeting.boundedBy.length)
    expect(meeting.boundedBy).toHaveLength(2)
  })

  it('부재가 없는 경계는 세지 않는다', () => {
    // 바깥 공기에 면한 경계다. 경계가 아니라 열린 면이라서 부재 목록에 들어가면 안 된다.
    const meeting = model.storeys[0].spaces.find((s) => s.name === '101')!
    expect(meeting.boundedBy.every((id) => id !== '')).toBe(true)
  })
})

// web-ifc 가 스키마에 따라 숫자를 다르게 준다. IFC4 는 IfcReal 객체로 감싸고 IFC2x3 은
// 맨 숫자로 준다. 한쪽만 맞춰 두면 **오류 없이 회전만 조용히 사라진다** — 방이 안 돌아간
// 채로 놓이는데 넓이는 그대로라 숫자만 봐서는 안 보인다. Duplex 세 판본이 이 상태였다.
describe('스키마마다 다른 숫자 표현', () => {
  it('싸여 있든 아니든 읽는다', () => {
    expect(numbers([0, 0, 1])).toEqual([0, 0, 1])
    expect(numbers([{ value: 0 }, { value: -1 }])).toEqual([0, -1])
  })

  it('숫자가 아닌 것이 섞이면 통째로 버린다', () => {
    // 일부만 읽어 내면 (1, undefined) 같은 반쪽 벡터가 만들어져서, 회전이 엉뚱하게 잡힌다.
    // 모르는 것은 모르는 채로 둬야 호출부가 기본값으로 떨어진다.
    expect(numbers([1, {}])).toBeNull()
    expect(numbers([1, null])).toBeNull()
    expect(numbers(undefined)).toBeNull()
  })
})

describe('배치점이 형상에서 떨어진 설비', () => {
  // 3D 좌표(x, 높이, -y)로 된 상자 메시. IFC 평면에서 x 4..6, y 2..3, 높이 2.5..2.8 이다.
  const box = (): MeshMap =>
    new Map([
      [
        'duct',
        {
          positions: new Float32Array([4, 2.5, -2, 6, 2.5, -2, 6, 2.8, -3, 4, 2.8, -3]),
          normals: new Float32Array(12),
          indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        },
      ],
    ])
  const duct = (position: Equipment['position']): Equipment => ({
    id: 'duct',
    name: 'duct',
    ifcClass: 'FlowSegment',
    role: 'segment',
    position,
    capacity: null,
    capacityProperty: null,
    systemId: null,
    spaceId: null,
    spaceSource: null,
  })

  it('층 원점에 찍힌 배치점은 형상 중심으로 바꾼다', () => {
    // Revit IFC2x3 의 덕트 구간이 이렇다. 형상은 제자리인데 배치점만 (0,0) 이다.
    const e = duct([0, 0, 0])
    expect(anchorToGeometry([e], box())).toBe(1)
    expect(e.position![0]).toBeCloseTo(5)
    expect(e.position![1]).toBeCloseTo(2.5)
    expect(e.position![2]).toBeCloseTo(2.65)
  })

  it('형상 가까이 있는 배치점은 그대로 둔다', () => {
    // 천장 설비의 삽입점이 몸체 윗면에 조금 떠 있는 정도는 정상이다.
    const e = duct([4.2, 2.1, 3.1])
    expect(anchorToGeometry([e], box())).toBe(0)
    expect(e.position).toEqual([4.2, 2.1, 3.1])
  })

  it('좌표가 없는 설비는 형상이 있어도 채우지 않는다', () => {
    // 배치가 없는 요소의 형상은 국소 좌표라 그 중심도 믿을 수 없다. "모름" 은 "모름" 으로 둔다.
    const e = duct(null)
    expect(anchorToGeometry([e], box())).toBe(0)
    expect(e.position).toBe(null)
  })
})

describe('구문이 깨진 파일', () => {
  it('web-ifc 가 못 연 파일은 이유를 말하며 멈춘다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    // Duplex COBie 판본 셋이 이렇게 깨져 있었다. 피트·인치 표기의 작은따옴표를 '' 로 안 바꿔서
    // 문자열이 6' 에서 끝나고, 뒤의 " 를 파서가 이진값으로 읽다가 파일 전체를 거부한다.
    const bytes = new TextEncoder().encode(
      [
        `ISO-10303-21;`,
        `HEADER;`,
        `FILE_DESCRIPTION((''),'2;1');`,
        `FILE_NAME('','',(''),(''),'','','');`,
        `FILE_SCHEMA(('IFC4'));`,
        `ENDSEC;`,
        `DATA;`,
        `#1=IFCLABEL('Atherton 6'8" Smooth');`,
        `ENDSEC;`,
        `END-ISO-10303-21;`,
      ].join('\n'),
    )
    // 확인하지 않던 시절에는 한참 뒤 "Cannot read properties of undefined" 로 죽었다.
    expect(() => importIfc(api, bytes)).toThrow(UnreadableIfcError)
    expect(() => importIfc(api, bytes)).toThrow(/작은따옴표/)
  })

  it('빈 파일과 STEP 이 아닌 파일은 여는 순간 이유를 말한다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const enc = (t: string) => new TextEncoder().encode(t)
    expect(() => importIfc(api, new Uint8Array())).toThrow(/빈 파일/)
    expect(() => importIfc(api, enc('hello, not a model'))).toThrow(/IFC\(STEP\) 파일이 아닙니다/)
    // 머리말 첫 줄만 흉내 낸 파일. 예전에는 web-ifc 안쪽에서 "Cannot read properties of undefined" 로 죽었다.
    expect(() => importIfc(api, enc('ISO-10303-21;\nHEADER;\nthis is not ifc\n'))).toThrow(/FILE_SCHEMA/)
  })
})

// 입력은 fixtures/proxy.ifc 다. Revit 이 공조기·FCU 를 IfcBuildingElementProxy 로 내보낸 경우를 줄였다.
describe('Proxy 로 들어온 설비', () => {
  let proxy: Model

  beforeAll(async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const path = fileURLToPath(new URL('./fixtures/proxy.ifc', import.meta.url))
    proxy = importIfc(api, new Uint8Array(readFileSync(path)))
  }, 60_000)

  const byName = (prefix: string) => proxy.storeys.flatMap((s) => s.equipment).find((e) => e.name.startsWith(prefix))

  it('포트가 있는 Proxy 를 설비로 받고, 이름으로 종류와 역할을 붙인다', () => {
    expect(byName('FCU3')).toMatchObject({ ifcClass: 'BuildingElementProxy', kind: 'fcu', role: 'conversion', objectType: 'FCU3:FCU3' })
  })

  it('포트가 없어도 이름이 사전에 있으면 받는다(관제점 후보)', () => {
    expect(byName('Security_Camera')).toMatchObject({ kind: 'camera', role: 'sensing' })
  })

  it('포트도 없고 이름도 모르는 Proxy 는 받지 않는다', () => {
    // 휠스톱 같은 건축 부재를 설비로 세면 대수가 부푼다.
    expect(byName('RThisWheelStops')).toBeUndefined()
    expect(countOf(proxy).equipment).toBe(4)
  })

  it('계통 종류를 ObjectType 에서 읽는다', () => {
    expect(proxy.systems[0]).toMatchObject({ name: 'Supply Air 1', kind: 'supply_air' })
  })

  it('SOURCEANDSINK 뿐인 연결에 규칙 방향을 주되, 포트 방향으로 섞지 않는다', () => {
    expect(proxy.connections.every((c) => !c.directed)).toBe(true)
    const fcu = byName('FCU3')!.id
    const duct = byName('Rectangular Duct')!.id
    const diffuser = byName('Supply Diffuser')!.id
    const arrows = proxy.connections.map((c) => [c.inferred?.from, c.inferred?.to])
    expect(arrows).toContainEqual([fcu, duct])
    expect(arrows).toContainEqual([duct, diffuser])
    expect(proxy.warnings.some((w) => w.includes('Proxy(IfcBuildingElementProxy) 3개 중 2개를 설비로 읽었습니다'))).toBe(true)
  })

  // OE-BIM-13 "Proxy 수 리포트". 읽은 것만 세면 빠뜨린 설비가 보이지 않는다 — 파일의 전체와 읽지 않은 것(이름 예)까지 센다.
  it('파일의 Proxy 를 전부 세고, 읽지 않은 것을 이름과 함께 경고·요구사항 R23 에 적는다', () => {
    expect(proxy.facts?.proxies).toEqual({ total: 3, ported: 1, named: 1, louvers: 0, skipped: ['RThisWheelStops850:850'] })
    const warning = proxy.warnings.find((w) => w.startsWith('Proxy('))!
    expect(warning).toContain('나머지 1개는 포트도 없고 이름도 사전에 없어 건축 부재로 보고 읽지 않았습니다(예: RThisWheelStops850:850)')
    const r23 = requirementsReport(proxy).find((r) => r.id === 'R23')!
    // 기기 셋(덕트는 빼고) 중 Proxy 로 들어온 둘이 다른 자리다.
    expect(r23.counts).toEqual({ standard: 1, elsewhere: 2, of: 3 })
    expect(r23.note).toContain('파일의 Proxy 3개 중 1개는 포트도 이름도 없어 건축 부재로 보고 읽지 않았습니다')
    // 합치면 두 파일의 Proxy 를 더한다.
    const twice = mergeModels(proxy, structuredClone(proxy)).model
    expect(twice.facts?.proxies).toMatchObject({ total: 6, ported: 2, named: 2, skipped: ['RThisWheelStops850:850'] })
  })
})

describe('피처 단위로 골라 읽기 (벽·문·창)', () => {
  let api: WebIFC.IfcAPI
  const bytes = () => new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/two-rooms.ifc', import.meta.url))))
  beforeAll(async () => {
    api = new WebIFC.IfcAPI()
    await api.Init()
  }, 60_000)

  it('끈 피처는 모델에 넣지 않고, 읽지 않았다고 적는다', () => {
    const m = importIfc(api, bytes(), { walls: false, windows: false })
    const c = countOf(m)
    expect({ walls: c.walls, doors: c.doors, windows: c.windows, spaces: c.spaces }).toEqual({ walls: 0, doors: 1, windows: 0, spaces: 3 })
    expect(m.skipped).toEqual(['walls', 'windows'])
    // 벽 경고(두께·내력)도 나오지 않는다. 읽지 않은 것을 "없다" 고 말하지 않는다.
    expect(m.warnings.some((w) => w.includes('벽'))).toBe(false)
  })

  it('요구사항 보고서는 읽지 않은 피처를 "없음" 이 아니라 잴 수 없음으로 둔다', () => {
    const rows = requirementsReport(importIfc(api, bytes(), { walls: false }))
    expect(rows.find((r) => r.id === 'R22')?.state).toBe('unmeasured')
    expect(rows.find((r) => r.id === 'R4')?.state).toBe('unmeasured')
    const all = requirementsReport(importIfc(api, bytes()))
    expect(all.find((r) => r.id === 'R22')?.state).not.toBe('unmeasured')
  })

  it('기본은 다 읽는다', () => {
    expect(importIfc(api, bytes()).skipped).toBeUndefined()
  })
})
