import { computed, onBeforeUnmount, ref, triggerRef, watch } from 'vue'
import { createSystem, deleteSystem, renameSystem, setEquipmentSystem, setSystemKind, snapshotSystems } from '../lib/edit'
import { systemOwns } from '../lib/flow-cascade'
import type { FlowEdge } from '../lib/flow-pulse'
import { josa } from '../lib/josa'
import { type Fluid, FLUID_KINDS, fluidInfo, systemKind } from '../lib/kinds'
import { isConduit } from '../lib/model'
import { narrowOptions } from '../lib/options'
import { replayOpen } from '../lib/replay-player'
import { systemCandidates } from '../lib/system-suggest'
import { systemColors } from '../lib/viewer'
import type { SrcKind } from '../components/Src.vue'
import { baseline } from './changes'
import { openCheck, selectedSpaceInfluence, systemById } from './checks'
import { openRequirementRow } from './requirement-items'
import { connectFrom, connectTo } from './connections'
import { editing, model } from './core'
import { shortName } from './equipment-shape'
import { flowOpen, flowSystemRow } from './flow-map'
import { equipmentById, flowVersion, ruleReport, selected, selectedId, showRules, traced, tracedRules, tracedShown } from './flow-rules'
import { mark, remember } from './history'
import { selectedZone } from './idf-zones'
import { note } from './keyboard'
import { selectedSystem, selectedSystemId } from './kinds'
import { group } from './multi-select'
import { redraw, sceneVersion } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedSpace } from './space-objects'

// --- 계통 편집 (E8) ------------------------------------------------------------------------
//
// 설비의 계통 한 자리를 바꾸고(고른 설비 패널), 계통의 종류·유체를 고친다(범례에서 고른 계통 패널). 둘 다 규칙 방향의
// 재료라 edit.ts 가 규칙을 다시 돌린다. 계통 이름은 BIM 것이라 고치지 않는다(분야별 파일을 합칠 때 이름으로 맞춘다).
export const systemNameOf = (id: string | null) => (id ? systemById.value.get(id)?.name || id : '(계통 없음)')
/** 계통 종류와 유체를 한 말로. `순환수 공급 · 냉수`. */
export function systemKindText(kind: string | null | undefined, fluid: Fluid | null | undefined): string {
  const k = systemKind(kind)
  if (!k) return '모름'
  const f = FLUID_KINDS.includes(k.kind) ? fluidInfo(fluid) : null
  return f ? `${k.label} · ${f.label}` : k.label
}
/** 계통 상자의 목록. 이름순이고 종류를 붙인다 — 이름이 번호뿐인 계통(ifc4Mep 22개)도 무엇인지 보인다. */
export const systemOptions = computed(() =>
  (model.value?.systems ?? [])
    .map((s) => ({ id: s.id, label: `${s.name || '(이름 없음)'}${s.kind ? ` · ${systemKindText(s.kind, s.fluid)}` : ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true })),
)
/**
 * 계통이 많으면(성수 1,037개) 상자에서 찾기 어렵다. 이 수를 넘으면 찾기 칸을 붙인다. 찾기 칸은 목록만 줄이고, 고른 설비의
 * 지금 계통은 걸러도 남긴다 — 상자가 지금 값을 잃으면 첫 줄이 고른 것처럼 보인다.
 */
export const SYSTEM_FILTER_FROM = 30
const SYSTEM_SHOWN = 200
export const systemFilter = ref('')
export const filteredSystemOptions = computed(() => narrowOptions(systemOptions.value, systemFilter.value, selected.value?.systemId ?? null, SYSTEM_SHOWN))
export function pickSystem(event: Event, equipmentId: string) {
  const el = event.target as HTMLSelectElement
  el.blur()
  applySystem(equipmentId, el.value || null)
}
export function applySystem(equipmentId: string, to: string | null) {
  const m = model.value
  const e = equipmentById.value.get(equipmentId)
  if (!m || !e) return
  const snapshot = snapshotSystems(m, [e.systemId, to], [equipmentId])
  const at = mark()
  const rules = setEquipmentSystem(m, equipmentId, to)
  if (!rules) return
  remember(`${shortName(e.name)} 계통 → ${systemNameOf(to)}`, snapshot, at)
  ruleReport.value = rules
  triggerRef(model)
  flowVersion.value++
  redraw()
}
/**
 * 계통이 없는 고른 설비의 계통 후보(system-suggest.ts, ADR-0057). 근처에 구성원이 있는 계통을 거리 순으로 셋 보인다.
 * 누르면 계통 상자에서 고른 것과 같다(applySystem).
 */
const systemSuggest = computed(() => {
  void flowVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || !editing.value || e.systemId || isConduit(e.role) || !e.position) return []
  return systemCandidates(m, e.id)
})
export const systemChips = computed(() => systemSuggest.value.slice(0, 3))
export function setSystemKindTo(systemId: string, kind: string | null, fluid: Fluid | null) {
  const m = model.value
  const system = systemById.value.get(systemId)
  if (!m || !system) return
  const snapshot = snapshotSystems(m, [systemId])
  const at = mark()
  const was = ruleReport.value?.bySystem[systemId]?.oriented ?? 0
  const rules = setSystemKind(m, systemId, kind, fluid)
  if (!rules) return
  remember(`계통 ${system.name || systemId} 종류 → ${systemKindText(kind, fluid)}`, snapshot, at)
  ruleReport.value = rules
  // 종류를 바꾸면 덕트·배관 유형 이름(SA_급기 …)과 방향이 엇갈려 규칙 방향이 통째로 빠질 수 있다. 계통이 확정 표에서
  // 조용히 사라지면 왜인지 알 수 없어서 수를 말한다.
  const now = rules.bySystem[systemId]
  if (now && (was || now.oriented)) {
    note(
      `계통 ${system.name || systemId}: 규칙 방향 ${was} → ${now.oriented}개` +
        (now.conflicts ? `. 덕트·배관 유형 이름이 다른 방향을 말하는 연결 ${now.conflicts}개는 정하지 않았습니다` : ''),
    )
  }
  triggerRef(model)
  flowVersion.value++
}
/** 계통 이름을 바꾼다(OE-PIP-09). BIM 이 준 계통도 바꾼다(2026-10-03 사용자 결정). TTL 계통 블록의 rdfs:label 이 된다. */
export function renameSystemTo(systemId: string, name: string) {
  const m = model.value
  const system = systemById.value.get(systemId)
  if (!m || !system) return
  const was = system.name
  const snapshot = snapshotSystems(m, [systemId])
  const at = mark()
  if (!renameSystem(m, systemId, name)) return
  remember(`계통 이름 ${was || systemId} → ${system.name}`, snapshot, at)
  triggerRef(model)
  flowVersion.value++
}
/** 연 때의 계통 이름. 고친 계통이면 패널에 BIM 이름을 같이 보인다. 사람이 만든 계통은 없다. */
export const systemNameAtOpen = (id: string) => baseline.value?.systems?.get(id)?.name ?? null
// 새 계통 만들기·지우기(E8). 만들면 고른 설비를 바로 넣는다 — 빈 계통은 온톨로지에 아무것도 더하지 않는다.
export const newSystemOpen = ref(false)
export const newSystemName = ref('')
export const newSystemKind = ref('')
export function createSystemFor(equipmentId: string) {
  const m = model.value
  const e = equipmentById.value.get(equipmentId)
  const name = newSystemName.value.trim()
  if (!m || !e || !name) return
  const snapshot = snapshotSystems(m, [e.systemId], [equipmentId], true)
  const at = mark()
  const system = createSystem(m, { name, kind: newSystemKind.value || null })
  if (!system) return
  ruleReport.value = setEquipmentSystem(m, equipmentId, system.id) ?? ruleReport.value
  remember(`계통 ${name} 만들기`, snapshot, at)
  newSystemOpen.value = false
  newSystemName.value = ''
  newSystemKind.value = ''
  triggerRef(model)
  flowVersion.value++
  redraw()
  note(`계통 ${name}${josa(name, '을/를')} 만들고 ${shortName(e.name)}${josa(shortName(e.name), '을/를')} 넣었습니다`)
}
export function removeSystem(systemId: string) {
  const m = model.value
  const system = systemById.value.get(systemId)
  if (!m || !system) return
  const members = m.storeys.flatMap((st) => st.equipment).filter((e) => e.systemId === systemId).map((e) => e.id)
  const snapshot = snapshotSystems(m, [systemId], members, true)
  const at = mark()
  const rules = deleteSystem(m, systemId)
  if (!rules) return
  remember(`계통 ${system.name || systemId} 지우기`, snapshot, at)
  ruleReport.value = rules
  selectedSystemId.value = null
  triggerRef(model)
  flowVersion.value++
  redraw()
  note(`계통 ${system.name || systemId}${josa(system.name || systemId, '을/를')} 지웠습니다. 구성원 ${system.memberIds.length}개는 이 계통 자리만 잃습니다(Ctrl+Z 로 되돌림)`)
}
/** 계통 종류의 출처. 사람이 고쳤으면 편집, 아니면 PredefinedType(BIM)·이름(사전). */
export const systemKindSrc = (s: { kindEdited?: unknown; kindSource?: 'bim' | 'dict' }): SrcKind => (s.kindEdited ? 'edit' : (s.kindSource ?? 'dict'))

export function toggleSystem(id: string) {
  selectedSystemId.value = selectedSystemId.value === id ? null : id
  if (selectedSystemId.value) selectedId.value = null
}

// 계통별 표의 고른 줄·펼친 검사는 옆 패널의 것이다. 편집 리플레이 동안은 보지 않는다 — 읽기만 해도 장면마다 계통 표·완전성 검사를
// 모델 전체로 다시 돌려 화면이 끊겼다.
const highlightRow = () => (replayOpen.value ? null : flowSystemRow.value)
/** 3D 에 남길 것. 펼친 사다리 칸이 있으면 그 기기만(방 칸은 기기가 아니라 계통 줄을 따른다), 없으면 고른 계통 줄. */
const highlightOnly = (): Set<string> | null => {
  const chip = replayOpen.value ? null : flowOpen.value
  if (chip && chip.target === 'device' && selectedId.value) return new Set([selectedId.value, ...chip.ids])
  return highlightRow()?.ids ?? null
}
const highlightCheck = () => (replayOpen.value ? null : openCheck.value)
/** 요구사항 칸에서 펼친 줄의 설비(requirement-items.ts). 완전성 검사와 같은 자리에서 같은 색으로 칠한다. 둘은 하나만 펼쳐진다. */
const highlightRequirement = () => {
  const r = replayOpen.value ? null : openRequirementRow.value
  return r?.items?.kind === 'equipment' ? [...r.items.elsewhere, ...r.items.missing] : null
}

// 고른 계통의 흐름을 3D 에서 달리는 빛으로 보인다(flow-pulse.ts). 방향은 화살표와 같은 차례로 읽는다 — BIM 포트, 사람이 정한 것,
// 규칙(R 을 켰을 때만, 옅게). 방향을 모르는 연결은 그리지 않는다. 빛이 없는 배관이 곧 방향을 모르는 곳이다. 연결은 위의 흐름 근거
// (FlowBasis)와 같은 것을 고른다 — 다르게 골랐더니 근거는 "포트 방향 24" 인데 아래 줄은 "모두 방향을 모름" 이라고 했다. `total` 은 그
// 연결 수이고, 패널이 빛이 왜 드문지 말하는 데 쓴다.
export const systemFlow = computed(() => {
  void flowVersion.value
  const m = model.value
  const system = selectedSystem.value
  if (!m || !system) return null
  const members = new Set(system.memberIds)
  const edges: FlowEdge[] = []
  let total = 0
  for (const c of m.connections) {
    if (!systemOwns(c, system.id, members)) continue
    total++
    if (c.directed) edges.push({ from: c.from, to: c.to, strong: true })
    else if (c.edited) edges.push({ from: c.edited.from, to: c.edited.to, strong: true })
    else if (c.inferred && showRules.value) edges.push({ from: c.inferred.from, to: c.inferred.to, strong: false })
  }
  return { edges, total, color: systemColors(m).get(system.id) ?? 0x2f6fed }
})

/** 고른 것과 이어진 것 전체가 화면에 들어오게 시점을 맞춘다. */
export function frameNetwork() {
  const t = tracedShown.value
  if (!selectedId.value || !t) return
  if (flowSystemRow.value) viewer?.frame(flowSystemRow.value.ids)
  else viewer?.frame([selectedId.value, ...t.upstream, ...t.downstream, ...t.linked])
}

/** 목록에서 고른 것도 3D 에서 고른 것과 같게 다룬다. 3D 는 그 자리로 시점을 옮긴다. */
export function select(id: string | null) {
  // 잇기 중이면 고른 것이 이을 상대다. 표·목록에서 골라도, 3D 에서 눌러도 같다.
  if (connectFrom.value && id) return connectTo(id)
  selectedId.value = id
  if (id) {
    selectedSystemId.value = null
    // 방 안의 설비를 고르면 방 선택을 남긴다(방 목록에서 들어갔다 Esc 로 돌아온다). 다른 곳의 설비면 푼다 — 남겨 두었더니
    // U 로 다른 층 설비로 건너뛴 뒤에도 앞서 고른 방의 꼭짓점 손잡이가 3D 에 남아 끌 수 있었다.
    if (selectedSpaceId.value && equipmentById.value.get(id)?.spaceId !== selectedSpaceId.value) selectedSpaceId.value = null
    viewer?.focus(id)
  }
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupSystems() {
  watch(selectedId, () => (systemFilter.value = ''))
  watch([selectedId, selectedSystemId, model, showRules, flowVersion, highlightRow, highlightOnly, highlightCheck, highlightRequirement, selectedSpace, selectedSpaceInfluence, sceneVersion, group, selectedZone], () => {
    if (!viewer) return

    // 여러 개 고른 설비(OE-UI-09). 고른 색으로 칠하고 나머지는 흐리게 하지 않는다(흐린 것은 Ctrl+클릭으로 더할 수 없다).
    if (group.value.length >= 2) {
      viewer.setHighlight({ selected: null, upstream: new Set(), downstream: new Set(), linked: new Set(), group: new Set(group.value) })
      return
    }

    const t = traced.value
    if (selectedId.value && t) {
      // 포트가 말한 상류·하류는 진한 색, 규칙(사전)으로만 정해진 것은 옅은 색이다. 한 색으로 섞어 칠하면
      // 3D 만 보고는 BIM 이 말한 흐름인지 우리가 정한 흐름인지 알 수 없다.
      const r = showRules.value ? tracedRules.value : null
      // 계통별 표에서 한 줄을 골랐거나 사다리 칸을 펼쳤으면 그것만 남긴다.
      const only = highlightOnly()
      const keep = (ids: Iterable<string>) => new Set([...ids].filter((id) => !only || only.has(id)))
      const port = new Set([...t.upstream, ...t.downstream])
      viewer.setHighlight({
        selected: selectedId.value,
        upstream: keep(t.upstream),
        downstream: keep(t.downstream),
        ruleUpstream: keep([...(r?.upstream ?? [])].filter((id) => !port.has(id))),
        ruleDownstream: keep([...(r?.downstream ?? [])].filter((id) => !port.has(id))),
        linked: keep([...t.linked, ...(r?.linked ?? [])]),
      })
      return
    }

    const system = selectedSystemId.value ? systemById.value.get(selectedSystemId.value) : null
    if (system) {
      // 계통은 흐름이 아니라 묶음이다. 상류·하류 색을 쓰지 않고 "이어짐" 한 가지로 칠한다.
      viewer.setHighlight({
        selected: null,
        upstream: new Set(),
        downstream: new Set(),
        linked: new Set(system.memberIds),
        keepColor: true,
      })
      return
    }

    // 고른 공조존을 담당하는 BIM 기기(말단은 고른 색, 원천은 이어짐 색).
    const zone = selectedZone.value
    if (zone) {
      viewer.setHighlight({ selected: null, upstream: new Set(zone.devices.sources), downstream: new Set(), linked: new Set(), group: new Set(zone.devices.terminals) })
      return
    }

    // 고른 물리존에 속한 설비. 경계를 끄는 동안 무엇이 드나드는지 보인다. 이 방 말단에 바람을 대는 공기 원천은 상류 색이다.
    const space = selectedSpace.value
    if (space) {
      viewer.setHighlight({
        selected: null,
        upstream: new Set(selectedSpaceInfluence.value?.sources.map((x) => x.id)),
        downstream: new Set(),
        linked: new Set(space.equipment.map((e) => e.id)),
        keepColor: true,
      })
      return
    }

    // 펼친 완전성 규칙이 있으면 어긴 것을 칠한다. 어디에 몰려 있는지가 먼저 보여야 무엇부터 고칠지 정한다.
    const check = highlightCheck()
    if (check && !check.skipped && check.failed.length) {
      viewer.setHighlight({ selected: null, upstream: new Set(), downstream: new Set(), linked: new Set(check.failed) })
      return
    }
    const required = highlightRequirement()
    if (required?.length) {
      viewer.setHighlight({ selected: null, upstream: new Set(), downstream: new Set(), linked: new Set(required) })
      return
    }

    viewer.setHighlight(null)
  })
  watch([systemFlow, sceneVersion], () => {
    const f = systemFlow.value
    viewer?.setFlow(f?.edges.length ? { edges: f.edges, color: f.color } : null)
  })
  onBeforeUnmount(() => viewer?.dispose())
}
