import { describe, expect, it } from 'vitest'
import { interiorPoint, isSelfIntersecting, locate, pointInPolygon, SNAP } from './mapping'
import type { Space, Vec2 } from './model'

// 4 x 3 직사각형. 왼쪽 아래가 (0,0) 이다.
const RECT: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
  [0, 0],
]

// ㄱ 자 방. 오목한 모양에서 광선 교차가 제대로 도는지 본다.
const L_SHAPE: Vec2[] = [
  [0, 0],
  [4, 0],
  [4, 2],
  [2, 2],
  [2, 4],
  [0, 4],
  [0, 0],
]

describe('pointInPolygon', () => {
  it('안에 있는 점을 찾는다', () => {
    expect(pointInPolygon([2, 1.5], RECT)).toBe(true)
  })

  it('밖에 있는 점을 거른다', () => {
    expect(pointInPolygon([5, 1.5], RECT)).toBe(false)
    expect(pointInPolygon([2, 4], RECT)).toBe(false)
    expect(pointInPolygon([-0.1, 1.5], RECT)).toBe(false)
  })

  it('오목한 방의 파인 자리는 밖이다', () => {
    // (3,3) 은 ㄱ 자의 바깥쪽 빈 곳이다. 볼록 껍질로 판정하면 여기서 틀린다.
    expect(pointInPolygon([1, 1], L_SHAPE)).toBe(true)
    expect(pointInPolygon([3, 1], L_SHAPE)).toBe(true)
    expect(pointInPolygon([3, 3], L_SHAPE)).toBe(false)
  })

  it('꼭짓점 높이를 지나는 수평선에서 두 번 세지 않는다', () => {
    // y=0 이 두 꼭짓점을 지난다. 교차를 두 번 세면 안팎이 뒤집힌다.
    expect(pointInPolygon([2, 0.0001], RECT)).toBe(true)
    expect(pointInPolygon([2, -0.0001], RECT)).toBe(false)
  })

  it('점이 세 개 미만이면 밖이다', () => {
    // FootPrint 를 못 읽은 공간이 이렇게 들어온다. 예외를 던지는 대신 아무도 안 담는다.
    expect(pointInPolygon([0, 0], [])).toBe(false)
  })
})

describe('isSelfIntersecting', () => {
  it('보통 방은 교차하지 않는다', () => {
    expect(isSelfIntersecting(RECT)).toBe(false)
    expect(isSelfIntersecting(L_SHAPE)).toBe(false)
  })

  it('나비 모양은 교차한다', () => {
    // 두 꼭짓점을 엇갈리게 이으면 8자가 된다. 넓이도 안팎 판정도 뜻을 잃는다.
    const bowtie: Vec2[] = [
      [0, 0],
      [4, 4],
      [4, 0],
      [0, 4],
      [0, 0],
    ]
    expect(isSelfIntersecting(bowtie)).toBe(true)
  })

  it('꼭짓점이 셋 이하면 교차할 수 없다', () => {
    expect(isSelfIntersecting([[0, 0], [1, 0], [0, 1], [0, 0]])).toBe(false)
  })
})

describe('locate — 벽면에 붙은 설비', () => {
  const room = (id: string, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: 0, boundedBy: [] })
  // 두 방 사이에 0.24m 칸막이벽이 있다. 왼쪽 방 외곽선은 x=4, 오른쪽 방은 x=4.24 부터다.
  const left = room('left', RECT)
  const right = room('right', RECT.map(([x, y]) => [x + 4.24, y] as Vec2))

  it('안에 든 점은 그 방이다', () => {
    expect(locate([2, 1], [left, right])).toBe('left')
  })

  it('외곽선 바로 위의 점은 그 방에 붙인다', () => {
    // 콘센트의 삽입점이 정확히 벽면에 있다. 광선 교차는 이 점을 밖이라 할 수 있다.
    expect(locate([4, 1.5], [left, right])).toBe('left')
    expect(locate([4 + SNAP * 0.9, 1.5], [left, right])).toBe('left')
  })

  it('벽 반대쪽 방으로 넘어가지 않는다', () => {
    // 오른쪽 방 벽면에 붙은 콘센트는 오른쪽이다. 가까운 쪽을 고른다.
    expect(locate([4.24, 1.5], [left, right])).toBe('right')
  })

  it('SNAP 밖은 어느 방에도 붙이지 않는다', () => {
    // 벽 한가운데(두 면에서 각각 0.12m). 어느 방이라고 말할 근거가 없다.
    expect(locate([4.12, 1.5], [left, right])).toBe(null)
    expect(locate([20, 1.5], [left, right])).toBe(null)
  })
})

describe('interiorPoint', () => {
  it('볼록한 방은 넓이 중심이다', () => {
    expect(interiorPoint(RECT)).toEqual([2, 1.5])
  })

  it('ㄷ 자 방은 넓이 중심이 파인 자리에 떨어져도 안쪽 점을 준다', () => {
    // 넓이 중심은 (3, 1.83) — 가운데 파인 자리라 방 밖이다.
    const U: Vec2[] = [[0, 0], [6, 0], [6, 4], [4, 4], [4, 1], [2, 1], [2, 4], [0, 4], [0, 0]]
    expect(pointInPolygon([3, 11 / 6], U)).toBe(false)
    const p = interiorPoint(U)!
    expect(pointInPolygon(p, U)).toBe(true)
  })

  it('외곽선이 없으면 null 이다', () => {
    expect(interiorPoint([])).toBe(null)
  })
})
