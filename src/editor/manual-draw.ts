import { computed, nextTick, ref, triggerRef, watch } from 'vue'
import { boxAlong, boxAt } from '../lib/conduit-mesh'
import { type Snapshot, snapshotHvacZones } from '../lib/edit'
import { flowType } from '../lib/flow-type'
import { createZoneFromSpaces } from '../lib/hvac-zone'
import { drawPipe } from '../lib/manual-pipe'
import { type Equipment, isConduit, type Model, segmentRest } from '../lib/model'
import { removalImpact } from '../lib/removal-impact'
import type { PathPoint } from '../lib/storey-z'
import { setEditPart } from './ceiling'
import { nameOfId } from './connections'
import { editing, mode, model } from './core'
import { railPanel } from './shell'
import { captureBase, placeStretched, shortName } from './equipment-shape'
import { equipmentById, flowVersion, ruleReport, selected, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { storeyOf } from './multi-select'
import { meshes } from './open-file'
import { redraw, sceneVersion } from './redraw'
import { askStorey, targetStorey } from './space-edit'

// --- 수동 공조존 (OE-ZON-01·02, hvac-zone.ts) ------------------------------------------------------
// R1 에서 공조존을 만드는 유일한 길이다. 물리존을 골라 합집합으로 만들거나(ZON-01), 한 물리존을 나눌 때 경계를 그린다(ZON-02).
// 담당 설비는 존마다 고르고, TTL 에서 그 설비가 존을 feeds 한다(계통도의 서비스 영역).

/** 층 하나의 사람이 만든 공조존 목록을 바꾼다. 되돌리기는 그 층 목록 통째다. */
export function changeHvacZones(storeyId: string, label: string, apply: (m: Model) => unknown, coalesce?: string): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotHvacZones(m, storeyId)
  const at = mark()
  const done = apply(m)
  if (!done) return false
  if (typeof done === 'object' && 'refused' in (done as object)) {
    note((done as { refused: string }).refused)
    return false
  }
  remember(label, snapshot, at, coalesce)
  triggerRef(model)
  sceneVersion.value++
  return true
}
/** 공조존 도구가 다루는 층. 층 하나만 보는 중이거나 고른 것의 층이다. */
export const zoneStorey = computed(() => (model.value ? targetStorey() : null))
/**
 * 공조존 생성 방법(OE-BIM-15). R1 은 직접 만들기(Case 3)만 있다 — 편집으로 들어가 공간 편집 모드에서 공조존 칸을 펼쳐 보인다.
 * IDF·gbXML 추가로 가져오기(Case 1·2)는 R2 에서 같은 자리에 더한다. 아무것도 바꾸지 않으니 나중에 만들어도 임포트 결과는 그대로다.
 */
export const zoneReveal = ref(false)
export async function startManualZones() {
  if (!editing.value) mode.value = 'edit'
  await nextTick()
  if (!editing.value) return
  setEditPart('space')
  // 공조존 칸은 레일의 펼침 칸(RailPanel)에 있다. 기준 · 검증 패널은 보기만 한다(2026-10-16).
  railPanel.value = 'hvac'
  zoneReveal.value = true
  await nextTick()
  zoneReveal.value = false
  note(zoneStorey.value ? `공조존 도구입니다 — ${zoneStorey.value.name}에서 담당 물리존을 골라 만들거나 경계를 그립니다` : '공조존 도구입니다 — 층 하나를 고른 뒤 담당 물리존을 골라 만듭니다')
}
/** 그 층의 사람이 만든 공조존. */
export const zonesHere = computed(() => {
  void sceneVersion.value
  // 모델을 다시 읽고 새 배열로 돌려준다. 층 객체나 같은 배열을 붙잡으면 공조존을 더해도 목록이 다시 그려지지 않는다.
  const m = model.value
  const id = zoneStorey.value?.id
  return [...(m?.storeys.find((s) => s.id === id)?.hvacZones ?? [])]
})
/** 물리존을 골라 만들 때 체크한 물리존 id. 층이 바뀌면 비운다. */
export const zonePick = ref<string[]>([])
export function makeZoneFromPick() {
  const storey = zoneStorey.value
  if (!storey) return askStorey('공조존을 만들')
  const ids = [...zonePick.value]
  if (changeHvacZones(storey.id, '공조존 만들기', (m) => createZoneFromSpaces(m, { spaceIds: ids }))) {
    zonePick.value = []
    note('공조존을 만들었습니다. 담당 설비를 고르세요')
  }
}
// --- 수동 배관 그리기 (OE-PIP-11, manual-pipe.ts) ---------------------------------------------------
// 고른 설비에서 끝 대상(설비·배관)까지. 끝·Flow Type·계통을 패널에서 고르고 [곧게 연결하기] 또는 꺾임점을 찍어 Enter.

/** 패널의 배관 그리기 칸. 고른 설비가 바뀌면 끝 대상만 비운다(Flow Type·계통은 이어서 쓴다). */
export const pipeDraft = ref<{ to: string; flowType: string; systemId: string }>({ to: '', flowType: 'SA', systemId: 'auto' })
/** 끝으로 고를 수 있는 것: 같은 층의 좌표 있는 설비·배관, 가까운 순 40개. */
export const pipeTargets = computed(() => {
  void sceneVersion.value
  const e = selected.value
  const home = e ? storeyOf(e.id) : null
  if (!e?.position || !home) return []
  const p = e.position
  return home.equipment
    .filter((x) => x.id !== e.id && !!x.position)
    .map((x) => ({ id: x.id, name: shortName(x.name), d: Math.hypot(x.position![0] - p[0], x.position![1] - p[1], x.position![2] - p[2]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 40)
})
/** 그린 배관의 굵기(m). 덕트는 굵게, 물·냉매·증기 배관은 가늘게 그린다. 보여 주기용이고 내보내지 않는다. */
const drawnSize = (e: Equipment) => (flowType(e.flowType)?.medium === 'air' ? 0.3 : 0.08)
/**
 * 그린 배관의 3D 형상이 없으면 만든다. 그린 직후와 편집 파일·자동 저장을 다시 얹은 뒤에 부른다. 끝을 늘인 구간은 늘이기 전 형상을
 * 만들어 두고 BIM 구간과 같은 길(placeStretched)로 늘인다.
 */
export function ensureDrawnMeshes() {
  for (const e of model.value?.storeys.flatMap((st) => st.equipment) ?? []) {
    if (!e.flowType || meshes.has(e.id) || !e.position) continue
    if (e.role === 'fitting') meshes.set(e.id, boxAt(e.position, drawnSize(e) * 1.4))
    else if (e.role === 'segment') {
      const rest = segmentRest(e)
      if (!rest) continue
      meshes.set(e.id, boxAlong(rest.ends[0], rest.ends[1], drawnSize(e)))
      if (e.endShift?.some((v) => v.some((x) => x !== 0)) && captureBase(e.id, rest.at)) placeStretched(e.id)
    }
  }
}
/** 배관을 그린다. 그렸으면 true. `range` 는 다중층 뷰의 보기 범위다(층간 배관, OE-ML-12). */
export function makePipe(via: PathPoint[], fromId = selectedId.value, range?: string[]): boolean {
  const m = model.value
  const from = fromId ? (equipmentById.value.get(fromId) ?? null) : null
  const d = pipeDraft.value
  if (!m || !from) return false
  if (!d.to) {
    note('끝 대상을 먼저 고르세요')
    return false
  }
  const at = mark()
  const done = drawPipe(m, { from: from.id, to: d.to, via, flowType: d.flowType, systemId: d.systemId === 'auto' ? undefined : d.systemId === 'none' ? null : d.systemId, range })
  if ('refused' in done) {
    note(done.refused)
    return false
  }
  const made = [...done.segments, ...done.fittings]
  // 되돌리면 새로 생긴 것이 연결·계통 자리와 함께 한 번에 빠진다. 층간 배관은 구간마다 층이 다르다.
  const snapshot: Snapshot = {
    kind: 'many',
    parts: made.map((equipment) => ({ kind: 'equipment-set', equipment, storeyId: done.storeyOf.get(equipment.id)!, index: 0, present: false, connections: [], systems: [] })),
  }
  remember(`${d.flowType} 배관 그리기 (구간 ${done.segments.length}개)`, snapshot, at)
  ruleReport.value = done.rules
  ensureDrawnMeshes()
  triggerRef(model)
  flowVersion.value++
  redraw()
  const storeys = new Set(done.storeyOf.values()).size
  note(
    `${d.flowType} 배관을 그렸습니다: 구간 ${done.segments.length}개 · 이음쇠 ${done.fittings.length}개 · ${done.length.toFixed(2)}m${storeys > 1 ? ` · ${storeys}개 층` : ''}. 흐름 방향은 아직 정하지 않았습니다`,
  )
  return true
}
/**
 * 고른 덕트·배관 조각을 지우면 연결망이 어떻게 갈라지나(OE-PIP-10, removal-impact.ts). 지우기 버튼 위에 실행 전에 보인다.
 * 기기 이름은 갈래마다 셋까지.
 */
export const selectedImpact = computed(() => {
  void sceneVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || !editing.value || !isConduit(e.role)) return null
  const impact = removalImpact(m, e.id)
  if (!impact) return null
  if (impact.pieces.length === 0) return '이어진 것이 없는 조각입니다.'
  if (impact.pieces.length === 1) return '지워도 갈라지는 기기가 없습니다(끝에 매달렸거나 다른 길로 이어져 있음).'
  const side = (p: (typeof impact.pieces)[number]) =>
    p.devices.length
      ? `${p.devices.slice(0, 3).map((id) => nameOfId(id)).join(', ')}${p.devices.length > 3 ? ` 외 ${p.devices.length - 3}대` : ''} 쪽(기기 ${p.devices.length}대)`
      : `기기 없는 배관 ${p.conduits}개`
  return `지우면 연결망이 ${impact.pieces.length}갈래로 나뉩니다: ${impact.pieces.map(side).join(' / ')}. 다른 분기의 연결은 그대로입니다.`
})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupManualDraw() {
  watch(zoneStorey, () => (zonePick.value = []))
  watch(selectedId, () => (pipeDraft.value = { ...pipeDraft.value, to: '' }))
}
