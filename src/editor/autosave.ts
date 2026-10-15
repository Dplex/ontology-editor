import { ref, shallowRef, watch } from 'vue'
import { countEdits, type EditFile, exportEdits, parseEditFile } from '../lib/edit-file'
import { replayOpen } from '../lib/replay-player'
import { type HomeOf, partSig, splitByStorey } from '../lib/storey-drafts'
import { baseline, changeCount } from './changes'
import { fileName, mode, model } from './core'
import { editSig, resetToOpened } from './exit-edit'
import { flowVersion } from './flow-rules'
import { history } from './history'
import { discardAsk } from './layout-storeys'
import { viewStorey } from './multi-view'
import { pristine } from './open-file'
import { applyEditFile } from './progress'
import { committedSig, openedProject } from './projects'

// --- 자동 저장 (OE-HIST-04) -------------------------------------------------------------------
//
// 편집은 탭 안에만 있어서 브라우저가 죽거나 PC 가 다시 켜지면 사라졌다(창 닫기는 묻지만 그 밖은 못 막는다). 편집할
// 때마다 "편집 저장" 과 같은 파일(lib/edit-file.ts)을 브라우저 `oe-autosave:<파일 이름>` 에 적어 둔다. 같은 IFC 를 다시 열었을 때
// 임시 저장본·8084 저장본으로 돌아오는 상태와 다르면 이어서 할지 묻는다. 되살리기도 편집 파일 불러오기와 같은 길이다 — 값을
// 덮지 않고 편집 함수에 다시 넣는다.
//
// 임시 저장(아래, 층마다)과 자리가 다르다. 임시 저장은 사람이 [임시 저장] 을 누른 층만, 자동 저장은 마지막 상태 전부다.
// 열자마자 지우면 안 된다. 연 직후에는 바뀐 것이 0 이라, 그대로 저장하면 되살릴 기록을 지운다. 사람이 편집을
// 시작하거나 되살린 뒤부터 적는다.
const AUTOSAVE_PREFIX = 'oe-autosave:'
/** 되살릴 수 있는 편집 — 자동 저장에 남은 것이나 [저장 안 함] 으로 버린 것. 위 줄의 자동 저장 질문([예]·[아니오], OE-HIST-04)이 쓴다. */
export const draft = shallowRef<{ file: EditFile; count: number; savedAt: string } | null>(null)
export let autosaveArmed = false
export function setAutosaveArmed(v: typeof autosaveArmed) {
  autosaveArmed = v
}
let autosaveTimer: number | undefined
export const autosaveKey = () => AUTOSAVE_PREFIX + (openedProject.value ? `${openedProject.value.id}:` : '') + fileName.value
/** 층 완료를 누르거나 지운 횟수(OE-MAN-06). 완료 표시는 되돌리기 이력에 들지 않아, 자동 저장·저장 안 한 편집 판정이 이것도 본다. */
export const progressVersion = ref(0)
export const editCount = countEdits
export const editsIn = (part: EditFile | undefined) => (part ? editCount(part) : 0)

export function restoreDraft() {
  const d = draft.value
  if (!d) return
  draft.value = null
  mode.value = 'edit'
  // 되살릴 편집은 연 때 기준의 편집 전부다. 8084 저장본·임시 저장본을 이미 얹었으면 걷고 얹는다 — 안 그러면 더한 설비가 두 번 생긴다.
  resetToOpened()
  applyEditFile(d.file, '자동 저장')
  // 모든 층의 편집이 들어왔으니 층에 들어갈 때 임시 저장본을 다시 얹지 않는다.
  for (const k of floorDrafts.keys()) appliedFloors.add(k)
}
export function discardDraft() {
  draft.value = null
  try {
    localStorage.removeItem(autosaveKey())
  } catch {
    // 못 지워도 다음 편집이 덮는다
  }
}

// --- 임시 저장 — 층마다 하나 (OE-COM-08 · OE-WF-01~03) -----------------------------------------------
//
// [임시 저장] 은 지금 층의 편집을 이 브라우저 `oe-draft:<파일 이름>@<층 id>` 에 남긴다. 층마다 하나고, 다시 누르면 덮는다(목록은
// 두지 않는다). 웹(8084)에는 올리지 않는다. 임시 저장본이 있는 층에 편집 모드로 들어가면 묻지 않고 얹어 이어서 편집한다(OE-WF-02).
// 층이 없는 편집(계통·종류·방향·잇기)은 건물 조각(`@*`)이라 어느 층에서 임시 저장해도 같이 남고, 어느 층에 들어가도 같이 얹힌다
// (lib/storey-drafts.ts).
//
// 얹기는 늘 "지금 편집 전부에서 그 층 조각만 갈아 끼워 연 때부터 다시 얹기" 다. 8084 저장본을 얹은 위에 연 때 기준 편집을 또 얹으면
// 더한 설비가 두 번 생긴다. 다시 얹으면 되돌리기 이력은 비워진다(불러온 편집과 같다).
//
// 저장하지 않은 편집이 있는 층에서 다른 층으로 가려 하면 묻는다 — 임시 저장 / 저장 안 함 / 취소(편집 종료와 같은 대화상자).
const DRAFT_PREFIX = 'oe-draft:'
// 프로젝트로 연 판은 프로젝트 id 를 붙인다. 같은 IFC 로 만든 다른 프로젝트가 이 브라우저의 임시 저장본을 얹지 않게 한다(OE-UI-02 AC4).
export const draftKey = (storeyKey: string) => `${DRAFT_PREFIX}${openedProject.value ? `${openedProject.value.id}:` : ''}${fileName.value}@${storeyKey}`
/** 연 때의 층. 층 조각을 가르는 기준이다. */
export let homeOf: HomeOf = () => null
/** 이 파일의 층별 임시 저장본(브라우저에서 읽은 것). 열쇠는 층 id 또는 BUILDING. */
export let floorDrafts = new Map<string, EditFile>()
export function setFloorDrafts(v: typeof floorDrafts) {
  floorDrafts = v
}
/** 이미 얹은 임시 저장본의 열쇠. */
export const appliedFloors = new Set<string>()
/** floorDrafts 가 바뀔 때 올린다(화면의 [임시 저장본 폐기] 가 본다). */
export const draftsVersion = ref(0)
/** 지금 반영된 레이아웃의 편집 파일(src/server/layouts.ts). 폐기하면 그 층을 이것으로 돌린다. 반영 전이면 null(BIM 그대로). */
export const publishedFile = shallowRef<EditFile | null>(null)
/** 조각마다 마지막으로 저장(임시 저장·8084·파일·구축하기)한 것. 저장 안 한 편집과 [저장 안 함] 이 이것과 견준다. */
export const savedParts = shallowRef(new Map<string, EditFile>())
/** 열기(8084 저장본 얹기까지)가 끝났는가. 그 전에 임시 저장본을 얹으면 저장본과 겹친다. */
export let openSettled = false
export function setOpenSettled(v: typeof openSettled) {
  openSettled = v
}

export function currentParts(): Map<string, EditFile> {
  const m = model.value
  if (!m || !baseline.value) return new Map()
  return splitByStorey(exportEdits(m, baseline.value, fileName.value), homeOf)
}
/** 마지막 저장 뒤 바뀐 조각의 열쇠(층 id 또는 BUILDING). */
export function dirtyKeys(parts = currentParts()): string[] {
  const keys = new Set([...parts.keys(), ...savedParts.value.keys()])
  return [...keys].filter((k) => partSig(parts.get(k)) !== partSig(savedParts.value.get(k)))
}
/** 저장 안 한 편집 수(근사 — 조각마다 지금 편집 수에서 저장한 편집 수를 뺀다). */
export function unsavedCount(keys: string[], parts = currentParts()): number {
  return Math.max(1, keys.reduce((n, k) => n + Math.max(0, editsIn(parts.get(k)) - editsIn(savedParts.value.get(k))), 0))
}
/** 지금 편집하는 층. 한 층을 보고 있으면 그 층, "모든 층" 이거나 층이 하나면 전부다. */
export function floorsInView(): string[] {
  const m = model.value
  if (!m) return []
  return viewStorey.value ? [viewStorey.value] : m.storeys.map((st) => st.id)
}
export const floorName = (id: string | null) => (id ? (model.value?.storeys.find((st) => st.id === id)?.name ?? id) : '모든 층')

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupAutosave() {
  watch(baseline, () => (progressVersion.value = 0))
  watch(baseline, () => {
    autosaveArmed = false
    draft.value = null
  })
  // 되돌리기 이력이 늘면 사람이 편집한 것이다. 남아 있던 기록은 이 편집으로 바뀐다.
  watch(
    () => history.value.length,
    (n, was) => {
      if (n > (was ?? 0)) {
        autosaveArmed = true
        draft.value = null
      }
    },
  )
  // 리플레이 동안은 바뀐 것 수(연 때와 모델 전체 비교)도 세지 않는다 — 감시 대상만 읽어도 장면마다 계산이 돈다.
  watch([() => (replayOpen.value ? -1 : changeCount.value), flowVersion, () => history.value.length, progressVersion, replayOpen], () => {
    // 편집 리플레이는 되돌리기·다시 하기를 잇달아 한다. 그 사이 상태는 남길 것이 아니고, 장면마다 편집 파일을 쓰면 화면이 끊긴다.
    // 닫으면(replayOpen 이 바뀌면) 연 때 상태로 한 번 남긴다.
    window.clearTimeout(autosaveTimer)
    if (!autosaveArmed || replayOpen.value) return
    autosaveTimer = window.setTimeout(() => {
      const m = model.value
      if (!m || !baseline.value) return
      try {
        const file = exportEdits(m, baseline.value, fileName.value)
        // 마지막으로 저장(8084·파일·구축하기)한 것과 같으면 남길 것이 없다.
        if (editCount(file) > 0 && editSig(file) !== committedSig) localStorage.setItem(autosaveKey(), JSON.stringify(file))
        else localStorage.removeItem(autosaveKey())
      } catch {
        // 저장소가 차거나 막혀 있으면 이번 창에서만 산다. "편집 저장" 으로 내려받는 길은 그대로다.
      }
    }, 600)
  })
  // 층 바꾸기를 묻는 감시(아래)가 새 파일의 첫 층 고르기를 물음으로 잡지 않게, 파일이 바뀌는 순간 바로 내린다.
  watch(baseline, () => (openSettled = false), { flush: 'sync' })
  watch(baseline, (b) => {
    floorDrafts = new Map()
    draftsVersion.value++
    discardAsk.value = false
    appliedFloors.clear()
    savedParts.value = new Map()
    if (!b) return
    const home = new Map<string, string>()
    for (const st of (pristine ?? model.value)?.storeys ?? []) for (const x of [...st.spaces, ...st.equipment, ...st.walls, ...st.openings]) home.set(x.id, st.id)
    homeOf = (id) => home.get(id) ?? null
    try {
      const prefix = draftKey('')
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k?.startsWith(prefix)) continue
        const file = parseEditFile(localStorage.getItem(k) ?? '')
        if (typeof file !== 'string') floorDrafts.set(k.slice(prefix.length), file)
      }
    } catch {
      // 브라우저 저장소를 못 읽으면 얹을 임시 저장본도 없다.
    }
  })
}
