// 오른쪽 패널의 현재 층 현황(OE-UI-04 ③). 고른 것이 있든 없든 늘 보인다 — 건물·층 이름과 상태, 공간 구성(물리존·룸·커스텀존·공조존의 수와
// 목록), 설비(종류별 수·미배치 수), 공간 오브젝트(벽·문·창·사무용품 등 종류별 수). 목록의 항목을 누르면 가운데 뷰에서 그것이 골라진다.

import { isConduit, type Equipment, type Model } from './model'

export type SummaryItem = { id: string; name: string }
export type FloorSummary = {
  spaces: SummaryItem[]
  rooms: SummaryItem[]
  customZones: SummaryItem[]
  hvacZones: SummaryItem[]
  /** 설비 종류별 수(많은 것부터). 덕트·배관은 빼고, 종류를 모르는 설비는 "종류 모름" 으로 센다. */
  equipment: { label: string; count: number }[]
  equipmentTotal: number
  /** 좌표가 없는 설비(미배치). */
  unplaced: number
  /** 공간 오브젝트 종류별 수. 벽·문·창 다음에 추가 공간 오브젝트(책상·의자…)의 이름별 수다. */
  objects: { label: string; count: number }[]
}

const tally = (labels: string[]) => {
  const m = new Map<string, number>()
  for (const l of labels) m.set(l, (m.get(l) ?? 0) + 1)
  return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'))
}

/** `storeyIds` 의 층(null 이면 모든 층)을 센다. `kindOf` 는 설비 종류 이름(화면이 쓰는 whatIs 의 label). */
export function floorSummary(m: Model, storeyIds: readonly string[] | null, kindOf: (e: Equipment) => string | null): FloorSummary {
  const sts = m.storeys.filter((s) => !storeyIds || storeyIds.includes(s.id))
  const equipment = sts.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
  const fixed = [
    { label: '벽', count: sts.reduce((n, s) => n + s.walls.length, 0) },
    { label: '문', count: sts.reduce((n, s) => n + s.openings.filter((o) => o.kind === 'door').length, 0) },
    { label: '창', count: sts.reduce((n, s) => n + s.openings.filter((o) => o.kind === 'window').length, 0) },
  ]
  return {
    spaces: sts.flatMap((s) => s.spaces.map((sp) => ({ id: sp.id, name: [sp.name, sp.longName].filter(Boolean).join(' ') || '(이름 없음)' }))),
    rooms: sts.flatMap((s) => (s.rooms ?? []).map((r) => ({ id: r.id, name: r.name }))),
    customZones: sts.flatMap((s) => (s.customZones ?? []).map((z) => ({ id: z.id, name: z.name }))),
    // 사람이 만든 공조존과 IDF 공조존(층을 찾은 것) 둘 다다. IDF 공조존을 빼면 성수 + IDF 의 4F 가 "공조존 0" 으로 보였다.
    hvacZones: [
      ...sts.flatMap((s) => (s.hvacZones ?? []).map((z) => ({ id: z.id, name: z.name }))),
      ...(m.hvac?.zones ?? []).filter((z) => sts.some((s) => s.id === z.storeyId)).map((z) => ({ id: z.id, name: z.name })),
    ],
    equipment: tally(equipment.map((e) => kindOf(e) ?? '종류 모름')),
    equipmentTotal: equipment.length,
    unplaced: equipment.filter((e) => !e.position).length,
    objects: [...fixed, ...tally(sts.flatMap((s) => (s.spaceObjects ?? []).map((o) => o.name)))],
  }
}
