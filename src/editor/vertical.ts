import { computed, ref, toRaw, triggerRef, watch } from 'vue'
import { type Snapshot, snapshotEquipment, snapshotVerticals } from '../lib/edit'
import type { ElevatorStop, Model, Vec2, Vec3, VerticalKind } from '../lib/model'
import { moveShaftCarrying, planShaftCarry } from '../lib/shaft-carry'
import { snapAxis } from '../lib/shortcuts'
import { slabOpenings } from '../lib/slab-opening'
import { DIRECTION_LABEL, movePart, moveVertical, rotateVertical, setElevatorStop, setEscalatorDirection, setPartPoint, setVerticalHeading, snapHeading, STOP_LABEL, verticalCollisions, verticalEffect, verticalHeading, verticalImpact, verticalPivot, wallHeadings } from '../lib/vertical-edit'
import { LINK_SNAP, linkStatus, relinkShift, unlink, verticalLinks } from '../lib/vertical-link'
import { findPart, partId, partSpaces, VERTICAL_KIND_LABEL, verticalObjects as verticalObjectsOf } from '../lib/vertical-object'
import type { RotateHandle } from '../lib/viewer'
import { baseline } from './changes'
import { editing, model } from './core'
import { spaceNameOf } from './edit-report'
import { selectedElementId } from './equipment-edit'
import { cm, moveInScene, segmentAxis, shortName } from './equipment-shape'
import { equipmentById, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { editNotice } from './multi-select'
import { viewStorey } from './multi-view'
import { sceneVersion } from './redraw'
import { selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedCustomZoneId } from './space-edit'
import { selectedObjectId } from './space-objects'
import { draftShape } from './vertical-create'

// --- 수직 관통 오브젝트 (OE-ML-05 · OE-OBJ-14) ---------------------------------------------------------
// 층 편집 화면에서는 고르고 보기만 한다. 그 층의 형상과 진입·종료 지점을 그리고, 패널은 관통 층·연관 물리존을 말한다. 옮기기·지우기·형상·
// 구간은 다중층 뷰(OE-ML-01, 아직 없음)에서 한다. 고른 것은 조각 id(`부모 id@층 id`)다 — 같은 계단이라도 층마다 형상·지점이 다르다.
export const selectedVerticalId = ref<string | null>(null)
export const selectedVertical = computed(() => {
  const m = model.value
  const id = selectedVerticalId.value
  void sceneVersion.value
  if (!m || !id) return null
  const found = findPart(m, id)
  if (!found) return null
  const { storey, part } = found.object.parts[found.index]
  const spaces = partSpaces(storey, part).map((sid) => ({ id: sid, name: spaceNameOf(sid) }))
  return { ...found, storey, part, spaces, label: VERTICAL_KIND_LABEL[part.kind], openings: slabOpenings(m, found.object) }
})
/** 다중층 뷰(OE-ML-01)의 보기 범위. 아래 "다중층 뷰" 묶음이 다룬다. 고른 계단 조각의 칠하기가 먼저 읽어 여기 둔다. */
export const multiView = ref<{ from: string; to: string; back: string | null } | null>(null)
export const MULTI_VIEW_ONLY = '다중층 뷰에서는 수직 관통 오브젝트와 층간 배관만 다룹니다. 다른 편집은 [층 편집으로] 돌아가 합니다.'
export const VERTICAL_PART_LOCKED = '수직 관통 오브젝트라 층 편집 화면에서는 옮기거나 지우거나 형상·구간을 바꾸지 않습니다. 다중층 뷰에서 편집합니다.'
export const VERTICAL_ROLE: Record<'start' | 'through' | 'end', string> = { start: '시작 층 — 여기서 오르기 시작합니다', through: '지나는 층 — 진입·종료 지점이 없습니다', end: '끝 층 — 여기에 다다릅니다' }
export function selectVertical(id: string | null) {
  selectedVerticalId.value = id
  if (!id) return
  selectedId.value = null
  selectedSpaceId.value = null
  selectedRoomId.value = null
  selectedObjectId.value = null
  selectedSystemId.value = null
  selectedElementId.value = null
  selectedCustomZoneId.value = null
  const found = model.value && findPart(model.value, id)
  const home = found?.object.parts[found.index].storey
  if (home && !multiView.value && viewStorey.value && home.id !== viewStorey.value) viewStorey.value = home.id
}
/** 막았다고 알린다. 데이터는 그대로다. */
export function refuseVertical(): boolean {
  const v = selectedVertical.value
  if (!v || !editing.value) return false
  editNotice.value = `${v.label} ${shortName(v.part.name)}: ${VERTICAL_PART_LOCKED}`
  return true
}
// 다중층 뷰에서는 고른 오브젝트의 모든 층 조각을 칠한다 — 한 오브젝트로 보인다(OE-ML-01·OE-OBJ-14).
export const verticalHighlight = computed(() => {
  const v = selectedVertical.value
  if (!v) return new Set<string>()
  return multiView.value ? new Set(v.object.parts.map((p) => partId(v.object.id, p.storey.id))) : new Set([selectedVerticalId.value!])
})
// 그리는 것은 구간 바꾸기 묶음 뒤에서 본다 — 적용 전 미리보기(rangeGiven)도 같이 그린다.

// 다중층 뷰의 편집(OE-ML-07 전체 이동 · OE-ML-09 삭제, vertical-edit.ts). 모든 층의 조각을 한 번에 떠 두고 되돌린다 — 여러 층에 걸친
// 변경이 이력 하나다. 층 편집 화면에서는 부르지 않는다(OE-ML-05).
export function changeVerticals(label: string, apply: (m: Model) => boolean): boolean {
  const m = model.value
  if (!m || !multiView.value || !editing.value) return false
  const snapshot = snapshotVerticals(m)
  const at = mark()
  if (!apply(m)) return false
  remember(label, snapshot, at)
  triggerRef(model)
  sceneVersion.value++
  return true
}
/** 에스컬레이터 운행 방향을 바꾼다(OE-ML-11). 되돌리기 한 번이다. */
export function setDirectionFrom(parentId: string, direction: 'up' | 'down' | 'unknown') {
  changeVerticals(`에스컬레이터 ${DIRECTION_LABEL[direction]}`, (m) => setEscalatorDirection(m, parentId, direction))
}
/** 엘리베이터 한 층의 정차를 바꾼다(OE-ML-10). 되돌리기 한 번이다. */
export function setStopFrom(parentId: string, storeyId: string, stop: ElevatorStop) {
  const name = model.value?.storeys.find((st) => st.id === storeyId)?.name ?? storeyId
  changeVerticals(`엘리베이터 ${name} ${STOP_LABEL[stop]}`, (m) => setElevatorStop(m, parentId, storeyId, stop))
}
/** 고른 오브젝트를 x·y 로 옮긴다(전체 이동). 모든 층 조각이 같이 간다. */
function moveSelectedVertical(d: Vec2): boolean {
  const v = selectedVertical.value
  if (!v) return false
  const name = v.part.name || v.label
  if (v.object.kind === 'shaft') return moveShaft(v.object.id, name, [cm(d[0]), cm(d[1])])
  return changeVerticals(`${name} 옮김`, (m) => moveVertical(m, v.object.id, [cm(d[0]), cm(d[1])]))
}
/**
 * 샤프트를 옮기면 안쪽 배관이 같이, 바깥 배관 끝이 따라온다(OE-ML-17, lib/shaft-carry.ts). 일부만 옮길 수밖에 없으면 까닭을 알리고 아무것도
 * 옮기지 않는다. 샤프트와 따라온 배관이 되돌리기 한 번이다.
 */
function moveShaft(id: string, name: string, d: Vec2): boolean {
  const m = model.value
  if (!m || !multiView.value || !editing.value) return false
  const plan = planShaftCarry(m, id, segmentAxis)
  if (plan.reasons.length) {
    editNotice.value = `${name}을(를) 옮기지 않았습니다 — ${plan.reasons.join(' · ')}`
    return false
  }
  const followers = [...plan.rigid, ...new Set(plan.stretch.map((x) => x.id))]
  const was = new Map(followers.map((fid) => [fid, equipmentById.value.get(fid)?.position ?? null]))
  const snapshot: Snapshot = { kind: 'many', parts: [snapshotVerticals(m), ...followers.flatMap((fid) => snapshotEquipment(m, fid) ?? [])] }
  const at = mark()
  const done = moveShaftCarrying(m, id, d, segmentAxis)
  if (done !== true) {
    if (done) editNotice.value = done.refused
    return false
  }
  remember(`${name} 옮김${followers.length ? ` (배관 ${followers.length}개 같이)` : ''}`, snapshot, at)
  for (const fid of followers) moveInScene(fid, was.get(fid) ?? null, equipmentById.value.get(fid)?.position ?? null)
  triggerRef(model)
  sceneVersion.value++
  return true
}
/** 고른 샤프트를 옮기면 무엇이 같이 가는지(OE-ML-17 "이동 전 미리 표시"). 다중층 뷰의 편집에서만 잰다. */
export const shaftCarry = computed(() => {
  void sceneVersion.value
  const v = selectedVertical.value
  const m = model.value
  return m && v && v.object.kind === 'shaft' && multiView.value && editing.value ? planShaftCarry(m, v.object.id, segmentAxis) : null
})
/** 방향키로 옮긴다(10cm, Shift 1m). 화면 방향에 가장 가까운 평면 축이다(설비·룸 옮기기와 같다). */
export function nudgeVertical(code: string, step: number): boolean {
  if (!viewer || !selectedVertical.value) return false
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  moveSelectedVertical([sign * ax * step, sign * ay * step])
  return true
}
/** 패널의 이동 칸(Δx·Δy, 미터). */
export const verticalShift = ref<[string, string]>(['', ''])
export function applyVerticalShift() {
  const d: Vec2 = [Number(verticalShift.value[0] || 0), Number(verticalShift.value[1] || 0)]
  if (!Number.isFinite(d[0]) || !Number.isFinite(d[1])) {
    editNotice.value = '이동 거리는 숫자로 넣습니다(미터).'
    return
  }
  if (moveSelectedVertical(d)) verticalShift.value = ['', '']
}
/**
 * 만들기 초안. 계단·ES·EL 은 `at`(계단·ES 시작점, EL 승강로 가운데) 하나와 방위 `heading`(°)으로 기본 형상을 계산한다(OE-ML-06, 2026-10-14
 * PRD). 샤프트는 지금처럼 공통 축 형상을 그린다. `direction`·`directionOk` 는 ES 운행 방향과 그 확인이다(OE-ML-11 AC2).
 */
export type VerticalDraft = {
  kind: VerticalKind
  name: string
  from: string
  to: string
  at: Vec2 | null
  heading: number
  direction: 'up' | 'down'
  directionOk: boolean
  /** 이어 놓은 구간(OE-ML-06 AC4). `start` 는 시작점이 그 구간의 끝점에, `end` 는 끝점이 그 구간의 시작점에 고정됐다. */
  link: { kind: 'start' | 'end'; to: string; name: string; heading: number | null } | null
  /** EL 층별 정차(없으면 정차)와 진입 면(없으면 첫 면), 그리고 그 둘을 확인했는가(OE-ML-10 AC1). */
  stops: Record<string, boolean>
  faces: Record<string, number>
  stopsOk: boolean
}
export const verticalCreate = ref<VerticalDraft | null>(null)
/** 시작점·위치 하나로 만드는 종류. 샤프트만 형상을 그린다. */
export const placesByPoint = (kind: VerticalKind) => kind !== 'shaft'
/** 계단·ES 는 끝 층이 바로 위층으로 정해진다. */
export const flightKind = (kind: VerticalKind): kind is 'stair' | 'escalator' => kind === 'stair' || kind === 'escalator'

// --- 전체 회전 (OE-OBJ-15 AC6 · OE-ML-07 AC2) ---------------------------------------------------------
//
// 다중층 뷰의 편집에서 고른 오브젝트 둘레에 회전 손잡이를 둔다. 손잡이를 끌면 건물 축·가까운 벽 방향 ±3° 에 붙고(Alt 면 안 붙음), 떼면
// 모든 층 조각이 같은 중심에서 그 각도만큼 돈다. 끄는 동안은 돌린 모양을 미리보기로만 그리고 모델은 떼야 바뀐다 — Esc·창 포커스 잃음이면
// 아무것도 바뀌지 않는다. 숫자로 넣는 칸(패널)은 붙이지 않고 넣은 값 그대로다.
/** 끄는 중의 각도와 무엇에 붙었는지. 끄지 않을 때는 null. */
export const rotating = ref<{ angle: number; by: string | null; free: boolean } | null>(null)
export const rotateTarget = computed(() => {
  void sceneVersion.value
  const v = selectedVertical.value
  const m = model.value
  // 만들기 초안(OE-ML-06 "배치 중 미리보기를 돌려 방향을 정한다"). 중심은 계단·ES 시작점, EL 승강로 가운데다. 모델은 [만들기] 전까지 그대로다.
  const c = verticalCreate.value
  if (c && c.at && placesByPoint(c.kind) && m && multiView.value && editing.value) {
    const home = m.storeys.find((st) => st.id === c.from)
    const shape = draftShape(c, c.at, c.heading)
    if (!home || !shape || 'refused' in shape) return null
    const ring = shape.given.get(c.from)?.footprint ?? []
    // 끝점을 위 구간에 고정했으면 끝점이 중심이다 — 돌려도 이어진 자리가 그대로다(OE-ML-06 "회전 중심은 고정된 지점").
    const exit = c.link?.kind === 'end' && shape.flight ? shape.flight.exit : null
    const pivot: Vec2 = exit ?? c.at
    const reach = Math.max(1.2, ...ring.map((p) => Math.hypot(p[0] - pivot[0], p[1] - pivot[1])))
    return { draft: true, id: '', name: c.name, pivot, heading: c.heading, storey: home, radius: reach * 1.2, linkHeading: c.link?.heading ?? null }
  }
  if (!v || !m || !multiView.value || !editing.value) return null
  // 위 구간이 이어져 끝점이 고정된 계단·ES(아래 구간이기만 한 것)는 끝점이 중심이다. 시작점이 이어진 것은 시작점(기본) 그대로다.
  const links = verticalLinks(m).filter((l) => l.lower === v.object.id || l.upper === v.object.id)
  const exitPivot = links.length && links.every((l) => l.lower === v.object.id) ? v.object.parts.at(-1)?.part.exit : null
  const pivot = exitPivot ? ([exitPivot[0], exitPivot[1]] as Vec2) : verticalPivot(m, v.object.id)
  const heading = verticalHeading(m, v.object.id)
  if (!pivot || heading === null) return null
  // 손잡이 높이는 시작 층 바닥이다. 계단·ES 의 회전 중심(시작점)이 거기 있다.
  const home = v.object.parts[0].storey
  const ring = v.object.parts.find((x) => x.part.footprint.length)?.part.footprint ?? []
  const reach = Math.max(1.2, ...ring.map((p) => Math.hypot(p[0] - pivot[0], p[1] - pivot[1])))
  const linkHeading = links.length === 1 ? verticalHeading(m, links[0].lower === v.object.id ? links[0].upper : links[0].lower) : null
  return { draft: false, id: v.object.id, name: v.part.name || v.label, pivot, heading, storey: home, radius: reach * 1.2, linkHeading }
})
/** 끄는 동안 돌린 모양. 모든 층 조각의 형상과 진입·종료 지점이다. */
export const rotatePreview = computed(() => {
  const t = rotateTarget.value
  const r = rotating.value
  const m = model.value
  const v = selectedVertical.value
  // 초안은 rangeGiven 미리보기가 끄는 각도를 따라 돈다(draft).
  if (!t || t.draft || !r || !m || !v) return []
  const d = (((r.angle - t.heading) % 360) + 540) % 360 - 180
  const copy = { storeys: v.object.parts.map(({ storey, part }) => ({ ...storey, verticalParts: [structuredClone(toRaw(part))] })) }
  rotateVertical(copy as unknown as Model, t.id, d, t.pivot)
  return copy.storeys.flatMap((st) =>
    st.verticalParts.flatMap((part) => [
      ...(part.footprint.length ? [{ storeyId: st.id, elevation: st.elevation, footprint: part.footprint }] : []),
      ...[part.entry, part.exit].filter((p): p is Vec3 => !!p).map((p) => ({ storeyId: st.id, elevation: st.elevation, point: [p[0], p[1]] as Vec2 })),
    ]),
  )
})
export const rotateHandle = computed<RotateHandle | null>(() => {
  const t = rotateTarget.value
  if (!t) return null
  const r = rotating.value
  const angle = r?.angle ?? t.heading
  const label = r ? `${angle.toFixed(1)}° · ${r.by ? `${r.by}에 붙음` : r.free ? '스냅 끔(Alt)' : '자유'}` : `${angle.toFixed(1)}°`
  return { center: t.pivot, elevation: t.storey.elevation, radius: t.radius, angle, guide: r?.by ? angle : null, label }
})
/**
 * 고른 오브젝트의 방위를 `to`(°)로 맞춘다. 샤프트 안에 배관이 있으면 돌리지 않는다 — 옮기기는 배관을 같이 옮기지만(OE-ML-17) 돌리기는
 * 배관을 같이 돌리지 않아 배관이 샤프트 밖으로 삐져나간다.
 */
function rotateSelectedVertical(to: number): boolean {
  const t = rotateTarget.value
  const m = model.value
  if (!t || !m || !Number.isFinite(to)) return false
  if (t.draft && verticalCreate.value) {
    const c = verticalCreate.value
    const heading = Math.round((((to % 360) + 360) % 360) * 10) / 10
    // 끝점 고정이면 끝점(중심)은 그대로 두고 시작점을 새 방위의 반대쪽 길이만큼에 둔다.
    if (c.link?.kind === 'end' && c.at) {
      const shape = draftShape(c, c.at, c.heading)
      if (shape && !('refused' in shape) && shape.flight) {
        const r = (heading * Math.PI) / 180
        c.at = [cm(t.pivot[0] - Math.cos(r) * shape.flight.length), cm(t.pivot[1] - Math.sin(r) * shape.flight.length)]
      }
    }
    c.heading = heading
    return true
  }
  if (selectedVertical.value?.object.kind === 'shaft') {
    const carry = planShaftCarry(m, t.id, segmentAxis)
    const inside = carry.rigid.length + new Set(carry.stretch.map((x) => x.id)).size
    if (inside) {
      editNotice.value = `${t.name}: 샤프트 안 배관 ${inside}개가 같이 돌지 않아 돌리지 않았습니다. 옮기기는 배관이 같이 갑니다.`
      return false
    }
  }
  const angle = ((to % 360) + 360) % 360
  return changeVerticals(`${t.name} ${angle.toFixed(1)}°로 돌림`, (mm) => setVerticalHeading(mm, t.id, angle, t.pivot))
}
export function onRotate(phase: 'move' | 'end' | 'cancel', raw: number, free: boolean) {
  const t = rotateTarget.value
  if (!t) return
  if (phase === 'cancel') {
    rotating.value = null
    return
  }
  if (phase === 'move') {
    const home = model.value?.storeys.find((st) => st.id === t.storey.id)
    // 이어진 구간이 있으면 그 방향과 반대 방향(꺾어 오르기)에도 ±8° 로 붙는다(OE-ML-06).
    const extra = t.linkHeading === null || t.linkHeading === undefined ? [] : [{ angle: t.linkHeading, by: '이어진 구간 방향', tol: LINK_SNAP }, { angle: t.linkHeading + 180, by: '꺾어 오르기(반대 방향)', tol: LINK_SNAP }]
    const snap = snapHeading(raw, home ? wallHeadings(home, t.pivot) : [], free, extra)
    rotating.value = { angle: snap.angle, by: snap.by, free }
    return
  }
  const r = rotating.value
  rotating.value = null
  if (r) rotateSelectedVertical(r.angle)
}
/** 패널의 회전각 칸. 붙이지 않고 넣은 값 그대로 돌린다. */
export function applyVerticalHeading(input: HTMLInputElement) {
  const t = rotateTarget.value
  const value = Number(input.value)
  if (!t) return
  if (!input.value.trim() || !Number.isFinite(value)) {
    editNotice.value = '회전각은 숫자로 넣습니다(°).'
    input.value = t.heading.toFixed(1)
    return
  }
  if (!rotateSelectedVertical(value)) input.value = t.heading.toFixed(1)
}
// --- 이어진 구간 (OE-ML-19 AC8 · OE-ML-07 AC6 · OE-ML-11 AC6) ---
// 고른 오브젝트가 낀 연속 연결과 지금 유효한지. 어긋나면 지우지 않고 재검토로 보이고, [다시 붙이기] 로 이 오브젝트를 옮겨 붙이거나 [연결 풀기]
// 로 푼다. 둘 다 되돌리기 한 번이다.
export const selectedLinks = computed(() => {
  void sceneVersion.value
  const v = selectedVertical.value
  const m = model.value
  if (!v || !m) return []
  const names = new Map(verticalObjectsOf(m).map((o) => [o.id, o.name]))
  return verticalLinks(m)
    .filter((l) => l.lower === v.object.id || l.upper === v.object.id)
    .map((link) => {
      const role: 'lower' | 'upper' = link.lower === v.object.id ? 'lower' : 'upper'
      const other = role === 'lower' ? link.upper : link.lower
      return { link, role, other, otherName: names.get(other) ?? other, storey: m.storeys.find((st) => st.id === link.storeyId)?.name ?? link.storeyId, status: linkStatus(m, link) }
    })
})
/** 고른 오브젝트의 연결 지점 표시(초록 유효 · 빨강 재검토). */
export const linkMarks = computed(() =>
  selectedLinks.value.flatMap((x) => {
    const at = x.status.at
    const st = model.value?.storeys.find((s) => s.id === x.link.storeyId)
    return at && st ? [{ storeyId: st.id, elevation: st.elevation + 0.05, point: [at[0], at[1]] as Vec2, ...(x.status.ok ? { tone: 'ok' as const } : { warn: true }) }] : []
  }),
)
export function relinkSelected(x: (typeof selectedLinks.value)[number]) {
  const m = model.value
  if (!m) return
  if (!x.status.ok && x.status.why === '운행 방향이 다릅니다') {
    editNotice.value = '운행 방향이 달라 붙이지 않았습니다. 방향부터 맞춥니다'
    return
  }
  const d = relinkShift(m, x.link, x.role)
  if (!d) {
    editNotice.value = '만나는 지점이 없어 다시 붙이지 못했습니다'
    return
  }
  const name = selectedVertical.value?.part.name || selectedVertical.value?.label || ''
  if (changeVerticals(`${name} 다시 붙이기`, (mm) => moveVertical(mm, x.role === 'lower' ? x.link.lower : x.link.upper, d))) note(`${name}을(를) 옮겨 ${x.otherName}에 다시 붙였습니다`)
}
export function unlinkSelected(x: (typeof selectedLinks.value)[number]) {
  if (changeVerticals(`${x.otherName} 연결 풀기`, (mm) => unlink(mm, x.link))) note(`${x.otherName}과(와)의 연결을 풀었습니다`)
}
/** V-03 다중층 이동 충돌 경고(OE-ML-07). 연 때 형상과 견준다. 막지는 않는다. */
export const verticalWarnings = computed(() => {
  const v = selectedVertical.value
  const m = model.value
  if (!v || !m || !multiView.value) return []
  return verticalCollisions(m, v.object.id, baseline.value?.verticals?.get(v.object.id)?.footprints)
})
/** 지우기 확인(OE-ML-09). 취소하면 아무것도 바뀌지 않는다. */
export const verticalDeleteAsk = ref(false)
export const verticalDeleteImpact = computed(() => (verticalDeleteAsk.value && selectedVertical.value && model.value ? verticalImpact(model.value, selectedVertical.value.object.id) : null))
export const verticalDeleteEffect = computed(() => (verticalDeleteAsk.value && selectedVertical.value && model.value ? verticalEffect(model.value, selectedVertical.value.object.id) : null))
/** 이 층 조각만 옮기는 칸(Δx·Δy)과 진입·종료 지점 칸(x·y). 고른 조각이 바뀌면 비운다. */
export const partShift = ref<[string, string]>(['', ''])
export function applyPartShift() {
  const v = selectedVertical.value
  const d: Vec2 = [Number(partShift.value[0] || 0), Number(partShift.value[1] || 0)]
  if (!v || !Number.isFinite(d[0]) || !Number.isFinite(d[1])) {
    editNotice.value = '이동 거리는 숫자로 넣습니다(미터).'
    return
  }
  if (changeVerticals(`${v.part.name || v.label} ${v.storey.name} 조각 옮김`, (m) => movePart(m, selectedVerticalId.value!, [cm(d[0]), cm(d[1])]))) partShift.value = ['', '']
}
export function applyPartPoint(which: 'entry' | 'exit', axis: 0 | 1, input: HTMLInputElement) {
  const v = selectedVertical.value
  const p = v?.part[which]
  const value = Number(input.value)
  if (!v || !p) return
  if (!input.value.trim() || !Number.isFinite(value)) {
    editNotice.value = '좌표는 숫자로 넣습니다(미터).'
    input.value = p[axis].toFixed(2)
    return
  }
  const at: Vec2 = axis === 0 ? [cm(value), p[1]] : [p[0], cm(value)]
  changeVerticals(`${v.part.name || v.label} ${which === 'entry' ? '진입' : '종료'} 지점`, (m) => setPartPoint(m, selectedVerticalId.value!, which, at))
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupVertical() {
  // 다시 열거나 합쳐서 조각이 없어지면 푼다.
  watch(model, (m) => {
    if (selectedVerticalId.value && (!m || !findPart(m, selectedVerticalId.value))) selectedVerticalId.value = null
  })
  watch(selectedVerticalId, () => (rotating.value = null))
  watch(rotateHandle, (h) => viewer?.setRotateHandle(h))
  watch(selectedVerticalId, () => (verticalDeleteAsk.value = false))
  watch(selectedVerticalId, () => (partShift.value = ['', '']))
}
