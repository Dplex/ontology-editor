import { computed, ref, triggerRef, watch } from 'vue'
import { ceilingOf, ceilingZone } from '../lib/ceiling'
import { findCustomZone, zoneEquipment, zoneSpaces } from '../lib/custom-zone'
import { type Change, orphanedBy, snapshotStoreySpaces, type SpaceSetChange } from '../lib/edit'
import { josa } from '../lib/josa'
import { type Model, polygonArea } from '../lib/model'
import { canMountOn, surfaceOf } from '../lib/mount'
import { replayOpen } from '../lib/replay-player'
import type { CeilingMark } from '../lib/viewer'
import { connectFrom } from './connections'
import { editing, model } from './core'
import { changes, exteriorIds, surfaceRows } from './edit-report'
import { stopAdd } from './equipment-edit'
import { shortName } from './equipment-shape'
import { selected, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { editNotice, storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { stopPlace } from './place'
import { sceneVersion } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { drawing, selectedSpace } from './space-objects'

// --- 물리존 만들기·지우기·나누기·합치기 (E3) --------------------------------------------------
//
// 경계 편집과 같이 넓이와 소속을 다시 재는데, 물리존이 생기고 없어져서 층 하나를 통째로 떠 두고 되돌린다
// (snapshotStoreySpaces). 거절된 것(층의 마지막 방, 방을 셋으로 자르는 선, 맞닿지 않은 방)은 이유를 알린다.
/**
 * 편집으로 소속 물리존을 잃은 설비를 알린다(OE-OBJ-02 "물리존에 속하지 않은 설비가 없다"). 지우기·경계 줄이기로 생기고, BIM 좌표가 방 밖인
 * 설비는 나누기로도 생긴다(Q13). 비는 자리는 이웃 물리존과 합치면 다시 소속을 찾는다(OE-SPC-04). 외벽 설비는 방 밖이 제자리라 세지 않는다.
 */
export function orphanNotice(list: readonly Change[]) {
  const lost = orphanedBy(list).filter((c) => !exteriorIds.value.has(c.equipmentId))
  if (!lost.length) return
  const SHOW = 3
  editNotice.value =
    `설비 ${lost.length}대가 소속 물리존을 잃었습니다: ${lost.slice(0, SHOW).map((c) => shortName(c.equipmentName)).join(', ')}` +
    `${lost.length > SHOW ? ` 외 ${lost.length - SHOW}대` : ''}. 비는 자리는 이웃 물리존과 합치면 다시 소속을 찾습니다(Ctrl+Z 로 되돌립니다).`
}
export function changeSpaces(storeyId: string, label: string, apply: (m: Model) => SpaceSetChange | { refused: string } | null): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotStoreySpaces(m, storeyId)
  const at = mark()
  const done = apply(m)
  if (!done) return false
  if ('refused' in done) {
    note(done.refused)
    return false
  }
  remember(label, snapshot, at)
  changes.value = [...changes.value, ...done.equipment]
  orphanNotice(done.equipment)
  triggerRef(model)
  viewer?.updateSpaces(m)
  sceneVersion.value++
  return true
}

/** 새 물리존·설비를 넣을 층. 층 하나만 보는 중이면 그 층, 고른 물리존·설비가 있으면 그 층, 층이 하나면 그 층이다. */
export function targetStorey() {
  const m = model.value
  if (!m) return null
  return (
    m.storeys.find((st) => st.id === viewStorey.value) ??
    selectedSpace.value?.storey ??
    (selected.value ? storeyOf(selected.value.id) : null) ??
    (m.storeys.length === 1 ? m.storeys[0] : null)
  )
}

/** 층을 몰라 도구를 못 여는 경우. 말만 하면 층 목록을 찾아 헤매서, 목록에 커서를 옮겨 바로 고르게 한다. */
export function askStorey(what: string) {
  note(`${what} 층을 먼저 고르세요(3D 오른쪽 위의 층 목록)`)
  document.querySelector<HTMLSelectElement>('.storey-view')?.focus()
}

export function startCreateSpace() {
  const storey = targetStorey()
  if (!storey) return askStorey('물리존을 그릴')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'create', spaceId: null, storeyId: storey.id, name: `${storey.name} 새 물리존`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
}

export function startSplit() {
  const picked = selectedSpace.value
  if (!picked) return
  stopPlace()
  stopAdd()
  const name = picked.space.longName || picked.space.name
  drawing.value = { purpose: 'split', spaceId: picked.space.id, storeyId: picked.storey.id, name, elevation: picked.storey.elevation, points: [] }
  viewer?.setPlaceMode(picked.storey.elevation)
  note(`${name}${josa(name, '을/를')} 나눌 선의 두 점을 바닥에 찍으세요 (Esc 취소)`)
}

// --- 커스텀존 (OE-OBJ-01) -----------------------------------------------------------------
//
// 물리존 위에 운영 편의로 정하는 다각형. 서로 겹쳐도 된다. 품는 방·든 설비는 저장하지 않고 쓸 때 계산하므로(custom-zone.ts)
// 여기서는 목록만 고치고 되돌리기에 쌓는다.
export const selectedCustomZoneId = ref<string | null>(null)
export const selectedCustomZone = computed(() => {
  void sceneVersion.value
  const m = model.value
  const id = selectedCustomZoneId.value
  const found = m && id ? findCustomZone(m, id) : null
  if (!found) return null
  return {
    ...found,
    spaces: zoneSpaces(found.storey, found.zone),
    equipment: zoneEquipment(found.storey, found.zone),
    areaM2: polygonArea(found.zone.footprint),
  }
})
/** 모든 층의 커스텀존. 개요 패널에서 골라 연다. */
export const allCustomZones = computed(() => {
  void sceneVersion.value
  return (model.value?.storeys ?? []).flatMap((storey) => (storey.customZones ?? []).map((zone) => ({ storey, zone })))
})
// 천장 설비 표시(OE-EQP-04). 편집 모드에서 천장 설비마다 바닥 발자국 링을, 고른 것이면 링까지 수직 점선을 그린다. 천장 설비는
// 판정 설치면이 천장·플레넘인 것과, 반자 높이를 모르는 층에서 종류가 천장 전용인 것이다(그 층은 천장을 판정하지 못한다). 천장에 달 수
// 없는 종류는 뺀다. 구역(링 색)은 종류가
// 정하고, 종류가 모르면 판정(플레넘이면 플레넘)을 따른다.
export const ceilingMarks = computed<CeilingMark[]>(() => {
  // 편집 리플레이 동안은 그리지 않는다 — 설비 전부의 설치면을 판정하는 일이라 장면마다 화면이 끊겼다.
  if (!editing.value || replayOpen.value) return []
  const out: CeilingMark[] = []
  for (const r of surfaceRows.value) {
    const e = r.equipment
    if (!e.position) continue
    const onCeiling = r.judged === 'ceiling' || r.judged === 'plenum' || (r.judged === null && !ceilingOf(r.storey) && surfaceOf(e) === 'ceiling')
    // 판정이 허용 설치면 밖이면 허용 설치면이 앞선다(Q9) — 반자 위에 있는 공조기는 천장 설비가 아니다.
    if (!onCeiling || !canMountOn(e, 'ceiling')) continue
    out.push({ id: e.id, storeyId: r.storey.id, at: e.position, floor: r.storey.elevation, zone: ceilingZone(e.kind) ?? (r.judged === 'plenum' ? 'plenum' : 'attached') })
  }
  return out
})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupSpaceEdit() {
  watch([model, sceneVersion, selectedCustomZoneId], () => viewer?.setCustomZones(model.value, selectedCustomZoneId.value))
}
