// 경로 추적(OE-ML-16)을 지금의 연결 추적(topology.ts 의 trace)으로 잰다. 연결은 층을 가리지 않는 모델 전체의 목록이라 층내·층간 경로가 이어진다.
// 합성 연결망: 지하 1층 펌프 P1·P2 → 공급관 S1 → 라이저 R(층간) → 3층 공급관 S3 → FCU. 방향은 BIM 포트(directed)이고, 일부만 방향을 뺀다.
import { describe, expect, it } from 'vitest'
import { trace, traceRoutes } from './topology'
import { withInferred } from './flow-rules'
import { releaseConnection } from './connection-release'
import type { Connection, Model } from './model'

const port = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })
const loose = (from: string, to: string): Connection => ({ from, to, source: 'geometry', directed: false, tolerance: null })
const CONDUITS = new Set(['S1', 'R', 'S3', 'S2', 'X', 'W1'])
const isConduit = (id: string) => CONDUITS.has(id)
const base = () => [port('P1', 'S1'), port('S1', 'R'), port('R', 'S3'), port('S3', 'FCU')]

describe('경로 추적 (OE-ML-16)', () => {
  it('지하 펌프와 위층 FCU 사이에 확정 흐름 경로가 있으면 FCU 의 상류에 펌프와 라이저가 든다 [OE-ML-16#1]', () => {
    const t = trace(base(), 'FCU', isConduit)
    expect([...t.upstream].sort()).toEqual(['P1', 'R', 'S1', 'S3'])
    expect(t.linked.size).toBe(0)
  })

  it('방향을 모르는 연결은 이어짐(연결 탐색)으로만 보이고 흐름 추적은 거기서 멈춘다 [OE-ML-16#2]', () => {
    const c = base()
    c[1] = loose('S1', 'R')
    const t = trace(c, 'FCU', isConduit)
    // R·S3 까지는 확정 흐름, S1 부터는 방향 모름이라 상류가 아니다(이어짐).
    expect([...t.upstream].sort()).toEqual(['R', 'S3'])
    expect(t.linked.has('S1')).toBe(true)
    expect(t.upstream.has('P1')).toBe(false)
  })

  it('원천이 둘이면 둘 다 상류이고, 순환이 있어도 추적이 끝난다 [OE-ML-16#3~]', () => {
    // P2 도 S1 에 물을 보내고, S3 → X → S1 로 도는 순환이 있다. 방문한 곳은 다시 보지 않아 끝난다.
    const c = [...base(), port('P2', 'S1'), port('S3', 'X'), port('X', 'S1')]
    const t = trace(c, 'FCU', isConduit)
    expect([...t.upstream].sort()).toEqual(['P1', 'P2', 'R', 'S1', 'S3', 'X'])
    // 순환 안에서 고르면 순환 위의 것은 상류이자 하류라 어느 한쪽으로 정하지 않는다(이어짐). "순환" 표시는 아직 없다.
    const inside = trace(c, 'R', isConduit)
    expect(['S1', 'S3', 'X'].every((id) => inside.linked.has(id))).toBe(true)
    expect(inside.upstream.has('P1')).toBe(true)
  })

  it('원천이 둘이고 대체 경로·순환이 있으면 원천마다 경로와 갈래 수를 따로 주고, 순환을 알리며 추적이 끝난다 [OE-ML-16#3]', () => {
    // P1 은 라이저(S1 → R → S3)로도, 따로 놓인 S2 로도 FCU 에 닿는다. P2 는 라이저로만 닿는다. S3 → X → S1 은 순환이다.
    const c = [...base(), port('P2', 'S1'), port('S3', 'X'), port('X', 'S1'), port('P1', 'S2'), port('S2', 'FCU')]
    const r = traceRoutes(c, 'FCU', isConduit)
    // 원천 둘을 다 든다 — 하나를 공급자로 정하지 않는다. P1 은 가까운 S2 쪽 길(배관 1개)이고 두 갈래로 닿는다.
    expect(r.sources).toEqual([
      { id: 'P1', via: [], conduits: 1, branches: 2 },
      { id: 'P2', via: [], conduits: 3, branches: 1 },
    ])
    expect(r.targets).toEqual([])
    expect(r.looped).toEqual([])
    expect(r.cycle).toEqual(['R', 'S1', 'S3', 'X'])
    // 순환 안의 구간을 골라도 끝나고, 순환 위의 것은 원천·말단 어느 쪽 목록에도 넣지 않는다.
    const inside = traceRoutes(c, 'R', isConduit)
    expect(inside.sources.map((x) => x.id)).toEqual(['P1', 'P2'])
    expect(inside.targets.map((x) => x.id)).toEqual(['FCU'])
    expect(inside.cycle).toEqual(['R', 'S1', 'S3', 'X'])
    // 방향을 모르는 연결은 경로가 아니다(흐름 추적은 거기서 멈춘다, AC2).
    const cut = base()
    cut[1] = loose('S1', 'R')
    expect(traceRoutes(cut, 'FCU', isConduit)).toEqual({ sources: [], targets: [], looped: [], cycle: [] })
    // 고른 기기와 같은 고리 위의 기기는 원천·말단으로 정하지 않고 따로 든다: FCU → S2 → P1 → S1 → … → FCU 이면 P1 은 FCU 의 위이자 아래다.
    const loop = traceRoutes([...base(), port('FCU', 'S2'), port('S2', 'P1')], 'FCU', isConduit)
    expect(loop.looped).toEqual([{ id: 'P1', via: [], conduits: 3, branches: 1 }])
    expect(loop.sources).toEqual([])
    expect(loop.cycle).toEqual(['FCU', 'P1', 'R', 'S1', 'S2', 'S3'])
  })

  it('기기를 지나는 경로는 사이 기기를 적는다 — 디퓨저의 원천은 공조기를 지나 열원까지 간다', () => {
    const c = [port('CH', 'W1'), port('W1', 'AHU'), port('AHU', 'S1'), port('S1', 'FCU')]
    expect(traceRoutes(c, 'FCU', isConduit).sources).toEqual([
      { id: 'AHU', via: [], conduits: 1, branches: 1 },
      { id: 'CH', via: ['AHU'], conduits: 2, branches: 1 },
    ])
  })

  it('사람이 해제 보정한 BIM 연결은 지나지 않는다 — 해제하면 경로가 끊긴다 [OE-ML-16#4]', () => {
    const model = { storeys: [], systems: [], connections: base(), connectionLog: [], releasedConnections: [] } as unknown as Model
    expect(trace(model.connections, 'FCU', isConduit).upstream.has('P1')).toBe(true)
    const done = releaseConnection(model, model.connections[1], '시험: 라이저 아래 연결 해제')
    expect('refused' in done).toBe(false)
    const t = trace(model.connections, 'FCU', isConduit)
    expect(t.upstream.has('P1')).toBe(false)
    expect(t.upstream.has('R')).toBe(true)
  })

  it('확정 전 규칙 방향은 미리보기 추적에만 들고, 내보내는 기준(확정만)의 추적과 다르다 [OE-ML-16#5]', () => {
    const c = base()
    c[1] = { ...loose('S1', 'R'), inferred: { from: 'S1', to: 'R', systemId: 'HW', confirmed: false } }
    const preview = trace(withInferred(c), 'FCU', isConduit)
    const confirmed = trace(withInferred(c, true), 'FCU', isConduit)
    expect(preview.upstream.has('P1')).toBe(true)
    expect(confirmed.upstream.has('P1')).toBe(false)
    // 추적은 연결을 고치지 않는다(TTL 의 확정 관계가 생기지 않는다).
    expect(c[1].inferred!.confirmed).toBe(false)
  })
})
