import { computed, shallowRef, watch } from 'vue'
import { type EditFile, exportEdits } from '../lib/edit-file'
import { inferFlowByRules } from '../lib/flow-rules'
import { BUILDING, splitByStorey } from '../lib/storey-drafts'
import { appliedFloors, autosaveArmed, currentParts, dirtyKeys, draft, draftKey, draftsVersion, editCount, floorDrafts, floorName, homeOf, savedParts, setAutosaveArmed, unsavedCount } from './autosave'
import { baseline } from './changes'
import { editing, fileName, mode, model } from './core'
import { fullscreen } from './chat-view'
import { changes } from './edit-report'
import { selectedElementId } from './equipment-edit'
import { positionDrafts } from './equipment-shape'
import { confirmations, flowVersion, ruleReport, selectedId } from './flow-rules'
import { future, history } from './history'
import { note } from './keyboard'
import { clearDrafts, goFloor, replaceParts, syncDraftsToServer } from './layout-storeys'
import { areaChanges, storeyMoved } from './multi-select'
import { storeysByHeight, viewStorey } from './multi-view'
import { meshesToOpened, pristine } from './open-file'
import { saveEdits } from './progress'
import { committedParts, committedSig, setCommittedParts, setCommittedSig } from './projects'
import { logActivity } from './publish'
import { redraw } from './redraw'
import { selectedSpaceId } from './rooms'

// --- 편집 종료 (OE-COM-08) ---------------------------------------------------------------
//
// 편집을 끝낼 때 마지막으로 저장한 뒤 바뀐 것이 있으면 묻는다 — 임시 저장 / 저장 안 함 / 취소. 저장은 [편집 저장](편집
// 파일)이나 [구축하기](온톨로지 두 파일)다. 바뀐 것은 편집 파일 내용(저장 시각을 뺀)으로 견준다 — 되돌리기로 저장한 때와
// 같아졌으면 묻지 않는다. 끝내는 길(편집 종료·보기·E·전체 화면의 편집 체크)은 전부 leaveEdit 을 거친다.
export let savedSig: string | null = null
export function editSig(file?: EditFile): string | null {
  const m = model.value
  if (!m || !baseline.value) return null
  const f = file ?? exportEdits(m, baseline.value, fileName.value)
  return editCount(f) > 0 ? JSON.stringify({ ...f, savedAt: '' }) : null
}
export function markSaved() {
  savedSig = editSig()
  savedParts.value = currentParts()
}
/** 저장(8084·파일·구축하기)했다. 모든 층이 저장된 상태가 되고 임시 저장본은 지운다. */
export function committed() {
  clearDrafts()
  markSaved()
  setCommittedSig(savedSig)
  setCommittedParts(savedParts.value)
}
/** 묻는 중인 대화상자. `floor` 가 있으면 층을 바꾸려다 물은 것이다. */
export const exitAsk = shallowRef<{ count: number; floor?: { from: string; to: string | null } } | null>(null)

/** 편집을 끝낸다. 저장하지 않은 편집이 있으면 묻고 false 를 돌려준다(끝내지 않았다). */
export function leaveEdit(): boolean {
  if (!editing.value) return true
  const parts = currentParts()
  const dirty = dirtyKeys(parts)
  if (!dirty.length) {
    mode.value = 'view'
    return true
  }
  // 대화상자는 작업 영역 밖에 있어서 넓게 보기에서는 가려진다. 먼저 나온다.
  fullscreen.value = false
  exitAsk.value = { count: unsavedCount(dirty, parts) }
  return false
}
export function onEditToggle(box: HTMLInputElement) {
  if (box.checked) mode.value = 'edit'
  else if (!leaveEdit()) box.checked = true
}
/** 대화상자의 [임시 저장]. 층을 바꾸려던 것이면 그 층만 남기고 옮기고, 편집을 끝내려던 것이면 저장 안 한 층을 전부 남기고 끝낸다. */
export function exitSaving() {
  const ask = exitAsk.value
  exitAsk.value = null
  if (ask?.floor) {
    keepDraft([ask.floor.from])
    goFloor(ask.floor.to)
    return
  }
  keepDraft(dirtyKeys())
  mode.value = 'view'
}
/**
 * [임시 저장]. 지금 층(모든 층을 보고 있으면 저장 안 한 층 전부)과 건물 조각을 이 브라우저에 남긴다. 층마다 하나라 다시 누르면 덮는다
 * (OE-WF-03). 편집이 없는 층은 임시 저장본을 지운다. 웹(8084)에는 올리지 않는다(OE-WF-01). 저장소가 막혀 있으면 파일로 내려받는다.
 */
export function keepDraft(keys: string[] = viewStorey.value ? [viewStorey.value] : dirtyKeys()) {
  if (!model.value || !baseline.value) return
  logActivity('draft', model.value.storeys.filter((st) => keys.includes(st.id)).map((st) => st.name))
  syncDraftsToServer([...new Set([...keys, BUILDING])], currentParts())
  const parts = currentParts()
  const saved = new Map(savedParts.value)
  const all = [...new Set([...keys, BUILDING])]
  try {
    for (const k of all) {
      const part = parts.get(k)
      if (part) {
        localStorage.setItem(draftKey(k), JSON.stringify(part))
        floorDrafts.set(k, part)
        draftsVersion.value++
        saved.set(k, part)
      } else {
        localStorage.removeItem(draftKey(k))
        floorDrafts.delete(k)
        draftsVersion.value++
        saved.delete(k)
      }
      appliedFloors.add(k)
    }
  } catch {
    // 브라우저 저장소가 막혔으면 파일로만 내려받는다.
    void saveEdits(true)
    return
  }
  savedParts.value = saved
  const names = all.filter((k) => k !== BUILDING).map(floorName)
  note(`${names.length ? names.join(' · ') : '건물'} 편집을 이 브라우저에 임시 저장했습니다(웹에는 반영되지 않습니다). 그 층에 다시 들어오면 이어서 편집합니다`)
}
/** 대화상자의 [저장]. 8084 에 둔다(못 두면 파일로 내려받는다). 그다음 층을 옮기거나 보기로 간다. */
export async function exitCommitting() {
  const ask = exitAsk.value
  exitAsk.value = null
  await saveEdits()
  if (ask?.floor) goFloor(ask.floor.to)
  else mode.value = 'view'
}
/** 저장 안 한 편집이 있는 층 이름(높이 순). 건물 조각(층이 없는 편집)뿐이면 "건물" 이다. 종료·구축 확인 창이 보인다(OE-UI-04 AC11·12). */
export function dirtyFloorNames(): string[] {
  const dirty = new Set(dirtyKeys())
  const names = storeysByHeight.value.filter((st) => dirty.has(st.id)).map((st) => st.name)
  return names.length ? names : dirty.size ? ['건물'] : []
}
/** 층을 바꿀 때 [그대로 이동](OE-UI-04 AC10). 저장도 되돌리기도 하지 않고 간다 — 앞 층의 편집은 화면에 남고, [편집 종료]·[구축하기]가 층별로 묻는다. */
export function exitKeeping() {
  const ask = exitAsk.value
  exitAsk.value = null
  if (ask?.floor) goFloor(ask.floor.to)
}
export function exitDiscarding() {
  const ask = exitAsk.value
  exitAsk.value = null
  if (ask?.floor) {
    const n = discardFloors([ask.floor.from])
    goFloor(ask.floor.to)
    note(`${floorName(ask.floor.from)}의 저장 안 한 편집 ${n}건을 버리고 마지막으로 저장한 때로 되돌렸습니다. 상단 바의 자동 저장 질문에서 [예]로 복구할 수 있습니다`)
    return
  }
  const n = discardFloors(dirtyKeys())
  mode.value = 'view'
  note(`편집 ${n}건을 버리고 마지막으로 저장한 때로 되돌렸습니다. 상단 바의 자동 저장 질문에서 [예]로 복구할 수 있습니다`)
}

/**
 * [저장 안 함]. 고른 조각을 마지막으로 저장한 때(임시 저장본, 없으면 8084·파일 저장, 없으면 연 때)로 되돌린다. 버리기 전 편집 전부를
 * 위 줄(draft)에 올려 한 번 되살릴 수 있게 둔다 — [저장 안 함]을 잘못 누르면 한 시간 고친 것이 사라진다. 버린 수를 돌려준다.
 */
export function discardFloors(keys: string[]): number {
  const m = model.value
  if (!m || !pristine || !baseline.value || !keys.length) return 0
  const file = exportEdits(m, baseline.value, fileName.value)
  const n = unsavedCount(keys, splitByStorey(file, homeOf))
  replaceParts(new Map(keys.map((k) => [k, savedParts.value.get(k) ?? null])), '저장 안 함')
  setAutosaveArmed(false)
  if (editCount(file) > 0) draft.value = { file, count: editCount(file), savedAt: file.savedAt }
  return n
}

/** 연 때(pristine)의 모델로 되돌린다. 저장 안 함과, 8084 저장본을 얹은 뒤 임시 저장을 되살릴 때가 쓴다. */
export function resetToOpened() {
  if (!pristine) return
  meshesToOpened()
  const opened = structuredClone(pristine)
  ruleReport.value = inferFlowByRules(opened)
  model.value = opened
  changes.value = []
  areaChanges.value = []
  confirmations.value = []
  storeyMoved.value = new Set()
  positionDrafts.value = new Map()
  history.value = []
  future.value = []
  selectedId.value = null
  selectedSpaceId.value = null
  selectedElementId.value = null
  setAutosaveArmed(false)
  savedSig = null
  flowVersion.value++
  redraw()
}

export const draftTime = computed(() => {
  const d = draft.value
  if (!d) return ''
  const t = new Date(d.savedAt)
  const today = new Date().toDateString() === t.toDateString()
  return today
    ? `오늘 ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
    : `${t.getMonth() + 1}월 ${t.getDate()}일 ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupExitEdit() {
  watch(baseline, () => (savedSig = null))
}
