// 층 사이 연결. 계단실·승강로가 바로 위층의 같은 계단실·승강로와 이어진다(OE-ML-19 의 겹침 후보, ADR-0032).
//
// 방-문-방 연결(문의 `connects`)은 한 층 안에서만 선다. 로봇 경로가 층을 옮기려면 어느 계단실이 위층의 어느 계단실과
// 같은 수직 통로인지 알아야 한다. 선행 연구(Zhu 2025, IFC-Graph)도 수평 연결과 수직 연결을 따로 만든다(정본 부록 E).
//
// **종류와 자리가 둘 다 맞을 때만 후보다.** 방 종류(계단실·승강로, kinds.ts 의 ROOM_KINDS)가 같고, 높이로 줄 세운 바로 위층에서
// 바닥 외곽선이 작은 쪽 넓이의 절반 넘게 겹쳐야 한다. 정확히 절반은 후보가 아니다. 종류를 모르는 방은 잇지 않는다 — 자리만
// 겹친다고 이으면 위층 복도가 아래층 로비와 이어진다. 넓이를 잴 수 없는 외곽선, 높이가 같거나 없는 층은 뺀다.
//
// **양쪽이 서로를 최고 후보로 고를 때만 잇는다.** 아래층 방의 최고 후보가 위층 방이고, 그 위층 방의 최고 후보도 그 아래층
// 방일 때다. 최고 비율이 둘 이상이면(동률) 고르지 못한다. 그 밖의 후보(동률, 한쪽만 고른 것, 큰 방 하나에 작은 방 둘이
// 걸린 것)는 모호 후보로 두고 내보내지 않는다 — 틀린 층간 연결은 빠진 연결보다 로봇 경로에 나쁘다.
//
// **수직 관통 오브젝트가 말한 연결이 먼저다**(OE-ML-19, ADR-0033). 계단(IfcStair) 오브젝트가 시작 층 진입 지점의 물리존과 끝 층
// 종료 지점의 물리존을 이으면 그 연결을 쓰고(출처 `bim`), 그 두 물리존은 겹침 후보에서 뺀다 — 겹침 추정이 명시 연결을 덮어쓰지 않는다.
//
// 모델에 저장하지 않고 내보낼 때 계산한다. 방의 경계·종류가 바뀌면 다음 내보내기에 그대로 반영된다.

import { overlapArea } from './polygon'
import { polygonArea, type Model, type VerticalPart } from './model'
import { explicitSpaceLinks, verticalObjects } from './vertical-object'

/** 층 사이로 이어지는 방 종류. */
export const VERTICAL_KINDS: readonly string[] = ['staircase', 'elevator_shaft']

/** 겹친 넓이가 작은 쪽 넓이의 이만큼을 넘어야 같은 수직 통로 후보로 본다. */
const MIN_SHARE = 0.5
/** 비율을 같다고 보는 차이. 삼각형으로 나눠 잰 넓이라 정확히 절반·동률도 끝자리가 흔들린다. */
const EPS = 1e-9

/** 겹침 후보 하나. low 가 아래층 방이다. */
export type VerticalPair = { low: string; high: string; share: number }

/**
 * 잇지 않은 후보와 그 까닭.
 * - `tie`: 한쪽 방에서 최고 비율이 둘 이상이다.
 * - `not-mutual`: 한쪽은 이 짝을 골랐는데 반대쪽은 다른 방을 골랐다(다대일, 여러 통로가 합쳐질 수 있는 자리 포함).
 */
export type AmbiguousPair = VerticalPair & { reason: 'tie' | 'not-mutual' }

/** 연결의 출처. 오브젝트가 말한 것은 그 오브젝트의 출처(`bim`·`edit`), 겹침으로 추정한 것은 `calc` 다. */
export type VerticalSource = VerticalPart['source'] | 'calc'

export type VerticalConnections = {
  /** 방 id → 아래·위층에서 이어진 방 id. 이어진 것이 없는 방은 담지 않는다. */
  links: Map<string, string[]>
  /** 방 id → 그 방 연결의 출처. 명시 연결이 있는 방은 겹침 후보에서 빠지므로 방 하나의 출처는 하나다. */
  sources: Map<string, VerticalSource>
  /** 수직 관통 오브젝트가 이은 물리존 짝. */
  explicit: { a: string; b: string; parentId: string }[]
  /** 겹침으로 이은 짝(`calc`). */
  pairs: VerticalPair[]
  /** 사람이 확인하기 전에는 내보내지 않는 후보. */
  ambiguous: AmbiguousPair[]
}

/** 층 사이 연결과 모호 후보. */
export function verticalConnections(model: Model): VerticalConnections {
  // 높이가 없는 층은 줄 세울 수 없다. 같은 높이의 두 층은 위아래가 아니다(같은 층이 두 번 들어온 것이다).
  const storeys = model.storeys.filter((s) => Number.isFinite(s.elevation)).sort((a, b) => a.elevation - b.elevation)
  const out: VerticalConnections = { links: new Map(), sources: new Map(), explicit: [], pairs: [], ambiguous: [] }
  const link = (a: string, b: string, source: VerticalSource) => {
    const had = out.links.get(a) ?? []
    if (!had.includes(b)) out.links.set(a, [...had, b])
    out.sources.set(a, source)
  }
  for (const e of explicitSpaceLinks(verticalObjects(model))) {
    out.explicit.push({ a: e.a, b: e.b, parentId: e.parentId })
    link(e.a, e.b, e.source)
    link(e.b, e.a, e.source)
  }
  const stated = new Set(out.links.keys())
  const candidates = (i: number) =>
    storeys[i].spaces
      .filter((s) => VERTICAL_KINDS.includes(s.kind ?? '') && s.footprint.length >= 3 && !stated.has(s.id))
      .map((space) => ({ space, area: polygonArea(space.footprint) }))
      .filter((c) => Number.isFinite(c.area) && c.area > EPS)
  for (let i = 0; i + 1 < storeys.length; i++) {
    if (!(storeys[i + 1].elevation > storeys[i].elevation)) continue
    const pairs: VerticalPair[] = []
    for (const low of candidates(i)) {
      for (const high of candidates(i + 1)) {
        if (high.space.kind !== low.space.kind) continue
        const shared = overlapArea(low.space.footprint, high.space.footprint)
        if (!shared) continue
        const share = shared / Math.min(low.area, high.area)
        if (share > MIN_SHARE + EPS) pairs.push({ low: low.space.id, high: high.space.id, share })
      }
    }
    // 방마다 최고 비율의 짝. 최고 비율이 둘 이상이면(동률) null 이다.
    const top = (id: string): VerticalPair | null => {
      const mine = pairs.filter((p) => p.low === id || p.high === id)
      const max = Math.max(...mine.map((p) => p.share))
      const atMax = mine.filter((p) => max - p.share <= EPS)
      return atMax.length === 1 ? atMax[0] : null
    }
    for (const p of pairs) {
      const fromLow = top(p.low)
      const fromHigh = top(p.high)
      if (fromLow === p && fromHigh === p) {
        out.pairs.push(p)
        link(p.low, p.high, 'calc')
        link(p.high, p.low, 'calc')
      } else {
        out.ambiguous.push({ ...p, reason: fromLow === null || fromHigh === null ? 'tie' : 'not-mutual' })
      }
    }
  }
  return out
}

/** 방 id → 아래·위층에서 이어진 방 id. 이어진 것이 없는 방은 담지 않는다. */
export function verticalLinks(model: Model): Map<string, string[]> {
  return verticalConnections(model).links
}

