import { computed, ref, watch } from 'vue'
import { EDIT_FORMAT, type EditFile, parseEditFile } from '../lib/edit-file'
import { floorSummary } from '../lib/floor-summary'
import { buildingsOf, summaryOf } from '../lib/projects'
import { replayOpen } from '../lib/replay-player'
import { isFull } from '../lib/space-checklist'
import { BUILDING, joinParts, partSig, splitByStorey } from '../lib/storey-drafts'
import { fullscreen } from './chat-view'
import { appliedFloors, autosaveKey, currentParts, dirtyKeys, draft, draftKey, draftsVersion, editCount, editsIn, floorDrafts, floorName, floorsInView, homeOf, openSettled, publishedFile, savedParts, setFloorDrafts, setOpenSettled, unsavedCount } from './autosave'
import { baseline } from './changes'
import { checksByStorey, whatIs } from './checks'
import { editing, fileName, model } from './core'
import { exitAsk, resetToOpened } from './exit-edit'
import { exteriorEditor } from './facade'
import { selectedId } from './flow-rules'
import { future, history } from './history'
import { note } from './keyboard'
import { viewStorey } from './multi-view'
import { pristine } from './open-file'
import { asMe, people } from './people'
import { applyEditFile } from './progress'
import { openedProject, serverKey } from './projects'
import { pickSpace, selectedSpaceId } from './rooms'
import { selectedCustomZoneId } from './space-edit'

// --- 화면 레이아웃의 층 표시(OE-UI-04) ---
/** 층마다의 상태(미편집 · 저장 안 된 편집 · 임시 저장). 편집이 쌓이거나 저장할 때 다시 잰다. */
export const floorStates = computed(() => {
  void history.value
  void future.value
  const m = model.value
  if (!m || !baseline.value) return new Map<string, string>()
  const parts = currentParts()
  const dirty = new Set(dirtyKeys(parts))
  const saved = savedParts.value
  return new Map(m.storeys.map((st) => [st.id, dirty.has(st.id) ? '저장 안 된 편집' : editsIn(saved.get(st.id)) > 0 ? '임시 저장' : '미편집']))
})
/** 액션바의 위치 표시 "사이트 › 건물 › 층"(OE-UI-04 AC14). 사이트는 프로젝트의 사이트, 없으면 BIM 의 사이트 이름이다. */
export const breadcrumb = computed(() => {
  const m = model.value
  if (!m) return null
  return { site: openedProject.value?.site || m.siteName || '(사이트 이름 없음)', building: m.buildingName || '(건물 이름 없음)', storey: floorName(viewStorey.value) }
})
/** 층 선택 칸의 건물 묶음 머리(OE-UI-04 AC13): 건물 · 층 범위 · 임시 저장한 층 수 / 층 수. 공통 표시 규칙은 OE-UI-03(lib/projects.ts). */
export const storeyGroup = computed(() => {
  const m = model.value
  if (!m) return null
  const states = floorStates.value
  const drafts = m.storeys.filter((st) => states.get(st.id) === '임시 저장').map((st) => ({ floor: st.id, by: '', savedAt: '' }))
  const [b] = buildingsOf({ summary: summaryOf(m), drafts })
  return b ? { label: `${b.name} · ${b.range} · 임시 저장 ${b.drafted}/${b.storeys.length}개 층`, storeys: b.storeys } : null
})
/** 오른쪽 패널의 현재 층 현황(OE-UI-04 AC9). */
export const floorNow = computed(() => (model.value ? floorSummary(model.value, viewStorey.value ? [viewStorey.value] : null, (e) => whatIs(e)?.label ?? null) : null))
/** 층 요약의 "다 찬 방". 한 층이면 그 층, 모든 층이면 층마다 센 합이다. */
export const floorFullRooms = computed(() => {
  const m = model.value
  if (!m) return null
  const ids = viewStorey.value ? [viewStorey.value] : m.storeys.map((s) => s.id)
  let have = 0
  let of = 0
  for (const id of ids) for (const c of checksByStorey(id).values()) {
    of++
    if (isFull(c)) have++
  }
  return of ? { have, of } : null
})
export const floorNowStatus = computed(() => {
  const states = floorStates.value
  if (viewStorey.value) return states.get(viewStorey.value) ?? ''
  const n = (s: string) => [...states.values()].filter((v) => v === s).length
  return `저장 안 된 편집 ${n('저장 안 된 편집')} · 임시 저장 ${n('임시 저장')} · 미편집 ${n('미편집')}개 층`
})
export function pickFromSummary(kind: 'space' | 'room' | 'customZone', id: string) {
  if (kind === 'customZone') {
    selectedId.value = null
    selectedSpaceId.value = null
    selectedCustomZoneId.value = id
    return
  }
  pickSpace(id)
}

/** 조각을 갈아 끼우고 연 때부터 다시 얹는다. 값이 null 이면 그 조각을 뺀다(연 때로). */
export function replaceParts(next: Map<string, EditFile | null>, from: string) {
  if (!model.value || !baseline.value || !pristine) return
  const parts = currentParts()
  for (const [k, part] of next) {
    if (part) parts.set(k, part)
    else parts.delete(k)
  }
  resetToOpened()
  if (parts.size) applyEditFile(joinParts(parts.values(), { format: EDIT_FORMAT, version: 1, source: fileName.value, savedAt: new Date().toISOString() }), from, true)
}

/** 편집 중인 층에 임시 저장본이 있으면 묻지 않고 얹는다(OE-WF-02). 건물 조각은 처음 한 번 같이 얹는다. */
function enterFloors() {
  if (!editing.value || !openSettled || !model.value) return
  const keys = [...floorsInView(), BUILDING].filter((k) => floorDrafts.has(k) && !appliedFloors.has(k))
  if (!keys.length) return
  replaceParts(new Map(keys.map((k) => [k, floorDrafts.get(k)!])), '임시 저장본')
  const saved = new Map(savedParts.value)
  for (const k of keys) {
    appliedFloors.add(k)
    saved.set(k, floorDrafts.get(k)!)
  }
  savedParts.value = saved
  const names = keys.filter((k) => k !== BUILDING).map(floorName)
  note(`${names.length ? names.join(' · ') : '건물'}의 임시 저장본을 열었습니다. 이어서 편집합니다`)
}

/** 열기(8084 저장본 얹기까지)가 끝났다. 연 상태를 저장된 상태로 두고, 자동 저장이 돌아올 상태와 다르면 묻고, 임시 저장본을 얹는다. */
export function settleOpen() {
  if (!model.value || !baseline.value || openSettled) return
  setOpenSettled(true)
  savedParts.value = currentParts()
  try {
    const raw = localStorage.getItem(autosaveKey())
    const file = raw ? parseEditFile(raw) : null
    if (file && typeof file !== 'string' && editCount(file) > 0) {
      const expected = new Map(savedParts.value)
      for (const [k, part] of floorDrafts) expected.set(k, part)
      const got = splitByStorey(file, homeOf)
      const keys = new Set([...expected.keys(), ...got.keys()])
      if ([...keys].some((k) => partSig(expected.get(k)) !== partSig(got.get(k)))) draft.value = { file, count: editCount(file), savedAt: file.savedAt }
      else localStorage.removeItem(autosaveKey())
    }
  } catch {
    // 저장소를 못 읽으면 물을 것도 없다
  }
  enterFloors()
}

/** 서버의 층별 임시 저장본을 맞춘다(있으면 덮고, 없어진 조각은 지운다). 사람 목록이 없는 곳은 브라우저에만 남는다. */
export function syncDraftsToServer(keys: string[], parts: Map<string, EditFile>) {
  const key = serverKey.value
  if (!key || !people.value) return
  for (const k of keys) {
    const part = parts.get(k)
    const url = `./__data/__drafts?${new URLSearchParams({ key, floor: k })}`
    void fetch(url, part ? { method: 'PUT', headers: asMe(), body: JSON.stringify(part) } : { method: 'DELETE', headers: asMe() })
      .then(async (r) => {
        if (!r.ok) note(`임시 저장본을 서버에 두지 못했습니다(${(await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`}). 이 브라우저에는 남았습니다`)
      })
      .catch(() => {})
  }
}
/** [임시 저장본 폐기](OE-WF-04) 확인 중. */
export const discardAsk = ref(false)
/** 폐기할 층: 보고 있는 층. 층이 하나뿐인 건물은 그 층이다. */
const discardFloor = computed(() => viewStorey.value ?? (model.value?.storeys.length === 1 ? model.value.storeys[0].id : null))
export const canDiscardDraft = computed(() => {
  void draftsVersion.value
  return editing.value && !!discardFloor.value && floorDrafts.has(discardFloor.value)
})
/** 지금 층의 임시 저장본을 지우고 반영된 레이아웃(없으면 BIM)으로 돌린다. 되돌릴 수 없다. */
export function discardFloorDraft() {
  const floor = discardFloor.value
  const key = serverKey.value
  discardAsk.value = false
  if (!floor || !model.value) return
  if (key && people.value) void fetch(`./__data/__drafts?${new URLSearchParams({ key, floor })}`, { method: 'DELETE', headers: asMe() }).catch(() => {})
  try {
    localStorage.removeItem(draftKey(floor))
  } catch {
    // 못 지워도 서버 것은 지웠다
  }
  floorDrafts.delete(floor)
  appliedFloors.delete(floor)
  draftsVersion.value++
  const published = publishedFile.value ? (splitByStorey(publishedFile.value, homeOf).get(floor) ?? null) : null
  replaceParts(new Map([[floor, published]]), '반영된 레이아웃')
  const saved = new Map(savedParts.value)
  if (published) saved.set(floor, published)
  else saved.delete(floor)
  savedParts.value = saved
  note(`${floorName(floor)}의 임시 저장본을 폐기했습니다. ${publishedFile.value ? '반영된 레이아웃' : 'BIM 그대로'}로 돌아왔습니다`)
}

/** 이 파일의 임시 저장본을 전부 지운다. 저장(8084·파일·구축하기)하면 임시 저장본은 쓸모가 없다. */
export function clearDrafts() {
  const key = serverKey.value
  if (key && people.value) void fetch(`./__data/__drafts?${new URLSearchParams({ key })}`, { method: 'DELETE', headers: asMe() }).catch(() => {})
  draftsVersion.value++
  try {
    const prefix = draftKey('')
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // 못 지워도 다음 임시 저장이 덮는다
  }
  setFloorDrafts(new Map())
}

// 저장 안 한 편집이 있는 층에서 다른 층으로 가려 하면 묻는다. 묻는 동안은 층을 그대로 둔다. 표에서 다른 층의 것을 골라 층이
// 따라가는 것도 같은 길이다. 대화상자를 거쳐 옮길 때(goFloor)와 "모든 층" 으로 넓힐 때는 묻지 않는다.
let switching = false
export function goFloor(id: string | null) {
  switching = true
  viewStorey.value = id
  switching = false
}

// --- 8084 에 저장 (OE-COM-08 "저장 시 변경사항을 웹에서 바로 확인") ----------------------------------
//
// data/ 에서 연 파일은 [편집 저장] 이 편집 파일을 서버(src/server/saved-edits.ts)에 둔다. 같은 파일을 8084 에서 여는 사람은
// 누구나 그 편집을 얹은 채로 본다. 손으로 연 파일은 서버에 원본이 없어서 예전처럼 파일로 내려받는다. 임시 저장은 서버에
// 오지 않는다(이 브라우저에만, "웹에 반영되지 않는다").
export let loadingPath: string | null = null
export function setLoadingPath(v: typeof loadingPath) {
  loadingPath = v
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupLayoutStoreys() {
  watch([editing, viewStorey], enterFloors)
  watch(
    viewStorey,
    (now, was) => {
      // "모든 층" 으로 넓히는 것은 다른 층으로 가는 것이 아니다 — 그 층도 계속 보이고 고칠 수 있다.
      // 외벽 에디터(OE-EXT-03)는 전 층을 한 번에 고친다. 층마다 물으면 [저장 안 함]이 한 층만 되돌려 같은 면이 어긋난다.
      // 편집 리플레이가 장면 따라 층을 옮기는 것은 사람이 층을 떠나는 것이 아니다.
      if (switching || replayOpen.value || !openSettled || !editing.value || !was || !now || now === was || exteriorEditor.value) return
      const parts = currentParts()
      if (!dirtyKeys(parts).includes(was)) return
      switching = true
      viewStorey.value = was
      switching = false
      fullscreen.value = false
      exitAsk.value = { count: unsavedCount([was], parts), floor: { from: was, to: now } }
    },
    { flush: 'sync' },
  )
}
