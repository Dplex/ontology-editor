import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { customerReportHTML, generationReport, type ReportInput, type ReportSectionB, sha256Hex } from '../lib/build-report'
import { exportEdits } from '../lib/edit-file'
import { issuesToBCF } from '../lib/export/bcf'
import { modelToGeoJSON } from '../lib/export/geojson'
import { ttlTriples } from '../lib/export/read-export'
import { readOntologyTTL } from '../lib/export/read-ttl'
import { modelToTTL } from '../lib/export/ttl'
import { gradeReport } from '../lib/grade'
import { issueList, issuesCSV, issueSummary } from '../lib/issue-list'
import { groupReport, layoutFiles, layoutSummary, newSince, type ReportSection, type SpaceTree } from '../lib/layout-files'
import { currentParts, dirtyKeys } from './autosave'
import { baseline } from './changes'
import { checks } from './checks'
import { fileName, model } from './core'
import { committed, discardFloors, keepDraft } from './exit-edit'
import { note } from './keyboard'
import { editNotice } from './multi-select'
import { currentRequirements, pristineCounts } from './open-file'
import { build, download, markDone } from './open-many'
import { asMe, currentUser, editBlock, people } from './people'
import { beginProgress, endProgress, paint } from './progress'
import { ontologyFloors, refreshPublished, serverKey, setWork, work, workFor } from './projects'
import { buildBlock, firstPublish, gradeLines, grades, layoutState, layoutsUrl, loadedVersion, refreshLayouts } from './publish'
import { makeMesh3D } from './storey-progress'
import { multiView } from './vertical'

// --- 생성 리포트(B-2)·고객사 결과 리포트(B-1) (OE-GEN-07·08, OE-BIM-20, lib/build-report.ts) ---
// 같은 재료(모델·등급 판정·요구사항·완전성 검사·산출물)로 만든다. 산출물(⑪)은 TTL·GeoJSON 을 만들어 세므로 누를 때 만든다.
async function reportInput(withOutputs: boolean): Promise<ReportInput | null> {
  const m = model.value
  if (!m) return null
  const g = grades.value ?? gradeReport(m, gradeLines.value, pristineCounts())
  let outputs: ReportInput['outputs'] = null
  if (withOutputs) {
    const ttl = modelToTTL(m)
    const reading = readOntologyTTL(ttl)
    const geo = modelToGeoJSON(m)
    outputs = {
      ttlBytes: new TextEncoder().encode(ttl).length,
      triples: ttlTriples(ttl).size,
      entities: reading.entities.length,
      unread: reading.unread.length,
      hash: await sha256Hex(ttl),
      geojsonFiles: geo.length,
      geojsonFeatures: geo.reduce((n, f) => n + f.collection.features.length, 0),
    }
  }
  return { fileName: fileName.value, model: m, grades: g, requirements: currentRequirements.value, checks: checks.value, outputs, at: new Date().toISOString() }
}
/** 화면에 보이는 생성 리포트(B-2). */
export const generation = shallowRef<ReportSectionB[] | null>(null)
export async function makeGenerationReport() {
  const input = await reportInput(true)
  if (input) generation.value = generationReport(input)
}
export async function downloadCustomerReport() {
  const input = await reportInput(false)
  if (!input) return
  const stem = fileName.value.split(' + ').map((n) => n.replace(/\.[^.]+$/, '')).join('+') || 'model'
  download(`${stem}-결과리포트.html`, customerReportHTML(input), 'text/html')
  markDone('customer-report')
  note(`${stem}-결과리포트.html 을 내려받았습니다. 재제출 항목(A·B)에 R 번호와 수정 방법이 붙어 있습니다`)
}
// BIM 필수 요구를 어긴 요소 목록(ADR-0051). 결과 리포트는 R 마다 개수까지라, 설계사가 원본에서 그 요소를 찾아 고치게 요소 단위로 낸다 —
// CSV(엑셀)와 BCF(BIMcollab Zoom 무료판에서 IFC 와 같이 열면 그 요소가 골라진다). 결과 리포트와 같은 모델·판정 — 편집한 상태다.
export const issueItems = computed(() => (model.value ? issueList(model.value, currentRequirements.value, checks.value) : []))
export const issueRows = computed(() => issueSummary(issueItems.value))
const reportStem = () => fileName.value.split(' + ').map((n) => n.replace(/\.[^.]+$/, '')).join('+') || 'model'
export function downloadIssuesCSV() {
  const items = issueItems.value
  download(`${reportStem()}-누락요소.csv`, issuesCSV(items), 'text/csv')
  markDone('issues-csv')
  note(`누락 요소 ${items.length}개를 CSV 로 내려받았습니다. 엑셀에서 R·분류로 거르면 고칠 요소가 GlobalId·Revit 요소 ID 와 함께 나옵니다`)
}
export function downloadIssuesBCF() {
  const items = issueItems.value
  const bytes = issuesToBCF(items, { files: fileName.value.split(' + '), project: model.value?.buildingName || reportStem() })
  download(`${reportStem()}-누락요소.bcf`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 'application/octet-stream')
  markDone('issues-bcf')
  note(`누락 요소를 BCF 로 내려받았습니다. BIMcollab Zoom(무료)에서 IFC 와 같이 열거나, 설계사는 Revit·Navisworks 의 BCF Manager 플러그인으로 엽니다`)
}
export const nextVersion = computed(() => Math.max(0, ...(layoutState.value?.versions.map((v) => v.version) ?? [])) + 1)
export const publishAsk = ref(false)
export const publishing = ref(false)
/** 반영자. 브라우저가 기억한다. */
export const publisher = ref((() => {
  try {
    return localStorage.getItem('oe.publisher') ?? ''
  } catch {
    return ''
  }
})())
/** 반영 대상 층: 바뀐 것이 있는 층. 층이 없는 편집(계통 등)뿐이면 모든 층이다. */
export const publishFloors = computed(() => {
  const m = model.value
  if (!m) return []
  const dirty = new Set(dirtyKeys(currentParts()))
  const named = m.storeys.filter((st) => dirty.has(st.id)).map((st) => st.name)
  return named.length ? named : m.storeys.map((st) => st.name)
})
export function askPublish() {
  if (buildBlock.value) return note(buildBlock.value)
  if (!serverKey.value) return void build()
  if (editBlock.value) return note(editBlock.value)
  publishAsk.value = true
}
export async function publishLayout(by: string, how: 'all' | 'save' | 'saved' = 'all') {
  // 임시 저장하지 않은 층이 있을 때 구축하기(OE-UI-04 AC12): 임시 저장하고 구축하거나, 그 편집을 되돌려(저장 안 함과 같다) 저장한 내용으로 구축한다.
  if (how !== 'all' && model.value && !publishing.value) {
    const dirty = dirtyKeys()
    if (how === 'save') keepDraft(dirty)
    else discardFloors(dirty)
  }
  const m = model.value
  const key = serverKey.value
  if (!m || !key || !baseline.value || publishing.value) return
  publishing.value = true
  try {
    localStorage.setItem('oe.publisher', by)
  } catch {
    // 못 남겨도 다음에 다시 친다
  }
  publisher.value = by
  const label = firstPublish.value ? '구축' : '반영'
  beginProgress(`${label}할 파일 만드는 중`)
  await paint()
  try {
    const edits = exportEdits(m, baseline.value, fileName.value)
    const stage = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('')
    const put = async (name: string, body: BodyInit) => {
      const r = await fetch(layoutsUrl({ key, stage, file: name }), { method: 'PUT', headers: asMe(), body })
      if (r.status === 401 || r.status === 403) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      if (!r.ok) throw new Error(`${name} 을 올리지 못했습니다(HTTP ${r.status})`)
    }
    const gen = await reportInput(true)
    for (const f of layoutFiles(m, edits, captureReport(), gen ? generationReport(gen) : undefined)) await put(f.name, f.text)
    await put('model.glb', new Blob(await makeMesh3D('glb')))
    const r = await fetch(layoutsUrl({ key, stage, publish: '' }), {
      method: 'POST',
      headers: asMe(),
      body: JSON.stringify({ by, floors: publishFloors.value, summary: layoutSummary(m, edits), work: workFor(multiView.value ? 'multi' : 'floor').id }),
    })
    const body = await r.json()
    if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
    // 반영이 PoC 의 저장이다. 끝낼 때 다시 묻지 않고 임시 저장본도 지운다. 층 편집에서 반영했으면 그 작업은 끝났다(다음 편집은 새 작업).
    committed()
    if (work?.kind === 'floor') setWork(null)
    publishAsk.value = false
    loadedVersion.value = body.version
    ontologyFloors.value = new Set(m.storeys.map((st) => st.id))
    refreshPublished()
    await refreshLayouts()
    markDone('build')
    // 반영 완료 화면 대신 그 버전의 결과 리포트를 연다(OE-SYNC-04).
    void openReport(body.version)
    // 앞서 남은 편집 경고(천장 모드 안내 등)가 결과 줄을 가리지 않게 지운다.
    editNotice.value = ''
    note(`v${body.version} 으로 ${label}했습니다(${body.floors.join(' · ')}). 다른 사람은 새로고침하면 이 레이아웃을 받습니다`)
  } catch (e) {
    editNotice.value = ''
    note(`${label}하지 못했습니다: ${(e as Error).message}. 지금 반영된 버전은 그대로입니다`)
  } finally {
    publishing.value = false
    endProgress()
  }
}
/** 되돌리기 확인 중인 버전. */
export const rollbackAsk = ref<number | null>(null)
export async function rollbackLayout(version: number) {
  const key = serverKey.value
  const by = people.value ? currentUser.value : publisher.value
  if (!key || !by.trim()) return note(people.value ? '화면 위의 사용자 칸에서 사람을 먼저 고르세요' : '반영자를 먼저 넣으세요(반영하기 창에서 한 번 넣으면 기억합니다)')
  const r = await fetch(layoutsUrl({ key, rollback: String(version) }), { method: 'POST', headers: asMe(), body: JSON.stringify({ by }) })
  const body = await r.json().catch(() => ({}))
  rollbackAsk.value = null
  editNotice.value = ''
  if (!r.ok) return note(`되돌리지 못했습니다: ${body.error ?? `HTTP ${r.status}`}`)
  await refreshLayouts()
  note(`v${version} 의 레이아웃을 v${body.version} 으로 다시 반영했습니다. 지금 화면의 편집은 그대로입니다`)
}
export const versionTime = (at: string) => new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
export const versionFileUrl = (v: number, file: string) => layoutsUrl({ key: serverKey.value ?? '', v: String(v), file })

// --- 반영 결과 리포트·공간 계층 (OE-SYNC-03~06) ---
// 리포트 줄은 화면의 "바뀐 내용" 그대로다(OE-SYNC-06 의 규칙으로 만든 것). 줄마다 붙은 종류(data-kind)로 여섯 항목에 묶어 버전의 report.json 에 담는다.
/** 지금 "바뀐 내용" 의 줄을 리포트 묶음으로. */
function captureReport(): ReportSection[] {
  const lines = [...document.querySelectorAll<HTMLLIElement>('ul.report li')].map((li) => ({ kind: li.dataset.kind ?? 'other', text: li.innerText.replace(/\s+/g, ' ').trim() }))
  return groupReport(lines)
}
/** 보고 있는 버전의 리포트. `fresh` 는 직전 버전에 없던 줄, `prev` 는 되돌릴 기본 버전(직전 버전). */
export const reportView = shallowRef<{ version: number; sections: ReportSection[]; fresh: Set<string>; prev: number | null; tree: SpaceTree | null } | null>(null)
export async function openReport(version: number) {
  const key = serverKey.value
  if (!key) return
  const getJson = async <T,>(v: number, file: string): Promise<T | null> => {
    try {
      const r = await fetch(layoutsUrl({ key, v: String(v), file }))
      return r.ok ? ((await r.json()) as T) : null
    } catch {
      return null
    }
  }
  await refreshLayouts()
  const prev = layoutState.value?.versions.map((v) => v.version).filter((v) => v < version).sort((a, b) => b - a)[0] ?? null
  const now = (await getJson<{ sections?: ReportSection[] }>(version, 'report.json'))?.sections ?? groupReport([])
  const before = prev ? ((await getJson<{ sections?: ReportSection[] }>(prev, 'report.json'))?.sections ?? null) : null
  reportView.value = { version, sections: now, fresh: newSince(now, before), prev, tree: await getJson<SpaceTree>(version, 'tree.json') }
}
/** 리포트의 [되돌리기](OE-SYNC-05): 직전 버전을 골라 둔 되돌리기 확인으로 간다. */
export function rollbackFromReport() {
  const prev = reportView.value?.prev
  if (!prev) return note('되돌릴 직전 버전이 없습니다(7일 안)')
  rollbackAsk.value = prev
  void nextTick(() => document.querySelector('[data-testid="versions"] tr.rollback-ask')?.scrollIntoView({ block: 'center' }))
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupReports() {
  watch(baseline, () => (generation.value = null))
}
