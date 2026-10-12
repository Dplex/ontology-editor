// 층 상대 높이와 공통 z(OE-ML-18). 모델의 좌표(설비 `position`, 구간 경로)는 이미 공통 z(IFC 세계 좌표, m)다. 사람이 다중층 뷰에서
// "어느 층 바닥에서 몇 m" 로 준 높이만 그 층 바닥 높이를 더해 공통 z 로 바꾼다 — 공통 z 에는 층 높이를 다시 더하지 않는다.
//
// 층 바닥 높이를 모르거나 두 층의 바닥 높이가 같아 어느 층인지 가를 수 없으면 바꾸지 않고 이유를 돌려준다. 층 이름·순번으로 높이를
// 짐작하지 않는다.

import type { Model, Storey, Vec2, Vec3 } from './model'

/** 층 상대 높이로 준 점. `height` 는 그 층 바닥에서 잰 m. */
export type StoreyPoint = { at: Vec2; storeyId: string; height: number }
/** 경로의 점. 공통 z 로 준 점(`Vec3`)은 그대로 쓴다. */
export type PathPoint = Vec3 | StoreyPoint

const isStoreyPoint = (p: PathPoint): p is StoreyPoint => !Array.isArray(p)

/** 바닥 높이가 같은 두 층(어느 층의 높이인지 가를 수 없다). */
const SAME_ELEVATION = 0.001

/** 층 하나의 바닥 높이를 쓸 수 있나. 못 쓰면 이유. */
export function storeyElevationProblem(model: Pick<Model, 'storeys'>, storey: Storey): string | null {
  if (!Number.isFinite(storey.elevation)) return `${storey.name} 의 바닥 높이를 모릅니다. 층 이름이나 순서로 높이를 짐작하지 않습니다 — BIM 에 층 높이를 넣은 뒤 그립니다.`
  const twin = model.storeys.find((s) => s !== storey && Number.isFinite(s.elevation) && Math.abs(s.elevation - storey.elevation) < SAME_ELEVATION)
  if (twin) return `${storey.name} 와 ${twin.name} 의 바닥 높이(${storey.elevation.toFixed(2)}m)가 같아 어느 층의 높이인지 가를 수 없습니다.`
  return null
}

/** 점 하나의 공통 좌표. 층 상대 높이면 그 층 바닥 높이를 더한다. */
export function toCommon(model: Pick<Model, 'storeys'>, p: PathPoint): Vec3 | { refused: string } {
  if (!isStoreyPoint(p)) return [p[0], p[1], p[2]]
  const storey = model.storeys.find((s) => s.id === p.storeyId)
  if (!storey) return { refused: '없는 층의 높이입니다.' }
  const problem = storeyElevationProblem(model, storey)
  if (problem) return { refused: problem }
  if (!Number.isFinite(p.height) || !p.at.every(Number.isFinite)) return { refused: '좌표 수치가 유효하지 않습니다.' }
  return [p.at[0], p.at[1], storey.elevation + p.height]
}

/**
 * 공통 z 가 든 층: 바닥 높이 ≤ z < 바로 위층 바닥 높이. 맨 아래층보다 낮으면 null. 높이를 모르는 층은 빼고 가른다.
 * 바닥 바로 위(1mm 안)의 점은 그 층이다 — 바닥에 찍은 점이 반올림으로 아래층에 들지 않게.
 */
export function storeyAtZ(model: Pick<Model, 'storeys'>, z: number): Storey | null {
  const sorted = model.storeys.filter((s) => Number.isFinite(s.elevation)).sort((a, b) => a.elevation - b.elevation)
  let found: Storey | null = null
  for (const s of sorted) if (s.elevation <= z + SAME_ELEVATION) found = s
  return found
}

/** 자기 층 바닥 아래로 이만큼(m)까지는 그 층 배관이다 — 바닥판 안·아래를 지나는 배관(Duplex 급수관이 바닥 -0.18m 까지 내려간다). */
export const BELOW_FLOOR_REACH = 0.3
/** 위층 바닥을 이만큼(m) 넘으면 위층으로 들어간 것이다. 천장 속 배관은 위층 바닥 아래에 머문다. */
export const ABOVE_FLOOR_REACH = 0.05

/**
 * 덕트·배관 구간이 자기 층(`homeId`)을 벗어나 들어간 다른 층들(OE-ML-05). 없으면 빈 배열이다. 층 편집 화면은 이런 구간의 형상을 바꾸지 않고
 * 다중층 뷰로 안내한다 — 한 층만 보며 고치면 보이지 않는 층의 경로가 바뀐다. 높이를 모르는 층은 가르지 않는다.
 */
export function storeysEntered(model: Pick<Model, 'storeys'>, homeId: string, path: readonly [Vec3, Vec3]): Storey[] {
  const sorted = model.storeys.filter((s) => Number.isFinite(s.elevation)).sort((a, b) => a.elevation - b.elevation)
  const i = sorted.findIndex((s) => s.id === homeId)
  if (i < 0) return []
  const low = Math.min(path[0][2], path[1][2])
  const high = Math.max(path[0][2], path[1][2])
  const below = sorted.slice(0, i).filter((s, k) => low < sorted[k + 1].elevation - BELOW_FLOOR_REACH)
  const above = sorted.slice(i + 1).filter((s) => high > s.elevation + ABOVE_FLOOR_REACH)
  return [...below, ...above]
}
