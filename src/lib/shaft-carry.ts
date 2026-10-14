// 샤프트 안 배관 연동 이동(OE-ML-17). 샤프트를 통째로 옮기면 그 샤프트에 든 구간(shaft.ts 의 소속)과 그 구간들 사이의 이음쇠(분기점)가
// 같은 거리만큼 같이 가고, 바깥 배관은 샤프트 쪽 끝만 따라 늘어난다. 바깥 설비·바깥 배관의 먼 끝·상관없는 분기는 그대로다.
//
// 계획(`planShaftCarry`)은 옮기기 **전에** 보인다(OE-ML-17 "이동 전 … 미리 표시"). 일부만 안전하게 옮길 수 없으면(좌표가 없는 구간, 샤프트
// 구간이 바깥 설비에 바로 붙음, 샤프트 밖의 분기점에 물림) 까닭을 적고 **전체를 옮기지 않는다** — 일부만 옮기면 배관이 샤프트와 어긋나
// 끊긴다. 사람이 형상·소속을 고친 뒤 다시 옮긴다.
//
// 옮기기는 설비를 옮길 때 배관이 따라오는 장치(edit.ts 의 applyFollow)를 그대로 쓴다. 안쪽 구간·이음쇠는 통째로(rigid), 바깥 구간은
// 한 끝만(stretch) 옮긴다. 연결 대상·흐름 방향·해제 보정은 건드리지 않는다.

import { applyFollow, type FollowPlan, type SegmentAxis } from './edit'
import { distanceToRing, pointInPolygon } from './mapping'
import { isConduit, type Equipment, type Model, type Vec2 } from './model'
import { SHAFT_TOLERANCE, shaftMembers } from './shaft'
import { moveVertical } from './vertical-edit'
import { verticalObjects } from './vertical-object'

export type ShaftCarry = FollowPlan & {
  /** 같이 옮길 샤프트 안 구간(소속)과 이음쇠(분기점). */
  segments: Equipment[]
  fittings: Equipment[]
  /** 끝을 늘일 바깥 구간. */
  outside: Equipment[]
  /** 영향 층(이름, 높이 순). */
  storeys: string[]
  /** 안전하게 옮길 수 없는 까닭. 하나라도 있으면 옮기지 않는다. */
  reasons: string[]
}

const dist2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/** 샤프트를 옮기면 무엇이 같이 가고 무엇이 늘어나며, 옮길 수 없다면 왜인지. */
export function planShaftCarry(model: Model, shaftId: string, axisOf: (id: string) => SegmentAxis | null): ShaftCarry {
  const plan: ShaftCarry = { rigid: [], stretch: [], held: [], blocked: [], segments: [], fittings: [], outside: [], storeys: [], reasons: [] }
  const o = verticalObjects(model).find((x) => x.id === shaftId && x.kind === 'shaft')
  if (!o) return plan
  const ring = o.parts.find((p) => p.part.footprint.length >= 3)?.part.footprint ?? []
  const inAxis = (p: readonly number[]) => ring.length >= 3 && (pointInPolygon([p[0], p[1]] as Vec2, ring) || distanceToRing([p[0], p[1]] as Vec2, ring) <= SHAFT_TOLERANCE)
  const storeyOf = new Map<string, string>()
  const byId = new Map<string, Equipment>()
  for (const s of model.storeys)
    for (const e of s.equipment) {
      byId.set(e.id, e)
      storeyOf.set(e.id, s.id)
    }
  const neighbors = new Map<string, Set<string>>()
  for (const c of model.connections) {
    if (c.from === c.to) continue
    neighbors.set(c.from, (neighbors.get(c.from) ?? new Set()).add(c.to))
    neighbors.set(c.to, (neighbors.get(c.to) ?? new Set()).add(c.from))
  }
  const name = (e: Equipment) => e.name || e.id

  // 안쪽: 소속 구간과, 그 구간에 물린 이음쇠 중 축 안에 있는 것(이음쇠끼리 이어진 것도 축 안이면 따라 들인다).
  const inner = new Set<string>()
  for (const e of shaftMembers(model, shaftId)) {
    inner.add(e.id)
    plan.segments.push(e)
  }
  let frontier = [...inner]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier)
      for (const n of neighbors.get(id) ?? []) {
        const e = byId.get(n)
        if (!e || inner.has(n) || e.role !== 'fitting' || !e.position || !inAxis(e.position)) continue
        inner.add(n)
        plan.fittings.push(e)
        next.push(n)
      }
    frontier = next
  }
  if (!inner.size) return plan

  for (const id of inner) {
    const e = byId.get(id)!
    if (!e.position) plan.reasons.push(`${name(e)}의 좌표가 없어 같이 옮길 수 없습니다. 좌표를 넣거나 샤프트 소속을 푼 뒤 옮깁니다`)
  }
  // 바깥: 안쪽에 물린 것. 구간은 샤프트 쪽 끝만 늘이고, 설비·축 밖 분기점은 옮기지 않으니 일부만 옮기게 되어 막는다.
  const stretched = new Set<string>()
  for (const id of inner) {
    const e = byId.get(id)!
    for (const n of neighbors.get(id) ?? []) {
      if (inner.has(n)) continue
      const x = byId.get(n)
      if (!x) continue
      if (x.role === 'segment') {
        const axis = axisOf(n)
        if (!x.position || !axis || !e.position) {
          plan.reasons.push(`바깥 배관 ${name(x)}의 ${!x.position ? '좌표가' : '형상이'} 없어 끝을 따라 늘일 수 없습니다`)
          continue
        }
        const now: [readonly number[], readonly number[]] = x.endShift ? [axis[0].map((v, i) => v + x.endShift![0][i]), axis[1].map((v, i) => v + x.endShift![1][i])] : axis
        const end: 0 | 1 = dist2(now[0], e.position) <= dist2(now[1], e.position) ? 0 : 1
        plan.stretch.push({ id: n, end })
        if (!stretched.has(n)) {
          stretched.add(n)
          plan.outside.push(x)
        }
      } else if (x.role === 'fitting') {
        plan.reasons.push(`분기점 ${name(x)}이 샤프트 밖에 있어 ${name(e)}만 옮기면 그 분기가 끊깁니다. 배관 형상을 먼저 고칩니다`)
      } else if (!isConduit(x.role)) {
        plan.reasons.push(`${name(e)}이 설비 ${name(x)}에 바로 붙어 있어 같이 옮기면 설비에서 떨어집니다. 설비는 샤프트와 같이 옮기지 않습니다`)
      }
    }
  }
  plan.rigid = [...inner]
  const ids = new Set([...inner, ...stretched].map((id) => storeyOf.get(id)))
  plan.storeys = [...model.storeys].sort((a, b) => a.elevation - b.elevation).filter((s) => ids.has(s.id)).map((s) => s.name)
  return plan
}

/**
 * 샤프트를 옮기고 안쪽 배관을 같이, 바깥 배관 끝을 따라 옮긴다. 옮길 수 없으면(계획에 까닭이 있으면) 아무것도 바꾸지 않고 까닭을 돌려준다.
 * 안쪽 배관이 없는 샤프트는 샤프트만 옮긴다.
 */
export function moveShaftCarrying(model: Model, shaftId: string, d: Vec2, axisOf: (id: string) => SegmentAxis | null): true | { refused: string } | false {
  const plan = planShaftCarry(model, shaftId, axisOf)
  if (plan.reasons.length) return { refused: plan.reasons.join(' · ') }
  if (!moveVertical(model, shaftId, d)) return false
  if (plan.rigid.length) applyFollow(model, plan, [d[0], d[1], 0], axisOf)
  return true
}
