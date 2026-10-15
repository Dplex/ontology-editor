// IDF 공조존을 BIM 과 겹쳐 보는 화면에 쓰는 것(3D·평면도·공조존 표). 모델을 바꾸지 않고 읽기만 한다.
//
// **색은 담당 방식이다.** 존을 직접 담당하는 IDF 존 설비의 종류로 정한다 — FCU, 공조기 말단(VAV), VRF 실내기. 둘 이상이면 "여럿",
// 없으면 "없음" 이다. 존 이름(`…_FCU_a`)은 DesignBuilder 사용자가 붙인 것이라 읽지 않는다. 성수 기준층은 창가 넷이 FCU, 안쪽이 공조기다.

import type { HvacZone, Model } from '../model'

export type ZoneServe = 'fcu' | 'ahu' | 'vrf' | 'mixed' | 'none'

export const ZONE_SERVE_LABEL: Record<ZoneServe, string> = {
  fcu: 'FCU',
  ahu: '공조기(VAV)',
  vrf: 'VRF 실내기',
  mixed: '여럿',
  none: '담당 설비 없음',
}

/** 3D·평면도·범례가 같이 쓴다. 벽(회색)·계통 색과 겹치지 않게 옅은 색 다섯이다. */
export const ZONE_SERVE_COLOR: Record<ZoneServe, string> = {
  fcu: '#2f9e8f',
  ahu: '#3b82f6',
  vrf: '#d97706',
  mixed: '#a855f7',
  none: '#94a3b8',
}

const SERVE_OF_KIND: Record<string, ZoneServe> = { fcu: 'fcu', vav: 'ahu', indoor_unit: 'vrf' }

/** IDF 공조존마다 담당 방식. 사람이 만든 공조존은 넣지 않는다. */
export function zoneServes(model: Model): Map<string, ZoneServe> {
  const out = new Map<string, ZoneServe>()
  const hvac = model.hvac
  if (!hvac) return out
  const kinds = new Map<string, Set<ZoneServe>>()
  for (const e of hvac.equipment) {
    const serve = e.kind ? SERVE_OF_KIND[e.kind] : undefined
    for (const t of e.feeds) if (serve) kinds.set(t, (kinds.get(t) ?? new Set()).add(serve))
  }
  for (const z of hvac.zones) {
    const k = kinds.get(z.id)
    out.set(z.id, !k?.size ? 'none' : k.size > 1 ? 'mixed' : [...k][0])
  }
  return out
}

/**
 * 존을 담당하는 BIM 기기(존 안의 BIM 기기로 푼 IDF 존 설비, 이름·층으로 이은 말단)와 그 위의 원천(공조기·실외기)이 이어진 BIM 기기.
 * 3D·평면도에서 존을 고르면 이것을 칠한다.
 */
export function zoneDevices(model: Model, zoneId: string): { terminals: string[]; sources: string[] } {
  const hvac = model.hvac
  if (!hvac) return { terminals: [], sources: [] }
  const bim = (id: string) => {
    const e = hvac.equipment.find((x) => x.id === id)
    return e ? (e.bimIds ?? (e.bimId ? [e.bimId] : [])) : []
  }
  const direct = hvac.equipment.filter((e) => e.feeds.includes(zoneId))
  const ids = new Set(direct.map((e) => e.id))
  const up = hvac.equipment.filter((e) => e.feeds.some((t) => ids.has(t)))
  return { terminals: [...new Set(direct.flatMap((e) => bim(e.id)))], sources: [...new Set(up.flatMap((e) => bim(e.id)))] }
}

/** 물리존 → 겹친 IDF 공조존과 몫(방 바닥 중 그 존의 몫). 많이 덮는 존이 먼저다. */
export function zonesOverSpaces(zones: readonly HvacZone[]): Map<string, { id: string; name: string; share: number }[]> {
  const out = new Map<string, { id: string; name: string; share: number }[]>()
  for (const z of zones)
    for (const o of z.overlaps ?? []) out.set(o.spaceId, [...(out.get(o.spaceId) ?? []), { id: z.id, name: z.name, share: o.spaceShare }])
  for (const list of out.values()) list.sort((a, b) => b.share - a.share)
  return out
}
