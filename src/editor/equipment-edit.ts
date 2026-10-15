import { computed, nextTick, ref, triggerRef, watch } from 'vue'
import { ceilingOf } from '../lib/ceiling'
import { addEquipment, deleteEquipment, renameEquipment, snapshotEquipment, snapshotEquipmentSet } from '../lib/edit'
import { josa } from '../lib/josa'
import { equipmentKind, resolveEquipmentKind } from '../lib/kinds'
import { LAYA_MIN, layaKinds, type LayaPick, newEquipmentText } from '../lib/laya'
import { type Equipment, isConduit, type Vec2, type Vec3 } from '../lib/model'
import { allowedLabel, allowedSurfaces } from '../lib/mount'
import { overlapForNew } from '../lib/overlap'
import { ceilingMode, editLock, refuseLock } from './ceiling'
import { connectFrom, nameOfId } from './connections'
import { editing, model } from './core'
import { borrowedShape, cm, refuseOverlap, shortName, syncBorrowedShapes } from './equipment-shape'
import { equipmentById, flowVersion, ruleReport, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { layaState, selectedSystemId } from './kinds'
import { editNotice, storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { meshes } from './open-file'
import { stopDraw, stopPlace } from './place'
import { currentBox, redraw } from './redraw'
import { selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { askStorey, selectedCustomZoneId, targetStorey } from './space-edit'
import { drawing, selectedObjectId } from './space-objects'
import { selectedVerticalId } from './vertical'

// --- 설비 더하기·지우기·이름 (E7) ---------------------------------------------------------
//
// 더하기는 [설비 더하기] 를 누르고 바닥을 누른다. 종류는 모르는 채 바닥 높이에 놓고 고르게 한다 — 종류와 높이를
// 지어내지 않는다. 지우면 붙은 연결·계통 자리도 같이 빠지고 Ctrl+Z 로 그대로 돌아온다(edit.ts).
/** `object` 는 추가 공간 오브젝트(OE-SPC-14)이고 `item` 이 라이브러리 항목이다. */
/** `copyOf` 는 [같은 모양으로 더하기] 의 원본 설비(ADR-0059). */
export const adding = ref<{ storeyId: string; elevation: number; what: 'equipment' | 'door' | 'window' | 'object'; item?: string; copyOf?: string } | null>(null)
export function startAddEquipment() {
  const storey = targetStorey()
  if (!storey) return askStorey('설비를 더할')
  if (ceilingMode.value && !ceilingOf(storey)) {
    editNotice.value = `${storey.name}의 천장고를 모릅니다. 천장 설비를 놓기 전에 왼쪽 도구에서 천장고를 입력하세요.`
    return
  }
  stopPlace()
  stopDraw()
  connectFrom.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  // 천장 모드에서 더한 설비는 반자 높이에 놓는다(종류를 정하기 전이라 반자 부착으로 본다).
  const z = ceilingMode.value ? storey.elevation + ceilingOf(storey)!.height : storey.elevation
  adding.value = { storeyId: storey.id, elevation: z, what: 'equipment' }
  viewer?.setPlaceMode(z)
  // 이름부터 치게 이름 칸으로 간다. 치지 않고 바로 바닥을 눌러도 된다(종류 미상으로 놓인다).
  void nextTick(() => addNameInput.value?.focus())
  note(ceilingMode.value ? `${storey.name} 천장에 설비를 놓을 자리를 3D에서 클릭하세요 (Esc 취소)` : `${storey.name}에 설비를 놓을 바닥을 3D에서 클릭하세요 (Esc 취소)`)
}
/**
 * 고른 설비와 종류·모양이 같은 설비를 더한다(ADR-0059). 바닥을 누르면 놓이고, 높이는 원본이 제 층 바닥에서 떠 있던 만큼이다.
 * 연결·계통·소속은 복사하지 않는다 — 원본에 붙은 배관을 새 설비가 가져가면 엉뚱한 곳이 이어진다.
 */
export function startDuplicate(e: Equipment) {
  if (e.flowType || isConduit(e.role)) {
    note('덕트·배관은 복제하지 않습니다. 배관 그리기로 잇습니다')
    return
  }
  startAddEquipment()
  const a = adding.value
  if (!a || a.what !== 'equipment') return
  const st = model.value?.storeys.find((s) => s.id === a.storeyId)
  const home = storeyOf(e.id)
  if (!st) return
  const lift = e.position && home ? e.position[2] - home.elevation : 0
  adding.value = { ...a, elevation: st.elevation + lift, copyOf: e.id }
  viewer?.setPlaceMode(st.elevation + lift)
  note(`${st.name}에 ${shortName(e.name)}${josa(shortName(e.name), '과/와')} 같은 모양의 설비를 놓을 자리를 3D에서 클릭하세요 (Esc 취소)`)
}
export function stopAdd() {
  if (!adding.value) return
  adding.value = null
  viewer?.setPlaceMode(null)
}
/** 사람이 [설비 더하기] 를 그만둔다(Esc·[더하기 취소]). 친 이름과 고른 종류도 버린다 — 다음 더하기에 묻지 않고 남지 않게. */
export function cancelAddEquipment() {
  stopAdd()
  addName.value = ''
  addKind.value = null
}

/**
 * 놓기 전에 이름을 치면 종류 후보를 보인다(ADR-0057). 사전이 이름을 읽으면 그것이 먼저(출처 사전), 이어서 Laya 의 후보(확률).
 * **고르지 않으면 지금처럼 종류 미상으로 놓는다**(OE-EQP-13) — 사람이 칩을 누르거나 Enter 로 첫 후보를 받아야 그 종류로 놓인다.
 */
export const addName = ref('')
export const addNameInput = ref<HTMLInputElement | null>(null)
export const addKind = ref<string | null>(null)
const addLaya = ref<LayaPick[]>([])
export const addSuggestions = computed(() => {
  const name = addName.value.trim()
  if (!name) return []
  const dict = resolveEquipmentKind(name)?.info.kind ?? null
  const out: { kind: string; p: number | null }[] = dict ? [{ kind: dict, p: null }] : []
  // 5% 아래는 보이지 않는다 — 0% 칩이 셋째 자리를 채워 고를 것처럼 보였다(Duplex 에서 쳐 본 12개 중 9개).
  for (const s of addLaya.value) if (s.p >= LAYA_MIN && equipmentKind(s.kind) && !out.some((o) => o.kind === s.kind) && out.length < 3) out.push(s)
  return out
})
let addAsk = 0
export function acceptAddKind() {
  if (!addKind.value && addSuggestions.value.length) addKind.value = addSuggestions.value[0].kind
}
/** 고른 종류가 지금 놓는 면(천장 모드인가)에 놓이지 않는 종류면 알린다. 막지는 않는다. */
export const addMountHint = computed(() => {
  const allowed = allowedSurfaces(addKind.value)
  if (!addKind.value || !allowed) return ''
  const fits = ceilingMode.value ? allowed.includes('ceiling') : allowed.some((s) => s !== 'ceiling')
  const label = equipmentKind(addKind.value)!.label
  return fits ? '' : `${label}${josa(label, '은/는')} ${allowedLabel(addKind.value)}에 놓는 종류입니다${ceilingMode.value ? '' : ' — 천장이면 T 로 천장 모드'}`
})
export function addEquipmentAt(at: Vec2) {
  const m = model.value
  const target = adding.value
  stopAdd()
  if (!m || !target) return
  const n = m.storeys.reduce((k, st) => k + st.equipment.filter((e) => e.added).length, 0) + 1
  const position: Vec3 = [cm(at[0]), cm(at[1]), cm(target.elevation)]
  // 새 설비는 종류를 정하기 전까지 배관 없는 설비로 본다. 다른 배관 없는 설비 자리에는 더하지 않는다(OE-OBJ-16).
  const blocked = overlapForNew(m, target.storeyId, position, currentBox)
  if (blocked) return refuseOverlap(blocked)
  const mk = mark()
  // 복제면 원본의 종류·모양을 따른다. 원본도 더한 설비면 그 설비가 빌린 BIM 설비가 모양의 원본이다. 아니면 팔레트에서 미리 고른 종류·이름이다.
  const src = target.copyOf ? (equipmentById.value.get(target.copyOf) ?? null) : null
  const shapeOf = src ? (src.added ? (borrowedShape.value.get(src.id) ?? src.shapeOf) : meshes.has(src.id) ? src.id : undefined) : undefined
  const kind = src ? (src.kind ?? null) : addKind.value
  const e = addEquipment(m, target.storeyId, { name: src ? `${shortName(src.name)} 복제` : addName.value.trim() || `새 설비 ${n}`, kind, position, shapeOf })
  if (!e) return
  addName.value = ''
  addKind.value = null
  const snapshot = snapshotEquipmentSet(m, e.id)
  if (snapshot?.kind === 'equipment-set') remember(`${e.name} 더하기`, { ...snapshot, present: false }, mk)
  syncBorrowedShapes()
  triggerRef(model)
  redraw()
  selectedId.value = e.id
  const from = borrowedShape.value.get(e.id)
  const shape = from ? ' 같은 종류 BIM 설비의 모양을 따릅니다.' : ''
  note(
    src
      ? `${e.name}${josa(e.name, '을/를')} 놓았습니다. ${from ? '원본과 같은 모양입니다' : '원본에 형상이 없어 상자로 그립니다'}. 연결·계통은 비어 있습니다`
      : kind
        ? `${e.name}${josa(e.name, '을/를')} ${ceilingMode.value ? '천장고' : '바닥 높이'}에 놓았습니다(종류 ${equipmentKind(kind)!.label}).${shape} 높이를 오른쪽 패널에서 정하세요`
        : `${e.name}${josa(e.name, '을/를')} ${ceilingMode.value ? '천장고' : '바닥 높이'}에 놓았습니다. 종류를 정하면 같은 종류 설비의 모양을 따릅니다`,
  )
}
export function removeEquipment(id: string) {
  const m = model.value
  if (!m) return
  const target = equipmentById.value.get(id)
  const lock = target ? editLock(target) : null
  if (target && lock) return refuseLock(target, lock)
  const name = nameOfId(id)
  const snapshot = snapshotEquipmentSet(m, id)
  const at = mark()
  const done = deleteEquipment(m, id)
  if (!done || !snapshot) return
  remember(`${name} 지우기`, snapshot, at)
  ruleReport.value = done.rules
  if (selectedId.value === id) selectedId.value = null
  triggerRef(model)
  flowVersion.value++
  redraw()
  note(`${name}${josa(name, '을/를')} 지웠습니다${done.connections ? `(연결 ${done.connections}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
}
export function renameEquipmentTo(id: string, name: string) {
  const m = model.value
  const trimmed = name.trim()
  if (!m || !trimmed) return
  const target = equipmentById.value.get(id)
  const lock = target ? editLock(target) : null
  if (target && lock) return refuseLock(target, lock)
  const snapshot = snapshotEquipment(m, id)
  const at = mark()
  if (!renameEquipment(m, id, trimmed)) return
  remember(`${shortName(trimmed)} 이름 고침`, snapshot, at)
  triggerRef(model)
}

// --- 벽·문·창 편집 (E4) -----------------------------------------------------------------
//
// [벽·문·창] 을 켜면 3D 에 벽 외곽선과 문·창 자리가 서고, 바닥을 누르면 물리존보다 벽·문·창을 먼저 고른다. 고른 것은
// 방향키로 옮기고(10cm, Shift 1m) 오른쪽 패널에서 내력 여부를 정하거나 지운다. 벽은 두 점으로 긋고 문·창은 벽 가까이
// 누른다. 물리존 경계는 벽에서 다시 만들지 않는다(edit.ts). IFC 형상으로 그리는 내력벽 겹은 편집이 따라가지 않으니,
// 이 층을 켠 동안에는 숨기고 끌 때 다시 그린다.
export const archMode = ref(false)
export const selectedElementId = ref<string | null>(null)

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupEquipmentEdit() {
  // 이름이 바뀌면 고른 종류를 버린다(다른 이름의 후보다).
  watch(
    () => addName.value.trim(),
    () => (addKind.value = null),
  )
  watch(
    () => [addName.value.trim(), ceilingMode.value, adding.value?.what === 'equipment', layaState.value?.enabled] as const,
    ([name, ceiling, on, enabled]) => {
      if (!name || !on || !enabled) {
        addLaya.value = []
        return
      }
      // 이미 고른 종류가 있으면 다시 묻지 않는다 — 천장 모드를 바꾸면(T) 글이 바뀌어 다시 물었고, 새 답에 그 종류가 없으면 고른 것이 말없이 빠졌다.
      if (addKind.value) return
      const ask = ++addAsk
      const text = newEquipmentText(name, ceiling)
      // 치는 동안은 묻지 않는다 — 멈추고 0.15초 뒤에 한 번. 늦게 온 답이 새 이름의 답을 덮지 않게 번호를 본다.
      setTimeout(() => {
        if (ask !== addAsk) return
        layaKinds([text])
          .then((got) => {
            if (ask === addAsk) addLaya.value = got.get(text)?.ranked ?? []
          })
          .catch(() => {})
      }, 150)
    },
  )
  watch(editing, (on) => {
    if (!on && drawing.value) stopDraw()
    if (!on) stopAdd()
    if (!on) archMode.value = false
  })
  // 수직 관통 오브젝트 조각(OE-ML-05)은 다른 것을 고르면 푼다. 고르는 곳이 여럿이라(표·목록·3D·평면도) 하나하나에 넣지 않고 여기서 본다.
  watch([selectedId, selectedSpaceId, selectedRoomId, selectedObjectId, selectedElementId, selectedCustomZoneId, selectedSystemId], (now) => {
    if (now.some((x) => x)) selectedVerticalId.value = null
  })
}
