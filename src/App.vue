<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, triggerRef, watch } from 'vue'
import type { MeshMap } from './lib/ifc/import'
import { countOf, isConduit, type Connection, type Equipment, type Model, type Vec2, type Vec3 } from './lib/model'
import { mergeModels, type MergeReport } from './lib/merge'
import { profileOf, type Profile } from './lib/profile'
import TierChips from './components/TierChips.vue'
import Fold from './components/Fold.vue'
import Src from './components/Src.vue'
import { neighbors, trace, traceBySystem, TOLERANCE, type Neighbor } from './lib/topology'
import { airServices, servedSpaces } from './lib/served'
import { completenessChecks } from './lib/checks'
import { confirmSystemFlow, inferFlowByRules, withInferred, type RuleReport } from './lib/flow-rules'
import { EQUIPMENT_KINDS, equipmentKind, roomKind, systemKind } from './lib/kinds'
import { modelToGeoJSON } from './lib/export/geojson'
import { modelToTTL } from './lib/export/ttl'
import {
  ARROW_COLORS,
  createViewer,
  PICK_COLORS,
  systemColors,
  toScene,
  WALL_COLORS,
  type Arrow,
  type Viewer,
} from './lib/viewer'
import {
  flowEdits,
  moveEquipment,
  moveEquipmentToStorey,
  moveSpaceVertex,
  renameSpace,
  setFlowDirection,
  summarize,
  wouldSelfIntersect,
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
/** 문이 잇는 방(방-문-방 그래프). GeoJSON 문 feature 의 connects 로 나간다. */
const doorLinks = computed(() => {
  const doors = (model.value?.storeys ?? []).flatMap((s) => s.openings).filter((o) => o.kind === 'door' && o.connects)
  return {
    total: doors.length,
    two: doors.filter((d) => d.connects!.length >= 2).length,
    bim: doors.some((d) => d.connectsSource === 'bim'),
    calc: doors.some((d) => d.connectsSource === 'calc'),
  }
})

// --- 보기 / 편집 ---------------------------------------------------------------
//
// 온톨로지를 둘러보는 사람과 고치는 사람이 보는 화면을 나눈다. 보기는 3D 와 연결을 넓게 보이고 고치는 손잡이를
// 전부 숨긴다. 편집은 고칠 수 있는 것(물리존 이름·경계, 설비 위치, 흐름 방향 확정·지정)을 드러내고, 바뀐 것의
// 수와 내보내기를 화면 위에 붙여 둔다. 편집한 것은 모드를 바꿔도 남는다(보기로 돌아가도 리포트는 그대로다).
// 고른 모드는 이 브라우저에만 기억한다.
type Mode = 'view' | 'edit'
const mode = ref<Mode>(
  (() => {
    try {
      return localStorage.getItem('oe-mode') === 'edit' ? 'edit' : 'view'
    } catch {
      return 'view'
    }
  })(),
)
watch(mode, (m) => {
  try {
    localStorage.setItem('oe-mode', m)
  } catch {
    // 못 써도 이번 창에서는 그대로 돈다.
  }
})
const editing = computed(() => mode.value === 'edit')

// 문·창 형상도 읽을까. 온톨로지에는 필요 없고 로봇 경로(문 자리·문이 잇는 방)용이라 기본은 끈다.
// 파일을 열 때 정하므로, 바꾸면 다음에 여는 파일부터 적용된다. 이 브라우저에만 기억한다.
const readOpenings = ref(
  (() => {
    try {
      return localStorage.getItem('oe-read-openings') === '1'
    } catch {
      return false
    }
  })(),
)
watch(readOpenings, (on) => {
  try {
    localStorage.setItem('oe-read-openings', on ? '1' : '0')
  } catch {
    // 못 써도 이번 창에서는 그대로 돈다.
  }
})
/** 편집 막대에 보이는 바뀐 것의 수. 리포트(바뀌는 것)에 적히는 줄과 같은 단위로 센다. */
const changeCount = computed(
  () => report.value.length + areaLines.value.length + confirmations.value.length + flowEditLines.value.length,
)

// 3D 에 내력벽을 켜고 끈다. 내력 여부를 모르는 벽도 같이 켠다(모름은 아니오가 아니다).
const showWalls = ref(false)
watch(showWalls, (on) => viewer?.setWallsVisible(on))
// 3D 에 그려지는 벽만 센다. 형상이 없는 벽(손으로 쓴 픽스처, COBie 판본)은 켜도 보일 것이 없다.
// meshes 는 반응형이 아니지만 늘 model 과 같이 바뀌므로 model 을 따라 다시 센다.
const drawnWalls = computed(() => {
  if (!model.value) return null
  let loadBearing = 0
  let unknown = 0
  for (const storey of model.value.storeys) {
    for (const wall of storey.walls) {
      if (wall.loadBearing === false || !meshes.has(wall.id)) continue
      if (wall.loadBearing) loadBearing++
      else unknown++
    }
  }
  return loadBearing + unknown > 0 ? { loadBearing, unknown } : null
})

// --- 편집 -------------------------------------------------------------------
//
// 편집은 모델을 그 자리에서 고친다. shallowRef 는 안쪽 변화를 못 보므로 편집한 뒤에
// triggerRef 로 알린다. 모델을 통째로 복사하면 3D 가 매번 다시 만들어진다.
const changes = ref<Change[]>([])
const report = computed(() => summarize(changes.value))

// 넓이는 편집할 때마다 조금씩 움직인다. 매번 한 줄씩 쌓지 말고 처음과 끝만 적는다.
const areaLines = computed(() => {
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
const areaSummary = computed(() => areaLines.value.join(' · '))

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

// --- 3D 다시 그리기 --------------------------------------------------------------
//
// 편집은 모델을 그 자리에서 고치고 triggerRef 로 알린다. 그때마다 3D 를 통째로 다시 만들면 성수에서
// 수십 초 멈추고 시점도 건물 전체로 튄다. 그래서 새 모델을 열었을 때만 새로 그리고, 편집 뒤에 무엇을
// 다시 그릴지는 편집하는 쪽이 정한다. 다시 그린 뒤에는 강조·손잡이·화살표를 다시 넘겨야 해서 판을 센다.
const sceneVersion = ref(0)
function redraw() {
  if (!viewer || !model.value) return
  viewer.setModel(model.value, meshes, { keepView: true })
  sceneVersion.value++
}

/**
 * 옮긴 설비의 형상을 같이 옮긴다. 형상은 임포트 때의 자리를 들고 있어서, 안 옮기면 다시 그릴 때
 * 예전 자리로 튄다. 형상이 없는 설비(상자로 찍는 것)는 좌표에서 바로 그리므로 할 일이 없다.
 */
function shiftMesh(id: string, from: Vec3 | null, to: Vec3 | null) {
  const mesh = meshes.get(id)
  if (!mesh || !from || !to) return
  const [dx, dy, dz] = toScene([to[0] - from[0], to[1] - from[1], to[2] - from[2]])
  if (!dx && !dy && !dz) return
  const positions = mesh.positions.slice()
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += dx
    positions[i + 1] += dy
    positions[i + 2] += dz
  }
  meshes.set(id, { ...mesh, positions })
}

/** 3D 에서 끈 값은 센티미터로 자른다. 마우스로 1mm 를 뜻하고 놓는 사람은 없다. */
const cm = (v: number) => Math.round(v * 100) / 100

/** 설비를 옮기는 길은 표(숫자)와 3D(끌기) 둘이지만 하는 일은 하나다. 소속 재판정은 edit.ts 가 한다. */
function relocate(equipmentId: string, to: Vec3): boolean {
  if (!model.value) return false
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  const change = moveEquipment(model.value, equipmentId, to)
  if (!change) return false
  shiftMesh(equipmentId, before, to)
  changes.value = [...changes.value, change]
  triggerRef(model)
  return true
}

function applyMove(equipmentId: string, axis: 0 | 1 | 2, raw: string, current: readonly number[] | null) {
  const value = Number(raw)
  if (!model.value || !Number.isFinite(value)) return

  // 미배치 설비는 기준 좌표가 없다. 한 축만 받아도 나머지를 0 으로 채워 배치한다(E6).
  const base: [number, number, number] = current ? [current[0], current[1], current[2]] : [0, 0, 0]
  base[axis] = value

  if (relocate(equipmentId, base)) redraw()
}

/** 3D 에서 고른 설비를 끌어 놓았다. 3D 는 이미 놓은 자리에 그려져 있어 다시 만들지 않는다. */
function dropEquipment(equipmentId: string, delta: Vec3) {
  const position = equipmentById.value.get(equipmentId)?.position
  if (!position) return
  relocate(equipmentId, [cm(position[0] + delta[0]), cm(position[1] + delta[1]), position[2]])
  // 화살표와 강조는 옮긴 자리 기준으로 다시 넘긴다.
  sceneVersion.value++
}

/** 설비를 다른 층으로(E6). 높이도 두 층 바닥의 차만큼 옮기므로 3D 를 다시 그린다. */
function moveToStorey(equipmentId: string, storeyId: string) {
  if (!model.value) return
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  const change = moveEquipmentToStorey(model.value, equipmentId, storeyId)
  if (!change) return
  shiftMesh(equipmentId, before, equipmentById.value.get(equipmentId)?.position ?? null)
  changes.value = [...changes.value, change]
  storeyMoved.value = new Set([...storeyMoved.value, equipmentId])
  triggerRef(model)
  redraw()
}
/** 사람이 층을 바꾼 설비. 층 칸의 출처를 BIM 에서 편집으로 바꾼다. */
const storeyMoved = ref(new Set<string>())

const storeyOf = (equipmentId: string) =>
  model.value?.storeys.find((s) => s.equipment.some((e) => e.id === equipmentId)) ?? null

/** 3D 편집이 받아들이지 않은 것을 한 줄로 알린다. 조용히 제자리로 돌리면 왜 안 됐는지 모른다. */
const editNotice = ref('')

// 경계 편집은 넓이와 설비 소속을 동시에 흔든다. 두 변화를 같은 자리에서 보여 준다.
const areaChanges = ref<BoundaryChange[]>([])
const selfIntersecting = computed(() => areaChanges.value.some((c) => c.selfIntersecting))

function applyVertex(spaceId: string, index: number, axis: 0 | 1, raw: string, current: readonly number[]) {
  const value = Number(raw)
  if (!model.value || !Number.isFinite(value)) return

  const point: [number, number] = [current[0], current[1]]
  point[axis] = value

  recordBoundary(moveSpaceVertex(model.value, spaceId, index, point))
}

function recordBoundary(change: BoundaryChange | null) {
  if (!change || !model.value) return
  areaChanges.value = [...areaChanges.value, change]
  changes.value = [...changes.value, ...change.equipment]
  triggerRef(model)
  // 설비는 그대로다. 판만 다시 만든다.
  viewer?.updateSpaces(model.value)
  sceneVersion.value++
}

/**
 * 3D 에서 꼭짓점을 끌어 놓았다. 표에서 숫자로 고칠 때와 달리 **자기 교차가 되는 자리에는 놓지 않는다** —
 * 마우스로 끌다 엇갈린 것은 뜻한 모양이 아니고, 놓은 뒤에 알리면 넓이와 소속이 이미 뜻 없는 값으로 바뀐 뒤다.
 */
function dropVertex(spaceId: string, index: number, raw: Vec2) {
  if (!model.value) return
  const to: Vec2 = [cm(raw[0]), cm(raw[1])]
  if (wouldSelfIntersect(model.value, spaceId, index, to)) {
    editNotice.value = '경계가 자기 자신과 엇갈리는 자리라 놓지 않았습니다. 꼭짓점을 제자리로 돌렸습니다.'
    // 끌던 손잡이를 원래 고리로 다시 그린다.
    sceneVersion.value++
    return
  }
  editNotice.value = ''
  recordBoundary(moveSpaceVertex(model.value, spaceId, index, to))
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

let drawn: Model | null = null
watch([model, canvas], ([m, el]) => {
  if (!m || !el) return
  if (!viewer) {
    viewer = createViewer(el)
    viewer.onPick((id) => {
      selectedId.value = id
    })
    viewer.onPickSpace((id) => {
      selectedSpaceId.value = id
      if (id) {
        selectedId.value = null
        selectedSystemId.value = null
      }
    })
    viewer.onEquipmentMove(dropEquipment)
    viewer.onVertexMove(dropVertex)
    viewer.onArrowClick(cycleFlow)
    viewer.setWallsVisible(showWalls.value)
    viewer.setEditMode(editing.value)
  }
  // 편집이 보낸 갱신(triggerRef)으로는 다시 만들지 않는다(redraw 참조). 새 모델일 때만이다.
  if (m === drawn) return
  drawn = m
  viewer.setModel(m, meshes)
  sceneVersion.value++
})

watch(editing, (on) => {
  viewer?.setEditMode(on)
  editNotice.value = ''
  // 물리존 고르기는 편집 모드에만 있다(보기 모드에서 바닥을 누르면 선택 해제다).
  if (!on) selectedSpaceId.value = null
})

// --- 3D 에서 고른 물리존 (E2) ------------------------------------------------------
//
// 편집 모드에서 바닥을 누르면 그 물리존이 골라지고, 꼭짓점에 손잡이가 뜬다. 설비 선택과 배타다.
const selectedSpaceId = ref<string | null>(null)
const selectedSpace = computed(() => {
  const m = model.value
  const id = selectedSpaceId.value
  if (!m || !id) return null
  for (const storey of m.storeys) {
    const space = storey.spaces.find((s) => s.id === id)
    if (space) {
      return {
        storey,
        space,
        equipment: storey.equipment.filter((e) => e.spaceId === id),
        edited: areaChanges.value.some((c) => c.spaceId === id),
      }
    }
  }
  return null
})
watch([selectedSpace, editing, sceneVersion], () => {
  const picked = selectedSpace.value
  if (!viewer) return
  if (!picked || !editing.value) {
    viewer.setSpaceHandles(null)
    return
  }
  // 닫는 점(첫 점과 같은 끝 점)은 손잡이를 따로 두지 않는다. 첫 점을 옮기면 edit.ts 가 끝 점을 같이 옮긴다.
  const ring = picked.space.footprint
  const last = ring.at(-1)
  const closed = ring.length > 1 && !!last && ring[0][0] === last[0] && ring[0][1] === last[1]
  viewer.setSpaceHandles({ id: picked.space.id, ring: closed ? ring.slice(0, -1) : ring, elevation: picked.storey.elevation })
})

// --- 선택과 연결 -------------------------------------------------------------
const selectedId = ref<string | null>(null)

const equipmentById = computed(() => {
  const map = new Map<string, Equipment>()
  for (const storey of model.value?.storeys ?? []) for (const e of storey.equipment) map.set(e.id, e)
  return map
})

const selected = computed(() => (selectedId.value ? (equipmentById.value.get(selectedId.value) ?? null) : null))

// 방향 모름은 다음 기기에서 멈춘다(topology.ts 의 trace). 끝까지 따라가면 성수 FCU 하나가 순환수관을
// 타고 다른 FCU 들의 덕트까지 번져 1만 개가 넘게 "이어짐" 이 된다. 연결 끝이 설비 목록에 없으면 기기로 본다.
const conduitId = (id: string) => {
  const e = equipmentById.value.get(id)
  return !!e && isConduit(e.role)
}
/** "이어짐" 중 덕트·배관이 아닌 기기 수. 수천 개여도 대부분은 관이라 기기 수를 따로 말한다. */
const deviceCount = (ids: Set<string>) => [...ids].filter((id) => !conduitId(id)).length

const traced = computed(() =>
  model.value && selectedId.value ? trace(model.value.connections, selectedId.value, conduitId) : null,
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
// 사람이 정한 방향도 규칙 방향과 같은 자리(추적·3D 의 옅은 색)에 들어간다. 규칙이 하나도 없는 파일에서
// 사람이 방향을 정해도 추적에 보여야 하므로 둘 다 본다.
const hasRules = computed(() => {
  void flowVersion.value
  return !!model.value?.connections.some((c) => c.inferred || c.edited)
})

const tracedRules = computed(() => {
  void flowVersion.value
  return model.value && selectedId.value && hasRules.value
    ? trace(withInferred(model.value.connections), selectedId.value, conduitId)
    : null
})
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
//
// 포트가 방향을 말하지 않은 연결에는 사람이 정한 방향, 없으면 규칙 방향을 같이 적는다. 방향의 출처가
// 셋(BIM 포트 · 편집 · 사전)이라 글자와 색을 다르게 둔다. 같은 "하류" 로 쓰면 규칙이 짐작한 것이
// BIM 이 말한 하류처럼 읽힌다.
type NeighborRow = Neighbor & {
  name: string
  edited: 'upstream' | 'downstream' | null
  rule: { relation: 'upstream' | 'downstream'; confirmed: boolean } | null
}
const selectedNeighbors = computed((): NeighborRow[] => {
  void flowVersion.value
  if (!model.value || !selectedId.value) return []
  const id = selectedId.value
  return neighbors(model.value.connections, id).map((n) => {
    const c = n.connection
    const edited = !c.directed && c.edited ? (c.edited.from === id ? 'downstream' : 'upstream') : null
    const rule =
      !c.directed && !c.edited && c.inferred
        ? { relation: c.inferred.from === id ? ('downstream' as const) : ('upstream' as const), confirmed: c.inferred.confirmed }
        : null
    return {
      ...n,
      edited,
      rule,
      name: equipmentById.value.get(n.id)?.name || equipmentById.value.get(n.id)?.ifcClass || n.id,
    }
  })
})
const REL_LABEL = { upstream: '상류', downstream: '하류', linked: '연결' } as const
function relLabel(n: NeighborRow) {
  if (n.edited) return REL_LABEL[n.edited]
  if (n.rule) return `${REL_LABEL[n.rule.relation]}(${n.rule.confirmed ? '확정' : '추정'})`
  return REL_LABEL[n.relation]
}
function relClass(n: NeighborRow) {
  if (n.edited) return [n.edited, 'edited']
  if (n.rule) return [`rule-${n.rule.relation}`]
  return [n.relation]
}

// 포트가 방향을 말하지 않은 연결에 사람이 방향을 정한다. from 이 null 이면 정한 것을 지운다.
// 확정과 같은 이유로 모델 전체에 갱신 신호를 보내지 않고 flowVersion 만 올린다.
function setFlow(n: NeighborRow, from: string | null) {
  if (setFlowDirection(n.connection, from)) flowVersion.value++
}
// --- 3D 의 연결 화살표 ------------------------------------------------------------
//
// 편집 모드에서 고른 설비에 붙은 연결을 3D 에 화살표로 그린다. 색은 방향의 출처다 — 포트(BIM) 진하게,
// 사람이 정한 것은 액센트, 규칙(사전)은 옅은 점선, 모르는 것은 촉 없는 점선. 누르면 표의 "하류로 → 상류로 →
// 되돌리기" 를 차례로 한다. 포트가 말한 방향은 누르지 못한다.
const arrowConnections = computed((): Connection[] => {
  void flowVersion.value
  if (!editing.value || !model.value || !selectedId.value) return []
  return neighbors(model.value.connections, selectedId.value).map((n) => n.connection)
})
function arrowOf(c: Connection, key: string): Arrow {
  if (c.directed) return { key, a: c.from, b: c.to, from: c.from, source: 'port' }
  if (c.edited) return { key, a: c.from, b: c.to, from: c.edited.from, source: 'edit' }
  if (c.inferred && showRules.value) return { key, a: c.from, b: c.to, from: c.inferred.from, source: 'rule' }
  return { key, a: c.from, b: c.to, from: null, source: 'none' }
}
watch([arrowConnections, showRules, sceneVersion], () => {
  viewer?.setArrows(arrowConnections.value.map((c, i) => arrowOf(c, String(i))))
})
function cycleFlow(key: string) {
  const c = arrowConnections.value[Number(key)]
  const id = selectedId.value
  if (!c || !id) return
  if (c.directed) {
    editNotice.value = '포트(BIM)가 말한 방향은 고치지 않습니다. BIM 이 말한 것을 덮어쓰면 온톨로지를 읽는 쪽이 둘을 구별할 수 없습니다.'
    return
  }
  editNotice.value = ''
  const other = c.from === id ? c.to : c.from
  const next = !c.edited ? id : c.edited.from === id ? other : null
  if (setFlowDirection(c, next)) flowVersion.value++
}
const hasArrows = computed(() => arrowConnections.value.length > 0)

// --- 계통별로 보기 --------------------------------------------------------------
//
// 고른 기기에 붙은 덕트·배관의 계통마다 상류·하류·방향 모름을 따로 센다(topology.ts 의 traceBySystem).
// 숫자는 기기 대수이고 덕트·배관은 따로 센다. 수천 개여도 대부분은 관 조각이라, 기기 수가 엔지니어가 읽는
// 숫자다. 방향은 3D 와 같은 것을 쓴다(규칙을 켜 두면 규칙 방향까지).
const systemColor = computed(() => new Map(legend.value.map((s) => [s.id, s.color])))
const systemRows = computed(() => {
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
        name: system ? system.name || '(이름 없는 계통)' : '덕트·배관 없이 바로',
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
const flowSystemKey = ref<string | null>(null)
watch(selectedId, () => (flowSystemKey.value = null))
const flowSystemRow = computed(() => systemRows.value.find((r) => r.key === flowSystemKey.value) ?? null)
function toggleFlowSystem(key: string) {
  flowSystemKey.value = flowSystemKey.value === key ? null : key
}
const kindsText = (kinds: [string, number][]) =>
  kinds.slice(0, 3).map(([label, n]) => `${label} ${n}`).join(' · ') + (kinds.length > 3 ? ` 외 ${kinds.length - 3}종` : '')

// --- 담당 공간 -----------------------------------------------------------------
//
// 공기 원천(공조기·FCU·전열교환기·팬)마다 흐름 방향을 따라 닿는 말단과 그 말단이 있는 방(served.ts).
// 방향은 3D 와 같은 것을 쓴다. 추정이라 화면에만 보이고 내보내지 않는다.
const airServiceList = computed(() => {
  void flowVersion.value
  const m = model.value
  if (!m) return []
  return airServices(m, showRules.value && hasRules.value ? withInferred(m.connections) : m.connections)
})
const spaceStorey = computed(() => {
  const map = new Map<string, string>()
  for (const storey of model.value?.storeys ?? []) for (const sp of storey.spaces) map.set(sp.id, storey.name)
  return map
})
const selectedService = computed(() => {
  const m = model.value
  const id = selectedId.value
  const service = id ? airServiceList.value.find((s) => s.sourceId === id) : null
  if (!m || !service) return null
  return { ...service, rooms: servedSpaces(m, service) }
})
/** 건물 전체의 원천별 담당 공간. 말단이 많은 원천부터. */
const serviceSummary = computed(() => {
  const m = model.value
  if (!m) return null
  const rows = airServiceList.value
    .map((s) => {
      const rooms = servedSpaces(m, s).filter((r) => r.spaceId !== null)
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
const SERVICE_LIMIT = 200

// --- 완전성 검사 ----------------------------------------------------------------
//
// 규칙마다 통과 수와 어긴 요소(checks.ts). 규칙을 펼치면 어긴 것을 목록으로 보이고 3D 에 칠한다.
// 설비나 계통을 고르면 그쪽이 3D 색을 가져간다.
const checks = computed(() => (model.value ? completenessChecks(model.value, airServiceList.value) : []))
const openCheckKey = ref<string | null>(null)
const openCheck = computed(() => checks.value.find((c) => c.key === openCheckKey.value) ?? null)
const CHECK_LIMIT = 100
function toggleCheck(key: string) {
  openCheckKey.value = openCheckKey.value === key ? null : key
  const c = openCheck.value
  if (c && c.failed.length) {
    selectedId.value = null
    selectedSystemId.value = null
    viewer?.frame(c.failed)
  }
}

const flowEditLines = computed(() => {
  void flowVersion.value
  if (!model.value) return []
  const nameOf = (id: string) => equipmentById.value.get(id)?.name || id
  return flowEdits(model.value).map((e) => ({
    from: nameOf(e.from),
    to: nameOf(e.to),
    note: e.rule === 'reversed' ? '규칙 방향과 반대' : e.rule === 'same' ? '규칙 방향과 같음' : '규칙이 방향을 못 정한 연결',
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

watch([selectedId, selectedSystemId, model, showRules, flowVersion, flowSystemRow, openCheck, selectedSpace, sceneVersion], () => {
  if (!viewer) return

  const t = traced.value
  if (selectedId.value && t) {
    // 포트가 말한 상류·하류는 진한 색, 규칙(사전)으로만 정해진 것은 옅은 색이다. 한 색으로 섞어 칠하면
    // 3D 만 보고는 BIM 이 말한 흐름인지 우리가 정한 흐름인지 알 수 없다.
    const r = showRules.value ? tracedRules.value : null
    // 계통별 표에서 한 줄을 골랐으면 그 계통의 추적에 든 것만 남긴다.
    const only = flowSystemRow.value?.ids
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

  // 고른 물리존에 속한 설비. 경계를 끄는 동안 무엇이 드나드는지 보인다.
  const space = selectedSpace.value
  if (space) {
    viewer.setHighlight({
      selected: null,
      upstream: new Set(),
      downstream: new Set(),
      linked: new Set(space.equipment.map((e) => e.id)),
      keepColor: true,
    })
    return
  }

  // 펼친 완전성 규칙이 있으면 어긴 것을 칠한다. 어디에 몰려 있는지가 먼저 보여야 무엇부터 고칠지 정한다.
  const check = openCheck.value
  if (check && !check.skipped && check.failed.length) {
    viewer.setHighlight({ selected: null, upstream: new Set(), downstream: new Set(), linked: new Set(check.failed) })
    return
  }

  viewer.setHighlight(null)
})

/** 고른 것과 이어진 것 전체가 화면에 들어오게 시점을 맞춘다. */
function frameNetwork() {
  const t = tracedShown.value
  if (!selectedId.value || !t) return
  if (flowSystemRow.value) viewer?.frame(flowSystemRow.value.ids)
  else viewer?.frame([selectedId.value, ...t.upstream, ...t.downstream, ...t.linked])
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

// 3D 와 고른 설비 패널을 같이 전체 화면으로 띄운다. 3D 만 띄우면 설비를 눌러도 무엇을 골랐는지 안 보인다.
// Esc 로 나가는 것은 브라우저가 하므로, 상태는 버튼이 아니라 fullscreenchange 로 따라간다.
const stage = ref<HTMLElement | null>(null)
const fullscreen = ref(false)
const onFullscreenChange = () => (fullscreen.value = document.fullscreenElement === stage.value)
document.addEventListener('fullscreenchange', onFullscreenChange)
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void stage.value?.requestFullscreen()
}

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
    w.postMessage(
      { bytes, wasmBase: new URL(import.meta.env.BASE_URL, location.href).href, options: { openings: readOpenings.value } },
      [bytes],
    )
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
    selectedSpaceId.value = null
    editNotice.value = ''
    storeyMoved.value = new Set()
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
    selectedSpaceId.value = null
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
  <main :class="model ? `mode-${mode}` : ''">
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
      <!-- 로봇 경로용. 온톨로지에는 없어도 되고 큰 파일은 느려져서 기본은 끈다. 다음에 여는 파일부터 적용된다. -->
      <label class="read-option">
        <input v-model="readOpenings" type="checkbox" :disabled="busy" />
        문·창 형상도 읽기
        <span class="muted">로봇 경로용(문 자리, 공간 경계가 없을 때 문이 잇는 방). 온톨로지에는 필요 없고 큰 파일은 느려집니다.</span>
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
      <!-- 편집 모드에서만 뜬다. 무엇을 몇 건 바꿨는지와 내보내기를 스크롤과 상관없이 붙여 둔다. -->
      <div v-if="editing" class="edit-bar" role="status">
        <b>편집 중</b>
        <span>바뀐 것 {{ changeCount }}건</span>
        <a href="#changes" class="link">목록 보기</a>
        <span class="grow"></span>
        <button type="button" class="ghost" @click="exportTTL">의미 내보내기 (TTL)</button>
        <button type="button" class="ghost" @click="mode = 'view'">보기로</button>
      </div>

      <section class="review">
        <div class="review-head">
          <h2>{{ fileName }}</h2>
          <!-- 보기와 편집. 편집은 고치는 손잡이를 드러낼 뿐이고 편집한 결과는 모드를 바꿔도 남는다. -->
          <div class="mode-switch" role="group" aria-label="화면 모드">
            <button type="button" :aria-pressed="mode === 'view'" @click="mode = 'view'">보기</button>
            <button type="button" :aria-pressed="mode === 'edit'" @click="mode = 'edit'">편집</button>
          </div>
        </div>
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
          <li :class="{ wide: doorLinks.total > 0 }">
            <b>{{ counts.doors }}</b><span>문</span><Src kind="bim" />
            <!-- 방-문-방. BIM 의 공간 경계가 말하면 BIM, 없으면 문 양쪽을 좌표로 짚은 계산이다. -->
            <small v-if="doorLinks.total > 0">
              방 둘을 잇는 것 {{ doorLinks.two }}
              <template v-if="doorLinks.bim"><Src kind="bim" /></template>
              <template v-if="doorLinks.calc"><Src kind="calc" /></template>
            </small>
          </li>
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

      <div ref="stage" :class="['stage', { full: fullscreen }]">
        <section class="viewport">
          <div class="canvas-wrap">
            <canvas ref="canvas"></canvas>
            <div class="view-tools">
              <!-- 보기 ↔ 편집. 위의 보기/편집 버튼과 같은 상태(mode) 하나다. 3D 를 보다가 손을 떼지 않고 오간다. -->
              <label class="edit-toggle" title="켜면 3D 에서 설비를 끌어 옮기고, 물리존 꼭짓점을 끌고, 연결 방향을 정합니다.">
                <input
                  type="checkbox"
                  :checked="editing"
                  @change="mode = ($event.target as HTMLInputElement).checked ? 'edit' : 'view'"
                />
                편집
              </label>
              <button
                v-if="drawnWalls"
                type="button"
                :class="['ghost', 'walls-toggle', { on: showWalls }]"
                :aria-pressed="showWalls"
                @click="showWalls = !showWalls"
              >
                내력벽
              </button>
              <button type="button" class="ghost fullscreen" :aria-pressed="fullscreen" @click="toggleFullscreen">
                {{ fullscreen ? '전체 화면 나가기 (Esc)' : '전체 화면' }}
              </button>
            </div>
            <!-- 내력 여부는 BIM 의 LoadBearing 속성 그대로다. 비내력벽은 그리지 않는다. -->
            <ul v-if="showWalls && drawnWalls" class="wall-key">
              <li><i :style="{ background: hex(WALL_COLORS.loadBearing) }"></i>내력벽 {{ drawnWalls.loadBearing }} <Src kind="bim" /></li>
              <li v-if="drawnWalls.unknown">
                <i :style="{ background: hex(WALL_COLORS.unknown) }"></i>내력 여부 모름 {{ drawnWalls.unknown }}
              </li>
            </ul>
          </div>

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
            <!-- 편집 모드의 연결 화살표. 색은 상류·하류가 아니라 그 방향을 누가 말했는가다. -->
            <template v-if="editing && hasArrows">
              <li class="key-head">화살표 · 누르면 방향을 바꿉니다</li>
              <li><i class="bar" :style="{ background: hex(ARROW_COLORS.port) }"></i>포트 방향(못 고침) <Src kind="bim" /></li>
              <li><i class="bar" :style="{ background: hex(ARROW_COLORS.edit) }"></i>사람이 정한 방향 <Src kind="edit" /></li>
              <li v-if="showRules"><i class="bar dashed" :style="{ color: hex(ARROW_COLORS.rule) }"></i>규칙 방향 <Src kind="dict" /></li>
              <li><i class="bar dashed" :style="{ color: hex(ARROW_COLORS.none) }"></i>방향 모름</li>
            </template>
          </ul>

          <p v-if="editNotice" class="edit-notice" role="alert">{{ editNotice }}</p>
          <p v-else-if="editing" class="hint pick-hint">
            {{
              selectedSpace
                ? '파란 손잡이를 끌면 경계가 바뀝니다. 끄는 중 Esc 는 취소입니다.'
                : selected
                  ? '고른 설비를 끌면 옮겨집니다 · 화살표를 누르면 흐름 방향이 하류 → 상류 → 지움 순으로 바뀝니다 · Esc 는 끌기 취소'
                  : '설비를 누르면 고르고, 고른 설비를 끌면 옮깁니다. 바닥을 누르면 물리존 꼭짓점이 뜹니다.'
            }}
          </p>
          <p v-else-if="counts.equipment > 0" class="hint pick-hint">
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

          <!-- 층 옮기기(E6). 층은 좌표로 판정하지 않고 사람이 고른다(edit.ts). -->
          <p v-if="editing" class="storey-move">
            <label>
              층
              <select
                :value="storeyOf(selected.id)?.id ?? ''"
                :disabled="model.storeys.length < 2"
                @change="moveToStorey(selected.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="s in model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </label>
            <Src :kind="storeyMoved.has(selected.id) ? 'edit' : 'bim'" />
            <span class="muted">
              {{
                model.storeys.length < 2
                  ? '층이 하나라 옮길 곳이 없습니다.'
                  : selected.position
                    ? '바꾸면 높이도 두 층 바닥의 차만큼 옮기고 소속을 다시 판정합니다.'
                    : '좌표가 없어 층만 바뀝니다. 좌표를 지어내지 않습니다.'
              }}
            </span>
          </p>

          <ul class="flow">
            <li class="upstream">
              <b>{{ traced?.upstream.size ?? 0 }}</b><span>상류</span><Src kind="bim" />
            </li>
            <li class="downstream">
              <b>{{ traced?.downstream.size ?? 0 }}</b><span>하류</span><Src kind="bim" />
            </li>
            <li class="linked">
              <b>{{ traced?.linked.size ?? 0 }}</b><span>이어짐 · 방향 모름</span>
              <small v-if="traced?.linked.size">그중 기기 {{ deviceCount(traced.linked) }}</small>
            </li>
          </ul>

          <!-- 규칙 방향. 위 숫자는 BIM 포트가 말한 것만이고, 여기부터가 계통·설비 종류로 정한 것이다. -->
          <div v-if="tracedRules" class="rule-box">
            <p>
              <Src kind="dict" /> 규칙 방향<template v-if="flowEditLines.length">과 <Src kind="edit" /> 사람이 정한 방향</template>을
              넣으면 상류 <b>{{ tracedRules.upstream.size }}</b> · 하류 <b>{{ tracedRules.downstream.size }}</b> ·
              방향 모름 <b>{{ tracedRules.linked.size }}</b>
              <template v-if="tracedRules.linked.size">(그중 기기 {{ deviceCount(tracedRules.linked) }})</template>
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
              <span v-if="selectedRule.confirmed" class="confirmed">확정함 · brick:feeds 로 나갑니다</span>
              <button
                v-else-if="editing"
                type="button"
                class="ghost"
                :disabled="selectedRule.count === 0"
                @click="confirmRule(selectedRule.systemId, selectedRule.name)"
              >
                이 계통 방향 확정
              </button>
              <span v-else class="muted"> 확정은 편집 모드에서 합니다.</span>
            </p>
            <p v-if="selectedRule && selectedRule.pct !== null && selectedRule.pct < 80" class="hint">
              일치율이 낮습니다. 확정하기 전에 3D 에서 흐름을 확인하세요.
            </p>
          </div>

          <!-- 계통별로 보기. 한 기기에 물·바람·배수가 같이 붙으므로 계통마다 나눠 센다. -->
          <div v-if="systemRows.length" class="by-system">
            <h4>
              계통별로 보기
              <span class="muted">
                기기 대수 · 방향 모름은 다음 기기에서 멈춤<template v-if="showRules && hasRules"> · 규칙 방향 포함 <Src kind="dict" /></template>
                · 줄을 누르면 3D 에 그 계통만
              </span>
            </h4>
            <table>
              <thead>
                <tr>
                  <th>계통 <Src kind="bim" /></th>
                  <th>종류 <Src kind="dict" /></th>
                  <th class="num">상류</th>
                  <th class="num">하류</th>
                  <th class="num">방향 모름</th>
                  <th class="num">덕트·배관</th>
                  <th>이어진 기기</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in systemRows"
                  :key="r.key"
                  :class="{ chosen: flowSystemKey === r.key }"
                  @click="toggleFlowSystem(r.key)"
                >
                  <td class="sys">
                    <i :style="{ background: r.color ?? 'transparent' }"></i>
                    <button type="button" class="link" :aria-pressed="flowSystemKey === r.key">{{ r.name }}</button>
                  </td>
                  <td :class="{ muted: !r.kind }">{{ r.kind ?? '모름' }}</td>
                  <td :class="['num', 'mono', r.up ? 'upstream' : 'muted']">{{ r.up || '·' }}</td>
                  <td :class="['num', 'mono', r.down ? 'downstream' : 'muted']">{{ r.down || '·' }}</td>
                  <td :class="['num', 'mono', r.unknown ? 'linked' : 'muted']">{{ r.unknown || '·' }}</td>
                  <td class="num mono muted">{{ r.conduits || '·' }}</td>
                  <td class="kinds-cell" :title="r.kinds.map(([l, n]) => `${l} ${n}`).join(', ')">
                    <template v-if="r.kinds.length">{{ kindsText(r.kinds) }}</template>
                    <!-- Revit 은 급기 계통을 가지마다 쪼개서, 관이 다른 계통으로 이어질 수 있다. 끊겼다고 단정하지 않는다. -->
                    <span v-else class="muted">이 계통 안에서 닿는 기기 없음</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 담당 공간. 공기 원천을 골랐을 때만 뜬다. 계통도가 묻는 "이 공조기가 담당하는 방" 의 근사다. -->
          <div v-if="selectedService" class="served">
            <h4>
              담당 공간 <Src kind="calc" />
              <span class="muted">
                흐름 방향을 따라 말단(디퓨저·그릴)까지 가서 말단이 있는 방을 모읍니다<template v-if="showRules && hasRules"> · 규칙 방향 포함 <Src kind="dict" /></template>
                · 추정이라 내보내지 않습니다
              </span>
            </h4>
            <p v-if="!selectedService.supply.length && !selectedService.extract.length" class="muted">
              흐름 방향으로 닿는 말단이 없습니다. 방향을 모르는 연결에서 멈췄거나, 덕트 없이 방에 바로 놓인 기기(카세트형 등)일 수 있습니다.
            </p>
            <table v-else>
              <thead>
                <tr>
                  <th>방</th>
                  <th>층</th>
                  <th class="num">급기 말단</th>
                  <th class="num">환기·배기 말단</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in selectedService.rooms" :key="r.spaceId ?? '-'">
                  <td :class="{ muted: !r.spaceId }">
                    {{ r.spaceId ? spaceNameOf(r.spaceId) : '소속 방 없음' }}
                    <Src v-if="r.spaceId" kind="calc" />
                  </td>
                  <td class="muted">{{ r.spaceId ? spaceStorey.get(r.spaceId) : '' }}</td>
                  <td :class="['num', 'mono', r.supply ? 'downstream' : 'muted']">{{ r.supply || '·' }}</td>
                  <td :class="['num', 'mono', r.extract ? 'upstream' : 'muted']">{{ r.extract || '·' }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="selectedService.rooms.some((r) => !r.spaceId) && counts.spaces === 0" class="hint">
              이 파일에는 방이 없습니다. 건축 파일을 덧붙이면 말단이 있는 방이 나옵니다.
            </p>
          </div>

          <p v-if="selectedNeighbors.length === 0" class="hint">
            이 설비에 붙은 연결이 없습니다.
          </p>
          <table v-else class="neighbors">
            <tbody>
              <tr v-for="(n, i) in selectedNeighbors" :key="`${n.id}-${i}`">
                <td :class="['rel', ...relClass(n)]">{{ relLabel(n) }}</td>
                <td>
                  <button type="button" class="link" @click="select(n.id)">{{ n.name }}</button>
                </td>
                <td class="muted">
                  <template v-if="n.source === 'port'">포트 <Src kind="bim" /></template>
                  <template v-else>{{ sourceLabel(n.tolerance) }} <Src kind="calc" /></template>
                  <template v-if="n.edited"> · 사람이 정한 방향 <Src kind="edit" /></template>
                  <template v-else-if="n.rule">
                    · {{ n.rule.confirmed ? '규칙 방향(확정)' : '규칙 방향(추정)' }} <Src kind="dict" />
                  </template>
                </td>
                <!-- 포트가 방향을 말한 연결은 고칠 수 없다. BIM 이 말한 것을 덮어쓰지 않는다. -->
                <td v-if="editing" class="flow-edit">
                  <template v-if="!n.connection.directed">
                    <button
                      type="button"
                      class="ghost"
                      :aria-pressed="n.edited === 'upstream'"
                      :title="`${n.name} 에서 이 설비로 흐른다`"
                      @click="setFlow(n, n.id)"
                    >
                      상류로
                    </button>
                    <button
                      type="button"
                      class="ghost"
                      :aria-pressed="n.edited === 'downstream'"
                      :title="`이 설비에서 ${n.name} 로 흐른다`"
                      @click="setFlow(n, selectedId)"
                    >
                      하류로
                    </button>
                    <!-- 자리는 늘 잡아 둔다. 누를 때 생기면 옆 버튼이 밀려 마우스 아래로 다른 버튼이 온다. -->
                    <button
                      type="button"
                      :class="['ghost', { hidden: !n.edited }]"
                      :disabled="!n.edited"
                      title="정한 방향을 지운다"
                      @click="setFlow(n, null)"
                    >
                      되돌리기
                    </button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 3D 에서 고른 물리존(E2). 편집 모드에서 바닥을 누르면 뜬다. -->
        <section v-else-if="selectedSpace" class="picked space-picked">
          <div class="picked-head">
            <div>
              <h3>{{ selectedSpace.space.longName || selectedSpace.space.name }}</h3>
              <p class="stats">
                물리존 {{ selectedSpace.space.name }} <Src kind="bim" /> · {{ selectedSpace.storey.name }} <Src kind="bim" /> ·
                <b class="mono">{{ selectedSpace.space.areaM2.toFixed(1) }}</b> ㎡
                <Src :kind="selectedSpace.edited ? 'edit' : 'calc'" /> · 소속 설비 {{ selectedSpace.equipment.length }}대
                <Src kind="calc" />
              </p>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="selectedSpaceId = null">선택 해제</button>
            </div>
          </div>
          <p class="hint">
            파란 손잡이를 끌면 경계가 바뀌고, 넓이와 설비 소속을 다시 판정합니다. 경계가 자기 자신과 엇갈리는 자리에는
            놓지 않습니다. 소속 설비는 3D 에 제 계통 색으로 남기고 나머지는 흐리게 했습니다.
          </p>
          <ul v-if="selectedSpace.equipment.length" class="plain space-members">
            <li v-for="e in selectedSpace.equipment" :key="e.id">
              <button type="button" class="link" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
              <span class="muted">{{ kindLabel(e) }}</span>
            </li>
          </ul>
          <p v-else class="empty">이 물리존에 속한 설비가 없습니다.</p>
        </section>
      </div>

      <!-- 3D 아래는 전부 접을 수 있다. 행이 많은 목록은 처음부터 접혀 있다(SMALL).
           파일이 바뀌면(key) 접힘 상태도 그 파일 기준으로 다시 정한다. -->
      <div :key="fileName" class="folds">
        <!-- 완전성 검사. 규칙마다 통과 수와 어긴 것. 펼치면 목록과 3D 에 어긴 것이 뜬다. -->
        <Fold
          v-if="checks.length"
          title="완전성 검사"
          :meta="`규칙 ${checks.length}개 · 전부 통과 ${checks.filter((c) => !c.skipped && c.total > 0 && c.failed.length === 0).length}개`"
          class="checks"
        >
          <p class="hint">
            DT 가 쓰려면 이어져 있어야 하는 것을 규칙으로 쟀습니다. 원천·말단은 <Src kind="dict" /> 사전으로 가르고, 흐름과 소속은
            <Src kind="calc" /> 추정이 섞여 있습니다<template v-if="showRules && hasRules">(규칙 방향 포함)</template>. 줄을 누르면 어긴 것을
            3D 에 칠합니다.
          </p>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>규칙</th>
                <th class="num">통과</th>
                <th class="num">어긴 것</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in checks"
                :key="c.key"
                :class="{ chosen: openCheckKey === c.key, skipped: !!c.skipped }"
                @click="!c.skipped && c.failed.length && toggleCheck(c.key)"
              >
                <td class="state">
                  <i :class="c.skipped || c.total === 0 ? 'none' : c.failed.length ? 'warn' : 'ok'"></i>
                </td>
                <td>
                  {{ c.rule }}
                  <small class="muted">{{ c.skipped ?? (c.total === 0 ? '이 파일에는 잴 대상이 없습니다' : `비면: ${c.why}`) }}</small>
                </td>
                <td class="num mono">
                  <template v-if="!c.skipped && c.total">{{ c.total - c.failed.length }} / {{ c.total }}</template>
                  <span v-else class="muted">—</span>
                </td>
                <td class="num">
                  <button
                    v-if="!c.skipped && c.failed.length"
                    type="button"
                    class="link mono"
                    :aria-pressed="openCheckKey === c.key"
                  >
                    {{ c.failed.length }}
                  </button>
                  <span v-else class="muted">·</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="openCheck && openCheck.failed.length" class="check-list">
            <h4>{{ openCheck.rule }} <span class="muted">어긴 것 {{ openCheck.failed.length }}개 · 3D 에 칠했습니다</span></h4>
            <ul class="plain">
              <li v-for="id in openCheck.failed.slice(0, CHECK_LIMIT)" :key="id">
                <button type="button" class="link" @click="select(id)">
                  {{ equipmentById.get(id)?.name || equipmentById.get(id)?.ifcClass || id }}
                </button>
                <span class="muted">
                  {{ equipmentById.get(id) ? kindLabel(equipmentById.get(id)!) : '' }}
                </span>
              </li>
            </ul>
            <p v-if="openCheck.failed.length > CHECK_LIMIT" class="hint">
              {{ openCheck.failed.length }}개 중 {{ CHECK_LIMIT }}개만 보입니다. 3D 에는 전부 칠했습니다.
            </p>
          </div>
        </Fold>

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

        <!-- 원천별 담당 공간. 계통도를 그리기 전에 "어느 기기가 어느 방을 맡는가" 를 한 장으로 본다. -->
        <Fold
          v-if="serviceSummary && serviceSummary.rows.length"
          title="담당 공간"
          :meta="`공기 원천 ${serviceSummary.rows.length}대 · 말단에 닿는 것 ${serviceSummary.reaching}대`"
          :default-open="false"
          class="service"
        >
          <p class="hint">
            <Src kind="calc" /> 흐름 방향을 따라 원천에서 말단까지 가고, 말단이 있는 방을 모았습니다. 급기는 하류로, 환기·배기는 상류로
            갑니다. 다른 원천을 만나면 멈춥니다. 추정이라 TTL 로 내보내지 않습니다.
          </p>
          <table>
            <thead>
              <tr>
                <th>원천</th>
                <th>종류 <Src kind="dict" /></th>
                <th class="num">급기 말단</th>
                <th class="num">환기·배기 말단</th>
                <th>방</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in serviceSummary.rows.slice(0, SERVICE_LIMIT)" :key="r.id" :class="{ chosen: r.id === selectedId }">
                <td><button type="button" class="link" @click="select(r.id)">{{ r.name }}</button></td>
                <td class="muted">{{ r.kind }}</td>
                <td :class="['num', 'mono', r.supply ? 'downstream' : 'muted']">{{ r.supply || '·' }}</td>
                <td :class="['num', 'mono', r.extract ? 'upstream' : 'muted']">{{ r.extract || '·' }}</td>
                <td class="names" :title="r.rooms.join(', ')">
                  <template v-if="r.rooms.length">{{ r.rooms.length }}개 · {{ r.rooms.join(', ') }}</template>
                  <span v-else class="muted">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="serviceSummary.rows.length > SERVICE_LIMIT" class="hint">
            {{ serviceSummary.rows.length }}대 중 말단이 많은 {{ SERVICE_LIMIT }}대만 보입니다.
          </p>
        </Fold>

        <!-- 편집. 3D 조작 대신 값을 직접 고친다. PoC 에서 확인할 것은 조작감이 아니라
             한 번의 편집이 온톨로지의 어느 관계를 바꾸는가이기 때문이다. -->
        <!-- 보기 모드에서도 설비 목록은 남긴다(이름으로 찾아 고르는 길이다). 고치는 칸과 물리존 편집만 숨긴다. -->
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
            <span class="muted">{{ editing ? '아래 세 목록에 같이 걸립니다.' : '설비 목록에 걸립니다.' }}</span>
          </div>

          <Fold v-if="editing" title="물리존 이름 (E1)" :meta="`${counts.spaces}개`" :default-open="counts.spaces <= SMALL">
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

          <Fold v-if="editing" title="물리존 경계 (E2)" :meta="`${counts.spaces}개`" :default-open="counts.spaces <= SMALL">
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
          <p v-if="editing && selfIntersecting" class="error" role="alert">
            경계가 자기 자신과 교차합니다. 이 상태에서는 넓이와 소속 판정이 뜻을 잃습니다.
          </p>

          <Fold
            :title="editing ? '설비 위치와 소속 (E5 · E6)' : '설비 목록'"
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
                    <span v-if="!editing" class="mono">{{ e.position ? e.position[axis].toFixed(2) : '—' }}</span>
                    <input
                      v-else
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

          <template v-if="editing || changeCount > 0">
          <h3 id="changes">바뀌는 것 (PRD #21)</h3>
          <ul v-if="report.length || areaChanges.length || confirmations.length || flowEditLines.length" class="report">
            <li v-for="c in report" :key="c.equipmentId">
              {{ c.equipmentName }}:
              <b>{{ spaceNameOf(c.fromSpaceId) }}</b> → <b>{{ spaceNameOf(c.toSpaceId) }}</b>
            </li>
            <li v-if="areaSummary" class="muted">{{ areaSummary }}</li>
            <li v-for="(c, i) in confirmations" :key="`rule-${i}`">
              계통 <b>{{ c.systemName }}</b>: 규칙 방향 {{ c.count }}개를 확정했습니다(brick:feeds 로 나갑니다)
            </li>
            <li v-for="(f, i) in flowEditLines" :key="`flow-${i}`">
              <b>{{ f.from }}</b> → <b>{{ f.to }}</b>: 사람이 방향을 정했습니다({{ f.note }}, brick:feeds 로 나갑니다)
            </li>
          </ul>
          <p v-else class="empty">아직 바뀐 소속 관계가 없습니다.</p>
          </template>
        </section>
      </div>

      <section class="actions">
        <button type="button" @click="exportGeoJSON">기하 내보내기 (GeoJSON)</button>
        <button type="button" @click="exportTTL">의미 내보내기 (Brick TTL)</button>
        <p class="note">
          두 파일은 같은 id 로 이어집니다. 기하는 GeoJSON 이 갖고, 설비와 계통은 TTL 이 갖습니다.
          벽·문·창의 자리와 문이 잇는 방은 GeoJSON 에만 있습니다(Brick 에 건축 부재 클래스가 없습니다).
          문·창의 자리는 "문·창 형상도 읽기" 를 켜고 연 파일에서만 나갑니다.
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
