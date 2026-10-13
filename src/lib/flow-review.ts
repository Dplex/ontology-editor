// 유체 흐름이 아닌 연결(OE-PIP-18).
//
// **형상 추정 연결**은 한쪽이 흐름 없는 기기(조명·감지기·비치품)면 연결로 넣지 않는다. 버리지 않고 `model.flowlessGeometry` 에 두고, 종류가
// 바뀔 때마다 다시 가른다(repartitionFlowless). 사람이 끊은 연결은 두 목록 어디에도 없어서 종류를 바꿔도 돌아오지 않는다.
//
// **BIM 포트 연결과 사람이 이은 연결**은 지우지 않는다. 원본 정보이고 사람의 판단이라서다. 대신 유체 흐름 관계가 아니면 검토 대상으로
// 표시하고 TTL `brick:feeds` 에서 뺀다. 포트가 있다는 것만으로 전기·신호 연결을 공기·물 공급 관계로 보지 않는다. 검토 대상은 둘이다.
// - 한쪽이 흐름 없는 기기이고 그 기기가 공기·물 계통에 속하지 않는다(조명 포트가 덕트에 물림). 계통에 든 것은 경로 위에 끼인 것으로 본다 —
//   ifc4Mep 의 덕트 센서(사전으로는 열감지기)가 급기 계통의 두 덕트 사이에 포트로 끼워져 있다.
// - 덕트·배관끼리인데 매체가 겹치지 않는다(공기 덕트와 물 배관). **기기의 매체는 보지 않는다.** 사전이 아는 매체는 일부라서다 — ifc4Mep 의
//   물 코일 디퓨저, 성수의 순환수 실내기 7대가 실제로 물 배관에 포트로 물려 있었다.
// 종류를 모르는 기기는 검토 대상으로 세지 않는다 — 모르는 것을 흐름 없다고 단정하지 않는다.

import { mediaOf } from './connect-candidates'
import { isFlowlessKind, systemKind } from './kinds'
import { isConduit, type Connection, type Equipment, type Model } from './model'

const MEDIUM_LABEL: Record<string, string> = { air: '공기', water: '물', refrigerant: '냉매' }

/**
 * 형상 연결을 흐름 없는 기기에 닿는 것과 아닌 것으로 다시 가른다. 종류를 바꾼 뒤(edit.ts 의 setTypeKind·restore)와 편집 파일을 얹은 뒤에
 * 부른다. 옮긴 수를 돌려준다. 포트·사람 연결은 건드리지 않는다.
 */
export function repartitionFlowless(model: Model): { removed: number; restored: number } {
  const kindOf = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.kind]))
  const flowless = (c: Connection) => isFlowlessKind(kindOf.get(c.from)) || isFlowlessKind(kindOf.get(c.to))
  const out = model.connections.filter((c) => c.source === 'geometry' && flowless(c))
  const back = (model.flowlessGeometry ?? []).filter((c) => !flowless(c))
  if (!out.length && !back.length) return { removed: 0, restored: 0 }
  const leaving = new Set(out)
  const returning = new Set(back)
  model.connections = [...model.connections.filter((c) => !leaving.has(c)), ...back]
  const kept = [...(model.flowlessGeometry ?? []).filter((c) => !returning.has(c)), ...out]
  if (kept.length) model.flowlessGeometry = kept
  else delete model.flowlessGeometry
  return { removed: out.length, restored: back.length }
}

export type FlowReview = { connection: Connection; reason: string; /** 걸린 쪽 기기(흐름 없는 기기). 매체가 다르면 두 끝 다. */ ids: string[] }

/** 유체 흐름 관계가 아닌 BIM 포트·사람 연결. 지우지 않고 검토 대상으로 둔다. */
export function flowReviews(model: Model, name: (id: string) => string = (id) => id): FlowReview[] {
  const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const media = new Map<string, string[]>()
  const mediaFor = (e: Equipment) => {
    let m = media.get(e.id)
    if (!m) media.set(e.id, (m = mediaOf(model, e)))
    return m
  }
  // 공기·물 계통에 든 기기. 계통 종류가 매체를 말한다.
  const fluidSystem = (e: Equipment) => !!e.systemId && !!systemKind(model.systems.find((x) => x.id === e.systemId)?.kind)?.medium
  const out: FlowReview[] = []
  for (const c of model.connections) {
    if (c.source === 'geometry') continue
    const a = byId.get(c.from)
    const b = byId.get(c.to)
    if (!a || !b) continue
    const flowless = [a, b].filter((e) => isFlowlessKind(e.kind) && !fluidSystem(e))
    if (flowless.length) {
      out.push({ connection: c, reason: `${flowless.map((e) => name(e.id)).join('·')}: 흐름 없는 기기`, ids: flowless.map((e) => e.id) })
      continue
    }
    if (!isConduit(a.role) || !isConduit(b.role)) continue
    const ma = mediaFor(a)
    const mb = mediaFor(b)
    if (ma.length && mb.length && !ma.some((m) => mb.includes(m))) {
      const label = (ms: string[]) => ms.map((m) => MEDIUM_LABEL[m] ?? m).join('·')
      out.push({ connection: c, reason: `매체가 다름(${name(a.id)} ${label(ma)} ↔ ${name(b.id)} ${label(mb)})`, ids: [a.id, b.id] })
    }
  }
  return out
}

/** TTL `brick:feeds` 를 만들 연결. 검토 대상(유체 흐름이 아닌 BIM·사람 연결)을 뺀다. */
export function fluidConnections<C extends Connection>(model: Model, connections: readonly C[]): C[] {
  const review = new Set(flowReviews(model).map((r) => `${r.connection.from}|${r.connection.to}`))
  if (!review.size) return [...connections]
  return connections.filter((c) => !review.has(`${c.from}|${c.to}`) && !review.has(`${c.to}|${c.from}`))
}
