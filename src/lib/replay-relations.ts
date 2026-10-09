// 편집 리플레이 카드의 관계 그래프. 장면의 TTL 변화(replay.ts 의 TtlChange)에서 다른 엔티티를 가리키는 줄(brick:hasLocation,
// brick:feeds, brick:hasPart …)만 골라, 주어마다 "끊긴 대상"과 "새로 이어진 대상"으로 나눈다. 설비를 옮겨 소속 방이 바뀌면
// hasLocation 의 옛 방이 끊기고 새 방이 이어진다 — BIM 을 고친 것이 온톨로지의 어느 관계를 바꿨는지를 그림으로 보인다.

import type { TtlChange } from './replay'

export type Relation = {
  subject: string
  /** 접두어를 뗀 술어(hasLocation). */
  predicate: string
  gone: string[]
  came: string[]
}

/** 한 줄을 술어와 대상들로. 대상이 모두 엔티티(ex:)일 때만 관계다 — 이름(rdfs:label)·숫자·종류(a)는 뺀다. */
function relationOf(line: string, subject: string): { predicate: string; objects: string[] } | null {
  const body = line.startsWith(`${subject} `) ? line.slice(subject.length + 1) : line
  const m = /^([\w-]+:[\w-]+)\s+(.+)$/.exec(body.trim())
  if (!m || m[1] === 'a') return null
  const objects = m[2].split(/\s*,\s*/).filter(Boolean)
  if (!objects.length || !objects.every((o) => /^ex:\S+$/.test(o))) return null
  return { predicate: m[1], objects }
}

/** 장면의 관계 변화. 대상이 실제로 바뀐 술어만(같은 목록을 다시 쓴 줄은 뺀다). 주어·술어 순서는 TTL 변화 순서. */
export function relationsOf(changes: readonly TtlChange[]): Relation[] {
  const out: Relation[] = []
  for (const c of changes) {
    const was = new Map<string, Set<string>>()
    const now = new Map<string, Set<string>>()
    const order: string[] = []
    const take = (lines: readonly string[], into: Map<string, Set<string>>) => {
      for (const l of lines) {
        const r = relationOf(l, c.subject)
        if (!r) continue
        if (!order.includes(r.predicate)) order.push(r.predicate)
        const set = into.get(r.predicate) ?? new Set<string>()
        for (const o of r.objects) set.add(o)
        into.set(r.predicate, set)
      }
    }
    take(c.removed, was)
    take(c.added, now)
    for (const p of order) {
      const a = was.get(p) ?? new Set<string>()
      const b = now.get(p) ?? new Set<string>()
      const gone = [...a].filter((o) => !b.has(o))
      const came = [...b].filter((o) => !a.has(o))
      if (gone.length || came.length) out.push({ subject: c.subject, predicate: p.replace(/^[\w-]+:/, ''), gone, came })
    }
  }
  return out
}
