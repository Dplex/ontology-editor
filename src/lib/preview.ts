// 반영 전 미리보기의 변경 요약(OE-WF-08)과 영향 목록(OE-WF-09). 연 때 모델(pristine)과 지금 모델을 견준다. 집계 규칙은 편집 리포트(OE-SYNC-06)와
// 같다 — 화면의 "바뀐 내용" 과 같은 설비 소속 변경 목록(edit.ts 의 summarize)을 받아 센다. 반영 확인 창(OE-WF-12)도 같은 수를 보인다.

import type { Model } from './model'

export type StoreyPreviewSummary = {
  buildingId: string
  buildingName: string
  storeyId: string
  storeyName: string
  affected: boolean
  area: { before: number; after: number; delta: number }
  moved: number
}

export type BuildingPreviewSummary = {
  buildingId: string
  buildingName: string
  storeys: string[]
  area: { before: number; after: number; delta: number }
  moved: number
}

export type SpaceMoveCount = {
  spaceId: string
  spaceName: string
  outCount: number
  inCount: number
}

export type PublishBrief = {
  affectedStoreyCount: number
  changedSpaces: number
  movedEquipment: number
}

export type PreviewSummary = {
  /** 물리존 넓이 합(㎡) — 전체 사이트. */
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
  /** 소속이 바뀔 설비 수 — 전체 사이트. */
  moved: number
  /** 사람 지정이 풀릴 설비 수(OE-MAP-01, K17). */
  released: number
  /** 영향 받는 층 목록(건물·층, OE-WF-08). */
  affectedStoreys: { buildingId: string; buildingName: string; storeyId: string; storeyName: string }[]
  /** 층별 면적 변화와 소속 변경 설비 수(OE-WF-08). */
  byStorey: StoreyPreviewSummary[]
  /** 건물별 면적 변화와 소속 변경 설비 수(OE-WF-08). */
  byBuilding: BuildingPreviewSummary[]
  /** 물리존별 나가는 설비 수·들어오는 설비 수(OE-WF-08). */
  bySpace: SpaceMoveCount[]
}

export type SpaceMove = { equipmentId: string; fromSpaceId: string | null; toSpaceId: string | null }

export function previewSummary(
  before: Model,
  now: Model,
  moves: readonly SpaceMove[],
  released: number,
  dirtyStoreyIds: Iterable<string> = [],
): PreviewSummary {
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
  const validMoves = moves.filter((m) => m.fromSpaceId !== m.toSpaceId)

  // 설비·물리존이 속한 층을 찾는다. 설비 하나는 한 층에만 속하므로 층별 합 = 건물 합 = 전체 사이트 합이다(OE-WF-08).
  const equipStorey = new Map<string, string>()
  const spaceStorey = new Map<string, string>()
  const spaceName = new Map<string, string>()
  for (const m of [before, now]) {
    for (const st of m.storeys) {
      for (const eq of st.equipment) equipStorey.set(eq.id, st.id)
      for (const sp of st.spaces) {
        spaceStorey.set(sp.id, st.id)
        spaceName.set(sp.id, sp.longName || sp.name)
      }
    }
  }
  const movedByStorey = new Map<string, number>()
  const spaceCounts = new Map<string, { outCount: number; inCount: number }>()
  for (const mv of validMoves) {
    const stId = equipStorey.get(mv.equipmentId) ?? (mv.toSpaceId ? spaceStorey.get(mv.toSpaceId) : undefined) ?? (mv.fromSpaceId ? spaceStorey.get(mv.fromSpaceId) : undefined)
    if (stId) movedByStorey.set(stId, (movedByStorey.get(stId) ?? 0) + 1)
    if (mv.fromSpaceId) {
      const cur = spaceCounts.get(mv.fromSpaceId) ?? { outCount: 0, inCount: 0 }
      cur.outCount++
      spaceCounts.set(mv.fromSpaceId, cur)
    }
    if (mv.toSpaceId) {
      const cur = spaceCounts.get(mv.toSpaceId) ?? { outCount: 0, inCount: 0 }
      cur.inCount++
      spaceCounts.set(mv.toSpaceId, cur)
    }
  }

  const dirtySet = new Set(dirtyStoreyIds)
  const beforeStoreys = new Map(before.storeys.map((s) => [s.id, s]))
  const buildingId = now.buildingId || before.buildingId || 'building'
  const buildingName = now.buildingName || before.buildingName || '(건물)'
  const byStorey: StoreyPreviewSummary[] = now.storeys.map((st) => {
    const prev = beforeStoreys.get(st.id)
    const beforeArea = sum(prev?.spaces ?? [])
    const afterArea = sum(st.spaces)
    const delta = afterArea - beforeArea
    const prevSpaceIds = new Set((prev?.spaces ?? []).map((sp) => sp.id))
    const nowSpaceIds = new Set(st.spaces.map((sp) => sp.id))
    const spaceChanged =
      st.spaces.some((sp) => !prevSpaceIds.has(sp.id)) ||
      (prev?.spaces ?? []).some((sp) => !nowSpaceIds.has(sp.id)) ||
      Math.abs(delta) > 1e-6
    const prevRoomIds = new Set((prev?.rooms ?? []).map((r) => r.id))
    const nowRoomIds = new Set((st.rooms ?? []).map((r) => r.id))
    const roomChanged =
      (st.rooms ?? []).some((r) => !prevRoomIds.has(r.id)) ||
      (prev?.rooms ?? []).some((r) => !nowRoomIds.has(r.id))
    const stMoved = movedByStorey.get(st.id) ?? 0
    const affected = dirtySet.has(st.id) || spaceChanged || roomChanged || stMoved > 0
    return {
      buildingId,
      buildingName,
      storeyId: st.id,
      storeyName: st.name,
      affected,
      area: { before: beforeArea, after: afterArea, delta },
      moved: stMoved,
    }
  })

  const affectedStoreys = byStorey
    .filter((st) => st.affected)
    .map(({ buildingId: bId, buildingName: bName, storeyId, storeyName }) => ({ buildingId: bId, buildingName: bName, storeyId, storeyName }))

  const byBuildingMap = new Map<string, BuildingPreviewSummary>()
  for (const st of byStorey) {
    const b = byBuildingMap.get(st.buildingId) ?? {
      buildingId: st.buildingId,
      buildingName: st.buildingName,
      storeys: [],
      area: { before: 0, after: 0, delta: 0 },
      moved: 0,
    }
    if (st.affected) b.storeys.push(st.storeyName)
    b.area.before += st.area.before
    b.area.after += st.area.after
    b.area.delta = b.area.after - b.area.before
    b.moved += st.moved
    byBuildingMap.set(st.buildingId, b)
  }
  const byBuilding = [...byBuildingMap.values()]

  const bySpace: SpaceMoveCount[] = [...spaceCounts.entries()].map(([spaceId, c]) => ({
    spaceId,
    spaceName: spaceName.get(spaceId) ?? spaceId,
    outCount: c.outCount,
    inCount: c.inCount,
  }))

  return {
    area: { before: sum(was.values()), after: sum(is.values()) },
    created: added.filter((sp) => !sp.splitFrom).length,
    split: added.filter((sp) => sp.splitFrom).length,
    removed: gone.filter((id) => !mergedIds.has(id)).length,
    merged: gone.filter((id) => mergedIds.has(id)).length,
    rooms: { added: [...roomsIs].filter((id) => !roomsWas.has(id)).length, removed: [...roomsWas].filter((id) => !roomsIs.has(id)).length },
    moved: validMoves.length,
    released,
    affectedStoreys,
    byStorey,
    byBuilding,
    bySpace,
  }
}

/** 반영 확인 팝업의 3가지 요약 수치(OE-WF-12). 미리보기 요약에서 합산한다. */
export function publishBrief(s: PreviewSummary): PublishBrief {
  return {
    affectedStoreyCount: s.affectedStoreys.length,
    changedSpaces: s.created + s.removed + s.split + s.merged,
    movedEquipment: s.moved,
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
