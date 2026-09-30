/**
 * 3D 형상 내보내기(GLB·OBJ). **보여 주기용 셋째 파일이다** — GeoJSON(평면 판정)과 TTL(관계)을 대신하지 않는다.
 *
 * 객체 이름은 GlobalId 다. GeoJSON·TTL 과 같은 id 하나로 이어지게 하려는 것이고, 사람이 읽는 이름·종류는
 * GLB 의 `extras`(three 의 userData)에만 넣는다. OBJ 는 이름 칸 하나뿐이라 id 만 남는다.
 *
 * 좌표는 3D 화면과 같은 three 좌표다(y 가 위, 미터). glTF 가 y 위를 표준으로 둬서 그대로 맞는다.
 * IFC 좌표로 되돌리려면 (x, y, z) → (x, -z, y) 다(`toScene` 의 반대).
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshLambertMaterial, Shape } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import type { ElementMesh, MeshMap } from '../ifc/import'
import type { Model, Vec2, Vec3 } from '../model'
import { ARCH_COLORS, spaceMesh, systemColors, toScene, WALL_COLORS } from '../viewer'

const SPACE_COLOR = 0x8fb3e8
const NO_SYSTEM = 0x98a1ab
/** 층 높이를 모를 때(맨 위층, 층이 하나) 벽 외곽선을 세우는 높이. */
const FALLBACK_STOREY_HEIGHT = 3

export type Mesh3dOptions = {
  /**
   * 연 때의 모델. 벽 외곽선이나 문·창 자리가 그때와 다르면 BIM 형상은 예전 자리라 쓰지 않는다 —
   * 벽은 지금 외곽선을 층 높이로 세우고, 문·창은 옮긴 만큼 형상을 옮긴다. 없으면 BIM 형상을 그대로 쓴다.
   */
  pristine?: Model | null
}

function fromElementMesh(data: ElementMesh, shift?: readonly [number, number, number]): BufferGeometry {
  const g = new BufferGeometry()
  let positions = data.positions
  if (shift && (shift[0] || shift[1] || shift[2])) {
    positions = positions.slice()
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] += shift[0]
      positions[i + 1] += shift[1]
      positions[i + 2] += shift[2]
    }
  }
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setAttribute('normal', new BufferAttribute(data.normals, 3))
  g.setIndex(new BufferAttribute(data.indices, 1))
  return g
}

function extrudeRings(rings: Vec2[][], y: number, height: number): BufferGeometry[] {
  const out: BufferGeometry[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const shape = new Shape()
    shape.moveTo(ring[0][0], ring[0][1])
    for (const p of ring.slice(1)) shape.lineTo(p[0], p[1])
    const g = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    g.translate(0, y, 0)
    out.push(g)
  }
  return out
}

const sameRings = (a: Vec2[][] | undefined, b: Vec2[][] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/**
 * 모델과 형상으로 내보낼 장면을 만든다. 층마다 Group 하나, 그 안에 방·벽·문·창·설비가 요소마다 Mesh 하나다.
 *
 * 설비는 화면과 같다 — 형상이 있으면 형상, 좌표만 있으면 0.4m 상자, 좌표도 없으면 넣지 않는다(원점에 두면 거기
 * 있는 것처럼 읽힌다). 방은 외곽선을 0.1m 판으로 깐다(방 높이는 읽지 않는다).
 */
export function modelToScene(model: Model, meshes: MeshMap, options: Mesh3dOptions = {}): Group {
  const root = new Group()
  root.name = model.buildingName || model.buildingId || 'building'
  root.userData = { id: model.buildingId, kind: 'building', schema: model.schema }

  const colorOf = systemColors(model)
  const materials = new Map<number, MeshLambertMaterial>()
  const material = (color: number) => {
    let m = materials.get(color)
    if (!m) materials.set(color, (m = new MeshLambertMaterial({ color, side: DoubleSide })))
    return m
  }
  const spaceMaterial = new MeshLambertMaterial({ color: SPACE_COLOR, transparent: true, opacity: 0.5, side: DoubleSide })

  const before = new Map<string, { footprint?: Vec2[][]; position?: Vec3 | null }>()
  for (const s of options.pristine?.storeys ?? []) {
    for (const w of s.walls) before.set(w.id, { footprint: w.footprint })
    for (const o of s.openings) before.set(o.id, { position: o.position ?? null })
  }

  const elevations = [...new Set(model.storeys.map((s) => s.elevation))].sort((a, b) => a - b)
  const heightOf = (elevation: number) => {
    const next = elevations.find((e) => e > elevation)
    return next !== undefined ? next - elevation : FALLBACK_STOREY_HEIGHT
  }

  const put = (parent: Group, geometry: BufferGeometry, mat: MeshLambertMaterial, id: string, extras: Record<string, unknown>) => {
    const mesh = new Mesh(geometry, mat)
    mesh.name = id
    mesh.userData = { id, ...extras }
    parent.add(mesh)
  }

  for (const storey of model.storeys) {
    const group = new Group()
    group.name = storey.id
    group.userData = { id: storey.id, kind: 'storey', name: storey.name, elevation: storey.elevation }
    root.add(group)

    for (const space of storey.spaces) {
      const slab = spaceMesh(space.footprint, SPACE_COLOR)
      if (!slab) continue
      ;(slab.material as { dispose(): void }).dispose()
      slab.geometry.translate(0, storey.elevation, 0)
      put(group, slab.geometry, spaceMaterial, space.id, { kind: 'space', name: space.name, longName: space.longName })
    }

    for (const wall of storey.walls) {
      const color = wall.loadBearing ? WALL_COLORS.loadBearing : wall.loadBearing === null ? WALL_COLORS.unknown : ARCH_COLORS.wall
      const extras = { kind: 'wall', name: wall.name, loadBearing: wall.loadBearing }
      const data = meshes.get(wall.id)
      const was = before.get(wall.id)
      // 연 때와 외곽선이 같으면(또는 비교할 것이 없으면) BIM 형상을 쓴다. 고친 벽·더한 벽은 지금 외곽선을 세운다.
      if (data && !wall.added && (!options.pristine || (was && sameRings(was.footprint, wall.footprint)))) {
        put(group, fromElementMesh(data), material(color), wall.id, extras)
        continue
      }
      const pieces = extrudeRings(wall.footprint ?? [], storey.elevation, heightOf(storey.elevation))
      pieces.forEach((g, i) => put(group, g, material(color), pieces.length > 1 ? `${wall.id}#${i}` : wall.id, extras))
    }

    for (const o of storey.openings) {
      const data = meshes.get(o.id)
      if (!data) continue
      const was = before.get(o.id)?.position
      const now = o.position
      const shift = was && now ? toScene([now[0] - was[0], now[1] - was[1], now[2] - was[2]]) : undefined
      const color = o.kind === 'door' ? ARCH_COLORS.door : ARCH_COLORS.window
      put(group, fromElementMesh(data, shift), material(color), o.id, { kind: o.kind, name: o.name, wallId: o.wallId })
    }

    for (const e of storey.equipment) {
      const color = e.systemId ? (colorOf.get(e.systemId) ?? NO_SYSTEM) : NO_SYSTEM
      const extras = { kind: 'equipment', name: e.name, ifcClass: e.ifcClass, role: e.role, systemId: e.systemId, spaceId: e.spaceId }
      const data = meshes.get(e.id)
      if (data) {
        put(group, fromElementMesh(data), material(color), e.id, extras)
      } else if (e.position) {
        const box = new BoxGeometry(0.4, 0.4, 0.4)
        box.translate(...toScene(e.position))
        put(group, box, material(color), e.id, { ...extras, placeholder: true })
      }
    }
  }
  return root
}

export function sceneToOBJ(scene: Group): string {
  return new OBJExporter().parse(scene)
}

export async function sceneToGLB(scene: Group): Promise<ArrayBuffer> {
  return (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer
}

/** 장면의 지오메트리·재질을 놓아 준다. 큰 파일은 내보낸 뒤 바로 풀어야 메모리가 두 벌로 남지 않는다. */
export function disposeScene(scene: Group) {
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose()
      ;(o.material as { dispose(): void }).dispose()
    }
  })
}
