import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './import'
import { countOf, type Model } from '../model'

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
      unplacedEquipment: 0,
      equipmentWithoutCapacity: 0,
      systems: 0,
      unlocatedEquipment: 0,
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
    expect(counts.equipment).toBe(5)
    expect(counts.systems).toBe(1)

    const classes = mep.storeys.flatMap((s) => s.equipment.map((e) => e.ifcClass)).sort()
    expect(classes).toEqual(['AirTerminal', 'AirTerminal', 'DuctSegment', 'Sensor', 'UnitaryEquipment'])
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
