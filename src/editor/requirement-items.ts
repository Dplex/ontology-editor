// --- 요구사항 칸에서 표준 자리가 아닌 것을 짚기 (components/editor/ReviewPanel.vue 의 요구사항 표) ---
// "R24 설비 종류 50/141" 의 나머지 91대가 어디 있는지를 숫자에서 바로 본다. Autodesk Tandem 의 데이터 완성도 대시보드가 빠진 값의 요소를
// 3D 에 격리해 보이는 것에서 가져왔다(reference.md). id 는 요구사항 보고서가 숫자를 셀 때 쓴 판정에서 나온다(requirements.ts 의 items).
// 화면 상태다 — 3D 에 남기는 것은 보기 필터의 격리라 [모두 보이기] 로 돌아오고, 모델·TTL·GeoJSON 은 그대로다.
import { computed, nextTick, ref } from 'vue'
import type { RequirementItemKind, RequirementRow } from '../lib/requirements'
import { activeTab } from './context-menu'
import { model } from './core'
import { shortName } from './equipment-shape'
import { selectFromCompare } from './export-compare'
import { openCheckKey } from './checks'
import { equipmentById, selectedId } from './flow-rules'
import { showWalls } from './idf-zones'
import { selectedSystemId } from './kinds'
import { note } from './keyboard'
import { viewStorey } from './multi-view'
import { currentRequirements } from './open-file'
import { revealStage, selectAndShow } from './chat-view'
import { viewer } from './scene'
import { multiView } from './vertical'
import { setViewFilter } from './view-filter'

export const ITEM_LABEL: Record<RequirementItemKind, string> = { equipment: '설비', space: '물리존', wall: '벽', opening: '문·창' }
/** 펼친 줄에 이름을 보이는 수. 성수 R25 는 1천 대가 넘는다. */
export const ITEMS_SHOWN = 60

/** 펼친 요구(R 번호). */
export const openRequirement = ref<string | null>(null)
export const openRequirementRow = computed(() => currentRequirements.value.find((r) => r.id === openRequirement.value && r.items) ?? null)

export const itemCount = (r: RequirementRow) => (r.items ? r.items.elsewhere.length + r.items.missing.length : 0)

type Item = { id: string; name: string; where: string; elsewhere: boolean; placed: boolean }
/** 펼친 줄의 항목 — 다른 자리 먼저(설정만 바꾸면 되는 것), 그다음 없음. */
export const openRequirementItems = computed((): Item[] => {
  const r = openRequirementRow.value
  const m = model.value
  if (!r?.items || !m) return []
  const info = new Map<string, Omit<Item, 'id' | 'elsewhere'>>()
  for (const s of m.storeys) {
    if (r.items.kind === 'equipment') for (const e of s.equipment) info.set(e.id, { name: shortName(e.name || e.ifcClass), where: s.name, placed: e.position !== null })
    if (r.items.kind === 'space') for (const x of s.spaces) info.set(x.id, { name: [x.name, x.longName].filter(Boolean).join(' ') || x.id, where: s.name, placed: x.footprint.length >= 3 })
    if (r.items.kind === 'wall') for (const w of s.walls) info.set(w.id, { name: w.name || w.id, where: s.name, placed: true })
    if (r.items.kind === 'opening') for (const o of s.openings) info.set(o.id, { name: o.name || o.id, where: s.name, placed: true })
  }
  const one = (id: string, elsewhere: boolean): Item => ({ id, elsewhere, ...(info.get(id) ?? { name: id, where: '', placed: false }) })
  return [...r.items.elsewhere.map((id) => one(id, true)), ...r.items.missing.map((id) => one(id, false))]
})

/** 펴면 그 줄의 설비를 3D 에 칠한다(systems.ts). 고른 것이 있으면 그쪽이 색을 가져가므로 풀고, 펼친 완전성 검사도 접는다. */
export function toggleRequirement(id: string) {
  openRequirement.value = openRequirement.value === id ? null : id
  if (!openRequirement.value) return
  openCheckKey.value = null
  if (openRequirementRow.value?.items?.kind === 'equipment') {
    selectedId.value = null
    selectedSystemId.value = null
  }
}

/** 펼친 줄의 설비만 3D 에 남긴다. 좌표가 없는 것은 3D 에 없으니 미배치 목록에서 본다고 알린다. */
export function isolateRequirement(r: RequirementRow) {
  if (r.items?.kind !== 'equipment') return
  const ids = [...r.items.elsewhere, ...r.items.missing]
  const placed = ids.filter((id) => equipmentById.value.get(id)?.position)
  const unplaced = ids.length - placed.length
  if (!placed.length) {
    note(`${r.id} ${r.title} — 3D 에 놓인 설비가 없습니다${unplaced ? `(좌표 없는 ${unplaced}대는 미배치 목록)` : ''}`)
    return
  }
  if (activeTab.value !== '3d') activeTab.value = '3d'
  // 한 층만 보는 중이면 다른 층의 것이 안 보인다 — 여러 층에 걸치면 건물 전체로 편다.
  const homes = new Set(placed.map((id) => model.value?.storeys.find((s) => s.equipment.some((e) => e.id === id))?.id))
  if (viewStorey.value && !multiView.value && (homes.size > 1 || !homes.has(viewStorey.value))) viewStorey.value = homes.size === 1 ? [...homes][0]! : null
  setViewFilter({ isolate: placed })
  revealStage()
  nextTick(() => viewer?.frame(placed, 0.5))
  note(`${r.id} ${r.title} — 표준 자리가 아닌 설비 ${placed.length}대만 남겼습니다${unplaced ? ` · 좌표 없는 ${unplaced}대는 미배치 목록` : ''}. 벽에 가리면 W, [모두 보이기] 로 돌아옵니다`)
}

/** 펼친 줄의 물리존을 3D 에서 잠깐 밝힌다(바닥 외곽선이 있는 것만 보인다). 벽은 3D 벽을 켠다 — 내력 여부 모름은 노란 벽이다. */
export function pulseRequirement(r: RequirementRow) {
  if (!r.items) return
  if (activeTab.value !== '3d') activeTab.value = '3d'
  revealStage()
  if (r.items.kind === 'space') {
    if (viewStorey.value && !multiView.value) viewStorey.value = null
    nextTick(() => viewer?.pulseSpaces([...r.items!.elsewhere, ...r.items!.missing]))
  }
  if (r.items.kind === 'wall' || r.items.kind === 'opening') showWalls.value = true
}

export function showRequirementItem(kind: RequirementItemKind, id: string) {
  if (kind === 'equipment') return selectAndShow(id)
  const m = model.value
  const home = m?.storeys.find((s) => s.spaces.some((x) => x.id === id) || s.walls.some((w) => w.id === id) || s.openings.some((o) => o.id === id))
  if (home && viewStorey.value && !multiView.value) viewStorey.value = home.id
  selectFromCompare(id, kind === 'space' ? '' : kind === 'wall' ? 'wall' : (m?.storeys.flatMap((s) => s.openings).find((o) => o.id === id)?.kind ?? 'door'))
}
