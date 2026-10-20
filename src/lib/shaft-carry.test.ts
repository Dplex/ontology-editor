import { describe, expect, it } from 'vitest'
import type { Connection, Equipment, Model, Space, Storey, Vec2, Vec3 } from './model'
import { segmentPath } from './model'
import { createVertical } from './vertical-edit'
import { setSegmentShaft, shaftDeviations } from './shaft'
import { moveShaftCarrying, planShaftCarry } from './shaft-carry'
import { restAxis } from './branch-pipe'
import { restore, snapshotEquipment, snapshotVerticals, type Snapshot } from './edit'
import { verticalObjects } from './vertical-object'

// 샤프트 안 배관 연동 이동(OE-ML-17). 두 층(0 · 4m) 건물, 샤프트 PS-1(축 3~4 × 0~1). 배관 한 줄:
// LOW(설비, 1F) — PIPE_A(수평 0.5→3.5) — FIT1(이음쇠, 축 안) — RISER(수직, 샤프트 소속) — FIT2(이음쇠, 축 안, 2F) — PIPE_B(수평 3.5→6.5) — HIGH(설비).
// 상관없는 배관 UNREL 은 따로 있다.

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const space = (id: string): Space => ({ id, name: id, longName: id, footprint: rect(0, 0, 10, 10), areaM2: 100, boundedBy: [] })
const eq = (id: string, role: Equipment['role'], at: Vec3, axis?: [Vec3, Vec3]): Equipment =>
  ({ id, name: id, ifcClass: role === 'segment' ? 'PipeSegment' : role === 'fitting' ? 'PipeFitting' : 'FlowTerminal', role, position: at, capacity: null, capacityProperty: null, systemId: null, spaceId: null, spaceSource: null, ...(axis ? { axis } : {}) }) as Equipment

function building(): Model {
  const floor = (id: string, elevation: number): Storey => ({ id, name: id, elevation, spaces: [space(`room-${id}`)], walls: [], openings: [], equipment: [] })
  const storeys = [floor('1F', 0), floor('2F', 4)]
  storeys[0].equipment.push(
    eq('LOW', 'terminal', [0.5, 0.5, 0.5]),
    eq('PIPE_A', 'segment', [2, 0.5, 0.5], [[-1.5, 0, 0], [1.5, 0, 0]]),
    eq('FIT1', 'fitting', [3.5, 0.5, 0.5]),
    eq('RISER', 'segment', [3.5, 0.5, 3], [[0, 0, -2.5], [0, 0, 2.5]]),
    eq('UNREL', 'segment', [8, 8, 0.5], [[-1, 0, 0], [1, 0, 0]]),
  )
  storeys[1].equipment.push(eq('FIT2', 'fitting', [3.5, 0.5, 5.5]), eq('PIPE_B', 'segment', [5, 0.5, 5.5], [[-1.5, 0, 0], [1.5, 0, 0]]), eq('HIGH', 'terminal', [6.5, 0.5, 5.5]))
  const link = (from: string, to: string) => ({ from, to, source: 'manual', directed: false, tolerance: null }) as Connection
  const m: Model = {
    schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys, systems: [], warnings: [],
    connections: [link('LOW', 'PIPE_A'), link('PIPE_A', 'FIT1'), link('FIT1', 'RISER'), link('RISER', 'FIT2'), link('FIT2', 'PIPE_B'), link('PIPE_B', 'HIGH')],
  }
  expect(createVertical(m, { id: 'U_ps', kind: 'shaft', name: 'PS-1', from: '1F', to: '2F' }, new Map([['1F', { footprint: rect(3, 0, 4, 1) }]]))).toEqual({ id: 'U_ps' })
  expect(setSegmentShaft(m, 'RISER', 'U_ps')).toBe(true)
  return m
}
const e = (m: Model, id: string) => m.storeys.flatMap((s) => s.equipment).find((x) => x.id === id)!
const path = (m: Model, id: string) => {
  const p = segmentPath(e(m, id))
  return p && 'path' in p ? p.path.map((q) => q.map((v) => Math.round(v * 1000) / 1000)) : null
}

describe('샤프트 안 배관 연동 이동 (OE-ML-17)', () => {
  it('옮기기 전에 같이 갈 안쪽 구간·분기점과 끝을 늘일 바깥 배관, 영향 층을 보인다 [OE-ML-17#2~]', () => {
    const m = building()
    const plan = planShaftCarry(m, 'U_ps', restAxis(m))
    expect([plan.segments.map((x) => x.id), plan.fittings.map((x) => x.id).sort(), plan.outside.map((x) => x.id).sort(), plan.storeys, plan.reasons]).toEqual([
      ['RISER'],
      ['FIT1', 'FIT2'],
      ['PIPE_A', 'PIPE_B'],
      ['1F', '2F'],
      [],
    ])
  })

  it('샤프트를 옮기면 안쪽 구간·분기점이 같은 거리만큼 가고, 바깥 배관은 샤프트 쪽 끝만 따라온다. 설비·먼 끝·상관없는 배관·연결은 그대로다 [OE-ML-17#2,3,5]', () => {
    const m = building()
    const links = JSON.stringify(m.connections)
    expect(moveShaftCarrying(m, 'U_ps', [1, 0], restAxis(m))).toBe(true)
    expect(verticalObjects(m).find((o) => o.id === 'U_ps')!.parts[0].part.footprint).toEqual(rect(4, 0, 5, 1))
    expect(path(m, 'RISER')).toEqual([[4.5, 0.5, 0.5], [4.5, 0.5, 5.5]])
    expect([e(m, 'FIT1').position, e(m, 'FIT2').position]).toEqual([[4.5, 0.5, 0.5], [4.5, 0.5, 5.5]])
    expect(path(m, 'PIPE_A')).toEqual([[0.5, 0.5, 0.5], [4.5, 0.5, 0.5]])
    expect(path(m, 'PIPE_B')).toEqual([[4.5, 0.5, 5.5], [6.5, 0.5, 5.5]])
    expect([e(m, 'LOW').position, e(m, 'HIGH').position]).toEqual([[0.5, 0.5, 0.5], [6.5, 0.5, 5.5]])
    expect(path(m, 'UNREL')).toEqual([[7, 8, 0.5], [9, 8, 0.5]])
    expect(JSON.stringify(m.connections)).toBe(links)
    // 옮긴 뒤에도 안쪽 구간은 축 안이라 이탈이 없다.
    expect(shaftDeviations(m)).toEqual([])
  })

  it('샤프트 구간이 설비에 바로 붙었거나 샤프트 밖 분기점에 물렸거나 좌표가 없으면 까닭을 보이고 아무것도 옮기지 않는다 [OE-ML-17#4]', () => {
    const direct = building()
    direct.connections.push({ from: 'RISER', to: 'HIGH', source: 'manual', directed: false, tolerance: null } as Connection)
    const before = JSON.stringify(direct)
    expect(moveShaftCarrying(direct, 'U_ps', [1, 0], restAxis(direct))).toEqual({ refused: expect.stringContaining('설비 HIGH에 바로 붙어') })
    expect(JSON.stringify(direct)).toBe(before)

    const branch = building()
    branch.storeys[0].equipment.push(eq('TEE_OUT', 'fitting', [6, 0.5, 0.5]))
    branch.connections.push({ from: 'FIT1', to: 'TEE_OUT', source: 'manual', directed: false, tolerance: null } as Connection)
    expect(planShaftCarry(branch, 'U_ps', restAxis(branch)).reasons).toEqual([expect.stringContaining('분기점 TEE_OUT이 샤프트 밖')])

    const lost = building()
    e(lost, 'PIPE_B').position = null
    expect(planShaftCarry(lost, 'U_ps', restAxis(lost)).reasons).toEqual([expect.stringContaining('바깥 배관 PIPE_B의 좌표가 없어')])
  })

  it('되돌리기 한 번(샤프트와 배관을 함께 뜬 스냅숏)이면 옮기기 전과 같다 [OE-ML-17#6]', () => {
    const m = building()
    // 합성 모델은 소속을 판정하지 않은 채 시작해서(되돌리면 다시 판정한다) 위치·형상·샤프트만 견준다.
    const shape = (x: Model) => JSON.stringify([x.storeys.map((s) => s.verticalParts), x.storeys.flatMap((s) => s.equipment.map((q) => [q.id, q.position, q.endShift ?? null])), x.connections])
    const before = shape(m)
    const plan = planShaftCarry(m, 'U_ps', restAxis(m))
    const snap: Snapshot = { kind: 'many', parts: [snapshotVerticals(m), ...[...plan.rigid, ...plan.stretch.map((s) => s.id)].map((id) => snapshotEquipment(m, id)!)] }
    expect(moveShaftCarrying(m, 'U_ps', [1, 0], restAxis(m))).toBe(true)
    expect(shape(m)).not.toBe(before)
    restore(m, snap)
    expect(shape(m)).toBe(before)
  })
})
