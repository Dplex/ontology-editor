import { shallowRef, triggerRef, watch } from 'vue'
import { type BoundaryChange, type Change, restore, type Snapshot, snapshotOf } from '../lib/edit'
import { findSpaceObject } from '../lib/space-object'
import { model } from './core'
import { changes } from './edit-report'
import { selectedElementId } from './equipment-edit'
import { moveInScene } from './equipment-shape'
import { archEdited, setArchEdited } from './export-compare'
import { followMounted, mountedAt } from './facade'
import { confirmations, equipmentById, flowVersion, ruleReport, selectedId } from './flow-rules'
import { flushNudge, note } from './keyboard'
import { areaChanges, editNotice, storeyMoved } from './multi-select'
import { redraw, sceneVersion } from './redraw'
import { selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedCustomZoneId } from './space-edit'
import { selectedObjectId } from './space-objects'

// --- 되돌리기 (Ctrl+Z) -------------------------------------------------------------
//
// 3D 와 표에서 한 편집을 한 줄로 쌓는다. 어디서 고쳤든 사람에게는 같은 편집이다. 한 단계는 한 번의 조작이고
// (끌기는 누르고 놓기까지), 거부된 것은 쌓지 않는다. 되돌리기는 편집 전 스냅숏을 되돌려 놓고 소속을 다시
// 판정한다(edit.ts 의 restore). 리포트는 편집이 붙인 만큼 잘라 낸다 — summarize 가 남은 이력으로 다시 접으므로
// 그 편집 전의 리포트와 같아진다. 새 파일을 열거나 덧붙일 때만 비운다.
const UNDO_LIMIT = 100
type Mark = { changes: number; areaChanges: number; confirmations: number; storeyMoved: Set<string> }
/** `coalesce` 가 같고 COALESCE_MS 안에 이어진 편집은 한 단계로 묶는다(방향키를 누르고 있는 것). */
type HistoryEntry = Mark & { label: string; snapshot: Snapshot; coalesce?: string; time: number }
export const history = shallowRef<HistoryEntry[]>([])
const COALESCE_MS = 1200

// 다시 하기. 되돌릴 때 그 대상의 지금 상태(snapshotOf)와 잘라 낸 리포트를 쌓아 두었다가 그대로 되돌려 놓는다.
// 새 편집을 하면 비운다 — 갈라진 이력의 "다시" 는 뜻이 없다.
type RedoEntry = {
  entry: HistoryEntry
  snapshot: Snapshot
  tail: { changes: Change[]; areaChanges: BoundaryChange[]; confirmations: { systemName: string; count: number }[]; storeyMoved: Set<string> }
}
export const future = shallowRef<RedoEntry[]>([])
export const mark = (): Mark => ({
  changes: changes.value.length,
  areaChanges: areaChanges.value.length,
  confirmations: confirmations.value.length,
  storeyMoved: storeyMoved.value,
})
export function remember(label: string, snapshot: Snapshot | null, at: Mark, coalesce?: string) {
  if (!snapshot) return
  future.value = []
  editNotice.value = ''
  const time = Date.now()
  const last = history.value.at(-1)
  if (coalesce && last?.coalesce === coalesce && time - last.time < COALESCE_MS) {
    // 첫 편집 전의 스냅숏과 표시(mark)를 그대로 둔다. 되돌리면 묶인 것 전부가 한 번에 돌아간다.
    history.value = [...history.value.slice(0, -1), { ...last, label, time }]
    settleLater()
    return
  }
  const next = [...history.value, { ...at, label, snapshot, coalesce, time }]
  // 넘치면 가장 오래된 것부터 버린다. 경계 스냅숏은 외곽선을 통째로 들고 있어 무한히 쌓지 않는다.
  history.value = next.length > UNDO_LIMIT ? next.slice(-UNDO_LIMIT) : next
  if (coalesce) settleLater()
}
/**
 * 묶는 시간은 앞 편집이 **끝난** 때부터 잰다. 큰 모델에서 편집 하나가 화면을 다시 그리는 데 오래 걸리면, 누른
 * 때부터 재는 사이 묶는 시간이 지나 방향키 다섯 번이 되돌리기 다섯 단계가 됐다. 화면 갱신(Vue flush, 3D) 뒤에
 * 도는 setTimeout 에서 시각을 다시 찍는다.
 */
function settleLater() {
  window.setTimeout(() => {
    const top = history.value.at(-1)
    if (top?.coalesce) top.time = Date.now()
  }, 0)
}

// 소속이 바뀐 방을 3D 에서 한 번 번쩍인다. 편집이 붙인 Change 는 들어간 방을, 되돌리기가 잘라 낸 Change 는 돌아간 방을.
// 어느 길로 고쳤든(끌기·표·방향키·경계·되돌리기) changes 하나로 모이므로 여기서 한 번만 본다. 한꺼번에 수백 개가 바뀌는
// 편집(경계·합치기)은 화면 전체가 번쩍여 아무것도 가리키지 않으니 몇 개까지만.
const PULSE_LIMIT = 12

export function undo() {
  flushNudge()
  const m = model.value
  const entry = history.value.at(-1)
  if (!m || !entry) return
  const after = snapshotOf(m, entry.snapshot)
  history.value = history.value.slice(0, -1)
  if (after) {
    future.value = [
      ...future.value,
      {
        entry,
        snapshot: after,
        tail: {
          changes: changes.value.slice(entry.changes),
          areaChanges: areaChanges.value.slice(entry.areaChanges),
          confirmations: confirmations.value.slice(entry.confirmations),
          storeyMoved: storeyMoved.value,
        },
      },
    ]
  }
  changes.value = changes.value.slice(0, entry.changes)
  areaChanges.value = areaChanges.value.slice(0, entry.areaChanges)
  confirmations.value = confirmations.value.slice(0, entry.confirmations)
  storeyMoved.value = entry.storeyMoved
  applySnapshot(entry.snapshot)
  // 오류가 아니라 잠깐 보이는 안내다. 경고 칸(editNotice)에 두면 다음 경고가 올 때까지 남아서, 뒤이어 누른 단축키의
  // 안내(U 의 "종류 모르는 패밀리 1/23" 같은 것)를 전부 가렸다.
  editNotice.value = ''
  note(`되돌렸습니다: ${entry.label}`)
}

export function redo() {
  flushNudge()
  const m = model.value
  const next = future.value.at(-1)
  if (!m || !next) return
  future.value = future.value.slice(0, -1)
  changes.value = [...changes.value, ...next.tail.changes]
  areaChanges.value = [...areaChanges.value, ...next.tail.areaChanges]
  confirmations.value = [...confirmations.value, ...next.tail.confirmations]
  storeyMoved.value = next.tail.storeyMoved
  // 되돌리기 전의 이력 한 줄을 그대로 돌려놓는다. 그 스냅숏이 가리키는 상태가 지금 상태다.
  history.value = [...history.value, { ...next.entry, time: 0 }]
  applySnapshot(next.snapshot)
  editNotice.value = ''
  note(`다시 했습니다: ${next.entry.label}`)
}

/** 스냅숏을 모델에 되돌려 놓고, 바뀐 것에 맞춰 3D 와 화면을 고친다. 되돌리기와 다시 하기가 같이 쓴다. */
function applySnapshot(s: Snapshot) {
  const m = model.value
  if (!m) return
  const drawnAt = s.kind === 'equipment' ? (equipmentById.value.get(s.id)?.position ?? null) : null
  // 배관·공조존·샤프트와 함께 옮긴 설비. 형상은 설비마다 옮긴다.
  const movedParts = s.kind === 'many' ? s.parts.filter((p): p is Extract<Snapshot, { kind: 'equipment' }> => p.kind === 'equipment') : []
  const drawn = new Map(movedParts.map((p) => [p.id, equipmentById.value.get(p.id)?.position ?? null]))
  // 벽을 되돌리면 붙은 설비도 같이 돌아온다. 형상도 따라 옮긴다.
  const hasArch = s.kind === 'storey-elements' || (s.kind === 'many' && s.parts.some((p) => p.kind === 'storey-elements' || p.kind === 'storey-spaces'))
  const mounted = hasArch ? mountedAt(m) : null
  const rules = restore(m, s)
  if (s.kind === 'many' && s.parts.every((p) => p.kind === 'equipment' || p.kind === 'hvac-zones')) {
    triggerRef(model)
    for (const p of movedParts) moveInScene(p.id, drawn.get(p.id) ?? null, p.position, true)
    if (s.parts.some((p) => p.kind === 'hvac-zones')) sceneVersion.value++
  } else if (s.kind === 'equipment') {
    triggerRef(model)
    // 형상도 되돌린다. 안 하면 다시 그릴 때 옮긴 자리에 남는다.
    moveInScene(s.id, drawnAt, s.position, true)
  } else if (s.kind === 'space') {
    triggerRef(model)
    viewer?.updateSpaces(m)
    sceneVersion.value++
  } else if (s.kind === 'equipment-set') {
    // 더하거나 지운 설비. 형상·연결이 같이 바뀌니 3D 를 다시 그리고 규칙 방향 채점도 바꾼다.
    if (rules) ruleReport.value = rules
    if (!model.value?.storeys.some((st) => st.equipment.includes(s.equipment)) && selectedId.value === s.equipment.id) selectedId.value = null
    triggerRef(model)
    flowVersion.value++
    redraw()
  } else if (s.kind === 'many') {
    if (rules) ruleReport.value = rules
    for (const p of movedParts) moveInScene(p.id, drawn.get(p.id) ?? null, p.position, true)
    if (s.parts.some((p) => p.kind === 'equipment-set')) {
      if (selectedId.value && !m.storeys.some((st) => st.equipment.some((e) => e.id === selectedId.value))) selectedId.value = null
      triggerRef(model)
      flowVersion.value++
      redraw()
    } else if (hasArch) {
      // 벽과 함께 방 경계를 옮긴 것. 벽·방 둘 다 다시 그린다.
      if (selectedSpaceId.value && !m.storeys.some((st) => st.spaces.some((x) => x.id === selectedSpaceId.value))) selectedSpaceId.value = null
      setArchEdited(true)
      triggerRef(model)
      if (mounted) followMounted(mounted, true)
      viewer?.updateSpaces(m)
      sceneVersion.value++
    } else if (s.parts.some((p) => p.kind === 'space')) {
      triggerRef(model)
      viewer?.updateSpaces(m)
      sceneVersion.value++
    } else {
      triggerRef(model)
      if (s.parts.some((p) => p.kind === 'release' || p.kind === 'connection')) flowVersion.value++
      sceneVersion.value++
    }
  } else if (s.kind === 'storey-elements') {
    if (selectedElementId.value && !m.storeys.some((st) => st.walls.some((w) => w.id === selectedElementId.value) || st.openings.some((o) => o.id === selectedElementId.value))) {
      selectedElementId.value = null
    }
    setArchEdited(true)
    triggerRef(model)
    if (mounted) followMounted(mounted, true)
    sceneVersion.value++
  } else if (s.kind === 'storey-spaces') {
    if (selectedSpaceId.value && !m.storeys.some((st) => st.spaces.some((x) => x.id === selectedSpaceId.value))) selectedSpaceId.value = null
    triggerRef(model)
    viewer?.updateSpaces(m)
    sceneVersion.value++
  } else if (s.kind === 'custom-zones') {
    // 커스텀존 목록(OE-OBJ-01). 없어진 존을 고르고 있었으면 푼다. 점선은 sceneVersion 을 보고 다시 그린다.
    if (selectedCustomZoneId.value && !m.storeys.some((st) => st.customZones?.some((z) => z.id === selectedCustomZoneId.value))) selectedCustomZoneId.value = null
    triggerRef(model)
    sceneVersion.value++
  } else if (s.kind === 'hvac-zones') {
    // 사람이 만든 공조존(OE-ZON-01·02). 목록과 3D 의 존 외곽선이 sceneVersion 을 보고 다시 그려진다.
    triggerRef(model)
    sceneVersion.value++
  } else if (s.kind === 'space-objects') {
    // 추가 공간 오브젝트(OE-OBJ-09). 없어진 것을 고르고 있었으면 푼다.
    if (selectedObjectId.value && !(model.value && findSpaceObject(model.value, selectedObjectId.value))) selectedObjectId.value = null
    triggerRef(model)
    sceneVersion.value++
  } else if (s.kind === 'verticals') {
    // 수직 관통 오브젝트(OE-ML-07·09). 다시 그리고, 없어진 조각을 고르고 있었으면 푼다(selectedVertical 의 watch).
    triggerRef(model)
    sceneVersion.value++
  } else if (s.kind === 'rooms') {
    // 룸 목록(OE-OBJ-03). 없어진 룸을 고르고 있었으면 푼다. 외곽선은 sceneVersion 을 보고 다시 그린다.
    if (selectedRoomId.value && !m.storeys.some((st) => st.rooms?.some((r) => r.id === selectedRoomId.value))) selectedRoomId.value = null
    triggerRef(model)
    sceneVersion.value++
  } else if (s.kind === 'storey-name') {
    // 층 이름. 층별 요약·등급 판정·층 고르기 목록이 이름을 다시 읽는다.
    triggerRef(model)
    sceneVersion.value++
} else if (s.kind === 'kinds' || s.kind === 'connection') {
    // 종류·연결을 되돌리면 edit.ts 가 규칙 방향도 다시 돌렸다. 채점표도 그것으로 바꾼다.
    if (rules) ruleReport.value = rules
    triggerRef(model)
    flowVersion.value++
  } else if (s.kind === 'release' || s.kind === 'rule-state') {
    // 연결 해제 보정·취소(OE-PIP-06). connection 과 같이 규칙 방향을 다시 돌렸다.
    if (rules) ruleReport.value = rules
    triggerRef(model)
    flowVersion.value++
  } else if (s.kind === 'systems') {
    // 계통 구성원이 바뀌면 3D 의 계통 색도 바뀐다.
    if (rules) ruleReport.value = rules
    triggerRef(model)
    flowVersion.value++
    // 계통 구성원이나 목록이 바뀌면 3D 의 계통 색이 바뀐다(색은 목록 순서로 정한다).
    if (s.equipment.length || s.list) redraw()
  } else {
    // 방향·확정은 소속과 상관이 없다. 모델 전체에 갱신 신호를 보내지 않는다(confirmRule 과 같은 이유).
    flowVersion.value++
  }
}

/** 글자를 치는 칸. 여기의 Ctrl+Z 는 그 칸의 실행취소다. 체크박스·선택 상자는 치는 칸이 아니다. */
export function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(target.type)
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupHistory() {
  watch(changes, (now, before) => {
    const added = now.length > before.length && now.slice(0, before.length).every((c, i) => c === before[i])
    const removed = now.length < before.length && before.slice(0, now.length).every((c, i) => c === now[i])
    const spaces = new Set<string>()
    if (added) for (const c of now.slice(before.length)) if (c.toSpaceId && c.toSpaceId !== c.fromSpaceId) spaces.add(c.toSpaceId)
    if (removed) for (const c of before.slice(now.length)) if (c.fromSpaceId && c.fromSpaceId !== c.toSpaceId) spaces.add(c.fromSpaceId)
    if (spaces.size && spaces.size <= PULSE_LIMIT) viewer?.pulseSpaces(spaces)
  })
}
