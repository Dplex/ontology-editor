import { describe, expect, it } from 'vitest'
import { boxesOverlap, markerBox, meshBox, overlapAt, overlappingPairs, standalone, type Box3 } from './overlap'
import type { Equipment, Model, Vec3 } from './model'
import type { ElementMesh } from './ifc/import'

// OE-OBJ-10 · OE-OBJ-16. 배관 없는 설비(조명·감지기·CCTV)는 서로 겹쳐 놓지 못한다. 덕트·배관이 붙는 설비는 규칙 밖이다.

const device = (id: string, kind: string | null, position: Vec3 | null, role: Equipment['role'] = 'terminal'): Equipment =>
  ({ id, name: id, kind, ifcClass: 'FlowTerminal', role, position, capacity: null, capacityProperty: null, systemId: null, spaceId: null, spaceSource: null }) as Equipment

const modelOf = (equipment: Equipment[]): Model =>
  ({ storeys: [{ id: 'S', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment }], systems: [], connections: [], warnings: [] }) as unknown as Model

describe('설비 겹침', () => {
  it('메시 상자를 IFC 좌표(z 가 위)로 잰다', () => {
    // three.js 세계 좌표 (x, 높이, -y). 점 (1, 2, -3) 은 IFC (1, 3, 2) 다.
    const mesh = { positions: new Float32Array([1, 2, -3, 2, 4, -5]), normals: new Float32Array(), indices: new Uint32Array() } as ElementMesh
    expect(meshBox(mesh)).toEqual({ min: [1, 3, 2], max: [2, 5, 4] })
  })

  it('맞닿기만 하거나 1cm 안으로 파고든 것은 겹침이 아니다', () => {
    const a: Box3 = { min: [0, 0, 0], max: [1, 1, 1] }
    expect(boxesOverlap(a, { min: [1, 0, 0], max: [2, 1, 1] })).toBe(false)
    expect(boxesOverlap(a, { min: [0.995, 0, 0], max: [2, 1, 1] })).toBe(false)
    expect(boxesOverlap(a, { min: [0.9, 0, 0], max: [2, 1, 1] })).toBe(true)
  })

  it('흐름이 없는 종류만 규칙을 따른다 — 덕트·디퓨저·종류 모르는 설비는 아니다', () => {
    expect(standalone(device('L', 'lighting', [0, 0, 0]))).toBe(true)
    expect(standalone(device('C', 'camera', [0, 0, 0]))).toBe(true)
    expect(standalone(device('F', 'fcu', [0, 0, 0]))).toBe(false)
    expect(standalone(device('D', 'duct', [0, 0, 0], 'segment'))).toBe(false)
    expect(standalone(device('U', null, [0, 0, 0]))).toBe(false)
    // 종류를 모르면 IFC 클래스로 가른다. 센서는 배관 없는 설비다.
    expect(standalone({ ...device('S', null, [0, 0, 0], 'sensing'), ifcClass: 'Sensor' })).toBe(true)
  })

  it('옮겨서 새로 겹치면 상대를 돌려주고, 원래 겹쳐 있던 상대는 떼어 놓을 수 있다', () => {
    const boxes: Record<string, Box3> = { A: markerBox([0, 0, 3]), B: markerBox([2, 0, 3]) }
    const m = modelOf([device('A', 'lighting', [0, 0, 3]), device('B', 'smoke_detector', [2, 0, 3]), device('F', 'fcu', [4, 0, 3])])
    const boxOf = (id: string) => boxes[id] ?? null
    expect(overlapAt(m, 'A', [1.8, 0, 3], boxOf)?.id).toBe('B')
    expect(overlapAt(m, 'A', [1.5, 0, 3], boxOf)).toBeNull()
    // FCU 는 규칙 밖이라 그 자리에 놓아도 된다(형상이 없어 좌표 상자로 잰다).
    expect(overlapAt(m, 'A', [4, 0, 3], boxOf)).toBeNull()
    // 높이가 다르면 겹치지 않는다(천장 조명과 바닥 분전반).
    expect(overlapAt(m, 'A', [2, 0, 1], boxOf)).toBeNull()
    // 이미 겹쳐 있으면(BIM 이 그렇게 뒀다) 그 상대 때문에 막지 않는다.
    boxes.B = markerBox([0.1, 0, 3])
    expect(overlapAt(m, 'A', [0.2, 0, 3], boxOf)).toBeNull()
    expect(overlappingPairs(m, boxOf).map(([a, b]) => [a.id, b.id])).toEqual([['A', 'B']])
  })

  it('좌표가 없던 설비(미배치)를 놓을 때는 좌표 상자로 잰다', () => {
    const m = modelOf([device('A', 'lighting', null), device('B', 'lighting', [2, 0, 3])])
    expect(overlapAt(m, 'A', [2.1, 0, 3], () => null)?.id).toBe('B')
    expect(overlapAt(m, 'A', [3, 0, 3], () => null)).toBeNull()
  })
})
