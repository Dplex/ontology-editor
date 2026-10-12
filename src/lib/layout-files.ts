// [반영하기]·[구축하기] 가 서버에 올리는 한 버전의 파일(OE-WF-10·13, OE-GEN-01·05·09, OE-SYNC-01·03, ADR-0037). 반영한 것은 이 파일들이다 —
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

/** 올릴 파일(GLB 빼고). 이름은 서버가 받는 이름이다(layouts.ts 의 validFile). */
export function layoutFiles(model: Model, edits: EditFile): { name: string; text: string }[] {
  return [
    { name: 'ontology.ttl', text: modelToTTL(model) },
    ...modelToGeoJSON(model).map((f) => ({ name: `geojson/${f.fileName.replace(/[/\\]/g, '_')}`, text: JSON.stringify(f.collection) })),
    { name: 'edits.json', text: JSON.stringify(edits) },
    { name: 'tree.json', text: JSON.stringify(spaceTree(model)) },
    { name: 'report.json', text: JSON.stringify({ source: edits.source, savedAt: edits.savedAt, ...layoutSummary(model, edits) }) },
  ]
}
