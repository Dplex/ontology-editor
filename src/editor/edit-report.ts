import { computed, nextTick, ref, shallowRef, triggerRef } from 'vue'
import { ceilingGuess, ceilingOf, FLOOR_BAND, judgeAll, type Judged, judgeSurface, outsideAllowed, setCeiling, setEquipmentSurface } from '../lib/ceiling'
import { type BoundaryChange, type Change, snapshotEquipment, summarize } from '../lib/edit'
import { exteriorDevices } from '../lib/exterior'
import { conduitFlowType, flowType, setConduitFlowType } from '../lib/flow-type'
import { type Equipment, isConduit, type Storey } from '../lib/model'
import { type Surface, SURFACE_LABEL } from '../lib/mount'
import { pausedInReplay } from '../lib/replay-player'
import { type StoreyHeight, storeyHeights } from '../lib/storey-height'
import { autosaveArmed, progressVersion, setAutosaveArmed } from './autosave'
import { systemById } from './checks'
import { nameOfId } from './connections'
import { model } from './core'
import { shortName } from './equipment-shape'
import { equipmentById, selected } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { areaChanges, storeyOf } from './multi-select'

// --- 편집 -------------------------------------------------------------------
//
// 편집은 모델을 그 자리에서 고친다. shallowRef 는 안쪽 변화를 못 보므로 편집한 뒤에
// triggerRef 로 알린다. 모델을 통째로 복사하면 3D 가 매번 다시 만들어진다.
// 바뀐 것 목록은 늘 새 배열로 갈아 끼우고 원소를 고치지 않는다. 깊은 ref 면 리포트를 셀 때마다 쌓인 원소 하나하나에 프록시를 씌운다.
export const changes = shallowRef<Change[]>([])
export const report = computed(() => summarize(changes.value))

// 넓이는 편집할 때마다 조금씩 움직인다. 매번 한 줄씩 쌓지 말고 처음과 끝만 적는다.
export const areaLines = computed(() => {
  const first = new Map<string, BoundaryChange>()
  for (const c of areaChanges.value) if (!first.has(c.spaceId)) first.set(c.spaceId, c)

  const parts: string[] = []
  for (const [spaceId, start] of first) {
    const now = areaChanges.value.filter((c) => c.spaceId === spaceId).at(-1)!
    if (Math.abs(now.toAreaM2 - start.fromAreaM2) < 0.005) continue
    parts.push(`${start.spaceName} ${start.fromAreaM2.toFixed(1)}㎡ → ${now.toAreaM2.toFixed(1)}㎡`)
  }
  return parts
})
export const areaSummary = computed(() => areaLines.value.join(' · '))
/** 넓이가 처음과 달라진 물리존(위 `areaLines` 와 같은 기준). 오브젝트 변경 표시(OE-UI-22)가 쓴다. */
export const areaChangedSpaceIds = computed(() => {
  const first = new Map<string, BoundaryChange>()
  const last = new Map<string, BoundaryChange>()
  for (const c of areaChanges.value) {
    if (!first.has(c.spaceId)) first.set(c.spaceId, c)
    last.set(c.spaceId, c)
  }
  return [...first].filter(([id, start]) => Math.abs(last.get(id)!.toAreaM2 - start.fromAreaM2) >= 0.005).map(([id]) => id)
})

// 층의 벽 두께 종류를 한 줄로 요약한다. 값이 여럿이면 내벽과 외벽이 섞인 것이다.
export const wallThicknessOf = (storey: { walls: { thickness: number | null }[] }) => {
  const values = [...new Set(storey.walls.map((w) => w.thickness).filter((t): t is number => t !== null))]
  return values.sort((a, b) => a - b).map((t) => `${(t * 1000).toFixed(0)}mm`).join('/')
}

// 층고(OE-BIM-02). BIM 이 적었으면 그 값, 아니면 윗층 바닥과의 차. 맨 위층이고 BIM 이 안 적었으면 모름이다.
export const storeyHeightOf = computed(() => (model.value ? storeyHeights(model.value.storeys) : new Map<string, StoreyHeight | null>()))
/** 미터. 단위 선언이 틀린 파일(Duplex COBie 는 층고가 3.1mm 로 들어온다)이 0.00 으로 뭉개지지 않게 작은 값은 유효 숫자로 보인다. */
export const meters = (v: number) => `${Math.abs(v) >= 0.1 ? v.toFixed(2) : v.toPrecision(2)} m`
export const storeyHeightTitle = (h: StoreyHeight) =>
  [
    h.source === 'bim' ? `BIM ${h.property}` : '윗층 바닥 높이와의 차',
    h.source === 'bim' ? (h.calc !== null ? `계산(윗층 바닥과의 차) ${meters(h.calc)}` : '윗층이 없어 계산할 수 없음') : null,
    h.net !== null ? `순 높이(BIM, 윗층 바닥판 아래까지) ${meters(h.net)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

// 반자 높이 h_c(OE-EQP-03). BIM 값이 있으면 그것, 사람이 정했으면 그 값, 둘 다 없으면 모름이다 — 0 이나 층고로 채우지 않는다.
// 반자 부착 설비의 z 로 짐작한 후보(계산)는 입력창 기본값과 참고로만 보인다.
export const ceilingGuessOf = computed(() => {
  const out = new Map<string, { height: number; count: number } | null>()
  for (const s of model.value?.storeys ?? []) out.set(s.id, ceilingGuess(s, storeyHeightOf.value.get(s.id)?.value ?? null))
  return out
})
export const ceilingTitle = (s: Storey) => {
  const c = ceilingOf(s)
  const guess = ceilingGuessOf.value.get(s.id)
  return [
    c?.source === 'bim' ? `BIM ${c.property} — 방·천장재 ${c.count}개의 가운데 값` : c ? '직접 정한 값' : 'BIM 에 천장고가 없습니다',
    s.ceilingSet != null && s.ceiling ? `BIM 값 ${meters(s.ceiling.height)} (${s.ceiling.property})` : null,
    guess ? `후보 ${meters(guess.height)} — 반자 부착 설비 ${guess.count}대의 높이 가운데 값(계산, 값으로 치지 않음)` : null,
  ]
    .filter(Boolean)
    .join('\n')
}
/** BIM 값과 후보가 0.3m 넘게 다르면 보인다. 층 하나에 반자 높이 하나라 방마다 다른 층(성수 지하)에서 벌어진다. */
export const ceilingGuessApart = (s: Storey) => {
  const c = ceilingOf(s)
  const g = ceilingGuessOf.value.get(s.id)
  return !!c && !!g && Math.abs(c.height - g.height) > 0.3
}
export const ceilingEditing = ref<string | null>(null)
export const ceilingInput = ref('')
export function startCeiling(storeyId: string) {
  const s = model.value?.storeys.find((x) => x.id === storeyId)
  if (!s) return
  ceilingEditing.value = storeyId
  const v = ceilingOf(s)?.height ?? ceilingGuessOf.value.get(storeyId)?.height
  ceilingInput.value = v === undefined ? '' : String(v)
  void nextTick(() => document.querySelector<HTMLInputElement>('.ceiling-input')?.select())
}
export function saveCeiling(storeyId: string, value: number | null) {
  const m = model.value
  const s = m?.storeys.find((x) => x.id === storeyId)
  if (!m || !s) return
  if (value !== null) {
    const top = storeyHeightOf.value.get(storeyId)?.value ?? null
    if (!Number.isFinite(value) || value <= FLOOR_BAND) return note(`천장고는 ${FLOOR_BAND}m 보다 높아야 합니다.`)
    if (top !== null && value >= top) return note(`천장고는 층고(${meters(top)})보다 낮아야 합니다.`)
  }
  ceilingEditing.value = null
  if (!setCeiling(m, storeyId, value)) return
  progressVersion.value++
  setAutosaveArmed(true)
  triggerRef(model)
  const c = ceilingOf(s)
  note(c ? `${s.name} 층의 천장고를 ${meters(c.height)}로 정했습니다${c.source === 'bim' ? '(BIM 값)' : ''}.` : `${s.name} 층의 천장고를 지웠습니다(모름).`)
}

/** 설비의 설치면을 사람이 정한다(OE-EQP-05). null 이면 지워 z 판정으로 돌아간다. 되돌리기에 쌓인다. */
export function setSurfaceOf(id: string, surface: Surface | null) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotEquipment(m, id)
  const at = mark()
  const done = setEquipmentSurface(m, id, surface)
  if (done !== true) {
    if (done) note(done.refused)
    return
  }
  const name = shortName(nameOfId(id))
  remember(surface ? `${name} 설치면 ${SURFACE_LABEL[surface]}` : `${name} 설치면 판정으로`, snapshot, at)
  triggerRef(model)
  note(surface ? `${name}의 설치면을 ${SURFACE_LABEL[surface]}으로 정했습니다` : `${name}의 설치면을 z 판정으로 되돌렸습니다`)
}

/**
 * BIM 덕트·배관 구간의 Flow Type 을 사람이 정한다(OE-PIP-14). null 이면 지워 계통 종류·유체로 계산한 값으로 돌아간다. 되돌리기에 쌓인다.
 * 계통 하나에 공급·환수가 섞여 계산으로 가르지 못한 배관을 사람이 가른다.
 */
function setFlowTypeOf(id: string, code: string | null) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotEquipment(m, id)
  const at = mark()
  const done = setConduitFlowType(m, id, code)
  if (done !== true) {
    if (done) note(done.refused)
    return
  }
  const name = shortName(nameOfId(id))
  remember(code ? `${name} Flow Type ${code}` : `${name} Flow Type 계산으로`, snapshot, at)
  triggerRef(model)
  note(code ? `${name}의 Flow Type 을 ${code}(${flowType(code)?.label})로 정했습니다 (GeoJSON flowType)` : `${name}의 Flow Type 을 계통으로 계산한 값으로 되돌렸습니다`)
}
/** 패널의 Flow Type 칸. 막히면 칸을 지금 값으로 되돌린다 — 고른 값이 남으면 바뀐 것처럼 보인다. */
export function onFlowTypePick(id: string, select: HTMLSelectElement) {
  setFlowTypeOf(id, select.value || null)
  select.value = equipmentById.value.get(id)?.flowTypeSet ?? ''
}
/** 고른 덕트·배관의 Flow Type: 지금 값과, 사람이 고른 것을 뺀 계산 값. */
export const selectedFlowType = computed(() => {
  void model.value
  const e = selected.value
  if (!e || !isConduit(e.role)) return null
  const systemOf = (id: string) => systemById.value.get(id)
  return { now: conduitFlowType(e, systemOf), calc: conduitFlowType({ ...e, flowTypeSet: undefined }, systemOf) }
})
export const flowTypeText = (code: string | null | undefined) => (code ? `${code} ${flowType(code)?.label ?? ''}` : '')

// 설치면 판정(OE-EQP-03). z(층 바닥 기준)로 판정하고, 허용 설치면 밖이면 목록에 올린다(Q9).
export const JUDGED_LABEL: Record<Judged, string> = { ...SURFACE_LABEL, plenum: '천장(플레넘)' }
export const surfaceRows = pausedInReplay(() => (model.value ? judgeAll(model.value, (id) => storeyHeightOf.value.get(id)?.value ?? null) : []))
export const surfaceCounts = computed(() => {
  const c = { ceiling: 0, plenum: 0, floor: 0, wall: 0, unknown: 0 }
  for (const r of surfaceRows.value) c[r.judged ?? 'unknown']++
  return c
})
export const surfaceMismatch = computed(() => surfaceRows.value.filter((r) => outsideAllowed(r.equipment.kind, r.judged)))
export const selectedJudged = computed(() => {
  const e = selected.value
  const st = e ? storeyOf(e.id) : null
  if (!e || !st) return null
  const judged = judgeSurface(e, st, storeyHeightOf.value.get(st.id)?.value ?? null)
  return { judged, z: e.position ? e.position[2] - st.elevation : null, outside: outsideAllowed(e.kind, judged), hc: ceilingOf(st) }
})

export const wallThicknessLabel = (storey: { walls: { thickness: number | null }[] }) => {
  const kinds = wallThicknessOf(storey).split('/').filter(Boolean)
  return kinds.length <= 2 ? kinds.join('/') : `두께 ${kinds.length}종`
}

// 외벽 설비(OE-EQP-15). 방 밖이 맞는 자리라 소속을 "외벽" 으로 보인다(TTL 은 층까지만 나간다).
export const exteriorIds = computed(() => (model.value ? exteriorDevices(model.value) : new Set<string>()))
export const locationOf = (e: Equipment) => (e.spaceId ? spaceNameOf(e.spaceId) : exteriorIds.value.has(e.id) ? '외벽 (층까지만)' : '(소속 없음)')
/**
 * 리포트의 소속 자리. 물리존이 없으면 TTL 이 그렇듯 층까지만이라고 적는다 — 외곽선 없는 물리존에 외곽선을 그리면 그 안 설비가
 * "(1F 층까지만) → 사무실" 로 남는다(OE-MAN-03).
 */
export const reportPlace = (spaceId: string | null, equipmentId: string) => {
  if (spaceId) return spaceNameOf(spaceId)
  const storey = storeyOf(equipmentId)
  return storey ? `(${storey.name} 층까지만)` : '(소속 없음)'
}
export const spaceNameOf = (spaceId: string | null) => {
  if (!model.value || !spaceId) return '(소속 없음)'
  for (const storey of model.value.storeys) {
    const space = storey.spaces.find((s) => s.id === spaceId)
    if (space) return space.longName || space.name
  }
  return spaceId
}
