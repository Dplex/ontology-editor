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
  ConeGeometry,
  OctahedronGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
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
import type { Model, Vec2, Vec3 } from './model'
import type { MeshMap } from './ifc/import'
import { pointInPolygon } from './mapping'

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

/**
 * 편집 모드에서 고른 설비에 붙은 연결 하나. 화살표로 그리고, 누르면 흐름 방향을 바꾼다.
 * 뷰어는 흐름의 뜻을 모른다 — 무엇을 어떤 출처로 그릴지는 부르는 쪽이 정한다.
 */
export type Arrow = {
  key: string
  a: string
  b: string
  /** 흐름이 나가는 쪽. null 이면 방향을 모른다(화살촉 없이 점선). */
  from: string | null
  source: 'port' | 'edit' | 'rule' | 'none'
  /** 키보드([ ])로 짚은 연결. 가운데에 표시를 달아 D 가 어느 연결을 바꿀지 보인다. */
  active?: boolean
}

/**
 * 연결 화살표 색. 설비 선택의 상류·하류 색과 달리 **방향의 출처**로 가른다 — 편집할 때 궁금한 것은 어느 쪽이
 * 상류인가보다 그 방향을 누가 말했는가(고칠 수 있는가)다. 포트(BIM)는 진하게, 사람이 정한 것은 화면의 액센트
 * 하나로, 규칙(사전)은 옅게 둔다. 규칙과 방향 모름은 점선이다.
 */
export const ARROW_COLORS = { port: 0x39424e, edit: 0x2f6fed, rule: 0xa3acb7, none: 0xc2c8cf }
/**
 * 다크 테마의 화살표 색. 라이트 색을 그대로 두면 포트 방향(진한 회색)이 어두운 바탕에 묻혀, 가장 믿을 만한
 * 방향이 가장 안 보인다. 밝기 순서(포트 > 편집 > 규칙 > 모름)는 라이트와 같게 둔다.
 */
export const ARROW_COLORS_DARK = { port: 0xd5d9e0, edit: 0x6f9bf5, rule: 0x7c8494, none: 0x596070 }
export const arrowColors = (dark: boolean) => (dark ? ARROW_COLORS_DARK : ARROW_COLORS)
/** 꼭짓점 손잡이. 화면의 액센트 하나와 같은 색이다(styles.css 의 --accent). */
const handleColor = (dark: boolean) => (dark ? 0x6f9bf5 : 0x2f6fed)

/** 고른 물리존의 외곽선. 닫는 점(첫 점과 같은 끝 점)은 빼고 넘긴다. */
export type SpaceHandles = {
  id: string
  ring: readonly Vec2[]
  elevation: number
  /** 키보드([ ])로 짚은 꼭짓점. 크게, 글자색으로 그려 방향키가 어느 점을 옮길지 보인다. */
  active?: number | null
}

export type Viewer = {
  /** keepView 면 시점을 그대로 둔다. 편집한 뒤 다시 그릴 때마다 건물 전체로 튀면 어디를 고치던 중인지 잃는다. */
  setModel(model: Model, meshes?: MeshMap, options?: { keepView?: boolean }): void
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
  /** 편집 모드를 켜고 끈다. 끄면 3D 는 보기 전용이고, 누르고 끄는 것은 전부 시점 조작이다. */
  setEditMode(on: boolean): void
  /** 편집 모드에서 무언가를 끄는 중인가. 그동안의 Ctrl+Z 는 받지 않는다(Esc 가 취소다). */
  isDragging(): boolean
  /**
   * 설비 하나의 형상만 옮긴다(IFC 좌표로 옮긴 거리). 표에서 고친 좌표나 되돌리기를 3D 에 반영할 때 쓴다 —
   * 모델 전체를 다시 만들면 성수 크기에서 2초가 걸린다. 그 설비가 3D 에 없으면 false 를 돌려주고, 그때는
   * 부르는 쪽이 setModel 로 다시 만든다.
   */
  shiftEquipment(id: string, delta: Vec3): boolean
  /** 편집 모드에서 고른 설비를 끌어 놓으면 부른다. 옮긴 거리를 IFC 좌표(미터)로 넘긴다. 높이는 그대로다. */
  onEquipmentMove(handler: (id: string, delta: Vec3) => void): void
  /** 편집 모드에서 설비가 아닌 바닥(물리존 판)을 누르면 부른다. */
  onPickSpace(handler: (spaceId: string | null) => void): void
  /** 고른 물리존의 꼭짓점 손잡이. null 이면 지운다. */
  setSpaceHandles(space: SpaceHandles | null): void
  /** 손잡이를 끌어 놓으면 부른다. IFC 평면 좌표로 넘긴다. */
  onVertexMove(handler: (spaceId: string, index: number, to: Vec2) => void): void
  /** 연결 화살표. 빈 배열이면 지운다. */
  setArrows(arrows: readonly Arrow[]): void
  onArrowClick(handler: (key: string) => void): void
  /** 물리존 판만 다시 만든다. 경계 하나를 고쳤다고 설비 1만 8천 개까지 다시 만들 까닭이 없다. */
  updateSpaces(model: Model): void
  /** 화살표·손잡이 색을 테마에 맞춘다. 바탕이 투명이라 페이지 색이 그대로 비친다. */
  setDark(on: boolean): void
  /** 건물 전체가 화면에 들어오게 한다. */
  frameAll(): void
  /** 물리존 하나가 화면에 들어오게 한다. */
  frameSpace(id: string): void
  /**
   * 화면의 오른쪽·위쪽이 IFC 평면에서 어느 쪽인가(단위 벡터). 방향키로 설비를 옮길 때 쓴다. 비스듬히 보면
   * 화면 위쪽은 바닥에서 "멀어지는 쪽" 이다.
   */
  planeAxes(): { right: Vec2; up: Vec2 }
  dispose(): void
}

/** 합친 형상 안에서 설비 하나가 차지하는 자리. 강조·선택·시점 맞추기가 이 표로 설비를 찾는다. */
type Part = {
  id: string
  color: number
  /** 꼭짓점 범위(색을 바꿀 때)와 삼각형 인덱스 범위(보이기·고르기). */
  vStart: number
  vCount: number
  iStart: number
  iCount: number
  box: Box3
}

/** 내력벽과 내력 여부를 모르는 벽을 한 덩어리로 합친다. 형상을 못 얻은 벽은 건너뛴다. */
function wallMesh(model: Model, meshes?: MeshMap): Mesh | null {
  const pieces: { color: Color; mesh: { positions: Float32Array; normals: Float32Array; indices: Uint32Array } }[] = []
  for (const storey of model.storeys) {
    for (const wall of storey.walls) {
      if (wall.loadBearing === false) continue
      const mesh = meshes?.get(wall.id)
      if (!mesh) continue
      pieces.push({ color: new Color(wall.loadBearing ? WALL_COLORS.loadBearing : WALL_COLORS.unknown), mesh })
    }
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
  let walls: Mesh | null = null
  let wallsVisible = false
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

  function rayAt(x: number, y: number): Ray {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((x - rect.left) / rect.width) * 2 - 1
    pointer.y = -((y - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    return raycaster.ray
  }

  const projected = new Vector3()
  /** 장면의 점이 화면(클라이언트 좌표)의 어디에 찍히는가. 카메라 뒤면 null. */
  function toScreen(p: Vector3): { x: number; y: number } | null {
    projected.copy(p).project(camera)
    if (projected.z > 1) return null
    const rect = canvas.getBoundingClientRect()
    return { x: ((projected.x + 1) / 2) * rect.width + rect.left, y: ((1 - projected.y) / 2) * rect.height + rect.top }
  }

  // --- 편집 ------------------------------------------------------------------
  //
  // 편집 모드에서만 3D 가 모델을 고친다. 뷰어는 끌어 놓은 자리만 알리고, 소속 재판정과 변경 기록은 부르는
  // 쪽이 edit.ts 로 한다. 손잡이·화살표는 모델과 따로(overlay) 두고, 모델을 다시 만들면 비운다 — 부르는 쪽이
  // 새 모델 기준으로 다시 넘겨야 예전 좌표의 손잡이가 남지 않는다.
  let editMode = false
  let dark = false
  let selectedPart: string | null = null
  /** 좌표가 있는 설비. 좌표가 없는 것은 끌지 않는다 — 끌면 원점 근처 어딘가에서 시작한 것이 된다. */
  let movable = new Set<string>()
  /** 물리존 판의 윗면. 편집 모드에서 바닥을 눌러 물리존을 고를 때 쓴다. */
  let spaceTargets: { id: string; y: number; ring: readonly Vec2[] }[] = []
  let moveHandler: (id: string, delta: Vec3) => void = () => {}
  let spacePickHandler: (id: string | null) => void = () => {}
  let vertexHandler: (spaceId: string, index: number, to: Vec2) => void = () => {}
  let arrowHandler: (key: string) => void = () => {}

  const overlay = new Group()
  scene.add(overlay)
  let handleSpace: SpaceHandles | null = null
  let handles: Mesh[] = []
  let outline: LineLoop | null = null
  let arrowSpecs: readonly Arrow[] = []
  let arrowObjects: (Line | Mesh)[] = []
  let arrowSegs: { key: string; a: Vector3; b: Vector3 }[] = []

  type Drag =
    | { kind: 'equipment'; part: Part; original: Float32Array; box: Box3; plane: Plane; start: Vector3; delta: Vector3 }
    | { kind: 'vertex'; index: number; plane: Plane; offset: Vector3; at: Vector3 }
  let drag: (Drag & { x: number; y: number; moved: boolean }) | null = null

  function disposeObject(o: Line | Mesh) {
    overlay.remove(o)
    o.geometry.dispose()
    ;(o.material as { dispose(): void }).dispose()
  }

  /** 손잡이는 화면에서 늘 같은 크기로 보이게 한다. 성수처럼 넓은 모델에서 10cm 상자는 점도 안 된다. */
  function scaleHandles() {
    for (const h of handles) h.scale.setScalar(camera.position.distanceTo(h.position) * 0.012 * (h.userData.size ?? 1))
  }

  function drawHandles() {
    for (const h of handles) disposeObject(h)
    handles = []
    if (outline) disposeObject(outline)
    outline = null
    dirty = true
    if (!editMode || !handleSpace || handleSpace.ring.length < 3) return
    // 판 윗면(바닥 + 0.1) 바로 위에 띄운다. 같은 높이면 판과 겹쳐 깜빡인다. 판에 가려지지 않게 깊이는 안 본다.
    const y = handleSpace.elevation + 0.12
    const points = handleSpace.ring.map(([x, z]) => new Vector3(...toScene([x, z, 0])).setY(y))
    outline = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: handleColor(dark), depthTest: false }))
    outline.renderOrder = 10
    overlay.add(outline)
    points.forEach((p, i) => {
      const active = i === handleSpace!.active
      const color = active ? (dark ? 0xffffff : 0x1a1d21) : handleColor(dark)
      const h = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color, depthTest: false }))
      h.userData.size = active ? 1.7 : 1
      h.position.copy(p)
      h.renderOrder = 11
      overlay.add(h)
      handles.push(h)
    })
    scaleHandles()
  }

  function moveHandle(index: number, at: Vector3) {
    const h = handles[index]
    if (!h) return
    h.position.set(at.x, h.position.y, at.z)
    if (outline) {
      const position = outline.geometry.getAttribute('position') as BufferAttribute
      position.setXYZ(index, at.x, h.position.y, at.z)
      position.needsUpdate = true
    }
    scaleHandles()
  }

  function drawArrows() {
    for (const o of arrowObjects) disposeObject(o)
    arrowObjects = []
    arrowSegs = []
    dirty = true
    if (!editMode) return
    for (const spec of arrowSpecs) {
      const pa = partById.get(spec.a)
      const pb = partById.get(spec.b)
      if (!pa || !pb) continue
      const ca = pa.box.getCenter(new Vector3())
      const cb = pb.box.getCenter(new Vector3())
      const len = ca.distanceTo(cb)
      if (len < 1e-6) continue
      const color = arrowColors(dark)[spec.source]
      // 실선은 누군가(BIM 포트나 사람)가 말한 방향이다. 규칙이 짐작한 것과 방향 모름은 점선이다.
      const dashed = spec.source === 'rule' || spec.source === 'none'
      const material = dashed
        ? new LineDashedMaterial({ color, dashSize: len / 10, gapSize: len / 20, depthTest: false })
        : new LineBasicMaterial({ color, depthTest: false })
      const line = new Line(new BufferGeometry().setFromPoints([ca, cb]), material)
      if (dashed) line.computeLineDistances()
      line.renderOrder = 10
      overlay.add(line)
      arrowObjects.push(line)
      if (spec.from === spec.a || spec.from === spec.b) {
        const [tail, head] = spec.from === spec.a ? [ca, cb] : [cb, ca]
        const dir = head.clone().sub(tail).normalize()
        const r = Math.min(Math.max(len * 0.07, 0.05), 0.4)
        const cone = new Mesh(new ConeGeometry(r, r * 3, 12), new MeshBasicMaterial({ color, depthTest: false }))
        cone.position.copy(tail).addScaledVector(dir, len * 0.6)
        cone.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
        cone.renderOrder = 11
        overlay.add(cone)
        arrowObjects.push(cone)
      }
      if (spec.active) {
        // 키보드로 짚은 연결. 선 색은 출처라 그대로 두고 마름모를 단다. 파랑·초록은 층 판과 계통이 이미 써서
        // 묻히므로 글자색(라이트는 검정, 다크는 흰색)으로 둔다. 화살촉(0.6)과 겹치지 않게 0.4 에 단다.
        const r = Math.min(Math.max(len * 0.06, 0.06), 0.35)
        const mark = new Mesh(new OctahedronGeometry(r), new MeshBasicMaterial({ color: dark ? 0xffffff : 0x1a1d21, depthTest: false }))
        mark.position.copy(ca).lerp(cb, spec.from === spec.b ? 0.6 : 0.4)
        mark.renderOrder = 12
        overlay.add(mark)
        arrowObjects.push(mark)
      }
      arrowSegs.push({ key: spec.key, a: ca, b: cb })
    }
  }

  /** 손잡이는 화면에서 잰다. 크기가 시점 따라 바뀌어도 누르는 너비는 같아야 한다. */
  function hitHandle(x: number, y: number): number | null {
    let best: { index: number; d: number } | null = null
    for (let index = 0; index < handles.length; index++) {
      const at = toScreen(handles[index].position)
      if (!at) continue
      const d = Math.hypot(at.x - x, at.y - y)
      if (d <= 10 && (!best || d < best.d)) best = { index, d }
    }
    return best?.index ?? null
  }

  /** 화살표도 화면에서 잰다. 양 끝은 설비 위라서(그걸 누르면 설비를 고른다) 가운데 토막만 화살표로 본다. */
  function hitArrow(x: number, y: number): string | null {
    let best: { key: string; d: number } | null = null
    for (const seg of arrowSegs) {
      const a = toScreen(seg.a)
      const b = toScreen(seg.b)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 < 1) continue
      const t = ((x - a.x) * dx + (y - a.y) * dy) / len2
      if (t < 0.2 || t > 0.8) continue
      const d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y)
      if (d <= 7 && (!best || d < best.d)) best = { key: seg.key, d }
    }
    return best?.key ?? null
  }

  /** 광선이 먼저 닿는 물리존 판. 판 윗면에서 외곽선 안에 드는지로 본다. */
  function pickSpace(ray: Ray): string | null {
    let best: { id: string; d: number } | null = null
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const at = new Vector3()
    for (const target of spaceTargets) {
      plane.constant = -target.y
      if (!ray.intersectPlane(plane, at)) continue
      const d = at.distanceToSquared(ray.origin)
      if (best && d >= best.d) continue
      if (pointInPolygon([at.x, -at.z], target.ring)) best = { id: target.id, d }
    }
    return best?.id ?? null
  }

  function placePart(d: Extract<Drag, { kind: 'equipment' }>, delta: Vector3) {
    const position = solid?.geometry.getAttribute('position') as BufferAttribute | undefined
    if (!position) return
    const arr = position.array as Float32Array
    for (let v = 0; v < d.part.vCount; v++) {
      const k = (d.part.vStart + v) * 3
      arr[k] = d.original[v * 3] + delta.x
      arr[k + 1] = d.original[v * 3 + 1] + delta.y
      arr[k + 2] = d.original[v * 3 + 2] + delta.z
    }
    position.needsUpdate = true
    d.part.box.copy(d.box).translate(delta)
  }

  function endDrag(commit: boolean) {
    const d = drag
    if (!d) return
    drag = null
    controls.enabled = true
    canvas.style.cursor = ''
    dirty = true
    if (hoverAt) hoverPending = true
    if (d.kind === 'equipment') {
      if (commit && d.moved) {
        // IFC 는 z 가 높이고 평면 y 의 부호가 뒤집힌다(toScene). 끌기는 수평면 위라 높이는 그대로다.
        moveHandler(d.part.id, [d.delta.x, -d.delta.z, 0])
      } else {
        placePart(d, new Vector3())
        drawArrows()
      }
    } else if (commit && d.moved && handleSpace) {
      vertexHandler(handleSpace.id, d.index, [d.at.x, -d.at.z])
    } else {
      drawHandles()
    }
  }

  // 편집 모드에서 손잡이나 고른 설비 위를 누르면 끌기를 시작한다. OrbitControls 보다 먼저 받도록 capture 로
  // 걸고, 끄는 동안은 시점이 돌지 않게 컨트롤을 끈다.
  canvas.addEventListener(
    'pointerdown',
    (e) => {
      pressedAt = { x: e.clientX, y: e.clientY }
      if (!editMode || e.button !== 0) return
      // 화살표 위에서 누른 것은 떼면서 방향을 바꾸는 누르기다. 끌기를 시작하지 않는다.
      if (hitArrow(e.clientX, e.clientY)) return
      const ray = rayAt(e.clientX, e.clientY)
      const start = new Vector3()
      let next: Drag | null = null
      const index = hitHandle(e.clientX, e.clientY)
      if (index !== null) {
        const at = handles[index].position.clone()
        const plane = new Plane(new Vector3(0, 1, 0), -at.y)
        if (!ray.intersectPlane(plane, start)) return
        next = { kind: 'vertex', index, plane, offset: at.clone().sub(start), at }
      } else {
        // 고른 설비만 끈다. 아무 설비나 끌리면 시점을 돌리려다 덕트를 옮긴다. 고른 설비는 앞에 다른 것이
        // 가려도 잡힌다 — 덕트 사이의 VAV 처럼 가운데가 늘 가려진 설비가 있다. 끌지 않고 떼면 맨 앞의 것을
        // 고른다(pointerup).
        const part = grabbable(ray)
        const position = solid?.geometry.getAttribute('position') as BufferAttribute | undefined
        if (!part || !position) return
        const plane = new Plane(new Vector3(0, 1, 0), -part.box.getCenter(new Vector3()).y)
        if (!ray.intersectPlane(plane, start)) return
        const original = (position.array as Float32Array).slice(part.vStart * 3, (part.vStart + part.vCount) * 3)
        next = { kind: 'equipment', part, original, box: part.box.clone(), plane, start, delta: new Vector3() }
      }
      drag = { ...next, x: e.clientX, y: e.clientY, moved: false }
      controls.enabled = false
      canvas.setPointerCapture(e.pointerId)
      e.stopImmediatePropagation()
      canvas.style.cursor = 'grabbing'
    },
    { capture: true },
  )
  canvas.addEventListener('pointerup', (e) => {
    if (drag) {
      const moved = drag.moved
      const kind = drag.kind
      endDrag(moved)
      // 설비를 잡았다가 끌지 않고 뗀 것은 누르기다. 아래로 내려가 평소처럼 맨 앞의 것을 고른다.
      if (moved || kind === 'vertex') {
        pressedAt = null
        return
      }
    }
    // 시점을 돌린 것과 고른 것을 가른다. 끌었으면 고르기가 아니다.
    if (!pressedAt) return
    const dragged = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 4
    pressedAt = null
    if (dragged) return

    if (editMode) {
      const key = hitArrow(e.clientX, e.clientY)
      if (key) {
        arrowHandler(key)
        return
      }
    }
    const ray = rayAt(e.clientX, e.clientY)
    const id = pick(ray)
    if (id || !editMode) {
      pickHandler(id)
      return
    }
    // 편집 모드에서 설비가 아닌 바닥을 누르면 물리존을 고른다. 경계를 고치는 손잡이가 거기서 뜬다.
    const space = pickSpace(ray)
    if (space) {
      spacePickHandler(space)
    } else {
      pickHandler(null)
      spacePickHandler(null)
    }
  })

  // 누르면 고를 수 있는 곳에 올라가 있으면 손가락 모양으로 바꾼다. 고르는 것과 같은 pick 을 쓰므로
  // 흐리게 칠한 설비 위에서는 바뀌지 않는다. 마우스가 움직일 때마다 재지 않고 한 프레임에 한 번만 잰다.
  // 시점이 바뀌어도(휠로 확대) 마우스 아래가 달라지니 다시 잰다.
  let hoverAt: { x: number; y: number } | null = null
  let hoverPending = false
  canvas.addEventListener('pointermove', (e) => {
    if (drag) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true
      const at = new Vector3()
      if (!rayAt(e.clientX, e.clientY).intersectPlane(drag.plane, at)) return
      if (drag.kind === 'equipment') {
        drag.delta.set(at.x - drag.start.x, 0, at.z - drag.start.z)
        placePart(drag, drag.delta)
        drawArrows()
      } else {
        drag.at.copy(at).add(drag.offset)
        moveHandle(drag.index, drag.at)
      }
      dirty = true
      return
    }
    if (e.buttons !== 0) return // 끄는 중에는 시점을 돌리는 것이지 고르려는 것이 아니다.
    hoverAt = { x: e.clientX, y: e.clientY }
    hoverPending = true
  })
  canvas.addEventListener('pointerleave', () => {
    hoverAt = null
    if (!drag) canvas.style.cursor = ''
  })
  controls.addEventListener('change', () => {
    if (hoverAt) hoverPending = true
  })
  // 끄는 중 Esc 는 끌기를 버리고 제자리로 돌린다. 캔버스는 포커스를 받지 않으므로 창에 건다.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && drag) endDrag(false)
  }
  window.addEventListener('keydown', onKeyDown)

  function updateHover() {
    hoverPending = false
    if (!hoverAt || drag) return
    const { x, y } = hoverAt
    if (editMode && hitHandle(x, y) !== null) {
      canvas.style.cursor = 'grab'
      return
    }
    if (editMode && hitArrow(x, y)) {
      canvas.style.cursor = 'pointer'
      return
    }
    const ray = rayAt(x, y)
    if (editMode && grabbable(ray)) {
      canvas.style.cursor = 'grab'
      return
    }
    const id = pick(ray)
    if (id) canvas.style.cursor = 'pointer'
    else canvas.style.cursor = editMode && pickSpace(ray) ? 'pointer' : ''
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
      if (fadedIds.has(part.id)) continue
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

  /** 광선이 이 설비를 지나가는가. 앞에 다른 것이 있어도 참이다(pick 은 맨 앞의 것만 본다). */
  function hitsPart(ray: Ray, part: Part): boolean {
    const geometry = solid?.geometry
    if (!geometry || !ray.intersectBox(part.box, hitPoint)) return false
    const pos = geometry.getAttribute('position') as BufferAttribute
    for (let k = part.iStart; k < part.iStart + part.iCount; k += 3) {
      a.fromBufferAttribute(pos, fullIndex[k])
      b.fromBufferAttribute(pos, fullIndex[k + 1])
      c.fromBufferAttribute(pos, fullIndex[k + 2])
      if (ray.intersectTriangle(a, b, c, false, hitPoint)) return true
    }
    return false
  }

  /** 끌 수 있는 것: 고른 설비이고 좌표가 있고 흐리게 칠해지지 않았다. */
  function grabbable(ray: Ray): Part | null {
    const part = selectedPart && movable.has(selectedPart) && !fadedIds.has(selectedPart) ? partById.get(selectedPart) : undefined
    return part && hitsPart(ray, part) ? part : null
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
      if (handles.length) scaleHandles()
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
      if (fadedIds.has(part.id)) fadedCount += part.iCount
      else solidCount += part.iCount
    }
    const solidIdx = new Uint32Array(solidCount)
    const fadedIdx = new Uint32Array(fadedCount)
    let si = 0
    let fi = 0
    for (const part of parts) {
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

  function disposeContent() {
    content.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose()
        ;(o.material as { dispose(): void }).dispose()
      }
    })
    scene.remove(content)
  }

  let slabs = new Group()
  let slabOpacity = 0.8

  /** 공간 판. 층마다 하나로 합친다. 성수는 방이 934개다. 편집 모드에서 바닥을 눌러 고를 자리도 같이 만든다. */
  function buildSlabs(model: Model) {
    slabs.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose()
        ;(o.material as { dispose(): void }).dispose()
      }
    })
    content.remove(slabs)
    slabs = new Group()
    spaceTargets = []
    model.storeys.forEach((storey, i) => {
      const color = STOREY_COLORS[i % STOREY_COLORS.length]
      const pieces: BufferGeometry[] = []
      for (const space of storey.spaces) {
        const mesh = spaceMesh(space.footprint, color, slabOpacity)
        if (!mesh) continue
        mesh.geometry.translate(0, storey.elevation, 0)
        pieces.push(mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry)
        ;(mesh.material as { dispose(): void }).dispose()
        // 판 두께가 0.1 이다(spaceMesh). 윗면에서 잰다.
        spaceTargets.push({ id: space.id, y: storey.elevation + 0.1, ring: space.footprint })
      }
      if (pieces.length === 0) return
      const merged = mergeGeometries(pieces)
      for (const g of pieces) g.dispose()
      if (merged) {
        slabs.add(new Mesh(merged, new MeshLambertMaterial({ color, transparent: true, opacity: slabOpacity, side: DoubleSide })))
      }
    })
    content.add(slabs)
    dirty = true
  }

  // e2e 모드에서만 연다. 3D 는 DOM 이 아니라서 테스트가 어디를 눌러야 하는지 알 길이 이것뿐이다.
  if (import.meta.env.MODE === 'e2e') {
    ;(window as unknown as { __viewer?: unknown }).__viewer = {
      part: (id: string) => {
        const part = partById.get(id)
        return part ? toScreen(part.box.getCenter(new Vector3())) : null
      },
      /** 설비 형상 중심의 IFC 좌표. 끌기는 이 높이의 수평면 위에서 움직인다. */
      center: (id: string) => {
        const part = partById.get(id)
        if (!part) return null
        const c = part.box.getCenter(new Vector3())
        return [c.x, -c.z, c.y]
      },
      handles: () => handles.map((h) => toScreen(h.position)),
      arrows: () =>
        arrowSegs.map((seg) => {
          const spec = arrowSpecs.find((a) => a.key === seg.key)
          return { key: seg.key, a: spec?.a, b: spec?.b, from: spec?.from, source: spec?.source, active: !!spec?.active, at: toScreen(seg.a.clone().lerp(seg.b, 0.5)) }
        }),
      point: (p: Vec3) => toScreen(new Vector3(...toScene(p))),
    }
  }

  return {
    setModel(model, meshes, options) {
      // 끄는 중에 모델이 바뀌면 끌던 것은 버린다. 형상을 새로 만드니 되돌릴 것도 없다.
      drag = null
      controls.enabled = true
      // 이전 모델의 지오메트리를 놓아 준다. 파일을 여러 번 열면 GPU 메모리가 쌓인다.
      disposeContent()
      content = new Group()
      slabs = new Group()
      parts = []
      partById = new Map()
      fadedIds = new Set()
      movable = new Set(model.storeys.flatMap((s) => s.equipment.filter((e) => e.position).map((e) => e.id)))
      handleSpace = null
      arrowSpecs = []
      drawHandles()
      drawArrows()

      const colorOf = systemColors(model)
      // 배관이 방 안을 지나므로 판을 옅게 깐다. 진하면 배관이 판에 묻힌다. 메시에는 벽도 들어 있으니
      // 설비 형상이 있는지로 가른다.
      const hasEquipmentMeshes = !!meshes && model.storeys.some((s) => s.equipment.some((e) => meshes.has(e.id)))
      slabOpacity = hasEquipmentMeshes ? 0.25 : 0.8
      buildSlabs(model)

      // 설비: 형상이 있으면 그 형상, 없고 좌표만 있으면 작은 상자. 좌표도 없으면 찍지 않는다 —
      // 원점에 찍으면 거기 있는 것처럼 보인다.
      const pieces: { id: string; color: number; p: ArrayLike<number>; n: ArrayLike<number>; i: ArrayLike<number> }[] = []
      for (const storey of model.storeys) {
        for (const equipment of storey.equipment) {
          const color = equipment.systemId ? (colorOf.get(equipment.systemId) ?? NO_SYSTEM) : NO_SYSTEM
          const data = meshes?.get(equipment.id)
          if (data) {
            pieces.push({ id: equipment.id, color, p: data.positions, n: data.normals, i: data.indices })
          } else if (equipment.position) {
            const box = new BoxGeometry(0.4, 0.4, 0.4)
            box.translate(...toScene(equipment.position))
            pieces.push({
              id: equipment.id,
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
        const part: Part = { id: piece.id, color: piece.color, vStart: vo, vCount, iStart: io, iCount: piece.i.length, box }
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
      walls = wallMesh(model, meshes)
      if (walls) {
        walls.visible = wallsVisible
        content.add(walls)
      }

      scene.add(content)
      dirty = true
      if (options?.keepView) return

      // 건물이 화면에 꽉 차게 카메라를 놓는다. 원점 근처에 고정해 두면 실제 좌표가 먼
      // 모델이 화면 밖으로 나가서, 임포트가 잘 됐는데도 빈 화면처럼 보인다.
      const box = new Box3().setFromObject(content)
      if (box.isEmpty()) return
      fit(box)
    },

    setHighlight(highlight) {
      // 끌 수 있는 것은 고른 설비 하나다(pointerdown 참조).
      selectedPart = highlight?.selected ?? null
      if (hoverAt) hoverPending = true
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
      if (walls) walls.visible = on
      dirty = true
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

    setEditMode(on) {
      editMode = on
      if (!on) endDrag(false)
      drawHandles()
      drawArrows()
      if (hoverAt) hoverPending = true
    },

    isDragging() {
      return drag !== null
    },

    shiftEquipment(id, delta) {
      const part = partById.get(id)
      const position = solid?.geometry.getAttribute('position') as BufferAttribute | undefined
      if (!part || !position) return false
      const [dx, dy, dz] = toScene(delta)
      const arr = position.array as Float32Array
      for (let v = part.vStart; v < part.vStart + part.vCount; v++) {
        arr[v * 3] += dx
        arr[v * 3 + 1] += dy
        arr[v * 3 + 2] += dz
      }
      position.needsUpdate = true
      part.box.translate(new Vector3(dx, dy, dz))
      drawArrows()
      dirty = true
      return true
    },

    onEquipmentMove(handler) {
      moveHandler = handler
    },

    onPickSpace(handler) {
      spacePickHandler = handler
    },

    setSpaceHandles(space) {
      handleSpace = space
      drawHandles()
    },

    onVertexMove(handler) {
      vertexHandler = handler
    },

    setArrows(arrows) {
      arrowSpecs = arrows
      drawArrows()
    },

    onArrowClick(handler) {
      arrowHandler = handler
    },

    updateSpaces(model) {
      buildSlabs(model)
    },

    setDark(on) {
      if (dark === on) return
      dark = on
      drawHandles()
      drawArrows()
    },

    frameAll() {
      const box = new Box3().setFromObject(content)
      if (!box.isEmpty()) fit(box)
    },

    frameSpace(id) {
      const target = spaceTargets.find((t) => t.id === id)
      if (!target || target.ring.length < 3) return
      const box = new Box3()
      for (const [x, y] of target.ring) box.expandByPoint(new Vector3(...toScene([x, y, 0])).setY(target.y))
      // 판만 맞추면 위에서 내려다보는 납작한 상자라 너무 가까이 간다. 층 높이쯤 띄운다.
      box.expandByPoint(box.max.clone().setY(target.y + 3))
      fit(box)
    },

    planeAxes() {
      camera.updateMatrixWorld()
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
      // 수평으로 보면 화면 위쪽이 하늘이라 바닥에 비추면 0 이다. 그때는 보는 방향(앞)을 위쪽으로 친다.
      if (Math.hypot(up.x, up.z) < 1e-3) up.setFromMatrixColumn(camera.matrixWorld, 2).negate()
      // 장면의 (x, z) 는 IFC 의 (x, -y) 다(toScene).
      const plane = (v: Vector3): Vec2 => {
        const n = Math.hypot(v.x, v.z) || 1
        return [v.x / n, -v.z / n]
      }
      return { right: plane(right), up: plane(up) }
    },

    dispose() {
      running = false
      window.removeEventListener('keydown', onKeyDown)
      if (import.meta.env.MODE === 'e2e') delete (window as unknown as { __viewer?: unknown }).__viewer
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      disposeContent()
      renderer.dispose()
    },
  }
}
