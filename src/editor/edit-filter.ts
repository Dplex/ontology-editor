import { computed, type Directive, ref, triggerRef, watch } from 'vue'
import { zoneNamesOfEquipment } from '../lib/custom-zone'
import { renameSpace, sameNameSpaces, setSpacesKind, type Snapshot, snapshotSpace } from '../lib/edit'
import { resolveRoomKind, roomKind } from '../lib/kinds'
import { type Equipment, isConduit } from '../lib/model'
import type { Surface } from '../lib/mount'
import { kindLabel } from './checks'
import { fileName, model } from './core'
import { surfaceRows } from './edit-report'
import { mark, remember } from './history'
import { selectedSpace } from './space-objects'

// --- 편집 목록을 좁히기 ----------------------------------------------------------
//
// 성수는 물리존 934개·설비 1만 8천 대다. 전부 한 번에 그리면 스크롤이 끝나지 않고 브라우저도
// 그만큼 느려진다. 그래서 행이 많은 목록은 처음부터 접어 두고(SMALL), 펼쳐도 앞의 EDIT_LIMIT
// 행만 그린다. 층과 이름으로 좁히면 원하는 행에 닿는다.
export const SMALL = 50
export const EDIT_LIMIT = 200
export const editStorey = ref('')
export const editQuery = ref('')
/**
 * 설비 목록의 설치면 거르기(OE-OBJ-08 "설치면 필터"). 그 면에 놓을 수 있는 종류를 남긴다 — CCTV 는 천장·벽 둘 다에 든다.
 * `none` 은 설치면을 정하지 않은 종류(표에 없는 종류·종류 모름)다. 덕트·배관은 거르면 빠진다.
 */
export const surfaceFilter = ref<'' | Surface | 'none'>('')
export const editLimit = ref(EDIT_LIMIT)

/** 층이나 이름으로 좁혔나. 표 머리의 수를 "찾은 것 N / 전체" 로 바꾼다 — 전체 수만 두었더니 좁혀 0건인 표가 비어 보였다. */
export const narrowed = computed(() => !!editStorey.value || !!editQuery.value.trim() || !!surfaceFilter.value)
const matches = (text: string) => {
  const q = editQuery.value.trim().toLowerCase()
  return !q || text.toLowerCase().includes(q)
}
const editStoreys = computed(() =>
  (model.value?.storeys ?? []).filter((s) => !editStorey.value || s.id === editStorey.value),
)
// 설치면 필터(OE-EQP-05). 기준은 판정 설치면이고 플레넘은 천장으로 센다. "미정" 은 판정하지 못한 설비다. 도관과 설치면 없는 종류
// (배관·덕트 위 밸브·댐퍼)는 어느 면에도 들지 않는다.
const judgedById = computed(() => new Map(surfaceRows.value.map((r) => [r.equipment.id, r.judged])))
const surfaceMatches = (e: Equipment) => {
  const f = surfaceFilter.value
  if (!f) return true
  if (isConduit(e.role) || !judgedById.value.has(e.id)) return false
  const judged = judgedById.value.get(e.id) ?? null
  if (f === 'none') return judged === null
  if (f === 'ceiling') return judged === 'ceiling' || judged === 'plenum'
  return judged === f
}
export const editSpaces = computed(() =>
  editStoreys.value
    .flatMap((storey) => storey.spaces.map((space) => ({ storey, space })))
    .filter(({ space }) => matches(`${space.name} ${space.longName ?? ''}`)),
)
// 설비는 소속 방 이름으로도 찾는다. 보기 모드에는 물리존 표가 없어서, "S.T"·"OFFICE" 를 치면 아무것도 안 나왔다.
// 든 커스텀존의 이름·별명으로도 찾는다(ADR-0004) — "임원석" 을 치면 그 존 안의 설비가 나온다.
export const editEquipment = computed(() => {
  const zoneText = new Map<string, string>()
  if (editQuery.value.trim() && model.value) for (const [id, names] of zoneNamesOfEquipment(model.value)) zoneText.set(id, names.join(' '))
  return editStoreys.value.flatMap((s) => {
    const room = new Map(s.spaces.map((sp) => [sp.id, `${sp.name} ${sp.longName ?? ''}`]))
    return s.equipment.filter(
      (e) => surfaceMatches(e) && matches(`${e.name} ${e.ifcClass} ${kindLabel(e)} ${e.spaceId ? room.get(e.spaceId) ?? '' : ''} ${zoneText.get(e.id) ?? ''}`),
    )
  })
})

/**
 * 치는 중인 칸을 모델 값으로 덮지 않는다(`v-keep-typing`).
 *
 * Vue 는 화면을 다시 그릴 때마다 `:value` 를 칸에 다시 넣는다. 편집 뒤 등급을 다시 재는 타이머(TIERS_DELAY)가
 * 화면을 다시 그리면, 그 사이 오른쪽 패널에서 치던 방 이름·좌표가 원래 값으로 돌아갔다(App 템플릿에 바로 있는
 * 칸이라 App 이 다시 그려질 때마다 덮인다. 아래 표는 Fold 슬롯이라 덜 걸리지만 같은 수를 둔다). 포커스가 있고
 * 사람이 값을 바꾼 칸만 지킨다. 넣는 것은 여전히 change(Enter·칸 나가기) 한 번이다.
 */
const typing = new WeakMap<HTMLInputElement, string>()
export const vKeepTyping: Directive<HTMLInputElement> = {
  beforeUpdate(el, _binding, _vnode, prev) {
    if (document.activeElement !== el) return
    if (el.value !== String(prev.props?.value ?? '')) typing.set(el, el.value)
  },
  updated(el) {
    const draft = typing.get(el)
    if (draft === undefined) return
    typing.delete(el)
    el.value = draft
  },
}

export function applyRename(spaceId: string, name: string) {
  if (!model.value) return
  const snapshot = snapshotSpace(model.value, spaceId)
  if (snapshot?.kind === 'space' && snapshot.longName === name) return
  const at = mark()
  if (!renameSpace(model.value, spaceId, name)) return
  remember(`이름 ${snapshot?.kind === 'space' ? snapshot.longName || '(없음)' : ''} → ${name}`, snapshot, at)
  triggerRef(model)
}

/**
 * 방 종류를 사람이 정한다(OE-SPC-17). 같은 공간명의 방(모든 층)에 함께 붙이고, 되돌리기는 한 번이다. `undefined` 는 [이름으로 정하기]
 * — 사람이 정한 것을 거두고 이름 사전으로 돌린다.
 */
export function applySpaceKind(spaceId: string, kind: string | null | undefined) {
  const m = model.value
  if (!m) return
  const group = sameNameSpaces(m, spaceId)
  const snapshot: Snapshot = { kind: 'many', parts: group.flatMap((s) => snapshotSpace(m, s.id) ?? []) }
  const at = mark()
  const n = setSpacesKind(m, group.map((s) => s.id), kind)
  if (!n) return
  const name = group[0]?.longName.trim() || group[0]?.name || ''
  const to = kind === undefined ? '이름으로 정하기' : kind === null ? '모름' : (roomKind(kind)?.label ?? kind)
  remember(`방 종류 ${name}${n > 1 ? ` ${n}개` : ''} → ${to}`, snapshot, at)
  triggerRef(model)
}
/** 고른 물리존과 공간명이 같은 방(모든 층). 종류를 고르면 이만큼에 함께 붙는다. */
export const sameNameGroup = computed(() => (selectedSpace.value && model.value ? sameNameSpaces(model.value, selectedSpace.value.space.id) : []))
/** 이름 사전(→ OmniClass)이 읽는 종류. [이름으로 정하기] 옆에 보인다. */
export const dictKindOfSelected = computed(() => {
  const s = selectedSpace.value?.space
  const read = s ? resolveRoomKind(s.name, s.longName, s.omniclass ?? null) : null
  return read ? read.info.label : '모름'
})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupEditFilter() {
  watch([editStorey, editQuery, fileName, () => surfaceFilter.value], () => {
    editLimit.value = EDIT_LIMIT
  })
  watch(fileName, () => {
    editStorey.value = ''
    editQuery.value = ''
  })
}
