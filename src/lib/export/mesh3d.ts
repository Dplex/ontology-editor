/**
 * 3D 형상 내보내기(GLB·OBJ). **보여 주기용 셋째 파일이다** — GeoJSON(평면 판정)과 TTL(관계)을 대신하지 않는다.
 *
 * 객체 이름은 GlobalId 다. GeoJSON·TTL 과 같은 id 하나로 이어지게 하려는 것이고, 사람이 읽는 이름·종류는
 * GLB 의 `extras`(three 의 userData)에만 넣는다. OBJ 는 이름 칸 하나뿐이라 id 만 남는다.
 *
 * 좌표는 3D 화면과 같은 three 좌표다(y 가 위, 미터). glTF 가 y 위를 표준으로 둬서 그대로 맞는다.
 * IFC 좌표로 되돌리려면 (x, y, z) → (x, -z, y) 다(`toScene` 의 반대).
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Matrix4, Shape } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import type { ElementMesh, MeshMap } from '../ifc/import'
import type { Model, Opening, Vec2, Vec3 } from '../model'
import { ARCH_COLORS, spaceMesh, systemColors, toScene, WALL_COLORS } from '../viewer'

const SPACE_COLOR = 0x8fb3e8
const NO_SYSTEM = 0x98a1ab
/** 층 높이를 모를 때(맨 위층, 층이 하나) 벽 외곽선을 세우는 높이. */
const FALLBACK_STOREY_HEIGHT = 3
/** BIM 에 크기가 없는 문·창의 상자(너비, 높이, 미터). 표시용 자리 표시이고 extras 에 placeholder 를 단다. */
const FALLBACK_OPENING: Record<'door' | 'window', [number, number]> = { door: [0.9, 2.1], window: [1.0, 1.0] }
/** 두께를 모를 때(사람이 더한 문·창) 상자의 두께. */
const FALLBACK_OPENING_DEPTH = 0.2

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
  // 법선은 고쳐 쓰므로(unitNormals) 사본을 둔다. 원본은 3D 화면이 같이 쓴다.
  g.setAttribute('normal', new BufferAttribute(new Float32Array(data.normals), 3))
  g.setIndex(new BufferAttribute(data.indices, 1))
  return g
}

/**
 * 법선을 단위 길이로 맞춘다(제자리). glTF 는 단위 법선만 받아서, 아니면 GLTFExporter 가 메시마다 사본을 만들어
 * 고치고 경고를 찍는다 — 성수에서 2만 2천 번. web-ifc 법선은 배치 행렬을 곱해 길이가 1 이 아닐 수 있고,
 * 넓이 0 인 삼각형(외곽선에 겹친 점이 있는 방 판 등)은 법선이 0 이거나 NaN 이다. 방향이 없으니 위를 준다.
 */
function unitNormals(g: BufferGeometry) {
  const attr = g.getAttribute('normal')
  if (!attr) return
  const n = attr.array as Float32Array
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2])
    if (!(len > 0) || !Number.isFinite(len)) {
      n[i] = 0
      n[i + 1] = 1
      n[i + 2] = 0
    } else if (Math.abs(len - 1) > 1e-6) {
      n[i] /= len
      n[i + 1] /= len
      n[i + 2] /= len
    }
  }
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
  const materials = new Map<number, MeshStandardMaterial>()
  const material = (color: number) => {
    let m = materials.get(color)
    if (!m) materials.set(color, (m = new MeshStandardMaterial({ color, side: DoubleSide })))
    return m
  }
  const spaceMaterial = new MeshStandardMaterial({ color: SPACE_COLOR, transparent: true, opacity: 0.5, side: DoubleSide })

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

  const put = (parent: Group, geometry: BufferGeometry, mat: MeshStandardMaterial, id: string, extras: Record<string, unknown>) => {
    unitNormals(geometry)
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

    // 문·창. 임포터는 문·창 형상을 자리만 재고 버려서(import.ts 의 placeWallsAndOpenings) 보통 형상이 없다. 그때는 자리·크기·
    // 벽을 뚫는 방향으로 상자를 세운다 — 요구조건 S7(DT 가 문·창을 그릴 형상, ADR-0009). 자리를 모르면 넣지 않는다(설비와 같다).
    for (const o of storey.openings) {
      const color = o.kind === 'door' ? ARCH_COLORS.door : ARCH_COLORS.window
      const extras = { kind: o.kind, name: o.name, wallId: o.wallId }
      const data = meshes.get(o.id)
      if (data) {
        const was = before.get(o.id)?.position
        const now = o.position
        const shift = was && now ? toScene([now[0] - was[0], now[1] - was[1], now[2] - was[2]]) : undefined
        put(group, fromElementMesh(data, shift), material(color), o.id, extras)
      } else if (o.position) {
        put(group, openingBox(o), material(color), o.id, o.width && o.height ? extras : { ...extras, placeholder: true })
      }
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

/**
 * 문·창의 상자. 가로는 벽을 따라, 두께는 벽을 뚫는 방향(`through`)으로, 바닥은 자리의 높이(형상의 바닥)다. three 좌표에서
 * 상자의 +z 를 through 쪽으로 돌린다 — IFC 평면 (tx, ty) 는 three 의 (tx, 0, -ty) 다(`toScene`).
 */
function openingBox(o: Opening): BoxGeometry {
  const [w, h] = o.width && o.height ? [o.width, o.height] : FALLBACK_OPENING[o.kind]
  const box = new BoxGeometry(w, h, o.depth && o.depth > 0 ? o.depth : FALLBACK_OPENING_DEPTH)
  const [tx, ty] = o.through ?? [0, 1]
  box.rotateY(Math.atan2(tx, -ty))
  const p = o.position!
  box.translate(...toScene([p[0], p[1], p[2] + h / 2]))
  return box
}

/** OBJ 조각 하나의 크기(글자). 조각을 Blob 에 이어 붙인다. */
const OBJ_CHUNK = 8_000_000
const mm = (v: number) => String(Math.round(v * 1000) / 1000)
const IDENTITY = new Matrix4()

/**
 * OBJ 를 문자열 조각으로 낸다. **한 문자열로 만들면 성수에서 V8 문자열 한도(약 5억 글자)를 넘는다** — three 의
 * `OBJExporter` 가 `RangeError: Invalid string length` 로 멈췄다. 조각을 `new Blob(parts)` 로 이으면 한도에 닿지 않는다.
 * 좌표는 mm 까지만 적는다(미터 단위라 그 아래는 BIM 도 뜻이 없고, 파일만 커진다).
 *
 * 성수는 16초 걸린다(GLB 는 3초). 화면이 그동안 멈추지 않게 50ms 마다 한 번 비켜 주고 `onProgress`(적은 꼭짓점, 전체 꼭짓점)를 부른다.
 */
export function sceneToOBJ(scene: Group, onProgress?: (done: number, total: number) => void): Promise<string[]>
/** `toPart` 는 조각이 찰 때마다 바로 부른다(워커가 바이트로 바꿔 글자 조각을 곧바로 버린다). */
export function sceneToOBJ<T>(scene: Group, onProgress: ((done: number, total: number) => void) | undefined, toPart: (chunk: string) => T): Promise<T[]>
export async function sceneToOBJ<T>(scene: Group, onProgress?: (done: number, total: number) => void, toPart?: (chunk: string) => T): Promise<(T | string)[]> {
  const parts: (T | string)[] = []
  let buf = '# ontology-editor 3D export. object name = IFC GlobalId, y up, metres\n'
  const emit = () => {
    parts.push(toPart ? toPart(buf) : buf)
    buf = ''
  }
  const flush = () => {
    if (buf.length >= OBJ_CHUNK) emit()
  }
  let base = 1
  scene.updateMatrixWorld(true)
  const list: Mesh[] = []
  scene.traverse((o) => void (o instanceof Mesh && list.push(o)))
  const total = list.reduce((s, o) => s + (o.geometry as BufferGeometry).getAttribute('position').count, 0) || 1
  let last = performance.now()
  for (const o of list) {
    if (performance.now() - last > 50) {
      onProgress?.(base - 1, total)
      await new Promise((r) => setTimeout(r, 0))
      last = performance.now()
    }
    // 형상은 세계 좌표로 구워 두어 행렬이 늘 단위 행렬이다. 아닐 때만 사본에 곱한다(성수는 꼭짓점이 1천만 개다).
    const identity = o.matrixWorld.equals(IDENTITY)
    const g = identity ? (o.geometry as BufferGeometry) : (o.geometry as BufferGeometry).clone().applyMatrix4(o.matrixWorld)
    const p = g.getAttribute('position').array
    const n = g.getAttribute('normal')?.array
    const count = p.length / 3
    buf += `o ${o.name}\n`
    for (let i = 0; i < p.length; i += 3) {
      buf += `v ${mm(p[i])} ${mm(p[i + 1])} ${mm(p[i + 2])}\n`
      if ((i & 0xfff) === 0) flush()
    }
    if (n) for (let i = 0; i < n.length; i += 3) {
      buf += `vn ${mm(n[i])} ${mm(n[i + 1])} ${mm(n[i + 2])}\n`
      if ((i & 0xfff) === 0) flush()
    }
    const index = g.index?.array
    const faces = index ? index.length / 3 : count / 3
    for (let f = 0; f < faces; f++) {
      const a = (index ? index[f * 3] : f * 3) + base
      const b = (index ? index[f * 3 + 1] : f * 3 + 1) + base
      const c = (index ? index[f * 3 + 2] : f * 3 + 2) + base
      buf += n ? `f ${a}//${a} ${b}//${b} ${c}//${c}\n` : `f ${a} ${b} ${c}\n`
      if ((f & 0x3ff) === 0) flush()
    }
    base += count
    if (!identity) g.dispose()
    flush()
  }
  emit()
  onProgress?.(total, total)
  return parts
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
