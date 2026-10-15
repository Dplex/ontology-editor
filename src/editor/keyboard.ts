import { nextTick, onBeforeUnmount, ref, triggerRef } from 'vue'
import { familyKeyOf, moveSpaceVertex, snapshotSpace, wouldSelfIntersect } from '../lib/edit'
import { doubleTap, nextStoreyEye } from '../lib/fly-storey'
import { isConduit, type Vec2, type Vec3 } from '../lib/model'
import { replayOpen } from '../lib/replay-player'
import { findRoom, resizeRoom } from '../lib/room'
import { matchShortcut, type Shortcut, snapAxis } from '../lib/shortcuts'
import { setPartVertex } from '../lib/vertical-edit'
import { findPart } from '../lib/vertical-object'
import { ceilingMode, editPart, selectedLock, setCeilingMode, setEditPart, SPACE_IN_EQUIPMENT } from './ceiling'
import { selectAndShow } from './chat-view'
import { checks, openCheck, openCheckKey, systemById } from './checks'
import { connectFrom } from './connections'
import { activeTab, closeContext, ctxMenu } from './context-menu'
import { editing, mode, model } from './core'
import { changes, spaceNameOf } from './edit-report'
import { adding, cancelAddEquipment, selectedElementId, startDuplicate, stopAdd } from './equipment-edit'
import { cm, relocate, shortName } from './equipment-shape'
import { leaveEdit } from './exit-edit'
import { compareOpen, selectedElement } from './export-compare'
import { nudgeElement } from './facade'
import { spaceView } from './flow-map'
import { activeArrow, arrowConnections, confirmRule, cycleFlow, equipmentById, flowDraft, flowText, relLabel, selected, selectedId, selectedNeighbors, selectedRule, showRules } from './flow-rules'
import { activeVertex, dragAlign, vertexCount, zoneActiveVertex, zoneVertexEdit } from './grid-snap'
import { future, history, isTextEntry, mark, redo, remember, undo } from './history'
import { drawnWalls, showWalls } from './idf-zones'
import { selectedSystemId, unknownTypes } from './kinds'
import { labelStorey, replay, showLabels, showPlan } from './labels'
import { areaChanges, deleteGroup, editNotice, group, moveToStorey, nudgeGroup } from './multi-select'
import { viewStorey } from './multi-view'
import { moveZoneCorner, nudgeZoneVertex, stepZoneVertex, zoneEdited } from './offset'
import { perfOn } from './panels'
import { finishDraw } from './pipe-handoff'
import { editVertex, placing, stopDraw, stopPlace } from './place'
import { saveEdits } from './progress'
import { sceneVersion } from './redraw'
import { changeRooms, nudgeRoom, selectedRoom, selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { orphanNotice, selectedCustomZone, selectedCustomZoneId } from './space-edit'
import { drawing, nudgeObject, removeObject, selectedObject, selectedObjectId, selectedSpace } from './space-objects'
import { frameNetwork, select } from './systems'
import { changeVerticals, MULTI_VIEW_ONLY, multiView, nudgeVertical, refuseVertical, selectedVertical, selectedVerticalId, verticalDeleteAsk } from './vertical'
import { placingRangeAt, placingVertical, stopPlaceVertical, stopRangeStart } from './vertical-create'
import { classTintOn, enterSpaceView, exitSpaceView, filterOpen, stepSpace } from './view-filter'

// --- 단축키 -------------------------------------------------------------------------
//
// 키 표는 lib/shortcuts.ts 하나다. `?` 안내도 같은 표를 읽는다. 여기는 눌린 키를 받아 할 일로 옮기기만 한다.
// 처리한 키만 브라우저 기본 동작을 막는다 — 고른 설비가 없을 때 ↓ 는 여전히 페이지를 내린다.
export const helpOpen = ref(false)
/** 키로 한 일을 캔버스 아래에 잠깐 알린다. 버튼과 달리 키는 누른 결과가 눈에 안 보일 때가 많다. */
export const keyNote = ref('')
let keyNoteTimer: number | undefined
export function note(text: string) {
  // 리플레이가 되돌리기·다시 하기를 부르는 동안의 "되돌렸습니다" 는 알릴 것이 아니다.
  if (replayOpen.value) return
  keyNote.value = text
  window.clearTimeout(keyNoteTimer)
  keyNoteTimer = window.setTimeout(() => (keyNote.value = ''), 2600)
}

// --- 비행 모드 ---
// G 로 켜고 끈다. 켜져 있는 동안 W·A·S·D·Q·E(와 Shift)는 이동이라 단축키로 보내지 않는다 — W(내력벽)·E(보기↔편집)·D(방향
// 미리보기)는 쉰다. 글자 칸에서는 그대로 글자다. 리플레이를 열거나 평면도로 가면 끈다.
export const flying = ref(false)
const FLY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'])
export function setFlying(on: boolean) {
  if (flying.value === on) return
  flying.value = on
  viewer?.setFly(on)
  note(on ? '비행 모드 — WASD 이동 · Q/E 내려가기·올라가기 · E E·Q Q 위층·아래층 · 드래그 둘러보기 · 휠 빠르기 · G·Esc 나가기' : '비행 모드를 껐습니다')
}
/**
 * 비행 중 층 이동(fly-storey.ts). E·Q 를 짧게 두 번 누르면 위층·아래층 눈높이(바닥 + 1.6m)로 옮긴다. 보일 층이 한 층이면 그 층으로
 * 같이 넘기고, 모든 층이면 그대로 둔다. 두 번째 누름은 이동 키로 넘기지 않는다 — 넘기면 옮기는 동안 천천히 오르내리기가 겹친다.
 */
const flyTap = doubleTap()
function flyStorey(dir: 1 | -1) {
  const m = model.value
  if (!m || !viewer) return
  const next = nextStoreyEye(m.storeys, viewer.eyeHeight(), dir)
  if (!next) return note(dir === 1 ? '맨 위층입니다' : '맨 아래층입니다')
  viewer.flyToHeight(next.z)
  if (viewStorey.value && !multiView.value) viewStorey.value = next.storey.id
  note(`${next.storey.name} 눈높이로 옮겼습니다`)
}
function onKeyUp(e: KeyboardEvent) {
  if (flying.value && FLY_CODES.has(e.code)) viewer?.flyKey(e.code, false)
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing || !model.value) return
  if (replayOpen.value) {
    if (replay.key(e)) e.preventDefault()
    return
  }
  if (flying.value && FLY_CODES.has(e.code) && !isTextEntry(e.target) && !(e.ctrlKey || e.metaKey || e.altKey)) {
    if ((e.code === 'KeyE' || e.code === 'KeyQ') && !e.repeat && flyTap(e.code, e.timeStamp)) {
      flyStorey(e.code === 'KeyE' ? 1 : -1)
      e.preventDefault()
      return
    }
    viewer?.flyKey(e.code, true)
    e.preventDefault()
    return
  }
  // 글자 칸의 Esc 는 칸에서 나온다. 좌표를 넣은 뒤 마우스 없이 다음 단축키(N, U …)로 이어 가게 한다.
  if (e.key === 'Escape' && isTextEntry(e.target) && !helpOpen.value) {
    ;(e.target as HTMLElement).blur()
    e.preventDefault()
    return
  }
  const shortcut = matchShortcut(e)
  if (!shortcut) return
  // 모아 둔 방향키는 다른 키보다 먼저 옮긴다. 안 그러면 방향키 바로 뒤의 Ctrl+Z 가 옮기기 전을 되돌리고, 옮기기는
  // 그 뒤에 일어난다.
  if (shortcut.id !== 'nudge') flushNudge()
  // 안내가 열려 있으면 뒤의 화면은 키를 받지 않는다(닫기는 대화상자가 Esc 로 한다).
  if (helpOpen.value && shortcut.id !== 'help') return
  // 글자를 치는 칸의 키는 그 칸 몫이다(그 칸의 Ctrl+Z 는 글자 되돌리기다). 선택 상자는 글자·방향키로 항목을
  // 고르니 수식 키 없는 키는 넘기고, Ctrl 조합과 Esc 만 받는다.
  // 저장만은 글자 칸에서도 받는다. 거기서 Ctrl+S 는 브라우저의 "페이지 저장" 이라 쓸모가 없다.
  if (isTextEntry(e.target) && shortcut.id !== 'save') return
  if (e.target instanceof HTMLSelectElement && !(e.ctrlKey || e.metaKey) && shortcut.id !== 'escape') return
  // 보기 모드에는 고치는 손잡이가 없다. 끄는 중에는 Esc 가 뷰어의 취소다.
  if (shortcut.edit && !editing.value) return
  // 다중층 뷰는 아직 보기만 한다(OE-ML-01). 편집 키는 무엇을 막았는지 알린다.
  // 고른 수직 관통 오브젝트의 방향키(전체 이동)와 Delete(지우기 확인)는 다중층 뷰의 편집이다(OE-ML-07·09).
  // 되돌리기·다시 하기는 다중층 뷰의 편집도 되돌린다.
  // 고른 덕트·배관의 방향키(꺾임점 옮기기)도 다중층 뷰의 편집이다(OE-PIP-10 AC1).
  const verticalKey =
    (!!selectedVertical.value && (shortcut.id === 'nudge' || shortcut.id === 'vertexDelete')) ||
    (shortcut.id === 'nudge' && !!selected.value && isConduit(selected.value.role)) ||
    shortcut.id === 'undo' ||
    shortcut.id === 'redo' ||
    (!!drawing.value && shortcut.id === 'drawFinish')
  if (shortcut.edit && multiView.value && !verticalKey) {
    editNotice.value = MULTI_VIEW_ONLY
    e.preventDefault()
    return
  }
  if (viewer?.isDragging()) return
  if (runShortcut(shortcut, e)) e.preventDefault()
}

export const searchInput = ref<HTMLInputElement | null>(null)
export const kindSelect = ref<HTMLSelectElement | null>(null)

/** 단축키 하나를 한다. 할 것이 없어서 넘긴 키는 false 다(브라우저 기본 동작을 살린다). */
export function runShortcut(s: Shortcut | Shortcut['id'], e?: KeyboardEvent): boolean {
  const id = typeof s === 'string' ? s : s.id
  switch (id) {
    case 'help':
      helpOpen.value = !helpOpen.value
      return true
    case 'replay':
      void replay.open()
      return true
    case 'spaceNext':
    case 'spacePrev':
    case 'spaceNextEmpty':
    case 'spacePrevEmpty':
      if (activeTab.value !== '3d' || replayOpen.value) return false
      stepSpace(id === 'spaceNext' || id === 'spaceNextEmpty' ? 1 : -1, id === 'spaceNextEmpty' || id === 'spacePrevEmpty')
      return true
    case 'spaceView':
      if (activeTab.value !== '3d' || replayOpen.value) return false
      if (spaceView.value) exitSpaceView()
      else if (selectedSpaceId.value) enterSpaceView(selectedSpaceId.value)
      else note('방을 먼저 고르세요 — 바닥을 누르거나 , . 로 옮겨 다닙니다')
      return true
    case 'mode':
      if (editing.value) {
        if (leaveEdit()) note('보기 모드')
      } else {
        mode.value = 'edit'
        note('편집 모드')
      }
      return true
    case 'search':
      if (!searchInput.value) return false
      searchInput.value.scrollIntoView({ block: 'center' })
      searchInput.value.focus()
      return true
    case 'escape':
      if (flying.value) {
        setFlying(false)
        return true
      }
      if (ctxMenu.value) {
        closeContext()
        return true
      }
      return clearSelection()
    case 'frame':
      return frameSelection()
    case 'frameAll':
      viewer?.frameAll()
      return true
    case 'topView':
      if (activeTab.value !== '3d' || replayOpen.value) return false
      viewer?.viewFrom([0, 1, 0])
      note('위에서 내려다보는 시점으로 맞췄습니다')
      return true
    case 'filterToggle':
      if (activeTab.value !== '3d' || replayOpen.value) return false
      filterOpen.value = !filterOpen.value
      return true
    case 'planToggle':
      if (replayOpen.value || multiView.value) return false
      if (activeTab.value === '3d') showPlan()
      else activeTab.value = '3d'
      return true
    case 'explodeToggle':
      // 독의 [Explode](종류별 색)를 켜고 끈다. 공중에 띄우는 분해도는 서랍·우클릭 메뉴에서만 연다.
      if (activeTab.value !== '3d' || replayOpen.value) return false
      classTintOn.value = !classTintOn.value
      return true
    case 'labelsToggle':
      if (activeTab.value !== '3d' || replayOpen.value) return false
      if (!labelStorey.value) {
        note('층 하나를 선택하면 설비 라벨을 표시할 수 있습니다')
        return true
      }
      showLabels.value = !showLabels.value
      return true
    case 'compareToggle':
      if (activeTab.value !== '3d' || replayOpen.value) return false
      compareOpen.value = !compareOpen.value
      return true
    case 'fly':
      if (activeTab.value !== '3d') return false
      setFlying(!flying.value)
      return true
    case 'perf':
      perfOn.value = !perfOn.value
      return true
    case 'rules':
      showRules.value = !showRules.value
      note(showRules.value ? '3D에 규칙 방향을 표시합니다' : '3D에서 규칙 방향을 숨깁니다')
      return true
    case 'walls':
      if (!drawnWalls.value) {
        note('표시할 벽이 없습니다')
        return true
      }
      showWalls.value = !showWalls.value
      return true
    case 'save':
      void saveEdits()
      return true
    case 'undo':
      if (!history.value.length) note('되돌릴 편집이 없습니다')
      undo()
      return true
    case 'redo':
      if (!future.value.length) note('다시 할 편집이 없습니다')
      redo()
      return true
    case 'nudge':
      return e ? nudge(e.code, e.shiftKey ? 1 : 0.1) : false
    case 'storeyUp':
    case 'storeyDown':
      return stepStorey(id === 'storeyUp' ? 1 : -1)
    case 'duplicate':
      if (!selected.value || selectedLock.value) return false
      startDuplicate(selected.value)
      return true
    case 'arrowPrev':
    case 'arrowNext':
      return stepArrow(id === 'arrowNext' ? 1 : -1)
    case 'flow':
      return flowByKey()
    case 'ceiling':
      setCeilingMode(!ceilingMode.value)
      return true
    case 'editPart':
      setEditPart(editPart.value === 'space' ? 'equipment' : 'space')
      return true
    case 'confirm': {
      const r = selectedRule.value
      if (!r) return false
      if (r.confirmed && !r.recheck) note(`이미 확정한 계통입니다: ${r.name}`)
      else if (r.count === 0) note('이 계통에는 규칙 방향이 없습니다')
      else confirmRule(r.systemId, r.name)
      return true
    }
    case 'kind':
      if (!kindSelect.value) return false
      kindSelect.value.focus()
      try {
        // 목록을 바로 편다. 닫힌 채 방향키로 고르면 누를 때마다 종류가 바뀌고 규칙을 다시 돌린다.
        kindSelect.value.showPicker()
      } catch {
        // showPicker 가 없는 브라우저는 포커스만 옮긴다(Alt+↓ 로 편다).
      }
      return true
    case 'nextUnknown':
    case 'prevUnknown':
      return stepUnknown(id === 'nextUnknown' ? 1 : -1)
    case 'nextIssue':
    case 'prevIssue':
      return stepIssue(id === 'nextIssue' ? 1 : -1)
    case 'vertexInsert':
      return editVertex('insert')
    case 'vertexDelete':
      // 여러 개 고른 설비가 있으면 같이 지운다(OE-UI-09). 없으면 짚은 꼭짓점 지우기.
      if (group.value.length >= 2) return deleteGroup()
      if (selectedObject.value) {
        removeObject()
        return true
      }
      if (selectedVertical.value) {
        if (!multiView.value) return refuseVertical()
        verticalDeleteAsk.value = true
        return true
      }
      return editVertex('delete')
    case 'drawFinish':
      return finishDraw()
  }
}

/**
 * N. 완전성 검사를 할 일 목록으로 쓴다 — 어긴 것을 하나씩 골라 고치고 N 으로 다음 것에 간다. 고친 것은 목록에서
 * 빠지므로, 고른 것이 목록에 없으면 남은 것의 처음부터 간다. 펼친 규칙이 없으면 어긴 것이 있는 첫 규칙을 편다.
 */
function stepIssue(dir: 1 | -1): boolean {
  const failing = checks.value.filter((c) => !c.skipped && c.failed.length > 0)
  if (!failing.length) {
    note('완전성 검사 위반이 없습니다')
    return true
  }
  const check = openCheck.value && openCheck.value.failed.length ? openCheck.value : failing[0]
  openCheckKey.value = check.key
  const ids = check.failed
  const here = selectedId.value ? ids.indexOf(selectedId.value) : -1
  const i = here < 0 ? (dir > 0 ? 0 : ids.length - 1) : (here + dir + ids.length) % ids.length
  selectAndShow(ids[i])
  const e = equipmentById.value.get(ids[i])
  note(`${check.rule} — 위반 ${i + 1}/${ids.length}: ${shortName(e?.name || e?.ifcClass)}`)
  return true
}

/** Esc. 짚은 연결 → 고른 설비·물리존·계통 → 펼친 검사 순으로 하나씩 푼다. */
function clearSelection(): boolean {
  if (drawing.value) {
    const purpose = drawing.value.purpose
    stopDraw()
    note(
      purpose === 'split' || purpose === 'customSplit'
        ? '나누기를 취소했습니다'
        : purpose === 'create'
          ? '물리존 그리기를 취소했습니다'
          : purpose === 'custom'
            ? '커스텀존 그리기를 취소했습니다'
            : purpose === 'hvacZone' || purpose === 'hvacZoneOutline'
              ? '공조존 그리기를 취소했습니다'
            : purpose === 'pipe'
              ? '배관 그리기를 취소했습니다. 아무것도 남기지 않았습니다'
            : purpose === 'bgScale' || purpose === 'bgAnchor'
              ? '배경 맞추기를 취소했습니다'
            : purpose === 'room'
              ? '룸 그리기를 취소했습니다'
            : purpose === 'verticalFootprint' || purpose === 'verticalPoint'
              ? '계단 구간 채우기를 취소했습니다. 고르던 구간은 그대로입니다'
            : '외곽선 그리기를 취소했습니다',
    )
  } else if (placingRangeAt.value) {
    stopRangeStart()
    note('시작점 찍기를 그만뒀습니다. 고르던 구간은 그대로입니다')
  } else if (placingVertical.value) {
    stopPlaceVertical()
    note('시작점·위치 찍기를 그만뒀습니다. 만들던 것은 그대로입니다')
  } else if (zoneVertexEdit.value) {
    zoneVertexEdit.value = null
    note('공조존 꼭짓점 고치기를 마쳤습니다')
  } else if (adding.value) {
    const what = adding.value.what
    if (what === 'equipment') cancelAddEquipment()
    else stopAdd()
    note(what === 'equipment' ? '설비 더하기를 취소했습니다' : what === 'door' ? '문 놓기를 취소했습니다' : what === 'object' ? '오브젝트 놓기를 취소했습니다' : '창 놓기를 취소했습니다')
  } else if (group.value.length) {
    group.value = []
  } else if (selectedElementId.value) {
    selectedElementId.value = null
  } else if (selectedVerticalId.value) {
    selectedVerticalId.value = null
  } else if (selectedRoomId.value) {
    selectedRoomId.value = null
  } else if (selectedObjectId.value) {
    selectedObjectId.value = null
  } else if (selectedCustomZoneId.value) {
    selectedCustomZoneId.value = null
  } else if (placing.value) {
    stopPlace()
    note('놓기를 취소했습니다')
  } else if (connectFrom.value) {
    connectFrom.value = null
    note('연결하기를 취소했습니다')
  } else if (activeArrow.value !== null) activeArrow.value = null
  else if (activeVertex.value !== null) activeVertex.value = null
  else if (selectedId.value) select(null)
  else if (selectedSpaceId.value) selectedSpaceId.value = null
  else if (selectedSystemId.value) selectedSystemId.value = null
  else if (spaceView.value) exitSpaceView()
  else if (openCheckKey.value) openCheckKey.value = null
  else return false
  return true
}

function frameSelection(): boolean {
  if (selectedId.value) frameNetwork()
  else if (selectedSpaceId.value) viewer?.frameSpace(selectedSpaceId.value)
  else if (selectedCustomZone.value?.equipment.length) viewer?.frame(selectedCustomZone.value.equipment)
  else if (selectedSystemId.value) viewer?.frame(systemById.value.get(selectedSystemId.value)?.memberIds ?? [])
  else if (openCheck.value?.failed.length) viewer?.frame(openCheck.value.failed)
  else viewer?.frameAll()
  return true
}

/** 방향키. 화면의 오른쪽·위쪽에 가장 가까운 평면 축으로 옮긴다(snapAxis). */
function nudge(code: string, step: number): boolean {
  if (group.value.length >= 2) return nudgeGroup(code, step)
  if (!selected.value && selectedVertical.value) return multiView.value ? nudgeVertical(code, step) : refuseVertical()
  if (!selected.value && selectedRoom.value) return nudgeRoom(code, step)
  if (zoneEdited.value && viewer) return nudgeZoneVertex(code, step)
  if (!selected.value && selectedObject.value) return nudgeObject(code, step)
  if (!selected.value && selectedElement.value && viewer) return nudgeElement(code, step)
  if (!selected.value && selectedSpace.value && viewer) return nudgeVertex(code, step)
  const e = selected.value
  if (!e || !viewer) return false
  if (!e.position) {
    note('좌표가 없는 설비입니다. 먼저 x·y·z를 넣으세요.')
    return true
  }
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const dx = sign * ax * step
  const dy = sign * ay * step
  if (pendingNudge?.id === e.id) {
    pendingNudge.dx += dx
    pendingNudge.dy += dy
    return true
  }
  flushNudge()
  pendingNudge = { id: e.id, dx, dy }
  requestAnimationFrame(flushNudge)
  return true
}

// 방향키는 한 프레임에 모아 한 번에 옮긴다. 성수에서 한 번 옮기는 데 0.2초가 들어서, 꾹 누른 키(초당 수십 번)를
// 하나씩 옮기면 키가 줄을 서서 손을 뗀 뒤에도 몇 초씩 따라 움직였다.
let pendingNudge: { id: string; dx: number; dy: number } | null = null
let pendingVertexNudge: { spaceId: string; index: number; to: Vec2 } | null = null
export function flushNudge() {
  const pv = pendingVertexNudge
  pendingVertexNudge = null
  if (pv && model.value) {
    if (!wouldSelfIntersect(model.value, pv.spaceId, pv.index, pv.to)) {
      moveVertex(pv.spaceId, pv.index, pv.to, `vertex:${pv.spaceId}:${pv.index}`)
      const sp = selectedSpace.value?.space.id === pv.spaceId ? selectedSpace.value.space : null
      if (sp) note(`꼭짓점 ${pv.index + 1} → (${pv.to[0].toFixed(2)}, ${pv.to[1].toFixed(2)}) · ${sp.areaM2.toFixed(1)}㎡`)
    } else {
      note('경계선이 교차해서 옮기지 않았습니다')
      sceneVersion.value++
    }
  }
  const p = pendingNudge
  pendingNudge = null
  const e = p ? equipmentById.value.get(p.id) : undefined
  if (!p || !e?.position) return
  const to: Vec3 = [cm(e.position[0] + p.dx), cm(e.position[1] + p.dy), e.position[2]]
  relocate(e.id, to, undefined, `nudge:${e.id}`)
  note(`${shortName(e.name)} → x ${to[0].toFixed(2)} · y ${to[1].toFixed(2)} · ${spaceNameOf(equipmentById.value.get(e.id)?.spaceId ?? null)}`)
}

/** 짚은 꼭짓점을 방향키로. 끌어 놓을 때처럼 경계가 엇갈리는 자리에는 놓지 않는다. */
function nudgeVertex(code: string, step: number): boolean {
  if (editPart.value !== 'space') {
    editNotice.value = SPACE_IN_EQUIPMENT
    return true
  }
  const picked = selectedSpace.value!
  const index = activeVertex.value
  if (index === null) {
    note('[ ]로 꼭짓점을 먼저 고르세요')
    return true
  }
  const base =
    pendingVertexNudge && pendingVertexNudge.spaceId === picked.space.id && pendingVertexNudge.index === index
      ? pendingVertexNudge.to
      : picked.space.footprint[index]
  const { right, up } = viewer!.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const to: Vec2 = [cm(base[0] + sign * ax * step), cm(base[1] + sign * ay * step)]
  if (wouldSelfIntersect(model.value!, picked.space.id, index, to)) {
    note('경계선이 교차해서 옮기지 않았습니다')
    return true
  }
  viewer?.previewVertex(index, to)
  if (pendingVertexNudge && pendingVertexNudge.spaceId === picked.space.id && pendingVertexNudge.index === index) {
    pendingVertexNudge.to = to
    return true
  }
  flushNudge()
  pendingVertexNudge = { spaceId: picked.space.id, index, to }
  requestAnimationFrame(flushNudge)
  return true
}

function stepStorey(dir: 1 | -1): boolean {
  const e = selected.value
  const m = model.value
  if (!e || !m) return false
  const order = [...m.storeys].sort((a, b) => a.elevation - b.elevation)
  const at = order.findIndex((s) => s.equipment.some((x) => x.id === e.id))
  const next = order[at + dir]
  if (!next) {
    note(dir > 0 ? '맨 위층입니다' : '맨 아래층입니다')
    return true
  }
  // 막혔으면(겹침) 안내가 이미 떴으니 덮어쓰지 않는다
  if (moveToStorey(e.id, next.id)) note(`${shortName(e.name)} → ${next.name}`)
  return true
}

function stepArrow(dir: 1 | -1): boolean {
  if (zoneEdited.value) {
    stepZoneVertex(dir)
    return true
  }
  // 물리존을 골랐으면 [ ] 는 꼭짓점을 짚는다.
  if (!selected.value && selectedSpace.value) {
    const n = vertexCount.value
    if (n === 0) return false
    const cur = activeVertex.value
    activeVertex.value = cur === null ? (dir > 0 ? 0 : n - 1) : (cur + dir + n) % n
    const p = selectedSpace.value.space.footprint[activeVertex.value]
    note(`꼭짓점 ${activeVertex.value + 1}/${n} (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) · ←↑→↓로 옮깁니다`)
    return true
  }
  const n = arrowConnections.value.length
  if (!selected.value) return false
  if (n === 0) {
    note('고른 설비에 연결이 없습니다')
    return true
  }
  const cur = activeArrow.value
  activeArrow.value = cur === null ? (dir > 0 ? 0 : n - 1) : (cur + dir + n) % n
  const row = selectedNeighbors.value[activeArrow.value]
  if (row) note(`연결 ${activeArrow.value + 1}/${n}: ${shortName(row.name)} (${relLabel(row)}) · D로 방향을 미리 봅니다`)
  return true
}

function flowByKey(): boolean {
  const n = arrowConnections.value.length
  if (!selected.value) return false
  if (n === 0) {
    note('고른 설비에 연결이 없습니다')
    return true
  }
  if (activeArrow.value === null) {
    if (n > 1) {
      activeArrow.value = 0
      note(`연결이 ${n}개입니다. [ ]로 고른 뒤 D를 누르세요`)
      return true
    }
    activeArrow.value = 0
  }
  cycleFlow(String(activeArrow.value))
  const row = selectedNeighbors.value[activeArrow.value]
  const draft = flowDraft.value
  if (row && !row.connection.directed) {
    note(draft ? `${shortName(row.name)}: 미리보기 ${flowText(draft.connection, draft.from)} · Enter 로 적용합니다` : `${shortName(row.name)}: ${relLabel(row)}`)
  }
  // 키보드로 미리 봤으면 [적용] 에 초점을 둔다. Enter 가 그 버튼을 누른다 — 단축키 Enter(외곽선 마치기)는 그리는 중이 아니면
  // 아무것도 하지 않고 넘긴다. 사유 칸에 두면 D 를 다시 눌러 다음 미리보기로 갈 때 글자로 들어간다. 사유가 필요하면 [적용] 이
  // 거절하면서 사유 칸으로 옮긴다(submitFlow).
  if (draft) void nextTick(() => document.querySelector<HTMLElement>('[data-testid="flow-apply"]')?.focus())
  return true
}

/** U. 종류를 모르는 패밀리를 대수 순으로 하나씩 돌며 그 패밀리의 설비 하나를 고른다. K 로 바로 종류를 붙인다. */
function stepUnknown(dir: 1 | -1): boolean {
  const list = unknownTypes.value
  if (!list.length) {
    note('종류를 모르는 설비가 없습니다')
    return true
  }
  const here = selected.value ? list.findIndex((t) => t.key === familyKeyOf(selected.value!)) : -1
  const i = here < 0 ? (dir > 0 ? 0 : list.length - 1) : (here + dir + list.length) % list.length
  const t = list[i]
  selectAndShow(t.sampleId)
  note(`종류 모르는 패밀리 ${i + 1}/${list.length}: ${t.label} ${t.count}대 · K로 종류를 고릅니다`)
  return true
}

export function applyVertex(spaceId: string, index: number, axis: 0 | 1, raw: string, current: readonly number[]) {
  const value = Number(raw)
  if (!model.value || !Number.isFinite(value)) return

  const point: [number, number] = [current[0], current[1]]
  point[axis] = value

  moveVertex(spaceId, index, point)
}

/** 꼭짓점 하나를 옮긴다. 표와 3D 가 같이 쓴다. 자기 교차를 막을지는 부르는 쪽이 정한다. */
function moveVertex(spaceId: string, index: number, to: Vec2, coalesce?: string) {
  if (!model.value) return
  const snapshot = snapshotSpace(model.value, spaceId)
  const at = mark()
  const change = moveSpaceVertex(model.value, spaceId, index, to)
  if (!change) return
  remember(`${change.spaceName} 꼭짓점`, snapshot, at, coalesce)
  areaChanges.value = [...areaChanges.value, change]
  changes.value = [...changes.value, ...change.equipment]
  orphanNotice(change.equipment)
  triggerRef(model)
  // 설비는 그대로다. 판만 다시 만든다.
  viewer?.updateSpaces(model.value)
  sceneVersion.value++
}

/**
 * 3D 에서 꼭짓점을 끌어 놓았다. 표에서 숫자로 고칠 때와 달리 **자기 교차가 되는 자리에는 놓지 않는다** —
 * 마우스로 끌다 엇갈린 것은 뜻한 모양이 아니고, 놓은 뒤에 알리면 넓이와 소속이 이미 뜻 없는 값으로 바뀐 뒤다.
 */
export function dropVertex(spaceId: string, index: number, raw: Vec2) {
  if (!model.value) return
  // 평면도에서 끈 꼭짓점도 3D 와 같이 보정한다(3D 는 끄는 동안 이미 보정해 넘긴다 — 다시 대도 같은 자리다).
  const aligned = dragAlign.point(spaceId, index, raw)
  const to: Vec2 = [cm(aligned[0]), cm(aligned[1])]
  // 공조존의 꼭짓점(OE-ZON-04).
  if (zoneEdited.value?.zone.id === spaceId) {
    moveZoneCorner(index, to)
    return
  }
  // 수직 관통 오브젝트 조각의 꼭짓점(OE-ML-07, 다중층 뷰).
  if (findPart(model.value, spaceId)) {
    let refused = ''
    const done = changeVerticals(`${selectedVertical.value?.part.name || '계단'} 형상`, (m) => {
      const r = setPartVertex(m, spaceId, index, to)
      if (typeof r === 'object') refused = r.refused
      return r === true
    })
    if (!done) {
      if (refused) editNotice.value = refused
      // 끌던 손잡이를 원래 고리로 다시 그린다.
      sceneVersion.value++
    }
    return
  }
  // 공간은 공간 편집 모드에서만 고친다(OE-UI-04). 끌던 손잡이를 원래 고리로 다시 그린다.
  if (editPart.value !== 'space') {
    editNotice.value = SPACE_IN_EQUIPMENT
    sceneVersion.value++
    return
  }
  // 룸의 꼭짓점(OE-SPC-11). 맞은편 꼭짓점을 두고 크기를 바꾼다.
  if (findRoom(model.value, spaceId)) {
    changeRooms(spaceId, '룸 크기', (m) => resizeRoom(m, spaceId, index, to))
    return
  }
  if (wouldSelfIntersect(model.value, spaceId, index, to)) {
    editNotice.value = '경계선이 교차하는 위치라 꼭짓점을 원래 자리로 되돌렸습니다.'
    // 끌던 손잡이를 원래 고리로 다시 그린다.
    sceneVersion.value++
    return
  }
  editNotice.value = ''
  moveVertex(spaceId, index, to)
}

/** 3D·평면도에서 꼭짓점 손잡이를 누르면 그 꼭짓점을 고른다 — [ ] 를 누르지 않고도 바로 방향키로 옮긴다. */
export function pickVertex(index: number) {
  if (zoneEdited.value) {
    zoneActiveVertex.value = index
    return
  }
  if (!selectedSpace.value) return
  activeVertex.value = index
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupKeyboard() {
  window.addEventListener('keyup', onKeyUp)
  onBeforeUnmount(() => window.removeEventListener('keyup', onKeyUp))
  window.addEventListener('keydown', onKey)
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
  // 마우스로 하는 편집(끌기, 버튼)도 모아 둔 방향키 뒤에 온다.
  window.addEventListener('pointerdown', () => flushNudge(), { capture: true })
}
