import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { familyKeyOf } from '../lib/edit'
import { EQUIPMENT_KINDS } from '../lib/kinds'
import { isConduit } from '../lib/model'
import { replayOpen } from '../lib/replay-player'
import { needsSystem } from '../lib/served'
import { isFull, type SpaceChecklist } from '../lib/space-checklist'
import { spaceInfluence, spaceViewHidden, storeySpaces } from '../lib/space-view'
import { EMPTY_FILTER, explodeGroups, facets, filterActive, filteredOut, filterSummary, sourceGroups, type TintSource, type ViewFilter } from '../lib/view-filter'
import { baseline } from './changes'
import { checks, checksByStorey, selectedSpaceInfluence } from './checks'
import { activeTab } from './context-menu'
import { editing, model } from './core'
import { exteriorIds } from './edit-report'
import { airServiceList, spaceView } from './flow-map'
import { equipmentById, selectedId } from './flow-rules'
import { note } from './keyboard'
import { unknownTypes } from './kinds'
import { multiRange, viewStorey } from './multi-view'
import { sceneVersion } from './redraw'
import { pickSpace, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { drawing } from './space-objects'
import { multiView, verticalCreate } from './vertical'
import { placingRangeAt, placingVertical } from './vertical-create'

// --- 보기 필터 · 숨기기 · 격리 · 분해도 (ui-notes 보기 필터) ---
// 층 보기(위)가 정한 보일 층·숨길 설비 위에 얹는다. 전부 화면 상태다 — 모델·편집 파일·TTL·GeoJSON 에 남지 않고, 파일을 새로 열면 푼다.
export const viewFilter = shallowRef<ViewFilter>(EMPTY_FILTER)
export const filterOpen = ref(false)
export const explorerQuery = ref('')
export const filterOn = computed(() => filterActive(viewFilter.value))
export const viewFacets = computed(() => (model.value && filterOpen.value ? facets(model.value) : null))

/**
 * Brick 클래스의 한국어 이름(보기 필터·종류별 색 범례). 종류 사전(kinds.ts)이 그 클래스로 내보내는 종류 이름을 쓴다 — 따로 이름표를 두면
 * 사전과 어긋난다(제미나이 판의 별칭 사전은 `brick:Terminal_Unit` 을 디퓨저로 불렀다. 디퓨저는 `brick:Air_Diffuser` 다).
 * 사전에 없는 클래스는 클래스 이름 그대로, `ex:` 는 종류 모름, FSO 는 덕트·배관 구간·이음쇠다.
 */
const BRICK_KIND_NAMES = (() => {
  const by = new Map<string, string[]>()
  for (const k of EQUIPMENT_KINDS) if (k.brick) by.set(k.brick, [...(by.get(k.brick) ?? []), k.label])
  return new Map([...by].map(([cls, labels]) => [cls, [...new Set(labels)].slice(0, 3).join('·')]))
})()
export function classFriendlyLabel(cls: string): string {
  if (cls.startsWith('ex:')) return '종류 모름'
  if (cls === 'fso:Segment') return '덕트·배관 구간'
  if (cls === 'fso:Fitting') return '덕트·배관 이음쇠'
  return BRICK_KIND_NAMES.get(cls) ?? cls.replace(/^brick:/, '').replace(/_/g, ' ')
}

export const filteredExplorerFacets = computed(() => {
  const f = viewFacets.value
  if (!f) return null
  const q = explorerQuery.value.trim().toLowerCase()
  if (!q) return f
  return {
    storeys: f.storeys.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)),
    classes: f.classes.filter((c) => c.id.toLowerCase().includes(q) || classFriendlyLabel(c.id).toLowerCase().includes(q)),
    systems: f.systems.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)),
  }
})
export const filterText = computed(() => (model.value && filterOn.value ? filterSummary(model.value, viewFilter.value) : ''))
/** 종류를 모르는 패밀리(U 로 도는 것과 같은 목록). */
export const unknownFamilies = computed(() => new Set(unknownTypes.value.map((t) => t.key)))
/** 손볼 설비(소속 방 없음 · 종류 모름 · 계통이 있어야 하는데 없음 · 완전성 검사 위반)만 3D 에 남긴다(격리). 화면에서만이다. */
export function isolateIssuesOnly() {
  const m = model.value
  if (!m) return
  const issueIds = new Set<string>()
  for (const st of m.storeys) {
    for (const e of st.equipment) {
      if (!e.position) continue
      if (!e.spaceId && !exteriorIds.value.has(e.id)) issueIds.add(e.id)
      if (unknownFamilies.value.has(familyKeyOf(e))) issueIds.add(e.id)
      if (needsSystem(e) && !e.systemId) issueIds.add(e.id)
    }
  }
  for (const c of checks.value) {
    for (const id of c.failed) issueIds.add(id)
  }
  if (!issueIds.size) {
    note('손볼 설비가 없습니다(3D 에 놓인 설비 기준)')
    return
  }
  setViewFilter({ isolate: [...issueIds] })
  note(`손볼 설비 ${issueIds.size}대만 남겼습니다 — 화면에서만. [모두 보이기] 로 돌아옵니다`)
}
export function topDownView() {
  if (activeTab.value !== '3d') activeTab.value = '3d'
  viewer?.viewFrom([0, 1, 0])
  note('위에서 내려다봅니다')
}
/** 층 칸은 모든 층을 볼 때만 쓴다. 층 하나만 보거나 다중층 뷰면 그쪽이 보일 층을 정한다(편집할 층이 하나여야 한다). */
export const filterStoreysUsable = computed(() => !viewStorey.value && !multiView.value)
export function setViewFilter(patch: Partial<ViewFilter>) {
  viewFilter.value = { ...viewFilter.value, ...patch }
}
export function clearViewFilter() {
  viewFilter.value = EMPTY_FILTER
  exitSpaceView()
  if (exploded.value) toggleExplode()
  classTintOn.value = false
  note('모두 보입니다')
}
/** 체크 목록 한 칸을 켜고 끈다. 전부 켜지면 null(거르지 않음)로 돌린다. */
export function toggleFacet(key: 'storeys' | 'classes' | 'systems', id: string, all: readonly string[]) {
  // 층 하나만 보던 중에 다른 층 칸을 누르면 모든 층 보기로 풀고, 보던 층에서 시작해 누른 층을 더하거나 뺀다.
  // 모든 층에서 시작하면 화면에 체크돼 보이지 않던 층을 누른 것이 "그 층만 빼기" 가 돼 보던 것과 거꾸로 된다.
  const single = key === 'storeys' && viewStorey.value && !multiView.value ? viewStorey.value : null
  if (single) viewStorey.value = null
  const now = single ? [single] : viewFilter.value[key] ?? [...all]
  const next = now.includes(id) ? now.filter((x) => x !== id) : [...now, id]
  setViewFilter({ [key]: next.length === all.length ? null : next })
}
export function setFacetAll(key: 'storeys' | 'classes' | 'systems', on: boolean, ids?: readonly string[]) {
  if (!ids) return setViewFilter({ [key]: on ? null : [] })
  // 덕트·배관처럼 일부 묶음만 켜고 끈다.
  const all = viewFacets.value?.[key === 'storeys' ? 'storeys' : key].map((x) => x.id) ?? []
  const now = new Set(viewFilter.value[key] ?? all)
  for (const id of ids) on ? now.add(id) : now.delete(id)
  setViewFilter({ [key]: now.size === all.length ? null : [...now] })
}
export const facetOn = (key: 'storeys' | 'classes' | 'systems', id: string) => viewFilter.value[key]?.includes(id) ?? true

// --- 공간 보기 (lib/space-view.ts) ---
// 층 보기(기본) 위에 방 하나로 좁힌다. 그 방을 고르고, 그 층만 보이며, 카메라를 그 방에 맞추고, 그 방 안의 설비와 그 방 말단에 바람을
// 대는 공기 원천만 3D 에 남긴다. 고르기·편집은 여느 때와 같다 — 보이는 것만 줄인다. 화면 상태라 모델·TTL·GeoJSON 에 남지 않는다.
/** 공간 칸이 방을 보이는 층. 층 하나를 볼 때만 — 모든 층이면 방이 수백 개라 고를 수 없다. 층이 하나뿐인 파일은 그 층이다. */
export const spacesStoreyId = computed(() => viewStorey.value ?? (model.value?.storeys.length === 1 ? model.value.storeys[0].id : null))
/** 공간 칸이 보이는 층의 방별 체크리스트. 칸의 점수·[빈칸 있는 방만]·방 사이 이동(, .)이 쓴다. */
const spacesChecks = computed(() => (spacesStoreyId.value && !multiView.value ? checksByStorey(spacesStoreyId.value) : new Map<string, SpaceChecklist>()))
/** 공간 칸에서 빈칸 있는 방만 보기. 화면 상태다. */
export const spacesEmptyOnly = ref(false)
export const viewSpaces = computed(() => {
  const m = model.value
  const id = spacesStoreyId.value
  if (!m || !id || multiView.value || !filterOpen.value) return []
  const checks = spacesChecks.value
  const rows = storeySpaces(m, id, (e) => isConduit(e.role)).map((r) => ({ ...r, check: checks.get(r.id) ?? null }))
  const q = explorerQuery.value.trim().toLowerCase()
  return rows.filter((r) => (!q || `${r.name} ${r.longName}`.toLowerCase().includes(q)) && (!spacesEmptyOnly.value || (r.check && !isFull(r.check)) || r.id === spaceView.value?.id))
})
export const spaceViewName = computed(() => {
  const id = spaceView.value?.id
  const sp = id ? model.value?.storeys.flatMap((st) => st.spaces).find((x) => x.id === id) : null
  return sp ? [sp.name, sp.longName].filter(Boolean).join(' ') : ''
})
export function enterSpaceView(id: string) {
  const m = model.value
  const storey = m?.storeys.find((st) => st.spaces.some((x) => x.id === id))
  if (!m || !storey) return
  // 다중층 뷰는 나가며 저장을 묻는다(closeMultiView) — 여기서 대신 나가지 않는다.
  if (multiView.value) return note('다중층 뷰에서는 공간 보기를 쓸 수 없습니다 — [층 편집으로] 돌아온 뒤 고르세요')
  if (activeTab.value !== '3d') activeTab.value = '3d'
  viewStorey.value = storey.id
  pickSpace(id)
  const inf = spaceInfluence(m, id, airServiceList.value, equipmentById.value)
  spaceView.value = { id, keep: new Set([...inf.inside, ...inf.sources.map((x) => x.id)]) }
  // 층을 바꾸면 그 층 전체에 맞추는 것(watch viewStorey)보다 뒤에 방으로 간다.
  void nextTick(() => viewer?.frameSpace(id, true))
}
/**
 * 방 사이 이동(, . · Shift+, Shift+.). 순서는 공간 칸과 같은 방번호 순이고 층 끝에서는 처음으로 돈다(D 1안). 공간 보기 중이면 옮긴 방을
 * 공간 보기로, 아니면 그 방을 골라 시점만 맞춘다. `emptyOnly` 면 체크리스트에 빈칸 있는 방만 밟는다.
 */
export function stepSpace(dir: 1 | -1, emptyOnly: boolean) {
  const m = model.value
  const storeyId = spacesStoreyId.value
  if (!m || !storeyId || multiView.value) return note('층 하나를 고르면 그 층의 방 사이를 옮겨 다닙니다')
  const checks = spacesChecks.value
  const all = storeySpaces(m, storeyId, (e) => isConduit(e.role))
  const order = emptyOnly ? all.filter((r) => { const c = checks.get(r.id); return c && !isFull(c) }) : all
  if (!order.length) return note(emptyOnly ? '이 층에는 빈칸 있는 방이 없습니다' : '이 층에는 물리존이 없습니다')
  const now = spaceView.value?.id ?? selectedSpaceId.value
  // 지금 방의 자리는 빈칸 없는 방이어도 전체 순서로 잡는다 — 그 뒤의 첫 빈칸 있는 방으로 간다.
  const at = now ? all.findIndex((r) => r.id === now) : -1
  let next = order[dir > 0 ? 0 : order.length - 1]
  if (at >= 0) {
    const pos = (id: string) => all.findIndex((r) => r.id === id)
    const ahead = order.filter((r) => (dir > 0 ? pos(r.id) > at : pos(r.id) < at))
    if (ahead.length) next = dir > 0 ? ahead[0] : ahead[ahead.length - 1]
  }
  if (spaceView.value) enterSpaceView(next.id)
  else {
    pickSpace(next.id)
    void nextTick(() => viewer?.frameSpace(next.id))
  }
  const c = checks.get(next.id)
  note(`${[next.name, next.longName].filter(Boolean).join(' ')} — ${all.findIndex((r) => r.id === next.id) + 1}/${all.length}${c ? ` · 체크리스트 ${c.have}/${c.of}` : ''}`)
}
export function exitSpaceView() {
  if (!spaceView.value) return
  spaceView.value = null
  viewer?.frameVisible(true)
}
/** 마지막으로 뷰어에 준 숨길 설비. 분해도가 보이는 것만 띄울 때 쓴다. */
let shownHidden: ReadonlySet<string> = new Set()
export function applyStoreyFilter() {
  const m = model.value
  if (!viewer || !m) return
  // 리플레이는 건물 전체 3D 에서 열고 장면마다 그 층으로 들어간다(replay-player 가 viewStorey 만 쓴다). 보기 필터·다중층 뷰는 편집 화면의
  // 상태라 리플레이 동안은 보지 않는다. 값을 고치지 않으니 닫으면 그대로 돌아온다.
  const replaying = replayOpen.value
  const extra = filterOn.value && !replaying ? filteredOut(m, viewFilter.value) : null
  // 공간 보기면 들어올 때 남긴 것·지금 그 방 안에 있는 것·공기 원천 밖은 숨긴다.
  const sv = replaying ? null : spaceView.value
  const spaceHidden = sv
    ? spaceViewHidden(m, new Set([...sv.keep, ...(sv.id === selectedSpaceId.value ? (selectedSpaceInfluence.value?.inside ?? []) : spaceInfluence(m, sv.id, airServiceList.value, equipmentById.value).inside)]))
    : null
  const merge = (hidden: Set<string>) => {
    if (extra) for (const id of extra) hidden.add(id)
    if (spaceHidden) for (const id of spaceHidden) hidden.add(id)
    return hidden
  }
  const send = (storeys: Set<string> | null, hidden: Set<string>) => {
    shownHidden = hidden
    viewer!.setStoreyFilter(storeys, hidden)
  }
  // 다중층 뷰면 보기 범위의 층들이다(OE-ML-01).
  const range = replaying ? null : multiRange.value
  if (range) {
    // 수직 관통 오브젝트의 형상·지점을 그리는 동안에는 그 층 위를 걷어 낸다. 위층 판이 덮으면 찍은 점이 안 보이고, 바닥에 대면
    // 위층 방이 떠서 어느 층에 찍는지 헷갈렸다(2026-10-13, 병원 1층에 계단을 그릴 때).
    // 시작점·승강로 위치를 찍는 동안(OE-ML-06)도 같다.
    const d = drawing.value
    const placingAt = placingVertical.value
      ? (m.storeys.find((st) => st.id === verticalCreate.value?.from)?.elevation ?? null)
      : placingRangeAt.value
        ? (m.storeys.find((st) => st.id === placingRangeAt.value)?.elevation ?? null)
        : null
    const cut = d && (d.purpose === 'verticalFootprint' || d.purpose === 'verticalPoint') ? d.elevation : placingAt
    const ids = new Set(range.filter((st) => cut === null || st.elevation <= cut + 1e-6).map((st) => st.id))
    send(ids, merge(new Set(m.storeys.filter((s) => !ids.has(s.id)).flatMap((s) => s.equipment.map((e) => e.id)))))
    return
  }
  const id = viewStorey.value
  if (!id || !m.storeys.some((s) => s.id === id)) {
    // 모든 층을 볼 때만 보기 필터의 층 칸이 먹는다.
    const picked = replaying ? null : viewFilter.value.storeys
    if (picked) {
      const ids = new Set(picked)
      send(ids, merge(new Set(m.storeys.filter((s) => !ids.has(s.id)).flatMap((s) => s.equipment.map((e) => e.id)))))
    } else send(null, merge(new Set()))
    return
  }
  const hidden = new Set(m.storeys.filter((s) => s.id !== id).flatMap((s) => s.equipment.map((e) => e.id)))
  send(new Set([id]), merge(hidden))
}
const verticalDrawAt = computed(() => {
  const d = drawing.value
  return d && (d.purpose === 'verticalFootprint' || d.purpose === 'verticalPoint') ? d.storeyId : null
})

/** 분해도(V3). 보이는 기기를 Brick 클래스별로 건물 위에 한 켜씩 띄운다. */
export const exploded = ref(false)
function explodeNow(): boolean {
  const m = model.value
  if (!viewer || !m) return false
  return viewer.setExplode(explodeGroups(m, (e) => !shownHidden.has(e.id)))
}
export function toggleExplode() {
  if (exploded.value) {
    viewer?.setExplode(null)
    exploded.value = false
    viewer?.frameVisible(true)
    return
  }
  if (activeTab.value !== '3d') activeTab.value = '3d'
  exploded.value = explodeNow()
  note(exploded.value ? 'Brick 클래스별로 띄웠습니다 — 화면에서만이고, 펼친 동안 3D 에서 드래그해 옮기지 않습니다' : '띄울 기기가 없습니다(덕트·배관은 띄우지 않습니다)')
}
// --- 종류별 색(독의 [Explode], 2026-10-15) ---
// 기기를 제자리에서 Brick 클래스(TTL 에 나가는 그 클래스, classOf)별 색으로 칠하고 범례에 종류 이름·대수를 보인다. 범례 줄을 누르면 그 종류만
// 색으로 남기고 나머지는 흐린 회색이다. 덕트·배관은 흐린 회색이고 가구는 흐리게 한다. 사전이 종류를 모르는 기기(`ex:` 클래스)는 한 줄 "종류 모름" 으로 묶어 자홍이다 —
// 종류를 채워야 할 기기가 어디에 얼마나 있는지 보이게. 화면에서만이고, 리플레이 동안은 끈다.
/** 범례 순서대로 쓰는 색(많은 종류부터). 10개를 넘으면 돌려 쓴다 — 그때는 범례 줄을 눌러 하나씩 본다. */
const CLASS_PALETTE = [0x4e79a7, 0xf28e2b, 0x59a14f, 0xe15759, 0x76b7b2, 0xedc948, 0xb07aa1, 0x9c755f, 0x2f8f9d, 0x8cd17d]
export const UNKNOWN_CLASS = '(종류 모름)'
/** 종류 모름은 눈에 띄는 자홍이다 — 짙은 회색으로 두었더니 벽·바닥과 섞여 채울 것이 안 보였다. 팔레트에는 이 색과 비슷한 분홍을 두지 않는다. */
const UNKNOWN_CLASS_COLOR = 0xc2185b
export const classTintOn = ref(false)
/**
 * 무엇으로 칠하나. `class` 는 Brick 클래스, `kind`·`space` 는 종류·소속을 어디서 알았나(lib/view-filter.ts 의 tintSourceOf).
 * 출처로 칠하면 "BIM 이 어디까지 주나" 가 3D 위에 보인다 — Revit 파일은 대개 종류가 사전 색, 소속이 계산 색이다.
 */
export const classTintBy = ref<'class' | 'kind' | 'space'>('class')
export const TINT_BY_LABEL = { class: '종류', kind: '종류 출처', space: '소속 출처' } as const
/** 출처 색. 화면의 출처 꼬리표(BIM·계산·사전·사람)와 같은 넷에 모름을 더한다. 모름은 종류 모름과 같은 자홍이다. */
const SOURCE_TINT: Record<TintSource, number> = { bim: 0x2563eb, calc: 0x16a34a, dict: 0xf59e0b, edit: 0x9333ea, none: 0xc2185b }
const SOURCE_LABEL: Record<'kind' | 'space', Record<TintSource, { label: string; note: string }>> = {
  kind: {
    bim: { label: 'BIM', note: 'IFC 클래스·PredefinedType 이 Brick 클래스를 정했습니다' },
    calc: { label: '계산', note: '' },
    dict: { label: '사전', note: '패밀리 이름을 사전으로 읽어 Brick 클래스를 정했습니다' },
    edit: { label: '사람', note: '사람이 종류를 정했습니다' },
    none: { label: '종류 모름', note: 'Brick 클래스가 없어 TTL 클래스가 ex: 입니다(종류를 모르거나, 사전에 그 종류의 Brick 클래스가 없음)' },
  },
  space: {
    bim: { label: 'BIM', note: 'BIM 이 공간 소속을 적었습니다' },
    calc: { label: '계산', note: '좌표가 그 방 외곽선 안이라 소속을 정했습니다' },
    dict: { label: '사전', note: '' },
    edit: { label: '사람', note: '사람이 소속 방을 지정했습니다' },
    none: { label: '방 없음', note: '소속 방이 없어 TTL 의 hasLocation 이 층입니다' },
  },
}
/** 범례에서 누른 종류. 그 종류만 색으로 남긴다. */
export const classFocus = ref<string | null>(null)
export const classLegend = computed(() => {
  void sceneVersion.value
  const m = model.value
  if (!classTintOn.value || !m) return []
  const rows: { key: string; label: string; cls: string; ids: string[]; color: number }[] = []
  const by = classTintBy.value
  if (by !== 'class') {
    for (const g of sourceGroups(m, by)) {
      const l = SOURCE_LABEL[by][g.source]
      rows.push({ key: `src:${g.source}`, label: l.label, cls: l.note, ids: g.ids, color: SOURCE_TINT[g.source] })
    }
    return rows
  }
  const unknown: { ids: string[]; classes: string[] } = { ids: [], classes: [] }
  for (const g of explodeGroups(m, () => true)) {
    if (g.cls.startsWith('ex:')) {
      unknown.ids.push(...g.ids)
      unknown.classes.push(g.cls)
      continue
    }
    rows.push({ key: g.cls, label: classFriendlyLabel(g.cls), cls: g.cls, ids: g.ids, color: CLASS_PALETTE[rows.length % CLASS_PALETTE.length] })
  }
  if (unknown.ids.length) rows.push({ key: UNKNOWN_CLASS, label: '종류 모름', cls: unknown.classes.join(' · '), ids: unknown.ids, color: UNKNOWN_CLASS_COLOR })
  return rows
})
// 리플레이 동안은 분해도를 접고 다중층 뷰의 손잡이를 끈다(건물 전체 3D 에서 튼다 — 보기 필터는 applyStoreyFilter). 닫으면 되살린다.
// 닫을 때 리플레이가 뷰어 편집 모드를 editing 으로만 돌려서, 다중층 뷰였으면 여기서 다시 맞춘다(위 watch([multiView, editing]) 와 같은 값).
let explodeAfterReplay = false

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupViewFilter() {
  watch(baseline, () => {
    viewFilter.value = EMPTY_FILTER
    spaceView.value = null
    exploded.value = false
    explorerQuery.value = ''
  })
  // 공간 보기 중에 다른 방 바닥을 누르면 그 방으로 옮겨 간다. 설비를 고르면(방 고르기가 풀린다) 그대로 둔다 — 그 방 안에서 고치는 중이다.
  watch(selectedSpaceId, (id) => {
    if (id && spaceView.value && id !== spaceView.value.id && model.value?.storeys.some((st) => st.spaces.some((x) => x.id === id))) enterSpaceView(id)
  })
  // 3D 에서 그 방 바닥을 채우고 그 층 판·벽을 흐린다. 리플레이 동안은 걷는다(리플레이는 보기 필터도 보지 않는다).
  watch([spaceView, replayOpen], () => viewer?.setSpaceFocus(spaceView.value && !replayOpen.value ? spaceView.value.id : null))
  // 층을 바꾸거나 다중층 뷰로 가면 푼다. 방이 지워져도 푼다.
  watch([viewStorey, multiView, model], () => {
    const v = spaceView.value
    if (!v) return
    const storey = model.value?.storeys.find((st) => st.spaces.some((x) => x.id === v.id))
    if (!storey || multiView.value || viewStorey.value !== storey.id) spaceView.value = null
  })
  watch([viewStorey, model, sceneVersion, () => multiRange.value, viewFilter, verticalDrawAt, replayOpen, spaceView], applyStoreyFilter)
  // 걸러 보는 중에 고른 설비가 숨으면 고르기를 푼다 — 안 보이는 것이 패널에 남아 있으면 무엇을 고쳤는지 모른다.
  watch(viewFilter, () => {
    if (selectedId.value && shownHidden.has(selectedId.value)) selectedId.value = null
  })
  // 필터를 바꾸면 보이는 것으로 다시 띄운다. 편집으로 다시 그리면 뷰어가 접으니 화면도 맞춘다.
  watch(viewFilter, () => {
    if (exploded.value) exploded.value = explodeNow()
  })
  watch([model, sceneVersion], () => {
    if (exploded.value && !viewer?.exploded()) exploded.value = false
  })
  // 기준을 바꾸면 앞 기준에서 누른 줄은 뜻이 없다.
  watch(classTintBy, () => (classFocus.value = null))
  watch(classTintOn, (on) => {
    if (!on) classFocus.value = null
    else if (activeTab.value !== '3d') activeTab.value = '3d'
  })
  watch([classLegend, classFocus, replayOpen], () => {
    if (!classTintOn.value || replayOpen.value) {
      viewer?.setTint(null)
      return
    }
    const colors = new Map<string, number>()
    for (const r of classLegend.value) if (!classFocus.value || classFocus.value === r.key) for (const id of r.ids) colors.set(id, r.color)
    viewer?.setTint(colors)
  })
  watch(replayOpen, (open) => {
    if (open) {
      explodeAfterReplay = exploded.value
      if (exploded.value) {
        viewer?.setExplode(null)
        exploded.value = false
      }
      viewer?.setHandleEdit(false)
      return
    }
    viewer?.setEditMode(editing.value && !multiView.value)
    viewer?.setHandleEdit(editing.value && !!multiView.value)
    if (explodeAfterReplay) exploded.value = explodeNow()
    explodeAfterReplay = false
  })
}
