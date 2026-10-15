// 공간 보기(ui-notes 공간 보기). 층 보기 위에 방 하나로 좁혀 그 방과 그 방에 영향을 주는 설비만 3D 에 남긴다. **화면 상태다** — 모델·편집
// 파일·TTL·GeoJSON 에 아무것도 남지 않는다(보기 필터와 같다).
//
// 방에 영향을 주는 설비는 두 갈래다.
// - **안**: 소속(`spaceId`)이 이 방인 설비. 좌표로 판정한 소속이라 TTL 의 `hasLocation` 과 같은 근거다.
// - **공기 원천**: 흐름 방향을 따라 이 방의 말단(디퓨저·그릴)에 닿는 공조기·FCU·팬(served.ts). 화면과 같은 방향(규칙 포함)으로 센 것을
//   받는다. 확정된 방향만 `brick:feeds` 로 나가므로 여기 보이는 원천이 다 TTL 에 있는 것은 아니다.
import type { AirService } from './served'
import type { Equipment, Model } from './model'

export type SpaceSource = {
  id: string
  /** 이 방에 바람을 내는 말단 수. */
  supply: number
  /** 이 방에서 바람을 거두는 말단 수. */
  extract: number
}

export type SpaceInfluence = {
  /** 소속이 이 방인 설비(덕트·배관 포함). */
  inside: string[]
  /** 이 방의 말단에 닿는 공기 원천. 말단이 많은 것부터. */
  sources: SpaceSource[]
}

export function spaceInfluence(model: Model, spaceId: string, services: readonly AirService[], byId?: ReadonlyMap<string, Equipment>): SpaceInfluence {
  const index = byId ?? new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const inside = model.storeys.flatMap((s) => s.equipment.filter((e) => e.spaceId === spaceId).map((e) => e.id))
  const here = (id: string) => index.get(id)?.spaceId === spaceId
  const sources: SpaceSource[] = []
  for (const s of services) {
    const supply = s.supply.filter(here).length
    const extract = s.extract.filter(here).length
    if (supply + extract) sources.push({ id: s.sourceId, supply, extract })
  }
  sources.sort((a, b) => b.supply + b.extract - (a.supply + a.extract) || a.id.localeCompare(b.id))
  return { inside, sources }
}

/**
 * 공간 보기에서 숨길 설비. `keep` 밖의 설비 전부다. `keep` 은 화면이 정한다 — 들어올 때 안에 있던 것, 지금 안에 있는 것, 공기 원천.
 * 들어올 때 있던 것을 남기는 까닭: 공간 보기 안에서 설비를 방 밖으로 끌어내면 소속이 바뀌는데, 그 순간 사라지면 어디로 갔는지 모른다.
 */
export function spaceViewHidden(model: Model, keep: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const st of model.storeys) for (const e of st.equipment) if (!keep.has(e.id)) out.add(e.id)
  return out
}

/** 층의 방 목록(보기 필터의 공간 칸). 방번호 순, 기기·덕트배관 수를 같이 센다. */
export function storeySpaces(model: Model, storeyId: string, isConduit: (e: Equipment) => boolean) {
  const st = model.storeys.find((s) => s.id === storeyId)
  if (!st) return []
  const count = new Map<string, { devices: number; conduits: number }>()
  for (const e of st.equipment) {
    if (!e.spaceId) continue
    const c = count.get(e.spaceId) ?? { devices: 0, conduits: 0 }
    if (isConduit(e)) c.conduits++
    else c.devices++
    count.set(e.spaceId, c)
  }
  return st.spaces
    .map((sp) => ({ id: sp.id, name: sp.name, longName: sp.longName, ...(count.get(sp.id) ?? { devices: 0, conduits: 0 }) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }) || a.longName.localeCompare(b.longName, 'ko'))
}
