import { computed, ref, triggerRef, watch } from 'vue'
import { setRatedAirflow, setSpaceAirflow, setZoneAirflow, zoneAirflow, type ZoneAirflow } from '../lib/airflow'
import { deleteCustomZone, mergeCustomZones, renameCustomZone, setCustomZoneAliases } from '../lib/custom-zone'
import { deleteSpace, mergeSpaces, type Snapshot, snapshotAirflow, snapshotEquipment } from '../lib/edit'
import { createZoneFromSpaces, deleteZoneVertex, findHvacZone, flowSpacesOfEquipment, flowSpacesOfZones, hvacZonesOf, insertZoneVertex, moveZoneVertex, setZoneServedBy, setZoneSpaces, zoneChecks, zoneCorners } from '../lib/hvac-zone'
import { josa } from '../lib/josa'
import { equipmentKind } from '../lib/kinds'
import { distanceToRing } from '../lib/mapping'
import { type CustomZone, type Equipment, type HvacZone, isConduit, type Model, segmentPath, type Vec2 } from '../lib/model'
import { planOffsetHeight, setOffsetHeight } from '../lib/offset-edit'
import { MERGE_GAP } from '../lib/polygon'
import { setSegmentShaft, shaftCandidates, shaftDeviations, shaftOf } from '../lib/shaft'
import { snapAxis } from '../lib/shortcuts'
import { storeyAtZ } from '../lib/storey-z'
import { changeCustomZones } from './ceiling'
import { stage } from './chat-view'
import { connectFrom, nameOfId } from './connections'
import { editing, model } from './core'
import { changes, spaceNameOf } from './edit-report'
import { stopAdd } from './equipment-edit'
import { cm, moveInScene, segmentAxis, shortName } from './equipment-shape'
import { equipmentById, flowVersion, selected, selectedId } from './flow-rules'
import { zoneActiveVertex, zoneVertexEdit } from './grid-snap'
import { mark, remember } from './history'
import { note } from './keyboard'
import { changeHvacZones, zoneStorey } from './manual-draw'
import { editNotice } from './multi-select'
import { multiRange, storeysByHeight, viewStorey } from './multi-view'
import { stopPlace } from './place'
import { sceneVersion } from './redraw'
import { selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { askStorey, changeSpaces, selectedCustomZone, selectedCustomZoneId, targetStorey } from './space-edit'
import { drawing, selectedSpace } from './space-objects'
import { multiView } from './vertical'

// --- 오프셋 높이 (다중층 뷰, OE-ML-14, offset-edit.ts) ---
// 고른 수평 구간(오프셋)과 양 끝 꺾임점을 같이 올리거나 내린다. 이어진 구간은 끝만 늘거나 준다. 바꾸기 전에 무엇이 움직이는지 보인다.

/** 고른 오프셋의 새 높이(층 + 바닥에서 m). null 이면 지금 높이다. */
export const offsetDraft = ref<{ storeyId: string; height: number } | null>(null)
/** 고른 구간이 다중층 뷰의 수평 구간이면 지금 높이. */
const offsetNow = computed(() => {
  void sceneVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || e.role !== 'segment' || !multiView.value || !editing.value) return null
  const path = segmentPath(e)
  if (!path || !('path' in path)) return null
  const [p, q] = path.path
  const st = Math.abs(p[2] - q[2]) <= 0.01 ? storeyAtZ(m, p[2]) : null
  return st ? { storeyId: st.id, height: cm(p[2] - st.elevation) } : null
})
export const offsetTarget = computed(() => (offsetNow.value ? (offsetDraft.value ?? offsetNow.value) : null))
/** [오프셋 층] 칸의 층: 보기 범위의 층과, 범위 밖이면 지금 오프셋이 있는 층(높이 순). */
export const offsetStoreys = computed(() => {
  const ids = new Set([...(multiRange.value ?? []).map((st) => st.id), ...(offsetTarget.value ? [offsetTarget.value.storeyId] : [])])
  return storeysByHeight.value.filter((st) => ids.has(st.id))
})
export const offsetPlan = computed(() => {
  void sceneVersion.value
  const m = model.value
  const e = selected.value
  const t = offsetDraft.value
  return m && e && t && offsetNow.value ? planOffsetHeight(m, e.id, t) : null
})
/**
 * 고른 덕트·배관 구간의 샤프트 소속(OE-ML-09·14, shaft.ts). 다중층 뷰에서만 정한다. 후보는 두 끝이 축 안인 샤프트뿐이고, 저절로 붙이지 않는다.
 * 지금 샤프트의 축을 벗어났으면(샤프트나 구간을 옮겼다) 이탈로 알린다.
 */
export const selectedShaft = computed(() => {
  void sceneVersion.value
  void model.value
  const m = model.value
  const e = selected.value
  if (!m || !e || e.role !== 'segment' || !multiView.value) return null
  const current = shaftOf(m, e)
  const candidates = shaftCandidates(m, e.id)
  if (!current && !candidates.length) return null
  return { current, candidates, deviated: !!current && !candidates.some((o) => o.id === current.id) }
})
export function changeShaft(shaftId: string) {
  const m = model.value
  const e = selected.value
  if (!m || !e) return
  const undo = snapshotEquipment(m, e.id)
  const at = mark()
  const done = setSegmentShaft(m, e.id, shaftId || null)
  if (done !== true) return note(done.refused)
  const shaft = shaftOf(m, e)
  remember(`${shortName(e.name)} 샤프트 소속`, undo, at)
  triggerRef(model)
  sceneVersion.value++
  note(shaft ? `${shortName(e.name)}${josa(shortName(e.name), '을/를')} 샤프트 ${shaft.name}에 넣었습니다(GeoJSON shaftId)` : `${shortName(e.name)}의 샤프트 소속을 풀었습니다`)
}
/** 소속 샤프트의 축을 벗어난 구간(이탈). 샤프트·구간을 옮긴 뒤 알린다. */
const shaftOff = computed(() => {
  void sceneVersion.value
  void model.value
  return model.value ? shaftDeviations(model.value) : []
})

/** 오프셋을 바꾸면 늘어나는 구간 중 샤프트에 든 것(OE-ML-14#5 — 바꾸기 전에 샤프트 소속 영향을 보인다). */
export const offsetShafts = computed(() => {
  const m = model.value
  const plan = offsetPlan.value
  if (!m || !plan || 'refused' in plan) return []
  return [plan.segment.id, ...new Set(plan.stretch.map((x) => x.id))].flatMap((id) => {
    const e = equipmentById.value.get(id)
    const o = e ? shaftOf(m, e) : null
    return e && o ? [{ segment: e.name, shaft: o.name }] : []
  })
})
export function applyOffsetHeight() {
  const m = model.value
  const e = selected.value
  const t = offsetDraft.value
  const plan = offsetPlan.value
  if (!m || !e || !t || !plan || 'refused' in plan) return
  const ids = [e.id, ...plan.fittings.map((f) => f.id), ...new Set(plan.stretch.map((x) => x.id))]
  const was = new Map(ids.map((id) => [id, equipmentById.value.get(id)?.position ?? null]))
  const undo: Snapshot = { kind: 'many', parts: ids.map((id) => snapshotEquipment(m, id)!) }
  const at = mark()
  const done = setOffsetHeight(m, e.id, t, segmentAxis)
  if ('refused' in done) return note(done.refused)
  remember(`${shortName(e.name)} 오프셋 높이`, undo, at)
  changes.value = [...changes.value, ...done.changes]
  for (const id of ids) moveInScene(id, was.get(id) ?? null, equipmentById.value.get(id)?.position ?? null)
  offsetDraft.value = null
  triggerRef(model)
  flowVersion.value++
  note(
    `${shortName(e.name)}의 높이를 ${plan.delta[2] > 0 ? '올렸' : '내렸'}습니다(${Math.abs(plan.delta[2]).toFixed(2)}m): 꺾임점 ${plan.fittings.length}개가 같이 움직이고 구간 ${new Set(plan.stretch.map((x) => x.id)).size}개가 늘거나 줄었습니다. 연결은 그대로입니다`,
  )
}

export function startHvacZone() {
  const storey = zoneStorey.value
  if (!storey) return askStorey('공조존을 그릴')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'hvacZone', spaceId: null, storeyId: storey.id, name: `${storey.name} 공조존`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
  stage.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  note('바닥에 꼭짓점을 찍어 공조존 경계를 그립니다. 겹치는 물리존이 담당이 됩니다 (Enter 마침, Esc 취소)')
}
/** 공조존 경계를 다시 그린다(OE-ZON-04). 담당 물리존은 새 경계와 겹치는 물리존으로 바뀐다. */
export function startHvacZoneOutline(zone: HvacZone) {
  const storey = model.value?.storeys.find((s) => s.id === zone.storeyId)
  if (!storey) return
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'hvacZoneOutline', spaceId: zone.id, storeyId: storey.id, name: zone.name, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
  stage.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  note(`${zone.name}의 새 경계를 바닥에 찍습니다. 겹치는 물리존이 담당이 됩니다 (Enter 마침, Esc 취소)`)
}
/**
 * 꼭짓점을 고치는 공조존(OE-ZON-04). 3D 에 그 경계의 손잡이가 달리고, 물리존 꼭짓점처럼 끌기·[ ]·방향키·Insert·Delete 로 고친다.
 * 고칠 때마다 담당 물리존·몫을 새 경계로 다시 잰다(`reshapeHvacZone`). 물리존·설비를 고르거나 그리기를 시작하면 끝난다.
 */
export const zoneEdited = computed(() => {
  void sceneVersion.value
  const m = model.value
  const id = zoneVertexEdit.value
  const found = m && id ? findHvacZone(m, id) : null
  const corners = found ? zoneCorners(found.zone) : null
  return found && corners ? { zone: found.zone, storey: found.storey, corners } : null
})
export function startZoneVertices(zone: HvacZone) {
  const storey = model.value?.storeys.find((s) => s.id === zone.storeyId)
  if (!storey) return
  if (!zoneCorners(zone)) return note('떨어진 조각이 있는 공조존은 꼭짓점을 고칠 수 없습니다. [경계 다시 그리기] 를 쓰세요.')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  selectedRoomId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  zoneVertexEdit.value = zone.id
  stage.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  note(`${zone.name}의 꼭짓점을 드래그해 옮깁니다. [ ]로 꼭짓점을 짚으면 방향키·Insert·Delete 로 고칩니다 (Esc 마침)`)
}
/** 공조존 꼭짓점 하나를 옮긴다. 막히면(변 엇갈림·겹치는 물리존 없음) 손잡이를 원래 자리로 다시 그린다. */
export function moveZoneCorner(index: number, to: Vec2, coalesce?: string): boolean {
  const z = zoneEdited.value
  if (!z) return false
  const done = changeHvacZones(z.storey.id, `${z.zone.name} 꼭짓점`, (m) => moveZoneVertex(m, z.zone.id, index, to), coalesce)
  if (!done) sceneVersion.value++
  return done
}
export function editZoneVertex(op: 'insert' | 'delete'): boolean {
  const z = zoneEdited.value
  const i = zoneActiveVertex.value
  if (!z) return false
  if (i === null) {
    note('[ ]로 꼭짓점을 먼저 고르세요')
    return true
  }
  if (op === 'insert') {
    if (changeHvacZones(z.storey.id, `${z.zone.name} 꼭짓점 넣기`, (m) => insertZoneVertex(m, z.zone.id, i))) {
      zoneActiveVertex.value = i + 1
      note(`꼭짓점을 넣었습니다(${i + 2}번). ←↑→↓로 옮깁니다`)
    }
    return true
  }
  if (changeHvacZones(z.storey.id, `${z.zone.name} 꼭짓점 지우기`, (m) => deleteZoneVertex(m, z.zone.id, i))) {
    zoneActiveVertex.value = Math.min(i, z.corners.length - 2)
    note('꼭짓점을 지웠습니다')
  }
  return true
}
export function stepZoneVertex(dir: 1 | -1) {
  const n = zoneEdited.value!.corners.length
  const cur = zoneActiveVertex.value
  zoneActiveVertex.value = cur === null ? (dir > 0 ? 0 : n - 1) : (cur + dir + n) % n
  const p = zoneEdited.value!.corners[zoneActiveVertex.value]
  note(`꼭짓점 ${zoneActiveVertex.value + 1}/${n} (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) · ←↑→↓로 옮깁니다`)
}
export function nudgeZoneVertex(code: string, step: number): boolean {
  const z = zoneEdited.value!
  const index = zoneActiveVertex.value
  if (index === null) {
    note('[ ]로 꼭짓점을 먼저 고르세요')
    return true
  }
  const p = z.corners[index]
  const { right, up } = viewer!.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const to: Vec2 = [cm(p[0] + sign * ax * step), cm(p[1] + sign * ay * step)]
  if (moveZoneCorner(index, to, `zone-vertex:${z.zone.id}:${index}`)) {
    note(`꼭짓점 ${index + 1} → (${to[0].toFixed(2)}, ${to[1].toFixed(2)}) · ${zoneEdited.value!.zone.areaM2.toFixed(1)}㎡`)
  }
  return true
}
export function addZoneServed(zoneId: string, storeyId: string, equipmentId: string, served: readonly string[]) {
  if (!equipmentId) return
  changeHvacZones(storeyId, '공조존 담당 설비', (m) => setZoneServedBy(m, zoneId, [...served, equipmentId]))
}
export function removeZoneServed(zoneId: string, storeyId: string, equipmentId: string, served: readonly string[]) {
  changeHvacZones(storeyId, '공조존 담당 설비', (m) => setZoneServedBy(m, zoneId, served.filter((id) => id !== equipmentId)))
}
export function setZoneSpaceList(zoneId: string, storeyId: string, ids: readonly string[]) {
  changeHvacZones(storeyId, '공조존 담당 물리존', (m) => setZoneSpaces(m, zoneId, ids))
}
/** 공조존 검증(OE-ZON-05). 경고만 하고 막지 않는다. */
export const zoneCheckList = computed(() => {
  void sceneVersion.value
  const m = model.value
  return m ? zoneChecks(m, { space: (id) => spaceNameOf(id), equipment: (id) => nameOfId(id) }) : null
})
/** 연결 기준 후보(OE-MAP-02): 공조존마다 담당 설비에서 확정된 흐름으로 닿는 말단의 물리존. */
export const zoneFlow = computed(() => {
  void sceneVersion.value
  const m = model.value
  return m ? flowSpacesOfZones(m) : new Map<string, string[]>()
})
/**
 * 설비 패널의 담당 공조존(OE-ZON-01 "설비를 선택하여 담당하는 공조존을 지정"). 고른 설비가 담당하는 그 층의 공조존과 더할 수 있는 공조존,
 * 그리고 흐름이 닿는 물리존(OE-MAP-02)이다. 공조존 목록의 담당 설비 칸과 같은 값을 설비 쪽에서 고친다. 덕트와 자리 없는 설비는 뺀다.
 */
export const selectedZones = computed(() => {
  void sceneVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || isConduit(e.role) || !e.position) return null
  const storey = m.storeys.find((s) => s.equipment.some((x) => x.id === e.id))
  if (!storey) return null
  const zones = storey.hvacZones ?? []
  // 공기가 지나는 설비(공조기·FCU·실내기·VAV·디퓨저 등)만. 조명·센서마다 이 칸이 뜨면 패널이 길어진다. 이미 담당하는 공조존이 있으면 보인다.
  if (!equipmentKind(e.kind)?.flow.air && !zones.some((z) => z.servedBy?.includes(e.id))) return null
  return {
    storeyId: storey.id,
    serving: zones.filter((z) => z.servedBy?.includes(e.id)),
    others: zones.filter((z) => !z.servedBy?.includes(e.id)),
    flow: editing.value ? flowSpacesOfEquipment(m, e.id) : [],
  }
})
/** 고른 설비가 흐름으로 닿는 물리존을 담당으로, 그 설비를 담당 설비로 공조존을 만든다. */
export function makeZoneForSelected() {
  const z = selectedZones.value
  const e = selected.value
  if (!z || !e || !z.flow.length) return
  if (changeHvacZones(z.storeyId, '공조존 만들기', (m) => createZoneFromSpaces(m, { spaceIds: z.flow, servedBy: [e.id] })))
    note(`공조존을 만들었습니다. 담당 물리존은 ${shortName(e.name)}의 흐름이 닿는 ${z.flow.map((id) => spaceNameOf(id)).join(', ')}입니다`)
}
/** 공조존마다 Z-03 이 쓰는 설계 풍량과 출처(OE-ZON-06, airflow.ts). */
export const zoneAirflows = computed(() => {
  void sceneVersion.value
  const m = model.value
  const out = new Map<string, ZoneAirflow>()
  if (m) for (const z of hvacZonesOf(m)) out.set(z.id, zoneAirflow(m, z, (id) => spaceNameOf(id)))
  return out
})
/** 입력 칸의 값. 빈칸은 null(값 없음)이다 — 0 을 넣어도 값 없음이다(airflow.ts 의 cleanAirflow). */
const airflowInput = (ev: Event) => {
  const v = (ev.target as HTMLInputElement).value.trim()
  return v === '' ? null : Number(v)
}
/** 공조존에 설계 풍량을 넣는다(OE-ZON-06). 냉방·난방 칸 하나씩 고친다. */
export function applyZoneAirflow(z: HvacZone, key: 'cooling' | 'heating', ev: Event) {
  const storeyId = z.storeyId
  if (!storeyId) return
  const next = { cooling: z.designAirflow?.cooling ?? null, heating: z.designAirflow?.heating ?? null, [key]: airflowInput(ev) }
  if (!changeHvacZones(storeyId, `${z.name} 설계 풍량`, (m) => setZoneAirflow(m, z.id, next))) {
    const was = z.designAirflow?.[key] ?? null
    ;(ev.target as HTMLInputElement).value = was === null ? '' : String(was)
  }
}
/** 물리존·설비에 설계 풍량·정격 풍량을 넣는다(OE-ZON-06). BIM 값이 있는 곳은 거절되고 칸을 되돌린다. */
function applyAirflow(target: 'space' | 'equipment', id: string, label: string, apply: (m: Model) => boolean | { refused: string }, ev: Event, was: number | null) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotAirflow(m, target, id)
  const at = mark()
  const done = apply(m)
  if (done !== true) {
    // 거절됐거나 바뀐 것이 없으면(0·음수는 빈칸이다) 칸을 지금 값으로 돌려놓는다.
    if (done) editNotice.value = done.refused
    ;(ev.target as HTMLInputElement).value = was === null ? '' : String(was)
    return
  }
  remember(label, snapshot, at)
  triggerRef(model)
  sceneVersion.value++
}
export function applySpaceAirflow(space: { id: string; designAirflow?: { cooling: number | null; heating: number | null } }, key: 'cooling' | 'heating', ev: Event) {
  const next = { cooling: space.designAirflow?.cooling ?? null, heating: space.designAirflow?.heating ?? null, [key]: airflowInput(ev) }
  applyAirflow('space', space.id, `${spaceNameOf(space.id)} 설계 풍량`, (m) => setSpaceAirflow(m, space.id, next), ev, space.designAirflow?.[key] ?? null)
}
export function applyRatedAirflow(e: Equipment, ev: Event) {
  applyAirflow('equipment', e.id, `${shortName(e.name)} 정격 풍량`, (m) => setRatedAirflow(m, e.id, airflowInput(ev)), ev, e.ratedAirflow?.cmh ?? null)
}
/** 리포트에 싣는 공조존 검증(OE-MAP-04). 경고가 있는 규칙만. 공조존이 하나도 없으면 싣지 않는다. */
export const reportZoneChecks = computed(() => {
  const m = model.value
  if (!m || !hvacZonesOf(m).length) return []
  return (zoneCheckList.value?.checks ?? []).filter((c) => c.items.length)
})
/** 담당 설비로 고를 수 있는 것: 그 층의 공기·물이 흐르는 기기(덕트·배관 제외). */
export const zoneEquipmentChoices = computed(() =>
  (zoneStorey.value?.equipment ?? []).filter((e) => !isConduit(e.role) && !!e.position).sort((a, b) => a.name.localeCompare(b.name)),
)

/** 룸 그리기(OE-SPC-11). 물리존 안에 대각선 두 꼭짓점을 찍는다. */
export function startRoom() {
  const storey = targetStorey()
  if (!storey) return askStorey('룸을 그릴')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  selectedRoomId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'room', spaceId: null, storeyId: storey.id, name: `${storey.name} 룸`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
  note('물리존 안에 룸의 대각선 두 꼭짓점을 찍습니다. 다른 룸과 겹치거나 물리존 밖으로 나갈 수 없습니다 (Esc 취소)')
}

export function startCustomSplit() {
  const picked = selectedCustomZone.value
  if (!picked) return
  stopPlace()
  stopAdd()
  drawing.value = { purpose: 'customSplit', spaceId: picked.zone.id, storeyId: picked.storey.id, name: picked.zone.name, elevation: picked.storey.elevation, points: [] }
  viewer?.setPlaceMode(picked.storey.elevation)
  note(`${picked.zone.name}${josa(picked.zone.name, '을/를')} 나눌 선의 두 점을 바닥에 찍으세요 (Esc 취소)`)
}

/** 이름을 고친다. 막히면(빈 이름, 건물 안의 다른 이름·별명과 같음, OE-SPC-06) 칸을 원래 이름으로 되돌린다. */
export function renameZone(input: HTMLInputElement) {
  const picked = selectedCustomZone.value
  if (!picked) return
  const name = input.value.trim()
  if (!changeCustomZones(picked.storey.id, `커스텀존 이름 ${name}`, (m) => renameCustomZone(m, picked.zone.id, name))) input.value = picked.zone.name
}

/** 더 붙인 별명(ADR-0004). 쉼표·줄바꿈으로 가른다. 막히면(OE-SPC-06) 칸을 원래 별명으로 되돌린다. */
export function setZoneAliases(input: HTMLInputElement) {
  const picked = selectedCustomZone.value
  if (!picked) return
  const aliases = input.value.split(/[,，\n]/)
  if (!changeCustomZones(picked.storey.id, `커스텀존 ${picked.zone.name} 별명`, (m) => setCustomZoneAliases(m, picked.zone.id, aliases))) {
    input.value = (picked.zone.aliases ?? []).join(', ')
  }
}

export function mergeZone(otherId: string) {
  const picked = selectedCustomZone.value
  if (!picked || !otherId) return
  const other = picked.storey.customZones?.find((z) => z.id === otherId)
  const names = [picked.zone.name, other?.name ?? '']
  let kept: CustomZone | null = null
  const merge = (m: Model) => {
    const done = mergeCustomZones(m, picked.zone.id, otherId)
    if (done && !('refused' in done)) kept = done
    return done
  }
  if (changeCustomZones(picked.storey.id, `${names[0]} + ${names[1]} 합치기`, merge) && kept) {
    // 넓은 쪽이 남는다(OE-SPC-08). 고른 존이 없어졌으면 남은 존을 고른다.
    const survivor = kept as CustomZone
    selectedCustomZoneId.value = survivor.id
    const gone = names.find((n) => n !== survivor.name) ?? ''
    note(`${names[0]}·${names[1]}${josa(names[1], '을/를')} 합쳤습니다. 넓은 ${survivor.name}${josa(survivor.name, '이/가')} 남고 ${gone}${josa(gone, '은/는')} 그 별명이 됩니다`)
  }
}

export function removeZone() {
  const picked = selectedCustomZone.value
  if (!picked) return
  const name = picked.zone.name
  if (changeCustomZones(picked.storey.id, `${name} 지우기`, (m) => deleteCustomZone(m, picked.zone.id))) {
    selectedCustomZoneId.value = null
    note(`${name}${josa(name, '을/를')} 지웠습니다(Ctrl+Z 로 되돌립니다)`)
  }
}

export function removeSpace() {
  const picked = selectedSpace.value
  if (!picked) return
  const name = picked.space.longName || picked.space.name
  const id = picked.space.id
  if (changeSpaces(picked.storey.id, `${name} 지우기`, (m) => deleteSpace(m, id))) {
    selectedSpaceId.value = null
    note(`${name}${josa(name, '을/를')} 지웠습니다. 그 안의 설비는 좌표로 다시 소속을 찾았습니다(Ctrl+Z 로 되돌립니다)`)
  }
}

/** 고른 물리존과 합칠 수 있는 같은 층 방. 벽 두께(MERGE_GAP) 안에 있는 것만, 가까운 순으로. */
export const mergeCandidates = computed(() => {
  const picked = selectedSpace.value
  if (!picked || picked.space.footprint.length < 3) return []
  const ring = picked.space.footprint
  // 외접 사각형이 MERGE_GAP 보다 먼 방은 점 거리를 재지 않는다 — 층의 방 전부와 꼭짓점끼리 재서 리플레이의 방 장면마다 20ms 넘게 썼다.
  const bounds = (r: readonly Vec2[]) => r.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity])
  const [x0, y0, x1, y1] = bounds(ring)
  const near = (r: readonly Vec2[]) => {
    const b = bounds(r)
    return b[0] <= x1 + MERGE_GAP && b[2] >= x0 - MERGE_GAP && b[1] <= y1 + MERGE_GAP && b[3] >= y0 - MERGE_GAP
  }
  return picked.storey.spaces
    .filter((x) => x !== picked.space && x.footprint.length >= 3 && near(x.footprint))
    .map((x) => ({
      space: x,
      gap: Math.min(...x.footprint.map((p) => distanceToRing(p, ring)), ...ring.map((p) => distanceToRing(p, x.footprint))),
    }))
    .filter((x) => x.gap <= MERGE_GAP)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 12)
})

export function mergeInto(otherId: string) {
  const picked = selectedSpace.value
  if (!picked || !otherId) return
  const other = picked.storey.spaces.find((x) => x.id === otherId)
  const name = picked.space.longName || picked.space.name
  const otherName = other ? other.longName || other.name : otherId
  const keepId = picked.space.id
  let bridged = false
  const ok = changeSpaces(picked.storey.id, `${name} + ${otherName} 합치기`, (m) => {
    const done = mergeSpaces(m, keepId, otherId)
    if (done && 'bridged' in done) bridged = done.bridged
    return done
  })
  if (ok) note(`${otherName}${josa(otherName, '을/를')} ${name}에 합쳤습니다${bridged ? '. 사이의 벽 자리도 방에 넣었습니다' : ''}`)
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupOffset() {
  watch(selectedId, () => (offsetDraft.value = null))
  // 구간의 높이가 바뀌면(적용·되돌리기) 고르던 값을 버린다.
  watch(offsetNow, (now, was) => {
    if (now?.storeyId !== was?.storeyId || now?.height !== was?.height) offsetDraft.value = null
  })
  watch(
    () => shaftOff.value.map((d) => d.segment.id).join(','),
    (now, before) => {
      const fresh = shaftOff.value.filter((d) => !(before ?? '').split(',').includes(d.segment.id))
      if (fresh.length && editing.value)
        editNotice.value = `샤프트 축을 벗어난 구간 ${fresh.length}개: ${fresh.slice(0, 3).map((d) => `${shortName(d.segment.name)}(${d.shaft.name})`).join(', ')}. 소속은 그대로입니다 — 배관을 옮기거나 소속을 풉니다.`
    },
  )
  watch([selectedSpaceId, selectedId, selectedRoomId, drawing, editing], () => {
    if (selectedSpaceId.value || selectedId.value || selectedRoomId.value || drawing.value || !editing.value) zoneVertexEdit.value = null
  })
  watch(zoneVertexEdit, () => (zoneActiveVertex.value = null))
  watch(zoneActiveVertex, () => sceneVersion.value++)
}
