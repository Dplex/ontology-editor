// 편집 리플레이 카드의 관계 그래프. 장면의 TTL 변화(replay.ts 의 TtlChange)에서 다른 엔티티를 가리키는 줄(brick:hasLocation,
// brick:feeds, brick:hasPart …)만 골라, 주어마다 "끊긴 대상"과 "새로 이어진 대상"으로 나눈다. 설비를 옮겨 소속 방이 바뀌면
// hasLocation 의 옛 방이 끊기고 새 방이 이어진다 — BIM 을 고친 것이 온톨로지의 어느 관계를 바꿨는지를 그림으로 보인다.

import type { TtlChange } from './replay'
import { josa } from './josa'

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

/**
 * 관계 변화를 "DT 에 물으면 답이 어떻게 바뀌나" 로 한 줄씩. 온톨로지를 읽지 않는 사람(PM·운영)에게 이 편집의 뜻을 말로 준다.
 * - hasLocation(설비 → 방·층): 「방 안의 설비」 질의에서 빠지고 들어간다.
 * - feeds(상류 → 하류): 「X 가 공급하는 것」 질의의 답이 바뀐다.
 * - hasPart(층·계통·존 → 구성): 「X 의 구성」 질의의 답이 바뀐다.
 * 그 밖의 술어는 "X 의 <술어>" 로 적는다. name 은 TTL 이름 → 사람이 읽는 이름.
 */
export function impactLines(rels: readonly Relation[], name: (ref: string) => string): string[] {
  const names = (xs: readonly string[]) => xs.map((x) => name(x))
  /** 「A」, 「B」 + 마지막 이름에 맞춘 조사. */
  const list = (xs: readonly string[], j: Parameters<typeof josa>[1]) => {
    const n = names(xs)
    return `${n.map((x) => `「${x}」`).join(', ')}${josa(n[n.length - 1] ?? '', j)}`
  }
  const out: string[] = []
  for (const r of rels) {
    const s = name(r.subject)
    if (r.predicate === 'hasLocation') {
      const into = names(r.came).map((x) => `「${x}」`).join(', ')
      const from = names(r.gone).map((x) => `「${x}」`).join(', ')
      const who = `「${s}」${josa(s, '이/가')}`
      if (r.came.length && r.gone.length) out.push(`${into} 안의 설비에 ${who} 들어가고, ${from} 안의 설비에서는 빠진다`)
      else if (r.came.length) out.push(`${into} 안의 설비에 ${who} 들어간다`)
      else out.push(`${from} 안의 설비에서 ${who} 빠진다`)
    } else if (r.predicate === 'feeds' || r.predicate === 'hasPart') {
      const what = r.predicate === 'feeds' ? `「${s}」${josa(s, '이/가')} 공급하는 것` : `「${s}」의 구성`
      if (r.came.length && r.gone.length) out.push(`${what}에 ${list(r.came, '이/가')} 더해지고, ${list(r.gone, '이/가')} 빠진다`)
      else if (r.came.length) out.push(`${what}에 ${list(r.came, '이/가')} 더해진다`)
      else out.push(`${what}에서 ${list(r.gone, '이/가')} 빠진다`)
    } else {
      out.push(`「${s}」의 ${r.predicate}: ${[r.came.length ? `+ ${names(r.came).join(', ')}` : '', r.gone.length ? `− ${names(r.gone).join(', ')}` : ''].filter(Boolean).join(' ')}`)
    }
  }
  return out
}
