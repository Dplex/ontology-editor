// 흐름 방향의 근거와 연쇄(에테리온 "Ontology Resolves the Path"·"Instant Reverse" 를 참고했다).
//
// **근거(flowBasis)**: 한 계통의 연결이 방향을 어디서 얻었나를 세 갈래로 센다 — ① BIM 포트가 말한 것 ② 규칙(계통·설비 종류, 화면의 출처
// "사전")이 정한 것 ③ 사람이 정한 것. 그리고 그 결과 TTL 에 `brick:feeds` 로 나가는 연결 수. 나가는 규칙은 ttl.ts 와 같다: 포트 방향과
// 사람이 정한 방향은 그대로, 규칙 방향은 사람이 확정했고 재검토 중이 아닌 것만, 유체 흐름이 아닌 연결(flow-review.ts)은 뺀다.
//
// **연쇄(cascadeWaves)**: 확정·적용·해제로 TTL 에 나가는 방향이 바뀐 연결들을, 바뀐 연결끼리 이은 그래프에서 원천에 가까운 순으로
// 줄 세운다. 3D 가 이 순서대로 화살표를 띄워 "한 곳을 고쳤더니 계통을 따라 brick:feeds 가 바뀐다" 를 보인다(viewer.ts 의 playCascade).
// 순서만 정한다 — 몇 ms 간격인지는 화면 몫이다.

import { flowReviews } from './flow-review'
import type { Connection, Model } from './model'

/** 원래 끝 순서의 열쇠. 방향을 바꿔도 `from`·`to` 는 BIM 이 준 순서 그대로라 확정·적용 앞뒤로 같은 연결을 가리킨다. */
export const connectionKey = (c: Pick<Connection, 'from' | 'to'>) => `${c.from}|${c.to}`

/** 이 연결이 TTL 에 `brick:feeds` 로 나갈 때의 흐름 시작 쪽. 나가지 않으면 null. 유체 흐름이 아닌 연결은 부르는 쪽이 거른다. */
export function exportedFrom(c: Connection): string | null {
  if (c.directed) return c.from
  if (c.edited) return c.edited.from
  if (c.inferred?.confirmed && c.inferred.recheck === undefined) return c.inferred.from
  return null
}

/**
 * 확정·적용 전에 떠 두는 것: 연결마다 내보내는 흐름 시작 쪽(나가지 않으면 null)과 검토 대상(유체 흐름 아님)인 연결의 열쇠. 유체 판정
 * (flowReviews)은 모델 전체를 훑어 성수 기계에서 130ms 가 걸리고, 확정·적용은 그것을 바꾸지 않아서 뒤에서 다시 하지 않고 이것을 쓴다.
 */
export type FlowSnapshot = { flows: Map<string, string | null>; review: ReadonlySet<string> }

/**
 * 유체 흐름이 아니라 검토 대상인 연결의 열쇠(두 끝 순서 모두). flow-review.ts 의 fluidConnections 와 같은 판정이다. 화면은 이것을 편집마다
 * 한 번 세어(App.vue 의 flowReviewKeys) 근거·연쇄가 같이 쓴다.
 */
export function reviewKeys(model: Model, manualOnly = false): Set<string> {
  const scope = manualOnly ? { ...model, connections: model.connections.filter((c) => c.source === 'manual') } : model
  return new Set(flowReviews(scope).flatMap((r) => [connectionKey(r.connection), connectionKey({ from: r.connection.to, to: r.connection.from })]))
}

/**
 * 앞뒤로 견줄 때는 사람이 이은 연결만 판정하면 된다(`manualOnly`). 형상 연결은 판정 대상이 아니고(flowReviews), 포트 연결은 방향이 늘
 * `from` 이라 앞뒤가 같다. 성수 기계에서 전체 판정 130ms 가 몇 ms 로 준다.
 */
export function exportedFlows(model: Model, review: ReadonlySet<string> = reviewKeys(model, true)): FlowSnapshot {
  return { flows: new Map(model.connections.map((c) => [connectionKey(c), review.has(connectionKey(c)) ? null : exportedFrom(c)])), review }
}

export type FlowEdge = { a: string; b: string; from: string }

/** 앞뒤를 견줘 새로 나가거나 방향이 뒤집힌 연결. 나가다 빠진 것은 그릴 화살촉이 없어 넣지 않는다. */
export function flowChanges(before: FlowSnapshot, model: Model): FlowEdge[] {
  const out: FlowEdge[] = []
  for (const c of model.connections) {
    const k = connectionKey(c)
    const now = before.review.has(k) ? null : exportedFrom(c)
    if (now !== null && now !== (before.flows.get(k) ?? null)) out.push({ a: c.from, b: c.to, from: now })
  }
  return out
}

/**
 * 바뀐 연결마다 몇 번째 물결에 띄울지. 바뀐 연결끼리만 이은 방향 그래프에서, 들어오는 변이 없는 끝(원천 쪽)부터 너비 우선으로 잰
 * 거리다. 원천이 없는 고리는 남은 것 중 앞 연결의 시작 쪽에서 0 으로 다시 잰다 — 떨어진 덩어리는 같이 퍼진다.
 */
export function cascadeWaves(edges: readonly FlowEdge[]): number[] {
  const toOf = (e: FlowEdge) => (e.from === e.a ? e.b : e.a)
  const out = new Map<string, number[]>()
  const incoming = new Set<string>()
  edges.forEach((e, i) => {
    out.set(e.from, [...(out.get(e.from) ?? []), i])
    incoming.add(toOf(e))
  })
  const dist = new Map<string, number>()
  const walk = (starts: string[]) => {
    const queue = starts.filter((s) => !dist.has(s))
    for (const s of queue) dist.set(s, 0)
    for (let q = 0; q < queue.length; q++) {
      const node = queue[q]
      for (const i of out.get(node) ?? []) {
        const next = toOf(edges[i])
        if (dist.has(next)) continue
        dist.set(next, dist.get(node)! + 1)
        queue.push(next)
      }
    }
  }
  walk(edges.map((e) => e.from).filter((n) => !incoming.has(n)))
  for (const e of edges) if (!dist.has(e.from)) walk([e.from])
  return edges.map((e) => dist.get(e.from)!)
}

export type FlowBasis = {
  /** 이 계통에 닿은 연결 수. */
  total: number
  /** ① BIM 포트가 방향을 말한 연결. */
  bim: number
  /** ② 규칙이 방향을 정한 연결(사람이 정한 것은 빼고). 그중 확정한 것, 재검토 중인 것. */
  rule: number
  ruleConfirmed: number
  ruleRecheck: number
  /** ③ 사람이 정한 방향. */
  edited: number
  /** 누구도 방향을 말하지 않은 연결. */
  unknown: number
  /** 유체 흐름이 아니라 검토 대상인 연결(방향이 있어도 내보내지 않는다). */
  review: number
  /** 그 결과 TTL 에 `brick:feeds` 로 나가는 연결. */
  feeds: number
}

/**
 * 연결이 이 계통의 것인가. 규칙 계통이 이 계통인 것과, 규칙이 없고 한쪽 끝이 이 계통의 구성원인 것이다. 다른 계통의 규칙이
 * 구성원에 닿은 연결은 그 계통에서 센다 — 계통별 확정 표의 "규칙 방향" 수와 같게. 3D 의 흐르는 빛(App.vue)도 이것으로 고른다.
 */
export const systemOwns = (c: Connection, systemId: string, members: ReadonlySet<string>): boolean =>
  c.inferred ? c.inferred.systemId === systemId : members.has(c.from) || members.has(c.to)

/** 한 계통의 흐름 방향 근거. 연결은 `systemOwns` 로 고른다. */
export function flowBasis(model: Model, systemId: string, members: ReadonlySet<string>, review: ReadonlySet<string> = reviewKeys(model)): FlowBasis {
  const own = model.connections.filter((c) => systemOwns(c, systemId, members))
  const basis: FlowBasis = { total: own.length, bim: 0, rule: 0, ruleConfirmed: 0, ruleRecheck: 0, edited: 0, unknown: 0, review: 0, feeds: 0 }
  for (const c of own) {
    if (c.directed) basis.bim++
    else if (c.edited) basis.edited++
    else if (c.inferred) {
      basis.rule++
      if (c.inferred.recheck !== undefined) basis.ruleRecheck++
      else if (c.inferred.confirmed) basis.ruleConfirmed++
    } else basis.unknown++
    if (review.has(connectionKey(c))) basis.review++
    else if (exportedFrom(c) !== null) basis.feeds++
  }
  return basis
}
