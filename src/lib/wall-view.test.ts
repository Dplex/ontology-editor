import { describe, expect, it } from 'vitest'
import { footprintRings, meshHeight } from './ifc/element-geometry'
import type { ElementMesh, MeshMap } from './ifc/import'
import type { Storey, Vec2, Wall } from './model'
import { wallShapes } from './wall-view'

/** IFC 평면의 직사각형(x0,y0)-(x1,y1)을 바닥 z0 에서 높이 h 만큼 세운 상자. three.js 좌표(x, 높이, -y)다. */
function box(x0: number, y0: number, x1: number, y1: number, h = 3, z0 = 0): ElementMesh {
  const corners: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const positions: number[] = []
  for (const z of [z0, z0 + h]) for (const [x, y] of corners) positions.push(x, z, -y)
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
  return { positions: new Float32Array(positions), normals: new Float32Array(positions.length), indices: new Uint32Array(faces.flat()) }
}

const bounds = (m: ElementMesh) => {
  const p = m.positions
  const xs = [], ys = [], zs = []
  for (let i = 0; i < p.length; i += 3) xs.push(p[i]), ys.push(p[i + 1]), zs.push(-p[i + 2])
  const r = (v: number) => Math.round(v * 1000) / 1000
  return { x: [r(Math.min(...xs)), r(Math.max(...xs))], y: [r(Math.min(...ys)), r(Math.max(...ys))], z: [r(Math.min(...zs)), r(Math.max(...zs))] }
}

function storeyOf(walls: Wall[], elevation = 0): Storey {
  return { id: 's1', name: '1F', elevation, spaces: [], walls, openings: [], equipment: [] } as unknown as Storey
}

const wall = (id: string, loadBearing: boolean | null, mesh: ElementMesh | null, extra: Partial<Wall> = {}): Wall => ({
  id,
  name: id,
  thickness: 0.2,
  loadBearing,
  ...(mesh ? { footprint: footprintRings(mesh), height: meshHeight(mesh) } : {}),
  ...extra,
})

describe('보기 모드 3D 의 벽 (#599)', () => {
  it('비내력벽도 그린다 — 내력·모름·비내력을 색 갈래로 나눈다', () => {
    const meshes: MeshMap = new Map([
      ['a', box(0, 0, 5, 0.2)],
      ['b', box(0, 0, 0.2, 4)],
      ['c', box(5, 0, 5.2, 4)],
    ])
    const st = storeyOf([wall('a', true, meshes.get('a')!), wall('b', null, meshes.get('b')!), wall('c', false, meshes.get('c')!)])
    const out = wallShapes(st, meshes)
    expect(out.map((w) => [w.id, w.tone])).toEqual([['a', 'loadBearing'], ['b', 'unknown'], ['c', 'ordinary']])
    // 편집하지 않은 벽은 IFC 형상 그대로다.
    for (const w of out) expect(w.mesh).toBe(meshes.get(w.id))
  })

  it('편집으로 옮긴 벽은 옛 자리의 IFC 형상 대신 지금 외곽선을 실제 높이로 세운다', () => {
    const ifc = box(0, 0, 5, 0.2, 2.8, 10)
    const moved = footprintRings(ifc).map((r) => r.map(([x, y]) => [x, y + 1.5] as Vec2))
    const st = storeyOf([wall('a', false, ifc, { footprint: moved, height: 2.8 })], 10)
    const [w] = wallShapes(st, new Map([['a', ifc]]))
    expect(w.mesh).not.toBe(ifc)
    expect(bounds(w.mesh)).toEqual({ x: [0, 5], y: [10, 12.8], z: [1.5, 1.7] })
  })

  it('높이만 고친 벽도 다시 세운다', () => {
    const ifc = box(0, 0, 5, 0.2, 3)
    const [w] = wallShapes(storeyOf([wall('a', false, ifc, { height: 2.5 })]), new Map([['a', ifc]]))
    expect(bounds(w.mesh).y).toEqual([0, 2.5])
  })

  it('에디터가 그은 벽(형상·높이 없음)은 같은 층 벽 높이로 세우고, 형상도 외곽선도 없는 벽은 건너뛴다', () => {
    const ifc = box(0, 0, 5, 0.2, 2.7)
    const drawn: Wall = { id: 'u', name: 'u', thickness: 0.2, loadBearing: null, added: true, footprint: [[[0, 3], [5, 3], [5, 3.2], [0, 3.2]]] }
    const bare: Wall = { id: 'x', name: 'x', thickness: null, loadBearing: false }
    const out = wallShapes(storeyOf([wall('a', true, ifc), drawn, bare]), new Map([['a', ifc]]))
    expect(out.map((w) => w.id)).toEqual(['a', 'u'])
    expect(bounds(out[1].mesh)).toEqual({ x: [0, 5], y: [0, 2.7], z: [3, 3.2] })
  })
})
