import { computed, ref, shallowRef, watch } from 'vue'
import { flowIndex, type FlowIndex, type Hop, ladder, type Step, supplyChain } from '../lib/flow-ladder'
import { withInferred } from '../lib/flow-rules'
import { josa } from '../lib/josa'
import { equipmentKind, type FlowPart, type Medium, systemKind } from '../lib/kinds'
import { pausedInReplay } from '../lib/replay-player'
import { airServices, servedSpaces } from '../lib/served'
import { type Route, traceBySystem, traceRoutes } from '../lib/topology'
import type { LadderChip, LadderLine, LadderPart, LadderRow } from '../components/FlowLadder.vue'
import { kindLabel, systemById, whatIs } from './checks'
import { nameOfId } from './connections'
import { editing, model } from './core'
import { shortName } from './equipment-shape'
import { conduitId, equipmentById, flowLabel, flowVersion, hasRules, selected, selectedId, showRules } from './flow-rules'
import { legend } from './kinds'
import { viewStorey } from './multi-view'
import { select } from './systems'
import { showSpace } from './versions'

// --- 계통별로 보기 --------------------------------------------------------------
//
// 고른 기기에 붙은 덕트·배관의 계통마다 상류·하류·방향 모름을 따로 센다(topology.ts 의 traceBySystem).
// 숫자는 기기 대수이고 덕트·배관은 따로 센다. 수천 개여도 대부분은 관 조각이라, 기기 수가 엔지니어가 읽는
// 숫자다. 방향은 3D 와 같은 것을 쓴다(규칙을 켜 두면 규칙 방향까지).
export const systemColor = computed(() => new Map(legend.value.map((s) => [s.id, s.color])))
export const systemRows = pausedInReplay(() => {
  void flowVersion.value
  const m = model.value
  const id = selectedId.value
  if (!m || !id) return []
  const connections = showRules.value && hasRules.value ? withInferred(m.connections) : m.connections
  const isDevice = (x: string) => !conduitId(x)
  return traceBySystem(connections, id, (x) => equipmentById.value.get(x)?.systemId ?? null, conduitId)
    .map((t) => {
      const all = [...t.upstream, ...t.downstream, ...t.linked]
      const devices = all.filter(isDevice)
      const kinds = new Map<string, number>()
      for (const x of devices) {
        const e = equipmentById.value.get(x)
        const label = (e && kindLabel(e)) || '종류 모름'
        kinds.set(label, (kinds.get(label) ?? 0) + 1)
      }
      const system = t.systemId ? systemById.value.get(t.systemId) : null
      return {
        key: t.systemId ?? '',
        name: system ? system.name || '(이름 없는 계통)' : '계통 없음',
        kind: system ? (systemKind(system.kind)?.label ?? null) : null,
        color: system ? (systemColor.value.get(system.id) ?? null) : null,
        up: [...t.upstream].filter(isDevice).length,
        down: [...t.downstream].filter(isDevice).length,
        unknown: [...t.linked].filter(isDevice).length,
        conduits: all.length - devices.length,
        kinds: [...kinds].sort((a, b) => b[1] - a[1]),
        ids: new Set([id, ...all]),
      }
    })
    .sort((a, b) => b.up + b.down + b.unknown - (a.up + a.down + a.unknown) || b.conduits - a.conduits)
})
/** 계통별 표에서 고른 줄. 3D 에 그 계통의 추적만 칠한다. 설비를 바꾸면 풀린다. */
export const flowSystemKey = ref<string | null>(null)
export const flowSystemRow = computed(() => systemRows.value.find((r) => r.key === flowSystemKey.value) ?? null)
export function toggleFlowSystem(key: string) {
  flowSystemKey.value = flowSystemKey.value === key ? null : key
}
// --- 흐름 지도 -------------------------------------------------------------------
//
// 고른 기기에서 덕트·배관을 건너뛰고 기기에서 기기로 건너간다(flow-ladder.ts). 바로 붙은 이웃은 거의 관 조각이라(병원 공조기는 넷 다)
// "이 공조기의 VAV 는?", "어느 냉동기에서?" 에 답하지 못했다. 맨 위 한 줄은 계통을 넘는 공급 사슬(냉동기 → 공조기 → VAV → 디퓨저 → 방)이고,
// 아래는 계통마다 같은 사다리다. 방향은 흐름 경로(OE-ML-16)와 같다 — 포트·사람이 정한 방향·확정한 규칙은 늘 타고, 규칙 방향을 켜 두면
// 확정 전 규칙까지 탄다. 포트만 타면 사람이 방향을 정해도 사다리에 안 들었다.
const flowIdx = computed(() => {
  void flowVersion.value
  const m = model.value
  if (!m) return null
  const connections = withInferred(m.connections, !(showRules.value && hasRules.value))
  // 관 중간의 부속(댐퍼·소음기·밸브)은 관처럼 지나간다(kinds.ts 의 inline). 성수 공조기의 보내는 곳이 덕트 부속만 늘어선 줄이었다.
  // Revit 이 가지마다 쪼갠 같은 종류의 계통(급기·급기)은 이어 간다(kindOf).
  return flowIndex(connections, conduitId, (x) => equipmentById.value.get(x)?.systemId ?? null, {
    inline: (x) => !!equipmentKind(equipmentById.value.get(x)?.kind)?.inline,
    kindOf: (x) => systemById.value.get(x)?.kind,
  })
})
/** 공급 쪽 계통(급기·외기·순환수 공급처럼 원천에서 말단으로 보내는 것)이거나 기기끼리 바로 붙은 연결. 공급 사슬이 이것만 탄다. */
const isSupplySystem = (id: string | null) => id === null || systemKind(systemById.value.get(id)?.kind)?.sense === 'out'
/** 설비가 놓인 층. `storeyOf` 는 부를 때마다 층을 훑어서, 디퓨저 수백 개짜리 칸에서 쓰기에 느리다. */
export const equipmentStorey = computed(() => {
  const map = new Map<string, { id: string; name: string }>()
  for (const s of model.value?.storeys ?? []) for (const e of s.equipment) map.set(e.id, { id: s.id, name: s.name })
  return map
})
const spaceInfo = computed(() => {
  const map = new Map<string, { name: string; storey: string }>()
  for (const s of model.value?.storeys ?? []) for (const sp of s.spaces) map.set(sp.id, { name: sp.longName || sp.name, storey: s.name })
  return map
})
/**
 * 칸·목록에 적는 짧은 이름. 종류는 칸이 이미 말하므로 Revit 패밀리 이름(`M_Screw Chiller - Air Cooled - 281-1231 kW #725669`)이 길면
 * 번호(`#725669`)만 남긴다. 짧은 패밀리(`OHU1 #790637`)나 사람이 붙인 이름(`AHU-1`)은 그대로 둔다.
 */
function flowTag(id: string): string {
  const name = nameOfId(id)
  const revit = / (#\d+)$/.exec(name)
  if (revit && name.length - revit[0].length > 12) return revit[1]
  return flowLabel(id)
}
/** 목록을 층·방 순으로 늘어놓는 열쇠. 같은 방의 VAV 가 붙어 보인다. */
const placeKey = (id: string) => {
  const e = equipmentById.value.get(id)
  return `${equipmentStorey.value.get(id)?.name ?? ''}\u0000${(e?.spaceId && spaceInfo.value.get(e.spaceId)?.name) || '\uffff'}\u0000${nameOfId(id)}`
}
/** 사다리 칸. 한 단계의 기기를 종류별로 묶는다. 한 대면 이름까지 적어 누르기 전에 무엇인지 보인다. */
function chipsOf(block: string, ids: string[]): LadderChip[] {
  const byKind = new Map<string, string[]>()
  for (const id of ids) {
    const label = whatIs(equipmentById.value.get(id))?.label ?? '종류 모름'
    byKind.set(label, [...(byKind.get(label) ?? []), id])
  }
  return [...byKind]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([kind, list]) => [kind, list.sort((a, b) => placeKey(a).localeCompare(placeKey(b), 'ko', { numeric: true }))] as const)
    .map(([kind, list]) => ({
      key: `${block}:${kind}`,
      label: list.length === 1 ? `${kind} ${flowTag(list[0])}` : `${kind} ${list.length}`,
      ids: list,
      target: 'device' as const,
      title: list.length === 1 ? `${nameOfId(list[0])} — 누르면 이 설비로 갑니다` : `${kind} ${list.length}대 — 누르면 목록을 펼칩니다`,
    }))
}
/**
 * 화살표 꼬리표. 건너간 계통의 종류이고, 같은 낱말로 시작하면 줄인다(`순환수 공급`·`순환수 환수` → `순환수 공급·환수`).
 * 꼬리표의 툴팁이 BIM 계통 이름(`Hydronic Supply 1`)이다. 이름은 Revit 이 붙인 번호라 그것만으로는 무엇인지 모른다.
 */
function viaLabel(systems: (string | null)[]): { label: string; title: string } {
  // 종류를 모르는 계통은 BIM 이름 그대로 둔다(`위생 2`). "종류 모를 계통" 이라고 적으면 무엇인지 더 모른다.
  const kinds = [...new Set(systems.map((x) => (x === null ? '직접 연결' : (systemKind(systemById.value.get(x)?.kind)?.label ?? (systemById.value.get(x)?.name || '이름 없는 계통')))))]
  const groups = new Map<string, string[]>()
  for (const k of kinds) {
    const cut = k.indexOf(' ')
    const head = cut < 0 ? k : k.slice(0, cut)
    groups.set(head, [...(groups.get(head) ?? []), cut < 0 ? '' : k.slice(cut + 1)])
  }
  const label = [...groups].map(([head, rest]) => (rest.length > 1 && rest.every(Boolean) ? `${head} ${rest.join('·')}` : rest.map((r) => (r ? `${head} ${r}` : head)).join('·'))).join('·')
  const title = [...new Set(systems.filter((x): x is string => x !== null).map((x) => systemById.value.get(x)?.name || x))].join(', ')
  return { label, title }
}
/** 보기 모드에서 흐름 카드 아래의 근거(규칙 방향·직접 연결·경로)를 접는다. 한 번 펴면 다른 설비를 골라도 편 채로 둔다. */
export const foldDetail = computed(() => !editing.value && !!flowMap.value)
export const detailOpen = ref(false)
export const flowMap = pausedInReplay(() => {
  const m = model.value
  const id = selectedId.value
  const idx = flowIdx.value
  if (!m || !id || !idx || conduitId(id)) return null
  // 받는 곳·보내는 곳의 줄기는 공급 사슬이다(냉동기 → 공조기 → VAV → 디퓨저). 공급 쪽 계통만 타서 계통을 넘어 이어진다.
  const chain = supplyChain(idx, id, isSupplySystem)
  // 환기·환수·배기처럼 돌아오는 쪽 계통은 계통마다 따로 따라간다. 사슬에 이미 바로 붙은 설비(공조기의 냉수 환수 → 냉동기)면 줄을 새로
  // 만들지 않고 그 화살표 꼬리표에 계통만 더한다. 냉동기가 공급관 줄과 환수관 줄에 두 번 나오던 것이 한 번이 된다.
  const extra: { key: string | null; dir: 'up' | 'down'; steps: Step[] }[] = []
  const quiet: string[] = []
  for (const key of idx.systemsOf(id)) {
    const pass = (h: Hop) => h.systemId === key
    const up = ladder(idx, id, 'up', pass)
    const down = ladder(idx, id, 'down', pass)
    if (!up.length && !down.length && !idx.next(id).unknown.some(pass)) quiet.push(key ? systemById.value.get(key)?.name || key : '직접 연결')
    if (isSupplySystem(key)) continue
    for (const [dir, steps] of [['up', up], ['down', down]] as const) {
      if (!steps.length) continue
      const near = steps.length === 1 ? new Set(steps[0].ids) : null
      const into = near && [chain.up[0], chain.down[0]].find((st) => st && [...near].every((x) => st.ids.includes(x)))
      if (into) into.systems.push(key)
      else extra.push({ key, dir, steps })
    }
  }
  // 사슬 끝의 말단(디퓨저·그릴)이 든 방. 말단이 방 안에 있다는 것까지가 BIM 이 말하는 것이라, 담당 공간 표와 같은 근거다.
  const rooms = [...new Set(chain.down.flatMap((st) => st.ids).filter((x) => equipmentById.value.get(x)?.role === 'terminal').map((x) => equipmentById.value.get(x)!.spaceId).filter((x): x is string => !!x))]
  const roomKey = (x: string) => `${spaceInfo.value.get(x)?.storey ?? ''}\u0000${spaceInfo.value.get(x)?.name ?? ''}`
  rooms.sort((a, b) => roomKey(a).localeCompare(roomKey(b), 'ko', { numeric: true }))

  // 고른 설비는 줄마다 ● 하나다. 무엇인지는 패널 머리의 한 줄이 말한다 — 줄마다 "공조기 · 이 설비" 를 적었더니 좁은 패널에서 줄이 꺾였다.
  const me: LadderPart = { kind: 'me', label: `이 설비(${whatIs(selected.value)?.label ?? '고른 설비'})` }
  /** 화살표. 앞 화살표와 같은 계통이면 글을 빼고 → 만 둔다(`● ─급기→ VAV 54 → 디퓨저 143`). */
  const arrows = () => {
    let last = ''
    return (systems: (string | null)[]): LadderPart => {
      const v = viaLabel(systems)
      const label = v.label === last ? '' : v.label
      last = v.label
      return { kind: 'arrow', label, title: v.title }
    }
  }
  // 받는 곳: 먼 것부터 고른 설비 쪽으로. 화살표는 그 단계에 올 때 탄 계통이다.
  const upLine = (block: string, steps: Step[]): LadderPart[] => {
    const arrow = arrows()
    const parts: LadderPart[] = []
    for (let i = steps.length - 1; i >= 0; i--) parts.push({ kind: 'chips', tone: 'up', chips: chipsOf(`${block}:${i}`, steps[i].ids) }, arrow(steps[i].systems))
    return [...parts, me]
  }
  const downLine = (block: string, steps: Step[], tail: LadderChip | null): LadderPart[] => {
    const arrow = arrows()
    const parts: LadderPart[] = [me]
    steps.forEach((st, i) => parts.push(arrow(st.systems), { kind: 'chips', tone: 'down', chips: chipsOf(`${block}:${i}`, st.ids) }))
    if (tail) parts.push({ kind: 'arrow', label: '', title: '' }, { kind: 'chips', tone: 'down', chips: [tail] })
    return parts
  }
  const lines: LadderLine[] = []
  // 머리말(받는 곳·보내는 곳)은 무리의 첫 줄에만 적는다.
  const add = (head: string, key: string, parts: LadderPart[]) => lines.push({ key, head: lines.some((l) => l.key.startsWith(`${head}:`)) ? '' : head, parts })
  if (chain.up.length) add('받는 곳', '받는 곳:chain', upLine('chain:up', chain.up))
  for (const e of extra.filter((x) => x.dir === 'up')) add('받는 곳', `받는 곳:${e.key}`, upLine(`up:${e.key}`, e.steps))
  const roomChip: LadderChip | null = rooms.length ? { key: 'chain:rooms', label: `방 ${rooms.length}곳`, ids: rooms, target: 'room', title: '사슬 끝의 말단이 놓인 방 — 누르면 목록을 펼칩니다' } : null
  if (chain.down.length) add('보내는 곳', '보내는 곳:chain', downLine('chain:down', chain.down, roomChip))
  for (const e of extra.filter((x) => x.dir === 'down')) add('보내는 곳', `보내는 곳:${e.key}`, downLine(`down:${e.key}`, e.steps, null))
  // 방향을 모르는 연결로만 닿은 기기. 계통을 가리지 않고 한 줄로 모은다(성수 FCU 는 순환수 공급·환수에 같은 FCU 가 120대씩 겹쳤다).
  const shown = new Set(lines.flatMap((l) => l.parts.flatMap((p) => (p.kind === 'chips' ? p.chips.flatMap((c) => c.ids) : []))))
  const loose = idx.next(id).unknown.filter((h) => !shown.has(h.id))
  if (loose.length) {
    const v = viaLabel([...new Set(loose.map((h) => h.systemId))])
    lines.push({ key: '방향 모름', head: '방향 모름', parts: [{ kind: 'chips', tone: 'linked', chips: chipsOf('unknown', [...new Set(loose.map((h) => h.id))]) }, { kind: 'tag', label: v.label, title: v.title }] })
  }
  return { lines, quiet, gaps: flowGaps(idx, id), summary: flowSentence(chain.up[0]?.ids ?? [], chain.down.flatMap((st) => st.ids), rooms.length) }
})
/**
 * 받는 곳·보내는 곳이 비었을 때 그 까닭 한 줄. 줄이 없으면 보는 사람은 "덕트만 보인다" 로 읽었다(성수 FCU·6층 공조기).
 * 종류가 말하는 흐름 자리(kinds.ts 의 flow)마다 본다 — FCU 는 물을 받고(sink) 공기를 보낸다(source). 그 매체의 관이 아예 안 붙은
 * 설비는 말하지 않는다(덕트 없이 방에 놓인 카세트형 등). 보는 범위는 흐름 카드와 같다 — 관을 지나 처음 닿는 설비.
 */
const MEDIUM_PIPE: Record<Medium, string> = { air: '덕트', water: '배관', refrigerant: '냉매 배관' }
function flowGaps(idx: FlowIndex, id: string): string[] {
  const info = equipmentKind(equipmentById.value.get(id)?.kind)
  if (!info) return []
  const mediumOf = (systemId: string | null) => (systemId ? systemKind(systemById.value.get(systemId)?.kind)?.medium : undefined)
  const next = idx.next(id)
  const gaps: string[] = []
  for (const [medium, part] of Object.entries(info.flow) as [Medium, FlowPart][]) {
    if (part === 'through' || medium === 'refrigerant') continue
    const has = (hops: Hop[]) => hops.filter((h) => mediumOf(h.systemId) === medium)
    if (!idx.systemsOf(id).some((k) => mediumOf(k) === medium)) continue
    const want = part === 'sink' ? 'up' : 'down'
    if (has(next[want]).length) continue
    const head = part === 'sink' ? '받는 곳' : '보내는 곳'
    const pipe = MEDIUM_PIPE[medium]
    // 반대 자리의 설비. 물을 받는 FCU 에게는 물을 보내는 설비(열원·펌프)가 받는 곳이다.
    const other = part === 'sink' ? 'source' : 'sink'
    const loose = [...new Set(has(next.unknown).map((h) => h.id))]
    const fits = loose.filter((x) => equipmentKind(equipmentById.value.get(x)?.kind)?.flow[medium] === other)
    const whom = part === 'sink' ? (medium === 'air' ? '공조기·팬' : '열원·펌프') : medium === 'air' ? '디퓨저·그릴' : '물을 받는 설비'
    if (fits.length) {
      const kinds = new Map<string, number>()
      for (const x of fits) {
        const label = whatIs(equipmentById.value.get(x))?.label ?? '종류 모름'
        kinds.set(label, (kinds.get(label) ?? 0) + 1)
      }
      gaps.push(`${head}: ${pipe} 방향이 정해지지 않았습니다. 방향 모름 줄에 ${head} 후보가 있습니다(${kindsText([...kinds].sort((a, b) => b[1] - a[1]))}).`)
    } else if (loose.length) gaps.push(`${head}: ${pipe}${josa(pipe, '을/를')} 따라 바로 닿는 설비 ${loose.length}대 중에 ${whom}${josa(whom, '이/가')} 없습니다.`)
    else gaps.push(`${head}: ${pipe}${josa(pipe, '이/가')} 다른 설비까지 이어지지 않습니다.`)
  }
  return gaps
}
/** `냉동기 1대에서 받아 VAV 54대·디퓨저 143대로 보냅니다(방 124곳)`. 받는 쪽은 바로 위 단계만, 보내는 쪽은 사슬 끝까지 센다. */
function flowSentence(from: string[], to: string[], rooms: number): string {
  const count = (ids: string[]) => {
    const n = new Map<string, number>()
    for (const id of ids) {
      const label = whatIs(equipmentById.value.get(id))?.label ?? '종류 모름'
      n.set(label, (n.get(label) ?? 0) + 1)
    }
    // 보내는 쪽은 사슬 차례(VAV → 디퓨저)대로 둔다. 많은 순으로 두면 "디퓨저 143대·VAV 54대" 가 되어 흐름이 거꾸로 읽힌다.
    const list = [...n]
    return list.slice(0, 3).map(([k, v]) => `${k} ${v}대`).join('·') + (list.length > 3 ? ` 외 ${list.length - 3}종` : '')
  }
  const tail = rooms ? `(방 ${rooms}곳)` : ''
  if (from.length && to.length) return `${count(from)}에서 받아 ${count(to)}로 보냅니다${tail}`
  if (from.length) return `${count(from)}에서 받습니다`
  if (to.length) return `${count(to)}로 보냅니다${tail}`
  return ''
}
/** 펼친 사다리 칸. 하나만 연다. 3D 는 그 칸의 기기만 남겨 칠한다. */
export const flowOpen = shallowRef<LadderChip | null>(null)
export function describeFlow(id: string, target: LadderChip['target']): LadderRow {
  if (target === 'room') {
    const sp = spaceInfo.value.get(id)
    return { id, name: sp?.name ?? id, where: sp?.storey ?? '' }
  }
  const e = equipmentById.value.get(id)
  const room = e?.spaceId ? spaceInfo.value.get(e.spaceId)?.name : null
  return { id, name: flowTag(id), where: [room ?? '방 밖', equipmentStorey.value.get(id)?.name].filter(Boolean).join(' · ') }
}
/** 펼친 칸의 기기 중 지금 3D 에 안 보이는 것(한 층만 보는 중에 다른 층에 있는 것). 목록 위에 알리고 모든 층 보기로 넘긴다. */
export const flowOpenAway = computed(() => {
  const chip = flowOpen.value
  const at = viewStorey.value
  if (!chip || chip.target !== 'device' || !at) return null
  const away = chip.ids.filter((id) => equipmentStorey.value.get(id)?.id !== at)
  if (!away.length) return null
  const names = [...new Set(away.map((id) => equipmentStorey.value.get(id)?.name).filter(Boolean))]
  return { count: away.length, all: away.length === chip.ids.length, storeys: names.slice(0, 2).join(', ') + (names.length > 2 ? ` 외 ${names.length - 2}개 층` : '') }
})
export function pickFlow(id: string, target: LadderChip['target']) {
  if (target === 'room') showSpace(id)
  else select(id)
}

// --- 흐름 경로 (OE-ML-16) -------------------------------------------------------
//
// 고른 기기에서 방향 있는 연결만 따라 닿는 원천·말단을 경로와 함께 나열한다. 원천이 여럿이면 여럿 다 보이고(하나를 공급자로 정하지 않는다),
// 한 원천에 두 갈래 넘게 닿으면 대체 경로가 있다고 적는다. 방향 있는 고리가 있으면 알린다 — 추적은 한 번 간 곳을 다시 가지 않아 끝난다.
// 방향은 계통별로 보기와 같은 것을 쓴다(규칙을 켜 두면 규칙 방향까지).
/** 한 목록에 보이는 수. 성수 공조기는 디퓨저가 수백 개다. */
const ROUTE_LIST_MAX = 6
export const routeView = pausedInReplay(() => {
  void flowVersion.value
  const m = model.value
  const id = selectedId.value
  if (!m || !id) return null
  // 확정 흐름(포트 · 사람이 정한 방향 · 확정한 규칙)만 따라간다. 규칙 미리보기를 켜면 확정 전 규칙 방향까지 넣고, 그렇다고 적는다(AC5).
  const preview = showRules.value && hasRules.value
  const r = traceRoutes(withInferred(m.connections, !preview), id, conduitId)
  if (!r.sources.length && !r.targets.length && !r.looped.length && !r.cycle.length) return null
  const name = (x: string) => shortName(equipmentById.value.get(x)?.name ?? x)
  const line = (x: Route) => ({
    id: x.id,
    name: name(x.id),
    detail: [x.via.length ? `${x.via.map(name).join(' → ')} 경유` : '', `덕트·배관 ${x.conduits}개`, x.branches > 1 ? `${x.branches}갈래(대체 경로)` : ''].filter(Boolean).join(' · '),
  })
  return {
    sources: r.sources.slice(0, ROUTE_LIST_MAX).map(line),
    moreSources: Math.max(0, r.sources.length - ROUTE_LIST_MAX),
    targets: r.targets.slice(0, ROUTE_LIST_MAX).map(line),
    moreTargets: Math.max(0, r.targets.length - ROUTE_LIST_MAX),
    looped: r.looped.slice(0, ROUTE_LIST_MAX).map(line),
    moreLooped: Math.max(0, r.looped.length - ROUTE_LIST_MAX),
    cycle: r.cycle.slice(0, ROUTE_LIST_MAX).map(name),
    moreCycle: Math.max(0, r.cycle.length - ROUTE_LIST_MAX),
    preview,
  }
})
export const kindsText = (kinds: [string, number][]) =>
  kinds.slice(0, 3).map(([label, n]) => `${label} ${n}`).join(' · ') + (kinds.length > 3 ? ` 외 ${kinds.length - 3}종` : '')

// --- 담당 공간 -----------------------------------------------------------------
//
// 공기 원천(공조기·FCU·전열교환기·팬)마다 흐름 방향을 따라 닿는 말단과 그 말단이 있는 방(served.ts).
// 방향은 3D 와 같은 것을 쓴다. 추정이라 화면에만 보이고 내보내지 않는다.
export const airServiceList = pausedInReplay(() => {
  void flowVersion.value
  const m = model.value
  if (!m) return []
  return airServices(m, showRules.value && hasRules.value ? withInferred(m.connections) : m.connections)
})
export const spaceStorey = computed(() => {
  const map = new Map<string, string>()
  for (const storey of model.value?.storeys ?? []) for (const sp of storey.spaces) map.set(sp.id, storey.name)
  return map
})
export const selectedService = pausedInReplay(() => {
  const m = model.value
  const id = selectedId.value
  const service = id ? airServiceList.value.find((s) => s.sourceId === id) : null
  if (!m || !service) return null
  return { ...service, rooms: servedSpaces(m, service, equipmentById.value) }
})
// --- 공간 보기 상태(lib/space-view.ts) — 켜고 끄는 것은 보기 필터 옆(enterSpaceView) ---
/** 공간 보기 중인 방과 들어올 때 남긴 설비. 화면 상태다. */
export const spaceView = shallowRef<{ id: string; keep: ReadonlySet<string> } | null>(null)

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupFlowMap() {
  watch(selectedId, () => (flowSystemKey.value = null))
  watch([selectedId, showRules], () => (flowOpen.value = null))
}
