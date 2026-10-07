import { describe, expect, it } from 'vitest'
import { connectGaps, deviceFlows, findGaps, inferConnections, neighbors, trace, traceBySystem, type ElementPoints } from './topology'
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
    expect(out).toEqual([{ from: 'p1', to: 'p2', source: 'geometry', directed: false, tolerance: 0.005 }])
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

describe('findGaps', () => {
  it('이어진 요소는 결손이 아니다', () => {
    const els = [pipe('p1', 0, 1), pipe('p2', 1, 2)]
    expect(findGaps(els, inferConnections(els))).toEqual([])
  })

  it('오차 밖이지만 가까우면 2차 결손이다 — 오차를 키우면 붙는다', () => {
    // 20mm 떨어져 있다. 기본 허용 오차 5mm 로는 안 붙지만 reach 50mm 안에는 든다.
    const els = [pipe('p1', 0, 1), pipe('p2', 1.02, 2)]
    const gaps = findGaps(els, inferConnections(els))
    expect(gaps.map((g) => g.kind)).toEqual(['derived', 'derived'])
    expect(gaps[0].nearest).toBeCloseTo(0.02, 6)
  })

  it('주변에 아무것도 없으면 1차 결손이다 — 모델을 다시 그려야 한다', () => {
    const els = [pipe('p1', 0, 1), pipe('far', 10, 11)]
    const gaps = findGaps(els, inferConnections(els))
    expect(gaps.map((g) => [g.id, g.kind, g.nearest])).toEqual([
      ['p1', 'primary', null],
      ['far', 'primary', null],
    ])
  })

  it('가까워도 계통이 다르면 1차 결손이다', () => {
    // 오차를 키워도 계통이 다르면 어차피 안 잇는다. 2차 결손이라 부르면 "오차 문제" 라고
    // 잘못 말하는 것이 된다.
    const els = [pipe('cold', 0, 1, ['냉수']), pipe('hot', 1.02, 2, ['온수'])]
    expect(findGaps(els, inferConnections(els)).map((g) => g.kind)).toEqual(['primary', 'primary'])
  })
})

describe('connectGaps', () => {
  it('고립된 요소를 실제 거리로 이어 붙인다', () => {
    // 20mm 떨어져 있어 5mm 판정으로는 안 붙는다. 주변에서만 넓혀 살린다.
    const els = [pipe('p1', 0, 1), pipe('p2', 1.02, 2)]
    const base = inferConnections(els)
    expect(base).toEqual([])

    const rescued = connectGaps(findGaps(els, base))
    expect(rescued).toHaveLength(1)
    expect(rescued[0].source).toBe('geometry')
    expect(rescued[0].directed).toBe(false)
    // 판정에 쓴 값이 아니라 실제로 떨어져 있던 거리를 적는다.
    expect(rescued[0].tolerance).toBeCloseTo(0.02, 6)
  })

  it('이미 이어진 요소는 건드리지 않는다', () => {
    // 전역으로 오차를 키우면 여기에도 엉뚱한 연결이 붙는다. 그래서 고립된 것만 본다.
    const els = [pipe('p1', 0, 1), pipe('p2', 1, 2), pipe('p3', 2.02, 3)]
    const base = inferConnections(els)
    expect(base).toHaveLength(1)

    const rescued = connectGaps(findGaps(els, base))
    // p3 만 고립이다. p1-p2 사이에는 아무것도 새로 안 생긴다.
    expect(rescued.map((c) => [c.from, c.to])).toEqual([['p3', 'p2']])
  })

  it('서로를 지목한 고립 요소 둘을 한 번만 잇는다', () => {
    const els = [pipe('a', 0, 1), pipe('b', 1.02, 2)]
    expect(connectGaps(findGaps(els, []))).toHaveLength(1)
  })

  it('가장 가까운 하나에만 잇는다 — 없던 분기를 지어내지 않는다', () => {
    // lonely 주위 reach 안에 둘이 있다. 둘 다 이으면 있지도 않은 티(tee)가 생긴다.
    const els = [pipe('x', 0, 1), pipe('y', 0, 1), pipe('lonely', 1.01, 2)]
    const rescued = connectGaps(findGaps(els, inferConnections(els)))
    expect(rescued.filter((c) => c.from === 'lonely' || c.to === 'lonely')).toHaveLength(1)
  })

  it('1차 결손은 메우지 않는다', () => {
    const els = [pipe('p1', 0, 1), pipe('far', 10, 11)]
    expect(connectGaps(findGaps(els, []))).toEqual([])
  })
})

const d = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })
const u = (from: string, to: string): Connection => ({ from, to, source: 'geometry', directed: false, tolerance: 0.005 })

describe('trace', () => {
  it('기기를 알려 주면 방향 모름은 다음 기기에서 멈추고, 방향을 아는 길은 기기를 지나간다', () => {
    // 순환수관(pipe)에 FCU 둘이 매달리고, 다른 FCU 너머에 그 FCU 의 덕트와 디퓨저가 있다.
    const connections = [u('fcu1', 'pipe'), u('pipe', 'fcu2'), u('fcu2', 'duct2'), u('duct2', 'diff2')]
    const conduits = new Set(['pipe', 'duct2'])
    const isConduit = (id: string) => conduits.has(id)
    expect(trace(connections, 'fcu1').linked).toEqual(new Set(['pipe', 'fcu2', 'duct2', 'diff2']))
    expect(trace(connections, 'fcu1', isConduit).linked).toEqual(new Set(['pipe', 'fcu2']))

    // 방향을 아는 사슬은 기기(ahu)를 지나 끝까지 간다.
    const chain = [d('plant', 'pipe'), d('pipe', 'ahu'), d('ahu', 'duct'), d('duct', 'diffuser')]
    const t = trace(chain, 'diffuser', (id) => id === 'pipe' || id === 'duct')
    expect(t.upstream).toEqual(new Set(['duct', 'ahu', 'pipe', 'plant']))
  })

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

describe('traceBySystem', () => {
  it('붙은 덕트·배관의 계통마다 따로 추적한다', () => {
    // FCU 에 순환수 공급관(ws)·환수관(wr)과 급기 덕트(sa)가 붙어 있다. 공급관에는 다른 FCU 가 매달려 있다.
    const connections = [
      d('ws1', 'fcu'),
      u('ws1', 'fcu2'),
      d('fcu', 'wr1'),
      d('fcu', 'sa1'),
      d('sa1', 'diff'),
      u('fcu', 'fcu3'), // 덕트 없이 기기끼리 바로 붙은 것
    ]
    const system: Record<string, string> = { ws1: 'ws', wr1: 'wr', sa1: 'sa' }
    const isConduit = (id: string) => id in system
    const bySystem = new Map(traceBySystem(connections, 'fcu', (id) => system[id] ?? null, isConduit).map((t) => [t.systemId, t]))

    expect([...bySystem.keys()].sort()).toEqual([null, 'sa', 'wr', 'ws'].sort())
    expect(bySystem.get('ws')!.upstream).toEqual(new Set(['ws1']))
    expect(bySystem.get('ws')!.linked).toEqual(new Set(['fcu2']))
    expect(bySystem.get('wr')!.downstream).toEqual(new Set(['wr1']))
    // 급기 계통에는 덕트 너머의 디퓨저까지 들어가고, 물 계통의 관은 섞이지 않는다.
    expect(bySystem.get('sa')!.downstream).toEqual(new Set(['sa1', 'diff']))
    expect(bySystem.get(null)!.linked).toEqual(new Set(['fcu3']))
  })
})

describe('neighbors', () => {
  it('바로 붙은 이웃과 방향을 준다', () => {
    const list = neighbors([d('ahu', 'duct'), d('duct', 'diffuser'), u('duct', 'sensor')], 'duct')
    expect(list.map(({ connection, ...n }) => n)).toEqual([
      { id: 'ahu', relation: 'upstream', source: 'port', tolerance: null },
      { id: 'diffuser', relation: 'downstream', source: 'port', tolerance: null },
      // 형상으로 이은 것은 그때의 거리를 함께 준다. 검토 화면이 넓혀 이은 것을 구별한다.
      { id: 'sensor', relation: 'linked', source: 'geometry', tolerance: 0.005 },
    ])
  })
})

describe('deviceFlows', () => {
  const conduit = (id: string) => id.startsWith('duct') || id.startsWith('pipe')

  it('덕트·배관만 지나 닿은 기기로 흐르고, 가까운 기기부터 적는다', () => {
    // ahu → duct1 → vavNear, duct1 → duct2 → duct3 → vavFar. 중간의 댐퍼(기기)에서는 멈춘다.
    const connections = [d('ahu', 'duct1'), d('duct1', 'duct2'), d('duct2', 'duct3'), d('duct3', 'vavFar'), d('duct1', 'vavNear'), d('duct1', 'damper'), d('damper', 'duct9'), d('duct9', 'diff')]
    const f = deviceFlows(connections, conduit, ['ahu', 'vavNear', 'vavFar', 'damper', 'diff'])
    expect(f.directed.get('ahu')).toEqual(['vavNear', 'damper', 'vavFar'])
    expect(f.directed.get('damper')).toEqual(['diff'])
    expect([...f.fed].sort()).toEqual(['ahu', 'damper', 'diff', 'vavFar', 'vavNear'])
  })

  it('배관 고리를 돌아 자기에게만 돌아오는 기기는 이어진 기기가 아니다', () => {
    // linked 는 다른 기기 하나를 찾는 대로 멈춘다. 고리를 돌다 만난 자기 자신을 "다른 기기" 로 세면 안 된다.
    const loop = [u('pump', 'pipe1'), u('pipe1', 'pipe2'), u('pipe2', 'pump'), d('pump', 'pump')]
    const f = deviceFlows(loop, conduit, ['pump'])
    expect(f.linked.size).toBe(0)
    expect(f.directed.size).toBe(0)
    // 같은 고리에 다른 기기가 하나 매달리면 둘 다 이어진 기기다.
    const g = deviceFlows([...loop, u('pipe2', 'valve')], conduit, ['pump', 'valve'])
    expect([...g.linked].sort()).toEqual(['pump', 'valve'])
  })

  it('긴 배관 사슬도 기기마다 끝까지 훑지 않는다 — 덕트 2만 개에 기기 2천 대', () => {
    // 큐를 shift() 로 빼던 때는 병원 건축+MEP 의 흐름 셋을 재는 데 0.22초가 걸렸다(0.02초가 됐다). 여기서는 시간이 아니라
    // 결과를 본다: 한 줄로 이어진 덕트에 기기가 고루 매달려 있으면 전부 이어진 기기이고, 방향은 다음 기기까지만 간다.
    const connections: Connection[] = []
    const devices: string[] = []
    for (let i = 0; i < 20_000; i++) {
      connections.push(d(`duct${i}`, `duct${i + 1}`))
      if (i % 10 === 0) {
        devices.push(`vav${i}`)
        connections.push(d(`duct${i}`, `vav${i}`))
      }
    }
    connections.push(d('ahu', 'duct0'))
    const f = deviceFlows(connections, conduit, ['ahu', ...devices])
    expect(f.linked.size).toBe(devices.length + 1)
    expect(f.directed.get('ahu')!.length).toBe(devices.length)
    expect(f.directed.get('vav0')).toBeUndefined()
  })
})

