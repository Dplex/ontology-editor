// 구간 끝의 연결 대상 바꾸기(OE-PIP-10 · OE-PIP-01·06). 공조기 — 덕트(1..4) — 디퓨저1(4,1), 디퓨저2(4,3) 는 따로 있다.
import { describe, expect, it } from 'vitest'
import { retargetEnd } from './retarget'
import { baselineOf, restore, snapshotEquipment, type SegmentAxis, type Snapshot } from './edit'
import { snapshotRelease } from './connection-release'
import { applyEdits, exportEdits } from './edit-file'
import { segmentPath, type Equipment, type Model, type Vec3 } from './model'

const eq = (id: string, role: Equipment['role'], position: Vec3, extra: Partial<Equipment> = {}): Equipment =>
  ({ id, name: id, ifcClass: 'X', role, position, capacity: null, systemId: null, spaceId: null, spaceSource: null, ...extra }) as unknown as Equipment
function build(): Model {
  return {
    schema: 'IFC4',
    storeys: [
      {
        id: 'S1', name: '1F', elevation: 0, spaces: [], walls: [], openings: [],
        equipment: [
          eq('AHU', 'conversion', [1, 1, 2]),
          eq('D', 'segment', [2.5, 1, 2], { axis: [[-1.5, 0, 0], [1.5, 0, 0]] }),
          eq('DIF1', 'terminal', [4, 1, 2]),
          eq('DIF2', 'terminal', [4, 3, 2]),
          eq('ELB', 'fitting', [6, 1, 2]),
        ],
      },
      { id: 'S2', name: '2F', elevation: 4, spaces: [], walls: [], openings: [], equipment: [eq('UP', 'terminal', [4, 3, 6])] },
    ],
    systems: [],
    connections: [
      { from: 'AHU', to: 'D', source: 'port', directed: true, tolerance: null },
      { from: 'D', to: 'DIF1', source: 'port', directed: true, tolerance: null },
    ],
    warnings: [],
  } as unknown as Model
}
const AXES: Record<string, SegmentAxis> = { D: [[1, 1, 2], [4, 1, 2]] }
const axisOf = (id: string) => AXES[id] ?? null
const find = (m: Model, id: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.id === id)!

describe('구간 끝의 연결 대상 바꾸기 (OE-PIP-10)', () => {
  it('BIM 포트 연결은 해제 보정하고 새 대상과 manual 로 잇는다. 그 끝은 새 대상 자리로 늘어나고 다른 끝은 그대로다', () => {
    const m = build()
    const done = retargetEnd(m, 'D', 'DIF1', 'DIF2', axisOf)
    if ('refused' in done) throw new Error(done.refused)
    expect(done.released).toBe(true)
    expect(m.releasedConnections?.map((r) => [r.connection.from, r.connection.to, r.reason])).toEqual([['D', 'DIF1', '끝 대상 바꾸기: DIF1 → DIF2']])
    expect(m.connections.map((c) => [c.from, c.to, c.source, c.directed])).toEqual([
      ['AHU', 'D', 'port', true],
      ['D', 'DIF2', 'manual', false],
    ])
    expect(segmentPath(find(m, 'D'))).toEqual({ path: [[1, 1, 2], [4, 3, 2]] })
    expect(done.stretched).toBe(true)
  })

  it('사람이 이은 연결은 해제 보정 없이 지운다', () => {
    const m = build()
    m.connections[1] = { from: 'D', to: 'DIF1', source: 'manual', directed: false, tolerance: null }
    const done = retargetEnd(m, 'D', 'DIF1', 'DIF2', axisOf)
    if ('refused' in done) throw new Error(done.refused)
    expect(done.released).toBe(false)
    expect(m.releasedConnections).toBeUndefined()
  })

  it('이음쇠 · 이어지지 않은 끝 · 같은 대상 · 이미 이어진 대상 · 좌표 없는 대상 · 다른 층은 막고 아무것도 바꾸지 않는다', () => {
    const m = build()
    const before = JSON.stringify(m)
    expect(retargetEnd(m, 'ELB', 'DIF1', 'DIF2', axisOf)).toEqual({ refused: '끝 대상은 구간에서 바꿉니다. 이음쇠에 붙은 구간을 고르세요.' })
    expect(retargetEnd(m, 'D', 'DIF2', 'ELB', axisOf)).toEqual({ refused: 'DIF2에 이어진 끝이 아닙니다.' })
    expect(retargetEnd(m, 'D', 'DIF1', 'DIF1', axisOf)).toEqual({ refused: '지금 대상과 다른 것을 고르세요.' })
    expect(retargetEnd(m, 'D', 'DIF1', 'AHU', axisOf)).toEqual({ refused: 'AHU에는 이미 이어져 있습니다.' })
    find(m, 'DIF2').position = null
    expect(retargetEnd(m, 'D', 'DIF1', 'DIF2', axisOf)).toEqual({ refused: '좌표가 없는 대상에는 잇지 않습니다. 먼저 위치를 넣으세요.' })
    find(m, 'DIF2').position = [4, 3, 2]
    expect(retargetEnd(m, 'D', 'DIF1', 'UP', axisOf)).toEqual({ refused: '다른 층의 대상과 잇는 것은 다중층 뷰에서 합니다(OE-PIP-15).' })
    expect(JSON.stringify(m)).toBe(before)
  })

  it('한 번에 되돌리면 연결·해제 보정·형상이 바꾸기 전과 같고, 편집 파일을 거쳐도 같다', () => {
    const m = build()
    const base = baselineOf(m)
    const before = JSON.stringify(m)
    // 화면이 묶는 되돌리기: 옛 연결의 해제 상태, 새 연결의 "없던 상태", 구간의 형상.
    const old = m.connections[1]
    const log = [...(m.connectionLog ?? [])]
    const parts: Snapshot[] = [snapshotRelease(m, old), snapshotEquipment(m, 'D')!]
    const done = retargetEnd(m, 'D', 'DIF1', 'DIF2', axisOf)
    if ('refused' in done) throw new Error(done.refused)
    const after = JSON.stringify(m)
    const again = build()
    applyEdits(again, exportEdits(m, base, 'x.ifc'))
    expect(again.connections.map((c) => `${c.from}-${c.to}-${c.source}`)).toEqual(m.connections.map((c) => `${c.from}-${c.to}-${c.source}`))
    expect(again.releasedConnections?.map((r) => `${r.connection.from}-${r.connection.to}`)).toEqual(['D-DIF1'])
    expect(segmentPath(find(again, 'D'))).toEqual(segmentPath(find(m, 'D')))
    restore(m, { kind: 'many', parts: [parts[0], { kind: 'release', connection: done.added, state: { where: 'absent' }, log }, parts[1]] })
    expect(JSON.stringify(m)).toBe(before)
    expect(after).not.toBe(before)
  })
})
