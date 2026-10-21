import { computed, ref, shallowRef, triggerRef } from 'vue'
import { type BoundaryChange, type Change, deleteEquipment, EXTERIOR_ONLY, exteriorOnly, moveEquipment, moveEquipmentToStorey, onExteriorFace, type Snapshot, snapshotEquipment, snapshotEquipmentSet, snapshotServedZones } from '../lib/edit'
import type { RuleReport } from '../lib/flow-rules'
import { josa } from '../lib/josa'
import { type Equipment, isConduit, type Vec3 } from '../lib/model'
import { overlapAt } from '../lib/overlap'
import { snapAxis } from '../lib/shortcuts'
import { editLock, refuseLock } from './ceiling'
import { kindLabel } from './checks'
import { model } from './core'
import { changes } from './edit-report'
import { selectedElementId } from './equipment-edit'
import { cm, moveInScene, noticeServedReleased, refuseOverlap, shortName } from './equipment-shape'
import { equipmentById, flowVersion, ruleReport, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { goFloor } from './layout-storeys'
import { viewStorey } from './multi-view'
import { currentBox, redraw, shiftMesh } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedCustomZoneId } from './space-edit'

// --- 여러 개 고르기 (OE-UI-09) -------------------------------------------------------------
//
// 설비만 여러 개 고른다(2026-10-03 사용자 결정). 편집 모드에서 Ctrl+클릭(3D·평면도·설비 목록)으로 넣고 빼고, Ctrl+끌기로 상자 안의
// 설비를 더한다(키는 DT 2.0 과 같다, #56). 덕트·배관은 넣지 않는다(상자에 수백 개가 딸려 온다). 둘 이상이면 고른 설비 패널 대신 묶음 패널이 뜨고, 방향키·끌기로
// 같이 옮기고 Delete 로 같이 지운다 — 되돌리기 한 번에 전부. 하나만 남으면 보통 고르기로 돌아간다.
export const group = ref<string[]>([])
/** 여러 개 고르기에 넣을 수 있는가. 좌표가 있는 기기(덕트·배관이 아닌 것)만. */
const groupable = (id: string) => {
  const e = equipmentById.value.get(id)
  return !!e && !isConduit(e.role)
}
export function setGroup(ids: readonly string[]) {
  const next = [...new Set(ids)].filter(groupable)
  if (next.length >= 2) {
    group.value = next
    selectedId.value = null
    selectedSpaceId.value = null
    selectedSystemId.value = null
    selectedElementId.value = null
    selectedCustomZoneId.value = null
  } else {
    group.value = []
    selectedId.value = next[0] ?? null
  }
}
/** Ctrl+클릭. 고른 하나가 있으면 그것부터 묶음에 넣는다. */
export function toggleGroup(id: string) {
  if (!groupable(id)) {
    note('덕트·배관은 여러 개 고르기에 넣지 않습니다')
    return
  }
  const base = group.value.length ? group.value : selectedId.value ? [selectedId.value] : []
  setGroup(base.includes(id) ? base.filter((x) => x !== id) : [...base, id])
}
/** Ctrl+끌기 상자. 덕트·배관을 빼고 지금 묶음에 더한다. */
export function addBoxToGroup(ids: readonly string[]) {
  const devices = ids.filter(groupable)
  if (!devices.length) return note('상자 안에 고를 설비가 없습니다(덕트·배관은 빼고 셉니다)')
  const base = group.value.length ? group.value : selectedId.value ? [selectedId.value] : []
  setGroup([...base, ...devices])
  if (group.value.length) note(`설비 ${group.value.length}대를 골랐습니다. 방향키·드래그로 같이 옮기고 Delete 로 같이 지웁니다`)
}
export const groupItems = computed(() => group.value.map((id) => equipmentById.value.get(id)).filter((e): e is Equipment => !!e))

// --- 종류로 거르고 같은 종류 모두 고르기 (OE-UI-24) ---------------------------------------------
// 종류는 설비 종류(OE-EQP-14, `Equipment.kind`)다. 사전에 없는 것(`null`)은 "종류 모름" 한 줄로 센다. 선택은 화면에만 있고 저장본·TTL·GeoJSON 에 남지 않는다.
export const UNKNOWN_KIND = '종류 모름'
const kindKey = (e: Equipment) => e.kind ?? ''
const kindText = (e: Equipment) => (e.kind ? kindLabel(e) || e.kind : UNKNOWN_KIND)
/** 고른 묶음의 종류별 개수. 많은 것부터, 같으면 이름 순. */
export const groupKinds = computed(() => {
  const n = new Map<string, { key: string; label: string; count: number }>()
  for (const e of groupItems.value) {
    const row = n.get(kindKey(e)) ?? { key: kindKey(e), label: kindText(e), count: 0 }
    row.count++
    n.set(kindKey(e), row)
  }
  return [...n.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'))
})
/** 묶음에서 한 종류를 뺀다. 하나만 남으면 보통 고르기로 돌아가고, 다 빠지면 선택이 풀린다. */
export function dropKindFromGroup(key: string) {
  setGroup(groupItems.value.filter((e) => kindKey(e) !== key).map((e) => e.id))
}
/**
 * 고른 설비와 같은 종류를 모두 고른다. `building` 이면 다른 층 것까지 고르고(화면에는 지금 층만 그린다, OE-UI-12), 아니면 그 설비가 있는 층만이다.
 * 덕트·배관은 여러 개 고르기에 넣지 않는다(위 `groupable`). 같은 종류가 자기 하나뿐이면 아무것도 바꾸지 않는다.
 */
export function selectSameKind(scope: 'storey' | 'building'): boolean {
  const m = model.value
  const base = selectedId.value ? equipmentById.value.get(selectedId.value) : null
  if (!m || !base) return false
  const home = storeyOf(base.id)
  const pool = scope === 'building' ? m.storeys : m.storeys.filter((s) => s.id === home?.id)
  const ids = pool.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role) && kindKey(e) === kindKey(base)).map((e) => e.id)
  if (ids.length < 2) {
    note(`같은 종류(${kindText(base)})가 ${scope === 'building' ? '건물에' : '이 층에'} 하나뿐입니다`)
    return false
  }
  setGroup(ids)
  const floors = new Set(groupItems.value.map((e) => storeyOf(e.id)?.id)).size
  note(`${kindText(base)} ${group.value.length}대를 골랐습니다${scope === 'building' ? `(${floors}개 층)` : ''}`)
  return true
}

/**
 * 묶음을 평면으로 같이 옮긴다. 하나라도 막히면(겹침 OE-OBJ-16 · 외벽 전용 OE-OBJ-04) 아무것도 옮기지 않는다 — 일부만 옮기면 묶음의
 * 모양이 깨진다. 묶음끼리는 같은 거리를 가니 서로의 옛 자리와 견주지 않는다. 붙은 배관은 따라오지 않는다. `dragged` 는 3D 에서 끌어
 * 이미 그려 둔 하나다.
 */
export function moveGroup(dx: number, dy: number, dragged?: { id: string; drawnAt: Vec3 }, coalesce?: string): boolean {
  const m = model.value
  const items = groupItems.value
  if (!m || items.length < 2) return false
  const revert = () => {
    const was = dragged ? equipmentById.value.get(dragged.id)?.position : null
    if (dragged && was) viewer?.shiftEquipment(dragged.id, [was[0] - dragged.drawnAt[0], was[1] - dragged.drawnAt[1], was[2] - dragged.drawnAt[2]], true)
  }
  if (items.some((e) => !e.position)) {
    revert()
    editNotice.value = '좌표가 없는 설비가 묶음에 있어 같이 옮기지 않습니다. 먼저 그 설비를 놓으세요.'
    return false
  }
  const locked = items.find((e) => editLock(e))
  if (locked) {
    revert()
    refuseLock(locked, `${editLock(locked)} 묶음을 옮기지 않았습니다.`)
    return false
  }
  const members = new Set(items.map((e) => e.id))
  const targets = items.map((e) => ({ e, from: e.position!, to: [cm(e.position![0] + dx), cm(e.position![1] + dy), e.position![2]] as Vec3 }))
  for (const { e, to } of targets) {
    const home = storeyOf(e.id)
    if (home && exteriorOnly(e) && !onExteriorFace(home, [to[0], to[1]])) {
      revert()
      editNotice.value = `${shortName(e.name)}: ${EXTERIOR_ONLY} 묶음을 옮기지 않았습니다.`
      return false
    }
    const blocked = overlapAt(m, e.id, to, currentBox, undefined, members)
    if (blocked) {
      revert()
      const name = shortName(blocked.name)
      editNotice.value = `이미 오브젝트가 있는 위치입니다(${shortName(e.name)}${josa(shortName(e.name), '이/가')} ${name}${josa(name, '과/와')} 겹칩니다). 묶음을 옮기지 않았습니다.`
      viewer?.markConflict(blocked.id)
      return false
    }
  }
  const served = new Map(targets.flatMap(({ e }) => snapshotServedZones(m, e.id)).map((x) => [x.kind === 'hvac-zones' ? x.storeyId : '', x]))
  const snapshot: Snapshot = { kind: 'many', parts: [...targets.flatMap(({ e }) => snapshotEquipment(m, e.id) ?? []), ...served.values()] }
  const at = mark()
  const done: Change[] = []
  for (const { e, to } of targets) {
    const change = moveEquipment(m, e.id, to)
    if (change) done.push(change)
  }
  noticeServedReleased(done)
  remember(`설비 ${items.length}대 옮김`, snapshot, at, coalesce)
  for (const { e, from, to } of targets) {
    if (dragged?.id === e.id) shiftMesh(e.id, from, dragged.drawnAt)
    moveInScene(e.id, dragged?.id === e.id ? dragged.drawnAt : from, to)
  }
  changes.value = [...changes.value, ...done]
  triggerRef(model)
  return true
}
/** 방향키로 묶음을 옮긴다. 화면의 오른쪽·위쪽에 가장 가까운 평면 축으로(한 대 옮기기와 같다). 꾹 누르면 되돌리기 한 단계로 묶인다. */
export function nudgeGroup(code: string, step: number): boolean {
  if (!viewer) return false
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  if (moveGroup(sign * ax * step, sign * ay * step, undefined, 'group-nudge')) note(`설비 ${group.value.length}대를 같이 옮겼습니다`)
  return true
}
/** 묶음을 같이 지운다. 붙은 연결도 같이 빠지고, 되돌리기 한 번에 전부 돌아온다. */
export function deleteGroup(): boolean {
  const m = model.value
  const items = groupItems.value
  if (!m || items.length < 2) return false
  const locked = items.find((e) => editLock(e))
  if (locked) {
    refuseLock(locked, `${editLock(locked)} 묶음을 지우지 않았습니다.`)
    return true
  }
  const parts = items.flatMap((e) => snapshotEquipmentSet(m, e.id) ?? [])
  const at = mark()
  let connections = 0
  let rules: RuleReport | null = null
  for (const e of items) {
    const done = deleteEquipment(m, e.id)
    if (!done) continue
    connections += done.connections
    rules = done.rules
  }
  remember(`설비 ${items.length}대 지우기`, { kind: 'many', parts }, at)
  if (rules) ruleReport.value = rules
  group.value = []
  triggerRef(model)
  flowVersion.value++
  redraw()
  note(`설비 ${items.length}대를 지웠습니다${connections ? `(연결 ${connections}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
  return true
}

/** 설비를 다른 층으로(E6). 높이도 두 층 바닥의 차만큼 옮기므로 3D 를 다시 그린다. */
/** 설비를 다른 층으로 옮긴다. 옮긴 층에서 배관 없는 설비와 겹치게 되면 옮기지 않고 false 다(OE-OBJ-16). */
export function moveToStorey(equipmentId: string, storeyId: string): boolean {
  if (!model.value) return false
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  const moving = equipmentById.value.get(equipmentId)
  const lock = moving ? editLock(moving) : null
  if (moving && lock) {
    refuseLock(moving, lock)
    return false
  }
  const target = model.value.storeys.find((s) => s.id === storeyId)
  if (moving && target && exteriorOnly(moving) && !(before && onExteriorFace(target, [before[0], before[1]]))) {
    editNotice.value = `${EXTERIOR_ONLY} 그 층의 같은 자리는 외벽 바깥 면이 아닙니다. 층을 옮긴 뒤 [벽에 붙이기]로 붙이세요.`
    return false
  }
  // 층을 옮기면 x·y 는 그대로이고 z 가 층 높이 차만큼 바뀐다(moveEquipmentToStorey). 그 자리로 미리 잰다.
  const from = storeyOf(equipmentId)
  if (before && from && target && from !== target) {
    const to: Vec3 = [before[0], before[1], before[2] + target.elevation - from.elevation]
    const blocked = overlapAt(model.value, equipmentId, to, currentBox, storeyId)
    if (blocked) {
      refuseOverlap(blocked)
      return false
    }
  }
  const own = snapshotEquipment(model.value, equipmentId)
  const served = snapshotServedZones(model.value, equipmentId)
  const snapshot: Snapshot | null = own && served.length ? { kind: 'many', parts: [own, ...served] } : own
  const at = mark()
  const change = moveEquipmentToStorey(model.value, equipmentId, storeyId)
  if (!change) return false
  noticeServedReleased([change])
  remember(`${shortName(change.equipmentName)} 층 옮김`, snapshot, at)
  moveInScene(equipmentId, before, equipmentById.value.get(equipmentId)?.position ?? null)
  changes.value = [...changes.value, change]
  storeyMoved.value = new Set([...storeyMoved.value, equipmentId])
  triggerRef(model)
  // 한 층만 보고 있으면 옮긴 층으로 따라간다. 안 따라가면 고른 설비가 화면에서 사라진 것처럼 보였다. 방금 한 편집을 따라가는 것이라
  // 층 바꾸기를 묻지 않는다(goFloor) — 옮긴 편집은 원래 층의 것으로 남는다(storey-drafts.ts).
  if (viewStorey.value && viewStorey.value !== storeyId) goFloor(storeyId)
  return true
}
/** 패널의 층 칸. 막히면 칸을 지금 층으로 되돌린다 — 고른 층이 남으면 옮겨진 것처럼 보인다. */
export function onStoreyPick(equipmentId: string, select: HTMLSelectElement) {
  if (!moveToStorey(equipmentId, select.value)) select.value = storeyOf(equipmentId)?.id ?? ''
}
/** 사람이 층을 바꾼 설비. 층 칸의 출처를 BIM 에서 편집으로 바꾼다. */
export const storeyMoved = ref(new Set<string>())

export const storeyOf = (equipmentId: string) =>
  model.value?.storeys.find((s) => s.equipment.some((e) => e.id === equipmentId)) ?? null

/** 3D 편집이 받아들이지 않은 것을 한 줄로 알린다. 조용히 제자리로 돌리면 왜 안 됐는지 모른다. */
export const editNotice = ref('')

// 경계 편집은 넓이와 설비 소속을 동시에 흔든다. 두 변화를 같은 자리에서 보여 준다.
// changes 처럼 새 배열로만 바꾼다(edit-report.ts).
export const areaChanges = shallowRef<BoundaryChange[]>([])
export const selfIntersecting = computed(() => areaChanges.value.some((c) => c.selfIntersecting))
