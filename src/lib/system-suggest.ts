// 계통이 없는 설비의 계통 후보(ADR-0057). 성수는 계통이 1,037개라 패널의 계통 상자에서 고르기 어렵다.
//
// 같은 층에서 이 설비와 가까운 구성원(설비·덕트·배관)이 있는 계통을, 가장 가까운 구성원까지의 거리 순으로 `LIMIT` 개까지 모은다.
// 반경(`REACH`) 밖의 계통은 후보가 아니다. **Laya 로 순서를 다시 매기지 않는다** — 가진 BIM 960줄에서 가장 가까운 계통이 첫 후보
// 608, 셋 안 897 을 맞혔고, Laya 를 어떻게 섞어도(계통 고르기·계통 종류 고르기·거리 감쇠와 곱하기) 그보다 못했다. 근처 후보끼리는
// 계통 종류도 같아서(성수 급기 계통 753개) 가르는 것이 거리뿐이다. 후보 글(`candidateText`)과 설비 글(`equipmentText`)은 그 실험의
// 재료로 남긴다(scripts/laya/export.test.ts, train.py --picks·--sysk).
//
// 정하지 않는다 — 누르면 패널의 계통 상자에서 고른 것과 같다(setEquipmentSystem, 출처 편집, TTL 의 brick:hasPart).
import { equipmentKind, systemKind } from './kinds'
import { isConduit, segmentPath, type Equipment, type Model, type System, type Vec3 } from './model'
import { whatOf } from './family-clues'

export type SystemCandidate = {
  system: System
  /** 가장 가까운 구성원까지(미터, 수평·수직 다). */
  distance: number
  /** 그 구성원이 무엇인지(종류·덕트·배관). */
  nearest: string
  /** 계통의 구성원 수. */
  members: number
}

/** 후보를 찾는 반경(미터). 방 하나 건너까지다. 더 멀면 그 계통의 덕트·배관이 이 자리로 오지 않는다고 본다. */
export const REACH = 15
export const LIMIT = 8

function pointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2))
  return Math.hypot(p[0] - (a[0] + t * d[0]), p[1] - (a[1] + t * d[1]), p[2] - (a[2] + t * d[2]))
}

function distanceTo(p: Vec3, e: Equipment): number | null {
  const seg = segmentPath(e)
  if (seg && 'path' in seg) return pointToSegment(p, seg.path[0], seg.path[1])
  return e.position ? Math.hypot(p[0] - e.position[0], p[1] - e.position[1], p[2] - e.position[2]) : null
}

/**
 * 이 설비의 계통 후보. 설비 자신은 구성원에서 뺀다. `skip` 의 구성원도 거리로 세지 않는다 — 학습 재료에서 BIM 설비에 이미 이어진
 * 덕트·배관을 빼서, 아직 아무것에도 이어지지 않은 막 놓은 설비를 흉내 낸다(이어진 덕트는 거리 0 이라 가장 가까운 것이 거저 맞는다).
 */
export function systemCandidates(model: Model, equipmentId: string, limit = LIMIT, skip: ReadonlySet<string> = new Set()): SystemCandidate[] {
  const storey = model.storeys.find((s) => s.equipment.some((e) => e.id === equipmentId))
  const e = storey?.equipment.find((x) => x.id === equipmentId)
  if (!storey || !e?.position) return []
  const here = new Map(storey.equipment.map((x) => [x.id, x]))
  const out: SystemCandidate[] = []
  for (const system of model.systems) {
    let best: { d: number; who: Equipment } | null = null
    for (const id of system.memberIds) {
      if (id === equipmentId || skip.has(id)) continue
      const m = here.get(id)
      if (!m) continue
      const d = distanceTo(e.position, m)
      if (d !== null && d <= REACH && (!best || d < best.d)) best = { d, who: m }
    }
    if (best) out.push({ system, distance: best.d, nearest: whatOf(best.who) ?? (isConduit(best.who.role) ? '덕트·배관' : '종류 모름'), members: system.memberIds.length })
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit)
}

/**
 * 후보 하나를 글로(화면의 설명, Laya 실험의 선택지). 거리는 넣지 않는다 — 선택지마다 적힌 숫자를 견주는 것은 인코더가 못했다
 * (거리를 넣고 배웠더니 병원 400줄 중 첫 후보 123, 가장 가까운 계통은 234).
 */
export function candidateText(c: SystemCandidate): string {
  const kind = systemKind(c.system.kind)?.label ?? '종류 모름'
  return `${c.system.name} · ${kind} · 가까운 구성원 ${c.nearest} · 구성원 ${c.members}`
}

/**
 * 설비를 Laya 가 읽는 글로(계통 실험의 재료). `hideKind` 는 BIM 설비의 종류를 가려 막 놓은 설비를 흉내 낸다.
 */
export function equipmentText(model: Model, equipmentId: string, hideKind = false): string | null {
  const storey = model.storeys.find((s) => s.equipment.some((e) => e.id === equipmentId))
  const e = storey?.equipment.find((x) => x.id === equipmentId)
  if (!storey || !e) return null
  const space = e.spaceId ? storey.spaces.find((s) => s.id === e.spaceId) : null
  return [
    `설비 이름: ${e.name}`,
    `종류: ${(!hideKind && equipmentKind(e.kind)?.label) || '모름'}`,
    `놓인 곳: ${space ? space.longName || space.name : '소속 없음'}`,
    `바닥에서: ${e.position ? (e.position[2] - storey.elevation).toFixed(1) : '?'}m`,
  ].join('\n')
}
