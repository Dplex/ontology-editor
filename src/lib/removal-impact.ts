// 덕트·배관 조각을 지우면 연결망이 어떻게 끊기나(OE-PIP-10 "중간 구간 삭제가 다른 분기의 연결에 미치는 영향을 실행 전에 표시").
//
// 지울 조각의 이웃에서 출발해, 그 조각을 빼고 연결을 따라가 닿는 덩어리를 센다. 덩어리가 하나면(고리처럼 다른 길로 이어짐) 끊기는 것이
// 없다. 둘 이상이면 갈래마다 든 기기(덕트·배관 아닌 것)를 보인다. 방향은 보지 않는다 — 방향을 모르는 연결도 물리적으로는 이어져 있다.
// 다른 분기의 연결은 지우는 조각에 붙은 연결만 빠지므로 그대로다.

import { isConduit, type Model } from './model'

export type RemovalImpact = {
  /** 지운 뒤 갈라지는 갈래. 기기가 많은 갈래가 앞이다. */
  pieces: { devices: string[]; conduits: number }[]
}

export function removalImpact(model: Model, id: string): RemovalImpact | null {
  const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  if (!byId.has(id)) return null
  const adj = new Map<string, string[]>()
  for (const c of model.connections) {
    if (c.from === c.to) continue
    adj.set(c.from, [...(adj.get(c.from) ?? []), c.to])
    adj.set(c.to, [...(adj.get(c.to) ?? []), c.from])
  }
  const seen = new Set([id])
  const pieces: RemovalImpact['pieces'] = []
  for (const start of new Set(adj.get(id) ?? [])) {
    if (seen.has(start)) continue
    const piece = { devices: [] as string[], conduits: 0 }
    seen.add(start)
    const queue = [start]
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head]
      if (isConduit(byId.get(at)?.role ?? null)) piece.conduits++
      else piece.devices.push(at)
      for (const next of adj.get(at) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    pieces.push(piece)
  }
  pieces.sort((a, b) => b.devices.length - a.devices.length || b.conduits - a.conduits)
  return { pieces }
}
