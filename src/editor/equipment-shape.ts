import { computed, ref, shallowRef, triggerRef, watch } from 'vue'
import { ceilingOf, judgeSurface } from '../lib/ceiling'
import { rigidPart, segmentAxisOf, stretchPositions } from '../lib/conduit-mesh'
import { applyFollow, type Change, completePosition, EXTERIOR_ONLY, exteriorOnly, fittingMoveRefusal, moveEquipment, onExteriorFace, planFollow, type SegmentAxis, type Snapshot, snapshotEquipment, snapshotServedZones } from '../lib/edit'
import { josa } from '../lib/josa'
import { type Equipment, isConduit, type Model, type Vec3 } from '../lib/model'
import { overlapAt } from '../lib/overlap'
import { ceilingMode, ceilingZCheck, CROSS_STOREY_LOCKED, crossingFollower, crossingText, editLock, refuseLock, VERTICAL_LOCKED } from './ceiling'
import { baseline } from './changes'
import { editing, model } from './core'
import { changes, meters, storeyHeightOf } from './edit-report'
import { carryConduits } from './facade'
import { equipmentById } from './flow-rules'
import { mark, remember } from './history'
import { editNotice, group, moveGroup, storeyOf } from './multi-select'
import { zoneCheckList } from './offset'
import { meshBase, meshes } from './open-file'
import { currentBox, redraw, sceneVersion, shiftMesh } from './redraw'
import { viewer } from './scene'
import { MULTI_VIEW_ONLY, multiView } from './vertical'

// --- 사람이 더한 설비의 모양 (ADR-0059) ---
// 더한 설비는 IFC 형상이 없어 상자로 그렸다. 복제한 원본(shapeOf)이나 종류가 같은 BIM 설비가 있으면 그 형상을 이 설비 자리로
// 옮겨 쓴다. 한 번 meshes 에 넣으면 옮기기·되돌리기는 다른 설비처럼 moveInScene 이 따라 옮긴다. 여기서는 만들 때와 빌려 올
// 설비가 바뀔 때(종류를 바꿈·되돌림)만 넣고 뺀다. BIM 설비 중 형상이 없는 것은 그대로 상자다 — "BIM 에 형상이 없다" 를 가리지 않는다.
/** 더한 설비 id → 모양을 빌려 온 BIM 설비 id. 패널이 어디서 온 모양인지 보인다. */
export const borrowedShape = shallowRef(new Map<string, string>())
/**
 * 종류마다 모양을 빌려 줄 BIM 설비. 형상이 있는 같은 종류 중 ObjectType(Revit "패밀리:유형")이 가장 많은 묶음의 첫 설비다.
 * 정해진 규칙이라 편집 파일로 다시 열어도 같은 설비가 골라진다(그래서 종류로 빌린 것은 파일에 적지 않는다).
 */
function kindShapes(m: Model): Map<string, Equipment> {
  const groups = new Map<string, Map<string, Equipment[]>>()
  for (const e of m.storeys.flatMap((s) => s.equipment)) {
    if (e.added || !e.kind || !e.position || e.flowType || isConduit(e.role) || !meshes.has(e.id) || meshBase.has(e.id)) continue
    const byType = groups.get(e.kind) ?? new Map<string, Equipment[]>()
    groups.set(e.kind, byType)
    const list = byType.get(e.objectType ?? '') ?? []
    byType.set(e.objectType ?? '', list)
    list.push(e)
  }
  return new Map([...groups].map(([kind, byType]) => [kind, [...byType.values()].reduce((a, b) => (b.length > a.length ? b : a))[0]]))
}
function shapeSource(e: Equipment, byKind: () => Map<string, Equipment>): Equipment | null {
  if (!e.added || !e.position || e.flowType || isConduit(e.role)) return null
  // 복제한 원본. 종류를 바꿨으면 원본 모양이 맞지 않으니 새 종류로 고른다.
  const own = e.shapeOf ? equipmentById.value.get(e.shapeOf) : undefined
  if (own?.position && !own.added && meshes.has(own.id) && (own.kind ?? null) === (e.kind ?? null)) return own
  return e.kind ? (byKind().get(e.kind) ?? null) : null
}
/** 더한 설비의 빌린 모양을 맞춘다. 바뀐 것이 있으면 true(다시 그려야 한다). */
export function syncBorrowedShapes(): boolean {
  const m = model.value
  if (!m) return false
  let index: Map<string, Equipment> | null = null
  const byKind = () => (index ??= kindShapes(m))
  const next = new Map(borrowedShape.value)
  let changed = false
  for (const e of m.storeys.flatMap((s) => s.equipment)) {
    if (!e.added) continue
    const src = shapeSource(e, byKind)
    const had = next.get(e.id)
    if (!src) {
      if (had) {
        meshes.delete(e.id)
        next.delete(e.id)
        changed = true
      }
      continue
    }
    if (had === src.id && meshes.has(e.id)) continue
    const mesh = meshes.get(src.id)!
    meshes.set(e.id, { ...mesh, positions: mesh.positions })
    // 원본 자리에 있는 형상을 이 설비 자리로 옮긴다.
    shiftMesh(e.id, src.position, e.position)
    next.set(e.id, src.id)
    changed = true
  }
  if (changed) borrowedShape.value = next
  return changed
}

/** 구간의 연 때 축. 처음 물을 때 형상을 떠 둔다(그때는 아직 늘이기 전이다). 형상이 없거나 구간이 아니면 null. */
export function segmentAxis(id: string): SegmentAxis | null {
  const known = meshBase.get(id)
  if (known) return known.axis
  const e = equipmentById.value.get(id)
  const mesh = meshes.get(id)
  if (e?.role !== 'segment' || !e.position || !mesh) return null
  return captureBase(id, e.position)?.axis ?? null
}

export function captureBase(id: string, at: Vec3) {
  const mesh = meshes.get(id)
  const axis = mesh && segmentAxisOf(mesh.positions)
  if (!mesh || !axis) return null
  const base = { positions: mesh.positions.slice(), at: [at[0], at[1], at[2]] as Vec3, axis }
  meshBase.set(id, base)
  return base
}

/** 늘인 구간의 형상을 지금 모델 값(`endShift`·`position`)으로 다시 만들어 3D 에 올린다. */
export function placeStretched(id: string, glide = false) {
  const base = meshBase.get(id)
  const e = equipmentById.value.get(id)
  const mesh = meshes.get(id)
  if (!base || !mesh || !e?.position) return
  const shift = e.endShift ?? [[0, 0, 0], [0, 0, 0]]
  const positions = stretchPositions(base.positions, base.axis, shift, rigidPart(base.axis, base.at, e.position, shift))
  meshes.set(id, { ...mesh, positions })
  if (viewer?.setEquipmentPositions(id, positions, glide)) sceneVersion.value++
  else redraw()
}

/**
 * 알림·되돌리기 이름에 쓰는 짧은 이름. Revit 은 "패밀리:유형:유형:요소ID" 를 이름으로 내보내서(`M_Return Register:
 * RR-600 x 600 Face 300 x 300 Connection:…:607161`) 한 줄 알림이 이름만으로 넘쳤다. 패밀리와 요소 ID 만 남긴다.
 * 제목·표·리포트는 BIM 의 이름 그대로 둔다.
 */
export function shortName(name: string | undefined | null): string {
  if (!name) return '설비'
  const revit = /^([^:]+):.+:(\d+)$/.exec(name)
  return revit ? `${revit[1]} #${revit[2]}` : name
}

/** 3D 에서 끈 값은 센티미터로 자른다. 마우스로 1mm 를 뜻하고 놓는 사람은 없다. */
export const cm = (v: number) => Math.round(v * 100) / 100

/**
 * 설비 하나의 3D 형상을 좌표가 바뀐 만큼 옮긴다. 모델 전체를 다시 만들면 성수 크기에서 2초가 걸려서,
 * 형상 하나만 옮긴다. 3D 에 없던 설비(좌표가 없다가 생긴 것)와 사라질 설비만 다시 그린다.
 */
export function moveInScene(id: string, from: Vec3 | null, to: Vec3 | null, glide = false) {
  if (meshBase.has(id)) {
    placeStretched(id, glide)
    return
  }
  shiftMesh(id, from, to)
  if (from && to && viewer?.shiftEquipment(id, [to[0] - from[0], to[1] - from[1], to[2] - from[2]], glide)) sceneVersion.value++
  else redraw()
}

/**
 * 설비를 옮기는 길은 표(숫자)와 3D(끌기) 둘이지만 하는 일은 하나다. 소속 재판정은 edit.ts 가 한다.
 * `drawnAt` 은 3D 가 이미 그려 둔 자리다(끌어 놓은 경우). 그 자리와 저장한 좌표의 차만큼만 형상을 옮긴다.
 */
/** 겹쳐서 막았다고 알린다. 문구는 OE-SPC-15 가 정한 것이고, 무엇과 겹쳤는지를 뒤에 붙인다(3D 에는 붉은 상자로 짚는다). */
export function refuseOverlap(blocked: Equipment) {
  const name = shortName(blocked.name)
  editNotice.value = `이미 오브젝트가 있는 위치입니다(${name}${josa(name, '과/와')} 겹칩니다). 배관 없는 설비는 서로 겹쳐 놓을 수 없습니다.`
  viewer?.markConflict(blocked.id)
}

export function relocate(equipmentId: string, to: Vec3, drawnAt?: Vec3, coalesce?: string, opts: { ignoreModeLock?: boolean } = {}): boolean {
  if (!model.value) return false
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  // 외벽 전용 설비(외기 센서, OE-OBJ-04)는 외벽 바깥 면으로만 옮긴다. 바깥 면을 따라 옮기는 것은 되고, 벽에서 떼는 것은 막는다.
  const moving = equipmentById.value.get(equipmentId)
  const home = storeyOf(equipmentId)
  const goBack = () => {
    if (drawnAt && before) viewer?.shiftEquipment(equipmentId, [before[0] - drawnAt[0], before[1] - drawnAt[1], before[2] - drawnAt[2]], true)
  }
  // 천장 편집 모드(OE-OBJ-08). 모드 밖의 설비는 옮기지 않고, 천장 설비의 z 는 구역 안에서만 고친다(Q10).
  // `ignoreModeLock` 은 완전성 검사의 [방 안으로 옮기기] — 높이는 그대로 x·y 만 옮기는 명시적 고치기라 천장·바닥 모드 구분은 건너뛴다.
  // 다중층 뷰·수직 관통 잠금은 그대로다.
  const raw = moving ? editLock(moving) : null
  const lock = opts.ignoreModeLock && raw !== MULTI_VIEW_ONLY && raw !== VERTICAL_LOCKED && raw !== CROSS_STOREY_LOCKED ? null : raw
  if (moving && lock) {
    goBack()
    refuseLock(moving, lock)
    return false
  }
  // 설비에 바로 붙은 이음쇠는 배관의 끝점이라 옮기면 설비와 떨어진다(OE-PIP-10). 꺾임점(구간 사이 이음쇠)만 옮긴다.
  const endpoint = model.value ? fittingMoveRefusal(model.value, equipmentId, (e) => shortName(e.name)) : null
  if (endpoint) {
    goBack()
    editNotice.value = endpoint
    return false
  }
  if (moving && home && ceilingMode.value && (!before || to[2] !== before[2])) {
    const ok = ceilingZCheck(moving, home, to[2])
    if (ok !== true) {
      goBack()
      editNotice.value = ok
      return false
    }
  }
  // 바닥·벽 쪽에서 z 를 올려 천장으로 보내지 않는다 — 천장 설비가 되면 이 쪽에서 다시 못 고친다.
  if (moving && home && editing.value && !ceilingMode.value && before && to[2] !== before[2]) {
    const judged = judgeSurface({ ...moving, position: to }, home, storeyHeightOf.value.get(home.id)?.value ?? null)
    if (judged === 'ceiling' || judged === 'plenum') {
      goBack()
      editNotice.value = `그 높이는 천장(천장고 ${meters(ceilingOf(home)!.height)} 근처)입니다. 천장으로 옮기려면 천장 편집 모드에서 하세요.`
      return false
    }
  }
  if (moving && home && exteriorOnly(moving) && !onExteriorFace(home, [to[0], to[1]])) {
    if (drawnAt && before) viewer?.shiftEquipment(equipmentId, [before[0] - drawnAt[0], before[1] - drawnAt[1], before[2] - drawnAt[2]], true)
    editNotice.value = `${EXTERIOR_ONLY} 그 자리는 외벽 바깥 면이 아닙니다. 다른 외벽으로는 [벽에 붙이기]로 옮기세요.`
    return false
  }
  // 배관 없는 설비끼리는 겹쳐 놓지 못한다(OE-OBJ-10·16). 끌어 놓은 것이면 3D 가 이미 그 자리에 그렸으니 되돌려 보낸다.
  const blocked = overlapAt(model.value, equipmentId, to, currentBox)
  if (blocked) {
    if (drawnAt && before) viewer?.shiftEquipment(equipmentId, [before[0] - drawnAt[0], before[1] - drawnAt[1], before[2] - drawnAt[2]], true)
    refuseOverlap(blocked)
    return false
  }
  // 붙은 배관(PRD #13). 옮기기 전에 정한다 — 옮긴 뒤에는 구간의 어느 끝이 가까웠는지 모른다.
  const plan = carryConduits.value && before ? planFollow(model.value, equipmentId, segmentAxis) : null
  // 따라 늘어날 구간이 다른 층으로 이어졌으면 층 편집에서는 옮기지 않는다(OE-ML-05). 끄고 옮기면 설비만 간다. 다중층 뷰에서는 옮긴다.
  const crossing = moving && !multiView.value ? crossingFollower(plan) : null
  if (moving && crossing) {
    goBack()
    editNotice.value = crossingText(moving, crossing)
    return false
  }
  const followers = plan ? [...plan.rigid, ...new Set(plan.stretch.map((x) => x.id))] : []
  const own = snapshotEquipment(model.value, equipmentId)
  // 공조기·PAC 를 다른 물리존으로 옮기면 담당 공조존에서 빠진다(OE-EQP-09). 되돌리면 담당도 돌아와야 해서 그 층의 공조존을 같이 받아 둔다.
  const served = snapshotServedZones(model.value, equipmentId)
  const snapshot: Snapshot | null =
    own && (followers.length || served.length) ? { kind: 'many', parts: [own, ...followers.flatMap((id) => snapshotEquipment(model.value!, id) ?? []), ...served] } : own
  const at = mark()
  const change = moveEquipment(model.value, equipmentId, to)
  if (!change) return false
  remember(`${shortName(change.equipmentName)} 옮김${followers.length ? ` (배관 ${followers.length}개 따라옴)` : ''}`, snapshot, at, coalesce)
  if (drawnAt) shiftMesh(equipmentId, before, drawnAt)
  moveInScene(equipmentId, drawnAt ?? before, to)
  if (plan && before && followers.length) {
    const was = new Map(followers.map((id) => [id, equipmentById.value.get(id)?.position ?? null]))
    changes.value = [...changes.value, ...applyFollow(model.value, plan, [to[0] - before[0], to[1] - before[1], to[2] - before[2]], segmentAxis)]
    for (const id of followers) moveInScene(id, was.get(id) ?? null, equipmentById.value.get(id)?.position ?? null)
  }
  changes.value = [...changes.value, change]
  triggerRef(model)
  // 실내기를 옮기면 담당 공조존을 다시 정해야 한다(OE-EQP-08). 옮긴 자리가 담당 공조존 밖이거나 담당 공조존이 없으면 Z-06 을 알린다.
  if (moving && (moving.kind === 'indoor_unit' || moving.kind === 'fcu')) {
    const z06 = zoneCheckList.value?.checks.find((c) => c.rule === 'Z-06')?.items.find((x) => x.id.includes(equipmentId))
    if (z06) editNotice.value = `실내기를 옮겼습니다. 담당 공조존을 다시 지정하세요(Z-06: ${z06.label}). 설비 패널의 "담당 공조존" 에서 고릅니다.`
  }
  noticeServedReleased([change])
  return true
}

/** 옮겨서 담당 공조존에서 빠진 공조기·PAC 를 알린다(OE-EQP-09). 다시 지정하기 전까지 그 공조존은 Z-04 다. */
export function noticeServedReleased(done: readonly Change[]) {
  const hit = done.filter((c) => c.servedReleased?.length)
  if (!hit.length) return
  const zones = [...new Set(hit.flatMap((c) => c.servedReleased!))]
  editNotice.value = `${hit.map((c) => shortName(c.equipmentName)).join(', ')}${josa(shortName(hit.at(-1)!.equipmentName), '을/를')} 다른 물리존으로 옮겨 담당하던 공조존(${zones.join(', ')})에서 뺐습니다(Z-04). 공조존 패널의 "담당 설비" 에서 다시 지정하세요.`
}

// 좌표가 없는 설비(E6)에 표로 넣은 축. 셋이 다 차야 옮긴다(completePosition). 새 파일을 열면 비운다.
export const positionDrafts = ref(new Map<string, (number | null)[]>())

/** 건물 범위: 물리존 외곽선 전체의 평면 범위와 층 높이 범위. 좌표 칸의 오타를 알아보는 데 쓴다. */
const buildingBox = computed(() => {
  const m = model.value
  if (!m) return null
  const pts = m.storeys.flatMap((s) => s.spaces.flatMap((sp) => sp.footprint))
  if (!pts.length) return null
  const zs = m.storeys.map((s) => s.elevation)
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    y1: Math.max(...pts.map((p) => p[1])),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
  }
})
/** 건물에서 이만큼 벗어나면 알린다(평면 m). 마당의 실외기처럼 조금 밖에 두는 것은 흔하다. */
const FAR_OUTSIDE = 30
/**
 * 칸에 친 좌표가 건물에서 멀면 알린다. 막지는 않는다(밖에 두는 설비가 있다). 성수에서 x 32.26 을 3226 으로 치자 설비가
 * 3km 밖으로 가고, 전체 보기에서 건물이 점 하나로 줄었는데 리포트에는 "소속 없음" 한 줄뿐이었다.
 */
function warnIfFar(to: Vec3) {
  const b = buildingBox.value
  if (!b) return
  const plan = Math.hypot(Math.max(b.x0 - to[0], 0, to[0] - b.x1), Math.max(b.y0 - to[1], 0, to[1] - b.y1))
  const height = Math.max(b.z0 - 10 - to[2], 0, to[2] - (b.z1 + 20))
  if (plan > FAR_OUTSIDE) editNotice.value = `건물 범위에서 평면으로 ${Math.round(plan).toLocaleString()}m 벗어난 자리입니다. 오타라면 Ctrl+Z 로 되돌리세요.`
  else if (height > 0) editNotice.value = `층 높이 범위에서 ${Math.round(height).toLocaleString()}m 벗어난 높이입니다. 오타라면 Ctrl+Z 로 되돌리세요.`
}

export function applyMove(equipmentId: string, axis: 0 | 1 | 2, raw: string, current: readonly number[] | null, input?: HTMLInputElement) {
  if (!model.value) return
  const value = raw.trim() === '' ? null : Number(raw)
  if (value !== null && !Number.isFinite(value)) return

  if (current) {
    // 좌표가 있는 설비의 칸을 비우면 옮기지 않는다. 칸도 지금 값으로 되돌린다(빈 칸으로 두면 좌표가 없어진 것처럼 보였다).
    if (value === null) {
      if (input) input.value = String(mmOf(current[axis]))
      return
    }
    const base: [number, number, number] = [current[0], current[1], current[2]]
    base[axis] = value
    if (relocate(equipmentId, base)) warnIfFar(base)
    // 막혔으면(겹침) 칸도 지금 값으로 되돌린다. 친 값이 남으면 옮겨진 것처럼 보인다.
    else if (input) input.value = String(mmOf(current[axis]))
    return
  }

  // 미배치 설비는 기준 좌표가 없다. 나머지 축을 0 으로 채우지 않고, 셋이 다 찰 때까지 들고 있는다.
  const draft = [...(positionDrafts.value.get(equipmentId) ?? [null, null, null])]
  draft[axis] = value
  const drafts = new Map(positionDrafts.value)
  const to = completePosition(draft)
  if (to) drafts.delete(equipmentId)
  else drafts.set(equipmentId, draft)
  positionDrafts.value = drafts
  if (to && relocate(equipmentId, to)) warnIfFar(to)
}

/**
 * 좌표 칸에 보일 값. BIM 좌표는 19.594049… 처럼 길어서 칸에서 잘렸다. 보이는 것만 mm 로 줄이고 모델 값은 그대로 둔다
 * (칸을 고치지 않으면 옮기지 않는다).
 */
export const mmOf = (v: number) => Math.round(v * 1000) / 1000

/** 3D 에서 고른 설비를 끌어 놓았다. 3D 는 이미 놓은 자리에 그려져 있어 다시 만들지 않는다. */
export function dropEquipment(equipmentId: string, delta: Vec3) {
  const position = equipmentById.value.get(equipmentId)?.position
  if (!position) return
  // 여러 개 고른 것 중 하나를 끌었으면 전부 같은 거리만큼(OE-UI-09).
  if (group.value.includes(equipmentId)) {
    moveGroup(delta[0], delta[1], { id: equipmentId, drawnAt: [position[0] + delta[0], position[1] + delta[1], position[2]] })
    return
  }
  const drawnAt: Vec3 = [position[0] + delta[0], position[1] + delta[1], position[2]]
  relocate(equipmentId, [cm(drawnAt[0]), cm(drawnAt[1]), position[2]], drawnAt)
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupEquipmentShape() {
  watch(baseline, () => (borrowedShape.value = new Map()))
  watch(model, () => {
    if (syncBorrowedShapes()) redraw()
  })
}
