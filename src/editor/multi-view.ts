import { computed, ref, watch } from 'vue'
import { isConduit, type Model } from '../lib/model'
import { baseline } from './changes'
import { activeTab } from './context-menu'
import { editing, model } from './core'
import { future, history } from './history'
import { note } from './keyboard'
import { editNotice } from './multi-select'
import { pipeHandoff, setPipeHandoff } from './pipe-handoff'
import { commitWork, newWorkId, serverKey, setWork, uncommitted, work } from './projects'
import { viewer } from './scene'
import { drawing } from './space-objects'
import { multiView, selectedVertical, selectedVerticalId } from './vertical'

// --- 다중층 뷰 (OE-ML-01 보기 부분) -----------------------------------------------------
//
// 여러 층을 함께 보는 화면이다. 들어가는 길은 ① 층 고르는 칸 옆 [다중층 뷰에서 편집](범위는 지금 층과 위층, 고쳐 고른다) ② 수직 관통
// 오브젝트 패널의 [다중층 뷰에서 편집](그 오브젝트의 관통 층). ③ 배관 그리기 중 전환은 층간 배관(OE-PIP-15)과 같이 한다.
// **보기 범위는 오브젝트의 관통 구간과 따로다** — 범위를 바꿔도 데이터는 그대로다. 편집 중에 들어가고 나오는 것은 다중층 세션(작업)의
// 경계다(위 "작업" 절): 들어가기 전에 층 편집을, 나올 때 세션을 8084 에 저장한다. 보기 범위 자체는 화면 상태라 저장하지 않는다.
export const storeysByHeight = computed(() => [...(model.value?.storeys ?? [])].sort((a, b) => a.elevation - b.elevation))
/** 보기 범위의 층(높이 순). 시작·끝을 거꾸로 골라도 그 사이다. */
export const multiRange = computed(() => {
  const v = multiView.value
  if (!v) return null
  const list = storeysByHeight.value
  let i = list.findIndex((st) => st.id === v.from)
  let j = list.findIndex((st) => st.id === v.to)
  if (i < 0 || j < 0) return null
  if (i > j) [i, j] = [j, i]
  return list.slice(i, j + 1)
})
/** 층 바닥 높이(cm 까지). 병원 1층은 -1e-13 이라 그대로 쓰면 "-0.00" 이 된다. */
export const elevationText = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2)
/**
 * 다중층 뷰를 연다. 범위를 안 주면 지금 층과 바로 위층(맨 위층이면 아래층), 층을 안 골랐으면 전체다. 편집 중에 들어가면 다중층 세션(작업)을
 * 시작한다 — 층 편집을 먼저 저장하고, 못 하면 열지 않고 false 다.
 */
export async function openMultiView(from?: string, to?: string): Promise<boolean> {
  const list = storeysByHeight.value
  if (list.length < 2) return false
  if (!multiView.value && !(await beginMultiSession())) return false
  if (!from || !to) {
    const i = list.findIndex((st) => st.id === viewStorey.value)
    if (i < 0) [from, to] = [list[0].id, list.at(-1)!.id]
    else [from, to] = i + 1 < list.length ? [list[i].id, list[i + 1].id] : [list[i - 1].id, list[i].id]
  }
  multiView.value = { from, to, back: multiView.value?.back ?? viewStorey.value }
  activeTab.value = '3d'
  editNotice.value = ''
  viewer?.frameAll()
  return true
}
/** 다중층 세션을 시작한다(OE-HIST-03). 저장 안 한 층 편집을 층 작업으로 저장한 뒤 새 작업 id 를 잡고 되돌리기 이력을 비운다. */
let sessionBusy = false
async function beginMultiSession(): Promise<boolean> {
  if (!editing.value || !serverKey.value) return true
  if (sessionBusy) return false
  sessionBusy = true
  try {
    if (uncommitted() && !(await commitWork('다중층 뷰로 가지 않았습니다. 층 편집은 그대로입니다.'))) {
      note('층 편집을 서버에 저장하지 못해 다중층 뷰로 가지 않았습니다. 편집은 그대로입니다')
      return false
    }
    setWork({ id: newWorkId(), kind: 'multi' })
    history.value = []
    future.value = []
    return true
  } finally {
    sessionBusy = false
  }
}
/** 고른 수직 관통 오브젝트의 관통 층으로 연다(진입 경로 ②). 고른 조각은 그대로다. */
export function openMultiViewFor(objectParts: readonly { storey: { id: string } }[]) {
  openMultiView(objectParts[0].storey.id, objectParts.at(-1)!.storey.id)
}
export function setMultiAll() {
  const list = storeysByHeight.value
  if (multiView.value && list.length) multiView.value = { ...multiView.value, from: list[0].id, to: list.at(-1)!.id }
}
/**
 * 층 편집으로 돌아간다. 들어오기 전에 보던 층이다. 고른 계단 조각이 그 층에 없으면 푼다. 다중층 세션이었으면 세션의 편집을 그 작업으로
 * 저장한 뒤 돌아가고, 못 하면 다중층 뷰에 남는다(편집·세션 그대로).
 */
export async function closeMultiView() {
  if (sessionBusy) return
  if (work?.kind === 'multi') {
    sessionBusy = true
    try {
      if (editing.value && serverKey.value && uncommitted() && !(await commitWork('다중층 뷰에 남았습니다.'))) {
        note('다중층 작업을 서버에 저장하지 못해 다중층 뷰에 남았습니다. 편집은 그대로이고, [층 편집으로] 를 다시 누르면 다시 저장합니다')
        return
      }
    } finally {
      sessionBusy = false
    }
    setWork(null)
    history.value = []
    future.value = []
  }
  // 그리던 배관을 들고 왔으면(진입 경로 ③) 옮기기 전의 그리기로 되돌린다.
  const handoff = pipeHandoff
  if (handoff && drawing.value?.purpose === 'pipe' && drawing.value.levels) {
    setPipeHandoff(null)
    drawing.value = handoff
    viewer?.setPlaceMode(handoff.elevation)
    note(`층 편집으로 돌아왔습니다. 그리던 배관(꺾임점 ${handoff.points.length}개)을 이어서 찍습니다`)
  }
  const back = multiView.value?.back ?? null
  multiView.value = null
  viewStorey.value = back && model.value?.storeys.some((st) => st.id === back) ? back : viewStorey.value
  if (selectedVertical.value && viewStorey.value && selectedVertical.value.storey.id !== viewStorey.value) selectedVerticalId.value = null
}

// --- 층별로 보기 ---------------------------------------------------------------------
//
// 층이 여럿이면 3D 에 전부 겹쳐 그려져, 아래층 설비는 위층 판과 배관에 가려 누르기도 끌기도 어려웠다. 한 층만 남긴다.
// 다른 층의 것을 표·목록에서 고르면 그 층으로 따라간다 — 고른 것이 안 보이면 고른 줄 모른다.
export const viewStorey = ref<string | null>(null)
/**
 * 파일을 열면 처음 볼 층(OE-UI-12). PRD 는 "3D는 한 층만, 전체 빌딩 뷰는 미리보기 Phase 2" 다. "모든 층" 은 남겨 두되(층을 넘는
 * 덕트·배관을 한눈에 볼 곳이 여기뿐이다) 처음에는 **방이 있는 가장 낮은 층**을 연다 — 기초(T/FDN·TOF Footing)는 방이 없다.
 * 방이 없는 파일(설비만)은 설비가 놓인 가장 낮은 층, 그것도 없으면 맨 아래 층. 층이 하나면 고를 것이 없다.
 */
function firstStorey(m: Model | null): string | null {
  if (!m || m.storeys.length <= 1) return null
  const st =
    m.storeys.find((s) => s.spaces.length > 0) ?? m.storeys.find((s) => s.equipment.some((e) => e.position && !isConduit(e.role))) ?? m.storeys[0]
  return st.id
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupMultiView() {
  // 새 파일을 열면 다중층 뷰와 고른 계단 조각을 푼다. 같은 BIM 을 다시 열면 조각 id(GUID)가 같아 고른 채 남았고, 그 계단을 누르면
  // "고른 조각을 다시 누르기" 로 쳐서 아래 계단실이 골라졌다.
  watch(baseline, () => {
    multiView.value = null
    selectedVerticalId.value = null
  })
  // 다중층 뷰는 3D 의 설비 끌기·물리존 손잡이를 끄고, 수직 관통 오브젝트 조각의 손잡이만 끌게 한다(OE-ML-07).
  watch([multiView, editing], () => {
    viewer?.setEditMode(editing.value && !multiView.value)
    viewer?.setHandleEdit(editing.value && !!multiView.value)
  })
  watch(baseline, () => (viewStorey.value = firstStorey(model.value)))
}
