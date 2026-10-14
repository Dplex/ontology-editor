// 수직 관통 오브젝트 편집(OE-ML-07 전체 이동 · OE-ML-09 삭제, ADR-0034). 다중층 뷰에서만 부른다(층 편집 화면은 읽기 전용, OE-ML-05).
//
// **오브젝트 단위로 고친다.** 오브젝트는 층별 조각의 묶음이라(ADR-0033) 옮기기는 모든 층 조각의 형상·진입/종료 지점에 같은 이동량을
// 더하고(층 사이 상대 위치가 그대로다), 지우기는 모든 층의 조각을 걷는다. 되돌리기는 모든 층의 조각 목록을 한 번에 떠 둔
// 스냅샷 하나다(edit.ts `verticals`) — 여러 층에 걸친 변경이 이력 하나다(OE-ML-01).
//
// **BIM 원본은 baseline 에 남고 고친 것은 보정이다.** 옮긴 조각에는 `edited` 를 단다(GeoJSON 이 원본과 보정을 가른다). 편집 파일은
// 연 때와 견준 이동량·지움만 적어(edit-file.ts `verticals`) 다시 열면 같은 GUID 의 계단에 다시 얹는다. 지운 계단은 다시 열어도
// 편집 파일이 다시 지운다 — 재임포트만으로 되살아나지 않는다(OE-ML-09).
//
// **연관 물리존·층간 연결은 저장하지 않으니 따로 고칠 것이 없다.** 진입·종료 지점이 드는 물리존을 그때 짚으므로(ADR-0033) 옮기면 새
// 자리의 물리존이, 지우면 겹침 추정(ADR-0032)이 그 자리를 잇는다. 형상이 닿았다고 새 연결을 확정하지 않는다(OE-ML-19).

import { distanceToRing, isSelfIntersecting, pointInPolygon } from './mapping'
import { shaftMembers } from './shaft'
import { overlapArea } from './polygon'
import { polygonArea, type ElevatorStop, type Model, type Storey, type Vec2, type Vec3, type VerticalKind, type VerticalPart } from './model'
import { partId, partSpaces, verticalObjects } from './vertical-object'

const mm = (v: number) => Math.round(v * 1000) / 1000

/** 조각의 기준점. 연 때와 견줘 얼마나 옮겼는지 잰다. 형상 첫 꼭짓점, 없으면 진입·종료 지점이다. */
export function partRef(part: VerticalPart): Vec2 | null {
  const p = part.footprint[0] ?? part.entry ?? part.exit
  return p ? [p[0], p[1]] : null
}

/** 오브젝트의 기준점 — 첫 층(높이 순) 조각의 기준점. */
export function verticalRef(model: Pick<Model, 'storeys'>, parentId: string): Vec2 | null {
  const o = verticalObjects(model).find((x) => x.id === parentId)
  for (const { part } of o?.parts ?? []) {
    const r = partRef(part)
    if (r) return r
  }
  return null
}

/**
 * 오브젝트를 x·y 로 옮긴다(OE-ML-07 "전체 이동"). 모든 층 조각의 형상·진입/종료 지점에 같은 이동량을 더한다. 높이는 그대로다.
 * 이동량이 0 이거나 오브젝트가 없으면 false. 좌표가 유한하지 않으면 적용하지 않는다("유효하지 않은 좌표는 적용하지 않는다").
 */
export function moveVertical(model: Pick<Model, 'storeys'>, parentId: string, d: Vec2): boolean {
  if (!Number.isFinite(d[0]) || !Number.isFinite(d[1]) || (d[0] === 0 && d[1] === 0)) return false
  let hit = false
  const shift3 = (p: Vec3 | null): Vec3 | null => (p ? [mm(p[0] + d[0]), mm(p[1] + d[1]), p[2]] : null)
  for (const storey of model.storeys) {
    for (const part of storey.verticalParts ?? []) {
      if (part.parentId !== parentId) continue
      part.footprint = part.footprint.map((p) => [mm(p[0] + d[0]), mm(p[1] + d[1])] as Vec2)
      part.entry = shift3(part.entry)
      part.exit = shift3(part.exit)
      part.edited = true
      hit = true
    }
  }
  return hit
}

// --- 회전 (OE-OBJ-15 AC6 · OE-ML-07 AC2 · OE-ML-02 평면 회전각) -------------------------------------------------
//
// 전체 회전은 모든 층 조각의 형상·진입/종료 지점을 같은 중심에서 같은 각도만큼 돌린다. 중심은 EL·샤프트가 공통 축(형상 가운데),
// 계단·ES 가 시작점(시작 층 진입 지점)이다. 각도는 평면 방위로, +x 에서 반시계로 잰 도(°)다.
//
// **각도를 따로 저장하지 않는다.** 방위는 형상에서 그때 잰다 — 계단·ES 는 시작점에서 끝점으로, EL·샤프트는 형상의 가장 긴 변의 방향이다.
// 돌리면 형상이 같이 도니 잰 값도 같이 돈다. 돌린 조각에는 `edited` 를 달아 보정으로 가르고, 편집 파일은 끝 모양을 통째로 적는다(평행이동이
// 아니라서, edit-file.ts 의 reshaped). BIM 원본 방향은 baseline 의 형상에 남는다.

/** 회전 자석 스냅의 허용 각도(°). OE-OBJ-15 "건물 축·가까운 벽 방향과 ±3° 안". */
export const HEADING_SNAP = 3
/** 가까운 벽으로 보는 거리(m). 이보다 먼 벽의 방향에는 붙지 않는다. 시험용 값이다. */
export const HEADING_WALL_RADIUS = 8

const norm360 = (a: number) => ((a % 360) + 360) % 360
/** 두 방위 사이의 가장 작은 차(°, 0~180). */
export const angleGap = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)
const dirOf = (a: readonly number[], b: readonly number[]) => norm360((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI)

/** 고리의 가장 긴 변(첫 번째)의 방향. 돌려도 같은 변이 가장 길어 같이 돈다. */
function longestEdgeDir(ring: readonly Vec2[]): number | null {
  let best = -1
  let dir: number | null = null
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len > best + 1e-9) {
      best = len
      dir = dirOf(a, b)
    }
  }
  return best > 1e-6 ? dir : null
}
const centroid = (ring: readonly Vec2[]): Vec2 => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]

/** 오브젝트의 회전 중심. EL·샤프트는 공통 축(형상 가운데), 계단·ES 는 시작점이다. 시작점이 없으면 시작 층 형상 가운데다. */
export function verticalPivot(model: Pick<Model, 'storeys'>, parentId: string): Vec2 | null {
  const o = verticalObjects(model).find((x) => x.id === parentId)
  if (!o) return null
  if (!COMMON_AXIS.has(o.kind)) {
    const entry = o.parts.find(({ part }) => part.entry)?.part.entry
    if (entry) return [entry[0], entry[1]]
  }
  const ring = o.parts.find(({ part }) => part.footprint.length >= 3)?.part.footprint
  return ring ? centroid(ring) : null
}

/** 오브젝트의 평면 방위(°). 계단·ES 는 시작점 → 끝점, EL·샤프트는 형상의 가장 긴 변 방향이다. 잴 수 없으면 null. */
export function verticalHeading(model: Pick<Model, 'storeys'>, parentId: string): number | null {
  const o = verticalObjects(model).find((x) => x.id === parentId)
  if (!o) return null
  if (!COMMON_AXIS.has(o.kind)) {
    const entry = o.parts.find(({ part }) => part.entry)?.part.entry
    const exit = [...o.parts].reverse().find(({ part }) => part.exit)?.part.exit
    if (entry && exit && Math.hypot(exit[0] - entry[0], exit[1] - entry[1]) > 0.05) return dirOf(entry, exit)
  }
  const ring = o.parts.find(({ part }) => part.footprint.length >= 2)?.part.footprint
  return ring ? longestEdgeDir(ring) : null
}

/**
 * 모든 층 조각을 `pivot` 둘레로 `deg` 만큼 돌린다(반시계가 +). 높이는 그대로다. 0° 이거나 숫자가 아니거나 오브젝트가 없으면 false.
 * 공통 축(샤프트·EL)은 모든 층이 같은 중심이라 축이 그대로 겹친다.
 */
export function rotateVertical(model: Pick<Model, 'storeys'>, parentId: string, deg: number, pivot = verticalPivot(model, parentId)): boolean {
  if (!pivot || !Number.isFinite(deg) || Math.abs(norm360(deg + 180) - 180) < 1e-9) return false
  const r = (deg * Math.PI) / 180
  const [c, s] = [Math.cos(r), Math.sin(r)]
  const turn = (x: number, y: number): [number, number] => {
    const dx = x - pivot[0]
    const dy = y - pivot[1]
    return [mm(pivot[0] + dx * c - dy * s), mm(pivot[1] + dx * s + dy * c)]
  }
  const turn3 = (p: Vec3 | null): Vec3 | null => (p ? [...turn(p[0], p[1]), p[2]] : null)
  let hit = false
  for (const storey of model.storeys) {
    for (const part of storey.verticalParts ?? []) {
      if (part.parentId !== parentId) continue
      part.footprint = part.footprint.map((p) => turn(p[0], p[1]) as Vec2)
      part.entry = turn3(part.entry)
      part.exit = turn3(part.exit)
      // 사람이 만든 것(출처 편집)은 원본이 없어 보정 표시를 달지 않는다(편집 파일에서 다시 얹을 때와 같다).
      if (part.source !== 'edit') part.edited = true
      hit = true
    }
  }
  return hit
}

/** 오브젝트 방위를 `to`(°)로 맞춘다. 지금 방위와 같으면 false. */
export function setVerticalHeading(model: Pick<Model, 'storeys'>, parentId: string, to: number): boolean {
  const now = verticalHeading(model, parentId)
  if (now === null || !Number.isFinite(to)) return false
  const d = ((((to - now) % 360) + 540) % 360) - 180
  return rotateVertical(model, parentId, d)
}

/**
 * 스냅 기준이 되는 가까운 벽의 방향(°). 그 층에서 중심 `near` 로부터 `radius` 안에 있는 벽마다 외곽선의 가장 긴 변 방향과 그 직각을 낸다.
 * 외곽선이 없는 벽(형상을 읽지 않은 임포트)은 건너뛴다.
 */
export function wallHeadings(storey: Pick<Storey, 'walls'>, near: Vec2, radius = HEADING_WALL_RADIUS): number[] {
  const out: number[] = []
  for (const w of storey.walls) {
    const ring = w.footprint?.[0]
    if (!ring || ring.length < 3) continue
    const d = Math.min(...ring.map((p) => Math.hypot(p[0] - near[0], p[1] - near[1])))
    if (d > radius) continue
    const dir = longestEdgeDir(ring)
    if (dir !== null) out.push(dir, norm360(dir + 90))
  }
  return out
}

/**
 * 회전 자석 스냅(OE-OBJ-15 AC6). 건물 축(0·90·180·270°)이나 가까운 벽 방향과 ±3° 안이면 그 각도로 붙이고 무엇에 붙었는지 돌려준다.
 * 둘 다 가까우면 더 가까운 쪽이다. `free`(Alt) 면 붙이지 않는다. 벽 방향은 180° 뒤집어도 같은 벽이라 반대쪽도 본다.
 */
export function snapHeading(angle: number, walls: readonly number[] = [], free = false): { angle: number; by: '건물 축' | '벽 방향' | null } {
  const a = norm360(angle)
  if (free) return { angle: Math.round(a * 10) / 10, by: null }
  let best: { angle: number; by: '건물 축' | '벽 방향'; gap: number } | null = null
  const consider = (t: number, by: '건물 축' | '벽 방향') => {
    const gap = angleGap(a, t)
    if (gap <= HEADING_SNAP && (!best || gap < best.gap - 1e-9)) best = { angle: norm360(t), by, gap }
  }
  for (const t of [0, 90, 180, 270]) consider(t, '건물 축')
  for (const t of walls) {
    consider(t, '벽 방향')
    consider(t + 180, '벽 방향')
  }
  const hit = best as { angle: number; by: '건물 축' | '벽 방향' } | null
  return hit ? { angle: Math.round(hit.angle * 10) / 10, by: hit.by } : { angle: Math.round(a * 10) / 10, by: null }
}

// --- 기본 형상으로 만들기 (OE-ML-06 · OE-ML-11, 2026-10-14 PRD) ------------------------------------------------
//
// 계단·ES 는 시작 층에서 시작점 하나만 받는다. 끝 층은 같은 건물에서 높이 순서로 바로 위층이고, 두 층 기준 높이 차와 종류의 기본 폭·기울기로
// 수평 길이를 정해 시작점에서 방위 쪽으로 뻗은 직사각형과 끝점을 만든다. EL 은 위치 하나를 받아 종류의 기본 크기 정사각형 승강로를 둔다.
// 만든 뒤의 형상·크기·지점은 층별 고치기(OE-ML-07)로 고친다.

/**
 * 종류별 기본 크기. EL 승강로 한 변, 계단·ES 폭과 기울기(°). PRD 가 값을 정하지 않아 PM 프로토타입(docs/presentation/
 * vertical-object-placement-prototype.html)의 시험용 값을 쓴다.
 */
export const VERTICAL_DEFAULTS = { elevator: { size: 2.4 }, escalator: { width: 1.2, slope: 30 }, stair: { width: 1.5, slope: 34 } } as const
/** 건물 안으로 보는 여유(m). 계단판 끝이 벽 두께 안으로 드는 것을 밖으로 치지 않는다(ADR-0034 의 병원 계단 0.26㎡). */
export const INSIDE_TOLERANCE = 0.5

/** 높이 순서로 바로 위층. 없거나(최상층) 그 층을 모르면 null. 이 앱의 층은 한 건물이다. */
export function storeyAbove(model: Pick<Model, 'storeys'>, storeyId: string): Storey | null {
  const sorted = [...model.storeys].filter((s) => Number.isFinite(s.elevation)).sort((a, b) => a.elevation - b.elevation)
  const i = sorted.findIndex((s) => s.id === storeyId)
  return i >= 0 ? (sorted[i + 1] ?? null) : null
}

/** 점들이 모두 그 층의 물리존 안(또는 `INSIDE_TOLERANCE` 안)에 있나. 물리존이 없는 층은 잴 수 없어 참이다. */
export function insideStorey(storey: Pick<Storey, 'spaces'>, points: readonly Vec2[]): boolean {
  const rings = storey.spaces.map((sp) => sp.footprint).filter((r) => r.length >= 3)
  if (!rings.length) return true
  return points.every((p) => rings.some((r) => pointInPolygon(p, r) || distanceToRing(p, r) <= INSIDE_TOLERANCE))
}

const along = (start: Vec2, deg: number, u: number, v: number): Vec2 => {
  const r = (deg * Math.PI) / 180
  const [c, s] = [Math.cos(r), Math.sin(r)]
  return [mm(start[0] + c * u - s * v), mm(start[1] + s * u + c * v)]
}

export type FlightDraft = { from: Storey; to: Storey; rise: number; length: number; footprint: Vec2[]; entry: Vec2; exit: Vec2; outside: boolean }

/**
 * 계단·ES 한 구간의 기본 형상(OE-ML-06 AC2). 시작점에서 방위 `heading`(°) 쪽으로 수평 길이 = 층고 차 ÷ tan(기울기) 만큼 뻗는다.
 * 시작 층이 최상층이거나 두 층 높이 차가 0 이하면 이유와 함께 거절한다(AC6). 형상이 시작 층 물리존 밖이거나 끝점이 위층 물리존 밖이면
 * `outside` 다 — 화면이 경고 색으로 보이고 완료를 막는다(AC3).
 */
export function planFlight(model: Pick<Model, 'storeys'>, kind: 'stair' | 'escalator', fromId: string, start: Vec2, heading: number): FlightDraft | { refused: string } {
  const from = model.storeys.find((s) => s.id === fromId)
  if (!from) return { refused: '시작 층을 찾지 못했습니다.' }
  if (!Number.isFinite(from.elevation)) return { refused: `${from.name} 의 기준 높이가 없어 종료점을 계산할 수 없습니다.` }
  const to = storeyAbove(model, fromId)
  if (!to) return { refused: `${from.name} 이 최상층이라 위층이 없습니다. 다른 층에서 시작합니다.` }
  const rise = to.elevation - from.elevation
  if (!(rise > 0)) return { refused: `${from.name} 과 ${to.name} 의 높이 차가 없어 종료점을 계산할 수 없습니다.` }
  const { width, slope } = VERTICAL_DEFAULTS[kind]
  const length = mm(rise / Math.tan((slope * Math.PI) / 180))
  const footprint: Vec2[] = [along(start, heading, 0, -width / 2), along(start, heading, length, -width / 2), along(start, heading, length, width / 2), along(start, heading, 0, width / 2)]
  const exit = along(start, heading, length, 0)
  const entry: Vec2 = [mm(start[0]), mm(start[1])]
  return { from, to, rise, length, footprint, entry, exit, outside: !insideStorey(from, footprint) || !insideStorey(to, [exit]) }
}

/** EL 승강로의 기본 형상(OE-ML-06 AC1). 위치 `center` 둘레 한 변 `VERTICAL_DEFAULTS.elevator.size` 정사각형을 방위만큼 돌린다. */
export function planElevator(model: Pick<Model, 'storeys'>, fromId: string, center: Vec2, heading: number): { footprint: Vec2[]; outside: boolean } {
  const h = VERTICAL_DEFAULTS.elevator.size / 2
  const footprint: Vec2[] = [along(center, heading, -h, -h), along(center, heading, h, -h), along(center, heading, h, h), along(center, heading, -h, h)]
  const from = model.storeys.find((s) => s.id === fromId)
  return { footprint, outside: !!from && !insideStorey(from, footprint) }
}

/** 조각 id(`부모 id@층 id`)의 조각. */
function partOf(model: Pick<Model, 'storeys'>, key: string): VerticalPart | null {
  for (const storey of model.storeys) {
    const part = (storey.verticalParts ?? []).find((p) => partId(p.parentId, storey.id) === key)
    if (part) return part
  }
  return null
}

/**
 * 한 층 조각만 옮긴다(OE-ML-07 "계단·ES 는 층별 형상·크기·진입/종료 위치를 수정"). 형상과 그 층의 진입·종료 지점이 같이 간다. 다른 층
 * 조각은 그대로라 층 사이 상대 위치가 바뀐다 — 그래서 전체 이동과 따로 둔다.
 */
export function movePart(model: Pick<Model, 'storeys'>, key: string, d: Vec2): boolean {
  const part = partOf(model, key)
  // 공통 축(샤프트·EL)은 한 층만 옮기지 않는다 — 축이 층마다 어긋난다(OE-ML-07 "샤프트·EL 공통 축은 유지").
  if (!part || COMMON_AXIS.has(part.kind) || !Number.isFinite(d[0]) || !Number.isFinite(d[1]) || (d[0] === 0 && d[1] === 0)) return false
  part.footprint = part.footprint.map((p) => [mm(p[0] + d[0]), mm(p[1] + d[1])] as Vec2)
  if (part.entry) part.entry = [mm(part.entry[0] + d[0]), mm(part.entry[1] + d[1]), part.entry[2]]
  if (part.exit) part.exit = [mm(part.exit[0] + d[0]), mm(part.exit[1] + d[1]), part.exit[2]]
  part.edited = true
  return true
}

/**
 * 한 층 조각 형상의 꼭짓점 하나를 옮긴다(손잡이 끌기). 변이 서로 교차하게 되면 적용하지 않고 이유를 돌려준다("유효하지 않은 형상은
 * 적용하지 않는다").
 */
export function setPartVertex(model: Pick<Model, 'storeys'>, key: string, index: number, to: Vec2): true | { refused: string } | false {
  const part = partOf(model, key)
  if (part && COMMON_AXIS.has(part.kind)) return { refused: COMMON_AXIS_LOCKED }
  if (!part || index < 0 || index >= part.footprint.length || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) return false
  const ring = part.footprint.map((p, i) => (i === index ? ([mm(to[0]), mm(to[1])] as Vec2) : p))
  if (isSelfIntersecting(ring)) return { refused: '변이 서로 교차하는 형상이라 꼭짓점을 원래 자리로 되돌렸습니다.' }
  part.footprint = ring
  part.edited = true
  return true
}

/** 한 층 조각의 진입 또는 종료 지점을 x·y 로 옮긴다. 높이는 그대로다. 그 지점이 없는 조각(사이 층)이면 false. */
export function setPartPoint(model: Pick<Model, 'storeys'>, key: string, which: 'entry' | 'exit', at: Vec2): boolean {
  const part = partOf(model, key)
  const p = part?.[which]
  if (!part || !p || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) return false
  if (p[0] === mm(at[0]) && p[1] === mm(at[1])) return false
  part[which] = [mm(at[0]), mm(at[1]), p[2]]
  part.edited = true
  return true
}

/** 오브젝트를 지운다(OE-ML-09). 모든 층의 조각을 걷는다. 연관 물리존은 그대로다. 없으면 false. */
export function deleteVertical(model: Pick<Model, 'storeys'>, parentId: string): boolean {
  let hit = false
  for (const storey of model.storeys) {
    const parts = storey.verticalParts ?? []
    const keep = parts.filter((p) => p.parentId !== parentId)
    if (keep.length === parts.length) continue
    hit = true
    if (keep.length) storey.verticalParts = keep
    else delete storey.verticalParts
  }
  return hit
}

/** 지우기 전에 보이는 영향(OE-ML-09 "확인 화면에 영향 층·층별 표현·명시 연결·배관 소속"). 개구부·정차/운행은 아직 없는 데이터다. */
export function verticalImpact(model: Pick<Model, 'storeys'>, parentId: string): {
  storeys: string[]
  parts: number
  /** 이 오브젝트가 이은 물리존 짝(시작 층 진입 지점 ↔ 끝 층 종료 지점). 지우면 겹침 추정이 그 자리를 다시 잰다. */
  link: { from: string; to: string } | null
  /** 샤프트에 든 덕트·배관 구간 수(shaft.ts). 지우면 배관·연결은 남고 소속만 풀린다. */
  pipes: number
} | null {
  const o = verticalObjects(model).find((x) => x.id === parentId)
  if (!o) return null
  const name = (storey: Storey, id: string | undefined) => {
    const sp = id ? storey.spaces.find((s) => s.id === id) : null
    return sp ? sp.longName || sp.name : null
  }
  const first = o.parts[0]
  const last = o.parts.at(-1)!
  const a = name(first.storey, partSpaces(first.storey, first.part)[0])
  const b = first === last ? null : name(last.storey, partSpaces(last.storey, last.part)[0])
  return { storeys: o.parts.map((p) => p.storey.name), parts: o.parts.length, link: a && b ? { from: a, to: b } : null, pipes: o.kind === 'shaft' ? shaftMembers(model, o.id).length : 0 }
}

/** 형상이 벽과 겹친 넓이(㎡). */
function wallOverlap(storey: Storey, ring: readonly Vec2[]): number {
  let sum = 0
  for (const w of storey.walls) for (const r of w.footprint ?? []) sum += overlapArea(ring, r) ?? 0
  return sum
}
/** 형상 넓이 중 한 물리존이 가장 많이 담은 몫(0~1). */
function containedShare(storey: Storey, ring: readonly Vec2[]): number {
  const area = polygonArea(ring)
  if (!(area > 0)) return 1
  let best = 0
  for (const s of storey.spaces) best = Math.max(best, overlapArea(ring, s.footprint) ?? 0)
  return Math.min(1, best / area)
}

/** 벽과 이만큼 넘게 더 겹치면 충돌이다(㎡). 가진 BIM 의 계단은 원래 자리에서 0~0.26㎡ 겹친다(난간·계단판 끝이 벽 두께에 든다). */
export const V03_WALL_GROWTH = 0.1
/** 한 물리존이 형상의 이만큼도 못 담으면 경계를 넘은 것이다. 가진 BIM 의 계단은 원래 자리에서 95.5~100% 다. */
export const V03_MIN_SHARE = 0.9

export type V03 = { storeyId: string; storey: string; wall: number; share: number; reasons: ('wall' | 'boundary')[] }

/**
 * V-03 다중층 이동 충돌 경고(OE-ML-07). 층마다 조각 형상이 **연 때보다** 벽과 V03_WALL_GROWTH 넘게 더 겹치거나, 한 물리존이 형상의
 * V03_MIN_SHARE 도 못 담으면 그 층을 적는다. 막지는 않는다. `original` 은 연 때의 층별 형상(baseline). 없으면(사람이 만든 것) 0 과 견준다.
 * 형상이 없는 조각(끝 층의 지점)은 재지 않는다.
 */
export function verticalCollisions(model: Pick<Model, 'storeys'>, parentId: string, original?: ReadonlyMap<string, readonly Vec2[]>): V03[] {
  const o = verticalObjects(model).find((x) => x.id === parentId)
  const out: V03[] = []
  for (const { storey, part } of o?.parts ?? []) {
    if (part.footprint.length < 3) continue
    const wall = wallOverlap(storey, part.footprint)
    const share = containedShare(storey, part.footprint)
    const before = original?.get(storey.id)
    const wall0 = before && before.length >= 3 ? wallOverlap(storey, before) : 0
    const share0 = before && before.length >= 3 ? containedShare(storey, before) : 1
    const reasons: V03['reasons'] = []
    if (wall > wall0 + V03_WALL_GROWTH) reasons.push('wall')
    // 연 때부터 경계를 넘던 조각은 그보다 더 나갔을 때만 적는다.
    if (share < Math.min(V03_MIN_SHARE, share0 - 0.05)) reasons.push('boundary')
    if (reasons.length) out.push({ storeyId: storey.id, storey: storey.name, wall: Math.round(wall * 100) / 100, share: Math.round(share * 1000) / 1000, reasons })
  }
  return out
}

// --- 구간 바꾸기 (OE-ML-08) · 만들기 (OE-ML-06) ---------------------------------------------------------
//
// 시작·끝 층을 바꾸거나 새로 만든다. 보기 범위(다중층 뷰)와 따로인 데이터다. 종류마다 층에 있어야 할 것이 다르다(OE-ML-02).
// - **계단·ES(층별 형상)**: 시작 층은 형상과 진입 지점, 사이 층은 형상, 끝 층은 종료 지점(ADR-0033).
// - **샤프트·EL 승강로(공통 축)**: 모든 층이 같은 형상 하나다. 형상을 한 번 받으면 구간의 모든 층에 같이 둔다 — 베끼는 것이 아니라 축의
//   정의다. 진입·종료 지점은 두지 않는다(EL 정차 층은 OE-ML-10 이 정해진 뒤다).
// 빈 것을 아래·위층에서 베껴 채우지 않는다(OE-ML-08 "형상을 임의 복제하여 완료하지 않는다") — 사람이 그 층에 그리거나 찍어 준 것(`given`)
// 으로만 채우고, 다 채우기 전에는 적용하지 않는다. 구간 밖이 된 층의 조각은 걷고, 자리가 바뀌어 쓰지 않게 된 것(사이 층이 된 시작 층의
// 진입 지점, 끝 층이 된 사이 층의 형상)도 지운다.

export type RangeGiven = ReadonlyMap<string, { footprint?: readonly Vec2[]; entry?: Vec2; exit?: Vec2 }>
export type RangeNeed = 'footprint' | 'entry' | 'exit'
export type RangePlan = {
  /** 새 구간의 층(높이 순). */
  storeys: Storey[]
  added: Storey[]
  removed: Storey[]
  /** 아직 채우지 않은 것. 비어 있어야 적용한다. */
  needs: { storey: Storey; what: RangeNeed[] }[]
  /** 적용하면 이 오브젝트가 잇는 물리존 짝(이름). 지점이 없는 종류이거나 아직 채우기 전이면 null. */
  link: { from: string | null; to: string | null } | null
}

/** 모든 층이 같은 형상 하나인 종류(공통 수직 축, OE-ML-02). */
export const COMMON_AXIS: ReadonlySet<VerticalKind> = new Set(['elevator', 'shaft'])
export const COMMON_AXIS_LOCKED = '샤프트·엘리베이터 승강로는 모든 층이 같은 축이라 한 층만 고치지 않습니다. 전체 이동으로 옮깁니다.'

/** 구간 계획. `had` 는 이미 있는 층별 조각(새로 만들면 비어 있다). */
function planFor(
  model: Pick<Model, 'storeys'>,
  kind: VerticalKind,
  fromId: string,
  toId: string,
  given: RangeGiven,
  had: ReadonlyMap<string, VerticalPart>,
): RangePlan | { refused: string } {
  if (fromId === toId) return { refused: '같은 층을 시작·끝 층으로 둘 수 없습니다. 수직 관통 오브젝트는 두 층 이상을 지납니다.' }
  const from = model.storeys.find((s) => s.id === fromId)
  const to = model.storeys.find((s) => s.id === toId)
  if (!from || !to) return { refused: '없는 층입니다.' }
  if (!Number.isFinite(from.elevation) || !Number.isFinite(to.elevation)) {
    return { refused: `${!Number.isFinite(from.elevation) ? from.name : to.name} 의 층 높이를 모릅니다. 층 높이가 있어야 관통 구간을 정합니다.` }
  }
  const sorted = model.storeys.filter((s) => Number.isFinite(s.elevation)).sort((a, b) => a.elevation - b.elevation)
  const i = sorted.indexOf(from)
  const j = sorted.indexOf(to)
  if (i > j) return { refused: '시작 층이 끝 층보다 위입니다. 시작 층은 오르기 시작하는 아래층입니다.' }
  const storeys = sorted.slice(i, j + 1)
  const needs: RangePlan['needs'] = []
  const bad = (ring: readonly Vec2[] | undefined) => !ring || ring.length < 3 || isSelfIntersecting(ring)
  const pointOf = (storey: Storey, which: 'entry' | 'exit'): Vec2 | null => {
    const g = given.get(storey.id)?.[which]
    if (g) return g
    const p = had.get(storey.id)?.[which]
    return p ? [p[0], p[1]] : null
  }
  const axial = COMMON_AXIS.has(kind)
  if (axial) {
    // 축: 사람이 이번에 그린 것(어느 층이든), 없으면 이미 있는 축.
    const axis = [...given.values()].find((g) => g.footprint)?.footprint ?? [...had.values()].find((p) => p.footprint.length >= 3)?.footprint
    if (bad(axis)) needs.push({ storey: storeys[0], what: ['footprint'] })
  } else {
    storeys.forEach((storey, k) => {
      const what: RangeNeed[] = []
      const last = k === storeys.length - 1
      // 사람이 그린 형상이 엇갈리면 채운 것으로 치지 않는다("유효하지 않은 형상은 적용하지 않는다").
      const drawn = given.get(storey.id)?.footprint
      if (!last && bad(drawn ?? had.get(storey.id)?.footprint)) what.push('footprint')
      if (k === 0 && !pointOf(storey, 'entry')) what.push('entry')
      if (last && !pointOf(storey, 'exit')) what.push('exit')
      if (what.length) needs.push({ storey, what })
    })
  }
  const name = (storey: Storey, at: Vec2 | null) => {
    if (!at) return null
    const sp = storey.spaces.find((s) => s.id === partSpaceAt(storey, at))
    return sp ? sp.longName || sp.name : null
  }
  const a = axial ? null : pointOf(storeys[0], 'entry')
  const b = axial ? null : pointOf(storeys.at(-1)!, 'exit')
  return {
    storeys,
    added: storeys.filter((s) => !had.has(s.id)),
    removed: model.storeys.filter((s) => had.has(s.id) && !storeys.includes(s)),
    needs,
    link: a && b ? { from: name(storeys[0], a), to: name(storeys.at(-1)!, b) } : null,
  }
}

/**
 * 만들 때 채울 것 전부를 채울 순서대로(OE-ML-06). 계단·ES 는 끝 층을 뺀 층마다 형상, 시작 층 진입, 끝 층 종료이고, 샤프트·EL 은 공통 축
 * 형상 하나다. `done` 은 계획의 needs 에 없는 것 — 화면이 채운 것에 ✓ 를 달고 남은 것을 차례로 이어 그린다.
 */
export function planSteps(kind: VerticalKind, plan: RangePlan): { storey: Storey; what: RangeNeed; done: boolean }[] {
  const left = new Set(plan.needs.flatMap((n) => n.what.map((w) => `${n.storey.id}:${w}`)))
  const steps: { storey: Storey; what: RangeNeed }[] = []
  if (COMMON_AXIS.has(kind)) steps.push({ storey: plan.storeys[0], what: 'footprint' })
  else
    plan.storeys.forEach((storey, k) => {
      const last = k === plan.storeys.length - 1
      if (!last) steps.push({ storey, what: 'footprint' })
      if (k === 0) steps.push({ storey, what: 'entry' })
      if (last) steps.push({ storey, what: 'exit' })
    })
  return steps.map((s) => ({ ...s, done: !left.has(`${s.storey.id}:${s.what}`) }))
}

function partSpaceAt(storey: Storey, at: Vec2): string | null {
  return partSpaces(storey, { parentId: '', kind: 'stair', name: '', source: 'edit', footprint: [], entry: [at[0], at[1], 0], exit: null })[0] ?? null
}

const NEED_LABEL: Record<RangeNeed, string> = { footprint: '형상', entry: '진입 지점', exit: '종료 지점' }
const needsText = (plan: RangePlan) => `채우지 않은 것이 있습니다: ${plan.needs.map((n) => `${n.storey.name} ${n.what.map((w) => NEED_LABEL[w]).join('·')}`).join(', ')}`

/** 계획대로 층별 조각을 둔다. 바뀐 조각에 `edited` 를 단다. 사람이 찍은 지점의 높이는 그 층 바닥이다. */
function writeParts(plan: RangePlan, kind: VerticalKind, template: Pick<VerticalPart, 'parentId' | 'kind' | 'name' | 'source'>, given: RangeGiven) {
  for (const storey of plan.removed) {
    storey.verticalParts = (storey.verticalParts ?? []).filter((p) => p.parentId !== template.parentId)
    if (!storey.verticalParts.length) delete storey.verticalParts
  }
  const parts = plan.storeys.map((s) => (s.verticalParts ?? []).find((p) => p.parentId === template.parentId))
  const axisRing = COMMON_AXIS.has(kind) ? ([...given.values()].find((g) => g.footprint)?.footprint ?? parts.find((p) => p && p.footprint.length >= 3)?.footprint) : undefined
  const axis = axisRing ? axisRing.map((p) => [mm(p[0]), mm(p[1])] as Vec2) : null
  plan.storeys.forEach((storey, k) => {
    const first = k === 0
    const last = k === plan.storeys.length - 1
    const g = given.get(storey.id)
    let part = parts[k]
    if (!part) {
      // 에스컬레이터 방향은 오브젝트 하나의 값이라 새 층 조각에도 같이 둔다(구간을 바꿔도 방향은 그대로다).
      const direction = parts.find((p) => p?.direction)?.direction
      part = { ...template, footprint: [], entry: null, exit: null, ...(kind === 'escalator' && direction ? { direction } : {}) }
      // 구간을 넓혀 새로 생긴 엘리베이터 층은 정차 미확인이다(OE-ML-10 "신규 층의 정차 여부는 사용자 확인 전 미확인"). 만들 때는 createVertical 이 정한다.
      if (kind === 'elevator') part.stop = 'unknown'
      storey.verticalParts = [...(storey.verticalParts ?? []), part]
    }
    const was = part
    const point = (which: 'entry' | 'exit'): Vec3 | null => {
      const at = g?.[which]
      if (at) return [mm(at[0]), mm(at[1]), storey.elevation]
      return was[which]
    }
    const next: Pick<VerticalPart, 'footprint' | 'entry' | 'exit'> = axis
      ? { footprint: axis, entry: null, exit: null }
      : {
          footprint: last ? [] : g?.footprint ? g.footprint.map((p) => [mm(p[0]), mm(p[1])] as Vec2) : part.footprint,
          entry: first ? point('entry') : null,
          exit: last ? point('exit') : null,
        }
    if (JSON.stringify([part.footprint, part.entry, part.exit]) !== JSON.stringify([next.footprint, next.entry, next.exit])) {
      Object.assign(part, next)
      part.edited = true
    }
  })
}

/** 구간을 이렇게 바꾸면 무엇이 더해지고 빠지고, 무엇을 채워야 하나. 바꿀 수 없는 구간이면 이유. */
export function planRange(model: Pick<Model, 'storeys'>, parentId: string, fromId: string, toId: string, given: RangeGiven = new Map()): RangePlan | { refused: string } {
  const o = verticalObjects(model).find((x) => x.id === parentId)
  if (!o) return { refused: '오브젝트가 없습니다.' }
  return planFor(model, o.kind, fromId, toId, given, new Map(o.parts.map((p) => [p.storey.id, p.part])))
}

/** 구간을 바꾼다(OE-ML-08). planRange 가 채울 것을 남기면 적용하지 않는다. */
export function setVerticalRange(model: Pick<Model, 'storeys'>, parentId: string, fromId: string, toId: string, given: RangeGiven = new Map()): true | { refused: string } {
  const plan = planRange(model, parentId, fromId, toId, given)
  if ('refused' in plan) return plan
  if (plan.needs.length) return { refused: needsText(plan) }
  const o = verticalObjects(model).find((x) => x.id === parentId)!
  const before = JSON.stringify(o.parts.map((p) => [p.storey.id, p.part]))
  const { kind, name, source } = o.parts[0].part
  writeParts(plan, kind, { parentId, kind, name, source }, given)
  return before === JSON.stringify(verticalObjects(model).find((x) => x.id === parentId)!.parts.map((p) => [p.storey.id, p.part])) ? { refused: '구간이 그대로입니다.' } : true
}

/** 새로 만들 때의 계획(OE-ML-06). */
export function planCreate(model: Pick<Model, 'storeys'>, kind: VerticalKind, fromId: string, toId: string, given: RangeGiven = new Map()): RangePlan | { refused: string } {
  return planFor(model, kind, fromId, toId, given, new Map())
}

/**
 * 수직 관통 오브젝트를 새로 만든다(OE-ML-06). 출처는 `edit`. 이름이 비었거나 채울 것이 남았으면 만들지 않는다. 층별 조각 id 는 `id@층 id` 다.
 * 연관 물리존은 저장하지 않고 진입·종료 지점으로 그때 짚는다(ADR-0033). 형상이 물리존과 겹친다고 연결을 확정하지 않는다(OE-ML-19).
 */
export function createVertical(
  model: Pick<Model, 'storeys'>,
  spec: { id: string; kind: VerticalKind; name: string; from: string; to: string },
  given: RangeGiven,
): { id: string } | { refused: string } {
  if (!spec.name.trim()) return { refused: '이름을 넣어야 합니다.' }
  if (verticalObjects(model).some((o) => o.id === spec.id)) return { refused: '같은 id 의 오브젝트가 있습니다.' }
  const plan = planCreate(model, spec.kind, spec.from, spec.to, given)
  if ('refused' in plan) return plan
  if (plan.needs.length) return { refused: needsText(plan) }
  writeParts(plan, spec.kind, { parentId: spec.id, kind: spec.kind, name: spec.name.trim(), source: 'edit' }, given)
  // 사람이 만든 것은 출처가 edit 라 원본과 보정을 가를 것이 없다. 처음 모양에는 보정 표시를 달지 않는다.
  // 엘리베이터는 관통 구간 전 층을 정차로 두고 시작한다(OE-ML-10 "수동 생성의 초기 선택은 전 층 정차"). 사람이 패널에서 무정차로 바꾼다.
  for (const st of plan.storeys)
    for (const p of st.verticalParts ?? [])
      if (p.parentId === spec.id) {
        delete p.edited
        if (spec.kind === 'elevator') p.stop = 'stop'
      }
  return { id: spec.id }
}

export const STOP_LABEL: Record<ElevatorStop, string> = { stop: '정차', skip: '무정차', unknown: '미확인' }
export const DIRECTION_LABEL: Record<'up' | 'down' | 'unknown', string> = { up: '상행', down: '하행', unknown: '미확인' }

/**
 * 에스컬레이터 운행 방향을 정한다(OE-ML-11). 모든 층 조각에 같이 적는다. `unknown` 이면 지운다 — 미확인을 상행·하행으로 지어내지 않는다.
 * 에스컬레이터가 아니거나 그대로면 false.
 */
export function setEscalatorDirection(model: Pick<Model, 'storeys'>, parentId: string, direction: 'up' | 'down' | 'unknown'): boolean {
  const parts = model.storeys.flatMap((s) => s.verticalParts ?? []).filter((p) => p.parentId === parentId)
  if (!parts.length || parts[0].kind !== 'escalator' || (parts[0].direction ?? 'unknown') === direction) return false
  for (const p of parts) {
    if (direction === 'unknown') delete p.direction
    else p.direction = direction
  }
  return true
}

/**
 * 에스컬레이터의 운행 시작·종료 지점(OE-ML-11 "높이 기준 하층/상층과 상행/하행에 따라 이동 시작·종료 지점을 구분"). 진입 지점은 시작 층(아래),
 * 종료 지점은 끝 층(위)에 있다. 상행이면 진입 → 종료, 하행이면 종료 → 진입이다. 방향이나 지점을 모르면 null.
 */
export function escalatorTravel(model: Pick<Model, 'storeys'>, parentId: string): { from: Vec3; to: Vec3 } | null {
  const parts = model.storeys.flatMap((s) => s.verticalParts ?? []).filter((p) => p.parentId === parentId)
  const dir = parts[0]?.direction
  const entry = parts.find((p) => p.entry)?.entry
  const exit = parts.find((p) => p.exit)?.exit
  if (!dir || !entry || !exit) return null
  return dir === 'up' ? { from: entry, to: exit } : { from: exit, to: entry }
}

/**
 * 엘리베이터의 한 층 정차 상태를 바꾼다(OE-ML-10). 엘리베이터가 아니거나 그 층 조각이 없으면 false. 미확인으로 되돌릴 수도 있다 —
 * 모르는 것을 정차로 남기지 않게. 로봇 통과(OE-ML-04)는 GeoJSON 이 이 값으로 정한다.
 */
export function setElevatorStop(model: Pick<Model, 'storeys'>, parentId: string, storeyId: string, stop: ElevatorStop): boolean {
  const part = model.storeys.find((s) => s.id === storeyId)?.verticalParts?.find((p) => p.parentId === parentId)
  if (!part || part.kind !== 'elevator' || (part.stop ?? 'unknown') === stop) return false
  part.stop = stop
  return true
}
