import { computed, nextTick, ref, triggerRef } from 'vue'
import { setSpaceNumber, snapshotSpace, snapshotStoreyName } from '../lib/edit'
import { resolveRoomKind, roomKind } from '../lib/kinds'
import { resetStoreyName, setStoreyName, storeyNamed } from '../lib/storey-name'
import { model } from './core'
import { mark, remember } from './history'
import { note } from './keyboard'
import { editNotice } from './multi-select'
import { sceneVersion } from './redraw'

/** 리포트 줄: 사람이 정한 방 종류를 공간명마다 한 줄로(OE-SPC-17). */
// --- 층 이름 (storey-name.ts) ---
// 이름 없는 층이 있으면 등급 0(층 이름 100%)이 미달이라 [구축하기] 가 막힌다. 기초 층처럼 BIM 이 이름을 비운 층은 여기서 넣는다. 고친 층은
// BIM 이름을 들고 있어 리포트·편집 파일·출처 표시가 그것을 본다.
export const storeyNameLines = computed(() => {
  void model.value
  void sceneVersion.value
  return (model.value?.storeys ?? []).filter(storeyNamed).map((st) => ({ id: st.id, from: st.bimName?.trim() || '(없음)', to: st.name }))
})
export const storeyNameEditing = ref<string | null>(null)
export const storeyNameInput = ref('')
export function startStoreyName(storeyId: string) {
  storeyNameEditing.value = storeyId
  storeyNameInput.value = model.value?.storeys.find((st) => st.id === storeyId)?.name ?? ''
  void nextTick(() => document.querySelector<HTMLInputElement>('.storey-name-input')?.select())
}
export function saveStoreyName(storeyId: string, reset = false) {
  const m = model.value
  const st = m?.storeys.find((x) => x.id === storeyId)
  if (!m || !st) return
  const snapshot = snapshotStoreyName(m, storeyId)
  const at = mark()
  const from = st.name.trim() || '(없음)'
  const done = reset ? resetStoreyName(m, storeyId) : setStoreyName(m, storeyId, storeyNameInput.value)
  if (done !== true && done !== false) return note(done.refused)
  storeyNameEditing.value = null
  if (!done) return
  remember(`층 이름 ${from} → ${st.name.trim() || '(없음)'}`, snapshot, at)
  triggerRef(model)
  sceneVersion.value++
  note(reset ? `층 이름을 BIM 이름(${st.name.trim() || '없음'})으로 돌렸습니다` : `층 이름을 '${st.name}' 로 정했습니다. TTL 의 층 이름과 GeoJSON 층 파일 이름이 바뀝니다`)
}
export const spaceKindLines = computed(() => {
  void model.value
  const m = model.value
  if (!m) return []
  const rows = new Map<string, { key: string; name: string; count: number; from: string; to: string }>()
  for (const s of m.storeys.flatMap((st) => st.spaces)) {
    if (s.kindSource !== 'edit') continue
    const read = resolveRoomKind(s.name, s.longName, s.omniclass ?? null)
    const from = read ? read.info.label : '모름'
    const to = roomKind(s.kind)?.label ?? '모름'
    const name = s.longName.trim() || s.name || s.id
    const key = `${name}|${from}|${to}`
    const row = rows.get(key) ?? { key, name, count: 0, from, to }
    row.count++
    rows.set(key, row)
  }
  return [...rows.values()]
})

/** 방번호를 고친다(OE-OBJ-02). 같은 층에 같은 번호가 있으면 막고 칸을 원래 번호로 돌린다. */
export function applySpaceNumber(spaceId: string, input: HTMLInputElement) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotSpace(m, spaceId)
  const was = snapshot?.kind === 'space' ? (snapshot.name ?? '') : ''
  const at = mark()
  const done = setSpaceNumber(m, spaceId, input.value)
  if (done !== true) {
    if (done) editNotice.value = done.refused
    input.value = was
    return
  }
  remember(`방번호 ${was || '(없음)'} → ${input.value.trim() || '(없음)'}`, snapshot, at)
  triggerRef(model)
}
