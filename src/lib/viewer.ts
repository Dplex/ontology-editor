// 임포트 결과를 3D 로 띄운다. 임포트가 맞았는지 눈으로 확인하는 것이 이 화면의 일이다.
//
// 표로는 안 잡히는 실패가 있다. 배치 사슬을 잘못 타면 방이 전부 원점에 겹쳐 쌓이는데,
// 개수도 넓이도 그대로라서 숫자만 봐서는 멀쩡해 보인다. 3D 로 띄우면 즉시 보인다.
//
// 설비는 상자 점이 아니라 IFC 의 실제 형상으로 그린다. 배관·덕트는 점으로 찍으면 계통이
// 어디로 지나가는지가 사라져서, 연결을 추정한 것이 맞는지 눈으로 확인할 수가 없다.

import {
  AmbientLight,
  Box3,
  Color,
  Ray,
  Sphere,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Shape,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Model, Vec2, Wall } from './model'
import type { MeshMap } from './ifc/import'

/**
 * 층을 구분하는 색. 층 수만큼 순환한다.
 *
 * 파랑에서 시작해 색상환을 도는 중채도 계열이다. 흙빛 계열을 써 봤더니 밝은 배경 위에서
 * 낡아 보였고, 형광색은 반대로 튀기만 한다. 채도는 중간, 명도는 비슷하게 맞춰서 어느
 * 층이 위인지가 색이 아니라 높이로 읽히게 한다.
 */
const STOREY_COLORS = [0x6f9bf5, 0x4fc3a1, 0xb08ef0, 0xf0a94e, 0xef7d7d]

/**
 * 계통을 구분하는 색. 계통 수만큼 순환한다.
 *
 * 층 색과 같은 성질로 고른다 — 채도는 중간, 명도는 비슷하게. 한 건물에 계통이 스무 개쯤
 * 되는 일이 흔해서(Duplex MEP 가 20개다) 색만으로는 다 구분되지 않는다. 그래서 범례에서
 * 계통을 짚는 쪽을 주된 길로 두고, 색은 "여기까지가 한 계통" 을 보는 보조로 쓴다.
 */
const SYSTEM_COLORS = [
  0x2f6fed, 0x1f9d7a, 0x9b59d0, 0xe0803a, 0xd1495b, 0x2aa8c4, 0x7a8b3f, 0xc2467f, 0x4a5bd4, 0x3f8f4a,
]

/** 계통에 색을 배정한다. 범례와 3D 가 같은 값을 봐야 해서 한 곳에서 만든다. */
export function systemColors(model: Model): Map<string, number> {
  return new Map(model.systems.map((s, i) => [s.id, SYSTEM_COLORS[i % SYSTEM_COLORS.length]]))
}

/** 계통이 없는 설비. 색을 안 주면 안 보이므로 중립 회색으로 둔다. */
const NO_SYSTEM = 0x98a1ab

/**
 * 선택과 연결을 나타내는 색.
 *
 * 상류·하류·방향 모름을 서로 다른 색으로 둔다. 방향 모름을 하류와 같은 색으로 두면,
 * 추정한 연결이 BIM 이 말해 준 흐름처럼 보인다.
 */
export const PICK_COLORS = {
  selected: 0x1b48b5,
  upstream: 0xe0803a,
  downstream: 0x1f9d7a,
  linked: 0x9b59d0,
  // 규칙(사전)으로 정한 상류·하류는 같은 색을 옅게 쓴다. 진한 색은 BIM 포트가 말한 것만이다.
  ruleUpstream: 0xf3c7a0,
  ruleDownstream: 0x9fd8c6,
  dimmed: 0xc8cdd3,
}

/**
 * 내력벽 색. 내력벽 여부를 BIM 이 말하지 않은 벽은 "모름" 으로 따로 칠한다 — 비내력으로 숨기면
 * 모르는 벽이 내력벽이 아닌 것처럼 보인다. 비내력벽은 그리지 않는다.
 */
export const WALL_COLORS = {
  loadBearing: 0x39424e,
  unknown: 0xd9a531,
}

export type Highlight = {
  selected: string | null
  upstream: Set<string>
  downstream: Set<string>
  linked: Set<string>
  /** 규칙 방향(사전)으로만 상류·하류가 된 것. 포트가 말한 것과 다른 색으로 칠한다. */
  ruleUpstream?: Set<string>
  ruleDownstream?: Set<string>
  /**
   * 참이면 강조된 것에 제 계통 색을 그대로 둔다. 계통 하나만 켤 때 쓴다 — 범례의 색과
   * 3D 의 색이 달라지면, 켠 계통이 범례에서 짚은 그 계통인지 알 수 없다.
   */
  keepColor?: boolean
}

/**
 * 공간 하나를 얇은 판으로 세운다.
 *
 * 벽 높이를 모르므로 두께만 주고 세우지 않는다. BIM 에서 층고를 읽어 오는 것은
 * 이 PoC 범위 밖이고, 평면이 맞는지 보는 데는 판이면 충분하다.
 */
export function spaceMesh(footprint: readonly Vec2[], color: number, opacity = 0.8): Mesh | null {
  if (footprint.length < 3) return null

  const shape = new Shape()
  shape.moveTo(footprint[0][0], footprint[0][1])
  for (const p of footprint.slice(1)) shape.lineTo(p[0], p[1])
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false })
  // Shape 는 XY 평면에 그려진다. 건물 평면이 XZ 가 되도록 눕힌다.
  geometry.rotateX(-Math.PI / 2)

  return new Mesh(
    geometry,
    new MeshLambertMaterial({ color, transparent: true, opacity, side: DoubleSide }),
  )
}

/**
 * IFC 세계 좌표를 three 좌표로 옮긴다.
 *
 * IFC 는 z 가 높이고 three 는 y 가 높이다. **평면 y 의 부호가 뒤집힌다** — 공간 판은
 * `rotateX(-90°)` 로 눕히면서 (x, y) 가 (x, -y) 로 가고, web-ifc 가 주는 메시도 같은
 * 변환을 이미 거쳐서 온다. 설비 점만 부호를 그대로 두면 설비가 건물을 가로질러 거울처럼
 * 뒤집힌 자리에 찍힌다. 그래도 개수와 좌표값은 멀쩡해서 표로는 잡히지 않는다.
 */
export function toScene(position: readonly [number, number, number]): [number, number, number] {
  return [position[0], position[2], -position[1]]
}

/**
 * 설비 한 대를 작은 상자로 찍는다. **형상이 없는 설비의 대비책이다.**
 *
 * 좌표는 있는데 IFC 에 형상이 없는 설비가 실제로 있다. 그런 설비까지 안 보이면 "BIM 에
 * 없는 것" 과 "형상이 없는 것" 이 화면에서 같아진다.
 */
export function equipmentMarker(position: readonly [number, number, number], color: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color }))
  mesh.position.set(...toScene(position))
  return mesh
}

export type Viewer = {
  /**
   * `offsets` 는 사람이 옮긴 설비의 이동량(IFC 좌표, 미터)이다. 형상(메시)은 BIM 자리에 있으니 그만큼 밀어서
   * 그린다. 안 주면 옮긴 설비가 3D 에서 제자리에 남아 편집이 안 보인다.
   */
  setModel(model: Model, meshes?: MeshMap, offsets?: ReadonlyMap<string, readonly [number, number, number]>): void
  /** 선택과 상류·하류를 색으로 칠한다. null 이면 전부 원래 색으로 되돌린다. */
  setHighlight(highlight: Highlight | null): void
  /** 3D 에서 설비를 고르면 부른다. 빈 곳을 누르면 null 이다. */
  onPick(handler: (id: string | null) => void): void
  /** 그 설비가 화면 가운데 오도록 카메라를 돌린다. */
  focus(id: string): void
  /** 주어진 설비들이 화면에 꽉 차게 카메라를 맞춘다. 연결망만 보고 싶을 때 쓴다. */
  frame(ids: Iterable<string>): void
  /** 내력벽(과 내력 여부를 모르는 벽)을 켜고 끈다. 모델을 바꿔도 켜 둔 상태는 남는다. */
  setWallsVisible(on: boolean): void
  /**
   * 층 하나만 보인다. null 이면 전체 층이다. 다른 층의 설비·판·벽은 그리지도 고르지도 않고, 카메라를 그 층에
   * 맞춘다. 모델을 바꿔도 고른 층은 남는다(그 층이 새 모델에 없으면 전체로 돌아간다).
   */
  setStorey(storeyId: string | null): void
  /** 편집 모드에서만 켠다. 켜 두면 고른 설비를 끌어 지금 높이의 수평면 위로 옮길 수 있다. */
  setDragEnabled(on: boolean): void
  /** 끌기를 놓았을 때 부른다. 이동량은 IFC 좌표(미터)이고 높이는 0 이다. */
  onDragEnd(handler: (id: string, delta: readonly [number, number, number]) => void): void
  dispose(): void
}

/** 합친 형상 안에서 설비 하나가 차지하는 자리. 강조·선택·시점 맞추기가 이 표로 설비를 찾는다. */
type Part = {
  id: string
  /** 이 설비가 든 층. 층별 보기가 이걸로 가린다. */
  storeyId: string
  color: number
  /** 꼭짓점 범위(색을 바꿀 때)와 삼각형 인덱스 범위(보이기·고르기). */
  vStart: number
  vCount: number
  iStart: number
  iCount: number
  box: Box3
}

/** 내력벽과 내력 여부를 모르는 벽을 한 덩어리로 합친다. 형상을 못 얻은 벽은 건너뛴다. */
function wallMesh(walls: readonly Wall[], meshes?: MeshMap): Mesh | null {
  const pieces: { color: Color; mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array } }[] = []
  for (const wall of walls) {
    if (wall.loadBearing === false) continue
    const mesh = meshes?.get(wall.id)
    if (!mesh) continue
    pieces.push({ color: new Color(wall.loadBearing ? WALL_COLORS.loadBearing : WALL_COLORS.unknown), mesh })
  }
  if (pieces.length === 0) return null
  let vTotal = 0
  let iTotal = 0
  for (const { mesh } of pieces) {
    vTotal += mesh.positions.length / 3
    iTotal += mesh.indices.length
  }
  const positions = new Float32Array(vTotal * 3)
  const normals = new Float32Array(vTotal * 3)
  const colors = new Float32Array(vTotal * 3)
  const index = new Uint32Array(iTotal)
  let vo = 0
  let io = 0
  for (const { color, mesh } of pieces) {
    const vCount = mesh.positions.length / 3
    positions.set(mesh.positions, vo * 3)
    normals.set(mesh.normals, vo * 3)
    for (let v = 0; v < vCount; v++) colors.set([color.r, color.g, color.b], (vo + v) * 3)
    for (let k = 0; k < mesh.indices.length; k++) index[io + k] = mesh.indices[k] + vo
    vo += vCount
    io += mesh.indices.length
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }))
  mesh.frustumCulled = false
  return mesh
}

export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true

  // 밝은 배경 위에서는 빛을 덜 준다. 그러지 않으면 면이 하얗게 날아가 경계가 사라진다.
  scene.add(new AmbientLight(0xffffff, 1.25))
  const sun = new DirectionalLight(0xffffff, 0.9)
  sun.position.set(20, 40, 20)
  scene.add(sun)

  let content = new Group()
  scene.add(content)

  // **설비는 한 덩어리로 합쳐 그린다.** 설비마다 메시·재질을 따로 두면 매 프레임 그리기 호출이 설비 수만큼
  // 나간다. 성수 기계 파일은 1만 8천 개라 시점을 돌릴 때마다 버벅였다. 지금은 형상을 하나로 합치고, 설비별
  // 색은 꼭짓점 색으로, 흐리게 할 것은 같은 형상을 공유하는 두 번째 메시(반투명)로 옮겨 그린다.
  // 그리기 호출이 설비 수와 상관없이 두 번이다.
  let parts: Part[] = []
  let partById = new Map<string, Part>()
  let fullIndex = new Uint32Array(0)
  let colors: BufferAttribute | null = null
  let solid: Mesh | null = null
  let faded: Mesh | null = null
  // 내력벽. 고르기 대상이 아니다(pick 은 설비만 본다). 벽 너머의 설비를 누를 수 있어야 해서다.
  // 층마다 한 덩어리. 층별 보기에서 층 단위로 켜고 끈다.
  let walls = new Map<string, Mesh>()
  let wallsVisible = false
  const slabs = new Map<string, Mesh>()
  let storeyFilter: string | null = null
  let lastModel: Model | null = null
  /** 층별 보기로 가린 설비. 흐리게 칠한 것(fadedIds)과 따로 든다 — 가린 것은 아예 그리지 않는다. */
  let hiddenIds = new Set<string>()
  let pickHandler: (id: string | null) => void = () => {}

  // **움직일 때만 다시 그린다.** 가만히 있을 때도 매 프레임 1만 8천 개를 다시 그리면 화면 전체(스크롤,
  // 입력칸)가 같이 느려진다. 시점이 바뀌거나 색·모델이 바뀌었을 때만 그린다.
  let dirty = true
  const invalidate = () => {
    dirty = true
  }
  controls.addEventListener('change', invalidate)

  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let pressedAt: { x: number; y: number } | null = null

  // --- 끌어 옮기기(편집 모드) -------------------------------------------------------------
  //
  // 고른 설비만 끈다. 아무 설비나 끌리면 시점을 돌리려다 설비를 옮기게 된다. 끄는 동안은 합친 형상의 그
  // 설비 꼭짓점만 밀어 미리 보이고, 놓을 때 한 번만 알린다 — 소속 재판정은 놓은 뒤 lib/edit.ts 가 한다.
  // 캡처 단계에서 받아 OrbitControls 보다 먼저 가로챈다(같은 대상에서는 캡처 리스너가 먼저 돈다).
  let dragEnabled = false
  let selectedPart: string | null = null
  let dragEndHandler: (id: string, delta: readonly [number, number, number]) => void = () => {}
  let dragging: { part: Part; plane: Plane; start: Vector3; last: Vector3; startX: number; startY: number } | null = null
  const dragHit = new Vector3()
  const rayAt = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    return raycaster.ray
  }
  /** 합친 형상에서 설비 하나의 꼭짓점을 밀고 상자도 같이 옮긴다. */
  function shiftPart(part: Part, dx: number, dz: number) {
    const pos = solid?.geometry.getAttribute('position') as BufferAttribute | undefined
    if (!pos) return
    for (let v = part.vStart; v < part.vStart + part.vCount; v++) {
      pos.setX(v, pos.getX(v) + dx)
      pos.setZ(v, pos.getZ(v) + dz)
    }
    pos.needsUpdate = true
    part.box.translate(new Vector3(dx, 0, dz))
    dirty = true
  }
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!dragEnabled || e.button !== 0 || !selectedPart) return
      const ray = rayAt(e)
      if (pick(ray) !== selectedPart) return
      const part = partById.get(selectedPart)
      if (!part) return
      const center = part.box.getCenter(new Vector3())
      const plane = new Plane(new Vector3(0, 1, 0), -center.y)
      if (!ray.intersectPlane(plane, dragHit)) return
      e.stopImmediatePropagation()
      controls.enabled = false
      canvas.setPointerCapture(e.pointerId)
      dragging = { part, plane, start: dragHit.clone(), last: dragHit.clone(), startX: e.clientX, startY: e.clientY }
    },
    { capture: true },
  )
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    if (!rayAt(e).intersectPlane(dragging.plane, dragHit)) return
    shiftPart(dragging.part, dragHit.x - dragging.last.x, dragHit.z - dragging.last.z)
    dragging.last.copy(dragHit)
  })
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return
    const d = dragging
    dragging = null
    controls.enabled = true
    canvas.releasePointerCapture?.(e.pointerId)
    // 거의 안 움직였으면 옮긴 게 아니다. 미리 민 것을 되돌린다.
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 4) {
      shiftPart(d.part, d.start.x - d.last.x, d.start.z - d.last.z)
      return
    }
    // three.js 좌표(x, 높이, -y) → IFC 평면(x, y).
    dragEndHandler(d.part.id, [d.last.x - d.start.x, -(d.last.z - d.start.z), 0])
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)

  canvas.addEventListener('pointerdown', (e) => {
    pressedAt = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointerup', (e) => {
    // 시점을 돌린 것과 고른 것을 가른다. 끌었으면 고르기가 아니다.
    if (!pressedAt) return
    const dragged = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 4
    pressedAt = null
    if (dragged) return

    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    pickHandler(pick(raycaster.ray))
  })

  // 누르면 고를 수 있는 곳에 올라가 있으면 손가락 모양으로 바꾼다. 고르는 것과 같은 pick 을 쓰므로
  // 흐리게 칠한 설비 위에서는 바뀌지 않는다. 마우스가 움직일 때마다 재지 않고 한 프레임에 한 번만 잰다.
  // 시점이 바뀌어도(휠로 확대) 마우스 아래가 달라지니 다시 잰다.
  let hoverAt: { x: number; y: number } | null = null
  let hoverPending = false
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons !== 0) return // 끄는 중에는 시점을 돌리는 것이지 고르려는 것이 아니다.
    hoverAt = { x: e.clientX, y: e.clientY }
    hoverPending = true
  })
  canvas.addEventListener('pointerleave', () => {
    hoverAt = null
    canvas.style.cursor = ''
  })
  controls.addEventListener('change', () => {
    if (hoverAt) hoverPending = true
  })
  function updateHover() {
    hoverPending = false
    if (!hoverAt) return
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((hoverAt.x - rect.left) / rect.width) * 2 - 1
    pointer.y = -((hoverAt.y - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    canvas.style.cursor = pick(raycaster.ray) ? 'pointer' : ''
  }

  /**
   * 광선에 맞은 설비. 합친 형상의 삼각형 수백만 개를 전부 보지 않고, 설비별 상자에 먼저 맞춰 본 뒤
   * 맞은 설비의 삼각형만 본다. 흐리게 칠한 설비는 고르지 않는다(보이지 않는 것을 고르면 헷갈린다).
   */
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const hitPoint = new Vector3()
  function pick(ray: Ray): string | null {
    const geometry = solid?.geometry
    if (!geometry) return null
    const pos = geometry.getAttribute('position') as BufferAttribute
    const candidates: { part: Part; d: number }[] = []
    for (const part of parts) {
      if (fadedIds.has(part.id) || hiddenIds.has(part.id)) continue
      if (ray.intersectBox(part.box, hitPoint)) candidates.push({ part, d: hitPoint.distanceToSquared(ray.origin) })
    }
    candidates.sort((x, y) => x.d - y.d)
    let best: { id: string; d: number } | null = null
    for (const { part, d } of candidates) {
      if (best && d > best.d) break
      for (let k = part.iStart; k < part.iStart + part.iCount; k += 3) {
        a.fromBufferAttribute(pos, fullIndex[k])
        b.fromBufferAttribute(pos, fullIndex[k + 1])
        c.fromBufferAttribute(pos, fullIndex[k + 2])
        if (!ray.intersectTriangle(a, b, c, false, hitPoint)) continue
        const dist = hitPoint.distanceToSquared(ray.origin)
        if (!best || dist < best.d) best = { id: part.id, d: dist }
      }
    }
    return best?.id ?? null
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas
    if (w === 0 || h === 0) return
    const ratio = Math.min(window.devicePixelRatio, 2)
    if (canvas.width === Math.round(w * ratio) && canvas.height === Math.round(h * ratio)) return
    renderer.setPixelRatio(ratio)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    dirty = true
  }

  let running = true
  function tick() {
    if (!running) return
    resize()
    // 관성(damping)으로 도는 동안에는 update 가 참을 돌려준다. 그동안만 계속 그린다.
    if (controls.update()) dirty = true
    if (dirty) {
      renderer.render(scene, camera)
      dirty = false
    }
    if (hoverPending) updateHover()
    requestAnimationFrame(tick)
  }
  tick()

  /**
   * 상자가 화면에 꽉 차도록 카메라를 놓는다.
   *
   * 긴 변 하나만 보고 거리를 잡으면 안 된다. 세로 시야각으로만 계산하면 가로로 넓적한 건물이
   * 화면 밖으로 삐져나가고, 비스듬히 보는 각도에서는 더 커 보인다. 외접구 반지름을 가로·세로
   * 시야각 중 **좁은 쪽**에 맞춘다.
   */
  function fit(box: Box3) {
    const sphere = box.getBoundingSphere(new Sphere())
    if (sphere.radius <= 0) return

    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1.6))
    const distance = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1

    controls.target.copy(sphere.center)
    camera.position.copy(sphere.center).add(new Vector3(1, 0.65, 1).normalize().multiplyScalar(distance))
    camera.near = Math.max(distance / 1000, 0.01)
    camera.far = distance * 10
    camera.updateProjectionMatrix()
    controls.update()
    dirty = true
  }

  let fadedIds = new Set<string>()

  /** 설비 하나의 색을 꼭짓점 색에 칠한다. */
  const tint = new Color()
  function paintPart(part: Part, hex: number) {
    if (!colors) return
    tint.setHex(hex)
    const arr = colors.array as Float32Array
    for (let v = part.vStart; v < part.vStart + part.vCount; v++) {
      arr[v * 3] = tint.r
      arr[v * 3 + 1] = tint.g
      arr[v * 3 + 2] = tint.b
    }
  }

  /** 보이는(진한) 설비와 흐린 설비의 삼각형 목록을 다시 짠다. 형상은 둘이 같이 쓴다. */
  function splitIndex() {
    if (!solid || !faded) return
    let solidCount = 0
    let fadedCount = 0
    for (const part of parts) {
      if (hiddenIds.has(part.id)) continue
      if (fadedIds.has(part.id)) fadedCount += part.iCount
      else solidCount += part.iCount
    }
    const solidIdx = new Uint32Array(solidCount)
    const fadedIdx = new Uint32Array(fadedCount)
    let si = 0
    let fi = 0
    for (const part of parts) {
      if (hiddenIds.has(part.id)) continue
      const slice = fullIndex.subarray(part.iStart, part.iStart + part.iCount)
      if (fadedIds.has(part.id)) {
        fadedIdx.set(slice, fi)
        fi += slice.length
      } else {
        solidIdx.set(slice, si)
        si += slice.length
      }
    }
    solid.geometry.setIndex(new BufferAttribute(solidIdx, 1))
    faded.geometry.setIndex(new BufferAttribute(fadedIdx, 1))
    faded.visible = fadedCount > 0
  }

  /**
   * 고른 층만 남긴다. 설비는 인덱스에서 빼고(그리기 호출 수는 그대로 둘), 판과 벽은 층 덩어리째 끈다.
   * 층이 없는 설비(층 정보가 없는 파일)는 없다 — 임포트가 설비를 늘 어느 층에 넣는다.
   */
  function applyStoreyFilter() {
    hiddenIds = storeyFilter === null ? new Set() : new Set(parts.filter((p) => p.storeyId !== storeyFilter).map((p) => p.id))
    for (const [id, mesh] of slabs) mesh.visible = storeyFilter === null || id === storeyFilter
    for (const [id, mesh] of walls) mesh.visible = wallsVisible && (storeyFilter === null || id === storeyFilter)
    splitIndex()
    dirty = true
  }

  /** 보이는 것 전체가 화면에 들어오게 카메라를 맞춘다. */
  function fitVisible() {
    const box = new Box3()
    for (const part of parts) if (!hiddenIds.has(part.id) && !part.box.isEmpty()) box.union(part.box)
    for (const [, mesh] of slabs) if (mesh.visible) box.union(new Box3().setFromObject(mesh))
    if (!box.isEmpty()) fit(box)
  }

  function disposeContent() {
    content.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose()
        ;(o.material as { dispose(): void }).dispose()
      }
    })
    scene.remove(content)
  }

  return {
    setModel(model, meshes, offsets) {
      // 같은 모델을 다시 그리는 것(편집 뒤)이면 카메라를 그대로 둔다. 편집할 때마다 시점이 튀면 방금 옮긴
      // 설비를 놓친다. 다른 파일을 열었을 때만 건물 전체에 맞춘다.
      const sameModel = model === lastModel
      lastModel = model
      // 이전 모델의 지오메트리를 놓아 준다. 파일을 여러 번 열면 GPU 메모리가 쌓인다.
      disposeContent()
      content = new Group()
      parts = []
      partById = new Map()
      fadedIds = new Set()
      hiddenIds = new Set()
      slabs.clear()
      walls = new Map()
      // 고른 층이 새 모델에 없으면(다른 파일을 열었다) 전체로 돌아간다.
      if (storeyFilter !== null && !model.storeys.some((s) => s.id === storeyFilter)) storeyFilter = null

      const colorOf = systemColors(model)
      // 배관이 방 안을 지나므로 판을 옅게 깐다. 진하면 배관이 판에 묻힌다. 메시에는 벽도 들어 있으니
      // 설비 형상이 있는지로 가른다.
      const hasEquipmentMeshes = !!meshes && model.storeys.some((s) => s.equipment.some((e) => meshes.has(e.id)))
      const slabOpacity = hasEquipmentMeshes ? 0.25 : 0.8

      // 공간 판도 층마다 하나로 합친다. 성수는 방이 934개다.
      model.storeys.forEach((storey, i) => {
        const color = STOREY_COLORS[i % STOREY_COLORS.length]
        const plates: BufferGeometry[] = []
        for (const space of storey.spaces) {
          const mesh = spaceMesh(space.footprint, color, slabOpacity)
          if (!mesh) continue
          mesh.geometry.translate(0, storey.elevation, 0)
          plates.push(mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry)
          ;(mesh.material as { dispose(): void }).dispose()
        }
        if (plates.length === 0) return
        const merged = mergeGeometries(plates)
        for (const g of plates) g.dispose()
        if (merged) {
          const slab = new Mesh(merged, new MeshLambertMaterial({ color, transparent: true, opacity: slabOpacity, side: DoubleSide }))
          slabs.set(storey.id, slab)
          content.add(slab)
        }
      })

      // 설비: 형상이 있으면 그 형상, 없고 좌표만 있으면 작은 상자. 좌표도 없으면 찍지 않는다 —
      // 원점에 찍으면 거기 있는 것처럼 보인다.
      const pieces: { id: string; storeyId: string; color: number; p: ArrayLike<number>; n: ArrayLike<number>; i: ArrayLike<number> }[] = []
      for (const storey of model.storeys) {
        for (const equipment of storey.equipment) {
          const color = equipment.systemId ? (colorOf.get(equipment.systemId) ?? NO_SYSTEM) : NO_SYSTEM
          const data = meshes?.get(equipment.id)
          const off = offsets?.get(equipment.id)
          if (data && off) {
            // 사람이 옮긴 설비. 형상은 BIM 자리에 있으니 이동량만큼 민 사본을 그린다(IFC → three.js 좌표).
            const p = Float32Array.from(data.positions)
            for (let k = 0; k < p.length; k += 3) {
              p[k] += off[0]
              p[k + 1] += off[2]
              p[k + 2] -= off[1]
            }
            pieces.push({ id: equipment.id, storeyId: storey.id, color, p, n: data.normals, i: data.indices })
          } else if (data) {
            pieces.push({ id: equipment.id, storeyId: storey.id, color, p: data.positions, n: data.normals, i: data.indices })
          } else if (equipment.position) {
            const box = new BoxGeometry(0.4, 0.4, 0.4)
            box.translate(...toScene(equipment.position))
            pieces.push({
              id: equipment.id,
              storeyId: storey.id,
              color,
              p: box.getAttribute('position').array,
              n: box.getAttribute('normal').array,
              i: box.index!.array,
            })
            box.dispose()
          }
        }
      }

      let vTotal = 0
      let iTotal = 0
      for (const piece of pieces) {
        vTotal += piece.p.length / 3
        iTotal += piece.i.length
      }
      const positions = new Float32Array(vTotal * 3)
      const normals = new Float32Array(vTotal * 3)
      fullIndex = new Uint32Array(iTotal)
      let vo = 0
      let io = 0
      for (const piece of pieces) {
        const vCount = piece.p.length / 3
        positions.set(piece.p, vo * 3)
        normals.set(piece.n, vo * 3)
        for (let k = 0; k < piece.i.length; k++) fullIndex[io + k] = piece.i[k] + vo
        const box = new Box3()
        for (let v = 0; v < vCount; v++) {
          box.expandByPoint(hitPoint.set(piece.p[v * 3], piece.p[v * 3 + 1], piece.p[v * 3 + 2]))
        }
        const part: Part = { id: piece.id, storeyId: piece.storeyId, color: piece.color, vStart: vo, vCount, iStart: io, iCount: piece.i.length, box }
        parts.push(part)
        partById.set(part.id, part)
        vo += vCount
        io += piece.i.length
      }

      solid = null
      faded = null
      colors = null
      if (parts.length > 0) {
        const positionAttr = new BufferAttribute(positions, 3)
        const normalAttr = new BufferAttribute(normals, 3)
        colors = new BufferAttribute(new Float32Array(vTotal * 3), 3)
        for (const part of parts) paintPart(part, part.color)

        const solidGeometry = new BufferGeometry()
        const fadedGeometry = new BufferGeometry()
        for (const g of [solidGeometry, fadedGeometry]) {
          g.setAttribute('position', positionAttr)
          g.setAttribute('normal', normalAttr)
          g.setAttribute('color', colors)
        }
        solid = new Mesh(solidGeometry, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }))
        // 아주 옅게 남긴다. 아예 지우면 연결망이 건물 어디쯤인지 알 수 없고, 진하면 가는 배관 한 줄이 묻힌다.
        faded = new Mesh(
          fadedGeometry,
          new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.08, depthWrite: false }),
        )
        content.add(solid, faded)
        splitIndex()
        // 합친 형상은 경계가 모델 전체라, 화면 밖 판정을 꺼도 잃는 것이 없다(늘 화면 안에 있다).
        solid.frustumCulled = false
        faded.frustumCulled = false
      }
      for (const storey of model.storeys) {
        const mesh = wallMesh(storey.walls, meshes)
        if (!mesh) continue
        walls.set(storey.id, mesh)
        content.add(mesh)
      }
      applyStoreyFilter()

      scene.add(content)
      dirty = true

      // 건물이 화면에 꽉 차게 카메라를 놓는다. 원점 근처에 고정해 두면 실제 좌표가 먼
      // 모델이 화면 밖으로 나가서, 임포트가 잘 됐는데도 빈 화면처럼 보인다.
      if (sameModel) return
      // 층 하나를 보고 있었으면 그 층에 맞춘다.
      if (storeyFilter !== null) return fitVisible()
      const box = new Box3().setFromObject(content)
      if (box.isEmpty()) return
      fit(box)
    },

    setHighlight(highlight) {
      selectedPart = highlight?.selected ?? null
      const nextFaded = new Set<string>()
      for (const part of parts) {
        const id = part.id
        let next = part.color
        if (highlight) {
          if (id === highlight.selected) next = PICK_COLORS.selected
          else if (highlight.upstream.has(id)) next = PICK_COLORS.upstream
          else if (highlight.downstream.has(id)) next = PICK_COLORS.downstream
          else if (highlight.ruleUpstream?.has(id)) next = PICK_COLORS.ruleUpstream
          else if (highlight.ruleDownstream?.has(id)) next = PICK_COLORS.ruleDownstream
          else if (highlight.linked.has(id)) next = highlight.keepColor ? part.color : PICK_COLORS.linked
          // 고른 것과 상관없는 설비는 흐리게 한다. 지우지 않으면 연결망이 숲에 묻힌다.
          else nextFaded.add(id)
        }
        paintPart(part, next)
      }
      if (colors) colors.needsUpdate = true
      const changed = nextFaded.size !== fadedIds.size || [...nextFaded].some((id) => !fadedIds.has(id))
      fadedIds = nextFaded
      if (changed) splitIndex()
      dirty = true
      // 흐리게 칠한 것은 고를 수 없으니, 계통을 바꾸면 마우스 아래가 고를 수 있는지도 바뀐다.
      if (changed && hoverAt) hoverPending = true
    },

    setWallsVisible(on) {
      wallsVisible = on
      applyStoreyFilter()
    },

    setDragEnabled(on) {
      dragEnabled = on
    },

    onDragEnd(handler) {
      dragEndHandler = handler
    },

    setStorey(storeyId) {
      if (storeyId === storeyFilter) return
      storeyFilter = storeyId
      applyStoreyFilter()
      fitVisible()
    },

    onPick(handler) {
      pickHandler = handler
    },

    focus(id) {
      const part = partById.get(id)
      if (!part || part.box.isEmpty()) return
      const center = part.box.getCenter(new Vector3())
      // 거리는 그대로 두고 바라보는 곳만 옮긴다. 확대까지 하면 어디를 보고 있었는지 잃는다.
      const offset = camera.position.clone().sub(controls.target)
      controls.target.copy(center)
      camera.position.copy(center).add(offset)
      controls.update()
      dirty = true
    },

    frame(ids) {
      const box = new Box3()
      for (const id of ids) {
        const part = partById.get(id)
        if (part) box.union(part.box)
      }
      if (box.isEmpty()) return
      fit(box)
    },

    dispose() {
      running = false
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      disposeContent()
      renderer.dispose()
    },
  }
}
