// 반자 높이 h_c 와 설치면 판정(OE-EQP-03 · glossary "천장 관련 높이").
//
// 높이는 전부 **층 바닥에서 잰 z** 다. h_c 는 눈에 보이는 천장 마감면(반자)이고, 슬래브 하단(윗층 바닥판 아래)과 다르다.
//
// **h_c 는 지어내지 않는다.** BIM 에 있으면 그 값, 없으면 사람이 정한 값이다. 둘 다 없으면 모름이고 0 이나 "층고−0.6m" 로
// 채우지 않는다 — 그러면 천장 판정이 "미정" 이 된다. 반자 부착 설비의 z 로 짐작한 값은 입력창의 기본값(출처 계산)으로만 쓴다.
//
// BIM 에서 읽는 순서(임포터가 층마다 고른다, `pickCeiling`): ① 반자 높이를 직접 말하는 속성(FinishCeilingHeight) ② 방 높이
// (Revit `Unbounded Height`, 없으면 방 형상의 압출 깊이) ③ 천장재(IfcCovering CEILING) 형상의 아랫면. **방 높이·천장재가
// 층고에 닿으면 버린다** — Revit 설비 판본의 MEP Space 는 윗층 바닥까지 늘어나 있어(병원 HVAC 4.42m·층고 4.57m, 성수 건축도
// 4.3m = 층고) 반자가 아니다. 이 문턱이 glossary 의 "설비 판본의 방 높이는 쓰지 않는다" 를 맡는다(판본을 파일에서 알 길이 없다).

import { isConduit, type Equipment, type Model, type Storey, type Vec2 } from './model'
import { distanceToRing } from './mapping'
import { allowedSurfaces, type Surface } from './mount'

/** 판정 문턱(m, glossary). 바닥 z ≤ 0.3, 천장 z ≥ h_c − 0.3, 벽은 벽선 0.3 이내. */
export const FLOOR_BAND = 0.3
export const CEILING_BAND = 0.3
export const WALL_BAND = 0.3
/**
 * 방 높이·천장재가 층고에서 이만큼 넘게 안쪽에 있어야 반자로 본다(m). 윗층 바닥판 아래까지 늘어난 방을 거른다 — 병원 HVAC 의
 * MEP Space 는 4.42m(층고 4.57m, 바닥판 0.15m)라 0.1m 문턱을 지나 반자로 잡혔다. Duplex 2층(층고 2.9m · 방 2.6m)은 남는다.
 */
export const SLAB_MARGIN = 0.25

/** BIM 이 말한 반자 높이 후보. 층 하나에 든 방·천장재마다 하나. */
export type CeilingEvidence = {
  /** ① FinishCeilingHeight. [값, 읽은 자리] */
  finish: [number, string][]
  /** ② 방 높이. [값, 읽은 자리] */
  room: [number, string][]
  /** ③ 천장재 아랫면. */
  covering: number[]
}

export const emptyEvidence = (): CeilingEvidence => ({ finish: [], room: [], covering: [] })

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * 층 하나의 반자 높이를 BIM 후보에서 고른다. 앞 순서에 쓸 값이 있으면 그것이고, 값은 그 층 방(천장재)들의 가운데 값이다.
 * `storeyHeight` 를 모르면(맨 위층) 층고 문턱은 걸지 않는다.
 */
export function pickCeiling(ev: CeilingEvidence, storeyHeight: number | null): NonNullable<Storey['ceiling']> | undefined {
  const below = (v: number) => v > FLOOR_BAND && (storeyHeight === null || v < storeyHeight - SLAB_MARGIN)
  const finish = ev.finish.filter(([v]) => v > FLOOR_BAND)
  if (finish.length) return { height: round(median(finish.map(([v]) => v))), property: finish[0][1], count: finish.length }
  // 방 높이는 그 층 방의 절반 넘게가 반자로 보일 때만 쓴다. 대부분 윗층 바닥까지 닿는 층(성수 1F: 62개 중 60개가 층고)에서
  // 낮은 방 몇 개(계단참·창고)의 높이를 층의 반자로 쓰면 틀린다 — 그런 층은 천장재로 넘어간다.
  const room = ev.room.filter(([v]) => below(v))
  if (room.length * 2 > ev.room.length) return { height: round(median(room.map(([v]) => v))), property: room[0][1], count: room.length }
  const covering = ev.covering.filter(below)
  if (covering.length) return { height: round(median(covering)), property: 'IfcCovering(CEILING) 아랫면', count: covering.length }
  return undefined
}

export type Ceiling = { height: number; source: 'bim' | 'edit'; property?: string; count?: number }

/** 층의 반자 높이. 사람이 정한 값이 BIM 값보다 앞선다. 모르면 null. */
export function ceilingOf(storey: Pick<Storey, 'ceiling' | 'ceilingSet'>): Ceiling | null {
  if (storey.ceilingSet != null) return { height: storey.ceilingSet, source: 'edit' }
  if (storey.ceiling) return { height: storey.ceiling.height, source: 'bim', property: storey.ceiling.property, count: storey.ceiling.count }
  return null
}

/** 천장 설비의 구역. 반자 부착은 반자 면에, 플레넘은 반자 위 숨은 공간에 든다(glossary "천장 설비의 두 구역"). */
export type CeilingZone = 'attached' | 'plenum'

/**
 * 플레넘에 드는 종류. 천장 속 VAV·FCU 다. 덕트형 실내기도 플레넘이지만 사전의 `indoor_unit` 은 카세트형과 같은 종류라
 * 반자 부착으로 둔다 — 반자 부착의 허용 z(h_c−0.3 이상)가 플레넘(h_c 초과)을 품어서 덕트형을 막지 않는다.
 */
const PLENUM = new Set(['vav', 'fcu'])

/** 종류의 천장 구역. 천장에 놓을 수 없는 종류면 null. */
export function ceilingZone(kind: string | null | undefined): CeilingZone | null {
  if (!allowedSurfaces(kind)?.includes('ceiling')) return null
  return PLENUM.has(kind!) ? 'plenum' : 'attached'
}

/**
 * 천장 설비가 놓일 수 있는 z 범위와 기본 z. h_c 를 모르면 null(지어내지 않는다). 층고를 모르면 위 끝은 없다.
 * 반자 부착: h_c − 0.3 ≤ z, 기본 h_c. 플레넘: h_c < z < 층고, 기본 h_c 바로 위(+0.1m).
 */
export function ceilingRange(zone: CeilingZone, hc: number | null, storeyHeight: number | null): { min: number; max: number | null; base: number; openMin: boolean } | null {
  if (hc === null) return null
  const max = storeyHeight
  if (zone === 'attached') return { min: round(hc - CEILING_BAND), max, base: hc, openMin: false }
  const base = max === null ? round(hc + 0.1) : round(Math.min(hc + 0.1, (hc + max) / 2))
  return { min: hc, max, base, openMin: true }
}

/** z 가 구역 안인가. 아니면 왜 아닌지 한 줄. */
export function checkCeilingZ(zone: CeilingZone, z: number, hc: number | null, storeyHeight: number | null): true | string {
  const r = ceilingRange(zone, hc, storeyHeight)
  if (!r) return '천장고(h_c)를 모릅니다. 층별 요약에서 먼저 입력하세요.'
  const m = (v: number) => `${v.toFixed(2)}m`
  if (zone === 'attached') {
    if (z < r.min) return `반자 부착 설비는 천장고(${m(hc!)})에서 0.3m 안쪽(${m(r.min)} 이상)에 둡니다.`
  } else if (z <= r.min) return `플레넘 설비는 천장고(${m(hc!)}) 위에 둡니다.`
  if (r.max !== null && z >= r.max) return `층고(${m(r.max)}) 아래에 둡니다.`
  return true
}

/** 판정 설치면. 플레넘은 천장 설비로 센다(OE-EQP-05). */
export type Judged = Surface | 'plenum'

/**
 * 설비의 설치면을 z(층 바닥 기준)로 판정한다(OE-EQP-03). 바닥 z ≤ 0.3, h_c 를 알면 z ≥ h_c−0.3 천장(h_c 초과는 플레넘),
 * 그 사이에서 벽선 0.3m 이내면 벽, 그 밖은 미정(null). 좌표가 없거나 도관·설치면 없는 종류(밸브·댐퍼)면 null. 사람이 정한 설치면
 * (`surfaceSet`, OE-EQP-05)이 있으면 그것이다.
 *
 * z 는 설비 좌표(배치점, 형상에서 멀면 형상 중심)다. glossary Q8 의 "형상 최저점" 은 아니다 — 모델에 설비 형상의 높이 폭을
 * 두지 않아서다. 천장 설비는 배치점이 반자 면이라 차이가 작고, 바닥 기기는 배치점이 바닥이다(실측은 PR 본문).
 */
export function judgeSurface(e: Pick<Equipment, 'position' | 'role' | 'kind' | 'surfaceSet'>, storey: Pick<Storey, 'elevation' | 'walls' | 'ceiling' | 'ceilingSet'>, storeyHeight: number | null): Judged | null {
  if (isConduit(e.role) || allowedSurfaces(e.kind)?.length === 0) return null
  // 사람이 정한 설치면이 앞선다(OE-EQP-05).
  if (e.surfaceSet) return e.surfaceSet
  if (!e.position) return null
  const z = e.position[2] - storey.elevation
  if (z <= FLOOR_BAND) return 'floor'
  const hc = ceilingOf(storey)?.height ?? null
  if (hc !== null && z >= hc - CEILING_BAND && (storeyHeight === null || z < storeyHeight)) return z > hc ? 'plenum' : 'ceiling'
  const p: Vec2 = [e.position[0], e.position[1]]
  for (const w of storey.walls) for (const ring of w.footprint ?? []) if (distanceToRing(p, ring) <= WALL_BAND) return 'wall'
  return null
}

/** 판정이 허용 설치면 밖인가(Q9). 판정이나 허용을 모르면 false. 플레넘은 천장으로 본다. */
export function outsideAllowed(kind: string | null | undefined, judged: Judged | null): boolean {
  const allowed = allowedSurfaces(kind)
  if (!allowed?.length || !judged) return false
  return !allowed.includes(judged === 'plenum' ? 'ceiling' : judged)
}

export type SurfaceRow = { equipment: Equipment; storey: Storey; judged: Judged | null }

/** 설비마다 판정 설치면. 도관과 설치면 없는 종류(배관·덕트 위 밸브·댐퍼·유량계)는 뺀다 — 면에 붙지 않아 판정할 것이 없다. */
export function judgeAll(model: Model, storeyHeight: (id: string) => number | null): SurfaceRow[] {
  const out: SurfaceRow[] = []
  for (const storey of model.storeys) {
    const h = storeyHeight(storey.id)
    for (const e of storey.equipment) {
      if (isConduit(e.role) || allowedSurfaces(e.kind)?.length === 0) continue
      out.push({ equipment: e, storey, judged: judgeSurface(e, storey, h) })
    }
  }
  return out
}

/**
 * 반자 높이 후보(출처 계산). 반자 부착 종류 중 IFC 클래스·이름으로 종류를 정한 설비(사람이 고친 종류나 높이로 짐작한 종류는
 * 뺀다 — 높이로 짐작한 종류로 높이를 짐작하면 순환이다)의 z 가운데 값. 층 바닥 근처·층고 위는 뺀다. 없으면 null.
 * 입력창의 기본값으로만 쓰고 값으로 치지 않는다.
 */
export function ceilingGuess(storey: Pick<Storey, 'elevation' | 'equipment'>, storeyHeight: number | null): { height: number; count: number } | null {
  const zs: number[] = []
  for (const e of storey.equipment) {
    if (!e.position || e.kindEdited || !e.kindSource || ceilingZone(e.kind) !== 'attached') continue
    const z = e.position[2] - storey.elevation
    if (z > FLOOR_BAND + 1 && (storeyHeight === null || z < storeyHeight)) zs.push(z)
  }
  return zs.length ? { height: round(median(zs)), count: zs.length } : null
}

/** 층의 반자 높이를 사람이 정한다(OE-EQP-03 ④). null 이면 지워 BIM 값(없으면 모름)으로 돌아간다. 바뀌었으면 true. */
export function setCeiling(model: Model, storeyId: string, height: number | null): boolean {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return false
  const next = height === null || !Number.isFinite(height) || height <= 0 ? null : round(height)
  // BIM 값과 같게 정하면 고친 것이 아니다 — 지운다.
  const value = next !== null && storey.ceiling && Math.abs(storey.ceiling.height - next) < 0.0005 ? null : next
  if ((storey.ceilingSet ?? null) === value) return false
  if (value === null) delete storey.ceilingSet
  else storey.ceilingSet = value
  return true
}

/**
 * 설비의 설치면을 사람이 정한다(OE-EQP-05). null 이면 지워 z 판정으로 돌아간다. 허용 설치면을 아는 종류는 그 안에서만 정한다.
 * 바뀌었으면 true, 허용 밖이면 그 이유.
 */
export function setEquipmentSurface(model: Model, id: string, surface: Surface | null): boolean | { refused: string } {
  const e = model.storeys.flatMap((s) => s.equipment).find((x) => x.id === id)
  if (!e) return false
  const allowed = allowedSurfaces(e.kind)
  if (surface && allowed && !allowed.includes(surface)) return { refused: '이 종류의 허용 설치면이 아닙니다.' }
  if ((e.surfaceSet ?? null) === surface) return false
  if (surface) e.surfaceSet = surface
  else delete e.surfaceSet
  return true
}
