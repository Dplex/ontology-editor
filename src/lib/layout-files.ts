// [반영하기]·[구축하기] 가 서버에 올리는 한 버전의 파일(OE-WF-10·13, OE-GEN-01·05·09, OE-SYNC-01·03, src/server/layouts.ts). 반영한 것은 이 파일들이다 —
// 온톨로지(TTL), 3D Map 기하(층마다 GeoJSON), 다시 열 때 얹는 편집 파일, 탐색기 트리 대신의 공간 계층, 생성 리포트(JSON). 3D 형상(GLB)은
// 화면이 워커로 만들어 따로 올린다.
import type { EditFile } from './edit-file'
import { countEdits } from './edit-file'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import { countOf, type Model } from './model'

/** 사이트 > 건물 > 층 > 물리존 계층(OE-SYNC-03). 반영 뒤 탐색기 트리가 보일 것이다. */
export type SpaceTree = {
  site: string
  building: { id: string; name: string }
  storeys: { id: string; name: string; elevation: number; spaces: { id: string; name: string; longName: string | null }[] }[]
}

export function spaceTree(model: Model): SpaceTree {
  return {
    site: model.siteName,
    building: { id: model.buildingId, name: model.buildingName },
    storeys: [...model.storeys]
      .sort((a, b) => a.elevation - b.elevation)
      .map((s) => ({ id: s.id, name: s.name, elevation: s.elevation, spaces: s.spaces.map((sp) => ({ id: sp.id, name: sp.name, longName: sp.longName ?? null })) })),
  }
}

/** 버전에 붙는 변경 요약(OE-WF-13). 화면의 확인 창과 히스토리가 같은 값을 보인다. */
export type LayoutSummary = { edits: number; counts: ReturnType<typeof countOf> }

export function layoutSummary(model: Model, edits: EditFile): LayoutSummary {
  return { edits: countEdits(edits), counts: countOf(model) }
}

/**
 * 반영 결과 리포트(OE-SYNC-04)의 묶음. 여섯 항목은 늘 있고(비면 빈 묶음), 거기 들지 않는 변경은 "그 밖의 변경" 이다. 줄은 화면의 "바뀐 내용" 과
 * 같은 규칙(OE-SYNC-06 — 열었을 때와 견주고, 여러 번 옮긴 것은 마지막만, 제자리로 돌아온 것은 뺌)으로 만든 것이다.
 */
export const REPORT_SECTIONS = [
  { kind: 'move', label: '소속이 바뀐 설비' },
  { kind: 'space', label: '물리존 생성·삭제·분할·병합·이름' },
  { kind: 'zone', label: '공조존 매핑 변경·미매핑 경고' },
  { kind: 'unassigned', label: '소속이 없어진 설비' },
  { kind: 'release', label: '사람 지정이 풀린 설비' },
  { kind: 'pipe', label: '배관·연결 변경' },
  { kind: 'other', label: '그 밖의 변경' },
] as const
export type ReportKind = (typeof REPORT_SECTIONS)[number]['kind']
export type ReportSection = { kind: ReportKind; label: string; lines: string[] }

/** 줄(종류·글)을 묶음으로. 모르는 종류는 "그 밖의 변경" 이다. */
export function groupReport(lines: readonly { kind: string; text: string }[]): ReportSection[] {
  const known = new Set<string>(REPORT_SECTIONS.map((x) => x.kind))
  return REPORT_SECTIONS.map((x) => ({ kind: x.kind, label: x.label, lines: lines.filter((l) => (known.has(l.kind) ? l.kind : 'other') === x.kind).map((l) => l.text) }))
}

/** 직전 버전의 리포트에 없던 줄 — 이번 반영에서 새로 생긴 변경이다(리포트는 BIM 을 연 때와 견준 누적이라). */
export function newSince(now: readonly ReportSection[], before: readonly ReportSection[] | null): Set<string> {
  const had = new Set((before ?? []).flatMap((x) => x.lines))
  return new Set(now.flatMap((x) => x.lines).filter((l) => !had.has(l)))
}

/** 올릴 파일(GLB 빼고). 이름은 서버가 받는 이름이다(layouts.ts 의 validFile). `result` 는 반영 결과 리포트의 묶음이다. */
export function layoutFiles(
  model: Model,
  edits: EditFile,
  result: ReportSection[] = groupReport([]),
  /** 생성 리포트(B-2, OE-GEN-07·09). */
  generation?: { no: number; title: string; lines: string[] }[],
): { name: string; text: string }[] {
  return [
    { name: 'ontology.ttl', text: modelToTTL(model) },
    ...modelToGeoJSON(model).map((f) => ({ name: `geojson/${f.fileName.replace(/[/\\]/g, '_')}`, text: JSON.stringify(f.collection) })),
    { name: 'edits.json', text: JSON.stringify(edits) },
    { name: 'tree.json', text: JSON.stringify(spaceTree(model)) },
    { name: 'report.json', text: JSON.stringify({ source: edits.source, savedAt: edits.savedAt, ...layoutSummary(model, edits), sections: result, ...(generation ? { generation } : {}) }) },
  ]
}
