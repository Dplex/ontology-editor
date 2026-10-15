import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { type EditFile, exportEdits, parseEditFile } from '../lib/edit-file'
import { type ProjectRow, summaryOf } from '../lib/projects'
import { BUILDING, buildingStoreys, partSig } from '../lib/storey-drafts'
import ProjectList from '../components/ProjectList.vue'
import { currentParts, draftsVersion, floorDrafts, homeOf, publishedFile, savedParts } from './autosave'
import { baseline } from './changes'
import { baseName, openedDataPath, profileAt } from './chat-view'
import { busy, error, fileName, mode, model } from './core'
import { committed, editSig, markSaved, savedSig } from './exit-edit'
import { viewStorey } from './multi-view'
import { fetchData } from './open-file'
import { openMany } from './open-many'
import { asMe, me, people } from './people'
import { applyEditFile, editFileNote, progress } from './progress'
import { layoutState, layoutsUrl, loadedVersion, refreshLayouts } from './publish'
import { multiView } from './vertical'

// --- 프로젝트 (OE-UI-02·03·01, OE-WF-06, src/server/projects.ts · components/ProjectList.vue) ---
// 첫 화면은 프로젝트 목록이다. 서버(8084·dev)가 있을 때만 보인다 — 손으로 고른 파일만 여는 곳(e2e 의 흉내 서버)은 예전처럼 파일 상자부터다.
export const projectRows = ref<ProjectRow[] | null>(null)
function refreshProjects() {
  return fetch('./__data/__projects')
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => (projectRows.value = Array.isArray(list) ? list : null))
    .catch(() => {})
}
/** 지금 연 프로젝트. 다른 파일을 열면 비운다(load 가 projectLoading 으로 갈아 끼운다). */
export const openedProject = ref<ProjectRow | null>(null)
export let projectLoading: ProjectRow | null = null
export function setProjectLoading(v: typeof projectLoading) {
  projectLoading = v
}
export const projectList = ref<InstanceType<typeof ProjectList> | null>(null)
/** [새 프로젝트]를 못 누르는 까닭. 사람 목록이 없으면(서버 사람 기능이 없는 곳) 막지 않는다 — 서버가 다시 거른다. */
export const projectBlock = computed(() => {
  if (!people.value) return null
  if (!me.value) return '사용자를 먼저 고르세요'
  return me.value.role === 'viewer' ? `${me.value.name}은(는) 보기 전용(Viewer)이라 프로젝트를 만들 수 없습니다` : null
})
/** 그 IFC 의 분야. data/ 목록이 잰 요약으로 정한다(방이 없으면 설비, 설비가 없으면 건축). */
export function fieldOf(path: string): string {
  const p = profileAt(path)
  return !p ? '' : p.needsArchitecture ? '설비' : p.needsEquipment ? '건축' : '건축·설비'
}
/**
 * 프로젝트를 연다(OE-UI-02). 구축 전이면 시작 화면 없이 초기 구축 에디터로, 구축을 마쳤으면 층 선택 화면에서 고른 층을 운영 편집으로 연다.
 * 열고 나면 센 층 구성을 서버에 올려 목록이 건물·층 수를 보이게 한다(서버는 IFC 를 읽지 않는다).
 */
export async function openProject(p: ProjectRow, storey: string | null) {
  projectLoading = p
  // 올린 파일은 서버가 이름 앞에 올린 시각을 붙여 둔다(projects.ts). 화면에는 원래 이름을 보인다.
  await openMany(p.paths.map((path) => ({ name: baseName(path).replace(/^\d{8}-\d{6}-/, ''), read: () => fetchData(path), dataPath: path })), 'open')
  projectLoading = null
  if (!model.value || openedProject.value?.id !== p.id) return
  if (storey && model.value.storeys.some((x) => x.id === storey)) viewStorey.value = storey
  mode.value = 'edit'
  const summary = summaryOf(model.value)
  if (JSON.stringify(summary) !== JSON.stringify(p.summary ?? null))
    void fetch(`./__data/__projects?${new URLSearchParams({ id: p.id, summary: '' })}`, { method: 'PUT', body: JSON.stringify(summary) }).catch(() => {})
}
/** [새 프로젝트]. IFC 를 올리고(data/uploads) 프로젝트를 만든 뒤 바로 초기 구축 에디터로 연다(OE-UI-15 ①→③). */
export async function createProject(input: { name: string; site: string; files: File[] }) {
  busy.value = true
  error.value = ''
  const paths: string[] = []
  try {
    for (const [i, f] of input.files.entries()) {
      progress.value = { label: `IFC 올리는 중 ${i + 1}/${input.files.length} · ${f.name}` }
      const r = await fetch(`./__data/__upload?${new URLSearchParams({ name: f.name })}`, { method: 'POST', headers: asMe(), body: f })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(`${f.name} 을(를) 올리지 못했습니다: ${body.error ?? `HTTP ${r.status}`}`)
      paths.push(body.path)
    }
    const r = await fetch('./__data/__projects', { method: 'POST', headers: { ...asMe(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name, site: input.site, paths }) })
    const row = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`프로젝트를 만들지 못했습니다: ${row.error ?? `HTTP ${r.status}`}`)
    projectList.value?.closeForm()
    await refreshProjects()
    busy.value = false
    progress.value = null
    await openProject(row as ProjectRow, null)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
    if (!model.value) progress.value = null
  }
}
/** 열린 모델을 이룬 파일들의 data/ 경로(연 순서). 손으로 고른 파일은 null. */
export const openedSources = ref<(string | null)[]>([])
export const serverKey = computed(() => {
  if (!openedSources.value.length || !openedSources.value.every((p) => p)) return null
  const paths = openedSources.value.join('|')
  // 프로젝트로 연 판은 프로젝트 열쇠(`@id|경로…`)를 쓴다 — 같은 IFC 의 다른 프로젝트와 임시 저장본·버전이 섞이지 않는다(OE-UI-02 AC4).
  // 프로젝트에 없는 파일을 덧붙였으면 프로젝트의 판이 아니라서 파일 열쇠로 돌아간다.
  const p = openedProject.value
  return p && p.paths.join('|') === paths ? p.key : paths
})
/** 지금 모델에 얹은 8084 저장본. 저장 안 함은 여기까지만 되돌린다. */
const serverSaved = shallowRef<{ file: EditFile; savedAt: string } | null>(null)
/** 마지막으로 정말 저장한(8084·파일) 편집의 서명. 자동 저장이 이것과 같으면 임시 저장으로 남기지 않는다. */
export let committedSig: string | null = null
export function setCommittedSig(v: typeof committedSig) {
  committedSig = v
}
/** 마지막으로 정말 저장한(8084·파일·구축하기) 때의 층별 조각. 작업의 영향 층과 다중층에 들어가기 전에 저장할지를 이것과 견준다. */
export let committedParts = new Map<string, EditFile>()
export function setCommittedParts(v: typeof committedParts) {
  committedParts = v
}
// --- 작업(OE-HIST-03 · OE-PIP-15 AC8) ---
// 8084 저장은 작업에 묶인다. 층 편집과 다중층 세션은 다른 작업이고, 다중층에 들어가서 나올 때까지의 저장은 층·공간/설비 모드와 상관없이
// 한 작업이다. 다중층에 들어가기 전에 층 편집을 저장하고(못 하면 들어가지 않는다), 나올 때 세션을 저장한다(못 하면 나오지 않는다).
// 경계에서 되돌리기 이력을 비운다 — 세션의 되돌리기로 앞 작업을 되돌리지 않는다. 8084 에 두지 않는 판(손으로 연 파일)은 완료 작업을
// 남길 곳이 없어 경계도 없다. 임시 저장·자동 저장은 작업을 만들지 않는다.
export let work: { id: string; kind: 'floor' | 'multi' } | null = null
export function setWork(v: typeof work) {
  work = v
}
export const newWorkId = () => `w${Date.now().toString(36)}${Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('')}`
/** 이 종류의 지금 작업. 종류가 바뀌었으면(층 편집 ↔ 다중층) 새 작업이다. */
export function workFor(kind: 'floor' | 'multi') {
  if (!work || work.kind !== kind) work = { id: newWorkId(), kind }
  return work
}
/** 마지막으로 정말 저장한 뒤 바뀐 층 id(건물 조각은 뺀다). 작업의 영향 층이다. */
function uncommittedStoreys(parts = currentParts()): string[] {
  const keys = new Set([...parts.keys(), ...committedParts.keys()])
  const changed = [...keys].filter((k) => partSig(parts.get(k)) !== partSig(committedParts.get(k)))
  const storeys = new Set(changed.filter((k) => k !== BUILDING))
  // 층이 없는 편집(잇기·해제 보정·방향)은 양 끝 설비의 층에 닿는다.
  if (changed.includes(BUILDING)) for (const id of buildingStoreys(committedParts.get(BUILDING), parts.get(BUILDING), homeOf)) storeys.add(id)
  return [...storeys]
}
/** 마지막으로 정말 저장한 뒤 바뀐 것이 있나. 임시 저장은 저장으로 치지 않는다. */
export const uncommitted = () => editSig() !== committedSig
const savedEditsUrl = (key?: string) => `./__data/__edits${key ? `?key=${encodeURIComponent(key)}` : ''}`

/** data/ 목록 옆에 보이는 8084 저장본. 열쇠(경로를 | 로 이은 것)마다 하나. */
type SavedSet = { key: string; paths: string[]; count: number; savedAt: string }
export const savedSets = ref<SavedSet[]>([])
function refreshSavedSets() {
  fetch(savedEditsUrl())
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (savedSets.value = Array.isArray(list) ? list : []))
    .catch(() => {})
}
export const savedFor = (path: string) => savedSets.value.find((s) => s.key === path) ?? null

// --- 모드 자동 분기 (OE-UI-01·02·03, src/server/layouts.ts) ------------------------------------------------------
// 반영한 버전(온톨로지)이 있는 건물은 운영 편집, 없으면 초기 구축이다. 사람이 모드를 고르지 않는다 — data/ 목록의 [초기 구축]·[운영 편집] 은 그 판정대로
// 하나만 켜진다. 층마다는 반영된 버전의 공간 계층(tree.json)에 그 층이 있는지로 가른다.
type Published = { key: string; paths: string[]; current: number; at: string; by: string }
const publishedSets = ref<Published[]>([])
export function refreshPublished() {
  fetch('./__data/__layouts')
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (publishedSets.value = Array.isArray(list) ? list : []))
    .catch(() => {})
}
export const publishedFor = (path: string) => publishedSets.value.find((s) => s.key === path) ?? null
/** 목록에서 고른 모드로 연다. 열고 나서 편집으로 들어간다(그 모드는 반영된 버전이 있는지로 이미 정해져 있다). */
export function openWithMode(path: string) {
  void openMany([{ name: baseName(path), read: () => fetchData(path), dataPath: path }], 'open').then(() => {
    openedDataPath.value = fileName.value === baseName(path) ? path : null
    if (model.value) mode.value = 'edit'
  })
}
/** 반영된 버전의 공간 계층에 있는 층 id. 반영 전이거나 서버가 없으면 null. */
export const ontologyFloors = shallowRef<Set<string> | null>(null)
/** 지금 층의 모드. 한 층을 보면 그 층, 모든 층이면 한 층이라도 온톨로지가 있으면 운영 편집이다. */
export const editKind = computed<'build' | 'operate'>(() => {
  const floors = ontologyFloors.value
  if (!floors) return 'build'
  return viewStorey.value ? (floors.has(viewStorey.value) ? 'operate' : 'build') : floors.size ? 'operate' : 'build'
})

/**
 * data/ 에서 연 건물에 서버의 편집을 얹는다. 반영된 버전(src/server/layouts.ts)이 있으면 그 레이아웃(버전의 편집 파일)이 시작점이다(OE-WF-17 "다시 들어오면 새
 * 레이아웃을 적용"). 8084 저장본이 그 버전보다 나중에 저장된 것이면 저장본을 얹는다 — 반영 뒤 이어 고친 것이다. 둘 다 BIM 을 기준으로 한 편집 파일이라
 * 하나만 얹는다.
 */
export async function loadServerEdits() {
  const key = serverKey.value
  if (!key) return
  const getFile = async (url: string) => {
    try {
      const r = await fetch(url)
      if (!r.ok) return null
      const f = parseEditFile(await r.text())
      return typeof f === 'string' ? null : f
    } catch {
      return null
    }
  }
  await refreshLayouts()
  const state = layoutState.value
  const cur = state?.current ? (state.versions.find((v) => v.version === state.current) ?? null) : null
  const saved = await getFile(savedEditsUrl(key))
  // 서버의 층별 임시 저장본(OE-WF-01·02, src/server/floor-state.ts). 브라우저의 것보다 앞선다 — 층의 것이라 누가 저장했든 이어서 편집한다.
  try {
    const r = await fetch(`./__data/__drafts?${new URLSearchParams({ key })}`)
    const got = r.ok ? ((await r.json()) as Record<string, { file: unknown }>) : {}
    for (const [k, d] of Object.entries(got)) {
      const f = parseEditFile(JSON.stringify(d.file))
      if (typeof f !== 'string') floorDrafts.set(k, f)
    }
    draftsVersion.value++
  } catch {
    // 서버 임시 저장본이 없으면 브라우저 것만 쓴다
  }
  if (key !== serverKey.value) return
  loadedVersion.value = cur?.version ?? null
  let file: EditFile | null = null
  let from = ''
  publishedFile.value = null
  ontologyFloors.value = null
  if (cur) {
    publishedFile.value = await getFile(layoutsUrl({ key, v: String(cur.version), file: 'edits.json' }))
    try {
      const r = await fetch(layoutsUrl({ key, v: String(cur.version), file: 'tree.json' }))
      const tree = r.ok ? ((await r.json()) as { storeys?: { id: string }[] }) : null
      ontologyFloors.value = new Set((tree?.storeys ?? []).map((st) => st.id))
    } catch {
      ontologyFloors.value = new Set()
    }
  }
  if (cur && (!saved || saved.savedAt <= cur.at)) {
    file = publishedFile.value
    from = `반영된 레이아웃 v${cur.version} · ${when(cur.at)}`
  }
  if (!file && saved) {
    file = saved
    from = `서버 저장본 · ${when(saved.savedAt)}`
  }
  if (!file || key !== serverKey.value) return
  applyEditFile(file, from)
  serverSaved.value = { file, savedAt: file.savedAt }
  markSaved()
  committedSig = savedSig
  committedParts = savedParts.value
}

/** 편집 파일을 서버에 둔다. 됐으면 true. 못 두면 `then`(그다음 무엇을 했는지)을 붙여 알린다. */
export async function saveToServer(file: EditFile, then = '파일로 내려받았습니다.'): Promise<boolean> {
  const key = serverKey.value
  if (!key) return false
  const kind = multiView.value ? 'multi' : 'floor'
  const w = workFor(kind)
  const at = `${savedEditsUrl(key)}&${new URLSearchParams({ work: w.id, kind, storeys: uncommittedStoreys().join(',') })}`
  try {
    const r = await fetch(at, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...asMe() }, body: JSON.stringify(file) })
    if (!r.ok) {
      const why = await r.json().then((b: { error?: string }) => b.error ?? '').catch(() => '')
      editFileNote.value = `서버에 저장하지 못했습니다(HTTP ${r.status}${why ? ` · ${why}` : ''}). ${then}`
      return false
    }
  } catch {
    editFileNote.value = `서버에 연결하지 못했습니다. ${then}`
    return false
  }
  serverSaved.value = { file, savedAt: file.savedAt }
  refreshSavedSets()
  return true
}

/** 지금 편집을 지금 작업의 완료 저장으로 8084 에 둔다(다중층 진입·종료). 못 두면 false 이고 아무것도 바꾸지 않는다. */
export async function commitWork(then: string): Promise<boolean> {
  const m = model.value
  if (!m || !baseline.value) return false
  if (!(await saveToServer(exportEdits(m, baseline.value, fileName.value), then))) return false
  committed()
  return true
}

/** 저장 시각을 "오늘 14:05" · "10월 2일 14:05" 로. */
export function when(iso: string): string {
  const t = new Date(iso)
  const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
  return new Date().toDateString() === t.toDateString() ? `오늘 ${hm}` : `${t.getMonth() + 1}월 ${t.getDate()}일 ${hm}`
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupProjects() {
  void refreshProjects()
  watch(baseline, () => {
    serverSaved.value = null
    committedSig = null
    committedParts = new Map()
    work = null
  })
  refreshSavedSets()
  refreshPublished()
  // 주소로 열기(OE-UI-01): `?open=a.ifc|b.ifc&storey=<층 id>&mode=edit`. DT 의 [레이아웃 에디터] 가 보고 있던 사이트·층을 넘기는 자리다(D-INT 전에는 주소).
  {
    const q = new URLSearchParams(location.search)
    const paths = (q.get('open') ?? '').split('|').filter(Boolean)
    // `?project=<id>[&storey=<층 id>]`: 프로젝트를 바로 연다(OE-UI-01 AC2, DT 없이 에디터 주소로 초기 구축에 들어간다).
    const projectId = q.get('project')
    if (projectId)
      void refreshProjects().then(() => {
        const p = projectRows.value?.find((x) => x.id === projectId)
        if (p) void openProject(p, q.get('storey'))
        else error.value = `프로젝트 ${projectId} 가 없습니다`
      })
    else if (paths.length)
      void nextTick(() =>
        openMany(paths.map((path) => ({ name: baseName(path), read: () => fetchData(path), dataPath: path })), 'open').then(() => {
          const st = q.get('storey')
          if (st && model.value?.storeys.some((x) => x.id === st)) viewStorey.value = st
          if (q.get('mode') === 'edit' && model.value) mode.value = 'edit'
        }),
      )
  }
}
