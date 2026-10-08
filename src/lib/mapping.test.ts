import { describe, expect, it } from 'vitest'
import { distanceToRing, interiorPoint, isSelfIntersecting, locate, pointInPolygon, SNAP } from './mapping'
import { polygonArea, type Space, type Vec2 } from './model'

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

describe('locate — 방이 겹친 자리', () => {
  // 병원 건축의 큰 대기실이 접수대를 품는다. 원본이 그렇게 겹쳐 있다(같은 층 52쌍).
  const room = (id: string, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: polygonArea(footprint), boundedBy: [] })
  const waiting = room('waiting', [[0, 0], [12, 0], [12, 12], [0, 12], [0, 0]])
  const reception = room('reception', [[2, 2], [5, 2], [5, 5], [2, 5], [2, 2]])

  it('가장 작은 방에 둔다 — 목록 순서와 상관없다', () => {
    // 첫 방을 고르던 때는 앞의 대기실로 갔다. BIM 이 말한 소속에 맞는 수가 가진 파일 전부에서 늘었다(check:sample).
    expect(locate([3, 3], [waiting, reception])).toBe('reception')
    expect(locate([3, 3], [reception, waiting])).toBe('reception')
  })

  it('겹치지 않은 자리는 큰 방이다', () => {
    expect(locate([8, 8], [waiting, reception])).toBe('waiting')
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

describe('locate — 외곽 상자로 먼 방 건너뛰기', () => {
  // 먼 방은 외곽 상자만 보고 건너뛴다. 상자 없이 방 전부를 훑던 판정과 답이 하나라도 다르면 소속이 조용히 바뀐다.
  // 틀리기 쉬운 자리는 상자 경계와 SNAP 경계라서, 점을 거기에 몰아 뽑는다.
  function reference(point: Vec2, spaces: readonly Space[], snap = SNAP): string | null {
    let inside: Space | null = null
    for (const space of spaces) if (pointInPolygon(point, space.footprint) && (!inside || space.areaM2 < inside.areaM2)) inside = space
    if (inside) return inside.id
    let best: string | null = null
    let bestDistance = snap
    for (const space of spaces) {
      if (space.footprint.length < 3) continue
      const d = distanceToRing(point, space.footprint)
      if (d <= bestDistance) {
        bestDistance = d
        best = space.id
      }
    }
    return best
  }
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const room = (id: string, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: polygonArea(footprint), boundedBy: [] })

  it('무작위 방 40개(겹치고 오목한 것 포함)에 점 2만 개 — 상자 없이 잰 것과 전부 같다', () => {
    const spaces: Space[] = []
    for (let i = 0; i < 40; i++) {
      const [x, y, w, h] = [rand() * 30, rand() * 30, 1 + rand() * 8, 1 + rand() * 8]
      const ring: Vec2[] = i % 3 === 0
        ? [[x, y], [x + w, y], [x + w, y + h / 2], [x + w / 2, y + h / 2], [x + w / 2, y + h], [x, y + h], [x, y]]
        : [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
      spaces.push(room(`r${i}`, ring))
    }
    let checked = 0
    for (let i = 0; i < 20_000; i++) {
      const s = spaces[Math.floor(rand() * spaces.length)]
      const [ax, ay] = s.footprint[Math.floor(rand() * (s.footprint.length - 1))]
      // 꼭짓점에서 0, ±SNAP, ±SNAP±1e-12 만큼 비킨 점과 아무 점을 섞는다.
      const offsets = [0, SNAP, -SNAP, SNAP + 1e-12, SNAP - 1e-12, (rand() - 0.5) * 0.3]
      const p: Vec2 = i % 4 === 3
        ? [rand() * 40, rand() * 40]
        : [ax + offsets[Math.floor(rand() * offsets.length)], ay + offsets[Math.floor(rand() * offsets.length)]]
      expect(locate(p, spaces)).toBe(reference(p, spaces))
      checked++
    }
    expect(checked).toBe(20_000)
  })

  it('외곽선을 새 배열로 갈아 끼우면 상자도 다시 잰다', () => {
    // 상자는 외곽선 배열마다 기억한다. 편집은 외곽선을 새 배열로 바꾼다(꼭짓점 옮기기·되돌리기).
    const r = room('r', RECT)
    expect(locate([6, 1], [r])).toBe(null)
    r.footprint = [[0, 0], [8, 0], [8, 3], [0, 3], [0, 0]]
    expect(locate([6, 1], [r])).toBe('r')
    r.footprint = [...RECT]
    expect(locate([6, 1], [r])).toBe(null)
  })
})

