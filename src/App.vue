<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, triggerRef, watch } from 'vue'
import type { MeshMap } from './lib/ifc/import'
import { countOf, isConduit, type Equipment, type Model } from './lib/model'
import { mergeModels, type MergeReport } from './lib/merge'
import { profileOf, type Profile } from './lib/profile'
import TierChips from './components/TierChips.vue'
import Fold from './components/Fold.vue'
import Src from './components/Src.vue'
import { neighbors, trace, TOLERANCE } from './lib/topology'
import { confirmSystemFlow, inferFlowByRules, withInferred, type RuleReport } from './lib/flow-rules'
import { EQUIPMENT_KINDS, equipmentKind, roomKind, systemKind } from './lib/kinds'
import { modelToGeoJSON } from './lib/export/geojson'
import { modelToTTL } from './lib/export/ttl'
import { createViewer, PICK_COLORS, systemColors, type Viewer } from './lib/viewer'
import {
  moveEquipment,
  moveSpaceVertex,
  renameSpace,
  summarize,
  type BoundaryChange,
  type Change,
} from './lib/edit'

// 테마는 라이트가 기본이고, 고른 값만 저장한다. 선행 스크립트(index.html)가 첫 페인트
// 전에 같은 값을 읽어 깜빡임을 막는다.
const dark = ref(document.documentElement.getAttribute('data-theme') === 'dark')

function toggleTheme() {
  dark.value = !dark.value
  const root = document.documentElement
  if (dark.value) root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
  try {
    localStorage.setItem('oe-theme', dark.value ? 'dark' : 'light')
  } catch {
    // 저장을 못 해도 이번 세션 동안은 바뀐 채로 쓴다.
  }
}

const fileName = ref('')
const busy = ref(false)
const error = ref('')
const dragging = ref(false)
const model = shallowRef<Model | null>(null)

const canvas = ref<HTMLCanvasElement | null>(null)
let viewer: Viewer | null = null

// 설비 형상. **모델과 따로 들고 다닌다** — 모델은 내보내기가 그대로 읽는 것이라 여기에
// 삼각형이 섞이면 TTL 로 기하가 새는 길이 생긴다. 반응형으로 감쌀 이유도 없다(화면이
// 값을 읽지 않고 3D 에만 넘긴다). 926개짜리 Map 을 반응형으로 만들면 그만큼 느려진다.
let meshes: MeshMap = new Map()

const counts = computed(() => (model.value ? countOf(model.value) : null))

// --- 편집 -------------------------------------------------------------------
//
// 편집은 모델을 그 자리에서 고친다. shallowRef 는 안쪽 변화를 못 보므로 편집한 뒤에
// triggerRef 로 알린다. 모델을 통째로 복사하면 3D 가 매번 다시 만들어진다.
const changes = ref<Change[]>([])
const report = computed(() => summarize(changes.value))

// 넓이는 편집할 때마다 조금씩 움직인다. 매번 한 줄씩 쌓지 말고 처음과 끝만 적는다.
const areaSummary = computed(() => {
  const first = new Map<string, BoundaryChange>()
  for (const c of areaChanges.value) if (!first.has(c.spaceId)) first.set(c.spaceId, c)

  const parts: string[] = []
  for (const [spaceId, start] of first) {
    const now = areaChanges.value.filter((c) => c.spaceId === spaceId).at(-1)!
    if (Math.abs(now.toAreaM2 - start.fromAreaM2) < 0.005) continue
    parts.push(`${start.spaceName} ${start.fromAreaM2.toFixed(1)}㎡ → ${now.toAreaM2.toFixed(1)}㎡`)
  }
  return parts.join(' · ')
})

// 층의 벽 두께 종류를 한 줄로 요약한다. 값이 여럿이면 내벽과 외벽이 섞인 것이다.
const wallThicknessOf = (storey: { walls: { thickness: number | null }[] }) => {
  const values = [...new Set(storey.walls.map((w) => w.thickness).filter((t): t is number => t !== null))]
  return values.sort((a, b) => a - b).map((t) => `${(t * 1000).toFixed(0)}mm`).join('/')
}

const wallThicknessLabel = (storey: { walls: { thickness: number | null }[] }) => {
  const kinds = wallThicknessOf(storey).split('/').filter(Boolean)
  return kinds.length <= 2 ? kinds.join('/') : `두께 ${kinds.length}종`
}

const spaceNameOf = (spaceId: string | null) => {
  if (!model.value || !spaceId) return '(소속 없음)'
  for (const storey of model.value.storeys) {
    const space = storey.spaces.find((s) => s.id === spaceId)
    if (space) return space.longName || space.name
  }
  return spaceId
}

function applyMove(equipmentId: string, axis: 0 | 1 | 2, raw: string, current: readonly number[] | null) {
  const value = Number(raw)
  if (!model.value || !Number.isFinite(value)) return

  // 미배치 설비는 기준 좌표가 없다. 한 축만 받아도 나머지를 0 으로 채워 배치한다(E6).
  const base: [number, number, number] = current ? [current[0], current[1], current[2]] : [0, 0, 0]
  base[axis] = value

  const change = moveEquipment(model.value, equipmentId, base)
  if (!change) return
  changes.value = [...changes.value, change]
  triggerRef(model)
  viewer?.setModel(model.value, meshes)
}

// 경계 편집은 넓이와 설비 소속을 동시에 흔든다. 두 변화를 같은 자리에서 보여 준다.
const areaChanges = ref<BoundaryChange[]>([])
const selfIntersecting = computed(() => areaChanges.value.some((c) => c.selfIntersecting))

function applyVertex(spaceId: string, index: number, axis: 0 | 1, raw: string, current: readonly number[]) {
  const value = Number(raw)
  if (!model.value || !Number.isFinite(value)) return

  const point: [number, number] = [current[0], current[1]]
  point[axis] = value

  const change = moveSpaceVertex(model.value, spaceId, index, point)
  if (!change) return

  areaChanges.value = [...areaChanges.value, change]
  changes.value = [...changes.value, ...change.equipment]
  triggerRef(model)
  viewer?.setModel(model.value, meshes)
}

// --- 편집 목록을 좁히기 ----------------------------------------------------------
//
// 성수는 물리존 934개·설비 1만 8천 대다. 전부 한 번에 그리면 스크롤이 끝나지 않고 브라우저도
// 그만큼 느려진다. 그래서 행이 많은 목록은 처음부터 접어 두고(SMALL), 펼쳐도 앞의 EDIT_LIMIT
// 행만 그린다. 층과 이름으로 좁히면 원하는 행에 닿는다.
const SMALL = 50
const EDIT_LIMIT = 200
const editStorey = ref('')
const editQuery = ref('')
const editLimit = ref(EDIT_LIMIT)
watch([editStorey, editQuery, fileName], () => {
  editLimit.value = EDIT_LIMIT
})
watch(fileName, () => {
  editStorey.value = ''
  editQuery.value = ''
})

const matches = (text: string) => {
  const q = editQuery.value.trim().toLowerCase()
  return !q || text.toLowerCase().includes(q)
}
const editStoreys = computed(() =>
  (model.value?.storeys ?? []).filter((s) => !editStorey.value || s.id === editStorey.value),
)
const editSpaces = computed(() =>
  editStoreys.value
    .flatMap((storey) => storey.spaces.map((space) => ({ storey, space })))
    .filter(({ space }) => matches(`${space.name} ${space.longName ?? ''}`)),
)
const editEquipment = computed(() =>
  editStoreys.value.flatMap((s) => s.equipment).filter((e) => matches(`${e.name} ${e.ifcClass} ${kindLabel(e)}`)),
)

function applyRename(spaceId: string, name: string) {
  if (!model.value) return
  renameSpace(model.value, spaceId, name)
  triggerRef(model)
}

watch([model, canvas], ([m, el]) => {
  if (!m || !el) return
  if (!viewer) {
    viewer = createViewer(el)
    viewer.onPick((id) => {
      selectedId.value = id
    })
  }
  viewer.setModel(m, meshes)
  viewer.setHighlight(null)
})

// --- 선택과 연결 -------------------------------------------------------------
const selectedId = ref<string | null>(null)

const equipmentById = computed(() => {
  const map = new Map<string, Equipment>()
  for (const storey of model.value?.storeys ?? []) for (const e of storey.equipment) map.set(e.id, e)
  return map
})

const selected = computed(() => (selectedId.value ? (equipmentById.value.get(selectedId.value) ?? null) : null))

const traced = computed(() =>
  model.value && selectedId.value ? trace(model.value.connections, selectedId.value) : null,
)

// --- 규칙 방향 -----------------------------------------------------------------
//
// 포트가 방향을 말하지 않은 연결에 계통·설비 종류로 정한 방향(flow-rules.ts). **첫 줄의 상류·하류는
// 포트 기준 그대로 둔다** — BIM 이 말한 것과 우리가 정한 것을 한 숫자에 섞으면 검토하는 사람이
// 구별할 수 없다. 규칙을 넣은 숫자는 한 줄 아래에 따로 보이고, 3D 에 칠할지는 사람이 고른다.
const ruleReport = shallowRef<RuleReport | null>(null)
const showRules = ref(true)
const confirmations = ref<{ systemName: string; count: number }[]>([])
// 확정은 연결의 `inferred.confirmed` 만 바꾼다. **모델 전체에 갱신 신호(triggerRef)를 보내지 않는다** —
// 그러면 3D 가 설비 수만큼 통째로 다시 만들어져 성수(1만 8천 개)에서 화면이 30초 넘게 멈췄다.
// 확정에 따라 바뀌는 칸(계통 현황, 등급 칩)만 이 값을 읽어 다시 계산한다.
const flowVersion = ref(0)
const hasRules = computed(() => !!model.value?.connections.some((c) => c.inferred))

const tracedRules = computed(() =>
  model.value && selectedId.value && hasRules.value
    ? trace(withInferred(model.value.connections), selectedId.value)
    : null,
)
/** 3D 에 칠하는 추적. 규칙을 켜 두면 규칙 방향까지 따라간다. */
const tracedShown = computed(() => (showRules.value && tracedRules.value ? tracedRules.value : traced.value))

/** 고른 설비가 속한 계통의 규칙 방향 현황. 확정 버튼 옆에 근거로 보인다. */
const selectedRule = computed(() => {
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
  return {
    systemId,
    name: system?.name || systemId,
    kind: systemKind(system?.kind)?.label ?? '',
    count: own.length,
    confirmed: own.length > 0 && own.every((c) => c.inferred!.confirmed),
    agree: tally?.agree ?? 0,
    checked,
    pct: checked > 0 ? Math.round(((tally?.agree ?? 0) / checked) * 100) : null,
  }
})

function confirmRule(systemId: string, systemName: string) {
  if (!model.value) return
  const n = confirmSystemFlow(model.value, systemId)
  if (n === 0) return
  confirmations.value = [...confirmations.value, { systemName, count: n }]
  flowVersion.value++
}

// 바로 붙은 이웃. 몇 개인지보다 무엇에 붙어 있는지가 먼저 궁금한 자리다.
const selectedNeighbors = computed(() => {
  if (!model.value || !selectedId.value) return []
  const id = selectedId.value
  // 포트가 방향을 말하지 않은 이웃에 규칙 방향이 있으면 같이 적는다. 출처 칸이 둘을 가른다.
  const ruleOf = new Map<string, { relation: 'upstream' | 'downstream'; confirmed: boolean }>()
  for (const c of model.value.connections) {
    if (c.directed || !c.inferred) continue
    if (c.inferred.from === id) ruleOf.set(c.inferred.to, { relation: 'downstream', confirmed: c.inferred.confirmed })
    else if (c.inferred.to === id) ruleOf.set(c.inferred.from, { relation: 'upstream', confirmed: c.inferred.confirmed })
  }
  return neighbors(model.value.connections, id).map((n) => ({
    ...n,
    rule: n.relation === 'linked' ? (ruleOf.get(n.id) ?? null) : null,
    name: equipmentById.value.get(n.id)?.name || equipmentById.value.get(n.id)?.ifcClass || n.id,
  }))
})

const systemById = computed(() => new Map((model.value?.systems ?? []).map((s) => [s.id, s])))

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
const roleLabel = (role: Equipment['role']) => (role ? ROLE_LABEL[role] : '')
const kindLabel = (e: Equipment) => equipmentKind(e.kind)?.label ?? ''
// Proxy 는 IFC 가 역할을 말하지 않아서, 역할도 이름 사전의 종류에서 나온다.
const roleSrc = (e: Equipment) => (e.ifcClass === 'BuildingElementProxy' ? 'dict' : 'bim')
const positionSrc = (e: Equipment) =>
  e.positionSource === 'edited' ? 'edit' : e.positionSource === 'geometry' ? 'calc' : 'bim'
const spaceSrc = (e: Equipment) => (e.spaceSource === 'bim' ? 'bim' : 'calc')
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

/**
 * Proxy 로 들어온 기기. IFC 가 설비라고 말하지 않은 것을 우리가 받은 것이다. 받은 근거가 둘이라 나눠 센다 —
 * 포트가 달려 연결망에 물려 있으면 BIM 의 연결로 판단한 것(계산), 포트 없이 이름만 사전에 있으면 사전이다.
 */
const proxyDevices = computed(() => {
  const m = model.value
  if (!m) return { ported: 0, named: 0 }
  const ported = new Set(m.connections.filter((c) => c.source === 'port').flatMap((c) => [c.from, c.to]))
  let p = 0
  let n = 0
  for (const s of m.storeys) {
    for (const e of s.equipment) {
      if (e.ifcClass !== 'BuildingElementProxy' || isConduit(e.role)) continue
      if (ported.has(e.id)) p++
      else n++
    }
  }
  return { ported: p, named: n }
})

/** 연결 수를 출처별로. 포트는 BIM 이 말한 것이고, 형상 추정은 우리가 맞닿음으로 계산한 것이다. */
const connectionSources = computed(() => {
  const cs = model.value?.connections ?? []
  const port = cs.filter((c) => c.source === 'port').length
  return { port, geometry: cs.length - port }
})

// --- 종류와 관제점 후보 --------------------------------------------------------------
//
// 이름 사전(kinds.ts)으로 읽은 것을 한 칸에 모은다. IFC2x3·Proxy 파일에서는 설비 종류와 Brick 클래스가
// 여기서만 나오므로, 무엇을 알아봤고 무엇을 몰랐는지가 한눈에 보여야 사전을 고칠 수 있다.
const kindSummary = computed(() => {
  const m = model.value
  if (!m) return null
  const devices = m.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
  const byKind = new Map<string, { label: string; brick: string; count: number; located: number; point: boolean }>()
  let unknown = 0
  for (const e of devices) {
    const info = equipmentKind(e.kind)
    if (!info) {
      unknown++
      continue
    }
    const row = byKind.get(info.kind) ?? { label: info.label, brick: info.brick ?? '(ex:)', count: 0, located: 0, point: !!info.point }
    row.count++
    if (e.spaceId) row.located++
    byKind.set(info.kind, row)
  }
  const order = new Map(EQUIPMENT_KINDS.map((k, i) => [k.label, i]))
  const kinds = [...byKind.values()].sort((a, b) => b.count - a.count || (order.get(a.label)! - order.get(b.label)!))
  const spaces = m.storeys.flatMap((s) => s.spaces)
  const rooms = new Map<string, number>()
  for (const sp of spaces) {
    const label = roomKind(sp.kind)?.label
    if (label) rooms.set(label, (rooms.get(label) ?? 0) + 1)
  }
  const systems = new Map<string, number>()
  for (const sy of m.systems) {
    const label = systemKind(sy.kind)?.label ?? '(종류 모름)'
    systems.set(label, (systems.get(label) ?? 0) + 1)
  }
  return {
    devices: devices.length,
    unknown,
    kinds,
    points: kinds.filter((k) => k.point),
    roomsKnown: [...rooms.values()].reduce((a, b) => a + b, 0),
    roomsTotal: spaces.length,
    rooms: [...rooms].sort((a, b) => b[1] - a[1]),
    systems: [...systems].sort((a, b) => b[1] - a[1]),
  }
})

// 형상으로 이은 연결에 거리를 붙여 보여 준다. 기본 판정에서 붙은 것과 고립된 요소를
// 살리려고 넓혀서 붙인 것은 확신의 정도가 달라서, 검토하는 사람이 구별할 수 있어야 한다.
const sourceLabel = (tolerance: number | null) =>
  tolerance !== null && tolerance > TOLERANCE ? `형상 추정 (${Math.round(tolerance * 1000)}mm 띄움)` : '형상 추정'

// 계통 범례. 색은 3D 와 같은 자리에서 가져온다.
const legend = computed(() => {
  if (!model.value) return []
  const colors = systemColors(model.value)
  const counted = new Map<string, number>()
  for (const storey of model.value.storeys) {
    for (const e of storey.equipment) if (e.systemId) counted.set(e.systemId, (counted.get(e.systemId) ?? 0) + 1)
  }
  return model.value.systems
    .map((s) => ({
      id: s.id,
      name: s.name || '(이름 없는 계통)',
      source: s.source,
      count: counted.get(s.id) ?? 0,
      color: `#${(colors.get(s.id) ?? 0).toString(16).padStart(6, '0')}`,
    }))
    .sort((a, b) => b.count - a.count)
})

/** 범례에서 고른 계통. 설비 선택과 배타다 — 둘을 겹쳐 칠하면 무엇이 강조된 건지 모른다. */
const selectedSystemId = ref<string | null>(null)

function toggleSystem(id: string) {
  selectedSystemId.value = selectedSystemId.value === id ? null : id
  if (selectedSystemId.value) selectedId.value = null
}

watch([selectedId, selectedSystemId, model, showRules], () => {
  if (!viewer) return

  const t = traced.value
  if (selectedId.value && t) {
    // 포트가 말한 상류·하류는 진한 색, 규칙(사전)으로만 정해진 것은 옅은 색이다. 한 색으로 섞어 칠하면
    // 3D 만 보고는 BIM 이 말한 흐름인지 우리가 정한 흐름인지 알 수 없다.
    const r = showRules.value ? tracedRules.value : null
    const port = new Set([...t.upstream, ...t.downstream])
    viewer.setHighlight({
      selected: selectedId.value,
      upstream: t.upstream,
      downstream: t.downstream,
      ruleUpstream: new Set([...(r?.upstream ?? [])].filter((id) => !port.has(id))),
      ruleDownstream: new Set([...(r?.downstream ?? [])].filter((id) => !port.has(id))),
      linked: new Set([...t.linked, ...(r?.linked ?? [])]),
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

  viewer.setHighlight(null)
})

/** 고른 것과 이어진 것 전체가 화면에 들어오게 시점을 맞춘다. */
function frameNetwork() {
  const t = tracedShown.value
  if (!selectedId.value || !t) return
  viewer?.frame([selectedId.value, ...t.upstream, ...t.downstream, ...t.linked])
}

/** 목록에서 고른 것도 3D 에서 고른 것과 같게 다룬다. 3D 는 그 자리로 시점을 옮긴다. */
function select(id: string | null) {
  selectedId.value = id
  if (id) {
    selectedSystemId.value = null
    viewer?.focus(id)
  }
}

onBeforeUnmount(() => viewer?.dispose())

// dev 서버가 data/ 의 .ifc 목록을 준다(vite.config.ts). 빌드 번들에선 실패하고 빈 목록이 된다.
const dataFiles = ref<{ path: string; size: number }[]>([])

// 파일마다 온톨로지를 어디까지 채우는지. dev 서버가 앱과 같은 임포터로 재서 준다(vite.config.ts).
// 한 파일에 1초 남짓 걸려서 목록을 먼저 보이고, 요약은 하나씩 채운다.
type Profiled = { profile: Profile } | { error: string }
const profiles = ref<Record<string, Profiled>>({})

fetch('./__data/')
  .then((r) => (r.ok ? r.json() : []))
  .then(async (files) => {
    dataFiles.value = Array.isArray(files) ? files : []
    for (const f of dataFiles.value) {
      try {
        const r = await fetch(`./__data/${f.path.split('/').map(encodeURIComponent).join('/')}?profile`)
        if (r.ok) profiles.value = { ...profiles.value, [f.path]: await r.json() }
      } catch {
        // 요약을 못 받아도 파일은 열 수 있다. 칸을 비워 둔다.
      }
    }
  })
  .catch(() => {})

const baseName = (path: string) => path.split('/').pop() ?? path
const profileAt = (path: string): Profile | null => {
  const p = profiles.value[path]
  return p && 'profile' in p ? p.profile : null
}
const errorAt = (path: string): string => {
  const p = profiles.value[path]
  return p && 'error' in p ? p.error : ''
}

function openData(path: string) {
  void load(baseName(path), () => fetchData(path))
}

function appendData(path: string) {
  void append(baseName(path), () => fetchData(path))
}

/** 요약 옆에 붙이는 한마디. 이 파일이 혼자 쓰이는지, 짝이 필요한지. */
function roleHint(p: Profile): string {
  if (p.needsArchitecture) return '방이 없다 — 건축 파일과 합칠 짝'
  if (p.needsEquipment) return '설비가 없다 — 설비 파일을 덧붙일 자리'
  return ''
}

function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// --- 진행 표시 -------------------------------------------------------------------
//
// 성수(건축 84MB + 기계 203MB)는 여는 데 수십 초가 걸린다. 무엇을 하는 중인지, 얼마나 남았는지를
// 보인다. 단계 안에서 몇 개 중 몇 개인지 알면 막대가 차고, 모르면 막대가 흐르기만 한다(억지로 %를
// 지어내지 않는다).
type Progress = { label: string; step?: number; steps?: number; done?: number; total?: number; unit?: 'bytes' | 'items' }
const progress = ref<Progress | null>(null)
const startedAt = ref(0)
const now = ref(0)
let ticker: number | undefined

function beginProgress(label: string) {
  startedAt.value = Date.now()
  now.value = startedAt.value
  progress.value = { label }
  window.clearInterval(ticker)
  ticker = window.setInterval(() => (now.value = Date.now()), 250)
}
function endProgress() {
  progress.value = null
  window.clearInterval(ticker)
}
const elapsed = computed(() => Math.max(0, Math.round((now.value - startedAt.value) / 1000)))
const progressPct = computed(() => {
  const p = progress.value
  return p && p.total ? Math.min(100, Math.round(((p.done ?? 0) / p.total) * 100)) : null
})
const progressTitle = computed(() => {
  const p = progress.value
  return p ? (p.step ? `${p.step}/${p.steps} · ${p.label}` : p.label) : ''
})
const progressDetail = computed(() => {
  const p = progress.value
  if (!p?.total) return ''
  return p.unit === 'bytes'
    ? `${mb(p.done ?? 0)} / ${mb(p.total)}`
    : `${(p.done ?? 0).toLocaleString()} / ${p.total.toLocaleString()}개`
})

/** 화면이 한 번 그려질 틈을 준다. 오래 막는 일(3D 만들기) 앞에서 진행 문구가 먼저 보이게 한다. */
const paint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))

// 임포트는 워커에서 돈다(lib/ifc/import.worker.ts). 화면 스레드에서 돌면 끝날 때까지 진행 막대가
// 한 번도 다시 그려지지 않는다. wasm 을 한 번만 초기화하도록 워커를 재사용한다.
//
// wasm 경로는 페이지 기준의 절대 주소로 넘긴다. vite 설정이 `base: './'` 라 번들이 하위 경로에서도
// 열리는데, 워커는 assets/ 아래에서 돌아서 상대 경로로 두면 wasm 을 엉뚱한 자리에서 찾는다.
let worker: Worker | null = null
function importInWorker(bytes: ArrayBuffer): Promise<{ model: Model; meshes: MeshMap }> {
  worker ??= new Worker(new URL('./lib/ifc/import.worker.ts', import.meta.url), { type: 'module' })
  const w = worker
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (d.type === 'progress') {
        progress.value = { label: d.progress.stage, step: d.progress.step, steps: d.progress.steps, done: d.progress.done, total: d.progress.total, unit: 'items' }
      } else if (d.type === 'done') {
        resolve({ model: d.model, meshes: new Map(d.meshes) })
      } else {
        reject(new Error(d.message))
      }
    }
    w.onerror = (e) => {
      // 워커가 죽었으면(메모리 부족 등) 다음 파일은 새 워커로 연다.
      worker = null
      reject(new Error(e.message || '임포트 워커가 멈췄습니다'))
    }
    w.postMessage({ bytes, wasmBase: new URL(import.meta.env.BASE_URL, location.href).href }, [bytes])
  })
}

async function load(name: string, read: () => Promise<ArrayBuffer>) {
  busy.value = true
  error.value = ''
  beginProgress('파일 읽는 중')
  try {
    const result = await importInWorker(await read())
    progress.value = { label: '3D 그리는 중' }
    await paint()
    meshes = result.meshes
    // 임포터가 이미 한 번 돌렸다. 계통별 채점표를 화면이 쓰려고 다시 받는다(같은 입력이면 같은 결과다).
    ruleReport.value = inferFlowByRules(result.model)
    confirmations.value = []
    model.value = result.model
    fileName.value = name
    mergeReport.value = null
    selectedId.value = null
    // 새 파일을 열면 이전 파일의 편집 이력은 뜻이 없다.
    changes.value = []
    areaChanges.value = []
    await nextTick()
    await paint()
  } catch (e) {
    // 실패한 채로 이전 모델을 남겨 두면 화면이 방금 연 파일을 보여 주는 것처럼 보인다.
    model.value = null
    meshes = new Map()
    fileName.value = ''
    mergeReport.value = null
    error.value = `IFC 를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
    endProgress()
  }
}

// --- 파일 덧붙이기 ------------------------------------------------------------
//
// 실제 프로젝트는 건축과 설비가 다른 파일이다. 설비 파일에는 방이 없어서 혼자 열면 소속
// 물리존(F11)이 안 나온다. 열린 모델에 다른 파일을 합친다.
const mergeReport = shallowRef<MergeReport | null>(null)

/** 외곽선이 있는 물리존 수. 이게 많은 쪽이 물리존을 대는 기준 모델이 된다. */
const drawnSpaces = (m: Model) => m.storeys.reduce((n, s) => n + s.spaces.filter((sp) => sp.footprint.length >= 3).length, 0)

// 편집한 뒤에는 덧붙이지 못하게 한다. 합치기는 모델을 새로 만드는 일이라, 앞선 편집이 합친
// 모델에 섞여 들어가면서 편집 이력에는 안 남는다 — 리포트가 모르는 변경이 생긴다.
const canAppend = computed(() => !!model.value && changes.value.length === 0 && areaChanges.value.length === 0)

async function append(name: string, read: () => Promise<ArrayBuffer>) {
  if (!model.value) return
  busy.value = true
  error.value = ''
  beginProgress('파일 읽는 중')
  try {
    const next = await importInWorker(await read())
    progress.value = { label: '합치는 중' }
    await paint()
    const current = { name: fileName.value, model: model.value }
    const incoming = { name, model: next.model }
    // 어느 파일을 먼저 열었는지와 무관하게 방을 더 많이 그린 쪽이 기준이다. 설비 파일을 먼저
    // 열고 건축 파일을 덧붙여도 결과가 같아야 한다.
    const [base, overlay] =
      drawnSpaces(incoming.model) > drawnSpaces(current.model) ? [incoming, current] : [current, incoming]
    const merged = mergeModels(base.model, overlay.model, { base: base.name, overlay: overlay.name })

    progress.value = { label: '3D 그리는 중' }
    await paint()
    meshes = new Map([...meshes, ...next.meshes])
    ruleReport.value = inferFlowByRules(merged.model)
    model.value = merged.model
    mergeReport.value = merged.report
    fileName.value = `${base.name} + ${overlay.name}`
    selectedId.value = null
    selectedSystemId.value = null
    await nextTick()
    await paint()
  } catch (e) {
    // 덧붙이기가 실패하면 열려 있던 모델은 그대로 둔다. 실패한 파일만 알린다.
    error.value = `${name} 를 덧붙이지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
    endProgress()
  }
}

function onAppendPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void append(file.name, () => file.arrayBuffer())
  // 같은 파일을 다시 고를 수 있게 비운다.
  input.value = ''
}


async function fetchData(path: string) {
  const r = await fetch(`./__data/${path.split('/').map(encodeURIComponent).join('/')}`)
  if (!r.ok) throw new Error(`data/${path} 를 받지 못했습니다 (HTTP ${r.status})`)
  // 크기를 알면 받은 만큼 막대를 채운다. 55 에서 203MB 를 받는 동안 멈춘 것처럼 보이지 않게.
  const total = Number(r.headers.get('Content-Length')) || 0
  if (!total || !r.body) return r.arrayBuffer()
  const buf = new Uint8Array(total)
  const reader = r.body.getReader()
  let done = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buf.set(chunk.value, done)
    done += chunk.value.length
    progress.value = { label: '내려받는 중', done, total, unit: 'bytes' }
  }
  return buf.buffer
}

/** 합치기 보고를 한 줄씩. 문제는 경고가 말하고, 여기는 무엇을 했는지를 말한다. */
const mergeLines = computed(() => {
  const r = mergeReport.value
  if (!r) return []
  const byName = r.storeys.filter((s) => s.by === 'name').length
  const byElevation = r.storeys.filter((s) => s.by === 'elevation').length
  const added = r.storeys.filter((s) => s.by === null).length
  const lines = [
    `층 ${r.storeys.length}개 중 이름으로 ${byName}` +
      (byElevation ? ` · 높이로 ${byElevation}` : '') +
      (added ? ` · 새 층 ${added}` : ''),
  ]
  if (r.alignment) lines.push(`좌표 겹침 ${Math.round(r.alignment.ratio * 100)}% (${r.alignment.inside}/${r.alignment.placed})`)
  const { dropped, kept, borrowed } = r.spaces
  const spaceParts = [
    dropped ? `겹친 물리존 ${dropped}개 뺌` : '',
    kept ? `빈자리 물리존 ${kept}개 받음` : '',
    borrowed ? `외곽선 ${borrowed}개 빌림` : '',
  ].filter(Boolean)
  if (spaceParts.length) lines.push(spaceParts.join(' · '))
  lines.push(`덧붙인 설비 미소속 ${r.unlocated.before} → ${r.unlocated.after}`)
  return lines
})

// 소속을 못 찾은 설비는 임포트 경고로 굳히지 않고 그때그때 센다. 경계 편집·설비 이동·
// 덧붙이기가 전부 이 값을 바꾼다. 기기와 도관을 나눠 말한다 — 이상 알림이 비는 것은 기기다.
const unlocatedLine = computed(() => {
  if (!model.value) return ''
  const all = model.value.storeys.flatMap((s) => s.equipment).filter((e) => e.spaceId === null)
  if (all.length === 0) return ''
  const conduits = all.filter((e) => isConduit(e.role)).length
  const devices = all.length - conduits
  return `기기 ${devices}대 · 덕트·배관 ${conduits}대의 소속 물리존을 찾지 못했습니다. 이상 알림의 '발생 위치' 가 빈 채로 나갑니다.`
})

// 열린 모델의 등급 칩. 파일 목록의 칩과 같은 계산이라, 덧붙인 뒤 어느 칸이 찼는지 견줄 수 있다.
const currentTiers = computed(() => {
  void flowVersion.value
  return model.value ? profileOf(model.value).tiers : []
})

const warnings = computed(() => [...(model.value?.warnings ?? []), ...(unlocatedLine.value ? [unlocatedLine.value] : [])])

function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void load(file.name, () => file.arrayBuffer())
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void load(file.name, () => file.arrayBuffer())
}

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function exportGeoJSON() {
  if (!model.value) return
  for (const { fileName: n, collection } of modelToGeoJSON(model.value)) {
    download(n, JSON.stringify(collection, null, 2), 'application/geo+json')
  }
}

function exportTTL() {
  if (!model.value) return
  download('ontology.ttl', modelToTTL(model.value), 'text/turtle')
}
</script>

<template>
  <main>
    <header>
      <div class="title">
        <div>
          <h1>ontology-editor</h1>
          <p class="sub">BIM(IFC4)을 읽어 공간 온톨로지 초안을 만듭니다.</p>
        </div>
        <button type="button" class="theme" :aria-pressed="dark" @click="toggleTheme">
          {{ dark ? '라이트' : '다크' }}
        </button>
      </div>
    </header>

    <section
      class="drop"
      :class="{ over: dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p v-if="busy">읽는 중… 진행 상황은 아래에 보입니다.</p>
      <p v-else>.ifc 파일을 여기에 끌어다 놓으세요.</p>
      <label class="pick">
        파일 선택
        <input type="file" accept=".ifc" :disabled="busy" @change="onPick" />
      </label>

    </section>

    <!-- data/ 의 샘플. 파일마다 온톨로지를 어디까지 채우는지 먼저 보고 고른다. -->
    <section v-if="dataFiles.length" class="catalog">
      <!-- 파일을 연 뒤에는 접어 둔다. 목록이 3D 와 검토 화면을 아래로 밀어낸다. 덧붙일 때 다시 편다. -->
      <Fold :key="model ? 'loaded' : 'empty'" title="data/ 의 IFC" :meta="`${dataFiles.length}개`" :default-open="!model">
        <p class="hint">
          칸은 등급이다. 공간(외곽선을 얻은 물리존) · 설비(좌표가 있는 기기) · 소속(방을 찾은 기기) ·
          연결망(연결 수) · 방향(흐름 방향을 아는 기기 비율). 칸에 마우스를 올리면 무엇을 셌는지 보인다.
        </p>
        <table>
          <tbody>
            <tr v-for="f in dataFiles" :key="f.path">
              <td class="name">
                <span>{{ f.path }}</span>
                <span class="muted">{{ mb(f.size) }}<template v-if="profileAt(f.path)"> · {{ profileAt(f.path)!.schema }}</template></span>
              </td>
              <td class="chips">
                <span v-if="!profiles[f.path]" class="muted">재는 중…</span>
                <span v-else-if="errorAt(f.path)" class="unreadable" :title="errorAt(f.path)">열 수 없음</span>
                <template v-else>
                  <TierChips :tiers="profileAt(f.path)!.tiers" />
                  <span v-if="roleHint(profileAt(f.path)!)" class="muted role">{{ roleHint(profileAt(f.path)!) }}</span>
                </template>
              </td>
              <td class="row-actions">
                <button type="button" class="ghost" :disabled="busy" @click="openData(f.path)">열기</button>
                <button v-if="canAppend" type="button" class="ghost" :disabled="busy" @click="appendData(f.path)">덧붙이기</button>
              </td>
            </tr>
          </tbody>
        </table>
      </Fold>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="model && counts">
      <section class="review">
        <h2>{{ fileName }}</h2>
        <p class="stats">
          {{ model.schema }} · {{ model.siteName || '(대지 이름 없음)' }} ›
          {{ model.buildingName || '(건물 이름 없음)' }}
        </p>

        <!-- 출처 표. 아래 숫자·표·3D 색에 붙는 꼬리표가 무엇을 뜻하는지 한 줄로 먼저 말한다. -->
        <p class="src-key">
          <Src kind="bim" /> 파일에 적힌 그대로
          <Src kind="calc" /> BIM 의 좌표·형상으로 계산
          <Src kind="dict" /> 이름 사전·흐름 규칙(도메인 지식)으로 만듦
        </p>

        <!-- PRD #6 의 임포트 결과 검토 항목이다. 무엇이 만들어졌는지 숫자로 먼저 본다. -->
        <ul class="tiles">
          <li><b>{{ counts.storeys }}</b><span>층</span><Src kind="bim" /></li>
          <li><b>{{ counts.spaces }}</b><span>물리존</span><Src kind="bim" /></li>
          <li><b>{{ counts.walls }}</b><span>벽</span><Src kind="bim" /></li>
          <li><b>{{ counts.doors }}</b><span>문</span><Src kind="bim" /></li>
          <li><b>{{ counts.windows }}</b><span>창문</span><Src kind="bim" /></li>
          <li><b>{{ counts.loadBearingWalls }}</b><span>내력벽</span><Src kind="bim" /></li>
          <!-- 설비를 하나로 세면 대수가 부푼다. 실측에서 85%가 덕트·배관이었다.
               Proxy 는 IFC 가 설비라고 말하지 않은 것을 사전이 설비로 받은 것이라 따로 센다. -->
          <li :class="{ wide: proxyDevices.ported + proxyDevices.named > 0 }">
            <b>{{ counts.devices }}</b><span>기기</span><Src kind="bim" />
            <small v-if="proxyDevices.ported + proxyDevices.named > 0">
              그중 Proxy
              <template v-if="proxyDevices.ported">포트 {{ proxyDevices.ported }} <Src kind="calc" /></template>
              <template v-if="proxyDevices.named">이름 {{ proxyDevices.named }} <Src kind="dict" /></template>
            </small>
          </li>
          <li><b>{{ counts.conduits }}</b><span>덕트·배관</span><Src kind="bim" /></li>
          <li><b>{{ counts.systems }}</b><span>계통</span><Src kind="bim" /></li>
          <li :class="{ wide: connectionSources.geometry > 0 && connectionSources.port > 0 }">
            <b>{{ counts.connections }}</b><span>연결</span>
            <template v-if="connectionSources.geometry === 0"><Src kind="bim" /></template>
            <template v-else-if="connectionSources.port === 0"><Src kind="calc" /></template>
            <small v-else>포트 {{ connectionSources.port }} <Src kind="bim" /> · 형상 {{ connectionSources.geometry }} <Src kind="calc" /></small>
          </li>
          <li><b>{{ counts.directedConnections }}</b><span>흐름 방향</span><Src kind="bim" /></li>
          <li v-if="ruleReport && ruleReport.oriented > 0">
            <b>{{ ruleReport.oriented }}</b><span>규칙 방향</span><Src kind="dict" />
          </li>
        </ul>

        <!-- 건축과 설비가 다른 파일일 때. 편집을 시작한 뒤에는 닫는다(canAppend 주석 참조). -->
        <div v-if="canAppend" class="append">
          <label class="ghost">
            파일 덧붙이기
            <input type="file" accept=".ifc" :disabled="busy" @change="onAppendPick" />
          </label>
          <span class="hint">건축과 설비가 다른 파일이면 합쳐야 설비의 소속 물리존이 나옵니다.</span>
        </div>

        <TierChips :tiers="currentTiers" />

        <ul v-if="mergeLines.length" class="merge">
          <li class="merge-src"><Src kind="calc" /> 두 파일을 층 이름·높이와 좌표로 맞춰 합쳤습니다.</li>
          <li v-for="line in mergeLines" :key="line">{{ line }}</li>
        </ul>

        <ul v-if="warnings.length" class="warnings">
          <li v-for="w in warnings" :key="w">{{ w }}</li>
        </ul>
      </section>

      <section class="viewport">
        <canvas ref="canvas"></canvas>

        <!-- 계통 범례. 색이 스물이면 색만으로는 못 고르니, 여기서 짚는 쪽이 주된 길이다. -->
        <div v-if="legend.length" class="legend">
          <h3>
            계통 {{ legend.length }}
            <span v-if="legend[0].source === 'property'" class="tag">System Name 속성</span>
            <span v-else class="tag">IfcSystem</span>
            <Src kind="bim" />
          </h3>
          <ul>
            <li v-for="s in legend" :key="s.id">
              <button
                type="button"
                :class="{ on: s.id === selectedSystemId }"
                :aria-pressed="s.id === selectedSystemId"
                @click="toggleSystem(s.id)"
              >
                <i :style="{ background: s.color }"></i>
                <span class="name">{{ s.name }}</span>
                <span class="mono muted">{{ s.count }}</span>
              </button>
            </li>
          </ul>
        </div>

        <!-- 3D 색이 무엇을 뜻하는지. 진한 색은 BIM 포트가 말한 흐름, 옅은 색은 규칙으로 정한 흐름이다. -->
        <ul v-if="selected" class="color-key">
          <li><i :style="{ background: hex(PICK_COLORS.upstream) }"></i>상류 <Src kind="bim" /></li>
          <li><i :style="{ background: hex(PICK_COLORS.downstream) }"></i>하류 <Src kind="bim" /></li>
          <template v-if="showRules && tracedRules">
            <li><i :style="{ background: hex(PICK_COLORS.ruleUpstream) }"></i>상류 <Src kind="dict" /></li>
            <li><i :style="{ background: hex(PICK_COLORS.ruleDownstream) }"></i>하류 <Src kind="dict" /></li>
          </template>
          <li><i :style="{ background: hex(PICK_COLORS.linked) }"></i>방향 모름</li>
        </ul>

        <p v-if="counts.equipment > 0" class="hint pick-hint">
          {{
            selectedSystemId
              ? '계통 하나만 켜 두었습니다. 다시 누르면 전체로 돌아갑니다.'
              : '설비·배관을 클릭하면 이어진 것들이 색으로 뜹니다. 계통은 오른쪽 범례에서 고릅니다.'
          }}
        </p>
      </section>

      <!-- 고른 설비의 연결. 상류·하류를 아는지 모르는지를 여기서 분명히 말한다. -->
      <section v-if="selected" class="picked">
        <div class="picked-head">
          <div>
            <h3>{{ selected.name || '(이름 없음)' }}</h3>
            <p class="stats">
              <template v-if="kindLabel(selected)">{{ kindLabel(selected) }} <Src kind="dict" /> · </template>
              {{ selected.ifcClass }} <Src kind="bim" />
              <template v-if="roleLabel(selected.role)"> · {{ roleLabel(selected.role) }} <Src :kind="roleSrc(selected)" /></template> ·
              {{ selected.systemId ? systemById.get(selected.systemId)?.name : '(계통 없음)' }}
              <Src v-if="selected.systemId" kind="bim" /> ·
              {{ spaceNameOf(selected.spaceId) }}
              <Src v-if="selected.spaceId" :kind="spaceSrc(selected)" />
            </p>
          </div>
          <div class="picked-actions">
            <button type="button" class="ghost" @click="frameNetwork">연결망에 맞추기</button>
            <button type="button" class="ghost" @click="select(null)">선택 해제</button>
          </div>
        </div>

        <ul class="flow">
          <li class="upstream">
            <b>{{ traced?.upstream.size ?? 0 }}</b><span>상류</span><Src kind="bim" />
          </li>
          <li class="downstream">
            <b>{{ traced?.downstream.size ?? 0 }}</b><span>하류</span><Src kind="bim" />
          </li>
          <li class="linked">
            <b>{{ traced?.linked.size ?? 0 }}</b><span>이어짐 · 방향 모름</span>
          </li>
        </ul>

        <!-- 규칙 방향. 위 숫자는 BIM 포트가 말한 것만이고, 여기부터가 계통·설비 종류로 정한 것이다. -->
        <div v-if="tracedRules" class="rule-box">
          <p>
            <Src kind="dict" /> 규칙 방향을
            넣으면 상류 <b>{{ tracedRules.upstream.size }}</b> · 하류 <b>{{ tracedRules.downstream.size }}</b> ·
            방향 모름 <b>{{ tracedRules.linked.size }}</b>
            <label class="rule-toggle">
              <input v-model="showRules" type="checkbox" />
              3D 에 규칙 방향도 칠하기
            </label>
          </p>
          <p v-if="selectedRule" class="rule-system">
            계통 <b>{{ selectedRule.name }}</b><template v-if="selectedRule.kind"> ({{ selectedRule.kind }})</template>:
            규칙으로 방향을 준 연결 {{ selectedRule.count }}개.
            <template v-if="selectedRule.pct !== null">
              같은 규칙을 포트가 방향을 말한 연결 {{ selectedRule.checked }}개에 대 보면
              <b :class="{ low: selectedRule.pct < 80 }">{{ selectedRule.pct }}%</b> 가 맞는다.
            </template>
            <template v-else> 포트가 방향을 말한 연결이 없어 대 볼 수 없다.</template>
            <button
              v-if="!selectedRule.confirmed"
              type="button"
              class="ghost"
              :disabled="selectedRule.count === 0"
              @click="confirmRule(selectedRule.systemId, selectedRule.name)"
            >
              이 계통 방향 확정
            </button>
            <span v-else class="confirmed">확정함 · brick:feeds 로 나갑니다</span>
          </p>
          <p v-if="selectedRule && selectedRule.pct !== null && selectedRule.pct < 80" class="hint">
            일치율이 낮습니다. 확정하기 전에 3D 에서 흐름을 확인하세요.
          </p>
        </div>

        <p v-if="selectedNeighbors.length === 0" class="hint">
          이 설비에 붙은 연결이 없습니다.
        </p>
        <table v-else class="neighbors">
          <tbody>
            <tr v-for="(n, i) in selectedNeighbors" :key="`${n.id}-${i}`">
              <td :class="['rel', n.rule ? n.rule.relation : n.relation]">
                <template v-if="n.rule">{{ n.rule.relation === 'upstream' ? '상류' : '하류' }}</template>
                <template v-else>{{ n.relation === 'upstream' ? '상류' : n.relation === 'downstream' ? '하류' : '연결' }}</template>
              </td>
              <td>
                <button type="button" class="link" @click="select(n.id)">{{ n.name }}</button>
              </td>
              <td class="muted">
                <template v-if="n.source === 'port'">포트 <Src kind="bim" /></template>
                <template v-else>{{ sourceLabel(n.tolerance) }} <Src kind="calc" /></template>
                <template v-if="n.rule">
                  · {{ n.rule.confirmed ? '규칙 방향(확정)' : '규칙 방향(추정)' }} <Src kind="dict" />
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 3D 아래는 전부 접을 수 있다. 행이 많은 목록은 처음부터 접혀 있다(SMALL).
           파일이 바뀌면(key) 접힘 상태도 그 파일 기준으로 다시 정한다. -->
      <div :key="fileName" class="folds">
        <Fold title="층별 요약" :meta="`${model.storeys.length}개 층`" class="storeys">
          <table>
            <thead>
              <tr>
                <th>층</th>
                <th class="num">높이</th>
                <th>물리존</th>
                <th class="num">넓이 합</th>
                <th class="num">벽</th>
                <th class="num">설비</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in model.storeys" :key="s.id">
                <td>{{ s.name }}</td>
                <td class="num mono">{{ s.elevation.toFixed(2) }} m</td>
                <!-- 한 층에 방이 수십 개면 이름이 줄을 넘친다. 한 줄로 자르고 전체는 툴팁으로. -->
                <td class="names" :title="s.spaces.map((x) => x.longName || x.name).join(', ')">
                  <template v-if="s.spaces.length">
                    <span class="muted">{{ s.spaces.length }}개 · </span>{{ s.spaces.map((x) => x.longName || x.name).join(', ') }}
                  </template>
                  <template v-else>—</template>
                </td>
                <td class="num mono">
                  {{ s.spaces.reduce((n, x) => n + x.areaM2, 0).toFixed(1) }} ㎡
                </td>
                <!-- 두께가 한두 종류면 그대로 보이고, 많으면 종류 수만 보이고 목록은 툴팁으로 본다.
                     성수는 한 층에 10종이 넘어 표가 오른쪽으로 넘쳤다. -->
                <td class="num mono" :title="wallThicknessOf(s)">
                  {{ s.walls.length }}<template v-if="s.walls.some((w) => w.thickness !== null)">
                    <span class="muted"> · {{ wallThicknessLabel(s) }}</span>
                  </template>
                </td>
                <td class="num mono">{{ s.equipment.length }}</td>
              </tr>
            </tbody>
          </table>
        </Fold>

        <Fold
          v-if="kindSummary"
          title="종류와 관제점 후보"
          :meta="`기기 종류 ${kindSummary.kinds.length}종 · 모름 ${kindSummary.unknown}대 · 관제점 후보 ${kindSummary.points.reduce((n, k) => n + k.count, 0)}`"
          :default-open="false"
          class="kinds"
        >
          <p class="hint">
            <Src kind="dict" /> 이 칸은 전부 사전에서 나왔습니다.
            이름(Revit 패밀리 이름)을 사전으로 읽어 종류와 Brick 클래스를 붙였습니다. 사전에 없는 이름은 종류를 붙이지 않습니다.
          </p>
          <div class="kind-grid">
            <table>
              <thead>
                <tr><th>기기 종류</th><th class="num">대수</th><th>Brick</th></tr>
              </thead>
              <tbody>
                <tr v-for="k in kindSummary.kinds" :key="k.label">
                  <td>{{ k.label }}</td>
                  <td class="num mono">{{ k.count }}</td>
                  <td class="muted mono">{{ k.brick }}</td>
                </tr>
                <tr v-if="kindSummary.unknown">
                  <td class="muted">(사전에 없음)</td>
                  <td class="num mono">{{ kindSummary.unknown }}</td>
                  <td class="muted mono">ex:</td>
                </tr>
              </tbody>
            </table>
            <div>
              <h4>관제점 후보 (F13)</h4>
              <p v-if="!kindSummary.points.length" class="empty">감지기·CCTV 가 없습니다.</p>
              <ul v-else class="plain">
                <li v-for="k in kindSummary.points" :key="k.label">
                  {{ k.label }} <b class="mono">{{ k.count }}</b>
                  <span class="muted"> · 소속 방 {{ k.located }}</span>
                </li>
              </ul>
              <p class="hint">위치와 소속 방은 나와 있습니다. 관제점 ID 는 BAS 에서 받아 이어야 합니다.</p>
              <h4>방 종류</h4>
              <p class="muted">{{ kindSummary.roomsKnown }} / {{ kindSummary.roomsTotal }} 개를 알아봤습니다.</p>
              <ul class="plain">
                <li v-for="[label, n] in kindSummary.rooms" :key="label">{{ label }} <b class="mono">{{ n }}</b></li>
              </ul>
              <h4>계통 종류</h4>
              <ul class="plain">
                <li v-for="[label, n] in kindSummary.systems" :key="label">{{ label }} <b class="mono">{{ n }}</b></li>
              </ul>
              <p v-if="ruleReport && ruleReport.agree + ruleReport.disagree > 0" class="hint">
                규칙 방향 {{ ruleReport.oriented }}개. 같은 규칙을 포트 방향 {{ ruleReport.agree + ruleReport.disagree }}개에 대 보면
                {{ Math.round((ruleReport.agree / (ruleReport.agree + ruleReport.disagree)) * 100) }}% 가 맞습니다.
              </p>
            </div>
          </div>
        </Fold>

        <!-- 편집. 3D 조작 대신 값을 직접 고친다. PoC 에서 확인할 것은 조작감이 아니라
             한 번의 편집이 온톨로지의 어느 관계를 바꾸는가이기 때문이다. -->
        <section class="editor">
          <div v-if="counts.spaces + counts.equipment > SMALL" class="edit-filter">
            <label>
              층
              <select v-model="editStorey">
                <option value="">전체</option>
                <option v-for="s in model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </label>
            <label class="grow">
              이름
              <input v-model="editQuery" type="search" placeholder="물리존·설비 이름이나 종류" />
            </label>
            <span class="muted">아래 세 목록에 같이 걸립니다.</span>
          </div>

          <Fold title="물리존 이름 (E1)" :meta="`${counts.spaces}개`" :default-open="counts.spaces <= SMALL">
            <ul class="rows">
              <li v-for="{ storey, space } in editSpaces.slice(0, editLimit)" :key="space.id">
                <label class="row">
                  <span class="tag mono">{{ storey.name }}</span>
                  <input
                    type="text"
                    :value="space.longName"
                    @change="applyRename(space.id, ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </li>
            </ul>
            <p v-if="editSpaces.length > editLimit" class="hint more">
              {{ editSpaces.length }}개 중 {{ editLimit }}개만 보입니다. 층이나 이름으로 좁히거나
              <button type="button" class="link" @click="editLimit += EDIT_LIMIT">더 보기</button>
            </p>
          </Fold>

          <Fold title="물리존 경계 (E2)" :meta="`${counts.spaces}개`" :default-open="counts.spaces <= SMALL">
            <p class="hint">
              꼭짓점을 고치면 넓이가 다시 계산되고, 경계 밖으로 밀려난 설비의 소속이 바뀝니다.
            </p>
            <table class="equipment">
              <thead>
                <tr>
                  <th>물리존</th>
                  <th class="num">넓이</th>
                  <th>꼭짓점 (x, y)</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="{ space: sp } in editSpaces.slice(0, editLimit)" :key="sp.id">
                  <td>{{ sp.longName || sp.name }}</td>
                  <td class="num mono">{{ sp.areaM2.toFixed(1) }} ㎡</td>
                  <td class="vertices">
                    <!-- 닫는 점은 첫 점과 같으므로 보여 주지 않는다. 두 번 고치게 된다. -->
                    <span v-for="(p, i) in sp.footprint.slice(0, -1)" :key="i" class="vertex">
                      <input
                        class="coord mono"
                        type="number"
                        step="0.1"
                        :value="p[0]"
                        @change="applyVertex(sp.id, i, 0, ($event.target as HTMLInputElement).value, p)"
                      />
                      <input
                        class="coord mono"
                        type="number"
                        step="0.1"
                        :value="p[1]"
                        @change="applyVertex(sp.id, i, 1, ($event.target as HTMLInputElement).value, p)"
                      />
                    </span>
                    <span v-if="!sp.footprint.length" class="muted">외곽선 없음</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="editSpaces.length > editLimit" class="hint more">
              {{ editSpaces.length }}개 중 {{ editLimit }}개만 보입니다. 층이나 이름으로 좁히거나
              <button type="button" class="link" @click="editLimit += EDIT_LIMIT">더 보기</button>
            </p>
          </Fold>
          <p v-if="selfIntersecting" class="error" role="alert">
            경계가 자기 자신과 교차합니다. 이 상태에서는 넓이와 소속 판정이 뜻을 잃습니다.
          </p>

          <Fold
            title="설비 위치와 소속 (E5 · E6)"
            :meta="`기기 ${counts.devices} · 덕트·배관 ${counts.conduits}`"
            :default-open="counts.equipment <= SMALL"
          >
            <table class="equipment">
              <thead>
                <tr>
                  <th>설비</th>
                  <th>종류</th>
                  <th class="num">x</th>
                  <th class="num">y</th>
                  <th class="num">z</th>
                  <th></th>
                  <th>소속 물리존</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="e in editEquipment.slice(0, editLimit)" :key="e.id" :class="{ chosen: e.id === selectedId }">
                  <td>
                    <!-- 표에서 고른 것과 3D 에서 고른 것이 같은 선택이다. 두 화면이 따로 놀면
                         설비 목록에서 찾은 것을 3D 에서 다시 찾아야 한다. -->
                    <button type="button" class="link" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
                  </td>
                  <td class="muted">
                    {{ e.ifcClass }}<template v-if="kindLabel(e)"> · {{ kindLabel(e) }} <Src kind="dict" /></template>
                  </td>
                  <td v-for="axis in [0, 1, 2]" :key="axis" class="num">
                    <input
                      class="coord mono"
                      type="number"
                      step="0.1"
                      :value="e.position ? e.position[axis] : ''"
                      placeholder="—"
                      @change="applyMove(e.id, axis as 0 | 1 | 2, ($event.target as HTMLInputElement).value, e.position)"
                    />
                  </td>
                  <!-- 좌표 출처. 배치점이 형상에서 떨어져 형상 중심을 쓴 것(계산)과 사람이 옮긴 것(편집)을 가른다. -->
                  <td><Src v-if="e.position" :kind="positionSrc(e)" /></td>
                  <td :class="{ muted: !e.spaceId }">
                    {{ spaceNameOf(e.spaceId) }}
                    <Src v-if="e.spaceId" :kind="spaceSrc(e)" />
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="editEquipment.length > editLimit" class="hint more">
              {{ editEquipment.length }}대 중 {{ editLimit }}대만 보입니다. 층이나 이름으로 좁히거나
              <button type="button" class="link" @click="editLimit += EDIT_LIMIT">더 보기</button>
            </p>
            <p v-if="counts.equipment === 0" class="empty">이 BIM 에는 설비가 없습니다.</p>
          </Fold>

          <h3>바뀌는 것 (PRD #21)</h3>
          <ul v-if="report.length || areaChanges.length || confirmations.length" class="report">
            <li v-for="c in report" :key="c.equipmentId">
              {{ c.equipmentName }}:
              <b>{{ spaceNameOf(c.fromSpaceId) }}</b> → <b>{{ spaceNameOf(c.toSpaceId) }}</b>
            </li>
            <li v-if="areaSummary" class="muted">{{ areaSummary }}</li>
            <li v-for="(c, i) in confirmations" :key="`rule-${i}`">
              계통 <b>{{ c.systemName }}</b>: 규칙 방향 {{ c.count }}개를 확정했습니다(brick:feeds 로 나갑니다)
            </li>
          </ul>
          <p v-else class="empty">아직 바뀐 소속 관계가 없습니다.</p>
        </section>
      </div>

      <section class="actions">
        <button type="button" @click="exportGeoJSON">기하 내보내기 (GeoJSON)</button>
        <button type="button" @click="exportTTL">의미 내보내기 (Brick TTL)</button>
        <p class="note">
          두 파일은 같은 id 로 이어집니다. 기하는 GeoJSON 이 갖고, 설비와 계통은 TTL 이 갖습니다.
          TTL 의 설비·방 클래스는 <Src kind="dict" /> 에서 나오고, 규칙 방향은 확정한 계통만 들어갑니다.
        </p>
      </section>
    </template>
    <!-- 진행 표시. 스크롤 위치와 상관없이 보이도록 화면 아래에 띄운다. -->
    <div v-if="progress" class="progress-toast" role="status" aria-live="polite">
      <div class="progress-head">
        <span>{{ progressTitle }}</span>
        <span class="muted mono">{{ elapsed }}초</span>
      </div>
      <div class="bar" :class="{ indeterminate: progressPct === null }">
        <i :style="progressPct !== null ? { width: `${progressPct}%` } : undefined"></i>
      </div>
      <div v-if="progressDetail" class="muted progress-detail mono">{{ progressDetail }} · {{ progressPct }}%</div>
    </div>
  </main>
</template>
