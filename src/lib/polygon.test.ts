import { describe, expect, it } from 'vitest'
import { polygonArea, type Vec2 } from './model'
import { splitRing, unionRings } from './polygon'

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]

describe('splitRing — 물리존 나누기', () => {
  it('선 하나로 둘로 나누고 넓이 합을 지킨다', () => {
    const r = splitRing(rect(0, 0, 10, 4), [4, -1], [4, 5])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const areas = r.rings.map(polygonArea).sort((a, b) => a - b)
    expect(areas).toEqual([16, 24])
  })

  it('꼭짓점을 지나는 대각선도 나눈다', () => {
    const r = splitRing(rect(0, 0, 4, 4), [0, 0], [4, 4])
    expect(r.ok && r.rings.map(polygonArea)).toEqual([8, 8])
  })

  it('방을 가로지르지 않는 선은 거절한다', () => {
    expect(splitRing(rect(0, 0, 4, 4), [5, 0], [5, 4]).ok).toBe(false)
  })

  it('변을 따라가는 선은 거절한다', () => {
    expect(splitRing(rect(0, 0, 4, 4), [0, 0], [4, 0]).ok).toBe(false)
  })

  it('ㄷ자 방의 두 팔을 한 번에 자르면 거절한다 — 조각이 얇은 다리로 이어진다', () => {
    const u: Vec2[] = [[0, 0], [6, 0], [6, 4], [4, 4], [4, 1], [2, 1], [2, 4], [0, 4], [0, 0]]
    const r = splitRing(u, [-1, 3], [7, 3])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('셋 이상')
  })
})

describe('unionRings — 물리존 합치기', () => {
  it('변을 맞댄 두 방은 맞댄 변을 지운다', () => {
    const r = unionRings(rect(0, 0, 4, 3), rect(4, 0, 10, 3))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(polygonArea(r.ring)).toBeCloseTo(30)
    expect(r.ring).toHaveLength(5) // 꼭짓점 넷 + 닫는 점. 맞댄 변의 끝점은 한 줄 위라 빠진다.
    expect(r.bridged).toBe(false)
  })

  it('길이가 다른 변을 맞대도 합친다(ㄱ자가 된다)', () => {
    const r = unionRings(rect(0, 0, 4, 4), rect(4, 1, 8, 2))
    expect(r.ok && polygonArea(r.ring)).toBeCloseTo(20)
  })

  it('벽 두께만큼 떨어진 방은 벽 자리까지 합친다', () => {
    const r = unionRings(rect(0, 0, 4, 3), rect(4.2, 0, 10, 3))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.bridged).toBe(true)
    expect(polygonArea(r.ring)).toBeCloseTo(30)
  })

  it('한쪽이 더 긴 벽 너머 방도 합친다', () => {
    const r = unionRings(rect(0, 0, 4, 3), rect(4.2, -1, 10, 5))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 작은 방이 벽 자리(0.2 × 3)만큼 넓어져 붙는다.
    expect(polygonArea(r.ring)).toBeCloseTo(12 + 0.6 + 5.8 * 6)
  })

  it('품은 방을 합치면 큰 방 외곽선이다 — 대기실과 접수대', () => {
    const r = unionRings(rect(0, 0, 12, 12), rect(2, 2, 5, 5))
    expect(r.ok && polygonArea(r.ring)).toBe(144)
  })

  it('멀리 떨어진 방은 거절한다', () => {
    const r = unionRings(rect(0, 0, 4, 3), rect(6, 0, 10, 3))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('맞닿지 않습니다')
  })

  it('일부만 겹친 방은 거절한다', () => {
    expect(unionRings(rect(0, 0, 4, 3), rect(3, 1, 8, 2)).ok).toBe(false)
  })

  it('합쳐서 가운데가 비면 거절한다', () => {
    const c: Vec2[] = [[0, 0], [6, 0], [6, 6], [0, 6], [0, 4], [4, 4], [4, 2], [0, 2], [0, 0]]
    // ㄷ자의 파인 곳 오른쪽이 아니라 왼쪽 바깥에 막대를 대면 가운데 구멍이 생긴다.
    const r = unionRings(c, rect(-1, 0, 0, 6))
    expect(r.ok).toBe(false)
  })
})
