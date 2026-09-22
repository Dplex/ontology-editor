import { describe, expect, it } from 'vitest'
import { isSelfIntersecting, pointInPolygon } from './mapping'
import type { Vec2 } from './model'

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
