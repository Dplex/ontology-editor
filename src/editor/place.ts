import { ref, triggerRef, watch } from 'vue'
import { ceilingOf, ceilingRange, ceilingZone } from '../lib/ceiling'
import { type BoundaryChange, deleteSpaceVertex, exteriorOnly, insertSpaceVertex, mountOnWall, onExteriorFace, snapshotEquipment, snapshotSpace } from '../lib/edit'
import { snapToGrid } from '../lib/grid'
import { josa } from '../lib/josa'
import type { Equipment, Model, Vec2 } from '../lib/model'
import { surfaceOf } from '../lib/mount'
import { overlapAt } from '../lib/overlap'
import { familyHeight } from '../lib/placement'
import { ceilingMode, editLock, refuseLock } from './ceiling'
import { stage } from './chat-view'
import { connectFrom, nameOfId } from './connections'
import { editing, model } from './core'
import { changes, storeyHeightOf } from './edit-report'
import { addEquipmentAt, adding } from './equipment-edit'
import { cm, moveInScene, relocate, shortName } from './equipment-shape'
import { addOpeningAt } from './facade'
import { equipmentById, selectedId } from './flow-rules'
import { activeVertex, alignAt, grid, vertexCount } from './grid-snap'
import { mark, remember } from './history'
import { note } from './keyboard'
import { areaChanges, editNotice, storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { editZoneVertex, zoneEdited } from './offset'
import { finishDraw, pipeHandoff, setPipeHandoff } from './pipe-handoff'
import { currentBox, sceneVersion } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { orphanNotice } from './space-edit'
import { addObjectAt, drawing, selectedSpace } from './space-objects'
import { multiView, verticalCreate } from './vertical'
import { createAnchor, createAnchored, placeRangeStart, placingRangeAt, placingVertical, stopPlaceVertical } from './vertical-create'

// --- 3D 에서 놓기 -------------------------------------------------------------------
//
// 좌표가 없는 설비는 x·y·z 를 숫자로 넣어야 했는데, 도면 좌표를 모르면 넣을 수가 없었다. [3D에서 놓기] 를 누르고 바닥을
// 누르면 그 자리에 놓는다. 높이는 같은 패밀리 설비의 바닥에서 높이(중앙값)를 따르고, 없으면 바닥에 두고 알린다 —
// 높이를 지어내지 않는다. 놓으면 여느 이동처럼 소속을 다시 판정하고 되돌리기에 쌓인다.
export const placing = ref<string | null>(null)
/** 놓는 방식. `wall` 이면 누른 자리에서 가장 가까운 벽 면에 붙인다(OE-OBJ-04 외벽 전용 설비). */
export const placingOn = ref<'floor' | 'wall'>('floor')
export function startPlace(id: string, on: 'floor' | 'wall' = 'floor') {
  const home = storeyOf(id)
  if (!home) return
  // 벽 전용 종류(콘센트)는 바닥에 놓지 않고 벽에 붙인다(OE-OBJ-10, 설치면 표 mount.ts)
  const target = equipmentById.value.get(id)
  // 천장 편집 모드(OE-OBJ-08): 천장 모드에서는 천장에, 바닥·벽 쪽에서는 바닥·벽에 놓는다. 천장 모드에는 벽에 붙이기가 없다.
  if (target && ceilingMode.value && on === 'wall') return refuseLock(target, '천장 편집 모드에서는 벽에 붙이지 않습니다. 바닥·벽 쪽에서 붙이세요.')
  const lock = target ? editLock(target) : null
  if (target && lock) return refuseLock(target, lock)
  if (ceilingMode.value && !ceilingOf(home)) {
    editNotice.value = `${home.name}의 천장고를 모릅니다. 천장 설비를 놓기 전에 왼쪽 도구에서 천장고를 입력하세요.`
    return
  }
  if (target && surfaceOf(target) === 'wall') on = 'wall'
  connectFrom.value = null
  placing.value = id
  placingOn.value = on
  viewer?.setPlaceMode(ceilingMode.value ? home.elevation + ceilingOf(home)!.height : home.elevation)
  // 바닥·천장에 놓을 때는 따로 안내하지 않는다(OE-EQP-02) — 팔레트의 눌린 항목과 십자 커서가 놓는 중임을 말한다. 벽에 붙이기는
  // 누를 자리(벽 면 가까이)가 달라서 알린다.
  if (on === 'wall') note(`${nameOfId(id)}${josa(nameOfId(id), '을/를')} 붙일 벽 면 가까이를 3D에서 클릭하세요. 바깥 면을 누르면 바깥에 붙습니다 (Esc 취소)`)
}
export function stopPlace() {
  placing.value = null
  placingOn.value = 'floor'
  viewer?.setPlaceMode(null)
}

/** 외벽 전용 설비(OE-OBJ-04)가 외벽 바깥 면에 있지 않은가. 패널 경고에 쓴다. */
export function exteriorMisplaced(e: Equipment): boolean {
  if (!exteriorOnly(e)) return false
  const home = storeyOf(e.id)
  return !e.position || !home || !onExteriorFace(home, [e.position[0], e.position[1]])
}
/** 설비를 벽 면에 붙인다(OE-OBJ-04). 여느 이동처럼 소속을 다시 재고 되돌리기에 쌓인다. 겹침 금지(OE-OBJ-16)도 같다. */
function mountAt(id: string, at: Vec2) {
  const m = model.value
  if (!m) return
  const before = equipmentById.value.get(id)?.position ?? null
  const snapshot = snapshotEquipment(m, id)
  const trial = structuredClone(m)
  const probe = mountOnWall(trial, id, [cm(at[0]), cm(at[1])])
  if (!probe) return
  if ('refused' in probe) return note(probe.refused)
  const target = trial.storeys.flatMap((st) => st.equipment).find((e) => e.id === id)!
  const blocked = overlapAt(m, id, target.position!, currentBox)
  if (blocked) {
    const name = shortName(blocked.name)
    editNotice.value = `이미 오브젝트가 있는 위치입니다(${name}${josa(name, '과/와')} 겹칩니다). 배관 없는 설비는 서로 겹쳐 놓을 수 없습니다.`
    viewer?.markConflict(blocked.id)
    return
  }
  const at0 = mark()
  const done = mountOnWall(m, id, [cm(at[0]), cm(at[1])])
  if (!done || 'refused' in done) return
  const wallName = done.wall.name || '벽'
  remember(`${shortName(done.change.equipmentName)} ${wallName}에 붙임`, snapshot, at0)
  moveInScene(id, before, equipmentById.value.get(id)?.position ?? null)
  changes.value = [...changes.value, done.change]
  triggerRef(model)
  note(`${wallName}에 붙였습니다. 벽을 옮기면 같이 갑니다`)
}
export function placeAt(at: Vec2) {
  // 구간을 늘린 계단·ES 의 새 층 시작점(OE-ML-08).
  if (placingRangeAt.value) {
    placeRangeStart(at)
    return
  }
  // 수직 관통 오브젝트의 시작점·승강로 위치(OE-ML-06). 한 번 찍으면 끝난다.
  if (placingVertical.value && verticalCreate.value) {
    const c = verticalCreate.value
    const a = createAnchored.value
    const k = createAnchor.value
    if (a && k) {
      // 고정한 지점은 반올림하지 않는다 — cm 로 깎으면 이어진 지점이 그만큼 어긋난 채로 시작한다.
      c.at = [a.at[0], a.at[1]]
      c.heading = a.heading
      c.link = { kind: k.kind, to: k.parentId, name: k.name, heading: k.heading }
    } else {
      c.at = [cm(at[0]), cm(at[1])]
      c.link = null
    }
    stopPlaceVertical()
    return
  }
  // 스냅(OE-UI-06)·그리드 정렬(OE-UI-07)을 켰으면 그리기에서 찍은 점을 붙을 자리로 옮긴다. 설비 놓기는 따르지 않는다.
  if (drawing.value && !multiView.value) at = alignAt(at, drawing.value.storeyId)?.at ?? at
  else if (drawing.value && grid.value.on) at = snapToGrid(at, grid.value.spacing)
  if (drawing.value) {
    const d = drawing.value
    drawing.value = { ...d, points: [...d.points, [cm(at[0]), cm(at[1])]], ...(d.levels && d.work ? { levels: [...d.levels, { ...d.work }] } : {}) }
    // 나눌 선은 두 점이면 끝난다.
    if ((drawing.value.purpose === 'split' || drawing.value.purpose === 'wall' || drawing.value.purpose === 'customSplit' || drawing.value.purpose === 'room' || drawing.value.purpose === 'bgScale') && drawing.value.points.length === 2) finishDraw()
    // 배경 원점(OE-MAN-02)·계단 진입/종료 지점(OE-ML-08)은 한 점이면 끝난다.
    else if (drawing.value.purpose === 'bgAnchor' || drawing.value.purpose === 'verticalPoint') finishDraw()
    return
  }
  if (adding.value) {
    if (adding.value.what === 'equipment') addEquipmentAt(at)
    else if (adding.value.what === 'object') addObjectAt(at)
    else addOpeningAt(at)
    return
  }
  const id = placing.value
  const m = model.value
  const on = placingOn.value
  stopPlace()
  if (id && on === 'wall') return mountAt(id, at)
  const home = id ? storeyOf(id) : null
  const target = id ? equipmentById.value.get(id) : null
  if (!m || !id || !home || !target) return
  // 천장 모드: 구역의 기본 z 에 놓는다 — 반자 부착은 반자 높이, 플레넘은 반자 바로 위(OE-EQP-02·04).
  if (ceilingMode.value) {
    const zone = ceilingZone(target.kind) ?? 'attached'
    const range = ceilingRange(zone, ceilingOf(home)?.height ?? null, storeyHeightOf.value.get(home.id)?.value ?? null)
    if (!range) return
    if (!relocate(id, [cm(at[0]), cm(at[1]), cm(home.elevation + range.base)])) return
    note(`${zone === 'plenum' ? '플레넘(천장고 바로 위)' : '천장고'}에 놓았습니다(바닥에서 ${range.base.toFixed(2)}m). 높이는 z 칸에서 고치세요`)
    return
  }
  // 종류를 모르면 허용 설치면을 알 수 없어 바닥에 놓는다(OE-EQP-02).
  if (!target.kind) {
    if (!relocate(id, [cm(at[0]), cm(at[1]), cm(home.elevation)])) return
    note('종류를 모르는 설비라 바닥 높이에 놓았습니다. 종류를 정한 뒤 높이를 고치세요')
    return
  }
  const family = familyHeight(m, target)
  const h = family ?? 0
  if (!relocate(id, [cm(at[0]), cm(at[1]), cm(home.elevation + h)])) return
  note(family !== null ? `같은 패밀리의 높이(바닥에서 ${h.toFixed(2)}m)로 놓았습니다` : '바닥 높이에 놓았습니다. 높이는 z 칸에서 고치세요')
}

// --- 물리존 꼭짓점 넣기·지우기, 외곽선 그리기 -------------------------------------------------
//
// 꼭짓점을 옮기기만 해서는 ㄱ자 방을 사각형으로 바꾸거나 모서리를 더 낼 수 없었고, 외곽선을 못 읽은 방(병원의 CORRIDOR·
// OPEN TO BELOW)은 손댈 길이 없었다. 셋 다 경계를 통째로 바꾸는 편집이라 한 길(changeFootprint)로 기록한다 — 꼭짓점을
// 끈 것과 같이 넓이·소속을 다시 재고, 되돌리기·리포트·편집 파일에 들어간다.
export function changeFootprint(spaceId: string, label: string, apply: (m: Model) => BoundaryChange | null): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotSpace(m, spaceId)
  const at = mark()
  const change = apply(m)
  if (!change) return false
  remember(label, snapshot, at)
  areaChanges.value = [...areaChanges.value, change]
  changes.value = [...changes.value, ...change.equipment]
  orphanNotice(change.equipment)
  triggerRef(model)
  viewer?.updateSpaces(m)
  sceneVersion.value++
  return true
}
export function editVertex(op: 'insert' | 'delete'): boolean {
  if (zoneEdited.value) return editZoneVertex(op)
  const picked = selectedSpace.value
  const i = activeVertex.value
  if (!picked || i === null) return false
  const id = picked.space.id
  const name = picked.space.longName || picked.space.name
  if (op === 'insert') {
    if (changeFootprint(id, `${name} 꼭짓점 넣기`, (m) => insertSpaceVertex(m, id, i))) {
      activeVertex.value = i + 1
      note(`꼭짓점을 넣었습니다(${i + 2}번). ←↑→↓로 옮깁니다`)
    }
    return true
  }
  if (vertexCount.value <= 3) {
    note('꼭짓점이 셋이라 더 지울 수 없습니다')
    return true
  }
  if (changeFootprint(id, `${name} 꼭짓점 지우기`, (m) => deleteSpaceVertex(m, id, i))) {
    activeVertex.value = Math.min(i, vertexCount.value - 1)
    note('꼭짓점을 지웠습니다')
  }
  return true
}
export function startDraw(spaceId: string) {
  const m = model.value
  const storey = m?.storeys.find((s) => s.spaces.some((x) => x.id === spaceId))
  const space = storey?.spaces.find((x) => x.id === spaceId)
  if (!storey || !space) return
  stopPlace()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  if (m!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'footprint', spaceId, storeyId: storey.id, name: space.longName || space.name, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
  stage.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
export function stopDraw() {
  drawing.value = null
  setPipeHandoff(null)
  viewer?.setPlaceMode(null)
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupPlace() {
  watch([selectedId, editing, viewStorey], () => {
    if (placing.value && (selectedId.value !== placing.value || !editing.value)) stopPlace()
  })
}
