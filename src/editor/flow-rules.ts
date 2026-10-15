import { computed, ref, shallowRef, watch } from 'vue'
import { applyFlow, clearFlow, snapshotRelease, snapshotRules } from '../lib/connection-release'
import { cascadeWaves, exportedFlows, flowBasis, flowChanges, type FlowSnapshot, reviewKeys } from '../lib/flow-cascade'
import { flowReviews } from '../lib/flow-review'
import { confirmSystemFlow, inferFlowByRules, type RuleReport, withInferred } from '../lib/flow-rules'
import { systemKind } from '../lib/kinds'
import { type Connection, type Equipment, isConduit } from '../lib/model'
import { type Neighbor, neighbors, trace } from '../lib/topology'
import { type Arrow, arrowColors } from '../lib/viewer'
import type { SrcKind } from '../components/Src.vue'
import { systemById, whatIs } from './checks'
import { nameOfId } from './connections'
import { dark, editing, model } from './core'
import { shortName } from './equipment-shape'
import { systemColor } from './flow-map'
import { mark, remember } from './history'
import { note } from './keyboard'
import { selectedSystem } from './kinds'
import { editNotice, storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { sceneVersion } from './redraw'
import { viewer } from './scene'

// --- 선택과 연결 -------------------------------------------------------------
export const selectedId = ref<string | null>(null)

export const equipmentById = computed(() => {
  const map = new Map<string, Equipment>()
  for (const storey of model.value?.storeys ?? []) for (const e of storey.equipment) map.set(e.id, e)
  return map
})

export const selected = computed(() => (selectedId.value ? (equipmentById.value.get(selectedId.value) ?? null) : null))

// 방향 모름은 다음 기기에서 멈춘다(topology.ts 의 trace). 끝까지 따라가면 성수 FCU 하나가 순환수관을
// 타고 다른 FCU 들의 덕트까지 번져 1만 개가 넘게 "이어짐" 이 된다. 연결 끝이 설비 목록에 없으면 기기로 본다.
export const conduitId = (id: string) => {
  const e = equipmentById.value.get(id)
  return !!e && isConduit(e.role)
}
/** "이어짐" 중 덕트·배관이 아닌 기기 수. 수천 개여도 대부분은 관이라 기기 수를 따로 말한다. */
export const deviceCount = (ids: Set<string>) => [...ids].filter((id) => !conduitId(id)).length

export const traced = computed(() =>
  model.value && selectedId.value ? trace(model.value.connections, selectedId.value, conduitId) : null,
)

// --- 규칙 방향 -----------------------------------------------------------------
//
// 포트가 방향을 말하지 않은 연결에 계통·설비 종류로 정한 방향(flow-rules.ts). **첫 줄의 상류·하류는
// 포트 기준 그대로 둔다** — BIM 이 말한 것과 우리가 정한 것을 한 숫자에 섞으면 검토하는 사람이
// 구별할 수 없다. 규칙을 넣은 숫자는 한 줄 아래에 따로 보이고, 3D 에 칠할지는 사람이 고른다.
export const ruleReport = shallowRef<RuleReport | null>(null)
export const showRules = ref(true)
export const confirmations = ref<{ systemName: string; count: number }[]>([])
// 확정은 연결의 `inferred.confirmed` 만 바꾼다. **모델 전체에 갱신 신호(triggerRef)를 보내지 않는다** —
// 그러면 3D 가 설비 수만큼 통째로 다시 만들어져 성수(1만 8천 개)에서 화면이 30초 넘게 멈췄다.
// 확정에 따라 바뀌는 칸(계통 현황, 등급 칩)만 이 값을 읽어 다시 계산한다.
export const flowVersion = ref(0)
// 사람이 정한 방향도 규칙 방향과 같은 자리(추적·3D 의 옅은 색)에 들어간다. 규칙이 하나도 없는 파일에서
// 사람이 방향을 정해도 추적에 보여야 하므로 둘 다 본다.
export const hasRules = computed(() => {
  void flowVersion.value
  return !!model.value?.connections.some((c) => c.inferred || c.edited)
})

export const tracedRules = computed(() => {
  void flowVersion.value
  return model.value && selectedId.value && hasRules.value
    ? trace(withInferred(model.value.connections), selectedId.value, conduitId)
    : null
})
/** 3D 에 칠하는 추적. 규칙을 켜 두면 규칙 방향까지 따라간다. */
export const tracedShown = computed(() => (showRules.value && tracedRules.value ? tracedRules.value : traced.value))

/** 고른 설비가 속한 계통의 규칙 방향 현황. 확정 버튼 옆에 근거로 보인다. */
export const selectedRule = computed(() => {
  void flowVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e) return null
  // 설비 자신의 계통이 먼저고, 없으면(원천 기기는 계통 밖인 일이 흔하다) 붙은 연결의 규칙 계통을 쓴다.
  const touching = m.connections.filter((c) => c.inferred && (c.from === e.id || c.to === e.id))
  const systemId = e.systemId && ruleReport.value?.bySystem[e.systemId] ? e.systemId : touching[0]?.inferred?.systemId
  if (!systemId) return null
  const system = systemById.value.get(systemId)
  const tally = ruleReport.value?.bySystem[systemId]
  const own = m.connections.filter((c) => c.inferred?.systemId === systemId)
  const checked = tally ? tally.agree + tally.disagree : 0
  const recheck = own.filter((c) => c.inferred!.recheck !== undefined).length
  const members = new Set(system?.memberIds ?? [])
  return {
    systemId,
    name: system?.name || systemId,
    kind: systemKind(system?.kind)?.label ?? '',
    count: own.length,
    confirmed: own.length > 0 && own.every((c) => c.inferred!.confirmed) && recheck === 0,
    recheck,
    agree: tally?.agree ?? 0,
    disagree: tally?.disagree ?? 0,
    // 원천을 못 찾은 계통은 규칙이 돌지 않아 채점표가 없다. 그 계통에 닿은 포트 방향 연결이 전부 추정 불가다.
    unestimated: tally?.unestimated ?? m.connections.filter((c) => c.directed && (members.has(c.from) || members.has(c.to))).length,
    checked,
    pct: checked > 0 ? Math.round(((tally?.agree ?? 0) / checked) * 100) : null,
  }
})

/**
 * 유체 흐름이 아니라 검토 대상인 연결의 열쇠(flow-cascade.ts 의 reviewKeys). 모델 전체를 훑어 성수 기계에서 130ms 가 걸려서 편집마다 한 번만
 * 세고 근거 패널·연쇄가 같이 쓴다. 종류를 바꾸면 flowVersion 이 오르고, 연결을 더하거나 지우면 모델 신호가 온다.
 */
const flowReviewKeys = computed(() => {
  void flowVersion.value
  return model.value ? reviewKeys(model.value) : new Set<string>()
})
/** 고른 설비 계통의 흐름 방향 근거(flow-cascade.ts) — BIM 포트 → 규칙 → 사람 → brick:feeds 세 줄과 결과. */
export const selectedFlowBasis = computed(() => {
  void flowVersion.value
  const m = model.value
  const r = selectedRule.value
  if (!m || !r) return null
  return flowBasis(m, r.systemId, new Set(systemById.value.get(r.systemId)?.memberIds ?? []), flowReviewKeys.value)
})
/** 고른 계통 패널의 같은 근거. */
export const selectedSystemBasis = computed(() => {
  void flowVersion.value
  const m = model.value
  const s = selectedSystem.value
  return m && s ? flowBasis(m, s.id, new Set(s.memberIds), flowReviewKeys.value) : null
})

/**
 * 규칙 방향이 선 계통 전부. 확정은 고른 설비의 패널에서만 할 수 있어서, 어느 계통이 남았는지 보려면 계통마다 설비를
 * 하나씩 찾아 골라야 했다. 재검토가 있는 것, 확정 안 한 것, 규칙 방향이 많은 것 순으로 둔다. 일치율은 그 계통에서 포트가
 * 이미 말한 연결에 같은 규칙을 대 본 값이다(확정한 계통도 규칙을 다시 돌려 잰다, OE-PIP-07).
 */
export const ruleSystems = computed(() => {
  void flowVersion.value
  const m = model.value
  const r = ruleReport.value
  if (!m) return []
  const bySystem = new Map<string, { count: number; confirmed: number; recheck: number }>()
  for (const c of m.connections) {
    if (!c.inferred) continue
    const row = bySystem.get(c.inferred.systemId) ?? { count: 0, confirmed: 0, recheck: 0 }
    row.count++
    if (c.inferred.confirmed) row.confirmed++
    if (c.inferred.recheck !== undefined) row.recheck++
    bySystem.set(c.inferred.systemId, row)
  }
  return [...bySystem]
    .map(([id, n]) => {
      const system = systemById.value.get(id)
      const tally = r?.bySystem[id]
      const checked = tally ? tally.agree + tally.disagree : 0
      return {
        id,
        name: system?.name || id,
        kind: systemKind(system?.kind)?.label ?? '',
        color: systemColor.value.get(id) ?? null,
        count: n.count,
        confirmed: n.confirmed === n.count && n.recheck === 0,
        recheck: n.recheck,
        agree: tally?.agree ?? 0,
        checked,
        pct: checked > 0 ? Math.round(((tally?.agree ?? 0) / checked) * 100) : null,
      }
    })
    .sort((a, b) => b.recheck - a.recheck || Number(a.confirmed) - Number(b.confirmed) || b.count - a.count)
})

/**
 * 포트와 잘 맞는 계통을 한꺼번에 확정한다. 성수는 규칙이 방향을 준 계통이 348개라 하나씩 누르면 45초가 걸렸다.
 * 포트와 대 볼 연결이 BULK_MIN_CHECKED 개 이상 있고 일치율이 문턱 이상인 것만 고른다 — 대 볼 것이 없는 계통은
 * 맞는지 모르므로 사람이 3D 로 흐름을 보고 하나씩 확정한다. 되돌리기는 한 번이다.
 */
export const BULK_MIN_CHECKED = 20
export const bulkThreshold = ref(90)
export const bulkCandidates = computed(() =>
  ruleSystems.value.filter((r) => !r.confirmed && r.pct !== null && r.checked >= BULK_MIN_CHECKED && r.pct >= bulkThreshold.value),
)
export function confirmMatching() {
  const m = model.value
  const rows = bulkCandidates.value
  if (!m || !rows.length) return
  const before = exportedFlows(m)
  const snapshot = snapshotRules(m, rows.map((r) => r.id))
  const at = mark()
  const done: { systemName: string; count: number }[] = []
  for (const r of rows) {
    const n = confirmSystemFlow(m, r.id)
    if (n) done.push({ systemName: r.name, count: n })
  }
  if (!done.length) return
  remember(`계통 ${done.length}개 한꺼번에 확정(포트와 ${bulkThreshold.value}% 이상)`, snapshot, at)
  confirmations.value = [...confirmations.value, ...done]
  flowVersion.value++
  playFlowCascade(before)
  note(`계통 ${done.length}개, 규칙 방향 ${done.reduce((n, d) => n + d.count, 0)}개를 확정했습니다. brick:feeds 로 내보냅니다`)
}

/**
 * 확정·적용·해제로 TTL 에 나가는 흐름 방향이 바뀐 연결을 원천에서 가까운 순으로 3D 에 퍼뜨린다(flow-cascade.ts · viewer.ts 의 playCascade).
 * 평소 화살표는 고른 설비의 이웃뿐이라 계통 확정처럼 수백 개가 바뀐 것은 안 보였다. `before` 는 바꾸기 전에 뜬 exportedFlows 다.
 * 움직임을 끈 사람에게도 한꺼번에 띄운다 — 무엇이 brick:feeds 로 나가게 됐는지는 알아야 한다.
 */
function playFlowCascade(before: FlowSnapshot) {
  const m = model.value
  if (!m || !viewer) return
  const changed = flowChanges(before, m)
  if (!changed.length) return
  const waves = cascadeWaves(changed)
  viewer.playCascade(changed.map((c, i) => ({ ...c, wave: waves[i] })))
}

export function confirmRule(systemId: string, systemName: string) {
  if (!model.value) return
  const before = exportedFlows(model.value)
  const snapshot = snapshotRules(model.value, systemId)
  const at = mark()
  const n = confirmSystemFlow(model.value, systemId)
  if (n === 0) return
  // 재검토를 다시 확정하면 확정이 없어지는 연결이 있다(새로 정할 수 없게 된 것). 규칙을 다시 돌려 그 연결의 미확정 방향을 세운다.
  ruleReport.value = inferFlowByRules(model.value)
  remember(`계통 ${systemName} 확정`, snapshot, at)
  confirmations.value = [...confirmations.value, { systemName, count: n }]
  flowVersion.value++
  playFlowCascade(before)
}

// 바로 붙은 이웃. 몇 개인지보다 무엇에 붙어 있는지가 먼저 궁금한 자리다.
//
// 포트가 방향을 말하지 않은 연결에는 사람이 정한 방향, 없으면 규칙 방향을 같이 적는다. 방향의 출처가
// 셋(BIM 포트 · 편집 · 사전)이라 글자와 색을 다르게 둔다. 같은 "하류" 로 쓰면 규칙이 짐작한 것이
// BIM 이 말한 하류처럼 읽힌다.
type NeighborRow = Neighbor & {
  name: string
  what: { label: string; src: SrcKind } | null
  edited: 'upstream' | 'downstream' | null
  rule: { relation: 'upstream' | 'downstream'; confirmed: boolean; recheck: boolean } | null
  /** 유체 흐름이 아닌 BIM·사람 연결이면 그 까닭(OE-PIP-18). 지우지 않고 TTL feeds 에서만 뺀다. */
  review: string | null
}
export const selectedNeighbors = computed((): NeighborRow[] => {
  void flowVersion.value
  if (!model.value || !selectedId.value) return []
  const id = selectedId.value
  const reviews = new Map(flowReviews(model.value, (x) => shortName(nameOfId(x))).map((r) => [r.connection, r.reason]))
  return neighbors(model.value.connections, id).map((n) => {
    const c = n.connection
    const edited = !c.directed && c.edited ? (c.edited.from === id ? 'downstream' : 'upstream') : null
    const rule =
      !c.directed && !c.edited && c.inferred
        ? { relation: c.inferred.from === id ? ('downstream' as const) : ('upstream' as const), confirmed: c.inferred.confirmed, recheck: c.inferred.recheck !== undefined }
        : null
    return {
      ...n,
      edited,
      rule,
      review: reviews.get(c) ?? null,
      name: equipmentById.value.get(n.id)?.name || equipmentById.value.get(n.id)?.ifcClass || n.id,
      what: whatIs(equipmentById.value.get(n.id)),
    }
  })
})
/** 한 층만 보는 중에 다른 층에 있는 설비면 그 층 이름. 모든 층을 보면 null. */
export function otherFloor(id: string): string | null {
  if (!viewStorey.value) return null
  const home = storeyOf(id)
  return home && home.id !== viewStorey.value ? home.name : null
}
// 포트·사람·규칙 누구도 방향을 말하지 않은 연결은 '방향 미지정' 이다(OE-PIP-04). '연결' 로 두면 방향이 없다는 것이 안 읽힌다.
const REL_LABEL = { upstream: '상류', downstream: '하류', linked: '방향 미지정' } as const
export function relLabel(n: NeighborRow) {
  if (n.edited) return REL_LABEL[n.edited]
  if (n.rule) return `${REL_LABEL[n.rule.relation]}(${n.rule.recheck ? '재검토' : n.rule.confirmed ? '확정' : '추정'})`
  return REL_LABEL[n.relation]
}
export function relClass(n: NeighborRow) {
  if (n.edited) return [n.edited, 'edited']
  if (n.rule) return [`rule-${n.rule.relation}`]
  return [n.relation]
}

// 포트가 방향을 말하지 않은 연결에 사람이 방향을 정한다(OE-PIP-04). 'A → B' 를 고르면 먼저 **미리보기**다 — 모델은 그대로라
// TTL 에 나가지 않고, 표와 3D 화살표(점선 액센트)에만 보인다. [적용] 해야 연결에 남는다. 규칙 방향과 반대면 차이를 보이고 보정
// 사유를 받는다(connection-release.ts 의 applyFlow). 확정과 같은 이유로 모델 전체에 갱신 신호를 보내지 않고 flowVersion 만 올린다.
// shallowRef: ref 는 연결을 반응형 대리 객체로 감싸 모델의 연결과 === 로 견줄 수 없다.
export const flowDraft = shallowRef<{ connection: Connection; from: string } | null>(null)
export const flowReason = ref('')
/** 미리보기. from 이 null 이면 미리보기를 거둔다. */
export function previewFlow(c: Connection, from: string | null) {
  flowDraft.value = from === null ? null : { connection: c, from }
  flowReason.value = ''
  editNotice.value = ''
}
/** 방향 버튼의 이름. BIM 이름(NBS_S&PUKVentilation…#1144538)이 길어 버튼이 두세 줄 알약이 됐다. 앞을 자르고 끝의 번호는 남긴다. 전체는 title·미리보기에. */
export function flowLabel(id: string) {
  const name = nameOfId(id)
  if (name.length <= 18) return name
  const tail = name.match(/ #\d+$/)?.[0] ?? ''
  return `${name.slice(0, 18 - tail.length)}…${tail}`
}
/** 미리보기의 화살표 글. 이름은 짧게(같은 패밀리 이름이 길다). */
export function flowText(c: Connection, from: string) {
  const to = from === c.from ? c.to : c.from
  return `${nameOfId(from)} → ${nameOfId(to)}`
}
export function submitFlow() {
  const m = model.value
  const d = flowDraft.value
  if (!m || !d) return
  const c = d.connection
  const before = exportedFlows(m)
  const snapshot = snapshotRelease(m, c)
  const at = mark()
  const done = applyFlow(m, c, d.from, flowReason.value)
  if (done !== true) {
    editNotice.value = done.refused
    document.querySelector<HTMLElement>('[data-testid="flow-reason"]')?.focus()
    return
  }
  remember(`${flowText(c, d.from)} 방향 적용`, snapshot, at)
  flowDraft.value = null
  editNotice.value = ''
  flowVersion.value++
  playFlowCascade(before)
  note(`${flowText(c, d.from)} 방향을 적용했습니다. 규칙 방향보다 앞서고 확정 없이 brick:feeds 로 나갑니다`)
}
/** 수동 지정 해제. 규칙 방향이 있으면 그것으로, 없으면 방향 미지정으로 돌아간다. */
export function clearManualFlow(c: Connection) {
  const m = model.value
  if (!m || !c.edited) return
  const was = flowText(c, c.edited.from)
  const before = exportedFlows(m)
  const snapshot = snapshotRelease(m, c)
  const at = mark()
  if (!clearFlow(m, c)) return
  remember(`${was} 수동 지정 해제`, snapshot, at)
  flowDraft.value = null
  flowVersion.value++
  // 해제하면 확정한 규칙 방향으로 돌아가 반대로 뒤집히는 일이 있다. 그때만 퍼진다(나가다 빠진 것은 그리지 않는다).
  playFlowCascade(before)
}
// --- 3D 의 연결 화살표 ------------------------------------------------------------
//
// 편집 모드에서 고른 설비에 붙은 연결을 3D 에 화살표로 그린다. 색은 방향의 출처다 — 포트(BIM) 진하게,
// 사람이 정한 것은 액센트, 규칙(사전)은 옅은 점선, 모르는 것은 촉 없는 점선. 누르면 미리보기가 "이 설비에서 나감 → 들어옴 →
// 거둠" 으로 돈다(점선 액센트). 적용은 표의 [적용] 이다. 포트가 말한 방향은 누르지 못한다.
export const arrowConnections = computed((): Connection[] => {
  void flowVersion.value
  if (!editing.value || !model.value || !selectedId.value) return []
  return neighbors(model.value.connections, selectedId.value).map((n) => n.connection)
})
export function arrowOf(c: Connection, key: string, active: boolean): Arrow {
  const base = { key, a: c.from, b: c.to, active }
  if (c.directed) return { ...base, from: c.from, source: 'port' }
  if (flowDraft.value?.connection === c) return { ...base, from: flowDraft.value.from, source: 'preview' }
  if (c.edited) return { ...base, from: c.edited.from, source: 'edit' }
  if (c.inferred && showRules.value) return { ...base, from: c.inferred.from, source: 'rule' }
  return { ...base, from: null, source: 'none' }
}
/** 키보드([ ])로 짚은 연결의 자리. 연결 표(selectedNeighbors)와 같은 순서다. 설비를 바꾸면 풀린다. */
export const activeArrow = ref<number | null>(null)
export const arrowPalette = computed(() => arrowColors(dark.value))
export function cycleFlow(key: string) {
  const c = arrowConnections.value[Number(key)]
  const id = selectedId.value
  if (!c || !id) return
  if (c.directed) {
    editNotice.value = '포트(BIM)에 적힌 방향은 고칠 수 없습니다.'
    return
  }
  editNotice.value = ''
  const other = c.from === id ? c.to : c.from
  // 미리보기가 없으면 적용한 방향에서 출발한다. 적용한 방향을 다시 미리 볼 일은 없어서, 그 다음은 미리보기를 거두는 것이다.
  const now = flowDraft.value?.connection === c ? flowDraft.value.from : (c.edited?.from ?? null)
  previewFlow(c, now === null ? id : now === id ? other : null)
}
export const hasArrows = computed(() => arrowConnections.value.length > 0)

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupFlowRules() {
  watch([selectedId, editing], () => (flowDraft.value = null))
  watch([selectedId, editing], () => (activeArrow.value = null))
  watch([arrowConnections, showRules, sceneVersion, activeArrow, flowDraft], () => {
    viewer?.setArrows(arrowConnections.value.map((c, i) => arrowOf(c, String(i), i === activeArrow.value)))
  })
}
