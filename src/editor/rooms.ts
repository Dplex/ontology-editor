import { computed, ref, triggerRef, watch } from 'vue'
import { snapshotRooms } from '../lib/edit'
import { josa } from '../lib/josa'
import { isConduit, type Model } from '../lib/model'
import { deleteRoom, findRoom, moveRoom, renameRoom } from '../lib/room'
import { snapAxis } from '../lib/shortcuts'
import { findPart } from '../lib/vertical-object'
import { editPart, SPACE_IN_EQUIPMENT } from './ceiling'
import { whatIs } from './checks'
import { editing, model } from './core'
import { cm } from './equipment-shape'
import { selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { editNotice } from './multi-select'
import { sceneVersion } from './redraw'
import { viewer } from './scene'
import { selectedObjectId, selectedSpace } from './space-objects'
import { selectedVerticalId, selectVertical } from './vertical'

// --- 3D 에서 고른 물리존 (E2) ------------------------------------------------------
//
// 바닥을 누르면 그 물리존이 골라진다. 편집 모드면 꼭짓점에 손잡이가 뜬다. 설비 선택과 배타다.
export const selectedSpaceId = ref<string | null>(null)
export const spaceDevices = computed(() => selectedSpace.value?.equipment.filter((e) => !isConduit(e.role)) ?? [])
/** 기기가 많은 방(성수 사무실 318대)은 목록 위에 종류별 수를 한 줄로 둔다. */
export const spaceKinds = computed(() => {
  const n = new Map<string, number>()
  for (const e of spaceDevices.value) {
    const k = whatIs(e)?.label ?? '모름'
    n.set(k, (n.get(k) ?? 0) + 1)
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(' · ')
})
export const spaceConduits = computed(() => selectedSpace.value?.equipment.filter((e) => isConduit(e.role)) ?? [])
/** 3D 바닥이나 평면도의 방을 눌렀을 때. 평면도가 제 안에만 들고 있었더니 방에 테두리만 뜨고 패널은 앞서 고른 설비였다. */
export function pickSpace(id: string | null) {
  // 수직 관통 오브젝트 조각(OE-ML-05)도 바닥 누르기로 골라진다 — 룸·물리존보다 먼저다.
  if (id && model.value && findPart(model.value, id)) {
    selectVertical(id)
    return
  }
  selectedVerticalId.value = null
  // 룸(OE-OBJ-03)은 물리존과 같은 바닥 누르기로 골라진다 — 룸 아래 물리존보다 먼저다.
  if (id && model.value && findRoom(model.value, id)) {
    selectedRoomId.value = id
    selectedSpaceId.value = null
    selectedId.value = null
    selectedSystemId.value = null
    return
  }
  selectedRoomId.value = null
  if (id) selectedObjectId.value = null
  selectedSpaceId.value = id
  if (id) {
    selectedId.value = null
    selectedSystemId.value = null
  }
}
// --- 룸 (OE-OBJ-03 · OE-SPC-11) --------------------------------------------------------------
/** 리포트의 룸 줄. 연 때는 룸이 없으니(임포트는 만들지 않는다) 있는 룸이 전부 편집이다. */
export const roomLines = computed(() =>
  (model.value?.storeys ?? []).flatMap((st) =>
    (st.rooms ?? []).map((r) => {
      const parent = st.spaces.find((sp) => sp.id === r.spaceId)
      const [[x0, y0], , [x1, y1]] = r.footprint
      return { id: r.id, name: r.name, storey: st.name, parent: parent?.longName || parent?.name || '물리존', size: `${(x1 - x0).toFixed(2)} × ${(y1 - y0).toFixed(2)} m` }
    }),
  ),
)
export const selectedRoomId = ref<string | null>(null)
export const selectedRoom = computed(() => {
  const m = model.value
  const id = selectedRoomId.value
  if (!m || !id) return null
  const found = findRoom(m, id)
  if (!found) return null
  const parent = found.storey.spaces.find((sp) => sp.id === found.room.spaceId)
  const [[x0, y0], , [x1, y1]] = found.room.footprint
  return { ...found, parent, width: x1 - x0, depth: y1 - y0 }
})
/** 겹쳐서 막은 상대 룸. 잠깐 붉게 보인다(OE-SPC-15). */
const roomConflict = ref<string | null>(null)
let roomConflictTimer: number | undefined
/**
 * 룸을 고친다. 층의 룸을 통째로 떠 두고 되돌린다(snapshotRooms). 막히면 이유를 알리고, 겹친 상대가 있으면 붉게 짚는다.
 * `storeyId` 를 모르면(고친 룸 id 로) 찾는다.
 */
export function changeRooms(roomId: string | null, label: string, apply: (m: Model) => unknown, storeyId?: string): boolean {
  const m = model.value
  if (!m) return false
  const sid = storeyId ?? (roomId ? findRoom(m, roomId)?.storey.id : undefined)
  if (!sid) return false
  const snapshot = snapshotRooms(m, sid)
  const at = mark()
  const done = apply(m) as boolean | { refused: string; blocked?: string } | null
  if (!done) return false
  if (typeof done === 'object' && 'refused' in done) {
    editNotice.value = done.refused
    if (done.blocked) {
      roomConflict.value = done.blocked
      window.clearTimeout(roomConflictTimer)
      roomConflictTimer = window.setTimeout(() => (roomConflict.value = null), 1600)
    }
    // 끌던 손잡이를 원래 자리로 다시 그린다.
    sceneVersion.value++
    return false
  }
  editNotice.value = ''
  remember(label, snapshot, at)
  triggerRef(model)
  return true
}
export function removeRoom() {
  const r = selectedRoom.value
  if (!r) return
  const name = r.room.name
  if (changeRooms(r.room.id, `${name} 지우기`, (m) => deleteRoom(m, r.room.id))) {
    selectedRoomId.value = null
    note(`${name}${josa(name, '을/를')} 지웠습니다. 그 자리는 ${r.parent?.longName || r.parent?.name || '물리존'}으로 돌아갑니다. Ctrl+Z 로 되돌립니다`)
  }
}
export function applyRoomName(name: string) {
  const r = selectedRoom.value
  if (r) changeRooms(r.room.id, `룸 이름 ${name.trim()}`, (m) => renameRoom(m, r.room.id, name))
}
/** 방향키로 고른 룸을 옮긴다(10cm, Shift 1m). 화면 방향에 가장 가까운 평면 축이다(설비 옮기기와 같다). */
export function nudgeRoom(code: string, step: number): boolean {
  const r = selectedRoom.value
  if (!r || !viewer) return false
  if (editPart.value !== 'space') {
    editNotice.value = SPACE_IN_EQUIPMENT
    return true
  }
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  changeRooms(r.room.id, `${r.room.name} 옮김`, (m) => moveRoom(m, r.room.id, [cm(sign * ax * step), cm(sign * ay * step)]))
  return true
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupRooms() {
  watch([model, sceneVersion, selectedRoomId, roomConflict, editing], () => viewer?.setRooms(model.value, selectedRoomId.value, roomConflict.value))
}
