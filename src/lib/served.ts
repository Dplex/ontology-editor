// 공기 원천(공조기·FCU·전열교환기·팬)이 어느 말단을 거쳐 어느 방에 바람을 보내고 거둬들이는가.
//
// 계통도가 묻는 "이 공조기가 담당하는 공간" 의 근사다(정본 §3.5 등급 4+, Wang 2026 의 말단–존 규칙, 정본 부록 E).
// 흐름 방향을 따라 원천에서 말단(디퓨저·그릴)까지 가고, 그 말단이 있는 방을 모은다.
//
// - **급기** 는 원천에서 하류로 내려가 닿는 말단이다.
// - **환기·배기** 는 원천으로 거슬러 올라가 닿는 말단이다(말단에서 원천으로 들어온다).
//
// 다른 공기 원천을 만나면 그 너머로 가지 않는다. 공조기 → 덕트 → FCU → 디퓨저 같은 길에서 디퓨저를
// 공조기 몫으로 세면, FCU 가 담당하는 방이 공조기에도 붙는다. 댐퍼·VAV 같은 기기는 지나간다.
//
// 화면은 3D 와 같은 방향(규칙 방향 포함)으로 센다. **내보내기는 확정된 방향만으로 다시 센다**(export/ttl.ts) — 포트·
// 사람이 정한 방향·확정한 규칙만 따라간 급기 말단의 방은 공기 원천의 `brick:feeds` 로 나간다. 확정 전 규칙 방향으로만
// 닿는 방은 추정이라 화면에만 보인다. 말단의 방은 좌표로 판정한 소속이라 `hasLocation` 과 같은 근거다.

import { equipmentKind } from './kinds'
import type { Connection, Equipment, Model } from './model'

/** 공기를 내보내는 기기. 사전의 `flow.air === 'source'` 이다. */
export function isAirSource(e: Equipment | undefined): boolean {
  return equipmentKind(e?.kind)?.flow.air === 'source'
}

/**
 * 방에 바람을 내거나 거두는 말단. 외부 루버는 방이 아니라 바깥과 통하므로 뺀다.
 */
export function isAirTerminal(e: Equipment | undefined): boolean {
  const info = equipmentKind(e?.kind)
  return !!info && info.flow.air === 'sink' && info.role === 'terminal' && info.kind !== 'outdoor_louver'
}

export type AirService = {
  sourceId: string
  /** 급기로 바람을 내보내는 말단. */
  supply: string[]
  /** 환기·배기로 바람을 거둬들이는 말단. */
  extract: string[]
}

/**
 * 공기 원천마다 닿는 말단을 센다. `connections` 는 방향이 정해진 것만 본다 — 규칙 방향까지 넣으려면
 * 호출부가 `withInferred` 로 펼쳐서 넘긴다.
 */
export function airServices(model: Model, connections: readonly Connection[]): AirService[] {
  const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const forward = new Map<string, string[]>()
  const backward = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, a: string, b: string) => {
    const list = map.get(a)
    if (list) list.push(b)
    else map.set(a, [b])
  }
  for (const c of connections) {
    if (!c.directed) continue
    push(forward, c.from, c.to)
    push(backward, c.to, c.from)
  }

  const walk = (start: string, adj: Map<string, string[]>): string[] => {
    const found: string[] = []
    const seen = new Set([start])
    const queue = [start]
    while (queue.length > 0) {
      const at = queue.shift()!
      for (const next of adj.get(at) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        const e = byId.get(next)
        if (isAirTerminal(e)) found.push(next)
        else if (!isAirSource(e)) queue.push(next)
      }
    }
    return found
  }

  const out: AirService[] = []
  for (const e of byId.values()) {
    if (!isAirSource(e)) continue
    out.push({ sourceId: e.id, supply: walk(e.id, forward), extract: walk(e.id, backward) })
  }
  return out
}

export type ServedSpace = {
  /** 물리존 id. 말단에 소속 방이 없으면 null 로 한데 모은다. */
  spaceId: string | null
  supply: number
  extract: number
}

/**
 * 원천 하나가 담당하는 방. 방마다 급기·환기 말단이 몇 개인지 센다. 원천 여럿을 잇달아 물을 때는 설비 색인(`byId`)을
 * 넘긴다 — 부를 때마다 새로 만들면 성수(원천 268대, 설비 2만 개)에서 편집 한 번에 0.3초가 여기서 나갔다.
 */
export function servedSpaces(
  model: Model,
  service: AirService,
  byId: ReadonlyMap<string, Equipment> = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e])),
): ServedSpace[] {
  const rows = new Map<string | null, ServedSpace>()
  const add = (terminalId: string, key: 'supply' | 'extract') => {
    const spaceId = byId.get(terminalId)?.spaceId ?? null
    const row = rows.get(spaceId) ?? { spaceId, supply: 0, extract: 0 }
    row[key]++
    rows.set(spaceId, row)
  }
  for (const id of service.supply) add(id, 'supply')
  for (const id of service.extract) add(id, 'extract')
  return [...rows.values()].sort(
    (a, b) => (a.spaceId === null ? 1 : 0) - (b.spaceId === null ? 1 : 0) || b.supply + b.extract - (a.supply + a.extract),
  )
}
