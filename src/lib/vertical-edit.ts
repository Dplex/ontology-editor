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

import { isSelfIntersecting } from './mapping'
import { overlapArea } from './polygon'
import { polygonArea, type Model, type Storey, type Vec2, type Vec3, type VerticalPart } from './model'
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
  if (!part || !Number.isFinite(d[0]) || !Number.isFinite(d[1]) || (d[0] === 0 && d[1] === 0)) return false
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

// --- 구간 바꾸기 (OE-ML-08) ------------------------------------------------------------------------
//
// 시작·끝 층을 바꾼다. 보기 범위(다중층 뷰)와 따로인 데이터다. 층마다 조각의 자리에 따라 있어야 할 것이 다르다(ADR-0033):
// 시작 층은 형상과 진입 지점, 사이 층은 형상, 끝 층은 종료 지점. 구간을 바꾸면 자리가 바뀐 층(옛 끝 층이 사이 층이 되는 것)과 새 층에
// 없는 것이 생긴다. **없는 것을 아래·위층에서 베껴 채우지 않는다**(OE-ML-08 "형상을 임의 복제하여 완료하지 않는다") — 사람이 그 층에
// 그리거나 찍어 준 것(`given`)으로만 채우고, 다 채우기 전에는 적용하지 않는다. 구간 밖이 된 층의 조각은 걷고, 자리가 바뀌어 쓰지 않게 된
// 것(사이 층이 된 시작 층의 진입 지점, 끝 층이 된 사이 층의 형상)도 지운다.

export type RangeGiven = ReadonlyMap<string, { footprint?: readonly Vec2[]; entry?: Vec2; exit?: Vec2 }>
export type RangeNeed = 'footprint' | 'entry' | 'exit'
export type RangePlan = {
  /** 새 구간의 층(높이 순). */
  storeys: Storey[]
  added: Storey[]
  removed: Storey[]
  /** 아직 채우지 않은 것. 비어 있어야 적용한다. */
  needs: { storey: Storey; what: RangeNeed[] }[]
  /** 적용하면 이 오브젝트가 잇는 물리존 짝(이름). 지점을 다 채우기 전이면 null. */
  link: { from: string | null; to: string | null } | null
}

/** 구간을 이렇게 바꾸면 무엇이 더해지고 빠지고, 무엇을 채워야 하나. 바꿀 수 없는 구간이면 이유. */
export function planRange(model: Pick<Model, 'storeys'>, parentId: string, fromId: string, toId: string, given: RangeGiven = new Map()): RangePlan | { refused: string } {
  const o = verticalObjects(model).find((x) => x.id === parentId)
  if (!o) return { refused: '오브젝트가 없습니다.' }
  if (fromId === toId) return { refused: '같은 층을 시작·끝 층으로 둘 수 없습니다. 수직 관통 오브젝트는 두 층 이상을 지납니다.' }
  const sorted = model.storeys.filter((s) => Number.isFinite(s.elevation)).sort((a, b) => a.elevation - b.elevation)
  const i = sorted.findIndex((s) => s.id === fromId)
  const j = sorted.findIndex((s) => s.id === toId)
  if (i < 0 || j < 0) return { refused: '없는 층입니다.' }
  if (i > j) return { refused: '시작 층이 끝 층보다 위입니다. 시작 층은 오르기 시작하는 아래층입니다.' }
  const storeys = sorted.slice(i, j + 1)
  const had = new Map(o.parts.map((p) => [p.storey.id, p.part]))
  const needs: RangePlan['needs'] = []
  const pointOf = (storey: Storey, which: 'entry' | 'exit', role: boolean): Vec2 | null => {
    const g = given.get(storey.id)?.[which]
    if (g) return g
    const p = had.get(storey.id)?.[which]
    return role && p ? [p[0], p[1]] : null
  }
  storeys.forEach((storey, k) => {
    const g = given.get(storey.id)
    const part = had.get(storey.id)
    const what: RangeNeed[] = []
    const last = k === storeys.length - 1
    // 사람이 그린 형상이 엇갈리면 채운 것으로 치지 않는다("유효하지 않은 형상은 적용하지 않는다").
    const drawn = g?.footprint
    if (!last && ((drawn ?? part?.footprint ?? []).length < 3 || (drawn && isSelfIntersecting(drawn)))) what.push('footprint')
    if (k === 0 && !pointOf(storey, 'entry', true)) what.push('entry')
    if (last && !pointOf(storey, 'exit', true)) what.push('exit')
    if (what.length) needs.push({ storey, what })
  })
  const name = (storey: Storey, at: Vec2 | null) => {
    if (!at) return null
    const sp = storey.spaces.find((s) => s.id === partSpaceAt(storey, at))
    return sp ? sp.longName || sp.name : null
  }
  const start = storeys[0]
  const end = storeys.at(-1)!
  const a = pointOf(start, 'entry', true)
  const b = pointOf(end, 'exit', true)
  return {
    storeys,
    added: storeys.filter((s) => !had.has(s.id)),
    removed: o.parts.map((p) => p.storey).filter((s) => !storeys.includes(s)),
    needs,
    link: a && b ? { from: name(start, a), to: name(end, b) } : null,
  }
}

function partSpaceAt(storey: Storey, at: Vec2): string | null {
  return partSpaces(storey, { parentId: '', kind: 'stair', name: '', source: 'edit', footprint: [], entry: [at[0], at[1], 0], exit: null })[0] ?? null
}

/**
 * 구간을 바꾼다(OE-ML-08). planRange 가 채울 것을 남기면 적용하지 않는다. 새 층·자리가 바뀐 층의 조각은 사람이 준 것으로 채우고 `edited` 를
 * 단다. 지점의 높이는 그 층 바닥이다(BIM 계단의 지점은 계단 끝 높이지만, 사람이 찍은 지점은 층 바닥에 찍힌다).
 */
export function setVerticalRange(model: Pick<Model, 'storeys'>, parentId: string, fromId: string, toId: string, given: RangeGiven = new Map()): true | { refused: string } {
  const plan = planRange(model, parentId, fromId, toId, given)
  if ('refused' in plan) return plan
  if (plan.needs.length) {
    const what = { footprint: '형상', entry: '진입 지점', exit: '종료 지점' }
    return { refused: `채우지 않은 것이 있습니다: ${plan.needs.map((n) => `${n.storey.name} ${n.what.map((w) => what[w]).join('·')}`).join(', ')}` }
  }
  const o = verticalObjects(model).find((x) => x.id === parentId)!
  const template = o.parts[0].part
  const before = JSON.stringify(o.parts.map((p) => [p.storey.id, p.part]))
  for (const storey of plan.removed) {
    storey.verticalParts = (storey.verticalParts ?? []).filter((p) => p.parentId !== parentId)
    if (!storey.verticalParts.length) delete storey.verticalParts
  }
  plan.storeys.forEach((storey, k) => {
    const first = k === 0
    const last = k === plan.storeys.length - 1
    const g = given.get(storey.id)
    let part = (storey.verticalParts ?? []).find((p) => p.parentId === parentId)
    if (!part) {
      part = { parentId, kind: template.kind, name: template.name, source: template.source, footprint: [], entry: null, exit: null }
      storey.verticalParts = [...(storey.verticalParts ?? []), part]
    }
    const point = (which: 'entry' | 'exit'): Vec3 | null => {
      const at = g?.[which]
      if (at) return [mm(at[0]), mm(at[1]), storey.elevation]
      return part![which]
    }
    const footprint = last ? [] : (g?.footprint ? g.footprint.map((p) => [mm(p[0]), mm(p[1])] as Vec2) : part.footprint)
    const next: Pick<VerticalPart, 'footprint' | 'entry' | 'exit'> = { footprint, entry: first ? point('entry') : null, exit: last ? point('exit') : null }
    if (JSON.stringify([part.footprint, part.entry, part.exit]) !== JSON.stringify([next.footprint, next.entry, next.exit])) {
      Object.assign(part, next)
      part.edited = true
    }
  })
  return before === JSON.stringify(verticalObjects(model).find((x) => x.id === parentId)!.parts.map((p) => [p.storey.id, p.part])) ? { refused: '구간이 그대로입니다.' } : true
}
