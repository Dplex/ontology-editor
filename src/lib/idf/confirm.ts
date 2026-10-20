// IDF 존↔물리존 매칭 확인(OE-ZON-07, D13).
//
// 존이 방 바닥의 절반 넘게를 덮어 `spaceIds` 에 든 방은 겹친 넓이로 **계산한 초안**이다(OE-IDF-05). 사람이 확인하기 전에는 온톨로지(TTL
// `brick:hasPart`, GeoJSON `spaceIds`)에 나가지 않는다. 반면 IDF 가 적은 설비↔존 담당(`brick:feeds`)은 설계자가 말한 값이라 이 확인을
// 거치지 않는다. 확인은 (존, 방) 짝 단위로 `hvac.confirmed` 에 `존id|방id` 로 남는다. 존 id 는 IDF 존 이름에서 만들어져 IDF 를 다시
// 얹어도 같다(attach.ts) — 그래서 다시 얹을 때 `options.confirmed` 로 넘기면 같은 짝은 확인한 채로 남는다.

import type { HvacZone, Model } from '../model'

export const pairKey = (zoneId: string, spaceId: string) => `${zoneId}|${spaceId}`

/** 사람이 만든 공조존(`source: 'edit'`)은 담당 물리존을 사람이 골랐으니 확인할 것이 없다. */
export const needsConfirm = (zone: HvacZone) => zone.source !== 'edit'

/** 온톨로지에 나가는 든 방. IDF 공조존은 확인한 방만이다. */
export function exportedSpaceIds(model: Pick<Model, 'hvac'>, zone: HvacZone): string[] {
  if (!needsConfirm(zone)) return zone.spaceIds
  const done = new Set(model.hvac?.confirmed ?? [])
  return zone.spaceIds.filter((id) => done.has(pairKey(zone.id, id)))
}

/** 존 하나의 확인 현황. 확인했어도 방이 사라진 짝은 세지 않는다. */
export function confirmState(model: Pick<Model, 'hvac'>, zone: HvacZone): { confirmed: number; total: number } {
  return { confirmed: exportedSpaceIds(model, zone).length, total: zone.spaceIds.length }
}

/** 확인을 켜거나 끈다. 존의 든 방 전부(`spaceIds` 를 주지 않으면)나 고른 방만. 바꾼 짝 수를 돌려준다. */
export function setConfirmed(model: Model, zoneId: string, on: boolean, spaceIds?: readonly string[]): number {
  const zone = model.hvac?.zones.find((z) => z.id === zoneId)
  if (!model.hvac || !zone || !needsConfirm(zone)) return 0
  const targets = (spaceIds ?? zone.spaceIds).filter((id) => zone.spaceIds.includes(id)).map((id) => pairKey(zoneId, id))
  const done = new Set(model.hvac.confirmed ?? [])
  const before = done.size
  for (const k of targets) on ? done.add(k) : done.delete(k)
  if (done.size === 0) delete model.hvac.confirmed
  else model.hvac.confirmed = [...done]
  return Math.abs(done.size - before)
}

/** 다시 얹을 때 넘길 확인. 지금 모델에 아직 있는 짝만 남긴다(IDF 나 BIM 이 바뀌어 짝이 사라지면 확인도 사라진다). */
export function carryConfirmed(keep: readonly string[] | undefined, zones: readonly HvacZone[]): string[] {
  const present = new Set(zones.flatMap((z) => (needsConfirm(z) ? z.spaceIds.map((id) => pairKey(z.id, id)) : [])))
  return (keep ?? []).filter((k) => present.has(k))
}
