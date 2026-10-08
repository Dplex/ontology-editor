// 연결 누락의 연결 후보(OE-PIP-08).
//
// 완전성 검사가 "연결망에 붙어 있지 않다" 고 한 설비·덕트·배관에 가까운 이웃을 후보로 보인다. 가깝다는 것만으로 잇지 않는다 — 다른
// 매체(공기 덕트 ↔ 물 배관), 흐름 없는 기기(조명·감지기·비치품, OE-PIP-18), 말단끼리, 다른 계통, 사람이 해제 보정한 BIM 연결(OE-PIP-06)은
// 후보에서 빼고 몇 개를 뺐는지 센다. 후보는 이름·거리·계통·매체와 함께 보이고, 사람이 하나를 골라 잇는다(출처 `manual`, 방향 없음).

import { releasedBetween } from './connection-release'
import { equipmentKind, systemKind, systemKindOf, type Medium } from './kinds'
import { isConduit, type Equipment, type Model } from './model'
import type { Box } from './checks'

export type ConnectCandidate = {
  id: string
  /** 형상 사이 거리(미터). */
  distance: number
  /** 계통 이름. 없으면 null. */
  system: string | null
  /** 알 수 있는 매체. 비면 모름이다. */
  media: Medium[]
}

export type CandidateResult = {
  candidates: ConnectCandidate[]
  /** 거리 안에 있었지만 뺀 것의 수. 사람이 "왜 저 덕트는 후보가 아니냐" 를 알 수 있게 센다. */
  excluded: { medium: number; flowless: number; terminal: number; system: number; released: number }
  /** 고친 설비 자신의 매체. 비면 매체로 거르지 못했다. */
  media: Medium[]
}

/** 후보를 찾는 거리(미터). 그보다 먼 것은 접합 부재가 빠진 것이지 잇기로 고칠 일이 아니다. */
export const CANDIDATE_GAP = 1
const LIMIT = 3

/** 냉매 설비. 사전에 공기·물 흐름이 없지만(`flow: {}`) 흐름 없는 기기가 아니다 — 지금 규칙이 다루지 않는 매체다(OE-PIP-18). */
const REFRIGERANT_KINDS: readonly string[] = ['outdoor_unit']

/** 종류를 아는 흐름 없는 기기. 종류를 모르는 것과 냉매 설비는 흐름이 없다고 단정하지 않는다(OE-PIP-18). */
export function isFlowless(e: Equipment): boolean {
  const info = equipmentKind(e.kind)
  return !!info && Object.keys(info.flow ?? {}).length === 0 && !REFRIGERANT_KINDS.includes(info.kind)
}

/** 설비·덕트·배관의 매체. 종류의 흐름, 계통 종류, 덕트·배관의 유형 이름, IFC 클래스(Duct·Pipe) 순으로 모은다. */
export function mediaOf(model: Model, e: Equipment): Medium[] {
  const out = new Set<Medium>()
  for (const m of Object.keys(equipmentKind(e.kind)?.flow ?? {})) if (m === 'air' || m === 'water') out.add(m)
  const system = e.systemId ? model.systems.find((s) => s.id === e.systemId) : undefined
  const bySystem = systemKind(system?.kind)?.medium
  if (bySystem) out.add(bySystem)
  if (isConduit(e.role)) {
    const hint = systemKindOf(e.name, e.objectType ?? '')?.medium
    if (hint) out.add(hint)
    if (/^Duct/i.test(e.ifcClass)) out.add('air')
    if (/^Pipe/i.test(e.ifcClass)) out.add('water')
  }
  return [...out]
}

const gapBetween = (a: Box, b: Box) =>
  Math.hypot(Math.max(0, a[0] - b[3], b[0] - a[3]), Math.max(0, a[1] - b[4], b[1] - a[4]), Math.max(0, a[2] - b[5], b[2] - a[5]))

/** `id` 에 이을 후보. 가까운 순으로 셋까지. 이미 이어진 상대는 뺀다(열린 끝에 붙을 것을 찾는다). */
export function connectCandidates(model: Model, id: string, boxes: ReadonlyMap<string, Box>): CandidateResult {
  const equipment = model.storeys.flatMap((s) => s.equipment)
  const me = equipment.find((e) => e.id === id)
  const box = boxes.get(id)
  const excluded = { medium: 0, flowless: 0, terminal: 0, system: 0, released: 0 }
  const media = me ? mediaOf(model, me) : []
  if (!me || !box) return { candidates: [], excluded, media }
  const linked = new Set(model.connections.flatMap((c) => (c.from === id ? [c.to] : c.to === id ? [c.from] : [])))
  const terminal = (e: Equipment) => e.role === 'terminal' && !isConduit(e.role)
  const systemName = (e: Equipment) => (e.systemId ? (model.systems.find((s) => s.id === e.systemId)?.name ?? e.systemId) : null)
  const found: ConnectCandidate[] = []
  for (const other of equipment) {
    if (other.id === id || linked.has(other.id)) continue
    const b = boxes.get(other.id)
    if (!b) continue
    const distance = gapBetween(box, b)
    if (distance > CANDIDATE_GAP) continue
    if (releasedBetween(model, id, other.id)) {
      excluded.released++
      continue
    }
    if (isFlowless(other)) {
      excluded.flowless++
      continue
    }
    if (me.systemId && other.systemId && me.systemId !== other.systemId) {
      excluded.system++
      continue
    }
    const theirs = mediaOf(model, other)
    if (media.length && theirs.length && !theirs.some((m) => media.includes(m))) {
      excluded.medium++
      continue
    }
    if (terminal(me) && terminal(other)) {
      excluded.terminal++
      continue
    }
    found.push({ id: other.id, distance, system: systemName(other), media: theirs })
  }
  found.sort((a, b) => a.distance - b.distance)
  return { candidates: found.slice(0, LIMIT), excluded, media }
}

const MEDIUM_LABEL: Record<Medium, string> = { air: '공기', water: '물', refrigerant: '냉매' }
export const mediaLabel = (media: readonly Medium[]) => (media.length ? media.map((m) => MEDIUM_LABEL[m]).join('·') : '매체 모름')

/** 뺀 후보를 한 줄로. 없으면 빈 글. */
export function excludedText(x: CandidateResult['excluded']): string {
  const parts = [
    x.medium ? `다른 매체 ${x.medium}` : '',
    x.flowless ? `흐름 없는 기기 ${x.flowless}` : '',
    x.terminal ? `말단끼리 ${x.terminal}` : '',
    x.system ? `다른 계통 ${x.system}` : '',
    x.released ? `해제 보정한 연결 ${x.released}` : '',
  ].filter(Boolean)
  return parts.length ? `가까워도 후보에서 뺀 것: ${parts.join(' · ')}.` : ''
}
