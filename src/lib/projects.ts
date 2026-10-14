// 프로젝트 목록·층 선택 화면의 표시 규칙(OE-UI-03 "공통 표시 규칙"). 서버의 프로젝트(src/server/projects.ts)를 화면이 보일 모양으로 바꾼다.
//
// - 층은 어디서든 건물 이름과 함께 보인다("B동 1F"). 두 건물에 같은 이름의 층이 있어도 갈린다.
// - 건물 안에서는 낮은 층부터(지하 먼저). 이름이 아니라 바닥 높이 순서다 — "B1F" 와 "1F" 를 글자로 줄 세우면 틀린다.
// - 층 범위는 가장 낮은 층~가장 높은 층("B5F~4F").

export type ProjectStorey = { key: string; name: string; elevation: number }
export type ProjectSummary = { buildings: { name: string; storeys: ProjectStorey[] }[] }
export type ProjectRow = {
  id: string
  key: string
  name: string
  site: string
  paths: string[]
  createdAt: string
  createdBy: string
  summary?: ProjectSummary
  built: { version: number; at: string; by: string } | null
  drafts: { floor: string; by: string; savedAt: string }[]
}

export type BuildingView = {
  name: string
  /** "B1F~4F". 층이 하나면 그 이름, 없으면 빈칸. */
  range: string
  storeys: (ProjectStorey & { label: string; drafted: boolean })[]
  drafted: number
}

const byElevation = (a: ProjectStorey, b: ProjectStorey) => a.elevation - b.elevation || a.name.localeCompare(b.name, 'ko')

/** 건물별 층(낮은 층부터)과 범위·임시 저장 수. 층 구성을 아직 모르면(한 번도 열지 않음) 빈 배열이다. */
export function buildingsOf(p: Pick<ProjectRow, 'summary' | 'drafts'>): BuildingView[] {
  const drafted = new Set(p.drafts.map((d) => d.floor))
  return (p.summary?.buildings ?? []).map((b) => {
    const storeys = [...b.storeys].sort(byElevation).map((s) => ({ ...s, label: `${b.name} ${s.name}`, drafted: drafted.has(s.key) }))
    const range = storeys.length > 1 ? `${storeys[0].name}~${storeys.at(-1)!.name}` : (storeys[0]?.name ?? '')
    return { name: b.name, range, storeys, drafted: storeys.filter((s) => s.drafted).length }
  })
}

/** 사이트 합계: 건물 수·전체 층 수·임시 저장한 층 수. 층 구성을 모르면 null. */
export function siteTotals(p: Pick<ProjectRow, 'summary' | 'drafts'>): { buildings: number; storeys: number; drafted: number } | null {
  if (!p.summary) return null
  const bs = buildingsOf(p)
  return { buildings: bs.length, storeys: bs.reduce((n, b) => n + b.storeys.length, 0), drafted: bs.reduce((n, b) => n + b.drafted, 0) }
}

/** 마지막 임시 저장 또는 구축(반영) — 더 늦은 쪽. 아무것도 없으면 만든 때. */
export function lastActivity(p: Pick<ProjectRow, 'built' | 'drafts' | 'createdAt' | 'createdBy'>): { what: '임시 저장' | '구축' | '반영' | '만듦'; at: string; by: string } {
  const draft = [...p.drafts].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
  const built = p.built
  if (built && (!draft || built.at >= draft.savedAt)) return { what: built.version > 1 ? '반영' : '구축', at: built.at, by: built.by }
  if (draft) return { what: '임시 저장', at: draft.savedAt, by: draft.by }
  return { what: '만듦', at: p.createdAt, by: p.createdBy }
}

/** 화면이 연 모델에서 센 층 구성. 모델은 건물 하나다(합쳐 연 건축·설비도 한 건물). */
export function summaryOf(m: { buildingName: string; storeys: { id: string; name: string; elevation: number }[] }): ProjectSummary {
  return { buildings: [{ name: m.buildingName || '(건물 이름 없음)', storeys: m.storeys.map((s) => ({ key: s.id, name: s.name, elevation: s.elevation })) }] }
}
