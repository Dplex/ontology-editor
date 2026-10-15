import { computed, nextTick, ref, watch } from 'vue'
import { type Box, completenessChecks, diagnoseFailure, type FailureFix } from '../lib/checks'
import { type ConnectCandidate, connectCandidates } from '../lib/connect-candidates'
import { flowEdits } from '../lib/edit'
import { withInferred } from '../lib/flow-rules'
import { EQUIPMENT_KINDS, equipmentKind, ifcClassLabel } from '../lib/kinds'
import type { Equipment } from '../lib/model'
import { pausedInReplay } from '../lib/replay-player'
import { airBasis, needsSystem, servedSpaces, systemlessAir } from '../lib/served'
import { checklistContext, type SpaceCheckItem, type SpaceChecklist, storeyChecklists } from '../lib/space-checklist'
import { spaceInfluence } from '../lib/space-view'
import type { SrcKind } from '../components/Src.vue'
import { connectFrom, connectTo } from './connections'
import { editing, mode, model } from './core'
import { spaceNameOf } from './edit-report'
import { relocate, shortName } from './equipment-shape'
import { airServiceList, selectedService, spaceStorey } from './flow-map'
import { equipmentById, flowVersion, hasRules, selected, selectedId, showRules } from './flow-rules'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { meshes } from './open-file'
import { currentBox, sceneVersion } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedSpace } from './space-objects'
import { select } from './systems'

// --- 방별 체크리스트(lib/space-checklist.ts, docs/plans/space-checklist.md) ---
// 방 하나가 온톨로지로 얼마나 찼는지. 건물을 한 번 훑은 것(checkCtx)을 층마다 방으로 나눈다. 리플레이 동안은 다시 세지 않는다.
const checkCtx = pausedInReplay(() => {
  void flowVersion.value
  void sceneVersion.value
  const m = model.value
  return m ? checklistContext(m, airServiceList.value) : null
})
/** 층마다 방의 체크리스트. 고른 층만 센다(층 요약·공간 칸·방 사이 이동이 같이 쓴다). */
export const checksByStorey = (storeyId: string): Map<string, SpaceChecklist> => {
  const m = model.value
  const ctx = checkCtx.value
  const st = m?.storeys.find((s) => s.id === storeyId)
  return st && ctx ? storeyChecklists(st, ctx) : new Map()
}
/** 고른 방의 체크리스트. */
export const selectedChecklist = computed(() => {
  const sp = selectedSpace.value
  return sp ? (checksByStorey(sp.storey.id).get(sp.space.id) ?? null) : null
})
/** 방 하나만 보여도 되는 [고치기]. 고칠 편집이 이미 있는 곳으로 데려간다. 되돌리기는 그 편집 그대로다. */
export function fixCheck(item: SpaceCheckItem) {
  const focus = (selector: string) => {
    if (!editing.value) mode.value = 'edit'
    void nextTick(() => document.querySelector<HTMLElement>(selector)?.focus())
  }
  if (item.key === 'label') return focus('.space-name input')
  if (item.key === 'number') return focus('[data-testid="space-number"]')
  if (item.key === 'kind') return focus('[data-testid="space-kind"]')
  const id = item.ids?.[0]
  if (!id) return
  select(id)
  if (item.key === 'supplyTtl') note('이 원천 계통의 규칙 방향을 확정하면(C) 이 방 급기가 TTL 에 나갑니다')
}
export const checkFixLabel = (item: SpaceCheckItem) =>
  item.key === 'label' || item.key === 'number' ? '이름 칸으로' : item.key === 'kind' ? '종류 고르기' : item.key === 'supplyTtl' ? '원천 고르기' : item.ids?.length ? `설비 고르기${item.ids.length > 1 ? ` (${item.ids.length})` : ''}` : ''
/** 고른 방에 영향을 주는 설비 — 안에 있는 것과 이 방 말단에 닿는 공기 원천. 패널·3D 칠하기·공간 보기가 같이 쓴다. */
export const selectedSpaceInfluence = computed(() => {
  const m = model.value
  const id = selectedSpaceId.value
  if (!m || !id) return null
  return spaceInfluence(m, id, airServiceList.value, equipmentById.value)
})
// VAV·말단의 계통과 담당 근거(OE-EQP-10). 계통이 있어야 하는 설비인데 없으면 패널과 검토 화면에서 경고한다. 담당은 흐름 방향을
// 거슬러(급기)·따라(환기) 닿는 공기 원천이다 — 위 담당 공간을 말단 쪽에서 본 것이라 같은 방향을 쓰고, 추정이라 화면에만 보인다.
export const selectedBasis = computed(() => {
  void flowVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || !needsSystem(e)) return null
  const basis = airBasis(m, showRules.value && hasRules.value ? withInferred(m.connections) : m.connections, e.id, equipmentById.value)
  const name = (id: string) => shortName(equipmentById.value.get(id)?.name || id)
  const rooms = new Set(basis.terminals.map((t) => equipmentById.value.get(t)?.spaceId).filter((x): x is string => !!x))
  return { supplyFrom: basis.supplyFrom.map(name), extractTo: basis.extractTo.map(name), terminals: basis.terminals.length, rooms: rooms.size }
})
export const systemless = computed(() => (model.value ? systemlessAir(model.value) : []))

/** 패널에 보일 담당 공간. 말단이 많은 방부터 SERVED_LIMIT 줄만, 층으로 묶는다(층 순서는 모델 순서). */
const SERVED_LIMIT = 12
export const servedAll = ref(false)
export const servedView = computed(() => {
  const rooms = selectedService.value?.rooms ?? []
  const shown = servedAll.value ? rooms : rooms.slice(0, SERVED_LIMIT)
  const order = new Map((model.value?.storeys ?? []).map((st, i) => [st.name, i]))
  const groups = new Map<string, typeof rooms>()
  for (const r of shown) {
    const label = r.spaceId ? (spaceStorey.value.get(r.spaceId) ?? '층 모름') : '방 밖'
    groups.set(label, [...(groups.get(label) ?? []), r])
  }
  return {
    groups: [...groups]
      .map(([label, rs]) => ({ label, rooms: rs }))
      .sort((a, b) => (order.get(a.label) ?? Infinity) - (order.get(b.label) ?? Infinity)),
    hidden: rooms.length - shown.length,
  }
})
/** 건물 전체의 원천별 담당 공간. 말단이 많은 원천부터. */
export const serviceSummary = computed(() => {
  const m = model.value
  if (!m) return null
  const rows = airServiceList.value
    .map((s) => {
      const rooms = servedSpaces(m, s, equipmentById.value).filter((r) => r.spaceId !== null)
      const e = equipmentById.value.get(s.sourceId)
      return {
        id: s.sourceId,
        name: e?.name || e?.ifcClass || s.sourceId,
        kind: e ? kindLabel(e) : '',
        supply: s.supply.length,
        extract: s.extract.length,
        rooms: rooms.map((r) => `${spaceStorey.value.get(r.spaceId!) ?? ''} ${spaceNameOf(r.spaceId)}`.trim()),
      }
    })
    .sort((a, b) => b.supply + b.extract - (a.supply + a.extract))
  return { rows, reaching: rows.filter((r) => r.supply + r.extract > 0).length }
})
export const SERVICE_LIMIT = 200

// --- 완전성 검사 ----------------------------------------------------------------
//
// 규칙마다 통과 수와 어긴 요소(checks.ts). 규칙을 펼치면 어긴 것을 목록으로 보이고 3D 에 칠한다.
// 설비나 계통을 고르면 그쪽이 3D 색을 가져간다.
export const checks = pausedInReplay(() => {
  const m = model.value
  if (!m) return []
  return completenessChecks(m, airServiceList.value, showRules.value && hasRules.value ? withInferred(m.connections) : m.connections)
})
/** 표에 두는 규칙(잰 것·건너뛴 까닭이 있는 것)과, 이 파일에 잴 대상이 없어 접어 두는 규칙. */
export const checksMeasured = computed(() => checks.value.filter((c) => c.skipped || c.total > 0))
export const checksEmpty = computed(() => checks.value.filter((c) => !c.skipped && c.total === 0))
export const openCheckKey = ref<string | null>(null)
export const openCheck = computed(() => checks.value.find((c) => c.key === openCheckKey.value) ?? null)
export const CHECK_LIMIT = 100

/** 설비 형상의 상자. 연결망 검사의 "이웃과 몇 mm 떨어졌나" 에만 쓴다. 형상이 바뀌면(열기·덧붙이기·옮기기) 다시 잰다. */
let boxCache: { at: number; boxes: Map<string, Box> } | null = null
function meshBoxes(): Map<string, Box> {
  if (boxCache && boxCache.at === sceneVersion.value) return boxCache.boxes
  const boxes = new Map<string, Box>()
  for (const [id, mesh] of meshes) {
    const p = mesh.positions
    if (p.length < 3) continue
    let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    for (let i = 0; i + 2 < p.length; i += 3) {
      if (p[i] < x0) x0 = p[i]
      if (p[i] > x1) x1 = p[i]
      if (p[i + 1] < y0) y0 = p[i + 1]
      if (p[i + 1] > y1) y1 = p[i + 1]
      if (p[i + 2] < z0) z0 = p[i + 2]
      if (p[i + 2] > z1) z1 = p[i + 2]
    }
    boxes.set(id, [x0, y0, z0, x1, y1, z1])
  }
  boxCache = { at: sceneVersion.value, boxes }
  return boxes
}

/** 펼친 검사에서 보이는 줄마다 왜 어겼는지(checks.ts 의 explainFailure). */
export const failReasons = computed(() => {
  void flowVersion.value
  const m = model.value
  const c = openCheck.value
  if (!m || !c) return new Map<string, ReturnType<typeof diagnoseFailure>>()
  const ctx = {
    model: m,
    connections: showRules.value && hasRules.value ? withInferred(m.connections) : m.connections,
    services: airServiceList.value,
    boxes: c.key === 'device-connected' || c.key === 'conduit-ends' ? meshBoxes() : undefined,
    boxOf: currentBox,
    label: (id: string) => {
      const e = equipmentById.value.get(id)
      const what = whatIs(e)?.label
      return [shortName(e?.name || e?.ifcClass || id), what].filter(Boolean).join(' · ')
    },
  }
  return new Map(c.failed.slice(0, CHECK_LIMIT).map((id) => [id, diagnoseFailure(c.key, id, ctx)]))
})
/**
 * 위반 목록의 한 번에 고치기. 여느 편집과 같은 길(relocate·connectTo)이라 되돌리기·리포트·자동 저장에 같이 들어간다.
 * 연결 누락은 바로 잇지 않고 후보부터 보인다(OE-PIP-08) — 대상·거리·계통·매체를 보고 사람이 하나를 고른다. 가깝다는 것만으로 이으면
 * 엉뚱한 계통의 덕트에 붙는다.
 */
export const fixOpen = ref<string | null>(null)
export function applyFix(id: string, fix: FailureFix) {
  if (fix.kind === 'move-into') {
    if (!editing.value) mode.value = 'edit'
    // 천장 설비도 바닥·벽 쪽에서 바로 고친다 — 모드가 달라 막히면 버튼이 아무 일도 하지 않았다(성수 J-1, 디퓨저 15개).
    relocate(id, fix.to, undefined, undefined, { ignoreModeLock: true })
  } else fixOpen.value = fixOpen.value === id ? null : id
}
/** 펼친 위반의 연결 후보. 검사 목록의 이유와 같은 거르기다(connect-candidates.ts). */
export const fixCandidates = computed((): ConnectCandidate[] => {
  void flowVersion.value
  const m = model.value
  const id = fixOpen.value
  return m && id ? connectCandidates(m, id, meshBoxes()).candidates : []
})
export function connectCandidate(id: string, other: string) {
  if (!editing.value) mode.value = 'edit'
  connectFrom.value = id
  connectTo(other)
  fixOpen.value = null
}
export const fixLabel = (fix: FailureFix) => (fix.kind === 'move-into' ? `${fix.spaceName} 안으로 옮기기` : '연결 후보 확인')
export function toggleCheck(key: string) {
  openCheckKey.value = openCheckKey.value === key ? null : key
  const c = openCheck.value
  if (c && c.failed.length) {
    selectedId.value = null
    selectedSystemId.value = null
    viewer?.frame(c.failed)
  }
}

export const flowEditLines = computed(() => {
  void flowVersion.value
  if (!model.value) return []
  const nameOf = (id: string) => equipmentById.value.get(id)?.name || id
  return flowEdits(model.value).map((e) => ({
    from: nameOf(e.from),
    to: nameOf(e.to),
    note:
      (e.rule === 'reversed' ? '규칙 방향과 반대' : e.rule === 'same' ? '규칙 방향과 같음' : '규칙으로 정할 수 없는 연결') +
      (e.reason ? ` · 사유: ${e.reason}` : ''),
  }))
})

export const systemById = computed(() => new Map((model.value?.systems ?? []).map((s) => [s.id, s])))

// IFC 계층이 말하는 역할을 사람 말로. IFC2x3 파일은 클래스가 전부 'FlowTerminal' 처럼
// 추상 이름이라 종류를 알 수 없는데, 역할만은 언제나 나온다.
const ROLE_LABEL: Record<NonNullable<Equipment['role']>, string> = {
  conversion: '에너지 변환',
  moving: '이송',
  storage: '저장',
  terminal: '말단',
  treatment: '처리',
  control: '조절',
  segment: '구간',
  fitting: '이음쇠',
  sensing: '계측',
}
export const roleLabel = (role: Equipment['role']) => (role ? ROLE_LABEL[role] : '')
export const kindLabel = (e: Equipment) => equipmentKind(e.kind)?.label ?? ''
/** 종류 상자의 무리. 사람만 고르는 종류(사전이 읽지 않고 Brick 이름도 없는 것)는 따로 보인다. */
export const KIND_GROUPS = [
  { label: '사전이 아는 종류', kinds: EQUIPMENT_KINDS.filter((k) => !k.manual) },
  { label: '이름으로 정하지 않는 종류 (BIM 값 또는 직접 선택)', kinds: EQUIPMENT_KINDS.filter((k) => k.manual) },
]
// 종류의 출처. 사전이 읽은 것과 사람이 타입 단위로 정한 것을 가른다.
export const kindSrc = (e: Equipment) => (e.kindEdited || e.added ? 'edit' : e.kindSource === 'bim' ? 'bim' : 'dict')

/**
 * 이 설비가 무엇인지 한 낱말로. 종류가 있으면 종류(출처는 그 종류의 출처), 없으면 IFC 클래스를 우리말로(출처 BIM).
 * 덕트·배관·이음쇠는 종류가 없어서, 목록에 이름만 있으면 `AT-101-01`·`Pipe Types:…:745565` 가 무엇인지 알 수 없었다.
 * 둘 다 없으면 null — 모르는 것을 지어 부르지 않는다.
 */
export function whatIs(e: Equipment | undefined | null): { label: string; src: SrcKind } | null {
  if (!e) return null
  const kind = kindLabel(e)
  if (kind) return { label: kind, src: kindSrc(e) }
  const label = ifcClassLabel(e.declaredType) ?? ifcClassLabel(e.ifcClass)
  return label ? { label, src: 'bim' } : null
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupChecks() {
  watch(selectedId, () => (servedAll.value = false))
  watch(openCheckKey, () => (fixOpen.value = null))
}
