// 임포트 결과를 3D 로 띄운다. 임포트가 맞았는지 눈으로 확인하는 것이 이 화면의 일이다.
//
// 표로는 안 잡히는 실패가 있다. 배치 사슬을 잘못 타면 방이 전부 원점에 겹쳐 쌓이는데,
// 개수도 넓이도 그대로라서 숫자만 봐서는 멀쩡해 보인다. 3D 로 띄우면 즉시 보인다.
//
// 설비는 상자 점이 아니라 IFC 의 실제 형상으로 그린다. 배관·덕트는 점으로 찍으면 계통이
// 어디로 지나가는지가 사라져서, 연결을 추정한 것이 맞는지 눈으로 확인할 수가 없다.

import { hvacZonesOf } from './hvac-zone'
import { zoneServes, ZONE_SERVE_COLOR, type ZoneServe } from './idf/zone-view'
import {
  Box3,
  MOUSE,
  TOUCH,
  Color,
  Ray,
  Sphere,
  Spherical,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
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
  TextureLoader,
  PerspectiveCamera,
  Plane,
  Raycaster,
  RingGeometry,
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
import { wallShapes } from './wall-view'
import { distanceToRing, pointInPolygon } from './mapping'
import { easeOut, still } from './motion'
import { isMultiSelect } from './shortcuts'
import { alongOf, cutWall, openingRect, type OpeningCut } from './opening-cut'
import { createReplayFx, type ReplayViewerApi } from './replay-viewer'
import { createNavCube } from './nav-cube'
import { type LibraryItem, type ObjectMaterial } from './space-object'
import { CONTEXT_ITEMS } from './object-names'
import { partId } from './vertical-object'
import { flowPulseMesh, setFlowTime, type FlowEdge, type FlowSegment } from './flow-pulse'
import { CONFLICT_LAYER, CONFLICT_STYLE, createSelectionOutline, HOVER_LAYER, HOVER_STYLE, OUTLINE_LAYER, SELECTED_STYLE } from './selection-outline'
import { createGroundGrid } from './ground-grid'
import { DROP_MAX, DROP_MS, dropPose, poseVertices, SHAKE_MS, shakeOffset, SINK_MS, sinkPose } from './drop-in'
import { addEdges, setEdgeTheme } from './model-edges'
import { conduitFlowType, flowTypeColor, systemFlowType } from './flow-type'

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

/**
 * 계통에 색을 배정한다. 범례와 3D 가 같은 값을 봐야 해서 한 곳에서 만든다.
 *
 * 계통 종류·유체로 Flow Type 이 정해지고 그 색이 glossary 범례에 있으면 그 색이다(OE-OBJ-12 — 급기 계통은 어느 건물이든 `#99FF00`).
 * 종류를 모르거나 범례 색이 미정(냉매·급수 …)인 계통만 SYSTEM_COLORS 를 순환한다.
 */
export function systemColors(model: Model): Map<string, number> {
  return new Map(model.systems.map((s, i) => [s.id, flowTypeColor(systemFlowType(s.kind, s.fluid)) ?? SYSTEM_COLORS[i % SYSTEM_COLORS.length]]))
}

/** 계통이 없는 설비. 색을 안 주면 안 보이므로 중립 회색으로 둔다. */
const NO_SYSTEM = 0x98a1ab

/**
 * 설비 하나의 색. 덕트·배관은 그 구간의 Flow Type 색(사람이 그리거나 고른 값이 계통 계산보다 앞선다 — `conduitFlowType`)이고,
 * Flow Type 을 모르거나 색이 미정이면 기기처럼 계통 색이다. 공급·환수가 한 계통에 섞인 BIM 계통에서 사람이 구간마다 고른 Flow Type 이
 * 색으로 갈려 보이게 하려는 것이다. 3D 화면과 GLB 내보내기(export/mesh3d.ts)가 같이 쓴다.
 */
export function equipmentColor(
  e: Model['storeys'][number]['equipment'][number],
  systemOf: (id: string) => Model['systems'][number] | undefined,
  colorOf: Map<string, number>,
): number {
  const flow = flowTypeColor(conduitFlowType(e, systemOf)?.code)
  if (flow !== null) return flow
  return e.systemId ? (colorOf.get(e.systemId) ?? NO_SYSTEM) : NO_SYSTEM
}

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
/** 겹친 상대 표시가 떠 있는 시간(ms). 알림 줄(App 의 note)과 비슷하게 둔다. */
const CONFLICT_MS = 2600

/**
 * 내력벽 색. 내력벽 여부를 BIM 이 말하지 않은 벽은 "모름" 으로 따로 칠한다 — 비내력으로 숨기면
 * 모르는 벽이 내력벽이 아닌 것처럼 보인다. 비내력벽은 그리지 않는다.
 */
/** 벽·문·창 편집 층의 색. 비내력벽은 회색, 고른 것은 액센트 하나다. 내력·모름은 WALL_COLORS 를 같이 쓴다. */
/** 만들 수 없는 미리보기(건물 밖)·재검토 연결의 색. */
const PREVIEW_WARN = 0xd1495b
/** 이어 놓을 수 있는 지점(후보)과 유효한 연속 연결의 색(OE-ML-06 AC4). */
const PREVIEW_CANDIDATE = 0xe0803a
const PREVIEW_OK = 0x1f9d7a
/** 만드는 동안 보이는 슬래브 개구부(OE-ML-06 AC5) — 확정은 보라, 초안(확인 전)은 노랑. */
const PREVIEW_CUT = 0x8a4fd8
const PREVIEW_DRAFT = 0xc99a12
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
/**
 * 문·창의 모양(OE-OBJ-07). 벽에 그 자리를 뚫고(opening-cut.ts) 문틀 두 기둥과 문짝·유리를 세운다. 벽처럼 단면(ARCH_WALL_HEIGHT)
 * 위는 자르고, 그 위의 실제 문·창 윤곽은 벽의 실제 높이 윤곽선과 같이 옅은 선으로 그린다. 문틀 폭·문짝·유리 두께(미터)와 유리 색.
 */
const OPENING_FRAME = 0.05
const DOOR_LEAF = 0.04
const GLASS = 0.02
const GLASS_COLOR = { color: 0x9cc3e6, opacity: 0.4 }
/** 다크 테마의 문짝·문틀. ARCH_COLORS.door(짙은 회청)는 어두운 바탕(#1c1f26)에 묻혀 바깥 벽의 문이 뚫린 구멍처럼 보였다. */
const DOOR_DARK = 0x6b7a90
/** 크기를 모르는 문·창(ADR-0009 의 기본값과 같다). */
const FALLBACK_SIZE = { door: [0.9, 2.1], window: [1.0, 1.0] } as const
/** 문·창을 누를 때 자리에서 이만큼 안이면 그 문·창이다(미터). */
const ELEMENT_REACH = 0.35
/** 룸(OE-OBJ-03) 외곽선 높이(층 바닥 위, 미터). 물리존 판(+0.1)과 커스텀존(+0.25) 사이다. */
const ROOM_LIFT = 0.18
const ROOM_COLORS = { line: 0xc0782a, conflict: 0xd93636 }
/** 수직 관통 오브젝트(OE-ML-05) 조각 높이(층 바닥 위, 미터). 룸(+0.18) 위라 바닥을 누르면 룸·물리존보다 먼저 닿는다. */
const VERTICAL_LIFT = 0.22
/**
 * 계단 조각 색. 평면도·내보낸 파일 뷰어는 분홍이지만 3D 는 층 판이 층마다 색(STOREY_COLORS, 분홍도 있다)이라 어느 색이든 한 층에서는
 * 묻힌다. 판 위에서 늘 진하게 읽히는 짙은 회색으로 둔다. 고른 것은 액센트 파랑이다.
 */
const VERTICAL_COLOR = 0x2a2f3a
/** 형상 없이 지점만 있는 조각(끝 층)을 누르는 반경(미터). */
const VERTICAL_POINT_REACH = 0.6
/** 추가 공간 오브젝트(OE-OBJ-09) 재질 색. 설비·벽과 헷갈리지 않게 가구다운 무채색·나무색으로 둔다. */
const OBJECT_COLORS: Record<ObjectMaterial, number> = {
  wood: 0xb08a5e,
  frame: 0x6b7280,
  fabric: 0x8796ad,
  panel: 0xc9ced6,
  board: 0xf4f5f7,
  pot: 0x9c6b4e,
  leaf: 0x5f9e5a,
  screen: 0x2b2f36,
  ceramic: 0xf1f2f4,
  // 주변 건물 매스·지형(조경 파일). 건물보다 흐리게 — 맥락이지 고칠 대상이 아니다.
  mass: 0xd7dbe2,
  ground: 0xc8c2a8,
}
/** 넣은 모델을 못 읽었을 때(아직 읽는 중이거나 깨진 파일) 그리는 상자 색. */
const OBJECT_FALLBACK = 0xa7adb7
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
  /** 비내력벽(칸막이). 편집 모드의 보통 벽(ARCH_COLORS.wall)과 같은 회색이다. */
  ordinary: 0xb7bec7,
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
 * 음영을 낸다(docs/dev/ui-notes.md). 색·텍스처·투명도는 그대로 둔다.
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
  /** `preview` 는 사람이 고르고 아직 [적용] 하지 않은 방향이다(OE-PIP-04). 색은 편집과 같고 점선이다. */
  source: 'port' | 'edit' | 'preview' | 'rule' | 'none'
  /** 키보드([ ])로 짚은 연결. 가운데에 표시를 달아 D 가 어느 연결을 바꿀지 보인다. */
  active?: boolean
}

/**
 * 연결 화살표 색. 설비 선택의 상류·하류 색과 달리 **방향의 출처**로 가른다 — 편집할 때 궁금한 것은 어느 쪽이
 * 상류인가보다 그 방향을 누가 말했는가(고칠 수 있는가)다. 포트(BIM)는 진하게, 사람이 정한 것은 화면의 액센트
 * 하나로, 규칙(사전)은 옅게 둔다. 규칙과 방향 모름은 점선이다.
 */
export const ARROW_COLORS = { port: 0x39424e, edit: 0x2f6fed, preview: 0x2f6fed, rule: 0xa3acb7, none: 0xc2c8cf }
/**
 * 다크 테마의 화살표 색. 라이트 색을 그대로 두면 포트 방향(진한 회색)이 어두운 바탕에 묻혀, 가장 믿을 만한
 * 방향이 가장 안 보인다. 밝기 순서(포트 > 편집 > 규칙 > 모름)는 라이트와 같게 둔다.
 */
export const ARROW_COLORS_DARK = { port: 0xd5d9e0, edit: 0x6f9bf5, preview: 0x6f9bf5, rule: 0x7c8494, none: 0x596070 }
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

/** 수직 관통 오브젝트 구간 바꾸기(OE-ML-08)에서 적용 전에 사람이 그린 형상·찍은 지점. 점선으로 그린다. */
/** 적용 전 미리보기. `path` 는 그리는 중인 층간 배관의 경로(공통 좌표)다(OE-ML-12). */
/**
 * 회전 손잡이(OE-OBJ-15 AC6). `center` 둘레 반지름 `radius` 의 고리와 `angle`(평면 방위 °, +x 에서 반시계) 방향의 손잡이다. `guide` 가 있으면
 * 그 방향으로 중심을 지나는 점선(자석 스냅의 기준선)을, `label` 이 있으면 손잡이 옆에 글을 띄운다.
 */
export type RotateHandle = { center: Vec2; elevation: number; radius: number; angle: number; guide: number | null; label: string }
/** 점선 미리보기. `warn` 이면 경고 색(빨강)으로 그린다 — 만들기 미리보기가 건물 밖으로 나갈 때(OE-ML-06 AC3). */
export type VerticalPreview = { storeyId: string; elevation: number; footprint?: readonly Vec2[]; point?: Vec2; path?: readonly Vec3[]; warn?: boolean; tone?: 'candidate' | 'ok' | 'cut' | 'draft' }

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
  /** 주어진 설비들이 화면에 꽉 차게 카메라를 맞춘다. 연결망만 보고 싶을 때 쓴다. margin(미터)만큼 둘레를 더 보인다. */
  frame(ids: Iterable<string>, margin?: number): void
  /** 움직이지 않은 우클릭(ui-notes 보기 필터). 누른 자리의 설비 id(없으면 null)와 화면 좌표. 끈 오른쪽 드래그는 그대로 회전이다. */
  onContext(handler: (id: string | null, x: number, y: number) => void): void
  /** 보이는 것 전체에 맞춘다. `keep` 이면 지금 보는 방향 그대로(전체 맞추기), 아니면 처음 시점 방향(카메라 초기화). */
  frameVisible(keep: boolean): void
  /**
   * Brick 클래스별 분해도(ui-notes 보기 필터). 묶음마다 그 설비를 건물 위로 한 켜씩 띄우고(평면 자리는 그대로) 켜 옆에 라벨을 단다.
   * 화면에서만 옮긴다 — 모델·편집 파일에는 아무것도 남지 않고, 다시 그리거나 설비를 옮기면 먼저 제자리로 돌아온다.
   * `null` 이면 제자리로. 띄웠으면 true.
   */
  setExplode(groups: readonly { label: string; ids: readonly string[] }[] | null): boolean
  /** 분해도가 펼쳐져 있나. 다시 그리기 등으로 저절로 접힐 수 있어 화면이 이것으로 맞춘다. */
  exploded(): boolean
  /**
   * 설비를 제자리에서 다른 색으로 칠한다(독의 [Explode] — Brick 클래스별 색, App.vue). 맵에 없는 설비(덕트·배관 등)는 흐린 회색이다.
   * 고른 것·상류·하류 색은 그 위에 그대로 칠한다. `null` 이면 계통 색으로 돌아간다. 화면에서만이다.
   */
  setTint(colors: ReadonlyMap<string, number> | null): void
  /** 보기 모드 3D 의 벽을 켜고 끈다. 모델을 바꿔도 켜 둔 상태는 남는다. */
  setWallsVisible(on: boolean): void
  /** 편집 모드를 켜고 끈다. 끄면 3D 는 보기 전용이고, 누르고 끄는 것은 전부 시점 조작이다. */
  setEditMode(on: boolean): void
  /**
   * 편집 모드가 꺼져 있어도 꼭짓점 손잡이만은 끌게 한다. 다중층 뷰(OE-ML-07)는 설비·물리존을 고치지 않고 수직 관통 오브젝트 조각의 형상만
   * 고친다 — 편집 모드를 켜면 고른 설비도 끌린다.
   */
  setHandleEdit(on: boolean): void
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
  /** 꼭짓점 손잡이를 누르면 부른다. 바로 방향키로 옮길 수 있게 고른 꼭짓점으로 잡는다. */
  onVertexPick(handler: (index: number) => void): void
  /** 손잡이·외곽선·바닥 미리보기 채움을 즉시 옮긴다(방향키 연타 중 프레임 배칭 전 미리보기). */
  previewVertex(index: number, to: Vec2): void
  /** 손잡이를 끌어 놓으면 부른다. IFC 평면 좌표로 넘긴다. */
  onVertexMove(handler: (spaceId: string, index: number, to: Vec2) => void): void
  /** 회전 손잡이를 그린다. null 이면 지운다. 화면은 끄는 동안 이 값을 다시 넣어 손잡이·기준선·글을 옮긴다. */
  setRotateHandle(spec: RotateHandle | null): void
  /**
   * 회전 손잡이 끌기. `move` 는 마우스가 가리키는 방위(°)와 Alt 를 눌렀는지, `end` 는 버튼을 뗀 것, `cancel` 은 Esc·창 포커스 잃음이다.
   * Shift+왼쪽 드래그는 손잡이 위에서 시작해도 시점 회전이라 여기로 오지 않는다(OE-OBJ-15).
   */
  onRotate(handler: (phase: 'move' | 'end' | 'cancel', angle: number, free: boolean) => void): void
  /** 연결 화살표. 빈 배열이면 지운다. */
  setArrows(arrows: readonly Arrow[]): void
  /** 고른 계통의 흐름을 달리는 빛으로 보인다(flow-pulse.ts). 색은 계통 색이다. null 이면 걷는다. */
  setFlow(flow: { edges: readonly FlowEdge[]; color: number } | null): void
  /**
   * 흐름 방향의 연쇄(flow-cascade.ts). 확정·적용으로 TTL 에 나가는 방향이 바뀐 연결을 물결(wave) 순서대로 강조색 화살표로 띄웠다가
   * 걷는다. 평소 화살표(setArrows, 고른 설비의 이웃)와 따로 겹쳐 그린다. 움직임을 끈 사람에게는 한꺼번에 띄웠다가 걷는다.
   */
  playCascade(items: readonly { a: string; b: string; from: string; wave: number }[]): void
  /** 편집 모드가 아니어도 화살표를 그린다(누르지는 못한다). 편집 리플레이가 바뀐 흐름을 보일 때 쓴다. */
  setArrowsShown(on: boolean): void
  onArrowClick(handler: (key: string) => void): void
  /** 물리존 판만 다시 만든다. 경계 하나를 고쳤다고 설비 1만 8천 개까지 다시 만들 까닭이 없다. */
  updateSpaces(model: Model): void
  /**
   * 벽·문·창 편집 층(E4). model 이 null 이면 끈다. 켜면 벽 외곽선(모델의 값, 편집이 바로 보인다)과 문·창 자리를
   * 그리고, 편집 모드에서 바닥을 누르면 물리존보다 벽·문·창을 먼저 고른다.
   */
  /** `also` 는 같이 고른 색으로 칠할 벽(외벽 에디터의 같은 면 묶음, OE-EXT-03). */
  setArchitecture(model: Model | null, selected: string | null, also?: ReadonlySet<string>): void
  /** 외곽선 층의 벽 입체를 프레임마다 조금씩 미리 압출해 둔다(짓지는 않는다). 리플레이가 오프닝 동안 부른다. */
  warmArchitecture(model: Model): void
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
   * 수직 관통 오브젝트의 층별 조각(OE-ML-05): 그 층의 형상, 진입 지점(채운 원)·종료 지점(빈 고리). 바닥을 누르면 룸·물리존보다 먼저
   * 골라진다(onPickSpace 로 조각 id 가 간다). 고른 조각을 다시 누르면 그 아래 룸·물리존이 골라진다 — 계단실을 고칠 길이다. 끌어 옮기지 않는다.
   * `selected` 는 고른 조각 id 들이다. 층 편집은 고른 조각 하나, 다중층 뷰는 고른 오브젝트의 모든 층 조각이다(OE-ML-01).
   */
  setVerticalParts(model: Model | null, selected: ReadonlySet<string>, preview?: readonly VerticalPreview[]): void
  /**
   * 천장 설비의 바닥 발자국 링과, 고른 설비에서 링까지의 수직 점선(OE-EQP-04). 빈 배열이면 지운다. 층별로 보기를 따르고
   * 고르지 않는다 — 링을 눌러도 바닥(물리존)이 골라진다.
   */
  setCeilingMarks(marks: readonly CeilingMark[], selected: string | null): void
  /** 천장 편집 모드의 천장면과 회색 처리. null 이면 지운다. 반자 높이가 있는 층만 면이 있다. */
  setCeilingView(view: CeilingView | null): void
  /** 끌어 옮기지 못하는 설비(모드 밖의 설비, OE-OBJ-08). 고르기는 된다. */
  setFrozen(ids: ReadonlySet<string>): void
  /** 얼린(지금 모드에서 고칠 수 없는) 고른 설비를 끌려 했다. 화면은 이유를 알린다(OE-UI-04 · OE-OBJ-08). 끌기는 시점 이동이 된다. */
  onFrozenGrab(handler: (id: string) => void): void
  /**
   * 평면도 배경 이미지(OE-MAN-02). 네 귀퉁이(IFC 평면, 왼쪽 위부터 시계 방향)에 이미지를 펴서 층 바닥 바로 위에 깐다. 누를 수 없고,
   * 물리존을 그리는 바닥 클릭은 그대로 바닥에 찍힌다. null 이면 걷는다.
   */
  setBackground(bg: { url: string; corners: readonly [Vec2, Vec2, Vec2, Vec2]; elevation: number; opacity: number } | null): void
  /** 그리드(OE-UI-07). 선(IFC 평면 x·y 값)과 높이. null 이면 지운다. 고르기 대상이 아니다. */
  setGrid(grid: { x: readonly number[]; y: readonly number[]; elevation: number; extent: { minX: number; minY: number; maxX: number; maxY: number } } | null): void
  /** 보이는 것 전체를 위에서 내려다본다. 화면 위쪽이 IFC +y(평면도와 같은 방위)다. */
  topView(): void
  /** 보이는 것 전체를 이 방향(대상에서 카메라 쪽, 장면 좌표 — x 는 IFC x, y 는 위, z 는 IFC −y)에서 본다. 방향 큐브가 부른다. */
  viewFrom(dir: readonly [number, number, number]): void
  /** 오른쪽 위 방향 큐브(nav-cube.ts)를 이 캔버스에 붙인다. 떼는 함수를 돌려준다. */
  attachNavCube(canvas: HTMLCanvasElement): () => void
  /**
   * 비행 모드. 켜면 WASD 로 앞·좌·뒤·우, Q/E 로 내려가기·올라가기(키는 flyKey 로 받는다), 왼쪽·오른쪽 드래그로 제자리에서 둘러보기,
   * 휠로 빠르기를 바꾼다. 끄면 지도식 시점으로 돌아오고 눈앞의 점을 도는 중심으로 둔다.
   */
  setFly(on: boolean): void
  /** 비행 중 눌린·뗀 키(`KeyW` 같은 code). 글자 칸·단축키 판단은 화면이 하고 넘긴다. `null` 이면 다 뗀다(창이 초점을 잃었을 때). */
  flyKey(code: string | null, down: boolean): void
  /** 지금 눈(카메라)의 높이(IFC z, 미터). 비행 중 층 이동(E E · Q Q)이 다음 층을 고를 때 쓴다. */
  eyeHeight(): number
  /** 눈과 보는 점을 함께 이 높이(IFC z)로 0.4초에 옮긴다. 가로 자리와 보는 방향은 그대로다. 비행 중 층 이동이 부른다. */
  flyToHeight(z: number): void
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
   * 개발용 성능 표. 지난 1초에 그린 장수, 마지막 프레임을 그린 시간(ms), draw call 수, 삼각형 수. 3D 는 바뀔 때만 그려서 가만히 있으면
   * 그린 장수가 0 이다.
   */
  stats(): { fps: number; renderMs: number; calls: number; triangles: number }
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
  /** 놓기 모드에서 마우스가 가리키는 바닥 점(IFC x, y)과 Alt 를 눌렀는지. 벗어나면 null. 스냅 자리를 미리 보이는 데 쓴다(OE-UI-06). */
  onPlaceHover(handler: ((at: Vec2 | null, alt: boolean) => void) | null): void
  /**
   * 놓기 전 미리보기(OE-SPC-14 · OE-SPC-15). 놓을 자리(`at`, IFC 평면)와 바닥 높이(`elevation`, IFC z)에 놓을 것의 반투명 모양을 세운다.
   * `item` 이 있으면 그 라이브러리 항목의 조각 모양, `shape` 가 있으면 그 설비 형상(ADR-0059 로 빌려 올 모양 — `origin` 은 그 설비의 좌표이고
   * `elevation` 은 새 설비의 좌표 높이다), 둘 다 없으면 `size` 상자다(바닥이 `elevation`). `blocked` 면 붉게 칠하고 그 상대를 붉은 외곽선으로
   * 짚는다. null 이면 걷는다.
   */
  setPlaceGhost(ghost: { at: Vec2; elevation: number; size: Vec3; item?: LibraryItem | null; shape?: { id: string; origin: Vec3 }; blocked: { kind: 'equipment' | 'object'; id: string } | null } | null): void
  /**
   * 스냅 표시(OE-UI-06). 붙을 자리(점)와, 변에 붙었으면 그 변을 높이 `elevation` 바닥 위에 그린다. 그리드 교점이면 점만이다.
   * null 이면 지운다.
   */
  setSnapMarker(marker: { at: Vec2; kind: 'vertex' | 'edge' | 'grid'; edge?: [Vec2, Vec2]; elevation: number } | null): void
  /**
   * 끄는 동안 자리를 보정한다(OE-UI-07 그리드, OE-UI-06 스냅). 설비·오브젝트는 옮긴 거리(IFC 평면)를, 물리존 꼭짓점은 놓일 점을
   * 받아 보정한 값을 돌려준다. 끄는 동안의 3D 와 놓을 때 넘기는 값이 같다. null 이면 보정하지 않는다.
   */
  setDragSnap(snap: { delta(kind: 'equipment' | 'object', id: string, delta: Vec2): Vec2; point(spaceId: string, index: number, at: Vec2): Vec2 } | null): void
  /**
   * 시점이 바뀌면 부른다(한 프레임에 한 번). 바라보는 점의 IFC 평면 좌표와, 그 거리에서 화면 가로 절반이 덮는 길이(m).
   * 비교 판(ExportCompare.vue, ADR-0061)의 평면이 3D 를 따라간다. null 이면 뗀다.
   */
  onView(handler: ((view: { target: Vec2; halfWidth: number }) => void) | null): void
  /** 물리존 하나가 화면에 들어오게 한다. `steep` 이면 지금 방위 그대로 위에서 내려다보듯 높이 선다 — 벽이 방을 덜 가린다. */
  frameSpace(id: string, steep?: boolean): void
  /**
   * 공간 보기(App.vue). 그 방 바닥을 강조색으로 채우고(벽 너머로도 보인다) 같은 층의 다른 방 판과 벽을 흐리게 한다. null 이면 되돌린다.
   * 화면에서만이다. 판·벽을 다시 만들어도(편집) 다시 건다.
   */
  setSpaceFocus(id: string | null): void
  /**
   * 설비 형상 상자 가운데의 화면 좌표(창 기준 px). 그려지지 않았거나(다른 층·숨김) 카메라 뒤·캔버스 밖이면 null.
   * 3D 위 설비 라벨(App.vue 의 equipmentLabels)이 쓴다.
   */
  screenOf(ids: readonly string[]): ({ x: number; y: number } | null)[]
  /** 3D 를 다시 그릴 때마다 오르는 수. 라벨이 그대로인 화면에서 자리를 다시 재지 않게 본다. */
  viewVersion(): number
  /**
   * 화면의 오른쪽·위쪽이 IFC 평면에서 어느 쪽인가(단위 벡터). 방향키로 설비를 옮길 때 쓴다. 비스듬히 보면
   * 화면 위쪽은 바닥에서 "멀어지는 쪽" 이다.
   */
  planeAxes(): { right: Vec2; up: Vec2 }
  dispose(): void
} & ReplayViewerApi

/**
 * 합친 형상의 한 덩어리. 설비 형상을 한 벌로 합치면 첫 그리기에 GPU 로 한 번에 올라가서 성수(정점 1천만 개,
 * 403MB)에서 화면이 3초 멈췄다. 덩어리로 나눠 한 프레임에 하나씩 켜면 올리는 일도 프레임마다 나뉜다.
 * 옮기거나 칠할 때도 그 덩어리만 다시 올린다(전부 올리면 방향키 한 번에 122MB 가 다시 갔다).
 */
export type Chunk = {
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
export type Part = {
  id: string
  color: number
  chunk: Chunk
  /** 덩어리 안의 꼭짓점 범위(색을 바꿀 때)와 삼각형 인덱스 범위(보이기·고르기). */
  vStart: number
  vCount: number
  iStart: number
  iCount: number
  box: Box3
  /** 그린 형상의 출처(형상 데이터 또는 상자 자리). 편집 뒤 다시 그릴 때 바뀌었는지 가른다(patchModel). */
  src?: unknown
}

/** 한 층의 벽을 한 덩어리로 합친다(wall-view.ts). 내력벽·모름·보통 벽을 색으로 가른다. */
function wallMesh(storey: Model['storeys'][number], meshes?: MeshMap): Mesh | null {
  const shapes = wallShapes(storey, meshes)
  const pieces = shapes.map(({ tone, mesh }) => ({ color: new Color(WALL_COLORS[tone]), mesh }))
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
  mesh.userData.rebuilt = shapes.filter((w) => w.rebuilt).map((w) => w.id)
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
  const hemi = new HemisphereLight(0xffffff, 0x6f7684, 0.9)
  scene.add(hemi)
  const sun = new DirectionalLight(0xffffff, 1.45)
  sun.position.set(-0.5, 1, 0.6)
  sun.target.position.set(0, 0, -1)
  camera.add(sun, sun.target)
  scene.add(camera)

  let content = new Group()
  scene.add(content)
  // 고른 것의 외곽선(selection-outline.ts)과 바닥 아래 격자(ground-grid.ts). 둘 다 모델을 다시 지어도 남는다.
  const selectionOutline = createSelectionOutline(renderer, SELECTED_STYLE, OUTLINE_LAYER)
  // 커서 아래에서 누르면 골라질 것(미리 강조, OE-UI-27). 같은 장치를 옅고 가늘게 쓴다. 고른 것보다 먼저 그려 고른 것이 위에 온다.
  const hoverOutline = createSelectionOutline(renderer, HOVER_STYLE, HOVER_LAYER)
  const hoverMasks = new Group()
  scene.add(hoverMasks)
  // 겹쳐서 막은 상대(OE-SPC-15). 고른 것보다 위에 그린다 — 막혔다는 것이 지금 가장 먼저 읽혀야 한다.
  const conflictOutline = createSelectionOutline(renderer, CONFLICT_STYLE, CONFLICT_LAYER)
  const conflictMasks = new Group()
  scene.add(conflictMasks)
  // 놓기 전 미리보기(setPlaceGhost)와 지운 것의 가라앉는 사본(지울 때 가라앉기). 둘 다 고르기 대상이 아니다.
  const placeGhost = new Group()
  placeGhost.visible = false
  scene.add(placeGhost)
  const exiting = new Group()
  scene.add(exiting)
  const ground = createGroundGrid()
  scene.add(ground.mesh)
  /** 외곽선 마스크로만 그리는 설비 형상(덩어리 형상을 나눠 쓴다). OUTLINE_LAYER 에만 있어 보통 장면에는 안 보인다. */
  const outlineMasks = new Group()
  scene.add(outlineMasks)

  // **설비는 한 덩어리로 합쳐 그린다.** 설비마다 메시·재질을 따로 두면 매 프레임 그리기 호출이 설비 수만큼
  // 나간다. 성수 기계 파일은 1만 8천 개라 시점을 돌릴 때마다 버벅였다. 지금은 형상을 하나로 합치고, 설비별
  // 색은 꼭짓점 색으로, 흐리게 할 것은 같은 형상을 공유하는 두 번째 메시(반투명)로 옮겨 그린다.
  // 그리기 호출이 설비 수와 상관없이 두 번이다.
  let parts: Part[] = []
  let partById = new Map<string, Part>()
  let chunks: Chunk[] = []
  // IFC 벽(#599). 고르기 대상이 아니다(pick 은 설비만 본다). 벽 너머의 설비를 누를 수 있어야 해서다.
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
    // 층을 잇는 선(진입 → 종료)은 양 끝 층이 다 보일 때만이다. 한 층만 보면 다른 층으로 뻗은 선만 떠 있게 된다.
    for (const o of verticals.children) o.visible = o.userData.storeys ? (o.userData.storeys as string[]).every((id) => !visibleStoreys || visibleStoreys.has(id)) : storeyShown(o)
    for (const o of ceilingMarks.children) o.visible = storeyShown(o)
    for (const o of ceilingPlanes.children) o.visible = storeyShown(o)
    for (const o of spaceObjects.children) o.visible = storeyShown(o)
    placeGround()
    markOutline()
    dirty = true
  }
  let pickHandler: (id: string | null, additive?: boolean) => void = () => {}
  let contextHandler: (id: string | null, x: number, y: number) => void = () => {}
  let boxHandler: (ids: string[]) => void = () => {}
  /** Ctrl+끌기로 그리는 고르기 상자(OE-UI-09). 화면 좌표의 시작점과 그리는 DOM 상자. */
  let box: { x: number; y: number; el: HTMLDivElement } | null = null
  let hoverCb: (target: HoverTarget | null, at: { x: number; y: number } | null) => void = () => {}
  const hoverHandler = (target: HoverTarget | null, at: { x: number; y: number } | null) => {
    markHover(target)
    hoverCb(target, at)
  }
  let placeElevation: number | null = null
  let placeHoverHandler: ((at: Vec2 | null, alt: boolean) => void) | null = null
  /** 마지막 마우스 이동 때 Alt 를 누르고 있었나. 놓기 모드의 알림에 같이 실어 보낸다(이어 놓기의 고정 풀기). */
  let hoverAlt = false
  let dragSnap: { delta(kind: 'equipment' | 'object', id: string, delta: Vec2): Vec2; point(spaceId: string, index: number, at: Vec2): Vec2 } | null = null
  let placeHandler: (at: Vec2) => void = () => {}

  // **움직일 때만 다시 그린다.** 가만히 있을 때도 매 프레임 1만 8천 개를 다시 그리면 화면 전체(스크롤,
  // 입력칸)가 같이 느려진다. 시점이 바뀌거나 색·모델이 바뀌었을 때만 그린다.
  let dirty = true
  // 시점을 알릴 곳(onView). 비행·관성으로 한 프레임에 여러 번 바뀌어도 프레임마다 한 번만 알린다.
  let viewHandler: ((view: { target: Vec2; halfWidth: number }) => void) | null = null
  let viewPending = false
  const invalidate = () => {
    dirty = true
    if (viewHandler && !viewPending) {
      viewPending = true
      requestAnimationFrame(() => {
        viewPending = false
        const t = controls.target
        const d = camera.position.distanceTo(t)
        viewHandler?.({ target: [t.x, -t.z], halfWidth: d * Math.tan((camera.fov * Math.PI) / 360) * (camera.aspect || 1.6) })
      })
    }
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
  let handleEdit = false
  /** 편집 모드가 아니어도 화살표를 그리나(setArrowsShown). */
  let arrowsShown = false
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
  let vertexPickHandler: (index: number) => void = () => {}
  let vertexHandler: (spaceId: string, index: number, to: Vec2) => void = () => {}
  let rotateHandler: (phase: 'move' | 'end' | 'cancel', angle: number, free: boolean) => void = () => {}
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
  /** 지난 setSpaceObjects 에 있던 오브젝트. 새로 보이는 id 가 놓기로 생긴 것이다(떨어져 앉기). 파일을 새로 열면 null. */
  let prevObjectIds: Set<string> | null = null
  let objectPickHandler: (id: string) => void = () => {}
  let objectMoveHandler: (id: string, delta: Vec2) => void = () => {}
  /**
   * 설비·계통을 고르는 동안 오브젝트(가구)를 흐리게 한다. 흐린 설비처럼 옅게만 남기고 고를 수 없다 — 성수 10층에서 계통을 고르면
   * 의자·책상이 천장 아래 배관을 가렸고, 가구를 눌러 배관을 고를 수 없었다. 고른 오브젝트는 흐리게 하지 않는다(끌던 것을 잃는다).
   */
  let objectsFaded = false
  const OBJECT_FADED_OPACITY = 0.08
  /** 흐리게 할 오브젝트인가. 설비·계통을 고른 동안, 또는 공간 보기(setSpaceFocus)에서 그 방 밖에 선 것. */
  function objectFaded(node: Object3D): boolean {
    if (node.userData.objectId === selectedObject) return false
    if (objectsFaded) return true
    const t = focusSpaceId ? spaceTargets.find((x) => x.id === focusSpaceId) : null
    return !!t && !(node.userData.storeyId === t.storeyId && pointInPolygon([node.position.x, -node.position.z], t.ring))
  }
  function fadeObjects() {
    for (const node of spaceObjects.children) {
      const fade = objectFaded(node)
      node.traverse((o) => {
        if (o instanceof LineSegments && o.userData.edges) o.visible = !fade
        if (!(o instanceof Mesh)) return
        const base = o.userData.baseMaterial as Material | Material[] | undefined
        if (fade && !base) {
          o.userData.baseMaterial = o.material
          const faded = (m: Material) => {
            const c = m.clone()
            c.transparent = true
            c.opacity = Math.min(m.opacity, OBJECT_FADED_OPACITY)
            c.depthWrite = false
            return c
          }
          o.material = Array.isArray(o.material) ? o.material.map(faded) : faded(o.material)
        } else if (!fade && base) {
          for (const m of [o.material].flat()) m.dispose()
          o.material = base
          delete o.userData.baseMaterial
        }
      })
    }
    dirty = true
  }
  /** 광선에 맞은 맨 앞의 오브젝트와 거리(제곱). 숨긴 층의 것과 흐리게 한 것은 뺀다. */
  function pickObject(ray: Ray): { target: ObjectTarget; d: number } | null {
    let best: { target: ObjectTarget; d: number } | null = null
    const at = new Vector3()
    for (const target of objectTargets) {
      if (visibleStoreys && !visibleStoreys.has(target.storeyId)) continue
      if (objectFaded(target.node)) continue
      if (!ray.intersectBox(target.box, at)) continue
      const d = at.distanceToSquared(ray.origin)
      if (!best || d < best.d) best = { target, d }
    }
    return best
  }
  /** 누를 수 있는 룸. 물리존 판보다 먼저 본다(pickSpace). */
  let roomTargets: { id: string; storeyId: string; y: number; ring: readonly Vec2[] }[] = []
  /** 누를 수 있는 수직 관통 오브젝트 조각(OE-ML-05). 룸보다 먼저 본다. 고른 조각은 건너뛰어 그 아래가 골라지게 한다. */
  const verticals = new Group()
  scene.add(verticals)
  let verticalTargets: { id: string; storeyId: string; y: number; ring: readonly Vec2[]; at: Vec2 }[] = []
  let selectedVertical: ReadonlySet<string> = new Set()
  const ceilingMarks = new Group()
  scene.add(ceilingMarks)
  const ceilingPlanes = new Group()
  scene.add(ceilingPlanes)
  // 평면도 배경 이미지(OE-MAN-02). 지금 깐 것의 귀퉁이를 e2e 가 읽는다.
  const backdrop = new Group()
  // 그리드(OE-UI-07). 바닥판 바로 위의 가는 선.
  const gridGroup = new Group()
  let gridCount = 0
  scene.add(backdrop)
  scene.add(gridGroup)
  // 스냅 표시(OE-UI-06). 붙을 자리의 고리와 붙은 변.
  const snapGroup = new Group()
  scene.add(snapGroup)
  let snapState: { at: Vec2; kind: 'vertex' | 'edge' | 'grid' } | null = null
  let backdropCorners: readonly [Vec2, Vec2, Vec2, Vec2] | null = null
  let dimIds: ReadonlySet<string> = new Set()
  let frozenIds: ReadonlySet<string> = new Set()
  let frozenGrabHandler: (id: string) => void = () => {}
  let lastHighlight: Highlight | null = null
  /** setTint 의 덧칠. 있으면 설비의 바탕색이 계통 색 대신 이것이다. */
  let tintColors: ReadonlyMap<string, number> | null = null
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
  let dragFill: Mesh | null = null
  // 마우스 아래 있는 것의 표시. 설비는 상자 테두리(액센트), 방은 바닥 외곽선(점선)이라 무엇 위에 있는지 모양으로 갈린다.
  let hoverMark: Line | null = null
  let hoverMarkKey = ''
  let arrowSpecs: readonly Arrow[] = []
  let arrowObjects: (Line | Mesh)[] = []
  let arrowSegs: { key: string; a: Vector3; b: Vector3 }[] = []
  let flowSpec: { edges: readonly FlowEdge[]; color: number } | null = null
  let flowMesh: Mesh | null = null

  type Drag =
    | { kind: 'equipment'; part: Part; original: Float32Array; box: Box3; plane: Plane; start: Vector3; delta: Vector3 }
    | { kind: 'object'; target: ObjectTarget; origin: Vector3; plane: Plane; start: Vector3; delta: Vector3 }
    | { kind: 'vertex'; index: number; plane: Plane; offset: Vector3; at: Vector3 }
    | { kind: 'rotate'; plane: Plane; angle: number; free: boolean }
  let drag: (Drag & { x: number; y: number; moved: boolean }) | null = null

  function disposeObject(o: Line | Mesh) {
    overlay.remove(o)
    o.geometry.dispose()
    ;(o.material as { dispose(): void }).dispose()
  }

  /** 손잡이는 화면에서 늘 같은 크기로 보이게 한다. 성수처럼 넓은 모델에서 10cm 상자는 점도 안 된다. */
  function scaleHandles() {
    for (const h of handles) h.scale.setScalar(camera.position.distanceTo(h.position) * 0.012 * (h.userData.size ?? 1))
    if (rotateKnob) rotateKnob.scale.setScalar(camera.position.distanceTo(rotateKnob.position) * 0.016)
  }

  // --- 회전 손잡이 (OE-OBJ-15 AC6) ---------------------------------------------------------------------
  // 고리·손잡이·기준선은 overlay 에 그리고, 각도 글은 캔버스 위 div 로 띄운다(손잡이 화면 자리를 따라간다).
  let rotateSpec: RotateHandle | null = null
  let rotateParts: (Line | Mesh)[] = []
  let rotateKnob: Mesh | null = null
  let rotateLabel: HTMLDivElement | null = null
  function drawRotate() {
    for (const o of rotateParts) disposeObject(o)
    rotateParts = []
    rotateKnob = null
    dirty = true
    const spec = rotateSpec
    if (!spec) {
      rotateLabel?.remove()
      rotateLabel = null
      return
    }
    const y = toScene([0, 0, spec.elevation])[1] + 0.05
    const at = (a: number, r: number) => new Vector3(spec.center[0] + Math.cos(a) * r, y, -(spec.center[1] + Math.sin(a) * r))
    const ring = new LineLoop(
      new BufferGeometry().setFromPoints(Array.from({ length: 72 }, (_, i) => at((i / 72) * Math.PI * 2, spec.radius))),
      new LineBasicMaterial({ color: ARCH_COLORS.selected, transparent: true, opacity: 0.8, depthTest: false }),
    )
    ring.renderOrder = 10
    overlay.add(ring)
    rotateParts.push(ring as unknown as Line)
    const rad = (spec.angle * Math.PI) / 180
    const spoke = new Line(new BufferGeometry().setFromPoints([at(0, 0), at(rad, spec.radius)]), new LineBasicMaterial({ color: ARCH_COLORS.selected, depthTest: false }))
    spoke.renderOrder = 10
    overlay.add(spoke)
    rotateParts.push(spoke)
    if (spec.guide !== null) {
      const g = (spec.guide * Math.PI) / 180
      const guide = new Line(
        new BufferGeometry().setFromPoints([at(g + Math.PI, 40), at(g, 40)]),
        new LineDashedMaterial({ color: 0xe0803a, dashSize: 0.5, gapSize: 0.35, depthTest: false }),
      )
      guide.computeLineDistances()
      guide.renderOrder = 10
      overlay.add(guide)
      rotateParts.push(guide)
    }
    const knob = new Mesh(new OctahedronGeometry(1, 2), new MeshBasicMaterial({ color: ARCH_COLORS.selected, depthTest: false }))
    knob.position.copy(at(rad, spec.radius))
    knob.renderOrder = 11
    overlay.add(knob)
    rotateParts.push(knob)
    rotateKnob = knob
    scaleHandles()
    if (!rotateLabel) {
      rotateLabel = document.createElement('div')
      rotateLabel.className = 'rotate-label'
      rotateLabel.dataset.testid = 'rotate-label'
      Object.assign(rotateLabel.style, { position: 'absolute', pointerEvents: 'none', zIndex: '5', transform: 'translate(12px, -50%)' })
      canvas.parentElement?.appendChild(rotateLabel)
    }
    rotateLabel.textContent = spec.label
    placeRotateLabel()
  }
  /** 각도 글을 손잡이의 화면 자리에 둔다. 시점이 바뀌면 다시 둔다. */
  function placeRotateLabel() {
    if (!rotateLabel || !rotateKnob) return
    // toScreen 은 창 좌표다. 글은 캔버스를 감싼 칸 안에 두므로 그 칸의 왼쪽 위를 뺀다.
    const p = toScreen(rotateKnob.position)
    const parent = canvas.parentElement?.getBoundingClientRect()
    if (!p || !parent) {
      rotateLabel.style.display = 'none'
      return
    }
    rotateLabel.style.display = rotateLabel.textContent ? '' : 'none'
    rotateLabel.style.left = `${p.x - parent.left}px`
    rotateLabel.style.top = `${p.y - parent.top}px`
  }
  /** 손잡이를 눌렀는가. 화면에서 손잡이 자리로부터 14px 안이다. */
  function hitRotateKnob(x: number, y: number): boolean {
    if (!rotateKnob) return false
    const at = toScreen(rotateKnob.position)
    return !!at && Math.hypot(at.x - x, at.y - y) <= 14
  }

  function drawHandles() {
    for (const h of handles) disposeObject(h)
    handles = []
    if (outline) disposeObject(outline)
    outline = null
    if (dragFill) disposeObject(dragFill)
    dragFill = null
    dirty = true
    // 보기 모드에서는 고른 방의 테두리만 긋고 손잡이는 달지 않는다.
    if (!handleSpace || handleSpace.ring.length < 3) return
    // 판 윗면(바닥 + 0.1) 바로 위에 띄운다. 같은 높이면 판과 겹쳐 깜빡인다. 판에 가려지지 않게 깊이는 안 본다.
    const y = handleSpace.elevation + 0.12
    const points = handleSpace.ring.map(([x, z]) => new Vector3(...toScene([x, z, 0])).setY(y))
    outline = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color: handleColor(dark), depthTest: false }))
    outline.renderOrder = 10
    overlay.add(outline)
    if (!editMode && !handleEdit) return
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

  /**
   * 마우스 아래 표시(미리 강조, OE-UI-27). 설비·오브젝트는 옅은 외곽선(hoverOutline), 물리존·룸·수직 관통 조각은 바닥 외곽 점선이다.
   * 오브젝트는 화면(hoverCb)에 알리지 않는다 — 설명 풍선은 설비·공간만 띄운다.
   */
  function markHover(target: HoverTarget | { kind: 'object'; id: string } | null) {
    const key = target ? (target.kind === 'arrow' ? '' : `${target.kind}:${target.id}`) : ''
    if (key === hoverMarkKey) return
    hoverMarkKey = key
    if (hoverMark) disposeObject(hoverMark)
    hoverMark = null
    setHoverOutline(target && (target.kind === 'equipment' || target.kind === 'object') ? target : null)
    dirty = true
    if (!target || target.kind === 'arrow' || target.kind === 'equipment' || target.kind === 'object') return
    {
      const t = verticalTargets.find((x) => x.id === target.id) ?? roomTargets.find((x) => x.id === target.id) ?? spaceTargets.find((x) => x.id === target.id)
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

  // --- 외곽선 대상(미리 강조 · 겹침) ---
  // 설비는 덩어리 꼭짓점을 나눠 쓰는 마스크를 만들고, 오브젝트는 묶음의 메시를 그 외곽선의 층에 올린다. 고른 것(refreshOutline)과 같은 방식이다.
  type OutlineTarget = { kind: 'equipment' | 'object'; id: string }
  type OutlineSet = { masks: Group; layer: number; enabled: Object3D[] }
  const hoverSet: OutlineSet = { masks: hoverMasks, layer: HOVER_LAYER, enabled: [] }
  const conflictSet: OutlineSet = { masks: conflictMasks, layer: CONFLICT_LAYER, enabled: [] }
  function clearOutlineSet(set: OutlineSet) {
    for (const o of set.masks.children) {
      // 꼭짓점은 덩어리 것이다(clearOutlineMasks 와 같다).
      const g = (o as Mesh).geometry
      g.deleteAttribute('position')
      g.dispose()
    }
    set.masks.clear()
    for (const o of set.enabled) o.layers.disable(set.layer)
    set.enabled = []
  }
  function fillOutlineSet(set: OutlineSet, targets: readonly OutlineTarget[]): { object: Object3D; box?: Box3 }[] {
    clearOutlineSet(set)
    const items: { object: Object3D; box?: Box3 }[] = []
    for (const t of targets) {
      if (t.kind === 'equipment') {
        const part = partById.get(t.id)
        if (!part || !part.iCount || part.box.isEmpty()) continue
        const g = new BufferGeometry()
        g.setAttribute('position', part.chunk.position)
        g.setIndex(new BufferAttribute(part.chunk.index.slice(part.iStart, part.iStart + part.iCount), 1))
        const mask = new Mesh(g, outlineMaskMaterial)
        mask.frustumCulled = false
        mask.layers.set(set.layer)
        set.masks.add(mask)
        items.push({ object: mask, box: part.box })
      } else {
        const node = spaceObjects.children.find((n) => n.userData.objectId === t.id)
        if (!node) continue
        node.traverse((o) => {
          if (o instanceof Mesh) {
            o.layers.enable(set.layer)
            set.enabled.push(o)
          }
        })
        items.push({ object: node })
      }
    }
    return items
  }
  function setHoverOutline(target: OutlineTarget | null) {
    hoverOutline.set(fillOutlineSet(hoverSet, target ? [target] : []), target ? `${target.kind}:${target.id}` : '')
  }
  const clearHoverOutline = () => clearOutlineSet(hoverSet)

  // --- 겹쳐서 막은 상대(OE-SPC-15) ---
  // 세 곳에서 온다: 설비를 놓거나 옮기다 막힘(markConflict, CONFLICT_MS 동안), 오브젝트가 막힘(setSpaceObjects 의 conflict, 화면이 1.6초 뒤
  // 거둔다), 놓기 전 미리보기가 겹치는 자리에 있음(setPlaceGhost 의 blocked, 커서가 비킬 때까지). 앞의 둘은 상대가 한 번 흔들린다.
  let conflictEquipment: string | null = null
  /** 모델을 다시 지어 막은 상대의 마스크를 다음 프레임에 다시 건다. */
  let markConflictRefresh = false
  let ghostBlocked: OutlineTarget | null = null
  function refreshConflict() {
    const targets: OutlineTarget[] = []
    const seen = new Set<string>()
    for (const t of [conflictEquipment ? { kind: 'equipment' as const, id: conflictEquipment } : null, objectConflictId ? { kind: 'object' as const, id: objectConflictId } : null, ghostBlocked]) {
      if (!t || seen.has(`${t.kind}:${t.id}`)) continue
      seen.add(`${t.kind}:${t.id}`)
      targets.push(t)
    }
    conflictOutline.set(fillOutlineSet(conflictSet, targets), [...seen].join(','))
    dirty = true
  }

  // 흔들기(drop-in.ts 의 shakeOffset). 설비는 꼭짓점을, 오브젝트는 묶음의 x 를 민다(떨어지기와 같은 장치).
  const shakes = new Map<string, { part: Part; base: Float32Array; out: Float32Array; size: number; t0: number | null }>()
  const objectShakes = new Map<string, { x: number; size: number; t0: number | null }>()
  function startShake(target: OutlineTarget) {
    if (still()) return
    if (target.kind === 'equipment') {
      const part = partById.get(target.id)
      if (!part || part.box.isEmpty() || drops.has(part.id)) return
      finishShake(part.id)
      const base = (part.chunk.position.array as Float32Array).slice(part.vStart * 3, (part.vStart + part.vCount) * 3)
      shakes.set(part.id, { part, base, out: new Float32Array(base.length), size: Math.max(...part.box.getSize(dropSize).toArray()), t0: null })
      started.shakes++
    } else {
      const node = spaceObjects.children.find((n) => n.userData.objectId === target.id)
      const t = objectTargets.find((x) => x.id === target.id)
      if (!node || !t) return
      objectShakes.set(target.id, { x: node.position.x, size: Math.max(...t.box.getSize(dropSize).toArray()), t0: null })
      started.shakes++
    }
    dirty = true
  }
  function finishShake(id: string) {
    const d = shakes.get(id)
    if (!d) return
    shakes.delete(id)
    writePart(d.part, d.base)
  }
  function stepShakes(now: number) {
    if (!shakes.size && !objectShakes.size) return
    for (const [id, d] of shakes) {
      if (d.t0 === null) d.t0 = now
      const k = (now - d.t0) / SHAKE_MS
      if (k >= 1) {
        finishShake(id)
        continue
      }
      const dx = shakeOffset(k, d.size)
      for (let i = 0; i < d.out.length; i += 3) {
        d.out[i] = d.base[i] + dx
        d.out[i + 1] = d.base[i + 1]
        d.out[i + 2] = d.base[i + 2]
      }
      writePart(d.part, d.out)
    }
    for (const [id, d] of objectShakes) {
      const node = spaceObjects.children.find((n) => n.userData.objectId === id)
      if (d.t0 === null) d.t0 = now
      const k = (now - d.t0) / SHAKE_MS
      if (node) node.position.x = d.x + shakeOffset(k, d.size)
      if (k >= 1 || !node) objectShakes.delete(id)
    }
    dirty = true
  }

  // --- 지울 때 가라앉기(drop-in.ts 의 sinkPose) ---
  // 모델에서 빠진 설비·오브젝트의 모양을 사본으로 떼어 SINK_MS 동안 줄이며 내리고 흐린 뒤 버린다. 떨어지기와 같은 조건에서만 한다(canDrop).
  const exits: { node: Object3D; y: number; height: number; materials: Material[]; t0: number | null }[] = []
  function startExit(node: Object3D, height: number) {
    const materials: Material[] = []
    node.traverse((o) => {
      if (!(o instanceof Mesh || o instanceof LineSegments)) return
      // 원래 재질은 넣은 모델과 나눠 쓸 수 있다 — 흐리게 할 사본을 따로 둔다.
      const own = [o.material].flat().map((m: Material) => {
        const c = m.clone()
        c.userData.baseOpacity = m.opacity
        c.transparent = true
        c.depthWrite = false
        return c
      })
      o.material = Array.isArray(o.material) ? own : own[0]
      materials.push(...own)
      o.layers.disableAll()
      o.layers.enable(0)
    })
    exiting.add(node)
    exits.push({ node, y: node.position.y, height, materials, t0: null })
    started.sinks++
    dirty = true
  }
  /** 설비 하나의 지금 모양(형상·색)을 따로 떼어 낸 메시. 바닥 가운데가 원점이다. */
  function partCopy(part: Part): Mesh {
    const arr = part.chunk.position.array as Float32Array
    const c = part.box.getCenter(new Vector3())
    const positions = arr.slice(part.vStart * 3, (part.vStart + part.vCount) * 3)
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= c.x
      positions[i + 1] -= part.box.min.y
      positions[i + 2] -= c.z
    }
    const index = part.chunk.index.slice(part.iStart, part.iStart + part.iCount)
    for (let i = 0; i < index.length; i++) index[i] -= part.vStart
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setIndex(new BufferAttribute(index, 1))
    g.computeVertexNormals()
    const mesh = new Mesh(g, new MeshLambertMaterial({ color: part.color, side: DoubleSide }))
    mesh.position.set(c.x, part.box.min.y, c.z)
    return mesh
  }
  function stepExits(now: number) {
    if (!exits.length) return
    for (let i = exits.length - 1; i >= 0; i--) {
      const e = exits[i]
      if (e.t0 === null) e.t0 = now
      const k = (now - e.t0) / SINK_MS
      if (k >= 1) {
        exiting.remove(e.node)
        e.node.traverse((o) => {
          if ((o instanceof Mesh || o instanceof LineSegments) && !o.userData.shared) o.geometry.dispose()
        })
        for (const m of e.materials) m.dispose()
        exits.splice(i, 1)
        continue
      }
      const pose = sinkPose(k, e.height)
      e.node.scale.setScalar(pose.scale)
      e.node.position.y = e.y + pose.lift
      for (const m of e.materials) m.opacity = pose.opacity * ((m.userData.baseOpacity as number | undefined) ?? 1)
    }
    dirty = true
  }

  // --- 놓기 전 미리보기(setPlaceGhost) ---
  // 놓기 모드에서 커서를 따라 놓을 것의 반투명 모양이 서고, 겹치는 자리면 붉어진다(막을 상대는 conflictOutline 이 짚는다).
  // 모양은 크기·항목·막힘이 바뀔 때만 다시 짓고, 커서가 움직이면 자리만 옮긴다.
  let ghostKey = ''
  /** 미리보기가 빌려 온 설비 형상(e2e). 상자·오브젝트면 null. */
  let ghostShape: string | null = null
  const GHOST_OPACITY = 0.42

  /** 겹쳐서 막아 붉게 그린 공간 오브젝트(OE-SPC-15). e2e 가 읽는다. */
  let objectConflictId: string | null = null
  let conflictTimer: number | undefined
  function clearConflict() {
    window.clearTimeout(conflictTimer)
    if (!conflictEquipment) return
    conflictEquipment = null
    refreshConflict()
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
    if (handleSpace && handles.length >= 3) {
      const pts = handles.map((m) => new Vector2(m.position.x, -m.position.z))
      const geom = new ShapeGeometry(new Shape(pts))
      geom.rotateX(-Math.PI / 2)
      if (dragFill) {
        dragFill.geometry.dispose()
        dragFill.geometry = geom
      } else {
        dragFill = new Mesh(
          geom,
          new MeshBasicMaterial({
            color: handleColor(dark),
            transparent: true,
            opacity: 0.22,
            depthTest: false,
            depthWrite: false,
            side: DoubleSide,
          }),
        )
        dragFill.position.y = handleSpace.elevation + 0.11
        dragFill.renderOrder = 8
        overlay.add(dragFill)
      }
      if (focusFill && focusSpaceId === handleSpace.id) {
        focusFill.geometry.dispose()
        focusFill.geometry = geom.clone()
      }
    }
    scaleHandles()
  }

  /** 흐르는 빛. 화살표와 같은 때(층 보기·설비 형상·테마가 바뀔 때) 다시 짓는다. 화살표와 달리 보기 모드에서도 그린다. */
  function drawFlow() {
    if (flowMesh) disposeObject(flowMesh)
    flowMesh = null
    dirty = true
    if (!flowSpec) return
    const segments: FlowSegment[] = []
    for (const e of flowSpec.edges) {
      // 한 층만 볼 때 다른 층으로 가는 연결은 그리지 않는다(화살표와 같다).
      if (hiddenIds.has(e.from) || hiddenIds.has(e.to)) continue
      const pa = partById.get(e.from)
      const pb = partById.get(e.to)
      if (!pa || !pb) continue
      segments.push({ ...e, a: pa.box.getCenter(new Vector3()), b: pb.box.getCenter(new Vector3()) })
    }
    flowMesh = flowPulseMesh(segments, flowSpec.color, dark)
    if (flowMesh) overlay.add(flowMesh)
  }

  function drawArrows() {
    drawFlow()
    for (const o of arrowObjects) disposeObject(o)
    arrowObjects = []
    arrowSegs = []
    dirty = true
    if (!editMode && !arrowsShown) return
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
      // 실선은 누군가(BIM 포트나 사람)가 말한 방향이다. 규칙이 짐작한 것, 방향 모름, 적용 전 미리보기는 점선이다.
      const dashed = spec.source === 'rule' || spec.source === 'none' || spec.source === 'preview'
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

  // --- 흐름 방향의 연쇄 ---
  // 바뀐 연결을 물결마다 CASCADE_STEP_MS 간격으로 띄운다. 물결이 많으면 간격을 줄여 전체가 CASCADE_SPAN_MS 안에 퍼진다. 다 띄운 뒤
  // CASCADE_HOLD_MS 두었다가 CASCADE_FADE_MS 동안 옅어진다. 성수 한꺼번에 확정처럼 수천 개가 바뀌어도 CASCADE_MAX 개(앞 물결부터)만 그린다.
  const CASCADE_STEP_MS = 140
  const CASCADE_SPAN_MS = 1600
  const CASCADE_HOLD_MS = 900
  const CASCADE_FADE_MS = 400
  const CASCADE_MAX = 400
  // 촉 형상 하나(높이 1, 반지름 1/3 — 크기는 scale 로)와 재질 둘을 모두가 같이 쓴다. 성수에서 화살표마다 새로 만들면 확정 한 번에 160ms 가 들었다.
  // 옅어지기는 다 같이라 재질 하나의 opacity 로 된다.
  const CASCADE_CONE = new ConeGeometry(1 / 3, 1, 12)
  let cascade: { t0: number | null; step: number; last: number; line: LineBasicMaterial; cone: MeshBasicMaterial; parts: { wave: number; r: number; objects: (Line | Mesh)[] }[] } | null = null
  function clearCascade() {
    if (!cascade) return
    for (const p of cascade.parts)
      for (const o of p.objects) {
        o.parent?.remove(o)
        if (o instanceof Line) o.geometry.dispose()
      }
    cascade.line.dispose()
    cascade.cone.dispose()
    cascade = null
    dirty = true
  }
  function startCascade(items: readonly { a: string; b: string; from: string; wave: number }[]) {
    clearCascade()
    const color = arrowColors(dark).edit
    const lineMat = new LineBasicMaterial({ color, depthTest: false, transparent: true })
    const coneMat = new MeshBasicMaterial({ color, depthTest: false, transparent: true })
    const parts: { wave: number; r: number; objects: (Line | Mesh)[] }[] = []
    // 배관 마디는 수십 cm 라 길이로만 촉 크기를 잡으면 건물 전체를 볼 때 안 보인다(Duplex MEP). 촉은 보는 거리에 맞춰 최소 크기를 둔다.
    const minR = camera.position.distanceTo(controls.target) * 0.012
    const up = new Vector3(0, 1, 0)
    for (const it of [...items].sort((x, y) => x.wave - y.wave).slice(0, CASCADE_MAX)) {
      if (hiddenIds.has(it.a) || hiddenIds.has(it.b)) continue
      const pa = partById.get(it.a)
      const pb = partById.get(it.b)
      if (!pa || !pb) continue
      const ca = pa.box.getCenter(new Vector3())
      const cb = pb.box.getCenter(new Vector3())
      const len = ca.distanceTo(cb)
      if (len < 1e-6) continue
      const [tail, head] = it.from === it.a ? [ca, cb] : [cb, ca]
      const dir = head.clone().sub(tail).normalize()
      const line = new Line(new BufferGeometry().setFromPoints([tail, head]), lineMat)
      line.renderOrder = 13
      // 평소 화살촉보다 조금 크게 — 위에 겹쳐 그리니 같은 크기면 안 보인다.
      const r = Math.max(Math.min(Math.max(len * 0.09, 0.07), 0.5), minR)
      const cone = new Mesh(CASCADE_CONE, coneMat)
      cone.position.copy(tail).addScaledVector(dir, len * 0.6)
      cone.quaternion.setFromUnitVectors(up, dir)
      cone.renderOrder = 14
      for (const o of [line, cone]) {
        o.visible = false
        overlay.add(o)
      }
      parts.push({ wave: it.wave, r: r * 3, objects: [line, cone] })
    }
    if (!parts.length) {
      lineMat.dispose()
      coneMat.dispose()
      return
    }
    const waves = parts.at(-1)!.wave + 1
    const step = still() ? 0 : Math.min(CASCADE_STEP_MS, CASCADE_SPAN_MS / waves)
    started.cascades++
    cascade = { t0: null, step, last: parts.at(-1)!.wave, line: lineMat, cone: coneMat, parts }
    dirty = true
  }
  function stepCascade(now: number) {
    if (!cascade) return
    if (cascade.t0 === null) cascade.t0 = now
    const t = now - cascade.t0
    const spread = cascade.last * cascade.step
    for (const p of cascade.parts) {
      const at = p.wave * cascade.step
      if (t < at) continue
      // 띄울 때 촉이 0.3 배에서 1 배로 커진다(180ms). 움직임을 끈 사람에게는 처음부터 1 배다.
      const grow = cascade.step === 0 ? 1 : Math.min(1, 0.3 + ((t - at) / 180) * 0.7)
      for (const o of p.objects) {
        o.visible = true
        if (o instanceof Mesh) o.scale.setScalar(p.r * grow)
      }
    }
    const fade = still() ? 1 : 1 - Math.min(1, Math.max(0, t - spread - CASCADE_HOLD_MS) / CASCADE_FADE_MS)
    cascade.line.opacity = fade
    cascade.cone.opacity = fade
    dirty = true
    // 움직임을 끈 사람에게는 한꺼번에 띄워 2초 둔다 — 퍼지는 순서는 못 보지만 무엇이 바뀌었는지는 본다.
    if (t > spread + CASCADE_HOLD_MS + (still() ? 1100 : CASCADE_FADE_MS)) clearCascade()
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
   * 광선이 닿는 수직 관통 오브젝트 조각(고른 것은 건너뛴다)과 거리(제곱). 여러 층을 함께 보면 위층 계단 지점 너머로 아래층 설비가 보여,
   * 설비를 늘 먼저 고르면 위층 계단을 누를 수 없었다(다중층 뷰, 병원 2층 계단 지점 너머의 1층 거울). 누르기가 둘의 거리를 견준다.
   */
  function pickVertical(ray: Ray): { id: string; d: number } | null {
    let best: { id: string; d: number } | null = null
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const at = new Vector3()
    for (const target of verticalTargets) {
      if (selectedVertical.has(target.id)) continue
      if (visibleStoreys && !visibleStoreys.has(target.storeyId)) continue
      plane.constant = -target.y
      if (!ray.intersectPlane(plane, at)) continue
      if (!pointInPolygon([at.x, -at.z], target.ring)) continue
      const d = at.distanceToSquared(ray.origin)
      if (!best || d < best.d) best = { id: target.id, d }
    }
    return best
  }

  /**
   * 광선이 먼저 닿는 물리존 판. 판 윗면에서 외곽선 안에 드는지로 본다. 같은 층에서 방이 겹친 자리면 **가장 작은 방**이다 —
   * 설비 소속(mapping.ts 의 locate)과 같은 규칙이라, 누른 자리의 설비가 속한 방이 골라진다.
   */
  function pickSpace(ray: Ray): string | null {
    let best: { id: string; d: number; area: number } | null = null
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    const at = new Vector3()
    // 수직 관통 오브젝트 조각, 룸(OE-OBJ-03) 순으로 먼저다 — 물리존 판보다 위에 그려 광선이 먼저 닿는다. 고른 조각은 건너뛴다.
    for (const target of [...verticalTargets.filter((t) => !selectedVertical.has(t.id)), ...roomTargets, ...spaceTargets]) {
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
   * 벽·문·창 편집 층이 켜져 있을 때 광선이 그린 벽·문·창에 처음 닿는 거리(제곱). 꺼져 있거나 안 닿으면 Infinity.
   * 오브젝트와 견준다 — 벽 앞에 붙은 BIM 가구(하부장·조리대) 상자가 벽 윗면을 누른 광선에도 닿아, 견주지 않으면 벽을 고를 수 없었다.
   */
  function archDistance(ray: Ray): number {
    if (!archTargets.length) return Infinity
    raycaster.ray.copy(ray)
    const hit = raycaster.intersectObjects(arch.children.filter((o) => o.visible && o instanceof Mesh), false)[0]
    return hit ? hit.point.distanceToSquared(ray.origin) : Infinity
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

  /** 마지막에 그린 외곽선 층. 리플레이가 새로 생긴 벽을 따로 그리려고 다시 그린다(rebuildArchitecture). */
  let lastArch: { model: Model | null; selected: string | null; also?: ReadonlySet<string> } = { model: null, selected: null }
  let lastArchKey = ''
  /** buildArchitecture 가 읽는 것(층 높이, 벽 외곽선·높이·내력, 문·창 자리·종류·폭·방향, 고른 것)을 이은 열쇠. */
  function archKey(model: Model | null, selected: string | null, also?: ReadonlySet<string>): string {
    if (!model) return `-|${selected}`
    const out: (string | number | null | undefined)[] = [selected, also ? [...also].join('+') : '']
    for (const st of model.storeys) {
      out.push('S', st.id, st.elevation)
      for (const w of st.walls) {
        out.push('W', w.id, w.height, String(w.loadBearing))
        for (const ring of w.footprint ?? []) for (const p of ring) out.push(p[0], p[1])
      }
      for (const o of st.openings) out.push('O', o.id, o.kind, o.width, o.position?.[0], o.position?.[1], o.through?.[0], o.through?.[1])
    }
    return out.join(',')
  }
  /**
   * 벽 외곽선 하나를 세운 입체(층 바닥 y 에서 ARCH_WALL_HEIGHT). 외곽선·높이로 기억한다 — 외곽선 층을 다시 지을 때마다 벽
   * 수백 개를 다시 삼각분할했다(dental 의 문 하나 옮기기에 65ms). 합칠 때 복사하고 고치지 않으니 같은 것을 다시 써도 된다.
   */
  const extruded = new Map<string, BufferGeometry>()
  function extrudeRing(ring: readonly Vec2[], y: number, height = ARCH_WALL_HEIGHT): BufferGeometry {
    const key = `${y}|${height}|${ring.map((p) => `${p[0]},${p[1]}`).join(';')}`
    let g = extruded.get(key)
    if (!g) {
      const shape = new Shape()
      shape.moveTo(ring[0][0], ring[0][1])
      for (const p of ring.slice(1)) shape.lineTo(p[0], p[1])
      g = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
      g.rotateX(-Math.PI / 2)
      g.translate(0, y, 0)
      if (extruded.size > 20000) extruded.clear()
      extruded.set(key, g)
    }
    return g
  }
  /** 그 층 벽에 뚫을 문·창 자리(벽 id → 자리들). 높이는 화면 벽 바닥(`y`)에서 잰다. 벽이 이 층에 없으면(천창은 지붕에 붙는다) 뚫지 않는다. */
  function openingCutsOf(storey: Model['storeys'][number], y: number): Map<string, OpeningCut[]> {
    const here = new Set(storey.walls.map((w) => w.id))
    const out = new Map<string, OpeningCut[]>()
    for (const o of storey.openings) {
      // 사람이 놓은 문·창은 가로를 정하기 전까지 비어 있다 — 기본 크기로 뚫는다(그리는 것과 같은 크기).
      const rect = o.wallId && here.has(o.wallId) ? openingRect({ ...o, width: o.width ?? FALLBACK_SIZE[o.kind][0] }) : null
      if (!rect) continue
      const sill = o.position![2] - y
      const cut = { rect, sill, head: sill + (o.height ?? FALLBACK_SIZE[o.kind][1]) }
      const list = out.get(o.wallId!)
      if (list) list.push(cut)
      else out.set(o.wallId!, [cut])
    }
    return out
  }
  /** 벽을 세울 조각: 문·창 자리를 뚫은 [아래, 위] 고리들. 뚫을 것이 없으면 고리 그대로 단면 높이까지다. */
  const wallSlabsOf = (rings: readonly (readonly Vec2[])[], cuts: readonly OpeningCut[] | undefined) =>
    cuts ? cutWall(rings, cuts, ARCH_WALL_HEIGHT) : rings.filter((r) => r.length >= 3).map((ring) => ({ ring, bottom: 0, top: ARCH_WALL_HEIGHT }))

  /**
   * 문·창 한 개의 조각들(three 좌표). 벽에 뚫린 것이면 문틀 두 기둥과 문짝(문)·창턱/창 위 틀과 유리(창)를 단면 높이까지 세운다.
   * 뚫는 방향을 모르거나 벽이 이 층에 없으면(천창) 실제 크기의 상자 하나다. 크기를 모르면 기본 크기(FALLBACK_SIZE)다. 단면 위의 윤곽은 `ghost` 에 선분으로.
   */
  function openingPieces(o: Model['storeys'][number]['openings'][number], y: number, hosted: boolean, ghost: number[]): { solid: BufferGeometry[]; glass: BufferGeometry[] } {
    const solid: BufferGeometry[] = []
    const glass: BufferGeometry[] = []
    const [w, h] = o.width && o.height ? [o.width, o.height] : FALLBACK_SIZE[o.kind]
    const p = o.position!
    const through: Vec2 = o.through ?? [0, 1]
    const along = alongOf(through)
    const yaw = Math.atan2(through[0], -through[1])
    // 벽을 따라 a, 벽을 뚫는 쪽으로 b 만큼 옮긴 평면 점에, 화면 높이 [y0, y1] 로 세운 상자(가로 sx · 두께 sz).
    const box = (a: number, b: number, sx: number, sz: number, y0: number, y1: number) => {
      const g = new BoxGeometry(sx, y1 - y0, sz)
      g.rotateY(yaw)
      const [sx2, , sz2] = toScene([p[0] + along[0] * a + through[0] * b, p[1] + along[1] * a + through[1] * b, 0])
      g.translate(sx2, (y0 + y1) / 2, sz2)
      return g
    }
    const depth = o.depth && o.depth > 0 ? o.depth : 0.2
    const bottom = p[2]
    if (!hosted || !o.through) {
      ;(o.kind === 'window' ? glass : solid).push(box(0, 0, w, depth, bottom, bottom + h))
      return { solid, glass }
    }
    const cutTop = y + ARCH_WALL_HEIGHT
    const y0 = Math.max(bottom, y)
    const y1 = Math.min(bottom + h, cutTop)
    // 문틀은 벽 두께를 넘지 않게 — 문 형상의 두께는 여닫는 폭까지 잡혀 0.48m 도 된다(Duplex).
    const frameDepth = Math.min(depth, 0.25)
    if (y1 > y0) {
      for (const side of [-1, 1]) solid.push(box(side * (w / 2 - OPENING_FRAME / 2), 0, OPENING_FRAME, frameDepth, y0, y1))
      const inner = Math.max(w - 2 * OPENING_FRAME, 0.05)
      if (o.kind === 'door') solid.push(box(0, 0, inner, DOOR_LEAF, y0, y1))
      else {
        if (bottom >= y) solid.push(box(0, 0, inner, frameDepth, bottom, Math.min(bottom + OPENING_FRAME, y1)))
        if (bottom + h <= cutTop) solid.push(box(0, 0, inner, frameDepth, Math.max(bottom + h - OPENING_FRAME, y0), bottom + h))
        glass.push(box(0, 0, inner, GLASS, y0, y1))
      }
    }
    // 단면 위로 올라간 부분은 윤곽선만: 양옆 세로선, 위 가로선(창이 단면보다 높이 났으면 아래 가로선도).
    const top = bottom + h
    if (top > cutTop + 0.05) {
      const from = Math.max(bottom, cutTop)
      const end = (a: number): [number, number] => [p[0] + along[0] * a, p[1] + along[1] * a]
      const [l, r] = [end(-w / 2), end(w / 2)]
      ghost.push(l[0], from, -l[1], l[0], top, -l[1], r[0], from, -r[1], r[0], top, -r[1], l[0], top, -l[1], r[0], top, -r[1])
      if (bottom > cutTop) ghost.push(l[0], bottom, -l[1], r[0], bottom, -r[1])
    }
    return { solid, glass }
  }
  function buildArchitecture(model: Model | null, selected: string | null, also?: ReadonlySet<string>) {
    lastArch = { model, selected, also }
    // 다시 지은 상태의 열쇠. 솟아오르기·미끄러짐이 먼저 다시 지었으면(rebuildArchitecture) 뒤따르는 setArchitecture 는 건너뛴다 —
    // 문 하나 옮기는 데 외곽선 층을 두세 번 지었다.
    lastArchKey = archKey(model, selected, also)
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
      // 펼쳐 새 배열을 만들면 벽 수의 제곱이 된다(dental 리플레이 8장면에 126ms). 붙이기만 한다.
      const add = (color: number, g: BufferGeometry) => {
        const piece = g.index ? g.toNonIndexed() : g
        const list = byColor.get(color)
        if (list) list.push(piece)
        else byColor.set(color, [piece])
      }
      // 실제 높이 윤곽선(선분 쌍). 깎은 벽 윗면(y + ARCH_WALL_HEIGHT)에서 실제 윗면(층 바닥 + 벽 높이)까지 세로선, 실제 윗면 외곽선.
      const tops: number[] = []
      const cuts = openingCutsOf(storey, y)
      const glassByColor = new Map<number, BufferGeometry[]>()
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
        const color = wall.id === selected || also?.has(wall.id) ? ARCH_COLORS.selected : wall.loadBearing ? WALL_COLORS.loadBearing : wall.loadBearing === null ? WALL_COLORS.unknown : ARCH_COLORS.wall
        const own: BufferGeometry[] | null = fx.reveals(wall.id) ? [] : null
        for (const slab of wallSlabsOf(rings, cuts.get(wall.id))) {
          const g = extrudeRing(slab.ring, y + slab.bottom, slab.top - slab.bottom)
          if (own) own.push(g)
          else add(color, g)
        }
        const mesh = own?.length ? fx.revealMesh(wall.id, own, color) : null
        if (mesh) {
          mesh.userData.storeyId = storey.id
          arch.add(mesh)
        }
      }
      for (const o of storey.openings) {
        if (!o.position) continue
        const dir: Vec2 | undefined = o.through ? [-o.through[1], o.through[0]] : undefined
        archTargets.push({ id: o.id, storeyId: storey.id, y, at: [o.position[0], o.position[1]], ...(dir && o.width ? { dir, half: o.width / 2 } : {}) })
        const isSelected = o.id === selected
        const color = isSelected ? ARCH_COLORS.selected : o.kind === 'door' ? (dark ? DOOR_DARK : ARCH_COLORS.door) : ARCH_COLORS.window
        // 가로를 아는 문·창은 그 가로만큼 벽을 뚫고 문틀·문짝·유리를 세운다(OE-OBJ-07, 크기를 바꾸면 3D 에서 보인다).
        const { solid, glass } = openingPieces(o, y, !!o.wallId && storey.walls.some((w) => w.id === o.wallId), tops)
        const mesh = fx.reveals(o.id) ? fx.revealMesh(o.id, [...solid, ...glass], color) : null
        if (mesh) {
          mesh.userData.storeyId = storey.id
          arch.add(mesh)
          continue
        }
        for (const g of solid) add(color, g)
        const glassColor = isSelected ? ARCH_COLORS.selected : GLASS_COLOR.color
        for (const g of glass) {
          const piece = g.index ? g.toNonIndexed() : g
          const list = glassByColor.get(glassColor)
          if (list) list.push(piece)
          else glassByColor.set(glassColor, [piece])
        }
      }
      for (const [color, pieces] of glassByColor) {
        const merged = mergeGeometries(pieces)
        for (const g of pieces) g.dispose()
        if (!merged) continue
        const mesh = new Mesh(merged, new MeshLambertMaterial({ color, side: DoubleSide, transparent: true, opacity: color === GLASS_COLOR.color ? GLASS_COLOR.opacity : 0.7, depthWrite: false }))
        mesh.userData.storeyId = storey.id
        mesh.userData.selected = color === ARCH_COLORS.selected
        arch.add(mesh)
      }
      for (const [color, pieces] of byColor) {
        const merged = mergeGeometries(pieces)
        for (const g of pieces) g.dispose()
        if (!merged) continue
        const mesh = new Mesh(merged, new MeshLambertMaterial({ color, side: DoubleSide }))
        mesh.userData.storeyId = storey.id
        mesh.userData.selected = color === ARCH_COLORS.selected
        addEdges(mesh)
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
    position.addUpdateRange(d.part.vStart * 3, d.part.vCount * 3)
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
    if (d.kind === 'rotate') {
      rotateHandler(commit && d.moved ? 'end' : 'cancel', d.angle, d.free)
      return
    }
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
      if (e.button !== 0) return
      // 분해도는 화면에서만 띄운 자리라 거기서 끌면 엉뚱한 곳으로 옮겨진다. 펼친 동안은 끌지 않는다(시점 이동은 된다).
      if (explodedParts) return
      // 회전 손잡이(OE-OBJ-15 AC6). Shift 를 누른 채 시작하면 손잡이 위여도 시점 회전이다 — 여기서 받지 않고 컨트롤로 넘긴다.
      if (rotateSpec && !e.shiftKey && hitRotateKnob(e.clientX, e.clientY)) {
        const plane = new Plane(new Vector3(0, 1, 0), -(toScene([0, 0, rotateSpec.elevation])[1] + 0.05))
        drag = { kind: 'rotate', plane, angle: rotateSpec.angle, free: false, x: e.clientX, y: e.clientY, moved: false }
        controls.enabled = false
        canvas.setPointerCapture(e.pointerId)
        e.stopImmediatePropagation()
        canvas.style.cursor = 'grabbing'
        return
      }
      if (!editMode && !(handleEdit && hitHandle(e.clientX, e.clientY) !== null)) return
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
        vertexPickHandler(index)
      } else {
        // 고른 설비만 끈다. 아무 설비나 끌리면 시점을 돌리려다 덕트를 옮긴다. 고른 설비는 앞에 다른 것이
        // 가려도 잡힌다 — 덕트 사이의 VAV 처럼 가운데가 늘 가려진 설비가 있다. 끌지 않고 떼면 맨 앞의 것을
        // 고른다(pointerup).
        const part = grabbable(ray)
        if (!part) {
          // 고른 설비가 얼어 있으면 끌리지 않는다 — 왜 안 끌리는지 알리게 화면에 말한다.
          for (const id of grabIds) {
            const frozen = frozenIds.has(id) && !hiddenIds.has(id) ? partById.get(id) : undefined
            if (frozen && hitsPart(ray, frozen)) {
              frozenGrabHandler(id)
              break
            }
          }
        }
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
      if (moved || kind === 'vertex' || kind === 'rotate') {
        pressedAt = null
        return
      }
    }
    // 시점을 돌린 것과 고른 것을 가른다. 끌었으면 고르기가 아니다.
    if (!pressedAt) return
    const dragged = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 4
    pressedAt = null
    if (dragged) return
    // 움직이지 않은 우클릭은 메뉴다(ui-notes 보기 필터). 전에는 왼쪽 누르기처럼 골랐다. 끈 오른쪽 드래그는 위에서 회전으로 끝났다.
    if (e.button === 2) {
      contextHandler(pick(rayAt(e.clientX, e.clientY)), e.clientX, e.clientY)
      return
    }
    // 휠 클릭은 회전 중심 정하기다(아래 pivot 리스너). 고르기로 내려가면 빈 곳을 누른 셈이 되어 고른 것이 풀렸다.
    if (e.button === 1) return

    // 리플레이의 빛기둥·이름표를 누르면 그 장면을 되풀이한다.
    const spot = fx.hitSpot(e.clientX, e.clientY)
    if (spot) return fx.spotClick(spot)

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
    // 오브젝트(OE-OBJ-09)가 설비·벽·문·창보다 앞에 있으면 오브젝트다. 책상 위로 보이는 천장 조명을 누르면 조명이다.
    const object = !additive ? pickObject(ray) : null
    if (object && (!id || object.d < pickDistance(ray, id)) && object.d < archDistance(ray)) {
      objectPickHandler(object.target.id)
      return
    }
    // 수직 관통 오브젝트 조각이 설비보다 앞에 있으면 조각이다(바닥 누르기와 같은 길, onPickSpace 로 조각 id).
    const vertical = id && !additive ? pickVertical(ray) : null
    if (vertical && vertical.d < pickDistance(ray, id!)) {
      spacePickHandler(vertical.id)
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
      // 보정(dragSnap)은 IFC 평면에서 한다. 화면은 x 가 같고 z 가 IFC y 의 부호를 뒤집은 것이다(toScene).
      if (drag.kind === 'rotate') {
        if (!rotateSpec) return
        const a = (Math.atan2(-at.z - rotateSpec.center[1], at.x - rotateSpec.center[0]) * 180) / Math.PI
        drag.angle = ((a % 360) + 360) % 360
        drag.free = e.altKey
        rotateHandler('move', drag.angle, drag.free)
        dirty = true
        return
      }
      if (drag.kind === 'equipment') {
        const [dx, dy] = dragSnap ? dragSnap.delta('equipment', drag.part.id, [at.x - drag.start.x, -(at.z - drag.start.z)]) : [at.x - drag.start.x, -(at.z - drag.start.z)]
        drag.delta.set(dx, 0, -dy)
        placePart(drag, drag.delta)
        drawArrows()
      } else if (drag.kind === 'object') {
        const [dx, dy] = dragSnap ? dragSnap.delta('object', drag.target.id, [at.x - drag.start.x, -(at.z - drag.start.z)]) : [at.x - drag.start.x, -(at.z - drag.start.z)]
        const step = new Vector3(dx, 0, -dy).sub(drag.delta)
        drag.delta.add(step)
        drag.target.node.position.add(step)
        drag.target.box.translate(step)
      } else {
        drag.at.copy(at).add(drag.offset)
        if (dragSnap && handleSpace) {
          const [x, y] = dragSnap.point(handleSpace.id, drag.index, [drag.at.x, -drag.at.z])
          drag.at.x = x
          drag.at.z = -y
        }
        moveHandle(drag.index, drag.at)
      }
      dirty = true
      return
    }
    if (e.buttons !== 0) return // 끄는 중에는 시점을 돌리는 것이지 고르려는 것이 아니다.
    hoverAt = { x: e.clientX, y: e.clientY }
    hoverAlt = e.altKey
    hoverPending = true
  })
  canvas.addEventListener('pointerleave', () => {
    hoverAt = null
    if (placeElevation !== null) placeHoverHandler?.(null, false)
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
    // 비행 중 창을 떠나면 뗀 키를 못 받아 계속 날아간다.
    flying?.keys.clear()
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
      if (placeHoverHandler) {
        const at = new Vector3()
        const plane = new Plane(new Vector3(0, 1, 0), -toScene([0, 0, placeElevation])[1])
        placeHoverHandler(hoverAt && rayAt(hoverAt.x, hoverAt.y).intersectPlane(plane, at) ? [at.x, -at.z] : null, hoverAlt)
      }
      return
    }
    if (!hoverAt || drag) {
      hoverHandler(null, null)
      return
    }
    const { x, y } = hoverAt
    if ((editMode || handleEdit) && hitHandle(x, y) !== null) {
      canvas.style.cursor = 'grab'
      hoverHandler(null, null)
      return
    }
    // 리플레이에서 누를 수 있는 빛기둥·이름표 위에서는 손가락 모양이다(누르면 그 장면을 되풀이한다).
    if (fx.hitSpot(x, y)) {
      canvas.style.cursor = 'pointer'
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
    // 누르기와 같게, 설비·벽·문·창보다 앞에 있는 오브젝트만 오브젝트다.
    const object = pickObject(ray)
    if (object && (!id || object.d < pickDistance(ray, id)) && object.d < archDistance(ray)) {
      canvas.style.cursor = editMode && object.target.id === selectedObject ? 'grab' : 'pointer'
      markHover({ kind: 'object', id: object.target.id })
      hoverCb(null, null)
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

  /** 픽셀비 상한. 리플레이 화질(setReplayQuality)이 낮춘다 — 매 프레임 resize 가 이 값을 따르므로 renderer 에 직접 넣으면 되돌아간다. */
  let pixelRatioCap = 2
  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas
    if (w === 0 || h === 0) return
    const ratio = Math.min(window.devicePixelRatio, pixelRatioCap)
    if (canvas.width === Math.round(w * ratio) && canvas.height === Math.round(h * ratio)) return
    renderer.setPixelRatio(ratio)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    dirty = true
  }

  let running = true
  /** 다시 그린 횟수(viewVersion). */
  let renders = 0
  function tick(now = performance.now()) {
    if (!running) return
    resize()
    stepFlight(now)
    stepFly(now)
    stepCascade(now)
    stepPivotMark(now)
    stepGlides(now)
    stepDrops(now)
    stepShakes(now)
    stepExits(now)
    if (conflictOutline.step(now)) dirty = true
    stepPulses(now)
    if (selectionOutline.step(now)) dirty = true
    if (outlinePending) refreshOutline()
    if (markConflictRefresh) {
      markConflictRefresh = false
      refreshConflict()
    }
    // 리플레이 연출(밤 다이오라마·층 펼치기)에는 격자를 걷는다. 층을 띄우면 격자만 바닥에 남는다.
    const groundOn = groundPlaced && !fx.cinema()
    if (ground.mesh.visible !== groundOn) {
      ground.mesh.visible = groundOn
      dirty = true
    }
    // 흐르는 빛은 움직임을 끈 사람에게는 멈춘 채(혜성 꼴만으로 방향을 읽는다) 둔다. 흐르는 동안은 매 프레임 그린다.
    if (flowMesh && !still()) {
      setFlowTime(flowMesh, now / 1000)
      dirty = true
    }
    fx.step(now)
    // 관성(damping)으로 도는 동안에는 update 가 참을 돌려준다. 그동안만 계속 그린다.
    if (controls.update()) dirty = true
    // 새로 연 모델은 덩어리를 한 프레임에 하나씩 켠다. 켜는 프레임에 그 덩어리만 GPU 로 올라간다.
    const next = chunks.find((c) => !c.shown)
    if (next) {
      showChunk(next)
      dirty = true
    }
    if (dirty) {
      if (handles.length || rotateKnob) scaleHandles()
      if (rotateLabel) placeRotateLabel()
      const t0 = performance.now()
      renderer.render(scene, camera)
      hoverOutline.render(scene, camera)
      selectionOutline.render(scene, camera)
      conflictOutline.render(scene, camera)
      renders++
      perf.renderMs = performance.now() - t0
      perf.calls = renderer.info.render.calls
      perf.triangles = renderer.info.render.triangles
      perf.frames.push(now)
      // 방향 큐브는 메인 시점이 바뀔 때만 다시 그린다(같은 dirty).
      navCube?.render(tmpDir.subVectors(camera.position, controls.target), camera.up)
      dirty = false
    }
    // 1초 창 안에 그린 장수와 그 사이 간격. 3D 는 바뀔 때만 그려서(dirty) 가만히 있으면 0 이 맞다.
    while (perf.frames.length && now - perf.frames[0] > 1000) perf.frames.shift()
    if (hoverPending) updateHover()
    requestAnimationFrame(tick)
  }
  /** 성능 표(개발용 HUD, stats). 마지막으로 그린 프레임의 값이다. */
  const perf = { renderMs: 0, calls: 0, triangles: 0, frames: [] as number[] }
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
  /** `eye` 가 false 면 리플레이 몰입이어도 눈 자리를 쓰지 않는다 — 건물 전체 보기·끝 화면의 바뀐 곳 모아 보기는 장면이 아니다. */
  function fit(box: Box3, animate = true, from = fx.fitFrom() ?? new Vector3(1, 0.65, 1), eye = true) {
    const sphere = box.getBoundingSphere(new Sphere())
    if (sphere.radius <= 0) return

    const back = from.clone().normalize() // 대상에서 카메라 쪽
    const forward = back.clone().negate()
    const right = new Vector3().crossVectors(forward, camera.up).normalize()
    const up = new Vector3().crossVectors(right, forward)
    const tanV = Math.tan((camera.fov * Math.PI) / 360) * FILL
    const tanH = tanV * (camera.aspect || 1.6)

    // 리플레이의 1인칭 몰입은 상자 밖에서 담지 않고 방 안 눈높이에 선다(replay-viewer 의 fitEye).
    const stand = eye ? fx.fitEye(box, tanV, tanH) : null
    if (stand) {
      const reach = stand.position.distanceTo(stand.target) + sphere.radius
      const clip = { near: 0.05, far: Math.max(reach * 10, 400) }
      fly(stand.target, stand.position, animate ? clip : null)
      if (!animate) {
        camera.near = clip.near
        camera.far = clip.far
        camera.updateProjectionMatrix()
      }
      return
    }

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
  const started = { flights: 0, glides: 0, pulses: 0, cascades: 0, drops: 0, shakes: 0, sinks: 0 }
  let flight: { t0: number | null; ms: number; lift: number; ease: (k: number) => number; fromT: Vector3; fromP: Vector3; toT: Vector3; toP: Vector3; near: number; far: number } | null = null
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
    flight = { t0: null, ...fx.flight(FLY_MS, camera.position.distanceTo(position)), fromT: controls.target.clone(), fromP: camera.position.clone(), toT: target, toP: position, ...clip }
  }
  function stepFlight(now: number) {
    if (!flight) return
    if (flight.t0 === null) flight.t0 = now
    const k = Math.min(1, (now - flight.t0) / flight.ms)
    const e = flight.ease(k)
    controls.target.lerpVectors(flight.fromT, flight.toT, e)
    camera.position.lerpVectors(flight.fromP, flight.toP, e)
    if (flight.lift) camera.position.y += Math.sin(Math.PI * e) * flight.lift
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

  // --- 방향 큐브와 비행 모드 ---
  // 큐브(nav-cube.ts)는 면·모서리·꼭짓점을 누르면 그 방향에서 보이는 것 전체를 맞추고(fit), 끌면 대상 둘레로 돈다.
  // 비행 모드는 사람이 건물 안을 걸어 다니듯 본다. 지도식 시점(OrbitControls)의 끌기·휠을 끄고, 키·드래그를 여기서 받는다.
  let navCube: ReturnType<typeof createNavCube> | null = null
  const tmpDir = new Vector3()
  function visibleBox(): Box3 {
    const box = new Box3()
    for (const part of parts) if (!hiddenIds.has(part.id)) box.union(part.box)
    for (const o of slabs.children) if (o.visible) box.expandByObject(o)
    if (box.isEmpty()) box.setFromObject(content)
    return box
  }
  /** 대상 둘레로 시점을 돌린다(px). 오른쪽으로 끌면 건물이 오른쪽으로 돈다 — 지도식 시점의 오른쪽 드래그와 같은 쪽이다. */
  const ORBIT_RAD_PER_PX = Math.PI / 240
  function orbitBy(dx: number, dy: number) {
    flight = null
    const offset = tmpDir.subVectors(camera.position, controls.target)
    const s = new Spherical().setFromVector3(offset)
    s.theta -= dx * ORBIT_RAD_PER_PX
    s.phi = Math.min(Math.PI - 0.01, Math.max(0.01, s.phi - dy * ORBIT_RAD_PER_PX))
    camera.position.copy(controls.target).add(offset.setFromSpherical(s))
    controls.update()
    dirty = true
  }

  const FLY_KEYS: Record<string, [number, number, number]> = {
    KeyW: [0, 0, 1],
    KeyS: [0, 0, -1],
    KeyA: [-1, 0, 0],
    KeyD: [1, 0, 0],
    KeyQ: [0, -1, 0],
    KeyE: [0, 1, 0],
  }
  /** 비행 상태. `rate` 는 초당 m(건물 크기에 맞춘 기본값 × 휠로 바꾼 배수). */
  let flying: { keys: Set<string>; base: number; scale: number; last: number | null; look: { x: number; y: number } | null } | null = null
  const LOOK_RAD_PER_PX = Math.PI / 600
  function stepFly(now: number) {
    if (!flying) return
    const moving = [...flying.keys].filter((k) => k in FLY_KEYS)
    if (!moving.length) {
      flying.last = null
      return
    }
    const dt = flying.last === null ? 1 / 60 : Math.min(0.1, (now - flying.last) / 1000)
    flying.last = now
    const fast = flying.keys.has('ShiftLeft') || flying.keys.has('ShiftRight') ? 3 : 1
    const step = flying.base * flying.scale * fast * dt
    const forward = new Vector3().subVectors(controls.target, camera.position).normalize()
    const right = new Vector3().crossVectors(forward, camera.up).normalize()
    const move = new Vector3()
    for (const k of moving) {
      const [x, y, z] = FLY_KEYS[k]
      move.addScaledVector(right, x).addScaledVector(camera.up, y).addScaledVector(forward, z)
    }
    if (move.lengthSq() === 0) return
    move.normalize().multiplyScalar(step)
    camera.position.add(move)
    controls.target.add(move)
    controls.update()
    dirty = true
  }
  function onFlyDown(e: PointerEvent) {
    if (!flying || (e.button !== 0 && e.button !== 2)) return
    flying.look = { x: e.clientX, y: e.clientY }
  }
  function onFlyMove(e: PointerEvent) {
    if (!flying?.look || !e.buttons) {
      if (flying) flying.look = null
      return
    }
    const dx = e.clientX - flying.look.x
    const dy = e.clientY - flying.look.y
    flying.look = { x: e.clientX, y: e.clientY }
    // 제자리에서 고개를 돌린다: 눈은 그대로, 보는 점(target)을 눈 둘레로 돌린다.
    const dir = tmpDir.subVectors(controls.target, camera.position)
    const s = new Spherical().setFromVector3(dir)
    s.theta -= dx * LOOK_RAD_PER_PX
    s.phi = Math.min(Math.PI - 0.05, Math.max(0.05, s.phi + dy * LOOK_RAD_PER_PX))
    controls.target.copy(camera.position).add(dir.setFromSpherical(s))
    controls.update()
    dirty = true
  }
  function onFlyUp() {
    if (flying) flying.look = null
  }
  function onFlyWheel(e: WheelEvent) {
    if (!flying) return
    e.preventDefault()
    flying.scale = Math.min(20, Math.max(0.05, flying.scale * (e.deltaY < 0 ? 1.25 : 0.8)))
  }
  canvas.addEventListener('pointerdown', onFlyDown)
  canvas.addEventListener('pointermove', onFlyMove)
  window.addEventListener('pointerup', onFlyUp)
  canvas.addEventListener('wheel', onFlyWheel, { passive: false })
  const MAP_BUTTONS = { ...controls.mouseButtons }
  // --- 휠 클릭으로 회전 중심 정하기 ---
  // 지도식 시점은 화면 가운데(target)를 중심으로 돈다. 큰 건물의 한쪽 구석을 돌려 보려면 그 자리를 가운데로 끌어와야 했다.
  // 휠(가운데 단추)을 움직이지 않고 누르면 그 자리(설비 형상, 없으면 물리존 바닥, 없으면 지금 중심 높이의 수평면)로 시점을 평행이동해
  // 회전 중심으로 삼는다. 각도는 그대로다. 휠 끌기(확대)는 그대로다.
  const PIVOT_PX = 4
  let pivotDown: { x: number; y: number } | null = null
  /** 마지막으로 정한 회전 중심(장면 좌표). 표시 고리는 이 자리에 잠깐 뜬다. */
  let pivotMark: { at: Vector3; t0: number } | null = null
  const pivotRing = new Mesh(new RingGeometry(0.55, 0.75, 40), new MeshBasicMaterial({ color: 0x4fd1ff, transparent: true, opacity: 0, depthTest: false, side: DoubleSide }))
  pivotRing.rotation.x = -Math.PI / 2
  pivotRing.renderOrder = 10
  pivotRing.visible = false
  scene.add(pivotRing)
  /** 화면 점(클라이언트 좌표)이 가리키는 장면의 점. */
  function pointUnder(x: number, y: number): Vector3 | null {
    const ray = rayAt(x, y).clone()
    let best = Infinity
    const id = pick(ray)
    if (id) best = pickDistance(ray, id)
    const at = new Vector3()
    const plane = new Plane(new Vector3(0, 1, 0), 0)
    for (const t of spaceTargets) {
      if (visibleStoreys && !visibleStoreys.has(t.storeyId)) continue
      plane.constant = -t.y
      if (!ray.intersectPlane(plane, at)) continue
      const d = at.distanceToSquared(ray.origin)
      if (d < best && pointInPolygon([at.x, -at.z], t.ring)) best = d
    }
    if (Number.isFinite(best)) return ray.origin.clone().addScaledVector(ray.direction, Math.sqrt(best))
    plane.constant = -controls.target.y
    return ray.intersectPlane(plane, at) ? at.clone() : null
  }
  function setPivot(at: Vector3) {
    const shift = at.clone().sub(controls.target)
    const near = camera.near
    const far = camera.far
    fly(at, camera.position.clone().add(shift), { near, far })
    pivotMark = { at, t0: performance.now() }
    dirty = true
  }
  function stepPivotMark(now: number) {
    if (!pivotMark) return
    const k = (now - pivotMark.t0) / 900
    if (k >= 1) {
      pivotMark = null
      pivotRing.visible = false
      dirty = true
      return
    }
    // 고리 크기는 화면에서 비슷하게 — 카메라 거리에 비례.
    const s = camera.position.distanceTo(pivotMark.at) * 0.03
    pivotRing.position.copy(pivotMark.at)
    pivotRing.scale.setScalar(s * (0.6 + 0.4 * k))
    ;(pivotRing.material as MeshBasicMaterial).opacity = 0.9 * (1 - k)
    pivotRing.visible = true
    dirty = true
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1) pivotDown = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointerup', (e) => {
    const down = pivotDown
    pivotDown = null
    if (e.button !== 1 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > PIVOT_PX) return
    const at = pointUnder(e.clientX, e.clientY)
    if (at) setPivot(at)
  })
  // 윈도의 가운데 단추 자동 스크롤을 막는다.
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault()
  })

  // --- 되돌리기의 미끄러짐 ---
  // 되돌린 설비(와 따라온 배관)가 순간이동하지 않고 원래 자리로 미끄러진다. 꼭짓점을 두 배열 사이에서 섞는다.
  const GLIDE_MS = 240
  /** ms·ease·delay 는 미끄러짐마다 정한다 — 리플레이에서는 길고 따라오는 배관이 늦게 출발한다(fx.glide). */
  const glides = new Map<string, { part: Part; from: Float32Array; to: Float32Array; t0: number | null; ms: number; ease: (k: number) => number; delay: number }>()
  function writePart(part: Part, positions: Float32Array) {
    const position = part.chunk.position
    ;(position.array as Float32Array).set(positions, part.vStart * 3)
    // 그 설비 범위만 올린다. 덩어리 전부(약 3MB)를 미끄러지는 프레임마다 올리면 성수에서 프레임이 끊겼다.
    position.addUpdateRange(part.vStart * 3, part.vCount * 3)
    position.needsUpdate = true
  }
  function finishGlide(id: string) {
    finishDrop(id)
    finishShake(id)
    const g = glides.get(id)
    if (!g) return
    glides.delete(id)
    writePart(g.part, g.to)
  }
  function stepGlides(now: number) {
    if (!glides.size) return
    for (const [id, g] of glides) {
      if (g.t0 === null) g.t0 = now
      const t = now - g.t0 - g.delay
      if (t < 0) continue
      const k = Math.min(1, t / g.ms)
      if (k === 1) {
        finishGlide(id)
        continue
      }
      const e = g.ease(k)
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
    const fromBox = part.box.clone()
    part.box.setFromArray(positions)
    if (glide && !still()) {
      glides.set(part.id, { part, from, to: positions, t0: null, ...fx.glide(part.id, GLIDE_MS) })
      started.glides++
      fx.glided(part.id, fromBox, part.box)
    }
    else writePart(part, positions)
    if (hoverMarkKey === `equipment:${part.id}`) markHover(null)
    drawArrows()
    dirty = true
  }

  // --- 놓을 때 떨어져 앉기(drop-in.ts) ---
  // 편집으로 새로 생긴 설비(patchModel 이 더한 덩어리)와 추가 공간 오브젝트(setSpaceObjects 에 처음 보이는 id)만 움직인다. 파일을 열 때나
  // 리플레이 중에는 움직이지 않는다. 설비는 꼭짓점을, 오브젝트는 묶음의 크기·높이를 고친다. 고르기 상자·소속은 처음부터 끝 자리다.
  const drops = new Map<string, { part: Part; base: Float32Array; out: Float32Array; pivot: [number, number, number]; size: number; t0: number | null }>()
  const objectDrops = new Map<string, { y: number; size: number; t0: number | null }>()
  const dropSize = new Vector3()
  const canDrop = (n: number) => editMode && n > 0 && n <= DROP_MAX && !still() && !fx.cinema()
  function startDrop(part: Part) {
    if (part.box.isEmpty()) return
    const arr = part.chunk.position.array as Float32Array
    const base = arr.slice(part.vStart * 3, (part.vStart + part.vCount) * 3)
    const c = part.box.getCenter(new Vector3())
    const d = { part, base, out: new Float32Array(base.length), pivot: [c.x, part.box.min.y, c.z] as [number, number, number], size: Math.max(...part.box.getSize(dropSize).toArray()), t0: null }
    drops.set(part.id, d)
    started.drops++
    poseVertices(base, d.out, d.pivot, dropPose(0, d.size))
    writePart(part, d.out)
    dirty = true
  }
  function finishDrop(id: string) {
    const d = drops.get(id)
    if (!d) return
    drops.delete(id)
    writePart(d.part, d.base)
  }
  function stepDrops(now: number) {
    if (!drops.size && !objectDrops.size) return
    for (const [id, d] of drops) {
      if (d.t0 === null) d.t0 = now
      const k = (now - d.t0) / DROP_MS
      if (k >= 1) {
        finishDrop(id)
        continue
      }
      poseVertices(d.base, d.out, d.pivot, dropPose(k, d.size))
      writePart(d.part, d.out)
    }
    for (const [id, d] of objectDrops) {
      // 오브젝트 묶음은 setSpaceObjects 마다 새로 만든다. 그때마다 id 로 다시 찾는다.
      const node = spaceObjects.children.find((n) => n.userData.objectId === id)
      if (d.t0 === null) d.t0 = now
      const k = (now - d.t0) / DROP_MS
      const pose = dropPose(k, d.size)
      if (node) {
        node.scale.set(pose.scale * pose.sxz, pose.scale * pose.sy, pose.scale * pose.sxz)
        node.position.y = d.y + pose.lift
      }
      if (k >= 1 || !node) objectDrops.delete(id)
    }
    dirty = true
  }

  // --- 고른 것의 외곽선(selection-outline.ts) ---
  // 고른 설비(여러 개 골랐으면 전부)·오브젝트·벽·문·창에 두른다. 고른 것·모델·숨기기·층 보기가 바뀌면 다음 프레임에 다시 모은다.
  // 계통을 통째로 고르면 수백 개라 앞의 OUTLINE_MAX_PARTS 개까지만 두른다.
  const OUTLINE_MAX_PARTS = 400
  let outlinePending = false
  let outlined: Object3D[] = []
  const outlineMaskMaterial = new MeshBasicMaterial()
  function markOutline() {
    outlinePending = true
    dirty = true
  }
  function clearOutlineMasks() {
    for (const o of outlineMasks.children) {
      // 꼭짓점은 덩어리 것이다. 떼고 버려야 덩어리의 GPU 버퍼가 남는다(dispose 는 형상의 속성 버퍼를 전부 지운다).
      const g = (o as Mesh).geometry
      g.deleteAttribute('position')
      g.dispose()
    }
    outlineMasks.clear()
    for (const o of outlined) o.layers.disable(OUTLINE_LAYER)
    outlined = []
  }
  function refreshOutline() {
    outlinePending = false
    clearOutlineMasks()
    const items: { object: Object3D; box?: Box3 }[] = []
    let key = ''
    const ids = grabIds.size ? [...grabIds] : selectedPart ? [selectedPart] : []
    for (const id of ids.slice(0, OUTLINE_MAX_PARTS)) {
      const part = partById.get(id)
      if (!part || hiddenIds.has(id) || !part.iCount || !part.chunk.shown) continue
      const g = new BufferGeometry()
      g.setAttribute('position', part.chunk.position)
      g.setIndex(new BufferAttribute(part.chunk.index.slice(part.iStart, part.iStart + part.iCount), 1))
      const mask = new Mesh(g, outlineMaskMaterial)
      mask.frustumCulled = false
      mask.layers.set(OUTLINE_LAYER)
      outlineMasks.add(mask)
      items.push({ object: mask, box: part.box })
    }
    if (items.length) key = `equipment:${ids.join(',')}`
    const node = selectedObject ? spaceObjects.children.find((n) => n.userData.objectId === selectedObject) : null
    if (node?.visible) {
      node.traverse((o) => {
        if (o instanceof Mesh) {
          o.layers.enable(OUTLINE_LAYER)
          outlined.push(o)
        }
      })
      items.push({ object: node })
      key ||= `object:${selectedObject}`
    }
    for (const o of arch.children) {
      if (!o.userData.selected || !o.visible) continue
      o.layers.enable(OUTLINE_LAYER)
      outlined.push(o)
      items.push({ object: o })
      key ||= `element:${lastArch.selected ?? ''}`
    }
    selectionOutline.set(items, key)
    dirty = true
  }

  // --- 바닥 아래 격자(ground-grid.ts) ---
  // 보이는 것(숨기지 않은 설비와 보이는 층의 판)의 상자 밑바닥에 깐다. 층 보기·숨기기·모델이 바뀌면 다시 깐다.
  let groundPlaced = false
  function placeGround() {
    const box = shownBox()
    groundPlaced = !box.isEmpty()
    ground.place(box, groundPlaced ? box.min.y : 0)
  }

  // --- Brick 클래스별 분해도(setExplode, ui-notes 보기 필터) ---
  // 클래스 묶음마다 설비 형상을 위로 평행이동한다(꼭짓점을 고쳐 쓴다 — 미끄러짐과 같은 장치라 고르기 상자도 따라간다). 원래 꼭짓점을
  // 떠 두었다가 접을 때 되돌린다. 모델은 건드리지 않는다. 다시 그리기·설비 옮기기가 오면 먼저 접는다 — 띄운 자리에서 옮기면 접을 때
  // 옛 자리로 돌아가 버린다.
  let explodedParts: Map<string, Float32Array> | null = null
  const explodeLabels = new Group()
  scene.add(explodeLabels)
  /** 미끄러지게 띄우는 설비 수의 한도. 넘으면 바로 옮긴다 — 성수에서 수천 대를 매 프레임 섞으면 화면이 멈춘다. */
  const EXPLODE_GLIDE_MAX = 400
  function disposeExplodeLabels() {
    for (const o of explodeLabels.children) {
      if (o instanceof Sprite) o.material.map?.dispose()
      else (o as LineLoop).geometry.dispose()
      ;((o as Sprite | LineLoop).material as Material).dispose()
    }
    explodeLabels.clear()
  }
  function collapseExplode(glide: boolean) {
    if (!explodedParts) return
    const slide = glide && explodedParts.size <= EXPLODE_GLIDE_MAX
    for (const [id, original] of explodedParts) {
      const part = partById.get(id)
      if (part && part.vCount * 3 === original.length) setPartPositions(part, original, slide)
    }
    explodedParts = null
    disposeExplodeLabels()
    dirty = true
  }
  function explodeLabel(text: string, height: number): Sprite {
    const c = document.createElement('canvas')
    const g = c.getContext('2d')!
    const font = '600 30px system-ui, sans-serif'
    g.font = font
    c.width = Math.ceil(g.measureText(text).width) + 36
    c.height = 52
    g.font = font
    g.fillStyle = 'rgba(17, 24, 39, 0.82)'
    g.beginPath()
    g.roundRect(0, 0, c.width, c.height, 12)
    g.fill()
    g.fillStyle = '#e8f4ff'
    g.textBaseline = 'middle'
    g.fillText(text, 18, c.height / 2 + 1)
    const map = new CanvasTexture(c)
    const sprite = new Sprite(new SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true }))
    sprite.scale.set((height * c.width) / c.height, height, 1)
    sprite.center.set(1, 0.5)
    sprite.renderOrder = 30
    return sprite
  }
  /** 보이는 것(숨기지 않은 설비와 보이는 층의 판)의 상자. */
  function shownBox(): Box3 {
    const box = new Box3()
    for (const part of parts) if (!hiddenIds.has(part.id)) box.union(part.box)
    for (const o of slabs.children) if (o.visible) box.expandByObject(o)
    if (box.isEmpty()) box.setFromObject(content)
    return box
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
      ;(p.mesh.material as MeshBasicMaterial).opacity = (fx.cinema() ? 0.6 : 0.35) * (k < 0.15 ? k / 0.15 : 1 - easeOut((k - 0.15) / 0.85))
    }
    dirty = true
  }


  let fadedIds = new Set<string>()

  /** 설비의 바탕색 — 덧칠(setTint)이 있으면 그 색, 없으면 계통 색. */
  const baseColor = (part: Part) => (tintColors ? (tintColors.get(part.id) ?? DIM_COLOR) : part.color)
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
    attr.addUpdateRange(k0, part.vCount * 3)
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
  const sameSet = (a: ReadonlySet<string> | null, b: ReadonlySet<string> | null) =>
    a === b || (!!a && !!b && a.size === b.size && [...a].every((x) => b.has(x)))
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

  type Piece = { id: string; color: number; p: ArrayLike<number>; n: ArrayLike<number>; i: ArrayLike<number>; src: unknown }
  /** 설비: 형상이 있으면 그 형상, 없고 좌표만 있으면 작은 상자. 좌표도 없으면 찍지 않는다 — 원점에 찍으면 거기 있는 것처럼 보인다. */
  function piecesOf(model: Model, meshes: MeshMap | undefined, colorOf: Map<string, number>): Piece[] {
    const pieces: Piece[] = []
    const systemById = new Map(model.systems.map((s) => [s.id, s]))
    const systemOf = (id: string) => systemById.get(id)
    for (const storey of model.storeys) {
      for (const equipment of storey.equipment) {
        const color = equipmentColor(equipment, systemOf, colorOf)
        const data = meshes?.get(equipment.id)
        if (data) {
          pieces.push({ id: equipment.id, color, p: data.positions, n: data.normals, i: data.indices, src: data })
        } else if (equipment.position) {
          const box = new BoxGeometry(0.4, 0.4, 0.4)
          box.translate(...toScene(equipment.position))
          pieces.push({
            id: equipment.id,
            color,
            p: box.getAttribute('position').array,
            n: box.getAttribute('normal').array,
            i: box.index!.array,
            src: `box:${equipment.position.join(',')}`,
          })
          box.dispose()
        }
      }
    }
    return pieces
  }
  /** 덩어리로 나눈다. 설비 하나는 한 덩어리 안에만 든다(끌기·칠하기가 설비 단위다). */
  function groupPieces(pieces: Piece[]): Piece[][] {
    const groups: Piece[][] = []
    let group: Piece[] = []
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
    return groups
  }
  /** 설비 묶음 하나를 한 덩어리(형상 하나에 진한·흐린 메시 둘)로 합쳐 장면에 건다. */
  function buildChunk(members: Piece[], solidMaterial: Material, fadedMaterial: Material): Chunk {
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
        const part: Part = { id: piece.id, color: piece.color, chunk, vStart: vo, vCount, iStart: io, iCount: piece.i.length, box, src: piece.src }
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
      for (const part of chunk.parts) paintPart(part, baseColor(part))
      // 합친 형상은 경계가 크고 켜 둔 채 시점을 돌린다. 화면 밖 판정은 꺼 둔다.
      chunk.solid.frustumCulled = false
      chunk.faded.frustumCulled = false
      content.add(chunk.solid, chunk.faded)
      chunks.push(chunk)
      return chunk
  }
  /**
   * 편집 뒤 다시 그리기(setModel keepView)를 고칠 것만 고쳐서 끝낸다. 설비 하나를 더하거나 계통을 바꿀 때마다 설비 형상 전부를
   * 다시 합쳐 GPU 에 올리느라 화면이 0.3~0.4초 멈췄다(dental 실측: 설비 더하기 392ms · 계통 300ms, 옮기기는 50~83ms).
   * 있던 덩어리는 두고 — 새 설비는 덩어리를 하나 더 붙이고, 색이 바뀐 설비는 칠만 다시 하고, 형상을 옮긴 설비는 꼭짓점만
   * 다시 쓴다. 지워진 설비가 있거나 꼭짓점 수가 달라졌으면 false(처음부터 다시 짓는다).
   */
  let lastMeshes: MeshMap | undefined
  function patchModel(model: Model, meshes: MeshMap | undefined): boolean {
    for (const id of [...drops.keys()]) finishDrop(id)
    for (const id of [...shakes.keys()]) finishShake(id)
    const colorOf = systemColors(model)
    const want = new Map(piecesOf(model, meshes, colorOf).map((p) => [p.id, p]))
    for (const part of parts) {
      const w = want.get(part.id)
      if (!w || w.p.length / 3 !== part.vCount || (w.src !== part.src && glides.has(part.id))) return false
    }
    for (const part of parts) {
      const w = want.get(part.id)!
      if (w.src !== part.src) {
        const positions = w.p instanceof Float32Array ? w.p : Float32Array.from(w.p)
        writePart(part, positions)
        part.box.makeEmpty()
        for (let k = 0; k < positions.length; k += 3) part.box.expandByPoint(tmpV.set(positions[k], positions[k + 1], positions[k + 2]))
        part.src = w.src
      }
      if (w.color !== part.color) {
        part.color = w.color
        paintPart(part, baseColor(part))
      }
    }
    const added = [...want.values()].filter((w) => !partById.has(w.id))
    if (added.length) {
      const made = new Set<Chunk>()
      for (const members of groupPieces(added)) made.add(buildChunk(members, chunks[0].solid.material as Material, chunks[0].faded.material as Material))
      splitIndex(made)
      for (const chunk of made) showChunk(chunk)
      if (canDrop(added.length)) for (const chunk of made) for (const part of chunk.parts) startDrop(part)
    }
    movable = new Set(model.storeys.flatMap((s) => s.equipment.filter((e) => e.position).map((e) => e.id)))
    fx.modelChanged(model)
    drag = null
    controls.enabled = true
    handleSpace = null
    arrowSpecs = []
    drawHandles()
    drawArrows()
    // 공간 판은 방 외곽선이, IFC 벽 형상은 층마다의 벽 목록이 바뀌었을 때만 다시 만든다(편집 파일을 얹으면 벽도 바뀐다).
    if (slabsKey(model) !== lastSlabsKey) buildSlabs(model)
    if (wallsKey(model) !== lastWallsKey) {
      if (walls) {
        content.remove(walls)
        walls.traverse((o) => {
          if (o instanceof Mesh || o instanceof LineSegments) {
            o.geometry.dispose()
            ;(o.material as { dispose(): void }).dispose()
          }
        })
      }
      buildWalls(model, meshes)
    }
    dirty = true
    return true
  }
  const tmpV = new Vector3()
  let lastWallsKey = ''
  // 편집으로 옮기거나 크기를 바꾼 벽은 지금 외곽선으로 다시 세운다(wall-view.ts) — 외곽선·높이도 열쇠에 넣는다.
  const wallsKey = (model: Model) =>
    model.storeys
      .map((st) => `${st.id}:${st.elevation}:${st.walls.map((w) => `${w.id}/${w.loadBearing}/${w.height ?? ''}/${(w.footprint ?? []).map((r) => r.map((p) => p.join(',')).join(';')).join('&')}`).join(',')}`)
      .join('|')
  /** 층마다 IFC 벽 형상(층별 보기가 층 단위로 켜고 끈다). */
  function buildWalls(model: Model, meshes: MeshMap | undefined) {
    lastWallsKey = wallsKey(model)
    walls = new Group()
    for (const storey of model.storeys) {
      const w = wallMesh(storey, meshes)
      if (!w) continue
      w.userData.storeyId = storey.id
      addEdges(w)
      walls.add(w)
    }
    if (walls.children.length === 0) walls = null
    if (walls) {
      walls.visible = wallsVisible
      content.add(walls)
      applyStoreyVisibility()
    }
    applySpaceFocus()
  }

  // --- 공간 보기(setSpaceFocus) ---
  // 판은 층마다 한 덩어리라 방 하나만 흐리게 할 수 없다. 그 층 판·벽을 통째로 흐리게 하고 고른 방 위에 채움을 따로 얹는다.
  let focusSpaceId: string | null = null
  let focusFill: Mesh | null = null
  const FOCUS_FILL = 0x38bdf8
  function applySpaceFocus() {
    if (focusFill) {
      overlay.remove(focusFill)
      focusFill.geometry.dispose()
      ;(focusFill.material as { dispose(): void }).dispose()
      focusFill = null
    }
    const t = focusSpaceId ? spaceTargets.find((x) => x.id === focusSpaceId) : null
    for (const o of slabs.children) {
      const mat = (o as Mesh).material as MeshLambertMaterial
      mat.opacity = t && o.userData.storeyId === t.storeyId ? Math.min(slabOpacity, 0.08) : ceilingPlanes.children.length ? Math.min(slabOpacity, 0.12) : slabOpacity
    }
    for (const o of walls?.children ?? []) {
      const mat = (o as Mesh).material as MeshLambertMaterial
      const fade = !!t && o.userData.storeyId === t.storeyId
      if (mat.transparent === fade) continue
      mat.transparent = fade
      mat.opacity = fade ? 0.18 : 1
      mat.depthWrite = !fade
      mat.needsUpdate = true
    }
    if (t && t.ring.length >= 3) {
      const geometry = new ShapeGeometry(new Shape(t.ring.map(([x, y]) => new Vector2(x, y))))
      // Shape 는 IFC 평면(x, y)이라 바닥(x, -z)으로 눕힌다(pulseSpaces 와 같다).
      geometry.rotateX(-Math.PI / 2)
      focusFill = new Mesh(geometry, new MeshBasicMaterial({ color: FOCUS_FILL, transparent: true, opacity: 0.42, depthTest: false, depthWrite: false, side: DoubleSide }))
      focusFill.position.y = t.y + 0.02
      focusFill.renderOrder = 7
      overlay.add(focusFill)
    }
    fadeObjects()
  }
  let lastSlabsKey = ''
  function slabsKey(model: Model): string {
    const out: (string | number)[] = [slabOpacity]
    for (const st of model.storeys) {
      out.push('S', st.id, st.elevation)
      for (const sp of st.spaces) {
        out.push(sp.id, sp.kind ?? '')
        for (const p of sp.footprint) out.push(p[0], p[1])
      }
    }
    return out.join(',')
  }

  const storeySlabCache = new Map<string, { key: string; mesh: Mesh }>()

  function disposeContent() {
    storeySlabCache.clear()
    content.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineSegments) {
        o.geometry.dispose()
        ;(o.material as { dispose(): void }).dispose()
      }
    })
    scene.remove(content)
  }

  let slabs = new Group()
  let slabOpacity = 0.8

  /**
   * 방 하나의 판 조각(spaceMesh 와 같은 압출, 층 높이로 올림). 외곽선·높이로 기억한다 — 방 하나를 고칠 때마다 모든 방을 다시
   * 압출했다(dental 리플레이의 방 장면마다 30~40ms, 성수는 934개).
   */
  const slabPieces = new Map<string, BufferGeometry | null>()
  function slabPiece(footprint: readonly Vec2[], elevation: number): BufferGeometry | null {
    const key = `${elevation}|${footprint.map((p) => `${p[0]},${p[1]}`).join(';')}`
    if (slabPieces.has(key)) return slabPieces.get(key)!
    const mesh = spaceMesh(footprint, 0)
    let g: BufferGeometry | null = null
    if (mesh) {
      mesh.geometry.translate(0, elevation, 0)
      g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
      ;(mesh.material as { dispose(): void }).dispose()
    }
    if (slabPieces.size > 20000) slabPieces.clear()
    slabPieces.set(key, g)
    return g
  }

  /** 공간 판. 층마다 하나로 합치고, 안 바뀐 층의 합친 메시는 그대로 재사용한다. 성수는 19개 층에 방이 934개라 한 방의 꼭짓점을 옮길 때 그 층 하나만 다시 합친다. */
  function buildSlabs(model: Model) {
    lastSlabsKey = slabsKey(model)
    content.remove(slabs)
    slabs = new Group()
    spaceTargets = []
    const seen = new Set<string>()
    model.storeys.forEach((storey, i) => {
      seen.add(storey.id)
      const color = STOREY_COLORS[i % STOREY_COLORS.length]
      const sKey = `${color}|${slabOpacity}|${storey.elevation}|${storey.spaces.map((sp) => `${sp.id}:${sp.footprint.map((p) => `${p[0]},${p[1]}`).join(';')}`).join('|')}`
      for (const space of storey.spaces) {
        if (space.footprint.length < 3) continue
        // 판 두께가 0.1 이다(spaceMesh). 윗면에서 잰다.
        spaceTargets.push({ id: space.id, storeyId: storey.id, y: storey.elevation + 0.1, ring: space.footprint })
      }
      const cached = storeySlabCache.get(storey.id)
      if (cached && cached.key === sKey) {
        slabs.add(cached.mesh)
        return
      }
      if (cached) {
        cached.mesh.geometry.dispose()
        ;(cached.mesh.material as { dispose(): void }).dispose()
        storeySlabCache.delete(storey.id)
      }
      const pieces: BufferGeometry[] = []
      for (const space of storey.spaces) {
        const piece = slabPiece(space.footprint, storey.elevation)
        if (!piece) continue
        pieces.push(piece)
      }
      if (pieces.length === 0) return
      // 조각은 slabPiece 가 기억해 두고 다시 쓴다 — 합치기는 복사라 놓지 않는다.
      const merged = mergeGeometries(pieces)
      if (merged) {
        const slab = new Mesh(merged, new MeshLambertMaterial({ color, transparent: true, opacity: slabOpacity, side: DoubleSide }))
        slab.userData.storeyId = storey.id
        storeySlabCache.set(storey.id, { key: sKey, mesh: slab })
        slabs.add(slab)
      }
    })
    for (const [id, cached] of storeySlabCache) {
      if (!seen.has(id)) {
        cached.mesh.geometry.dispose()
        ;(cached.mesh.material as { dispose(): void }).dispose()
        storeySlabCache.delete(id)
      }
    }
    content.add(slabs)
    applyStoreyVisibility()
    applySpaceFocus()
  }

  // e2e 모드에서만 연다. 3D 는 DOM 이 아니라서 테스트가 어디를 눌러야 하는지 알 길이 이것뿐이다.
  if (import.meta.env.MODE === 'e2e') {
    ;(window as unknown as { __viewer?: unknown }).__viewer = {
      /** 공간 보기로 채운 방(setSpaceFocus)과 그 층 판의 불투명도. */
      spaceFocus: () => ({ id: focusSpaceId, fill: !!focusFill, slab: Math.min(...slabs.children.map((o) => ((o as Mesh).material as MeshLambertMaterial).opacity)) }),
      /** 숨긴 설비 수·보이는 층·분해도 라벨(ui-notes 의 보기 필터 절을 잰다). */
      shown: () => ({ hidden: hiddenIds.size, parts: parts.length, storeys: visibleStoreys ? [...visibleStoreys] : null, labels: explodeLabels.children.filter((o) => o instanceof Sprite).length, exploded: explodedParts?.size ?? 0 }),
      /** 마우스 아래 표시가 무엇에 그려져 있는지('equipment:id' · 'space:id' · ''). */
      hoverMark: () => (hoverMark || hoverOutline.state().objects ? hoverMarkKey : ''),
      /** 미리 강조 외곽선(OE-UI-27): 두른 수와 무엇인가. */
      hoverOutline: () => hoverOutline.state(),
      /** 막은 상대의 붉은 외곽선(OE-SPC-15)과 놓기 전 미리보기(보이나 · 붉은가 · 자리). */
      conflictOutline: () => conflictOutline.state(),
      ghost: () => ({ visible: placeGhost.visible, blocked: placeGhost.visible && !!ghostBlocked, at: placeGhost.visible ? [placeGhost.position.x, -placeGhost.position.z] : null, shape: placeGhost.visible ? ghostShape : null }),
      /** 보기 모드 3D 의 벽(#599): 켜져 있나, 삼각형 수. 벽이 없으면 null. */
      walls: () =>
        walls
          ? {
              visible: walls.visible,
              triangles: walls.children.reduce((n, o) => n + ((o as Mesh).geometry.index?.count ?? 0) / 3, 0),
              /** 층마다의 벽 덩어리 수와 모서리 선(model-edges.ts)을 붙인 덩어리 수. */
              meshes: walls.children.length,
              edged: walls.children.filter((o) => o.children.some((c) => c.userData.edges)).length,
              /** IFC 형상 대신 지금 외곽선으로 다시 세운 벽(편집한 벽만이어야 한다). */
              rebuilt: walls.children.flatMap((o) => o.userData.rebuilt as string[]),
            }
          : null,
      /** 깐 평면도 배경의 귀퉁이(IFC 평면). 없으면 null. */
      background: () => backdropCorners,
      /** 회전 손잡이의 화면 자리(창 좌표)와 손잡이 둘레의 중심·반지름. 손잡이가 없으면 null. */
      rotateHandle: () => {
        if (!rotateKnob || !rotateSpec) return null
        const knob = toScreen(rotateKnob.position)
        const y = toScene([0, 0, rotateSpec.elevation])[1] + 0.05
        const center = toScreen(new Vector3(rotateSpec.center[0], y, -rotateSpec.center[1]))
        return knob && center ? { knob, center, angle: rotateSpec.angle, guide: rotateSpec.guide, spec: rotateSpec } : null
      },
      /** 평면 점(IFC x·y, 높이 z)의 화면 자리. 회전 손잡이를 어느 방향으로 끌지 정할 때 쓴다. */
      screenOf: (p: Vec3) => toScreen(new Vector3(...toScene(p))),
      /** 지금 도는 움직임(카메라 비행·미끄러지는 설비 수·번쩍이는 방 수). */
      /** 카메라 자리와 바라보는 점(three.js 좌표). 시점 조작(OE-OBJ-15)이 이동인지 회전인지 가른다 — 이동은 둘의 차가 그대로다. */
      camera: () => ({ position: camera.position.toArray(), target: controls.target.toArray() }),
      flying: () => (flying ? { keys: [...flying.keys], scale: flying.scale } : null),
      /** 휠 클릭으로 정한 회전 중심 고리가 떠 있나. */
      pivot: () => (pivotMark ? pivotMark.at.toArray() : null),
      /** 고른 것의 외곽선(두른 수 · 빛이 퍼지는 중인가 · 무엇을 골랐나)과 바닥 격자(보이나 · 높이). */
      outline: () => selectionOutline.state(),
      ground: () => ({ visible: ground.mesh.visible, y: ground.mesh.position.y }),
      /** 모서리 선(model-edges.ts)을 붙인 메시 수. 벽·편집 벽·가구 조각마다 하나다. */
      edges: () => {
        let n = 0
        scene.traverse((o) => {
          if (o instanceof LineSegments && o.userData.edges) n++
        })
        return n
      },
      motion: () => ({ flying: !!flight, gliding: glides.size, dropping: drops.size + objectDrops.size, shaking: shakes.size + objectShakes.size, sinking: exits.length, pulsing: pulses.length, cascading: cascade ? cascade.parts.length : 0, cascadeShown: cascade ? cascade.parts.filter((p) => p.objects[0].visible).length : 0, ...fx.motion(), started }),
      part: (id: string) => {
        const part = partById.get(id)
        return part ? toScreen(part.box.getCenter(new Vector3())) : null
      },
      /** 설비 형상 상자의 가로·세로·높이(IFC 축, mm 로 반올림). 형상 없는 설비는 표시 상자(0.4m)다. */
      size: (id: string) => {
        const part = partById.get(id)
        if (!part) return null
        const s = part.box.getSize(new Vector3())
        return [s.x, s.z, s.y].map((v) => Math.round(v * 1000) / 1000)
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
      /** 그린 흐르는 빛의 연결 수. 없으면 0. */
      flow: () => (flowMesh?.userData.flowSegments as number | undefined) ?? 0,
      /** 지금까지 3D 를 다시 그린 장수. 가만히 있으면 늘지 않아야 한다(흐르는 빛이 있을 때만 매 프레임). */
      renders: () => renders,
      objects: () => objectTargets.map((t) => t.id),
      /** 겹쳐서 막아 붉게 그린 공간 오브젝트(OE-SPC-15). 없으면 null. */
      objectConflict: () => objectConflictId,
      /** 오브젝트 윗면 가운데의 화면 자리. 눌러 고르고 끄는 데 쓴다. */
      object: (id: string) => {
        const t = objectTargets.find((x) => x.id === id)
        if (!t) return null
        const center = t.box.getCenter(new Vector3())
        return toScreen(center.setY(t.box.max.y))
      },
      /** 오브젝트에서 가장 진한 면의 불투명도. 설비·계통을 고르는 동안 가구를 흐리게 했는지 본다. */
      objectOpacity: (id: string) => {
        const t = objectTargets.find((x) => x.id === id)
        if (!t) return null
        let most = 0
        t.node.traverse((o) => {
          if (o instanceof Mesh) for (const m of [o.material].flat()) most = Math.max(most, m.transparent ? m.opacity : 1)
        })
        return most
      },
      /** 오브젝트 상자(화면 세계 좌표). 늘린 모델이 상자에 맞는지 본다. */
      objectBox: (id: string) => {
        const t = objectTargets.find((x) => x.id === id)
        return t ? { min: t.box.min.toArray(), max: t.box.max.toArray() } : null
      },
      /** 그린 룸의 id. */
      rooms: () => roomTargets.map((t) => t.id),
      /** 종류별 색(setTint)으로 칠한 설비 수. 끄면 0. */
      tinted: () => tintColors?.size ?? 0,
      /** 그린 수직 관통 오브젝트 조각의 id(보이는 층만)와, 조각을 누를 화면 자리(형상 가운데 또는 지점). */
      verticals: () => verticalTargets.filter((t) => !visibleStoreys || visibleStoreys.has(t.storeyId)).map((t) => t.id),
      vertical: (id: string) => {
        const t = verticalTargets.find((x) => x.id === id)
        return t ? toScreen(new Vector3(t.at[0], t.y, -t.at[1])) : null
      },
      /** 그린 그리드 선 수(OE-UI-07). */
      grid: () => gridCount,
      snap: () => snapState,
      /** 고른(파랗게 칠한) 조각 id. */
      verticalSelected: () => [...selectedVertical],
      /** 진입·종료 표시 수(보이는 층만). */
      verticalMarks: () => ({
        entry: verticals.children.filter((o) => o.visible && o.userData.mark === 'entry').length,
        exit: verticals.children.filter((o) => o.visible && o.userData.mark === 'exit').length,
        rise: verticals.children.filter((o) => o.visible && o.userData.mark === 'rise').length,
        preview: verticals.children.filter((o) => o.visible && o.userData.mark === 'preview').length,
      }),
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
      /** 화면의 한 점을 누르면 무엇이 골라지는가(설비·벽·문·창·물리존·수직 관통 오브젝트 조각). */
      pickAt: (x: number, y: number) => {
        const ray = rayAt(x, y)
        return { equipment: pick(ray), element: archTargets.length ? pickElement(ray) : null, space: pickSpace(ray), vertical: pickVertical(ray)?.id ?? null }
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

  // 편집 리플레이(PoC)의 연출. 뷰어 안의 것을 빌려주고, 위아래의 `fx.` 자리에서 부른다(replay-viewer.ts).
  const fx = createReplayFx({
    scene, camera, controls, renderer, hemi, sun, raycaster, overlay, arch, rooms, customZones, spaceObjects,
    content: () => content,
    chunks: () => chunks,
    partById: () => partById,
    objectTargets: () => objectTargets,
    spaceTargets: () => spaceTargets,
    archTargets: () => archTargets,
    hiddenIds: () => hiddenIds,
    visibleStoreys: () => visibleStoreys,
    storeyShown, invalidate, writePart, paintPart, toScene, rayAt, toScreen,
    fit: (box, eye = false) => fit(box, true, undefined, eye),
    setPixelRatioCap: (cap) => {
      pixelRatioCap = cap
      invalidate()
    },
    viewDistance: () => (flight ? flight.toP.distanceTo(flight.toT) : camera.position.distanceTo(controls.target)),
    rebuildArchitecture: () => lastArch.model && buildArchitecture(lastArch.model, lastArch.selected, lastArch.also),
  })

  const api: Viewer = {
    ...fx.api,
    setModel(model, meshes, options) {
      // 분해도는 화면에서만 띄운 것이다. 다시 그리기 전에 접는다(patchModel 은 안 바뀐 설비를 그대로 두니 띄운 채 남는다).
      collapseExplode(false)
      // 편집으로 지운 설비는 지금 모양을 떼어 가라앉힌다(지울 때 가라앉기). 지우면 patchModel 이 못 하고 아래에서 다시 짓는다.
      if (options?.keepView) {
        const ids = new Set(model.storeys.flatMap((st) => st.equipment.map((e) => e.id)))
        const removed = parts.filter((p) => !ids.has(p.id) && !hiddenIds.has(p.id) && !p.box.isEmpty())
        if (canDrop(removed.length)) for (const p of removed) startExit(partCopy(p), p.box.max.y - p.box.min.y)
      }
      for (const id of [...shakes.keys()]) finishShake(id)
      // 편집 뒤 다시 그리기는 바뀐 설비만 고친다(patchModel). 안 되면 아래에서 처음부터 다시 짓는다.
      if (options?.keepView && meshes === lastMeshes && chunks.length && patchModel(model, meshes)) return
      lastMeshes = meshes
      // 형상을 새로 지으면 연쇄 화살표가 가리키던 자리도 바뀐다. 걷는다.
      clearCascade()
      // 끄는 중에 모델이 바뀌면 끌던 것은 버린다. 형상을 새로 만드니 되돌릴 것도 없다.
      drag = null
      controls.enabled = true
      // 외곽선 마스크는 덩어리 꼭짓점을 나눠 쓴다. 덩어리를 버리기 전에 뗀다. 새 파일의 오브젝트는 떨어지지 않는다(처음 보는 것이 아니다).
      clearOutlineMasks()
      clearHoverOutline()
      hoverOutline.set([], '')
      hoverMarkKey = ''
      // 막은 상대의 마스크도 덩어리 꼭짓점을 나눠 쓴다. 다시 지은 덩어리로 다음 프레임에 다시 건다.
      clearOutlineSet(conflictSet)
      conflictOutline.set([], '')
      if (conflictEquipment || objectConflictId || ghostBlocked) markConflictRefresh = true
      drops.clear()
      objectDrops.clear()
      prevObjectIds = null
      // 이전 모델의 지오메트리를 놓아 준다. 파일을 여러 번 열면 GPU 메모리가 쌓인다.
      disposeContent()
      content = new Group()
      slabs = new Group()
      parts = []
      partById = new Map()
      fadedIds = new Set()
      movable = new Set(model.storeys.flatMap((s) => s.equipment.filter((e) => e.position).map((e) => e.id)))
      fx.modelChanged(model)
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

      const groups = groupPieces(piecesOf(model, meshes, colorOf))

      chunks = []
      const solidMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
      // 아주 옅게 남긴다. 아예 지우면 연결망이 건물 어디쯤인지 알 수 없고, 진하면 가는 배관 한 줄이 묻힌다.
      const fadedMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.08, depthWrite: false })
      for (const members of groups) buildChunk(members, solidMaterial, fadedMaterial)
      splitIndex()
      // 같은 모델을 다시 그리는 것(편집 뒤)은 한꺼번에 켠다. 나눠 켜면 편집할 때마다 건물이 사라졌다 다시 찬다.
      if (options?.keepView) for (const chunk of chunks) showChunk(chunk)
      // 층마다 따로 만든다. 층별로 보기가 층 단위로 켜고 끈다.
      buildWalls(model, meshes)

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
        const base = baseColor(part)
        let next = base
        if (highlight) {
          if (id === highlight.selected || highlight.group?.has(id)) next = PICK_COLORS.selected
          else if (highlight.upstream.has(id)) next = PICK_COLORS.upstream
          else if (highlight.downstream.has(id)) next = PICK_COLORS.downstream
          else if (highlight.ruleUpstream?.has(id)) next = PICK_COLORS.ruleUpstream
          else if (highlight.ruleDownstream?.has(id)) next = PICK_COLORS.ruleDownstream
          else if (highlight.linked.has(id)) next = highlight.keepColor ? base : PICK_COLORS.linked
          // 고른 것과 상관없는 설비는 흐리게 한다. 지우지 않으면 연결망이 숲에 묻힌다. 여러 개 고르는 중에는 흐리게 하지 않는다 —
          // 흐린 것은 고를 수 없다.
          else if (!highlight.group) nextFaded.add(id)
        }
        // 천장 편집 모드에서 천장 설비가 아닌 것은 회색이다(고른 것·상류·하류 색은 둔다).
        if (next === base && dimIds.has(id)) next = DIM_COLOR
        paintPart(part, next)
      }
      // 고른 것이 있으면 가구도 흐리게 한다. 여러 개 고르는 중에는 설비처럼 두고, 칠할 것이 없는 강조(빈 계통)도 둔다.
      // 종류별 색(setTint)일 때도 가구를 흐리게 한다 — 갈색 가구가 칠한 기기보다 먼저 눈에 들어왔다.
      const fadeObjectsNow = (!!highlight && !highlight.group && nextFaded.size > 0) || !!tintColors
      if (fadeObjectsNow !== objectsFaded) {
        objectsFaded = fadeObjectsNow
        fadeObjects()
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
      markOutline()
      dirty = true
      // 흐리게 칠한 것은 고를 수 없으니, 계통을 바꾸면 마우스 아래가 고를 수 있는지도 바뀐다.
      if (changed && hoverAt) hoverPending = true
    },

    setTint(colors) {
      tintColors = colors && colors.size ? colors : null
      api.setHighlight(lastHighlight)
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

    onContext(handler) {
      contextHandler = handler
    },

    frameVisible(keep) {
      const box = shownBox()
      for (const o of explodeLabels.children) box.expandByObject(o)
      if (box.isEmpty()) return
      if (keep) fit(box, true, new Vector3().subVectors(camera.position, controls.target))
      else fit(box)
    },

    setExplode(groups) {
      collapseExplode(!groups)
      if (!groups?.length) return false
      const all = shownBox()
      if (all.isEmpty()) return false
      const height = all.max.y - all.min.y
      const width = Math.max(all.max.x - all.min.x, all.max.z - all.min.z)
      // 넓은 건물(Duplex·병원)은 클래스마다 건물 위로 한 켜씩 쌓는다. 높은 건물(성수 19층)은 쌓으면 기둥처럼 길어져 라벨이 안 읽혀,
      // 건물 옆에 바둑판으로 늘어놓는다(칸마다 그 클래스 설비가 건물 안 제자리에 있다 — 어디에 몰려 있는지가 보인다).
      const tall = height > width * 0.8
      const cell = width * 1.3
      const cols = Math.ceil(Math.sqrt(groups.length + 1))
      const gap = Math.max(2.5, height * 0.3)
      // 라벨 높이는 건물 크기에 맞춘다. 건물 전체를 맞춘 시점에서 글자가 읽히는 크기.
      const labelH = tall ? Math.max(1.5, cell * 0.09) : Math.max(1.2, Math.min(6, (all.max.x - all.min.x + all.max.z - all.min.z) * 0.045))
      const moving = groups.reduce((n, g) => n + g.ids.length, 0)
      const slide = moving <= EXPLODE_GLIDE_MAX
      const next = new Map<string, Float32Array>()
      let level = all.max.y + gap
      const frameBox = all.clone()
      groups.forEach((g, k) => {
        const members = g.ids.map((id) => partById.get(id)).filter((p): p is Part => !!p && !hiddenIds.has(p.id) && !p.box.isEmpty())
        if (!members.length) return
        const box = new Box3()
        for (const p of members) {
          finishGlide(p.id)
          box.union(p.box)
        }
        // 바둑판: 0번 칸은 건물(덕트·배관과 판)이 그대로 쓴다.
        const at = k + 1
        const shift = tall ? new Vector3((at % cols) * cell, 0, Math.floor(at / cols) * cell) : new Vector3(0, level - box.min.y, 0)
        for (const p of members) {
          const arr = p.chunk.position.array as Float32Array
          const original = arr.slice(p.vStart * 3, (p.vStart + p.vCount) * 3)
          next.set(p.id, original)
          const moved = original.slice()
          for (let i = 0; i < moved.length; i += 3) {
            moved[i] += shift.x
            moved[i + 1] += shift.y
            moved[i + 2] += shift.z
          }
          setPartPositions(p, moved, slide)
        }
        const sprite = explodeLabel(g.label, labelH)
        if (tall) {
          // 칸 위 가운데. 칸의 바닥 윤곽(건물 발자국)을 옅게 그려 칸이 어디까지인지 보인다.
          sprite.center.set(0.5, 0)
          sprite.position.set((all.min.x + all.max.x) / 2 + shift.x, all.max.y + labelH * 0.4, (all.min.z + all.max.z) / 2 + shift.z)
          const ring = new LineLoop(
            new BufferGeometry().setFromPoints(
              [
                [all.min.x, all.min.z],
                [all.max.x, all.min.z],
                [all.max.x, all.max.z],
                [all.min.x, all.max.z],
              ].map(([x, z]) => new Vector3(x + shift.x, all.min.y, z + shift.z)),
            ),
            new LineBasicMaterial({ color: 0x8a94a3, transparent: true, opacity: 0.5 }),
          )
          ring.userData.explodeRing = true
          explodeLabels.add(ring)
        } else {
          // 켜의 왼쪽 끝 바로 옆에 라벨(오른쪽 끝을 맞춘다). 건물 왼쪽 끝에 세우면 켜가 작을 때 라벨과 떨어져 무엇의 이름인지 몰랐다.
          sprite.position.set(box.min.x - labelH * 0.3, level + (box.max.y - box.min.y) / 2, (box.min.z + box.max.z) / 2)
          level += box.max.y - box.min.y + gap * 0.6
        }
        explodeLabels.add(sprite)
        frameBox.union(box.clone().translate(shift))
      })
      if (!next.size) return false
      explodedParts = next
      for (const o of explodeLabels.children) frameBox.expandByObject(o)
      fit(frameBox)
      dirty = true
      return true
    },

    exploded() {
      return !!explodedParts
    },

    frame(ids, margin = 0) {
      const box = new Box3()
      for (const id of ids) {
        const part = partById.get(id)
        if (part) box.union(part.box)
      }
      if (box.isEmpty()) return
      if (margin > 0) box.expandByScalar(margin)
      fit(box)
    },

    setEditMode(on) {
      editMode = on
      if (!on) endDrag(false)
      drawHandles()
      drawArrows()
      if (hoverAt) hoverPending = true
    },

    setHandleEdit(on) {
      handleEdit = on
      if (!on && drag?.kind === 'vertex') endDrag(false)
      drawHandles()
    },

    isDragging() {
      return drag !== null && drag.moved
    },

    shiftEquipment(id, delta, glide = false) {
      const part = partById.get(id)
      if (!part) return false
      collapseExplode(false)
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
      collapseExplode(false)
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
      // 붉은 외곽선(conflictOutline)이 상대를 짚고, 상대가 한 번 흔들린다(OE-SPC-15).
      conflictEquipment = id
      refreshConflict()
      startShake({ kind: 'equipment', id })
      conflictTimer = window.setTimeout(clearConflict, CONFLICT_MS)
    },

    onEquipmentMove(handler) {
      moveHandler = handler
    },

    onPickSpace(handler) {
      spacePickHandler = handler
    },

    setSpaceHandles(space) {
      if (drag?.kind === 'vertex' && !drag.moved && space && drag.index < space.ring.length) {
        const p = space.ring[drag.index]
        drag.at.set(p[0], drag.at.y, -p[1])
      }
      handleSpace = space
      drawHandles()
    },

    onVertexPick(handler) {
      vertexPickHandler = handler
    },

    previewVertex(index, to) {
      if (!handleSpace || index < 0 || index >= handles.length) return
      const y = handleSpace.elevation + 0.12
      moveHandle(index, new Vector3(to[0], y, -to[1]))
      dirty = true
    },

    onVertexMove(handler) {
      vertexHandler = handler
    },

    setRotateHandle(spec) {
      rotateSpec = spec
      drawRotate()
    },

    onRotate(handler) {
      rotateHandler = handler
    },

    setArrows(arrows) {
      arrowSpecs = arrows
      drawArrows()
    },

    setFlow(flow) {
      flowSpec = flow
      drawFlow()
    },

    playCascade(items) {
      startCascade(items)
    },

    setArrowsShown(on) {
      arrowsShown = on
      drawArrows()
    },

    onArrowClick(handler) {
      arrowHandler = handler
    },

    updateSpaces(model) {
      buildSlabs(model)
    },

    warmArchitecture(model) {
      // 외곽선 층은 켤 때 처음 짓는다 — 리플레이의 첫 벽 장면이 벽 전부(dental 1300개)를 한 프레임에 압출했다. 오프닝 동안
      // 프레임마다 조금씩(6ms) 압출해 extrudeRing 에 기억해 둔다. 짓지는 않는다.
      const jobs: [readonly Vec2[], number, number][] = []
      for (const st of model.storeys) {
        const y = st.elevation + 0.1
        const cuts = openingCutsOf(st, y)
        for (const w of st.walls) for (const slab of wallSlabsOf(w.footprint ?? [], cuts.get(w.id))) jobs.push([slab.ring, y + slab.bottom, slab.top - slab.bottom])
      }
      let i = 0
      const slice = () => {
        const end = performance.now() + 6
        while (i < jobs.length && performance.now() < end) extrudeRing(...jobs[i++])
        if (i < jobs.length && running) requestAnimationFrame(slice)
      }
      requestAnimationFrame(slice)
    },

    setArchitecture(model, selected, also) {
      // 벽·문·창과 고른 것이 그대로면 다시 짓지 않는다. 화면 갱신(sceneVersion)마다 불려서 설비만 바뀐 편집에도 벽을 전부 다시
      // 압출했다(dental 의 리플레이 다시 하기 한 번에 92ms). 솟아오르기·미끄러짐은 rebuildArchitecture 로 따로 다시 짓는다.
      if (archKey(model, selected, also) === lastArchKey) return
      buildArchitecture(model, selected, also)
    },

    setHvacZones(model, selected) {
      zoneLines.traverse((o) => {
        if (o instanceof LineLoop || o instanceof Mesh) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      zoneLines.clear()
      const elevation = new Map((model?.storeys ?? []).map((s) => [s.id, s.elevation]))
      // IDF 공조존은 담당 방식 색으로 바닥을 옅게 칠한다(idf/zone-view.ts). 존 다섯이 방 하나를 나누는 성수 기준층에서 외곽선만으로는
      // 어느 띠가 어느 존인지 안 보였다. 사람이 만든 공조존은 예전처럼 외곽선만이다.
      const serves = model ? zoneServes(model) : new Map<string, ZoneServe>()
      for (const zone of model ? hvacZonesOf(model) : []) {
        if (!zone.storeyId) continue
        const on = zone.id === selected
        const serve = serves.get(zone.id)
        const color = on ? ARCH_COLORS.selected : serve ? new Color(ZONE_SERVE_COLOR[serve]).getHex() : ZONE_COLOR
        const y = (elevation.get(zone.storeyId) ?? 0) + 0.2
        for (const ring of zone.footprint) {
          const points = ring.map((p) => new Vector3(p[0], y, -p[1]))
          const line = new LineLoop(new BufferGeometry().setFromPoints(points), new LineBasicMaterial({ color }))
          line.userData.storeyId = zone.storeyId
          zoneLines.add(line)
          if ((serve || on) && ring.length >= 4) {
            const shape = new Shape(ring.slice(0, -1).map((p) => new Vector2(p[0], p[1])))
            const face = new Mesh(
              new ShapeGeometry(shape),
              new MeshBasicMaterial({ color, transparent: true, opacity: on ? 0.35 : 0.16, side: DoubleSide, depthWrite: false }),
            )
            // ShapeGeometry 는 xy 평면이다. IFC 평면(x, y)을 three 바닥(x, -z)으로 눕힌다.
            face.rotation.x = -Math.PI / 2
            face.position.y = y - 0.01
            face.userData.storeyId = zone.storeyId
            face.raycast = () => {}
            zoneLines.add(face)
          }
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

    onFrozenGrab(handler) {
      frozenGrabHandler = handler
    },

    setGrid(grid) {
      for (const o of gridGroup.children) {
        const line = o as LineSegments
        line.geometry.dispose()
        ;(line.material as LineBasicMaterial).dispose()
      }
      gridGroup.clear()
      gridCount = 0
      dirty = true
      if (!grid) return
      const y = grid.elevation + 0.115
      const pts: number[] = []
      for (const x of grid.x) pts.push(x, y, -grid.extent.minY, x, y, -grid.extent.maxY)
      for (const v of grid.y) pts.push(grid.extent.minX, y, -v, grid.extent.maxX, y, -v)
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3))
      const lines = new LineSegments(geometry, new LineBasicMaterial({ color: 0x8a93a3, transparent: true, opacity: 0.35, depthWrite: false }))
      lines.raycast = () => {}
      lines.renderOrder = 2
      gridGroup.add(lines)
      gridCount = grid.x.length + grid.y.length
    },

    setBackground(bg) {
      for (const o of backdrop.children) {
        const mesh = o as Mesh
        mesh.geometry.dispose()
        const material = mesh.material as MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
      }
      backdrop.clear()
      backdropCorners = bg?.corners ?? null
      // 화면은 바뀐 것이 있을 때만 다시 그린다.
      dirty = true
      if (!bg) return
      // IFC 평면(x, y)을 three 바닥(x, -z)으로. 물리존 판(두께 0.1m, spaceMesh) 바로 위에 깐다 — 아래에 두면 판이 도면을 덮어
      // 그 위에 물리존을 그릴 수 없다. 반투명이라 판의 색은 비친다.
      const y = bg.elevation + 0.11
      const positions = bg.corners.flatMap((p) => [p[0], y, -p[1]])
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
      // 텍스처는 위가 v=1 이다. 왼쪽 위·오른쪽 위·오른쪽 아래·왼쪽 아래.
      geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2))
      geometry.setIndex([0, 2, 1, 0, 3, 2])
      const material = new MeshBasicMaterial({ transparent: true, opacity: bg.opacity, side: DoubleSide, depthWrite: false })
      new TextureLoader().load(bg.url, (texture) => {
        material.map = texture
        material.needsUpdate = true
        dirty = true
      })
      const mesh = new Mesh(geometry, material)
      mesh.raycast = () => {}
      // 물리존 판도 반투명이라 먼저 그리면 판이 덮는다. 판 뒤에 그려 그 위에 비치게 한다. 설비는 깊이로 가려진다.
      mesh.renderOrder = 1
      backdrop.add(mesh)
    },

    topView() {
      const box = visibleBox()
      // 바로 위는 OrbitControls 가 위쪽 방향을 잃는다. +z(IFC −y) 쪽으로 아주 조금 기울여 화면 위쪽이 IFC +y 가 되게 한다.
      if (!box.isEmpty()) fit(box, true, new Vector3(0, 1, 0.02))
    },

    viewFrom(dir) {
      const box = visibleBox()
      if (box.isEmpty()) return
      const from = new Vector3(...dir)
      if (from.lengthSq() === 0) return
      // 바로 위·아래는 위쪽 방향을 잃는다(topView 와 같다). 앞(+z) 쪽으로 아주 조금 기울인다.
      if (!from.x && !from.z) from.z = 0.02
      fit(box, true, from)
    },

    attachNavCube(el) {
      navCube?.dispose()
      const cube = createNavCube(el, {
        pick: (dir) => this.viewFrom(dir),
        orbit: orbitBy,
        dark: () => document.documentElement.getAttribute('data-theme') === 'dark',
      })
      navCube = cube
      dirty = true
      return () => {
        cube.dispose()
        if (navCube === cube) navCube = null
      }
    },

    setFly(on) {
      if (on === !!flying) return
      if (on) {
        flight = null
        // 빠르기는 보이는 것 크기에 맞춘다 — 성수와 집 한 채가 같은 m/s 면 한쪽은 기어가고 한쪽은 튄다. 휠로 바꾼다.
        const radius = visibleBox().getBoundingSphere(new Sphere()).radius
        flying = { keys: new Set(), base: Math.max(1, radius * 0.25), scale: 1, last: null, look: null }
        controls.mouseButtons = { LEFT: -1 as MOUSE, MIDDLE: -1 as MOUSE, RIGHT: -1 as MOUSE }
        controls.enableZoom = false
        canvas.style.cursor = 'crosshair'
      } else {
        flying = null
        controls.mouseButtons = { ...MAP_BUTTONS }
        controls.enableZoom = true
        canvas.style.cursor = ''
      }
      dirty = true
    },

    flyKey(code, down) {
      if (!flying) return
      if (code === null) flying.keys.clear()
      else if (down) flying.keys.add(code)
      else flying.keys.delete(code)
    },
    eyeHeight: () => camera.position.y,
    flyToHeight(z) {
      const shift = new Vector3(0, z - camera.position.y, 0)
      if (Math.abs(shift.y) < 1e-3) return
      fly(controls.target.clone().add(shift), camera.position.clone().add(shift), { near: camera.near, far: camera.far })
      // 위아래로만 옮기니 포물선(lift) 없이 곧게 간다.
      if (flight) Object.assign(flight, { lift: 0, ms: 400 })
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

    setVerticalParts(model, selected, preview = []) {
      verticals.traverse((o) => {
        if (o instanceof Line || o instanceof Mesh) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      verticals.clear()
      verticalTargets = []
      selectedVertical = selected
      for (const storey of model?.storeys ?? []) {
        const y = storey.elevation + VERTICAL_LIFT
        for (const part of storey.verticalParts ?? []) {
          const id = partId(part.parentId, storey.id)
          const on = selected.has(id)
          const color = on ? ARCH_COLORS.selected : VERTICAL_COLOR
          const add = (o: Object3D, mark?: 'entry' | 'exit') => {
            o.userData.storeyId = storey.id
            if (mark) o.userData.mark = mark
            verticals.add(o)
          }
          const ring = part.footprint
          if (ring.length >= 3) {
            add(new LineLoop(new BufferGeometry().setFromPoints(ring.map((p) => new Vector3(p[0], y, -p[1]))), new LineBasicMaterial({ color })))
            const face = new Mesh(
              new ShapeGeometry(new Shape(ring.map((p) => new Vector2(p[0], p[1])))),
              new MeshBasicMaterial({ color, transparent: true, opacity: on ? 0.4 : 0.32, side: DoubleSide, depthWrite: false }),
            )
            face.rotation.x = -Math.PI / 2
            face.position.y = y
            add(face)
          }
          // 진입 지점은 채운 원, 종료 지점은 빈 고리. 층 바닥 높이에 눕힌다(지점의 z 는 패널이 말한다).
          for (const [mark, p] of [['entry', part.entry], ['exit', part.exit]] as const) {
            if (!p) continue
            const geometry = mark === 'entry' ? new CircleGeometry(0.3, 24) : new RingGeometry(0.22, 0.34, 24)
            const dot = new Mesh(geometry, new MeshBasicMaterial({ color, side: DoubleSide, depthTest: false }))
            dot.rotation.x = -Math.PI / 2
            dot.position.set(p[0], y + 0.01, -p[1])
            dot.renderOrder = 3
            add(dot, mark)
          }
          // 누르는 자리: 형상이 있으면 형상, 없으면(끝 층) 종료 지점 둘레의 작은 정사각형.
          const point = part.exit ?? part.entry
          const r = VERTICAL_POINT_REACH
          const target: Vec2[] | null =
            ring.length >= 3 ? ring : point ? [[point[0] - r, point[1] - r], [point[0] + r, point[1] - r], [point[0] + r, point[1] + r], [point[0] - r, point[1] + r]] : null
          if (!target) continue
          const at: Vec2 = ring.length >= 3 ? [ring.reduce((a, q) => a + q[0], 0) / ring.length, ring.reduce((a, q) => a + q[1], 0) / ring.length] : [point![0], point![1]]
          verticalTargets.push({ id, storeyId: storey.id, y, ring: target, at })
        }
      }
      // 같은 오브젝트의 시작 층 진입 지점과 끝 층 종료 지점을 잇는 점선(실제 높이). 여러 층을 함께 볼 때 두 층의 조각이 한 오브젝트로 읽힌다
      // (다중층 뷰, OE-ML-01). 고르기 대상은 아니다.
      const ends = new Map<string, { entry?: { p: Vec3; storey: string; id: string }; exit?: { p: Vec3; storey: string; id: string } }>()
      for (const storey of model?.storeys ?? []) {
        for (const part of storey.verticalParts ?? []) {
          const e = ends.get(part.parentId) ?? {}
          const id = partId(part.parentId, storey.id)
          if (part.entry) e.entry = { p: part.entry, storey: storey.id, id }
          if (part.exit) e.exit = { p: part.exit, storey: storey.id, id }
          ends.set(part.parentId, e)
        }
      }
      // 적용 전 미리보기(OE-ML-08). 고르기 대상이 아니다.
      for (const p of preview) {
        if (p.path) {
          const line = new Line(new BufferGeometry().setFromPoints(p.path.map((q) => new Vector3(q[0], q[2], -q[1]))), new LineDashedMaterial({ color: ARCH_COLORS.selected, dashSize: 0.25, gapSize: 0.15, depthTest: false }))
          line.computeLineDistances()
          line.renderOrder = 4
          line.userData.storeyId = p.storeyId
          line.userData.mark = 'preview'
          verticals.add(line)
          continue
        }
        const y = p.elevation + VERTICAL_LIFT + 0.02
        const r = 0.35
        const pts: readonly Vec2[] | null =
          p.footprint && p.footprint.length >= 3
            ? p.footprint
            : p.point
              ? [[p.point[0] - r, p.point[1] - r], [p.point[0] + r, p.point[1] - r], [p.point[0] + r, p.point[1] + r], [p.point[0] - r, p.point[1] + r]]
              : null
        if (!pts) continue
        const line = new LineLoop(new BufferGeometry().setFromPoints(pts.map((q) => new Vector3(q[0], y, -q[1]))), new LineDashedMaterial({ color: p.warn ? PREVIEW_WARN : p.tone === 'candidate' ? PREVIEW_CANDIDATE : p.tone === 'ok' ? PREVIEW_OK : p.tone === 'cut' ? PREVIEW_CUT : p.tone === 'draft' ? PREVIEW_DRAFT : ARCH_COLORS.selected, dashSize: 0.25, gapSize: 0.15, depthTest: false }))
        line.computeLineDistances()
        line.renderOrder = 4
        line.userData.storeyId = p.storeyId
        line.userData.mark = 'preview'
        verticals.add(line)
      }
      for (const { entry, exit } of ends.values()) {
        if (!entry || !exit || entry.storey === exit.storey) continue
        const on = selected.has(entry.id) || selected.has(exit.id)
        const line = new Line(
          new BufferGeometry().setFromPoints([new Vector3(entry.p[0], entry.p[2], -entry.p[1]), new Vector3(exit.p[0], exit.p[2], -exit.p[1])]),
          new LineDashedMaterial({ color: on ? ARCH_COLORS.selected : VERTICAL_COLOR, dashSize: 0.3, gapSize: 0.2, depthTest: false }),
        )
        line.computeLineDistances()
        line.renderOrder = 3
        line.userData.storeys = [entry.storey, exit.storey]
        line.userData.mark = 'rise'
        verticals.add(line)
      }
      applyStoreyVisibility()
    },

    setSpaceObjects(model, library, models, selected, conflict = null) {
      const newConflict = !!conflict && conflict !== objectConflictId
      objectConflictId = conflict
      if (drag?.kind === 'object') {
        // 끄는 중에 다시 그리면 잡은 것을 잃는다. 놓으면 다시 불린다. 막은 상대는 지금 짚는다.
        refreshConflict()
        return
      }
      // 편집으로 지운 오브젝트는 묶음을 떼어 가라앉힌다(지울 때 가라앉기). 아래에서 버리는 묶음에 넣지 않는다.
      if (prevObjectIds) {
        const ids = new Set((model?.storeys ?? []).flatMap((st) => (st.spaceObjects ?? []).map((o) => o.id)))
        const gone = spaceObjects.children.filter((n) => !ids.has(n.userData.objectId as string) && n.visible)
        if (canDrop(gone.length)) {
          for (const node of gone) {
            spaceObjects.remove(node)
            const t = objectTargets.find((x) => x.id === node.userData.objectId)
            startExit(node, t ? t.box.max.y - t.box.min.y : 1)
          }
        }
      }
      spaceObjects.traverse((o) => {
        if (o instanceof Mesh || o instanceof LineSegments) {
          // 흐리게 칠한 재질은 언제나 이 오브젝트 몫이다. 원래 재질은 넣은 모델과 나눠 쓰면 남긴다.
          const base = o.userData.baseMaterial as Material | Material[] | undefined
          if (base) for (const m of [o.material].flat()) m.dispose()
          if (!o.userData.shared) o.geometry.dispose()
          if (!o.userData.shared) for (const m of [base ?? o.material].flat()) m.dispose()
        }
      })
      spaceObjects.clear()
      objectTargets = []
      selectedObject = selected
      const seenObjects = prevObjectIds
      prevObjectIds = new Set()
      const dropped: { node: Object3D; size: number }[] = []
      for (const storey of model?.storeys ?? []) {
        for (const o of storey.spaceObjects ?? []) {
          const [w, d, h] = o.size
          const node = new Group()
          // BIM 에서 받은 상부장·지하 지형처럼 바닥에 서지 않는 것은 `base` 만큼 띄운다.
          node.position.set(o.at[0], storey.elevation + (o.base ?? 0), -o.at[1])
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
              const context = CONTEXT_ITEMS.has(o.item)
              const mesh = new Mesh(g, new MeshLambertMaterial({ color: tint ?? (item ? OBJECT_COLORS[p.material] : OBJECT_FALLBACK), ...(context ? { transparent: true, opacity: 0.28, depthWrite: false } : {}) }))
              mesh.position.set(((x0 + x1) / 2 - 0.5) * w, ((z0 + z1) / 2) * h, -((y0 + y1) / 2 - 0.5) * d)
              if (!context) addEdges(mesh)
              node.add(mesh)
            }
          }
          // 고른 것은 외곽선(refreshOutline)이, 막은 상대는 붉은 외곽선(refreshConflict)이 두른다.
          node.userData.objectId = o.id
          spaceObjects.add(node)
          prevObjectIds.add(o.id)
          if (seenObjects && !seenObjects.has(o.id)) dropped.push({ node, size: Math.max(w, d, h) })
          // 주변 모델(object-names.ts 의 CONTEXT_ITEMS)은 눌러도 고르지 않는다 — 바닥·설비를 가린다.
          if (CONTEXT_ITEMS.has(o.item)) continue
          const z0 = storey.elevation + (o.base ?? 0)
          const box = new Box3(new Vector3(o.at[0] - w / 2, z0, -o.at[1] - d / 2), new Vector3(o.at[0] + w / 2, z0 + h, -o.at[1] + d / 2))
          objectTargets.push({ id: o.id, storeyId: storey.id, box, node })
        }
      }
      if (objectsFaded || focusSpaceId) fadeObjects()
      if (canDrop(dropped.length)) {
        for (const { node, size } of dropped) {
          objectDrops.set(node.userData.objectId as string, { y: node.position.y, size, t0: null })
          started.drops++
          const pose = dropPose(0, size)
          node.scale.setScalar(pose.scale)
          node.position.y += pose.lift
        }
      }
      // 오브젝트 묶음을 새로 만들었으니 미리 강조·막은 상대의 외곽선도 새 묶음에 다시 건다. 새로 막혔으면 상대가 한 번 흔들린다.
      if (hoverMarkKey.startsWith('object:')) setHoverOutline({ kind: 'object', id: hoverMarkKey.slice('object:'.length) })
      refreshConflict()
      if (newConflict && conflict) startShake({ kind: 'object', id: conflict })
      // 끝나지 않은 움직임은 새 묶음에서 이어 간다(stepDrops). 원래 높이는 새 묶음의 것이 맞다.
      for (const [id, d] of objectDrops) {
        const node = spaceObjects.children.find((n) => n.userData.objectId === id)
        if (node && !dropped.some((x) => x.node === node)) d.y = node.position.y
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
      selectionOutline.setDark(on)
      hoverOutline.setDark(on)
      conflictOutline.setDark(on)
      ground.setDark(on)
      const lines: LineSegments[] = []
      scene.traverse((o) => {
        if (o instanceof LineSegments && o.userData.edges) lines.push(o)
      })
      setEdgeTheme(on, lines)
      drawHandles()
      drawArrows()
      if (lastArch.model) buildArchitecture(lastArch.model, lastArch.selected, lastArch.also)
    },

    stats() {
      return { fps: perf.frames.length, renderMs: perf.renderMs, calls: perf.calls, triangles: perf.triangles }
    },

    frameAll() {
      // 보이는 것만. 한 층만 보는 중이면 그 층에 맞춘다.
      const box = new Box3()
      for (const part of parts) if (!hiddenIds.has(part.id)) box.union(part.box)
      for (const o of slabs.children) if (o.visible) box.expandByObject(o)
      if (box.isEmpty()) box.setFromObject(content)
      // 밤 다이오라마로 층을 띄우면(여러 층이 보일 때) 건물이 그만큼 높아진다.
      if (!box.isEmpty()) box.max.y += fx.fitHeight()
      if (!box.isEmpty()) fit(box, true, undefined, false)
    },

    setPlaceMode(elevation) {
      placeElevation = elevation
      canvas.style.cursor = elevation === null ? '' : 'crosshair'
      // 놓기를 마치거나 그만두면 미리보기도 걷는다(놓은 뒤 화면이 따로 부르지 않아도 된다).
      if (elevation === null && (placeGhost.visible || ghostBlocked)) api.setPlaceGhost(null)
    },

    onPlace(handler) {
      placeHandler = handler
    },

    setPlaceGhost(g) {
      const blocked = g?.blocked ?? null
      if (!g) {
        placeGhost.visible = false
        ghostKey = ''
      } else {
        const shapePart = g.shape ? partById.get(g.shape.id) : undefined
        ghostShape = shapePart ? shapePart.id : null
        const key = JSON.stringify([g.size, g.item?.key ?? null, shapePart ? g.shape : null, !!blocked, dark])
        if (key !== ghostKey) {
          ghostKey = key
          placeGhost.traverse((o) => {
            if (o instanceof Mesh || o instanceof LineSegments) {
              o.geometry.dispose()
              ;(o.material as Material).dispose()
            }
          })
          placeGhost.clear()
          const [w, d, h] = g.size
          const red = dark ? CONFLICT_STYLE.colors.dark : CONFLICT_STYLE.colors.light
          const accent = dark ? SELECTED_STYLE.colors.dark : SELECTED_STYLE.colors.light
          if (shapePart && g.shape) {
            // 빌려 올 설비의 형상을 그 설비 좌표 기준으로 떼어 온다. 놓으면 3D 가 이 형상을 새 좌표로 옮겨 그린다(shiftMesh 와 같다).
            const o = toScene(g.shape.origin)
            const arr = shapePart.chunk.position.array as Float32Array
            const positions = arr.slice(shapePart.vStart * 3, (shapePart.vStart + shapePart.vCount) * 3)
            for (let i = 0; i < positions.length; i += 3) {
              positions[i] -= o[0]
              positions[i + 1] -= o[1]
              positions[i + 2] -= o[2]
            }
            const index = shapePart.chunk.index.slice(shapePart.iStart, shapePart.iStart + shapePart.iCount)
            for (let i = 0; i < index.length; i++) index[i] -= shapePart.vStart
            const geometry = new BufferGeometry()
            geometry.setAttribute('position', new BufferAttribute(positions, 3))
            geometry.setIndex(new BufferAttribute(index, 1))
            geometry.computeVertexNormals()
            const mesh = new Mesh(geometry, new MeshLambertMaterial({ color: blocked ? red : accent, transparent: true, opacity: GHOST_OPACITY, depthWrite: false, side: DoubleSide }))
            const lines = new LineSegments(new EdgesGeometry(geometry, 30), new LineBasicMaterial({ color: blocked ? red : accent, transparent: true, opacity: 0.9, depthTest: false }))
            lines.renderOrder = 12
            mesh.add(lines)
            placeGhost.add(mesh)
          }
          const pieces = shapePart ? [] : (g.item?.parts ?? [{ box: [0, 0, 0, 1, 1, 1] as const, material: null }])
          for (const p of pieces) {
            const [x0, y0, z0, x1, y1, z1] = p.box
            const geometry = new BoxGeometry((x1 - x0) * w, (z1 - z0) * h, (y1 - y0) * d)
            const color = blocked ? red : p.material ? OBJECT_COLORS[p.material] : accent
            const mesh = new Mesh(geometry, new MeshLambertMaterial({ color, transparent: true, opacity: GHOST_OPACITY, depthWrite: false }))
            mesh.position.set(((x0 + x1) / 2 - 0.5) * w, ((z0 + z1) / 2) * h, -((y0 + y1) / 2 - 0.5) * d)
            const lines = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: blocked ? red : accent, transparent: true, opacity: 0.9, depthTest: false }))
            lines.renderOrder = 12
            mesh.add(lines)
            placeGhost.add(mesh)
          }
        }
        // 상자·오브젝트는 바닥 가운데가, 빌린 형상은 새 설비의 좌표가 이 자리다.
        placeGhost.position.set(g.at[0], toScene([0, 0, g.elevation])[1], -g.at[1])
        placeGhost.visible = true
      }
      const was = ghostBlocked ? `${ghostBlocked.kind}:${ghostBlocked.id}` : ''
      ghostBlocked = blocked
      if ((blocked ? `${blocked.kind}:${blocked.id}` : '') !== was) refreshConflict()
      dirty = true
    },

    onPlaceHover(handler) {
      placeHoverHandler = handler
    },

    setSnapMarker(marker) {
      for (const o of snapGroup.children) {
        const obj = o as Mesh | Line
        obj.geometry.dispose()
        ;(obj.material as MeshBasicMaterial | LineBasicMaterial).dispose()
      }
      snapGroup.clear()
      snapState = marker ? { at: marker.at, kind: marker.kind } : null
      dirty = true
      if (!marker) return
      // 그리드(0.115)보다 조금 위에, 깊이를 무시하고 그려 바닥판·벽에 묻히지 않게 한다.
      const y = marker.elevation + 0.13
      const color = marker.kind === 'grid' ? 0x8a93a3 : 0xf59e0b
      const ring = new Mesh(new RingGeometry(marker.kind === 'vertex' ? 0.12 : 0.08, marker.kind === 'vertex' ? 0.2 : 0.14, 24), new MeshBasicMaterial({ color, depthTest: false, transparent: true, side: DoubleSide }))
      ring.rotation.x = -Math.PI / 2
      ring.position.set(marker.at[0], y, -marker.at[1])
      ring.raycast = () => {}
      ring.renderOrder = 10
      snapGroup.add(ring)
      if (marker.edge) {
        const [a, b] = marker.edge
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(new Float32Array([a[0], y, -a[1], b[0], y, -b[1]]), 3))
        const line = new Line(g, new LineBasicMaterial({ color, depthTest: false, transparent: true }))
        line.raycast = () => {}
        line.renderOrder = 10
        snapGroup.add(line)
      }
    },

    setDragSnap(snap) {
      dragSnap = snap
    },

    onView(handler) {
      viewHandler = handler
      if (handler) invalidate()
    },

    setStoreyFilter(storeys, hidden) {
      // 화면은 모델이 바뀔 때마다(편집·되돌리기마다) 이것을 다시 부른다. 보일 층과 숨길 설비가 그대로면 삼각형 목록을 다시 짜지
      // 않는다 — 덩어리 전부의 인덱스를 새로 올려서 성수에서 편집·되돌리기마다 화면이 0.2초씩 멈췄다. 새 형상(setModel)은
      // 거기서 따로 짠다.
      const same = sameSet(visibleStoreys, storeys) && sameSet(hiddenIds, hidden)
      visibleStoreys = storeys
      hiddenIds = hidden
      applyStoreyVisibility()
      if (same) return
      splitIndex()
      drawArrows()
      if (hoverAt) hoverPending = true
    },

    frameSpace(id, steep) {
      const target = spaceTargets.find((t) => t.id === id)
      if (!target || target.ring.length < 3) return
      const box = new Box3()
      for (const [x, y] of target.ring) box.expandByPoint(new Vector3(...toScene([x, y, 0])).setY(target.y))
      // 판만 맞추면 위에서 내려다보는 납작한 상자라 너무 가까이 간다. 층 높이쯤 띄운다.
      box.expandByPoint(box.max.clone().setY(target.y + 3))
      if (!steep) return fit(box)
      // 지금 보는 방위는 두고 60° 쯤 내려다본다. 옆에서 보면 방을 두른 벽이 방 안을 가린다.
      const from = camera.position.clone().sub(controls.target).setY(0)
      if (from.lengthSq() < 1e-9) from.set(1, 0, 1)
      fit(box, true, from.normalize().setY(1.7))
    },

    setSpaceFocus(id) {
      if (focusSpaceId === id) return
      focusSpaceId = id
      applySpaceFocus()
    },

    screenOf(ids) {
      const rect = canvas.getBoundingClientRect()
      const c = new Vector3()
      return ids.map((id) => {
        const part = partById.get(id)
        if (!part || hiddenIds.has(id)) return null
        const at = toScreen(part.box.getCenter(c))
        if (!at || at.x < rect.left || at.x > rect.right || at.y < rect.top || at.y > rect.bottom) return null
        return at
      })
    },

    viewVersion: () => renders,

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
      window.removeEventListener('pointerup', onFlyUp)
      canvas.removeEventListener('pointerdown', onFlyDown)
      canvas.removeEventListener('pointermove', onFlyMove)
      canvas.removeEventListener('wheel', onFlyWheel)
      navCube?.dispose()
      clearOutlineMasks()
      selectionOutline.dispose()
      clearHoverOutline()
      hoverOutline.dispose()
      clearOutlineSet(conflictSet)
      conflictOutline.dispose()
      ground.dispose()
      outlineMaskMaterial.dispose()
      rotateLabel?.remove()
      clearCascade()
      CASCADE_CONE.dispose()
      if (import.meta.env.MODE === 'e2e') delete (window as unknown as { __viewer?: unknown }).__viewer
      controls.removeEventListener('change', invalidate)
      controls.dispose()
      disposeContent()
      renderer.dispose()
    },
  }
  return api
}
