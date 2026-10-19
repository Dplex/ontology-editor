import { describe, expect, it } from 'vitest'
import { polygonArea, type Vec2 } from '../model'
import { trimZonesToRooms } from './trim'

// 성수(Factorial.idf + 건축 IFC)에서 본 어긋남 셋을 줄여 옮긴다(ADR-0072). 벽 두께 0.2m, 방은 벽 안쪽 면까지, IDF 존은 벽 중심선까지다.
const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const areaOf = (rings: Vec2[][]) => rings.reduce((n, r) => n + polygonArea(r), 0)
const bounds = (rings: Vec2[][]) => {
  const pts = rings.flat()
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]
}

// 방 둘 사이에 벽(x 5.0~5.2). 바깥벽도 0.2m 다.
const room1 = sq(0, 0, 5, 4)
const room2 = sq(5.2, 0, 10, 4)
const walls = [sq(5, -0.2, 5.2, 4.2), sq(-0.2, -0.2, 10.2, 0), sq(-0.2, 4, 10.2, 4.2), sq(-0.2, 0, 0, 4), sq(10, 0, 10.2, 4)]

describe('trimZonesToRooms — IDF 공조존 바닥을 BIM 방에 맞추기', () => {
  it('벽 중심선까지 그린 존은 벽 두께 띠를 깎아 방 경계가 된다', () => {
    const out = trimZonesToRooms(
      [
        { id: 'A', footprint: [sq(-0.1, -0.1, 5.1, 4.1)] },
        { id: 'B', footprint: [sq(5.1, -0.1, 10.1, 4.1)] },
      ],
      [room1, room2],
      walls,
    )
    expect(areaOf(out.get('A')!.footprint)).toBeCloseTo(20, 6)
    expect(bounds(out.get('A')!.footprint)).toEqual([0, 0, 5, 4])
    expect(areaOf(out.get('B')!.footprint)).toBeCloseTo(4.8 * 4, 6)
    expect(out.get('A')!.noRoomM2).toBe(0)
  })

  it('이웃 방으로 0.3m 삐친 몫은 그 방에서 가장 큰 조각의 존으로 넘긴다 — 두 존이 그 방을 나누는 것으로 보지 않는다', () => {
    const out = trimZonesToRooms(
      [
        { id: 'A', footprint: [sq(0, 0, 5.5, 4)] },
        { id: 'B', footprint: [sq(5.5, 0, 10, 4)] },
      ],
      [room1, room2],
      walls,
    )
    expect(areaOf(out.get('A')!.footprint)).toBeCloseTo(20, 6)
    expect(areaOf(out.get('B')!.footprint)).toBeCloseTo(4.8 * 4, 6)
    expect(bounds(out.get('B')!.footprint)).toEqual([5.2, 0, 10, 4])
  })

  it('방 안에서 어느 존도 안 덮은 얇은 틈은 그 방의 존이 메운다', () => {
    const out = trimZonesToRooms([{ id: 'A', footprint: [sq(0, 0, 4.7, 4)] }], [room1], walls)
    expect(areaOf(out.get('A')!.footprint)).toBeCloseTo(20, 6)
  })

  it('방이 없는 자리는 벽만 빼고 IDF 외곽선 그대로 두고 그 넓이를 알린다 — 존을 지우지 않는다', () => {
    // 위쪽(y 4.2~10)에는 방이 없다. BIM 이 매장 방을 안 그린 성수 1F 와 같다.
    const out = trimZonesToRooms([{ id: 'store', footprint: [sq(-0.1, -0.1, 5.1, 10)] }], [room1], walls)
    const t = out.get('store')!
    expect(t.noRoomM2).toBeCloseTo(5.2 * 5.8, 6)
    expect(areaOf(t.footprint)).toBeCloseTo(20 + 5.2 * 5.8, 6)
  })

  it('벽 없이 방 하나를 나눈 창가·안쪽 경계는 그대로다', () => {
    // 20×10 사무실 하나를 창가 띠(깊이 4.5m)와 안쪽이 나눈다.
    const office = sq(0, 0, 20, 10)
    const out = trimZonesToRooms(
      [
        { id: 'N', footprint: [sq(0, 5.5, 20, 10)] },
        { id: 'C', footprint: [sq(0, 0, 20, 5.5)] },
      ],
      [office],
      [],
    )
    expect(areaOf(out.get('N')!.footprint)).toBeCloseTo(90, 6)
    expect(areaOf(out.get('C')!.footprint)).toBeCloseTo(110, 6)
  })

  it('존의 띠만 닿은 방은 그 존에 붙지 않는다', () => {
    const out = trimZonesToRooms([{ id: 'A', footprint: [sq(0, 0, 5.4, 4)] }], [room1, room2], walls)
    expect(areaOf(out.get('A')!.footprint)).toBeCloseTo(20, 6)
  })
})
