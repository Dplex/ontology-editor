import { describe, expect, it } from 'vitest'
import type { Vec2 } from './model'
import { cutWall, intersectConvex, openingRect, subtractConvex } from './opening-cut'

const area = (ring: readonly Vec2[]) => {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(a / 2)
}
// 길이 6m · 두께 0.2m 벽(x 축을 따라), 닫힌 고리로 온다.
const WALL: Vec2[] = [
  [0, 0],
  [6, 0],
  [6, 0.2],
  [0, 0.2],
  [0, 0],
]
const window1 = { position: [3, 0.1, 0.9] as [number, number, number], width: 1.2, through: [0, 1] as Vec2 }

describe('openingRect', () => {
  it('벽을 따라 가로만큼, 벽 두께 쪽으로는 넉넉히 덮는 반시계 사각형이다', () => {
    const r = openingRect(window1)!
    const xs = r.map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(2.4)
    expect(Math.max(...xs)).toBeCloseTo(3.6)
    // 벽 두께(0.2)를 넘어 덮는다 — 창 형상의 두께가 문틀만이어도 벽이 다 뚫린다.
    expect(Math.min(...r.map((p) => p[1]))).toBeLessThan(0)
    expect(Math.max(...r.map((p) => p[1]))).toBeGreaterThan(0.2)
  })
  it('뚫는 방향이 반대여도 반시계다', () => {
    const r = openingRect({ ...window1, through: [0, -1] })!
    let s = 0
    for (let i = 0; i < 4; i++) s += r[i][0] * r[(i + 1) % 4][1] - r[(i + 1) % 4][0] * r[i][1]
    expect(s).toBeGreaterThan(0)
  })
  it('자리·가로·방향 중 하나라도 모르면 뚫지 않는다', () => {
    expect(openingRect({ ...window1, width: null })).toBeNull()
    expect(openingRect({ ...window1, through: undefined })).toBeNull()
    expect(openingRect({ ...window1, position: null })).toBeNull()
  })
})

describe('subtractConvex · intersectConvex', () => {
  it('벽에서 창 자리를 빼면 양옆 두 조각이고, 뺀 것과 겹친 것의 넓이 합이 원래 넓이다', () => {
    const rect = openingRect(window1)!
    const rest = subtractConvex(WALL, rect)
    const hit = intersectConvex(WALL, rect)!
    expect(rest).toHaveLength(2)
    expect(area(hit)).toBeCloseTo(1.2 * 0.2)
    expect(rest.reduce((n, r) => n + area(r), 0) + area(hit)).toBeCloseTo(6 * 0.2)
  })
  it('벽 끝에 걸친 문은 한쪽 조각만 남긴다', () => {
    const rect = openingRect({ ...window1, position: [0.3, 0.1, 0] })!
    const rest = subtractConvex(WALL, rect)
    expect(rest).toHaveLength(1)
    expect(area(rest[0])).toBeCloseTo((6 - 0.9) * 0.2)
  })
  it('벽에 닿지 않는 사각형은 아무것도 빼지 않는다', () => {
    const rect = openingRect({ ...window1, position: [10, 0.1, 0] })!
    expect(intersectConvex(WALL, rect)).toBeNull()
    expect(subtractConvex(WALL, rect).reduce((n, r) => n + area(r), 0)).toBeCloseTo(6 * 0.2)
  })
})

describe('cutWall', () => {
  const TOP = 1.2
  it('창은 창턱 아래만 벽으로 남고, 창 자리 위쪽은 비어 창이 보인다', () => {
    const slabs = cutWall([WALL], [{ rect: openingRect(window1)!, sill: 0.8, head: 2.0 }], TOP)
    const full = slabs.filter((s) => s.bottom === 0 && s.top === TOP)
    const under = slabs.filter((s) => s.top === 0.8)
    expect(full).toHaveLength(2)
    expect(under).toHaveLength(1)
    expect(area(under[0].ring)).toBeCloseTo(1.2 * 0.2)
    // 창 위(2.0)는 단면(1.2)보다 높아 남는 것이 없다.
    expect(slabs.some((s) => s.bottom > 0)).toBe(false)
  })
  it('바닥까지 내려온 문은 그 자리 벽을 다 뺀다', () => {
    const slabs = cutWall([WALL], [{ rect: openingRect(window1)!, sill: -0.1, head: 2.1 }], TOP)
    expect(slabs).toHaveLength(2)
    expect(slabs.reduce((n, s) => n + area(s.ring), 0)).toBeCloseTo((6 - 1.2) * 0.2)
  })
  it('단면보다 낮은 창은 창 위에도 벽이 남는다', () => {
    const slabs = cutWall([WALL], [{ rect: openingRect(window1)!, sill: 0.3, head: 0.9 }], TOP)
    expect(slabs.filter((s) => s.bottom === 0.9 && s.top === TOP)).toHaveLength(1)
    expect(slabs.filter((s) => s.bottom === 0 && s.top === 0.3)).toHaveLength(1)
  })
  it('단면보다 높이 난 창(고창)은 벽을 자르지 않는다', () => {
    const slabs = cutWall([WALL], [{ rect: openingRect(window1)!, sill: 1.6, head: 2.4 }], TOP)
    expect(slabs).toHaveLength(1)
  })
  it('창 둘을 차례로 자르면 세 조각 사이에 두 창턱이다', () => {
    const a = openingRect({ ...window1, position: [1.5, 0.1, 0.9] })!
    const b = openingRect({ ...window1, position: [4.5, 0.1, 0.9] })!
    const slabs = cutWall([WALL], [{ rect: a, sill: 0.8, head: 2 }, { rect: b, sill: 0.8, head: 2 }], TOP)
    expect(slabs.filter((s) => s.top === TOP)).toHaveLength(3)
    expect(slabs.filter((s) => s.top === 0.8)).toHaveLength(2)
    const volume = slabs.reduce((n, s) => n + area(s.ring) * (s.top - s.bottom), 0)
    expect(volume).toBeCloseTo(6 * 0.2 * TOP - 2 * 1.2 * 0.2 * (TOP - 0.8))
  })
})
