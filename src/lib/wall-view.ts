// 보기 모드 3D 의 벽(#599). 벽은 IFC 형상 그대로 그리되, 편집으로 옮기거나 크기를 바꾼 벽은 형상이 옛 자리에 남으므로
// 지금 외곽선을 실제 높이로 세워 그린다. 편집 모드의 1.2m 로 깎은 벽(viewer.ts 의 arch)과는 따로다.
import { ExtrudeGeometry, Shape } from 'three'
import type { ElementMesh, MeshMap } from './ifc/import'
import { footprintRings, meshBottom, meshHeight } from './ifc/element-geometry'
import type { Storey, Vec2, Wall } from './model'

export type WallTone = 'loadBearing' | 'unknown' | 'ordinary'

/** 높이를 모르는 벽(에디터가 그은 벽)에 같은 층 벽 높이가 하나도 없을 때. 그리기에만 쓰고 모델에는 넣지 않는다. */
const FALLBACK_HEIGHT = 2.4

export const wallTone = (wall: Wall): WallTone => (wall.loadBearing ? 'loadBearing' : wall.loadBearing === null ? 'unknown' : 'ordinary')

const ringsKey = (rings: readonly (readonly Vec2[])[]) => rings.map((r) => r.map(([x, y]) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`).join(';')).join('|')

/**
 * IFC 형상이 지금 벽과 같은 자리에 있나 — 임포트가 형상에서 외곽선·높이를 읽은 그대로인가(import.ts 의 footprintRings·meshHeight).
 * 범위만 대 보면 안 된다: 외곽선 읽기가 아랫면 일부를 놓친 벽이 있어(Duplex 2층 칸막이 하나) 편집 안 한 벽을 짧게 다시 세운다.
 * 외곽선이 없으면 비교할 것이 없어 형상을 믿는다.
 */
function meshFits(wall: Wall, mesh: ElementMesh): boolean {
  if (!wall.footprint?.length) return true
  if (wall.height != null && wall.height !== meshHeight(mesh)) return false
  return ringsKey(wall.footprint) === ringsKey(footprintRings(mesh))
}

/** 외곽선을 층 바닥에서 `height` 만큼 세운 형상. three.js 좌표(높이가 y)로, 형상 읽기와 같은 꼴이다. */
function extrude(rings: readonly (readonly Vec2[])[], bottom: number, height: number): ElementMesh | null {
  const positions: number[] = []
  const normals: number[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const shape = new Shape()
    shape.moveTo(ring[0][0], ring[0][1])
    for (const p of ring.slice(1)) shape.lineTo(p[0], p[1])
    const g = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    g.translate(0, bottom, 0)
    const geo = g.index ? g.toNonIndexed() : g
    positions.push(...geo.getAttribute('position').array)
    normals.push(...geo.getAttribute('normal').array)
    g.dispose()
    geo.dispose()
  }
  if (!positions.length) return null
  const indices = new Uint32Array(positions.length / 3)
  for (let i = 0; i < indices.length; i++) indices[i] = i
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices }
}

/**
 * 한 층의 벽을 3D 에 그릴 형상으로. 내력 여부와 상관없이 다 그린다 — 비내력벽(칸막이)을 빼면 방이 뚫려 보인다(#599).
 * 형상도 외곽선도 없는 벽은 건너뛴다(손으로 쓴 픽스처, COBie 판본).
 */
export type WallShape = { id: string; tone: WallTone; mesh: ElementMesh; /** IFC 형상 대신 지금 외곽선으로 다시 세웠다. */ rebuilt: boolean }

export function wallShapes(storey: Storey, meshes: MeshMap | undefined): WallShape[] {
  const known = storey.walls.map((w) => w.height).filter((h): h is number => h != null && h > 0).sort((a, b) => a - b)
  const usual = known.length ? known[Math.floor(known.length / 2)] : FALLBACK_HEIGHT
  const out: WallShape[] = []
  for (const wall of storey.walls) {
    const ifc = meshes?.get(wall.id)
    if (ifc && meshFits(wall, ifc)) {
      out.push({ id: wall.id, tone: wallTone(wall), mesh: ifc, rebuilt: false })
      continue
    }
    // 다시 세우는 벽의 바닥은 IFC 형상의 바닥이다 — 기초벽처럼 층 바닥보다 아래서 시작하는 벽이 있다.
    const mesh = extrude(wall.footprint ?? [], meshBottom(ifc) ?? storey.elevation, wall.height ?? usual)
    if (mesh) out.push({ id: wall.id, tone: wallTone(wall), mesh, rebuilt: true })
  }
  return out
}
