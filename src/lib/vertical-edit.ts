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

import { overlapArea } from './polygon'
import { polygonArea, type Model, type Storey, type Vec2, type Vec3, type VerticalPart } from './model'
import { partSpaces, verticalObjects } from './vertical-object'

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

/** 지우기 전에 보이는 영향(OE-ML-09 "확인 화면에 영향 층·층별 표현·명시 연결"). 개구부·정차/운행·배관 소속은 아직 없는 데이터다. */
export function verticalImpact(model: Pick<Model, 'storeys'>, parentId: string): {
  storeys: string[]
  parts: number
  /** 이 오브젝트가 이은 물리존 짝(시작 층 진입 지점 ↔ 끝 층 종료 지점). 지우면 겹침 추정이 그 자리를 다시 잰다. */
  link: { from: string; to: string } | null
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
  return { storeys: o.parts.map((p) => p.storey.name), parts: o.parts.length, link: a && b ? { from: a, to: b } : null }
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
