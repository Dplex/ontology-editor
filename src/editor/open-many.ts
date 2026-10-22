import { computed, nextTick, ref, watch } from 'vue'
import { modelToGeoJSON } from '../lib/export/geojson'
import { previewSummary, publishBrief, summaryText } from '../lib/preview'
import { DEFAULT_SITE_RULES, type SiteRules, siteWarnings } from '../lib/site-rules'
import { currentParts, dirtyKeys } from './autosave'
import { openedDataPath } from './chat-view'
import { dragging, error, fileName, model } from './core'
import { report } from './edit-report'
import { committed } from './exit-edit'
import { isIdf } from './idf-zones'
import { note } from './keyboard'
import { assignLines } from './kinds'
import { loadingPath, setLoadingPath, settleOpen } from './layout-storeys'
import { storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { append, canAppend, load, pristine } from './open-file'
import { batch } from './progress'
import { loadServerEdits, serverKey } from './projects'
import { sceneVersion } from './redraw'
import { publishAsk } from './reports'
import { exportTTL } from './storey-progress'
import { multiView } from './vertical'

// --- 여러 파일 한 번에 ---------------------------------------------------------------
//
// 실제 프로젝트는 건축·설비가 다른 IFC 다. 예전에는 하나를 열고 도구막대의 [덧붙이기] 를 찾아 다른 하나를 골라야 했고,
// 둘을 같이 끌어다 놓으면 첫 파일만 열리고 나머지는 **조용히** 버려졌다. 이제 같이 고르거나 같이 놓으면 하나를 열고
// 나머지를 덧붙인다. 어느 것을 먼저 열든 방을 더 그린 쪽이 기준이라(append) 순서는 결과를 바꾸지 않는다. IDF 는 층·방이
// 다 선 뒤에 얹어야 방을 찾으므로 IFC 뒤로 보낸다.
/** `dataPath` 는 data/ 목록에서 연 파일의 경로다. 손으로 고른 파일은 없다 — 8084 에 저장할 수 없다(saved-edits.ts). */
type FileSource = { name: string; read: () => Promise<ArrayBuffer>; dataPath?: string }
export async function openMany(files: readonly FileSource[], into: 'open' | 'append') {
  const ordered = [...files.filter((f) => !isIdf(f.name)), ...files.filter((f) => isIdf(f.name))]
  if (!ordered.length) return
  let rest = ordered
  const mark = (f: FileSource) => {
    if (ordered.length > 1) batch.value = { index: ordered.indexOf(f) + 1, total: ordered.length, name: f.name }
  }
  try {
    if (into === 'open' || !model.value) {
      mark(ordered[0])
      setLoadingPath(ordered[0].dataPath ?? null)
      await load(ordered[0].name, ordered[0].read)
      // 편집이 남아 열기를 물리쳤거나 읽지 못했으면 멈춘다.
      if (!model.value || fileName.value !== ordered[0].name || error.value) return
      rest = ordered.slice(1)
      // 작업 화면은 맨 위(3D)부터 보인다. data/ 목록 아래쪽의 [열기] 를 누르면 그 스크롤 자리 그대로 열려, 3D 가 화면 위로
      // 밀려나고 요약·검사 표부터 보였다.
      window.scrollTo({ top: 0 })
    }
    for (const f of rest) {
      mark(f)
      setLoadingPath(f.dataPath ?? null)
      await append(f.name, f.read)
      if (error.value) return
    }
    // data/ 에서 열었으면 8084 에 저장된 편집을 얹는다. 덧붙이기만 했을 때는 얹지 않는다 — 이미 고친 것 위에 다른 판의 편집이 겹친다.
    if (into === 'open' && serverKey.value) await loadServerEdits()
  } finally {
    batch.value = null
    settleOpen()
  }
}
export const sourcesOf = (list: FileList | null | undefined): FileSource[] =>
  Array.from(list ?? [], (file) => ({ name: file.name, read: () => file.arrayBuffer() }))

export function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = sourcesOf(input.files)
  openedDataPath.value = null
  void openMany(files, 'open')
  // 같은 파일을 다시 고를 수 있게 비운다. 편집이 남아 열기를 물리친 뒤 같은 파일을 다시 고르면 change 가 안 온다.
  input.value = ''
}

export function onDrop(event: DragEvent) {
  dragging.value = false
  openedDataPath.value = null
  void openMany(sourcesOf(event.dataTransfer?.files), 'open')
}

/** [덧붙이기] 에 끌어다 놓기. [열기] 에 놓으면 열려 있던 것을 바꾸므로, 합치려면 여기에 놓는다. */
export function onAppendDrop(event: DragEvent) {
  appendOver.value = false
  if (canAppend.value) void openMany(sourcesOf(event.dataTransfer?.files), 'append')
}
export const appendOver = ref(false)

/** `data` 가 배열이면 조각을 이어 붙인다 — 한 덩어리로 만들면 한도를 넘는 큰 파일(성수 OBJ 683MB)용이다. */
export function download(name: string, data: string | ArrayBuffer | ArrayBuffer[], mime: string) {
  const url = URL.createObjectURL(new Blob(Array.isArray(data) ? data : [data], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // 클릭 직후에 풀면 브라우저에 따라 받기가 시작되기 전에 끊긴다(큰 파일일수록). 받기가 시작될 틈을 둔다.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 폴더를 골라 파일 여럿을 한 번에 쓰는 브라우저 기능(크롬·엣지). 없으면 undefined. */
type DirectoryPicker = (options: { mode: 'readwrite' }) => Promise<{
  getFileHandle(name: string, options: { create: true }): Promise<{ createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }> }>
}>

/**
 * GeoJSON 은 층마다 한 파일이다(성수 19개). 연달아 내려받으면 크롬이 "여러 파일 다운로드"를 묻고, 거절하거나 창을
 * 놓치면 둘째 파일부터 **조용히** 빠진다. 폴더를 고를 수 있으면 한 폴더에 한꺼번에 쓰고, 못 하면 내려받는다.
 */
// 내보내기·저장이 끝나면 누른 단추에 잠깐 ✓ 를 띄운다. 받기 표시는 브라우저 구석에 떠서, 눌렀는데 된 건지 단추에서는 알 수 없었다.
export const justDone = ref('')
let doneTimer = 0
export function markDone(key: string) {
  justDone.value = ''
  window.clearTimeout(doneTimer)
  // 같은 단추를 잇달아 누르면 한 번 비웠다가 다시 붙여 애니메이션을 처음부터 튼다.
  void nextTick(() => (justDone.value = key))
  doneTimer = window.setTimeout(() => (justDone.value = ''), 1800)
}

/** 다 냈으면 true. 사람이 폴더 고르기를 닫았으면 false. */
async function exportGeoJSON(): Promise<boolean> {
  if (!model.value) return false
  const files = modelToGeoJSON(model.value).map((f) => ({ name: f.fileName, text: JSON.stringify(f.collection, null, 2) }))
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  if (files.length > 1 && picker) {
    try {
      const dir = await picker({ mode: 'readwrite' })
      for (const f of files) {
        const writable = await (await dir.getFileHandle(f.name, { create: true })).createWritable()
        await writable.write(f.text)
        await writable.close()
      }
      note(`GeoJSON ${files.length}개(층마다 하나)를 저장했습니다.`)
      return true
    } catch (e) {
      // 사람이 폴더 고르기를 닫은 것이면 아무것도 하지 않는다. 권한이 막힌 것이면 내려받기로 넘어간다.
      if ((e as DOMException)?.name === 'AbortError') return false
    }
  }
  // 크롬은 잇달아 누른 내려받기를 10개에서 끊는다(성수 19개 층 중 9개가 조용히 빠졌다). 하나씩 틈을 둔다.
  for (const [i, f] of files.entries()) {
    if (i) await new Promise((r) => window.setTimeout(r, 250))
    download(f.name, f.text, 'application/geo+json')
  }
  return true
}
export async function exportGeoJSONDone() {
  if (await exportGeoJSON()) markDone('geojson')
}

// --- 미리보기 (OE-WF-07~09) ---
// 반영 전 결과를 보인다. 실제 반영(서버 버전)은 바뀌지 않는다. 변경 요약은 연 때 모델과 지금 모델을 견준 수(lib/preview.ts)이고, 영향 목록은 소속이 바뀔
// 설비마다 지금 → 바뀔 물리존, 사람 지정이 풀릴 설비는 따로 이유와 함께. 목록을 누르면 3D 에서 그 설비를 고른다. 바뀐 층이 하나면 그 층을 보인다(Phase 1).
export const previewOpen = ref(false)
export const previewData = computed(() => {
  void sceneVersion.value
  const m = model.value
  if (!m || !pristine) return null
  const released = assignLines.value.filter((r) => r.released)
  const dirty = dirtyKeys(currentParts()).filter((k) => m.storeys.some((st) => st.id === k))
  const summary = previewSummary(pristine, m, report.value, released.length, dirty)
  return { summary, brief: publishBrief(summary), moves: report.value.filter((c) => c.fromSpaceId !== c.toSpaceId), released }
})
export const previewText = computed(() => (previewData.value ? summaryText(previewData.value.summary) : ''))
/** 규칙 기반 경고의 사이트 설정(OE-P3-01~04). 이 브라우저에 남는다. */
export const siteRules = ref<SiteRules>(
  (() => {
    try {
      return { ...DEFAULT_SITE_RULES, ...(JSON.parse(localStorage.getItem('oe.siteRules') ?? 'null') ?? {}) }
    } catch {
      return { ...DEFAULT_SITE_RULES }
    }
  })(),
)
/** 규칙 기반 경고(OE-P3-01~04). 미리보기와 기준 · 검증 패널이 같이 보며 막지 않는다. */
export const ruleWarnings = computed(() => {
  void sceneVersion.value
  return model.value ? siteWarnings(model.value, siteRules.value) : []
})
export const ruleWarningsTotal = computed(() => ruleWarnings.value.reduce((sum, w) => sum + w.items.length, 0))
export function previewChanges() {
  previewOpen.value = !previewOpen.value
  if (!previewOpen.value || !model.value) return
  // 바뀐 층(Phase 1). 설비 소속이 바뀐 층과 저장 안 한 조각의 층.
  const floors = new Set([...dirtyKeys(currentParts())].filter((k) => model.value!.storeys.some((st) => st.id === k)))
  for (const c of previewData.value?.moves ?? []) {
    const st = storeyOf(c.equipmentId)
    if (st) floors.add(st.id)
  }
  if (floors.size === 1 && !multiView.value) viewStorey.value = [...floors][0]
}
/** 확인 창의 [미리보기](OE-WF-11): 창을 닫고 미리보기를 연다. */
export function previewFromPublish() {
  publishAsk.value = false
  if (!previewOpen.value) previewChanges()
}

/** 초기 구축의 마지막 단계. 기하와 의미를 따로 내는 전제는 그대로다 — 한 번 눌러 두 파일을 다 받을 뿐이다. */
export async function build() {
  exportTTL()
  if (await exportGeoJSON()) {
    // 구축하기가 PoC 의 "저장"이다(PRD 의 저장 = 반영, D10). 온톨로지로 낸 편집은 끝낼 때 다시 묻지 않고, 임시 저장본도 지운다.
    committed()
    markDone('build')
  }
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupOpenMany() {
  watch(
    siteRules,
    (v) => {
      try {
        localStorage.setItem('oe.siteRules', JSON.stringify(v))
      } catch {
        // 못 남겨도 이번 창에서는 그대로다
      }
    },
    { deep: true },
  )
}
