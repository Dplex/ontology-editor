// 계단·ES 이어 놓기(OE-ML-06 AC4 · OE-ML-19 AC8 · OE-ML-11 AC6 · OE-ML-07 AC6).
//
// 계단·ES 는 한 구간이 이웃한 두 층이라, 층을 잇는 동선은 아래 구간의 끝점과 위 구간의 시작점이 같은 층에서 만나야 한다. 새 구간을 놓을 때
// 커서가 붙일 수 있는 지점(후보) 가까이 가면 새 구간의 시작점이나 끝점을 그 자리에 고정하고, 커서를 움직이는 대로 구간이 고정점을 중심으로
// 돈다. 클릭하면 두 구간의 연속 연결을 새 구간의 조각에 적는다(model.ts 의 `continuesFrom`·`continuesTo`).
//
// **연결이 유효한지는 저장하지 않고 그때 잰다.** 두 지점이 같은 층에서 `LINK_TOLERANCE` 안에 있고, 같은 종류이며, ES 면 운행 방향이 같아야
// 유효하다. 옮기기·돌리기·방향 바꾸기로 어긋나면 연결을 지우지 않고 재검토로 본다 — GeoJSON 은 유효한 것만 연결로 낸다.
//
// 숫자(고정 1m, 풀기 = 구간 길이 + 6m, 이어진 구간 방향 ±8°)는 PM 프로토타입의 시험용 값이다. 프로토타입은 화면 거리 28px 로도 고정했는데,
// 여기서는 평면 거리 1m 만 쓴다(놓기 모드가 바닥 평면의 점만 알린다).

import type { Model, Storey, Vec2, Vec3 } from './model'
import { partId, verticalObjects, type VerticalObject } from './vertical-object'
import { planFlight, snapHeading, storeyAbove, verticalHeading, wallHeadings } from './vertical-edit'

/** 두 지점이 만난다고 보는 평면 거리(m). */
export const LINK_TOLERANCE = 0.05
/** 커서가 후보 지점에서 이 평면 거리(m) 안이면 고정한다. */
export const LINK_GRAB = 1
/** 고정점에서 구간 길이보다 이만큼(m) 더 멀어지면 고정을 푼다. */
export const LINK_RELEASE = 6
/** 이어진 구간 방향과 그 반대 방향에 붙는 허용 각도(°). 계속 이어 놓는 일이 많아 건물 축(±3°)보다 넓다. */
export const LINK_SNAP = 8

/** 연속 연결 하나. 아래 구간 `lower` 의 끝점과 위 구간 `upper` 의 시작점이 층 `storeyId` 에서 만난다. */
export type VerticalLink = { lower: string; upper: string; storeyId: string }

/** 모델의 연속 연결. 조각의 `continuesFrom`·`continuesTo` 에서 모은다. 같은 짝은 한 번이다. */
export function verticalLinks(model: Pick<Model, 'storeys'>): VerticalLink[] {
  const out = new Map<string, VerticalLink>()
  for (const storey of model.storeys) {
    for (const part of storey.verticalParts ?? []) {
      if (part.continuesFrom) out.set(`${part.continuesFrom}>${part.parentId}@${storey.id}`, { lower: part.continuesFrom, upper: part.parentId, storeyId: storey.id })
      if (part.continuesTo) out.set(`${part.parentId}>${part.continuesTo}@${storey.id}`, { lower: part.parentId, upper: part.continuesTo, storeyId: storey.id })
    }
  }
  return [...out.values()]
}

export type LinkStatus = { ok: true; at: Vec3 } | { ok: false; why: string; at: Vec3 | null }

const directionOf = (o: VerticalObject) => o.parts.find(({ part }) => part.direction)?.part.direction ?? null

/** 연결이 지금 유효한가. 유효하지 않으면 까닭(재검토). */
export function linkStatus(model: Pick<Model, 'storeys'>, link: VerticalLink): LinkStatus {
  const objects = verticalObjects(model)
  const lower = objects.find((o) => o.id === link.lower)
  const upper = objects.find((o) => o.id === link.upper)
  if (!lower || !upper) return { ok: false, why: '이어진 구간이 없습니다', at: null }
  const exit = lower.parts.find(({ storey }) => storey.id === link.storeyId)?.part.exit ?? null
  const entry = upper.parts.find(({ storey }) => storey.id === link.storeyId)?.part.entry ?? null
  if (lower.kind !== upper.kind) return { ok: false, why: '종류가 다릅니다', at: exit }
  if (!exit || !entry) return { ok: false, why: '구간이 바뀌어 그 층에 만나는 지점이 없습니다', at: exit ?? entry }
  if (lower.kind === 'escalator') {
    const [a, b] = [directionOf(lower), directionOf(upper)]
    if (!a || !b) return { ok: false, why: '운행 방향을 모릅니다', at: exit }
    if (a !== b) return { ok: false, why: '운행 방향이 다릅니다', at: exit }
  }
  const d = Math.hypot(exit[0] - entry[0], exit[1] - entry[1])
  if (d > LINK_TOLERANCE) return { ok: false, why: `지점이 ${d.toFixed(2)}m 어긋났습니다`, at: exit }
  return { ok: true, at: exit }
}

/** 놓을 때 붙일 수 있는 지점. `start` 는 새 구간의 시작점을 아래 구간 끝점에, `end` 는 새 구간의 끝점을 위 구간 시작점에 붙인다. */
export type LinkCandidate = { kind: 'start' | 'end'; parentId: string; name: string; at: Vec2; storey: Storey; heading: number | null }

/**
 * 새 구간(종류 `kind`, 시작 층 `fromId`)이 붙을 수 있는 지점. 같은 종류끼리, ES 는 운행 방향이 같은 것끼리다. 이미 다른 구간과 이어진 지점은
 * 뺀다(시작점 후보는 이미 위 구간이 붙은 아래 구간, 끝점 후보는 이미 아래 구간이 붙은 위 구간).
 */
export function linkCandidates(model: Pick<Model, 'storeys'>, kind: 'stair' | 'escalator', fromId: string, direction: 'up' | 'down' | null): LinkCandidate[] {
  const links = verticalLinks(model)
  const above = storeyAbove(model, fromId)
  const out: LinkCandidate[] = []
  for (const o of verticalObjects(model)) {
    if (o.kind !== kind) continue
    if (kind === 'escalator' && (!direction || directionOf(o) !== direction)) continue
    const last = o.parts.at(-1)
    const first = o.parts[0]
    const heading = verticalHeading(model, o.id)
    if (last && last.storey.id === fromId && last.part.exit && !links.some((l) => l.lower === o.id)) {
      out.push({ kind: 'start', parentId: o.id, name: o.name, at: [last.part.exit[0], last.part.exit[1]], storey: last.storey, heading })
    }
    if (above && first && first.storey.id === above.id && first.part.entry && !links.some((l) => l.upper === o.id)) {
      out.push({ kind: 'end', parentId: o.id, name: o.name, at: [first.part.entry[0], first.part.entry[1]], storey: first.storey, heading })
    }
  }
  return out
}

/** 커서 가까운 후보. `LINK_GRAB` 안에서 가장 가까운 것, 없으면 null. */
export function nearestCandidate(candidates: readonly LinkCandidate[], cursor: Vec2): LinkCandidate | null {
  let best: { c: LinkCandidate; d: number } | null = null
  for (const c of candidates) {
    const d = Math.hypot(c.at[0] - cursor[0], c.at[1] - cursor[1])
    if (d <= LINK_GRAB && (!best || d < best.d)) best = { c, d }
  }
  return best?.c ?? null
}

/**
 * 고정한 뒤 커서로 정한 새 구간의 시작점과 방위. 시작점 고정이면 구간이 고정점에서 커서 쪽으로 뻗고, 끝점 고정이면 시작점이 커서 쪽에 놓인다
 * (길이는 층고로 정해진다). 방위는 이어진 구간 방향·반대(±8°)와 건물 축·벽 방향(±3°)에 붙는다. 커서가 고정점에 너무 가까우면 이어진 구간의
 * 방향을 쓴다. 길이를 계산할 수 없으면(최상층 등) null.
 */
export function anchoredFlight(
  model: Pick<Model, 'storeys'>,
  kind: 'stair' | 'escalator',
  fromId: string,
  cand: LinkCandidate,
  cursor: Vec2,
  free = false,
): { at: Vec2; heading: number; by: string | null; length: number } | null {
  const plan = planFlight(model, kind, fromId, [0, 0], 0)
  if ('refused' in plan) return null
  const v = cand.kind === 'start' ? [cursor[0] - cand.at[0], cursor[1] - cand.at[1]] : [cand.at[0] - cursor[0], cand.at[1] - cursor[1]]
  const raw = Math.hypot(v[0], v[1]) < 0.4 ? (cand.heading ?? 0) : (Math.atan2(v[1], v[0]) * 180) / Math.PI
  const extra = cand.heading === null ? [] : [{ angle: cand.heading, by: '이어진 구간 방향', tol: LINK_SNAP }, { angle: cand.heading + 180, by: '꺾어 오르기(반대 방향)', tol: LINK_SNAP }]
  const walls = wallHeadings(cand.storey, cand.at)
  const snap = snapHeading(raw, walls, free, extra)
  const r = (snap.angle * Math.PI) / 180
  const at: Vec2 = cand.kind === 'start' ? [cand.at[0], cand.at[1]] : [cand.at[0] - Math.cos(r) * plan.length, cand.at[1] - Math.sin(r) * plan.length]
  return { at: [Math.round(at[0] * 1000) / 1000, Math.round(at[1] * 1000) / 1000], heading: snap.angle, by: snap.by, length: plan.length }
}

/**
 * 어긋난 연결을 다시 붙이려면 오브젝트 `which`(아래·위 구간)를 얼마나 옮기나. 아래 구간을 옮기면 끝점이 위 구간 시작점으로, 위 구간을 옮기면
 * 시작점이 아래 구간 끝점으로 간다. 지점이 없으면 null.
 */
export function relinkShift(model: Pick<Model, 'storeys'>, link: VerticalLink, which: 'lower' | 'upper'): Vec2 | null {
  const objects = verticalObjects(model)
  const exit = objects.find((o) => o.id === link.lower)?.parts.find(({ storey }) => storey.id === link.storeyId)?.part.exit
  const entry = objects.find((o) => o.id === link.upper)?.parts.find(({ storey }) => storey.id === link.storeyId)?.part.entry
  if (!exit || !entry) return null
  return which === 'lower' ? [entry[0] - exit[0], entry[1] - exit[1]] : [exit[0] - entry[0], exit[1] - entry[1]]
}

/** 연결 하나를 푼다. 그 연결을 적은 조각에서 지운다. 없으면 false. */
export function unlink(model: Pick<Model, 'storeys'>, link: VerticalLink): boolean {
  let hit = false
  for (const storey of model.storeys) {
    if (storey.id !== link.storeyId) continue
    for (const part of storey.verticalParts ?? []) {
      if (part.parentId === link.upper && part.continuesFrom === link.lower) {
        delete part.continuesFrom
        hit = true
      }
      if (part.parentId === link.lower && part.continuesTo === link.upper) {
        delete part.continuesTo
        hit = true
      }
    }
  }
  return hit
}

/** GeoJSON 에 낼 연속 연결. feature id(`오브젝트 id@층 id`) → 이어진 feature 와 재검토 까닭. */
export function linkFeatures(model: Pick<Model, 'storeys'>): Map<string, { with: string[]; review: { id: string; reason: string }[] }> {
  const out = new Map<string, { with: string[]; review: { id: string; reason: string }[] }>()
  const row = (id: string) => out.get(id) ?? (out.set(id, { with: [], review: [] }), out.get(id)!)
  for (const link of verticalLinks(model)) {
    const status = linkStatus(model, link)
    const a = partId(link.lower, link.storeyId)
    const b = partId(link.upper, link.storeyId)
    if (status.ok) {
      row(a).with.push(b)
      row(b).with.push(a)
    } else {
      row(a).review.push({ id: b, reason: status.why })
      row(b).review.push({ id: a, reason: status.why })
    }
  }
  return out
}
