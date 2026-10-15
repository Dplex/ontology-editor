import { computed, ref, triggerRef, watch } from 'vue'
import { ceilingOf, ceilingZone, checkCeilingZ } from '../lib/ceiling'
import { type FollowPlan, snapshotCustomZones } from '../lib/edit'
import { josa } from '../lib/josa'
import { type Equipment, isConduit, type Model, segmentPath, type Storey, type Vec2 } from '../lib/model'
import { canMountOn, surfaceOf } from '../lib/mount'
import { replayOpen } from '../lib/replay-player'
import { storeysEntered } from '../lib/storey-z'
import type { CeilingView } from '../lib/viewer'
import { connectFrom } from './connections'
import { editing, model } from './core'
import { ceilingGuessOf, meters, storeyHeightOf } from './edit-report'
import { archMode, selectedElementId, stopAdd } from './equipment-edit'
import { shortName } from './equipment-shape'
import { equipmentById, selected, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { editNotice, group, storeyOf } from './multi-select'
import { openMultiView, storeysByHeight, viewStorey } from './multi-view'
import { stopDraw, stopPlace } from './place'
import { sceneVersion } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { askStorey, ceilingMarks, selectedCustomZone, selectedCustomZoneId, targetStorey } from './space-edit'
import { drawing, objectsOpen } from './space-objects'
import { select } from './systems'
import { MULTI_VIEW_ONLY, multiView } from './vertical'

// --- 천장 편집 모드 (OE-OBJ-08) ----------------------------------------------------------------
//
// 설비 편집의 [바닥·벽 / 천장] 토글(T)에서 천장 쪽이다. 들어가면 선택과 하던 조작을 끝내고, 위에서 내려다보고, 층마다 반자 높이에
// 반투명 천장면을 그린다. 천장 설비만 놓고·옮기고·지우고·이름과 종류를 고친다(옮기기는 x·y 만, z 는 패널). 나머지는 회색이고 고르기·
// 조회만 된다. 바닥·벽 쪽(평소 편집)에서는 거꾸로 천장 설비가 고르기·조회만 된다. 모드는 화면 상태라 저장하지 않는다.
export const ceilingMode = ref(false)
/**
 * 편집 대상(OE-UI-04). 공간(물리존·룸·커스텀존·벽·문·창·추가 오브젝트)과 설비(설비·배관·천장). 팔레트가 그 모드의 도구만 보이고, 다른 모드의
 * 오브젝트는 고르고 볼 수 있지만 끌거나 방향키로 옮기면 막고 어느 모드에서 고치는지 알린다. 되돌리기 이력은 모드와 상관없이 하나다.
 */
export const editPart = ref<'space' | 'equipment'>('equipment')
const EQUIPMENT_IN_SPACE = '설비는 설비 편집 모드에서 편집합니다([설비] 또는 M).'
export const SPACE_IN_EQUIPMENT = '물리존·룸·벽은 공간 편집 모드에서 편집합니다([공간] 또는 M).'
/** 천장 설비 id(좌표가 있는 것). 바닥 링과 같은 판단이다. */
const ceilingIds = computed(() => new Set(ceilingMarks.value.map((m) => m.id)))
const IN_CEILING_MODE = '천장 설비는 천장 편집 모드에서 편집합니다([천장] 또는 T).'
const NOT_ON_CEILING = '천장에 설치할 수 없는 설비입니다.'
/** 수직 관통 오브젝트인 설비 종류(OE-OBJ-14). */
const VERTICAL_DEVICES = new Set(['elevator', 'escalator'])
export const VERTICAL_LOCKED = '엘리베이터·에스컬레이터는 수직 관통 오브젝트라 층 편집 화면에서는 옮기거나 지우지 않습니다. 다중층 뷰에서 편집합니다.'
export const CROSS_STOREY_LOCKED = '다른 층으로 이어진 덕트·배관 구간이라 층 편집 화면에서는 형상을 바꾸지 않습니다. 다중층 뷰에서 편집합니다.'
/**
 * 덕트·배관 구간이 자기 층을 벗어나 들어간 다른 층(OE-ML-05). 층 편집 화면은 이런 구간을 옮기거나 늘이지 않는다 — 한 층만 보며 고치면
 * 보이지 않는 층의 경로가 바뀐다. 같은 층 안에서 그 구간의 이음쇠에 배관을 이어 그리는 것은 된다(형상을 바꾸지 않는다).
 */
const crossStorey = computed(() => {
  void sceneVersion.value
  const m = model.value
  const out = new Map<string, Storey[]>()
  if (!m) return out
  for (const st of m.storeys)
    for (const e of st.equipment) {
      if (e.role !== 'segment') continue
      const p = segmentPath(e)
      const entered = p && 'path' in p ? storeysEntered(m, st.id, p.path) : []
      if (entered.length) out.set(e.id, entered)
    }
  return out
})
const enteredOf = (e: Equipment): Storey[] => crossStorey.value.get(e.id) ?? []
/** 그 구간이 걸친 층들로 다중층 뷰를 연다. */
export function openMultiViewForSegment(e: Equipment) {
  const home = storeyOf(e.id)
  if (!home) return
  const ids = new Set([home.id, ...enteredOf(e).map((s) => s.id)])
  const list = storeysByHeight.value.filter((st) => ids.has(st.id))
  if (list.length) openMultiView(list[0].id, list.at(-1)!.id)
}
/** 옮기면 늘어날 구간 중 다른 층으로 이어진 것. 층 편집 화면에서는 그 이동을 막는다. */
export function crossingFollower(plan: FollowPlan | null): Equipment | null {
  for (const s of plan?.stretch ?? []) {
    const e = equipmentById.value.get(s.id)
    if (e && enteredOf(e).length) return e
  }
  return null
}
export const crossingText = (moving: Equipment, seg: Equipment) =>
  `${shortName(moving.name)}${josa(shortName(moving.name), '을/를')} 옮기면 다른 층(${enteredOf(seg).map((s) => s.name).join('·')})으로 이어진 ${shortName(seg.name)}의 형상이 바뀝니다. 층 편집 화면에서는 바꾸지 않습니다 — 다중층 뷰에서 편집하거나 [배관도 같이] 를 끄고 옮깁니다.`
/**
 * 지금 모드에서 이 설비를 고칠 수 없는 이유. 고칠 수 있으면 null. 좌표가 없는 설비는 놓을 면으로 가른다 — 천장 모드에서는 천장에 놓을
 * 수 있는 종류, 바닥·벽 쪽에서는 천장 전용이 아닌 종류다(OE-EQP-02).
 */
export function editLock(e: Equipment): string | null {
  if (!editing.value) return null
  // 다중층 뷰는 수직 관통 오브젝트와 덕트·배관만 고친다(OE-ML-01·07, OE-PIP-10 AC1). 설비는 고르고 보기만 — 3D 에서 안 끌리고 패널의
  // 좌표·지우기 칸도 없다. 덕트·배관은 층 편집과 같은 패널(꼭짓점 넣기·지우기, 꺾임점 좌표, 끝 대상 바꾸기, 구간 지우기)을 쓴다 — 층을 넘는
  // 구간도 여기서는 고친다. 3D 끌기는 다중층 뷰 전체에서 꺼져 있다.
  if (multiView.value) return isConduit(e.role) ? null : MULTI_VIEW_ONLY
  // 엘리베이터·에스컬레이터는 수직 관통 오브젝트라 층 편집 화면에서는 고르고 보기만 한다(OE-EQP-07·OE-ML-05). 종류는 고칠 수 있다 —
  // 이름 사전이 잘못 읽은 것을 풀 길이 없으면 그 설비가 계속 잠긴다.
  if (VERTICAL_DEVICES.has(e.kind ?? '')) return VERTICAL_LOCKED
  if (enteredOf(e).length) return CROSS_STOREY_LOCKED
  if (editPart.value === 'space') return EQUIPMENT_IN_SPACE
  if (!e.position) {
    if (ceilingMode.value) return isConduit(e.role) ? '덕트·배관은 바닥·벽 쪽에서 편집합니다.' : canMountOn(e, 'ceiling') ? null : NOT_ON_CEILING
    return surfaceOf(e) === 'ceiling' ? '천장 전용 설비는 천장 편집 모드에서 놓습니다([천장] 또는 T).' : null
  }
  const on = ceilingIds.value.has(e.id)
  if (!ceilingMode.value) return on ? IN_CEILING_MODE : null
  if (on) return null
  if (isConduit(e.role)) return '덕트·배관은 바닥·벽 쪽에서 편집합니다.'
  return canMountOn(e, 'ceiling') ? '바닥·벽 설비는 바닥·벽 쪽에서 편집합니다.' : NOT_ON_CEILING
}
/** 막았다고 알린다. 천장에 놓을 수 없는 설비면 3D 에 붉게 짚는다. */
export function refuseLock(e: Equipment, why: string) {
  editNotice.value = `${shortName(e.name)}: ${why}`
  if (why === NOT_ON_CEILING) viewer?.markConflict(e.id)
}
/** 고른 설비를 지금 모드에서 고칠 수 없으면 그 이유. 패널의 편집 칸을 숨기고 이 말을 보인다. */
export const selectedLock = computed(() => {
  // 종류를 바꿔도 고른 설비는 같은 객체라 selected 만 보면 다시 재지 않는다(엘리베이터로 바꾼 뒤 되돌려도 잠금이 남았다). 모델을 읽는다.
  void model.value
  void sceneVersion.value
  return selected.value ? editLock(selected.value) : null
})
/** 지금 보는 층(천장 모드의 기준). */
export const ceilingStorey = computed(() => (ceilingMode.value ? (model.value?.storeys.find((st) => st.id === viewStorey.value) ?? null) : null))
/** 천장 모드인데 지금 층의 반자 높이를 모른다 — 입력을 받기 전에는 천장 설비를 놓지 않는다. */
export const ceilingAsk = computed(() => {
  // 층 객체는 편집해도 같은 객체라 ceilingStorey 만 보면 다시 재지 않는다 — model 을 직접 읽는다(triggerRef).
  const st = model.value?.storeys.find((x) => x.id === viewStorey.value)
  return ceilingMode.value && !!st && !ceilingOf(st)
})

export function setEditPart(part: 'space' | 'equipment') {
  if (part === editPart.value || !editing.value) return
  // 하던 것을 끝낸다 — 공간 모드에서 설비를 놓던 상태가 남으면 헷갈린다.
  stopPlace()
  stopAdd()
  if (drawing.value) stopDraw()
  connectFrom.value = null
  if (part === 'space') {
    if (ceilingMode.value) ceilingMode.value = false
    group.value = []
  } else {
    archMode.value = false
    objectsOpen.value = false
  }
  editPart.value = part
  note(part === 'space' ? '공간 편집 모드입니다 — 물리존·룸·커스텀존·벽·문·창·오브젝트를 고칩니다. 설비는 고르고 보기만 합니다(M)' : '설비 편집 모드입니다 — 설비·배관·천장 설비를 고칩니다. 공간은 고르고 보기만 합니다(M)')
}

export function setCeilingMode(on: boolean) {
  if (on === ceilingMode.value) return
  // 천장은 설비 편집 모드의 한쪽이다.
  if (on && editPart.value === 'space') setEditPart('equipment')
  if (!on) {
    ceilingMode.value = false
    note('천장 편집 모드를 나왔습니다. 바닥·벽 쪽입니다')
    return
  }
  if (!editing.value) return
  const st = targetStorey()
  if (!st) return askStorey('천장을 편집할')
  // 들어갈 때 하던 것을 끝낸다 — 바닥에 놓던 설비를 천장 높이로 놓게 되면 헷갈린다.
  stopPlace()
  stopAdd()
  if (drawing.value) stopDraw()
  connectFrom.value = null
  archMode.value = false
  group.value = []
  select(null)
  selectedSpaceId.value = null
  selectedElementId.value = null
  selectedCustomZoneId.value = null
  ceilingMode.value = true
  if (viewStorey.value !== st.id) viewStorey.value = st.id
  // 층을 바꾸면 위 watch 가 시점을 맞춘다. 같은 층이면 여기서 내려다본다.
  else viewer?.topView()
  note(ceilingOf(st) ? `천장 편집 모드입니다 — ${st.name} 천장고 ${meters(ceilingOf(st)!.height)}. 천장 설비만 놓고 옮깁니다(T 로 나가기)` : `천장 편집 모드입니다. ${st.name}의 천장고를 먼저 입력하세요`)
}
/** 천장 모드에서 잠긴 도구를 눌렀다. 어디서 편집하는지 알린다(OE-OBJ-08). */
export function lockedTool() {
  editNotice.value = '천장 편집 모드에서는 공간을 고치지 않습니다. 공간은 [바닥·벽] 쪽에서 편집하세요(T 로 나가기).'
}
// 천장 모드의 반자 높이 입력 칸. 기본값은 BIM 값이 없으니 후보(계산)다.
export const ceilingAskInput = ref('')

/** 천장면과 회색 처리. 천장면은 반자 높이를 아는 층만, 면은 그 층 물리존 외곽선(없으면 설비가 든 평면 범위)이다. */
const ceilingView = computed<CeilingView | null>(() => {
  const m = model.value
  if (!ceilingMode.value || !m || replayOpen.value) return null
  const planes: CeilingView['planes'] = []
  for (const st of m.storeys) {
    const c = ceilingOf(st)
    if (!c) continue
    let rings: Vec2[][] = st.spaces.filter((sp) => sp.footprint.length >= 4).map((sp) => sp.footprint as Vec2[])
    if (!rings.length) {
      const pts = st.equipment.flatMap((e) => (e.position ? [e.position] : []))
      if (pts.length) {
        const [x0, x1] = [Math.min(...pts.map((p) => p[0])) - 1, Math.max(...pts.map((p) => p[0])) + 1]
        const [y0, y1] = [Math.min(...pts.map((p) => p[1])) - 1, Math.max(...pts.map((p) => p[1])) + 1]
        rings = [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
      }
    }
    planes.push({ storeyId: st.id, z: st.elevation + c.height, rings })
  }
  const dim = new Set<string>()
  for (const st of m.storeys) for (const e of st.equipment) if (!ceilingIds.value.has(e.id)) dim.add(e.id)
  return { planes, dim }
})
// 끌지 못하는 설비. 모드 밖의 설비는 3D 에서 잡히지 않는다(고르기는 된다).
const frozenIds = computed(() => {
  const out = new Set<string>()
  // 리플레이 동안은 끌 수 없으니(편집 모드가 아니다) 잠근 설비도 없다.
  if (!editing.value || !model.value || replayOpen.value) return out
  for (const st of model.value.storeys) for (const e of st.equipment) if (e.position && editLock(e)) out.add(e.id)
  return out
})

/** 천장 설비의 z 가 구역(반자 부착 · 플레넘) 안인가(Q10). 아니면 이유. 천장 설비가 아니면 true. */
export function ceilingZCheck(e: Equipment, storey: Storey, z: number): true | string {
  const mark = ceilingMarks.value.find((m) => m.id === e.id)
  const zone = mark?.zone ?? ceilingZone(e.kind)
  if (!zone) return true
  return checkCeilingZ(zone, z - storey.elevation, ceilingOf(storey)?.height ?? null, storeyHeightOf.value.get(storey.id)?.value ?? null)
}

/** 커스텀존이 품는 방의 표시 이름. 이름과 방 번호를 같이 둔다. */
export function zoneRoomLabel(id: string): string {
  const sp = selectedCustomZone.value?.storey.spaces.find((x) => x.id === id)
  if (!sp) return id
  return sp.longName && sp.name && sp.longName !== sp.name ? `${sp.longName} ${sp.name}` : sp.longName || sp.name || id
}

export function changeCustomZones(storeyId: string, label: string, apply: (m: Model) => unknown): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotCustomZones(m, storeyId)
  const at = mark()
  const done = apply(m)
  if (!done) return false
  if (typeof done === 'object' && 'refused' in (done as object)) {
    note((done as { refused: string }).refused)
    return false
  }
  remember(label, snapshot, at)
  triggerRef(model)
  sceneVersion.value++
  return true
}

export function startCustomZone() {
  const storey = targetStorey()
  if (!storey) return askStorey('커스텀존을 그릴')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  selectedCustomZoneId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'custom', spaceId: null, storeyId: storey.id, name: `${storey.name} 커스텀존`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
  note('바닥에 꼭짓점을 찍어 커스텀존을 그립니다. 물리존과 경계가 달라도, 다른 커스텀존과 겹쳐도 됩니다 (Enter 마침, Esc 취소)')
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupCeiling() {
  // 천장 모드에서는 위에서 내려다보니 링이 설비와 겹친다 — 그리지 않는다.
  watch([ceilingMarks, sceneVersion, selectedId, () => ceilingMode.value], () => viewer?.setCeilingMarks(ceilingMode.value ? [] : ceilingMarks.value, selectedId.value))
  watch(editing, (on) => {
    if (!on) editPart.value = 'equipment'
  })
  watch(editing, (on) => {
    if (!on) ceilingMode.value = false
  })
  watch(ceilingAsk, (ask) => {
    if (ask && ceilingStorey.value) ceilingAskInput.value = String(ceilingGuessOf.value.get(ceilingStorey.value.id)?.height ?? '')
  }, { immediate: true })
  watch([ceilingView, sceneVersion], () => viewer?.setCeilingView(ceilingView.value))
  watch([frozenIds, sceneVersion], () => viewer?.setFrozen(frozenIds.value))
}
