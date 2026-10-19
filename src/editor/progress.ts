import { computed, ref, triggerRef } from 'vue'
import { applyEdits, type EditFile, exportEdits, parseEditFile } from '../lib/edit-file'
import type { MeshMap } from '../lib/ifc/import'
import type { Model } from '../lib/model'
import { MATCH_KEY_BY, type MatchKey } from '../lib/versions'
import { autosaveArmed, editCount, setAutosaveArmed } from './autosave'
import { baseline, changeCount } from './changes'
import { mb } from './chat-view'
import { systemById } from './checks'
import { fileName, model } from './core'
import { changes, spaceNameOf } from './edit-report'
import { captureBase, placeStretched } from './equipment-shape'
import { committed, editSig, markSaved } from './exit-edit'
import { confirmations, flowVersion, ruleReport } from './flow-rules'
import { future, history } from './history'
import { note } from './keyboard'
import { ASSIGN_RELEASE_REASON } from './kinds'
import { ensureDrawnMeshes } from './manual-draw'
import { areaChanges, storeyMoved } from './multi-select'
import { meshBase } from './open-file'
import { download, markDone } from './open-many'
import { saveToServer, serverKey } from './projects'
import { readFeatures, readOpeningShapes } from './read-settings'
import { redraw, shiftMesh } from './redraw'
import { hasEdits } from './versions'

// --- 진행 표시 -------------------------------------------------------------------
//
// 성수(건축 84MB + 기계 203MB)는 여는 데 수십 초가 걸린다. 무엇을 하는 중인지, 얼마나 남았는지를
// 보인다. 단계 안에서 몇 개 중 몇 개인지 알면 막대가 차고, 모르면 막대가 흐르기만 한다(억지로 %를
// 지어내지 않는다).
type Progress = { label: string; step?: number; steps?: number; done?: number; total?: number; unit?: 'bytes' | 'items' }
export const progress = ref<Progress | null>(null)
const startedAt = ref(0)
const now = ref(0)
let ticker: number | undefined
/**
 * 여러 파일을 이어 열 때 지금 몇 번째 파일인지. 파일마다 단계(1/6…)가 처음부터 다시 돌아서, 이것 없이는 성수 두 파일을
 * 여는 동안 막대가 끝났다가 다시 시작하고 초도 0 으로 돌아가 얼마나 남았는지 알 수 없었다. 초는 첫 파일부터 이어 센다.
 */
export const batch = ref<{ index: number; total: number; name: string } | null>(null)

export function beginProgress(label: string) {
  if (!batch.value || batch.value.index === 1) startedAt.value = Date.now()
  now.value = Date.now()
  progress.value = { label }
  window.clearInterval(ticker)
  ticker = window.setInterval(() => (now.value = Date.now()), 250)
}
export function endProgress() {
  progress.value = null
  window.clearInterval(ticker)
}
export const elapsed = computed(() => Math.max(0, Math.round((now.value - startedAt.value) / 1000)))
export const progressPct = computed(() => {
  const p = progress.value
  return p && p.total ? Math.min(100, Math.round(((p.done ?? 0) / p.total) * 100)) : null
})
export const progressTitle = computed(() => {
  const p = progress.value
  return p ? (p.step ? `${p.step}/${p.steps} · ${p.label}` : p.label) : ''
})
export const progressFile = computed(() => {
  const b = batch.value
  return b ? `파일 ${b.index}/${b.total} · ${b.name}` : ''
})
export const progressDetail = computed(() => {
  const p = progress.value
  if (!p?.total) return ''
  return p.unit === 'bytes'
    ? `${mb(p.done ?? 0)} / ${mb(p.total)}`
    : `${(p.done ?? 0).toLocaleString()} / ${p.total.toLocaleString()}개`
})

/** 화면이 한 번 그려질 틈을 준다. 오래 막는 일(3D 만들기) 앞에서 진행 문구가 먼저 보이게 한다. */
export const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))

// 임포트는 워커에서 돈다(lib/ifc/import.worker.ts). 화면 스레드에서 돌면 끝날 때까지 진행 막대가
// 한 번도 다시 그려지지 않는다. wasm 을 한 번만 초기화하도록 워커를 재사용한다.
//
// wasm 경로는 페이지 기준의 절대 주소로 넘긴다. vite 설정이 `base: './'` 라 번들이 하위 경로에서도
// 열리는데, 워커는 assets/ 아래에서 돌아서 상대 경로로 두면 wasm 을 엉뚱한 자리에서 찾는다.
let worker: Worker | null = null
export function importInWorker(bytes: ArrayBuffer): Promise<{ model: Model; meshes: MeshMap }> {
  worker ??= new Worker(new URL('../lib/ifc/import.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d.type === 'progress') {
        progress.value = { label: d.progress.stage, step: d.progress.step, steps: d.progress.steps, done: d.progress.done, total: d.progress.total, unit: 'items' }
      } else if (d.type === 'done') {
        resolve({ model: d.model, meshes: new Map(d.meshes) })
      } else {
        reject(new Error(d.message))
      }
    }
    w.onerror = (e) => {
      // 워커가 죽었으면(메모리 부족 등) 다음 파일은 새 워커로 연다.
      worker = null
      reject(new Error(e.message || '임포트 워커가 멈췄습니다'))
    }
    w.postMessage(
      {
        bytes,
        wasmBase: new URL(import.meta.env.BASE_URL, location.href).href,
        options: { openings: readOpeningShapes.value, ...readFeatures.value },
      },
      [bytes],
    )
  })
}

// --- 편집 저장·불러오기 --------------------------------------------------------------
//
// 연 때와 달라진 값만 GUID 로 적은 JSON 이다(lib/edit-file.ts). 불러오면 편집 함수를 다시 거쳐 소속·규칙 방향을
// 다시 판정한다. 불러온 것은 한 번에 되돌리지 못한다 — 되돌리기 이력을 비우고, 리포트에는 연 때와 견준 줄로 남는다.
export const editFileNote = ref('')

/**
 * [편집 저장]. data/ 에서 연 파일이면 8084 에 둔다 — 같은 파일을 여는 사람 누구나 이 편집을 본다(OE-COM-08). 손으로 연 파일이거나
 * 서버에 못 닿으면 파일로 내려받는다. `toFile` 이면 data/ 의 파일이라도 내려받기만 한다.
 */
export async function saveEdits(toFile = false) {
  const m = model.value
  if (!m || !baseline.value) return
  if (!hasEdits.value && changeCount.value === 0) {
    note('저장할 편집이 없습니다')
    return
  }
  const file = exportEdits(m, baseline.value, fileName.value)
  const sig = editSig(file)
  if (!toFile && serverKey.value && (await saveToServer(file))) {
    committed()
    note(`서버에 저장했습니다(편집 ${editCount(file)}건). 이 파일을 여는 모든 사용자가 같은 편집을 봅니다`)
    markDone('save')
    return
  }
  const stem = fileName.value.replace(/\.(ifc|idf)/gi, '').replace(/[^\w가-힣.+-]+/g, '_') || 'model'
  download(`${stem}.edits.json`, JSON.stringify(file, null, 2), 'application/json')
  committed()
  note(`편집을 파일로 내려받았습니다: ${stem}.edits.json`)
  markDone('save')
}

export async function onEditFilePick(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  const m = model.value
  if (!picked || !m) return
  const file = parseEditFile(await picked.text())
  if (typeof file === 'string') {
    editFileNote.value = `불러오지 못했습니다(${picked.name}): ${file}`
    return
  }
  applyEditFile(file, picked.name)
  // 파일에서 불러온 편집은 그 파일에 이미 있다. 불러온 뒤 더 고친 것만 저장하지 않은 편집이다.
  markSaved()
}

/** 편집 파일을 지금 모델에 얹는다. 파일에서 불러올 때와 자동 저장을 되살릴 때가 같이 쓴다. */
export function applyEditFile(file: EditFile, from: string, quiet = false) {
  const m = model.value
  if (!m) return
  // 옮길 설비의 형상도 같이 옮겨야 다시 그릴 때 예전 자리로 튀지 않는다. 얹기 전 좌표를 떠 둔다.
  const before = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.position]))
  const result = applyEdits(m, file)
  for (const e of m.storeys.flatMap((s) => s.equipment)) {
    const was = before.get(e.id) ?? null
    // 늘인 구간은 얹기 전 형상을 떠 두고 다시 만든다. 통째로 옮기면 붙은 끝이 떨어진다.
    if (e.endShift && was && (meshBase.has(e.id) || captureBase(e.id, was))) placeStretched(e.id)
    else if (was !== e.position) shiftMesh(e.id, was, e.position)
  }
  // 그린 배관(OE-PIP-11)은 BIM 형상이 없어 여기서 만든다.
  ensureDrawnMeshes()
  changes.value = [...changes.value, ...result.changes]
  areaChanges.value = [...areaChanges.value, ...result.areaChanges]
  confirmations.value = [
    ...confirmations.value,
    ...result.confirmations.map((c) => ({ systemName: systemById.value.get(c.systemId)?.name || c.systemId, count: c.count })),
  ]
  storeyMoved.value = new Set([...storeyMoved.value, ...result.storeyMoved])
  if (result.rules) ruleReport.value = result.rules
  history.value = []
  future.value = []
  triggerRef(model)
  flowVersion.value++
  redraw()

  const missing = Object.entries(result.missing).filter(([, n]) => n > 0)
  const MISSING_LABEL: Record<string, string> = { equipment: '설비', spaces: '물리존', kinds: '타입', flows: '방향', systems: '계통', connections: '연결', elements: '벽·문·창', storeys: '완료한 층' }
  // GUID 가 바뀐 판본에서 다른 열쇠로 찾은 것. 사람이 확인할 수 있게 무엇으로 찾았는지까지 말한다.
  const rematched = (Object.entries(result.rematched) as [Exclude<MatchKey, 'guid'>, number][]).filter(([, n]) => n > 0)
  setAutosaveArmed(true)
  if (quiet) return
  editFileNote.value =
    `편집 ${result.applied}개를 적용했습니다(${from}).` +
    (file.source && file.source !== fileName.value ? ` 원래 파일: ${file.source}.` : '') +
    (rematched.length
      ? ` GUID가 바뀐 ${rematched.reduce((n, [, k]) => n + k, 0)}개는 ${rematched.map(([k, n]) => `${MATCH_KEY_BY[k]} ${n}개`).join(', ')} 찾았습니다.`
      : '') +
    (result.releases?.review ? ` 해제 보정한 BIM 연결 ${result.releases.review}개는 이 판본에서 원본이 달라 재검토가 필요합니다(바뀐 내용).` : '') +
    (missing.length ? ` 찾지 못함: ${missing.map(([k, n]) => `${MISSING_LABEL[k]} ${n}`).join(' · ')}.` : '') +
    (result.numberConflicts.length
      ? ` 같은 층에 이미 있는 방번호라 BIM 번호로 되돌림: ${result.numberConflicts.map((c) => `${c.storey} ${c.number}`).join(', ')}.`
      : '') +
    (result.assignReleased?.length
      ? ` 사람 지정 해제 ${result.assignReleased.length}대: ${result.assignReleased.map((r) => `${r.name} ${spaceNameOf(r.from)} → ${spaceNameOf(r.to)}(${ASSIGN_RELEASE_REASON[r.reason]})`).join(', ')}.`
      : '') +
    ' 불러온 편집은 되돌리기로 취소할 수 없습니다.'
}
