// 3D 보기 필터(ui-notes 보기 필터). 층 여러 개 골라 보기, Brick 클래스·계통으로 거르기, 숨기기·격리. **화면 상태다** — 모델·편집 파일·TTL·
// GeoJSON 에 아무것도 남지 않는다. 층 보기(viewStorey)·다중층 뷰가 정한 보일 층과 숨길 설비 위에 얹는다(App.vue 의 applyStoreyFilter).
// 클래스는 내보내기와 같은 규칙(export/ttl.ts 의 classOf)으로 센다 — 필터에서 고른 `brick:Air_Diffuser` 가 TTL 의 그 클래스다.
import { classOf } from './export/ttl'
import type { Equipment, Model } from './model'

/** `null` 은 그 기준으로 거르지 않는다(전부). 빈 배열은 아무것도 안 고른 것이다(그 기준으로 다 숨는다). */
export type ViewFilter = {
  /** 보일 층(모든 층을 볼 때만 쓴다 — 층 하나만 보거나 다중층 뷰면 그쪽이 정한다). */
  storeys: string[] | null
  /** 보일 클래스(`brick:Fan`, `fso:Segment` …). */
  classes: string[] | null
  /** 보일 계통 id. 계통이 없는 설비는 `NO_SYSTEM`. */
  systems: string[] | null
  /** 이것만 보기(격리). `null` 이면 격리하지 않는다. */
  isolate: string[] | null
  /** 숨긴 설비. */
  hidden: string[]
}

export const NO_SYSTEM = '(계통 없음)'
export const EMPTY_FILTER: ViewFilter = { storeys: null, classes: null, systems: null, isolate: null, hidden: [] }

export function filterActive(f: ViewFilter): boolean {
  return f.storeys !== null || f.classes !== null || f.systems !== null || f.isolate !== null || f.hidden.length > 0
}

/** 덕트·배관 클래스(FSO). 필터 목록에서 기기와 따로 묶는다. */
export const isConduitClass = (cls: string) => cls.startsWith('fso:')

export type Facets = {
  storeys: { id: string; name: string; count: number }[]
  classes: { id: string; count: number; conduit: boolean }[]
  systems: { id: string; name: string; count: number }[]
}

/** 필터 칸의 항목과 개수. 설비마다 하나씩 센다(위치가 없는 미배치 설비도 센다 — 표와 같다). */
export function facets(model: Model): Facets {
  const classes = new Map<string, number>()
  const systems = new Map<string, number>()
  for (const e of model.storeys.flatMap((s) => s.equipment)) {
    const c = classOf(e)
    classes.set(c, (classes.get(c) ?? 0) + 1)
    const s = e.systemId ?? NO_SYSTEM
    systems.set(s, (systems.get(s) ?? 0) + 1)
  }
  const systemName = new Map(model.systems.map((s) => [s.id, s.name || s.id]))
  return {
    storeys: [...model.storeys].sort((a, b) => a.elevation - b.elevation).map((s) => ({ id: s.id, name: s.name, count: s.equipment.length })),
    // 기기 먼저, 많은 것부터. 덕트·배관은 뒤에 둔다 — 대수가 기기의 여러 배라 위에 있으면 기기 목록이 밀린다.
    classes: [...classes]
      .map(([id, count]) => ({ id, count, conduit: isConduitClass(id) }))
      .sort((a, b) => Number(a.conduit) - Number(b.conduit) || b.count - a.count || a.id.localeCompare(b.id)),
    systems: [...systems]
      .map(([id, count]) => ({ id, name: id === NO_SYSTEM ? NO_SYSTEM : (systemName.get(id) ?? id), count }))
      .sort((a, b) => Number(a.id === NO_SYSTEM) - Number(b.id === NO_SYSTEM) || b.count - a.count),
  }
}

/** 이 설비가 필터를 지나 보이는가(층은 따로 — 층은 판·벽까지 숨기니 화면이 층 보기와 합친다). */
export function passes(e: Equipment, f: ViewFilter, hidden: ReadonlySet<string> = new Set(f.hidden), isolate: ReadonlySet<string> | null = f.isolate && new Set(f.isolate)): boolean {
  if (hidden.has(e.id)) return false
  if (isolate && !isolate.has(e.id)) return false
  if (f.classes && !f.classes.includes(classOf(e))) return false
  if (f.systems && !f.systems.includes(e.systemId ?? NO_SYSTEM)) return false
  return true
}

/** 필터로 숨는 설비 id. 층 보기가 숨긴 것과 합쳐 뷰어에 준다. */
export function filteredOut(model: Model, f: ViewFilter): Set<string> {
  const out = new Set<string>()
  if (!filterActive(f)) return out
  const hidden = new Set(f.hidden)
  const isolate = f.isolate && new Set(f.isolate)
  for (const e of model.storeys.flatMap((s) => s.equipment)) if (!passes(e, f, hidden, isolate)) out.add(e.id)
  // 층만 거른 필터는 설비를 숨기지 않는다(층이 판째 숨긴다).
  return out
}

/** 필터를 한 줄로(3D 위 띠). 무엇이 걸러졌는지 말하고, 화면에만 적용된다는 것을 함께 말한다. */
export function filterSummary(model: Model, f: ViewFilter): string {
  const parts: string[] = []
  if (f.isolate) parts.push(`${f.isolate.length.toLocaleString()}대만 보기`)
  if (f.storeys) parts.push(`층 ${f.storeys.length}개`)
  if (f.classes) parts.push(`클래스 ${f.classes.length}개`)
  if (f.systems) parts.push(`계통 ${f.systems.length}개`)
  if (f.hidden.length) parts.push(`${f.hidden.length.toLocaleString()}대 숨김`)
  const shown = model.storeys.flatMap((s) => s.equipment).length - filteredOut(model, f).size
  return `${parts.join(' · ')} — 설비 ${shown.toLocaleString()}대 보임`
}

/**
 * 분해도(Brick 클래스별) 묶음. 기기 클래스만 띄운다 — 덕트·배관은 제자리에 둔다(띄우면 배관망이 통째로 떠 기기 묶음을 가린다).
 * 보이는 설비(필터를 지난 것)만, 많은 클래스부터.
 */
export function explodeGroups(model: Model, visible: (e: Equipment) => boolean): { label: string; cls: string; ids: string[] }[] {
  const by = new Map<string, string[]>()
  for (const e of model.storeys.flatMap((s) => s.equipment)) {
    if (!e.position || !visible(e)) continue
    const c = classOf(e)
    if (isConduitClass(c)) continue
    const list = by.get(c) ?? []
    list.push(e.id)
    by.set(c, list)
  }
  return [...by]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([cls, ids]) => ({ cls, ids, label: `${cls} · ${ids.length.toLocaleString()}` }))
}
