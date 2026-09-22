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
