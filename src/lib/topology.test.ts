import { describe, expect, it } from 'vitest'
import { inferConnections, neighbors, trace, type ElementPoints } from './topology'
import type { Connection } from './model'

/** x 축을 따라 놓인 배관 한 토막. 양 끝에 꼭짓점을 둔다. */
const pipe = (id: string, from: number, to: number, systems: string[] | null = ['A']): ElementPoints => ({
  id,
  points: new Float32Array([from, 0, 0, from, 0.05, 0, to, 0, 0, to, 0.05, 0]),
  systems,
})

describe('inferConnections', () => {
  it('끝이 맞닿은 두 토막을 방향 없는 형상 연결로 잇는다', () => {
    const out = inferConnections([pipe('p1', 0, 1), pipe('p2', 1, 2)])
    expect(out).toEqual([{ from: 'p1', to: 'p2', source: 'geometry', directed: false }])
  })

  it('허용 오차 밖이면 잇지 않는다', () => {
    expect(inferConnections([pipe('p1', 0, 1), pipe('p2', 1.01, 2)])).toEqual([])
  })

  it('칸 경계를 사이에 둔 두 점도 놓치지 않는다', () => {
    // 격자를 반올림으로만 맞추면 0.0049 와 0.0051 이 다른 칸에 떨어져 연결이 끊긴다.
    const out = inferConnections([pipe('p1', 0, 0.0049), pipe('p2', 0.0051, 1)], 0.005)
    expect(out).toHaveLength(1)
  })

  it('다른 계통끼리는 맞닿아도 잇지 않는다', () => {
    // 냉수관과 온수관이 붙어 달리는 곳에서 연결망이 섞이지 않게 한다.
    expect(inferConnections([pipe('cold', 0, 1, ['냉수']), pipe('hot', 1, 2, ['온수'])])).toEqual([])
  })

  it('계통을 모르는 요소는 거르지 않는다', () => {
    expect(inferConnections([pipe('p1', 0, 1, ['냉수']), pipe('p2', 1, 2, null)])).toHaveLength(1)
  })

  it('계통이 겹치면 잇는다 — 두 계통 사이의 설비(온수기)', () => {
    const heater = pipe('heater', 1, 2, ['냉수', '온수'])
    expect(inferConnections([pipe('cold', 0, 1, ['냉수']), heater, pipe('hot', 2, 3, ['온수'])])).toHaveLength(2)
  })

  it('한 쌍은 한 번만 적는다', () => {
    // 맞닿은 꼭짓점이 여럿이어도 연결은 하나다.
    expect(inferConnections([pipe('p1', 0, 1), pipe('p2', 1, 2)])).toHaveLength(1)
  })
})

const d = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true })
const u = (from: string, to: string): Connection => ({ from, to, source: 'geometry', directed: false })

describe('trace', () => {
  it('방향 있는 사슬에서 상류와 하류를 나눈다', () => {
    // 공조기 → 덕트 → 토출구
    const t = trace([d('ahu', 'duct'), d('duct', 'diffuser')], 'duct')
    expect([...t.upstream]).toEqual(['ahu'])
    expect([...t.downstream]).toEqual(['diffuser'])
    expect(t.linked.size).toBe(0)
  })

  it('끝까지 따라간다', () => {
    const t = trace([d('ahu', 'duct'), d('duct', 'diffuser')], 'ahu')
    expect([...t.downstream].sort()).toEqual(['diffuser', 'duct'])
  })

  it('방향 없는 연결로만 닿는 곳은 방향 모름으로 둔다', () => {
    const t = trace([u('a', 'b'), u('b', 'c')], 'a')
    expect(t.upstream.size).toBe(0)
    expect(t.downstream.size).toBe(0)
    expect([...t.linked].sort()).toEqual(['b', 'c'])
  })

  it('방향 없는 연결을 한 번이라도 거치면 그 뒤는 단정하지 않는다', () => {
    // a → b ─ c → d. c 와 d 가 b 의 하류인지는 b─c 방향을 모르면 알 수 없다.
    const t = trace([d('a', 'b'), u('b', 'c'), d('c', 'd')], 'a')
    expect([...t.downstream]).toEqual(['b'])
    expect([...t.linked].sort()).toEqual(['c', 'd'])
  })

  it('이어지지 않은 요소는 어디에도 없다', () => {
    const t = trace([d('a', 'b'), d('x', 'y')], 'a')
    expect([...t.downstream]).toEqual(['b'])
    expect(t.linked.has('x')).toBe(false)
  })

  it('고리가 있어도 끝난다', () => {
    const t = trace([d('a', 'b'), d('b', 'c'), d('c', 'a')], 'a')
    // 고리 위의 요소는 상류이자 하류라 어느 쪽으로도 단정하지 않는다.
    expect(t.upstream.size + t.downstream.size).toBe(0)
    expect([...t.linked].sort()).toEqual(['b', 'c'])
  })
})

describe('neighbors', () => {
  it('바로 붙은 이웃과 방향을 준다', () => {
    const list = neighbors([d('ahu', 'duct'), d('duct', 'diffuser'), u('duct', 'sensor')], 'duct')
    expect(list).toEqual([
      { id: 'ahu', relation: 'upstream', source: 'port' },
      { id: 'diffuser', relation: 'downstream', source: 'port' },
      { id: 'sensor', relation: 'linked', source: 'geometry' },
    ])
  })
})
