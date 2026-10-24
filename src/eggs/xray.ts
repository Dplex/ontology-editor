// S1. 온톨로지 투시(xray) — 내보낼 TTL 을 받는 쪽 규칙(readOntologyTTL)으로 읽은 그래프를 건물 자리에 세운다(docs/plans/easter-eggs.md).
//
// - 데이터는 readOntologyTTL(modelToTTL(model)) 과 modelToGeoJSON(model) 만 쓴다. 화면의 선 하나가 파일의 줄 하나다.
// - 설비는 제자리의 점(종류별 색 X 와 같은 팔레트), 물리존은 바닥 중심의 고리, 층은 건물 옆에 세운 기둥의 마디다.
// - feeds 는 흐르는 빛(flowPulseMesh), hasLocation 은 설비에서 방으로 가는 가는 선, hasPart 는 방에서 층 기둥으로 휘는 곡선이다.
// - 어두운 막은 건물 재질을 바꾸지 않고 afterRender 에서 화면 전체 사각형(바탕 85%)을 그린 뒤 그래프 장면을 같은 카메라로 덧그린다.
// - 3D 위에서 Space 를 누르고 있는 동안 0.25초에 서고, 놓으면 0.2초에 물러난다. 처음 켰을 때는 바로 보여 주어 ~ 판·콘솔·주소로도
//   곧장 확인하고, Space 를 누르고 떼면 훑어보기처럼 여닫힌다.
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Vector3,
} from 'three'
import { watch } from 'vue'
import { modelToGeoJSON } from '../lib/export/geojson'
import { readOntologyTTL } from '../lib/export/read-ttl'
import { classOf, modelToTTL } from '../lib/export/ttl'
import { flowPulseMesh, setFlowTime, type FlowSegment } from '../lib/flow-pulse'
import { isConduit, type Model } from '../lib/model'
import { easeOut } from '../lib/motion'
import { toScene } from '../lib/viewer'
import type { EggContext, EggHandle } from './types'

/** 종류별 색(X, editor/view-filter.ts)과 같은 10색 팔레트와 종류 모름(ex:) 자홍. */
const CLASS_PALETTE = [0x4e79a7, 0xf28e2b, 0x59a14f, 0xe15759, 0x76b7b2, 0xedc948, 0xb07aa1, 0x9c755f, 0x2f8f9d, 0x8cd17d]
const UNKNOWN_CLASS_COLOR = 0xc2185b
const FADE_IN_MS = 250
const FADE_OUT_MS = 200
const CURVE_STEPS = 6
/** 편집 뒤 다시 짓기까지 모으는 시간. */
const REBUILD_SETTLE_MS = 250

export type XrayStats = {
  feeds: number
  hasLocation: number
  hasPart: number
  /** 받는 쪽이 읽지 않는 덕트·배관(fso:) 수. */
  unread: number
  /** 받는 쪽이 읽지 않는 것 가운데 fso: 가 아닌 것의 수. */
  unreadOther: number
  graph: {
    points: number
    feeds: number
    hasLocation: number
    hasPart: number
  }
  buildMs: number
}

type BuiltGraph = {
  scene: Scene
  stats: XrayStats
  feedsMesh: Mesh | null
  setOpacity(alpha: number, dark: boolean): void
  dispose(): void
}

/** 모델의 기기 클래스 빈도순으로 종류별 색(X)과 같은 색 표를 만든다. */
function classColorsOf(model: Readonly<Model>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of model.storeys) {
    for (const e of s.equipment) {
      if (!e.position || isConduit(e.role)) continue
      const cls = classOf(e)
      if (!cls.startsWith('ex:')) counts.set(cls, (counts.get(cls) ?? 0) + 1)
    }
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return new Map(ordered.map(([cls], i) => [cls, CLASS_PALETTE[i % CLASS_PALETTE.length]]))
}

function ringSegments(out: number[], center: Vector3, radius: number, sides: number) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    out.push(
      center.x + Math.cos(a0) * radius,
      center.y,
      center.z + Math.sin(a0) * radius,
      center.x + Math.cos(a1) * radius,
      center.y,
      center.z + Math.sin(a1) * radius,
    )
  }
}

/** 내보낼 TTL·GeoJSON 만 읽어 3D 그래프 장면을 짓는다. 단위 테스트에서도 직접 부른다. */
export function buildXrayGraph(model: Readonly<Model>, dark: boolean): BuiltGraph {
  const t0 = performance.now()
  const ttl = modelToTTL(model as Model)
  const reading = readOntologyTTL(ttl)
  const geo = modelToGeoJSON(model as Model)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  const touchXY = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const s of model.storeys) {
    if (s.elevation < minZ) minZ = s.elevation
    if (s.elevation > maxZ) maxZ = s.elevation
  }

  const posByKey = new Map<string, Vector3>()
  const spaceCenters: Vector3[] = []

  for (const { collection } of geo) {
    for (const f of collection.features) {
      const g = f.geometry
      const elev = typeof f.properties.elevation === 'number' ? f.properties.elevation : 0
      if (!g) continue
      if (g.type === 'Point') {
        const [x, y, z = elev] = g.coordinates
        touchXY(x, y)
        posByKey.set(String(f.id), new Vector3(...toScene([x, y, z])))
      } else if (g.type === 'LineString' && g.coordinates.length >= 2) {
        const a = g.coordinates[0]
        const b = g.coordinates[g.coordinates.length - 1]
        const mx = (a[0] + b[0]) / 2
        const my = (a[1] + b[1]) / 2
        const mz = ((a[2] ?? elev) + (b[2] ?? elev)) / 2
        touchXY(mx, my)
        posByKey.set(String(f.id), new Vector3(...toScene([mx, my, mz])))
      } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0]
        if (!ring || ring.length < 3) continue
        const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length
        let sx = 0
        let sy = 0
        for (let i = 0; i < n; i++) {
          sx += ring[i][0]
          sy += ring[i][1]
          touchXY(ring[i][0], ring[i][1])
        }
        const cx = sx / n
        const cy = sy / n
        const v = new Vector3(...toScene([cx, cy, elev + 0.15]))
        posByKey.set(String(f.id), v)
        if (f.properties.kind === 'space') spaceCenters.push(v)
      }
    }
  }

  if (!Number.isFinite(minX)) {
    minX = -5
    maxX = 5
    minY = -5
    maxY = 5
  }
  if (!Number.isFinite(minZ)) {
    minZ = 0
    maxZ = 3
  }

  const span = Math.max(maxX - minX, maxY - minY, 6)
  const pillarX = minX - Math.max(2.5, span * 0.12)
  const pillarY = (minY + maxY) / 2
  const storeyNodes: Vector3[] = []
  const orderedStoreys = [...model.storeys].sort((a, b) => a.elevation - b.elevation)
  for (const s of orderedStoreys) {
    const v = new Vector3(...toScene([pillarX, pillarY, s.elevation + 0.5]))
    posByKey.set(s.id, v)
    storeyNodes.push(v)
  }
  const buildingTop = new Vector3(...toScene([pillarX, pillarY, maxZ + Math.max(2.5, span * 0.1)]))
  posByKey.set(model.buildingId, buildingTop)

  // 계통(System)은 구성원 설비들의 중심 위쪽에 둔다.
  for (let i = 0; i < model.systems.length; i++) {
    const sys = model.systems[i]
    const members = sys.memberIds.map((id) => posByKey.get(id)).filter((v): v is Vector3 => !!v)
    if (members.length) {
      const avg = new Vector3()
      for (const m of members) avg.add(m)
      avg.divideScalar(members.length)
      avg.y += 1.2 + (i % 4) * 0.15
      posByKey.set(sys.id, avg)
    } else {
      posByKey.set(sys.id, buildingTop.clone().add(new Vector3(0.4 * ((i % 5) - 2), 0.8 + i * 0.1, 0.4 * Math.floor(i / 5))))
    }
  }

  // 아직 자리가 없는 엔티티(외곽선 없는 방, 미배치 설비, BIM 과 안 이어진 IDF 설비 등)는 소속 층·건물 기둥 둘레에 놓는다.
  // 엔티티는 Map 으로 찾는다. 배열을 훑으면 성수처럼 자리 없는 설비가 많은 파일에서 엔티티 수의 제곱이 된다.
  const entityByKey = new Map(reading.entities.map((e) => [e.key, e] as const))
  const ensurePos = (key: string, idx: number): Vector3 => {
    const had = posByKey.get(key)
    if (had) return had
    const ent = entityByKey.get(key)
    const base = (ent?.locations[0] ? posByKey.get(ent.locations[0]) : null) ?? storeyNodes[0] ?? buildingTop
    const angle = idx * 2.399963229728653
    const r = 0.5 + (idx % 5) * 0.15
    const v = new Vector3(base.x + Math.cos(angle) * r, base.y + 0.25 + (idx % 4) * 0.12, base.z + Math.sin(angle) * r)
    posByKey.set(key, v)
    return v
  }
  reading.entities.forEach((e, i) => ensurePos(e.key, i + 1))

  // 같은 자리에 겹친 엔티티(분전반 안 차단기 등)는 살짝 비켜 두어 길이가 0 인 선분이 생기지 않게 한다.
  const occupied = new Set<string>()
  let nudgeIdx = 1
  for (const [, v] of posByKey) {
    const snap = `${Math.round(v.x * 200)},${Math.round(v.y * 200)},${Math.round(v.z * 200)}`
    if (occupied.has(snap)) {
      const a = nudgeIdx * 2.399963229728653
      v.x += Math.cos(a) * 0.04
      v.y += 0.02 * ((nudgeIdx % 5) + 1)
      v.z += Math.sin(a) * 0.04
      nudgeIdx++
    } else {
      occupied.add(snap)
    }
  }

  const equipById = new Map(model.storeys.flatMap((s) => s.equipment.map((e) => [e.id, e] as const)))
  const hvacEquipIds = new Set((model.hvac?.equipment ?? []).map((e) => e.id))
  const classColorMap = classColorsOf(model)

  const pointPositions: number[] = []
  const pointColors: number[] = []
  const tmpColor = new Color()

  const feedSegments: FlowSegment[] = []
  const locPositions: number[] = []
  const partPositions: number[] = []
  let feedsCount = 0
  let locCount = 0
  let partCount = 0

  const tmpMid = new Vector3()
  const tmpA = new Vector3()
  const tmpB = new Vector3()

  for (let i = 0; i < reading.entities.length; i++) {
    const e = reading.entities[i]
    const fromPos = ensurePos(e.key, i + 100)

    const eq = equipById.get(e.key)
    if (eq || hvacEquipIds.has(e.key)) {
      const cls = eq ? classOf(eq) : `${e.ns}:${e.cls}`
      const hex = cls.startsWith('ex:') ? UNKNOWN_CLASS_COLOR : (classColorMap.get(cls) ?? CLASS_PALETTE[0])
      tmpColor.setHex(hex)
      pointPositions.push(fromPos.x, fromPos.y, fromPos.z)
      pointColors.push(tmpColor.r, tmpColor.g, tmpColor.b)
    }

    for (const target of e.feeds) {
      const toPos = ensurePos(target, feedsCount + 1000)
      feedSegments.push({ from: e.key, to: target, strong: true, a: fromPos, b: toPos })
      feedsCount++
    }
    for (const loc of e.locations) {
      const toPos = ensurePos(loc, locCount + 5000)
      locPositions.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z)
      locCount++
    }
    for (const part of e.parts) {
      const p0 = ensurePos(part, partCount + 9000)
      const p1 = fromPos
      const dist = p0.distanceTo(p1)
      tmpMid.copy(p0).lerp(p1, 0.5)
      tmpMid.y += Math.max(0.6, dist * 0.16)
      for (let s = 0; s < CURVE_STEPS; s++) {
        const t0 = s / CURVE_STEPS
        const t1 = (s + 1) / CURVE_STEPS
        const u0 = 1 - t0
        const u1 = 1 - t1
        tmpA.set(
          u0 * u0 * p0.x + 2 * u0 * t0 * tmpMid.x + t0 * t0 * p1.x,
          u0 * u0 * p0.y + 2 * u0 * t0 * tmpMid.y + t0 * t0 * p1.y,
          u0 * u0 * p0.z + 2 * u0 * t0 * tmpMid.z + t0 * t0 * p1.z,
        )
        tmpB.set(
          u1 * u1 * p0.x + 2 * u1 * t1 * tmpMid.x + t1 * t1 * p1.x,
          u1 * u1 * p0.y + 2 * u1 * t1 * tmpMid.y + t1 * t1 * p1.y,
          u1 * u1 * p0.z + 2 * u1 * t1 * tmpMid.z + t1 * t1 * p1.z,
        )
        partPositions.push(tmpA.x, tmpA.y, tmpA.z, tmpB.x, tmpB.y, tmpB.z)
      }
      partCount++
    }
  }

  // 물리존 바닥 중심 고리와 층 기둥 마디
  const markerPositions: number[] = []
  for (const c of spaceCenters) ringSegments(markerPositions, c, 0.55, 16)
  if (storeyNodes.length) {
    const low = storeyNodes[0]
    markerPositions.push(low.x, low.y, low.z, buildingTop.x, buildingTop.y, buildingTop.z)
    for (const node of storeyNodes) ringSegments(markerPositions, node, 0.85, 12)
    ringSegments(markerPositions, buildingTop, 0.65, 12)
  }

  const scene = new Scene()
  const disposables: { dispose(): void }[] = []

  const markerGeo = new BufferGeometry()
  markerGeo.setAttribute('position', new BufferAttribute(new Float32Array(markerPositions), 3))
  const markerMat = new LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.55, depthTest: false })
  scene.add(new LineSegments(markerGeo, markerMat))
  disposables.push(markerGeo, markerMat)

  const locGeo = new BufferGeometry()
  locGeo.setAttribute('position', new BufferAttribute(new Float32Array(locPositions), 3))
  const locMat = new LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.42, depthTest: false })
  scene.add(new LineSegments(locGeo, locMat))
  disposables.push(locGeo, locMat)

  const partGeo = new BufferGeometry()
  partGeo.setAttribute('position', new BufferAttribute(new Float32Array(partPositions), 3))
  const partMat = new LineBasicMaterial({ color: 0xa78bfa, transparent: true, opacity: 0.52, depthTest: false })
  scene.add(new LineSegments(partGeo, partMat))
  disposables.push(partGeo, partMat)

  const pointsGeo = new BufferGeometry()
  pointsGeo.setAttribute('position', new BufferAttribute(new Float32Array(pointPositions), 3))
  pointsGeo.setAttribute('color', new BufferAttribute(new Float32Array(pointColors), 3))
  const pointsMat = new PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthTest: false })
  scene.add(new Points(pointsGeo, pointsMat))
  disposables.push(pointsGeo, pointsMat)

  const feedsMesh = flowPulseMesh(feedSegments, 0x38bdf8, dark)
  if (feedsMesh) {
    scene.add(feedsMesh)
    disposables.push(feedsMesh.geometry, feedsMesh.material as ShaderMaterial)
  }

  // 덕트·배관(fso:)과 그 밖에 받는 쪽이 읽지 않는 것을 따로 센다. 섞어 세면 HUD 가 세는 것의 이름을 틀린다.
  const unreadConduits = reading.unread.filter((u) => u.cls.startsWith('fso:')).length
  const buildMs = Math.round((performance.now() - t0) * 10) / 10

  const stats: XrayStats = {
    feeds: feedsCount,
    hasLocation: locCount,
    hasPart: partCount,
    unread: unreadConduits,
    unreadOther: reading.unread.length - unreadConduits,
    graph: {
      points: pointPositions.length / 3,
      feeds: (feedsMesh?.userData.flowSegments as number | undefined) ?? 0,
      hasLocation: locPositions.length / 6,
      hasPart: partPositions.length / (6 * CURVE_STEPS),
    },
    buildMs,
  }

  // 선이 많을수록 옅게 칠한다. 성수는 hasPart 가 2만 개라 같은 짙기면 보라색 덩어리가 되어 feeds·점을 덮었다. 수는 그대로다.
  const thin = (n: number) => Math.min(1, Math.sqrt(1500 / Math.max(1, n)))
  const locBase = 0.42 * thin(locCount)
  const partBase = 0.52 * thin(partCount)

  return {
    scene,
    stats,
    feedsMesh,
    setOpacity(alpha: number, isDark: boolean) {
      markerMat.opacity = 0.55 * alpha
      locMat.opacity = locBase * alpha
      partMat.opacity = partBase * alpha
      pointsMat.opacity = 0.95 * alpha
      if (feedsMesh) {
        const u = (feedsMesh.material as ShaderMaterial).uniforms
        u.uDark.value = isDark ? 1 : 0
        feedsMesh.visible = alpha > 0.01
      }
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t.isContentEditable) return true
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || !!t.closest('dialog[open]')
}

export function enable(ctx: EggContext): EggHandle {
  const hud = ctx.hud
  hud.style.cssText =
    'padding:0.45rem 0.65rem;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--surface) 90%,transparent);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg)'
  const line1 = document.createElement('div')
  line1.dataset.testid = 'egg-xray-line1'
  const line2 = document.createElement('div')
  line2.dataset.testid = 'egg-xray-line2'
  line2.style.color = 'var(--muted)'
  hud.append(line1, line2)

  // 어두운 막(바탕색 85%): 건물 재질을 건드리지 않고 afterRender 에서 화면 전체 사각형으로 먼저 덮는다.
  const backdropScene = new Scene()
  const backdropCam = new Camera()
  const backdropGeo = new PlaneGeometry(2, 2)
  const backdropMat = new MeshBasicMaterial({
    color: 0x12151c,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  })
  backdropScene.add(new Mesh(backdropGeo, backdropMat))

  let built: BuiltGraph | null = null
  let builtVersion = -1
  let pointerInViewport = true
  let pointerButtons = 0
  let holding = false
  // 처음 켰을 때는 바로 보여 주고(target = 1), Space 를 눌렀다 떼면 0.2초에 물러난다(target = 0).
  let targetAlpha = 1
  let alpha = ctx.still() ? 1 : 0
  let fadeFrom = alpha
  let fadeAt = performance.now()
  /** 움직임 끄기면 alpha 가 바로 바뀌므로, 그 한 장을 그리라고 step 에 알린다. */
  let needsFrame = false

  function updateHud(stats: XrayStats) {
    line1.textContent = `받는 쪽이 읽는 관계 · feeds ${stats.feeds.toLocaleString()} · hasLocation ${stats.hasLocation.toLocaleString()} · hasPart ${stats.hasPart.toLocaleString()} · 화면에서만`
    const other = stats.unreadOther ? ` · 그 밖에 ${stats.unreadOther.toLocaleString()}개도 같은 이유로 뺐습니다` : ''
    line2.textContent = `덕트·배관(fso:) ${stats.unread.toLocaleString()}개는 받는 쪽이 읽지 않아 그리지 않았습니다${other}`
  }

  function ensureGraph(): BuiltGraph | null {
    const m = ctx.model()
    if (!m) return null
    const v = ctx.modelVersion()
    if (built && builtVersion === v) return built
    built?.dispose()
    line1.textContent = '그래프 짓는 중 · 화면에서만'
    line2.textContent = ''
    built = buildXrayGraph(m, ctx.dark())
    builtVersion = v
    updateHud(built.stats)
    return built
  }

  ensureGraph()

  function startFade(to: number) {
    if (targetAlpha === to) return
    targetAlpha = to
    if (ctx.still()) {
      alpha = to
      fadeFrom = to
      hud.style.opacity = String(to)
      needsFrame = true
      return
    }
    fadeFrom = alpha
    fadeAt = performance.now()
  }

  const onPointerMove = (e: PointerEvent) => {
    const el = e.target instanceof Element ? e.target : null
    pointerInViewport = !!el?.closest('.viewport')
    pointerButtons = e.buttons
  }
  const onPointerDown = (e: PointerEvent) => {
    pointerButtons = e.buttons
  }
  const onPointerUp = (e: PointerEvent) => {
    pointerButtons = e.buttons
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    if (ctx.signals.replaying.value || isEditableTarget(e.target)) return
    // 끌기·그리기 도구(십자 커서)가 도는 동안은 가로채지 않는다(G9).
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas')
    if (pointerButtons !== 0 || canvas?.style.cursor === 'crosshair') return
    if (!pointerInViewport && document.activeElement && document.activeElement !== document.body && !document.activeElement.closest('.viewport')) return
    e.preventDefault()
    if (!holding) {
      holding = true
      ensureGraph()
      startFade(1)
    }
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return
    if (holding) {
      holding = false
      startFade(0)
    }
  }

  const onBlur = () => {
    pointerButtons = 0
    if (holding) {
      holding = false
      startFade(0)
    }
  }

  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerdown', onPointerDown, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  // 편집 뒤 0.25초 모았다가 한 번 다시 짓는다(성수에서 한 번에 0.4초). 그사이에는 지어 둔 그래프를 그대로 보인다.
  let timer: ReturnType<typeof setTimeout> | null = null
  const stopModelWatch = watch(
    () => ctx.modelVersion(),
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (alpha > 0 || targetAlpha > 0) {
          ensureGraph()
          needsFrame = true
        }
      }, REBUILD_SETTLE_MS)
    },
  )

  ctx.addLayer({
    step(now) {
      if (ctx.still()) {
        alpha = targetAlpha
        hud.style.opacity = String(alpha)
        const draw = needsFrame
        needsFrame = false
        return draw
      }
      let dirty = needsFrame
      needsFrame = false
      if (alpha !== targetAlpha) {
        const dur = targetAlpha > fadeFrom ? FADE_IN_MS : FADE_OUT_MS
        const t = Math.min(1, Math.max(0, (now - fadeAt) / dur))
        const k = easeOut(t)
        alpha = fadeFrom + (targetAlpha - fadeFrom) * k
        if (t >= 1) alpha = targetAlpha
        hud.style.opacity = String(Number(alpha.toFixed(3)))
        dirty = true
      }
      if (holding && alpha > 0.01 && built?.feedsMesh) {
        setFlowTime(built.feedsMesh, now / 1000)
        dirty = true
      }
      return dirty
    },
    afterRender({ renderer, camera }) {
      if (alpha <= 0.001) return
      // 지어 둔 것이 있으면 낡았어도 그대로 그린다. 다시 짓기는 위 watch 가 모아서 한다.
      const g = built ?? ensureGraph()
      if (!g) return
      const isDark = ctx.dark()
      backdropMat.color.setHex(isDark ? 0x111318 : 0x161922)
      backdropMat.opacity = 0.85 * alpha
      g.setOpacity(alpha, isDark)
      if (ctx.still() && g.feedsMesh) setFlowTime(g.feedsMesh, 0)

      const prevAutoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(backdropScene, backdropCam)
      renderer.clearDepth()
      renderer.render(g.scene, camera)
      renderer.autoClear = prevAutoClear
    },
    dispose() {
      built?.dispose()
      built = null
      backdropGeo.dispose()
      backdropMat.dispose()
    },
  })

  return {
    off() {
      stopModelWatch()
      if (timer) clearTimeout(timer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
    inspect() {
      // 여기서 짓지 않는다. 편집을 따라 다시 짓는지는 builtVersion 으로 본다.
      return {
        ...(built?.stats ?? { feeds: 0, hasLocation: 0, hasPart: 0, unread: 0, unreadOther: 0, graph: { points: 0, feeds: 0, hasLocation: 0, hasPart: 0 }, buildMs: 0 }),
        builtVersion,
        modelVersion: ctx.modelVersion(),
        holding,
        alpha: Number(alpha.toFixed(3)),
        hud: hud.textContent,
      }
    },
  }
}
