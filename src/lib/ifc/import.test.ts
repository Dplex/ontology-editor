import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc, numbers } from './import'
import { countOf, type Model } from '../model'
import { trace } from '../topology'

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
    expect(model.warnings.some((w) => w.includes('Structural'))).toBe(true)
  })

  it('명시적 false 와 속성 없음을 구별한다', () => {
    const walls = model.storeys.flatMap((s) => s.walls)
    expect(walls.find((w) => w.name === 'W-1F-01')?.loadBearing).toBe(true)
    expect(walls.find((w) => w.name === 'W-1F-02')?.loadBearing).toBe(false)
    expect(walls.find((w) => w.name === 'W-1F-03')?.loadBearing).toBe(null)
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
    expect(byName('AHU-1').capacity).toBe(6000)
    expect(byName('AT-101-01').capacity).toBe(900)
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
    expect(mep.warnings.some((w) => w.includes('좌표가 없어'))).toBe(true)
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
