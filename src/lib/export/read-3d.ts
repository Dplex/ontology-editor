// 내보낸 3D 형상(GLB·OBJ)을 다시 읽는다. 내보낸 파일 뷰어(viewer.html)와 check:sample 이 쓴다.
//
// 3D 는 보여 주기용 셋째 파일이다(mesh3d.ts) — 객체 이름이 GlobalId 라 GeoJSON·TTL 과 같은 id 로 이어지고, 좌표는 three 좌표
// (y 가 위, 미터)다. 여기서는 객체마다 id·꼭짓점 수·범위(**IFC 좌표로 되돌린 것**, (x, y, z) = (x, -z, y))를 뽑고, GeoJSON 과
// 견줘 이어지는지·같은 자리인지를 센다. 3D 만 다른 좌표로 나가면(축이 바뀌거나 층 높이가 빠지면) 파일 셋을 겹쳐 쓰는 쪽이 틀린다.

import { Box3, type Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import type { ExportFloor } from './read-export'
import type { TtlReading } from './read-ttl'

export type Part3D = {
  /** GlobalId. 벽 외곽선이 여러 조각이면 `id#0`, `id#1` 로 나가서 뒤를 뗀 것이다. */
  id: string
  /** 파일에 적힌 객체 이름 그대로. */
  name: string
  /** GLB extras 의 kind·name(OBJ 는 이름 칸 하나뿐이라 없다). */
  kind: string | null
  label: string | null
  /** 삼각형 수. 꼭짓점 수는 OBJ 로더가 면마다 풀어 읽어 GLB 와 달라지므로 삼각형으로 센다. */
  triangles: number
  /** IFC 좌표(x 동, y 북, z 위) 범위. */
  min: [number, number, number]
  max: [number, number, number]
}

export type Reading3D = {
  fileName: string
  format: 'glb' | 'obj'
  scene: Object3D
  parts: Part3D[]
}

const baseId = (name: string) => name.replace(/#\d+$/, '')

function partsOf(scene: Object3D): Part3D[] {
  scene.updateMatrixWorld(true)
  const out: Part3D[] = []
  const box = new Box3()
  scene.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    box.setFromObject(mesh)
    // three(x, y 위, z) → IFC(x, -z, y). z 를 뒤집으니 최소·최대가 바뀐다.
    out.push({
      id: baseId(mesh.name),
      name: mesh.name,
      kind: typeof mesh.userData.kind === 'string' ? mesh.userData.kind : null,
      label: typeof mesh.userData.name === 'string' ? mesh.userData.name : null,
      triangles: (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3,
      min: [box.min.x, -box.max.z, box.min.y],
      max: [box.max.x, -box.min.z, box.max.y],
    })
  })
  return out
}

/** GLB(바이너리 glTF)·OBJ 를 읽는다. 확장자로 가른다. */
export async function read3D(fileName: string, data: ArrayBuffer): Promise<Reading3D> {
  if (/\.obj$/i.test(fileName)) {
    const scene = new OBJLoader().parse(new TextDecoder().decode(data))
    return { fileName, format: 'obj', scene, parts: partsOf(scene) }
  }
  const gltf = await new GLTFLoader().parseAsync(data, '')
  return { fileName, format: 'glb', scene: gltf.scene, parts: partsOf(gltf.scene) }
}

/**
 * 범위가 이만큼 어긋나도 같은 자리로 본다(미터). OBJ 는 좌표를 mm 까지만 적고(mesh3d.ts), 방 판은 외곽선을 그대로 깐 것이라
 * 그보다 크게 어긋날 까닭이 없다.
 */
export const PLACE_TOLERANCE = 0.01
/**
 * 설비는 GeoJSON 점이 BIM 의 배치점이라 형상 밖에 있을 수 있다 — ifc4Mep 의 얇은 덕트 플랜지·센서 39대가 형상 범위에서 0.3m
 * 떨어져 있다. 임포터는 배치점이 형상에서 ANCHOR_MARGIN(0.5m) 넘게 떨어지면 형상 중심으로 옮기므로(OE-BIM-12), 그 안쪽은 BIM 그대로다.
 * 값은 import.ts 의 ANCHOR_MARGIN 과 같다(read-export.test.ts 가 맞춰 본다). 뷰어 번들이 web-ifc 를 끌어오지 않게 따로 둔다.
 */
export const EQUIPMENT_TOLERANCE = 0.5

export type Check3D = {
  /** 3D 객체인데 GeoJSON·TTL 어디에도 그 id 가 없다. */
  unknown: string[]
  /** 형상이 있는 물리존·설비·벽 feature 인데 3D 객체가 없다. */
  missing: { id: string; kind: string }[]
  /** 같은 id 인데 자리가 다르다 — 방은 외곽선 범위, 설비는 GeoJSON 점이 3D 범위 안에 드는지. */
  misplaced: { id: string; kind: string; by: number }[]
}

const IN_3D = new Set(['space', 'equipment', 'wall'])

export function check3D(parts: readonly Part3D[], floors: readonly ExportFloor[], ttl: TtlReading | null): Check3D {
  // 같은 id 의 조각(벽 여러 조각)은 범위를 합친다.
  const byId = new Map<string, { min: number[]; max: number[] }>()
  for (const p of parts) {
    const had = byId.get(p.id)
    if (!had) byId.set(p.id, { min: [...p.min], max: [...p.max] })
    else for (let i = 0; i < 3; i++) (had.min[i] = Math.min(had.min[i], p.min[i])), (had.max[i] = Math.max(had.max[i], p.max[i]))
  }
  const features = new Map(floors.flatMap((f) => f.features.map((x) => [x.id, x] as const)))
  const inTtl = (id: string) => !!ttl && (ttl.entities.some((e) => e.key === id) || ttl.unread.some((u) => u.key === id))

  const unknown = [...byId.keys()].filter((id) => !features.has(id) && !inTtl(id))
  const missing: Check3D['missing'] = []
  const misplaced: Check3D['misplaced'] = []
  for (const [id, f] of features) {
    const kind = String(f.properties.kind ?? '')
    if (!f.geometry || !IN_3D.has(kind)) continue
    const box = byId.get(id)
    if (!box) {
      missing.push({ id, kind })
      continue
    }
    // 평면(x, y)만 본다. 높이는 GeoJSON 이 층 elevation 으로만 말한다.
    const outside = (x: number, y: number) =>
      Math.max(box.min[0] - x, x - box.max[0], box.min[1] - y, y - box.max[1], 0)
    let by = 0
    if (f.geometry.type === 'Point') {
      const [x, y] = f.geometry.coordinates as number[]
      by = outside(x, y)
    } else if (kind === 'space' && f.geometry.type === 'Polygon') {
      // 방 판은 외곽선을 그대로 깐다. 외곽선 범위와 3D 범위가 같아야 한다.
      const ring = (f.geometry.coordinates as number[][][])[0]
      const xs = ring.map((p) => p[0])
      const ys = ring.map((p) => p[1])
      by = Math.max(
        Math.abs(Math.min(...xs) - box.min[0]),
        Math.abs(Math.max(...xs) - box.max[0]),
        Math.abs(Math.min(...ys) - box.min[1]),
        Math.abs(Math.max(...ys) - box.max[1]),
      )
    }
    if (by > (kind === 'equipment' ? EQUIPMENT_TOLERANCE : PLACE_TOLERANCE)) misplaced.push({ id, kind, by })
  }
  return { unknown, missing, misplaced }
}
