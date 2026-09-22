import { describe, expect, it } from 'vitest'
import { apply, compose, foldChain, fromAxisPlacement, IDENTITY } from './placement'
import type { Vec2 } from '../model'

const near = (p: Vec2, q: Vec2) => {
  expect(p[0]).toBeCloseTo(q[0], 9)
  expect(p[1]).toBeCloseTo(q[1], 9)
}

describe('fromAxisPlacement', () => {
  it('RefDirection 이 없으면 회전이 없다', () => {
    expect(fromAxisPlacement([3, 4, 0], null)).toEqual({ cos: 1, sin: 0, tx: 3, ty: 4 })
  })

  it('RefDirection (0,-1) 은 -90도 회전이다', () => {
    const t = fromAxisPlacement([0, 0, 0], [0, -1, 0])
    near(apply(t, [1, 0]), [0, -1])
  })

  it('길이가 0 인 방향 벡터는 회전 없음으로 두고 위치는 지킨다', () => {
    expect(fromAxisPlacement([5, 6, 0], [0, 0, 0])).toEqual({ cos: 1, sin: 0, tx: 5, ty: 6 })
  })
})

describe('compose', () => {
  // 사슬을 잘못된 순서로 접으면 여기서 걸린다. 회전과 이동이 둘 다 있어야 차이가 난다.
  it('바깥 변환이 안쪽 결과에 적용된다', () => {
    const inner = fromAxisPlacement([1, 0, 0], null)
    const outer = fromAxisPlacement([0, 0, 0], [0, 1, 0]) // +90도
    near(apply(compose(outer, inner), [0, 0]), [0, 1])
    // 순서를 뒤집으면 다른 점이 나온다.
    near(apply(compose(inner, outer), [0, 0]), [1, 0])
  })
})

describe('foldChain', () => {
  it('빈 사슬은 항등이다', () => {
    expect(foldChain([])).toEqual(IDENTITY)
  })

  it('FZK-Haus 의 Buero 배치를 실제 값으로 재현한다', () => {
    // 실측: space 21640 의 사슬은 [loc (0.3, 9.7) / refd (0,-1,0)] 위에 항등 둘이다.
    const chain = [
      fromAxisPlacement([0.3, 9.7, 0], [0, -1, 0]),
      fromAxisPlacement([0, 0, 0], [1, 0, 0]),
      fromAxisPlacement([0, 0, 0], [1, 0, 0]),
    ]
    const t = foldChain(chain)
    // 방의 국소 외곽선 [[0,0],[3.71,0],[3.71,3.5],[0,3.5]] 가 -90도 돌아 옮겨진다.
    near(apply(t, [0, 0]), [0.3, 9.7])
    near(apply(t, [3.71, 0]), [0.3, 9.7 - 3.71])
    near(apply(t, [3.71, 3.5]), [0.3 + 3.5, 9.7 - 3.71])
  })
})
