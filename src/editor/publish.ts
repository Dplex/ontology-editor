import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { DEFAULT_LINES, GATE, type GradeLines, gradeReport, type GradeReport } from '../lib/grade'
import { josa } from '../lib/josa'
import { blockingOf, preBuildChecks } from '../lib/pre-build'
import { useReplay } from '../lib/replay-player'
import { BUILDING } from '../lib/storey-drafts'
import { currentParts, dirtyKeys, floorName, floorsInView } from './autosave'
import { baseline, changeCount } from './changes'
import { openDataSet } from './chat-view'
import { editing, mode, model } from './core'
import { note } from './keyboard'
import { editNotice } from './multi-select'
import { viewStorey } from './multi-view'
import { pristineCounts } from './open-file'
import { asMe, me, people } from './people'
import { ontologyFloors, openedSources, serverKey } from './projects'

// --- 반영하기·버전 (OE-WF-10~13·18~20, OE-GEN-05, server/layouts.ts) ------------------------------------
// data/ 에서 연 건물은 [구축하기](첫 반영 = v1)·[반영하기] 가 서버에 새 버전을 만든다. 반영된 것은 서버의 현재 버전 폴더다(DT·온톨로지 대신).
// 손으로 연 파일은 서버 열쇠가 없어 예전처럼 두 파일을 내려받는다.

type LayoutVersion = { version: number; at: string; by: string; floors: string[]; summary: { edits?: number }; kind: 'publish' | 'rollback'; from?: number; files: string[] }
export const layoutState = ref<{ current: number | null; versions: LayoutVersion[] } | null>(null)
export const layoutsUrl = (q: Record<string, string>) => `./__data/__layouts?${new URLSearchParams(q)}`
export async function refreshLayouts() {
  const key = serverKey.value
  if (!key) return void (layoutState.value = null)
  try {
    const r = await fetch(layoutsUrl({ key }))
    if (key === serverKey.value) layoutState.value = r.ok ? await r.json() : null
  } catch {
    layoutState.value = null
  }
}

// --- 시스템 로그 (OE-COM-04, server/activity-log.ts) ---
// 편집 시작·종료·임시 저장은 화면만 안다. 반영·되돌리기·저장은 서버가 적는다. 보내다 실패해도 편집은 막지 않는다.
export function logActivity(type: 'edit-start' | 'edit-end' | 'draft', floors: string[] = []) {
  const key = serverKey.value
  if (!key || !people.value || !me.value) return
  void fetch('./__data/__log', { method: 'POST', headers: asMe(), body: JSON.stringify({ type, key, floors }) }).catch(() => {})
}
export const activity = ref<{ at: string; type: string; user: string; floors: string[]; version?: number }[]>([])
async function refreshActivity() {
  const key = serverKey.value
  if (!key) return void (activity.value = [])
  try {
    const r = await fetch(`./__data/__log?${new URLSearchParams({ key })}`)
    activity.value = r.ok ? (await r.json()).slice(0, 10) : []
  } catch {
    activity.value = []
  }
}
export const ACTIVITY_LABEL: Record<string, string> = { 'edit-start': '편집 시작', 'edit-end': '편집 종료', draft: '임시 저장', save: '편집 저장', publish: '레이아웃 반영', rollback: '레이아웃 되돌리기' }

// --- 새 레이아웃 배너·알림 (OE-WF-14~17) ---
// 다른 사람이 반영해도 이 화면은 바뀌지 않는다(WF-14). 서버의 현재 버전을 30초마다·창으로 돌아올 때 보고, 이 화면이 연 버전보다 새것이면 상단 배너를
// 띄운다(WF-15). [새로고침] 은 같은 파일을 다시 열어 새 버전을 얹는다. GNB 알림 대신 앱 위의 [알림] 목록에 반영·되돌리기를 모은다(WF-16).

/** 이 화면이 얹은 반영 버전. 반영 전이면 null. */
export const loadedVersion = ref<number | null>(null)
/** 서버의 현재 버전이 이 화면보다 새것이면 그 버전. */
export const newerLayout = computed(() => {
  const st = layoutState.value
  const cur = st?.current ? st.versions.find((v) => v.version === st.current) : null
  return cur && cur.version > (loadedVersion.value ?? 0) ? cur : null
})
type Notice = { at: string; type: string; user: string; key: string; floors: string[]; version?: number }
export const notices = ref<Notice[]>([])
export const noticesOpen = ref(false)
const noticesSeen = ref(
  (() => {
    try {
      return localStorage.getItem('oe.noticesSeen') ?? ''
    } catch {
      return ''
    }
  })(),
)
export const unseenNotices = computed(() => notices.value.filter((n) => n.at > noticesSeen.value).length)
export function openNotices() {
  noticesOpen.value = !noticesOpen.value
  const last = notices.value[0]?.at
  if (noticesOpen.value && last) {
    noticesSeen.value = last
    try {
      localStorage.setItem('oe.noticesSeen', last)
    } catch {
      // 못 남기면 다음에 또 새것으로 보인다
    }
  }
}
async function pollLayouts() {
  if (serverKey.value) await refreshLayouts()
  if (!people.value) return
  try {
    const r = await fetch('./__data/__log')
    if (r.ok) notices.value = ((await r.json()) as Notice[]).filter((n) => n.type === 'publish' || n.type === 'rollback').slice(0, 20)
  } catch {
    // 다음에 다시 본다
  }
}
let layoutPoll: number
const onFocusPoll = () => void pollLayouts()
/** [새로고침]: 같은 파일을 다시 열어 새 버전을 얹는다. 저장하지 않은 편집이 있으면 먼저 저장하게 한다. */
export function reloadLayout() {
  const unsaved = dirtyKeys(currentParts()).length
  if (unsaved) return note(`저장하지 않은 편집이 ${unsaved}개 층에 있습니다. [임시 저장] 이나 [편집 저장] 을 한 뒤 새로고침하세요`)
  const paths = openedSources.value.filter((p): p is string => !!p)
  if (paths.length) openDataSet(paths)
}

// --- 층 잠금 (OE-COM-05·06, server/floor-state.ts) ---
// 편집 중인 층(한 층을 보면 그 층, "모든 층" 이면 전부)을 잡는다. 1분마다 다시 잡아 늘이고, [편집 종료]·층 바꾸기·창 닫기 때 푼다. 남이 잡은 층이면
// 보기로 돌리고 "OOO님이 편집 중입니다" 를 보인다. 사람 목록이 없는 곳은 잠그지 않는다.
const heldLocks = new Map<string, { key: string; floor: string }>()
const lockUrl = (key: string, floor: string) => `./__data/__locks?${new URLSearchParams({ key, floor })}`
function releaseLocks(keep: (l: { key: string; floor: string }) => boolean = () => false) {
  for (const [id, l] of [...heldLocks]) {
    if (keep(l)) continue
    heldLocks.delete(id)
    void fetch(lockUrl(l.key, l.floor), { method: 'DELETE', headers: asMe(), keepalive: true }).catch(() => {})
  }
}
let lockRun = 0
async function syncLocks() {
  const key = serverKey.value
  const run = ++lockRun
  if (!key || !people.value || !me.value || !editing.value || !model.value) return releaseLocks()
  // 보는 층과, [그대로 이동]으로 떠났지만 저장 안 한 편집이 남은 층(OE-UI-04 AC10)을 쥔다. 남이 그 층을 고쳐 편집이 겹치지 않게 한다.
  const want = [...new Set([...floorsInView(), ...dirtyKeys().filter((k) => k !== BUILDING)])]
  releaseLocks((l) => l.key === key && want.includes(l.floor))
  for (const floor of want) {
    let r: Response
    try {
      r = await fetch(lockUrl(key, floor), { method: 'PUT', headers: asMe() })
    } catch {
      return
    }
    if (run !== lockRun) return
    if (r.status === 409) {
      const by = ((await r.json().catch(() => ({}))) as { by?: string }).by ?? '다른 사람'
      releaseLocks()
      mode.value = 'view'
      // 모드가 바뀌면 편집 경고를 지우는 감시가 있어, 그 뒤에 띄운다.
      const why = `${by}님이 ${floorName(floor)}${josa(floorName(floor), '을/를')} 편집 중입니다. 그 층은 보기만 합니다. 편집이 끝나면 들어갈 수 있습니다`
      window.setTimeout(() => (editNotice.value = why))
      return
    }
    if (r.ok) heldLocks.set(`${key}\n${floor}`, { key, floor })
  }
}
let lockTimer: number
const onPageHide = () => releaseLocks()
/** 첫 반영이면 [구축하기](v1), 아니면 [반영하기]. */
export const firstPublish = computed(() => !layoutState.value?.current)

// --- 등급 판정·수용 기준선 (OE-REQ-04 · OE-BIM-21 · OE-GEN-02, ADR-0040) ---
// D1·D12 제안안(lib/grade.ts). 게이트(등급 0~3) 미달이면 [구축하기] 를 끄고 재제출 항목을 보인다. 운영 편집의 [반영하기] 는 막지 않는다(이미 만든 온톨로지).
// 기준값은 브라우저 설정이고 비우면 1.8 의 안이다. 편집마다 다시 재면 큰 파일에서 느려서, 편집이 멈춘 뒤 한 번 잰다.
export const gradeLines = ref<GradeLines>(
  (() => {
    try {
      return { ...DEFAULT_LINES, ...(JSON.parse(localStorage.getItem('oe.gradeLines') ?? 'null') ?? {}) }
    } catch {
      return { ...DEFAULT_LINES }
    }
  })(),
)
export const grades = shallowRef<GradeReport | null>(null)
let gradeTimer: number | undefined
export const gradesOpen = ref(false)
/** [구축하기] 를 막는 이유(게이트 미달). 반영한 버전이 있으면(운영 편집) 막지 않는다. */
export const buildBlock = computed(() => {
  // 생성 전 검증의 차단 항목(OE-GEN-03 — 한 층 안 방번호 중복, 물리존 없는 층)은 구축·반영 모두 막는다. 경고는 막지 않고 리포트 ⑩ 에 남는다.
  const m = model.value
  const blocks = m ? blockingOf(preBuildChecks(m, [])) : []
  if (blocks.length) return `생성 전 검증에서 막혔습니다 — ${blocks.map((x) => x.detail).join(' · ')}`
  const g = grades.value
  if (!g || g.gate || (serverKey.value && !firstPublish.value)) return null
  const nameHint = g.failing.some((r) => r.why?.startsWith('층 이름')) ? ' 층 이름은 [층별 요약] 에서 넣을 수 있습니다.' : ''
  return `수용 기준선(게이트 등급 0~${GATE}) 미달이라 구축하지 않습니다 — ${g.failing.map((r) => `등급 ${r.grade} ${r.label} ${r.why}`).join(', ')}. 재제출 항목을 보세요.${nameHint}`
})
export function resetGradeLines() {
  gradeLines.value = { ...DEFAULT_LINES }
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupPublish() {
  watch(serverKey, () => void refreshLayouts(), { immediate: true })
  watch(editing, (on, was) => {
    if (on === was) return
    const st = model.value?.storeys.find((x) => x.id === viewStorey.value)
    logActivity(on ? 'edit-start' : 'edit-end', st ? [st.name] : [])
  })
  watch(layoutState, () => void refreshActivity())
  watch(baseline, () => {
    loadedVersion.value = null
    ontologyFloors.value = null
  })
  layoutPoll = window.setInterval(() => void pollLayouts(), 30_000)
  window.addEventListener('focus', onFocusPoll)
  onBeforeUnmount(() => {
    window.clearInterval(layoutPoll)
    window.removeEventListener('focus', onFocusPoll)
  })
  watch(people, () => void pollLayouts())
  watch([editing, viewStorey, serverKey, me], () => void syncLocks())
  lockTimer = window.setInterval(() => {
    if (heldLocks.size) void syncLocks()
  }, 60_000)
  window.addEventListener('pagehide', onPageHide)
  onBeforeUnmount(() => {
    window.clearInterval(lockTimer)
    window.removeEventListener('pagehide', onPageHide)
    releaseLocks()
  })
  watch(gradeLines, (v) => {
    try {
      localStorage.setItem('oe.gradeLines', JSON.stringify(v))
    } catch {
      // 못 남겨도 이번 창에서는 그대로다
    }
  }, { deep: true })
  // 기준값은 글로 바꿔 본다. `deep` 으로 보면 모델(shallowRef)까지 통째로 훑어 성수에서 편집마다 느려졌다.
  watch(
    [model, changeCount, () => JSON.stringify(gradeLines.value)],
    () => {
      window.clearTimeout(gradeTimer)
      gradeTimer = window.setTimeout(() => (grades.value = model.value ? gradeReport(model.value, gradeLines.value, pristineCounts()) : null), grades.value ? 300 : 0)
    },
    { immediate: true },
  )
}
