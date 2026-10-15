import { computed, ref, triggerRef, watch } from 'vue'
import { addOpening, crossingMessage, deleteOpening, deleteWall, EXTERIOR_LOCKED, type FollowPlan, moveOpening, moveWall, moveWallWithSpaces, newCrossing, planFollow, setOpeningSize, setWallExternal, setWallHeight, setWallLength, setWallLoadBearing, setWallThickness, type Snapshot, snapshotStoreyElements, snapshotStoreySpaces, type WallCarryPlan, wallLocked } from '../lib/edit'
import { judgeExternalAll } from '../lib/exterior'
import { facadeOf, moveFacade } from '../lib/facade'
import { josa } from '../lib/josa'
import type { Model, Opening, Vec2, Vec3, Wall } from '../lib/model'
import { replayArch, replayElement } from '../lib/replay-player'
import { snapAxis } from '../lib/shortcuts'
import { crossingFollower, crossingText } from './ceiling'
import { editing, model } from './core'
import { changes, spaceNameOf } from './edit-report'
import { adding, archMode, selectedElementId, stopAdd } from './equipment-edit'
import { cm, mmOf, moveInScene, segmentAxis, shortName } from './equipment-shape'
import { archEdited, externalOf, selectedElement, setArchEdited } from './export-compare'
import { equipmentById, selected } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { areaChanges } from './multi-select'
import { viewStorey } from './multi-view'
import { stopDraw, stopPlace } from './place'
import { elementSettings } from './read-settings'
import { sceneVersion } from './redraw'
import { viewer } from './scene'
import { askStorey, targetStorey } from './space-edit'
import { drawing } from './space-objects'
import { multiView } from './vertical'

// --- 외벽 에디터 (OE-EXT-03, lib/facade.ts) ---
// 켜면 외벽을 골랐을 때 다른 층에서 같은 면에 쌓인 외벽까지 묶고, 방향키로 함께 옮긴다(층 편집 화면의 외벽 잠금 OE-EXT-02 를 이 묶음에만 푼다).
// 층마다 벽 가까운 방 변이 따라가 설비 소속을 다시 잰다. 외벽 판정은 층마다 격자를 재야 해서 켰을 때만 전 층을 잰다.
export const exteriorEditor = ref(false)
const allExternal = computed(() => {
  void sceneVersion.value
  return exteriorEditor.value && model.value ? judgeExternalAll(model.value) : null
})
export const facadeGroup = computed(() => {
  const picked = selectedElement.value
  const m = model.value
  if (!exteriorEditor.value || !picked?.wall || !m || !allExternal.value) return null
  const group = facadeOf(m, allExternal.value, picked.wall.id)
  if (!group) return null
  const names = new Map(m.storeys.map((st) => [st.id, st.name]))
  const walls = new Map(m.storeys.flatMap((st) => st.walls).map((w) => [w.id, w]))
  return group.map((x) => ({ ...x, storeyName: names.get(x.storeyId) ?? x.storeyId, bearing: wallLocked(walls.get(x.id)) }))
})
const facadeIds = computed(() => new Set(facadeGroup.value?.map((x) => x.id) ?? []))
/**
 * 고른 벽·문·창을 고칠 수 없는 이유(내력벽 OE-OBJ-05 · 외벽 OE-EXT-02). 계산으로 외벽인 벽도 잠근다 — edit.ts 는 BIM·편집 값만 본다
 * (계산은 층 격자를 다시 재야 해서 방향키마다 할 수 없다). 화면이 고른 층 하나를 재 둔 것을 쓴다.
 */
export const elementLock = computed(() => {
  const picked = selectedElement.value
  if (!picked) return null
  if (picked.locked) return picked.locked
  return picked.wall && externalOf(picked.wall.id)?.external ? EXTERIOR_LOCKED : null
})
/** 설비를 붙인 벽의 이름(OE-OBJ-04). */
export const wallNameOf = (wallId: string) => model.value?.storeys.flatMap((st) => st.walls).find((w) => w.id === wallId)?.name || '벽'
export const elementLabel = (kind: 'wall' | 'door' | 'window') => (kind === 'wall' ? '벽' : kind === 'door' ? '문' : '창')
export const nameOfSpace = (id: string) => spaceNameOf(id)

/**
 * 벽 면에 붙은 설비의 지금 좌표(OE-OBJ-04). 벽을 옮기거나 두께·길이를 바꾸면 edit.ts 가 붙은 설비를 따라 옮기는데,
 * 3D 형상은 [벽·문·창] 을 끌 때 다시 그리기 전까지 제자리에 남았다. 고치기 전 좌표를 들고 있다가 바뀐 것만 옮긴다.
 */
export function mountedAt(m: Model): Map<string, Vec3 | null> {
  const at = new Map<string, Vec3 | null>()
  for (const st of m.storeys) for (const e of st.equipment) if (e.wallId) at.set(e.id, e.position ? [e.position[0], e.position[1], e.position[2]] : null)
  return at
}

export function followMounted(before: Map<string, Vec3 | null>, glide = false) {
  for (const [id, from] of before) {
    const to = equipmentById.value.get(id)?.position ?? null
    if (from && to && from[0] === to[0] && from[1] === to[1] && from[2] === to[2]) continue
    moveInScene(id, from, to, glide)
  }
}

export function changeElements(storeyId: string, label: string, apply: (m: Model) => unknown, coalesce?: string): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotStoreyElements(m, storeyId)
  const at = mark()
  const mounted = mountedAt(m)
  const done = apply(m)
  if (!done) return false
  if (typeof done === 'object' && 'refused' in (done as object)) {
    note((done as { refused: string }).refused)
    return false
  }
  remember(label, snapshot, at, coalesce)
  setArchEdited(true)
  triggerRef(model)
  followMounted(mounted)
  sceneVersion.value++
  return true
}

/** 벽과 벽 가까운 방 변을 같이 옮긴다. 벽·방을 한 번에 되돌리게 두 스냅숏을 묶는다. */
function moveWallCarrying(storeyId: string, wall: Wall, delta: Vec2) {
  const m = model.value
  if (!m) return
  const elements = snapshotStoreyElements(m, storeyId)
  const spaces = snapshotStoreySpaces(m, storeyId)
  const at = mark()
  const mounted = mountedAt(m)
  const done = moveWallWithSpaces(m, wall.id, delta, carryPlan)
  if (!done || !elements || !spaces) return
  carryPlan = done.plan
  remember(`${wall.name || '벽'} 옮김(방 경계 같이)`, { kind: 'many', parts: [elements, spaces] }, at, `el:${wall.id}:rooms`)
  areaChanges.value = [...areaChanges.value, ...done.changes]
  changes.value = [...changes.value, ...done.changes.flatMap((c) => c.equipment)]
  setArchEdited(true)
  triggerRef(model)
  followMounted(mounted)
  viewer?.updateSpaces(m)
  sceneVersion.value++
  if (done.crossed.length) note(`방 경계가 자기와 겹칩니다: ${done.crossed.slice(0, 3).join(', ')}${done.crossed.length > 3 ? ` 외 ${done.crossed.length - 3}` : ''}`)
  else if (!done.changes.length) {
    note(done.plan.items.length ? '벽 길이 방향으로 옮겨서 방 경계는 그대로입니다' : '이 벽 가까이(0.6m)에 따라올 방 변이 없습니다')
  }
}

/** 외벽 에디터: 같은 면의 외벽을 전 층에서 함께 옮기고 방 변을 따라 옮긴다. 층마다의 벽·방을 한 번에 되돌리게 묶는다. */
function moveFacadeNow(group: readonly { id: string; storeyId: string; storeyName: string; bearing: boolean }[], delta: Vec2) {
  const m = model.value
  if (!m) return
  const storeyIds = [...new Set(group.map((x) => x.storeyId))]
  const parts = storeyIds.flatMap((id) => [snapshotStoreyElements(m, id), snapshotStoreySpaces(m, id)]).filter((x): x is Snapshot => !!x)
  const at = mark()
  const mounted = mountedAt(m)
  const done = moveFacade(m, group.map((x) => x.id), delta, true)
  if ('refused' in done) return note(done.refused)
  if (!done.moved) return
  const movedOn = group.filter((x) => !x.bearing).map((x) => x.storeyName)
  remember(`외벽 ${done.moved}개 옮김(${[...new Set(movedOn)].join('·')})`, { kind: 'many', parts }, at, `facade:${group.map((x) => x.id).join(',')}`)
  areaChanges.value = [...areaChanges.value, ...done.changes]
  changes.value = [...changes.value, ...done.changes.flatMap((c) => c.equipment)]
  setArchEdited(true)
  triggerRef(model)
  followMounted(mounted)
  viewer?.updateSpaces(m)
  sceneVersion.value++
  if (done.crossed.length) note(`방 경계가 자기와 겹칩니다: ${done.crossed.slice(0, 3).join(', ')}${done.crossed.length > 3 ? ` 외 ${done.crossed.length - 3}` : ''}`)
  else if (done.kept.length) note(`${done.kept.join('·')} 의 벽은 내력벽이라 제자리에 둡니다`)
}

export function setBearing(wall: Wall, raw: string) {
  const value = raw === 'true' ? true : raw === 'false' ? false : null
  const storey = selectedElement.value?.storey
  if (!storey) return
  changeElements(storey.id, `${wall.name || '벽'} 내력 ${value === null ? '모름' : value ? '내력' : '비내력'}`, (m) => setWallLoadBearing(m, wall.id, value))
}

export function removeElement() {
  const picked = selectedElement.value
  if (!picked) return
  if (elementLock.value) return note(elementLock.value)
  const what = elementLabel(picked.kind)
  const name = picked.wall?.name || picked.opening?.name || what
  let openings = 0
  const ok = changeElements(picked.storey.id, `${name} 지우기`, (m) => {
    if (picked.wall) {
      const done = deleteWall(m, picked.wall.id)
      openings = done?.openings ?? 0
      return done
    }
    return deleteOpening(m, picked.opening!.id)
  })
  if (!ok) return
  selectedElementId.value = null
  note(`${what} ${name}${josa(name, '을/를')} 지웠습니다${openings ? `(뚫린 문·창 ${openings}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
}

/** 방향키로 고른 벽·문·창을 옮긴다. 화면 방향에 가장 가까운 평면 축이다(설비 옮기기와 같다). */
/**
 * 벽을 옮길 때 방 경계도 같이 옮기나(edit.ts 의 moveWallWithSpaces). 기본은 끔 — 방은 IfcSpace 가 따로 그린 것이라 벽이 방을
 * 지어내지 않는다. 켜면 벽 가까이 있던 방 변이 벽이 움직인 만큼 따라온다. 같은 벽을 방향키로 옮기는 동안은 처음 세운 계획을
 * 다시 쓴다(되돌아오면 제자리).
 */
export const carryRooms = ref(false)
/**
 * 설비를 옮길 때 붙은 배관도 따라오게 하나(edit.ts 의 planFollow). 기본은 켬 — 끄면 설비만 옮겨져 3D·GeoJSON 에서 배관이
 * 떨어져 보인다. 도관을 직접 옮길 때는 무엇도 따라오지 않는다.
 */
export const carryConduits = ref(true)
const FOLLOW_BLOCKED = { geometry: '형상이 없음', position: '좌표가 없음' } as const
/**
 * 설비를 옮길 때 따라오지 않는 배관을 한 문장으로(OE-PIP-12). 없으면 빈 문자열. 고른 설비 패널에 옮기기 전부터 보인다 — 옮긴 뒤 경고 칸에도
 * 띄웠더니 방향키를 누를 때마다 같은 경고가 남아 다른 키 안내(층 완료가 풀렸다 등)를 가렸다.
 */
function followLeftText(plan: FollowPlan): string {
  const name = (id: string) => shortName(equipmentById.value.get(id)?.name || id)
  const parts: string[] = []
  if (plan.held.length) parts.push(`다른 분기에도 이어진 이음쇠 ${plan.held.length}개(${plan.held.slice(0, 3).map(name).join(', ')})는 옮기지 않습니다. 배관 형상을 확인하세요.`)
  if (plan.blocked.length)
    parts.push(`끝점 자동 추종 불가 ${plan.blocked.length}개: ${plan.blocked.slice(0, 3).map((b) => `${name(b.id)}(${FOLLOW_BLOCKED[b.reason]})`).join(', ')}.`)
  return parts.join(' ')
}
/** 고른 설비를 옮기면 무엇이 따라오나(OE-PIP-12 "영향을 미리 표시"). 따라올 배관이 하나도 없으면 null. */
export const followPreview = computed(() => {
  const e = selected.value
  if (!editing.value || !carryConduits.value || !e?.position || !model.value || e.role === 'segment') return null
  const plan = planFollow(model.value, e.id, segmentAxis)
  const stretch = new Set(plan.stretch.map((x) => x.id)).size
  if (!plan.rigid.length && !stretch && !plan.held.length && !plan.blocked.length) return null
  const crossing = multiView.value ? null : crossingFollower(plan)
  return { rigid: plan.rigid.length, stretch, left: crossing ? crossingText(e, crossing) : followLeftText(plan), crossing: !!crossing }
})
let carryPlan: WallCarryPlan | null = null

export function nudgeElement(code: string, step: number): boolean {
  const picked = selectedElement.value
  if (!picked || !viewer) return false
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const delta: Vec2 = [cm(sign * ax * step), cm(sign * ay * step)]
  if (picked.wall && facadeGroup.value) {
    moveFacadeNow(facadeGroup.value, delta)
    return true
  }
  if (elementLock.value) {
    note(elementLock.value)
    return true
  }
  if (picked.wall) {
    if (!picked.wall.footprint?.length) {
      note('외곽선이 없는 벽은 옮길 수 없습니다')
      return true
    }
    // 다른 벽을 새로 가로지르게 되면 옮기지 않는다(OE-OBJ-05). 이유를 말해야 방향키가 고장 난 것처럼 보이지 않는다.
    const crossed = newCrossing(model.value!, picked.wall.id, picked.wall.footprint.map((r) => r.map((p) => [p[0] + delta[0], p[1] + delta[1]] as Vec2)))
    if (crossed) {
      note(crossingMessage(crossed))
      return true
    }
    if (carryRooms.value) {
      moveWallCarrying(picked.storey.id, picked.wall, delta)
      return true
    }
    changeElements(picked.storey.id, `${picked.wall.name || '벽'} 옮김`, (m) => moveWall(m, picked.wall!.id, delta), `el:${picked.wall.id}`)
    return true
  }
  const o = picked.opening!
  if (!o.position) {
    note('자리를 모르는 문·창은 옮길 수 없습니다(읽을 것에서 문·창 자리를 켜고 여세요)')
    return true
  }
  changeElements(picked.storey.id, `${o.name || elementLabel(o.kind)} 옮김`, (m) => moveOpening(m, o.id, [cm(o.position![0] + delta[0]), cm(o.position![1] + delta[1])], { snap: elementSettings.value.openingSnap }), `el:${o.id}`)
  return true
}

/** 벽 길이(OE-OBJ-05). 가운데를 두고 양 끝을 같이 늘이거나 줄인다. 꼭짓점 넷인 벽만이다(직사각형·비스듬히 맞댄 사다리꼴). */
export function applyWallLength(wall: Wall, raw: string) {
  const value = Number(raw)
  const storey = selectedElement.value?.storey
  if (!storey || raw.trim() === '' || !Number.isFinite(value)) return
  changeElements(storey.id, `${wall.name || '벽'} 길이 ${value.toFixed(2)}m`, (m) => setWallLength(m, wall.id, value))
}

/** 벽 두께·높이(OE-OBJ-04 크기 y·z). 두께는 중심선을 두고 펴고, 높이는 빈칸이면 모름이다. */
export function applyWallSize(wall: Wall, key: 'thickness' | 'height', raw: string) {
  const storey = selectedElement.value?.storey
  if (!storey) return
  if (key === 'height' && raw.trim() === '') {
    changeElements(storey.id, `${wall.name || '벽'} 높이 모름`, (m) => setWallHeight(m, wall.id, null))
    return
  }
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(value)) return
  const label = `${wall.name || '벽'} ${key === 'thickness' ? '두께' : '높이'} ${value.toFixed(2)}m`
  changeElements(storey.id, label, (m) => (key === 'thickness' ? setWallThickness(m, wall.id, value) : setWallHeight(m, wall.id, value)))
}

/** 외벽 여부를 사람이 정한다(OE-OBJ-04). 계산이 틀린 벽을 바로잡는 자리다. */
export function setExternal(wall: Wall, raw: string) {
  const value = raw === 'true' ? true : raw === 'false' ? false : null
  const storey = selectedElement.value?.storey
  if (!storey) return
  changeElements(storey.id, `${wall.name || '벽'} ${value === null ? '외벽 여부 모름' : value ? '외벽' : '내벽'}`, (m) => setWallExternal(m, wall.id, value))
}

/** 문·창 가로·세로(OE-OBJ-07). */
export function applyOpeningSize(o: Opening, key: 'width' | 'height', raw: string) {
  const value = Number(raw)
  const storey = selectedElement.value?.storey
  if (!storey || raw.trim() === '' || !Number.isFinite(value)) return
  const label = `${o.name || elementLabel(o.kind)} ${key === 'width' ? '가로' : '세로'} ${value.toFixed(2)}m`
  changeElements(storey.id, label, (m) => setOpeningSize(m, o.id, { [key]: value }))
}

export function applyOpeningPosition(o: Opening, axis: 0 | 1, raw: string, input?: HTMLInputElement) {
  const value = Number(raw)
  const storey = selectedElement.value?.storey
  if (!o.position || !storey || raw.trim() === '' || !Number.isFinite(value)) return
  if (elementLock.value) return note(elementLock.value)
  const to: [number, number] = [o.position[0], o.position[1]]
  to[axis] = value
  changeElements(storey.id, `${o.name || elementLabel(o.kind)} 옮김`, (m) => moveOpening(m, o.id, to, { snap: elementSettings.value.openingSnap }))
  // 문·창은 벽을 따라서만 가서(OE-OBJ-07) 친 값과 놓인 자리가 다를 수 있다. 칸은 치는 동안 덮이지 않으니(v-keep-typing) 놓인 자리로 되돌린다.
  if (input && o.position) input.value = String(mmOf(o.position[axis]))
}

export function startWall() {
  const storey = targetStorey()
  if (!storey) return askStorey('벽을 그을')
  stopPlace()
  stopAdd()
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'wall', spaceId: null, storeyId: storey.id, name: `${storey.name} 벽`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
}

export function startOpening(kind: 'door' | 'window') {
  const storey = targetStorey() ?? selectedElement.value?.storey ?? null
  if (!storey) return askStorey('문·창을 놓을')
  stopPlace()
  stopDraw()
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  adding.value = { storeyId: storey.id, elevation: storey.elevation, what: kind }
  viewer?.setPlaceMode(storey.elevation)
  note(`${elementLabel(kind)}${josa(elementLabel(kind), '을/를')} 놓을 벽을 3D에서 클릭하세요 (Esc 취소)`)
}

export function addOpeningAt(at: Vec2) {
  const target = adding.value
  stopAdd()
  if (!target || target.what === 'equipment' || target.what === 'object') return
  const kind = target.what
  let made: Opening | null = null
  const ok = changeElements(target.storeyId, `${elementLabel(kind)} 놓기`, (m) => {
    const done = addOpening(m, target.storeyId, kind, [cm(at[0]), cm(at[1])], undefined, elementSettings.value.openingSnap)
    if (done && !('refused' in done)) made = done
    return done
  })
  if (ok && made) {
    selectedElementId.value = (made as Opening).id
    note(`${elementLabel(kind)}${josa(elementLabel(kind), '을/를')} 놓았습니다. 방향키로 벽을 따라 옮깁니다`)
  }
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupFacade() {
  watch([archMode, editing], ([a, e]) => {
    if (!a || !e) exteriorEditor.value = false
  })
  // 켜면 모든 층을 보인다 — 같은 면에 쌓인 다른 층 외벽이 같이 보여야 무엇을 함께 옮기는지 안다.
  watch(exteriorEditor, (on) => {
    if (on) viewStorey.value = null
  })
  watch([archMode, editing, model, sceneVersion, selectedElementId, facadeIds, replayArch, replayElement], () => {
    // 편집 리플레이의 벽·문·창 장면도 이 층을 켠다(replayArch).
    const on = (archMode.value && editing.value) || replayArch.value
    viewer?.setArchitecture(on ? model.value : null, replayArch.value ? replayElement.value : selectedElementId.value, facadeIds.value)
  })
  watch(selectedElementId, () => (carryPlan = null))
}
