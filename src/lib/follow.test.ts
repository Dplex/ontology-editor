// 설비를 옮기면 붙은 배관이 따라온다(PRD #13, OE-OBJ-11). 손으로 만든 한 줄 배관: 공조기 — 엘보 — 덕트 — 토출구.
import { describe, expect, it } from 'vitest'
import { applyEdits, exportEdits } from './edit-file'
import { applyFollow, baselineOf, moveEquipment, planFollow, restore, snapshotEquipment, type SegmentAxis, type Snapshot } from './edit'
import { assignEquipment } from './mapping'
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
    expect(plan).toEqual({ rigid: ['ELB'], stretch: [{ id: 'DUCT', end: 0 }] })
    moveWithFollow(m, 'AHU', [0, 2, 0])
    expect(find(m, 'ELB').position).toEqual([2, 3, 2])
    expect(find(m, 'DUCT').endShift).toEqual([[0, 2, 0], [0, 0, 0]])
    // 덕트 좌표(축의 가운데)는 끝이 옮겨진 양의 절반만 간다. 먼 끝의 토출구는 그대로다.
    expect(find(m, 'DUCT').position).toEqual([4, 2, 2])
    expect(find(m, 'DIF').position).toEqual([6, 1, 2])
  })

  it('다른 설비(토출구)는 끌려오지 않고, 구간 너머로 번지지 않는다', () => {
    const m = build()
    const plan = planFollow(m, 'DIF', axisOf)
    expect(plan).toEqual({ rigid: [], stretch: [{ id: 'DUCT', end: 1 }] })
  })

  it('도관을 직접 옮기면 아무것도 따라오지 않는다', () => {
    expect(planFollow(build(), 'ELB', axisOf)).toEqual({ rigid: [], stretch: [] })
  })

  it('되돌리면 늘인 것까지 연 때로 돌아간다', () => {
    const m = build()
    const before = JSON.stringify(m)
    restore(m, moveWithFollow(m, 'AHU', [0, 2, 0]))
    expect(JSON.stringify(m)).toBe(before)
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
