// 참고 벽 — BIM 벽에 형상이 없을 때(샘플 IFC 처럼) 화면에서만 물리존 외곽선을 따라 얇게 세운다.
// 모델·저장본·내보내기에는 들어가지 않고, 이름에 '참고 벽'을 붙여 BIM 벽과 구분한다. 형상이 있는 벽이 하나라도 있는 층은 건드리지 않는다.
import type { Model, Storey, Vec2, Wall } from '../../../../src/lib/model'
import type { MeshMap } from '../../../../src/lib/ifc/import'

export const REF_WALL_THICKNESS = 0.15
export const REF_WALL_HEIGHT = 2.7

function quad(a: Vec2, b: Vec2, t: number): Vec2[] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const nx = (-dy / len) * (t / 2), ny = (dx / len) * (t / 2)
  return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]]
}

export function hasRealWalls(storey: Storey, meshes?: MeshMap): boolean {
  return storey.walls.some(w => (w.footprint?.length ?? 0) > 0 || meshes?.has(w.id))
}

export function referenceWalls(storey: Storey, height = REF_WALL_HEIGHT): Wall[] {
  const out: Wall[] = []
  storey.spaces.forEach((sp, i) => {
    const ring = sp.footprint
    for (let k = 0; k + 1 < ring.length; k++) {
      const q = quad(ring[k], ring[k + 1], REF_WALL_THICKNESS)
      if (q) out.push({ id: `ref:${sp.id}:${k}`, name: '참고 벽', thickness: REF_WALL_THICKNESS, loadBearing: false, height, footprint: [q] } as Wall)
    }
    void i
  })
  return out
}

/** 화면용 모델: 형상 있는 벽이 없는 층에만 참고 벽을 더한다(원본 모델은 그대로). */
export function withReferenceWalls(model: Model, meshes?: MeshMap): Model {
  return { ...model, storeys: model.storeys.map(st => hasRealWalls(st, meshes) || !st.spaces.length ? st : { ...st, walls: [...st.walls, ...referenceWalls(st)] }) }
}
