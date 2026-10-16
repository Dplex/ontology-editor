import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { josa } from '../lib/josa'
import { partnerOf as findPartner, type Profile } from '../lib/profile'
import { fileName, model } from './core'
import { note } from './keyboard'
import { shortName } from './equipment-shape'
import { equipmentById } from './flow-rules'
import { storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { fetchData } from './open-file'
import { openMany } from './open-many'
import { pickSpace } from './rooms'
import { viewer } from './scene'
import { select } from './systems'
import { multiView } from './vertical'

// --- 온톨로지 챗의 답을 이 3D 에서 보기 (R4, ADR-0063) ---
// 55 의 챗봇 창(scripts/docs-chat.js, dist 에 끼워 넣는 부속)이 [온톨로지] 답의 `ex:…` id 를 여기에 넘긴다. 열어 둔 BIM 에 그 id 가
// 있으면 고르고 그 자리로 시점을 옮기고, 무엇을 했는지 돌려준다(창이 "3D 동작" 칩으로 적는다). 브라우저 안에서만 오가고 서버로는
// 아무것도 보내지 않는다(서버로 가는 앱 상태는 질문과 함께 보내는 지금 화면의 id 뿐이다, ADR-0050 · viewForChat). 열어 둔 BIM 에 없는 id 는 세기만 한다.
type Editor3dResult = { equipment: number; spaces: number; storeys: number; missing: number; label: string }
function showFromChat(ids: readonly string[]): Editor3dResult {
  const m = model.value
  const out: Editor3dResult = { equipment: 0, spaces: 0, storeys: 0, missing: 0, label: '' }
  if (!m) return { ...out, missing: ids.length, label: '편집 화면에 연 BIM 이 없습니다' }
  const eq: string[] = []
  const sp: { id: string; storey: string }[] = []
  const st: string[] = []
  for (const id of new Set(ids)) {
    if (equipmentById.value.has(id)) eq.push(id)
    else {
      const home = m.storeys.find((s) => s.spaces.some((x) => x.id === id))
      if (home) sp.push({ id, storey: home.id })
      else if (m.storeys.some((s) => s.id === id)) st.push(id)
      else out.missing++
    }
  }
  out.equipment = eq.length
  out.spaces = sp.length
  out.storeys = st.length
  if (eq.length) {
    // 설비가 있으면 설비가 답의 대상이다. 한 대면 고르고(층을 따라간다), 여럿이면 첫 대를 고르고 모두가 들어오게 본다.
    select(eq[0])
    if (eq.length > 1) {
      const home = storeyOf(eq[0])?.id
      if (viewStorey.value && eq.some((id) => storeyOf(id)?.id !== home)) viewStorey.value = null
      nextTick(() => viewer?.frame(eq, 0.5))
    }
  } else if (sp.length) {
    if (viewStorey.value && !multiView.value) viewStorey.value = sp[0].storey
    pickSpace(sp[0].id)
    nextTick(() => {
      viewer?.pulseSpaces(sp.map((x) => x.id))
      viewer?.frameSpace(sp[0].id)
    })
  } else if (st.length) {
    viewStorey.value = st[0]
  }
  const parts = [eq.length && `설비 ${eq.length}`, sp.length && `물리존 ${sp.length}`, st.length && `층 ${st.length}`].filter(Boolean)
  out.label = parts.length
    ? `${parts.join(' · ')} — ${eq.length ? `${shortName(equipmentById.value.get(eq[0])?.name)}${josa(shortName(equipmentById.value.get(eq[0])?.name), "을/를")} 골라` : sp.length ? '물리존을 골라' : '층을 바꿔'} 그 자리로 옮겼습니다${out.missing ? ` (이 화면의 BIM 에 없는 id ${out.missing})` : ''}`
    : `이 화면에 연 BIM 에는 답의 대상이 없습니다${ids.length ? ` (id ${ids.length})` : ''}`
  return out
}

// 3D 와 고른 설비 패널을 같이 창 가득 띄운다(넓게 보기). 3D 만 띄우면 설비를 눌러도 무엇을 골랐는지 안 보인다.
export const stage = ref<HTMLElement | null>(null)

/**
 * 3D 아래(표·검사·목록)에서 고를 때. 고른 결과는 3D 와 오른쪽 패널에 뜨는데 화면이 아래에 머물면 안 보이니,
 * 작업 화면이 가려져 있으면 올려 보인다. 이미 보이면 움직이지 않는다 — 표를 보며 여럿을 차례로 고를 때 흔들리지 않게.
 */
export function selectAndShow(id: string) {
  select(id)
  revealStage()
}
/** 작업 화면(3D·오른쪽 패널)이 가려져 있으면 올려 보인다. 이미 보이면 움직이지 않는다. */
export function revealStage() {
  const el = stage.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--appbar-h')) || 0
  if (r.top < top - 1 || r.top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
/**
 * 넓게 보기. 브라우저 전체 화면(requestFullscreen)이 아니라 작업 영역을 창 가득 키운다 — 브라우저 전체 화면은 Esc 를 브라우저가 먼저 받아
 * 꺼 버려서, 설비를 고르고 Esc(선택 해제)를 누르면 전체 화면이 꺼졌다(2026-10-16). 페이지는 Esc 를 되찾을 수 없고(Keyboard Lock 은 https 만),
 * F11 을 대신 누를 수도 없어서, 탭 · 주소창까지 숨기려면 사람이 F11 을 누르게 안내한다. 사람이 누른 F11 은 Esc 로 꺼지지 않는다.
 */
export const fullscreen = ref(false)

// 도구막대 높이를 재서 작업 화면(3D + 오른쪽 패널)이 남은 높이를 쓰게 한다. 폭이 좁으면 막대가 두 줄이 되고, 편집 중에는
// 편집 줄이 붙는다 — 높이를 고정값으로 빼면 그때마다 3D 아래가 잘린다.
export const appbar = ref<HTMLElement | null>(null)
const appbarObserver = new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--appbar-h', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`)
})
export function toggleFullscreen() {
  fullscreen.value = !fullscreen.value
  if (fullscreen.value) note('넓게 보기 — 나가기 Ctrl+\\ · 탭 · 주소창까지 숨기려면 F11')
}

// dev 서버가 data/ 의 .ifc 목록을 준다(vite.config.ts). 빌드 번들에선 실패하고 빈 목록이 된다.
export const dataFiles = ref<{ path: string; size: number }[]>([])

// 첫 화면의 [바로 열기] 묶음(예: 성수 건축 + 기계, 성수 전부). data/.open-sets.json 에 적고, 파일이 다 있는 것만 온다(server/data-catalog.ts).
export const openSetList = ref<{ title: string; paths: string[] }[]>([])

// 파일마다 온톨로지를 어디까지 채우는지. dev 서버가 앱과 같은 임포터로 재서 준다(vite.config.ts).
// 한 파일에 1초 남짓 걸려서 목록을 먼저 보이고, 요약은 하나씩 채운다.
type Profiled = { profile: Profile } | { error: string }
export const profiles = ref<Record<string, Profiled>>({})

/** 목록에 보이는 data/ 파일. 등급을 재다 오류가 난(열 수 없는) 파일은 뺀다. 재기 전에는 보인다. */
export const openableDataFiles = computed(() => dataFiles.value.filter((f) => !errorAt(f.path)))

export const baseName = (path: string) => path.split('/').pop() ?? path
export const profileAt = (path: string): Profile | null => {
  const p = profiles.value[path]
  return p && 'profile' in p ? p.profile : null
}
const errorAt = (path: string): string => {
  const p = profiles.value[path]
  return p && 'error' in p ? p.error : ''
}

/** data/ 에서 연 파일. 짝 파일(건축 ↔ 설비)을 권할 때 쓴다. 손으로 고른 파일이면 null. */
export const openedDataPath = ref<string | null>(null)

export function openData(path: string) {
  void openMany([{ name: baseName(path), read: () => fetchData(path), dataPath: path }], 'open').then(() => {
    openedDataPath.value = fileName.value === baseName(path) ? path : null
  })
}

export function appendData(path: string) {
  void openMany([{ name: baseName(path), read: () => fetchData(path), dataPath: path }], 'append')
}

/** 목록에서 고른 파일. 건축·설비를 같이 골라 한 번에 연다. */
export const dataPicked = ref<string[]>([])
export function toggleDataPick(path: string) {
  dataPicked.value = dataPicked.value.includes(path) ? dataPicked.value.filter((p) => p !== path) : [...dataPicked.value, path]
}
export function openDataSet(paths: readonly string[]) {
  const list = [...paths]
  dataPicked.value = []
  void openMany(list.map((path) => ({ name: baseName(path), read: () => fetchData(path), dataPath: path })), 'open').then(() => {
    openedDataPath.value = null
  })
}

/** 짝 파일(profile.ts 의 partnerOf). 판본이 여럿인 폴더에서는 권하지 않는다. */
export function partnerOf(path: string | null): string | null {
  return path ? findPartner(path, dataFiles.value.map((f) => ({ path: f.path, profile: profileAt(f.path) }))) : null
}

/** 요약 옆에 붙이는 한마디. 이 파일이 혼자 쓰이는지, 짝이 필요한지. */
export function roleHint(p: Profile): string {
  if (p.needsArchitecture) return '방이 없습니다. 건축 파일과 합쳐 쓰는 파일입니다'
  if (p.needsEquipment) return '설비가 없습니다. 설비 파일을 덧붙여 쓰는 파일입니다'
  return ''
}

export function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupChatView() {
  ;  (window as unknown as { __editor3d?: { show: typeof showFromChat } }).__editor3d = { show: showFromChat }
  onBeforeUnmount(() => delete (window as unknown as { __editor3d?: unknown }).__editor3d)
  watch(appbar, (el, old) => {
    if (old) appbarObserver.unobserve(old)
    if (el) appbarObserver.observe(el)
  })
  onBeforeUnmount(() => appbarObserver.disconnect())
  fetch('./__data/__sets')
    .then((r) => (r.ok ? r.json() : []))
    // 모양이 다른 답(옛 서버·시험의 가짜 목록)은 버린다 — 제목과 경로 목록이 있는 것만.
    .then((sets) => (openSetList.value = Array.isArray(sets) ? sets.filter((x) => x && typeof x.title === 'string' && Array.isArray(x.paths) && x.paths.length) : []))
    .catch(() => {})
  fetch('./__data/')
    .then((r) => (r.ok ? r.json() : []))
    .then(async (files) => {
      dataFiles.value = Array.isArray(files) ? files : []
      for (const f of dataFiles.value) {
        try {
          const r = await fetch(`./__data/${f.path.split('/').map(encodeURIComponent).join('/')}?profile`)
          if (r.ok) profiles.value = { ...profiles.value, [f.path]: await r.json() }
        } catch {
          // 요약을 못 받아도 파일은 열 수 있다. 칸을 비워 둔다.
        }
      }
    })
    .catch(() => {})
}
