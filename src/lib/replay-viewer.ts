// 편집 리플레이(PoC)의 3D 연출. viewer.ts 의 createViewer 가 이것을 한 번 만들고(createReplayFx), 자기 안의 것(장면·카메라·
// 설비 형상 표…)을 ReplayHost 로 빌려준다. 리플레이 연출은 전부 여기 있고, viewer.ts 에는 "여기서 리플레이를 부른다" 는
// 꽂는 자리만 남는다 — `fx.` 로 찾으면 다 나온다. main 으로 옮길 때 이 파일은 그대로 가져가고, viewer.ts 는 그 꽂는 자리만 맞춘다.
//
// 연출: 카메라 호 비행·느린 회전(setCinema), 고친 자리의 빛기둥·울타리·궤적·충격파(spotlight), 오프닝의 층 쌓기(buildUp),
// 새로 생긴 것이 솟아오르기(revealElements), 밤 다이오라마(setDiorama·nightFall), 단면 자르기(sectionTo), 흐름 알갱이(setFlows),
// 방 표시(setRoomTags).

import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Raycaster,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Ray,
  type Texture,
} from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Model, Vec2, Vec3 } from './model'
import { distanceToRing } from './mapping'
import { labelPoint } from './polygon'
import { easeOut, still } from './motion'
import type { Chunk, Part } from './viewer'

/**
 * 설비가 아닌 것을 비출 때(편집 리플레이). 문·창은 자리(IFC 좌표, z 는 층 바닥)에 빛기둥을, `from` 이 있으면 거기서 미끄러져
 * 와 궤적·충격파를 남긴다. 벽은 외곽선 둘레에 빛 울타리를 세운다.
 */
export type SpotlightExtra = {
  /** bare: 빛기둥 없이 바닥 물결과 이름표만 — 그 자리에서 새로 생기는 것(revealElements)을 기둥이 가리지 않게. */
  points?: readonly { key: string; at: Vec3; from?: Vec3; label?: string; bare?: boolean }[]
  rings?: readonly { key: string; ring: readonly Vec2[]; elevation: number }[]
}


/** 리플레이가 뷰어에 더하는 것. viewer.ts 의 Viewer 가 이것을 이어 붙인다. */
export type ReplayViewerApi = {
  /**
   * 편집 리플레이의 연출. 켜면 카메라가 호를 그리며 길게 날고 선 자리에서 느리게 돌며, 설비는 길게 미끄러진다. 끄면 걷는다.
   * 움직임을 끈 사람에게는 도는 것도, spotlight 도 없다.
   */
  setCinema(on: boolean): void
  /** 리플레이(setCinema)에서 선 자리를 느리게 도는 것을 켜고 끈다. 장면 반복 중에는 꺼서 사람이 잡은 시점을 두게 한다. */
  setAutoRotate(on: boolean): void
  /**
   * 리플레이 오프닝. 건물이 바닥에서부터 한쪽 모서리에서 물결처럼 솟아오른다 — 솟는 앞머리에 밝은 선이 지나가고, 막 솟은 곳은
   * 회색 종이처럼 보이다가 앞머리가 지나가면 제 색이 칠해진다. 움직임을 끈 사람에게는 아무것도 하지 않는다.
   */
  buildUp(ms?: number): void
  /**
   * 리플레이에서 새로 생긴 것(벽·문·창·설비·공간 오브젝트의 id). 납작한 2D 발자국에서 위로 자라며 3D 형체를 드러낸다. 아직
   * 그려지지 않은 id 는 잠깐 기다렸다가 그려지면 시작한다.
   */
  revealElements(ids: readonly string[]): void
  /**
   * 편집 리플레이 전용 밤 다이오라마. 켜면 조명을 밤으로 낮추고 방마다 바닥에 따뜻한 빛 웅덩이를 깔며, 건물 전체를 볼 때(여러 층이
   * 보일 때)는 층 사이를 띄워 각 층 안이 들여다보이게 한다. 한 층만 볼 때는 붙는다. 끄면 평소 모습으로 돌아간다.
   */
  setDiorama(on: boolean): void
  /** 밤 다이오라마에서 해가 지게 한다: delay 뒤 0.9초에 걸쳐 조명이 밤으로 바뀌고 방 불이 아래층부터 켜진다. 부르지 않으면 바로 밤이다. */
  nightFall(delayMs: number): void
  /**
   * 단면 자르기. 수평으로 자르는 면(옅은 판과 밝은 테두리)이 건물 위에서 그 층 바로 위까지 내려와 위층을 걷어낸다(1초). 끝나면 자른 채로 둔다 —
   * 부르는 쪽이 층을 바꾼 뒤 clearSection 으로 푼다. 움직임을 끈 사람에게는 바로 끝난다.
   */
  sectionTo(storeyId: string): Promise<void>
  clearSection(): void
  /** 흐르는 빛 알갱이. 연결마다 from 에서 다른 끝으로 몇 개가 흐른다(리플레이의 흐름 장면). 빈 목록이면 지운다. */
  setFlows(flows: readonly { a: string; b: string; from: string }[]): void
  /**
   * 방마다 작은 표시(이름 · 면적 · 종류). at 은 모델 좌표(바닥 높이). hot 은 장면에서 바뀐 방이라 강조한다. 빈 목록이면 지운다.
   * 밤 다이오라마의 층 띄우기를 따라 움직인다.
   */
  setRoomTags(tags: readonly { id: string; storeyId: string; at: Vec3; title: string; sub: string; hot: boolean }[]): void
  /** 리플레이에서 비춘 빛기둥·이름표를 눌렀다. 설비면 그 id, 자리(문·창 등)면 spotlight 의 points 의 key 다. */
  onSpotClick(handler: ((key: string) => void) | null): void
  /**
   * 리플레이에서 고친 자리를 비춘다: 설비에는 빛기둥·물결·이름표, 물리존에는 빛 울타리. 비춘 설비가 미끄러지면 떠난 자리·궤적·
   * 충격파가 남는다. 부를 때마다 앞의 것은 옅어지며 사라진다. 둘 다 비면 걷기만 한다.
   */
  spotlight(equipment: readonly { id: string; label?: string }[], spaces: readonly string[], color: number, extra?: SpotlightExtra): void
  /**
   * 지워지는 것을 비춘다(4D 시뮬레이션의 "철거"). 붉은 상자·윤곽이 번쩍였다가 바닥으로 가라앉으며 옅어지고, 밑동에 붉은
   * 충격파가 퍼진다. 설비는 id(지우기 전에 불러야 상자를 잰다), 벽·물리존은 외곽선과 높이, 문·창은 자리. 움직임을 끈 사람에게는 없다.
   */
  demolish(items: readonly { key: string; id?: string; ring?: readonly Vec2[]; elevation?: number; height?: number; at?: Vec3 }[]): void
  /**
   * 변경 지도: 더한 것(파랑)·고친 것(주황)·지운 것(빨강)을 덧그린다. 설비는 id(3D 의 형상 상자), 벽·물리존은 외곽선과 높이,
   * 지운 설비·문·창은 자리(at)와 상자 크기. null 이면 걷는다. 움직이지 않는다.
   */
  setDiffMap(
    items: readonly { key: string; state: 'added' | 'modified' | 'removed'; id?: string; ring?: readonly Vec2[]; elevation?: number; height?: number; at?: Vec3; size?: number; tall?: number }[] | null,
  ): void
  /** IFC 좌표의 점들(벽 외곽선·문·창 자리)이 화면에 들어오게 한다. margin(미터)만큼 둘레를 더 보인다. */
  framePoints(points: readonly Vec3[], margin?: number): void
}

/**
 * createViewer 가 빌려주는 것. 다시 만들어지는 것(설비 형상 표·물리존 목록 등)은 늘 지금 것을 읽게 함수로 받는다.
 */
export type ReplayHost = {
  scene: Scene
  camera: PerspectiveCamera
  controls: OrbitControls
  renderer: WebGLRenderer
  hemi: HemisphereLight
  sun: DirectionalLight
  raycaster: Raycaster
  /** 연출 메시(빛기둥·울타리·궤적)를 거는 곳. 모델과 따로 둔다. */
  overlay: Group
  arch: Group
  rooms: Group
  customZones: Group
  spaceObjects: Group
  content: () => Group
  chunks: () => readonly Chunk[]
  partById: () => ReadonlyMap<string, Part>
  objectTargets: () => readonly { id: string; node: Object3D }[]
  spaceTargets: () => readonly { id: string; storeyId: string; y: number; ring: readonly Vec2[] }[]
  archTargets: () => readonly { id: string }[]
  hiddenIds: () => ReadonlySet<string>
  visibleStoreys: () => ReadonlySet<string> | null
  storeyShown: (o: { userData: { storeyId?: string } }) => boolean
  invalidate: () => void
  writePart: (part: Part, positions: Float32Array) => void
  paintPart: (part: Part, hex: number) => void
  toScene: (p: readonly [number, number, number]) => [number, number, number]
  rayAt: (x: number, y: number) => Ray
  toScreen: (p: Vector3) => { x: number; y: number } | null
  fit: (box: Box3) => void
  /** 지금(날아가는 중이면 도착할 자리의) 카메라와 바라보는 점 사이 거리. */
  viewDistance: () => number
  /** 벽·문·창 외곽선 층을 마지막에 그린 그대로 다시 그린다(새로 생긴 벽을 따로 그리게). */
  rebuildArchitecture: () => void
}

export type ReplayFx = ReturnType<typeof createReplayFx>

export function createReplayFx(host: ReplayHost) {
  const tint = new Color()

  // --- 리플레이: 새로 생긴 것이 납작한 2D 발자국에서 3D 형체를 드러낸다(revealElements) ---
  // 벽·문·창, 설비, 공간 오브젝트가 대상이다. 처음 30% 는 바닥에 눌린 납작한 발자국이 비쳐 들고, 나머지에 위로 자라 제 높이를
  // 살짝 넘쳤다 앉는다. 자라는 동안 밝게 빛나다 제 색으로 돌아온다. 편집 뒤 장면을 다시 그려도(setArchitecture·setModel)
  // 시작 시각으로 이어서 움직인다 — 매 프레임 id 로 지금 그려진 것을 다시 찾는다.
  //  - 벽·문·창은 합치지 않고 따로 그린 메시의 높이(scale.y)를 키운다.
  //  - 설비는 합친 형상 안의 부분이라 꼭짓점을 바닥 높이 쪽으로 눌렀다 편다(미끄러짐과 같은 writePart).
  //  - 공간 오브젝트는 바닥이 원점인 묶음(node)의 높이를 키운다.
  const REVEAL_MS = 1500
  /** 아직 그려지지 않은 것(편집 뒤 다시 그리기 전)을 기다리는 시간. 넘으면 버린다. */
  const REVEAL_WAIT_MS = 1500
  const REVEAL_GLOW = new Color(0xd4ff3a)
  const revealing = new Map<string, { t0: number | null; asked: number }>()
  /** 설비 부분의 다 자란 꼭짓점. 다시 그려 부분이 바뀌면 새로 뜬다. */
  const revealFull = new Map<string, { part: Part; full: Float32Array; base: number }>()
  /** 요소 하나를 따로 그린다. 형상은 바닥 가운데가 원점이 되게 옮기고 그 자리에 둔다(키를 바닥에서 키우려고). */
  function revealMesh(id: string, pieces: BufferGeometry[], color: number): Mesh | null {
    const merged = mergeGeometries(pieces)
    for (const g of pieces) g.dispose()
    if (!merged) return null
    merged.computeBoundingBox()
    const b = merged.boundingBox!
    const base = new Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2)
    merged.translate(-base.x, -base.y, -base.z)
    const mesh = new Mesh(merged, new MeshLambertMaterial({ color, side: DoubleSide, transparent: true, emissive: 0xd4ff3a, emissiveIntensity: 0 }))
    mesh.position.copy(base)
    mesh.userData.reveal = id
    mesh.scale.set(1, 0.02, 1)
    return mesh
  }
  /** k(0..1) → 높이 비율. 앞 30% 는 납작하게, 뒤 70% 에 넘쳤다 앉으며 자란다. */
  const revealHeight = (k: number) => {
    const g = Math.max(0, (k - 0.3) / 0.7)
    const q = g - 1
    return g === 0 ? 0.02 : Math.max(0.02, 1 + 3.4 * q * q * q + 2.4 * q * q)
  }
  const revealGlow = (k: number) => Math.sin(Math.PI * Math.min(1, k * 1.1))
  function stepReveal(now: number) {
    if (!revealing.size) return
    for (const [id, r] of revealing) {
      const mesh = host.arch.children.find((o) => o.userData.reveal === id) as Mesh | undefined
      const part = host.partById().get(id)
      const node = host.objectTargets().find((t) => t.id === id)?.node
      if (!mesh && !part && !node) {
        if (now - r.asked > REVEAL_WAIT_MS) revealing.delete(id)
        continue
      }
      if (r.t0 === null) r.t0 = now
      const k = Math.min(1, (now - r.t0) / REVEAL_MS)
      const h = k >= 1 ? 1 : revealHeight(k)
      if (mesh) {
        const m = mesh.material as MeshLambertMaterial
        mesh.scale.y = h
        m.opacity = k >= 1 ? 1 : 0.35 + 0.65 * Math.min(1, k / 0.3)
        m.transparent = k < 1
        m.emissiveIntensity = k >= 1 ? 0 : 0.9 * revealGlow(k)
      }
      if (node) node.scale.y = h
      if (part) {
        let f = revealFull.get(id)
        if (!f || f.part !== part) {
          const pos = part.chunk.position.array as Float32Array
          const full = pos.slice(part.vStart * 3, (part.vStart + part.vCount) * 3)
          let base = Infinity
          for (let v = 1; v < full.length; v += 3) base = Math.min(base, full[v])
          revealFull.set(id, (f = { part, full, base }))
        }
        const out = f.full.slice()
        for (let v = 1; v < out.length; v += 3) out[v] = f.base + (out[v] - f.base) * h
        host.writePart(part, out)
        host.paintPart(part, k >= 1 ? part.color : tint.setHex(part.color).lerp(REVEAL_GLOW, 0.75 * revealGlow(k)).getHex())
      }
      if (k >= 1) {
        revealing.delete(id)
        revealFull.delete(id)
      }
    }
    host.invalidate()
  }

  // --- 리플레이 오프닝: 솟아오르기(buildUp) ---
  // 처음에는 모든 층이 맨 아래층 높이에 포개진 납작한 회색 평면도 한 장이다. 아래층부터 차례로 제 높이로 들려 올라가고(층
  // 쌓기), 자리에 닿은 층 안에서 벽·설비가 하나씩 위로 자라 오른다(살짝 넘쳤다 내려앉는다). 자라는 동안 밝게 빛나고 다 자라면
  // 제 색이 칠해진다. 층이 많은 건물(성수)에서는 층마다 몇 m 자라는 것이 건물 전체에 비해 작아 안 보여서, 층이 들리는 것이
  // 건물 단위로 보이는 움직임이다. 설비는 하나가 한 덩어리로 자라고(합친 형상의 부분마다), 벽·물리존 판처럼 층마다 합친 것은
  // 꼭짓점 자리대로 물결이 지나간다.
  // 셰이더에 끼워 넣는다 — 꼭짓점 속성 aRise(자라는 바닥 높이, 자라기 시작, 들릴 높이, 들리기 시작)만 더하고 그리기 호출·형상은
  // 그대로다. uBuild 가 0 이면 아무 일도 하지 않는다. 시각은 모두 전체 시간에 대한 비율이다.
  const BUILD_MS = 2700
  /** 카메라가 건물 전체로 날아가는 동안은 납작하게 둔다. */
  const BUILD_HOLD_MS = 300
  /** 맨 위층이 들리기 시작하는 때, 한 층이 들리는 시간. */
  const STOREY_LAG = 0.42
  const LIFT_SPAN = 0.22
  /** 층이 들리기 시작하고 그 안이 자라기 시작하기까지, 층 안의 물결(한쪽 모서리에서 먼 것일수록 늦게), 하나가 자라는 시간. */
  const GROW_AFTER = 0.12
  const XZ_LAG = 0.18
  const RISE_SPAN = 0.28
  const MAX_LEVELS = 32
  const buildUniforms = {
    uBuild: { value: 0 },
    uBuildT: { value: 1 },
    /** 밤 다이오라마의 층 띄우기(m). 층 높이(uLevels, 오름차순) 구간마다 이만큼씩 위로 민다. */
    uExplode: { value: 0 },
    uLevels: { value: new Array<number>(MAX_LEVELS).fill(1e9) },
    uLevelCount: { value: 0 },
  }
  const BUILD_VERT = `
  vec3 xBase = transformed;
  vRise = 1.0;
  vLift = 0.0;
  if (uBuild > 0.5) {
    float p = clamp((uBuildT - aRise.y) / ${RISE_SPAN.toFixed(2)}, 0.0, 1.0);
    float q = p - 1.0;
    // 넘쳤다 내려앉기(back-out). 2.4 면 키의 20% 남짓 넘친다.
    float s = 1.0 + 3.4 * q * q * q + 2.4 * q * q;
    vLift = clamp((transformed.y - aRise.x) / 1.2, 0.0, 1.0);
    transformed.y = aRise.x + (transformed.y - aRise.x) * max(s, 0.02);
    float l = clamp((uBuildT - aRise.w) / ${LIFT_SPAN.toFixed(2)}, 0.0, 1.0);
    transformed.y -= (1.0 - l * l * (3.0 - 2.0 * l)) * aRise.z;
    vRise = p;
  }`
  /** 층 띄우기. 편집 전 높이(xBase)로 어느 층인지 가른다 — 솟아오르는 동안 낮춰진 높이로 가르면 층이 뒤바뀐다. */
  const EXPLODE_VERT = `
  if (uExplode > 0.001) {
    float baseY = (modelMatrix * vec4(xBase, 1.0)).y;
    float off = 0.0;
    for (int i = 1; i < ${MAX_LEVELS}; i++) {
      if (i >= uLevelCount) break;
      if (baseY >= uLevels[i] - 0.3) off += uExplode;
    }
    vec4 bw = modelMatrix * vec4(transformed, 1.0);
    bw.y += off;
    mvPosition = viewMatrix * bw;
    gl_Position = projectionMatrix * mvPosition;
  }`
  const BUILD_FRAG = `
  if (uBuild > 0.5) {
    float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 paper = vec3(0.2 + lum * 0.7);
    gl_FragColor.rgb = mix(paper, gl_FragColor.rgb, smoothstep(0.55, 1.0, vRise));
    // 자라는 동안 빛난다. 키가 있는 것(벽·설비의 윗부분)일수록 밝고, 납작한 물리존 판·지붕은 거의 빛나지 않는다 — 큰 판이
    // 한꺼번에 형광으로 덮이면 무엇이 솟는지 안 보인다.
    float glow = smoothstep(0.05, 0.4, vRise) * (1.0 - smoothstep(0.7, 1.0, vRise));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.83, 1.0, 0.23), glow * (0.12 + 0.68 * vLift));
  }`
  const buildPatched = new WeakSet<Material>()
  function patchBuild(material: Material) {
    if (buildPatched.has(material)) return
    buildPatched.add(material)
    const before = material.onBeforeCompile
    material.onBeforeCompile = (shader, r) => {
      before.call(material, shader, r)
      Object.assign(shader.uniforms, buildUniforms)
      shader.vertexShader =
        `uniform float uBuild;\nuniform float uBuildT;\nuniform float uExplode;\nuniform float uLevels[${MAX_LEVELS}];\nuniform int uLevelCount;\nattribute vec4 aRise;\nvarying float vRise;\nvarying float vLift;\n` +
        shader.vertexShader
          .replace('#include <begin_vertex>', `#include <begin_vertex>${BUILD_VERT}`)
          .replace('#include <project_vertex>', `#include <project_vertex>${EXPLODE_VERT}`)
      shader.fragmentShader =
        'uniform float uBuild;\nvarying float vRise;\nvarying float vLift;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>${BUILD_FRAG}`)
    }
    material.needsUpdate = true
  }
  /** 층의 높이(장면 y)와 설비가 든 층. 솟아오르기가 층을 쌓는 데 쓴다(setModel 에서 채운다). */
  let storeyElevation = new Map<string, number>()
  let equipmentStorey = new Map<string, string>()
  /**
   * 형상마다 aRise 를 채운다. 층은 높이 순서(같은 높이는 한 단)로 들린다. 설비 덩어리는 부분마다(제 바닥에서 통째로), 나머지는
   * 꼭짓점마다(형상의 바닥에서, 제 자리의 늦음) 자란다. 층을 모르는 것(층 없이 그린 것)은 들리지 않고 자라기만 한다.
   */
  function riseAttributes(groups: Object3D[], corner: Vector2, reach: number) {
    const levels = [...new Set(storeyElevation.values())].sort((a, b) => a - b)
    const ground = levels[0] ?? 0
    const rank = new Map(levels.map((e, k) => [e, levels.length > 1 ? k / (levels.length - 1) : 0]))
    const timing = (storeyId: string | undefined, x: number, z: number): [number, number, number] => {
      const e = storeyId !== undefined ? storeyElevation.get(storeyId) : undefined
      const liftAt = e === undefined ? 0 : rank.get(e)! * STOREY_LAG
      const xz = Math.min(1, Math.hypot(x - corner.x, z - corner.y) / reach)
      return [liftAt + GROW_AFTER + xz * XZ_LAG, e === undefined ? 0 : e - ground, liftAt]
    }
    const done = new Set<BufferGeometry>()
    for (const chunk of host.chunks()) {
      const pos = chunk.position.array as Float32Array
      const rise = new Float32Array((pos.length / 3) * 4)
      for (const [n, part] of chunk.parts.entries()) {
        let minY = Infinity
        let cx = 0
        let cz = 0
        for (let v = part.vStart; v < part.vStart + part.vCount; v++) {
          minY = Math.min(minY, pos[v * 3 + 1])
          cx += pos[v * 3]
          cz += pos[v * 3 + 2]
        }
        const [grow, lift, liftAt] = timing(equipmentStorey.get(part.id), cx / part.vCount, cz / part.vCount)
        // 같은 자리의 것들이 한꺼번에 서지 않게 조금씩 흔든다(부분 번호로 정해져 매번 같다).
        const d = grow + ((n * 0.618) % 1) * 0.04
        for (let v = part.vStart; v < part.vStart + part.vCount; v++) rise.set([minY, d, lift, liftAt], v * 4)
      }
      const attr = new BufferAttribute(rise, 4)
      for (const m of [chunk.solid, chunk.faded]) {
        m.geometry.setAttribute('aRise', attr)
        done.add(m.geometry)
      }
    }
    for (const g of groups) {
      g.traverse((o) => {
        const geometry = (o as Mesh).geometry as BufferGeometry | undefined
        const position = geometry?.getAttribute('position')
        if (!geometry || !position || done.has(geometry)) return
        done.add(geometry)
        let storeyId: string | undefined
        for (let a: Object3D | null = o; a && storeyId === undefined; a = a.parent) storeyId = a.userData.storeyId as string | undefined
        let minY = Infinity
        for (let v = 0; v < position.count; v++) minY = Math.min(minY, position.getY(v))
        const rise = new Float32Array(position.count * 4)
        for (let v = 0; v < position.count; v++) {
          const [grow, lift, liftAt] = timing(storeyId, position.getX(v), position.getZ(v))
          rise.set([minY, grow, lift, liftAt], v * 4)
        }
        geometry.setAttribute('aRise', new BufferAttribute(rise, 4))
      })
    }
  }
  // --- 밤 다이오라마(setDiorama) ---
  // 일러스트로 그린 집 대시보드처럼: 바깥은 어둡고 방마다 따뜻한 불빛이 바닥에 고인다. 진짜 조명·그림자는 쓰지 않는다(성수에서
  // 값이 든다, ADR-0013) — 빛을 낮추고, 방마다 둥근 빛 웅덩이 판(가산 혼합)을 층마다 한 덩어리로 깐다. 여러 층이 보이면 층 사이를
  // 띄운다(셰이더의 uExplode). 빛기둥·방 표시처럼 따로 그린 것은 userData.baseY 로 같은 만큼 옮긴다.
  let diorama = false
  let explodeGap = 0
  const pools = new Group()
  host.scene.add(pools)
  const roomTags = new Group()
  host.scene.add(roomTags)
  let poolsOf: unknown = null
  /** 방 표시가 나타나기 시작하는 때. 다른 층으로 넘어가면 카메라가 닿은 뒤(CINEMA_FLY_MS)로 미룬다 — 멀리서 뜨면 한 덩어리로 뭉친다. */
  let tagsFrom = 0
  let tagsStorey: string | null = null
  /** 해 지기(nightFall). null 이면 바로 밤. 밤 정도는 0(낮)~1(밤). */
  let nightFrom: number | null = null
  const NIGHT_MS = 900
  let nightLevel = 0
  function applyNight(level: number) {
    nightLevel = level
    host.hemi.intensity = 0.9 + (0.3 - 0.9) * level
    host.sun.intensity = 1.45 + (0.55 - 1.45) * level
    host.sun.color.setRGB(1, 1 + (0xd2 / 255 - 1) * level, 1 + (0xa6 / 255 - 1) * level)
  }

  // --- 흐르는 빛 알갱이(setFlows) ---
  // 알갱이는 실제 거리로 움직인다: 초속 FLOW_SPEED m, 간격 FLOW_GAP m. 연결 길이에 비례해 세면 짧은 배관 마디(이음쇠 사이 수십 cm)
  // 에서 한 바퀴를 순식간에 돌아 알갱이가 떨었다. 끝점은 매 프레임 설비 자리에서 다시 읽는다(미끄러지는 설비를 따라간다).
  const FLOW_SPEED = 0.9
  const FLOW_GAP = 0.7
  const FLOW_MIN = 0.6
  const FLOW_MAX = 12
  let flows: { a: string; b: string }[] = []
  const flowPoints = new Points(
    new BufferGeometry(),
    new PointsMaterial({ size: 6, sizeAttenuation: false, color: 0x9ff3ff, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, blending: AdditiveBlending }),
  )
  flowPoints.renderOrder = 23
  flowPoints.frustumCulled = false
  host.scene.add(flowPoints)
  function stepFlows(now: number) {
    if (!flows.length) return
    const out: number[] = []
    const travel = (now / 1000) * FLOW_SPEED
    for (const f of flows) {
      const pa = host.partById().get(f.a)
      const pb = host.partById().get(f.b)
      if (!pa || !pb) continue
      const a = pa.box.getCenter(new Vector3())
      const b = pb.box.getCenter(new Vector3())
      const len = a.distanceTo(b)
      if (len < FLOW_MIN) continue
      const lift = explodeAt(a.y)
      for (let d = travel % FLOW_GAP; d < len; d += FLOW_GAP) {
        const t = d / len
        out.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + lift, a.z + (b.z - a.z) * t)
      }
    }
    flowPoints.geometry.setAttribute('position', new BufferAttribute(new Float32Array(out), 3))
    host.invalidate()
  }

  // --- 단면 자르기(sectionTo) ---
  let section: { from: number; to: number; t0: number | null; done: () => void } | null = null
  const sectionPlane = new Plane(new Vector3(0, -1, 0), 0)
  const SECTION_MS = 1000
  /** 자르는 면을 보이게: 그 높이에 옅은 판과 밝은 테두리. 자르는 동안만. */
  const sectionSheet = new Group()
  sectionSheet.visible = false
  host.scene.add(sectionSheet)
  function showSectionSheet(box: Box3) {
    for (const o of sectionSheet.children) {
      ;(o as Mesh).geometry.dispose()
      ;((o as Mesh).material as Material).dispose()
    }
    sectionSheet.clear()
    const c = box.getCenter(new Vector3())
    const w = (box.max.x - box.min.x) * 1.08
    const d = (box.max.z - box.min.z) * 1.08
    const fill = new Mesh(new PlaneGeometry(w, d).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
    const edge = new LineLoop(
      new BufferGeometry().setFromPoints([new Vector3(-w / 2, 0, -d / 2), new Vector3(w / 2, 0, -d / 2), new Vector3(w / 2, 0, d / 2), new Vector3(-w / 2, 0, d / 2)]),
      new LineBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.9, depthTest: false }),
    )
    sectionSheet.add(fill, edge)
    sectionSheet.position.set(c.x, 0, c.z)
    sectionSheet.renderOrder = 24
  }
  function stepSection(now: number) {
    if (!section) return
    if (section.t0 === null) section.t0 = now
    const k = Math.min(1, (now - section.t0) / SECTION_MS)
    const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2
    sectionPlane.constant = section.from + (section.to - section.from) * e
    host.renderer.clippingPlanes = [sectionPlane]
    sectionSheet.visible = true
    sectionSheet.position.y = sectionPlane.constant
    host.invalidate()
    if (k >= 1) {
      const done = section.done
      section = null
      done()
    }
  }
  let poolTexture: CanvasTexture | null = null
  function poolMap(): CanvasTexture {
    if (poolTexture) return poolTexture
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.35, 'rgba(255,255,255,0.55)')
    r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 128, 128)
    return (poolTexture = new CanvasTexture(c))
  }
  /** 방마다 빛 웅덩이: 방 안에서 벽과 먼 점에 그 거리만큼(방 범위 안으로) 둥근 판. 층마다 한 메시. */
  function buildPools() {
    for (const o of pools.children) (o as Mesh).geometry.dispose()
    pools.clear()
    const byStorey = new Map<string, number[]>()
    for (const t of host.spaceTargets()) {
      const c = labelPoint(t.ring)
      if (!c) continue
      const d = distanceToRing(c, t.ring)
      const xs = t.ring.map((p) => p[0])
      const ys = t.ring.map((p) => p[1])
      const hw = Math.min((Math.max(...xs) - Math.min(...xs)) / 2, d * 1.9 + 0.4, 9)
      const hh = Math.min((Math.max(...ys) - Math.min(...ys)) / 2, d * 1.9 + 0.4, 9)
      if (hw < 0.3 || hh < 0.3) continue
      const [x, y, z] = host.toScene([c[0], c[1], t.y + 0.03])
      // 넓은 판(지붕·로비·주차장)은 옅게 — 방 하나에 등 하나가 켜진 느낌이 나야지, 지붕 전체가 빛나면 안 된다.
      const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))
      const b = Math.max(0.18, Math.min(1, 45 / Math.max(1, area)))
      const v = byStorey.get(t.storeyId) ?? []
      // 두 삼각형(x−, z− … ). 꼭짓점마다 x y z, u v, 밝기.
      v.push(x - hw, y, z - hh, 0, 0, b, x + hw, y, z - hh, 1, 0, b, x + hw, y, z + hh, 1, 1, b, x - hw, y, z - hh, 0, 0, b, x + hw, y, z + hh, 1, 1, b, x - hw, y, z + hh, 0, 1, b)
      byStorey.set(t.storeyId, v)
    }
    for (const [storeyId, v] of byStorey) {
      const n = v.length / 6
      const pos = new Float32Array(n * 3)
      const uv = new Float32Array(n * 2)
      const col = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        pos.set(v.slice(i * 6, i * 6 + 3), i * 3)
        uv.set(v.slice(i * 6 + 3, i * 6 + 5), i * 2)
        col.fill(v[i * 6 + 5], i * 3, i * 3 + 3)
      }
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(pos, 3))
      g.setAttribute('uv', new BufferAttribute(uv, 2))
      g.setAttribute('color', new BufferAttribute(col, 3))
      const mesh = new Mesh(g, new MeshBasicMaterial({ map: poolMap(), color: 0xffa65a, vertexColors: true, transparent: true, opacity: 0.8, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }))
      mesh.userData.storeyId = storeyId
      const levels = buildUniforms.uLevels.value.slice(0, buildUniforms.uLevelCount.value)
      const e = storeyElevation.get(storeyId) ?? 0
      mesh.userData.rank = levels.length > 1 ? Math.max(0, levels.findIndex((l) => l >= e - 0.01)) / (levels.length - 1) : 0
      mesh.renderOrder = 5
      pools.add(mesh)
    }
    poolsOf = host.spaceTargets()
  }
  /** 이 높이(장면 y)에 지금 더해지는 층 띄우기. 셰이더와 같은 셈. */
  function explodeAt(y: number): number {
    const u = buildUniforms
    let off = 0
    for (let i = 1; i < u.uLevelCount.value; i++) if (y >= u.uLevels.value[i] - 0.3) off += u.uExplode.value
    return off
  }
  function stepDiorama(now: number) {
    if (!diorama && buildUniforms.uExplode.value === 0) return
    for (const g of [host.content(), host.arch, host.rooms, host.customZones, host.spaceObjects, pools]) {
      g.traverse((o) => {
        const m = (o as Mesh).material as Material | Material[] | undefined
        for (const x of Array.isArray(m) ? m : m ? [m] : []) patchBuild(x)
      })
    }
    if (diorama && poolsOf !== host.spaceTargets()) buildPools()
    // 해 지기: 조명이 밤으로, 방 불은 아래층부터(층 순서 rank 만큼 늦게) 켜진다.
    const night = !diorama ? 0 : nightFrom === null ? 1 : Math.max(0, Math.min(1, (now - nightFrom) / NIGHT_MS))
    if (night !== nightLevel) {
      applyNight(night)
      host.invalidate()
    }
    for (const o of pools.children) {
      o.visible = diorama && host.storeyShown(o)
      const on = Math.max(0, Math.min(1, (night * 1.5 - ((o.userData.rank as number) ?? 0) * 0.5) / 1))
      const m = (o as Mesh).material as MeshBasicMaterial
      if (m.opacity !== 0.8 * on) m.opacity = 0.8 * on
    }
    const fade = Math.max(0, Math.min(1, (now - tagsFrom) / 400))
    for (const o of roomTags.children) {
      // 겹쳐 숨긴 방 표시(declutter)는 숨긴 채로.
      o.visible = host.storeyShown(o) && fade > 0 && !o.userData.cluttered
      const m = (o as Sprite).material
      if (m.opacity !== fade) {
        m.opacity = fade
        host.invalidate()
      }
    }
    // 여러 층이 보일 때만 띄운다. 부드럽게 다가간다.
    const shown = host.visibleStoreys()
    const target = diorama && (!shown || shown.size > 1) ? explodeGap : 0
    const u = buildUniforms.uExplode
    const next = Math.abs(target - u.value) < 0.01 ? target : u.value + (target - u.value) * 0.12
    if (next !== u.value) host.invalidate()
    u.value = next
    for (const g of [host.overlay, roomTags]) {
      for (const o of g.children) {
        const baseY = o.userData.baseY as number | undefined
        if (baseY !== undefined) o.position.y = baseY + explodeAt(baseY)
      }
    }
  }
  /** 방 표시 한 장: 반투명 검은 판에 이름(흰 글씨)과 면적·종류(회색), 바뀐 방은 따뜻한 밑줄. */
  function roomTagSprite(title: string, sub: string, hot: boolean): Sprite {
    const c = document.createElement('canvas')
    let g = c.getContext('2d')!
    const tf = '400 24px system-ui, sans-serif'
    const sf = '400 17px ui-monospace, SFMono-Regular, Menlo, monospace'
    g.font = tf
    const tw = g.measureText(title).width
    g.font = sf
    const sw = g.measureText(sub).width
    const w = Math.ceil(Math.max(tw, sw) + 24)
    c.width = w
    c.height = 64
    g = c.getContext('2d')!
    g.fillStyle = hot ? 'rgba(40, 24, 8, 0.78)' : 'rgba(5, 6, 8, 0.6)'
    g.fillRect(0, 0, w, 64)
    g.textBaseline = 'middle'
    g.font = tf
    g.fillStyle = hot ? '#ffd9a8' : '#f2f2f2'
    g.fillText(title, 12, 22)
    g.font = sf
    g.fillStyle = '#b9bec6'
    g.fillText(sub, 12, 47)
    if (hot) {
      g.fillStyle = '#ffb46b'
      g.fillRect(0, 62, w, 2)
    }
    const map = new CanvasTexture(c)
    map.colorSpace = SRGBColorSpace
    const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }))
    const h = hot ? 0.04 : 0.032
    sprite.scale.set((h * w) / 64, h, 1)
    sprite.center.set(0.5, 0)
    sprite.renderOrder = hot ? 21 : 20
    return sprite
  }

  let build: { t0: number | null } | null = null
  function stepBuild(now: number) {
    if (!build) return
    if (build.t0 === null) build.t0 = now + BUILD_HOLD_MS
    const k = Math.max(0, (now - build.t0) / BUILD_MS)
    buildUniforms.uBuildT.value = Math.min(1, k)
    if (k >= 1) {
      buildUniforms.uBuild.value = 0
      build = null
    }
    host.invalidate()
  }

  // --- 편집 리플레이의 연출(setCinema·spotlight) ---
  // 리플레이는 사람이 앉아서 보는 영상이라 평소 편집과 다르게 움직인다. 카메라는 지금 보던 쪽에서 비스듬히 돌아 들어가며 호를 그려
  // 1.5초에 날아가고, 선 자리에서는 느리게 돈다. 설비는 1.1초에 걸쳐 미끄러지며 떠난 자리에 빈 상자와 궤적을 남기고, 도착하면
  // 바닥에 물결이 퍼진다. 고친 설비에는 빛기둥·이름표, 고친 물리존에는 빛 울타리를 세운다. 전부 host.overlay 의 가산 혼합 메시라
  // 형상(성수 정점 1천만 개)은 건드리지 않고, 크기는 그때의 카메라 거리에 맞춘다(가까이서도 건물 전체에서도 보이게).
  let cinema = false
  const CINEMA_FLY_MS = 1500
  const CINEMA_GLIDE_MS = 1100
  const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2)
  /**
   * 애니메이션 원칙 셋(예비 동작·지나침·안착): 떠나기 전에 살짝 뒤로 물러났다가, 목표를 조금 지나친 뒤 돌아와 선다. 리플레이에서
   * 비춘 설비에만 쓴다 — 무엇이 옮겨지는지가 눈에 걸린다. 따라오는 배관은 CINEMA_FOLLOW_MS 늦게 부드럽게 따라온다.
   */
  const backInOut = (k: number) => {
    const c = 1.2 * 1.525
    return k < 0.5 ? ((2 * k) ** 2 * ((c + 1) * 2 * k - c)) / 2 : ((2 * k - 2) ** 2 * ((c + 1) * (k * 2 - 2) + c) + 2) / 2
  }
  const CINEMA_FOLLOW_MS = 140
  /** 다음 비행이 들어갈 방향. 지금 보는 쪽에서 35° 돌리고 40° 쯤 내려다본다 — 장면마다 다른 쪽에서 들어간다. */
  function cinemaFrom(): Vector3 {
    const d = host.camera.position.clone().sub(host.controls.target)
    const az = Math.atan2(d.x, d.z) + (35 * Math.PI) / 180
    return new Vector3(Math.sin(az), 0.85, Math.cos(az))
  }
  const viewDistance = host.viewDistance

  /** 시간에 따라 바뀌는 연출 하나. loop 면 group.userData.fade 가 0 이 될 때까지 돈다. */
  type Fx = { obj: Object3D; t0: number | null; ms: number; loop?: boolean; step: (k: number, t: number) => void }
  const fxs: Fx[] = []
  function disposeFx(obj: Object3D) {
    host.overlay.remove(obj)
    obj.traverse((o) => {
      const m = o as Mesh
      m.geometry?.dispose()
      const mat = m.material as (Material & { map?: Texture | null }) | undefined
      if (mat?.map) mat.map.dispose()
      mat?.dispose()
    })
  }
  // --- 이름표 겹침 정리(declutter) ---
  // 끝 화면은 고친 자리마다 장면 번호 이름표를 세운다. 한 자리에서 여러 번 고쳤으면(벽 긋기 → 문 놓기 → 문 옮기기) 이름표가
  // 한데 겹쳐 하나도 안 읽혔다. 지도 라벨의 충돌 처리처럼, 화면에서 이름표 상자를 장면 차례로 놓되 앞의 것과 겹치면 위로 한 칸씩
  // 올리고, LEVELS 칸 안에 자리가 없으면 숨긴다(그 빛기둥은 남아 누를 수 있다). 극장 위의 판(끝 요약·통계·층 레일·장면 제목·
  // 조작 막대)도 피한다 — 이름표가 그 위로 올라가면 둘 다 안 읽힌다. 카메라가 도는 동안 120ms 마다 다시 놓는다.
  const DECLUTTER_MS = 120
  const LEVELS = 6
  const LABEL_GAP = 4
  const AVOID = ['.hud-done', '.rp-stats', '.rail', '.scene', '.bug', '.hud-bar', '.rp-side'].map((c) => `.replay-hud ${c}`).join(', ')
  let declutteredAt = 0
  const tagAt = new Vector3()
  type Rect = { left: number; right: number; top: number; bottom: number }
  const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  function declutter(now: number) {
    if (now - declutteredAt < DECLUTTER_MS) return
    declutteredAt = now
    const tags: Sprite[] = []
    for (const s of spots) for (const o of s.group.children) if (o instanceof Sprite && o.userData.spot) tags.push(o)
    if (!tags.length && !roomTags.children.length) return
    tags.sort((a, b) => ((a.userData.nth as number) ?? 0) - ((b.userData.nth as number) ?? 0))
    const view = host.renderer.domElement.getBoundingClientRect()
    const placed: Rect[] = [...document.querySelectorAll(AVOID)].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height)
    // sizeAttenuation 을 끈 스프라이트의 화면 크기: 크기 1 이 화면 높이의 P[1][1]/2 배(three.js sprite 셰이더).
    const px = (host.camera.projectionMatrix.elements[5] * view.height) / 2
    let changed = false
    for (const tag of tags) {
      const at = host.toScreen(tag.getWorldPosition(tagAt))
      const w = tag.scale.x * px
      const h = tag.scale.y * px
      let level = -1
      if (at && at.x >= view.left && at.x <= view.right) {
        for (let l = 0; l < LEVELS; l++) {
          const bottom = at.y - l * (h + LABEL_GAP)
          const r = { left: at.x - w / 2, right: at.x + w / 2, top: bottom - h, bottom }
          if (r.top < view.top) break
          if (!placed.some((p) => overlaps(p, r))) {
            level = l
            placed.push(r)
            break
          }
        }
      }
      const visible = level >= 0
      // center.y 가 -1 이면 스프라이트가 제 높이만큼 위로 선다(아래 가운데가 기준점).
      const cy = visible ? -level * (1 + LABEL_GAP / h) : 0
      if (tag.visible !== visible || tag.center.y !== cy) {
        tag.visible = visible
        tag.center.y = cy
        changed = true
      }
    }
    // 방 표시(밤 다이오라마의 이름·면적)도 겹치면 숨긴다. 장면 이름표 다음 차례이고, 바뀐 방(hot)이 먼저, 그다음은 받은 차례
    // (넓은 방부터). 쌓아 올리지는 않는다 — 방 표시는 그 방 위에 있어야 뜻이 있다. 멀리서 건물 전체를 보면 큰 방 몇 개만 남는다.
    const rooms = (roomTags.children as Sprite[]).filter((o) => host.storeyShown(o))
    rooms.sort((a, b) => Number(!!b.userData.hot) - Number(!!a.userData.hot))
    for (const tag of rooms) {
      const at = host.toScreen(tag.getWorldPosition(tagAt))
      const w = tag.scale.x * px
      const h = tag.scale.y * px
      const r = at ? { left: at.x - w / 2, right: at.x + w / 2, top: at.y - h, bottom: at.y } : null
      const free = !!r && r.left >= view.left && r.right <= view.right && r.top >= view.top && !placed.some((p) => overlaps(p, r))
      if (free) placed.push(r!)
      if (!!tag.userData.cluttered === free) {
        tag.userData.cluttered = !free
        changed = true
      }
    }
    if (changed) host.invalidate()
  }

  function stepFx(now: number) {
    if (!fxs.length) return
    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i]
      if (f.t0 === null) f.t0 = now
      const t = now - f.t0
      if (f.loop ? f.obj.userData.dead : t >= f.ms) {
        // 끝 프레임을 한 번 그려 둔다(옅어지기가 0 에 닿아야 그 빛기둥이 걷힌다).
        if (!f.loop) f.step(1, f.ms)
        if (!f.loop || f.obj.parent) disposeFx(f.obj)
        fxs.splice(i, 1)
        continue
      }
      f.step(f.loop ? (t % f.ms) / f.ms : t / f.ms, t)
    }
    host.invalidate()
  }
  /** 아래에서 위로 옅어지는 알파 무늬. 빛기둥·울타리가 같이 쓴다. */
  let glowTexture: CanvasTexture | null = null
  function glow(): CanvasTexture {
    if (glowTexture) return glowTexture
    const c = document.createElement('canvas')
    c.width = 4
    c.height = 128
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, 0, 128)
    grad.addColorStop(0, '#000')
    grad.addColorStop(0.55, '#3a3a3a')
    grad.addColorStop(1, '#fff')
    g.fillStyle = grad
    g.fillRect(0, 0, 4, 128)
    return (glowTexture = new CanvasTexture(c))
  }
  const fxMaterial = (color: number, opacity: number, faded = false) =>
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: DoubleSide, alphaMap: faded ? glow() : null })

  /**
   * 이름표. 화면에서 늘 같은 크기다(sizeAttenuation 끔). 영화 자막처럼 반투명 검은 판에 가는 흰 글씨, 밑변에만 갈래 색 가는
   * 줄을 둔다. 앞의 장면 번호("#03 …")는 회색 고정폭 글씨로 한 단계 낮춘다.
   */
  function labelSprite(text: string, color: number): Sprite {
    const m = /^#(\d+)\s+(.*)$/.exec(text)
    const [num, name] = m ? [m[1], m[2]] : ['', text]
    const font = '400 28px system-ui, sans-serif'
    const numFont = '500 22px ui-monospace, SFMono-Regular, Menlo, monospace'
    const pad = 14
    const c = document.createElement('canvas')
    let g = c.getContext('2d')!
    g.font = numFont
    const nw = num ? g.measureText(num).width + 12 : 0
    g.font = font
    const tw = g.measureText(name).width
    const w = Math.ceil(pad * 2 + nw + tw)
    c.width = w
    c.height = 60
    g = c.getContext('2d')!
    g.textBaseline = 'middle'
    // 빛기둥 위에서도 읽히게 반투명 검은 판을 깐다(자막 판). 색 막대·테두리는 두지 않는다.
    g.fillStyle = 'rgba(5, 6, 8, 0.62)'
    g.fillRect(0, 0, w, 60)
    if (num) {
      g.font = numFont
      g.fillStyle = '#c4c9d0'
      g.fillText(num, pad, 29)
    }
    g.font = font
    g.fillStyle = '#fff'
    g.fillText(name, pad + nw, 29)
    g.globalAlpha = 0.9
    g.fillStyle = `#${color.toString(16).padStart(6, '0')}`
    g.fillRect(0, 58, w, 2)
    const map = new CanvasTexture(c)
    map.colorSpace = SRGBColorSpace
    const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }))
    // 화면 높이의 약 5%.
    const h = 0.045
    sprite.scale.set((h * w) / 60, h, 1)
    sprite.center.set(0.5, 0)
    sprite.renderOrder = 22
    return sprite
  }

  type Spot = { id: string; color: number; group: Group }
  let spots: Spot[] = []
  let spotClickHandler: ((key: string) => void) | null = null
  /** 화면 점 아래의 빛기둥·이름표. 지금 비춘 것(사라지는 중인 것은 빼고)만 본다. */
  function hitSpot(x: number, y: number): string | null {
    if (!cinema || !spots.length) return null
    host.rayAt(x, y)
    // 겹쳐서 숨긴 이름표(declutter)는 누르지 못한다 — 그 자리의 빛기둥을 누른다.
    const parts = spots.flatMap((s) => s.group.children.filter((o) => o.userData.spot && o.visible))
    // 이름표가 빛기둥보다 먼저다 — 이름표는 늘 위에 그려지는데, 빛기둥이 더 가까우면 뒤의 빛기둥 장면이 골라졌다.
    const tags = parts.filter((o) => o instanceof Sprite)
    const hit = (host.raycaster.intersectObjects(tags, false)[0] ?? host.raycaster.intersectObjects(parts, false)[0])?.object.userData.spot as string | undefined
    if (hit) return hit
    // 작은 설비의 빛기둥은 몇 픽셀이라 맞히기 어렵다. 이름표·빛기둥 밑동에서 SPOT_REACH 픽셀 안이면 그것으로 친다(가까운 것).
    let best: { key: string; d: number } | null = null
    for (const part of parts) {
      const at = host.toScreen(part.getWorldPosition(new Vector3()))
      if (!at) continue
      const d = Math.hypot(at.x - x, at.y - y)
      if (d < SPOT_REACH && (!best || d < best.d)) best = { key: part.userData.spot as string, d }
    }
    return best?.key ?? null
  }
  const SPOT_REACH = 30
  /** 비춘 것들을 옅게 걷는다. keep 이 있으면 그것만 남긴다(지운 설비의 빛기둥만 걷을 때). */
  function fadeSpots(keep?: (s: Spot) => boolean) {
    for (const s of spots) {
      if (keep?.(s)) continue
      const g = s.group
      const from = g.userData.fade as number
      fxs.push({ obj: new Object3D(), t0: null, ms: 450, step: (k) => {
        g.userData.fade = from * (1 - k)
        if (k >= 1) g.userData.dead = true
      } })
    }
    spots = keep ? spots.filter(keep) : []
  }
  /** 설비 하나의 빛기둥·바닥 물결 두 겹·이름표. 무리(group)는 설비 형상 중심에 있고, 미끄러지면 따라간다(trace). */
  function deviceSpot(id: string, color: number, label: string | undefined, d: number, nth: number): Spot | null {
    const part = host.partById().get(id)
    if (!part || host.hiddenIds().has(id)) return null
    return boxSpot(id, part.box, color, label, d, nth)
  }
  /** 형상이 없는 자리(문·창)의 빛기둥. 문 크기(0.9 × 2.1m)의 상자를 바닥에 세운 것으로 친다. */
  function pointSpot(p: NonNullable<SpotlightExtra['points']>[number], color: number, d: number, nth: number): Spot {
    const boxAt = (at: Vec3) => {
      const [x, y, z] = host.toScene(at)
      return new Box3(new Vector3(x - 0.45, y, z - 0.45), new Vector3(x + 0.45, y + 2.1, z + 0.45))
    }
    const to = boxAt(p.at)
    const spot = boxSpot(p.key, p.from ? boxAt(p.from) : to, color, p.label, d, nth, p.bare)
    if (p.from) {
      spots.push(spot)
      trace(p.key, boxAt(p.from), to)
    }
    return spot
  }
  function boxSpot(id: string, box: Box3, color: number, label: string | undefined, d: number, nth: number, bare = false): Spot {
    const size = box.getSize(new Vector3())
    const r = Math.max(Math.hypot(size.x, size.z) * 0.45, d * 0.01)
    const h = Math.max(4, d * 0.3)
    const group = new Group()
    group.position.copy(box.getCenter(new Vector3()))
    group.userData.fade = 1
    const base = -size.y / 2
    const outer = new Mesh(new CylinderGeometry(r, r, h, 40, 1, true).translate(0, h / 2, 0), fxMaterial(color, 0.4, true))
    const core = new Mesh(new CylinderGeometry(r * 0.22, r * 0.22, h * 1.15, 16, 1, true).translate(0, (h * 1.15) / 2, 0), fxMaterial(0xffffff, 0.6, true))
    outer.position.y = core.position.y = base
    const rings = [0, 1].map(() => {
      const ring = new Mesh(new RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2), fxMaterial(color, 0.8))
      ring.position.y = base + 0.02
      return ring
    })
    const tag = label ? labelSprite(label, color) : null
    // 리플레이 끝 화면에서 빛기둥·이름표를 누르면 그 장면을 다시 본다(onSpotClick).
    outer.userData.spot = id
    if (tag) tag.userData.spot = id
    // 이름표는 빛기둥 꼭대기 조금 위. 여럿이 겹치면 화면에서 위로 한 칸씩 비켜 선다(declutter).
    if (tag) tag.position.y = size.y / 2 + d * 0.02
    if (tag) tag.userData.nth = nth
    group.add(...(bare ? [] : [outer, core]), ...rings, ...(tag ? [tag] : []))
    for (const o of group.children) o.renderOrder = o.renderOrder || 18
    // 밤 다이오라마의 층 띄우기를 따라간다(stepDiorama).
    group.userData.baseY = group.position.y
    group.position.y += explodeAt(group.position.y)
    host.overlay.add(group)
    fxs.push({ obj: group, t0: null, ms: 1600, loop: true, step: (k, t) => {
      const fade = group.userData.fade as number
      const rise = easeOut(Math.min(1, t / 600))
      outer.scale.y = core.scale.y = rise
      ;(outer.material as MeshBasicMaterial).opacity = 0.4 * fade * (0.85 + 0.15 * Math.sin(t / 160))
      ;(core.material as MeshBasicMaterial).opacity = 0.6 * fade * rise
      rings.forEach((ring, i) => {
        const p = (k + i / 2) % 1
        ring.scale.setScalar(r * (1 + 2.4 * easeOut(p)))
        ;(ring.material as MeshBasicMaterial).opacity = 0.65 * (1 - p) * fade * rise
      })
      if (tag) (tag.material as SpriteMaterial).opacity = fade * rise
    } })
    return { id, color, group }
  }
  /** 물리존 둘레의 빛 울타리(아래가 밝고 위로 옅어지는 벽)와 바닥 테두리. 땅에서 솟아오른다. */
  function spaceSpot(id: string, color: number): Spot | null {
    const t = host.spaceTargets().find((x) => x.id === id)
    if (!t || t.ring.length < 3) return null
    const shown = host.visibleStoreys()
    if (shown && !shown.has(t.storeyId)) return null
    return fenceSpot(`space:${id}`, t.ring, t.y, color)
  }
  /** 외곽선 둘레의 빛 울타리. 물리존·벽이 같이 쓴다. y 는 장면 높이(층 바닥). */
  function fenceSpot(key: string, ring: readonly Vec2[], y: number, color: number): Spot | null {
    if (ring.length < 2) return null
    const h = 2.6
    const pts = ring.map(([x, z]) => new Vector3(...host.toScene([x, z, 0])).setY(0))
    const position: number[] = []
    const uv: number[] = []
    const index: number[] = []
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]
      const v = position.length / 3
      position.push(a.x, 0, a.z, b.x, 0, b.z, a.x, h, a.z, b.x, h, b.z)
      uv.push(0, 0, 1, 0, 0, 1, 1, 1)
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    geometry.setIndex(index)
    const wall = new Mesh(geometry, fxMaterial(color, 0.55, true))
    const edge = new LineLoop(
      new BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(0.06))),
      new LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false, depthWrite: false, blending: AdditiveBlending }),
    )
    const group = new Group()
    group.position.y = y + 0.1
    group.userData.fade = 1
    group.add(wall, edge)
    wall.renderOrder = edge.renderOrder = 17
    host.overlay.add(group)
    fxs.push({ obj: group, t0: null, ms: 1400, loop: true, step: (k, t) => {
      const fade = group.userData.fade as number
      const rise = easeOut(Math.min(1, t / 700))
      wall.scale.y = Math.max(rise, 0.001)
      ;(wall.material as MeshBasicMaterial).opacity = 0.55 * fade * (0.8 + 0.2 * Math.sin(k * Math.PI * 2))
      ;(edge.material as LineBasicMaterial).opacity = fade
    } })
    return { id: key, color, group }
  }
  /** 바닥에 퍼지는 충격파 한 번. 미끄러진 설비가 도착할 때. */
  function shock(at: Vector3, color: number, r: number) {
    const ring = new Mesh(new RingGeometry(0.9, 1, 72).rotateX(-Math.PI / 2), fxMaterial(color, 1))
    const disc = new Mesh(new CircleGeometry(1, 48).rotateX(-Math.PI / 2), fxMaterial(0xffffff, 0.5))
    const group = new Group()
    group.position.copy(at)
    group.add(ring, disc)
    ring.renderOrder = disc.renderOrder = 19
    host.overlay.add(group)
    fxs.push({ obj: group, t0: null, ms: 900, step: (k) => {
      const e = easeOut(k)
      ring.scale.setScalar(r * (1 + 7 * e))
      disc.scale.setScalar(r * (0.5 + 2.5 * e))
      ;(ring.material as MeshBasicMaterial).opacity = 1 - k
      ;(disc.material as MeshBasicMaterial).opacity = 0.5 * (1 - e)
    } })
  }
  // --- 변경 지도(setDiffMap) ---
  // 애니메이션은 순서를 보이지만 "몇 개가, 어디가 바뀌었나" 를 세기에는 한 장의 차이 지도가 낫다(동적 그래프 시각화 연구).
  // BIM 버전 비교 도구(Archicad·BIMvision·Navisworks Compare)처럼 이번 세션에서 더한 것·고친 것·지운 것을 색으로 한꺼번에 칠한다.
  // 움직이지 않는 덧그림이라 움직임을 끈 사람에게도 보인다. 지운 것은 3D 에 없으니 연 때 자리에 빈 상자로 둔다.
  const DIFF_COLOR = { added: 0x4da3ff, modified: 0xffb020, removed: 0xff4d5e } as const
  let diffGroups: Group[] = []
  function clearDiff() {
    for (const g of diffGroups) disposeFx(g)
    diffGroups = []
  }
  function diffBox(box: Box3, color: number) {
    const size = box.getSize(new Vector3())
    size.y = Math.max(size.y, 0.05)
    const geo = new BoxGeometry(size.x, size.y, size.z).translate(0, size.y / 2, 0)
    const fill = new Mesh(geo, fxMaterial(color, 0.22))
    const edges = new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }))
    const g = new Group()
    const base = box.getCenter(new Vector3()).setY(box.min.y)
    g.position.copy(base)
    g.add(fill, edges)
    fill.renderOrder = edges.renderOrder = 16
    g.userData.baseY = base.y
    g.position.y += explodeAt(base.y)
    host.overlay.add(g)
    diffGroups.push(g)
  }
  /** 외곽선 둘레의 낮은 울타리(물리존·룸 h 0.4, 벽 h 2.6)와 바닥 테두리. 움직이지 않는다. y 는 장면 높이. */
  function diffFence(ring: readonly Vec2[], y: number, h: number, color: number) {
    if (ring.length < 2) return
    const pts = ring.map(([x, z]) => new Vector3(...host.toScene([x, z, 0])).setY(0))
    const position: number[] = []
    const uv: number[] = []
    const index: number[] = []
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length]
      const v = position.length / 3
      position.push(a.x, 0, a.z, b.x, 0, b.z, a.x, h, a.z, b.x, h, b.z)
      uv.push(0, 0, 1, 0, 0, 1, 1, 1)
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    geometry.setIndex(index)
    const wall = new Mesh(geometry, fxMaterial(color, 0.45, true))
    const edge = new LineLoop(new BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(0.05))), new LineBasicMaterial({ color, transparent: true, opacity: 1, depthTest: false, depthWrite: false }))
    const g = new Group()
    g.position.y = y + 0.08
    g.add(wall, edge)
    wall.renderOrder = edge.renderOrder = 16
    g.userData.baseY = g.position.y
    g.position.y += explodeAt(g.position.y)
    host.overlay.add(g)
    diffGroups.push(g)
  }

  // --- 철거(demolish) ---
  const DEMOLISH_MS = 1300
  const DEMOLISH_COLOR = 0xff4d5e
  /** 비춘 철거 수(e2e 가 짧은 연출을 놓치지 않게 센다). */
  let demolished = 0
  /** 장면 상자 하나를 붉게 비춰 가라앉힌다. 상자는 장면 좌표(설비 형상 상자 또는 외곽선을 세운 상자). */
  function demolishBox(box: Box3) {
    // 작은 설비(말단·센서)는 빛기둥에 가려 안 보인다 — 바닥 넓이를 60cm 는 되게 키운다.
    const c = box.getCenter(new Vector3())
    box.expandByPoint(new Vector3(c.x - 0.3, box.min.y, c.z - 0.3)).expandByPoint(new Vector3(c.x + 0.3, box.min.y, c.z + 0.3))
    const size = box.getSize(new Vector3())
    size.y = Math.max(size.y, 0.05)
    // 바닥이 원점인 상자 — 키를 줄이면 바닥으로 가라앉는다.
    const geo = new BoxGeometry(size.x, size.y, size.z).translate(0, size.y / 2, 0)
    const fill = new Mesh(geo, fxMaterial(DEMOLISH_COLOR, 0.35))
    const edges = new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: DEMOLISH_COLOR, transparent: true, opacity: 1, depthTest: false, depthWrite: false, blending: AdditiveBlending }))
    const group = new Group()
    const base = box.getCenter(new Vector3()).setY(box.min.y)
    group.position.copy(base)
    group.add(fill, edges)
    fill.renderOrder = edges.renderOrder = 19
    group.userData.baseY = base.y
    group.position.y += explodeAt(base.y)
    host.overlay.add(group)
    demolished++
    let shocked = false
    fxs.push({ obj: group, t0: null, ms: DEMOLISH_MS, step: (k) => {
      // 앞 25% 는 번쩍이고(두 번), 그 뒤 가라앉으며 옅어진다.
      const flash = k < 0.25 ? 0.5 + 0.5 * Math.cos(k * Math.PI * 8) : 1
      const sink = k < 0.25 ? 1 : 1 - easeOut((k - 0.25) / 0.75)
      group.scale.y = Math.max(sink, 0.001)
      ;(fill.material as MeshBasicMaterial).opacity = 0.35 * flash * (0.3 + 0.7 * sink)
      ;(edges.material as LineBasicMaterial).opacity = flash * (0.2 + 0.8 * sink)
      if (!shocked && k >= 0.25) {
        shocked = true
        shock(group.position.clone().setY(group.position.y + 0.02), DEMOLISH_COLOR, Math.max(0.4, Math.hypot(size.x, size.z) * 0.3))
      }
    } })
  }

  /** 비춘 설비가 미끄러질 때: 떠난 자리의 빈 상자, 지나간 궤적, 따라가는 빛기둥, 도착하면 충격파. */
  function trace(id: string, fromBox: Box3, toBox: Box3) {
    const spot = spots.find((s) => s.id === id)
    if (!spot) return
    const a = fromBox.getCenter(new Vector3())
    const b = toBox.getCenter(new Vector3())
    const length = a.distanceTo(b)
    if (length < 0.02) return
    const d = viewDistance()
    const ghost = new LineSegments(
      new EdgesGeometry(new BoxGeometry(...fromBox.getSize(new Vector3()).toArray())),
      new LineBasicMaterial({ color: spot.color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, blending: AdditiveBlending }),
    )
    ghost.position.copy(a)
    const r = Math.max(0.025, d * 0.0018)
    const trail = new Mesh(new CylinderGeometry(r, r, 1, 10, 1, true).translate(0, 0.5, 0), fxMaterial(spot.color, 0.95))
    trail.position.copy(a)
    trail.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize())
    trail.scale.y = 0.0001
    ghost.renderOrder = trail.renderOrder = 19
    const group = new Group()
    group.add(ghost, trail)
    host.overlay.add(group)
    const follow = spot.group
    const bottom = b.clone().setY(toBox.min.y + 0.02)
    let landed = false
    fxs.push({ obj: group, t0: null, ms: CINEMA_GLIDE_MS + 2400, step: (_k, t) => {
      const e = backInOut(Math.min(1, t / CINEMA_GLIDE_MS))
      trail.scale.y = Math.max(length * Math.min(1, e), 0.0001)
      if (!follow.userData.dead) follow.position.lerpVectors(a, b, e)
      const fade = t < CINEMA_GLIDE_MS ? 1 : 1 - (t - CINEMA_GLIDE_MS) / 2400
      ;(ghost.material as LineBasicMaterial).opacity = 0.9 * fade
      ;(trail.material as MeshBasicMaterial).opacity = 0.95 * fade
      if (!landed && t >= CINEMA_GLIDE_MS) {
        landed = true
        shock(bottom, spot.color, Math.max(0.4, d * 0.015))
      }
    } })
  }


  const api: ReplayViewerApi = {
    setCinema(on) {
      cinema = on
      host.controls.autoRotate = on && !still()
      host.controls.autoRotateSpeed = 0.35
      if (!on) {
        for (const f of fxs) disposeFx(f.obj)
        fxs.length = 0
        spots = []
        clearDiff()
      }
      host.invalidate()
    },

    setDiorama(on) {
      if (on === diorama) return
      diorama = on
      nightFrom = null
      applyNight(on ? 1 : 0)
      const levels = [...new Set(storeyElevation.values())].sort((a, b) => a - b).slice(0, MAX_LEVELS)
      buildUniforms.uLevels.value = [...levels, ...new Array<number>(MAX_LEVELS - levels.length).fill(1e9)]
      buildUniforms.uLevelCount.value = levels.length
      // 층 사이(가운데 값)의 70%, 1.5~6m.
      const gaps = levels.slice(1).map((e, i) => e - levels[i]).sort((a, b) => a - b)
      explodeGap = gaps.length ? Math.min(6, Math.max(1.5, gaps[gaps.length >> 1] * 0.7)) : 0
      if (!on) {
        for (const o of pools.children) (o as Mesh).geometry.dispose()
        pools.clear()
        poolsOf = null
        flows = []
        flowPoints.geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3))
        section = null
        sectionSheet.visible = false
        host.renderer.clippingPlanes = []
      }
      host.invalidate()
    },

    nightFall(delayMs) {
      if (!diorama || still()) return
      nightFrom = performance.now() + delayMs
      applyNight(0)
      host.invalidate()
    },

    sectionTo(storeyId) {
      return new Promise<void>((done) => {
        const levels = buildUniforms.uLevels.value.slice(0, buildUniforms.uLevelCount.value)
        const e = storeyElevation.get(storeyId)
        const above = e === undefined ? undefined : levels.find((l) => l > e + 0.01)
        if (!diorama || still() || above === undefined) return done()
        // 자를 높이: 그 층 바로 위층의 바닥(띄운 만큼 올린 자리) 조금 아래. 출발은 건물 꼭대기 위.
        const to = above + explodeAt(above) - 0.15
        const box = new Box3().setFromObject(host.content())
        const from = (box.isEmpty() ? to + 10 : box.max.y) + explodeGap * Math.max(0, levels.length - 1) + 1
        if (!box.isEmpty()) showSectionSheet(box)
        section = { from, to, t0: null, done }
        host.invalidate()
      })
    },

    clearSection() {
      section = null
      sectionSheet.visible = false
      host.renderer.clippingPlanes = []
      host.invalidate()
    },

    setFlows(list) {
      flows = list.slice(0, FLOW_MAX).map((f) => (f.from === f.b ? { a: f.b, b: f.a } : { a: f.a, b: f.b }))
      if (!flows.length) flowPoints.geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3))
      host.invalidate()
    },

    setRoomTags(tags) {
      for (const o of roomTags.children) {
        const m = (o as Sprite).material
        m.map?.dispose()
        m.dispose()
      }
      roomTags.clear()
      const storey = tags[0]?.storeyId ?? null
      if (storey !== tagsStorey) tagsFrom = performance.now() + (cinema && !still() ? CINEMA_FLY_MS : 0)
      tagsStorey = storey
      for (const t of tags) {
        const sprite = roomTagSprite(t.title, t.sub, t.hot)
        const [x, y, z] = host.toScene(t.at)
        sprite.position.set(x, y + 0.2, z)
        sprite.userData.baseY = y + 0.2
        sprite.userData.storeyId = t.storeyId
        sprite.userData.hot = t.hot
        sprite.position.y += explodeAt(sprite.userData.baseY)
        roomTags.add(sprite)
      }
      host.invalidate()
    },

    revealElements(ids) {
      if (still() || !ids.length) return
      const now = performance.now()
      for (const id of ids) {
        revealing.set(id, { t0: null, asked: now })
        revealFull.delete(id)
      }
      // 벽·문·창은 따로 그리도록 다시 짓는다. 설비·공간 오브젝트는 그려진 그대로 다음 프레임부터 눌렀다 편다.
      if (ids.some((id) => host.archTargets().some((t) => t.id === id))) host.rebuildArchitecture()
      host.invalidate()
    },

    buildUp() {
      if (still()) return
      const groups = [host.content(), host.arch, host.rooms, host.customZones, host.spaceObjects]
      const box = new Box3()
      for (const g of groups) if (g.visible) box.expandByObject(g)
      if (box.isEmpty()) return
      for (const g of groups) {
        g.traverse((o) => {
          const m = (o as Mesh).material as Material | Material[] | undefined
          for (const x of Array.isArray(m) ? m : m ? [m] : []) patchBuild(x)
        })
      }
      // 물결은 화면에서 왼쪽 앞 모서리(바닥면의 x 최소·z 최대)에서 출발한다.
      riseAttributes(groups, new Vector2(box.min.x, box.max.z), Math.max(1, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z)))
      buildUniforms.uBuildT.value = 0
      buildUniforms.uBuild.value = 1
      build = { t0: null }
      host.invalidate()
    },

    onSpotClick(handler) {
      spotClickHandler = handler
    },

    setAutoRotate(on) {
      host.controls.autoRotate = on && cinema && !still()
      host.invalidate()
    },

    spotlight(equipment, spaces, color, extra) {
      fadeSpots()
      if (!cinema || still()) return
      const d = viewDistance()
      for (const [i, e] of equipment.slice(0, 8).entries()) {
        const s = deviceSpot(e.id, color, e.label, d, i)
        if (s) spots.push(s)
      }
      for (const id of spaces.slice(0, 6)) {
        const s = spaceSpot(id, color)
        if (s) spots.push(s)
      }
      for (const [i, p] of (extra?.points ?? []).slice(0, 8).entries()) {
        const s = pointSpot(p, color, d, equipment.length + i)
        if (!p.from) spots.push(s)
      }
      for (const r of (extra?.rings ?? []).slice(0, 6)) {
        const s = fenceSpot(r.key, r.ring, r.elevation, color)
        if (s) spots.push(s)
      }
      host.invalidate()
    },

    setDiffMap(items) {
      clearDiff()
      if (items) {
        for (const it of items) {
          const color = DIFF_COLOR[it.state]
          if (it.id) {
            const part = host.partById().get(it.id)
            if (part && !host.hiddenIds().has(it.id)) diffBox(part.box.clone().expandByScalar(0.08), color)
          } else if (it.ring && it.ring.length >= 2) {
            diffFence(it.ring, host.toScene([0, 0, it.elevation ?? 0])[1], it.height ?? 0.4, color)
          } else if (it.at) {
            const [x, y, z] = host.toScene(it.at)
            const s = it.size ?? 0.6
            diffBox(new Box3(new Vector3(x - s / 2, y, z - s / 2), new Vector3(x + s / 2, y + (it.tall ?? s), z + s / 2)), color)
          }
        }
      }
      host.invalidate()
    },

    demolish(items) {
      if (!cinema || still()) return
      // 지우는 설비를 비추던 빛기둥·이름표는 같이 걷는다 — 남으면 빈 자리를 가리킨다.
      const gone = new Set(items.flatMap((it) => (it.id ? [it.id] : [])))
      if (gone.size) fadeSpots((s) => !gone.has(s.id))
      for (const it of items) {
        if (it.id) {
          const part = host.partById().get(it.id)
          if (part && !host.hiddenIds().has(it.id)) demolishBox(part.box.clone())
        } else if (it.ring && it.ring.length >= 2) {
          const box = new Box3()
          for (const p of it.ring) box.expandByPoint(new Vector3(...host.toScene([p[0], p[1], it.elevation ?? 0])))
          box.max.y += it.height ?? 1
          demolishBox(box)
        } else if (it.at) {
          const [x, y, z] = host.toScene(it.at)
          demolishBox(new Box3(new Vector3(x - 0.45, y, z - 0.45), new Vector3(x + 0.45, y + 2.1, z + 0.45)))
        }
      }
      host.invalidate()
    },

    framePoints(points, margin = 0) {
      const box = new Box3()
      for (const p of points) {
        const v = new Vector3(...host.toScene(p))
        box.expandByPoint(v)
        box.expandByPoint(v.clone().setY(v.y + 2.6))
      }
      if (box.isEmpty()) return
      if (margin > 0) box.expandByScalar(margin)
      host.fit(box)
    },

  }

  return {
    api,
    /** 매 프레임. viewer.ts 의 tick 이 비행·미끄러짐·번쩍임 다음에 부른다. */
    step(now: number) {
      stepFx(now)
      if (cinema && (spots.length || roomTags.children.length)) declutter(now)
      stepBuild(now)
      stepReveal(now)
      stepDiorama(now)
      stepFlows(now)
      stepSection(now)
    },
    /** 리플레이 연출 중인가. 켜져 있으면 비행·미끄러짐이 길어지고 번쩍임이 진해진다. */
    cinema: () => cinema,
    /** 이 벽·문·창이 솟아오르는 중이라 따로 그려야 하나(buildArchitecture). */
    reveals: (id: string) => revealing.has(id),
    revealMesh,
    /** 새 모델. 층 쌓기가 층 높이와 설비의 층을 쓴다. */
    modelChanged(model: Model) {
      storeyElevation = new Map(model.storeys.map((s) => [s.id, s.elevation]))
      equipmentStorey = new Map(model.storeys.flatMap((s) => s.equipment.map((e) => [e.id, s.id] as const)))
    },
    /** 카메라 비행 하나의 시간·떠오름·감속. 리플레이에서는 길게, 가운데서 위로 떠오르는 호를 그리며 간다(먼 거리일수록 높이). */
    flight(ms: number, distance: number): { ms: number; lift: number; ease: (k: number) => number } {
      if (!cinema) return { ms, lift: 0, ease: easeOut }
      return { ms: CINEMA_FLY_MS, lift: Math.min(distance * 0.35, 80), ease: easeInOut }
    },
    /**
     * 미끄러짐 하나의 시간·감속·늦은 출발. 리플레이에서 비춘 설비는 예비 동작·지나침·안착으로, 따라오는 배관은 조금 늦게
     * 부드럽게 간다.
     */
    glide(id: string, ms: number): { ms: number; ease: (k: number) => number; delay: number } {
      if (!cinema) return { ms, ease: easeOut, delay: 0 }
      const lead = spots.some((s) => s.id === id)
      return { ms: CINEMA_GLIDE_MS, ease: lead ? backInOut : easeInOut, delay: lead ? 0 : CINEMA_FOLLOW_MS }
    },
    /** 설비가 미끄러지기 시작했다. 비춘 설비면 떠난 자리·궤적·충격파를 남긴다. */
    glided(id: string, from: Box3, to: Box3) {
      if (cinema) trace(id, from, to)
    },
    /** 다음 시점 맞추기가 들어갈 방향. 리플레이가 아니면 null(뷰어의 기본 방향). */
    fitFrom: (): Vector3 | null => (cinema ? cinemaFrom() : null),
    /** 밤 다이오라마로 층을 띄운 만큼 건물 전체 보기의 높이를 더한다. */
    fitHeight(): number {
      const shown = host.visibleStoreys()
      return diorama && (!shown || shown.size > 1) ? explodeGap * Math.max(0, buildUniforms.uLevelCount.value - 1) : 0
    },
    /** 화면 점 아래의 누를 수 있는 빛기둥·이름표. 누르기를 받는 쪽이 없으면 null. */
    hitSpot: (x: number, y: number): string | null => (spotClickHandler ? hitSpot(x, y) : null),
    spotClick: (key: string) => spotClickHandler?.(key),
    /** e2e 가 보는 지금의 연출 수. */
    motion: () => ({ effects: fxs.length, spots: spots.length, demolished }),
  }
}
