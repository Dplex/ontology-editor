import { computed, ref, watch } from 'vue'
import { newId } from '../lib/edit'
import { josa } from '../lib/josa'
import type { Vec2, VerticalKind } from '../lib/model'
import { type SlabOpening, slabOpenings } from '../lib/slab-opening'
import { createVertical, deleteVertical, draftVertical, faceLanding, planCreate, planElevator, planFlight, planRange, planSteps, type RangeGiven, type RangeNeed, setElevatorLanding, setElevatorStop, setEscalatorDirection, setVerticalRange, storeyAbove, verticalHeading } from '../lib/vertical-edit'
import { anchoredFlight, LINK_RELEASE, type LinkCandidate, linkCandidates, nearestCandidate } from '../lib/vertical-link'
import { findPart, partId, VERTICAL_KIND_LABEL } from '../lib/vertical-object'
import { model } from './core'
import { stopAdd } from './equipment-edit'
import { shortName } from './equipment-shape'
import { selectedId } from './flow-rules'
import { note } from './keyboard'
import { editNotice } from './multi-select'
import { multiRange, openMultiView, storeysByHeight } from './multi-view'
import { stopDraw, stopPlace } from './place'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { drawing } from './space-objects'
import { changeVerticals, flightKind, multiView, placesByPoint, rotateTarget, rotating, selectedVertical, selectedVerticalId, selectVertical, verticalCreate, type VerticalDraft } from './vertical'
import { applyStoreyFilter } from './view-filter'

// --- 구간 바꾸기(OE-ML-08) ---
/** 고르는 중인 시작·끝 층. null 이면 지금 구간이다. */
const rangeDraft = ref<{ from: string; to: string } | null>(null)
/** 빈 층을 채우려고 사람이 그린 형상·찍은 지점(층 id → 것). [구간 적용] 때 한 번에 넣는다. */
export const rangeGiven = ref(new Map<string, { footprint?: Vec2[]; entry?: Vec2; exit?: Vec2 }>())
// 구간 바꾸기에서 적용 전에 그리거나 찍은 것은 점선으로 보인다(OE-ML-08). 
export const verticalPreview = computed(() =>
  [...rangeGiven.value].flatMap(([storeyId, g]) => {
    const st = model.value?.storeys.find((s) => s.id === storeyId)
    if (!st) return []
    return [
      ...(g.footprint ? [{ storeyId, elevation: st.elevation, footprint: g.footprint, warn: draftOutside.value }] : []),
      ...[g.entry, g.exit].filter((p): p is Vec2 => !!p).map((point) => ({ storeyId, elevation: st.elevation, point, warn: draftOutside.value })),
    ]
  }),
)
/** 찍은 초안이 건물 밖인가(경고 색, OE-ML-06 AC3). */
export const draftOutside = computed(() => {
  const d = createDraft.value
  return !!d && !('refused' in d) && d.outside
})
export const verticalRange = computed(() => {
  const v = selectedVertical.value
  if (!v) return null
  return rangeDraft.value ?? { from: v.object.parts[0].storey.id, to: v.object.parts.at(-1)!.storey.id }
})
export const RANGE_NEED: Record<RangeNeed, string> = { footprint: '형상', entry: '진입 지점', exit: '종료 지점' }
/** 고른 구간이 지금과 다르면 무엇이 더해지고 빠지고 무엇을 채워야 하나. 같으면 null. */
export const rangePlan = computed(() => {
  const v = selectedVertical.value
  const r = rangeDraft.value
  if (!v || !r || !model.value) return null
  return planRange(model.value, v.object.id, r.from, r.to, rangeGiven.value)
})
export function setRangeEnd(which: 'from' | 'to', storeyId: string) {
  const r = verticalRange.value
  if (!r) return
  rangeDraft.value = { ...r, [which]: storeyId }
  // 새 구간이 보기 범위 밖이면 보기 범위를 넓힌다 — 채울 층이 보여야 그린다. 데이터는 [구간 적용] 전까지 그대로다.
  const list = storeysByHeight.value
  const v = multiView.value
  if (!v) return
  const at = (id: string) => list.findIndex((st) => st.id === id)
  const lo = Math.min(at(v.from), at(v.to), at(rangeDraft.value.from), at(rangeDraft.value.to))
  const hi = Math.max(at(v.from), at(v.to), at(rangeDraft.value.from), at(rangeDraft.value.to))
  if (lo >= 0 && hi >= 0) multiView.value = { ...v, from: list[lo].id, to: list[hi].id }
}
/** 그 층의 빈 것을 채우러 바닥에 그리거나 찍는다. `lead` 는 안내 앞에 붙는 말(앞 단계를 채웠다는 것). */
export function fillRange(storeyId: string, what: RangeNeed, lead = '') {
  const st = model.value?.storeys.find((s) => s.id === storeyId)
  if (!st) return
  stopPlace()
  stopAdd()
  const label = RANGE_NEED[what]
  drawing.value =
    what === 'footprint'
      ? { purpose: 'verticalFootprint', spaceId: null, storeyId, name: `${st.name} 형상`, elevation: st.elevation, points: [] }
      : { purpose: 'verticalPoint', which: what, spaceId: null, storeyId, name: `${st.name} ${label}`, elevation: st.elevation, points: [] }
  viewer?.setPlaceMode(st.elevation)
  note(lead + (what === 'footprint' ? `${st.name} 바닥에 형상의 꼭짓점을 찍고 Enter 로 마칩니다 (Esc 취소)` : `${st.name} 바닥에서 ${label}을 누릅니다 (Esc 취소)`))
}
/**
 * 구간을 늘린 계단·ES 의 새 층은 그 층의 시작점 하나로 채운다(OE-ML-08, 2026-10-14 PRD "생성과 같은 기준(OE-ML-06)"). 찍은 점에서 지금 방위로
 * 바로 위층까지의 기본 형상과 위층 종료 지점을 계산해 채운다. 그 층이 새 시작 층이면 진입 지점도 그 점이다. 형상을 손으로 그리는 길도 둔다.
 */
export const placingRangeAt = ref<string | null>(null)
export function fillRangeStart(storeyId: string) {
  const st = model.value?.storeys.find((s) => s.id === storeyId)
  if (!st) return
  stopPlace()
  stopAdd()
  if (drawing.value) stopDraw()
  placingRangeAt.value = storeyId
  viewer?.setPlaceMode(st.elevation)
  note(`${st.name} 바닥에서 이 층 구간의 시작점을 누릅니다. 지금 방위로 위층까지 계산합니다 (Esc 취소)`)
}
export function stopRangeStart() {
  if (!placingRangeAt.value) return
  placingRangeAt.value = null
  viewer?.setPlaceMode(null)
}
export function placeRangeStart(at: Vec2) {
  const storeyId = placingRangeAt.value
  const v = selectedVertical.value
  const m = model.value
  stopRangeStart()
  if (!storeyId || !v || !m || (v.object.kind !== 'stair' && v.object.kind !== 'escalator')) return
  const f = planFlight(m, v.object.kind, storeyId, at, verticalHeading(m, v.object.id) ?? 0)
  if ('refused' in f) {
    editNotice.value = f.refused
    return
  }
  const next = new Map(rangeGiven.value)
  const needsEntry = rangePlan.value && !('refused' in rangePlan.value) && rangePlan.value.needs.some((n) => n.storey.id === storeyId && n.what.includes('entry'))
  next.set(storeyId, { ...next.get(storeyId), footprint: f.footprint, ...(needsEntry ? { entry: f.entry } : {}) })
  next.set(f.to.id, { ...next.get(f.to.id), exit: f.exit })
  rangeGiven.value = next
  note(`${f.from.name} 시작점에서 ${f.to.name}까지 계산했습니다(수평 길이 ${f.length.toFixed(2)}m). 다 채웠으면 [구간 적용] 을 누릅니다`)
}
/** 만들기·구간 바꾸기에서 아직 채우지 않은 첫 번째 것. 하나를 채우면 이것을 이어서 그린다 — 층마다 단추를 찾아 누르지 않게. */
export function nextFill(): { storeyId: string; what: RangeNeed } | null {
  const plan = verticalCreate.value ? createPlan.value : rangePlan.value
  const n = plan && !('refused' in plan) ? plan.needs[0] : undefined
  return n ? { storeyId: n.storey.id, what: n.what[0] } : null
}
export function isFilling(storeyId: string, what: RangeNeed): boolean {
  const d = drawing.value
  if (!d || d.storeyId !== storeyId) return false
  return what === 'footprint' ? d.purpose === 'verticalFootprint' : d.purpose === 'verticalPoint' && d.which === what
}
export function fillNext() {
  const n = nextFill()
  if (n) fillRange(n.storeyId, n.what)
}
export function cancelRange() {
  rangeDraft.value = null
  rangeGiven.value = new Map()
}
export function applyRange() {
  const v = selectedVertical.value
  const r = rangeDraft.value
  if (!v || !r) return
  let refused = ''
  const name = v.part.name || v.label
  const done = changeVerticals(`${name} 구간`, (m) => {
    const res = setVerticalRange(m, v.object.id, r.from, r.to, rangeGiven.value)
    if (res !== true) refused = res.refused
    return res === true
  })
  if (!done) {
    if (refused) editNotice.value = refused
    return
  }
  const id = v.object.id
  cancelRange()
  // 고른 조각이 구간 밖이 되었으면 새 시작 층 조각을 고른다.
  if (model.value && !findPart(model.value, selectedVerticalId.value!)) selectVertical(partId(id, r.from))
  note(`${name}의 구간을 바꿨습니다. Ctrl+Z 로 되돌립니다`)
}
// --- 만들기(OE-ML-06) ---
// 다중층 뷰(편집 모드)에서 종류·이름·시작/끝 층을 정하고, 빈 층은 구간 바꾸기와 같은 길(fillRange · rangeGiven)로 채운다. 계획·채우기는 모델을
// 바꾸지 않는다 — [취소] 하면 남는 것이 없다. [만들기] 한 번이 되돌리기 한 번이다.

export const createPlan = computed(() => {
  const c = verticalCreate.value
  return c && model.value ? planCreate(model.value, c.kind, c.from, c.to, rangeGiven.value) : null
})
/**
 * 층 편집 화면의 도구 팔레트에서 부르면 지금 층과 위층으로 다중층 뷰를 열고 만든다(만들기는 다중층 뷰에서만 한다, OE-ML-06).
 * 계단·샤프트는 공간 쪽, 엘리베이터·에스컬레이터는 설비 쪽 팔레트에 있다.
 */
export async function startCreateVertical(kind: VerticalKind = 'stair') {
  if (!multiView.value && !(await openMultiView())) return
  const range = multiRange.value
  if (!range || range.length < 2) {
    note('보기 범위를 두 층 이상으로 넓힌 뒤 만듭니다')
    return
  }
  selectedVerticalId.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  rangeDraft.value = null
  rangeGiven.value = new Map()
  verticalCreate.value = draftFor(kind, `새 ${VERTICAL_KIND_LABEL[kind]}`, range[0].id, range[1].id)
}
function draftFor(kind: VerticalKind, name: string, from: string, to: string): VerticalDraft {
  const above = flightKind(kind) && model.value ? storeyAbove(model.value, from) : null
  return { kind, name, from, to: above?.id ?? to, at: null, heading: 0, direction: 'up', directionOk: false, link: null, stops: {}, faces: {}, stopsOk: false }
}
export const createSteps = computed(() => {
  const c = verticalCreate.value
  const plan = createPlan.value
  return c && plan && !('refused' in plan) ? planSteps(c.kind, plan) : []
})
export function setCreateKind(kind: VerticalKind) {
  const c = verticalCreate.value
  if (!c) return
  // 종류마다 채울 것이 다르다(층별 형상 / 공통 축). 채운 것을 비운다.
  const wasDefault = c.name === `새 ${VERTICAL_KIND_LABEL[c.kind]}`
  verticalCreate.value = draftFor(kind, wasDefault ? `새 ${VERTICAL_KIND_LABEL[kind]}` : c.name, c.from, c.to)
  rangeGiven.value = new Map()
  stopPlaceVertical()
}
export function cancelCreateVertical() {
  if (drawing.value?.purpose === 'verticalFootprint' || drawing.value?.purpose === 'verticalPoint') stopDraw()
  stopPlaceVertical()
  verticalCreate.value = null
  rangeGiven.value = new Map()
}

// --- 시작점·위치 찍기와 기본 형상 (OE-ML-06 AC1·2·3 · OE-ML-11 AC2) ---
// 찍는 동안은 마우스를 따라 기본 형상이 점선으로 따라온다. 찍은 뒤에는 회전 손잡이(rotateTarget 의 초안 갈래)나 회전각 칸으로 방위를 정한다.
// 계산한 형상·지점은 구간 바꾸기와 같은 rangeGiven 에 넣어, 채울 것·미리보기·[만들기] 가 그 길을 그대로 탄다.
export const placingVertical = ref(false)
const createHover = ref<Vec2 | null>(null)
/** 찍는 동안 고정한 이어 놓기 후보와, 그 고정에서 커서로 정한 시작점·방위(OE-ML-06 AC4). */
export const createAnchor = ref<LinkCandidate | null>(null)
export const createAnchored = ref<{ at: Vec2; heading: number; by: string | null; length: number } | null>(null)
/** 지금 찍는 구간이 붙을 수 있는 지점. 계단은 계단끼리, ES 는 같은 운행 방향끼리다. */
export const createCandidates = computed(() => {
  const c = verticalCreate.value
  const m = model.value
  if (!c || !m || !placingVertical.value || !flightKind(c.kind)) return []
  return linkCandidates(m, c.kind, c.from, c.kind === 'escalator' ? c.direction : null)
})
export function startPlaceVertical() {
  const c = verticalCreate.value
  const st = c && model.value?.storeys.find((x) => x.id === c.from)
  if (!c || !st || !placesByPoint(c.kind)) return
  placingVertical.value = true
  viewer?.setPlaceMode(st.elevation)
  note(`${st.name} 바닥에서 ${flightKind(c.kind) ? '시작점' : '승강로 가운데'}을 누릅니다. Esc 로 그만둡니다`)
}
export function stopPlaceVertical() {
  if (!placingVertical.value) return
  placingVertical.value = false
  createHover.value = null
  createAnchor.value = null
  createAnchored.value = null
  viewer?.setPlaceMode(null)
}
/** 초안 하나의 기본 형상. 계단·ES 는 planFlight(거절 가능), EL 은 planElevator 다. */
export function draftShape(c: VerticalDraft, at: Vec2, heading: number) {
  const m = model.value
  if (!m) return null
  if (flightKind(c.kind)) {
    const f = planFlight(m, c.kind, c.from, at, heading)
    if ('refused' in f) return f
    return { given: new Map([[c.from, { footprint: f.footprint, entry: f.entry }], [f.to.id, { exit: f.exit }]]) as RangeGivenMap, outside: f.outside, flight: f }
  }
  if (c.kind === 'elevator') {
    const e = planElevator(m, c.from, at, heading)
    return { given: new Map([[c.from, { footprint: e.footprint }]]) as RangeGivenMap, outside: e.outside, flight: null }
  }
  return null
}
type RangeGivenMap = Map<string, { footprint?: Vec2[]; entry?: Vec2; exit?: Vec2 }>
/**
 * 찍는 동안 커서가 후보 지점에 1m 안으로 가면 고정하고(Alt 면 고정하지 않음), 고정한 뒤에는 커서 쪽으로 방위를 정한다. 고정점에서 구간 길이
 * + 6m 보다 멀어지거나 Alt 를 누르면 푼다(OE-ML-06 AC4).
 */
export function onPlaceVerticalHover(at: Vec2 | null, alt: boolean) {
  createHover.value = at
  const c = verticalCreate.value
  const m = model.value
  if (!at || !c || !m || !flightKind(c.kind)) {
    createAnchored.value = null
    return
  }
  const anchor = createAnchor.value
  if (anchor && (alt || Math.hypot(at[0] - anchor.at[0], at[1] - anchor.at[1]) > (createAnchored.value?.length ?? 0) + LINK_RELEASE)) createAnchor.value = null
  if (!createAnchor.value && !alt) createAnchor.value = nearestCandidate(createCandidates.value, at)
  createAnchored.value = createAnchor.value ? anchoredFlight(m, c.kind, c.from, createAnchor.value, at) : null
}
/** 찍은 초안의 형상. 손잡이를 끄는 동안은 끄는 각도로 계산해 미리보기가 따라 돈다. */
export const createDraft = computed(() => {
  const c = verticalCreate.value
  if (!c || !c.at || !placesByPoint(c.kind)) return null
  const heading = rotateTarget.value?.draft ? (rotating.value?.angle ?? c.heading) : c.heading
  return draftShape(c, c.at, heading)
})
/** 찍는 동안 마우스를 따라오는 미리보기. */
export const createHoverPreview = computed(() => {
  const c = verticalCreate.value
  const at = createHover.value
  if (!c || !placingVertical.value) return []
  // 붙일 수 있는 지점(주황). 고정한 지점은 그 자리에 하나 더 그려 두껍게 보인다.
  const marks = createCandidates.value.map((k) => ({ storeyId: k.storey.id, elevation: k.storey.elevation, point: k.at, tone: 'candidate' as const }))
  if (createAnchor.value) marks.push({ storeyId: createAnchor.value.storey.id, elevation: createAnchor.value.storey.elevation + 0.05, point: createAnchor.value.at, tone: 'candidate' })
  if (!at) return marks
  const a = createAnchored.value
  const d = a ? draftShape(c, a.at, a.heading) : draftShape(c, at, c.heading)
  if (!d || 'refused' in d) return marks
  return [...marks, ...[...d.given].flatMap(([storeyId, g]) => {
    const st = model.value?.storeys.find((x) => x.id === storeyId)
    if (!st) return []
    return [
      ...(g.footprint ? [{ storeyId, elevation: st.elevation, footprint: g.footprint, warn: d.outside }] : []),
      ...[g.entry, g.exit].filter((p): p is Vec2 => !!p).map((point) => ({ storeyId, elevation: st.elevation, point, warn: d.outside })),
    ]
  })]
})
/**
 * 만드는 동안의 슬래브 개구부(OE-ML-06 AC5). 만든 뒤 패널과 같은 판정(slabOpenings, OE-ML-03)을 초안 형상으로 미리 잰다 — 찍는 동안은 커서를
 * 따라, 돌리는 동안은 끄는 각도를 따라(rangeGiven 이 createDraft 를 따른다) 다시 잰다. 모델은 [만들기] 전까지 그대로다.
 */
export const createOpenings = computed<SlabOpening[]>(() => {
  const c = verticalCreate.value
  const m = model.value
  const plan = createPlan.value
  if (!c || !m || !plan || 'refused' in plan) return []
  let given: RangeGiven = rangeGiven.value
  if (placingVertical.value && createHover.value) {
    const a = createAnchored.value
    const d = a ? draftShape(c, a.at, a.heading) : draftShape(c, createHover.value, c.heading)
    given = d && !('refused' in d) ? d.given : new Map()
  }
  if (![...given.values()].some((g) => g.footprint)) return []
  return slabOpenings(m, draftVertical(c.kind, plan, given))
})
/** 개구부가 면적에 주는 영향(한 줄). 물리존 면적 차감은 아직 하지 않는다(ADR-0068) — 초안은 확인 전이라 그 뒤에도 빼지 않는다. */
export function openingImpact(o: SlabOpening): string {
  if (o.state === 'cut') return `슬래브 ${o.coverM2!.toFixed(2)}㎡ 를 뚫음`
  if (o.state === 'draft') return `확인 전 — 면적에 반영하지 않음`
  if (o.state === 'bim') return '원본 개구부를 다시 씀 — 면적 그대로'
  if (o.state === 'open') return '이미 비어 있음 — 면적 그대로'
  return '형상 근거가 없어 산정하지 않음'
}
/** 3D 의 개구부 미리보기 — 뚫리는 층 바닥에 확정은 보라, 초안은 노랑 점선. 이미 비었거나 BIM 개구부인 자리는 새로 생기는 것이 없어 그리지 않는다. */
export const createOpeningPreview = computed(() =>
  createOpenings.value.flatMap((o) => {
    const st = model.value?.storeys.find((x) => x.id === o.storeyId)
    if (!st || !o.footprint || (o.state !== 'cut' && o.state !== 'draft')) return []
    return [{ storeyId: o.storeyId, elevation: st.elevation + 0.03, footprint: o.footprint, tone: o.state }]
  }),
)
/** 초안이 만들 수 있는가. 못 만들면 그 까닭. */
export const draftBlock = computed(() => {
  const c = verticalCreate.value
  if (!c || !placesByPoint(c.kind)) return null
  const from = model.value?.storeys.find((st) => st.id === c.from)
  if (flightKind(c.kind) && from && model.value && !storeyAbove(model.value, c.from)) return `${from.name} 이 최상층이라 위층이 없습니다. 다른 층에서 시작합니다.`
  if (!c.at) return `${flightKind(c.kind) ? '시작점' : '승강로 위치'}을 먼저 찍습니다`
  const d = createDraft.value
  if (!d) return null
  if ('refused' in d) return d.refused
  if (d.outside) return flightKind(c.kind) ? '형상이 건물(물리존) 밖으로 나갑니다. 돌리거나 다른 자리에 찍습니다' : '승강로가 건물(물리존) 밖으로 나갑니다. 다른 자리에 찍습니다'
  if (c.kind === 'escalator' && !c.directionOk) return '운행 방향을 확인합니다'
  if (c.kind === 'elevator' && !c.stopsOk) return '정차 층·진입 지점을 확인합니다'
  return null
})
/** 만들 EL 의 층들(구간). 정차·진입 면을 층마다 고른다. */
export const draftFloors = computed(() => {
  const plan = createPlan.value
  return verticalCreate.value?.kind === 'elevator' && plan && !('refused' in plan) ? plan.storeys : []
})
/** 만들 EL 의 승강로 형상(진입 면을 고르는 기준). */
export const draftRing = computed(() => {
  const d = createDraft.value
  const c = verticalCreate.value
  return c && d && !('refused' in d) ? (d.given.get(c.from)?.footprint ?? []) : []
})
/** 면 이름. 바깥 방향이 가장 가까운 평면 축이다(`면 1 · -y 쪽`). */
export function faceLabel(ring: readonly Vec2[], face: number): string {
  const p = faceLanding(ring, face)
  const a = ring[face]
  const b = ring[(face + 1) % ring.length]
  if (!p || !a || !b) return `면 ${face + 1}`
  const deg = (((Math.atan2(p[1] - (a[1] + b[1]) / 2, p[0] - (a[0] + b[0]) / 2) * 180) / Math.PI) + 360) % 360
  const dir = ['+x', '+y', '-x', '-y'][Math.round(deg / 90) % 4]
  return `면 ${face + 1} · ${dir} 쪽`
}
/** 만들 EL 의 층별 진입 지점 미리보기(초록 점). */
export const draftLandingPreview = computed(() => {
  const c = verticalCreate.value
  const ring = draftRing.value
  if (!c || c.kind !== 'elevator' || ring.length < 3) return []
  return draftFloors.value.flatMap((st) => {
    const at = faceLanding(ring, c.faces[st.id] ?? 0)
    return at ? [{ storeyId: st.id, elevation: st.elevation, point: at, tone: 'ok' as const }] : []
  })
})
/** 고른 EL 한 층의 진입 면을 바꾼다(OE-ML-10). 되돌리기 한 번이다. */
export function setLandingFrom(parentId: string, storeyId: string, face: number) {
  const name = model.value?.storeys.find((st) => st.id === storeyId)?.name ?? storeyId
  changeVerticals(`엘리베이터 ${name} 진입 면 ${face + 1}`, (m) => setElevatorLanding(m, parentId, storeyId, face))
}
export function applyCreateVertical() {
  const c = verticalCreate.value
  if (!c) return
  const id = newId()
  let refused = ''
  if (draftBlock.value) {
    editNotice.value = draftBlock.value
    return
  }
  const done = changeVerticals(`${c.name.trim() || VERTICAL_KIND_LABEL[c.kind]} 만들기`, (m) => {
    const r = createVertical(m, { id, kind: c.kind, name: c.name, from: c.from, to: c.to }, rangeGiven.value)
    if ('refused' in r) refused = r.refused
    // ES 운행 방향은 확인한 값으로 만든다(OE-ML-11 AC2). 같은 되돌리기 한 번이다.
    if ('id' in r && c.kind === 'escalator') setEscalatorDirection(m, id, c.direction)
    // EL 층별 정차·진입 면(OE-ML-10). 고른 그대로 같은 되돌리기 한 번에 넣는다.
    if ('id' in r && c.kind === 'elevator') {
      for (const st of draftFloors.value) {
        setElevatorStop(m, id, st.id, c.stops[st.id] === false ? 'skip' : 'stop')
        setElevatorLanding(m, id, st.id, c.faces[st.id] ?? 0)
      }
    }
    // 이어 놓은 연결(OE-ML-19 AC8)을 새 구간의 조각에 적는다. 시작점 고정은 시작 층 조각, 끝점 고정은 끝 층 조각이다.
    if ('id' in r && c.link) {
      const part = m.storeys.find((st) => st.id === (c.link!.kind === 'start' ? c.from : c.to))?.verticalParts?.find((p) => p.parentId === id)
      if (part && c.link.kind === 'start') part.continuesFrom = c.link.to
      if (part && c.link.kind === 'end') part.continuesTo = c.link.to
    }
    return 'id' in r
  })
  if (!done) {
    if (refused) editNotice.value = refused
    return
  }
  verticalCreate.value = null
  rangeGiven.value = new Map()
  selectVertical(partId(id, c.from))
  note(`${VERTICAL_KIND_LABEL[c.kind]} ${c.name.trim()}${josa(c.name.trim(), '을/를')} 만들었습니다. Ctrl+Z 로 되돌립니다`)
}
export function removeSelectedVertical() {
  const v = selectedVertical.value
  if (!v) return
  const name = v.part.name || v.label
  if (changeVerticals(`${name} 지우기`, (m) => deleteVertical(m, v.object.id))) {
    selectedVerticalId.value = null
    note(`${v.label} ${shortName(name)}${josa(shortName(name), '을/를')} 지웠습니다. 계단실 같은 물리존은 그대로입니다. Ctrl+Z 로 되돌립니다`)
  }
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupVerticalCreate() {
  watch(selectedVerticalId, (now, was) => {
    // 같은 오브젝트의 다른 층 조각으로 옮겨 가면 고르던 구간을 둔다.
    if (now && was && now.split('@')[0] === was.split('@')[0]) return
    rangeDraft.value = null
    rangeGiven.value = new Map()
  })
  // 계단·ES 는 시작 층을 바꾸면 끝 층이 그 바로 위층으로 따라간다. 찍은 시작점은 그 층 바닥의 점이라 비운다.
  watch(
    () => verticalCreate.value?.from,
    (from, was) => {
      const c = verticalCreate.value
      if (!c || !from || from === was || !model.value) return
      if (flightKind(c.kind)) c.to = storeyAbove(model.value, from)?.id ?? from
      if (placesByPoint(c.kind)) {
        c.at = null
        c.link = null
      }
    },
  )
  // ES 운행 방향을 바꾸면 이어 놓은 연결이 풀린다 — 같은 방향끼리만 잇는다(OE-ML-11 AC6). 고정한 자리도 비운다.
  watch(
    () => verticalCreate.value?.direction,
    (now, was) => {
      const c = verticalCreate.value
      if (!c || !now || now === was || !c.link) return
      c.link = null
      c.at = null
      note('운행 방향을 바꿔 이어 놓은 연결이 풀렸습니다. 같은 방향 구간에 다시 붙입니다')
    },
  )
  // 찍는 동안 시작 층 위를 걷는다(applyStoreyFilter). 위의 watch 들보다 뒤에 선언되어 여기서 건다.
  watch(placingVertical, applyStoreyFilter)
  watch(placingRangeAt, applyStoreyFilter)
  watch(createDraft, (d) => {
    if (!verticalCreate.value || !placesByPoint(verticalCreate.value.kind)) return
    rangeGiven.value = d && !('refused' in d) ? new Map(d.given) : new Map()
  })
  watch(multiView, (v) => {
    if (!v) cancelCreateVertical()
  })
}
