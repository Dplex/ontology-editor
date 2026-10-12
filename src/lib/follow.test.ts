// 설비를 옮기면 붙은 배관이 따라온다(PRD #13, OE-OBJ-11). 손으로 만든 한 줄 배관: 공조기 — 엘보 — 덕트 — 토출구.
import { describe, expect, it } from 'vitest'
import { applyEdits, exportEdits } from './edit-file'
import { applyFollow, baselineOf, moveEquipment, planFollow, restore, snapshotEquipment, type SegmentAxis, type Snapshot } from './edit'
import { assignEquipment } from './mapping'
import { releaseConnection } from './connection-release'
import type { Equipment, Model, Vec3 } from './model'

function eq(id: string, role: Equipment['role'], position: Vec3): Equipment {
  return { id, name: id, ifcClass: 'X', role, position, capacity: null, systemId: null, spaceId: null, spaceSource: null } as Equipment
}

function build(): Model {
  const m = {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'B',
    buildingName: '',
    storeys: [
      {
        id: 'S1',
        name: '1F',
        elevation: 0,
        spaces: [
          { id: 'R1', name: 'R1', longName: '방1', footprint: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], areaM2: 100, boundedBy: [] },
        ],
        walls: [],
        openings: [],
        equipment: [eq('AHU', 'conversion', [1, 1, 2]), eq('ELB', 'fitting', [2, 1, 2]), eq('DUCT', 'segment', [4, 1, 2]), eq('DIF', 'terminal', [6, 1, 2])],
      },
    ],
    systems: [],
    connections: [
      { from: 'AHU', to: 'ELB', source: 'port', directed: true, tolerance: null },
      { from: 'ELB', to: 'DUCT', source: 'port', directed: true, tolerance: null },
      { from: 'DUCT', to: 'DIF', source: 'port', directed: true, tolerance: null },
    ],
    warnings: [],
  } as unknown as Model
  // 임포트처럼 소속을 먼저 잰다.
  for (const e of m.storeys[0].equipment) assignEquipment(e, m.storeys[0].spaces)
  return m
}

// 덕트는 x 2..6 을 지난다(엘보 쪽 끝이 0번).
const AXES: Record<string, SegmentAxis> = { DUCT: [[2, 1, 2], [6, 1, 2]] }
const axisOf = (id: string) => AXES[id] ?? null
const find = (m: Model, id: string) => m.storeys[0].equipment.find((e) => e.id === id)!

function moveWithFollow(m: Model, id: string, delta: Vec3) {
  const plan = planFollow(m, id, axisOf)
  const snaps = [id, ...plan.rigid, ...plan.stretch.map((s) => s.id)].map((x) => snapshotEquipment(m, x)!)
  const p = find(m, id).position!
  moveEquipment(m, id, [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]])
  applyFollow(m, plan, delta, axisOf)
  return { kind: 'many', parts: snaps } as Snapshot
}

describe('배관이 설비를 따라온다', () => {
  it('이음쇠는 같이 옮기고 구간은 가까운 끝만 늘인다', () => {
    const m = build()
    const plan = planFollow(m, 'AHU', axisOf)
    expect(plan).toEqual({ rigid: ['ELB'], stretch: [{ id: 'DUCT', end: 0 }], held: [], blocked: [] })
    const links = JSON.stringify(m.connections)
    moveWithFollow(m, 'AHU', [0, 2, 0])
    // 위치만 바뀐다. 연결 대상과 흐름 방향은 그대로다(OE-PIP-12).
    expect(JSON.stringify(m.connections)).toBe(links)
    expect(find(m, 'ELB').position).toEqual([2, 3, 2])
    expect(find(m, 'DUCT').endShift).toEqual([[0, 2, 0], [0, 0, 0]])
    // 덕트 좌표(축의 가운데)는 끝이 옮겨진 양의 절반만 간다. 먼 끝의 토출구는 그대로다.
    expect(find(m, 'DUCT').position).toEqual([4, 2, 2])
    expect(find(m, 'DIF').position).toEqual([6, 1, 2])
  })

  it('다른 설비(토출구)는 끌려오지 않고, 구간 너머로 번지지 않는다', () => {
    const m = build()
    const plan = planFollow(m, 'DIF', axisOf)
    expect(plan).toEqual({ rigid: [], stretch: [{ id: 'DUCT', end: 1 }], held: [], blocked: [] })
  })

  it('도관을 직접 옮기면 아무것도 따라오지 않는다', () => {
    expect(planFollow(build(), 'ELB', axisOf)).toEqual({ rigid: [], stretch: [], held: [], blocked: [] })
  })

  it('되돌리면 늘인 것까지 연 때로 돌아간다', () => {
    const m = build()
    const before = JSON.stringify(m)
    restore(m, moveWithFollow(m, 'AHU', [0, 2, 0]))
    expect(JSON.stringify(m)).toBe(before)
  })

  it('다른 분기에도 붙은 이음쇠(티)는 옮기지 않고 그 너머도 따라가지 않으며, 그 분기의 배관은 그대로다 (OE-PIP-12)', () => {
    const m = build()
    // 엘보에 다른 분기(BR)를 하나 더 붙여 티로 만든다. BR 너머에는 다른 토출구(DIF2)가 있다.
    m.storeys[0].equipment.push(eq('BR', 'segment', [2, 3, 2]), eq('DIF2', 'terminal', [2, 5, 2]))
    m.connections.push({ from: 'ELB', to: 'BR', source: 'port', directed: true, tolerance: null }, { from: 'BR', to: 'DIF2', source: 'port', directed: true, tolerance: null })
    const axes: Record<string, SegmentAxis> = { ...AXES, BR: [[2, 1, 2], [2, 5, 2]] }
    const plan = planFollow(m, 'AHU', (id) => axes[id] ?? null)
    expect(plan).toEqual({ rigid: [], stretch: [], held: ['ELB'], blocked: [] })
  })

  it('이음쇠가 옮기는 설비가 아닌 다른 설비에도 바로 붙어 있으면 옮기지 않는다', () => {
    const m = build()
    m.storeys[0].equipment.push(eq('FAN', 'conversion', [2, 0, 2]))
    m.connections = m.connections.filter((c) => c.to !== 'DUCT')
    m.connections.push({ from: 'ELB', to: 'FAN', source: 'port', directed: true, tolerance: null })
    expect(planFollow(m, 'AHU', axisOf).held).toEqual(['ELB'])
  })

  it('형상이 없어 축을 모르는 구간과 좌표가 없는 도관은 늘이지 않고 "자동 추종 불가" 사유로 돌려준다 (OE-PIP-12)', () => {
    const m = build()
    const plan = planFollow(m, 'DIF', () => null)
    expect(plan).toEqual({ rigid: [], stretch: [], held: [], blocked: [{ id: 'DUCT', reason: 'geometry' }] })
    find(m, 'ELB').position = null
    expect(planFollow(m, 'AHU', axisOf).blocked).toEqual([{ id: 'ELB', reason: 'position' }])
    // 임의 좌표를 만들지 않는다.
    moveWithFollow(m, 'AHU', [0, 2, 0])
    expect(find(m, 'ELB').position).toBe(null)
  })

  it('사람이 해제 보정한 BIM 연결의 배관은 따라오지 않는다 (OE-PIP-06)', () => {
    const m = build()
    const elbowDuct = m.connections.find((c) => c.from === 'ELB' && c.to === 'DUCT')!
    expect(releaseConnection(m, elbowDuct, '현장에서 철거')).not.toHaveProperty('refused')
    expect(planFollow(m, 'AHU', axisOf)).toEqual({ rigid: ['ELB'], stretch: [], held: [], blocked: [] })
  })

  it('편집 파일을 거쳐도 끝과 좌표가 같다', () => {
    const m = build()
    const base = baselineOf(m)
    moveWithFollow(m, 'AHU', [0, 2, 0])
    moveWithFollow(m, 'DIF', [1, 0, 0])
    const file = exportEdits(m, base, 'x.ifc')
    const reloaded = build()
    applyEdits(reloaded, JSON.parse(JSON.stringify(file)))
    for (const id of ['AHU', 'ELB', 'DUCT', 'DIF']) {
      expect(find(reloaded, id).position).toEqual(find(m, id).position)
      expect(find(reloaded, id).endShift).toEqual(find(m, id).endShift)
    }
    expect(find(m, 'DUCT').endShift).toEqual([[0, 2, 0], [1, 0, 0]])
  })
})
