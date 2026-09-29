// 층 사이 연결. 계단실·승강로가 바로 위층의 같은 계단실·승강로와 이어진다.
//
// 방-문-방 연결(문의 `connects`)은 한 층 안에서만 선다. 로봇 경로가 층을 옮기려면 어느 계단실이 위층의 어느 계단실과
// 같은 수직 통로인지 알아야 한다. 선행 연구(Zhu 2025, IFC-Graph)도 수평 연결과 수직 연결을 따로 만든다(정본 부록 E).
//
// **종류와 자리가 둘 다 맞을 때만 잇는다.** 방 종류(계단실·승강로, kinds.ts 의 ROOM_KINDS)가 같고, 바로 위층에서 바닥
// 외곽선이 작은 쪽 넓이의 절반 넘게 겹쳐야 한다. 공조존을 방에 잇는 기준(겹친 넓이가 절반 넘게)과 같다. 여럿이 걸리면
// 가장 많이 겹친 것 하나다. 종류를 모르는 방은 잇지 않는다 — 자리만 겹친다고 이으면 위층 복도가 아래층 로비와 이어진다.
//
// 모델에 저장하지 않고 내보낼 때 계산한다. 방의 경계·종류가 바뀌면 다음 내보내기에 그대로 반영된다.

import { overlapArea } from './polygon'
import { polygonArea, type Model } from './model'

/** 층 사이로 이어지는 방 종류. */
export const VERTICAL_KINDS: readonly string[] = ['staircase', 'elevator_shaft']

/** 겹친 넓이가 작은 쪽 넓이의 이만큼을 넘어야 같은 수직 통로로 본다. */
const MIN_SHARE = 0.5

/** 방 id → 아래·위층에서 이어진 방 id. 이어진 것이 없는 방은 담지 않는다. */
export function verticalLinks(model: Model): Map<string, string[]> {
  const storeys = [...model.storeys].sort((a, b) => a.elevation - b.elevation)
  const out = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    out.set(a, [...(out.get(a) ?? []), b])
    out.set(b, [...(out.get(b) ?? []), a])
  }
  const candidates = (i: number) => storeys[i].spaces.filter((s) => VERTICAL_KINDS.includes(s.kind ?? '') && s.footprint.length >= 3)
  for (let i = 0; i + 1 < storeys.length; i++) {
    const above = candidates(i + 1)
    for (const low of candidates(i)) {
      let best: { id: string; share: number } | null = null
      for (const high of above) {
        if (high.kind !== low.kind) continue
        const shared = overlapArea(low.footprint, high.footprint)
        if (!shared) continue
        const share = shared / Math.min(polygonArea(low.footprint), polygonArea(high.footprint))
        if (share > MIN_SHARE && (!best || share > best.share)) best = { id: high.id, share }
      }
      if (best) link(low.id, best.id)
    }
  }
  return out
}
