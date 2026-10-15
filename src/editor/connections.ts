import { computed, ref, shallowRef, triggerRef, watch } from 'vue'
import { ceilingOf } from '../lib/ceiling'
import { cancelRelease, dropRelease, keepRelease, releaseConnection, releasedBetween, releasesOf, snapshotRelease } from '../lib/connection-release'
import { addConnection, addEquipment, connectionBetween, removeConnection, snapshotConnection, snapshotEquipmentSet } from '../lib/edit'
import { bare, type EditCommand, parsePlan, type Preview, previewPlan, resolveEquipment, resolveSpace } from '../lib/edit-commands'
import { josa } from '../lib/josa'
import { equipmentKind } from '../lib/kinds'
import { interiorPoint, pointInPolygon } from '../lib/mapping'
import type { Connection, Model, Vec2, Vec3 } from '../lib/model'
import { allowedSurfaces } from '../lib/mount'
import { overlapForNew } from '../lib/overlap'
import { editing, model } from './core'
import { cm, shortName } from './equipment-shape'
import { equipmentById, flowVersion, ruleReport, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { editNotice } from './multi-select'
import { currentBox, redraw } from './redraw'
import { selectedSpaceId } from './rooms'

// --- 연결 잇기·끊기 -----------------------------------------------------------------
//
// 고른 설비에서 [잇기] 를 누르고 상대를 고르면(3D·표·목록 어디서든) 둘을 잇는다. 이은 연결은 방향 없이 시작한다 —
// 이어서 상류로·하류로를 정하면 그때 brick:feeds 로 나간다. 포트(BIM)가 말한 연결은 끊지 않는다(edit.ts).
export const connectFrom = ref<string | null>(null)
export const nameOfId = (id: string) => shortName(equipmentById.value.get(id)?.name || equipmentById.value.get(id)?.ifcClass || id)
export function startConnect() {
  if (!selectedId.value) return
  connectFrom.value = selectedId.value
  note(`${nameOfId(selectedId.value)}${josa(nameOfId(selectedId.value), '과/와')} 연결할 설비를 3D나 목록에서 고르세요 (Esc 취소)`)
}
export function connectTo(id: string) {
  const m = model.value
  const from = connectFrom.value
  connectFrom.value = null
  if (!m || !from) return
  if (id === from) return note('같은 설비끼리는 연결할 수 없습니다')
  if (connectionBetween(m, from, id)) return note('이미 이어져 있습니다')
  if (releasedBetween(m, from, id)) return note('해제 보정한 BIM 연결이 있는 두 설비입니다. 해제한 연결의 [해제 취소]로 되살립니다')
  const at = mark()
  const done = addConnection(m, from, id)
  if (!done) return
  remember(`${nameOfId(from)}–${nameOfId(id)} 연결`, { kind: 'connection', connection: done.connection, present: false, index: m.connections.length - 1 }, at)
  ruleReport.value = done.rules
  triggerRef(model)
  flowVersion.value++
  selectedId.value = from
  note(`${nameOfId(from)}–${nameOfId(id)}${josa(nameOfId(id), '을/를')} 연결했습니다. 방향은 상류로·하류로로 정합니다`)
}
// --- 말로 편집 시키기(ADR-0060) -------------------------------------------------------------
//
// [온톨로지] 칸의 gemini 가 붙인 편집 계획(```oe-edit)을 창(scripts/docs-chat.js)이 window.__oe.plan 으로 미리 보이고, 사람이 [적용] 을
// 누르면 window.__oe.apply 가 여기서 하나씩 실행한다. 실행은 여느 편집과 같은 함수다 — 되돌리기 이력에 명령마다 쌓이고, 겹침·소속 검사도
// 같다. 대상 찾기·계획 읽기는 lib/edit-commands.ts.
type PlanResult = { ok: boolean; text: string }
/** 창이 부르는 window.__oe(screen·plan·apply). 여러 곳에서 더하므로 없으면 만든다. */
export function oeHook(): Record<string, unknown> {
  const w = window as unknown as { __oe?: Record<string, unknown> }
  return (w.__oe ??= {})
}
function planOf(text: string): { error: string } | { commands: EditCommand[]; preview: Preview[] } | null {
  const m = model.value
  const plan = parsePlan(text)
  if (!plan || 'error' in plan) return plan
  if (!m) return { error: '편집 화면에 연 건물이 없습니다' }
  return { commands: plan.commands, preview: previewPlan(m, plan.commands) }
}
/** 방 안에 새 설비를 놓을 자리. 방 안의 점에서 시작해 다른 설비와 겹치면 0.5m 씩 비켜 본다(8방향 × 3바퀴). */
function freeSpotIn(m: Model, storeyId: string, ring: readonly Vec2[], z: number): Vec3 | null {
  const at = interiorPoint(ring)
  if (!at) return null
  for (let r = 0; r <= 3; r++) {
    for (let k = 0; k < (r ? 8 : 1); k++) {
      const a = (k * Math.PI) / 4
      const p: Vec2 = [at[0] + r * 0.5 * Math.cos(a), at[1] + r * 0.5 * Math.sin(a)]
      if (r && !pointInPolygon(p, ring)) continue
      const position: Vec3 = [cm(p[0]), cm(p[1]), cm(z)]
      if (!overlapForNew(m, storeyId, position, currentBox)) return position
    }
  }
  return null
}
function applyPlan(text: string): PlanResult[] {
  const m = model.value
  const plan = planOf(text)
  if (!plan) return [{ ok: false, text: '편집 계획이 없습니다' }]
  if ('error' in plan) return [{ ok: false, text: plan.error }]
  if (!m) return [{ ok: false, text: '편집 화면에 연 건물이 없습니다' }]
  if (!editing.value) return [{ ok: false, text: '편집 모드에서 적용합니다 — [편집] 을 누른 뒤 다시 [적용] 하세요' }]
  const bad = plan.preview.find((p) => !p.ok)
  if (bad) return [{ ok: false, text: `적용하지 않았습니다: ${bad.text}` }]
  const made = new Map<string, string>()
  // 이 계획에서 더한 설비는 equipmentById(화면 갱신 뒤에 다시 셈)에 아직 없다 — 모델에서 바로 찾는다.
  const nameIn = (id: string) => shortName(m.storeys.flatMap((s) => s.equipment).find((e) => e.id === id)?.name || id)
  const out: PlanResult[] = []
  for (const c of plan.commands) {
    if (c.do === 'add_equipment') {
      const sp = resolveSpace(m, c.space) as Exclude<ReturnType<typeof resolveSpace>, { error: string }>
      const storey = m.storeys.find((s) => s.id === sp.storeyId)!
      const space = storey.spaces.find((s) => s.id === sp.id)!
      // 천장에만 놓는 종류(디퓨저 등)는 천장고를 알면 천장에, 아니면 바닥에 놓는다(높이는 사람이 패널에서 고친다).
      const ceilingOnly = !(allowedSurfaces(c.kind)?.some((s) => s !== 'ceiling') ?? true)
      const ceil = ceilingOf(storey)
      const z = ceilingOnly && ceil ? storey.elevation + ceil.height : storey.elevation
      const position = freeSpotIn(m, storey.id, space.footprint, z)
      if (!position) {
        out.push({ ok: false, text: `${sp.label} 안에 빈 자리를 찾지 못했습니다(다른 설비와 겹침)` })
        break
      }
      const n = m.storeys.reduce((k, st) => k + st.equipment.filter((e) => e.added).length, 0) + 1
      const mk = mark()
      const e = addEquipment(m, storey.id, { name: c.name ?? `${equipmentKind(c.kind)!.label} ${n}`, kind: c.kind, position })
      if (!e) {
        out.push({ ok: false, text: `${sp.label}에 더하지 못했습니다` })
        break
      }
      const snapshot = snapshotEquipmentSet(m, e.id)
      if (snapshot?.kind === 'equipment-set') remember(`${e.name} 더하기(말로)`, { ...snapshot, present: false }, mk)
      made.set(e.name, e.id)
      out.push({ ok: true, text: `${storey.name} ${sp.label}에 ${e.name}${josa(e.name, '을/를')} 더했습니다` })
    } else {
      const id = (ref: string) => made.get(bare(ref)) ?? (resolveEquipment(m, ref) as { id: string }).id
      const a = id(c.from)
      const b = id(c.to)
      const at = mark()
      const done = addConnection(m, a, b)
      if (!done) {
        out.push({ ok: false, text: `${nameIn(a)}–${nameIn(b)}${josa(nameIn(b), '은/는')} 잇지 않았습니다(이미 이어졌거나 같은 설비)` })
        continue
      }
      remember(`${nameIn(a)}–${nameIn(b)} 연결(말로)`, { kind: 'connection', connection: done.connection, present: false, index: m.connections.length - 1 }, at)
      ruleReport.value = done.rules
      out.push({ ok: true, text: `${nameIn(a)}–${nameIn(b)}${josa(nameIn(b), '을/를')} 연결했습니다(방향 없음 — 상류로·하류로로 정합니다)` })
    }
  }
  triggerRef(model)
  flowVersion.value++
  redraw()
  const last = [...made.values()].at(-1)
  if (last) selectedId.value = last
  return out
}

export function disconnect(c: Connection) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotConnection(m, c)
  const at = mark()
  const rules = removeConnection(m, c)
  if (!rules) return
  remember(`${nameOfId(c.from)}–${nameOfId(c.to)} 연결 끊기`, snapshot, at)
  ruleReport.value = rules
  triggerRef(model)
  flowVersion.value++
}

// --- 연결 해제 보정 (OE-PIP-01·06) ----------------------------------------------------------
//
// BIM 포트 연결은 [연결 끊기]로 지우지 않고 해제 보정한다(connection-release.ts). 원본은 남고, 규칙 방향·계통 추적·TTL feeds 에서만
// 빠진다. 해제와 취소는 사유를 받아 보정 이력에 남긴다. 사유 칸은 그 줄 바로 아래에 연다 — 확인 창(window.prompt)은 다른 줄을 가리고
// 자동화 시험을 멈춘다.
// shallowRef: ref 는 연결을 반응형 대리 객체로 감싸 모델의 연결과 === 로 견줄 수 없다.
export const releaseDraft = shallowRef<{ connection: Connection; mode: 'release' | 'restore' } | null>(null)
export const releaseReason = ref('')
/** 고른 설비에 붙은 해제 보정. 직접 연결 표 아래에 비활성으로 보인다. */
export const selectedReleases = computed(() => {
  void flowVersion.value
  const m = model.value
  const id = selectedId.value
  if (!m || !id) return []
  return releasesOf(m, id).map((entry) => {
    const other = entry.connection.from === id ? entry.connection.to : entry.connection.from
    const relation = !entry.connection.directed ? null : entry.connection.from === id ? ('downstream' as const) : ('upstream' as const)
    return { entry, id: other, name: equipmentById.value.get(other)?.name || other, relation }
  })
})
/** 바뀐 내용에 올리는 해제 보정. 원본을 못 찾은 것·방향이 바뀐 것은 재검토로 적는다. */
export const releaseLines = computed(() => {
  void flowVersion.value
  return (model.value?.releasedConnections ?? []).map((r) => ({ from: r.connection.from, to: r.connection.to, reason: r.reason, review: r.review }))
})
/** 연결 보정 이력. 새 것이 위다. */
export const releaseLog = computed(() => {
  void flowVersion.value
  return [...(model.value?.connectionLog ?? [])].reverse()
})
export const RELEASE_ACTION = {
  release: '연결 해제 보정',
  restore: '해제 보정 취소',
  keep: '재검토: 해제 유지',
  drop: '재검토: 보정 지우기',
  flow: '방향 적용',
  unflow: '수동 지정 해제',
} as const
/** 이력의 시각. 로컬 시간으로(저장은 UTC). */
export function logTime(at: string) {
  const d = new Date(at)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}
export function openRelease(c: Connection, mode: 'release' | 'restore') {
  releaseDraft.value = { connection: c, mode }
  releaseReason.value = ''
}
export function submitRelease() {
  const m = model.value
  const d = releaseDraft.value
  if (!m || !d) return
  const c = d.connection
  const snapshot = snapshotRelease(m, c)
  const at = mark()
  const done = d.mode === 'release' ? releaseConnection(m, c, releaseReason.value) : cancelRelease(m, c, releaseReason.value)
  if ('refused' in done) {
    editNotice.value = done.refused
    return
  }
  const pair = `${nameOfId(c.from)}–${nameOfId(c.to)}`
  remember(`${pair} ${RELEASE_ACTION[d.mode]}`, snapshot, at)
  releaseDraft.value = null
  editNotice.value = ''
  ruleReport.value = done
  triggerRef(model)
  flowVersion.value++
  note(
    d.mode === 'release'
      ? `${pair} 연결을 해제 보정했습니다. 원본은 남고, 규칙 방향·계통 추적·TTL feeds 에서 뺐습니다`
      : `${pair} 연결의 해제 보정을 취소했습니다. 원본 방향 그대로 돌아왔습니다`,
  )
}
/** 재검토 처리. 방향이 바뀐 것은 해제 유지, 원본을 못 찾은 것은 보정 지우기. */
export function settleRelease(c: Connection, how: 'keep' | 'drop') {
  const m = model.value
  if (!m) return
  const snapshot = snapshotRelease(m, c)
  const at = mark()
  if (!(how === 'keep' ? keepRelease(m, c) : dropRelease(m, c))) return
  remember(`${nameOfId(c.from)}–${nameOfId(c.to)} ${RELEASE_ACTION[how]}`, snapshot, at)
  triggerRef(model)
  flowVersion.value++
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupConnections() {
  watch([selectedSpaceId, editing], () => (connectFrom.value = null))
  Object.assign(oeHook(), {
    plan: (text: string) => {
      const p = planOf(text)
      return p && !('error' in p) ? { preview: p.preview.map(({ text, ok }) => ({ text, ok })), editing: editing.value } : p
    },
    apply: applyPlan,
  })
  watch([selectedId, editing], () => (releaseDraft.value = null))
}
