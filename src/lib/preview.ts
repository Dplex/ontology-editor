// 반영 전 미리보기의 변경 요약(OE-WF-08)과 영향 목록(OE-WF-09). 연 때 모델(pristine)과 지금 모델을 견준다. 집계 규칙은 편집 리포트(OE-SYNC-06)와
// 같다 — 화면의 "바뀐 내용" 과 같은 설비 소속 변경 목록(edit.ts 의 summarize)을 받아 센다. 반영 확인 창(OE-WF-12)도 같은 수를 보인다.

import type { Model } from './model'

export type PreviewSummary = {
  /** 물리존 넓이 합(㎡). */
  area: { before: number; after: number }
  /** 사람이 그려 만든 물리존(나눈 조각 빼고). */
  created: number
  /** 나눠 생긴 조각 수(= 분할 횟수). */
  split: number
  /** 지운 물리존(합친 것 빼고). */
  removed: number
  /** 다른 물리존에 합쳐 들어간 물리존. */
  merged: number
  /** 룸(OE-SPC-11) 만든 수·지운 수. */
  rooms: { added: number; removed: number }
  /** 소속이 바뀔 설비 수. */
  moved: number
  /** 사람 지정이 풀릴 설비 수(OE-MAP-01, K17). */
  released: number
}

export type SpaceMove = { equipmentId: string; fromSpaceId: string | null; toSpaceId: string | null }

export function previewSummary(before: Model, now: Model, moves: readonly SpaceMove[], released: number): PreviewSummary {
  const spacesOf = (m: Model) => new Map(m.storeys.flatMap((s) => s.spaces).map((sp) => [sp.id, sp]))
  const was = spacesOf(before)
  const is = spacesOf(now)
  const mergedIds = new Set([...is.values()].flatMap((sp) => sp.merged ?? []))
  const added = [...is.values()].filter((sp) => !was.has(sp.id))
  const gone = [...was.keys()].filter((id) => !is.has(id))
  const roomsOf = (m: Model) => new Set(m.storeys.flatMap((s) => s.rooms ?? []).map((r) => r.id))
  const roomsWas = roomsOf(before)
  const roomsIs = roomsOf(now)
  const sum = (xs: Iterable<{ areaM2: number }>) => [...xs].reduce((n, sp) => n + sp.areaM2, 0)
  return {
    area: { before: sum(was.values()), after: sum(is.values()) },
    created: added.filter((sp) => !sp.splitFrom).length,
    split: added.filter((sp) => sp.splitFrom).length,
    removed: gone.filter((id) => !mergedIds.has(id)).length,
    merged: gone.filter((id) => mergedIds.has(id)).length,
    rooms: { added: [...roomsIs].filter((id) => !roomsWas.has(id)).length, removed: [...roomsWas].filter((id) => !roomsIs.has(id)).length },
    moved: moves.filter((m) => m.fromSpaceId !== m.toSpaceId).length,
    released,
  }
}

/** 요약 한 줄. 확인 창과 미리보기가 같은 글을 쓴다. */
export function summaryText(s: PreviewSummary): string {
  const delta = s.area.after - s.area.before
  const parts = [
    `면적 ${s.area.before.toFixed(1)}㎡ → ${s.area.after.toFixed(1)}㎡(${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`,
    `생성 ${s.created}`,
    `분할 ${s.split}`,
    `삭제 ${s.removed}`,
    `병합 ${s.merged}`,
    `룸 +${s.rooms.added}/-${s.rooms.removed}`,
    `소속 변경 설비 ${s.moved}`,
  ]
  if (s.released) parts.push(`사람 지정 해제 ${s.released}`)
  return parts.join(' · ')
}
