// 임포트 결과를 3D 로 띄운다. 임포트가 맞았는지 눈으로 확인하는 것이 이 화면의 일이다.
//
// 표로는 안 잡히는 실패가 있다. 배치 사슬을 잘못 타면 방이 전부 원점에 겹쳐 쌓이는데,
// 개수도 넓이도 그대로라서 숫자만 봐서는 멀쩡해 보인다. 3D 로 띄우면 즉시 보인다.
//
// 설비는 상자 점이 아니라 IFC 의 실제 형상으로 그린다. 배관·덕트는 점으로 찍으면 계통이
// 어디로 지나가는지가 사라져서, 연결을 추정한 것이 맞는지 눈으로 확인할 수가 없다.

import {
  Box3,
  MOUSE,
  TOUCH,
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
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Material,
  Object3D,
  type Texture,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { polygonArea, type Model, type Vec2, type Vec3 } from './model'
import type { MeshMap } from './ifc/import'
import { distanceToRing, pointInPolygon } from './mapping'
import { easeOut, still } from './motion'
import { isMultiSelect } from './shortcuts'
import { type LibraryItem, type ObjectMaterial } from './space-object'

/**
 * 층을 구분하는 색. 층 수만큼 순환한다.
 *
 * 색상환을 도는 중채도 계열이다. 흙빛 계열을 써 봤더니 밝은 배경 위에서
 * 낡아 보였고, 형광색은 반대로 튀기만 한다. 채도는 중간, 명도는 비슷하게 맞춰서 어느
 * 층이 위인지가 색이 아니라 높이로 읽히게 한다. 이웃한 층끼리는 색상환에서 멀리 둔다.
 *
 * **파랑은 쓰지 않는다.** 고른 방의 테두리·손잡이가 액센트 파랑이라, 첫 층이 파랑이던 때 AC20 1층에서
 * 고른 방이 판과 같은 색이라 보이지 않았다(다크의 액센트는 판 색과 같은 값이었다).
 */
const STOREY_COLORS = [0x4fc3a1, 0xe88bc9, 0xf0a94e, 0xb08ef0, 0xef7d7d]

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

/** 마우스 아래 표시. 설비는 액센트 상자, 방은 회색 점선 — 색만이 아니라 모양으로도 갈린다. */
const HOVER_COLORS = { equipment: 0x2f6fed, space: 0x5b6470, spaceDark: 0xc0c6cd }
/** 막힌 편집의 상대(겹친 설비, OE-OBJ-16). 오류 색 하나다. */
const CONFLICT_COLOR = 0xd1372b
/** 겹친 상대 표시가 떠 있는 시간(ms). 알림 줄(App 의 note)과 비슷하게 둔다. */
const CONFLICT_MS = 2600

/**
 * 내력벽 색. 내력벽 여부를 BIM 이 말하지 않은 벽은 "모름" 으로 따로 칠한다 — 비내력으로 숨기면
 * 모르는 벽이 내력벽이 아닌 것처럼 보인다. 비내력벽은 그리지 않는다.
 */
/** 벽·문·창 편집 층의 색. 비내력벽은 회색, 고른 것은 액센트 하나다. 내력·모름은 WALL_COLORS 를 같이 쓴다. */
export const ARCH_COLORS = { wall: 0xb7bec7, door: 0x39424e, window: 0x7fa6cf, selected: 0x2f6fed }
/** 공조존(IDF) 외곽선 색. 계통 색과 헷갈리지 않게 한 가지로만 그린다. */
const ZONE_COLOR = 0x6b7280
/**
 * 커스텀존(OE-OBJ-01) 외곽선. 공조존과 같은 회색 계열이되 점선으로 가른다(색을 늘리지 않는다). 고른 존은 액센트 선과 옅은 면.
 * 물리존 판 위에 겹쳐 그리므로 판보다 조금 높게 띄운다.
 */
const CUSTOM_ZONE_COLOR = 0x39424e
const CUSTOM_ZONE_LIFT = 0.25
/** 벽을 세우는 높이(미터). 실제 벽 높이가 아니라 평면이 보일 만큼만 세운다 — 다 세우면 방 안이 가린다. */
const ARCH_WALL_HEIGHT = 1.2
/**
 * 실제 벽 높이를 보이는 윤곽선. 1.2m 로 깎은 벽만 보면 1.2m 에 둔 조명이 벽 윗면에 맞아 보여 높이를 잘못 읽는다(2026-10-07 검토).
 * 면을 세우면 방 안이 가리므로 윗면 외곽선과 모서리 세로선만 옅게 그린다. 높이를 모르는 벽(null)은 그리지 않는다.
 */
const ARCH_WALL_TOP = { color: 0x8a94a3, opacity: 0.45 }
/** 문·창을 누를 때 자리에서 이만큼 안이면 그 문·창이다(미터). */
const ELEMENT_REACH = 0.35
/** 룸(OE-OBJ-03) 외곽선 높이(층 바닥 위, 미터). 물리존 판(+0.1)과 커스텀존(+0.25) 사이다. */
const ROOM_LIFT = 0.18
const ROOM_COLORS = { line: 0xc0782a, conflict: 0xd93636 }
/** 추가 공간 오브젝트(OE-OBJ-09) 재질 색. 설비·벽과 헷갈리지 않게 가구다운 무채색·나무색으로 둔다. */
const OBJECT_COLORS: Record<ObjectMaterial, number> = {
  wood: 0xb08a5e,
  frame: 0x6b7280,
  fabric: 0x8796ad,
  panel: 0xc9ced6,
  board: 0xf4f5f7,
  pot: 0x9c6b4e,
  leaf: 0x5f9e5a,
}
/** 넣은 모델을 못 읽었을 때(아직 읽는 중이거나 깨진 파일) 그리는 상자 색. */
const OBJECT_FALLBACK = 0xa7adb7
const OBJECT_SELECTED = 0x2f6fed
const OBJECT_CONFLICT = 0xd93636

/**
 * 천장 설비의 바닥 발자국 링 색(OE-EQP-04). 반자 부착과 플레넘을 색으로 가른다. 링은 바닥(층 바닥 + 이만큼)에 눕고, 크기는 설비
 * 형상의 평면 외곽(없으면 CEILING_RING_MIN)이다. 높이는 물리존 판(층 바닥 + 0.1m) 바로 위다 — 밑에 두면 판에 가린다.
 */
export const CEILING_RING_COLORS = { attached: 0x1f9bb4, plenum: 0x9a5fd0 }
const CEILING_RING_LIFT = 0.13
const CEILING_RING_MIN = 0.25
const CEILING_RING_SIDES = 24

/**
 * 천장 편집 모드(OE-OBJ-08). 층마다 반자 높이(IFC z)에 반투명 천장면을 그리고 — 면은 그 층 물리존 외곽선들이고, 물리존이 없으면
 * 설비가 든 평면 범위다 — `dim` 의 설비(천장 설비가 아닌 것)는 회색·투과로 칠한다. 회색 설비도 고를 수 있다(속성 조회).
 */
export type CeilingView = { planes: { storeyId: string; z: number; rings: readonly (readonly Vec2[])[] }[]; dim: ReadonlySet<string> }
const CEILING_PLANE = { color: 0x9fb3cc, opacity: 0.22 }
const DIM_COLOR = 0xb4bac4

/** 천장 설비 하나의 발자국(OE-EQP-04). `at` 은 설비의 IFC 좌표, `floor` 는 그 층 바닥 높이(IFC z)다. */
export type CeilingMark = { id: string; storeyId: string; at: Vec3; floor: number; zone: 'attached' | 'plenum' }

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
  /**
   * 여러 개 고른 설비(OE-UI-09). 고른 색으로 칠하고, 나머지는 흐리게 하지 않는다 — 흐리게 칠한 것은 고를 수 없어 Ctrl+클릭으로
   * 더 넣지 못한다. 끌기는 이 중 어느 것을 잡아도 된다(놓으면 화면이 전부 같은 거리만큼 옮긴다).
   */
  group?: ReadonlySet<string>
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
 * 넣은 3D 모델(OE-P3-08)의 재질을 Lambert 로 바꾼다. glTF 는 PBR 재질(MeshStandardMaterial)로 읽히는데, 3D 는 Lambert 와 빛 두 개로만
 * 음영을 낸다(ADR-0013). 색·텍스처·투명도는 그대로 둔다.
 */
export function lambertize(root: Object3D): Object3D {
  const convert = (m: Material): Material => {
    const src = m as Material & { color?: Color; map?: Texture | null }
    const out = new MeshLambertMaterial({ color: src.color ?? OBJECT_FALLBACK, map: src.map ?? null, transparent: m.transparent, opacity: m.opacity, side: m.side })
    m.dispose()
    return out
  }
  root.traverse((o) => {
    if (o instanceof Mesh) o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material)
  })
  return root
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

/** 마우스 아래에 있는 것. 설비·물리존(편집 모드)·연결 화살표(편집 모드). */
export type HoverTarget = { kind: 'equipment'; id: string } | { kind: 'space'; id: string } | { kind: 'arrow'; key: string }

export type Viewer = {
  /** keepView 면 시점을 그대로 둔다. 편집한 뒤 다시 그릴 때마다 건물 전체로 튀면 어디를 고치던 중인지 잃는다. */
  setModel(model: Model, meshes?: MeshMap, options?: { keepView?: boolean }): void
  /** 선택과 상류·하류를 색으로 칠한다. null 이면 전부 원래 색으로 되돌린다. */
  setHighlight(highlight: Highlight | null): void
  /** 3D 에서 설비를 고르면 부른다. 빈 곳을 누르면 null 이다. 편집 모드에서 Ctrl(⌘)을 누른 채면 `additive`(여러 개 고르기, OE-UI-09). */
  onPick(handler: (id: string | null, additive?: boolean) => void): void
  /** 편집 모드에서 Ctrl(⌘)을 누른 채 끌어 그린 상자 안의 설비(OE-UI-09). 화면에 보이는(숨기지 않은) 것만, 형상 중심이 상자 안이면. */
  onBoxSelect(handler: (ids: string[]) => void): void
  /**
   * 마우스가 움직일 때마다(한 프레임에 한 번) 그 아래에 무엇이 있는지 알린다. 캔버스를 벗어나거나 끄는 중이면 null.
   * at 은 화면(클라이언트) 좌표다. 누르지 않고도 무엇인지 알 수 있게 하는 설명 풍선이 쓴다.
   */
  onHover(handler: (target: HoverTarget | null, at: { x: number; y: number } | null) => void): void
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
  shiftEquipment(id: string, delta: Vec3, glide?: boolean): boolean
  /** 설비 하나의 꼭짓점을 통째로 바꾼다(화면 좌표, 꼭짓점 수가 같아야 한다). 설비를 따라 늘인 배관에 쓴다. 없으면 false. */
  setEquipmentPositions(id: string, positions: Float32Array, glide?: boolean): boolean
  /** 소속이 바뀐 방 바닥을 한 번 번쩍인다. 움직임을 끈 사람에게는 아무것도 하지 않는다. */
  pulseSpaces(ids: Iterable<string>): void
  /** 막힌 편집의 상대 설비를 붉은 상자로 잠깐 짚는다(겹침, OE-OBJ-16). */
  markConflict(id: string): void
  /** 편집 모드에서 고른 설비를 끌어 놓으면 부른다. 옮긴 거리를 IFC 좌표(미터)로 넘긴다. 높이는 그대로다. */
  onEquipmentMove(handler: (id: string, delta: Vec3) => void): void
  /** 설비가 아닌 바닥(물리존 판)을 누르면 부른다. 편집 모드면 손잡이가, 보기 모드면 테두리만 뜬다. */
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
  /**
   * 벽·문·창 편집 층(E4). model 이 null 이면 끈다. 켜면 벽 외곽선(모델의 값, 편집이 바로 보인다)과 문·창 자리를
   * 그리고, 편집 모드에서 바닥을 누르면 물리존보다 벽·문·창을 먼저 고른다.
   */
  setArchitecture(model: Model | null, selected: string | null): void
  /** 공조존(IDF) 외곽선. null 이면 지운다. 층별로 보기를 따른다. */
  setHvacZones(model: Model | null, selected: string | null): void
  /** 커스텀존(OE-OBJ-01) 외곽선과 고른 존의 면. null 이면 지운다. 층별로 보기를 따른다. */
  setCustomZones(model: Model | null, selected: string | null): void
  /**
   * 룸(OE-OBJ-03) 외곽선과 고른 룸의 면. `conflict` 는 겹쳐서 막은 상대 룸이라 붉게 그린다(OE-SPC-15). 바닥을 누르면 룸이 그 아래
   * 물리존보다 먼저 골라진다(onPickSpace 로 룸 id 가 간다). null 이면 지운다.
   */
  setRooms(model: Model | null, selected: string | null, conflict?: string | null): void
  /**
   * 천장 설비의 바닥 발자국 링과, 고른 설비에서 링까지의 수직 점선(OE-EQP-04). 빈 배열이면 지운다. 층별로 보기를 따르고
   * 고르지 않는다 — 링을 눌러도 바닥(물리존)이 골라진다.
   */
  setCeilingMarks(marks: readonly CeilingMark[], selected: string | null): void
  /** 천장 편집 모드의 천장면과 회색 처리. null 이면 지운다. 반자 높이가 있는 층만 면이 있다. */
  setCeilingView(view: CeilingView | null): void
  /** 끌어 옮기지 못하는 설비(모드 밖의 설비, OE-OBJ-08). 고르기는 된다. */
  setFrozen(ids: ReadonlySet<string>): void
  /** 보이는 것 전체를 위에서 내려다본다. 화면 위쪽이 IFC +y(평면도와 같은 방위)다. */
  topView(): void
  /**
   * 추가 공간 오브젝트(OE-OBJ-09). 항목의 3D 조각(내장) 또는 넣은 모델(`models`, 열쇠 → 읽은 장면)을 오브젝트 상자에 맞춰
   * 늘려 그린다. 고른 것은 액센트 테두리, `conflict`(겹쳐서 막은 상대)는 붉게 그린다(OE-SPC-15). 편집 모드에서 고른 것은 끌 수 있다.
   */
  setSpaceObjects(
    model: Model | null,
    library: (key: string) => LibraryItem | null,
    models: ReadonlyMap<string, Object3D>,
    selected: string | null,
    conflict?: string | null,
  ): void
  /** 오브젝트를 누르면 부른다. 설비보다 앞에 있을 때만이다. */
  onPickObject(handler: (id: string) => void): void
  /** 고른 오브젝트를 끌어 놓으면 부른다. 옮긴 거리를 IFC 평면 좌표로 넘긴다. */
  onObjectMove(handler: (id: string, delta: Vec2) => void): void
  onPickElement(handler: (id: string | null) => void): void
  /** 화살표·손잡이 색을 테마에 맞춘다. 바탕이 투명이라 페이지 색이 그대로 비친다. */
  setDark(on: boolean): void
  /** 건물 전체가 화면에 들어오게 한다. */
  frameAll(): void
  /**
   * 보일 층만 남긴다. storeys 가 null 이면 전부. hidden 은 숨길 설비 id(그 층에 없는 설비) — 층과 설비의 짝은 편집으로
   * 바뀌므로(층 옮기기) 화면이 셈해서 준다. 숨긴 것은 그리지도, 고르지도 않는다.
   */
  setStoreyFilter(storeys: ReadonlySet<string> | null, hidden: ReadonlySet<string>): void
  /**
   * 놓기 모드. 높이(IFC z, 층 바닥)를 주면 다음 누르기를 고르기 대신 그 높이 바닥의 점(IFC x, y)으로 알린다.
   * 좌표가 없는 설비를 3D 에서 놓을 때 쓴다. null 이면 끈다.
   */
  setPlaceMode(elevation: number | null): void
  onPlace(handler: (at: Vec2) => void): void
  /** 물리존 하나가 화면에 들어오게 한다. */
  frameSpace(id: string): void
  /**
   * 화면의 오른쪽·위쪽이 IFC 평면에서 어느 쪽인가(단위 벡터). 방향키로 설비를 옮길 때 쓴다. 비스듬히 보면
   * 화면 위쪽은 바닥에서 "멀어지는 쪽" 이다.
   */
  planeAxes(): { right: Vec2; up: Vec2 }
  dispose(): void
}

/**
 * 합친 형상의 한 덩어리. 설비 형상을 한 벌로 합치면 첫 그리기에 GPU 로 한 번에 올라가서 성수(정점 1천만 개,
 * 403MB)에서 화면이 3초 멈췄다. 덩어리로 나눠 한 프레임에 하나씩 켜면 올리는 일도 프레임마다 나뉜다.
 * 옮기거나 칠할 때도 그 덩어리만 다시 올린다(전부 올리면 방향키 한 번에 122MB 가 다시 갔다).
 */
type Chunk = {
  position: BufferAttribute
  colors: BufferAttribute
  /** 덩어리 안의 삼각형 인덱스 전부. 흐리게·숨기기를 바꿀 때 여기서 두 메시의 인덱스를 다시 짠다. */
  index: Uint32Array
  solid: Mesh
  faded: Mesh
  parts: Part[]
  /** 한 프레임에 한 덩어리씩 켠다. 켜기 전에는 그리지 않는다(고르기는 JS 배열로 하니 된다). */
  shown: boolean
  solidCount: number
  fadedCount: number
}
/** 덩어리 하나의 꼭짓점 수. 한 프레임에 올리는 양이 약 8MB 가 된다. */
const CHUNK_VERTICES = 250_000

/** 합친 형상 안에서 설비 하나가 차지하는 자리. 강조·선택·시점 맞추기가 이 표로 설비를 찾는다. */
type Part = {
  id: string
  color: number
  chunk: Chunk
  /** 덩어리 안의 꼭짓점 범위(색을 바꿀 때)와 삼각형 인덱스 범위(보이기·고르기). */
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
  // 시점은 지도식이다(OE-OBJ-15, three.js MapControls 의 배치). 왼쪽 드래그는 바닥면을 따라 화면 이동, 오른쪽 드래그와 Shift+왼쪽
  // 드래그는 회전·기울이기, 휠은 확대·축소다(보기·편집 모드 같다). 일 대부분이 층을 내려다보는 일이라 이동이 회전보다 잦다.
  // OrbitControls 는 Ctrl·⌘+왼쪽 드래그도 회전으로 받지만, 편집 모드에서는 여러 개 고르기 상자가 먼저 가져간다(OE-UI-09, pointerdown).
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
  controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE }
  controls.screenSpacePanning = false

  // 조명. **그림자·후처리 없이 빛 두 개로만 면을 가른다** — 그리기 호출과 셰이더가 그대로라 성수에서도 값이 들지 않는다.
  // 예전에는 고른 주변광(1.25)이 대부분이라 어느 쪽 면이든 밝기가 같아서, 형상이 있는 설비도 계통 색 한 덩어리로 보였다.
  // 하늘빛(HemisphereLight)은 윗면을 밝게, 아랫면을 어둡게 해 덕트·배관의 위아래를 가른다. 주광은 카메라에 붙여 화면 왼쪽
  // 위에서 비춘다 — 세계에 고정하면 해 반대편으로 돌아갔을 때 모든 면이 그늘이라 다시 한 덩어리가 된다. 3D 는 시점이
  // 바뀔 때만 다시 그리므로(아래 tick 의 dirty) 빛이 따라 움직여도 더 그리지 않는다.
  scene.add(new HemisphereLight(0xffffff, 0x6f7684, 0.9))
  const sun = new DirectionalLight(0xffffff, 1.45)
  sun.position.set(-0.5, 1, 0.6)
  sun.target.position.set(0, 0, -1)
  camera.add(sun, sun.target)
  scene.add(camera)

  let content = new Group()
  scene.add(content)

  // **설비는 한 덩어리로 합쳐 그린다.** 설비마다 메시·재질을 따로 두면 매 프레임 그리기 호출이 설비 수만큼
  // 나간다. 성수 기계 파일은 1만 8천 개라 시점을 돌릴 때마다 버벅였다. 지금은 형상을 하나로 합치고, 설비별
  // 색은 꼭짓점 색으로, 흐리게 할 것은 같은 형상을 공유하는 두 번째 메시(반투명)로 옮겨 그린다.
  // 그리기 호출이 설비 수와 상관없이 두 번이다.
  let parts: Part[] = []
  let partById = new Map<string, Part>()
  let chunks: Chunk[] = []
  // 내력벽. 고르기 대상이 아니다(pick 은 설비만 본다). 벽 너머의 설비를 누를 수 있어야 해서다.
  let walls: Group | null = null
  let wallsVisible = false
  // 층별로 보기. 숨긴 층의 판·벽은 visible 을 끄고, 숨긴 설비는 인덱스에서 뺀다(흐리게 칠한 것과 같은 장치).
  let visibleStoreys: ReadonlySet<string> | null = null
  let hiddenIds: ReadonlySet<string> = new Set()
  const storeyShown = (o: { userData: { storeyId?: string } }) => !visibleStoreys || !o.userData.storeyId || visibleStoreys.has(o.userData.storeyId)
  function applyStoreyVisibility() {
    for (const o of slabs.children) o.visible = storeyShown(o)
    for (const o of walls?.children ?? []) o.visible = storeyShown(o)
    for (const o of arch.children) o.visible = storeyShown(o)
    for (const o of zoneLines.children) o.visible = storeyShown(o)
    for (const o of customZones.children) o.visible = storeyShown(o)
    for (const o of rooms.children) o.visible = storeyShown(o)
    for (const o of ceilingMarks.children) o.visible = storeyShown(o)
    for (const o of ceilingPlanes.children) o.visible = storeyShown(o)
    for (const o of spaceObjects.children) o.visible = storeyShown(o)
    dirty = true
  }
  let pickHandler: (id: string | null, additive?: boolean) => void = () => {}
  let boxHandler: (ids: string[]) => void = () => {}
  /** Ctrl+끌기로 그리는 고르기 상자(OE-UI-09). 화면 좌표의 시작점과 그리는 DOM 상자. */
  let box: { x: number; y: number; el: HTMLDivElement } | null = null
  let hoverCb: (target: HoverTarget | null, at: { x: number; y: number } | null) => void = () => {}
  const hoverHandler = (target: HoverTarget | null, at: { x: number; y: number } | null) => {
    markHover(target)
    hoverCb(target, at)
  }
  let placeElevation: number | null = null
  let placeHandler: (at: Vec2) => void = () => {}

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
  /** 끌 수 있는 설비. 고른 것 하나, 여러 개 골랐으면 그 전부(OE-UI-09). */
  let grabIds: ReadonlySet<string> = new Set()
  /** 좌표가 있는 설비. 좌표가 없는 것은 끌지 않는다 — 끌면 원점 근처 어딘가에서 시작한 것이 된다. */
  let movable = new Set<string>()
  /** 물리존 판의 윗면. 편집 모드에서 바닥을 눌러 물리존을 고를 때 쓴다. */
  let spaceTargets: { id: string; storeyId: string; y: number; ring: readonly Vec2[] }[] = []
  let moveHandler: (id: string, delta: Vec3) => void = () => {}
  let spacePickHandler: (id: string | null) => void = () => {}
  let vertexHandler: (spaceId: string, index: number, to: Vec2) => void = () => {}
  let arrowHandler: (key: string) => void = () => {}
  let elementHandler: (id: string | null) => void = () => {}
  // 벽·문·창 편집 층(E4). 누르는 자리는 판처럼 평면에서 잰다 — 벽은 외곽선 안, 문·창은 자리에서 ELEMENT_REACH 안.
  const arch = new Group()
  scene.add(arch)
  // 공조존(IDF) 외곽선. 고르지 않는다 — 바닥을 누르면 물리존이 골라지고, 그 방의 공조존은 패널이 말한다.
  const zoneLines = new Group()
  scene.add(zoneLines)
  const customZones = new Group()
  scene.add(customZones)
  const rooms = new Group()
  scene.add(rooms)
  // 추가 공간 오브젝트(OE-OBJ-09). 오브젝트마다 묶음 하나이고, 누르기는 상자로 잰다(가구 모양은 상자를 거의 채운다).
  const spaceObjects = new Group()
  scene.add(spaceObjects)
  type ObjectTarget = { id: string; storeyId: string; box: Box3; node: Object3D }
  let objectTargets: ObjectTarget[] = []
  let selectedObject: string | null = null
  let objectPickHandler: (id: string) => void = () => {}
  let objectMoveHandler: (id: string, delta: Vec2) => void = () => {}
  /** 광선에 맞은 맨 앞의 오브젝트와 거리(제곱). 숨긴 층의 것은 뺀다. */
  function pickObject(ray: Ray): { target: ObjectTarget; d: number } | null {
    let best: { target: ObjectTarget; d: number } | null = null
    const at = new Vector3()
    for (const target of objectTargets) {
      if (visibleStoreys && !visibleStoreys.has(target.storeyId)) continue
      if (!ray.intersectBox(target.box, at)) continue
      const d = at.distanceToSquared(ray.origin)
      if (!best || d < best.d) best = { target, d }
    }
    return best
  }
  /** 누를 수 있는 룸. 물리존 판보다 먼저 본다(pickSpace). */
  let roomTargets: { id: string; storeyId: string; y: number; ring: readonly Vec2[] }[] = []
  const ceilingMarks = new Group()
  scene.add(ceilingMarks)
  const ceilingPlanes = new Group()
  scene.add(ceilingPlanes)
  let dimIds: ReadonlySet<string> = new Set()
  let frozenIds: ReadonlySet<string> = new Set()
  let lastHighlight: Highlight | null = null
  /** 누를 수 있는 벽·문·창. 문·창은 자리(`at`)와, 가로를 알면 벽을 따라 편 반 폭(`half`, 방향 `dir`)을 든다. */
  let archTargets: { id: string; storeyId: string; y: number; rings?: readonly (readonly Vec2[])[]; at?: Vec2; dir?: Vec2; half?: number }[] = []
  /** 문·창까지의 평면 거리. 가로를 알면 그 폭의 선분까지다(넓힌 창의 끝을 눌러도 창이다). */
  const openingGap = (t: (typeof archTargets)[number], p: Vec2) => {
    const at = t.at!
    if (!t.dir || !t.half) return Math.hypot(p[0] - at[0], p[1] - at[1])
    const along = Math.max(-t.half, Math.min(t.half, (p[0] - at[0]) * t.dir[0] + (p[1] - at[1]) * t.dir[1]))
    return Math.hypot(p[0] - (at[0] + t.dir[0] * along), p[1] - (at[1] + t.dir[1] * along))
  }

  const overlay = new Group()
  scene.add(overlay)
  let handleSpace: SpaceHandles | null = null
  let handles: Mesh[] = []
  let outline: LineLoop | null = null
  // 마우스 아래 있는 것의 표시. 설비는 상자 테두리(액센트), 방은 바닥 외곽선(점선)이라 무엇 위에 있는지 모양으로 갈린다.
  let hoverMark: Line | null = null
  let hoverMarkKey = ''
  let arrowSpecs: readonly Arrow[] = []
  let arrowObjects: (Line | Mesh)[] = []
  let arrowSegs: { key: string; a: Vector3; b: Vector3 }[] = []

  type Drag =
    | { kind: 'equipment'; part: Part; original: Float32Array; box: Box3; plane: Plane; start: Vector3; delta: Vector3 }
    | { kind: 'object'; target: ObjectTarget; origin: Vector3; plane: Plane; start: Vector3; delta: Vector3 }
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
    // 보기 모드에서는 고른 방의 테두리만 긋고 손잡이는 달지 않는다.
    if (!handleSpace || handleSpace.ring.length < 3) return
    // 판 윗면(바닥 + 0.1) 바로 위에 띄운다. 같은 높이면 판과 겹쳐 깜빡인다. 판에 가려지지 않게 깊이는 안 본다.
    const y = handleSpace.elevation + 0.12
    const points = handleSpace.ring.map(([x, z]) => new Vector3(...toScene([x, z, 0])).setY(y))
    outline = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: handleColor(dark), depthTest: false }))
    outline.renderOrder = 10
    overlay.add(outline)
    if (!editMode) return
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

  function markHover(target: HoverTarget | null) {
    const key = target ? (target.kind === 'arrow' ? '' : `${target.kind}:${target.id}`) : ''
    if (key === hoverMarkKey) return
    hoverMarkKey = key
    if (hoverMark) disposeObject(hoverMark)
    hoverMark = null
    dirty = true
    if (!target || target.kind === 'arrow') return
    if (target.kind === 'equipment') {
      const part = partById.get(target.id)
      if (!part || part.box.isEmpty()) return
      const size = part.box.getSize(new Vector3()).max(new Vector3(0.05, 0.05, 0.05))
      const geometry = new EdgesGeometry(new BoxGeometry(size.x, size.y, size.z))
      hoverMark = new LineSegments(geometry, new LineBasicMaterial({ color: HOVER_COLORS.equipment, depthTest: false }))
      part.box.getCenter(hoverMark.position)
    } else {
      const t = roomTargets.find((x) => x.id === target.id) ?? spaceTargets.find((x) => x.id === target.id)
      if (!t || t.ring.length < 3) return
      const points = t.ring.map(([x, z]) => new Vector3(...toScene([x, z, 0])).setY(t.y + 0.1))
      hoverMark = new LineLoop(
        new BufferGeometry().setFromPoints(points),
        new LineDashedMaterial({ color: dark ? HOVER_COLORS.spaceDark : HOVER_COLORS.space, dashSize: 0.4, gapSize: 0.25, depthTest: false }),
      )
      hoverMark.computeLineDistances()
    }
    hoverMark.renderOrder = 9
    overlay.add(hoverMark)
  }

  let conflictMark: LineSegments | null = null
  let conflictTimer: number | undefined
  function clearConflict() {
    window.clearTimeout(conflictTimer)
    if (!conflictMark) return
    overlay.remove(conflictMark)
    conflictMark.geometry.dispose()
    ;(conflictMark.material as LineBasicMaterial).dispose()
    conflictMark = null
    dirty = true
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
      // 한 층만 볼 때 다른 층 끝으로 가는 화살표는 그리지도 누르지도 않는다(OE-UI-12). 끝이 안 보이는 곳을 가리켰다.
      // 그 연결은 오른쪽 패널의 연결 표에 "다른 층" 으로 남고, 방향도 거기서 바꾼다.
      if (hiddenIds.has(spec.a) || hiddenIds.has(spec.b)) continue
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

  /**
   * 광선이 먼저 닿는 물리존 판. 판 윗면에서 외곽선 안에 드는지로 본다. 같은 층에서 방이 겹친 자리면 **가장 작은 방**이다 —
   * 설비 소속(mapping.ts 의 locate)과 같은 규칙이라, 누른 자리의 설비가 속한 방이 골라진다.
   */
  function pickSpace(ray: Ray): string | null {
    let best: { id: string; d: number; area: number } | null = null
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const at = new Vector3()
    // 룸(OE-OBJ-03)이 먼저다 — 물리존 판보다 위에 그려 광선이 먼저 닿는다.
    for (const target of [...roomTargets, ...spaceTargets]) {
      if (visibleStoreys && !visibleStoreys.has(target.storeyId)) continue
      plane.constant = -target.y
      if (!ray.intersectPlane(plane, at)) continue
      const d = at.distanceToSquared(ray.origin)
      const tie = best && Math.abs(d - best.d) < 1e-6
      if (best && d > best.d && !tie) continue
      if (!pointInPolygon([at.x, -at.z], target.ring)) continue
      const area = polygonArea(target.ring)
      if (best && tie && area >= best.area) continue
      best = { id: target.id, d, area }
    }
    return best?.id ?? null
  }

  /**
   * 광선이 닿는 벽·문·창. 세워 그린 벽의 옆면·윗면을 누르는 것이 보통이라 그린 형상에 먼저 쏘고, 맞은 자리의 평면
   * 좌표로 어느 것인지 가린다. 문·창이 벽보다 먼저다(문은 벽 안에 있다). 형상에 안 맞으면 바닥 평면에서 잰다.
   */
  function pickElement(ray: Ray): string | null {
    raycaster.ray.copy(ray)
    const hit = raycaster.intersectObjects(arch.children.filter((o) => o.visible && o instanceof Mesh), false)[0]
    if (hit) {
      const p: Vec2 = [hit.point.x, -hit.point.z]
      let best: { id: string; rank: number } | null = null
      for (const t of archTargets) {
        if (visibleStoreys && !visibleStoreys.has(t.storeyId)) continue
        if (Math.abs(hit.point.y - t.y) > ARCH_WALL_HEIGHT + 0.5) continue
        const rank = t.at
          ? openingGap(t, p)
          : t.rings?.some((r) => pointInPolygon(p, r) || distanceToRing(p, r) < 0.03)
            ? ELEMENT_REACH + 1
            : null
        if (rank === null || (t.at && rank > ELEMENT_REACH)) continue
        if (!best || rank < best.rank) best = { id: t.id, rank }
      }
      if (best) return best.id
    }
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const at = new Vector3()
    let best: { id: string; d: number; rank: number } | null = null
    for (const t of archTargets) {
      if (visibleStoreys && !visibleStoreys.has(t.storeyId)) continue
      plane.constant = -t.y
      if (!ray.intersectPlane(plane, at)) continue
      const p: Vec2 = [at.x, -at.z]
      const d = at.distanceToSquared(ray.origin)
      let rank: number | null = null
      if (t.at) {
        const gap = openingGap(t, p)
        if (gap <= ELEMENT_REACH) rank = gap
      } else if (t.rings?.some((r) => pointInPolygon(p, r))) rank = ELEMENT_REACH + 1
      if (rank === null) continue
      if (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) <= 1e-6 && rank < best.rank)) best = { id: t.id, d, rank }
    }
    return best?.id ?? null
  }

  function buildArchitecture(model: Model | null, selected: string | null) {
    arch.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineSegments) {
        o.geometry.dispose()
        ;(o.material as { dispose(): void }).dispose()
      }
    })
    arch.clear()
    archTargets = []
    if (!model) {
      dirty = true
      return
    }
    for (const storey of model.storeys) {
      const y = storey.elevation + 0.1
      const byColor = new Map<number, BufferGeometry[]>()
      const add = (color: number, g: BufferGeometry) => byColor.set(color, [...(byColor.get(color) ?? []), g.index ? g.toNonIndexed() : g])
      // 실제 높이 윤곽선(선분 쌍). 깎은 벽 윗면(y + ARCH_WALL_HEIGHT)에서 실제 윗면(층 바닥 + 벽 높이)까지 세로선, 실제 윗면 외곽선.
      const tops: number[] = []
      for (const wall of storey.walls) {
        const rings = wall.footprint ?? []
        if (!rings.length) continue
        archTargets.push({ id: wall.id, storeyId: storey.id, y, rings })
        const top = wall.height != null ? storey.elevation + wall.height : null
        if (top !== null && top > y + ARCH_WALL_HEIGHT + 0.05) {
          for (const ring of rings) {
            const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
            if (pts.length < 2) continue
            pts.forEach((p, i) => {
              const q = pts[(i + 1) % pts.length]
              tops.push(p[0], top, -p[1], q[0], top, -q[1])
              tops.push(p[0], y + ARCH_WALL_HEIGHT, -p[1], p[0], top, -p[1])
            })
          }
        }
        const color = wall.id === selected ? ARCH_COLORS.selected : wall.loadBearing ? WALL_COLORS.loadBearing : wall.loadBearing === null ? WALL_COLORS.unknown : ARCH_COLORS.wall
        for (const ring of rings) {
          if (ring.length < 3) continue
          const shape = new Shape()
          shape.moveTo(ring[0][0], ring[0][1])
          for (const p of ring.slice(1)) shape.lineTo(p[0], p[1])
          const g = new ExtrudeGeometry(shape, { depth: ARCH_WALL_HEIGHT, bevelEnabled: false })
          g.rotateX(-Math.PI / 2)
          g.translate(0, y, 0)
          add(color, g)
        }
      }
      for (const o of storey.openings) {
        if (!o.position) continue
        const dir: Vec2 | undefined = o.through ? [-o.through[1], o.through[0]] : undefined
        archTargets.push({ id: o.id, storeyId: storey.id, y, at: [o.position[0], o.position[1]], ...(dir && o.width ? { dir, half: o.width / 2 } : {}) })
        const color = o.id === selected ? ARCH_COLORS.selected : o.kind === 'door' ? ARCH_COLORS.door : ARCH_COLORS.window
        const h = o.kind === 'door' ? ARCH_WALL_HEIGHT + 0.3 : ARCH_WALL_HEIGHT + 0.15
        // 가로를 아는 문·창은 그 가로만큼 벽을 따라 편다(OE-OBJ-07, 크기를 바꾸면 3D 에서 보인다). 모르면 기둥 하나다.
        const g = new BoxGeometry(o.width && o.through ? o.width : 0.35, h, 0.35)
        if (o.width && o.through) g.rotateY(Math.atan2(o.through[0], -o.through[1]))
        const [sx, , sz] = toScene([o.position[0], o.position[1], 0])
        g.translate(sx, y + h / 2, sz)
        add(color, g)
      }
      for (const [color, pieces] of byColor) {
        const merged = mergeGeometries(pieces)
        for (const g of pieces) g.dispose()
        if (!merged) continue
        const mesh = new Mesh(merged, new MeshLambertMaterial({ color, side: DoubleSide }))
        mesh.userData.storeyId = storey.id
        arch.add(mesh)
      }
      if (tops.length) {
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(new Float32Array(tops), 3))
        const lines = new LineSegments(g, new LineBasicMaterial({ ...ARCH_WALL_TOP, transparent: true, depthWrite: false }))
        lines.userData.storeyId = storey.id
        lines.userData.wallTop = true
        arch.add(lines)
      }
    }
    applyStoreyVisibility()
  }

  function placePart(d: Extract<Drag, { kind: 'equipment' }>, delta: Vector3) {
    const position = d.part.chunk.position
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
    if (d.kind === 'object') {
      // 놓을지는 화면이 정한다(겹치면 막는다). 막히면 setSpaceObjects 로 다시 그려져 원래 자리로 돌아간다.
      if (commit && d.moved) objectMoveHandler(d.target.id, [d.delta.x, -d.delta.z])
      else {
        d.target.node.position.copy(d.origin)
        d.target.box.translate(d.delta.clone().negate())
      }
      return
    }
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
      // Ctrl+끌기는 고르기 상자다(OE-UI-09, DT 2.0 과 같은 키). 고른 설비 위에서 시작하면 그 설비들을 끄는 것이고, 손잡이·놓기
      // 모드는 그쪽이 먼저다. Shift+끌기는 여기서 받지 않아 보기 모드처럼 회전이다(OE-OBJ-15).
      if (isMultiSelect(e) && placeElevation === null && hitHandle(e.clientX, e.clientY) === null && !grabbable(ray)) {
        const el = document.createElement('div')
        el.className = 'box-select'
        Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', border: '1px dashed currentColor', background: 'rgba(47, 111, 237, 0.08)', zIndex: '5' })
        canvas.parentElement?.appendChild(el)
        box = { x: e.clientX, y: e.clientY, el }
        drawBox(e.clientX, e.clientY)
        controls.enabled = false
        canvas.setPointerCapture(e.pointerId)
        e.stopImmediatePropagation()
        return
      }
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
        const held = !part && selectedObject ? pickObject(ray) : null
        if (held && held.target.id === selectedObject) {
          // 잡은 높이의 수평면 위로 끈다. 바닥면으로 끌면 비스듬히 볼 때 오브젝트가 마우스보다 빨리 간다.
          const hit = ray.intersectBox(held.target.box, new Vector3())
          if (!hit) return
          const plane = new Plane(new Vector3(0, 1, 0), -hit.y)
          start.copy(hit)
          next = { kind: 'object', target: held.target, origin: held.target.node.position.clone(), plane, start, delta: new Vector3() }
          drag = { ...next, x: e.clientX, y: e.clientY, moved: false }
          controls.enabled = false
          canvas.setPointerCapture(e.pointerId)
          e.stopImmediatePropagation()
          canvas.style.cursor = 'grabbing'
          return
        }
        if (!part) return
        finishGlide(part.id) // 미끄러지는 중이면 끝 자리에서 잡는다.
        const position = part.chunk.position
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
    if (box) {
      const b = box
      box = null
      b.el.remove()
      controls.enabled = true
      // 거의 안 끌었으면 Ctrl+클릭이다 — 아래로 내려가 그 자리의 설비를 하나 더한다.
      if (Math.hypot(e.clientX - b.x, e.clientY - b.y) > 4) {
        pressedAt = null
        boxHandler(partsInBox(b.x, b.y, e.clientX, e.clientY))
        return
      }
    }
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

    if (placeElevation !== null) {
      const at = new Vector3()
      const plane = new Plane(new Vector3(0, 1, 0), -toScene([0, 0, placeElevation])[1])
      if (rayAt(e.clientX, e.clientY).intersectPlane(plane, at)) placeHandler([at.x, -at.z])
      return
    }

    if (editMode) {
      const key = hitArrow(e.clientX, e.clientY)
      if (key) {
        arrowHandler(key)
        return
      }
    }
    const ray = rayAt(e.clientX, e.clientY)
    const additive = editMode && isMultiSelect(e)
    const id = pick(ray, additive)
    // 오브젝트(OE-OBJ-09)가 설비보다 앞에 있으면 오브젝트다. 책상 위로 보이는 천장 조명을 누르면 조명이다.
    const object = !additive ? pickObject(ray) : null
    if (object && (!id || object.d < pickDistance(ray, id))) {
      objectPickHandler(object.target.id)
      return
    }
    if (id) {
      pickHandler(id, additive)
      return
    }
    // Ctrl 을 누른 채 빈 곳을 누른 것은 고른 것을 버리는 누르기가 아니다.
    if (additive) return
    // 보기 모드에서도 바닥을 누르면 그 물리존을 보인다(이름·넓이·든 설비). 고치는 칸은 편집 모드에만 뜬다.
    if (!editMode) {
      const space = pickSpace(ray)
      if (space) spacePickHandler(space)
      else {
        pickHandler(null)
        spacePickHandler(null)
      }
      return
    }
    // 벽·문·창 편집 층이 켜져 있으면 벽·문·창이 물리존보다 먼저다.
    if (archTargets.length) {
      const element = pickElement(ray)
      if (element) {
        elementHandler(element)
        return
      }
      elementHandler(null)
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
    if (box) {
      drawBox(e.clientX, e.clientY)
      return
    }
    // 끌거나 시점을 돌리는 동안에는 설명 풍선을 숨긴다. 그대로 두면 옛 자리에 떠 있다.
    if (drag || e.buttons !== 0) hoverHandler(null, null)
    if (drag) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) drag.moved = true
      const at = new Vector3()
      if (!rayAt(e.clientX, e.clientY).intersectPlane(drag.plane, at)) return
      if (drag.kind === 'equipment') {
        drag.delta.set(at.x - drag.start.x, 0, at.z - drag.start.z)
        placePart(drag, drag.delta)
        drawArrows()
      } else if (drag.kind === 'object') {
        const step = new Vector3(at.x - drag.start.x, 0, at.z - drag.start.z).sub(drag.delta)
        drag.delta.add(step)
        drag.target.node.position.add(step)
        drag.target.box.translate(step)
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
    hoverHandler(null, null)
  })
  controls.addEventListener('change', () => {
    if (hoverAt) hoverPending = true
  })
  // 끄는 중 Esc 는 끌기를 버리고 제자리로 돌린다. 캔버스는 포커스를 받지 않으므로 창에 건다.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && drag) endDrag(false)
  }
  window.addEventListener('keydown', onKeyDown)
  // 끄는 중 창이 포커스를 잃으면(다른 창으로 전환) 버린다(OE-OBJ-15). 버튼을 뗀 것을 못 받으니 확정하지 않는다.
  const onBlur = () => {
    if (drag) endDrag(false)
    if (box) {
      box.el.remove()
      box = null
      controls.enabled = true
    }
  }
  window.addEventListener('blur', onBlur)

  function updateHover() {
    hoverPending = false
    if (placeElevation !== null) {
      canvas.style.cursor = 'crosshair'
      hoverHandler(null, null)
      return
    }
    if (!hoverAt || drag) {
      hoverHandler(null, null)
      return
    }
    const { x, y } = hoverAt
    if (editMode && hitHandle(x, y) !== null) {
      canvas.style.cursor = 'grab'
      hoverHandler(null, null)
      return
    }
    const arrow = editMode ? hitArrow(x, y) : null
    if (arrow) {
      canvas.style.cursor = 'pointer'
      hoverHandler({ kind: 'arrow', key: arrow }, hoverAt)
      return
    }
    const ray = rayAt(x, y)
    const id = pick(ray)
    // 누르기와 같게, 설비보다 앞에 있는 오브젝트만 오브젝트다.
    const object = pickObject(ray)
    if (object && (!id || object.d < pickDistance(ray, id))) {
      canvas.style.cursor = editMode && object.target.id === selectedObject ? 'grab' : 'pointer'
      hoverHandler(null, null)
      return
    }
    if (editMode && grabbable(ray)) canvas.style.cursor = 'grab'
    else if (id) canvas.style.cursor = 'pointer'
    const space = !id ? pickSpace(ray) : null
    if (!id && !(editMode && grabbable(ray))) canvas.style.cursor = space ? 'pointer' : ''
    hoverHandler(id ? { kind: 'equipment', id } : space ? { kind: 'space', id: space } : null, hoverAt)
  }

  /**
   * 광선에 맞은 설비. 합친 형상의 삼각형 수백만 개를 전부 보지 않고, 설비별 상자에 먼저 맞춰 본 뒤
   * 맞은 설비의 삼각형만 본다. 흐리게 칠한 설비는 고르지 않는다(보이지 않는 것을 고르면 헷갈린다).
   */
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const hitPoint = new Vector3()
  /** `faded` 면 흐리게 칠한 것도 고른다 — 하나를 고르면 상관없는 것이 흐려지는데, Ctrl+클릭으로 그것을 더하려면 잡혀야 한다(OE-UI-09). */
  function pick(ray: Ray, faded = false): string | null {
    const candidates: { part: Part; d: number }[] = []
    for (const part of parts) {
      if ((!faded && fadedIds.has(part.id)) || hiddenIds.has(part.id)) continue
      if (ray.intersectBox(part.box, hitPoint)) candidates.push({ part, d: hitPoint.distanceToSquared(ray.origin) })
    }
    candidates.sort((x, y) => x.d - y.d)
    let best: { id: string; d: number } | null = null
    for (const { part, d } of candidates) {
      if (best && d > best.d) break
      const { position: pos, index } = part.chunk
      for (let k = part.iStart; k < part.iStart + part.iCount; k += 3) {
        a.fromBufferAttribute(pos, index[k])
        b.fromBufferAttribute(pos, index[k + 1])
        c.fromBufferAttribute(pos, index[k + 2])
        if (!ray.intersectTriangle(a, b, c, false, hitPoint)) continue
        const dist = hitPoint.distanceToSquared(ray.origin)
        if (!best || dist < best.d) best = { id: part.id, d: dist }
      }
    }
    return best?.id ?? null
  }

  /** 광선이 이 설비 형상에 처음 닿는 거리(제곱). 안 닿으면 무한대. 오브젝트와 앞뒤를 가를 때 쓴다. */
  function pickDistance(ray: Ray, id: string): number {
    const part = partById.get(id)
    if (!part) return Infinity
    let best = Infinity
    const { position: pos, index } = part.chunk
    for (let k = part.iStart; k < part.iStart + part.iCount; k += 3) {
      a.fromBufferAttribute(pos, index[k])
      b.fromBufferAttribute(pos, index[k + 1])
      c.fromBufferAttribute(pos, index[k + 2])
      if (ray.intersectTriangle(a, b, c, false, hitPoint)) best = Math.min(best, hitPoint.distanceToSquared(ray.origin))
    }
    return best
  }

  /** 광선이 이 설비를 지나가는가. 앞에 다른 것이 있어도 참이다(pick 은 맨 앞의 것만 본다). */
  function hitsPart(ray: Ray, part: Part): boolean {
    if (!ray.intersectBox(part.box, hitPoint)) return false
    const { position: pos, index } = part.chunk
    for (let k = part.iStart; k < part.iStart + part.iCount; k += 3) {
      a.fromBufferAttribute(pos, index[k])
      b.fromBufferAttribute(pos, index[k + 1])
      c.fromBufferAttribute(pos, index[k + 2])
      if (ray.intersectTriangle(a, b, c, false, hitPoint)) return true
    }
    return false
  }

  /** 끌 수 있는 것: 고른 설비(여러 개면 그 중 하나)이고 좌표가 있고 흐리게 칠해지지 않았다. */
  function grabbable(ray: Ray): Part | null {
    for (const id of grabIds) {
      const part = movable.has(id) && !fadedIds.has(id) && !hiddenIds.has(id) && !frozenIds.has(id) ? partById.get(id) : undefined
      if (part && hitsPart(ray, part)) return part
    }
    return null
  }

  /** 상자 안(화면 좌표)에 형상 중심이 드는 설비. 숨긴 층은 뺀다. 흐리게 칠한 것은 넣는다(하나를 고르면 나머지가 흐려진다). */
  function partsInBox(x0: number, y0: number, x1: number, y1: number): string[] {
    const [l, r, t, b] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
    const out: string[] = []
    const center = new Vector3()
    for (const part of parts) {
      if (hiddenIds.has(part.id) || part.box.isEmpty()) continue
      const at = toScreen(part.box.getCenter(center))
      if (at && at.x >= l && at.x <= r && at.y >= t && at.y <= b) out.push(part.id)
    }
    return out
  }
  function drawBox(x: number, y: number) {
    if (!box?.el.parentElement) return
    // 상자는 캔버스의 부모(.canvas-wrap, position: relative) 안에 그린다.
    const parent = box.el.parentElement.getBoundingClientRect()
    const [l, t] = [Math.min(box.x, x) - parent.left, Math.min(box.y, y) - parent.top]
    Object.assign(box.el.style, { left: `${l}px`, top: `${t}px`, width: `${Math.abs(x - box.x)}px`, height: `${Math.abs(y - box.y)}px` })
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
  function tick(now = performance.now()) {
    if (!running) return
    resize()
    stepFlight(now)
    stepGlides(now)
    stepPulses(now)
    // 관성(damping)으로 도는 동안에는 update 가 참을 돌려준다. 그동안만 계속 그린다.
    if (controls.update()) dirty = true
    // 새로 연 모델은 덩어리를 한 프레임에 하나씩 켠다. 켜는 프레임에 그 덩어리만 GPU 로 올라간다.
    const next = chunks.find((c) => !c.shown)
    if (next) {
      showChunk(next)
      dirty = true
    }
    if (dirty) {
      if (handles.length) scaleHandles()
      renderer.render(scene, camera)
      dirty = false
    }
    if (hoverPending) updateHover()
    requestAnimationFrame(tick)
  }
  // 첫 틱도 다음 프레임에 — 아래에 선언한 비행·미끄러짐 상태를 읽기 때문이다.
  requestAnimationFrame(tick)

  /**
   * 상자가 화면에 꽉 차도록 카메라를 놓는다.
   *
   * 긴 변 하나만 보고 거리를 잡으면 안 된다. 세로 시야각으로만 계산하면 가로로 넓적한 건물이
   * 화면 밖으로 삐져나가고, 비스듬히 보는 각도에서는 더 커 보인다. 그렇다고 외접구에 맞추면 너무 멀다 —
   * 건물은 납작해서 구가 실제로 보이는 모양보다 훨씬 크고, 실제 BIM 이 전부 화면 폭의 60% 쯤에 떴다.
   * 상자 꼭짓점 여덟을 보는 방향으로 비춰 보고, 가로·세로 어느 쪽으로도 화면의 FILL 을 넘지 않는
   * 가장 가까운 거리를 잡는다.
   */
  const FILL = 0.88
  function fit(box: Box3, animate = true, from = new Vector3(1, 0.65, 1)) {
    const sphere = box.getBoundingSphere(new Sphere())
    if (sphere.radius <= 0) return

    const back = from.clone().normalize() // 대상에서 카메라 쪽
    const forward = back.clone().negate()
    const right = new Vector3().crossVectors(forward, camera.up).normalize()
    const up = new Vector3().crossVectors(right, forward)
    const tanV = Math.tan((camera.fov * Math.PI) / 360) * FILL
    const tanH = tanV * (camera.aspect || 1.6)

    const center = sphere.center
    let distance = 0
    const corner = new Vector3()
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center)
      // 카메라에서 이 꼭짓점까지의 깊이는 distance + (꼭짓점·앞). 화면 가장자리에 걸리는 깊이를 거꾸로 푼다.
      const ahead = corner.dot(forward)
      distance = Math.max(distance, Math.abs(corner.dot(right)) / tanH - ahead, Math.abs(corner.dot(up)) / tanV - ahead)
    }
    // 점 하나(좌표만 있는 설비)여도 붙어 서지 않게.
    distance = Math.max(distance, 2)

    const near = Math.max(distance / 1000, 0.01)
    const far = (distance + sphere.radius) * 10
    fly(center.clone(), center.clone().addScaledVector(back, distance), animate ? { near, far } : null)
    if (!animate) {
      camera.near = near
      camera.far = far
      camera.updateProjectionMatrix()
    }
  }

  // --- 카메라 비행 ---
  // 표·검사에서 고르거나 전체 보기를 누르면 시점이 순간이동해서 어디서 어디로 왔는지 잃었다. 짧게 날아간다.
  // 움직임을 끈 사람에게는 그대로 순간이동이다. 사람이 시점을 잡으면(controls 'start') 그 자리에서 멈춘다.
  const FLY_MS = 380
  /** 시작한 움직임 수(e2e 가 짧은 움직임을 놓치지 않게 센다). */
  const started = { flights: 0, glides: 0, pulses: 0 }
  let flight: { t0: number | null; fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3; near: number; far: number } | null = null
  function fly(target: Vector3, position: Vector3, clip: { near: number; far: number } | null) {
    flight = null
    if (!clip || still()) {
      controls.target.copy(target)
      camera.position.copy(position)
      if (clip) {
        camera.near = clip.near
        camera.far = clip.far
        camera.updateProjectionMatrix()
      }
      controls.update()
      dirty = true
      return
    }
    // 날아가는 동안 잘리지 않게 앞뒤 자르는 면을 두 시점 중 넓은 쪽으로 둔다. 도착하면 새 값으로 좁힌다.
    camera.near = Math.min(camera.near, clip.near)
    camera.far = Math.max(camera.far, clip.far)
    camera.updateProjectionMatrix()
    started.flights++
    flight = { t0: null, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: position, ...clip }
  }
  function stepFlight(now: number) {
    if (!flight) return
    if (flight.t0 === null) flight.t0 = now
    const k = Math.min(1, (now - flight.t0) / FLY_MS)
    const e = easeOut(k)
    controls.target.lerpVectors(flight.fromT, flight.toT, e)
    camera.position.lerpVectors(flight.fromP, flight.toP, e)
    if (k === 1) {
      camera.near = flight.near
      camera.far = flight.far
      camera.updateProjectionMatrix()
      flight = null
    }
    controls.update()
    dirty = true
  }
  controls.addEventListener('start', () => {
    if (!flight) return
    camera.near = Math.min(camera.near, flight.near)
    flight = null
  })

  // --- 되돌리기의 미끄러짐 ---
  // 되돌린 설비(와 따라온 배관)가 순간이동하지 않고 원래 자리로 미끄러진다. 꼭짓점을 두 배열 사이에서 섞는다.
  const GLIDE_MS = 240
  const glides = new Map<string, { part: Part; from: Float32Array; to: Float32Array; t0: number | null }>()
  function writePart(part: Part, positions: Float32Array) {
    const position = part.chunk.position
    ;(position.array as Float32Array).set(positions, part.vStart * 3)
    position.needsUpdate = true
  }
  function finishGlide(id: string) {
    const g = glides.get(id)
    if (!g) return
    glides.delete(id)
    writePart(g.part, g.to)
  }
  function stepGlides(now: number) {
    if (!glides.size) return
    for (const [id, g] of glides) {
      if (g.t0 === null) g.t0 = now
      const k = Math.min(1, (now - g.t0) / GLIDE_MS)
      if (k === 1) {
        finishGlide(id)
        continue
      }
      const e = easeOut(k)
      const mix = new Float32Array(g.to.length)
      for (let i = 0; i < mix.length; i++) mix[i] = g.from[i] + (g.to[i] - g.from[i]) * e
      writePart(g.part, mix)
    }
    dirty = true
  }
  /** 형상을 positions 로 바꾼다. glide 면 지금 자리에서 미끄러져 간다. 상자·화살표는 바로 도착한 자리로 둔다(고르기·판정은 끝 자리). */
  function setPartPositions(part: Part, positions: Float32Array, glide: boolean) {
    finishGlide(part.id)
    const arr = part.chunk.position.array as Float32Array
    const from = arr.slice(part.vStart * 3, (part.vStart + part.vCount) * 3)
    part.box.setFromArray(positions)
    if (glide && !still()) {
      glides.set(part.id, { part, from, to: positions, t0: null })
      started.glides++
    }
    else writePart(part, positions)
    if (hoverMarkKey === `equipment:${part.id}`) markHover(null)
    drawArrows()
    dirty = true
  }

  // --- 소속이 바뀐 방의 번쩍임 ---
  // 편집이 실제로 고치는 것은 hasLocation 한 줄이다. 설비가 새 방에 들어가면 그 방 바닥이 한 번 차올랐다 빠진다.
  const PULSE_MS = 1100
  const pulses: { mesh: Mesh; t0: number | null }[] = []
  function pulseSpaces(ids: Iterable<string>) {
    if (still()) return
    for (const id of ids) {
      const t = spaceTargets.find((x) => x.id === id)
      if (!t || t.ring.length < 3) continue
      if (visibleStoreys && !visibleStoreys.has(t.storeyId)) continue
      const shape = new Shape(t.ring.map(([x, y]) => new Vector2(x, y)))
      const geometry = new ShapeGeometry(shape)
      // Shape 는 IFC 평면(x, y)이라 바닥(x, -z)으로 눕힌다.
      geometry.rotateX(-Math.PI / 2)
      const mesh = new Mesh(
        geometry,
        new MeshBasicMaterial({ color: HOVER_COLORS.equipment, transparent: true, opacity: 0, depthTest: false, side: DoubleSide }),
      )
      mesh.position.y = t.y + 0.11
      mesh.renderOrder = 8
      overlay.add(mesh)
      pulses.push({ mesh, t0: null })
      started.pulses++
    }
    dirty = true
  }
  function stepPulses(now: number) {
    if (!pulses.length) return
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]
      if (p.t0 === null) p.t0 = now
      const k = (now - p.t0) / PULSE_MS
      if (k >= 1) {
        disposeObject(p.mesh)
        pulses.splice(i, 1)
        continue
      }
      // 빨리 차오르고(15%) 천천히 빠진다.
      ;(p.mesh.material as MeshBasicMaterial).opacity = 0.35 * (k < 0.15 ? k / 0.15 : 1 - easeOut((k - 0.15) / 0.85))
    }
    dirty = true
  }

  let fadedIds = new Set<string>()

  /** 설비 하나의 색을 꼭짓점 색에 칠한다. */
  const tint = new Color()
  function paintPart(part: Part, hex: number) {
    tint.setHex(hex)
    const r = Math.round(tint.r * 255)
    const g = Math.round(tint.g * 255)
    const b = Math.round(tint.b * 255)
    const attr = part.chunk.colors
    const arr = attr.array as Uint8Array
    const k0 = part.vStart * 3
    // 설비 하나는 한 색이다. 이미 그 색이면 덩어리를 다시 올리지 않는다.
    if (part.vCount && arr[k0] === r && arr[k0 + 1] === g && arr[k0 + 2] === b) return
    for (let v = part.vStart; v < part.vStart + part.vCount; v++) {
      arr[v * 3] = r
      arr[v * 3 + 1] = g
      arr[v * 3 + 2] = b
    }
    attr.needsUpdate = true
  }

  /** 켠 덩어리만 그린다. 비어 있는 쪽(흐린 설비가 없는 덩어리 등)은 그리기 호출을 아낀다. */
  function showChunk(chunk: Chunk) {
    chunk.shown = true
    chunk.solid.visible = chunk.solidCount > 0
    chunk.faded.visible = chunk.fadedCount > 0
  }

  /**
   * 보이는(진한) 설비와 흐린 설비의 삼각형 목록을 다시 짠다. 형상은 둘이 같이 쓴다. `only` 를 주면 그 덩어리만
   * 짠다 — 계통 하나를 고를 때 바뀌는 덩어리는 몇 개뿐이다.
   */
  function splitIndex(only?: ReadonlySet<Chunk>) {
    for (const chunk of chunks) {
      if (only && !only.has(chunk)) continue
      let solidCount = 0
      let fadedCount = 0
      for (const part of chunk.parts) {
        if (hiddenIds.has(part.id)) continue
        if (fadedIds.has(part.id) || dimIds.has(part.id)) fadedCount += part.iCount
        else solidCount += part.iCount
      }
      const solidIdx = new Uint32Array(solidCount)
      const fadedIdx = new Uint32Array(fadedCount)
      let si = 0
      let fi = 0
      for (const part of chunk.parts) {
        if (hiddenIds.has(part.id)) continue
        const slice = chunk.index.subarray(part.iStart, part.iStart + part.iCount)
        if (fadedIds.has(part.id) || dimIds.has(part.id)) {
          fadedIdx.set(slice, fi)
          fi += slice.length
        } else {
          solidIdx.set(slice, si)
          si += slice.length
        }
      }
      chunk.solid.geometry.setIndex(new BufferAttribute(solidIdx, 1))
      chunk.faded.geometry.setIndex(new BufferAttribute(fadedIdx, 1))
      chunk.solidCount = solidCount
      chunk.fadedCount = fadedCount
      chunk.solid.visible = chunk.shown && solidCount > 0
      chunk.faded.visible = chunk.shown && fadedCount > 0
    }
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
        spaceTargets.push({ id: space.id, storeyId: storey.id, y: storey.elevation + 0.1, ring: space.footprint })
      }
      if (pieces.length === 0) return
      const merged = mergeGeometries(pieces)
      for (const g of pieces) g.dispose()
      if (merged) {
        const slab = new Mesh(merged, new MeshLambertMaterial({ color, transparent: true, opacity: slabOpacity, side: DoubleSide }))
        slab.userData.storeyId = storey.id
        slabs.add(slab)
      }
    })
    content.add(slabs)
    applyStoreyVisibility()
  }

  // e2e 모드에서만 연다. 3D 는 DOM 이 아니라서 테스트가 어디를 눌러야 하는지 알 길이 이것뿐이다.
  if (import.meta.env.MODE === 'e2e') {
    ;(window as unknown as { __viewer?: unknown }).__viewer = {
      /** 마우스 아래 표시가 무엇에 그려져 있는지('equipment:id' · 'space:id' · ''). */
      hoverMark: () => (hoverMark ? hoverMarkKey : ''),
      /** 지금 도는 움직임(카메라 비행·미끄러지는 설비 수·번쩍이는 방 수). */
      /** 카메라 자리와 바라보는 점(three.js 좌표). 시점 조작(OE-OBJ-15)이 이동인지 회전인지 가른다 — 이동은 둘의 차가 그대로다. */
      camera: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
      motion: () => ({ flying: !!flight, gliding: glides.size, pulsing: pulses.length, started }),
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
      /** 설비 형상 전부의 중심(IFC 좌표, mm 로 반올림). 편집을 버린 뒤 3D 가 연 때로 돌아왔는지 견준다. */
      centers: () => {
        const out: Record<string, number[]> = {}
        for (const [id, part] of partById) {
          const c = part.box.getCenter(new Vector3())
          out[id] = [c.x, -c.z, c.y].map((v) => Math.round(v * 1000))
        }
        return out
      },
      handles: () => handles.map((h) => toScreen(h.position)),
      arrows: () =>
        arrowSegs.map((seg) => {
          const spec = arrowSpecs.find((a) => a.key === seg.key)
          return { key: seg.key, a: spec?.a, b: spec?.b, from: spec?.from, source: spec?.source, active: !!spec?.active, at: toScreen(seg.a.clone().lerp(seg.b, 0.5)) }
        }),
      point: (p: Vec3) => toScreen(new Vector3(...toScene(p))),
      /** 그린 추가 공간 오브젝트의 id. */
      objects: () => objectTargets.map((t) => t.id),
      /** 오브젝트 윗면 가운데의 화면 자리. 눌러 고르고 끄는 데 쓴다. */
      object: (id: string) => {
        const t = objectTargets.find((x) => x.id === id)
        if (!t) return null
        const center = t.box.getCenter(new Vector3())
        return toScreen(center.setY(t.box.max.y))
      },
      /** 오브젝트 상자(화면 세계 좌표). 늘린 모델이 상자에 맞는지 본다. */
      objectBox: (id: string) => {
        const t = objectTargets.find((x) => x.id === id)
        return t ? { min: t.box.min.toArray(), max: t.box.max.toArray() } : null
      },
      /** 그린 룸의 id. */
      rooms: () => roomTargets.map((t) => t.id),
      /** 룸 바닥의 화면 자리(가운데). 룸을 눌러 고르는 데 쓴다. */
      room: (id: string) => {
        const t = roomTargets.find((x) => x.id === id)
        if (!t) return null
        const [[x0, y0], , [x1, y1]] = t.ring
        return toScreen(new Vector3((x0 + x1) / 2, t.y, -(y0 + y1) / 2))
      },
      /** 천장 설비 링 수(보이는 층만)와 수직 점선이 가리키는 설비(OE-EQP-04). */
      ceilingMarks: () => ({
        rings: ceilingMarks.children.filter((o) => o.visible && o instanceof LineSegments).reduce((n, o) => n + (o.userData.count as number), 0),
        guide: (ceilingMarks.children.find((o) => o.visible && o.userData.guide)?.userData.guide as string | undefined) ?? null,
      }),
      /** 벽·문·창 편집 층에서 누를 수 있는 것의 id. */
      elements: () => archTargets.map((t) => t.id),
      /** 벽·문·창을 누를 화면 자리. 벽은 첫 외곽선 꼭짓점의 평균(곧은 벽이면 외곽선 안), 문·창은 자리다. */
      element: (id: string) => {
        const t = archTargets.find((x) => x.id === id)
        const ring = t?.rings?.[0]?.slice(0, -1)
        const p = t?.at ?? (ring?.length ? ([ring.reduce((a, q) => a + q[0], 0) / ring.length, ring.reduce((a, q) => a + q[1], 0) / ring.length] as Vec2) : null)
        return t && p ? toScreen(new Vector3(p[0], t.y, -p[1])) : null
      },
      /** 화면의 한 점을 누르면 무엇이 골라지는가(설비·벽·문·창·물리존). */
      pickAt: (x: number, y: number) => {
        const ray = rayAt(x, y)
        return { equipment: pick(ray), element: archTargets.length ? pickElement(ray) : null, space: pickSpace(ray) }
      },
      /** 합친 설비 형상의 크기와 켠 덩어리 수. 첫 그리기에 GPU 로 올리는 양을 잰다. */
      stats: () => {
        let bytes = 0
        let vertices = 0
        let indices = 0
        for (const c of chunks) {
          const g = c.solid.geometry
          bytes += ['position', 'normal', 'color'].reduce((n, k) => n + (g.getAttribute(k)?.array.byteLength ?? 0), 0) + c.index.byteLength
          vertices += c.position.count
          indices += c.index.length
        }
        return { parts: parts.length, chunks: chunks.length, shown: chunks.filter((c) => c.shown).length, vertices, indices, mb: Math.round(bytes / 1048576) }
      },
      /** 보이는 판의 층 id. 층별로 보기를 잰다. */
      visibleStoreys: () => slabs.children.filter((o) => o.visible).map((o) => o.userData.storeyId as string),
      /**
       * 화면의 한 점에서 맨 앞에 맞는 설비, 그 시선이 id 설비도 지나는지, 연결 화살표가 걸리는지.
       * 가림은 카메라 거리에 따라 달라서 테스트가 찾아 쓴다. 화살표 위를 누르면 고르기가 아니라 방향 바꾸기다.
       */
      hit: (x: number, y: number, id: string) => {
        const part = partById.get(id)
        const ray = rayAt(x, y).clone()
        return { front: pick(ray), through: part ? hitsPart(ray, part) : false, arrow: hitArrow(x, y) !== null }
      },
    }
  }

  const api: Viewer = {
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

      // 덩어리로 나눈다. 설비 하나는 한 덩어리 안에만 든다(끌기·칠하기가 설비 단위다).
      const groups: (typeof pieces)[] = []
      let group: typeof pieces = []
      let groupVertices = 0
      for (const piece of pieces) {
        const vCount = piece.p.length / 3
        if (group.length && groupVertices + vCount > CHUNK_VERTICES) {
          groups.push(group)
          group = []
          groupVertices = 0
        }
        group.push(piece)
        groupVertices += vCount
      }
      if (group.length) groups.push(group)

      chunks = []
      const solidMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
      // 아주 옅게 남긴다. 아예 지우면 연결망이 건물 어디쯤인지 알 수 없고, 진하면 가는 배관 한 줄이 묻힌다.
      const fadedMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.08, depthWrite: false })
      for (const members of groups) {
        let vTotal = 0
        let iTotal = 0
        for (const piece of members) {
          vTotal += piece.p.length / 3
          iTotal += piece.i.length
        }
        const positions = new Float32Array(vTotal * 3)
        const normals = new Float32Array(vTotal * 3)
        const index = new Uint32Array(iTotal)
        const solidGeometry = new BufferGeometry()
        const fadedGeometry = new BufferGeometry()
        const chunk: Chunk = {
          position: new BufferAttribute(positions, 3),
          // 색은 바이트로 둔다. 부동소수로 두면 꼭짓점마다 12바이트라 올리는 양의 4분의 1이 색이었다.
          colors: new BufferAttribute(new Uint8Array(vTotal * 3), 3, true),
          index,
          solid: new Mesh(solidGeometry, solidMaterial),
          faded: new Mesh(fadedGeometry, fadedMaterial),
          parts: [],
          shown: false,
          solidCount: 0,
          fadedCount: 0,
        }
        let vo = 0
        let io = 0
        for (const piece of members) {
          const vCount = piece.p.length / 3
          const p = piece.p
          positions.set(p, vo * 3)
          normals.set(piece.n, vo * 3)
          for (let k = 0; k < piece.i.length; k++) index[io + k] = piece.i[k] + vo
          // 상자는 맨 루프로 잰다. 성수는 꼭짓점이 1천만 개라 Vector3 를 거치면 여기서 0.1초가 나갔다.
          let x0 = Infinity
          let y0 = Infinity
          let z0 = Infinity
          let x1 = -Infinity
          let y1 = -Infinity
          let z1 = -Infinity
          for (let k = 0; k < p.length; k += 3) {
            if (p[k] < x0) x0 = p[k]
            if (p[k] > x1) x1 = p[k]
            if (p[k + 1] < y0) y0 = p[k + 1]
            if (p[k + 1] > y1) y1 = p[k + 1]
            if (p[k + 2] < z0) z0 = p[k + 2]
            if (p[k + 2] > z1) z1 = p[k + 2]
          }
          const box = vCount ? new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1)) : new Box3()
          const part: Part = { id: piece.id, color: piece.color, chunk, vStart: vo, vCount, iStart: io, iCount: piece.i.length, box }
          chunk.parts.push(part)
          parts.push(part)
          partById.set(part.id, part)
          vo += vCount
          io += piece.i.length
        }
        const normalAttr = new BufferAttribute(normals, 3)
        for (const g of [solidGeometry, fadedGeometry]) {
          g.setAttribute('position', chunk.position)
          g.setAttribute('normal', normalAttr)
          g.setAttribute('color', chunk.colors)
        }
        for (const part of chunk.parts) paintPart(part, part.color)
        // 합친 형상은 경계가 크고 켜 둔 채 시점을 돌린다. 화면 밖 판정은 꺼 둔다.
        chunk.solid.frustumCulled = false
        chunk.faded.frustumCulled = false
        content.add(chunk.solid, chunk.faded)
        chunks.push(chunk)
      }
      splitIndex()
      // 같은 모델을 다시 그리는 것(편집 뒤)은 한꺼번에 켠다. 나눠 켜면 편집할 때마다 건물이 사라졌다 다시 찬다.
      if (options?.keepView) for (const chunk of chunks) showChunk(chunk)
      // 층마다 따로 만든다. 층별로 보기가 층 단위로 켜고 끈다.
      walls = new Group()
      for (const storey of model.storeys) {
        const w = wallMesh({ ...model, storeys: [storey] }, meshes)
        if (!w) continue
        w.userData.storeyId = storey.id
        walls.add(w)
      }
      if (walls.children.length === 0) walls = null
      if (walls) {
        walls.visible = wallsVisible
        content.add(walls)
        applyStoreyVisibility()
      }

      scene.add(content)
      dirty = true
      if (options?.keepView) return

      // 건물이 화면에 꽉 차게 카메라를 놓는다. 원점 근처에 고정해 두면 실제 좌표가 먼
      // 모델이 화면 밖으로 나가서, 임포트가 잘 됐는데도 빈 화면처럼 보인다.
      // 설비 형상은 이미 잰 설비별 상자로 합친다. setFromObject 는 덩어리마다 꼭짓점을 다시 훑었다.
      const box = new Box3()
      for (const part of parts) box.union(part.box)
      const own = new Set(chunks.flatMap((c) => [c.solid, c.faded]))
      for (const child of content.children) if (!own.has(child as Mesh)) box.expandByObject(child)
      if (box.isEmpty()) return
      fit(box, false)
    },

    setHighlight(highlight) {
      lastHighlight = highlight
      // 끌 수 있는 것은 고른 설비 하나다(pointerdown 참조).
      selectedPart = highlight?.selected ?? null
      grabIds = highlight?.group ? new Set(highlight.group) : selectedPart ? new Set([selectedPart]) : new Set()
      if (hoverAt) hoverPending = true
      const nextFaded = new Set<string>()
      for (const part of parts) {
        const id = part.id
        let next = part.color
        if (highlight) {
          if (id === highlight.selected || highlight.group?.has(id)) next = PICK_COLORS.selected
          else if (highlight.upstream.has(id)) next = PICK_COLORS.upstream
          else if (highlight.downstream.has(id)) next = PICK_COLORS.downstream
          else if (highlight.ruleUpstream?.has(id)) next = PICK_COLORS.ruleUpstream
          else if (highlight.ruleDownstream?.has(id)) next = PICK_COLORS.ruleDownstream
          else if (highlight.linked.has(id)) next = highlight.keepColor ? part.color : PICK_COLORS.linked
          // 고른 것과 상관없는 설비는 흐리게 한다. 지우지 않으면 연결망이 숲에 묻힌다. 여러 개 고르는 중에는 흐리게 하지 않는다 —
          // 흐린 것은 고를 수 없다.
          else if (!highlight.group) nextFaded.add(id)
        }
        // 천장 편집 모드에서 천장 설비가 아닌 것은 회색이다(고른 것·상류·하류 색은 둔다).
        if (next === part.color && dimIds.has(id)) next = DIM_COLOR
        paintPart(part, next)
      }
      // 흐리게 하기가 바뀐 설비가 든 덩어리만 인덱스를 다시 짠다.
      const touched = new Set<Chunk>()
      for (const id of nextFaded) if (!fadedIds.has(id)) touched.add(partById.get(id)!.chunk)
      for (const id of fadedIds) {
        const part = partById.get(id)
        if (part && !nextFaded.has(id)) touched.add(part.chunk)
      }
      const changed = touched.size > 0
      fadedIds = nextFaded
      if (changed) splitIndex(touched)
      dirty = true
      // 흐리게 칠한 것은 고를 수 없으니, 계통을 바꾸면 마우스 아래가 고를 수 있는지도 바뀐다.
      if (changed && hoverAt) hoverPending = true
    },

    setWallsVisible(on) {
      wallsVisible = on
      if (walls) walls.visible = on
      dirty = true
    },

    onBoxSelect(handler) {
      boxHandler = handler
    },

    onPick(handler) {
      pickHandler = handler
    },

    onHover(handler) {
      hoverCb = handler
    },

    focus(id) {
      const part = partById.get(id)
      if (!part || part.box.isEmpty()) return
      const center = part.box.getCenter(new Vector3())
      // 거리는 그대로 두고 바라보는 곳만 옮긴다. 확대까지 하면 어디를 보고 있었는지 잃는다.
      const offset = (flight ? flight.toP.clone().sub(flight.toT) : camera.position.clone().sub(controls.target))
      fly(center, center.clone().add(offset), { near: camera.near, far: camera.far })
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

    shiftEquipment(id, delta, glide = false) {
      const part = partById.get(id)
      if (!part) return false
      finishGlide(id)
      const [dx, dy, dz] = toScene(delta)
      const arr = part.chunk.position.array as Float32Array
      const next = arr.slice(part.vStart * 3, (part.vStart + part.vCount) * 3)
      for (let i = 0; i < next.length; i += 3) {
        next[i] += dx
        next[i + 1] += dy
        next[i + 2] += dz
      }
      setPartPositions(part, next, glide)
      return true
    },

    setEquipmentPositions(id, positions, glide = false) {
      const part = partById.get(id)
      if (!part || positions.length !== part.vCount * 3) return false
      setPartPositions(part, positions, glide)
      return true
    },

    pulseSpaces(ids) {
      pulseSpaces(ids)
    },

    markConflict(id) {
      clearConflict()
      const part = partById.get(id)
      if (!part || part.box.isEmpty()) return
      const size = part.box.getSize(new Vector3()).max(new Vector3(0.05, 0.05, 0.05)).addScalar(0.06)
      conflictMark = new LineSegments(new EdgesGeometry(new BoxGeometry(size.x, size.y, size.z)), new LineBasicMaterial({ color: CONFLICT_COLOR, depthTest: false }))
      part.box.getCenter(conflictMark.position)
      conflictMark.renderOrder = 10
      overlay.add(conflictMark)
      dirty = true
      conflictTimer = window.setTimeout(clearConflict, CONFLICT_MS)
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

    setArchitecture(model, selected) {
      buildArchitecture(model, selected)
    },

    setHvacZones(model, selected) {
      zoneLines.traverse((o) => {
        if (o instanceof LineLoop) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      zoneLines.clear()
      const elevation = new Map((model?.storeys ?? []).map((s) => [s.id, s.elevation]))
      for (const zone of model?.hvac?.zones ?? []) {
        if (!zone.storeyId) continue
        const y = (elevation.get(zone.storeyId) ?? 0) + 0.2
        for (const ring of zone.footprint) {
          const points = ring.map((p) => new Vector3(p[0], y, -p[1]))
          const line = new LineLoop(
            new BufferGeometry().setFromPoints(points),
            new LineBasicMaterial({ color: zone.id === selected ? ARCH_COLORS.selected : ZONE_COLOR }),
          )
          line.userData.storeyId = zone.storeyId
          zoneLines.add(line)
        }
      }
      applyStoreyVisibility()
    },

    setCustomZones(model, selected) {
      customZones.traverse((o) => {
        if (o instanceof LineLoop || o instanceof Mesh) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      customZones.clear()
      for (const storey of model?.storeys ?? []) {
        const y = storey.elevation + CUSTOM_ZONE_LIFT
        for (const zone of storey.customZones ?? []) {
          const on = zone.id === selected
          const points = zone.footprint.map((p) => new Vector3(p[0], y, -p[1]))
          const line = new LineLoop(
            new BufferGeometry().setFromPoints(points),
            on ? new LineBasicMaterial({ color: ARCH_COLORS.selected }) : new LineDashedMaterial({ color: CUSTOM_ZONE_COLOR, dashSize: 0.4, gapSize: 0.25 }),
          )
          line.computeLineDistances()
          line.userData.storeyId = storey.id
          customZones.add(line)
          if (on && zone.footprint.length >= 4) {
            const shape = new Shape(zone.footprint.slice(0, -1).map((p) => new Vector2(p[0], p[1])))
            const face = new Mesh(new ShapeGeometry(shape), new MeshBasicMaterial({ color: ARCH_COLORS.selected, transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false }))
            // ShapeGeometry 는 xy 평면이다. IFC 평면(x, y)을 three 바닥(x, -z)으로 눕힌다.
            face.rotation.x = -Math.PI / 2
            face.position.y = y
            face.userData.storeyId = storey.id
            customZones.add(face)
          }
        }
      }
      applyStoreyVisibility()
    },

    setCeilingMarks(marks, selected) {
      ceilingMarks.traverse((o) => {
        if (o instanceof LineSegments || o instanceof Line) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      ceilingMarks.clear()
      // 층마다 링 전부를 선분 한 덩어리로 — 성수는 천장 설비가 1천 대 가까워 링마다 객체를 두면 그리기 호출이 그만큼 는다.
      const byStorey = new Map<string, CeilingMark[]>()
      for (const m of marks) byStorey.set(m.storeyId, [...(byStorey.get(m.storeyId) ?? []), m])
      const color = new Color()
      for (const [storeyId, list] of byStorey) {
        const positions = new Float32Array(list.length * CEILING_RING_SIDES * 6)
        const colors = new Float32Array(positions.length)
        let o = 0
        for (const m of list) {
          const box = partById.get(m.id)?.box
          const r = box ? Math.max(CEILING_RING_MIN, Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2) : CEILING_RING_MIN
          const [cx, , cz] = toScene(m.at)
          const y = m.floor + CEILING_RING_LIFT
          color.setHex(CEILING_RING_COLORS[m.zone])
          for (let k = 0; k < CEILING_RING_SIDES; k++) {
            const a = (k / CEILING_RING_SIDES) * Math.PI * 2
            const b = ((k + 1) / CEILING_RING_SIDES) * Math.PI * 2
            positions.set([cx + r * Math.cos(a), y, cz + r * Math.sin(a), cx + r * Math.cos(b), y, cz + r * Math.sin(b)], o)
            colors.set([color.r, color.g, color.b, color.r, color.g, color.b], o)
            o += 6
          }
        }
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(positions, 3))
        g.setAttribute('color', new BufferAttribute(colors, 3))
        const rings = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }))
        rings.userData.storeyId = storeyId
        rings.userData.count = list.length
        ceilingMarks.add(rings)
      }
      const picked = selected ? marks.find((m) => m.id === selected) : undefined
      if (picked) {
        const [x, top, z] = toScene(picked.at)
        const line = new Line(
          new BufferGeometry().setFromPoints([new Vector3(x, top, z), new Vector3(x, picked.floor + CEILING_RING_LIFT, z)]),
          new LineDashedMaterial({ color: CEILING_RING_COLORS[picked.zone], dashSize: 0.15, gapSize: 0.1 }),
        )
        line.computeLineDistances()
        line.userData.storeyId = picked.storeyId
        line.userData.guide = picked.id
        ceilingMarks.add(line)
      }
      applyStoreyVisibility()
    },

    setCeilingView(view) {
      ceilingPlanes.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      ceilingPlanes.clear()
      for (const plane of view?.planes ?? []) {
        for (const ring of plane.rings) {
          const open = ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring
          if (open.length < 3) continue
          const face = new Mesh(
            new ShapeGeometry(new Shape(open.map((p) => new Vector2(p[0], p[1])))),
            new MeshBasicMaterial({ ...CEILING_PLANE, transparent: true, side: DoubleSide, depthWrite: false }),
          )
          // ShapeGeometry 는 xy 평면이다. IFC 평면(x, y)을 three 바닥(x, -z)으로 눕힌다.
          face.rotation.x = -Math.PI / 2
          face.position.y = plane.z
          face.userData.storeyId = plane.storeyId
          ceilingPlanes.add(face)
        }
      }
      // 물리존 판도 옅게 — 천장면 아래 바닥이 진하면 천장 설비가 묻힌다.
      for (const o of slabs.children) {
        const m = (o as Mesh).material as MeshLambertMaterial
        m.opacity = view ? Math.min(slabOpacity, 0.12) : slabOpacity
      }
      const nextDim = view?.dim ?? new Set<string>()
      const touched = new Set<Chunk>()
      for (const id of nextDim) if (!dimIds.has(id)) touched.add(partById.get(id)?.chunk as Chunk)
      for (const id of dimIds) if (!nextDim.has(id)) touched.add(partById.get(id)?.chunk as Chunk)
      touched.delete(undefined as unknown as Chunk)
      dimIds = nextDim
      if (touched.size) splitIndex(touched)
      api.setHighlight(lastHighlight)
      applyStoreyVisibility()
    },

    setFrozen(ids) {
      frozenIds = ids
    },

    topView() {
      const box = new Box3()
      for (const part of parts) if (!hiddenIds.has(part.id)) box.union(part.box)
      for (const o of slabs.children) if (o.visible) box.expandByObject(o)
      if (box.isEmpty()) box.setFromObject(content)
      // 바로 위는 OrbitControls 가 위쪽 방향을 잃는다. +z(IFC −y) 쪽으로 아주 조금 기울여 화면 위쪽이 IFC +y 가 되게 한다.
      if (!box.isEmpty()) fit(box, true, new Vector3(0, 1, 0.02))
    },

    setRooms(model, selected, conflict = null) {
      rooms.traverse((o) => {
        if (o instanceof LineLoop || o instanceof Mesh) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      rooms.clear()
      roomTargets = []
      for (const storey of model?.storeys ?? []) {
        const y = storey.elevation + ROOM_LIFT
        for (const room of storey.rooms ?? []) {
          const on = room.id === selected
          const color = room.id === conflict ? ROOM_COLORS.conflict : on ? ARCH_COLORS.selected : ROOM_COLORS.line
          const line = new LineLoop(new BufferGeometry().setFromPoints(room.footprint.map((p) => new Vector3(p[0], y, -p[1]))), new LineBasicMaterial({ color }))
          line.userData.storeyId = storey.id
          rooms.add(line)
          if (on || room.id === conflict) {
            const shape = new Shape(room.footprint.slice(0, -1).map((p) => new Vector2(p[0], p[1])))
            const face = new Mesh(new ShapeGeometry(shape), new MeshBasicMaterial({ color, transparent: true, opacity: 0.2, side: DoubleSide, depthWrite: false }))
            face.rotation.x = -Math.PI / 2
            face.position.y = y
            face.userData.storeyId = storey.id
            rooms.add(face)
          }
          roomTargets.push({ id: room.id, storeyId: storey.id, y, ring: room.footprint })
        }
      }
      applyStoreyVisibility()
    },

    setSpaceObjects(model, library, models, selected, conflict = null) {
      if (drag?.kind === 'object') return // 끄는 중에 다시 그리면 잡은 것을 잃는다. 놓으면 다시 불린다.
      spaceObjects.traverse((o) => {
        if (o instanceof Mesh || o instanceof LineSegments) {
          if (!o.userData.shared) o.geometry.dispose()
          if (!o.userData.shared) (o.material as { dispose(): void }).dispose()
        }
      })
      spaceObjects.clear()
      objectTargets = []
      selectedObject = selected
      for (const storey of model?.storeys ?? []) {
        for (const o of storey.spaceObjects ?? []) {
          const [w, d, h] = o.size
          const node = new Group()
          node.position.set(o.at[0], storey.elevation, -o.at[1])
          node.userData.storeyId = storey.id
          const item = library(o.item)
          const tint = o.id === conflict ? OBJECT_CONFLICT : null
          const loaded = item?.glb ? models.get(item.key) : undefined
          if (loaded) {
            // 넣은 모델은 상자에 맞춰 축마다 늘인다(glTF 는 y 가 위라 장면 좌표 그대로다).
            const copy = loaded.clone(true)
            const box = new Box3().setFromObject(copy)
            const ext = box.getSize(new Vector3())
            copy.scale.set(w / (ext.x || 1), h / (ext.y || 1), d / (ext.z || 1))
            const center = box.getCenter(new Vector3())
            copy.position.set(-center.x * copy.scale.x, -box.min.y * copy.scale.y, -center.z * copy.scale.z)
            copy.traverse((m) => {
              if (m instanceof Mesh) {
                m.userData.shared = true
                if (tint !== null) {
                  m.material = new MeshLambertMaterial({ color: tint })
                  m.userData.shared = false
                }
              }
            })
            node.add(copy)
          } else {
            const parts = item?.parts ?? [{ box: [0, 0, 0, 1, 1, 1] as const, material: 'panel' as const }]
            for (const p of parts) {
              const [x0, y0, z0, x1, y1, z1] = p.box
              const g = new BoxGeometry((x1 - x0) * w, (z1 - z0) * h, (y1 - y0) * d)
              const mesh = new Mesh(g, new MeshLambertMaterial({ color: tint ?? (item ? OBJECT_COLORS[p.material] : OBJECT_FALLBACK) }))
              mesh.position.set(((x0 + x1) / 2 - 0.5) * w, ((z0 + z1) / 2) * h, -((y0 + y1) / 2 - 0.5) * d)
              node.add(mesh)
            }
          }
          if (o.id === selected || o.id === conflict) {
            const edges = new LineSegments(new EdgesGeometry(new BoxGeometry(w, h, d)), new LineBasicMaterial({ color: o.id === conflict ? OBJECT_CONFLICT : OBJECT_SELECTED, depthTest: false }))
            edges.position.y = h / 2
            edges.renderOrder = 2
            node.add(edges)
          }
          spaceObjects.add(node)
          const box = new Box3(new Vector3(o.at[0] - w / 2, storey.elevation, -o.at[1] - d / 2), new Vector3(o.at[0] + w / 2, storey.elevation + h, -o.at[1] + d / 2))
          objectTargets.push({ id: o.id, storeyId: storey.id, box, node })
        }
      }
      applyStoreyVisibility()
    },

    onPickObject(handler) {
      objectPickHandler = handler
    },

    onObjectMove(handler) {
      objectMoveHandler = handler
    },

    onPickElement(handler) {
      elementHandler = handler
    },

    setDark(on) {
      if (dark === on) return
      dark = on
      drawHandles()
      drawArrows()
    },

    frameAll() {
      // 보이는 것만. 한 층만 보는 중이면 그 층에 맞춘다.
      const box = new Box3()
      for (const part of parts) if (!hiddenIds.has(part.id)) box.union(part.box)
      for (const o of slabs.children) if (o.visible) box.expandByObject(o)
      if (box.isEmpty()) box.setFromObject(content)
      if (!box.isEmpty()) fit(box)
    },

    setPlaceMode(elevation) {
      placeElevation = elevation
      canvas.style.cursor = elevation === null ? '' : 'crosshair'
    },

    onPlace(handler) {
      placeHandler = handler
    },

    setStoreyFilter(storeys, hidden) {
      visibleStoreys = storeys
      hiddenIds = hidden
      applyStoreyVisibility()
      splitIndex()
      drawArrows()
      if (hoverAt) hoverPending = true
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
      window.removeEventListener('blur', onBlur)
      if (import.meta.env.MODE === 'e2e') delete (window as unknown as { __viewer?: unknown }).__viewer
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      disposeContent()
      renderer.dispose()
    },
  }
  return api
}
