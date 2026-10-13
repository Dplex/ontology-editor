import { describe, expect, it } from 'vitest'
import { cascadeWaves, exportedFlows, flowBasis, flowChanges, type FlowEdge } from './flow-cascade'
import { addEquipment } from './edit'
import type { Connection, Model } from './model'

// 흐름 방향의 근거(계통 하나의 연결을 BIM 포트·규칙·사람으로 센다)와 연쇄 순서(바뀐 연결을 원천에서 가까운 순으로).
// 공조기 ahu → 덕트 d1 → d2 → 말단 t1, d2 → t2. 포트 방향 1개, 규칙 방향 3개(확정 1), 사람이 정한 것 1개, 방향 모름 1개.

function model(): Model {
  const m: Model = {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [{ id: 's1', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [] }],
    systems: [{ id: 'sys', name: 'SA-1', kind: null, memberIds: ['ahu', 'd1', 'd2', 't1', 't2'] } as unknown as Model['systems'][number]],
    connections: [],
    warnings: [],
  }
  for (const id of ['ahu', 'd1', 'd2', 't1', 't2', 'x']) addEquipment(m, 's1', { id, name: id, kind: null, position: [0, 0, 0] })
  const rule = (from: string, to: string, confirmed: boolean, recheck?: null): Connection['inferred'] => ({ from, to, systemId: 'sys', confirmed, ...(recheck === null ? { recheck } : {}) })
  m.connections = [
    { from: 'ahu', to: 'd1', source: 'port', directed: true, tolerance: null },
    { from: 'd2', to: 'd1', source: 'geometry', directed: false, tolerance: 0.005, inferred: rule('d1', 'd2', true) },
    { from: 'd2', to: 't1', source: 'geometry', directed: false, tolerance: 0.005, inferred: rule('d2', 't1', false) },
    { from: 't2', to: 'd2', source: 'geometry', directed: false, tolerance: 0.005, inferred: rule('d2', 't2', true, null) },
    { from: 't2', to: 'x', source: 'manual', directed: false, tolerance: null, edited: { from: 't2', to: 'x' } },
    { from: 'x', to: 'd1', source: 'geometry', directed: false, tolerance: 0.005 },
  ]
  return m
}

describe('흐름 방향의 근거', () => {
  it('BIM 포트·규칙(확정·재검토)·사람·모름으로 세고, brick:feeds 는 포트·사람·확정한 규칙(재검토 중 제외)만이다', () => {
    const m = model()
    expect(flowBasis(m, 'sys', new Set(m.systems[0].memberIds))).toEqual({
      total: 6,
      bim: 1,
      rule: 3,
      ruleConfirmed: 1,
      ruleRecheck: 1,
      edited: 1,
      unknown: 1,
      review: 0,
      feeds: 3,
    })
    // 다른 계통의 규칙이 구성원에 닿은 연결은 그 계통 몫이다(계통별 확정 표의 수와 같게).
    m.connections.push({ from: 'd1', to: 'x', source: 'geometry', directed: false, tolerance: 0.005, inferred: { from: 'd1', to: 'x', systemId: 'other', confirmed: true } })
    expect(flowBasis(m, 'sys', new Set(m.systems[0].memberIds)).total).toBe(6)
    expect(flowBasis(m, 'other', new Set()).rule).toBe(1)
  })
})

describe('연쇄 순서', () => {
  it('확정하면 새로 나가는 연결만 바뀐 것으로 잡고, 원천 쪽부터 한 물결씩 퍼진다', () => {
    const m = model()
    const before = exportedFlows(m)
    for (const c of m.connections) if (c.inferred) Object.assign(c.inferred, { confirmed: true, recheck: undefined })
    for (const c of m.connections) if (c.inferred && 'recheck' in c.inferred) delete c.inferred.recheck
    const changed = flowChanges(before, m)
    // 이미 나가던 d1→d2 는 그대로라 빠지고, 확정한 d2→t1 · 재검토가 풀린 d2→t2 가 든다.
    expect(changed).toEqual([
      { a: 'd2', b: 't1', from: 'd2' },
      { a: 't2', b: 'd2', from: 'd2' },
    ])
    expect(cascadeWaves(changed)).toEqual([0, 0])
  })

  it('사람이 이은 연결이 유체 흐름이 아니면(흐름 없는 기기) 방향을 정해도 brick:feeds 로 안 나가니 연쇄에 들지 않는다', () => {
    const m = model()
    addEquipment(m, 's1', { id: 'det', name: '열감지기', kind: 'heat_detector', position: [0, 0, 0] })
    const wire: Connection = { from: 'det', to: 'd1', source: 'manual', directed: false, tolerance: null }
    const pipe: Connection = { from: 'x', to: 't1', source: 'manual', directed: false, tolerance: null }
    m.connections.push(wire, pipe)
    const before = exportedFlows(m)
    wire.edited = { from: 'det', to: 'd1' }
    pipe.edited = { from: 'x', to: 't1' }
    expect(flowChanges(before, m)).toEqual([{ a: 'x', b: 't1', from: 'x' }])
    expect(flowBasis(m, 'sys', new Set(['d1', 't1'])).review).toBe(1)
  })

  it('이어진 연결은 거리 순, 떨어진 덩어리는 따로 0 부터, 원천이 없는 고리도 순서가 정해진다', () => {
    const chain: FlowEdge[] = [
      { a: 'c', b: 'd', from: 'c' },
      { a: 'a', b: 'b', from: 'a' },
      { a: 'b', b: 'c', from: 'b' },
      { a: 'p', b: 'q', from: 'p' },
    ]
    expect(cascadeWaves(chain)).toEqual([2, 0, 1, 0])
    const ring: FlowEdge[] = [
      { a: 'r1', b: 'r2', from: 'r1' },
      { a: 'r2', b: 'r3', from: 'r2' },
      { a: 'r3', b: 'r1', from: 'r3' },
    ]
    expect(cascadeWaves(ring)).toEqual([0, 1, 2])
    // 방향이 끝 순서와 반대여도(b 쪽에서 나감) 같은 그래프다.
    expect(cascadeWaves([{ a: 'y', b: 'x', from: 'x' }, { a: 'z', b: 'y', from: 'y' }])).toEqual([0, 1])
  })
})
