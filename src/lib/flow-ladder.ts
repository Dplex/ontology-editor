import type { Connection } from './model'

/**
 * 기기에서 기기로 건너가기. 고른 설비의 패널이 "이 공조기에서 어느 VAV 로, 어느 냉동기에서" 를 바로 보이게 한다.
 *
 * 연결망은 기기와 덕트·배관 조각이 섞인 그래프라, 바로 붙은 이웃은 거의 다 관 조각이다(병원 공조기는 넷 다 관 조각이었다).
 * 사람이 묻는 것은 관을 지나서 **처음 닿는 기기**다. 그래서 관만 지나고 기기에서 멈추는 한 걸음(`next`)을 두고, 그것을
 * 되풀이해 단계(`ladder`)와 계통을 넘는 공급 사슬(`supplyChain`)을 만든다.
 *
 * - **계통으로 가른다.** 한 공조기에는 급기·환기 덕트와 냉수 공급·환수관이 같이 붙는다. 섞으면 냉동기가 공급관으로는 상류,
 *   환수관으로는 하류라 고리가 되어 원천도 말단도 아닌 것으로 보였다. 관 조각이 든 연결은 그 관의 계통에 속하고, 기기끼리 바로
 *   붙은 연결은 계통 없음(null)이다(`topology.ts` 의 `traceBySystem` 과 같은 규칙).
 * - **방향을 아는 연결만** 상류·하류로 탄다. 방향을 모르는 연결로만 닿는 기기는 `unknown` 이고, 그 너머로는 가지 않는다.
 *   모르는 것을 한쪽으로 정하면 틀린 쪽이 반이다.
 */
export type Hop = { id: string; systemId: string | null }
export type Next = { down: Hop[]; up: Hop[]; unknown: Hop[] }

type Edge = { other: string; key: string | null; dir: 'out' | 'in' | 'both' }

export type FlowIndex = {
  /** 덕트·배관만 지나 처음 닿는 기기들. 같은 기기라도 계통이 다르면 따로 센다. */
  next(id: string): Next
  /** 이 요소에 바로 붙은 연결의 계통들(관 조각의 계통, 기기끼리 바로 붙었으면 null). */
  systemsOf(id: string): (string | null)[]
}

export function flowIndex(
  connections: readonly Connection[],
  isConduit: (id: string) => boolean,
  systemOf: (id: string) => string | null,
): FlowIndex {
  const adj = new Map<string, Edge[]>()
  const push = (at: string, edge: Edge) => {
    const list = adj.get(at)
    if (list) list.push(edge)
    else adj.set(at, [edge])
  }
  for (const c of connections) {
    const conduits = [c.from, c.to].filter(isConduit)
    let key: string | null = null
    if (conduits.length) {
      key = systemOf(conduits[0])
      // 두 계통의 관이 맞닿은 연결은 어느 계통의 것도 아니다. 이으면 급기가 환기로 새어 든다.
      if (conduits.some((id) => systemOf(id) !== key)) continue
    }
    push(c.from, { other: c.to, key, dir: c.directed ? 'out' : 'both' })
    push(c.to, { other: c.from, key, dir: c.directed ? 'in' : 'both' })
  }

  /**
   * start 에서 key 계통의 연결만 타고 관을 지나 처음 닿는 기기. `loose` 면 방향 없는 연결도 탄다 — 그래도 방향 있는 연결은 `want` 쪽으로만
   * 탄다. 방향을 아예 안 보면 위로 올라갔다 형제로 내려와, VAV 하나를 골랐을 때 같은 덕트의 VAV 53대가 "방향 모름" 으로 잡혔다.
   */
  const reach = (start: string, key: string | null, want: 'out' | 'in', loose = false) => {
    const found: string[] = []
    const seen = new Set([start])
    const queue = [start]
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head]
      for (const e of adj.get(at) ?? []) {
        if (e.key !== key || seen.has(e.other)) continue
        if (e.dir !== want && !(loose && e.dir === 'both')) continue
        seen.add(e.other)
        if (isConduit(e.other)) queue.push(e.other)
        else found.push(e.other)
      }
    }
    return found
  }

  const memo = new Map<string, Next>()
  const systemsOf = (id: string) => [...new Set((adj.get(id) ?? []).map((e) => e.key))]
  return {
    systemsOf,
    next(id) {
      const hit = memo.get(id)
      if (hit) return hit
      const out: Next = { down: [], up: [], unknown: [] }
      for (const key of systemsOf(id)) {
        const down = reach(id, key, 'out')
        const up = reach(id, key, 'in')
        const known = new Set([...down, ...up])
        out.down.push(...down.map((x) => ({ id: x, systemId: key })))
        out.up.push(...up.map((x) => ({ id: x, systemId: key })))
        const loose = new Set([...reach(id, key, 'out', true), ...reach(id, key, 'in', true)])
        out.unknown.push(...[...loose].filter((x) => !known.has(x)).map((x) => ({ id: x, systemId: key })))
      }
      memo.set(id, out)
      return out
    },
  }
}

/**
 * 단계 하나. 고른 기기에서 기기 몇 개를 건너 닿는지가 같은 기기들이다. 첫 단계가 "바로 다음 기기" 다.
 * `systems` 는 앞 단계에서 이 단계로 건너올 때 탄 계통이다 — 화면이 화살표에 "급기"·"순환수 공급" 을 붙인다.
 */
export type Step = { ids: string[]; systems: (string | null)[] }

/** 단계는 이만큼까지만 따라간다. 성수 순환수처럼 길게 이어진 망에서 패널이 끝없이 길어지지 않게 한다. */
export const LADDER_MAX = 5

/**
 * 한 방향으로 단계를 쌓는다. `pass(hop)` 이 참인 걸음만 탄다 — 계통 하나로 좁히거나(계통 줄), 공급 쪽 계통만 고른다(공급 사슬).
 * 한 번 닿은 기기는 다시 넣지 않아 고리가 있어도 끝난다. 시작 기기도 다시 넣지 않는다.
 */
export function ladder(
  index: FlowIndex,
  start: string,
  dir: 'down' | 'up',
  pass: (hop: Hop) => boolean,
  max = LADDER_MAX,
): Step[] {
  const seen = new Set([start])
  const steps: Step[] = []
  let front = [start]
  while (front.length && steps.length < max) {
    const ids: string[] = []
    const systems = new Set<string | null>()
    for (const at of front) {
      for (const hop of index.next(at)[dir]) {
        if (!pass(hop) || seen.has(hop.id)) continue
        seen.add(hop.id)
        ids.push(hop.id)
        systems.add(hop.systemId)
      }
    }
    if (!ids.length) break
    steps.push({ ids, systems: [...systems] })
    front = ids
  }
  return steps
}

/**
 * 계통을 넘는 공급 사슬. 냉동기 → 공조기 → VAV → 디퓨저처럼 **공급 쪽 계통**(급기·외기·순환수 공급처럼 원천에서 말단으로 보내는 것,
 * `kinds.ts` 의 sense 'out')과 기기끼리 바로 붙은 연결만 탄다. 환기·환수까지 타면 공조기의 상류에 그릴 110개가 들고, 냉동기가
 * 공조기의 하류로도 잡혀 사슬이 아니라 고리가 된다. 공급 쪽인지 모르는 계통(종류 없음)은 타지 않는다.
 */
export function supplyChain(
  index: FlowIndex,
  start: string,
  isSupply: (systemId: string | null) => boolean,
  max = LADDER_MAX,
): { up: Step[]; down: Step[] } {
  const pass = (hop: Hop) => isSupply(hop.systemId)
  return { up: ladder(index, start, 'up', pass, max), down: ladder(index, start, 'down', pass, max) }
}
