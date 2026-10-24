// S4. 해가 지나가는 건물(sun) — IfcSite 위도·경도와 TrueNorth 로 해 자리와 그림자를 그린다(docs/plans/easter-eggs.md).
//
// - 위도·경도는 model.site(IfcSite.RefLatitude·RefLongitude), 진북은 model.site.trueNorth(IfcGeometricRepresentationContext.TrueNorth)에서 읽는다.
// - 파일에 대지 좌표가 없으면 서울시청(37.5665, 126.9780)과 +y 를 북으로 쓰고, HUD 에 "이 파일에는 대지 좌표가 없어 서울 기준으로 그렸습니다" 를 적는다.
// - 해 자리는 외부 라이브러리 없이 NOAA 근사식으로 계산한다(서울 기준 하지 최고 고도 약 75.9° · 동지 약 29.0°).
// - 그림자 맵은 renderer.shadowMap.autoUpdate = false 로 두고 해 자리나 모델이 바뀔 때만 needsUpdate = true 를 걸어,
//   카메라를 돌려도 그림자 맵을 다시 그리지 않고 가만히 있을 때는 0장이다.
// - 땅은 불투명한 판이다(해가 비추고 그림자를 받는다). 내려다보면 화면 대부분이 지평선 아래인데 Sky 는 거기를 지평선의 옅은 연무색으로
//   칠해서, 그림자만 받는 투명한 판일 때는 바탕 전체가 하얗게 떠 건물이 묻혔다.
// - 하늘(Sky)은 제 셰이더 안에서 노출을 낮추고 ACES 로 눌러 칠한다. Sky 는 렌더러의 톤 매핑(ACES · 노출 0.5)을 전제로 밝기를 내는데
//   편집기 3D 는 톤 매핑을 쓰지 않아서, 그대로 두면 하늘이 하얗게 타 건물·HUD 가 묻혔다. 렌더러 톤 매핑을 켜면 건물 재질 색이 다 바뀐다.
import {
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  MeshLambertMaterial,
  type ShaderMaterial,
  Vector3,
  type WebGLRenderer,
  type Scene,
} from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { watch } from 'vue'
import type { Model, Vec2 } from '../lib/model'
import { toScene } from '../lib/viewer'
import type { EggContext, EggHandle } from './types'

export const SEOUL_LAT = 37.5665
export const SEOUL_LON = 126.978

export type SiteResolved = {
  latitude: number
  longitude: number
  trueNorth: Vec2
  hasSiteCoords: boolean
  hasTrueNorth: boolean
}

export type SolarPosition = {
  /** 태양 고도각(도, 지평선 위가 양수). */
  altitudeDeg: number
  /** 진북 기준 시계 방향 방위각(도, 0=북 · 90=동 · 180=남 · 270=서). */
  azimuthDeg: number
  /** 태양 적위(도). */
  declinationDeg: number
  /** 동(+x)·북(+y)·위(+z) 단위 벡터 성분. */
  east: number
  north: number
  up: number
}

/** 땅 색(테마별). 회색에 색을 섞지 않는다(ui-notes: 세피아로 보였다). */
const GROUND_DARK = 0x2c2f35
const GROUND_LIGHT = 0x9a9ea6
/** 땅 판의 한 변(m). 내려다볼 때 지평선 아래를 거의 다 덮는 크기다. */
const GROUND_SIZE = 4000

/** 하늘에만 거는 노출(three 의 Sky 예제가 쓰는 값). */
const SKY_EXPOSURE = 0.5
/** three 의 ACESFilmicToneMapping 과 같은 식. 렌더러 톤 매핑이 꺼져 있으면 그 함수가 셰이더에 들지 않아 여기 따로 둔다. */
const SKY_TONE_GLSL = /* glsl */ `
vec3 eggSkyRrt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 eggSkyAces(vec3 color) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= ${SKY_EXPOSURE.toFixed(2)} / 0.6;
  return clamp(outM * eggSkyRrt(inM * color), 0.0, 1.0);
}
`

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

/** 경도에 맞는 표준 시간대(시). 한국 경도 대역(124~132°E)은 KST(+9)를 쓴다. */
export function defaultTzOffset(lonDeg: number): number {
  if (lonDeg >= 124 && lonDeg <= 132) return 9
  return Math.round(lonDeg / 15)
}

/**
 * NOAA 일반 태양 위치 근사식(gml.noaa.gov/grad/solcalc/calcdetails.html).
 * `dayOfYear` 는 1~365, `minutesOfDay` 는 0~1440(지방 표준시 기준 분)이다.
 */
export function solarPosition(
  latDeg: number,
  lonDeg: number,
  dayOfYear: number,
  minutesOfDay: number,
  tzOffsetHours = defaultTzOffset(lonDeg),
): SolarPosition {
  const day = Math.max(1, Math.min(365, dayOfYear))
  const mins = Math.max(0, Math.min(1440, minutesOfDay))
  const gamma = ((2 * Math.PI) / 365) * (day - 1 + (mins / 60 - 12) / 24)

  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  const timeOffset = eqtime + 4 * lonDeg - 60 * tzOffsetHours
  const tst = mins + timeOffset
  const ha = (tst / 4 - 180) * DEG_TO_RAD
  const lat = latDeg * DEG_TO_RAD

  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const sinDecl = Math.sin(decl)
  const cosDecl = Math.cos(decl)
  const cosHa = Math.cos(ha)
  const sinHa = Math.sin(ha)

  const up = Math.max(-1, Math.min(1, sinLat * sinDecl + cosLat * cosDecl * cosHa))
  const east = -cosDecl * sinHa
  const north = cosLat * sinDecl - sinLat * cosDecl * cosHa
  const horiz = Math.hypot(east, north)
  const norm = Math.hypot(horiz, up) || 1

  const altitudeDeg = Math.asin(up) * RAD_TO_DEG
  const azimuthDeg = ((Math.atan2(east, north) * RAD_TO_DEG) + 360) % 360

  return {
    altitudeDeg,
    azimuthDeg,
    declinationDeg: decl * RAD_TO_DEG,
    east: east / norm,
    north: north / norm,
    up: up / norm,
  }
}

/** 주어진 날(1~365)의 하루 최고 태양 고도각(도). */
export function maxSolarAltitude(
  latDeg: number,
  lonDeg: number,
  dayOfYear: number,
  tzOffsetHours = defaultTzOffset(lonDeg),
): number {
  let best = -90
  for (let m = 660; m <= 840; m += 1) {
    const { altitudeDeg } = solarPosition(latDeg, lonDeg, dayOfYear, m, tzOffsetHours)
    if (altitudeDeg > best) best = altitudeDeg
  }
  return best
}

/** 모델에서 대지 좌표와 진북 방향을 읽고, 없으면 서울시청(37.5665, 126.9780)과 +y 로 채운다. */
export function resolveSite(model: Readonly<Model> | null): SiteResolved {
  const lat = model?.site?.latitude
  const lon = model?.site?.longitude
  const hasSiteCoords = typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon)
  const rawNorth = model?.site?.trueNorth
  let trueNorth: Vec2 = [0, 1]
  let hasTrueNorth = false
  if (rawNorth && Number.isFinite(rawNorth[0]) && Number.isFinite(rawNorth[1])) {
    const len = Math.hypot(rawNorth[0], rawNorth[1])
    if (len > 1e-6) {
      trueNorth = [rawNorth[0] / len, rawNorth[1] / len]
      hasTrueNorth = true
    }
  }
  return {
    latitude: hasSiteCoords ? lat! : SEOUL_LAT,
    longitude: hasSiteCoords ? lon! : SEOUL_LON,
    trueNorth,
    hasSiteCoords,
    hasTrueNorth,
  }
}

/** 동·북·위 태양 벡터와 진북 단위 벡터(IFC 평면)를 three.js 장면 방향 벡터로 바꾼다. */
export function sunSceneDirection(pos: Pick<SolarPosition, 'east' | 'north' | 'up'>, trueNorth: Vec2): Vector3 {
  const [nx, ny] = trueNorth
  // IFC 평면에서 북이 (nx, ny) 이면 동(시계 90°)은 (ny, -nx) 다.
  const ifcX = pos.east * ny + pos.north * nx
  const ifcY = -pos.east * nx + pos.north * ny
  const ifcZ = pos.up
  return new Vector3(...toScene([ifcX, ifcY, ifcZ])).normalize()
}

type Bounds = {
  cx: number
  cy: number
  cz: number
  minY: number
  radius: number
}

function measureBounds(model: Readonly<Model> | null): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  const touch = (ifcX: number, ifcY: number, ifcZ: number) => {
    const [sx, sy, sz] = toScene([ifcX, ifcY, ifcZ])
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz)) return
    if (sx < minX) minX = sx
    if (sx > maxX) maxX = sx
    if (sy < minY) minY = sy
    if (sy > maxY) maxY = sy
    if (sz < minZ) minZ = sz
    if (sz > maxZ) maxZ = sz
  }

  if (model) {
    for (const s of model.storeys) {
      for (const sp of s.spaces) {
        for (const p of sp.footprint) touch(p[0], p[1], s.elevation)
      }
      for (const e of s.equipment) {
        if (e.position) touch(e.position[0], e.position[1], e.position[2])
      }
      for (const w of s.walls) {
        for (const ring of w.footprint ?? []) {
          for (const p of ring) touch(p[0], p[1], s.elevation + (w.height ?? 3))
        }
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return { cx: 0, cy: 1.5, cz: 0, minY: 0, radius: 15 }
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  const radius = Math.max(12, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2)
  return { cx, cy, cz, minY, radius }
}

/** 바닥에 놓는 진북 화살표와 N 표지(텍스처 없이 형상만으로 짓는다). */
function buildNorthArrow(disposables: { dispose(): void }[]): Group {
  const group = new Group()
  group.name = 'egg-sun-north'

  // 화살촉(삼각형) + 몸통을 XZ 평면(-Z 가 북쪽 기본 방향)에 눕힌다.
  const bodyGeo = new BufferGeometry()
  bodyGeo.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        // 화살촉 삼각형
        0, 0, -2.4,
        -0.55, 0, -1.2,
        0.55, 0, -1.2,
        // 화살 기둥(사각형 두 삼각형)
        -0.18, 0, -1.2,
        -0.18, 0, 0.8,
        0.18, 0, -1.2,
        0.18, 0, -1.2,
        -0.18, 0, 0.8,
        0.18, 0, 0.8,
      ],
      3,
    ),
  )
  const bodyMat = new MeshBasicMaterial({ color: 0xef4444, side: DoubleSide })
  const bodyMesh = new Mesh(bodyGeo, bodyMat)
  group.add(bodyMesh)
  disposables.push(bodyGeo, bodyMat)

  // 화살표 앞의 'N' 글자 선분과 원형 테두리
  const linePts: number[] = [
    -0.35, 0.01, -2.75, -0.35, 0.01, -3.45,
    -0.35, 0.01, -3.45, 0.35, 0.01, -2.75,
    0.35, 0.01, -2.75, 0.35, 0.01, -3.45,
  ]
  const segs = 24
  const r = 1.65
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2
    const a1 = ((i + 1) / segs) * Math.PI * 2
    linePts.push(
      Math.sin(a0) * r, 0.01, Math.cos(a0) * r - 0.8,
      Math.sin(a1) * r, 0.01, Math.cos(a1) * r - 0.8,
    )
  }
  const lineGeo = new BufferGeometry()
  lineGeo.setAttribute('position', new Float32BufferAttribute(linePts, 3))
  const lineMat = new LineBasicMaterial({ color: 0xef4444 })
  const lines = new LineSegments(lineGeo, lineMat)
  group.add(lines)
  disposables.push(lineGeo, lineMat)

  return group
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function formatDayOfYear(dayOfYear: number): string {
  let rem = Math.max(1, Math.min(365, Math.round(dayOfYear)))
  for (let m = 0; m < MONTH_DAYS.length; m++) {
    if (rem <= MONTH_DAYS[m]) return `${m + 1}월 ${rem}일`
    rem -= MONTH_DAYS[m]
  }
  return '12월 31일'
}

export function formatMinutesOfDay(minutesOfDay: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutesOfDay)))
  const hh = String(Math.floor(m / 60) % 24).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

export function enable(ctx: EggContext): EggHandle {
  const restoreLights = ctx.lights({ hemi: 0.55, sun: 0.2 })

  const hud = ctx.hud
  hud.style.cssText =
    'pointer-events:auto;display:flex;flex-direction:column;gap:0.35rem;padding:0.5rem 0.7rem;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--surface) 92%,transparent);font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg);min-width:21rem'

  const disposables: { dispose(): void }[] = []
  const root = new Group()
  root.name = 'egg-sun-root'

  const sky = new Sky()
  sky.scale.setScalar(4500)
  sky.frustumCulled = false
  const skyUniforms = (sky.material as ShaderMaterial).uniforms
  skyUniforms.turbidity.value = 2.4
  skyUniforms.rayleigh.value = 1.15
  skyUniforms.mieCoefficient.value = 0.005
  skyUniforms.mieDirectionalG.value = 0.8
  skyUniforms.cloudCoverage.value = 0
  const skyMat = sky.material as ShaderMaterial
  skyMat.fragmentShader =
    SKY_TONE_GLSL + skyMat.fragmentShader.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = eggSkyAces(gl_FragColor.rgb);')
  root.add(sky)
  disposables.push(sky.geometry, sky.material as ShaderMaterial)

  const sunLight = new DirectionalLight(0xfff5e0, 1.85)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.bias = -0.0005
  // 해는 렌더러의 그림자를 켠 다음에 얹는다(afterRender 의 첫 장). 재질 셰이더는 빛이 바뀔 때 다시 지어지는데, 그림자를 켜기 전에
  // 해를 얹으면 그 한 번이 "그림자 꺼짐" 으로 지어지고, 그 뒤 그림자를 켜도 다시 짓지 않아 그림자가 하나도 안 생겼다.

  const groundGeo = new PlaneGeometry(1, 1)
  groundGeo.rotateX(-Math.PI / 2)
  const groundMat = new MeshLambertMaterial({ color: ctx.dark() ? GROUND_DARK : GROUND_LIGHT })
  const groundPlane = new Mesh(groundGeo, groundMat)
  groundPlane.receiveShadow = true
  root.add(groundPlane)
  disposables.push(groundGeo, groundMat)

  const northArrow = buildNorthArrow(disposables)
  root.add(northArrow)

  // 기본 날짜·시각: 하지(172일, 6월 21일) 오후 2시(840분) — 해와 그림자가 또렷한 시각.
  let dayOfYear = 172
  let minutesOfDay = 840
  let site: SiteResolved = resolveSite(ctx.model())
  let bounds: Bounds = measureBounds(ctx.model())
  let currentSolar: SolarPosition = solarPosition(site.latitude, site.longitude, dayOfYear, minutesOfDay)
  let shadowDirty = true
  let needsFrame = false
  let shadowUpdates = 0

  let hookedRenderer: WebGLRenderer | null = null
  let prevShadowEnabled = false
  let prevShadowAutoUpdate = true
  const savedMeshes = new Map<Mesh, { cast: boolean; receive: boolean }>()

  const doc = hud.ownerDocument ?? (typeof document !== 'undefined' ? document : null)
  let summaryEl: HTMLElement | null = null
  let dayLabelEl: HTMLElement | null = null
  let timeLabelEl: HTMLElement | null = null
  let dayInputEl: HTMLInputElement | null = null
  let timeInputEl: HTMLInputElement | null = null
  const cleanups: (() => void)[] = []

  if (doc) {
    summaryEl = doc.createElement('div')
    summaryEl.dataset.testid = 'egg-sun-summary'

    const controlsRow = doc.createElement('div')
    controlsRow.style.cssText = 'display:grid;grid-template-columns:auto 5.2rem 1fr;align-items:center;gap:0.35rem 0.5rem;color:var(--muted)'

    const dayTitle = doc.createElement('span')
    dayTitle.textContent = '날짜'
    dayLabelEl = doc.createElement('span')
    dayLabelEl.style.color = 'var(--fg)'
    dayInputEl = doc.createElement('input')
    dayInputEl.type = 'range'
    dayInputEl.min = '1'
    dayInputEl.max = '365'
    dayInputEl.step = '1'
    dayInputEl.value = String(dayOfYear)
    dayInputEl.dataset.testid = 'egg-sun-day'
    dayInputEl.setAttribute('aria-label', '해 날짜')

    const timeTitle = doc.createElement('span')
    timeTitle.textContent = '시각'
    timeLabelEl = doc.createElement('span')
    timeLabelEl.style.color = 'var(--fg)'
    timeInputEl = doc.createElement('input')
    timeInputEl.type = 'range'
    timeInputEl.min = '300'
    timeInputEl.max = '1260'
    timeInputEl.step = '5'
    timeInputEl.value = String(minutesOfDay)
    timeInputEl.dataset.testid = 'egg-sun-time'
    timeInputEl.setAttribute('aria-label', '해 시각')

    const stopProp = (e: Event) => e.stopPropagation()
    const onDayInput = () => {
      dayOfYear = Number(dayInputEl!.value) || 172
      updateSun(true)
    }
    const onTimeInput = () => {
      minutesOfDay = Number(timeInputEl!.value) || 840
      updateSun(true)
    }

    for (const el of [dayInputEl, timeInputEl]) {
      el.addEventListener('pointerdown', stopProp)
      el.addEventListener('keydown', stopProp)
      cleanups.push(() => {
        el.removeEventListener('pointerdown', stopProp)
        el.removeEventListener('keydown', stopProp)
      })
    }
    dayInputEl.addEventListener('input', onDayInput)
    timeInputEl.addEventListener('input', onTimeInput)
    cleanups.push(
      () => dayInputEl?.removeEventListener('input', onDayInput),
      () => timeInputEl?.removeEventListener('input', onTimeInput),
    )

    controlsRow.append(dayTitle, dayLabelEl, dayInputEl, timeTitle, timeLabelEl, timeInputEl)
    hud.append(summaryEl, controlsRow)
  }

  function updateHudText() {
    const northAngle = Math.round(((Math.atan2(site.trueNorth[0], site.trueNorth[1]) * RAD_TO_DEG) + 360) % 360)
    const northText = !site.hasTrueNorth ? '없음(+y 로 그림)' : northAngle === 0 ? '+y(0°)' : `${northAngle}°`
    const altText = currentSolar.altitudeDeg.toFixed(1)
    const azText = Math.round(currentSolar.azimuthDeg)
    const coordNote = site.hasSiteCoords
      ? `대지 ${site.latitude.toFixed(4)}°N, ${site.longitude.toFixed(4)}°E`
      : '이 파일에는 대지 좌표가 없어 서울 기준으로 그렸습니다'
    const line = `${coordNote} · 진북 ${northText} · 고도 ${altText}° · 방위 ${azText}° · 화면에서만`
    if (summaryEl) {
      summaryEl.textContent = line
      if (dayLabelEl) dayLabelEl.textContent = formatDayOfYear(dayOfYear)
      if (timeLabelEl) timeLabelEl.textContent = formatMinutesOfDay(minutesOfDay)
    } else {
      hud.textContent = `${line} · ${formatDayOfYear(dayOfYear)} ${formatMinutesOfDay(minutesOfDay)}`
    }
  }

  function updateSun(requestRender: boolean) {
    currentSolar = solarPosition(site.latitude, site.longitude, dayOfYear, minutesOfDay)
    const dir = sunSceneDirection(currentSolar, site.trueNorth)
    skyUniforms.sunPosition.value.copy(dir)

    const dist = Math.max(30, bounds.radius * 2.6)
    sunLight.target.position.set(bounds.cx, bounds.minY, bounds.cz)
    sunLight.position.copy(sunLight.target.position).addScaledVector(dir, dist)
    sunLight.intensity = currentSolar.altitudeDeg > 0 ? 1.85 : 0.05
    sunLight.target.updateMatrixWorld()
    sunLight.updateMatrixWorld()

    updateHudText()
    shadowDirty = true
    if (requestRender) needsFrame = true
  }

  function rebuildBoundsAndSite(requestRender: boolean) {
    const m = ctx.model()
    site = resolveSite(m)
    bounds = measureBounds(m)

    const span = Math.max(16, bounds.radius * 1.45)
    sunLight.shadow.camera.left = -span
    sunLight.shadow.camera.right = span
    sunLight.shadow.camera.top = span
    sunLight.shadow.camera.bottom = -span
    sunLight.shadow.camera.near = 0.5
    sunLight.shadow.camera.far = Math.max(80, bounds.radius * 6)
    sunLight.shadow.camera.updateProjectionMatrix()

    groundPlane.scale.set(GROUND_SIZE, 1, GROUND_SIZE)
    groundPlane.position.set(bounds.cx, bounds.minY - 0.02, bounds.cz)

    // 진북 화살표: 건물 앞바닥 가장자리에 놓고 진북 방향으로 돌린다.
    const arrowScale = Math.max(0.8, Math.min(2.4, bounds.radius * 0.08))
    northArrow.scale.setScalar(arrowScale)
    northArrow.position.set(bounds.cx + bounds.radius * 0.85, bounds.minY + 0.04, bounds.cz + bounds.radius * 0.65)
    // 기본 화살표는 -Z(IFC +y)를 가리킨다. trueNorth = (nx, ny) 는 장면에서 (nx, 0, -ny) 다.
    northArrow.rotation.y = -Math.atan2(site.trueNorth[0], site.trueNorth[1])

    updateSun(requestRender)
  }

  function tagSceneShadowMeshes(scene: Scene) {
    scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      if (obj === sky || obj === groundPlane || northArrow.children.includes(obj)) return
      // 반투명한 것(다른 egg 의 흐르는 빛·층판, 강조 막)은 건물이 아니다. 그림자를 드리우면 바닥에 선 그림자가 생긴다.
      if (([] as { transparent?: boolean }[]).concat(obj.material).some((m) => m?.transparent)) return
      if (!savedMeshes.has(obj)) {
        savedMeshes.set(obj, { cast: obj.castShadow, receive: obj.receiveShadow })
      }
      obj.castShadow = true
      obj.receiveShadow = true
    })
  }

  rebuildBoundsAndSite(false)

  const stopModelWatch = watch(
    () => ctx.modelVersion(),
    () => rebuildBoundsAndSite(true),
  )
  const stopDarkWatch = watch(
    () => ctx.dark(),
    (d) => {
      groundMat.color.setHex(d ? GROUND_DARK : GROUND_LIGHT)
      needsFrame = true
    },
  )

  ctx.addLayer({
    object: root,
    step() {
      if (!needsFrame) return false
      needsFrame = false
      return true
    },
    afterRender({ renderer, scene }) {
      if (!hookedRenderer) {
        hookedRenderer = renderer
        prevShadowEnabled = renderer.shadowMap.enabled
        prevShadowAutoUpdate = renderer.shadowMap.autoUpdate
        renderer.shadowMap.enabled = true
        renderer.shadowMap.autoUpdate = false
        root.add(sunLight, sunLight.target)
        shadowDirty = true
      }
      // 그림자 맵은 다음 장에서 다시 그린다. 여기서 장면을 한 번 더 그리면 먼저 덧그린 다른 egg(xray 의 막)가 지워진다.
      if (shadowDirty) {
        tagSceneShadowMeshes(scene)
        renderer.shadowMap.needsUpdate = true
        shadowDirty = false
        shadowUpdates++
        needsFrame = true
      }
    },
    dispose() {
      for (const [mesh, flags] of savedMeshes) {
        mesh.castShadow = flags.cast
        mesh.receiveShadow = flags.receive
      }
      savedMeshes.clear()
      if (hookedRenderer) {
        hookedRenderer.shadowMap.enabled = prevShadowEnabled
        hookedRenderer.shadowMap.autoUpdate = prevShadowAutoUpdate
        hookedRenderer = null
      }
      sunLight.shadow.map?.dispose()
      sunLight.shadow.map = null
      sunLight.dispose()
      for (const d of disposables) d.dispose()
      root.clear()
    },
  })

  return {
    off() {
      stopModelWatch()
      stopDarkWatch()
      for (const fn of cleanups) fn()
      restoreLights()
    },
    inspect() {
      return {
        latitude: site.latitude,
        longitude: site.longitude,
        trueNorth: site.trueNorth,
        hasSiteCoords: site.hasSiteCoords,
        hasTrueNorth: site.hasTrueNorth,
        dayOfYear,
        minutesOfDay,
        altitudeDeg: Math.round(currentSolar.altitudeDeg * 100) / 100,
        azimuthDeg: Math.round(currentSolar.azimuthDeg * 10) / 10,
        shadowAutoUpdate: hookedRenderer ? hookedRenderer.shadowMap.autoUpdate : false,
        shadowUpdates,
        hud: hud.textContent,
      }
    },
  }
}
