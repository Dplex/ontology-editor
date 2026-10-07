<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, triggerRef, watch, type Directive } from 'vue'
import type { MeshMap } from './lib/ifc/import'
import { countOf, isConduit, polygonArea, unplacedOf, type Connection, type Equipment, type Model, type Opening, type Storey, type Vec2, type Vec3, type Wall } from './lib/model'
import { mergeModels, type MergeReport } from './lib/merge'
import { partnerOf as findPartner, profileOf, type Profile } from './lib/profile'
import { requirementsReport, type RequirementRow, type RequirementState } from './lib/requirements'
import TierChips from './components/TierChips.vue'
import Fold from './components/Fold.vue'
import Src, { type SrcKind } from './components/Src.vue'
import ShortcutHelp from './components/ShortcutHelp.vue'
import ExitEditDialog from './components/ExitEditDialog.vue'
import HoverTip from './components/HoverTip.vue'
import FloorPlan from './components/FloorPlan.vue'
import Roll from './components/Roll.vue'
import Meter from './components/Meter.vue'
import { vFlash } from './lib/motion'
import { matchShortcut, snapAxis, type Shortcut } from './lib/shortcuts'
import { josa } from './lib/josa'
import { narrowOptions } from './lib/options'
import { applyEdits, countEdits, EDIT_FORMAT, exportEdits, parseEditFile, type EditFile } from './lib/edit-file'
import { BUILDING, joinParts, partSig, splitByStorey, type HomeOf } from './lib/storey-drafts'
import { compareVersions, MATCH_KEY_BY, type MatchKey, type VersionDiff } from './lib/versions'
import { ratioLabel } from './lib/unit-check'
import { neighbors, trace, traceBySystem, TOLERANCE, type Neighbor } from './lib/topology'
import { airBasis, airServices, needsSystem, servedSpaces, systemlessAir } from './lib/served'
import { storeyHeights, type StoreyHeight } from './lib/storey-height'
import { storeyFiles } from './lib/export/storey-export'
import { clearStoreyDone, markStoreyDone, storeyProgress, type StoreyProgress } from './lib/storey-progress'
import { completenessChecks, diagnoseFailure, type Box, type FailureFix } from './lib/checks'
import { suggestKinds, type KindSuggestion } from './lib/kind-suggest'
import { confirmSystemFlow, inferFlowByRules, newlyDisagreeing, withInferred, type RuleReport } from './lib/flow-rules'
import { EQUIPMENT_KINDS, equipmentKind, FLUID_KINDS, FLUIDS, fluidInfo, ifcClassLabel, roomKind, SYSTEM_KINDS, systemKind, type Fluid } from './lib/kinds'
import { modelToGeoJSON } from './lib/export/geojson'
import type { Mesh3dReply, Mesh3dRequest } from './lib/export/mesh3d.worker'
import { modelToTTL } from './lib/export/ttl'
import {
  arrowColors,
  CEILING_RING_COLORS,
  createViewer,
  PICK_COLORS,
  systemColors,
  toScene,
  WALL_COLORS,
  type Arrow,
  type CeilingMark,
  type CeilingView,
  type Viewer,
  type HoverTarget,
} from './lib/viewer'
import { rigidPart, segmentAxisOf, stretchPositions } from './lib/conduit-mesh'
import {
  applyFollow,
  planFollow,
  type SegmentAxis,
  flowEdits,
  moveEquipment,
  moveEquipmentToStorey,
  moveSpaceVertex,
  completePosition,
  renameSpace,
  renameSystem,
  exteriorOnly,
  onExteriorFace,
  EXTERIOR_ONLY,
  restore,
  insertSpaceVertex,
  deleteSpaceVertex,
  drawSpaceFootprint,
  addConnection,
  connectionBetween,
  removeConnection,
  snapshotConnection,
  setTypeKind,
  kindEdits,
  snapshotType,
  typeKeyOf,
  typeNameOf,
  familyKeyOf,
  familyNameOf,
  snapshotConfirm,
  snapshotEquipment,
  snapshotFlow,
  snapshotSpace,
  snapshotOf,
  baselineOf,
  diffBaseline,
  setFlowDirection,
  summarize,
  wouldSelfIntersect,
  addEquipment,
  deleteEquipment,
  renameEquipment,
  snapshotEquipmentSet,
  setEquipmentSystem,
  setSystemKind,
  snapshotSystems,
  createSystem,
  deleteSystem,
  createSpace,
  deleteSpace,
  splitSpace,
  mergeSpaces,
  snapshotStoreySpaces,
  addWall,
  addOpening,
  moveWall,
  moveWallWithSpaces,
  type WallCarryPlan,
  deleteWall,
  moveOpening,
  deleteOpening,
  setWallLoadBearing,
  snapshotStoreyElements,
  wallLocked,
  WALL_LOCKED,
  newCrossing,
  crossingMessage,
  wallLength,
  setWallLength,
  setOpeningSize,
  mountOnWall,
  snapshotCustomZones,
  setWallExternal,
  setWallHeight,
  setWallThickness,
  type Baseline,
  type BoundaryChange,
  type Change,
  type SpaceSetChange,
  type Snapshot,
} from './lib/edit'
import { MERGE_GAP } from './lib/polygon'
import { judgeExternal } from './lib/exterior'
import {
  createCustomZone,
  deleteCustomZone,
  findCustomZone,
  mergeCustomZones,
  renameCustomZone,
  setCustomZoneAliases,
  zoneNamesOfEquipment,
  splitCustomZone,
  zoneEquipment,
  zoneSpaces,
} from './lib/custom-zone'
import { allowedLabel, allowedSurfaces, canMountOn, SURFACE_LABEL, surfaceOf, type Surface } from './lib/mount'
import { ceilingGuess, ceilingOf, ceilingRange, ceilingZone, checkCeilingZ, FLOOR_BAND, judgeAll, judgeSurface, outsideAllowed, setCeiling, setEquipmentSurface, type Judged } from './lib/ceiling'
import { meshBox, overlapAt, overlapForNew, type Box3 } from './lib/overlap'
import { readIdf, type IdfModel } from './lib/idf/read'
import { attachIdf, modelFromIdf, type IdfAttachReport } from './lib/idf/attach'
import { distanceToRing } from './lib/mapping'

// 테마는 라이트가 기본이고, 고른 값만 저장한다. 선행 스크립트(index.html)가 첫 페인트
// 전에 같은 값을 읽어 깜빡임을 막는다.
const dark = ref(document.documentElement.getAttribute('data-theme') === 'dark')

function toggleTheme() {
  dark.value = !dark.value
  viewer?.setDark(dark.value)
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
/**
 * 오류 문구는 목록 아래에 뜬다. data/ 목록 가운데서 [열기] 를 누른 사람에게는 화면 밖이라, 열 수 없는 파일을 눌러도
 * 아무 일이 없는 것처럼 보였다. 뜨면 보이는 자리까지 끌어온다.
 */
const errorEl = ref<HTMLElement | null>(null)
watch(error, async (e) => {
  if (!e) return
  await nextTick()
  errorEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})
const dragging = ref(false)
const model = shallowRef<Model | null>(null)

const canvas = ref<HTMLCanvasElement | null>(null)
let viewer: Viewer | null = null

// 설비 형상. **모델과 따로 들고 다닌다** — 모델은 내보내기가 그대로 읽는 것이라 여기에
// 삼각형이 섞이면 TTL 로 기하가 새는 길이 생긴다. 반응형으로 감쌀 이유도 없다(화면이
// 값을 읽지 않고 3D 에만 넘긴다). 926개짜리 Map 을 반응형으로 만들면 그만큼 느려진다.
let meshes: MeshMap = new Map()
/**
 * 설비를 따라 늘인 구간의 늘이기 전 형상과 그때 좌표·축. 처음 늘일 때(또는 불러오기 직전에) 뜬다. 늘인 형상은 늘 이것에서 다시
 * 만든다 — 늘인 형상을 또 늘이면 꼭짓점의 축 위 비율이 바뀌어 되돌려도 제자리가 아니다.
 */
let meshBase = new Map<string, { positions: Float32Array; at: Vec3; axis: SegmentAxis }>()

const counts = computed(() => (model.value ? countOf(model.value) : null))
/** 임포트 때 읽지 않기로 한 피처(벽·문·창). 숫자 칸이 0 대신 "읽지 않음" 을 보인다. */
const skipped = computed(() => new Set(model.value?.skipped ?? []))
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

// 벽·문·창을 읽을까(피처 단위). 셋 다 GeoJSON 에만 나가고 온톨로지(TTL)에는 필요 없어서, 큰 파일을 빨리 열거나
// 설비만 볼 때 끈다. 기본은 예전처럼 다 읽는다. 끈 것은 모델에 "읽지 않음" 으로 적혀 요구사항 보고서가 "없음" 과 가른다.
type ReadFeatures = { walls: boolean; doors: boolean; windows: boolean }
const readFeatures = ref<ReadFeatures>(
  (() => {
    const all = { walls: true, doors: true, windows: true }
    try {
      const saved = JSON.parse(localStorage.getItem('oe-read-features') ?? 'null') as Partial<ReadFeatures> | null
      return saved ? { ...all, ...saved } : all
    } catch {
      return all
    }
  })(),
)
watch(
  readFeatures,
  (v) => {
    try {
      localStorage.setItem('oe-read-features', JSON.stringify(v))
    } catch {
      // 못 써도 이번 창에서는 그대로 돈다.
    }
  },
  { deep: true },
)
const readOpeningShapes = computed(() => readOpenings.value && (readFeatures.value.doors || readFeatures.value.windows))
/** 편집 막대에 보이는 바뀐 것의 수. 리포트(바뀌는 것)에 적히는 줄과 같은 단위로 센다. */
const changeCount = computed(
  () =>
    report.value.length +
    areaLines.value.length +
    confirmations.value.length +
    flowEditLines.value.length +
    kindEditLines.value.length +
    sinceOpen.value.renamed.length +
    sinceOpen.value.restoreyed.length +
    sinceOpen.value.moved.length +
    sinceOpen.value.connected.length +
    sinceOpen.value.disconnected.length +
    sinceOpen.value.spacesAdded.length +
    sinceOpen.value.spacesRemoved.length +
    sinceOpen.value.equipmentAdded.length +
    sinceOpen.value.equipmentRemoved.length +
    sinceOpen.value.equipmentRenamed.length +
    sinceOpen.value.equipmentMounted.length +
    sinceOpen.value.wallsAdded.length +
    sinceOpen.value.wallsRemoved.length +
    sinceOpen.value.wallsChanged.length +
    sinceOpen.value.openingsAdded.length +
    sinceOpen.value.openingsRemoved.length +
    sinceOpen.value.openingsMoved.length +
    sinceOpen.value.customZones.length +
    sinceOpen.value.systemMoved.length +
    sinceOpen.value.systemKinds.length +
    sinceOpen.value.systemNames.length +
    sinceOpen.value.systemsAdded.length +
    sinceOpen.value.systemsRemoved.length,
)

// 연 때의 값. 소속 관계 말고도 내보내는 파일을 바꾸는 편집(이름·방 안 이동·층)을 이것과 견줘 리포트에 올린다
// (edit.ts 의 diffBaseline). 파일을 열거나 합칠 때 뜬다.
const baseline = shallowRef<Baseline | null>(null)
const sinceOpen = computed(() => {
  const m = model.value
  return m && baseline.value
    ? diffBaseline(m, baseline.value)
    : {
        renamed: [],
        moved: [],
        restoreyed: [],
        connected: [],
        disconnected: [],
        spacesAdded: [],
        spacesRemoved: [],
        equipmentAdded: [],
        equipmentRemoved: [],
        equipmentRenamed: [],
        equipmentMounted: [],
        wallsAdded: [],
        wallsRemoved: [],
        wallsChanged: [],
        openingsAdded: [],
        openingsRemoved: [],
        openingsMoved: [],
        customZones: [],
        systemMoved: [],
        systemKinds: [],
        systemNames: [],
        systemsAdded: [],
        systemsRemoved: [],
      }
})
const MOVED_NAMES = 5

// --- 공조존 (IDF, F12) --------------------------------------------------------------
//
// IDF 를 열거나 덧붙이면 공조존과 담당 관계가 모델에 얹힌다(idf/attach.ts). 읽은 IDF 는 들고 있다가 IFC 를 덧붙여 층·방이
// 바뀌면 다시 얹는다. 3D 에는 외곽선만 그린다(고르지 않는다) — 방을 누르면 그 방의 공조존을 패널이 말한다.
const isIdf = (name: string) => /\.idf$/i.test(name)
let idfSource: { name: string; idf: IdfModel } | null = null
const idfReport = shallowRef<IdfAttachReport | null>(null)
const showZones = ref(true)
const zoneOfSpace = computed(() => {
  const map = new Map<string, { id: string; name: string }>()
  for (const z of model.value?.hvac?.zones ?? []) for (const id of z.spaceIds) map.set(id, z)
  return map
})
/** 공조존 표. 담당은 존을 직접 공급하는 설비(말단)와 그 위의 원천(공조기·실외기)이다. */
const zoneRows = computed(() => {
  const hvac = model.value?.hvac
  if (!hvac) return []
  const storeyName = new Map((model.value?.storeys ?? []).map((s) => [s.id, s.name]))
  const upstream = new Map<string, string[]>()
  for (const e of hvac.equipment) for (const t of e.feeds) upstream.set(t, [...(upstream.get(t) ?? []), e.id])
  const byId = new Map(hvac.equipment.map((e) => [e.id, e]))
  const label = (id: string) => {
    const e = byId.get(id)
    if (!e) return id
    const bim = e.bimId ? equipmentById.value.get(e.bimId) : null
    return bim ? `${bim.name}(BIM)` : e.name
  }
  return hvac.zones.map((z) => {
    const terminals = upstream.get(z.id) ?? []
    const sources = [...new Set(terminals.flatMap((t) => upstream.get(t) ?? []))]
    return {
      id: z.id,
      name: z.name,
      storey: z.storeyId ? (storeyName.get(z.storeyId) ?? '') : '(층 모름)',
      area: z.areaM2,
      declared: z.declaredAreaM2,
      // 방을 다 덮지 않으면 몫을 붙인다(넓이로 잰다, idf/attach.ts).
      spaces: z.spaceIds.map((id) => {
        const share = z.spaceShares?.[id]
        return share !== undefined && share < 0.995 ? `${spaceNameOf(id)} ${Math.round(share * 100)}%` : spaceNameOf(id)
      }),
      terminals: terminals.map(label),
      sources: sources.map(label),
    }
  })
})
const ZONE_LIMIT = 200

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

// 층고(OE-BIM-02). BIM 이 적었으면 그 값, 아니면 윗층 바닥과의 차. 맨 위층이고 BIM 이 안 적었으면 모름이다.
const storeyHeightOf = computed(() => (model.value ? storeyHeights(model.value.storeys) : new Map<string, StoreyHeight | null>()))
/** 미터. 단위 선언이 틀린 파일(Duplex COBie 는 층고가 3.1mm 로 들어온다)이 0.00 으로 뭉개지지 않게 작은 값은 유효 숫자로 보인다. */
const meters = (v: number) => `${Math.abs(v) >= 0.1 ? v.toFixed(2) : v.toPrecision(2)} m`
const storeyHeightTitle = (h: StoreyHeight) =>
  [
    h.source === 'bim' ? `BIM ${h.property}` : '윗층 바닥 높이와의 차',
    h.source === 'bim' ? (h.calc !== null ? `계산(윗층 바닥과의 차) ${meters(h.calc)}` : '윗층이 없어 계산할 수 없음') : null,
    h.net !== null ? `순 높이(BIM, 윗층 바닥판 아래까지) ${meters(h.net)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

// 반자 높이 h_c(OE-EQP-03). BIM 값이 있으면 그것, 사람이 정했으면 그 값, 둘 다 없으면 모름이다 — 0 이나 층고로 채우지 않는다.
// 반자 부착 설비의 z 로 짐작한 후보(계산)는 입력창 기본값과 참고로만 보인다.
const ceilingGuessOf = computed(() => {
  const out = new Map<string, { height: number; count: number } | null>()
  for (const s of model.value?.storeys ?? []) out.set(s.id, ceilingGuess(s, storeyHeightOf.value.get(s.id)?.value ?? null))
  return out
})
const ceilingTitle = (s: Storey) => {
  const c = ceilingOf(s)
  const guess = ceilingGuessOf.value.get(s.id)
  return [
    c?.source === 'bim' ? `BIM ${c.property} — 방·천장재 ${c.count}개의 가운데 값` : c ? '직접 정한 값' : 'BIM 에 반자 높이가 없습니다',
    s.ceilingSet != null && s.ceiling ? `BIM 값 ${meters(s.ceiling.height)} (${s.ceiling.property})` : null,
    guess ? `후보 ${meters(guess.height)} — 반자 부착 설비 ${guess.count}대의 높이 가운데 값(계산, 값으로 치지 않음)` : null,
  ]
    .filter(Boolean)
    .join('\n')
}
/** BIM 값과 후보가 0.3m 넘게 다르면 보인다. 층 하나에 반자 높이 하나라 방마다 다른 층(성수 지하)에서 벌어진다. */
const ceilingGuessApart = (s: Storey) => {
  const c = ceilingOf(s)
  const g = ceilingGuessOf.value.get(s.id)
  return !!c && !!g && Math.abs(c.height - g.height) > 0.3
}
const ceilingEditing = ref<string | null>(null)
const ceilingInput = ref('')
function startCeiling(storeyId: string) {
  const s = model.value?.storeys.find((x) => x.id === storeyId)
  if (!s) return
  ceilingEditing.value = storeyId
  const v = ceilingOf(s)?.height ?? ceilingGuessOf.value.get(storeyId)?.height
  ceilingInput.value = v === undefined ? '' : String(v)
  void nextTick(() => document.querySelector<HTMLInputElement>('.ceiling-input')?.select())
}
function saveCeiling(storeyId: string, value: number | null) {
  const m = model.value
  const s = m?.storeys.find((x) => x.id === storeyId)
  if (!m || !s) return
  if (value !== null) {
    const top = storeyHeightOf.value.get(storeyId)?.value ?? null
    if (!Number.isFinite(value) || value <= FLOOR_BAND) return note(`반자 높이는 ${FLOOR_BAND}m 보다 높아야 합니다.`)
    if (top !== null && value >= top) return note(`반자 높이는 층고(${meters(top)})보다 낮아야 합니다.`)
  }
  ceilingEditing.value = null
  if (!setCeiling(m, storeyId, value)) return
  progressVersion.value++
  autosaveArmed = true
  triggerRef(model)
  const c = ceilingOf(s)
  note(c ? `${s.name} 층의 반자 높이를 ${meters(c.height)}로 정했습니다${c.source === 'bim' ? '(BIM 값)' : ''}.` : `${s.name} 층의 반자 높이를 지웠습니다(모름).`)
}

/** 설비의 설치면을 사람이 정한다(OE-EQP-05). null 이면 지워 z 판정으로 돌아간다. 되돌리기에 쌓인다. */
function setSurfaceOf(id: string, surface: Surface | null) {
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

// 설치면 판정(OE-EQP-03). z(층 바닥 기준)로 판정하고, 허용 설치면 밖이면 목록에 올린다(Q9).
const JUDGED_LABEL: Record<Judged, string> = { ...SURFACE_LABEL, plenum: '천장(플레넘)' }
const surfaceRows = computed(() => (model.value ? judgeAll(model.value, (id) => storeyHeightOf.value.get(id)?.value ?? null) : []))
const surfaceCounts = computed(() => {
  const c = { ceiling: 0, plenum: 0, floor: 0, wall: 0, unknown: 0 }
  for (const r of surfaceRows.value) c[r.judged ?? 'unknown']++
  return c
})
const surfaceMismatch = computed(() => surfaceRows.value.filter((r) => outsideAllowed(r.equipment.kind, r.judged)))
const selectedJudged = computed(() => {
  const e = selected.value
  const st = e ? storeyOf(e.id) : null
  if (!e || !st) return null
  const judged = judgeSurface(e, st, storeyHeightOf.value.get(st.id)?.value ?? null)
  return { judged, z: e.position ? e.position[2] - st.elevation : null, outside: outsideAllowed(e.kind, judged), hc: ceilingOf(st) }
})

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

// --- 3D 설명 풍선 ------------------------------------------------------------------
//
// 마우스 아래 있는 것이 무엇인지. 누르지 않고도 이름·종류·계통·소속을 본다(연결 화살표면 두 끝과 방향의 출처).
// 내용은 대상이 바뀔 때만 새로 만들고, 같은 대상 위에서는 자리만 옮긴다(HoverTip 주석 참조).
const hoverTip = ref<InstanceType<typeof HoverTip> | null>(null)
let hoverKey = ''
function hoverText(t: HoverTarget): { title: string; lines: string[] } | null {
  const m = model.value
  if (!m) return null
  const nameOf = (id: string) => {
    const e = equipmentById.value.get(id)
    return e?.name || e?.ifcClass || id
  }
  if (t.kind === 'equipment') {
    const e = equipmentById.value.get(t.id)
    if (!e) return null
    const what = whatIs(e)?.label
    const system = e.systemId ? systemById.value.get(e.systemId)?.name : null
    return {
      title: e.name || what || e.ifcClass,
      lines: [[what, system].filter(Boolean).join(' · '), e.spaceId ? `소속 ${spaceNameOf(e.spaceId)}` : '소속 방 없음'].filter(Boolean),
    }
  }
  if (t.kind === 'space') {
    for (const storey of m.storeys) {
      const sp = storey.spaces.find((x) => x.id === t.id)
      if (!sp) continue
      // 패널과 같은 말로 센다(기기만, 덕트·배관은 빼고).
      const devices = storey.equipment.filter((e) => e.spaceId === sp.id && !isConduit(e.role)).length
      return {
        title: sp.longName || sp.name,
        lines: [
          `물리존 ${sp.name} · ${storey.name} · ${sp.areaM2.toFixed(1)}㎡ · 기기 ${devices}대`,
          editing.value ? '클릭하면 꼭짓점을 고칠 수 있습니다' : '클릭하면 이 방에 든 기기를 봅니다',
        ],
      }
    }
    return null
  }
  const c = arrowConnections.value[Number(t.key)]
  if (!c) return null
  const from = c.directed ? c.from : c.edited ? c.edited.from : c.inferred && showRules.value ? c.inferred.from : null
  const to = from === c.from ? c.to : c.from
  const source = c.directed
    ? '포트 방향(BIM) · 고칠 수 없습니다'
    : c.edited
      ? '직접 정한 방향 · 클릭하면 바꿉니다'
      : c.inferred && showRules.value
        ? `규칙 방향(${c.inferred.confirmed ? '확정' : '추정'}) · 클릭하면 바꿉니다`
        : '방향 모름 · 클릭하면 정합니다'
  return { title: from ? `${nameOf(from)} → ${nameOf(to)}` : `${nameOf(c.from)} — ${nameOf(c.to)}`, lines: [source] }
}
function onHover(t: HoverTarget | null, at: { x: number; y: number } | null) {
  const tip = hoverTip.value
  if (!tip) return
  if (!t || !at) {
    hoverKey = ''
    tip.hide()
    return
  }
  const key = t.kind === 'arrow' ? `arrow:${t.key}` : `${t.kind}:${t.id}`
  if (key === hoverKey) return tip.move(at)
  hoverKey = key
  const text = hoverText(t)
  if (text) tip.show(t.kind, text.title, text.lines, at)
  else tip.hide()
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
/**
 * 설비 형상을 감싸는 상자(IFC 좌표). 겹침 판정(lib/overlap.ts)이 쓴다. 형상을 옮기면 shiftMesh 가 좌표 배열을 새로 만들어서
 * 배열마다 한 번만 잰다(성수 배관 없는 설비 1,152대를 방향키마다 다시 재지 않는다).
 */
const ifcBoxes = new WeakMap<Float32Array, Box3>()
function currentBox(id: string): Box3 | null {
  const mesh = meshes.get(id)
  if (!mesh) return null
  const had = ifcBoxes.get(mesh.positions)
  if (had) return had
  const box = meshBox(mesh)
  if (box) ifcBoxes.set(mesh.positions, box)
  return box
}

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

/** 구간의 연 때 축. 처음 물을 때 형상을 떠 둔다(그때는 아직 늘이기 전이다). 형상이 없거나 구간이 아니면 null. */
function segmentAxis(id: string): SegmentAxis | null {
  const known = meshBase.get(id)
  if (known) return known.axis
  const e = equipmentById.value.get(id)
  const mesh = meshes.get(id)
  if (e?.role !== 'segment' || !e.position || !mesh) return null
  return captureBase(id, e.position)?.axis ?? null
}

function captureBase(id: string, at: Vec3) {
  const mesh = meshes.get(id)
  const axis = mesh && segmentAxisOf(mesh.positions)
  if (!mesh || !axis) return null
  const base = { positions: mesh.positions.slice(), at: [at[0], at[1], at[2]] as Vec3, axis }
  meshBase.set(id, base)
  return base
}

/** 늘인 구간의 형상을 지금 모델 값(`endShift`·`position`)으로 다시 만들어 3D 에 올린다. */
function placeStretched(id: string, glide = false) {
  const base = meshBase.get(id)
  const e = equipmentById.value.get(id)
  const mesh = meshes.get(id)
  if (!base || !mesh || !e?.position) return
  const shift = e.endShift ?? [[0, 0, 0], [0, 0, 0]]
  const positions = stretchPositions(base.positions, base.axis, shift, rigidPart(base.axis, base.at, e.position, shift))
  meshes.set(id, { ...mesh, positions })
  if (viewer?.setEquipmentPositions(id, positions, glide)) sceneVersion.value++
  else redraw()
}

/**
 * 알림·되돌리기 이름에 쓰는 짧은 이름. Revit 은 "패밀리:유형:유형:요소ID" 를 이름으로 내보내서(`M_Return Register:
 * RR-600 x 600 Face 300 x 300 Connection:…:607161`) 한 줄 알림이 이름만으로 넘쳤다. 패밀리와 요소 ID 만 남긴다.
 * 제목·표·리포트는 BIM 의 이름 그대로 둔다.
 */
function shortName(name: string | undefined | null): string {
  if (!name) return '설비'
  const revit = /^([^:]+):.+:(\d+)$/.exec(name)
  return revit ? `${revit[1]} #${revit[2]}` : name
}

/** 3D 에서 끈 값은 센티미터로 자른다. 마우스로 1mm 를 뜻하고 놓는 사람은 없다. */
const cm = (v: number) => Math.round(v * 100) / 100

/**
 * 설비 하나의 3D 형상을 좌표가 바뀐 만큼 옮긴다. 모델 전체를 다시 만들면 성수 크기에서 2초가 걸려서,
 * 형상 하나만 옮긴다. 3D 에 없던 설비(좌표가 없다가 생긴 것)와 사라질 설비만 다시 그린다.
 */
function moveInScene(id: string, from: Vec3 | null, to: Vec3 | null, glide = false) {
  if (meshBase.has(id)) {
    placeStretched(id, glide)
    return
  }
  shiftMesh(id, from, to)
  if (from && to && viewer?.shiftEquipment(id, [to[0] - from[0], to[1] - from[1], to[2] - from[2]], glide)) sceneVersion.value++
  else redraw()
}

/**
 * 설비를 옮기는 길은 표(숫자)와 3D(끌기) 둘이지만 하는 일은 하나다. 소속 재판정은 edit.ts 가 한다.
 * `drawnAt` 은 3D 가 이미 그려 둔 자리다(끌어 놓은 경우). 그 자리와 저장한 좌표의 차만큼만 형상을 옮긴다.
 */
/** 겹쳐서 막았다고 알린다. 문구는 OE-SPC-15 가 정한 것이고, 무엇과 겹쳤는지를 뒤에 붙인다(3D 에는 붉은 상자로 짚는다). */
function refuseOverlap(blocked: Equipment) {
  const name = shortName(blocked.name)
  editNotice.value = `이미 오브젝트가 있는 위치입니다(${name}${josa(name, '과/와')} 겹칩니다). 배관 없는 설비는 서로 겹쳐 놓을 수 없습니다.`
  viewer?.markConflict(blocked.id)
}

function relocate(equipmentId: string, to: Vec3, drawnAt?: Vec3, coalesce?: string): boolean {
  if (!model.value) return false
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  // 외벽 전용 설비(외기 센서, OE-OBJ-04)는 외벽 바깥 면으로만 옮긴다. 바깥 면을 따라 옮기는 것은 되고, 벽에서 떼는 것은 막는다.
  const moving = equipmentById.value.get(equipmentId)
  const home = storeyOf(equipmentId)
  const goBack = () => {
    if (drawnAt && before) viewer?.shiftEquipment(equipmentId, [before[0] - drawnAt[0], before[1] - drawnAt[1], before[2] - drawnAt[2]], true)
  }
  // 천장 편집 모드(OE-OBJ-08). 모드 밖의 설비는 옮기지 않고, 천장 설비의 z 는 구역 안에서만 고친다(Q10).
  const lock = moving ? ceilingLock(moving) : null
  if (moving && lock) {
    goBack()
    refuseLock(moving, lock)
    return false
  }
  if (moving && home && ceilingMode.value && (!before || to[2] !== before[2])) {
    const ok = ceilingZCheck(moving, home, to[2])
    if (ok !== true) {
      goBack()
      editNotice.value = ok
      return false
    }
  }
  // 바닥·벽 쪽에서 z 를 올려 천장으로 보내지 않는다 — 천장 설비가 되면 이 쪽에서 다시 못 고친다.
  if (moving && home && editing.value && !ceilingMode.value && before && to[2] !== before[2]) {
    const judged = judgeSurface({ ...moving, position: to }, home, storeyHeightOf.value.get(home.id)?.value ?? null)
    if (judged === 'ceiling' || judged === 'plenum') {
      goBack()
      editNotice.value = `그 높이는 천장(반자 ${meters(ceilingOf(home)!.height)} 근처)입니다. 천장으로 옮기려면 천장 편집 모드에서 하세요.`
      return false
    }
  }
  if (moving && home && exteriorOnly(moving) && !onExteriorFace(home, [to[0], to[1]])) {
    if (drawnAt && before) viewer?.shiftEquipment(equipmentId, [before[0] - drawnAt[0], before[1] - drawnAt[1], before[2] - drawnAt[2]], true)
    editNotice.value = `${EXTERIOR_ONLY} 그 자리는 외벽 바깥 면이 아닙니다. 다른 외벽으로는 [벽에 붙이기]로 옮기세요.`
    return false
  }
  // 배관 없는 설비끼리는 겹쳐 놓지 못한다(OE-OBJ-10·16). 끌어 놓은 것이면 3D 가 이미 그 자리에 그렸으니 되돌려 보낸다.
  const blocked = overlapAt(model.value, equipmentId, to, currentBox)
  if (blocked) {
    if (drawnAt && before) viewer?.shiftEquipment(equipmentId, [before[0] - drawnAt[0], before[1] - drawnAt[1], before[2] - drawnAt[2]], true)
    refuseOverlap(blocked)
    return false
  }
  // 붙은 배관(PRD #13). 옮기기 전에 정한다 — 옮긴 뒤에는 구간의 어느 끝이 가까웠는지 모른다.
  const plan = carryConduits.value && before ? planFollow(model.value, equipmentId, segmentAxis) : null
  const followers = plan ? [...plan.rigid, ...new Set(plan.stretch.map((x) => x.id))] : []
  const own = snapshotEquipment(model.value, equipmentId)
  const snapshot: Snapshot | null =
    own && followers.length ? { kind: 'many', parts: [own, ...followers.flatMap((id) => snapshotEquipment(model.value!, id) ?? [])] } : own
  const at = mark()
  const change = moveEquipment(model.value, equipmentId, to)
  if (!change) return false
  remember(`${shortName(change.equipmentName)} 옮김${followers.length ? ` (배관 ${followers.length}개 따라옴)` : ''}`, snapshot, at, coalesce)
  if (drawnAt) shiftMesh(equipmentId, before, drawnAt)
  moveInScene(equipmentId, drawnAt ?? before, to)
  if (plan && before && followers.length) {
    const was = new Map(followers.map((id) => [id, equipmentById.value.get(id)?.position ?? null]))
    changes.value = [...changes.value, ...applyFollow(model.value, plan, [to[0] - before[0], to[1] - before[1], to[2] - before[2]], segmentAxis)]
    for (const id of followers) moveInScene(id, was.get(id) ?? null, equipmentById.value.get(id)?.position ?? null)
  }
  changes.value = [...changes.value, change]
  triggerRef(model)
  return true
}

// 좌표가 없는 설비(E6)에 표로 넣은 축. 셋이 다 차야 옮긴다(completePosition). 새 파일을 열면 비운다.
const positionDrafts = ref(new Map<string, (number | null)[]>())

/** 건물 범위: 물리존 외곽선 전체의 평면 범위와 층 높이 범위. 좌표 칸의 오타를 알아보는 데 쓴다. */
const buildingBox = computed(() => {
  const m = model.value
  if (!m) return null
  const pts = m.storeys.flatMap((s) => s.spaces.flatMap((sp) => sp.footprint))
  if (!pts.length) return null
  const zs = m.storeys.map((s) => s.elevation)
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])),
    y1: Math.max(...pts.map((p) => p[1])),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
  }
})
/** 건물에서 이만큼 벗어나면 알린다(평면 m). 마당의 실외기처럼 조금 밖에 두는 것은 흔하다. */
const FAR_OUTSIDE = 30
/**
 * 칸에 친 좌표가 건물에서 멀면 알린다. 막지는 않는다(밖에 두는 설비가 있다). 성수에서 x 32.26 을 3226 으로 치자 설비가
 * 3km 밖으로 가고, 전체 보기에서 건물이 점 하나로 줄었는데 리포트에는 "소속 없음" 한 줄뿐이었다.
 */
function warnIfFar(to: Vec3) {
  const b = buildingBox.value
  if (!b) return
  const plan = Math.hypot(Math.max(b.x0 - to[0], 0, to[0] - b.x1), Math.max(b.y0 - to[1], 0, to[1] - b.y1))
  const height = Math.max(b.z0 - 10 - to[2], 0, to[2] - (b.z1 + 20))
  if (plan > FAR_OUTSIDE) editNotice.value = `건물 범위에서 평면으로 ${Math.round(plan).toLocaleString()}m 벗어난 자리입니다. 오타라면 Ctrl+Z 로 되돌리세요.`
  else if (height > 0) editNotice.value = `층 높이 범위에서 ${Math.round(height).toLocaleString()}m 벗어난 높이입니다. 오타라면 Ctrl+Z 로 되돌리세요.`
}

function applyMove(equipmentId: string, axis: 0 | 1 | 2, raw: string, current: readonly number[] | null, input?: HTMLInputElement) {
  if (!model.value) return
  const value = raw.trim() === '' ? null : Number(raw)
  if (value !== null && !Number.isFinite(value)) return

  if (current) {
    // 좌표가 있는 설비의 칸을 비우면 옮기지 않는다. 칸도 지금 값으로 되돌린다(빈 칸으로 두면 좌표가 없어진 것처럼 보였다).
    if (value === null) {
      if (input) input.value = String(mmOf(current[axis]))
      return
    }
    const base: [number, number, number] = [current[0], current[1], current[2]]
    base[axis] = value
    if (relocate(equipmentId, base)) warnIfFar(base)
    // 막혔으면(겹침) 칸도 지금 값으로 되돌린다. 친 값이 남으면 옮겨진 것처럼 보인다.
    else if (input) input.value = String(mmOf(current[axis]))
    return
  }

  // 미배치 설비는 기준 좌표가 없다. 나머지 축을 0 으로 채우지 않고, 셋이 다 찰 때까지 들고 있는다.
  const draft = [...(positionDrafts.value.get(equipmentId) ?? [null, null, null])]
  draft[axis] = value
  const drafts = new Map(positionDrafts.value)
  const to = completePosition(draft)
  if (to) drafts.delete(equipmentId)
  else drafts.set(equipmentId, draft)
  positionDrafts.value = drafts
  if (to && relocate(equipmentId, to)) warnIfFar(to)
}

/**
 * 좌표 칸에 보일 값. BIM 좌표는 19.594049… 처럼 길어서 칸에서 잘렸다. 보이는 것만 mm 로 줄이고 모델 값은 그대로 둔다
 * (칸을 고치지 않으면 옮기지 않는다).
 */
const mmOf = (v: number) => Math.round(v * 1000) / 1000

/** 3D 에서 고른 설비를 끌어 놓았다. 3D 는 이미 놓은 자리에 그려져 있어 다시 만들지 않는다. */
function dropEquipment(equipmentId: string, delta: Vec3) {
  const position = equipmentById.value.get(equipmentId)?.position
  if (!position) return
  // 여러 개 고른 것 중 하나를 끌었으면 전부 같은 거리만큼(OE-UI-09).
  if (group.value.includes(equipmentId)) {
    moveGroup(delta[0], delta[1], { id: equipmentId, drawnAt: [position[0] + delta[0], position[1] + delta[1], position[2]] })
    return
  }
  const drawnAt: Vec3 = [position[0] + delta[0], position[1] + delta[1], position[2]]
  relocate(equipmentId, [cm(drawnAt[0]), cm(drawnAt[1]), position[2]], drawnAt)
}

// --- 여러 개 고르기 (OE-UI-09) -------------------------------------------------------------
//
// 설비만 여러 개 고른다(2026-10-03 사용자 결정). 편집 모드에서 Shift+클릭(3D·평면도·설비 목록)으로 넣고 빼고, Shift+끌기로 상자 안의
// 설비를 더한다. 덕트·배관은 넣지 않는다(상자에 수백 개가 딸려 온다). 둘 이상이면 고른 설비 패널 대신 묶음 패널이 뜨고, 방향키·끌기로
// 같이 옮기고 Delete 로 같이 지운다 — 되돌리기 한 번에 전부. 하나만 남으면 보통 고르기로 돌아간다.
const group = ref<string[]>([])
/** 여러 개 고르기에 넣을 수 있는가. 좌표가 있는 기기(덕트·배관이 아닌 것)만. */
const groupable = (id: string) => {
  const e = equipmentById.value.get(id)
  return !!e && !isConduit(e.role)
}
function setGroup(ids: readonly string[]) {
  const next = [...new Set(ids)].filter(groupable)
  if (next.length >= 2) {
    group.value = next
    selectedId.value = null
    selectedSpaceId.value = null
    selectedSystemId.value = null
    selectedElementId.value = null
    selectedCustomZoneId.value = null
  } else {
    group.value = []
    selectedId.value = next[0] ?? null
  }
}
/** Shift+클릭. 고른 하나가 있으면 그것부터 묶음에 넣는다. */
function toggleGroup(id: string) {
  if (!groupable(id)) {
    note('덕트·배관은 여러 개 고르기에 넣지 않습니다')
    return
  }
  const base = group.value.length ? group.value : selectedId.value ? [selectedId.value] : []
  setGroup(base.includes(id) ? base.filter((x) => x !== id) : [...base, id])
}
/** Shift+끌기 상자. 덕트·배관을 빼고 지금 묶음에 더한다. */
function addBoxToGroup(ids: readonly string[]) {
  const devices = ids.filter(groupable)
  if (!devices.length) return note('상자 안에 고를 설비가 없습니다(덕트·배관은 빼고 셉니다)')
  const base = group.value.length ? group.value : selectedId.value ? [selectedId.value] : []
  setGroup([...base, ...devices])
  if (group.value.length) note(`설비 ${group.value.length}대를 골랐습니다. 방향키·끌기로 같이 옮기고 Delete 로 같이 지웁니다`)
}
const groupItems = computed(() => group.value.map((id) => equipmentById.value.get(id)).filter((e): e is Equipment => !!e))

/**
 * 묶음을 평면으로 같이 옮긴다. 하나라도 막히면(겹침 OE-OBJ-16 · 외벽 전용 OE-OBJ-04) 아무것도 옮기지 않는다 — 일부만 옮기면 묶음의
 * 모양이 깨진다. 묶음끼리는 같은 거리를 가니 서로의 옛 자리와 견주지 않는다. 붙은 배관은 따라오지 않는다. `dragged` 는 3D 에서 끌어
 * 이미 그려 둔 하나다.
 */
function moveGroup(dx: number, dy: number, dragged?: { id: string; drawnAt: Vec3 }, coalesce?: string): boolean {
  const m = model.value
  const items = groupItems.value
  if (!m || items.length < 2) return false
  const revert = () => {
    const was = dragged ? equipmentById.value.get(dragged.id)?.position : null
    if (dragged && was) viewer?.shiftEquipment(dragged.id, [was[0] - dragged.drawnAt[0], was[1] - dragged.drawnAt[1], was[2] - dragged.drawnAt[2]], true)
  }
  if (items.some((e) => !e.position)) {
    revert()
    editNotice.value = '좌표가 없는 설비가 묶음에 있어 같이 옮기지 않습니다. 먼저 그 설비를 놓으세요.'
    return false
  }
  const locked = items.find((e) => ceilingLock(e))
  if (locked) {
    revert()
    refuseLock(locked, `${ceilingLock(locked)} 묶음을 옮기지 않았습니다.`)
    return false
  }
  const members = new Set(items.map((e) => e.id))
  const targets = items.map((e) => ({ e, from: e.position!, to: [cm(e.position![0] + dx), cm(e.position![1] + dy), e.position![2]] as Vec3 }))
  for (const { e, to } of targets) {
    const home = storeyOf(e.id)
    if (home && exteriorOnly(e) && !onExteriorFace(home, [to[0], to[1]])) {
      revert()
      editNotice.value = `${shortName(e.name)}: ${EXTERIOR_ONLY} 묶음을 옮기지 않았습니다.`
      return false
    }
    const blocked = overlapAt(m, e.id, to, currentBox, undefined, members)
    if (blocked) {
      revert()
      const name = shortName(blocked.name)
      editNotice.value = `이미 오브젝트가 있는 위치입니다(${shortName(e.name)}${josa(shortName(e.name), '이/가')} ${name}${josa(name, '과/와')} 겹칩니다). 묶음을 옮기지 않았습니다.`
      viewer?.markConflict(blocked.id)
      return false
    }
  }
  const snapshot: Snapshot = { kind: 'many', parts: targets.flatMap(({ e }) => snapshotEquipment(m, e.id) ?? []) }
  const at = mark()
  const done: Change[] = []
  for (const { e, to } of targets) {
    const change = moveEquipment(m, e.id, to)
    if (change) done.push(change)
  }
  remember(`설비 ${items.length}대 옮김`, snapshot, at, coalesce)
  for (const { e, from, to } of targets) {
    if (dragged?.id === e.id) shiftMesh(e.id, from, dragged.drawnAt)
    moveInScene(e.id, dragged?.id === e.id ? dragged.drawnAt : from, to)
  }
  changes.value = [...changes.value, ...done]
  triggerRef(model)
  return true
}
/** 방향키로 묶음을 옮긴다. 화면의 오른쪽·위쪽에 가장 가까운 평면 축으로(한 대 옮기기와 같다). 꾹 누르면 되돌리기 한 단계로 묶인다. */
function nudgeGroup(code: string, step: number): boolean {
  if (!viewer) return false
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  if (moveGroup(sign * ax * step, sign * ay * step, undefined, 'group-nudge')) note(`설비 ${group.value.length}대를 같이 옮겼습니다`)
  return true
}
/** 묶음을 같이 지운다. 붙은 연결도 같이 빠지고, 되돌리기 한 번에 전부 돌아온다. */
function deleteGroup(): boolean {
  const m = model.value
  const items = groupItems.value
  if (!m || items.length < 2) return false
  const locked = items.find((e) => ceilingLock(e))
  if (locked) {
    refuseLock(locked, `${ceilingLock(locked)} 묶음을 지우지 않았습니다.`)
    return true
  }
  const parts = items.flatMap((e) => snapshotEquipmentSet(m, e.id) ?? [])
  const at = mark()
  let connections = 0
  let rules: RuleReport | null = null
  for (const e of items) {
    const done = deleteEquipment(m, e.id)
    if (!done) continue
    connections += done.connections
    rules = done.rules
  }
  remember(`설비 ${items.length}대 지우기`, { kind: 'many', parts }, at)
  if (rules) ruleReport.value = rules
  group.value = []
  triggerRef(model)
  flowVersion.value++
  redraw()
  note(`설비 ${items.length}대를 지웠습니다${connections ? `(연결 ${connections}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
  return true
}

/** 설비를 다른 층으로(E6). 높이도 두 층 바닥의 차만큼 옮기므로 3D 를 다시 그린다. */
/** 설비를 다른 층으로 옮긴다. 옮긴 층에서 배관 없는 설비와 겹치게 되면 옮기지 않고 false 다(OE-OBJ-16). */
function moveToStorey(equipmentId: string, storeyId: string): boolean {
  if (!model.value) return false
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  const moving = equipmentById.value.get(equipmentId)
  const lock = moving ? ceilingLock(moving) : null
  if (moving && lock) {
    refuseLock(moving, lock)
    return false
  }
  const target = model.value.storeys.find((s) => s.id === storeyId)
  if (moving && target && exteriorOnly(moving) && !(before && onExteriorFace(target, [before[0], before[1]]))) {
    editNotice.value = `${EXTERIOR_ONLY} 그 층의 같은 자리는 외벽 바깥 면이 아닙니다. 층을 옮긴 뒤 [벽에 붙이기]로 붙이세요.`
    return false
  }
  // 층을 옮기면 x·y 는 그대로이고 z 가 층 높이 차만큼 바뀐다(moveEquipmentToStorey). 그 자리로 미리 잰다.
  const from = storeyOf(equipmentId)
  if (before && from && target && from !== target) {
    const to: Vec3 = [before[0], before[1], before[2] + target.elevation - from.elevation]
    const blocked = overlapAt(model.value, equipmentId, to, currentBox, storeyId)
    if (blocked) {
      refuseOverlap(blocked)
      return false
    }
  }
  const snapshot = snapshotEquipment(model.value, equipmentId)
  const at = mark()
  const change = moveEquipmentToStorey(model.value, equipmentId, storeyId)
  if (!change) return false
  remember(`${shortName(change.equipmentName)} 층 옮김`, snapshot, at)
  moveInScene(equipmentId, before, equipmentById.value.get(equipmentId)?.position ?? null)
  changes.value = [...changes.value, change]
  storeyMoved.value = new Set([...storeyMoved.value, equipmentId])
  triggerRef(model)
  // 한 층만 보고 있으면 옮긴 층으로 따라간다. 안 따라가면 고른 설비가 화면에서 사라진 것처럼 보였다. 방금 한 편집을 따라가는 것이라
  // 층 바꾸기를 묻지 않는다(goFloor) — 옮긴 편집은 원래 층의 것으로 남는다(storey-drafts.ts).
  if (viewStorey.value && viewStorey.value !== storeyId) goFloor(storeyId)
  return true
}
/** 패널의 층 칸. 막히면 칸을 지금 층으로 되돌린다 — 고른 층이 남으면 옮겨진 것처럼 보인다. */
function onStoreyPick(equipmentId: string, select: HTMLSelectElement) {
  if (!moveToStorey(equipmentId, select.value)) select.value = storeyOf(equipmentId)?.id ?? ''
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

// --- 되돌리기 (Ctrl+Z) -------------------------------------------------------------
//
// 3D 와 표에서 한 편집을 한 줄로 쌓는다. 어디서 고쳤든 사람에게는 같은 편집이다. 한 단계는 한 번의 조작이고
// (끌기는 누르고 놓기까지), 거부된 것은 쌓지 않는다. 되돌리기는 편집 전 스냅숏을 되돌려 놓고 소속을 다시
// 판정한다(edit.ts 의 restore). 리포트는 편집이 붙인 만큼 잘라 낸다 — summarize 가 남은 이력으로 다시 접으므로
// 그 편집 전의 리포트와 같아진다. 새 파일을 열거나 덧붙일 때만 비운다.
const UNDO_LIMIT = 100
type Mark = { changes: number; areaChanges: number; confirmations: number; storeyMoved: Set<string> }
/** `coalesce` 가 같고 COALESCE_MS 안에 이어진 편집은 한 단계로 묶는다(방향키를 누르고 있는 것). */
type HistoryEntry = Mark & { label: string; snapshot: Snapshot; coalesce?: string; time: number }
const history = shallowRef<HistoryEntry[]>([])
const COALESCE_MS = 1200

// 다시 하기. 되돌릴 때 그 대상의 지금 상태(snapshotOf)와 잘라 낸 리포트를 쌓아 두었다가 그대로 되돌려 놓는다.
// 새 편집을 하면 비운다 — 갈라진 이력의 "다시" 는 뜻이 없다.
type RedoEntry = {
  entry: HistoryEntry
  snapshot: Snapshot
  tail: { changes: Change[]; areaChanges: BoundaryChange[]; confirmations: { systemName: string; count: number }[]; storeyMoved: Set<string> }
}
const future = shallowRef<RedoEntry[]>([])
const mark = (): Mark => ({
  changes: changes.value.length,
  areaChanges: areaChanges.value.length,
  confirmations: confirmations.value.length,
  storeyMoved: storeyMoved.value,
})
function remember(label: string, snapshot: Snapshot | null, at: Mark, coalesce?: string) {
  if (!snapshot) return
  future.value = []
  editNotice.value = ''
  const time = Date.now()
  const last = history.value.at(-1)
  if (coalesce && last?.coalesce === coalesce && time - last.time < COALESCE_MS) {
    // 첫 편집 전의 스냅숏과 표시(mark)를 그대로 둔다. 되돌리면 묶인 것 전부가 한 번에 돌아간다.
    history.value = [...history.value.slice(0, -1), { ...last, label, time }]
    settleLater()
    return
  }
  const next = [...history.value, { ...at, label, snapshot, coalesce, time }]
  // 넘치면 가장 오래된 것부터 버린다. 경계 스냅숏은 외곽선을 통째로 들고 있어 무한히 쌓지 않는다.
  history.value = next.length > UNDO_LIMIT ? next.slice(-UNDO_LIMIT) : next
  if (coalesce) settleLater()
}
/**
 * 묶는 시간은 앞 편집이 **끝난** 때부터 잰다. 큰 모델에서 편집 하나가 화면을 다시 그리는 데 오래 걸리면, 누른
 * 때부터 재는 사이 묶는 시간이 지나 방향키 다섯 번이 되돌리기 다섯 단계가 됐다. 화면 갱신(Vue flush, 3D) 뒤에
 * 도는 setTimeout 에서 시각을 다시 찍는다.
 */
function settleLater() {
  window.setTimeout(() => {
    const top = history.value.at(-1)
    if (top?.coalesce) top.time = Date.now()
  }, 0)
}

// 소속이 바뀐 방을 3D 에서 한 번 번쩍인다. 편집이 붙인 Change 는 들어간 방을, 되돌리기가 잘라 낸 Change 는 돌아간 방을.
// 어느 길로 고쳤든(끌기·표·방향키·경계·되돌리기) changes 하나로 모이므로 여기서 한 번만 본다. 한꺼번에 수백 개가 바뀌는
// 편집(경계·합치기)은 화면 전체가 번쩍여 아무것도 가리키지 않으니 몇 개까지만.
const PULSE_LIMIT = 12
watch(changes, (now, before) => {
  const added = now.length > before.length && now.slice(0, before.length).every((c, i) => c === before[i])
  const removed = now.length < before.length && before.slice(0, now.length).every((c, i) => c === now[i])
  const spaces = new Set<string>()
  if (added) for (const c of now.slice(before.length)) if (c.toSpaceId && c.toSpaceId !== c.fromSpaceId) spaces.add(c.toSpaceId)
  if (removed) for (const c of before.slice(now.length)) if (c.fromSpaceId && c.fromSpaceId !== c.toSpaceId) spaces.add(c.fromSpaceId)
  if (spaces.size && spaces.size <= PULSE_LIMIT) viewer?.pulseSpaces(spaces)
})

function undo() {
  flushNudge()
  const m = model.value
  const entry = history.value.at(-1)
  if (!m || !entry) return
  const after = snapshotOf(m, entry.snapshot)
  history.value = history.value.slice(0, -1)
  if (after) {
    future.value = [
      ...future.value,
      {
        entry,
        snapshot: after,
        tail: {
          changes: changes.value.slice(entry.changes),
          areaChanges: areaChanges.value.slice(entry.areaChanges),
          confirmations: confirmations.value.slice(entry.confirmations),
          storeyMoved: storeyMoved.value,
        },
      },
    ]
  }
  changes.value = changes.value.slice(0, entry.changes)
  areaChanges.value = areaChanges.value.slice(0, entry.areaChanges)
  confirmations.value = confirmations.value.slice(0, entry.confirmations)
  storeyMoved.value = entry.storeyMoved
  applySnapshot(entry.snapshot)
  // 오류가 아니라 잠깐 보이는 안내다. 경고 칸(editNotice)에 두면 다음 경고가 올 때까지 남아서, 뒤이어 누른 단축키의
  // 안내(U 의 "종류 모르는 패밀리 1/23" 같은 것)를 전부 가렸다.
  editNotice.value = ''
  note(`되돌렸습니다: ${entry.label}`)
}

function redo() {
  flushNudge()
  const m = model.value
  const next = future.value.at(-1)
  if (!m || !next) return
  future.value = future.value.slice(0, -1)
  changes.value = [...changes.value, ...next.tail.changes]
  areaChanges.value = [...areaChanges.value, ...next.tail.areaChanges]
  confirmations.value = [...confirmations.value, ...next.tail.confirmations]
  storeyMoved.value = next.tail.storeyMoved
  // 되돌리기 전의 이력 한 줄을 그대로 돌려놓는다. 그 스냅숏이 가리키는 상태가 지금 상태다.
  history.value = [...history.value, { ...next.entry, time: 0 }]
  applySnapshot(next.snapshot)
  editNotice.value = ''
  note(`다시 했습니다: ${next.entry.label}`)
}

/** 스냅숏을 모델에 되돌려 놓고, 바뀐 것에 맞춰 3D 와 화면을 고친다. 되돌리기와 다시 하기가 같이 쓴다. */
function applySnapshot(s: Snapshot) {
  const m = model.value
  if (!m) return
  const drawnAt = s.kind === 'equipment' ? (equipmentById.value.get(s.id)?.position ?? null) : null
  // 배관을 데리고 옮긴 설비. 형상은 설비마다 옮긴다.
  const carried = s.kind === 'many' && s.parts.every((p) => p.kind === 'equipment') ? (s.parts as Extract<Snapshot, { kind: 'equipment' }>[]) : null
  const drawn = new Map(carried?.map((p) => [p.id, equipmentById.value.get(p.id)?.position ?? null]))
  // 벽을 되돌리면 붙은 설비도 같이 돌아온다. 형상도 따라 옮긴다.
  const mounted = s.kind === 'many' || s.kind === 'storey-elements' ? mountedAt(m) : null
  const rules = restore(m, s)
  if (carried) {
    triggerRef(model)
    for (const p of carried) moveInScene(p.id, drawn.get(p.id) ?? null, p.position, true)
  } else if (s.kind === 'equipment') {
    triggerRef(model)
    // 형상도 되돌린다. 안 하면 다시 그릴 때 옮긴 자리에 남는다.
    moveInScene(s.id, drawnAt, s.position, true)
  } else if (s.kind === 'space') {
    triggerRef(model)
    viewer?.updateSpaces(m)
    sceneVersion.value++
  } else if (s.kind === 'equipment-set') {
    // 더하거나 지운 설비. 형상·연결이 같이 바뀌니 3D 를 다시 그리고 규칙 방향 채점도 바꾼다.
    if (rules) ruleReport.value = rules
    if (!model.value?.storeys.some((st) => st.equipment.includes(s.equipment)) && selectedId.value === s.equipment.id) selectedId.value = null
    triggerRef(model)
    flowVersion.value++
    redraw()
  } else if (s.kind === 'many') {
    // 벽과 함께 방 경계를 옮긴 것. 벽·방 둘 다 다시 그린다.
    if (selectedSpaceId.value && !m.storeys.some((st) => st.spaces.some((x) => x.id === selectedSpaceId.value))) selectedSpaceId.value = null
    archEdited = true
    triggerRef(model)
    if (mounted) followMounted(mounted, true)
    viewer?.updateSpaces(m)
    sceneVersion.value++
  } else if (s.kind === 'storey-elements') {
    if (selectedElementId.value && !m.storeys.some((st) => st.walls.some((w) => w.id === selectedElementId.value) || st.openings.some((o) => o.id === selectedElementId.value))) {
      selectedElementId.value = null
    }
    archEdited = true
    triggerRef(model)
    if (mounted) followMounted(mounted, true)
    sceneVersion.value++
  } else if (s.kind === 'storey-spaces') {
    if (selectedSpaceId.value && !m.storeys.some((st) => st.spaces.some((x) => x.id === selectedSpaceId.value))) selectedSpaceId.value = null
    triggerRef(model)
    viewer?.updateSpaces(m)
    sceneVersion.value++
  } else if (s.kind === 'custom-zones') {
    // 커스텀존 목록(OE-OBJ-01). 없어진 존을 고르고 있었으면 푼다. 점선은 sceneVersion 을 보고 다시 그린다.
    if (selectedCustomZoneId.value && !m.storeys.some((st) => st.customZones?.some((z) => z.id === selectedCustomZoneId.value))) selectedCustomZoneId.value = null
    triggerRef(model)
    sceneVersion.value++
  } else if (s.kind === 'kinds' || s.kind === 'connection') {
    // 종류·연결을 되돌리면 edit.ts 가 규칙 방향도 다시 돌렸다. 채점표도 그것으로 바꾼다.
    if (rules) ruleReport.value = rules
    triggerRef(model)
    flowVersion.value++
  } else if (s.kind === 'systems') {
    // 계통 구성원이 바뀌면 3D 의 계통 색도 바뀐다.
    if (rules) ruleReport.value = rules
    triggerRef(model)
    flowVersion.value++
    // 계통 구성원이나 목록이 바뀌면 3D 의 계통 색이 바뀐다(색은 목록 순서로 정한다).
    if (s.equipment.length || s.list) redraw()
  } else {
    // 방향·확정은 소속과 상관이 없다. 모델 전체에 갱신 신호를 보내지 않는다(confirmRule 과 같은 이유).
    flowVersion.value++
  }
}

/** 글자를 치는 칸. 여기의 Ctrl+Z 는 그 칸의 실행취소다. 체크박스·선택 상자는 치는 칸이 아니다. */
function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(target.type)
}

// --- 단축키 -------------------------------------------------------------------------
//
// 키 표는 lib/shortcuts.ts 하나다. `?` 안내도 같은 표를 읽는다. 여기는 눌린 키를 받아 할 일로 옮기기만 한다.
// 처리한 키만 브라우저 기본 동작을 막는다 — 고른 설비가 없을 때 ↓ 는 여전히 페이지를 내린다.
const helpOpen = ref(false)
/** 키로 한 일을 캔버스 아래에 잠깐 알린다. 버튼과 달리 키는 누른 결과가 눈에 안 보일 때가 많다. */
const keyNote = ref('')
let keyNoteTimer: number | undefined
function note(text: string) {
  keyNote.value = text
  window.clearTimeout(keyNoteTimer)
  keyNoteTimer = window.setTimeout(() => (keyNote.value = ''), 2600)
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing || !model.value) return
  // 글자 칸의 Esc 는 칸에서 나온다. 좌표를 넣은 뒤 마우스 없이 다음 단축키(N, U …)로 이어 가게 한다.
  if (e.key === 'Escape' && isTextEntry(e.target) && !helpOpen.value) {
    ;(e.target as HTMLElement).blur()
    e.preventDefault()
    return
  }
  const shortcut = matchShortcut(e)
  if (!shortcut) return
  // 모아 둔 방향키는 다른 키보다 먼저 옮긴다. 안 그러면 방향키 바로 뒤의 Ctrl+Z 가 옮기기 전을 되돌리고, 옮기기는
  // 그 뒤에 일어난다.
  if (shortcut.id !== 'nudge') flushNudge()
  // 안내가 열려 있으면 뒤의 화면은 키를 받지 않는다(닫기는 대화상자가 Esc 로 한다).
  if (helpOpen.value && shortcut.id !== 'help') return
  // 글자를 치는 칸의 키는 그 칸 몫이다(그 칸의 Ctrl+Z 는 글자 되돌리기다). 선택 상자는 글자·방향키로 항목을
  // 고르니 수식 키 없는 키는 넘기고, Ctrl 조합과 Esc 만 받는다.
  // 저장만은 글자 칸에서도 받는다. 거기서 Ctrl+S 는 브라우저의 "페이지 저장" 이라 쓸모가 없다.
  if (isTextEntry(e.target) && shortcut.id !== 'save') return
  if (e.target instanceof HTMLSelectElement && !(e.ctrlKey || e.metaKey) && shortcut.id !== 'escape') return
  // 보기 모드에는 고치는 손잡이가 없다. 끄는 중에는 Esc 가 뷰어의 취소다.
  if (shortcut.edit && !editing.value) return
  if (viewer?.isDragging()) return
  if (runShortcut(shortcut, e)) e.preventDefault()
}
window.addEventListener('keydown', onKey)
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const searchInput = ref<HTMLInputElement | null>(null)
const kindSelect = ref<HTMLSelectElement | null>(null)

/** 단축키 하나를 한다. 할 것이 없어서 넘긴 키는 false 다(브라우저 기본 동작을 살린다). */
function runShortcut(s: Shortcut, e: KeyboardEvent): boolean {
  switch (s.id) {
    case 'help':
      helpOpen.value = !helpOpen.value
      return true
    case 'mode':
      if (editing.value) {
        if (leaveEdit()) note('보기 모드')
      } else {
        mode.value = 'edit'
        note('편집 모드')
      }
      return true
    case 'search':
      if (!searchInput.value) return false
      searchInput.value.scrollIntoView({ block: 'center' })
      searchInput.value.focus()
      return true
    case 'escape':
      return clearSelection()
    case 'frame':
      return frameSelection()
    case 'frameAll':
      viewer?.frameAll()
      return true
    case 'rules':
      showRules.value = !showRules.value
      note(showRules.value ? '3D에 규칙 방향을 표시합니다' : '3D에서 규칙 방향을 숨깁니다')
      return true
    case 'walls':
      if (!drawnWalls.value) {
        note('표시할 내력벽이 없습니다')
        return true
      }
      showWalls.value = !showWalls.value
      return true
    case 'save':
      void saveEdits()
      return true
    case 'undo':
      if (!history.value.length) note('되돌릴 편집이 없습니다')
      undo()
      return true
    case 'redo':
      if (!future.value.length) note('다시 할 편집이 없습니다')
      redo()
      return true
    case 'nudge':
      return nudge(e.code, e.shiftKey ? 1 : 0.1)
    case 'storeyUp':
    case 'storeyDown':
      return stepStorey(s.id === 'storeyUp' ? 1 : -1)
    case 'arrowPrev':
    case 'arrowNext':
      return stepArrow(s.id === 'arrowNext' ? 1 : -1)
    case 'flow':
      return flowByKey()
    case 'ceiling':
      setCeilingMode(!ceilingMode.value)
      return true
    case 'confirm': {
      const r = selectedRule.value
      if (!r) return false
      if (r.confirmed) note(`이미 확정한 계통입니다: ${r.name}`)
      else if (r.count === 0) note('이 계통에는 규칙 방향이 없습니다')
      else confirmRule(r.systemId, r.name)
      return true
    }
    case 'kind':
      if (!kindSelect.value) return false
      kindSelect.value.focus()
      try {
        // 목록을 바로 편다. 닫힌 채 방향키로 고르면 누를 때마다 종류가 바뀌고 규칙을 다시 돌린다.
        kindSelect.value.showPicker()
      } catch {
        // showPicker 가 없는 브라우저는 포커스만 옮긴다(Alt+↓ 로 편다).
      }
      return true
    case 'nextUnknown':
    case 'prevUnknown':
      return stepUnknown(s.id === 'nextUnknown' ? 1 : -1)
    case 'nextIssue':
    case 'prevIssue':
      return stepIssue(s.id === 'nextIssue' ? 1 : -1)
    case 'vertexInsert':
      return editVertex('insert')
    case 'vertexDelete':
      // 여러 개 고른 설비가 있으면 같이 지운다(OE-UI-09). 없으면 짚은 꼭짓점 지우기.
      if (group.value.length >= 2) return deleteGroup()
      return editVertex('delete')
    case 'drawFinish':
      return finishDraw()
  }
}

/**
 * N. 완전성 검사를 할 일 목록으로 쓴다 — 어긴 것을 하나씩 골라 고치고 N 으로 다음 것에 간다. 고친 것은 목록에서
 * 빠지므로, 고른 것이 목록에 없으면 남은 것의 처음부터 간다. 펼친 규칙이 없으면 어긴 것이 있는 첫 규칙을 편다.
 */
function stepIssue(dir: 1 | -1): boolean {
  const failing = checks.value.filter((c) => !c.skipped && c.failed.length > 0)
  if (!failing.length) {
    note('완전성 검사 위반이 없습니다')
    return true
  }
  const check = openCheck.value && openCheck.value.failed.length ? openCheck.value : failing[0]
  openCheckKey.value = check.key
  const ids = check.failed
  const here = selectedId.value ? ids.indexOf(selectedId.value) : -1
  const i = here < 0 ? (dir > 0 ? 0 : ids.length - 1) : (here + dir + ids.length) % ids.length
  selectAndShow(ids[i])
  const e = equipmentById.value.get(ids[i])
  note(`${check.rule} — 위반 ${i + 1}/${ids.length}: ${shortName(e?.name || e?.ifcClass)}`)
  return true
}

/** Esc. 짚은 연결 → 고른 설비·물리존·계통 → 펼친 검사 순으로 하나씩 푼다. */
function clearSelection(): boolean {
  if (drawing.value) {
    const purpose = drawing.value.purpose
    stopDraw()
    note(
      purpose === 'split' || purpose === 'customSplit'
        ? '나누기를 취소했습니다'
        : purpose === 'create'
          ? '물리존 그리기를 취소했습니다'
          : purpose === 'custom'
            ? '커스텀존 그리기를 취소했습니다'
            : '외곽선 그리기를 취소했습니다',
    )
  } else if (adding.value) {
    const what = adding.value.what
    stopAdd()
    note(what === 'equipment' ? '설비 더하기를 취소했습니다' : what === 'door' ? '문 놓기를 취소했습니다' : '창 놓기를 취소했습니다')
  } else if (group.value.length) {
    group.value = []
  } else if (selectedElementId.value) {
    selectedElementId.value = null
  } else if (selectedCustomZoneId.value) {
    selectedCustomZoneId.value = null
  } else if (placing.value) {
    stopPlace()
    note('놓기를 취소했습니다')
  } else if (connectFrom.value) {
    connectFrom.value = null
    note('연결하기를 취소했습니다')
  } else if (activeArrow.value !== null) activeArrow.value = null
  else if (activeVertex.value !== null) activeVertex.value = null
  else if (selectedId.value) select(null)
  else if (selectedSpaceId.value) selectedSpaceId.value = null
  else if (selectedSystemId.value) selectedSystemId.value = null
  else if (openCheckKey.value) openCheckKey.value = null
  else return false
  return true
}

function frameSelection(): boolean {
  if (selectedId.value) frameNetwork()
  else if (selectedSpaceId.value) viewer?.frameSpace(selectedSpaceId.value)
  else if (selectedCustomZone.value?.equipment.length) viewer?.frame(selectedCustomZone.value.equipment)
  else if (selectedSystemId.value) viewer?.frame(systemById.value.get(selectedSystemId.value)?.memberIds ?? [])
  else if (openCheck.value?.failed.length) viewer?.frame(openCheck.value.failed)
  else viewer?.frameAll()
  return true
}

/** 방향키. 화면의 오른쪽·위쪽에 가장 가까운 평면 축으로 옮긴다(snapAxis). */
function nudge(code: string, step: number): boolean {
  if (group.value.length >= 2) return nudgeGroup(code, step)
  if (!selected.value && selectedElement.value && viewer) return nudgeElement(code, step)
  if (!selected.value && selectedSpace.value && viewer) return nudgeVertex(code, step)
  const e = selected.value
  if (!e || !viewer) return false
  if (!e.position) {
    note('좌표가 없는 설비입니다. 먼저 x·y·z를 넣으세요.')
    return true
  }
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const dx = sign * ax * step
  const dy = sign * ay * step
  if (pendingNudge?.id === e.id) {
    pendingNudge.dx += dx
    pendingNudge.dy += dy
    return true
  }
  flushNudge()
  pendingNudge = { id: e.id, dx, dy }
  requestAnimationFrame(flushNudge)
  return true
}

// 방향키는 한 프레임에 모아 한 번에 옮긴다. 성수에서 한 번 옮기는 데 0.2초가 들어서, 꾹 누른 키(초당 수십 번)를
// 하나씩 옮기면 키가 줄을 서서 손을 뗀 뒤에도 몇 초씩 따라 움직였다.
let pendingNudge: { id: string; dx: number; dy: number } | null = null
// 마우스로 하는 편집(끌기, 버튼)도 모아 둔 방향키 뒤에 온다.
window.addEventListener('pointerdown', () => flushNudge(), { capture: true })
function flushNudge() {
  const p = pendingNudge
  pendingNudge = null
  const e = p ? equipmentById.value.get(p.id) : undefined
  if (!p || !e?.position) return
  const to: Vec3 = [cm(e.position[0] + p.dx), cm(e.position[1] + p.dy), e.position[2]]
  relocate(e.id, to, undefined, `nudge:${e.id}`)
  note(`${shortName(e.name)} → x ${to[0].toFixed(2)} · y ${to[1].toFixed(2)} · ${spaceNameOf(equipmentById.value.get(e.id)?.spaceId ?? null)}`)
}

/** 짚은 꼭짓점을 방향키로. 끌어 놓을 때처럼 경계가 엇갈리는 자리에는 놓지 않는다. */
function nudgeVertex(code: string, step: number): boolean {
  const picked = selectedSpace.value!
  const index = activeVertex.value
  if (index === null) {
    note('[ ]로 꼭짓점을 먼저 고르세요')
    return true
  }
  const p = picked.space.footprint[index]
  const { right, up } = viewer!.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const to: Vec2 = [cm(p[0] + sign * ax * step), cm(p[1] + sign * ay * step)]
  if (wouldSelfIntersect(model.value!, picked.space.id, index, to)) {
    note('경계선이 교차해서 옮기지 않았습니다')
    return true
  }
  moveVertex(picked.space.id, index, to, `vertex:${picked.space.id}:${index}`)
  note(`꼭짓점 ${index + 1} → (${to[0].toFixed(2)}, ${to[1].toFixed(2)}) · ${picked.space.areaM2.toFixed(1)}㎡`)
  return true
}

function stepStorey(dir: 1 | -1): boolean {
  const e = selected.value
  const m = model.value
  if (!e || !m) return false
  const order = [...m.storeys].sort((a, b) => a.elevation - b.elevation)
  const at = order.findIndex((s) => s.equipment.some((x) => x.id === e.id))
  const next = order[at + dir]
  if (!next) {
    note(dir > 0 ? '맨 위층입니다' : '맨 아래층입니다')
    return true
  }
  // 막혔으면(겹침) 안내가 이미 떴으니 덮어쓰지 않는다
  if (moveToStorey(e.id, next.id)) note(`${shortName(e.name)} → ${next.name}`)
  return true
}

function stepArrow(dir: 1 | -1): boolean {
  // 물리존을 골랐으면 [ ] 는 꼭짓점을 짚는다.
  if (!selected.value && selectedSpace.value) {
    const n = vertexCount.value
    if (n === 0) return false
    const cur = activeVertex.value
    activeVertex.value = cur === null ? (dir > 0 ? 0 : n - 1) : (cur + dir + n) % n
    const p = selectedSpace.value.space.footprint[activeVertex.value]
    note(`꼭짓점 ${activeVertex.value + 1}/${n} (${p[0].toFixed(2)}, ${p[1].toFixed(2)}) · ←↑→↓로 옮깁니다`)
    return true
  }
  const n = arrowConnections.value.length
  if (!selected.value) return false
  if (n === 0) {
    note('고른 설비에 연결이 없습니다')
    return true
  }
  const cur = activeArrow.value
  activeArrow.value = cur === null ? (dir > 0 ? 0 : n - 1) : (cur + dir + n) % n
  const row = selectedNeighbors.value[activeArrow.value]
  if (row) note(`연결 ${activeArrow.value + 1}/${n}: ${shortName(row.name)} (${relLabel(row)}) · D로 방향을 바꿉니다`)
  return true
}

function flowByKey(): boolean {
  const n = arrowConnections.value.length
  if (!selected.value) return false
  if (n === 0) {
    note('고른 설비에 연결이 없습니다')
    return true
  }
  if (activeArrow.value === null) {
    if (n > 1) {
      activeArrow.value = 0
      note(`연결이 ${n}개입니다. [ ]로 고른 뒤 D를 누르세요`)
      return true
    }
    activeArrow.value = 0
  }
  cycleFlow(String(activeArrow.value))
  const row = selectedNeighbors.value[activeArrow.value]
  if (row && !row.connection.directed) note(`${shortName(row.name)}: ${relLabel(row)}`)
  return true
}

/** U. 종류를 모르는 패밀리를 대수 순으로 하나씩 돌며 그 패밀리의 설비 하나를 고른다. K 로 바로 종류를 붙인다. */
function stepUnknown(dir: 1 | -1): boolean {
  const list = unknownTypes.value
  if (!list.length) {
    note('종류를 모르는 설비가 없습니다')
    return true
  }
  const here = selected.value ? list.findIndex((t) => t.key === familyKeyOf(selected.value!)) : -1
  const i = here < 0 ? (dir > 0 ? 0 : list.length - 1) : (here + dir + list.length) % list.length
  const t = list[i]
  selectAndShow(t.sampleId)
  note(`종류 모르는 패밀리 ${i + 1}/${list.length}: ${t.label} ${t.count}대 · K로 종류를 고릅니다`)
  return true
}

function applyVertex(spaceId: string, index: number, axis: 0 | 1, raw: string, current: readonly number[]) {
  const value = Number(raw)
  if (!model.value || !Number.isFinite(value)) return

  const point: [number, number] = [current[0], current[1]]
  point[axis] = value

  moveVertex(spaceId, index, point)
}

/** 꼭짓점 하나를 옮긴다. 표와 3D 가 같이 쓴다. 자기 교차를 막을지는 부르는 쪽이 정한다. */
function moveVertex(spaceId: string, index: number, to: Vec2, coalesce?: string) {
  if (!model.value) return
  const snapshot = snapshotSpace(model.value, spaceId)
  const at = mark()
  const change = moveSpaceVertex(model.value, spaceId, index, to)
  if (!change) return
  remember(`${change.spaceName} 꼭짓점`, snapshot, at, coalesce)
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
    editNotice.value = '경계선이 교차하는 위치라 꼭짓점을 원래 자리로 되돌렸습니다.'
    // 끌던 손잡이를 원래 고리로 다시 그린다.
    sceneVersion.value++
    return
  }
  editNotice.value = ''
  moveVertex(spaceId, index, to)
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
/**
 * 설비 목록의 설치면 거르기(OE-OBJ-08 "설치면 필터"). 그 면에 놓을 수 있는 종류를 남긴다 — CCTV 는 천장·벽 둘 다에 든다.
 * `none` 은 설치면을 정하지 않은 종류(표에 없는 종류·종류 모름)다. 덕트·배관은 거르면 빠진다.
 */
const surfaceFilter = ref<'' | Surface | 'none'>('')
const editLimit = ref(EDIT_LIMIT)
watch([editStorey, editQuery, fileName, () => surfaceFilter.value], () => {
  editLimit.value = EDIT_LIMIT
})
watch(fileName, () => {
  editStorey.value = ''
  editQuery.value = ''
})

/** 층이나 이름으로 좁혔나. 표 머리의 수를 "찾은 것 N / 전체" 로 바꾼다 — 전체 수만 두었더니 좁혀 0건인 표가 비어 보였다. */
const narrowed = computed(() => !!editStorey.value || !!editQuery.value.trim() || !!surfaceFilter.value)
const matches = (text: string) => {
  const q = editQuery.value.trim().toLowerCase()
  return !q || text.toLowerCase().includes(q)
}
const editStoreys = computed(() =>
  (model.value?.storeys ?? []).filter((s) => !editStorey.value || s.id === editStorey.value),
)
// 설치면 필터(OE-EQP-05). 기준은 판정 설치면이고 플레넘은 천장으로 센다. "미정" 은 판정하지 못한 설비다. 도관과 설치면 없는 종류
// (배관·덕트 위 밸브·댐퍼)는 어느 면에도 들지 않는다.
const judgedById = computed(() => new Map(surfaceRows.value.map((r) => [r.equipment.id, r.judged])))
const surfaceMatches = (e: Equipment) => {
  const f = surfaceFilter.value
  if (!f) return true
  if (isConduit(e.role) || !judgedById.value.has(e.id)) return false
  const judged = judgedById.value.get(e.id) ?? null
  if (f === 'none') return judged === null
  if (f === 'ceiling') return judged === 'ceiling' || judged === 'plenum'
  return judged === f
}
const editSpaces = computed(() =>
  editStoreys.value
    .flatMap((storey) => storey.spaces.map((space) => ({ storey, space })))
    .filter(({ space }) => matches(`${space.name} ${space.longName ?? ''}`)),
)
// 설비는 소속 방 이름으로도 찾는다. 보기 모드에는 물리존 표가 없어서, "S.T"·"OFFICE" 를 치면 아무것도 안 나왔다.
// 든 커스텀존의 이름·별명으로도 찾는다(ADR-0012) — "임원석" 을 치면 그 존 안의 설비가 나온다.
const editEquipment = computed(() => {
  const zoneText = new Map<string, string>()
  if (editQuery.value.trim() && model.value) for (const [id, names] of zoneNamesOfEquipment(model.value)) zoneText.set(id, names.join(' '))
  return editStoreys.value.flatMap((s) => {
    const room = new Map(s.spaces.map((sp) => [sp.id, `${sp.name} ${sp.longName ?? ''}`]))
    return s.equipment.filter(
      (e) => surfaceMatches(e) && matches(`${e.name} ${e.ifcClass} ${kindLabel(e)} ${e.spaceId ? room.get(e.spaceId) ?? '' : ''} ${zoneText.get(e.id) ?? ''}`),
    )
  })
})

/**
 * 치는 중인 칸을 모델 값으로 덮지 않는다(`v-keep-typing`).
 *
 * Vue 는 화면을 다시 그릴 때마다 `:value` 를 칸에 다시 넣는다. 편집 뒤 등급을 다시 재는 타이머(TIERS_DELAY)가
 * 화면을 다시 그리면, 그 사이 오른쪽 패널에서 치던 방 이름·좌표가 원래 값으로 돌아갔다(App 템플릿에 바로 있는
 * 칸이라 App 이 다시 그려질 때마다 덮인다. 아래 표는 Fold 슬롯이라 덜 걸리지만 같은 수를 둔다). 포커스가 있고
 * 사람이 값을 바꾼 칸만 지킨다. 넣는 것은 여전히 change(Enter·칸 나가기) 한 번이다.
 */
const typing = new WeakMap<HTMLInputElement, string>()
const vKeepTyping: Directive<HTMLInputElement> = {
  beforeUpdate(el, _binding, _vnode, prev) {
    if (document.activeElement !== el) return
    if (el.value !== String(prev.props?.value ?? '')) typing.set(el, el.value)
  },
  updated(el) {
    const draft = typing.get(el)
    if (draft === undefined) return
    typing.delete(el)
    el.value = draft
  },
}

function applyRename(spaceId: string, name: string) {
  if (!model.value) return
  const snapshot = snapshotSpace(model.value, spaceId)
  if (snapshot?.kind === 'space' && snapshot.longName === name) return
  const at = mark()
  if (!renameSpace(model.value, spaceId, name)) return
  remember(`이름 ${snapshot?.kind === 'space' ? snapshot.longName || '(없음)' : ''} → ${name}`, snapshot, at)
  triggerRef(model)
}

let drawn: Model | null = null
let drawTimer: number | undefined
watch([model, canvas], ([m, el]) => {
  if (!m || !el) return
  if (!viewer) {
    viewer = createViewer(el)
    viewer.onPick((id, additive) => {
      if (connectFrom.value && id) return connectTo(id)
      if (additive && id) return toggleGroup(id)
      group.value = []
      selectedId.value = id
    })
    viewer.onBoxSelect(addBoxToGroup)
    viewer.onHover(onHover)
    viewer.onPlace((at) => placeAt(at))
    viewer.onPickSpace(pickSpace)
    viewer.onEquipmentMove(dropEquipment)
    viewer.onPickElement((id) => (selectedElementId.value = id))
    viewer.onVertexMove(dropVertex)
    viewer.onArrowClick(cycleFlow)
    viewer.setWallsVisible(showWalls.value)
    viewer.setEditMode(editing.value)
    viewer.setDark(dark.value)
  }
  // 편집이 보낸 갱신(triggerRef)으로는 다시 만들지 않는다(redraw 참조). 새 모델일 때만이다.
  if (m === drawn) return
  // 한 태스크 뒤에 그린다. 여는 태스크에 합치기가 이미 0.4초라, 3D 준비(성수 0.35초)까지 붙이면 그만큼 더 멈췄다.
  window.clearTimeout(drawTimer)
  drawTimer = window.setTimeout(() => {
    const now = model.value
    if (!viewer || !now || now === drawn) return
    drawn = now
    viewer.setModel(now, meshes)
    sceneVersion.value++
  }, 0)
})

watch(editing, (on) => {
  viewer?.setEditMode(on)
  editNotice.value = ''
})

// --- 3D 에서 고른 물리존 (E2) ------------------------------------------------------
//
// 바닥을 누르면 그 물리존이 골라진다. 편집 모드면 꼭짓점에 손잡이가 뜬다. 설비 선택과 배타다.
const selectedSpaceId = ref<string | null>(null)
const spaceDevices = computed(() => selectedSpace.value?.equipment.filter((e) => !isConduit(e.role)) ?? [])
/** 기기가 많은 방(성수 사무실 318대)은 목록 위에 종류별 수를 한 줄로 둔다. */
const spaceKinds = computed(() => {
  const n = new Map<string, number>()
  for (const e of spaceDevices.value) {
    const k = whatIs(e)?.label ?? '모름'
    n.set(k, (n.get(k) ?? 0) + 1)
  }
  return [...n].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(' · ')
})
const spaceConduits = computed(() => selectedSpace.value?.equipment.filter((e) => isConduit(e.role)) ?? [])
/** 3D 바닥이나 평면도의 방을 눌렀을 때. 평면도가 제 안에만 들고 있었더니 방에 테두리만 뜨고 패널은 앞서 고른 설비였다. */
function pickSpace(id: string | null) {
  selectedSpaceId.value = id
  if (id) {
    selectedId.value = null
    selectedSystemId.value = null
  }
}
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
/** 외곽선이 없던 물리존에 3D 에서 찍어 가는 꼭짓점. 아래 "외곽선 그리기" 참조. */
/**
 * 3D 바닥에 점을 찍는 편집. `footprint` 는 외곽선이 없던 물리존에 외곽선을 그리는 것, `create` 는 새 물리존을 그리는
 * 것(E3), `split` 은 두 점으로 나눌 선을 긋는 것(E3)이다.
 */
/** `custom`·`customSplit` 은 커스텀존(OE-OBJ-01) 그리기·나누기다. `customSplit` 의 spaceId 자리에는 존 id 가 든다. */
type Drawing = {
  purpose: 'footprint' | 'create' | 'split' | 'wall' | 'custom' | 'customSplit'
  spaceId: string | null
  storeyId: string
  name: string
  elevation: number
  points: Vec2[]
}
const drawing = ref<Drawing | null>(null)
watch([selectedSpace, editing, sceneVersion, drawing], () => {
  const picked = selectedSpace.value
  if (!viewer) return
  if (drawing.value) {
    const d = drawing.value
    viewer.setSpaceHandles({ id: d.spaceId ?? 'new', ring: d.points, elevation: d.elevation, active: d.points.length ? d.points.length - 1 : null })
    return
  }
  if (!picked) {
    viewer.setSpaceHandles(null)
    return
  }
  // 닫는 점(첫 점과 같은 끝 점)은 손잡이를 따로 두지 않는다. 첫 점을 옮기면 edit.ts 가 끝 점을 같이 옮긴다.
  const ring = picked.space.footprint
  const last = ring.at(-1)
  const closed = ring.length > 1 && !!last && ring[0][0] === last[0] && ring[0][1] === last[1]
  viewer.setSpaceHandles({
    id: picked.space.id,
    ring: closed ? ring.slice(0, -1) : ring,
    elevation: picked.storey.elevation,
    active: activeVertex.value,
  })
})
/** 키보드([ ])로 짚은 꼭짓점. 물리존을 바꾸면 풀린다. */
const activeVertex = ref<number | null>(null)
watch([selectedSpaceId, editing], () => (activeVertex.value = null))
watch(activeVertex, () => sceneVersion.value++)
/** 손잡이를 다는 꼭짓점 수(닫는 점 빼고). */
const vertexCount = computed(() => {
  const ring = selectedSpace.value?.space.footprint ?? []
  const last = ring.at(-1)
  return ring.length > 1 && last && ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.length - 1 : ring.length
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

/**
 * 규칙 방향이 선 계통 전부. 확정은 고른 설비의 패널에서만 할 수 있어서, 어느 계통이 남았는지 보려면 계통마다 설비를
 * 하나씩 찾아 골라야 했다. 확정 안 한 것부터, 규칙 방향이 많은 것부터 둔다. 일치율은 그 계통에서 포트가 이미 말한
 * 연결에 같은 규칙을 대 본 값이다(확정한 계통은 규칙을 다시 돌리지 않아 비어 있다).
 */
const ruleSystems = computed(() => {
  void flowVersion.value
  const m = model.value
  const r = ruleReport.value
  if (!m) return []
  const bySystem = new Map<string, { count: number; confirmed: number }>()
  for (const c of m.connections) {
    if (!c.inferred) continue
    const row = bySystem.get(c.inferred.systemId) ?? { count: 0, confirmed: 0 }
    row.count++
    if (c.inferred.confirmed) row.confirmed++
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
        confirmed: n.confirmed === n.count,
        agree: tally?.agree ?? 0,
        checked,
        pct: checked > 0 ? Math.round(((tally?.agree ?? 0) / checked) * 100) : null,
      }
    })
    .sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || b.count - a.count)
})

/**
 * 포트와 잘 맞는 계통을 한꺼번에 확정한다. 성수는 규칙이 방향을 준 계통이 348개라 하나씩 누르면 45초가 걸렸다.
 * 포트와 대 볼 연결이 BULK_MIN_CHECKED 개 넘게 있고 일치율이 문턱 이상인 것만 고른다 — 대 볼 것이 없는 계통은
 * 맞는지 모르므로 사람이 3D 로 흐름을 보고 하나씩 확정한다. 되돌리기는 한 번이다.
 */
const BULK_MIN_CHECKED = 20
const bulkThreshold = ref(90)
const bulkCandidates = computed(() =>
  ruleSystems.value.filter((r) => !r.confirmed && r.pct !== null && r.checked >= BULK_MIN_CHECKED && r.pct >= bulkThreshold.value),
)
function confirmMatching() {
  const m = model.value
  const rows = bulkCandidates.value
  if (!m || !rows.length) return
  const snapshot = snapshotConfirm(m, rows.map((r) => r.id))
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
  note(`계통 ${done.length}개, 규칙 방향 ${done.reduce((n, d) => n + d.count, 0)}개를 확정했습니다. brick:feeds 로 내보냅니다`)
}

function confirmRule(systemId: string, systemName: string) {
  if (!model.value) return
  const snapshot = snapshotConfirm(model.value, systemId)
  const at = mark()
  const n = confirmSystemFlow(model.value, systemId)
  if (n === 0) return
  remember(`계통 ${systemName} 확정`, snapshot, at)
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
  what: { label: string; src: SrcKind } | null
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
      what: whatIs(equipmentById.value.get(n.id)),
    }
  })
})
/** 한 층만 보는 중에 다른 층에 있는 설비면 그 층 이름. 모든 층을 보면 null. */
function otherFloor(id: string): string | null {
  if (!viewStorey.value) return null
  const home = storeyOf(id)
  return home && home.id !== viewStorey.value ? home.name : null
}
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
  flowTo(n.connection, from)
}
/** 연결 하나의 방향을 정한다. 표의 버튼과 3D 화살표가 같이 쓴다. */
function flowTo(c: Connection, from: string | null) {
  const snapshot = snapshotFlow(c)
  const at = mark()
  if (!setFlowDirection(c, from)) return
  const name = (id: string) => equipmentById.value.get(id)?.name || id
  remember(`${name(c.from)}–${name(c.to)} 방향`, snapshot, at)
  flowVersion.value++
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
function arrowOf(c: Connection, key: string, active: boolean): Arrow {
  const base = { key, a: c.from, b: c.to, active }
  if (c.directed) return { ...base, from: c.from, source: 'port' }
  if (c.edited) return { ...base, from: c.edited.from, source: 'edit' }
  if (c.inferred && showRules.value) return { ...base, from: c.inferred.from, source: 'rule' }
  return { ...base, from: null, source: 'none' }
}
/** 키보드([ ])로 짚은 연결의 자리. 연결 표(selectedNeighbors)와 같은 순서다. 설비를 바꾸면 풀린다. */
const activeArrow = ref<number | null>(null)
watch([selectedId, editing], () => (activeArrow.value = null))
watch([arrowConnections, showRules, sceneVersion, activeArrow], () => {
  viewer?.setArrows(arrowConnections.value.map((c, i) => arrowOf(c, String(i), i === activeArrow.value)))
})
const arrowPalette = computed(() => arrowColors(dark.value))
function cycleFlow(key: string) {
  const c = arrowConnections.value[Number(key)]
  const id = selectedId.value
  if (!c || !id) return
  if (c.directed) {
    editNotice.value = '포트(BIM)에 적힌 방향은 고칠 수 없습니다.'
    return
  }
  editNotice.value = ''
  const other = c.from === id ? c.to : c.from
  const next = !c.edited ? id : c.edited.from === id ? other : null
  flowTo(c, next)
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
  return { ...service, rooms: servedSpaces(m, service, equipmentById.value) }
})
// VAV·말단의 계통과 담당 근거(OE-EQP-10). 계통이 있어야 하는 설비인데 없으면 패널과 검토 화면에서 경고한다. 담당은 흐름 방향을
// 거슬러(급기)·따라(환기) 닿는 공기 원천이다 — 위 담당 공간을 말단 쪽에서 본 것이라 같은 방향을 쓰고, 추정이라 화면에만 보인다.
const selectedBasis = computed(() => {
  void flowVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || !needsSystem(e)) return null
  const basis = airBasis(m, showRules.value && hasRules.value ? withInferred(m.connections) : m.connections, e.id, equipmentById.value)
  const name = (id: string) => shortName(equipmentById.value.get(id)?.name || id)
  const rooms = new Set(basis.terminals.map((t) => equipmentById.value.get(t)?.spaceId).filter((x): x is string => !!x))
  return { supplyFrom: basis.supplyFrom.map(name), extractTo: basis.extractTo.map(name), terminals: basis.terminals.length, rooms: rooms.size }
})
const systemless = computed(() => (model.value ? systemlessAir(model.value) : []))

/** 패널에 보일 담당 공간. 말단이 많은 방부터 SERVED_LIMIT 줄만, 층으로 묶는다(층 순서는 모델 순서). */
const SERVED_LIMIT = 12
const servedAll = ref(false)
watch(selectedId, () => (servedAll.value = false))
const servedView = computed(() => {
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
const serviceSummary = computed(() => {
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
const SERVICE_LIMIT = 200

// --- 완전성 검사 ----------------------------------------------------------------
//
// 규칙마다 통과 수와 어긴 요소(checks.ts). 규칙을 펼치면 어긴 것을 목록으로 보이고 3D 에 칠한다.
// 설비나 계통을 고르면 그쪽이 3D 색을 가져간다.
const checks = computed(() => {
  const m = model.value
  if (!m) return []
  return completenessChecks(m, airServiceList.value, showRules.value && hasRules.value ? withInferred(m.connections) : m.connections)
})
const openCheckKey = ref<string | null>(null)
const openCheck = computed(() => checks.value.find((c) => c.key === openCheckKey.value) ?? null)
const CHECK_LIMIT = 100

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
const failReasons = computed(() => {
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
/** 위반 목록의 한 번에 고치기. 여느 편집과 같은 길(relocate·connectTo)이라 되돌리기·리포트·자동 저장에 같이 들어간다. */
function applyFix(id: string, fix: FailureFix) {
  if (!editing.value) mode.value = 'edit'
  if (fix.kind === 'move-into') relocate(id, fix.to)
  else {
    connectFrom.value = id
    connectTo(fix.other)
  }
}
const fixLabel = (fix: FailureFix) => (fix.kind === 'move-into' ? `${fix.spaceName} 안으로 옮기기` : `연결하기: ${nameOfId(fix.other)}`)
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
    note: e.rule === 'reversed' ? '규칙 방향과 반대' : e.rule === 'same' ? '규칙 방향과 같음' : '규칙으로 정할 수 없는 연결',
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
/** 종류 상자의 무리. 사람만 고르는 종류(사전이 읽지 않고 Brick 이름도 없는 것)는 따로 보인다. */
const KIND_GROUPS = [
  { label: '사전이 아는 종류', kinds: EQUIPMENT_KINDS.filter((k) => !k.manual) },
  { label: '이름으로 정하지 않는 종류 (BIM 값 또는 직접 선택)', kinds: EQUIPMENT_KINDS.filter((k) => k.manual) },
]
// 종류의 출처. 사전이 읽은 것과 사람이 타입 단위로 정한 것을 가른다.
const kindSrc = (e: Equipment) => (e.kindEdited || e.added ? 'edit' : e.kindSource === 'bim' ? 'bim' : 'dict')

/**
 * 이 설비가 무엇인지 한 낱말로. 종류가 있으면 종류(출처는 그 종류의 출처), 없으면 IFC 클래스를 우리말로(출처 BIM).
 * 덕트·배관·이음쇠는 종류가 없어서, 목록에 이름만 있으면 `AT-101-01`·`Pipe Types:…:745565` 가 무엇인지 알 수 없었다.
 * 둘 다 없으면 null — 모르는 것을 지어 부르지 않는다.
 */
function whatIs(e: Equipment | undefined | null): { label: string; src: SrcKind } | null {
  if (!e) return null
  const kind = kindLabel(e)
  if (kind) return { label: kind, src: kindSrc(e) }
  const label = ifcClassLabel(e.declaredType) ?? ifcClassLabel(e.ifcClass)
  return label ? { label, src: 'bim' } : null
}

// --- 종류 지정 (타입 단위) -----------------------------------------------------------
//
// 사전이 모르는 종류를 사람이 채운다. 한 번에 한 대가 아니라 **같은 타입(Revit 패밀리:유형) 전부**에 붙인다 —
// 병원 HVAC 는 종류 모르는 기기 327대가 타입 6개였다. 종류는 Brick 클래스와 규칙 방향(원천·말단)을 정하므로,
// edit.ts 가 규칙을 다시 돌리고 그 채점표를 돌려준다.
//
// 묶음은 **패밀리**다(edit.ts 의 familyNameOf). 크기만 다른 유형(VAV 150·200·250 mm)을 하나씩 고르지 않게 한다.
const familyCounts = computed(() => {
  const map = new Map<string, { count: number; types: Set<string> }>()
  for (const s of model.value?.storeys ?? []) {
    for (const e of s.equipment) {
      const key = familyKeyOf(e)
      const row = map.get(key) ?? { count: 0, types: new Set<string>() }
      row.count++
      row.types.add(typeKeyOf(e))
      map.set(key, row)
    }
  }
  return map
})
const typeLabel = (e: Equipment) => typeNameOf(e) ?? (e.name || e.ifcClass)
const familyLabel = (e: Equipment) => familyNameOf(e) ?? (e.name || e.ifcClass)
function setKind(typeKey: string, kind: string | null, label: string) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotType(m, typeKey)
  const at = mark()
  const done = setTypeKind(m, typeKey, kind)
  if (!done) return
  remember(`${label} ${done.count}대 종류 → ${kind ? equipmentKind(kind)!.label : '모름'}`, snapshot, at)
  const worse = newlyDisagreeing(ruleReport.value, done.rules)
  ruleReport.value = done.rules
  triggerRef(model)
  flowVersion.value++
  // remember 가 알림을 지우므로 그 뒤에 건다.
  kindWarning.value = ''
  if (worse.length) {
    const SHOW = 3
    const names = worse
      .slice(0, SHOW)
      .map((w) => `${systemById.value.get(w.systemId)?.name || w.systemId} ${w.agree}/${w.checked}`)
      .join(', ')
    // 3D 아래에는 띄우지 않는다. 종류는 고른 설비 패널이나 종류 목록에서 바꾸고, 알림은 거기 뜬다(둘이 한 화면에
    // 같이 보여 같은 글이 두 번 떴었다).
    kindWarning.value =
      `종류를 바꾼 뒤 규칙 방향이 포트와 어긋나는 계통이 생겼습니다: ${names}` +
      (worse.length > SHOW ? ` 외 ${worse.length - SHOW}개` : '') +
      '. 확정하기 전에 3D에서 흐름을 확인하거나 Ctrl+Z로 되돌리세요.'
  }
}
/** 종류를 바꿔 규칙이 포트와 어긋나기 시작했다는 알림. 3D 아래 알림은 종류 목록에서 안 보여 그 자리에도 둔다. */
const kindWarning = ref('')
watch([history, fileName], () => {
  // 되돌리거나 다른 편집을 하면 그 알림은 지난 이야기다.
  if (!history.value.at(-1)?.label.includes('종류 →')) kindWarning.value = ''
})
/** 고른 설비 패널의 종류 상자. 고른 뒤 포커스를 놓아 준다 — 상자에 남아 있으면 다음 단축키(U, K)를 상자가 먹는다. */
function pickKind(event: Event, e: Equipment) {
  const el = event.target as HTMLSelectElement
  setKind(familyKeyOf(e), el.value || null, familyLabel(e))
  el.blur()
}
/** 종류를 모르는 패밀리 목록의 상자. 고르면 그 줄이 목록에서 빠지고, 포커스는 놓는다(다음 단축키를 상자가 먹지 않게). */
function pickTypeKind(event: Event, typeKey: string, label: string) {
  const el = event.target as HTMLSelectElement
  setKind(typeKey, el.value || null, label)
  el.blur()
}
/** 종류를 모르는 기기를 패밀리로 묶은 것. 대수가 많은 것부터 — 위에서 몇 개만 고르면 대부분이 찬다. */
const unknownTypes = computed(() => {
  const rows = new Map<string, { key: string; label: string; ifcClass: string; count: number; types: Set<string>; sampleId: string }>()
  for (const s of model.value?.storeys ?? []) {
    for (const e of s.equipment) {
      if (isConduit(e.role) || equipmentKind(e.kind)) continue
      const key = familyKeyOf(e)
      const row = rows.get(key) ?? { key, label: familyLabel(e), ifcClass: e.ifcClass, count: 0, types: new Set<string>(), sampleId: e.id }
      row.count++
      row.types.add(typeKeyOf(e))
      rows.set(key, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count)
})
const TYPE_LIMIT = 50

/**
 * 종류를 모르는 패밀리마다 종류 후보(kind-suggest.ts). 이름의 낱말이 맞은 종류와, 같은 건물에서 계통·이웃·높이가 닮은
 * 패밀리의 종류다. 정하지 않는다 — 누르면 여느 종류 지정과 같이 패밀리 전체에 붙고(출처 "편집") 되돌리기에 쌓인다.
 */
const kindSuggestions = computed(() => {
  void flowVersion.value
  const m = model.value
  return m && editing.value && unknownTypes.value.length ? suggestKinds(m) : new Map<string, KindSuggestion[]>()
})
const suggestionWhy = (s: KindSuggestion) =>
  'name' in s.why ? `이름의 '${s.why.name}'` : `닮은 패밀리: ${s.why.like} (${Math.round(s.score * 100)}%)`

/**
 * 종류를 모르는 패밀리마다 고를 단서. 이름이 암호 같아도(`M_Exhaust Unit…:47-84 LPS`) 어느 계통에 있고, 무엇에
 * 붙어 있고, 어디(천장·바닥·방)에 놓였는지를 보면 대부분 짐작한다 — 급기 계통 끝에서 덕트 하나에 붙어 천장에
 * 있으면 디퓨저다. 모두 BIM 이 말한 계통·연결·좌표를 모은 것이다. 편집 모드에서 보이는 줄에만 잰다.
 */
const familyClues = computed(() => {
  void flowVersion.value
  const m = model.value
  const out = new Map<string, { system: string; neighbors: string; place: string }>()
  if (!m || !editing.value) return out
  const shown = new Set(unknownTypes.value.slice(0, TYPE_LIMIT).map((t) => t.key))
  const adjacent = new Map<string, string[]>()
  for (const c of m.connections) {
    adjacent.set(c.from, [...(adjacent.get(c.from) ?? []), c.to])
    adjacent.set(c.to, [...(adjacent.get(c.to) ?? []), c.from])
  }
  const tally = () => new Map<string, number>()
  const add = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1)
  const top = (map: Map<string, number>, n: number) =>
    [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k} ${c}`).join(' · ')
  const acc = new Map<string, { systems: Map<string, number>; neighbors: Map<string, number>; rooms: Map<string, number>; heights: number[] }>()
  for (const storey of m.storeys) {
    for (const e of storey.equipment) {
      if (isConduit(e.role) || equipmentKind(e.kind)) continue
      const key = familyKeyOf(e)
      if (!shown.has(key)) continue
      const a = acc.get(key) ?? { systems: tally(), neighbors: tally(), rooms: tally(), heights: [] }
      const sy = e.systemId ? systemById.value.get(e.systemId) : null
      if (sy) add(a.systems, systemKind(sy.kind)?.label ?? sy.name ?? '이름 없는 계통')
      for (const other of adjacent.get(e.id) ?? []) add(a.neighbors, whatIs(equipmentById.value.get(other))?.label ?? '종류 모름')
      if (e.spaceId) add(a.rooms, spaceNameOf(e.spaceId))
      if (e.position) a.heights.push(e.position[2] - storey.elevation)
      acc.set(key, a)
    }
  }
  for (const [key, a] of acc) {
    const h = [...a.heights].sort((x, y) => x - y)
    const median = h.length ? h[Math.floor(h.length / 2)] : null
    out.set(key, {
      system: a.systems.size ? top(a.systems, 2) : '계통 없음',
      neighbors: a.neighbors.size ? top(a.neighbors, 3) : '연결 없음',
      place: [median !== null ? `바닥에서 ${median.toFixed(1)}m` : '', top(a.rooms, 2)].filter(Boolean).join(' · ') || '위치 모름',
    })
  }
  return out
})
const kindEditLines = computed(() => {
  void flowVersion.value
  const m = model.value
  if (!m) return []
  const sample = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [typeKeyOf(e), e]))
  const name = (k: string | null) => (k ? (equipmentKind(k)?.label ?? k) : '모름')
  // 편집은 타입마다 적히지만(edit-file 도 타입 단위로 저장한다) 리포트는 패밀리 한 줄로 접는다.
  const rows = new Map<string, { key: string; label: string; count: number; types: number; from: string; to: string }>()
  for (const k of kindEdits(m)) {
    const e = sample.get(k.typeKey)
    const family = e ? familyKeyOf(e) : k.typeKey
    const key = `${family}|${k.from}|${k.to}`
    const row = rows.get(key) ?? { key, label: e ? familyLabel(e) : k.typeKey, count: 0, types: 0, from: name(k.from), to: name(k.to) }
    row.count += k.count
    row.types++
    rows.set(key, row)
  }
  return [...rows.values()]
})
// Proxy 는 IFC 가 역할을 말하지 않아서, 역할도 이름 사전의 종류에서 나온다.
const roleSrc = (e: Equipment) => (e.added ? 'edit' : e.ifcClass === 'BuildingElementProxy' ? 'dict' : 'bim')
const positionSrc = (e: Equipment) =>
  e.positionSource === 'edited' ? 'edit' : e.positionSource === 'geometry' || e.positionSource === 'panel' ? 'calc' : 'bim'
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
  let roomsFromBim = 0
  for (const sp of spaces) {
    const label = roomKind(sp.kind)?.label
    if (label) rooms.set(label, (rooms.get(label) ?? 0) + 1)
    if (label && sp.kindSource === 'bim') roomsFromBim++
  }
  const systems = new Map<string, number>()
  for (const sy of m.systems) {
    const label = sy.kind ? systemKindText(sy.kind, sy.fluid) : '(종류 모름)'
    systems.set(label, (systems.get(label) ?? 0) + 1)
  }
  return {
    devices: devices.length,
    unknown,
    kinds,
    points: kinds.filter((k) => k.point),
    roomsKnown: [...rooms.values()].reduce((a, b) => a + b, 0),
    roomsFromBim,
    roomsTotal: spaces.length,
    rooms: [...rooms].sort((a, b) => b[1] - a[1]),
    systems: [...systems].sort((a, b) => b[1] - a[1]),
  }
})

// 형상으로 이은 연결에 거리를 붙여 보여 준다. 기본 판정에서 붙은 것과 고립된 요소를
// 살리려고 넓혀서 붙인 것은 확신의 정도가 달라서, 검토하는 사람이 구별할 수 있어야 한다.
const sourceLabel = (tolerance: number | null) =>
  tolerance !== null && tolerance > TOLERANCE ? `형상 추정 (${Math.round(tolerance * 1000)}mm 간격)` : '형상 추정'

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
const selectedSystem = computed(() => (selectedSystemId.value ? (systemById.value.get(selectedSystemId.value) ?? null) : null))

// --- 계통 편집 (E8) ------------------------------------------------------------------------
//
// 설비의 계통 한 자리를 바꾸고(고른 설비 패널), 계통의 종류·유체를 고친다(범례에서 고른 계통 패널). 둘 다 규칙 방향의
// 재료라 edit.ts 가 규칙을 다시 돌린다. 계통 이름은 BIM 것이라 고치지 않는다(분야별 파일을 합칠 때 이름으로 맞춘다).
const systemNameOf = (id: string | null) => (id ? systemById.value.get(id)?.name || id : '(계통 없음)')
/** 계통 종류와 유체를 한 말로. `순환수 공급 · 냉수`. */
function systemKindText(kind: string | null | undefined, fluid: Fluid | null | undefined): string {
  const k = systemKind(kind)
  if (!k) return '모름'
  const f = FLUID_KINDS.includes(k.kind) ? fluidInfo(fluid) : null
  return f ? `${k.label} · ${f.label}` : k.label
}
/** 계통 상자의 목록. 이름순이고 종류를 붙인다 — 이름이 번호뿐인 계통(ifc4Mep 22개)도 무엇인지 보인다. */
const systemOptions = computed(() =>
  (model.value?.systems ?? [])
    .map((s) => ({ id: s.id, label: `${s.name || '(이름 없음)'}${s.kind ? ` · ${systemKindText(s.kind, s.fluid)}` : ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true })),
)
/**
 * 계통이 많으면(성수 1,037개) 상자에서 찾기 어렵다. 이 수를 넘으면 찾기 칸을 붙인다. 찾기 칸은 목록만 줄이고, 고른 설비의
 * 지금 계통은 걸러도 남긴다 — 상자가 지금 값을 잃으면 첫 줄이 고른 것처럼 보인다.
 */
const SYSTEM_FILTER_FROM = 30
const SYSTEM_SHOWN = 200
const systemFilter = ref('')
const filteredSystemOptions = computed(() => narrowOptions(systemOptions.value, systemFilter.value, selected.value?.systemId ?? null, SYSTEM_SHOWN))
watch(selectedId, () => (systemFilter.value = ''))
function pickSystem(event: Event, equipmentId: string) {
  const el = event.target as HTMLSelectElement
  const m = model.value
  const e = equipmentById.value.get(equipmentId)
  el.blur()
  if (!m || !e) return
  const to = el.value || null
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
function setSystemKindTo(systemId: string, kind: string | null, fluid: Fluid | null) {
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
function renameSystemTo(systemId: string, name: string) {
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
const systemNameAtOpen = (id: string) => baseline.value?.systems?.get(id)?.name ?? null
// 새 계통 만들기·지우기(E8). 만들면 고른 설비를 바로 넣는다 — 빈 계통은 온톨로지에 아무것도 더하지 않는다.
const newSystemOpen = ref(false)
const newSystemName = ref('')
const newSystemKind = ref('')
function createSystemFor(equipmentId: string) {
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
function removeSystem(systemId: string) {
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
const systemKindSrc = (s: { kindEdited?: unknown; kindSource?: 'bim' | 'dict' }): SrcKind => (s.kindEdited ? 'edit' : (s.kindSource ?? 'dict'))

function toggleSystem(id: string) {
  selectedSystemId.value = selectedSystemId.value === id ? null : id
  if (selectedSystemId.value) selectedId.value = null
}

watch([selectedId, selectedSystemId, model, showRules, flowVersion, flowSystemRow, openCheck, selectedSpace, sceneVersion, group], () => {
  if (!viewer) return

  // 여러 개 고른 설비(OE-UI-09). 고른 색으로 칠하고 나머지는 흐리게 하지 않는다(흐린 것은 Shift+클릭으로 더할 수 없다).
  if (group.value.length >= 2) {
    viewer.setHighlight({ selected: null, upstream: new Set(), downstream: new Set(), linked: new Set(), group: new Set(group.value) })
    return
  }

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

onBeforeUnmount(() => viewer?.dispose())

// 3D 와 고른 설비 패널을 같이 전체 화면으로 띄운다. 3D 만 띄우면 설비를 눌러도 무엇을 골랐는지 안 보인다.
// Esc 로 나가는 것은 브라우저가 하므로, 상태는 버튼이 아니라 fullscreenchange 로 따라간다.
const stage = ref<HTMLElement | null>(null)

/**
 * 3D 아래(표·검사·목록)에서 고를 때. 고른 결과는 3D 와 오른쪽 패널에 뜨는데 화면이 아래에 머물면 안 보이니,
 * 작업 화면이 가려져 있으면 올려 보인다. 이미 보이면 움직이지 않는다 — 표를 보며 여럿을 차례로 고를 때 흔들리지 않게.
 */
function selectAndShow(id: string) {
  select(id)
  const el = stage.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--appbar-h')) || 0
  if (r.top < top - 1 || r.top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const fullscreen = ref(false)
const onFullscreenChange = () => (fullscreen.value = document.fullscreenElement === stage.value)
document.addEventListener('fullscreenchange', onFullscreenChange)
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', onFullscreenChange))

// 도구막대 높이를 재서 작업 화면(3D + 오른쪽 패널)이 남은 높이를 쓰게 한다. 폭이 좁으면 막대가 두 줄이 되고, 편집 중에는
// 편집 줄이 붙는다 — 높이를 고정값으로 빼면 그때마다 3D 아래가 잘린다.
const appbar = ref<HTMLElement | null>(null)
const appbarObserver = new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--appbar-h', `${Math.ceil(entry.target.getBoundingClientRect().height)}px`)
})
watch(appbar, (el, old) => {
  if (old) appbarObserver.unobserve(old)
  if (el) appbarObserver.observe(el)
})
onBeforeUnmount(() => appbarObserver.disconnect())
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

/** data/ 에서 연 파일. 짝 파일(건축 ↔ 설비)을 권할 때 쓴다. 손으로 고른 파일이면 null. */
const openedDataPath = ref<string | null>(null)

function openData(path: string) {
  void openMany([{ name: baseName(path), read: () => fetchData(path), dataPath: path }], 'open').then(() => {
    openedDataPath.value = fileName.value === baseName(path) ? path : null
  })
}

function appendData(path: string) {
  void openMany([{ name: baseName(path), read: () => fetchData(path), dataPath: path }], 'append')
}

/** 목록에서 고른 파일. 건축·설비를 같이 골라 한 번에 연다. */
const dataPicked = ref<string[]>([])
function toggleDataPick(path: string) {
  dataPicked.value = dataPicked.value.includes(path) ? dataPicked.value.filter((p) => p !== path) : [...dataPicked.value, path]
}
function openDataSet(paths: readonly string[]) {
  const list = [...paths]
  dataPicked.value = []
  void openMany(list.map((path) => ({ name: baseName(path), read: () => fetchData(path), dataPath: path })), 'open').then(() => {
    openedDataPath.value = null
  })
}

/** 짝 파일(profile.ts 의 partnerOf). 판본이 여럿인 폴더에서는 권하지 않는다. */
function partnerOf(path: string | null): string | null {
  return path ? findPartner(path, dataFiles.value.map((f) => ({ path: f.path, profile: profileAt(f.path) }))) : null
}

/** 요약 옆에 붙이는 한마디. 이 파일이 혼자 쓰이는지, 짝이 필요한지. */
function roleHint(p: Profile): string {
  if (p.needsArchitecture) return '방이 없습니다. 건축 파일과 합쳐 쓰는 파일입니다'
  if (p.needsEquipment) return '설비가 없습니다. 설비 파일을 덧붙여 쓰는 파일입니다'
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
/**
 * 여러 파일을 이어 열 때 지금 몇 번째 파일인지. 파일마다 단계(1/6…)가 처음부터 다시 돌아서, 이것 없이는 성수 두 파일을
 * 여는 동안 막대가 끝났다가 다시 시작하고 초도 0 으로 돌아가 얼마나 남았는지 알 수 없었다. 초는 첫 파일부터 이어 센다.
 */
const batch = ref<{ index: number; total: number; name: string } | null>(null)

function beginProgress(label: string) {
  if (!batch.value || batch.value.index === 1) startedAt.value = Date.now()
  now.value = Date.now()
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
const progressFile = computed(() => {
  const b = batch.value
  return b ? `파일 ${b.index}/${b.total} · ${b.name}` : ''
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
      {
        bytes,
        wasmBase: new URL(import.meta.env.BASE_URL, location.href).href,
        options: { openings: readOpeningShapes.value, ...readFeatures.value },
      },
      [bytes],
    )
  })
}

// --- 편집 저장·불러오기 --------------------------------------------------------------
//
// 연 때와 달라진 값만 GUID 로 적은 JSON 이다(lib/edit-file.ts). 불러오면 편집 함수를 다시 거쳐 소속·규칙 방향을
// 다시 판정한다. 불러온 것은 한 번에 되돌리지 못한다 — 되돌리기 이력을 비우고, 리포트에는 연 때와 견준 줄로 남는다.
const editFileNote = ref('')

/**
 * [편집 저장]. data/ 에서 연 파일이면 8084 에 둔다 — 같은 파일을 여는 사람 누구나 이 편집을 본다(OE-COM-08). 손으로 연 파일이거나
 * 서버에 못 닿으면 파일로 내려받는다. `toFile` 이면 data/ 의 파일이라도 내려받기만 한다.
 */
async function saveEdits(toFile = false) {
  const m = model.value
  if (!m || !baseline.value) return
  if (!hasEdits.value && changeCount.value === 0) {
    note('저장할 편집이 없습니다')
    return
  }
  const file = exportEdits(m, baseline.value, fileName.value)
  const sig = editSig(file)
  if (!toFile && serverKey.value && (await saveToServer(file))) {
    committed()
    note(`8084 에 저장했습니다(편집 ${editCount(file)}건). 이 파일을 여는 사람 모두 같은 편집을 봅니다`)
    markDone('save')
    return
  }
  const stem = fileName.value.replace(/\.ifc/gi, '').replace(/[^\w가-힣.+-]+/g, '_') || 'model'
  download(`${stem}.edits.json`, JSON.stringify(file, null, 2), 'application/json')
  committed()
  note(`편집을 파일로 내려받았습니다: ${stem}.edits.json`)
  markDone('save')
}

async function onEditFilePick(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  const m = model.value
  if (!picked || !m) return
  const file = parseEditFile(await picked.text())
  if (typeof file === 'string') {
    editFileNote.value = `불러오지 못했습니다(${picked.name}): ${file}`
    return
  }
  applyEditFile(file, picked.name)
  // 파일에서 불러온 편집은 그 파일에 이미 있다. 불러온 뒤 더 고친 것만 저장하지 않은 편집이다.
  markSaved()
}

/** 편집 파일을 지금 모델에 얹는다. 파일에서 불러올 때와 자동 저장을 되살릴 때가 같이 쓴다. */
function applyEditFile(file: EditFile, from: string, quiet = false) {
  const m = model.value
  if (!m) return
  // 옮길 설비의 형상도 같이 옮겨야 다시 그릴 때 예전 자리로 튀지 않는다. 얹기 전 좌표를 떠 둔다.
  const before = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.position]))
  const result = applyEdits(m, file)
  for (const e of m.storeys.flatMap((s) => s.equipment)) {
    const was = before.get(e.id) ?? null
    // 늘인 구간은 얹기 전 형상을 떠 두고 다시 만든다. 통째로 옮기면 붙은 끝이 떨어진다.
    if (e.endShift && was && (meshBase.has(e.id) || captureBase(e.id, was))) placeStretched(e.id)
    else if (was !== e.position) shiftMesh(e.id, was, e.position)
  }
  changes.value = [...changes.value, ...result.changes]
  areaChanges.value = [...areaChanges.value, ...result.areaChanges]
  confirmations.value = [
    ...confirmations.value,
    ...result.confirmations.map((c) => ({ systemName: systemById.value.get(c.systemId)?.name || c.systemId, count: c.count })),
  ]
  storeyMoved.value = new Set([...storeyMoved.value, ...result.storeyMoved])
  if (result.rules) ruleReport.value = result.rules
  history.value = []
  future.value = []
  triggerRef(model)
  flowVersion.value++
  redraw()

  const missing = Object.entries(result.missing).filter(([, n]) => n > 0)
  const MISSING_LABEL: Record<string, string> = { equipment: '설비', spaces: '물리존', kinds: '타입', flows: '방향', systems: '계통', connections: '연결', elements: '벽·문·창', storeys: '완료한 층' }
  // GUID 가 바뀐 판본에서 다른 열쇠로 찾은 것. 사람이 확인할 수 있게 무엇으로 찾았는지까지 말한다.
  const rematched = (Object.entries(result.rematched) as [Exclude<MatchKey, 'guid'>, number][]).filter(([, n]) => n > 0)
  autosaveArmed = true
  if (quiet) return
  editFileNote.value =
    `편집 ${result.applied}개를 적용했습니다(${from}).` +
    (file.source && file.source !== fileName.value ? ` 원래 파일: ${file.source}.` : '') +
    (rematched.length
      ? ` GUID가 바뀐 ${rematched.reduce((n, [, k]) => n + k, 0)}개는 ${rematched.map(([k, n]) => `${MATCH_KEY_BY[k]} ${n}개`).join(', ')} 찾았습니다.`
      : '') +
    (missing.length ? ` 찾지 못함: ${missing.map(([k, n]) => `${MISSING_LABEL[k]} ${n}`).join(' · ')}.` : '') +
    ' 불러온 편집은 되돌리기로 취소할 수 없습니다.'
}

// --- 층별로 보기 ---------------------------------------------------------------------
//
// 층이 여럿이면 3D 에 전부 겹쳐 그려져, 아래층 설비는 위층 판과 배관에 가려 누르기도 끌기도 어려웠다. 한 층만 남긴다.
// 다른 층의 것을 표·목록에서 고르면 그 층으로 따라간다 — 고른 것이 안 보이면 고른 줄 모른다.
const viewStorey = ref<string | null>(null)
/**
 * 파일을 열면 처음 볼 층(OE-UI-12). PRD 는 "3D는 한 층만, 전체 빌딩 뷰는 미리보기 Phase 2" 다. "모든 층" 은 남겨 두되(층을 넘는
 * 덕트·배관을 한눈에 볼 곳이 여기뿐이다) 처음에는 **방이 있는 가장 낮은 층**을 연다 — 기초(T/FDN·TOF Footing)는 방이 없다.
 * 방이 없는 파일(설비만)은 설비가 놓인 가장 낮은 층, 그것도 없으면 맨 아래 층. 층이 하나면 고를 것이 없다.
 */
function firstStorey(m: Model | null): string | null {
  if (!m || m.storeys.length <= 1) return null
  const st =
    m.storeys.find((s) => s.spaces.length > 0) ?? m.storeys.find((s) => s.equipment.some((e) => e.position && !isConduit(e.role))) ?? m.storeys[0]
  return st.id
}
watch(baseline, () => (viewStorey.value = firstStorey(model.value)))
function applyStoreyFilter() {
  const m = model.value
  if (!viewer || !m) return
  const id = viewStorey.value
  if (!id || !m.storeys.some((s) => s.id === id)) {
    viewer.setStoreyFilter(null, new Set())
    return
  }
  const hidden = new Set(m.storeys.filter((s) => s.id !== id).flatMap((s) => s.equipment.map((e) => e.id)))
  viewer.setStoreyFilter(new Set([id]), hidden)
}
watch([viewStorey, model, sceneVersion], applyStoreyFilter)
// 천장 모드에서 층을 바꾸면 위에서 내려다보는 시점을 지킨다(OE-OBJ-08).
watch(viewStorey, () => (ceilingMode.value ? viewer?.topView() : viewer?.frameAll()))

// --- 3D / 평면도 ---------------------------------------------------------------------
//
// 평면도는 3D 와 탭으로 갈아 끼운다(한 번에 하나만 그린다). 층 하나를 골랐을 때만 그리고, 고른 층·고른 설비는
// 3D 와 같은 상태(viewStorey, selectedId)를 쓴다. 꼭짓점 끌기는 3D 에서 놓는 것과 같은 길(dropVertex — 자기 교차
// 막기, cm 로 자르기, 되돌리기 이력)을 탄다.
const activeTab = ref<'3d' | 'plan'>('3d')
// 편집은 모델을 그 자리에서 고치고 triggerRef 로 알린다. 같은 층 객체를 넘기면 평면도가 다시 그릴 이유를 몰라서, 방향키로
// 옮긴 설비의 점과 끌어 놓은 방 외곽선이 예전 자리에 남았다. 알릴 때마다 얕은 사본을 넘긴다(층 하나라 싸다).
// 층이 하나면 층 목록이 없으니 그 층을 그린다 — "층을 고르세요" 만 뜨고 고를 곳이 없었다.
const planStorey = computed(() => {
  const m = model.value
  const storey = m?.storeys.find((s) => s.id === viewStorey.value) ?? (m?.storeys.length === 1 ? m.storeys[0] : undefined)
  return storey ? { ...storey } : null
})
/** 평면도로 갈 때 층이 안 골라져 있으면 고른 방·설비의 층으로 연다. 고른 것이 없으면 층 목록에서 고르게 둔다. */
function showPlan() {
  activeTab.value = 'plan'
  if (planStorey.value) return
  const st = selectedSpace.value?.storey ?? (selected.value ? storeyOf(selected.value.id) : null)
  if (st) viewStorey.value = st.id
}
// 고른 설비·물리존이 다른 층이면 그 층으로.
watch([selectedId, selectedSpaceId], ([eq, sp]) => {
  if (!viewStorey.value || !model.value) return
  const home = eq ? storeyOf(eq) : sp ? model.value.storeys.find((s) => s.spaces.some((x) => x.id === sp)) : null
  if (home && home.id !== viewStorey.value) viewStorey.value = home.id
})

// --- 3D 에서 놓기 -------------------------------------------------------------------
//
// 좌표가 없는 설비는 x·y·z 를 숫자로 넣어야 했는데, 도면 좌표를 모르면 넣을 수가 없었다. [3D에서 놓기] 를 누르고 바닥을
// 누르면 그 자리에 놓는다. 높이는 같은 패밀리 설비의 바닥에서 높이(중앙값)를 따르고, 없으면 바닥에 두고 알린다 —
// 높이를 지어내지 않는다. 놓으면 여느 이동처럼 소속을 다시 판정하고 되돌리기에 쌓인다.
const placing = ref<string | null>(null)
/** 놓는 방식. `wall` 이면 누른 자리에서 가장 가까운 벽 면에 붙인다(OE-OBJ-04 외벽 전용 설비). */
const placingOn = ref<'floor' | 'wall'>('floor')
function startPlace(id: string, on: 'floor' | 'wall' = 'floor') {
  const home = storeyOf(id)
  if (!home) return
  // 벽 전용 종류(콘센트)는 바닥에 놓지 않고 벽에 붙인다(OE-OBJ-10, 설치면 표 mount.ts)
  const target = equipmentById.value.get(id)
  // 천장 편집 모드(OE-OBJ-08): 천장 모드에서는 천장에, 바닥·벽 쪽에서는 바닥·벽에 놓는다. 천장 모드에는 벽에 붙이기가 없다.
  if (target && ceilingMode.value && on === 'wall') return refuseLock(target, '천장 편집 모드에서는 벽에 붙이지 않습니다. 바닥·벽 쪽에서 붙이세요.')
  const lock = target ? ceilingLock(target) : null
  if (target && lock) return refuseLock(target, lock)
  if (ceilingMode.value && !ceilingOf(home)) {
    editNotice.value = `${home.name}의 반자 높이를 모릅니다. 천장 설비를 놓기 전에 왼쪽 도구에서 반자 높이를 입력하세요.`
    return
  }
  if (target && surfaceOf(target) === 'wall') on = 'wall'
  connectFrom.value = null
  placing.value = id
  placingOn.value = on
  viewer?.setPlaceMode(ceilingMode.value ? home.elevation + ceilingOf(home)!.height : home.elevation)
  // 바닥·천장에 놓을 때는 따로 안내하지 않는다(OE-EQP-02) — 팔레트의 눌린 항목과 십자 커서가 놓는 중임을 말한다. 벽에 붙이기는
  // 누를 자리(벽 면 가까이)가 달라서 알린다.
  if (on === 'wall') note(`${nameOfId(id)}${josa(nameOfId(id), '을/를')} 붙일 벽 면 가까이를 3D에서 클릭하세요. 바깥 면을 누르면 바깥에 붙습니다 (Esc 취소)`)
}
function stopPlace() {
  placing.value = null
  placingOn.value = 'floor'
  viewer?.setPlaceMode(null)
}

/** 외벽 전용 설비(OE-OBJ-04)가 외벽 바깥 면에 있지 않은가. 패널 경고에 쓴다. */
function exteriorMisplaced(e: Equipment): boolean {
  if (!exteriorOnly(e)) return false
  const home = storeyOf(e.id)
  return !e.position || !home || !onExteriorFace(home, [e.position[0], e.position[1]])
}
/** 설비를 벽 면에 붙인다(OE-OBJ-04). 여느 이동처럼 소속을 다시 재고 되돌리기에 쌓인다. 겹침 금지(OE-OBJ-16)도 같다. */
function mountAt(id: string, at: Vec2) {
  const m = model.value
  if (!m) return
  const before = equipmentById.value.get(id)?.position ?? null
  const snapshot = snapshotEquipment(m, id)
  const trial = structuredClone(m)
  const probe = mountOnWall(trial, id, [cm(at[0]), cm(at[1])])
  if (!probe) return
  if ('refused' in probe) return note(probe.refused)
  const target = trial.storeys.flatMap((st) => st.equipment).find((e) => e.id === id)!
  const blocked = overlapAt(m, id, target.position!, currentBox)
  if (blocked) {
    const name = shortName(blocked.name)
    editNotice.value = `이미 오브젝트가 있는 위치입니다(${name}${josa(name, '과/와')} 겹칩니다). 배관 없는 설비는 서로 겹쳐 놓을 수 없습니다.`
    viewer?.markConflict(blocked.id)
    return
  }
  const at0 = mark()
  const done = mountOnWall(m, id, [cm(at[0]), cm(at[1])])
  if (!done || 'refused' in done) return
  const wallName = done.wall.name || '벽'
  remember(`${shortName(done.change.equipmentName)} ${wallName}에 붙임`, snapshot, at0)
  moveInScene(id, before, equipmentById.value.get(id)?.position ?? null)
  changes.value = [...changes.value, done.change]
  triggerRef(model)
  note(`${wallName}에 붙였습니다. 벽을 옮기면 같이 갑니다`)
}
watch([selectedId, editing, viewStorey], () => {
  if (placing.value && (selectedId.value !== placing.value || !editing.value)) stopPlace()
})
function placeAt(at: Vec2) {
  if (drawing.value) {
    drawing.value = { ...drawing.value, points: [...drawing.value.points, [cm(at[0]), cm(at[1])]] }
    // 나눌 선은 두 점이면 끝난다.
    if ((drawing.value.purpose === 'split' || drawing.value.purpose === 'wall' || drawing.value.purpose === 'customSplit') && drawing.value.points.length === 2) finishDraw()
    return
  }
  if (adding.value) {
    if (adding.value.what === 'equipment') addEquipmentAt(at)
    else addOpeningAt(at)
    return
  }
  const id = placing.value
  const m = model.value
  const on = placingOn.value
  stopPlace()
  if (id && on === 'wall') return mountAt(id, at)
  const home = id ? storeyOf(id) : null
  const target = id ? equipmentById.value.get(id) : null
  if (!m || !id || !home || !target) return
  // 천장 모드: 구역의 기본 z 에 놓는다 — 반자 부착은 반자 높이, 플레넘은 반자 바로 위(OE-EQP-02·04).
  if (ceilingMode.value) {
    const zone = ceilingZone(target.kind) ?? 'attached'
    const range = ceilingRange(zone, ceilingOf(home)?.height ?? null, storeyHeightOf.value.get(home.id)?.value ?? null)
    if (!range) return
    if (!relocate(id, [cm(at[0]), cm(at[1]), cm(home.elevation + range.base)])) return
    note(`${zone === 'plenum' ? '플레넘(반자 바로 위)' : '반자 높이'}에 놓았습니다(바닥에서 ${range.base.toFixed(2)}m). 높이는 z 칸에서 고치세요`)
    return
  }
  // 종류를 모르면 허용 설치면을 알 수 없어 바닥에 놓는다(OE-EQP-02).
  if (!target.kind) {
    if (!relocate(id, [cm(at[0]), cm(at[1]), cm(home.elevation)])) return
    note('종류를 모르는 설비라 바닥 높이에 놓았습니다. 종류를 정한 뒤 높이를 고치세요')
    return
  }
  const key = familyKeyOf(target)
  const heights = m.storeys
    .flatMap((st) => st.equipment.filter((e) => e.id !== id && e.position && familyKeyOf(e) === key).map((e) => e.position![2] - st.elevation))
    .sort((a, b) => a - b)
  const h = heights.length ? heights[Math.floor(heights.length / 2)] : 0
  if (!relocate(id, [cm(at[0]), cm(at[1]), cm(home.elevation + h)])) return
  note(
    heights.length
      ? `같은 패밀리의 높이(바닥에서 ${h.toFixed(2)}m)로 놓았습니다`
      : '바닥 높이에 놓았습니다. 높이는 z 칸에서 고치세요',
  )
}

// --- 물리존 꼭짓점 넣기·지우기, 외곽선 그리기 -------------------------------------------------
//
// 꼭짓점을 옮기기만 해서는 ㄱ자 방을 사각형으로 바꾸거나 모서리를 더 낼 수 없었고, 외곽선을 못 읽은 방(병원의 CORRIDOR·
// OPEN TO BELOW)은 손댈 길이 없었다. 셋 다 경계를 통째로 바꾸는 편집이라 한 길(changeFootprint)로 기록한다 — 꼭짓점을
// 끈 것과 같이 넓이·소속을 다시 재고, 되돌리기·리포트·편집 파일에 들어간다.
function changeFootprint(spaceId: string, label: string, apply: (m: Model) => BoundaryChange | null): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotSpace(m, spaceId)
  const at = mark()
  const change = apply(m)
  if (!change) return false
  remember(label, snapshot, at)
  areaChanges.value = [...areaChanges.value, change]
  changes.value = [...changes.value, ...change.equipment]
  triggerRef(model)
  viewer?.updateSpaces(m)
  sceneVersion.value++
  return true
}
function editVertex(op: 'insert' | 'delete'): boolean {
  const picked = selectedSpace.value
  const i = activeVertex.value
  if (!picked || i === null) return false
  const id = picked.space.id
  const name = picked.space.longName || picked.space.name
  if (op === 'insert') {
    if (changeFootprint(id, `${name} 꼭짓점 넣기`, (m) => insertSpaceVertex(m, id, i))) {
      activeVertex.value = i + 1
      note(`꼭짓점을 넣었습니다(${i + 2}번). ←↑→↓로 옮깁니다`)
    }
    return true
  }
  if (vertexCount.value <= 3) {
    note('꼭짓점이 셋이라 더 지울 수 없습니다')
    return true
  }
  if (changeFootprint(id, `${name} 꼭짓점 지우기`, (m) => deleteSpaceVertex(m, id, i))) {
    activeVertex.value = Math.min(i, vertexCount.value - 1)
    note('꼭짓점을 지웠습니다')
  }
  return true
}
function startDraw(spaceId: string) {
  const m = model.value
  const storey = m?.storeys.find((s) => s.spaces.some((x) => x.id === spaceId))
  const space = storey?.spaces.find((x) => x.id === spaceId)
  if (!storey || !space) return
  stopPlace()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  if (m!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'footprint', spaceId, storeyId: storey.id, name: space.longName || space.name, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
  stage.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function stopDraw() {
  drawing.value = null
  viewer?.setPlaceMode(null)
}
function undoDrawPoint() {
  if (drawing.value) drawing.value = { ...drawing.value, points: drawing.value.points.slice(0, -1) }
}
function finishDraw(): boolean {
  const d = drawing.value
  if (!d) return false
  if (d.purpose === 'wall') {
    if (d.points.length < 2) {
      note('벽의 두 끝점을 찍어야 합니다')
      return true
    }
    stopDraw()
    const [a, b] = d.points
    let made: Wall | null = null
    const draw = (m: Model) => {
      const done = addWall(m, d.storeyId, a, b)
      if (done && !('refused' in done)) made = done
      return done
    }
    if (changeElements(d.storeyId, '벽 긋기', draw) && made) {
      selectedElementId.value = (made as Wall).id
      note('벽을 그었습니다. 내력 여부는 오른쪽 패널에서 정합니다')
    }
    return true
  }
  if (d.purpose === 'customSplit') {
    if (d.points.length < 2) {
      note('나눌 선의 두 점을 찍어야 합니다')
      return true
    }
    stopDraw()
    const [a, b] = d.points
    const zoneId = d.spaceId!
    if (changeCustomZones(d.storeyId, `${d.name} 나누기`, (m) => splitCustomZone(m, zoneId, a, b))) {
      selectedCustomZoneId.value = zoneId
      note(`${d.name}${josa(d.name, '을/를')} 둘로 나눴습니다. 좁은 쪽이 새 커스텀존입니다`)
    }
    return true
  }
  if (d.purpose === 'split') {
    if (d.points.length < 2) {
      note('나눌 선의 두 점을 찍어야 합니다')
      return true
    }
    stopDraw()
    const [a, b] = d.points
    if (changeSpaces(d.storeyId, `${d.name} 나누기`, (m) => splitSpace(m, d.spaceId!, a, b))) {
      selectedSpaceId.value = d.spaceId
      note(`${d.name}${josa(d.name, '을/를')} 둘로 나눴습니다. 새 조각의 이름은 오른쪽 패널에서 고칩니다`)
    }
    return true
  }
  if (d.points.length < 3) {
    note('꼭짓점을 셋 이상 찍어야 합니다')
    return true
  }
  stopDraw()
  if (d.purpose === 'custom') {
    let created: string | null = null
    const ok = changeCustomZones(d.storeyId, '커스텀존 만들기', (m) => {
      const done = createCustomZone(m, d.storeyId, { footprint: d.points })
      if (done && !('refused' in done)) created = done.id
      return done
    })
    if (ok && created) {
      selectedCustomZoneId.value = created
      note('커스텀존을 만들었습니다. 이름은 오른쪽 패널에서 고칩니다')
    }
    return true
  }
  if (d.purpose === 'create') {
    const n = (model.value?.storeys ?? []).reduce((k, st) => k + st.spaces.filter((x) => x.added).length, 0) + 1
    let created: string | null = null
    const ok = changeSpaces(d.storeyId, '물리존 만들기', (m) => {
      const done = createSpace(m, d.storeyId, { name: '', longName: `새 물리존 ${n}`, footprint: d.points })
      created = done?.created[0] ?? null
      return done
    })
    if (ok && created) {
      selectedSpaceId.value = created
      note(`새 물리존 ${n}${josa(String(n), '을/를')} 만들었습니다. 이름은 오른쪽 패널에서 고칩니다`)
    }
    return true
  }
  const spaceId = d.spaceId!
  if (changeFootprint(spaceId, `${d.name} 외곽선 그리기`, (m) => drawSpaceFootprint(m, spaceId, d.points))) {
    selectedSpaceId.value = spaceId
    note(`${d.name}의 외곽선을 그렸습니다. 꼭짓점은 끌거나 [ ]로 골라 고칩니다`)
  }
  return true
}

// --- 물리존 만들기·지우기·나누기·합치기 (E3) --------------------------------------------------
//
// 경계 편집과 같이 넓이와 소속을 다시 재는데, 물리존이 생기고 없어져서 층 하나를 통째로 떠 두고 되돌린다
// (snapshotStoreySpaces). 거절된 것(층의 마지막 방, 방을 셋으로 자르는 선, 맞닿지 않은 방)은 이유를 알린다.
function changeSpaces(storeyId: string, label: string, apply: (m: Model) => SpaceSetChange | { refused: string } | null): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotStoreySpaces(m, storeyId)
  const at = mark()
  const done = apply(m)
  if (!done) return false
  if ('refused' in done) {
    note(done.refused)
    return false
  }
  remember(label, snapshot, at)
  changes.value = [...changes.value, ...done.equipment]
  triggerRef(model)
  viewer?.updateSpaces(m)
  sceneVersion.value++
  return true
}

/** 새 물리존·설비를 넣을 층. 층 하나만 보는 중이면 그 층, 고른 물리존·설비가 있으면 그 층, 층이 하나면 그 층이다. */
function targetStorey() {
  const m = model.value
  if (!m) return null
  return (
    m.storeys.find((st) => st.id === viewStorey.value) ??
    selectedSpace.value?.storey ??
    (selected.value ? storeyOf(selected.value.id) : null) ??
    (m.storeys.length === 1 ? m.storeys[0] : null)
  )
}

/** 층을 몰라 도구를 못 여는 경우. 말만 하면 층 목록을 찾아 헤매서, 목록에 커서를 옮겨 바로 고르게 한다. */
function askStorey(what: string) {
  note(`${what} 층을 먼저 고르세요(3D 오른쪽 위의 층 목록)`)
  document.querySelector<HTMLSelectElement>('.storey-view')?.focus()
}

function startCreateSpace() {
  const storey = targetStorey()
  if (!storey) return askStorey('물리존을 그릴')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'create', spaceId: null, storeyId: storey.id, name: `${storey.name} 새 물리존`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
}

function startSplit() {
  const picked = selectedSpace.value
  if (!picked) return
  stopPlace()
  stopAdd()
  const name = picked.space.longName || picked.space.name
  drawing.value = { purpose: 'split', spaceId: picked.space.id, storeyId: picked.storey.id, name, elevation: picked.storey.elevation, points: [] }
  viewer?.setPlaceMode(picked.storey.elevation)
  note(`${name}${josa(name, '을/를')} 나눌 선의 두 점을 바닥에 찍으세요 (Esc 취소)`)
}

// --- 커스텀존 (OE-OBJ-01) -----------------------------------------------------------------
//
// 물리존 위에 운영 편의로 정하는 다각형. 서로 겹쳐도 된다. 품는 방·든 설비는 저장하지 않고 쓸 때 계산하므로(custom-zone.ts)
// 여기서는 목록만 고치고 되돌리기에 쌓는다.
const selectedCustomZoneId = ref<string | null>(null)
const selectedCustomZone = computed(() => {
  void sceneVersion.value
  const m = model.value
  const id = selectedCustomZoneId.value
  const found = m && id ? findCustomZone(m, id) : null
  if (!found) return null
  return {
    ...found,
    spaces: zoneSpaces(found.storey, found.zone),
    equipment: zoneEquipment(found.storey, found.zone),
    areaM2: polygonArea(found.zone.footprint),
  }
})
/** 모든 층의 커스텀존. 개요 패널에서 골라 연다. */
const allCustomZones = computed(() => {
  void sceneVersion.value
  return (model.value?.storeys ?? []).flatMap((storey) => (storey.customZones ?? []).map((zone) => ({ storey, zone })))
})
watch([model, sceneVersion, selectedCustomZoneId], () => viewer?.setCustomZones(model.value, selectedCustomZoneId.value))
// 천장 설비 표시(OE-EQP-04). 편집 모드에서 천장 설비마다 바닥 발자국 링을, 고른 것이면 링까지 수직 점선을 그린다. 천장 설비는
// 판정 설치면이 천장·플레넘인 것과, 반자 높이를 모르는 층에서 종류가 천장 전용인 것이다(그 층은 천장을 판정하지 못한다). 천장에 달 수
// 없는 종류는 뺀다. 구역(링 색)은 종류가
// 정하고, 종류가 모르면 판정(플레넘이면 플레넘)을 따른다.
const ceilingMarks = computed<CeilingMark[]>(() => {
  if (!editing.value) return []
  const out: CeilingMark[] = []
  for (const r of surfaceRows.value) {
    const e = r.equipment
    if (!e.position) continue
    const onCeiling = r.judged === 'ceiling' || r.judged === 'plenum' || (r.judged === null && !ceilingOf(r.storey) && surfaceOf(e) === 'ceiling')
    // 판정이 허용 설치면 밖이면 허용 설치면이 앞선다(Q9) — 반자 위에 있는 공조기는 천장 설비가 아니다.
    if (!onCeiling || !canMountOn(e, 'ceiling')) continue
    out.push({ id: e.id, storeyId: r.storey.id, at: e.position, floor: r.storey.elevation, zone: ceilingZone(e.kind) ?? (r.judged === 'plenum' ? 'plenum' : 'attached') })
  }
  return out
})

// --- 천장 편집 모드 (OE-OBJ-08) ----------------------------------------------------------------
//
// 설비 편집의 [바닥·벽 / 천장] 토글(T)에서 천장 쪽이다. 들어가면 선택과 하던 조작을 끝내고, 위에서 내려다보고, 층마다 반자 높이에
// 반투명 천장면을 그린다. 천장 설비만 놓고·옮기고·지우고·이름과 종류를 고친다(옮기기는 x·y 만, z 는 패널). 나머지는 회색이고 고르기·
// 조회만 된다. 바닥·벽 쪽(평소 편집)에서는 거꾸로 천장 설비가 고르기·조회만 된다. 모드는 화면 상태라 저장하지 않는다.
const ceilingMode = ref(false)
// 천장 모드에서는 위에서 내려다보니 링이 설비와 겹친다 — 그리지 않는다.
watch([ceilingMarks, sceneVersion, selectedId, () => ceilingMode.value], () => viewer?.setCeilingMarks(ceilingMode.value ? [] : ceilingMarks.value, selectedId.value))
/** 천장 설비 id(좌표가 있는 것). 바닥 링과 같은 판단이다. */
const ceilingIds = computed(() => new Set(ceilingMarks.value.map((m) => m.id)))
const IN_CEILING_MODE = '천장 설비는 천장 편집 모드에서 편집합니다([천장] 또는 T).'
const NOT_ON_CEILING = '천장에 설치할 수 없는 설비입니다.'
/**
 * 지금 모드에서 이 설비를 고칠 수 없는 이유. 고칠 수 있으면 null. 좌표가 없는 설비는 놓을 면으로 가른다 — 천장 모드에서는 천장에 놓을
 * 수 있는 종류, 바닥·벽 쪽에서는 천장 전용이 아닌 종류다(OE-EQP-02).
 */
function ceilingLock(e: Equipment): string | null {
  if (!editing.value) return null
  if (!e.position) {
    if (ceilingMode.value) return isConduit(e.role) ? '덕트·배관은 바닥·벽 쪽에서 편집합니다.' : canMountOn(e, 'ceiling') ? null : NOT_ON_CEILING
    return surfaceOf(e) === 'ceiling' ? '천장 전용 설비는 천장 편집 모드에서 놓습니다([천장] 또는 T).' : null
  }
  const on = ceilingIds.value.has(e.id)
  if (!ceilingMode.value) return on ? IN_CEILING_MODE : null
  if (on) return null
  if (isConduit(e.role)) return '덕트·배관은 바닥·벽 쪽에서 편집합니다.'
  return canMountOn(e, 'ceiling') ? '바닥·벽 설비는 바닥·벽 쪽에서 편집합니다.' : NOT_ON_CEILING
}
/** 막았다고 알린다. 천장에 놓을 수 없는 설비면 3D 에 붉게 짚는다. */
function refuseLock(e: Equipment, why: string) {
  editNotice.value = `${shortName(e.name)}: ${why}`
  if (why === NOT_ON_CEILING) viewer?.markConflict(e.id)
}
/** 고른 설비를 지금 모드에서 고칠 수 없으면 그 이유. 패널의 편집 칸을 숨기고 이 말을 보인다. */
const selectedLock = computed(() => (selected.value ? ceilingLock(selected.value) : null))
/** 지금 보는 층(천장 모드의 기준). */
const ceilingStorey = computed(() => (ceilingMode.value ? (model.value?.storeys.find((st) => st.id === viewStorey.value) ?? null) : null))
/** 천장 모드인데 지금 층의 반자 높이를 모른다 — 입력을 받기 전에는 천장 설비를 놓지 않는다. */
const ceilingAsk = computed(() => {
  // 층 객체는 편집해도 같은 객체라 ceilingStorey 만 보면 다시 재지 않는다 — model 을 직접 읽는다(triggerRef).
  const st = model.value?.storeys.find((x) => x.id === viewStorey.value)
  return ceilingMode.value && !!st && !ceilingOf(st)
})

function setCeilingMode(on: boolean) {
  if (on === ceilingMode.value) return
  if (!on) {
    ceilingMode.value = false
    note('천장 편집 모드를 나왔습니다. 바닥·벽 쪽입니다')
    return
  }
  if (!editing.value) return
  const st = targetStorey()
  if (!st) return askStorey('천장을 편집할')
  // 들어갈 때 하던 것을 끝낸다 — 바닥에 놓던 설비를 천장 높이로 놓게 되면 헷갈린다.
  stopPlace()
  stopAdd()
  if (drawing.value) stopDraw()
  connectFrom.value = null
  archMode.value = false
  group.value = []
  select(null)
  selectedSpaceId.value = null
  selectedElementId.value = null
  selectedCustomZoneId.value = null
  ceilingMode.value = true
  if (viewStorey.value !== st.id) viewStorey.value = st.id
  // 층을 바꾸면 위 watch 가 시점을 맞춘다. 같은 층이면 여기서 내려다본다.
  else viewer?.topView()
  note(ceilingOf(st) ? `천장 편집 모드입니다 — ${st.name} 반자 ${meters(ceilingOf(st)!.height)}. 천장 설비만 놓고 옮깁니다(T 로 나가기)` : `천장 편집 모드입니다. ${st.name}의 반자 높이를 먼저 입력하세요`)
}
watch(editing, (on) => {
  if (!on) ceilingMode.value = false
})
/** 천장 모드에서 잠긴 도구를 눌렀다. 어디서 편집하는지 알린다(OE-OBJ-08). */
function lockedTool() {
  editNotice.value = '천장 편집 모드에서는 공간을 고치지 않습니다. 공간은 [바닥·벽] 쪽에서 편집하세요(T 로 나가기).'
}
// 천장 모드의 반자 높이 입력 칸. 기본값은 BIM 값이 없으니 후보(계산)다.
const ceilingAskInput = ref('')
watch(ceilingAsk, (ask) => {
  if (ask && ceilingStorey.value) ceilingAskInput.value = String(ceilingGuessOf.value.get(ceilingStorey.value.id)?.height ?? '')
}, { immediate: true })

/** 천장면과 회색 처리. 천장면은 반자 높이를 아는 층만, 면은 그 층 물리존 외곽선(없으면 설비가 든 평면 범위)이다. */
const ceilingView = computed<CeilingView | null>(() => {
  const m = model.value
  if (!ceilingMode.value || !m) return null
  const planes: CeilingView['planes'] = []
  for (const st of m.storeys) {
    const c = ceilingOf(st)
    if (!c) continue
    let rings: Vec2[][] = st.spaces.filter((sp) => sp.footprint.length >= 4).map((sp) => sp.footprint as Vec2[])
    if (!rings.length) {
      const pts = st.equipment.flatMap((e) => (e.position ? [e.position] : []))
      if (pts.length) {
        const [x0, x1] = [Math.min(...pts.map((p) => p[0])) - 1, Math.max(...pts.map((p) => p[0])) + 1]
        const [y0, y1] = [Math.min(...pts.map((p) => p[1])) - 1, Math.max(...pts.map((p) => p[1])) + 1]
        rings = [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]
      }
    }
    planes.push({ storeyId: st.id, z: st.elevation + c.height, rings })
  }
  const dim = new Set<string>()
  for (const st of m.storeys) for (const e of st.equipment) if (!ceilingIds.value.has(e.id)) dim.add(e.id)
  return { planes, dim }
})
watch([ceilingView, sceneVersion], () => viewer?.setCeilingView(ceilingView.value))
// 끌지 못하는 설비. 모드 밖의 설비는 3D 에서 잡히지 않는다(고르기는 된다).
const frozenIds = computed(() => {
  const out = new Set<string>()
  if (!editing.value || !model.value) return out
  for (const st of model.value.storeys) for (const e of st.equipment) if (e.position && ceilingLock(e)) out.add(e.id)
  return out
})
watch([frozenIds, sceneVersion], () => viewer?.setFrozen(frozenIds.value))

/** 천장 설비의 z 가 구역(반자 부착 · 플레넘) 안인가(Q10). 아니면 이유. 천장 설비가 아니면 true. */
function ceilingZCheck(e: Equipment, storey: Storey, z: number): true | string {
  const mark = ceilingMarks.value.find((m) => m.id === e.id)
  const zone = mark?.zone ?? ceilingZone(e.kind)
  if (!zone) return true
  return checkCeilingZ(zone, z - storey.elevation, ceilingOf(storey)?.height ?? null, storeyHeightOf.value.get(storey.id)?.value ?? null)
}

/** 커스텀존이 품는 방의 표시 이름. 이름과 방 번호를 같이 둔다. */
function zoneRoomLabel(id: string): string {
  const sp = selectedCustomZone.value?.storey.spaces.find((x) => x.id === id)
  if (!sp) return id
  return sp.longName && sp.name && sp.longName !== sp.name ? `${sp.longName} ${sp.name}` : sp.longName || sp.name || id
}

function changeCustomZones(storeyId: string, label: string, apply: (m: Model) => unknown): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotCustomZones(m, storeyId)
  const at = mark()
  const done = apply(m)
  if (!done) return false
  if (typeof done === 'object' && 'refused' in (done as object)) {
    note((done as { refused: string }).refused)
    return false
  }
  remember(label, snapshot, at)
  triggerRef(model)
  sceneVersion.value++
  return true
}

function startCustomZone() {
  const storey = targetStorey()
  if (!storey) return askStorey('커스텀존을 그릴')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  selectedId.value = null
  selectedSpaceId.value = null
  selectedCustomZoneId.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'custom', spaceId: null, storeyId: storey.id, name: `${storey.name} 커스텀존`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
  note('바닥에 꼭짓점을 찍어 커스텀존을 그립니다. 물리존과 경계가 달라도, 다른 커스텀존과 겹쳐도 됩니다 (Enter 마침, Esc 취소)')
}

function startCustomSplit() {
  const picked = selectedCustomZone.value
  if (!picked) return
  stopPlace()
  stopAdd()
  drawing.value = { purpose: 'customSplit', spaceId: picked.zone.id, storeyId: picked.storey.id, name: picked.zone.name, elevation: picked.storey.elevation, points: [] }
  viewer?.setPlaceMode(picked.storey.elevation)
  note(`${picked.zone.name}${josa(picked.zone.name, '을/를')} 나눌 선의 두 점을 바닥에 찍으세요 (Esc 취소)`)
}

function renameZone(raw: string) {
  const picked = selectedCustomZone.value
  if (!picked) return
  const name = raw.trim()
  if (!name) return note('커스텀존 이름은 비울 수 없습니다')
  changeCustomZones(picked.storey.id, `커스텀존 이름 ${name}`, (m) => renameCustomZone(m, picked.zone.id, name))
}

/** 더 붙인 별명(ADR-0012). 쉼표·줄바꿈으로 가른다. */
function setZoneAliases(raw: string) {
  const picked = selectedCustomZone.value
  if (!picked) return
  const aliases = raw.split(/[,，\n]/)
  changeCustomZones(picked.storey.id, `커스텀존 ${picked.zone.name} 별명`, (m) => setCustomZoneAliases(m, picked.zone.id, aliases))
}

function mergeZone(otherId: string) {
  const picked = selectedCustomZone.value
  if (!picked || !otherId) return
  const other = picked.storey.customZones?.find((z) => z.id === otherId)
  if (changeCustomZones(picked.storey.id, `${picked.zone.name} + ${other?.name ?? ''} 합치기`, (m) => mergeCustomZones(m, picked.zone.id, otherId))) {
    note(`${other?.name ?? ''}${josa(other?.name ?? '', '을/를')} ${picked.zone.name}에 합쳤습니다`)
  }
}

function removeZone() {
  const picked = selectedCustomZone.value
  if (!picked) return
  const name = picked.zone.name
  if (changeCustomZones(picked.storey.id, `${name} 지우기`, (m) => deleteCustomZone(m, picked.zone.id))) {
    selectedCustomZoneId.value = null
    note(`${name}${josa(name, '을/를')} 지웠습니다(Ctrl+Z 로 되돌립니다)`)
  }
}

function removeSpace() {
  const picked = selectedSpace.value
  if (!picked) return
  const name = picked.space.longName || picked.space.name
  const id = picked.space.id
  if (changeSpaces(picked.storey.id, `${name} 지우기`, (m) => deleteSpace(m, id))) {
    selectedSpaceId.value = null
    note(`${name}${josa(name, '을/를')} 지웠습니다. 그 안의 설비는 좌표로 다시 소속을 찾았습니다(Ctrl+Z 로 되돌립니다)`)
  }
}

/** 고른 물리존과 합칠 수 있는 같은 층 방. 벽 두께(MERGE_GAP) 안에 있는 것만, 가까운 순으로. */
const mergeCandidates = computed(() => {
  const picked = selectedSpace.value
  if (!picked || picked.space.footprint.length < 3) return []
  const ring = picked.space.footprint
  return picked.storey.spaces
    .filter((x) => x !== picked.space && x.footprint.length >= 3)
    .map((x) => ({
      space: x,
      gap: Math.min(...x.footprint.map((p) => distanceToRing(p, ring)), ...ring.map((p) => distanceToRing(p, x.footprint))),
    }))
    .filter((x) => x.gap <= MERGE_GAP)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 12)
})

function mergeInto(otherId: string) {
  const picked = selectedSpace.value
  if (!picked || !otherId) return
  const other = picked.storey.spaces.find((x) => x.id === otherId)
  const name = picked.space.longName || picked.space.name
  const otherName = other ? other.longName || other.name : otherId
  const keepId = picked.space.id
  let bridged = false
  const ok = changeSpaces(picked.storey.id, `${name} + ${otherName} 합치기`, (m) => {
    const done = mergeSpaces(m, keepId, otherId)
    if (done && 'bridged' in done) bridged = done.bridged
    return done
  })
  if (ok) note(`${otherName}${josa(otherName, '을/를')} ${name}에 합쳤습니다${bridged ? '. 사이의 벽 자리도 방에 넣었습니다' : ''}`)
}

// --- 설비 더하기·지우기·이름 (E7) ---------------------------------------------------------
//
// 더하기는 [설비 더하기] 를 누르고 바닥을 누른다. 종류는 모르는 채 바닥 높이에 놓고 고르게 한다 — 종류와 높이를
// 지어내지 않는다. 지우면 붙은 연결·계통 자리도 같이 빠지고 Ctrl+Z 로 그대로 돌아온다(edit.ts).
const adding = ref<{ storeyId: string; elevation: number; what: 'equipment' | 'door' | 'window' } | null>(null)
function startAddEquipment() {
  const storey = targetStorey()
  if (!storey) return askStorey('설비를 더할')
  if (ceilingMode.value && !ceilingOf(storey)) {
    editNotice.value = `${storey.name}의 반자 높이를 모릅니다. 천장 설비를 놓기 전에 왼쪽 도구에서 반자 높이를 입력하세요.`
    return
  }
  stopPlace()
  stopDraw()
  connectFrom.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  // 천장 모드에서 더한 설비는 반자 높이에 놓는다(종류를 정하기 전이라 반자 부착으로 본다).
  const z = ceilingMode.value ? storey.elevation + ceilingOf(storey)!.height : storey.elevation
  adding.value = { storeyId: storey.id, elevation: z, what: 'equipment' }
  viewer?.setPlaceMode(z)
  note(ceilingMode.value ? `${storey.name} 천장에 설비를 놓을 자리를 3D에서 클릭하세요 (Esc 취소)` : `${storey.name}에 설비를 놓을 바닥을 3D에서 클릭하세요 (Esc 취소)`)
}
function stopAdd() {
  if (!adding.value) return
  adding.value = null
  viewer?.setPlaceMode(null)
}
function addEquipmentAt(at: Vec2) {
  const m = model.value
  const target = adding.value
  stopAdd()
  if (!m || !target) return
  const n = m.storeys.reduce((k, st) => k + st.equipment.filter((e) => e.added).length, 0) + 1
  const position: Vec3 = [cm(at[0]), cm(at[1]), cm(target.elevation)]
  // 새 설비는 종류를 정하기 전까지 배관 없는 설비로 본다. 다른 배관 없는 설비 자리에는 더하지 않는다(OE-OBJ-16).
  const blocked = overlapForNew(m, target.storeyId, position, currentBox)
  if (blocked) return refuseOverlap(blocked)
  const mk = mark()
  const e = addEquipment(m, target.storeyId, { name: `새 설비 ${n}`, kind: null, position })
  if (!e) return
  const snapshot = snapshotEquipmentSet(m, e.id)
  if (snapshot?.kind === 'equipment-set') remember(`${e.name} 더하기`, { ...snapshot, present: false }, mk)
  triggerRef(model)
  redraw()
  selectedId.value = e.id
  note(`${e.name}${josa(e.name, '을/를')} ${ceilingMode.value ? '반자 높이' : '바닥 높이'}에 놓았습니다. 종류·이름·높이를 오른쪽 패널에서 정하세요`)
}
function removeEquipment(id: string) {
  const m = model.value
  if (!m) return
  const target = equipmentById.value.get(id)
  const lock = target ? ceilingLock(target) : null
  if (target && lock) return refuseLock(target, lock)
  const name = nameOfId(id)
  const snapshot = snapshotEquipmentSet(m, id)
  const at = mark()
  const done = deleteEquipment(m, id)
  if (!done || !snapshot) return
  remember(`${name} 지우기`, snapshot, at)
  ruleReport.value = done.rules
  if (selectedId.value === id) selectedId.value = null
  triggerRef(model)
  flowVersion.value++
  redraw()
  note(`${name}${josa(name, '을/를')} 지웠습니다${done.connections ? `(연결 ${done.connections}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
}
function renameEquipmentTo(id: string, name: string) {
  const m = model.value
  const trimmed = name.trim()
  if (!m || !trimmed) return
  const target = equipmentById.value.get(id)
  const lock = target ? ceilingLock(target) : null
  if (target && lock) return refuseLock(target, lock)
  const snapshot = snapshotEquipment(m, id)
  const at = mark()
  if (!renameEquipment(m, id, trimmed)) return
  remember(`${shortName(trimmed)} 이름 고침`, snapshot, at)
  triggerRef(model)
}
watch(editing, (on) => {
  if (!on && drawing.value) stopDraw()
  if (!on) stopAdd()
  if (!on) archMode.value = false
})

// --- 벽·문·창 편집 (E4) -----------------------------------------------------------------
//
// [벽·문·창] 을 켜면 3D 에 벽 외곽선과 문·창 자리가 서고, 바닥을 누르면 물리존보다 벽·문·창을 먼저 고른다. 고른 것은
// 방향키로 옮기고(10cm, Shift 1m) 오른쪽 패널에서 내력 여부를 정하거나 지운다. 벽은 두 점으로 긋고 문·창은 벽 가까이
// 누른다. 물리존 경계는 벽에서 다시 만들지 않는다(edit.ts). IFC 형상으로 그리는 내력벽 겹은 편집이 따라가지 않으니,
// 이 층을 켠 동안에는 숨기고 끌 때 다시 그린다.
const archMode = ref(false)
const selectedElementId = ref<string | null>(null)
// 여러 개 고르기(OE-UI-09): 다른 것을 고르거나 편집을 끝내면 묶음을 푼다. 지운 설비는 묶음에서 빠진다. 고른 것들이 다 선언된 뒤라 여기 둔다.
watch([selectedId, selectedSpaceId, selectedSystemId, selectedElementId, selectedCustomZoneId], (now) => {
  if (now.some(Boolean) && group.value.length) group.value = []
})
watch(editing, (on) => {
  if (!on) group.value = []
})
watch(model, () => {
  if (group.value.length && group.value.some((id) => !equipmentById.value.has(id))) setGroup(group.value.filter((id) => equipmentById.value.has(id)))
})
// 커스텀존을 고르면 다른 고른 것을 풀고, 다른 것을 고르면 커스텀존을 푼다(패널은 하나만 뜬다).
watch([selectedId, selectedSpaceId, selectedElementId], ([a, b, c]) => {
  if (a || b || c) selectedCustomZoneId.value = null
})
watch(selectedCustomZoneId, (id) => {
  if (!id) return
  selectedId.value = null
  selectedSpaceId.value = null
  selectedElementId.value = null
})
let archEdited = false
const selectedElement = computed(() => {
  const m = model.value
  const id = selectedElementId.value
  if (!m || !id) return null
  for (const storey of m.storeys) {
    // 내력벽과 거기 뚫린 문·창은 잠긴다(OE-OBJ-06). 고르고 볼 수는 있고, 옮기기·지우기만 막는다.
    const wall = storey.walls.find((w) => w.id === id)
    if (wall) return { kind: 'wall' as const, storey, wall, opening: null, locked: wallLocked(wall) }
    const opening = storey.openings.find((o) => o.id === id)
    if (opening) return { kind: opening.kind, storey, wall: null, opening, locked: wallLocked(storey.walls.find((w) => w.id === opening.wallId)) }
  }
  return null
})
watch([showZones, model, sceneVersion], () => viewer?.setHvacZones(showZones.value ? model.value : null, null))
watch([archMode, editing, model, sceneVersion, selectedElementId], () => {
  viewer?.setArchitecture(archMode.value && editing.value ? model.value : null, selectedElementId.value)
})
watch(archMode, (on) => {
  if (on) {
    viewer?.setWallsVisible(false)
    return
  }
  selectedElementId.value = null
  viewer?.setWallsVisible(showWalls.value)
  if (archEdited) {
    archEdited = false
    redraw()
  }
})
watch([selectedId, selectedSpaceId], ([a, b]) => {
  if (a || b) selectedElementId.value = null
})
watch(selectedElementId, (id) => {
  if (!id) return
  selectedId.value = null
  selectedSpaceId.value = null
})
/**
 * 고른 벽·문·창이 있는 층의 외벽 판정(OE-EXT-01). BIM 이 말한 것은 그대로, 안 말한 벽은 건물 바깥에 닿는지로 계산한다.
 * 벽을 옮기면 다시 센다(sceneVersion) — 모델에 저장하지 않는 값이다.
 */
const selectedExternal = computed(() => {
  void sceneVersion.value
  const storey = selectedElement.value?.storey
  return storey ? judgeExternal(storey) : null
})
/** 내력 여부의 출처(OE-OBJ-06). 더한 벽이거나 연 때와 값이 다르면 사람이 정한 것이다. */
const bearingSrc = (wall: Wall): 'edit' | 'bim' => {
  const was = baseline.value?.walls?.get(wall.id)
  return wall.added || (was !== undefined && was.loadBearing !== wall.loadBearing) ? 'edit' : 'bim'
}
const externalOf = (wallId: string | null | undefined) => (wallId ? selectedExternal.value?.get(wallId) ?? null : null)
/** 설비를 붙인 벽의 이름(OE-OBJ-04). */
const wallNameOf = (wallId: string) => model.value?.storeys.flatMap((st) => st.walls).find((w) => w.id === wallId)?.name || '벽'
const elementLabel = (kind: 'wall' | 'door' | 'window') => (kind === 'wall' ? '벽' : kind === 'door' ? '문' : '창')
const nameOfSpace = (id: string) => spaceNameOf(id)

/**
 * 벽 면에 붙은 설비의 지금 좌표(OE-OBJ-04). 벽을 옮기거나 두께·길이를 바꾸면 edit.ts 가 붙은 설비를 따라 옮기는데,
 * 3D 형상은 [벽·문·창] 을 끌 때 다시 그리기 전까지 제자리에 남았다. 고치기 전 좌표를 들고 있다가 바뀐 것만 옮긴다.
 */
function mountedAt(m: Model): Map<string, Vec3 | null> {
  const at = new Map<string, Vec3 | null>()
  for (const st of m.storeys) for (const e of st.equipment) if (e.wallId) at.set(e.id, e.position ? [e.position[0], e.position[1], e.position[2]] : null)
  return at
}

function followMounted(before: Map<string, Vec3 | null>, glide = false) {
  for (const [id, from] of before) {
    const to = equipmentById.value.get(id)?.position ?? null
    if (from && to && from[0] === to[0] && from[1] === to[1] && from[2] === to[2]) continue
    moveInScene(id, from, to, glide)
  }
}

function changeElements(storeyId: string, label: string, apply: (m: Model) => unknown, coalesce?: string): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotStoreyElements(m, storeyId)
  const at = mark()
  const mounted = mountedAt(m)
  const done = apply(m)
  if (!done) return false
  if (typeof done === 'object' && 'refused' in (done as object)) {
    note((done as { refused: string }).refused)
    return false
  }
  remember(label, snapshot, at, coalesce)
  archEdited = true
  triggerRef(model)
  followMounted(mounted)
  sceneVersion.value++
  return true
}

/** 벽과 벽 가까운 방 변을 같이 옮긴다. 벽·방을 한 번에 되돌리게 두 스냅숏을 묶는다. */
function moveWallCarrying(storeyId: string, wall: Wall, delta: Vec2) {
  const m = model.value
  if (!m) return
  const elements = snapshotStoreyElements(m, storeyId)
  const spaces = snapshotStoreySpaces(m, storeyId)
  const at = mark()
  const mounted = mountedAt(m)
  const done = moveWallWithSpaces(m, wall.id, delta, carryPlan)
  if (!done || !elements || !spaces) return
  carryPlan = done.plan
  remember(`${wall.name || '벽'} 옮김(방 경계 같이)`, { kind: 'many', parts: [elements, spaces] }, at, `el:${wall.id}:rooms`)
  areaChanges.value = [...areaChanges.value, ...done.changes]
  changes.value = [...changes.value, ...done.changes.flatMap((c) => c.equipment)]
  archEdited = true
  triggerRef(model)
  followMounted(mounted)
  viewer?.updateSpaces(m)
  sceneVersion.value++
  if (done.crossed.length) note(`방 경계가 자기와 겹칩니다: ${done.crossed.slice(0, 3).join(', ')}${done.crossed.length > 3 ? ` 외 ${done.crossed.length - 3}` : ''}`)
  else if (!done.changes.length) {
    note(done.plan.items.length ? '벽 길이 방향으로 옮겨서 방 경계는 그대로입니다' : '이 벽 가까이(0.6m)에 따라올 방 변이 없습니다')
  }
}

function setBearing(wall: Wall, raw: string) {
  const value = raw === 'true' ? true : raw === 'false' ? false : null
  const storey = selectedElement.value?.storey
  if (!storey) return
  changeElements(storey.id, `${wall.name || '벽'} 내력 ${value === null ? '모름' : value ? '내력' : '비내력'}`, (m) => setWallLoadBearing(m, wall.id, value))
}

function removeElement() {
  const picked = selectedElement.value
  if (!picked) return
  if (picked.locked) return note(WALL_LOCKED)
  const what = elementLabel(picked.kind)
  const name = picked.wall?.name || picked.opening?.name || what
  let openings = 0
  const ok = changeElements(picked.storey.id, `${name} 지우기`, (m) => {
    if (picked.wall) {
      const done = deleteWall(m, picked.wall.id)
      openings = done?.openings ?? 0
      return done
    }
    return deleteOpening(m, picked.opening!.id)
  })
  if (!ok) return
  selectedElementId.value = null
  note(`${what} ${name}${josa(name, '을/를')} 지웠습니다${openings ? `(뚫린 문·창 ${openings}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
}

/** 방향키로 고른 벽·문·창을 옮긴다. 화면 방향에 가장 가까운 평면 축이다(설비 옮기기와 같다). */
/**
 * 벽을 옮길 때 방 경계도 같이 옮기나(edit.ts 의 moveWallWithSpaces). 기본은 끔 — 방은 IfcSpace 가 따로 그린 것이라 벽이 방을
 * 지어내지 않는다. 켜면 벽 가까이 있던 방 변이 벽이 움직인 만큼 따라온다. 같은 벽을 방향키로 옮기는 동안은 처음 세운 계획을
 * 다시 쓴다(되돌아오면 제자리).
 */
const carryRooms = ref(false)
/**
 * 설비를 옮길 때 붙은 배관도 따라오게 하나(edit.ts 의 planFollow). 기본은 켬 — 끄면 설비만 옮겨져 3D·GeoJSON 에서 배관이
 * 떨어져 보인다. 도관을 직접 옮길 때는 무엇도 따라오지 않는다.
 */
const carryConduits = ref(true)
let carryPlan: WallCarryPlan | null = null
watch(selectedElementId, () => (carryPlan = null))

function nudgeElement(code: string, step: number): boolean {
  const picked = selectedElement.value
  if (!picked || !viewer) return false
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const delta: Vec2 = [cm(sign * ax * step), cm(sign * ay * step)]
  if (picked.locked) {
    note(WALL_LOCKED)
    return true
  }
  if (picked.wall) {
    if (!picked.wall.footprint?.length) {
      note('외곽선이 없는 벽은 옮길 수 없습니다')
      return true
    }
    // 다른 벽을 새로 가로지르게 되면 옮기지 않는다(OE-OBJ-05). 이유를 말해야 방향키가 고장 난 것처럼 보이지 않는다.
    const crossed = newCrossing(model.value!, picked.wall.id, picked.wall.footprint.map((r) => r.map((p) => [p[0] + delta[0], p[1] + delta[1]] as Vec2)))
    if (crossed) {
      note(crossingMessage(crossed))
      return true
    }
    if (carryRooms.value) {
      moveWallCarrying(picked.storey.id, picked.wall, delta)
      return true
    }
    changeElements(picked.storey.id, `${picked.wall.name || '벽'} 옮김`, (m) => moveWall(m, picked.wall!.id, delta), `el:${picked.wall.id}`)
    return true
  }
  const o = picked.opening!
  if (!o.position) {
    note('자리를 모르는 문·창은 옮길 수 없습니다(읽을 것에서 문·창 자리를 켜고 여세요)')
    return true
  }
  changeElements(picked.storey.id, `${o.name || elementLabel(o.kind)} 옮김`, (m) => moveOpening(m, o.id, [cm(o.position![0] + delta[0]), cm(o.position![1] + delta[1])]), `el:${o.id}`)
  return true
}

/** 벽 길이(OE-OBJ-05). 가운데를 두고 양 끝을 같이 늘이거나 줄인다. 꼭짓점 넷인 벽만이다(직사각형·비스듬히 맞댄 사다리꼴). */
function applyWallLength(wall: Wall, raw: string) {
  const value = Number(raw)
  const storey = selectedElement.value?.storey
  if (!storey || raw.trim() === '' || !Number.isFinite(value)) return
  changeElements(storey.id, `${wall.name || '벽'} 길이 ${value.toFixed(2)}m`, (m) => setWallLength(m, wall.id, value))
}

/** 벽 두께·높이(OE-OBJ-04 크기 y·z). 두께는 중심선을 두고 펴고, 높이는 빈칸이면 모름이다. */
function applyWallSize(wall: Wall, key: 'thickness' | 'height', raw: string) {
  const storey = selectedElement.value?.storey
  if (!storey) return
  if (key === 'height' && raw.trim() === '') {
    changeElements(storey.id, `${wall.name || '벽'} 높이 모름`, (m) => setWallHeight(m, wall.id, null))
    return
  }
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isFinite(value)) return
  const label = `${wall.name || '벽'} ${key === 'thickness' ? '두께' : '높이'} ${value.toFixed(2)}m`
  changeElements(storey.id, label, (m) => (key === 'thickness' ? setWallThickness(m, wall.id, value) : setWallHeight(m, wall.id, value)))
}

/** 외벽 여부를 사람이 정한다(OE-OBJ-04). 계산이 틀린 벽을 바로잡는 자리다. */
function setExternal(wall: Wall, raw: string) {
  const value = raw === 'true' ? true : raw === 'false' ? false : null
  const storey = selectedElement.value?.storey
  if (!storey) return
  changeElements(storey.id, `${wall.name || '벽'} ${value === null ? '외벽 여부 모름' : value ? '외벽' : '내벽'}`, (m) => setWallExternal(m, wall.id, value))
}

/** 문·창 가로·세로(OE-OBJ-07). */
function applyOpeningSize(o: Opening, key: 'width' | 'height', raw: string) {
  const value = Number(raw)
  const storey = selectedElement.value?.storey
  if (!storey || raw.trim() === '' || !Number.isFinite(value)) return
  const label = `${o.name || elementLabel(o.kind)} ${key === 'width' ? '가로' : '세로'} ${value.toFixed(2)}m`
  changeElements(storey.id, label, (m) => setOpeningSize(m, o.id, { [key]: value }))
}

function applyOpeningPosition(o: Opening, axis: 0 | 1, raw: string, input?: HTMLInputElement) {
  const value = Number(raw)
  const storey = selectedElement.value?.storey
  if (!o.position || !storey || raw.trim() === '' || !Number.isFinite(value)) return
  if (selectedElement.value?.locked) return note(WALL_LOCKED)
  const to: [number, number] = [o.position[0], o.position[1]]
  to[axis] = value
  changeElements(storey.id, `${o.name || elementLabel(o.kind)} 옮김`, (m) => moveOpening(m, o.id, to))
  // 문·창은 벽을 따라서만 가서(OE-OBJ-07) 친 값과 놓인 자리가 다를 수 있다. 칸은 치는 동안 덮이지 않으니(v-keep-typing) 놓인 자리로 되돌린다.
  if (input && o.position) input.value = String(mmOf(o.position[axis]))
}

function startWall() {
  const storey = targetStorey()
  if (!storey) return askStorey('벽을 그을')
  stopPlace()
  stopAdd()
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'wall', spaceId: null, storeyId: storey.id, name: `${storey.name} 벽`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
}

function startOpening(kind: 'door' | 'window') {
  const storey = targetStorey() ?? selectedElement.value?.storey ?? null
  if (!storey) return askStorey('문·창을 놓을')
  stopPlace()
  stopDraw()
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  adding.value = { storeyId: storey.id, elevation: storey.elevation, what: kind }
  viewer?.setPlaceMode(storey.elevation)
  note(`${elementLabel(kind)}${josa(elementLabel(kind), '을/를')} 놓을 벽을 3D에서 클릭하세요 (Esc 취소)`)
}

function addOpeningAt(at: Vec2) {
  const target = adding.value
  stopAdd()
  if (!target || target.what === 'equipment') return
  const kind = target.what
  let made: Opening | null = null
  const ok = changeElements(target.storeyId, `${elementLabel(kind)} 놓기`, (m) => {
    const done = addOpening(m, target.storeyId, kind, [cm(at[0]), cm(at[1])])
    if (done && !('refused' in done)) made = done
    return done
  })
  if (ok && made) {
    selectedElementId.value = (made as Opening).id
    note(`${elementLabel(kind)}${josa(elementLabel(kind), '을/를')} 놓았습니다. 방향키로 벽을 따라 옮깁니다`)
  }
}

// --- 연결 잇기·끊기 -----------------------------------------------------------------
//
// 고른 설비에서 [잇기] 를 누르고 상대를 고르면(3D·표·목록 어디서든) 둘을 잇는다. 이은 연결은 방향 없이 시작한다 —
// 이어서 상류로·하류로를 정하면 그때 brick:feeds 로 나간다. 포트(BIM)가 말한 연결은 끊지 않는다(edit.ts).
const connectFrom = ref<string | null>(null)
watch([selectedSpaceId, editing], () => (connectFrom.value = null))
const nameOfId = (id: string) => shortName(equipmentById.value.get(id)?.name || equipmentById.value.get(id)?.ifcClass || id)
function startConnect() {
  if (!selectedId.value) return
  connectFrom.value = selectedId.value
  note(`${nameOfId(selectedId.value)}${josa(nameOfId(selectedId.value), '과/와')} 연결할 설비를 3D나 목록에서 고르세요 (Esc 취소)`)
}
function connectTo(id: string) {
  const m = model.value
  const from = connectFrom.value
  connectFrom.value = null
  if (!m || !from) return
  if (id === from) return note('같은 설비끼리는 연결할 수 없습니다')
  if (connectionBetween(m, from, id)) return note('이미 이어져 있습니다')
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
function disconnect(c: Connection) {
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

// --- 자동 저장 (OE-HIST-04) -------------------------------------------------------------------
//
// 편집은 탭 안에만 있어서 브라우저가 죽거나 PC 가 다시 켜지면 사라졌다(창 닫기는 묻지만 그 밖은 못 막는다). 편집할
// 때마다 "편집 저장" 과 같은 파일(lib/edit-file.ts)을 브라우저 `oe-autosave:<파일 이름>` 에 적어 둔다. 같은 IFC 를 다시 열었을 때
// 임시 저장본·8084 저장본으로 돌아오는 상태와 다르면 이어서 할지 묻는다. 되살리기도 편집 파일 불러오기와 같은 길이다 — 값을
// 덮지 않고 편집 함수에 다시 넣는다.
//
// 임시 저장(아래, 층마다)과 자리가 다르다. 임시 저장은 사람이 [임시 저장] 을 누른 층만, 자동 저장은 마지막 상태 전부다.
// 열자마자 지우면 안 된다. 연 직후에는 바뀐 것이 0 이라, 그대로 저장하면 되살릴 기록을 지운다. 사람이 편집을
// 시작하거나 되살린 뒤부터 적는다.
const AUTOSAVE_PREFIX = 'oe-autosave:'
/** 되살릴 수 있는 편집 — 자동 저장에 남은 것이나 [저장 안 함] 으로 버린 것. 위 줄의 [이어서 하기] 가 쓴다. */
const draft = shallowRef<{ file: EditFile; count: number; savedAt: string } | null>(null)
let autosaveArmed = false
let autosaveTimer: number | undefined
const autosaveKey = () => AUTOSAVE_PREFIX + fileName.value
/** 층 완료를 누르거나 지운 횟수(OE-MAN-06). 완료 표시는 되돌리기 이력에 들지 않아, 자동 저장·저장 안 한 편집 판정이 이것도 본다. */
const progressVersion = ref(0)
watch(baseline, () => (progressVersion.value = 0))
const editCount = countEdits
const editsIn = (part: EditFile | undefined) => (part ? editCount(part) : 0)

watch(baseline, () => {
  autosaveArmed = false
  draft.value = null
})
// 되돌리기 이력이 늘면 사람이 편집한 것이다. 남아 있던 기록은 이 편집으로 바뀐다.
watch(
  () => history.value.length,
  (n, was) => {
    if (n > (was ?? 0)) {
      autosaveArmed = true
      draft.value = null
    }
  },
)
watch([changeCount, flowVersion, () => history.value.length, progressVersion], () => {
  if (!autosaveArmed) return
  window.clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => {
    const m = model.value
    if (!m || !baseline.value) return
    try {
      const file = exportEdits(m, baseline.value, fileName.value)
      // 마지막으로 저장(8084·파일·구축하기)한 것과 같으면 남길 것이 없다.
      if (editCount(file) > 0 && editSig(file) !== committedSig) localStorage.setItem(autosaveKey(), JSON.stringify(file))
      else localStorage.removeItem(autosaveKey())
    } catch {
      // 저장소가 차거나 막혀 있으면 이번 창에서만 산다. "편집 저장" 으로 내려받는 길은 그대로다.
    }
  }, 600)
})

function restoreDraft() {
  const d = draft.value
  if (!d) return
  draft.value = null
  mode.value = 'edit'
  // 되살릴 편집은 연 때 기준의 편집 전부다. 8084 저장본·임시 저장본을 이미 얹었으면 걷고 얹는다 — 안 그러면 더한 설비가 두 번 생긴다.
  resetToOpened()
  applyEditFile(d.file, '이어서 하기')
  // 모든 층의 편집이 들어왔으니 층에 들어갈 때 임시 저장본을 다시 얹지 않는다.
  for (const k of floorDrafts.keys()) appliedFloors.add(k)
}
function discardDraft() {
  draft.value = null
  try {
    localStorage.removeItem(autosaveKey())
  } catch {
    // 못 지워도 다음 편집이 덮는다
  }
}

// --- 임시 저장 — 층마다 하나 (OE-COM-08 · OE-WF-01~03) -----------------------------------------------
//
// [임시 저장] 은 지금 층의 편집을 이 브라우저 `oe-draft:<파일 이름>@<층 id>` 에 남긴다. 층마다 하나고, 다시 누르면 덮는다(목록은
// 두지 않는다). 웹(8084)에는 올리지 않는다. 임시 저장본이 있는 층에 편집 모드로 들어가면 묻지 않고 얹어 이어서 편집한다(OE-WF-02).
// 층이 없는 편집(계통·종류·방향·잇기)은 건물 조각(`@*`)이라 어느 층에서 임시 저장해도 같이 남고, 어느 층에 들어가도 같이 얹힌다
// (lib/storey-drafts.ts).
//
// 얹기는 늘 "지금 편집 전부에서 그 층 조각만 갈아 끼워 연 때부터 다시 얹기" 다. 8084 저장본을 얹은 위에 연 때 기준 편집을 또 얹으면
// 더한 설비가 두 번 생긴다. 다시 얹으면 되돌리기 이력은 비워진다(불러온 편집과 같다).
//
// 저장하지 않은 편집이 있는 층에서 다른 층으로 가려 하면 묻는다 — 임시 저장 / 저장 안 함 / 취소(편집 종료와 같은 대화상자).
const DRAFT_PREFIX = 'oe-draft:'
const draftKey = (storeyKey: string) => `${DRAFT_PREFIX}${fileName.value}@${storeyKey}`
/** 연 때의 층. 층 조각을 가르는 기준이다. */
let homeOf: HomeOf = () => null
/** 이 파일의 층별 임시 저장본(브라우저에서 읽은 것). 열쇠는 층 id 또는 BUILDING. */
let floorDrafts = new Map<string, EditFile>()
/** 이미 얹은 임시 저장본의 열쇠. */
const appliedFloors = new Set<string>()
/** 조각마다 마지막으로 저장(임시 저장·8084·파일·구축하기)한 것. 저장 안 한 편집과 [저장 안 함] 이 이것과 견준다. */
const savedParts = shallowRef(new Map<string, EditFile>())
/** 열기(8084 저장본 얹기까지)가 끝났는가. 그 전에 임시 저장본을 얹으면 저장본과 겹친다. */
let openSettled = false
// 층 바꾸기를 묻는 감시(아래)가 새 파일의 첫 층 고르기를 물음으로 잡지 않게, 파일이 바뀌는 순간 바로 내린다.
watch(baseline, () => (openSettled = false), { flush: 'sync' })
watch(baseline, (b) => {
  floorDrafts = new Map()
  appliedFloors.clear()
  savedParts.value = new Map()
  if (!b) return
  const home = new Map<string, string>()
  for (const st of (pristine ?? model.value)?.storeys ?? []) for (const x of [...st.spaces, ...st.equipment, ...st.walls, ...st.openings]) home.set(x.id, st.id)
  homeOf = (id) => home.get(id) ?? null
  try {
    const prefix = draftKey('')
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(prefix)) continue
      const file = parseEditFile(localStorage.getItem(k) ?? '')
      if (typeof file !== 'string') floorDrafts.set(k.slice(prefix.length), file)
    }
  } catch {
    // 브라우저 저장소를 못 읽으면 얹을 임시 저장본도 없다.
  }
})

function currentParts(): Map<string, EditFile> {
  const m = model.value
  if (!m || !baseline.value) return new Map()
  return splitByStorey(exportEdits(m, baseline.value, fileName.value), homeOf)
}
/** 마지막 저장 뒤 바뀐 조각의 열쇠(층 id 또는 BUILDING). */
function dirtyKeys(parts = currentParts()): string[] {
  const keys = new Set([...parts.keys(), ...savedParts.value.keys()])
  return [...keys].filter((k) => partSig(parts.get(k)) !== partSig(savedParts.value.get(k)))
}
/** 저장 안 한 편집 수(근사 — 조각마다 지금 편집 수에서 저장한 편집 수를 뺀다). */
function unsavedCount(keys: string[], parts = currentParts()): number {
  return Math.max(1, keys.reduce((n, k) => n + Math.max(0, editsIn(parts.get(k)) - editsIn(savedParts.value.get(k))), 0))
}
/** 지금 편집하는 층. 한 층을 보고 있으면 그 층, "모든 층" 이거나 층이 하나면 전부다. */
function floorsInView(): string[] {
  const m = model.value
  if (!m) return []
  return viewStorey.value ? [viewStorey.value] : m.storeys.map((st) => st.id)
}
const floorName = (id: string | null) => (id ? (model.value?.storeys.find((st) => st.id === id)?.name ?? id) : '모든 층')

/** 조각을 갈아 끼우고 연 때부터 다시 얹는다. 값이 null 이면 그 조각을 뺀다(연 때로). */
function replaceParts(next: Map<string, EditFile | null>, from: string) {
  if (!model.value || !baseline.value || !pristine) return
  const parts = currentParts()
  for (const [k, part] of next) {
    if (part) parts.set(k, part)
    else parts.delete(k)
  }
  resetToOpened()
  if (parts.size) applyEditFile(joinParts(parts.values(), { format: EDIT_FORMAT, version: 1, source: fileName.value, savedAt: new Date().toISOString() }), from, true)
}

/** 편집 중인 층에 임시 저장본이 있으면 묻지 않고 얹는다(OE-WF-02). 건물 조각은 처음 한 번 같이 얹는다. */
function enterFloors() {
  if (!editing.value || !openSettled || !model.value) return
  const keys = [...floorsInView(), BUILDING].filter((k) => floorDrafts.has(k) && !appliedFloors.has(k))
  if (!keys.length) return
  replaceParts(new Map(keys.map((k) => [k, floorDrafts.get(k)!])), '임시 저장본')
  const saved = new Map(savedParts.value)
  for (const k of keys) {
    appliedFloors.add(k)
    saved.set(k, floorDrafts.get(k)!)
  }
  savedParts.value = saved
  const names = keys.filter((k) => k !== BUILDING).map(floorName)
  note(`${names.length ? names.join(' · ') : '건물'}의 임시 저장본을 열었습니다. 이어서 편집합니다`)
}
watch([editing, viewStorey], enterFloors)

/** 열기(8084 저장본 얹기까지)가 끝났다. 연 상태를 저장된 상태로 두고, 자동 저장이 돌아올 상태와 다르면 묻고, 임시 저장본을 얹는다. */
function settleOpen() {
  if (!model.value || !baseline.value || openSettled) return
  openSettled = true
  savedParts.value = currentParts()
  try {
    const raw = localStorage.getItem(autosaveKey())
    const file = raw ? parseEditFile(raw) : null
    if (file && typeof file !== 'string' && editCount(file) > 0) {
      const expected = new Map(savedParts.value)
      for (const [k, part] of floorDrafts) expected.set(k, part)
      const got = splitByStorey(file, homeOf)
      const keys = new Set([...expected.keys(), ...got.keys()])
      if ([...keys].some((k) => partSig(expected.get(k)) !== partSig(got.get(k)))) draft.value = { file, count: editCount(file), savedAt: file.savedAt }
      else localStorage.removeItem(autosaveKey())
    }
  } catch {
    // 저장소를 못 읽으면 물을 것도 없다
  }
  enterFloors()
}

/** 이 파일의 임시 저장본을 전부 지운다. 저장(8084·파일·구축하기)하면 임시 저장본은 쓸모가 없다. */
function clearDrafts() {
  try {
    const prefix = draftKey('')
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // 못 지워도 다음 임시 저장이 덮는다
  }
  floorDrafts = new Map()
}

// 저장 안 한 편집이 있는 층에서 다른 층으로 가려 하면 묻는다. 묻는 동안은 층을 그대로 둔다. 표에서 다른 층의 것을 골라 층이
// 따라가는 것도 같은 길이다. 대화상자를 거쳐 옮길 때(goFloor)와 "모든 층" 으로 넓힐 때는 묻지 않는다.
let switching = false
watch(
  viewStorey,
  (now, was) => {
    // "모든 층" 으로 넓히는 것은 다른 층으로 가는 것이 아니다 — 그 층도 계속 보이고 고칠 수 있다.
    if (switching || !openSettled || !editing.value || !was || !now || now === was) return
    const parts = currentParts()
    if (!dirtyKeys(parts).includes(was)) return
    switching = true
    viewStorey.value = was
    switching = false
    if (document.fullscreenElement) void document.exitFullscreen()
    exitAsk.value = { count: unsavedCount([was], parts), floor: { from: was, to: now } }
  },
  { flush: 'sync' },
)
function goFloor(id: string | null) {
  switching = true
  viewStorey.value = id
  switching = false
}

// --- 8084 에 저장 (OE-COM-08 "저장 시 변경사항을 웹에서 바로 확인") ----------------------------------
//
// data/ 에서 연 파일은 [편집 저장] 이 편집 파일을 서버(src/server/saved-edits.ts)에 둔다. 같은 파일을 8084 에서 여는 사람은
// 누구나 그 편집을 얹은 채로 본다. 손으로 연 파일은 서버에 원본이 없어서 예전처럼 파일로 내려받는다. 임시 저장은 서버에
// 오지 않는다(이 브라우저에만, "웹에 반영되지 않는다").
let loadingPath: string | null = null
/** 열린 모델을 이룬 파일들의 data/ 경로(연 순서). 손으로 고른 파일은 null. */
const openedSources = ref<(string | null)[]>([])
const serverKey = computed(() =>
  openedSources.value.length && openedSources.value.every((p) => p) ? openedSources.value.join('|') : null,
)
/** 지금 모델에 얹은 8084 저장본. 저장 안 함은 여기까지만 되돌린다. */
const serverSaved = shallowRef<{ file: EditFile; savedAt: string } | null>(null)
/** 마지막으로 정말 저장한(8084·파일) 편집의 서명. 자동 저장이 이것과 같으면 임시 저장으로 남기지 않는다. */
let committedSig: string | null = null
watch(baseline, () => {
  serverSaved.value = null
  committedSig = null
})
const savedEditsUrl = (key?: string) => `./__data/__edits${key ? `?key=${encodeURIComponent(key)}` : ''}`

/** data/ 목록 옆에 보이는 8084 저장본. 열쇠(경로를 | 로 이은 것)마다 하나. */
type SavedSet = { key: string; paths: string[]; count: number; savedAt: string }
const savedSets = ref<SavedSet[]>([])
function refreshSavedSets() {
  fetch(savedEditsUrl())
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => (savedSets.value = Array.isArray(list) ? list : []))
    .catch(() => {})
}
refreshSavedSets()
const savedFor = (path: string) => savedSets.value.find((s) => s.key === path) ?? null

async function loadServerEdits() {
  const key = serverKey.value
  if (!key) return
  let file: EditFile | string
  try {
    const r = await fetch(savedEditsUrl(key))
    if (!r.ok) return
    file = parseEditFile(await r.text())
  } catch {
    return
  }
  if (typeof file === 'string' || key !== serverKey.value) return
  applyEditFile(file, `8084 저장본 · ${when(file.savedAt)}`)
  serverSaved.value = { file, savedAt: file.savedAt }
  markSaved()
  committedSig = savedSig
}

/** 편집 파일을 8084 에 둔다. 됐으면 true. */
async function saveToServer(file: EditFile): Promise<boolean> {
  const key = serverKey.value
  if (!key) return false
  try {
    const r = await fetch(savedEditsUrl(key), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file) })
    if (!r.ok) {
      const why = await r.json().then((b: { error?: string }) => b.error ?? '').catch(() => '')
      editFileNote.value = `8084 에 저장하지 못했습니다(HTTP ${r.status}${why ? ` · ${why}` : ''}). 파일로 내려받았습니다.`
      return false
    }
  } catch {
    editFileNote.value = '8084 에 닿지 못했습니다. 파일로 내려받았습니다.'
    return false
  }
  serverSaved.value = { file, savedAt: file.savedAt }
  refreshSavedSets()
  return true
}

/** 저장 시각을 "오늘 14:05" · "10월 2일 14:05" 로. */
function when(iso: string): string {
  const t = new Date(iso)
  const hm = `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
  return new Date().toDateString() === t.toDateString() ? `오늘 ${hm}` : `${t.getMonth() + 1}월 ${t.getDate()}일 ${hm}`
}

// --- 편집 종료 (OE-COM-08) ---------------------------------------------------------------
//
// 편집을 끝낼 때 마지막으로 저장한 뒤 바뀐 것이 있으면 묻는다 — 임시 저장 / 저장 안 함 / 취소. 저장은 [편집 저장](편집
// 파일)이나 [구축하기](온톨로지 두 파일)다. 바뀐 것은 편집 파일 내용(저장 시각을 뺀)으로 견준다 — 되돌리기로 저장한 때와
// 같아졌으면 묻지 않는다. 끝내는 길(편집 종료·보기·E·전체 화면의 편집 체크)은 전부 leaveEdit 을 거친다.
let savedSig: string | null = null
watch(baseline, () => (savedSig = null))
function editSig(file?: EditFile): string | null {
  const m = model.value
  if (!m || !baseline.value) return null
  const f = file ?? exportEdits(m, baseline.value, fileName.value)
  return editCount(f) > 0 ? JSON.stringify({ ...f, savedAt: '' }) : null
}
function markSaved() {
  savedSig = editSig()
  savedParts.value = currentParts()
}
/** 저장(8084·파일·구축하기)했다. 모든 층이 저장된 상태가 되고 임시 저장본은 지운다. */
function committed() {
  clearDrafts()
  markSaved()
  committedSig = savedSig
}
/** 묻는 중인 대화상자. `floor` 가 있으면 층을 바꾸려다 물은 것이다. */
const exitAsk = shallowRef<{ count: number; floor?: { from: string; to: string | null } } | null>(null)

/** 편집을 끝낸다. 저장하지 않은 편집이 있으면 묻고 false 를 돌려준다(끝내지 않았다). */
function leaveEdit(): boolean {
  if (!editing.value) return true
  const parts = currentParts()
  const dirty = dirtyKeys(parts)
  if (!dirty.length) {
    mode.value = 'view'
    return true
  }
  // 대화상자는 전체 화면 요소 밖에 있어서 전체 화면에서는 안 보인다. 먼저 나온다.
  if (document.fullscreenElement) void document.exitFullscreen()
  exitAsk.value = { count: unsavedCount(dirty, parts) }
  return false
}
function onEditToggle(box: HTMLInputElement) {
  if (box.checked) mode.value = 'edit'
  else if (!leaveEdit()) box.checked = true
}
/** 대화상자의 [임시 저장]. 층을 바꾸려던 것이면 그 층만 남기고 옮기고, 편집을 끝내려던 것이면 저장 안 한 층을 전부 남기고 끝낸다. */
function exitSaving() {
  const ask = exitAsk.value
  exitAsk.value = null
  if (ask?.floor) {
    keepDraft([ask.floor.from])
    goFloor(ask.floor.to)
    return
  }
  keepDraft(dirtyKeys())
  mode.value = 'view'
}
/**
 * [임시 저장]. 지금 층(모든 층을 보고 있으면 저장 안 한 층 전부)과 건물 조각을 이 브라우저에 남긴다. 층마다 하나라 다시 누르면 덮는다
 * (OE-WF-03). 편집이 없는 층은 임시 저장본을 지운다. 웹(8084)에는 올리지 않는다(OE-WF-01). 저장소가 막혀 있으면 파일로 내려받는다.
 */
function keepDraft(keys: string[] = viewStorey.value ? [viewStorey.value] : dirtyKeys()) {
  if (!model.value || !baseline.value) return
  const parts = currentParts()
  const saved = new Map(savedParts.value)
  const all = [...new Set([...keys, BUILDING])]
  try {
    for (const k of all) {
      const part = parts.get(k)
      if (part) {
        localStorage.setItem(draftKey(k), JSON.stringify(part))
        floorDrafts.set(k, part)
        saved.set(k, part)
      } else {
        localStorage.removeItem(draftKey(k))
        floorDrafts.delete(k)
        saved.delete(k)
      }
      appliedFloors.add(k)
    }
  } catch {
    // 브라우저 저장소가 막혔으면 파일로만 내려받는다.
    void saveEdits(true)
    return
  }
  savedParts.value = saved
  const names = all.filter((k) => k !== BUILDING).map(floorName)
  note(`${names.length ? names.join(' · ') : '건물'} 편집을 이 브라우저에 임시 저장했습니다(웹에는 반영되지 않습니다). 그 층에 다시 들어오면 이어서 편집합니다`)
}
/** 대화상자의 [저장]. 8084 에 둔다(못 두면 파일로 내려받는다). 그다음 층을 옮기거나 보기로 간다. */
async function exitCommitting() {
  const ask = exitAsk.value
  exitAsk.value = null
  await saveEdits()
  if (ask?.floor) goFloor(ask.floor.to)
  else mode.value = 'view'
}
function exitDiscarding() {
  const ask = exitAsk.value
  exitAsk.value = null
  if (ask?.floor) {
    const n = discardFloors([ask.floor.from])
    goFloor(ask.floor.to)
    note(`${floorName(ask.floor.from)}의 저장 안 한 편집 ${n}건을 버리고 마지막으로 저장한 때로 되돌렸습니다. 위 줄의 [이어서 하기]로 되살립니다`)
    return
  }
  const n = discardFloors(dirtyKeys())
  mode.value = 'view'
  note(`편집 ${n}건을 버리고 마지막으로 저장한 때로 되돌렸습니다. 위 줄의 [이어서 하기]로 되살립니다`)
}

/**
 * [저장 안 함]. 고른 조각을 마지막으로 저장한 때(임시 저장본, 없으면 8084·파일 저장, 없으면 연 때)로 되돌린다. 버리기 전 편집 전부를
 * 위 줄(draft)에 올려 한 번 되살릴 수 있게 둔다 — [저장 안 함]을 잘못 누르면 한 시간 고친 것이 사라진다. 버린 수를 돌려준다.
 */
function discardFloors(keys: string[]): number {
  const m = model.value
  if (!m || !pristine || !baseline.value || !keys.length) return 0
  const file = exportEdits(m, baseline.value, fileName.value)
  const n = unsavedCount(keys, splitByStorey(file, homeOf))
  replaceParts(new Map(keys.map((k) => [k, savedParts.value.get(k) ?? null])), '저장 안 함')
  autosaveArmed = false
  if (editCount(file) > 0) draft.value = { file, count: editCount(file), savedAt: file.savedAt }
  return n
}

/** 연 때(pristine)의 모델로 되돌린다. 저장 안 함과, 8084 저장본을 얹은 뒤 임시 저장을 되살릴 때가 쓴다. */
function resetToOpened() {
  if (!pristine) return
  meshesToOpened()
  const opened = structuredClone(pristine)
  ruleReport.value = inferFlowByRules(opened)
  model.value = opened
  changes.value = []
  areaChanges.value = []
  confirmations.value = []
  storeyMoved.value = new Set()
  positionDrafts.value = new Map()
  history.value = []
  future.value = []
  selectedId.value = null
  selectedSpaceId.value = null
  selectedElementId.value = null
  autosaveArmed = false
  savedSig = null
  flowVersion.value++
  redraw()
}

const draftTime = computed(() => {
  const d = draft.value
  if (!d) return ''
  const t = new Date(d.savedAt)
  const today = new Date().toDateString() === t.toDateString()
  return today
    ? `오늘 ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
    : `${t.getMonth() + 1}월 ${t.getDate()}일 ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
})

// --- 판본 비교 (PRD #6, 요구사항 R13) ----------------------------------------------------
//
// 이전 판본 IFC 를 열어 지금 모델과 짝짓는다(lib/versions.ts). 새로 생긴 것·없어진 것·옮겨진 것·소속이 바뀐 것을
// 보이고, 두 판본에 다 있는 것 중 GUID 가 그대로인 비율이 요구사항 R13 의 실측이 된다. 이전 판본은 짝짓기에만
// 쓰고 버린다 — 화면·내보내기는 지금 모델 그대로다.
const versionDiff = shallowRef<{ name: string; diff: VersionDiff } | null>(null)
const versionBusy = ref(false)
const versionError = ref('')
const versionView = ref('equipment-moved')
watch(fileName, () => {
  versionDiff.value = null
  versionError.value = ''
})

async function onVersionPick(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  const m = model.value
  if (!picked || !m) return
  // 워커는 하나라 열기·덧붙이기와 겹치면 안 된다(onmessage 를 서로 덮는다). busy 로 막고 진행 표시도 같이 쓴다.
  versionBusy.value = true
  busy.value = true
  versionError.value = ''
  beginProgress('이전 판본 여는 중')
  try {
    const { model: prev } = await importInWorker(await picked.arrayBuffer())
    const diff = compareVersions(prev, m)
    versionDiff.value = { name: picked.name, diff }
    // 처음 보일 목록은 비어 있지 않은 것 중 앞의 것.
    versionView.value = versionLists.value.find((l) => l.rows.length)?.key ?? 'equipment-moved'
  } catch (e) {
    versionError.value = `열지 못했습니다(${picked.name}): ${e instanceof Error ? e.message : String(e)}`
  } finally {
    versionBusy.value = false
    busy.value = false
    endProgress()
  }
}

/** R13 실측: 두 판본에 다 있는 것 중 GUID 가 그대로인 것과, 바뀌어 다른 열쇠로 찾은 것. */
const versionStat = computed(() => {
  const v = versionDiff.value
  if (!v) return null
  const sum = (by: Record<MatchKey, number>) => ({ kept: by.guid, rematched: by.revitId + by.name + by.position })
  const a = sum(v.diff.spaces.by)
  const b = sum(v.diff.equipment.by)
  return { name: v.name, kept: a.kept + b.kept, rematched: a.rematched + b.rematched, storeyScale: v.diff.storeyScale }
})

type VersionRow = { id: string; name: string; detail: string; target: 'equipment' | 'space' | null }
const versionLists = computed((): { key: string; label: string; rows: VersionRow[] }[] => {
  const d = versionDiff.value?.diff
  if (!d) return []
  const eq = (r: { id: string; name: string }, detail = ''): VersionRow => ({ ...r, detail, target: 'equipment' })
  const sp = (r: { id: string; name: string }, detail = ''): VersionRow => ({ ...r, detail, target: 'space' })
  const gone = (r: { id: string; name: string }): VersionRow => ({ ...r, detail: '', target: null })
  const spaceName = (id: string) => spaceNameOf(id)
  // GUID 가 바뀐 것(R13 판정 근거). 지금 판본에서 고르고, 이전 GUID 와 무엇으로 찾았는지를 같이 보인다.
  const rekeyed = (r: VersionDiff['spaces']['rekeyed'][number], target: 'equipment' | 'space'): VersionRow => ({
    id: r.id,
    name: r.name,
    detail: `${MATCH_KEY_BY[r.by]} 찾음 · 이전 GUID ${r.prevId}`,
    target,
  })
  return [
    { key: 'rekeyed', label: 'GUID가 바뀐 것', rows: [...d.spaces.rekeyed.map((r) => rekeyed(r, 'space')), ...d.equipment.rekeyed.map((r) => rekeyed(r, 'equipment'))] },
    { key: 'equipment-moved', label: '옮겨진 설비', rows: d.equipment.moved.map((r) => eq(r, `${r.distance.toFixed(2)} m`)) },
    {
      key: 'equipment-relocated',
      label: '소속이 바뀐 설비',
      rows: d.equipment.relocated.map((r) => eq(r, `${r.from ?? '(소속 없음)'} → ${r.to ?? '(소속 없음)'}`)),
    },
    { key: 'equipment-added', label: '새 설비', rows: d.equipment.added.map((r) => eq(r)) },
    { key: 'equipment-removed', label: '없어진 설비', rows: d.equipment.removed.map(gone) },
    { key: 'spaces-renamed', label: '이름이 바뀐 물리존', rows: d.spaces.renamed.map((r) => sp({ id: r.id, name: spaceName(r.id) }, `${r.from || '(없음)'} → ${r.to || '(없음)'}`)) },
    {
      key: 'spaces-reshaped',
      label: '넓이가 바뀐 물리존',
      rows: d.spaces.reshaped.map((r) => sp(r, `${r.from.toFixed(1)} → ${r.to.toFixed(1)} ㎡`)),
    },
    { key: 'spaces-added', label: '새 물리존', rows: d.spaces.added.map((r) => sp(r)) },
    { key: 'spaces-removed', label: '없어진 물리존', rows: d.spaces.removed.map(gone) },
  ]
})
const versionRows = computed(() => versionLists.value.find((l) => l.key === versionView.value)?.rows ?? [])

/** 비교 목록에서 물리존을 고른다. 3D 에서 바닥을 누른 것과 같다(편집 모드가 아니어도 그 방에 맞춘다). */
function showSpace(id: string) {
  selectedId.value = null
  selectedSystemId.value = null
  selectedSpaceId.value = id
  viewer?.frameSpace(id)
  const el = stage.value
  if (el && el.getBoundingClientRect().top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// --- 편집을 잃지 않게 ----------------------------------------------------------------
//
// 편집은 탭 안에만 있다(내보낸 파일에만 남는다). 새로 고침·탭 닫기·다른 파일 열기가 편집을 조용히 버리면, 한 시간
// 고친 것이 경고 없이 사라진다. 편집이 남아 있으면 먼저 묻는다.
const hasEdits = computed(() => changeCount.value > 0 || history.value.length > 0 || progressVersion.value > 0)
watch(fileName, () => (editFileNote.value = ''))
function onBeforeUnload(e: BeforeUnloadEvent) {
  // 임시 저장·편집 저장·구축하기 뒤로 바뀐 것이 없으면 묻지 않는다(OE-COM-08). 남길 것이 이미 남아 있다.
  if (!hasEdits.value || !dirtyKeys().length) return
  e.preventDefault()
  // 옛 브라우저는 returnValue 가 있어야 묻는다. 문구는 브라우저가 정한 것으로 바뀐다.
  e.returnValue = ''
}
window.addEventListener('beforeunload', onBeforeUnload)
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

async function load(name: string, read: () => Promise<ArrayBuffer>) {
  if (
    hasEdits.value &&
    !window.confirm(
      `지금까지 편집한 내용이 사라집니다. 이어서 하려면 먼저 "편집 저장"(Ctrl+S)으로 내려받으세요.

${name} 파일을 열까요?`,
    )
  )
    return
  busy.value = true
  error.value = ''
  beginProgress('파일 읽는 중')
  try {
    let result: { model: Model; meshes: MeshMap }
    idfReport.value = null
    idfSource = null
    if (isIdf(name)) {
      // IDF 만 연 것. 공조존과 담당 관계만 있고 방·설비 형상은 없다. 글이라 워커 없이 바로 읽는다.
      idfSource = { name, idf: readIdf(new TextDecoder().decode(await read())) }
      const done = modelFromIdf(idfSource.idf, name)
      idfReport.value = done.report
      result = { model: done.model, meshes: new Map() }
    } else {
      result = await importInWorker(await read())
    }
    progress.value = { label: '3D 그리는 중' }
    await paint()
    meshes = result.meshes
    meshBase = new Map()
    // 임포터가 이미 한 번 돌렸다. 계통별 채점표를 화면이 쓰려고 다시 받는다(같은 입력이면 같은 결과다).
    ruleReport.value = inferFlowByRules(result.model)
    confirmations.value = []
    baseline.value = baselineOf(result.model)
    pristine = structuredClone(result.model)
    model.value = result.model
    fileName.value = name
    openedSources.value = [loadingPath]
    mergeReport.value = null
    selectedId.value = null
    selectedSpaceId.value = null
    editNotice.value = ''
    storeyMoved.value = new Set()
    positionDrafts.value = new Map()
    history.value = []
    future.value = []
    // 새 파일을 열면 이전 파일의 편집 이력은 뜻이 없다.
    changes.value = []
    areaChanges.value = []
    await nextTick()
    await paint()
  } catch (e) {
    // 실패한 채로 이전 모델을 남겨 두면 화면이 방금 연 파일을 보여 주는 것처럼 보인다.
    model.value = null
    baseline.value = null
    meshes = new Map()
    meshBase = new Map()
    fileName.value = ''
    mergeReport.value = null
    const detail = e instanceof Error ? e.message : String(e)
    // 워커 안쪽의 자바스크립트 오류 문구("Cannot read properties of undefined")는 사람에게 뜻이 없다. 무엇이 일어났는지
    // 먼저 말하고 원문은 괄호에 남긴다(버그 보고에 쓴다).
    const internal = /Cannot read properties|is not a function|is not iterable|undefined|null/.test(detail)
    error.value = internal
      ? `${isIdf(name) ? 'IDF' : 'IFC'}를 읽다가 멈췄습니다. 파일 구조가 깨졌거나 에디터가 모르는 형태입니다(원문: ${detail}).`
      : `${isIdf(name) ? 'IDF' : 'IFC'}를 읽지 못했습니다: ${detail}`
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

// **편집한 뒤에도 덧붙인다.** 예전에는 막았다 — 합치기는 모델을 새로 만드는 일이라, 편집한 모델을 그대로 합치면 값은
// TTL 에 나가는데 "바뀐 것 0건" 이 되고 편집 파일·자동 저장·되돌리기에서 빠졌다(Q-1). 이제는 편집을 편집 파일로 떠서,
// **연 때의 모델(pristine)** 을 합친 뒤 그 파일을 다시 얹는다. 편집 파일 불러오기와 같은 길이라 소속·규칙 방향을 합친
// 모델에서 다시 판정하고, 못 찾은 것(합치며 걷어 낸 중복 방 등)은 센다. 되돌리기 이력만 합치기 전에서 끊긴다.
const canAppend = computed(() => !!model.value)
/** 연 때(또는 마지막으로 합친 때)의 모델. 편집한 뒤 덧붙일 때 이것을 합치고 편집을 다시 얹는다. */
let pristine: Model | null = null

/** 3D 형상을 연 때(pristine) 자리로 되돌린다. 덧붙이기 전과 편집 버리기가 쓴다. */
function meshesToOpened() {
  if (!pristine || !model.value) return
  const opened = new Map(pristine.storeys.flatMap((st) => st.equipment).map((e) => [e.id, e.position]))
  for (const e of model.value.storeys.flatMap((st) => st.equipment)) {
    // 늘인 구간은 늘이기 전 형상으로 되돌리고 거기서 연 때 자리로 옮긴다.
    const base = meshBase.get(e.id)
    const mesh = meshes.get(e.id)
    if (base && mesh) {
      meshes.set(e.id, { ...mesh, positions: base.positions })
      shiftMesh(e.id, base.at, opened.get(e.id) ?? null)
    } else shiftMesh(e.id, e.position, opened.get(e.id) ?? null)
  }
  meshBase = new Map()
}

async function append(name: string, read: () => Promise<ArrayBuffer>) {
  if (!model.value) return
  busy.value = true
  error.value = ''
  beginProgress('파일 읽는 중')
  // 편집이 있으면 떠 두고, 3D 형상도 연 때 자리로 되돌린다. 합친 뒤 편집을 다시 얹으면서 형상도 다시 옮긴다.
  const edits = hasEdits.value && baseline.value && pristine ? exportEdits(model.value, baseline.value, fileName.value) : null
  const unedited = () => (edits ? structuredClone(pristine!) : model.value!)
  const restoreMeshes = () => {
    if (edits) meshesToOpened()
  }
  const replay = () => {
    if (!edits) return
    const n = changeCount.value
    changes.value = []
    areaChanges.value = []
    confirmations.value = []
    storeyMoved.value = new Set()
    applyEditFile(edits, '덧붙이기 전에 한 편집')
    note(`덧붙이기 전에 한 편집 ${n}건을 합친 모델에 다시 얹었습니다. 되돌리기 이력은 여기서 끊깁니다`)
  }
  try {
    if (isIdf(name)) {
      // IDF 는 모델에 공조존과 담당 관계를 얹는다(idf/attach.ts). 방·설비는 그대로다.
      idfSource = { name, idf: readIdf(new TextDecoder().decode(await read())) }
      const done = attachIdf(unedited(), idfSource.idf, name)
      restoreMeshes()
      idfReport.value = done.report
      ruleReport.value = inferFlowByRules(done.model)
      baseline.value = baselineOf(done.model)
      pristine = structuredClone(done.model)
      model.value = done.model
      fileName.value = `${fileName.value} + ${name}`
      openedSources.value = [...openedSources.value, loadingPath]
      showZones.value = true
      history.value = []
      future.value = []
      // 파일 이름이 바뀌면 편집 파일 알림을 지우는 감시가 돈다. 그 뒤에 얹어야 다시 얹었다는 알림이 남는다.
      await nextTick()
      replay()
      await paint()
      return
    }
    const next = await importInWorker(await read())
    progress.value = { label: '합치는 중' }
    await paint()
    const current = { name: fileName.value, model: unedited() }
    const incoming = { name, model: next.model }
    // 어느 파일을 먼저 열었는지와 무관하게 방을 더 많이 그린 쪽이 기준이다. 설비 파일을 먼저
    // 열고 건축 파일을 덧붙여도 결과가 같아야 한다.
    const [base, overlay] =
      drawnSpaces(incoming.model) > drawnSpaces(current.model) ? [incoming, current] : [current, incoming]
    const merged = mergeModels(base.model, overlay.model, { base: base.name, overlay: overlay.name })
    // 공조존은 층·방에 이어 둔 것이라, 합쳐서 층·방이 바뀌면 IDF 를 다시 얹는다(합치기는 공조존을 모른다).
    if (idfSource) {
      const again = attachIdf({ ...merged.model, hvac: undefined, storeys: merged.model.storeys.filter((s) => !s.id.startsWith('IDF_storey_')) }, idfSource.idf, idfSource.name)
      merged.model = again.model
      idfReport.value = again.report
    }

    progress.value = { label: '3D 그리는 중' }
    await paint()
    restoreMeshes()
    meshes = new Map([...meshes, ...next.meshes])
    ruleReport.value = inferFlowByRules(merged.model)
    baseline.value = baselineOf(merged.model)
    pristine = structuredClone(merged.model)
    model.value = merged.model
    mergeReport.value = merged.report
    fileName.value = `${base.name} + ${overlay.name}`
    openedSources.value = [...openedSources.value, loadingPath]
    selectedId.value = null
    selectedSpaceId.value = null
    positionDrafts.value = new Map()
    // 합치면 모델을 새로 만든다. 예전 모델을 가리키는 스냅숏은 뜻이 없다.
    history.value = []
    future.value = []
    selectedSystemId.value = null
    await nextTick()
    replay()
    await paint()
  } catch (e) {
    // 덧붙이기가 실패하면 열려 있던 모델은 그대로 둔다. 실패한 파일만 알린다.
    error.value = `덧붙이지 못했습니다(${name}): ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
    endProgress()
  }
}

function onAppendPick(event: Event) {
  const input = event.target as HTMLInputElement
  void openMany(sourcesOf(input.files), 'append')
  // 같은 파일을 다시 고를 수 있게 비운다.
  input.value = ''
}

/**
 * 한쪽만 연 파일에 모자란 반쪽. 설비만 있으면 방이 없어 소속(F11)이 안 나오고, 방만 있으면 설비가 없다. 요약 칸에서 바로
 * 덧붙이게 한다 — 도구막대의 [덧붙이기] 를 찾지 못했다.
 */
const pairHint = computed(() => {
  const c = counts.value
  if (!model.value || !c) return null
  const partner = partnerOf(openedDataPath.value)
  if (c.spaces === 0 && c.devices > 0) {
    return { text: '방이 없는 설비 파일입니다. 건축 IFC를 덧붙이면 설비가 어느 방에 있는지(소속)가 나옵니다.', button: '건축 IFC 덧붙이기', partner }
  }
  if (c.devices === 0 && c.spaces > 0) {
    return { text: '설비가 없는 건축 파일입니다. 설비 IFC를 덧붙이면 설비·계통·연결이 이 방들에 얹힙니다.', button: '설비 IFC 덧붙이기', partner }
  }
  // 건축 파일에도 감지기·조명·CCTV 가 들어 있다(성수 건축 1,439대). 기기만 보고 가르면 덕트·배관이 하나도 없는 건축 파일에
  // 덧붙이라는 말이 안 떴다 — 목록은 같은 파일에 짝을 권하는데.
  if (c.conduits === 0 && c.spaces > 0) {
    return { text: '덕트·배관이 없는 건축 파일입니다. 설비 IFC를 덧붙이면 계통과 연결이 이 방들에 얹힙니다.', button: '설비 IFC 덧붙이기', partner }
  }
  return null
})


async function fetchData(path: string) {
  const r = await fetch(`./__data/${path.split('/').map(encodeURIComponent).join('/')}`)
  if (!r.ok) throw new Error(`받지 못했습니다: data/${path} (HTTP ${r.status})`)
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
    `층 ${r.storeys.length}개를 맞췄습니다: 이름으로 ${byName}개` +
      (byElevation ? `, 높이로 ${byElevation}개` : '') +
      (added ? `, 새 층 ${added}개` : ''),
  ]
  if (r.alignment) lines.push(`좌표 겹침 ${Math.round(r.alignment.ratio * 100)}%: 덧붙인 설비 ${r.alignment.placed}대 중 ${r.alignment.inside}대가 건축 공간 안에 있습니다.`)
  const { dropped, kept, borrowed } = r.spaces
  const spaceParts = [
    dropped ? `건축 파일과 겹치는 물리존 ${dropped}개는 뺐습니다` : '',
    kept ? `건축 파일에 없는 물리존 ${kept}개는 넣었습니다` : '',
    borrowed ? `외곽선이 없는 물리존 ${borrowed}개는 설비 파일의 외곽선을 썼습니다` : '',
  ].filter(Boolean)
  if (spaceParts.length) lines.push(spaceParts.join(', ') + '.')
  lines.push(`소속 방이 없는 설비: ${r.unlocated.before}대 → ${r.unlocated.after}대`)
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
  const what = [devices ? `기기 ${devices}대` : '', conduits ? `덕트·배관 ${conduits}대` : ''].filter(Boolean).join(', ')
  return `${what}${josa(what, '은/는')} 소속 물리존을 찾지 못했습니다. 위치는 층까지만 내보냅니다.`
})

// 열린 모델의 등급 칩. 파일 목록의 칩과 같은 계산이라, 덧붙인 뒤 어느 칸이 찼는지 견줄 수 있다.
//
// 모델 전체를 다시 재므로 병원 MEP(1만 3천 개)에서 한 번에 0.14초가 든다. 편집마다 재면 방향키를 누를 때마다
// 그만큼 막힌다. 새 모델은 바로 재고, 편집은 멈춘 뒤(TIERS_DELAY) 한 번 잰다.
const currentTiers = shallowRef<Profile['tiers']>([])
// 요구사항 보고서(정본 4장). 등급 칩과 같은 때에 잰다 — 둘 다 모델 전체를 훑는다.
const currentRequirements = shallowRef<RequirementRow[]>([])
const TIERS_DELAY = 400
let tiersTimer: number | undefined
let tieredModel: Model | null = null
watch([model, flowVersion, versionStat], () => {
  window.clearTimeout(tiersTimer)
  const m = model.value
  if (!m) {
    currentTiers.value = []
    currentRequirements.value = []
    tieredModel = null
    return
  }
  const measure = () => {
    currentTiers.value = profileOf(m).tiers
    currentRequirements.value = requirementsReport(m, mergeReport.value, versionStat.value)
  }
  if (m !== tieredModel) {
    tieredModel = m
    // 새 모델도 한 태스크 뒤로 미룬다. 여는 태스크에 합치기·3D 준비가 몰려 있어서 여기까지 붙이면 화면이 1초 넘게 멈췄다.
    tiersTimer = window.setTimeout(measure, 0)
  } else {
    tiersTimer = window.setTimeout(measure, TIERS_DELAY)
  }
}, { immediate: true })

const warnings = computed(() => [...(model.value?.warnings ?? []), ...(unlocatedLine.value ? [unlocatedLine.value] : [])])

// 미배치 목록(OE-BIM-07). BIM 에 좌표가 없어 3D·평면에 그려지지 않는 설비. 임포트 경고는 연 때의 수만 말하고, 이 목록은
// 놓을 때마다 줄어든다. 설비 표의 빈 좌표 칸으로는 수천 행 사이에서 찾을 수 없었고, 완전성 검사는 방이 없는 파일에서
// 건너뛴다(ifc4Mep 28대). 많으면 앞의 UNPLACED_SHOWN 대만 그린다.
const unplaced = computed(() => (model.value ? unplacedOf(model.value) : []))
/** 팔레트의 미배치 목록. 한 층만 보는 중이면 그 층 것만. */
const unplacedHere = computed(() => unplaced.value.filter((u) => !viewStorey.value || u.storey.id === viewStorey.value))
const unplacedOpen = ref(false)
const UNPLACED_SHOWN = 200
/** 목록에서 바로 놓는다. 편집 모드로 들어가 고르고, 다른 층만 보고 있었다면 설비의 층으로 바꾼 뒤 바닥을 누르게 한다. */
function placeFromList(id: string) {
  if (!editing.value) mode.value = 'edit'
  selectAndShow(id)
  const home = storeyOf(id)
  // 놓을 층의 바닥이 보이게 그 층만 본다([설비 더하기] 와 같다). 모든 층을 보던 중이어도 바꾼다.
  if (home && (model.value?.storeys.length ?? 0) > 1 && viewStorey.value !== home.id) viewStorey.value = home.id
  startPlace(id)
}

const REQUIREMENT_STATE: Record<RequirementState, string> = {
  standard: '표준 자리',
  elsewhere: '다른 자리',
  partial: '일부',
  missing: '없음',
  none: '해당 없음',
  unmeasured: '잴 수 없음',
}
// 접힌 칸의 제목 옆에 붙는 한 줄. 고객사에 할 말이 셋으로 갈린다 — 할 말 없음, 설정을 바꿔 달라, 값을 넣어 달라.
// 파일 하나로 잴 수 없는 것(R12·R13)을 분모에 넣으면 필수가 반쯤 빠진 것처럼 읽힌다. 잰 것만 센다.
const requirementGroups = computed(() =>
  (['필수', '권장'] as const).map((level) => ({ level, rows: currentRequirements.value.filter((r) => r.level === level) })),
)
const requirementsMeta = computed(() => {
  const count = (list: RequirementRow[], states: RequirementState[]) => list.filter((r) => states.includes(r.state)).length
  return requirementGroups.value
    .map(({ level, rows }) => {
      const parts = [
        [`표준 ${count(rows, ['standard'])}`],
        count(rows, ['elsewhere']) ? [`다른 자리 ${count(rows, ['elsewhere'])}`] : [],
        count(rows, ['missing', 'partial']) ? [`없음·일부 ${count(rows, ['missing', 'partial'])}`] : [],
      ].flat()
      return `${level} ${rows.length}개: ${parts.join(' · ')}`
    })
    .join(' / ')
})

// --- 여러 파일 한 번에 ---------------------------------------------------------------
//
// 실제 프로젝트는 건축·설비가 다른 IFC 다. 예전에는 하나를 열고 도구막대의 [덧붙이기] 를 찾아 다른 하나를 골라야 했고,
// 둘을 같이 끌어다 놓으면 첫 파일만 열리고 나머지는 **조용히** 버려졌다. 이제 같이 고르거나 같이 놓으면 하나를 열고
// 나머지를 덧붙인다. 어느 것을 먼저 열든 방을 더 그린 쪽이 기준이라(append) 순서는 결과를 바꾸지 않는다. IDF 는 층·방이
// 다 선 뒤에 얹어야 방을 찾으므로 IFC 뒤로 보낸다.
/** `dataPath` 는 data/ 목록에서 연 파일의 경로다. 손으로 고른 파일은 없다 — 8084 에 저장할 수 없다(saved-edits.ts). */
type FileSource = { name: string; read: () => Promise<ArrayBuffer>; dataPath?: string }
async function openMany(files: readonly FileSource[], into: 'open' | 'append') {
  const ordered = [...files.filter((f) => !isIdf(f.name)), ...files.filter((f) => isIdf(f.name))]
  if (!ordered.length) return
  let rest = ordered
  const mark = (f: FileSource) => {
    if (ordered.length > 1) batch.value = { index: ordered.indexOf(f) + 1, total: ordered.length, name: f.name }
  }
  try {
    if (into === 'open' || !model.value) {
      mark(ordered[0])
      loadingPath = ordered[0].dataPath ?? null
      await load(ordered[0].name, ordered[0].read)
      // 편집이 남아 열기를 물리쳤거나 읽지 못했으면 멈춘다.
      if (!model.value || fileName.value !== ordered[0].name || error.value) return
      rest = ordered.slice(1)
      // 작업 화면은 맨 위(3D)부터 보인다. data/ 목록 아래쪽의 [열기] 를 누르면 그 스크롤 자리 그대로 열려, 3D 가 화면 위로
      // 밀려나고 요약·검사 표부터 보였다.
      window.scrollTo({ top: 0 })
    }
    for (const f of rest) {
      mark(f)
      loadingPath = f.dataPath ?? null
      await append(f.name, f.read)
      if (error.value) return
    }
    // data/ 에서 열었으면 8084 에 저장된 편집을 얹는다. 덧붙이기만 했을 때는 얹지 않는다 — 이미 고친 것 위에 다른 판의 편집이 겹친다.
    if (into === 'open' && serverKey.value) await loadServerEdits()
  } finally {
    batch.value = null
    settleOpen()
  }
}
const sourcesOf = (list: FileList | null | undefined): FileSource[] =>
  Array.from(list ?? [], (file) => ({ name: file.name, read: () => file.arrayBuffer() }))

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  const files = sourcesOf(input.files)
  openedDataPath.value = null
  void openMany(files, 'open')
  // 같은 파일을 다시 고를 수 있게 비운다. 편집이 남아 열기를 물리친 뒤 같은 파일을 다시 고르면 change 가 안 온다.
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  openedDataPath.value = null
  void openMany(sourcesOf(event.dataTransfer?.files), 'open')
}

/** [덧붙이기] 에 끌어다 놓기. [열기] 에 놓으면 열려 있던 것을 바꾸므로, 합치려면 여기에 놓는다. */
function onAppendDrop(event: DragEvent) {
  appendOver.value = false
  if (canAppend.value) void openMany(sourcesOf(event.dataTransfer?.files), 'append')
}
const appendOver = ref(false)

/** `data` 가 배열이면 조각을 이어 붙인다 — 한 덩어리로 만들면 한도를 넘는 큰 파일(성수 OBJ 683MB)용이다. */
function download(name: string, data: string | ArrayBuffer | ArrayBuffer[], mime: string) {
  const url = URL.createObjectURL(new Blob(Array.isArray(data) ? data : [data], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // 클릭 직후에 풀면 브라우저에 따라 받기가 시작되기 전에 끊긴다(큰 파일일수록). 받기가 시작될 틈을 둔다.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 폴더를 골라 파일 여럿을 한 번에 쓰는 브라우저 기능(크롬·엣지). 없으면 undefined. */
type DirectoryPicker = (options: { mode: 'readwrite' }) => Promise<{
  getFileHandle(name: string, options: { create: true }): Promise<{ createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }> }>
}>

/**
 * GeoJSON 은 층마다 한 파일이다(성수 19개). 연달아 내려받으면 크롬이 "여러 파일 다운로드"를 묻고, 거절하거나 창을
 * 놓치면 둘째 파일부터 **조용히** 빠진다. 폴더를 고를 수 있으면 한 폴더에 한꺼번에 쓰고, 못 하면 내려받는다.
 */
// 내보내기·저장이 끝나면 누른 단추에 잠깐 ✓ 를 띄운다. 받기 표시는 브라우저 구석에 떠서, 눌렀는데 된 건지 단추에서는 알 수 없었다.
const justDone = ref('')
let doneTimer = 0
function markDone(key: string) {
  justDone.value = ''
  window.clearTimeout(doneTimer)
  // 같은 단추를 잇달아 누르면 한 번 비웠다가 다시 붙여 애니메이션을 처음부터 튼다.
  void nextTick(() => (justDone.value = key))
  doneTimer = window.setTimeout(() => (justDone.value = ''), 1800)
}

/** 다 냈으면 true. 사람이 폴더 고르기를 닫았으면 false. */
async function exportGeoJSON(): Promise<boolean> {
  if (!model.value) return false
  const files = modelToGeoJSON(model.value).map((f) => ({ name: f.fileName, text: JSON.stringify(f.collection, null, 2) }))
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  if (files.length > 1 && picker) {
    try {
      const dir = await picker({ mode: 'readwrite' })
      for (const f of files) {
        const writable = await (await dir.getFileHandle(f.name, { create: true })).createWritable()
        await writable.write(f.text)
        await writable.close()
      }
      note(`GeoJSON ${files.length}개(층마다 하나)를 저장했습니다.`)
      return true
    } catch (e) {
      // 사람이 폴더 고르기를 닫은 것이면 아무것도 하지 않는다. 권한이 막힌 것이면 내려받기로 넘어간다.
      if ((e as DOMException)?.name === 'AbortError') return false
    }
  }
  // 크롬은 잇달아 누른 내려받기를 10개에서 끊는다(성수 19개 층 중 9개가 조용히 빠졌다). 하나씩 틈을 둔다.
  for (const [i, f] of files.entries()) {
    if (i) await new Promise((r) => window.setTimeout(r, 250))
    download(f.name, f.text, 'application/geo+json')
  }
  return true
}
async function exportGeoJSONDone() {
  if (await exportGeoJSON()) markDone('geojson')
}

/** 바뀐 내용 목록으로 내려간다. 작업 화면 아래에 있어 도구막대에서 바로 가는 길을 둔다. */
function previewChanges() {
  document.getElementById('changes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 초기 구축의 마지막 단계. 기하와 의미를 따로 내는 전제는 그대로다 — 한 번 눌러 두 파일을 다 받을 뿐이다. */
async function build() {
  exportTTL()
  if (await exportGeoJSON()) {
    // 구축하기가 PoC 의 "저장"이다(PRD 의 저장 = 반영, D10). 온톨로지로 낸 편집은 끝낼 때 다시 묻지 않고, 임시 저장본도 지운다.
    committed()
    markDone('build')
  }
}

// --- 층 단위 진행 (OE-MAN-06) -------------------------------------------------------------
//
// 층마다 완료를 표시하고 몇 층이 끝났는지 보인다(ADR-0011). 완료는 그때 층의 지문과 지금 지문을 견줘 정한다(storey-progress.ts) —
// 완료한 층을 고치면 "완료 뒤 고침" 으로 저절로 풀리고, Ctrl+Z 로 그 층이 완료한 때와 같아지면 다시 완료다. 표시는 편집 파일에
// 남는다(되돌리기 이력에는 들지 않는다 — 고친 것이 아니라 진행 표시다).
// 완료한 층의 지문을 재는 값이 병원 건축+HVAC 네 층에 45ms 다. 편집(방향키 한 번)마다 바로 재면 편집이 그만큼 느려진다.
// 편집이 멈춘 뒤 한 번 잰다. 완료를 누르거나 지울 때는 바로 잰다.
const storeyProgressRows = shallowRef<StoreyProgress[]>([])
let progressTimer: number | undefined
function refreshProgress() {
  window.clearTimeout(progressTimer)
  storeyProgressRows.value = model.value ? storeyProgress(model.value) : []
}
watch(
  model,
  () => {
    window.clearTimeout(progressTimer)
    progressTimer = window.setTimeout(refreshProgress, 200)
  },
  { immediate: true },
)
const progressById = computed(() => new Map(storeyProgressRows.value.map((p) => [p.id, p])))
const storeysDoneCount = computed(() => storeyProgressRows.value.filter((p) => p.state === 'done').length)
function setStoreyDone(storeyId: string, on: boolean) {
  const m = model.value
  if (!m) return
  const name = m.storeys.find((s) => s.id === storeyId)?.name ?? ''
  if (!(on ? markStoreyDone(m, storeyId) : clearStoreyDone(m, storeyId))) return
  progressVersion.value++
  autosaveArmed = true
  refreshProgress()
  triggerRef(model)
  note(on ? `${name} 층을 완료로 표시했습니다(${storeysDoneCount.value}/${m.storeys.length}층).` : `${name} 층의 완료 표시를 지웠습니다.`)
}
// 완료한 층을 고치면 알린다. 표에서도 보이지만 표는 접혀 있을 수 있다.
watch(storeyProgressRows, (now, before) => {
  const was = new Map((before ?? []).map((p) => [p.id, p.state]))
  const reopened = now.filter((p) => p.state === 'changed' && was.get(p.id) === 'done')
  if (reopened.length) note(`${reopened.map((p) => p.name).join(', ')} 층을 완료한 뒤 고쳤습니다 — 완료가 풀렸습니다. 다시 구축하고 완료를 표시하세요.`)
})
const doneTime = (at?: string) => (at ? new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * 층 하나만 구축한다(OE-GEN-11). 그 층의 TTL·GeoJSON 한 쌍을 받는다(storey-export.ts). 층 파일을 다 모으면 건물 전체와 같은
 * 트리플이다(ADR-0011). 건물 전체 [구축하기] 와 달리 저장으로 치지 않는다 — 다른 층의 편집은 아직 안 나갔다.
 */
async function buildStorey(storeyId: string) {
  const m = model.value
  const files = m ? storeyFiles(m, storeyId) : null
  if (!m || !files) return
  download(files.ttlName, files.ttl, 'text/turtle')
  // 잇달아 받으면 크롬이 둘째를 막을 수 있다(exportGeoJSON 주석). 틈을 둔다.
  await new Promise((r) => window.setTimeout(r, 250))
  download(files.geojsonName, files.geojson, 'application/geo+json')
  const name = m.storeys.find((s) => s.id === storeyId)?.name ?? ''
  note(`${name} 층을 구축했습니다: ${files.ttlName} · ${files.geojsonName}. 다른 층을 가리키는 줄은 id 로 남습니다.`)
  markDone(`build:${storeyId}`)
}

function exportTTL() {
  if (!model.value) return
  download('ontology.ttl', modelToTTL(model.value), 'text/turtle')
}
function exportTTLDone() {
  exportTTL()
  markDone('ttl')
}

/**
 * 3D 형상(GLB·OBJ). 보여 주기용 파일이라 GeoJSON·TTL 과 따로 낸다. 큰 파일은 몇 초(성수 OBJ 16초) 걸려 누르는 동안
 * 버튼을 막고, 여는 때와 같은 진행 막대에 단계를 보인다. OBJ 는 꼭짓점 수로 막대가 차고, GLB 는 흐르기만 한다.
 */
const exporting3d = ref<'glb' | 'obj' | null>(null)
async function export3D(format: 'glb' | 'obj') {
  if (!model.value || exporting3d.value || progress.value) return
  exporting3d.value = format
  beginProgress('형상 넘기는 중')
  // 형상을 워커로 복사하는 동안 화면이 잠깐 멈춘다. 막대가 먼저 보이게 한 번 그린다.
  await paint()
  // 합쳐 연 파일은 이름이 "건축.ifc + 기계.ifc" 다. 확장자를 떼고 + 로 잇는다.
  const stem = fileName.value.split(' + ').map((n) => n.replace(/\.[^.]+$/, '')).join('+') || 'model'
  // 워커에서 만든다(lib/export/mesh3d.worker.ts). 화면 스레드로 만들면 성수에서 3~4초씩 멈췄다.
  // 한 번 쓰고 닫는다 — 워커가 든 장면(수백 MB)이 남지 않게.
  const worker = new Worker(new URL('./lib/export/mesh3d.worker.ts', import.meta.url), { type: 'module' })
  try {
    const parts = await new Promise<ArrayBuffer[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<Mesh3dReply>) => {
        const d = e.data
        if (d.type === 'progress') progress.value = { label: d.stage, step: d.step, steps: d.steps, done: d.done, total: d.total, unit: 'items' }
        else if (d.type === 'done') resolve(d.parts)
        else reject(new Error(d.message))
      }
      worker.onerror = (e) => reject(new Error(e.message || '워커가 멈췄습니다'))
      const request: Mesh3dRequest = { format, model: model.value!, pristine, meshes: [...meshes] }
      worker.postMessage(request)
    })
    const name = `${stem}.${format}`
    download(name, parts, format === 'glb' ? 'model/gltf-binary' : 'model/obj')
    // 막대가 닫히면 끝났는지 알 길이 브라우저 받기 표시뿐이다. 이름과 크기를 남긴다(성수 OBJ 는 683MB 다).
    note(`${name} (${mb(parts.reduce((s, p) => s + p.byteLength, 0))}) 내려받기를 시작했습니다`)
    markDone(format)
  } catch (e) {
    note(`3D 내보내기에 실패했습니다: ${(e as Error).message}`)
  } finally {
    worker.terminate()
    exporting3d.value = null
    endProgress()
  }
}
</script>

<template>
  <main :class="model ? ['has-model', `mode-${mode}`] : ''">
    <header v-if="!model">
      <div class="title">
        <div>
          <h1>ontology-editor</h1>
          <p class="sub">BIM(IFC)을 읽어 공간 온톨로지 초안을 만듭니다. 내보낸 TTL·GeoJSON 은 <a href="./viewer.html">내보낸 파일 보기</a>에서 다시 열어 봅니다.</p>
        </div>
        <button type="button" class="theme" :aria-pressed="dark" @click="toggleTheme">
          {{ dark ? '라이트' : '다크' }}
        </button>
      </div>
    </header>

    <section
      v-if="!model"
      class="drop"
      :class="{ over: dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p v-if="busy">읽는 중…</p>
      <template v-else>
        <p>IFC 파일을 여기에 끌어다 놓으세요.</p>
        <p class="muted drop-multi">건축과 설비가 다른 파일이면 <b>둘을 같이</b> 놓거나 고르세요(Ctrl·Shift 로 여러 개). 하나로 합쳐 엽니다. IDF 도 같이 고르면 공조존까지 얹습니다.</p>
      </template>
      <label class="pick">
        파일 선택
        <input type="file" accept=".ifc,.idf" multiple :disabled="busy" @change="onPick" />
      </label>
      <!-- 피처 단위로 읽을 것. 물리존·설비는 늘 읽는다. 다음에 여는 파일부터 적용된다. -->
      <fieldset class="read-option features" :disabled="busy">
        <legend>읽을 것</legend>
        <label><input v-model="readFeatures.walls" type="checkbox" /> 벽</label>
        <label><input v-model="readFeatures.doors" type="checkbox" /> 문</label>
        <label><input v-model="readFeatures.windows" type="checkbox" /> 창</label>
        <label :class="{ off: !readFeatures.doors && !readFeatures.windows }">
          <input v-model="readOpenings" type="checkbox" :disabled="!readFeatures.doors && !readFeatures.windows" /> 문·창 자리(형상)
        </label>
        <span class="muted">
          물리존·설비는 늘 읽습니다. 벽·문·창은 GeoJSON에만 나가고 온톨로지(TTL)에는 필요 없어서, 끄면 큰 파일이 빨리
          열립니다. 문·창 자리는 로봇 경로와 문·창 옮기기에 씁니다.
        </span>
      </fieldset>

    </section>

    <!-- 합쳐 연 판의 8084 저장본. 한 파일의 저장본은 아래 data/ 목록의 그 줄에 보인다. 임시 저장본은 목록을 두지 않는다 —
         층마다 하나라 그 층에 들어가면 바로 얹힌다(OE-COM-08 · OE-WF-03). -->
    <section v-if="savedSets.some((s) => s.paths.length > 1)" class="catalog resume">
      <Fold :key="model ? 'loaded' : 'empty'" title="8084 에 저장한 편집" :meta="`${savedSets.filter((s) => s.paths.length > 1).length}건`" :default-open="!model">
        <table>
          <tbody>
            <tr v-for="sv in savedSets.filter((s) => s.paths.length > 1)" :key="'saved:' + sv.key" class="saved-row">
              <td class="name">
                <span>{{ sv.paths.map(baseName).join(' + ') }}</span>
                <span class="muted">8084 저장 · 편집 {{ sv.count }}건 · {{ when(sv.savedAt) }}</span>
              </td>
              <td class="row-actions">
                <button type="button" class="ghost" :disabled="busy" @click="openDataSet(sv.paths)">합쳐서 열기</button>
              </td>
            </tr>
          </tbody>
        </table>
      </Fold>
    </section>

    <!-- data/ 의 샘플. 파일마다 온톨로지를 어디까지 채우는지 먼저 보고 고른다. -->
    <section v-if="dataFiles.length" class="catalog">
      <!-- 파일을 연 뒤에는 접어 둔다. 목록이 3D 와 검토 화면을 아래로 밀어낸다. 덧붙일 때 다시 편다. -->
      <Fold :key="model ? 'loaded' : 'empty'" title="data/ 의 IFC" :meta="`${dataFiles.length}개`" :default-open="!model">
        <p v-if="dataPicked.length" class="catalog-pick">
          <button type="button" class="pick" :disabled="busy" @click="openDataSet(dataPicked)">
            고른 {{ dataPicked.length }}개 {{ dataPicked.length > 1 ? '합쳐서 열기' : '열기' }}
          </button>
          <span class="muted">{{ dataPicked.map(baseName).join(' + ') }}</span>
          <button type="button" class="link" @click="dataPicked = []">고르기 취소</button>
        </p>
        <p class="hint">
          건축·설비를 같이 쓰려면 왼쪽 칸에 둘 다 표시하고 [합쳐서 열기]를 누르세요.
          칸마다 얼마나 채워졌는지 보입니다. 공간(외곽선이 있는 물리존) · 설비(좌표가 있는 기기) · 소속(방을 찾은 기기) ·
          연결망(연결 수) · 방향(흐름 방향을 아는 기기 비율). 마우스를 올리면 자세히 보입니다.
        </p>
        <table>
          <tbody>
            <tr v-for="f in dataFiles" :key="f.path" :class="{ picked: dataPicked.includes(f.path) }">
              <td class="pick-cell">
                <input type="checkbox" :checked="dataPicked.includes(f.path)" :aria-label="`${f.path} 같이 열기`" @change="toggleDataPick(f.path)" />
              </td>
              <td class="name">
                <span>{{ f.path }}</span>
                <span class="muted">{{ mb(f.size) }}<template v-if="profileAt(f.path)"> · {{ profileAt(f.path)!.schema }}</template></span>
              </td>
              <td class="chips">
                <span v-if="!profiles[f.path]" class="muted">재는 중…</span>
                <span v-else-if="errorAt(f.path)" class="unreadable" :title="errorAt(f.path)">열 수 없음</span>
                <!-- 모양이 다른 응답(옛 서버 등)이 오면 칩 없이 둔다. `!` 로 밀어붙였더니 목록 렌더가 멈춰 그 뒤 화면 갱신이 꼬였다. -->
                <template v-else-if="profileAt(f.path)">
                  <TierChips :tiers="profileAt(f.path)!.tiers" />
                  <span v-if="roleHint(profileAt(f.path)!)" class="muted role">{{ roleHint(profileAt(f.path)!) }}</span>
                  <button
                    v-if="!model && partnerOf(f.path)"
                    type="button"
                    class="link pair"
                    :disabled="busy"
                    :title="`${f.path} + ${partnerOf(f.path)}`"
                    @click="openDataSet([f.path, partnerOf(f.path)!])"
                  >
                    짝 {{ baseName(partnerOf(f.path)!) }}{{ josa(baseName(partnerOf(f.path)!), '과/와') }} 합쳐서 열기
                  </button>
                </template>
              </td>
              <td class="row-actions">
                <span v-if="savedFor(f.path)" class="saved-chip" :title="`8084 에 저장된 편집 ${savedFor(f.path)!.count}건 — 열면 얹어서 보입니다`">
                  저장 {{ savedFor(f.path)!.count }}건 · {{ when(savedFor(f.path)!.savedAt) }}
                </span>
                <button type="button" class="ghost" :disabled="busy" @click="openData(f.path)">열기</button>
                <button v-if="canAppend" type="button" class="ghost" :disabled="busy" @click="appendData(f.path)">덧붙이기</button>
              </td>
            </tr>
          </tbody>
        </table>
      </Fold>
    </section>

    <p v-if="error" ref="errorEl" class="error" role="alert">{{ error }}</p>

    <template v-if="model && counts">
      <!-- 파일을 연 뒤의 도구막대. 스크롤과 상관없이 위에 붙는다. 파일·모드·내보내기가 여기 모이고, 편집 중에는 한 줄이
           더 붙어 바뀐 것의 수와 되돌리기가 따라온다. 온종일 3D 를 보며 고치는 화면이라 큰 머리말과 파일 받는 칸은 접는다. -->
      <div ref="appbar" class="appbar">
        <div class="appbar-row">
          <div class="file">
            <h2 :title="fileName">{{ fileName }}</h2>
            <span class="muted">{{ model.schema }} · {{ model.buildingName || '(건물 이름 없음)' }}</span>
          </div>
          <div class="bar-actions">
            <label
              class="ghost drop compact"
              :class="{ over: dragging }"
              title="다른 IFC 열기 (여기에 끌어다 놓아도 됩니다)"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
            >
              열기
              <input type="file" accept=".ifc,.idf" multiple :disabled="busy" @change="onPick" />
            </label>
            <!-- 다음에 열 파일에서 읽을 피처. 첫 화면의 "읽을 것" 과 같은 값이다. -->
            <details class="read-menu">
              <summary title="다음에 여는 파일에서 읽을 것">읽을 것</summary>
              <fieldset class="read-option features" :disabled="busy">
                <label><input v-model="readFeatures.walls" type="checkbox" /> 벽</label>
                <label><input v-model="readFeatures.doors" type="checkbox" /> 문</label>
                <label><input v-model="readFeatures.windows" type="checkbox" /> 창</label>
                <label :class="{ off: !readFeatures.doors && !readFeatures.windows }">
                  <input v-model="readOpenings" type="checkbox" :disabled="!readFeatures.doors && !readFeatures.windows" /> 문·창 자리(형상)
                </label>
                <span class="muted">다음에 여는 파일부터 적용됩니다.</span>
              </fieldset>
            </details>
            <!-- 건축과 설비가 다른 파일일 때. 편집을 시작한 뒤에는 닫는다(canAppend 주석 참조). -->
            <label
              class="ghost append"
              :class="{ disabled: !canAppend, over: appendOver }"
              :aria-disabled="!canAppend"
              :title="
                hasEdits
                  ? '열린 파일에 합치기. 지금까지 한 편집은 합친 모델에 다시 얹습니다(되돌리기 이력은 끊깁니다). 여기에 끌어다 놓아도 됩니다'
                  : '열린 파일에 합치기 — 건축·설비 IFC(합쳐야 설비가 어느 방에 있는지 나옵니다) 또는 IDF(공조존). 여기에 끌어다 놓아도 됩니다'
              "
              @dragover.prevent="appendOver = canAppend"
              @dragleave.prevent="appendOver = false"
              @drop.prevent="onAppendDrop"
            >
              덧붙이기
              <input type="file" accept=".ifc,.idf" multiple :disabled="busy || !canAppend" @change="onAppendPick" />
            </label>
            <a v-if="warnings.length" href="#warnings" class="warn-count" title="읽으면서 건너뛴 것. 목록은 아래 요약에 있습니다.">경고 {{ warnings.length }}</a>
            <!-- 보기와 편집. 편집은 고치는 손잡이를 드러낼 뿐이고 편집한 결과는 모드를 바꿔도 남는다. -->
            <div class="mode-switch" role="group" aria-label="화면 모드">
              <button type="button" :aria-pressed="mode === 'view'" @click="leaveEdit()">보기</button>
              <button type="button" :aria-pressed="mode === 'edit'" :disabled="busy" @click="mode = 'edit'">편집</button>
            </div>
            <span class="bar-sep" aria-hidden="true"></span>
            <!-- 여는·합치는 중(busy)에는 막는다. 건축·설비를 같이 열 때 설비를 읽는 동안 누르면 건축만 든 파일이 나갔다. -->
            <button type="button" class="ghost" aria-label="기하 내보내기 (GeoJSON)" title="형상 내보내기 (층마다 GeoJSON 파일 하나)" :disabled="busy" :class="{ done: justDone === 'geojson' }" @click="exportGeoJSONDone">GeoJSON</button>
            <button type="button" class="ghost" aria-label="의미 내보내기 (Brick TTL)" title="관계 내보내기 (Brick TTL 파일 하나)" :disabled="busy" :class="{ done: justDone === 'ttl' }" @click="exportTTLDone">TTL</button>
            <button type="button" class="ghost" aria-label="3D 형상 내보내기 (GLB)" title="3D 형상 내보내기 (GLB 파일 하나, 요소 이름은 GlobalId)" :disabled="busy || !!exporting3d" :aria-busy="exporting3d === 'glb'" :class="{ done: justDone === 'glb' }" @click="export3D('glb')">{{ exporting3d === 'glb' ? '만드는 중…' : 'GLB' }}</button>
            <button type="button" class="ghost" aria-label="3D 형상 내보내기 (OBJ)" title="3D 형상 내보내기 (OBJ 파일 하나, 요소 이름은 GlobalId)" :disabled="busy || !!exporting3d" :aria-busy="exporting3d === 'obj'" :class="{ done: justDone === 'obj' }" @click="export3D('obj')">{{ exporting3d === 'obj' ? '만드는 중…' : 'OBJ' }}</button>
            <button type="button" class="ghost keys-help" title="단축키 안내 (?)" aria-label="단축키 안내" @click="helpOpen = true">?</button>
            <button type="button" class="ghost theme" :aria-pressed="dark" @click="toggleTheme">{{ dark ? '라이트' : '다크' }}</button>
          </div>
        </div>
        <!-- 편집 모드에서만. 좁은 폭에서는 마지막 편집 이름이 남는 폭을 쓰고 넘치면 자른다. 단축키는 title 과 ? 안내로. -->
        <!-- 자동 저장된 편집이 남아 있으면 연 직후에 묻는다. 새로 편집을 시작하면 그 편집이 기록을 대신한다. -->
        <div v-if="draft" class="draft-bar" role="status">
          <span>
            이 파일에서 저장하지 않은 편집 <b>{{ draft.count }}건</b>이 남아 있습니다({{ draftTime }}).
          </span>
          <button type="button" class="ghost on" @click="restoreDraft">이어서 하기</button>
          <button type="button" class="ghost" @click="discardDraft">버리기</button>
        </div>
        <div v-if="editing" class="edit-bar" role="status">
          <span class="state"><b>편집 중</b> · <a href="#changes" class="link">바뀐 것 <Roll :value="changeCount" :count-up="false" />건</a></span>
          <button
            type="button"
            class="ghost undo"
            :disabled="!history.length"
            :title="history.length ? `되돌리기 (Ctrl+Z): ${history.at(-1)!.label}` : '되돌릴 편집이 없습니다'"
            @click="undo"
          >
            ↶ 되돌리기
          </button>
          <button
            type="button"
            class="ghost redo"
            :disabled="!future.length"
            :title="future.length ? `다시 하기 (Ctrl+Shift+Z): ${future.at(-1)!.entry.label}` : '다시 할 편집이 없습니다'"
            @click="redo"
          >
            ↷ 다시
          </button>
          <span class="muted last-edit" :title="history.at(-1)?.label">{{ history.at(-1)?.label ?? '' }}</span>
          <button
            type="button"
            class="ghost save-edits"
            :class="{ done: justDone === 'save' }"
            :title="serverKey
              ? '편집 저장 (Ctrl+S). 8084 에 둡니다 — 이 파일을 여는 사람 모두 같은 편집을 봅니다.'
              : '편집 저장 (Ctrl+S). 손으로 연 파일이라 바뀐 내용을 JSON으로 내려받습니다. 같은 IFC를 다시 열고 불러오면 이어서 편집할 수 있습니다.'"
            @click="saveEdits()"
          >
            편집 저장
          </button>
          <button v-if="serverKey" type="button" class="ghost" title="8084 에 두지 않고 편집 파일(JSON)로만 내려받습니다" @click="saveEdits(true)">파일로</button>
          <button type="button" class="ghost" title="웹에 반영하지 않고 이 층의 편집을 이 브라우저에 남깁니다. 층마다 하나이고, 이 층에 다시 들어오면 이어서 편집합니다" @click="keepDraft()">임시 저장</button>
          <!-- PRD #9 의 액션바. 초기 구축 모드라 "반영하기" 대신 "구축하기"(두 파일 내보내기)다 — 운영 DT 에 반영하는 길은 D10 이 열려 있다. -->
          <button type="button" class="ghost" title="반영 전에 바뀐 내용(소속·경계·이름·방향)을 봅니다" @click="previewChanges">미리보기</button>
          <button type="button" class="ghost primary-action" :class="{ done: justDone === 'build' }" :disabled="busy" title="온톨로지 두 파일을 냅니다 — 기하(GeoJSON)와 관계(Brick TTL)" @click="build">구축하기</button>
          <button type="button" class="ghost" title="보기 모드로 돌아갑니다. 저장하지 않은 편집이 있으면 먼저 묻습니다" @click="leaveEdit()">편집 종료</button>
        </div>
      </div>

      <!-- 작업 화면: 3D 와 오른쪽 패널이 화면 높이를 나눠 쓴다. 3D 에서 누른 것이 스크롤 없이 바로 옆에 뜬다.
           전체 화면도 이 둘을 같이 띄운다. -->
      <div ref="stage" :class="['stage', 'workspace', { full: fullscreen }]">
        <HoverTip ref="hoverTip" />
        <section class="viewport">
          <div class="canvas-wrap">
            <canvas v-show="activeTab === '3d'" ref="canvas"></canvas>
            <!-- 평면도. 3D 와 탭으로 갈아 끼우고, 층 하나를 골랐을 때만 그린다. -->
            <FloorPlan
              v-if="activeTab === 'plan' && planStorey"
              :storey="planStorey"
              :selected-id="selectedId"
              :selected-space-id="selectedSpaceId"
              :selected-element-id="selectedElementId"
              :editing="editing"
              :pick-walls="editing && archMode"
              :group="group"
              @select="(id, additive) => (editing && additive ? toggleGroup(id) : select(id))"
              @select-box="addBoxToGroup"
              @pick-space="pickSpace"
              @pick-element="selectedElementId = $event"
              @move-vertex="dropVertex"
            />
            <p v-else-if="activeTab === 'plan'" class="plan-empty">
              평면도는 층 하나를 그립니다. 오른쪽 위에서 층을 고르세요.
            </p>
            <!-- 외곽선 그리기 중. 찍은 점 수와 마침·한 점 지우기·취소. -->
            <div v-if="drawing" class="draw-bar" role="status">
              <template v-if="drawing.purpose === 'split' || drawing.purpose === 'customSplit'">
                <b>{{ drawing.name }}</b> 나누기 · 나눌 선의 두 점을 바닥에 찍습니다 · {{ drawing.points.length }}/2
              </template>
              <template v-else-if="drawing.purpose === 'wall'">
                <b>{{ drawing.name }}</b> 긋기 · 벽의 두 끝점을 바닥에 찍습니다 · {{ drawing.points.length }}/2
              </template>
              <template v-else>
                <b>{{ drawing.name }}</b> {{ drawing.purpose === 'create' || drawing.purpose === 'custom' ? '그리기' : '외곽선 그리기' }} · 바닥을 눌러 꼭짓점을 찍습니다 ·
                {{ drawing.points.length }}개
              </template>
              <button v-if="drawing.purpose !== 'split' && drawing.purpose !== 'wall' && drawing.purpose !== 'customSplit'" type="button" class="ghost" :disabled="drawing.points.length < 3" @click="finishDraw">마침 <kbd>Enter</kbd></button>
              <button type="button" class="ghost" :disabled="!drawing.points.length" @click="undoDrawPoint">한 점 지우기</button>
              <button type="button" class="ghost" @click="stopDraw">취소 <kbd>Esc</kbd></button>
            </div>
            <!-- 편집 도구 팔레트(PRD #9 화면 레이아웃의 왼쪽). 편집 모드에서만, 무엇을 만드는지로 묶는다. 넣을 층은 층 하나만
                 보는 중이면 그 층이다(targetStorey). 왼쪽 위는 색 안내 자리라 아래쪽에 둔다. -->
            <nav v-if="editing && !drawing && activeTab === '3d'" class="tool-palette" aria-label="편집 도구">
              <!-- 천장 편집 모드(OE-OBJ-08). 천장 쪽에서는 공간 도구와 바닥·벽 도구가 잠기고, 누르면 어디서 편집하는지 알린다. -->
              <span class="palette-head">공간 그리기</span>
              <!-- 두 버튼을 한 줄에 둔다. 팔레트가 높아지면 3D 왼쪽 아래(작은 파일에서는 건물이 있는 자리)를 가린다. -->
              <span class="palette-row">
                <button type="button" :class="['ghost', { locked: ceilingMode }]" aria-label="물리존 그리기" title="바닥에 꼭짓점을 찍어 새 물리존을 그립니다" @click="ceilingMode ? lockedTool() : startCreateSpace()">물리존</button>
                <button type="button" :class="['ghost', { locked: ceilingMode }]" aria-label="커스텀존 그리기" title="물리존 위에 운영 단위(임원석·식당 등)를 다각형으로 그립니다. 겹쳐도 됩니다(OE-OBJ-01)" @click="ceilingMode ? lockedTool() : startCustomZone()">커스텀존</button>
              </span>
              <!-- [바닥·벽 / 천장] 토글(T). 제목 줄에 둔다 — 줄을 하나 더 쓰면 팔레트가 3D 왼쪽 아래 바닥을 가린다. -->
              <span class="palette-head palette-head-row">
                설비
                <span class="ceiling-toggle" role="group" aria-label="설비 편집 면">
                  <button type="button" :class="{ on: !ceilingMode }" :aria-pressed="!ceilingMode" title="바닥·벽 설비와 배관을 편집합니다" @click="setCeilingMode(false)">바닥·벽</button>
                  <button type="button" :class="{ on: ceilingMode }" :aria-pressed="ceilingMode" title="천장 설비만 편집합니다. 위에서 내려다보고 반자 높이에 천장면을 그립니다 (T)" @click="setCeilingMode(true)">천장</button>
                </span>
              </span>
              <!-- 천장 모드에서 지금 층의 반자 높이를 모르면 입력을 받는다. 그 전에는 천장 설비를 놓지 않는다(0 이나 층고로 채우지 않는다). -->
              <form v-if="ceilingAsk" class="ceiling-ask" @submit.prevent="saveCeiling(ceilingStorey!.id, Number(ceilingAskInput))">
                <label>
                  {{ ceilingStorey!.name }} 반자
                  <input
                    v-model="ceilingAskInput"
                    v-keep-typing
                    type="number"
                    step="0.05"
                    min="0.3"
                    aria-label="천장 모드 반자 높이(m)"
                    @keydown.enter.prevent="saveCeiling(ceilingStorey!.id, Number(ceilingAskInput))"
                  />
                  m
                </label>
                <button type="submit" class="ghost">정하기</button>
              </form>
              <span v-else-if="ceilingStorey && ceilingOf(ceilingStorey)" class="ceiling-now muted">
                반자 {{ meters(ceilingOf(ceilingStorey)!.height) }} <Src :kind="ceilingOf(ceilingStorey)!.source" />
              </span>
              <button
                type="button"
                :class="['ghost', { on: adding?.what === 'equipment' }]"
                :aria-pressed="adding?.what === 'equipment'"
                :disabled="ceilingAsk"
                :title="ceilingMode ? '천장을 눌러 새 설비를 반자 높이에 놓습니다' : '바닥을 눌러 새 설비를 놓습니다'"
                @click="adding?.what === 'equipment' ? stopAdd() : startAddEquipment()"
              >
                {{ adding?.what === 'equipment' ? '더하기 취소' : '설비 더하기' }}
              </button>
              <!-- 미배치 목록 펼치기. 작은 글자 한 줄로 둔다 — 버튼 줄을 더 쓰거나 [설비 더하기] 옆에 두면 팔레트가 커져 3D 왼쪽 아래 바닥을 가린다. -->
              <button v-if="unplacedHere.length" type="button" class="link unplaced-toggle" :aria-expanded="unplacedOpen" @click="unplacedOpen = !unplacedOpen">
                미배치 {{ unplacedHere.length.toLocaleString() }}대 {{ unplacedOpen ? '▾' : '▸' }}
              </button>
              <!-- 미배치 설비(OE-EQP-02). 누르면 바로 놓기 — 그 층 바닥(천장 모드면 천장)을 누르면 그 자리에 놓인다. 같은 설비를 다시
                   누르거나 Esc 면 취소다. 접어 둔다 — 펼친 채면 팔레트가 3D 왼쪽 아래를 가린다. -->
              <template v-if="unplacedHere.length && unplacedOpen">
                <ul class="palette-unplaced" aria-label="미배치 설비">
                  <li v-for="u in unplacedHere.slice(0, UNPLACED_SHOWN)" :key="u.equipment.id">
                    <button
                      type="button"
                      :class="{ on: placing === u.equipment.id }"
                      :aria-pressed="placing === u.equipment.id"
                      :title="`${u.storey.name} · ${whatIs(u.equipment)?.label ?? ifcClassLabel(u.equipment.ifcClass) ?? u.equipment.ifcClass}`"
                      @click="placing === u.equipment.id ? stopPlace() : placeFromList(u.equipment.id)"
                    >
                      {{ u.equipment.name ? shortName(u.equipment.name) : `(이름 없음 · ${whatIs(u.equipment)?.label ?? ifcClassLabel(u.equipment.ifcClass) ?? u.equipment.ifcClass})` }}
                    </button>
                  </li>
                  <li v-if="unplacedHere.length > UNPLACED_SHOWN" class="muted">외 {{ (unplacedHere.length - UNPLACED_SHOWN).toLocaleString() }}대</li>
                </ul>
              </template>
              <label v-if="!ceilingMode" class="palette-check" title="설비를 옮기면 붙은 이음쇠는 같이 옮기고, 그 너머 덕트·배관은 먼 끝을 두고 늘입니다">
                <input v-model="carryConduits" type="checkbox" /> 배관도 같이
              </label>
              <!-- 천장 설비의 바닥 발자국 링(OE-EQP-04). 색은 구역이다. 왼쪽 위 색 안내에 넣었더니 길어져 3D 의 설비를 덮었다. -->
              <span v-if="ceilingMarks.length && !ceilingMode" class="ceiling-key" title="천장 설비는 바닥에 링으로 보입니다. 고르면 링까지 점선이 내려옵니다(OE-EQP-04)">
                <i class="ring" :style="{ color: hex(CEILING_RING_COLORS.attached) }"></i>반자 부착
                <i class="ring" :style="{ color: hex(CEILING_RING_COLORS.plenum) }"></i>플레넘
              </span>
              <!-- 켜면 3D 에 벽·문·창이 서고 바닥 누르기가 그것을 먼저 고른다(E4). 제목 줄은 두지 않는다 — 버튼 이름과 같고, 줄이 늘면
                   팔레트가 3D 왼쪽 아래를 가린다. -->
              <button type="button" :class="['ghost', { on: archMode, locked: ceilingMode }]" :aria-pressed="archMode" title="벽·문·창을 3D에 세우고 고쳐 봅니다" @click="ceilingMode ? lockedTool() : (archMode = !archMode)">
                벽·문·창
              </button>
              <template v-if="archMode">
                <button type="button" class="ghost" title="바닥에 두 점을 찍어 벽을 긋습니다" @click="startWall">벽 긋기</button>
                <button type="button" :class="['ghost', { on: adding?.what === 'door' }]" title="벽 가까이 눌러 문을 놓습니다" @click="adding?.what === 'door' ? stopAdd() : startOpening('door')">문 놓기</button>
                <button type="button" :class="['ghost', { on: adding?.what === 'window' }]" title="벽 가까이 눌러 창을 놓습니다" @click="adding?.what === 'window' ? stopAdd() : startOpening('window')">창 놓기</button>
              </template>
            </nav>
            <div class="view-tools">
              <!-- 보기 ↔ 편집, 단축키 안내. 위 도구막대와 같은 일이라 전체 화면(도구막대가 안 보인다)에서만 둔다.
                   평소에도 두었더니 같은 스위치가 한 화면에 둘이었다. -->
              <label v-if="fullscreen" class="edit-toggle" title="켜면 3D에서 설비와 물리존 꼭짓점을 옮기고 연결 방향을 정할 수 있습니다.">
                <input
                  type="checkbox"
                  :checked="editing"
                  @change="onEditToggle($event.target as HTMLInputElement)"
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
              <!-- 공조존(IDF) 외곽선. IDF 를 열거나 덧붙였을 때만. -->
              <button
                v-if="model.hvac?.zones.length"
                type="button"
                :class="['ghost', { on: showZones }]"
                :aria-pressed="showZones"
                title="IDF 공조존의 바닥 외곽선"
                @click="showZones = !showZones"
              >
                공조존
              </button>
              <div class="tabs" role="group" aria-label="보기">
                <button type="button" :aria-pressed="activeTab === '3d'" @click="activeTab = '3d'">3D</button>
                <button type="button" :aria-pressed="activeTab === 'plan'" @click="showPlan">평면도</button>
              </div>
              <!-- 층별로 보기. 층이 하나면 둘 까닭이 없다. -->
              <select v-if="model.storeys.length > 1" v-model="viewStorey" class="storey-view" aria-label="보일 층" title="이 층만 보기">
                <option :value="null">모든 층</option>
                <option v-for="st in model.storeys" :key="st.id" :value="st.id">{{ st.name }}만</option>
              </select>
              <button v-if="fullscreen" type="button" class="ghost keys-help" title="단축키 안내" aria-label="단축키 안내" @click="helpOpen = true">?</button>
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

          <!-- 3D 색이 무엇을 뜻하는지. 진한 색은 BIM 포트가 말한 흐름, 옅은 색은 규칙으로 정한 흐름이다. -->
          <ul v-if="selected && activeTab === '3d'" class="color-key">
            <li><i :style="{ background: hex(PICK_COLORS.upstream) }"></i>상류 <Src kind="bim" /></li>
            <li><i :style="{ background: hex(PICK_COLORS.downstream) }"></i>하류 <Src kind="bim" /></li>
            <template v-if="showRules && tracedRules">
              <li><i :style="{ background: hex(PICK_COLORS.ruleUpstream) }"></i>상류 <Src kind="dict" /></li>
              <li><i :style="{ background: hex(PICK_COLORS.ruleDownstream) }"></i>하류 <Src kind="dict" /></li>
            </template>
            <li><i :style="{ background: hex(PICK_COLORS.linked) }"></i>방향 모름</li>
            <!-- 편집 모드의 연결 화살표. 색은 상류·하류가 아니라 그 방향을 누가 말했는가다. -->
            <template v-if="editing && hasArrows">
              <li class="key-head">화살표 (누르면 방향 전환)</li>
              <li><i class="bar" :style="{ background: hex(arrowPalette.port) }"></i>포트 방향 (고정) <Src kind="bim" /></li>
              <li><i class="bar" :style="{ background: hex(arrowPalette.edit) }"></i>직접 정한 방향 <Src kind="edit" /></li>
              <li v-if="showRules"><i class="bar dashed" :style="{ color: hex(arrowPalette.rule) }"></i>규칙 방향 <Src kind="dict" /></li>
              <li><i class="bar dashed" :style="{ color: hex(arrowPalette.none) }"></i>방향 모름</li>
            </template>
          </ul>

          <p v-if="editNotice" class="edit-notice" role="alert">{{ editNotice }}</p>
          <p v-else-if="keyNote" class="hint pick-hint key-note" role="status">{{ keyNote }}</p>
          <p v-else-if="editing" class="hint pick-hint">
            <template v-if="groupItems.length >= 2">
              설비 {{ groupItems.length }}대 · <kbd>←↑→↓</kbd>·끌기: 같이 옮기기 · <kbd>Delete</kbd>: 같이 지우기 · <kbd>Shift</kbd>+클릭: 넣고 빼기 · <kbd>Esc</kbd>: 풀기
            </template>
            <template v-else-if="selectedSpace">
              파란 손잡이 끌기 또는 <kbd>[ ]</kbd> 후 <kbd>←↑→↓</kbd>: 꼭짓점 옮기기 · <kbd>F</kbd>: 이 물리존 보기
            </template>
            <template v-else-if="selected">
              끌기 또는 <kbd>←↑→↓</kbd>: 옮기기 · <kbd>PageUp/Down</kbd>: 층 바꾸기 · 화살표 클릭 또는 <kbd>[ ]</kbd>: 연결 고르기 ·
              <kbd>D</kbd>: 방향 바꾸기 · <kbd>K</kbd>: 종류 고르기
            </template>
            <template v-else-if="selectedElement">
              <kbd>←↑→↓</kbd>: 옮기기(<kbd>Shift</kbd> 1m) · 다른 {{ activeTab === 'plan' ? '벽' : '벽·문·창' }} 클릭: 바꿔 고르기
            </template>
            <template v-else-if="archMode">
              {{ activeTab === 'plan' ? '벽' : '벽·문·창' }} 클릭: 고르기 · 바닥 클릭: 물리존 꼭짓점 보기 ·
              <kbd>U</kbd>: 종류 모르는 설비로
            </template>
            <template v-else>
              설비 클릭: 고르기 · <kbd>Shift</kbd>+클릭·끌기: 여러 개 · 고른 설비 끌기: 옮기기 · 바닥 클릭: 물리존 꼭짓점 보기 ·
              <kbd>U</kbd>: 종류 모르는 설비로
            </template>
            · <button type="button" class="link" @click="helpOpen = true">단축키 전체 <kbd>?</kbd></button>
          </p>
          <p v-else-if="counts.equipment > 0" class="hint pick-hint">
            {{
              activeTab === 'plan'
                ? '방이나 설비(점)를 누르면 오른쪽에 뜹니다. 휠로 확대, 끌어서 이동합니다.'
                : selectedSystemId
                  ? '계통 하나만 보는 중입니다. 다시 누르면 전체를 봅니다.'
                  : '설비·배관을 클릭하면 연결된 것이 색으로 표시됩니다. 바닥을 누르면 그 방이 뜹니다. 계통은 오른쪽 범례에서 고르세요.'
            }}
          </p>
        </section>

        <aside class="side">
        <!-- 고른 설비의 연결. 상류·하류를 아는지 모르는지를 여기서 분명히 말한다. -->
        <!-- 고른 것이 바뀌면 패널을 살짝 갈아 끼운다. 같은 것을 고친 것은 key 가 같아 가만히 있고, 바뀐 값만 v-flash 가 번쩍인다. -->
        <Transition name="swap" mode="out-in">
        <!-- 여러 개 고른 설비(OE-UI-09). 방향키·끌기로 같이 옮기고 Delete 로 같이 지운다. 되돌리기 한 번에 전부. -->
        <section v-if="groupItems.length >= 2" key="group" class="picked group-picked">
          <div class="picked-head">
            <div>
              <h3>설비 {{ groupItems.length }}대 고름</h3>
              <p class="stats">{{ [...new Set(groupItems.map((e) => storeyOf(e.id)?.name ?? ''))].filter(Boolean).join(' · ') }}</p>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="group = []">선택 해제</button>
            </div>
          </div>
          <ul class="group-list">
            <li v-for="e in groupItems.slice(0, 12)" :key="e.id">
              <button type="button" class="link" :title="'이 설비만 고르기'" @click="select(e.id)">{{ shortName(e.name) }}</button>
              <span v-if="whatIs(e)" class="muted"> {{ whatIs(e)!.label }}</span>
            </li>
            <li v-if="groupItems.length > 12" class="muted">외 {{ groupItems.length - 12 }}대</li>
          </ul>
          <p class="hint">
            <kbd>←↑→↓</kbd>·끌기: 같이 옮기기(<kbd>Shift</kbd> 1m) · <kbd>Shift</kbd>+클릭: 넣고 빼기 · <kbd>Shift</kbd>+끌기: 상자로 더하기 ·
            <kbd>Esc</kbd>: 풀기. 붙은 배관은 따라오지 않습니다.
          </p>
          <p class="picked-actions">
            <button type="button" class="ghost danger" @click="deleteGroup()">설비 {{ groupItems.length }}대 지우기 <kbd>Delete</kbd></button>
          </p>
        </section>
        <section v-else-if="selected" :key="`e:${selected.id}`" class="picked">
          <div class="picked-head">
            <div>
              <h3>{{ selected.name || '(이름 없음)' }}</h3>
              <!-- 한 줄에 "공조기 사전 · UnitaryEquipment.AIRHANDLER BIM · 에너지 변환 BIM · …" 로 이었더니 출처 칩이 어느 값에
                   붙은 것인지 읽기 어려웠다. 무엇에 대한 값인지를 앞에 두고 줄을 나눈다. -->
              <dl class="stats facts">
                <div>
                  <dt>종류</dt>
                  <dd v-flash="whatIs(selected)?.label">
                    <template v-if="whatIs(selected)">{{ whatIs(selected)!.label }} <Src :kind="whatIs(selected)!.src" /> · </template>
                    <template v-if="selected.added">에디터에서 더한 설비 <Src kind="edit" /></template>
                    <span v-else class="muted">{{ selected.declaredType ?? selected.ifcClass }} <Src kind="bim" /></span>
                  </dd>
                </div>
                <div v-if="roleLabel(selected.role)">
                  <dt>역할</dt>
                  <dd>{{ roleLabel(selected.role) }} <Src :kind="roleSrc(selected)" /></dd>
                </div>
                <div>
                  <dt>계통</dt>
                  <dd v-flash="selected.systemId">
                    {{ selected.systemId ? systemById.get(selected.systemId)?.name : '(계통 없음)' }}
                    <Src v-if="selected.systemEdited" kind="edit" /><Src v-else-if="selected.systemId" kind="bim" />
                  </dd>
                </div>
                <!-- 담당 근거(OE-EQP-10). VAV·말단을 어느 공조기가 맡는지 흐름 방향으로 찾은 것. -->
                <div v-if="selectedBasis" class="basis">
                  <dt>담당</dt>
                  <dd>
                    <template v-if="selectedBasis.supplyFrom.length || selectedBasis.extractTo.length">
                      <span v-if="selectedBasis.supplyFrom.length">급기 ← {{ selectedBasis.supplyFrom.join(', ') }}</span>
                      <template v-if="selectedBasis.supplyFrom.length && selectedBasis.extractTo.length"> · </template>
                      <span v-if="selectedBasis.extractTo.length">환기 → {{ selectedBasis.extractTo.join(', ') }}</span>
                    </template>
                    <span v-else class="muted">흐름 방향으로 닿는 공조기 없음</span>
                    <template v-if="selected.kind === 'vav'"> · 말단 {{ selectedBasis.terminals }}개 · 방 {{ selectedBasis.rooms }}곳</template>
                    <Src kind="calc" />
                  </dd>
                </div>
                <div>
                  <dt>소속</dt>
                  <dd v-flash="selected.spaceId">
                    {{ spaceNameOf(selected.spaceId) }}
                    <Src v-if="selected.spaceId" :kind="spaceSrc(selected)" />
                  </dd>
                </div>
                <!-- 설치면(OE-OBJ-08 · OE-EQP-03). 허용 설치면은 종류(사전, glossary 설치면 type), 판정은 z(층 바닥 기준). -->
                <div v-if="!isConduit(selected.role)" class="mount">
                  <dt>설치면</dt>
                  <dd v-flash="selected.kind">
                    <template v-if="allowedSurfaces(selected.kind)">허용 {{ allowedLabel(selected.kind) }} <Src kind="dict" /></template>
                    <span v-else class="muted">허용 설치면을 정하지 않은 종류</span>
                    <template v-if="selectedJudged && allowedSurfaces(selected.kind)?.length !== 0">
                      <br />
                      <template v-if="selectedJudged.judged">
                        판정 <span :class="{ 'height-mismatch': selectedJudged.outside }">{{ JUDGED_LABEL[selectedJudged.judged] }}</span>
                        <span v-if="selectedJudged.z !== null" class="muted">(z {{ selectedJudged.z.toFixed(2) }}m)</span>
                        <Src v-if="!selected.surfaceSet" kind="calc" />
                        <span v-if="selectedJudged.outside" class="height-mismatch"> 허용 밖</span>
                      </template>
                      <span v-else-if="selectedJudged.z !== null" class="muted">
                        판정 미정 (z {{ selectedJudged.z.toFixed(2) }}m{{ selectedJudged.hc ? '' : ' · 이 층 반자 높이 모름' }})
                      </span>
                      <!-- 사람이 정한 설치면(OE-EQP-05). 판정하지 못한 설비에 정하고, 지우면 z 판정으로 돌아간다. -->
                      <template v-if="selected.surfaceSet">
                        <Src kind="edit" />
                        <button v-if="editing && !selectedLock" type="button" class="link" @click="setSurfaceOf(selected.id, null)">판정으로 되돌리기</button>
                      </template>
                      <label v-else-if="editing && !selectedLock && !selectedJudged.judged" class="surface-set">
                        <select aria-label="설치면 정하기" @change="setSurfaceOf(selected.id, (($event.target as HTMLSelectElement).value || null) as Surface | null)">
                          <option value="">설치면 정하기…</option>
                          <option v-for="x in allowedSurfaces(selected.kind) ?? (['ceiling', 'floor', 'wall'] as const)" :key="x" :value="x">{{ SURFACE_LABEL[x] }}</option>
                        </select>
                      </label>
                    </template>
                  </dd>
                </div>
              </dl>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="frameNetwork">연결망 보기</button>
              <button type="button" class="ghost" @click="select(null)">선택 해제</button>
            </div>
          </div>

          <!-- 천장 편집 모드(OE-OBJ-08). 지금 모드에서 고칠 수 없는 설비는 고르기·조회만 되고 편집 칸을 숨긴다. -->
          <p v-if="editing && selectedLock" class="ceiling-lock" role="status">
            {{ selectedLock }}
            <button v-if="selectedLock.includes('천장 편집 모드에서')" type="button" class="link" @click="setCeilingMode(true)">천장 편집으로</button>
            <button v-else-if="selectedLock.includes('바닥·벽')" type="button" class="link" @click="setCeilingMode(false)">바닥·벽으로</button>
          </p>
          <!-- 이름(태그) 고치기(E7). 지우기는 패널 맨 아래에 둔다 — 이름 칸 바로 옆에 있어 고치려다 누르기 쉬웠다. -->
          <p v-if="editing && !selectedLock" class="equipment-name-edit">
            <label>
              이름
              <input
                class="name-input"
                type="text"
                v-keep-typing
                :value="selected.name"
                @change="renameEquipmentTo(selected.id, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </p>

          <!-- 종류 지정. 사전이 모르거나 잘못 읽은 종류를 같은 패밀리 전부에 한 번에 정한다. -->
          <p v-if="editing && !selectedLock" class="kind-edit">
            <label>
              종류
              <select
                ref="kindSelect"
                :value="selected.kind ?? ''"
                @change="pickKind($event, selected)"
              >
                <option value="">(모름)</option>
                <optgroup v-for="g in KIND_GROUPS" :key="g.label" :label="g.label">
                  <option v-for="k in g.kinds" :key="k.kind" :value="k.kind">{{ k.label }}</option>
                </optgroup>
              </select>
            </label>
            <Src v-if="selected.kind || selected.kindEdited" :kind="kindSrc(selected)" />
            <span class="muted" :title="typeLabel(selected)">
              {{
                typeNameOf(selected)
                  ? `같은 패밀리 ${familyLabel(selected)}${(familyCounts.get(familyKeyOf(selected))?.types.size ?? 1) > 1 ? `(유형 ${familyCounts.get(familyKeyOf(selected))!.types.size}개)` : ''} ${familyCounts.get(familyKeyOf(selected))?.count ?? 1}대에 함께 적용됩니다`
                  : '타입 정보가 없어 이 설비에만 적용됩니다'
              }}
            </span>
          </p>

          <p v-if="editing && kindWarning" class="edit-notice inline" role="alert">{{ kindWarning }}</p>
          <!-- 외벽 전용 설비(OE-OBJ-04)가 외벽 바깥 면에 있지 않다. 종류를 바꾸거나 BIM 이 방 안에 둔 외기 센서다. -->
          <p v-if="exteriorMisplaced(selected)" class="edit-notice inline exterior-misplaced" role="alert">
            {{ EXTERIOR_ONLY }} 지금 자리는 {{ selected.position ? '외벽 바깥 면이 아닙니다' : '없습니다' }}.
            {{ editing ? '[벽에 붙이기]로 외벽 바깥쪽을 누르세요.' : '편집 모드에서 [벽에 붙이기]로 옮기세요.' }}
          </p>
          <!-- 계통 없는 VAV·토출구(OE-EQP-10). 보기 모드에서도 띄운다 — 내보내면 어느 계통의 구성원으로도 나가지 않는다. -->
          <p v-if="needsSystem(selected) && !selected.systemId" class="edit-notice inline system-missing" role="alert">
            {{ whatIs(selected)?.label ?? 'VAV·토출구' }}에 계통이 없습니다. 내보내면 어느 계통의 구성원(brick:hasPart)으로도 나가지 않아,
            DT 에서 계통으로 찾을 때 빠집니다. {{ editing ? '아래 계통 칸에서 정하세요.' : '편집 모드에서 계통을 정하세요.' }}
          </p>

          <!-- 계통(E8). 설비의 계통 한 자리를 바꾼다. 규칙 방향을 다시 돌리고 TTL 의 brick:hasPart 가 바뀐다. -->
          <p v-if="editing && !selectedLock" class="system-edit">
            <label>
              계통
              <select :value="selected.systemId ?? ''" @change="pickSystem($event, selected.id)">
                <option value="">(계통 없음)</option>
                <option v-for="o in filteredSystemOptions.options" :key="o.id" :value="o.id">{{ o.label }}</option>
              </select>
            </label>
            <Src v-if="selected.systemEdited" kind="edit" />
            <input
              v-if="systemOptions.length > SYSTEM_FILTER_FROM"
              v-model="systemFilter"
              v-keep-typing
              class="system-filter"
              type="search"
              :placeholder="`계통 ${systemOptions.length}개에서 찾기`"
              aria-label="계통 찾기"
            />
            <span v-if="systemFilter && filteredSystemOptions.options.length <= 1" class="muted">맞는 계통이 없습니다</span>
            <span v-else-if="filteredSystemOptions.hidden" class="muted">{{ filteredSystemOptions.hidden }}개 더 있습니다. 찾기 칸으로 줄이세요</span>
            <button type="button" class="link" @click="newSystemOpen = !newSystemOpen">새 계통…</button>
          </p>
          <!-- 새 계통(E8). 사람이 더한 설비처럼 넣을 계통이 없을 때. 만들면 고른 설비를 바로 넣는다. -->
          <form v-if="editing && !selectedLock && newSystemOpen" class="system-edit new-system" @submit.prevent="createSystemFor(selected.id)">
            <input v-model="newSystemName" v-keep-typing type="text" placeholder="계통 이름" aria-label="새 계통 이름" required />
            <select v-model="newSystemKind" aria-label="새 계통 종류">
              <option value="">(종류 모름)</option>
              <option v-for="k in SYSTEM_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
            </select>
            <button type="submit" class="ghost" :disabled="!newSystemName.trim()">만들어 넣기</button>
          </form>

          <!-- 위치(E5·E6). 아래 설비 표와 같은 칸이다. N 으로 소속 없는 설비에 오면 좌표를 여기서 바로 넣는다 — 표는
               화면 아래 멀리 있다. 좌표가 없는 설비는 셋이 다 차야 옮긴다(0 으로 채우지 않는다). -->
          <p v-if="editing && !selectedLock" class="position-edit">
            위치
            <label v-for="axis in [0, 1, 2] as const" :key="axis">
              {{ 'xyz'[axis] }}
              <input
                class="coord mono"
                type="number"
                step="0.1"
                v-keep-typing
                :value="selected.position ? mmOf(selected.position[axis]) : (positionDrafts.get(selected.id)?.[axis] ?? '')"
                placeholder="—"
                @change="applyMove(selected.id, axis, ($event.target as HTMLInputElement).value, selected.position, $event.target as HTMLInputElement)"
              />
            </label>
            <Src v-if="selected.position" :kind="positionSrc(selected)" />
            <!-- 외벽 전용 설비(OE-OBJ-04). 누른 자리에서 가장 가까운 벽 면에 붙이고, 벽을 옮기면 같이 간다. -->
            <button
              v-if="editing && canMountOn(selected, 'wall')"
              type="button"
              :class="['ghost', 'place', 'mount', { on: placing === selected.id && placingOn === 'wall' }]"
              :aria-pressed="placing === selected.id && placingOn === 'wall'"
              @click="placing === selected.id && placingOn === 'wall' ? stopPlace() : startPlace(selected.id, 'wall')"
            >
              {{ placing === selected.id && placingOn === 'wall' ? '붙이기 취소' : '벽에 붙이기' }}
            </button>
            <span class="muted">
              {{
                selected.position
                  ? `${selected.wallId ? `${wallNameOf(selected.wallId)}에 붙음 · ` : ''}${selected.spaceId ? `소속 ${spaceNameOf(selected.spaceId)}` : '소속 방 없음'} · 방향키로도 옮길 수 있습니다`
                  : positionDrafts.has(selected.id)
                    ? 'x·y·z를 모두 넣어야 옮겨집니다'
                    : '좌표가 없습니다. x·y·z를 넣거나 왼쪽 도구의 미배치 목록에서 눌러 3D에 놓으세요'
              }}
            </span>
          </p>

          <!-- 층 옮기기(E6). 층은 좌표로 판정하지 않고 사람이 고른다(edit.ts). -->
          <p v-if="editing && !selectedLock" class="storey-move">
            <label>
              층
              <select
                :value="storeyOf(selected.id)?.id ?? ''"
                :disabled="model.storeys.length < 2"
                @change="onStoreyPick(selected.id, $event.target as HTMLSelectElement)"
              >
                <option v-for="s in model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </label>
            <Src :kind="storeyMoved.has(selected.id) ? 'edit' : 'bim'" />
            <span class="muted">
              {{
                model.storeys.length < 2
                  ? '층이 하나뿐입니다.'
                  : selected.position
                    ? '층을 바꾸면 높이도 층 차이만큼 옮기고 소속 방을 다시 찾습니다.'
                    : '좌표가 없어 층만 바뀝니다.'
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
              <b>{{ traced?.linked.size ?? 0 }}</b><span>방향 모름</span>
              <small v-if="traced?.linked.size">그중 기기 {{ deviceCount(traced.linked) }}</small>
            </li>
          </ul>

          <!-- 규칙 방향. 위 숫자는 BIM 포트가 말한 것만이고, 여기부터가 계통·설비 종류로 정한 것이다. -->
          <div v-if="tracedRules" class="rule-box">
            <p>
              <Src kind="dict" /> 규칙 방향<template v-if="flowEditLines.length">과 <Src kind="edit" /> 직접 정한 방향</template>까지
              포함하면 상류 <b>{{ tracedRules.upstream.size }}</b> · 하류 <b>{{ tracedRules.downstream.size }}</b> ·
              방향 모름 <b>{{ tracedRules.linked.size }}</b>
              <template v-if="tracedRules.linked.size">(그중 기기 {{ deviceCount(tracedRules.linked) }})</template>
              <label class="rule-toggle">
                <input v-model="showRules" type="checkbox" />
                3D에 규칙 방향 표시
              </label>
            </p>
            <p v-if="selectedRule" class="rule-system">
              <b>{{ selectedRule.name }}</b><template v-if="selectedRule.kind">({{ selectedRule.kind }})</template>: 규칙으로 방향을 정한 연결
              {{ selectedRule.count }}개.
              <template v-if="selectedRule.pct !== null">
                포트 방향이 있는 연결 {{ selectedRule.checked }}개로 검증하면
                <b :class="{ low: selectedRule.pct < 80 }">{{ selectedRule.pct }}%</b> 일치합니다.
              </template>
              <template v-else> 포트 방향이 있는 연결이 없어 검증할 수 없습니다.</template>
              <span v-if="selectedRule.confirmed" class="confirmed">확정했습니다. brick:feeds로 내보냅니다.</span>
              <button
                v-else-if="editing"
                type="button"
                class="ghost"
                :disabled="selectedRule.count === 0"
                @click="confirmRule(selectedRule.systemId, selectedRule.name)"
              >
                이 계통 방향 확정
              </button>
              <span v-else class="muted"> 확정은 편집 모드에서 할 수 있습니다.</span>
            </p>
            <p v-if="selectedRule && selectedRule.pct !== null && selectedRule.pct < 80" class="hint">
              일치율이 낮습니다. 확정하기 전에 3D에서 흐름을 확인하세요.
            </p>
          </div>

          <!-- 바로 붙은 연결. 편집 모드에서 방향을 정하는 자리라 계통·담당 공간(길어질 수 있다)보다 앞에 둔다.
               맨 아래에 두었더니 병원 공조기에서 담당 방 150줄 아래로 묻혔다. -->
          <h4 class="picked-sub">
            직접 연결 <span class="muted">{{ selectedNeighbors.length }}</span>
            <button
              v-if="editing"
              type="button"
              :class="['ghost', 'connect', { on: connectFrom }]"
              :aria-pressed="!!connectFrom"
              @click="connectFrom ? (connectFrom = null) : startConnect()"
            >
              {{ connectFrom ? '연결하기 취소' : '연결하기' }}
            </button>
          </h4>
          <p v-if="connectFrom" class="edit-notice inline">연결할 설비를 3D나 목록에서 고르세요. <kbd>Esc</kbd>로 취소합니다.</p>
          <p v-if="selectedNeighbors.length === 0" class="hint">
            이 설비에 연결된 것이 없습니다.
          </p>
          <table v-else class="neighbors">
            <tbody>
              <tr v-for="(n, i) in selectedNeighbors" :key="`${n.id}-${i}`" :class="{ active: editing && i === activeArrow }">
                <td :class="['rel', ...relClass(n)]">{{ relLabel(n) }}</td>
                <td class="name-cell">
                  <button type="button" class="link" @click="select(n.id)">{{ n.name }}</button>
                  <span v-if="n.what" class="what">{{ n.what.label }} <Src :kind="n.what.src" /></span>
                  <!-- 출처는 이름 아래 한 줄. 글과 출처 꼬리표가 따로 꺾이지 않게 한 덩어리씩 묶는다. -->
                  <div class="muted src-cell">
                    <span v-if="n.source === 'port'">포트 <Src kind="bim" /></span>
                    <span v-else-if="n.source === 'manual'">직접 이음 <Src kind="edit" /></span>
                    <span v-else>{{ sourceLabel(n.tolerance) }} <Src kind="calc" /></span>
                    <span v-if="n.edited">직접 정한 방향 <Src kind="edit" /></span>
                    <span v-else-if="n.rule">{{ n.rule.confirmed ? '규칙 방향(확정)' : '규칙 방향(추정)' }} <Src kind="dict" /></span>
                    <!-- 한 층만 보는 중이면 다른 층 것은 3D 에 없고 화살표도 안 그린다(OE-UI-12). 왜 안 보이는지 적는다. -->
                    <span v-if="otherFloor(n.id)" class="other-floor">다른 층({{ otherFloor(n.id) }}) — 3D에 안 보임</span>
                  </div>
                  <!-- 방향 버튼은 이름 아래 줄에 둔다. 좁은 패널에서 네 번째 칸으로 두었더니 이름이 한 글자씩 꺾이고 버튼이 잘렸다.
                       포트가 방향을 말한 연결은 고칠 수 없다. BIM 이 말한 것을 덮어쓰지 않는다. -->
                  <div v-if="editing && !n.connection.directed" class="flow-edit">
                    <button
                      type="button"
                      class="ghost"
                      :aria-pressed="n.edited === 'upstream'"
                      :title="`${n.name} → 이 설비`"
                      @click="setFlow(n, n.id)"
                    >
                      상류로
                    </button>
                    <button
                      type="button"
                      class="ghost"
                      :aria-pressed="n.edited === 'downstream'"
                      :title="`이 설비 → ${n.name}`"
                      @click="setFlow(n, selectedId)"
                    >
                      하류로
                    </button>
                    <!-- 자리는 늘 잡아 둔다. 누를 때 생기면 옆 버튼이 밀려 마우스 아래로 다른 버튼이 온다. -->
                    <button
                      type="button"
                      :class="['ghost', { hidden: !n.edited }]"
                      :disabled="!n.edited"
                      title="정한 방향 지우기"
                      @click="setFlow(n, null)"
                    >
                      지우기
                    </button>
                    <button v-if="n.source !== 'port'" type="button" class="ghost cut" title="이 연결을 끊습니다" @click="disconnect(n.connection)">연결 끊기</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- 계통별로 보기. 한 기기에 물·바람·배수가 같이 붙으므로 계통마다 나눠 센다. 패널이 좁아 표가 아니라
               줄마다 두세 줄짜리 목록이다 — 일곱 칸 표는 오른쪽 넷(방향 모름·덕트·이어진 기기)이 잘렸다. -->
          <div v-if="systemRows.length" class="by-system">
            <h4 class="picked-sub">
              계통별로 보기 <Src kind="bim" />
              <span class="muted">
                기기 대수입니다<template v-if="showRules && hasRules">(규칙 방향 포함 <Src kind="dict" />)</template>. 방향을 모르는 연결은 다음 기기까지만
                셉니다. 누르면 3D에 그 계통만 보입니다.
              </span>
            </h4>
            <ul class="sys-list">
              <li v-for="r in systemRows" :key="r.key" :class="{ chosen: flowSystemKey === r.key }">
                <button type="button" :aria-pressed="flowSystemKey === r.key" @click="toggleFlowSystem(r.key)">
                  <span class="sys">
                    <i :style="{ background: r.color ?? 'transparent' }"></i>
                    <span class="sys-name">{{ r.name }}</span>
                    <span :class="['sys-kind', { muted: !r.kind }]">{{ r.kind ?? '종류 모름' }}<Src v-if="r.kind" kind="dict" /></span>
                  </span>
                  <span class="sys-counts">
                    <span v-if="r.up" class="upstream">상류 <b>{{ r.up }}</b></span>
                    <span v-if="r.down" class="downstream">하류 <b>{{ r.down }}</b></span>
                    <span v-if="r.unknown" class="linked">방향 모름 <b>{{ r.unknown }}</b></span>
                    <span v-if="r.conduits" class="muted">덕트·배관 {{ r.conduits }}</span>
                  </span>
                  <span class="sys-kinds" :title="r.kinds.map(([l, n]) => `${l} ${n}`).join(', ')">
                    <template v-if="r.kinds.length">{{ kindsText(r.kinds) }}</template>
                    <!-- Revit 은 급기 계통을 가지마다 쪼개서, 관이 다른 계통으로 이어질 수 있다. 끊겼다고 단정하지 않는다. -->
                    <span v-else class="muted">이 계통에 연결된 기기 없음</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <!-- 담당 공간. 공기 원천을 골랐을 때만 뜬다. 계통도가 묻는 "이 공조기가 담당하는 방" 의 근사다.
               병원 공조기 하나가 방 150개에 닿아 패널이 8,000px 이 됐었다. 층으로 묶고 말단이 많은 방부터 몇 줄만 보인다. -->
          <div v-if="selectedService" class="served">
            <h4 class="picked-sub">
              담당 공간 <Src kind="calc" />
              <span class="muted">
                흐름을 따라 닿는 말단(디퓨저·그릴)이 있는 방입니다<template v-if="showRules && hasRules">(규칙 방향 포함 <Src kind="dict" />)</template>.
                추정값이라 내보내지 않습니다.
              </span>
            </h4>
            <p v-if="!selectedService.supply.length && !selectedService.extract.length" class="muted">
              흐름을 따라 닿는 말단이 없습니다. 방향을 모르는 연결에서 끊겼거나, 덕트 없이 방에 놓인 기기(카세트형 등)일 수 있습니다.
            </p>
            <template v-else>
              <p class="served-sum">
                방 <b>{{ selectedService.rooms.filter((r) => r.spaceId).length }}</b> ·
                급기 말단 <b class="downstream">{{ selectedService.supply.length }}</b> ·
                환기·배기 말단 <b class="upstream">{{ selectedService.extract.length }}</b>
              </p>
              <table>
                <thead>
                  <tr>
                    <th>방</th>
                    <th class="num">급기</th>
                    <th class="num">환기·배기</th>
                  </tr>
                </thead>
                <tbody v-for="g in servedView.groups" :key="g.label">
                  <tr class="group">
                    <th colspan="3">{{ g.label }}</th>
                  </tr>
                  <tr v-for="r in g.rooms" :key="r.spaceId ?? '-'">
                    <td :class="{ muted: !r.spaceId }">{{ r.spaceId ? spaceNameOf(r.spaceId) : '소속 방 없는 말단' }}</td>
                    <td :class="['num', 'mono', r.supply ? 'downstream' : 'muted']">{{ r.supply || '·' }}</td>
                    <td :class="['num', 'mono', r.extract ? 'upstream' : 'muted']">{{ r.extract || '·' }}</td>
                  </tr>
                </tbody>
              </table>
              <button v-if="servedView.hidden" type="button" class="link more" @click="servedAll = true">
                나머지 {{ servedView.hidden }}개 더 보기
              </button>
            </template>
            <p v-if="selectedService.rooms.some((r) => !r.spaceId) && counts.spaces === 0" class="hint">
              이 파일에는 방이 없습니다. 건축 파일을 덧붙이면 방이 나옵니다.
            </p>
          </div>

          <!-- 지우기(E7). 지우면 붙은 연결·계통 자리도 빠지고 Ctrl+Z 로 돌아온다. 고치는 칸과 떨어뜨려 맨 아래에 둔다. -->
          <p v-if="editing && !selectedLock" class="danger-zone">
            <button type="button" class="ghost danger" title="이 설비와 붙은 연결을 지웁니다 (Ctrl+Z 로 되돌림)" @click="removeEquipment(selected.id)">
              설비 지우기
            </button>
            <span class="muted">붙은 연결·계통 자리도 같이 빠집니다. Ctrl+Z 로 되돌립니다.</span>
          </p>
        </section>

        <!-- 3D·평면도에서 고른 물리존(E2). 바닥을 누르면 뜬다. 고치는 칸은 편집 모드에만. -->
        <!-- 3D 에서 고른 벽·문·창(E4). [벽·문·창] 을 켰을 때만 골라진다. -->
        <section v-else-if="selectedElement" :key="`w:${selectedElementId}`" class="picked element-picked">
          <div class="picked-head">
            <div>
              <h3>{{ selectedElement.wall?.name || selectedElement.opening?.name || elementLabel(selectedElement.kind) }}</h3>
              <p class="stats">
                {{ selectedElement.wall?.loadBearing ? '내력벽' : elementLabel(selectedElement.kind) }}
                <Src :kind="selectedElement.wall ? bearingSrc(selectedElement.wall) : selectedElement.opening?.added ? 'edit' : 'bim'" /> ·
                {{ selectedElement.storey.name }}
                <template v-if="selectedElement.wall">
                  · 두께 {{ selectedElement.wall.thickness !== null ? `${selectedElement.wall.thickness.toFixed(2)}m` : '모름' }}
                  <!-- 외벽·내벽(OE-EXT-01). BIM(IsExternal)이 말하지 않으면 건물 바깥에 닿는지로 계산하고 출처를 가른다.
                       외곽선이 없어 계산도 못 하면 적지 않는다 — 내벽으로 보이면 아니오처럼 읽힌다. -->
                  <template v-if="externalOf(selectedElement.wall.id)">
                    · <span data-testid="wall-external">{{ externalOf(selectedElement.wall.id)!.external ? '외벽' : '내벽' }}</span>
                    <Src :kind="externalOf(selectedElement.wall.id)!.source" />
                  </template>
                </template>
                <template v-if="selectedElement.opening && externalOf(selectedElement.opening.wallId)">
                  · {{ externalOf(selectedElement.opening.wallId)!.external ? '외벽' : '내벽' }}에 뚫림
                  <Src :kind="externalOf(selectedElement.opening.wallId)!.source" />
                </template>
              </p>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="selectedElementId = null">선택 해제</button>
            </div>
          </div>
          <p v-if="selectedElement.locked" class="lock-note" data-testid="wall-locked">
            {{ selectedElement.wall ? '내력벽이라' : '내력벽에 뚫린 것이라' }} 옮기거나 지울 수 없습니다.
            <template v-if="selectedElement.wall">아래 내력 여부를 바꾸면 풀립니다.</template>
          </p>
          <!-- 크기(OE-OBJ-04 x·y·z). 길이·두께는 꼭짓점 넷인 벽만(문·창으로 조각난 벽은 옮기기만), 높이는 어느 벽이나. -->
          <p v-if="selectedElement.wall && !selectedElement.locked" class="position-edit wall-length wall-size">
            <label v-if="wallLength(selectedElement.wall) !== null">
              길이
              <input
                class="coord mono"
                type="number"
                step="0.1"
                min="0.1"
                data-testid="wall-length"
                v-keep-typing
                :value="wallLength(selectedElement.wall)!.toFixed(2)"
                @change="applyWallLength(selectedElement.wall!, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label v-if="wallLength(selectedElement.wall) !== null">
              두께
              <input
                class="coord mono"
                type="number"
                step="0.05"
                min="0.05"
                data-testid="wall-thickness"
                v-keep-typing
                :value="selectedElement.wall.thickness?.toFixed(2) ?? ''"
                placeholder="모름"
                @change="applyWallSize(selectedElement.wall!, 'thickness', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              높이
              <input
                class="coord mono"
                type="number"
                step="0.1"
                min="0.1"
                data-testid="wall-height"
                v-keep-typing
                :value="selectedElement.wall.height?.toFixed(2) ?? ''"
                placeholder="모름"
                @change="applyWallSize(selectedElement.wall!, 'height', ($event.target as HTMLInputElement).value)"
              />
              m
              <!-- 높이는 형상의 위아래 폭으로 잰 값(계산)이다. 연 뒤에 고쳤으면 편집. 모르면 칩을 달지 않는다. -->
              <Src
                v-if="selectedElement.wall.height != null"
                :kind="selectedElement.wall.added || sinceOpen.wallsChanged.some((c) => c.id === selectedElement!.wall!.id && c.resized) ? 'edit' : 'calc'"
              />
            </label>
            <span class="muted">{{
              wallLength(selectedElement.wall) !== null
                ? '길이·두께는 가운데를 두고 같이 늘거나 줄어듭니다. 높이 빈칸은 모름입니다.'
                : '문·창으로 조각났거나 꺾인 벽은 길이·두께를 바꾸지 않고 옮기기만 됩니다. 높이 빈칸은 모름입니다.'
            }}</span>
          </p>
          <!-- 외벽 여부(OE-OBJ-04). 지금 판정(BIM·계산·편집)을 보이고, 고르면 사람이 정한 값이 된다. -->
          <p v-if="selectedElement.wall" class="storey-move">
            <label>
              외벽
              <select
                data-testid="wall-external-select"
                :value="String(externalOf(selectedElement.wall.id)?.external ?? null)"
                @change="setExternal(selectedElement.wall!, ($event.target as HTMLSelectElement).value)"
              >
                <option value="true">외벽</option>
                <option value="false">내벽</option>
                <option value="null">모름</option>
              </select>
            </label>
            <Src v-if="externalOf(selectedElement.wall.id)" :kind="externalOf(selectedElement.wall.id)!.source" />
            <span class="muted">{{ externalOf(selectedElement.wall.id)?.source === 'calc' ? '건물 바깥에 닿는지로 계산했습니다. 틀리면 고르세요.' : '' }}</span>
          </p>
          <p v-if="selectedElement.wall && !selectedElement.locked" class="storey-move carry-rooms">
            <label title="벽 면에서 0.6m 안의 방 변이 벽이 움직인 만큼 따라옵니다. 끄면 방 경계는 그대로입니다(방은 IfcSpace 가 따로 그린 것)">
              <input v-model="carryRooms" type="checkbox" /> 옮길 때 방 경계도 같이
            </label>
          </p>
          <p v-if="selectedElement.wall" class="storey-move">
            <label>
              내력
              <select
                data-testid="wall-bearing"
                :value="String(selectedElement.wall.loadBearing)"
                @change="setBearing(selectedElement.wall!, ($event.target as HTMLSelectElement).value)"
              >
                <option value="true">내력벽</option>
                <option value="false">비내력벽</option>
                <option value="null">모름</option>
              </select>
            </label>
            <Src :kind="bearingSrc(selectedElement.wall)" />
            <span class="muted">{{ selectedElement.wall.loadBearing === null ? '모름은 아니오가 아닙니다. 내벽처럼 고칠 수 있습니다.' : '모름은 아니오가 아닙니다.' }}</span>
          </p>
          <!-- 문·창 크기(OE-OBJ-07). 자리(가운데)는 두고 가로·세로만 바꾼다. 모르는 값은 빈칸이다. -->
          <p v-if="selectedElement.opening" class="opening-size">
            크기
            <label v-for="key in ['width', 'height'] as const" :key="key">
              {{ key === 'width' ? '가로' : '세로' }}
              <input
                class="coord mono"
                type="number"
                step="0.1"
                min="0.1"
                v-keep-typing
                :disabled="selectedElement.locked"
                :value="selectedElement.opening[key] != null ? selectedElement.opening[key]!.toFixed(2) : ''"
                :placeholder="'모름'"
                @change="applyOpeningSize(selectedElement.opening!, key, ($event.target as HTMLInputElement).value)"
              />
            </label>
            m
          </p>
          <p v-if="selectedElement.opening?.position" class="position-edit">
            자리
            <label v-for="axis in [0, 1] as const" :key="axis">
              {{ 'xy'[axis] }}
              <input
                class="coord mono"
                type="number"
                step="0.1"
                v-keep-typing
                :disabled="selectedElement.locked"
                :value="mmOf(selectedElement.opening.position[axis])"
                @change="applyOpeningPosition(selectedElement.opening!, axis, ($event.target as HTMLInputElement).value, $event.target as HTMLInputElement)"
              />
            </label>
          </p>
          <p v-if="selectedElement.opening?.kind === 'door'" class="stats">
            잇는 방:
            {{ selectedElement.opening.connects?.length ? selectedElement.opening.connects.map(nameOfSpace).join(' · ') : '(없음)' }}
            <Src v-if="selectedElement.opening.connectsSource" :kind="selectedElement.opening.connectsSource === 'bim' ? 'bim' : 'calc'" />
          </p>
          <p v-if="!selectedElement.locked" class="danger-zone">
            <button type="button" class="ghost danger" @click="removeElement">
              {{ elementLabel(selectedElement.kind) }} 지우기
            </button>
            <span class="muted">
              {{ selectedElement.wall ? '뚫린 문·창도 같이 지워집니다. ' : '' }}방향키로 옮깁니다(Shift 1m).
              {{ selectedElement.wall && carryRooms ? '벽 가까운 방 변이 벽에 수직으로 따라옵니다.' : '방 경계는 따라 바뀌지 않습니다.' }}
            </span>
          </p>
        </section>
        <!-- 커스텀존(OE-OBJ-01). 품는 방·든 설비는 쓸 때 계산한 것이라 물리존·설비를 고치면 따라 바뀐다. -->
        <section v-else-if="selectedCustomZone" :key="`cz:${selectedCustomZone.zone.id}`" class="picked custom-zone-picked">
          <div class="picked-head">
            <div>
              <h3>{{ selectedCustomZone.zone.name }}</h3>
              <dl class="stats facts">
                <div v-if="selectedCustomZone.zone.aliases?.length">
                  <dt>다른 별명</dt>
                  <dd data-testid="zone-aliases">{{ selectedCustomZone.zone.aliases.join(', ') }} <Src kind="edit" /></dd>
                </div>
                <div>
                  <dt>커스텀존</dt>
                  <dd>{{ selectedCustomZone.storey.name }} <Src kind="edit" /></dd>
                </div>
                <div>
                  <dt>넓이</dt>
                  <dd><b class="mono">{{ selectedCustomZone.areaM2.toFixed(1) }}</b> ㎡ <Src kind="calc" /></dd>
                </div>
                <div>
                  <dt>품는 방</dt>
                  <dd data-testid="zone-spaces">
                    <!-- 방 번호를 같이 — 거울 대칭 세대는 이름이 같은 방이 둘이다(Duplex 의 Bathroom 1 A104·B104). -->
                    <template v-if="selectedCustomZone.spaces.length">{{ selectedCustomZone.spaces.map(zoneRoomLabel).join(', ') }}</template>
                    <span v-else class="muted">없음(방 바닥의 절반 넘게 덮는 방만)</span>
                    <Src kind="calc" />
                  </dd>
                </div>
                <div>
                  <dt>든 설비</dt>
                  <dd data-testid="zone-equipment">{{ selectedCustomZone.equipment.length }}대 <Src kind="calc" /></dd>
                </div>
              </dl>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="selectedCustomZoneId = null">선택 해제</button>
            </div>
          </div>
          <label v-if="editing" class="space-name">
            이름
            <input type="text" data-testid="zone-name" v-keep-typing :value="selectedCustomZone.zone.name" @change="renameZone(($event.target as HTMLInputElement).value)" />
          </label>
          <!-- 별명은 여러 개(ADR-0012). 첫 이름이 TTL rdfs:label, 여기 적은 것은 ex:alias 다. 쉼표로 가른다. -->
          <label v-if="editing" class="space-name">
            다른 별명
            <input
              type="text"
              data-testid="zone-aliases-input"
              v-keep-typing
              placeholder="쉼표로 여러 개 (예: 임원 구역, 경영진석)"
              :value="(selectedCustomZone.zone.aliases ?? []).join(', ')"
              @change="setZoneAliases(($event.target as HTMLInputElement).value)"
            />
          </label>
          <p v-if="editing" class="space-tools">
            <button type="button" class="ghost" title="바닥에 선의 두 점을 찍어 둘로 나눕니다" @click="startCustomSplit">나누기</button>
            <label v-if="(selectedCustomZone.storey.customZones ?? []).length > 1">
              <select :value="''" aria-label="합칠 커스텀존" @change="mergeZone(($event.target as HTMLSelectElement).value)">
                <option value="" disabled>합칠 커스텀존 고르기…</option>
                <option v-for="z in selectedCustomZone.storey.customZones!.filter((x) => x.id !== selectedCustomZone!.zone.id)" :key="z.id" :value="z.id">{{ z.name }}</option>
              </select>
            </label>
          </p>
          <p class="hint">
            TTL 에 brick:Zone 으로 나갑니다. 품는 방은 hasPart, 든 설비는 이 존을 위치(hasLocation)로 하나 더 갖습니다. 공조존과는 같은 방을
            품는 것으로 이어집니다.
          </p>
          <ul v-if="selectedCustomZone.equipment.length" class="plain space-members">
            <li v-for="id in selectedCustomZone.equipment.slice(0, 12)" :key="id">
              <button type="button" class="link" @click="select(id)">{{ nameOfId(id) }}</button>
              <span class="muted">{{ equipmentById.get(id) ? whatIs(equipmentById.get(id)!)?.label : '' }}</span>
            </li>
          </ul>
          <p v-if="editing" class="danger-zone">
            <button type="button" class="ghost danger" @click="removeZone">커스텀존 지우기</button>
            <span class="muted">물리존·설비는 그대로입니다. Ctrl+Z 로 되돌립니다.</span>
          </p>
        </section>
        <section v-else-if="selectedSpace" :key="`s:${selectedSpace.space.id}`" class="picked space-picked">
          <div class="picked-head">
            <div>
              <h3>{{ selectedSpace.space.longName || selectedSpace.space.name }}</h3>
              <dl class="stats facts">
                <div>
                  <dt>물리존</dt>
                  <dd>{{ selectedSpace.space.name }} <Src kind="bim" /> · {{ selectedSpace.storey.name }} <Src kind="bim" /></dd>
                </div>
                <!-- 방 종류(TTL 의 Brick 클래스). 이름을 고치면 따라 바뀌므로, 고친 사람이 무엇이 됐는지 여기서 본다. -->
                <div>
                  <dt>종류</dt>
                  <dd v-flash="selectedSpace.space.kind" class="space-kind">
                    <template v-if="roomKind(selectedSpace.space.kind)">
                      {{ roomKind(selectedSpace.space.kind)!.label }} <Src :kind="selectedSpace.space.kindSource === 'bim' ? 'bim' : 'dict'" />
                    </template>
                    <span v-else class="muted">모름</span>
                  </dd>
                </div>
                <div>
                  <dt>넓이</dt>
                  <dd v-flash="selectedSpace.space.areaM2.toFixed(1)"><b class="mono">{{ selectedSpace.space.areaM2.toFixed(1) }}</b> ㎡ <Src :kind="selectedSpace.edited ? 'edit' : 'calc'" /></dd>
                </div>
                <div>
                  <dt>소속</dt>
                  <dd v-flash="`${spaceDevices.length}/${spaceConduits.length}`">
                    기기 {{ spaceDevices.length }}대<template v-if="spaceConduits.length"> · 덕트·배관 {{ spaceConduits.length }}개</template>
                    <Src kind="calc" />
                  </dd>
                </div>
                <div v-if="zoneOfSpace.get(selectedSpace.space.id)">
                  <dt>공조존</dt>
                  <dd>{{ zoneOfSpace.get(selectedSpace.space.id)!.name }} <Src kind="idf" /></dd>
                </div>
              </dl>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="selectedSpaceId = null">선택 해제</button>
            </div>
          </div>
          <!-- 3D 에서 고른 방의 이름을 그 자리에서 고친다(E1). 아래 표에서 같은 방을 다시 찾지 않게. -->
          <label v-if="editing" class="space-name">
            이름
            <input
              type="text"
              v-keep-typing
              :value="selectedSpace.space.longName"
              @change="applyRename(selectedSpace.space.id, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <!-- 다섯 줄 설명이 이름 칸과 나누기·합치기 사이에 있어 도구를 아래로 밀었다. 손잡이·꼭짓점 조작은 3D 아래 안내줄과
               ? 안내에 이미 있어 여기서는 이 패널에서만 알 수 있는 것(이름 → 종류)만 둔다. -->
          <p v-if="editing" class="hint">
            이름을 고치면 종류도 새 이름으로 다시 읽습니다(사전이 모르면 BIM 방 분류). 경계는 3D·평면도의 파란 손잡이로 고치고,
            넓이·설비 소속은 다시 계산됩니다.
          </p>
          <!-- 나누기·합치기(E3). 합칠 방은 벽 두께 안의 같은 층 방만 가까운 순으로 보인다. 지우기는 맨 아래. -->
          <p v-if="editing" class="space-tools">
            <button type="button" class="ghost" :disabled="selectedSpace.space.footprint.length < 4" title="바닥에 선의 두 점을 찍어 둘로 나눕니다" @click="startSplit">
              나누기
            </button>
            <label v-if="mergeCandidates.length">
              <select :value="''" aria-label="합칠 물리존" @change="mergeInto(($event.target as HTMLSelectElement).value)">
                <option value="" disabled>합칠 방 고르기…</option>
                <option v-for="c in mergeCandidates" :key="c.space.id" :value="c.space.id">
                  {{ c.space.longName || c.space.name || c.space.id }}{{ c.gap > 0.005 ? ` (벽 ${c.gap.toFixed(2)}m 너머)` : '' }}
                </option>
              </select>
            </label>
            <span v-else class="muted">맞닿은 방이 없어 합칠 수 없습니다</span>
          </p>
          <p v-if="editing && activeVertex !== null" class="vertex-tools">
            <span>꼭짓점 {{ activeVertex + 1 }}/{{ vertexCount }}</span>
            <button type="button" class="ghost" title="다음 꼭짓점과의 가운데에 넣습니다 (Insert)" @click="editVertex('insert')">꼭짓점 넣기</button>
            <button type="button" class="ghost" :disabled="vertexCount <= 3" title="Delete" @click="editVertex('delete')">꼭짓점 지우기</button>
          </p>
          <!-- 기기를 먼저 둔다. 성수 기계실은 107대 중 88개가 덕트·이음쇠라 공조기가 그 사이에 묻혔다. -->
          <p v-if="spaceDevices.length > 12" class="space-kinds muted">{{ spaceKinds }}</p>
          <ul v-if="spaceDevices.length" class="plain space-members">
            <li v-for="e in spaceDevices" :key="e.id">
              <button type="button" class="link" :title="e.name || e.ifcClass" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
              <span class="muted">{{ whatIs(e)?.label }}</span>
            </li>
          </ul>
          <details v-if="spaceConduits.length" class="space-conduits">
            <summary>덕트·배관 {{ spaceConduits.length }}개</summary>
            <ul class="plain space-members">
              <li v-for="e in spaceConduits" :key="e.id">
                <button type="button" class="link" :title="e.name || e.ifcClass" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
                <span class="muted">{{ whatIs(e)?.label }}</span>
              </li>
            </ul>
          </details>
          <p v-if="!selectedSpace.equipment.length" class="empty">이 물리존에 속한 설비가 없습니다.</p>
          <p v-if="editing" class="danger-zone">
            <button type="button" class="ghost danger" :disabled="selectedSpace.storey.spaces.length <= 1" title="이 물리존을 지웁니다. 안의 설비는 좌표로 다시 소속을 찾습니다" @click="removeSpace">
              물리존 지우기
            </button>
            <span class="muted">안의 설비는 좌표로 다시 소속을 찾습니다. Ctrl+Z 로 되돌립니다.</span>
          </p>
        </section>
        <!-- 아무것도 고르지 않았을 때. 이 파일이 어디까지 찼는지와, 무엇을 누르면 여기 무엇이 뜨는지. -->
        <section v-else key="overview" class="overview">
          <h3>이 파일</h3>
          <TierChips :tiers="currentTiers" />
          <!-- 여는 중에는 숨긴다. 건축·설비를 같이 열면 설비를 읽는 동안 건축만 보여 "설비를 덧붙이라" 가 떴다. -->
          <div v-if="pairHint && canAppend && !busy" class="pair-hint">
            <p>{{ pairHint.text }}</p>
            <button v-if="pairHint.partner" type="button" class="pick" :disabled="busy" @click="appendData(pairHint.partner!)">
              {{ baseName(pairHint.partner) }} 덧붙이기
            </button>
            <label :class="pairHint.partner ? 'ghost other' : 'pick'">
              {{ pairHint.partner ? '다른 파일 고르기' : pairHint.button }}
              <input type="file" accept=".ifc,.idf" multiple :disabled="busy" @change="onAppendPick" />
            </label>
          </div>
          <ul class="overview-counts">
            <li><b>{{ counts.storeys }}</b> 층</li>
            <li><b>{{ counts.spaces }}</b> 물리존</li>
            <li><b>{{ counts.devices }}</b> 기기</li>
            <li><b>{{ counts.conduits }}</b> 덕트·배관</li>
            <li><b>{{ counts.systems }}</b> 계통</li>
            <li><b>{{ counts.connections }}</b> 연결</li>
          </ul>
          <!-- 커스텀존(OE-OBJ-01). 3D 에서는 점선이라 누르기 어려워 여기서 고른다. -->
          <div v-if="allCustomZones.length" class="overview-zones">
            <h4>커스텀존 {{ allCustomZones.length }}</h4>
            <ul class="plain">
              <li v-for="x in allCustomZones" :key="x.zone.id">
                <button type="button" class="link" @click="selectedCustomZoneId = x.zone.id">{{ x.zone.name }}</button>
                <span class="muted">{{ x.storey.name }}</span>
              </li>
            </ul>
          </div>
          <p class="hint">
            3D에서 설비를 클릭하면 연결과 소속이, 바닥을 클릭하면 물리존 정보가 여기에 표시됩니다.
            <template v-if="warnings.length"><a href="#warnings" class="link">경고 {{ warnings.length }}건</a>, </template>
            요구사항, 검사, 표는 3D 아래에 있습니다.
          </p>
          <!-- 출처 표. 숫자·표·3D 색에 붙는 꼬리표가 무엇을 뜻하는지. -->
          <p class="src-key">
            <Src kind="bim" /> 파일에 적힌 그대로<br />
            <Src kind="calc" /> BIM 좌표·형상으로 계산<br />
            <Src kind="dict" /> 이름 사전·흐름 규칙으로 추정
          </p>
        </section>
        </Transition>

            <!-- 범례에서 고른 계통. 종류·유체는 규칙 방향과 TTL 계통 클래스를 정한다. 편집 모드에서 고친다(E8). -->
            <section v-if="selectedSystem" class="picked system-picked">
              <h3>{{ selectedSystem.name || '(이름 없는 계통)' }}</h3>
              <p v-if="systemNameAtOpen(selectedSystem.id) !== null && systemNameAtOpen(selectedSystem.id) !== selectedSystem.name" class="stats system-renamed">
                BIM 이름 {{ systemNameAtOpen(selectedSystem.id) || '(없음)' }} <Src kind="bim" /> → 고친 이름 <Src kind="edit" />
              </p>
              <p class="stats">
                구성 {{ selectedSystem.memberIds.length }}개 <Src :kind="selectedSystem.added ? 'edit' : 'bim'" /> ·
                {{ systemKindText(selectedSystem.kind, selectedSystem.fluid) }}
                <Src v-if="selectedSystem.kind || selectedSystem.kindEdited" :kind="systemKindSrc(selectedSystem)" />
                <template v-if="!selectedSystem.kindEdited && selectedSystem.fluid && selectedSystem.fluidSource === 'rule'">
                  (유체는 배관이 닿는 원천 기기로 짐작 <Src kind="dict" />)
                </template>
                <template v-else-if="!selectedSystem.kindEdited && selectedSystem.fluid && selectedSystem.fluidSource !== selectedSystem.kindSource">
                  (유체 <Src :kind="selectedSystem.fluidSource === 'bim' ? 'bim' : 'dict'" />)
                </template>
              </p>
              <p v-if="editing" class="system-edit system-name-edit">
                <label>
                  이름
                  <input
                    type="text"
                    v-keep-typing
                    :value="selectedSystem.name"
                    aria-label="계통 이름"
                    @change="renameSystemTo(selectedSystem.id, ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </p>
              <p v-if="editing" class="system-edit system-kind-edit">
                <label>
                  종류
                  <select
                    :value="selectedSystem.kind ?? ''"
                    @change="setSystemKindTo(selectedSystem.id, ($event.target as HTMLSelectElement).value || null, selectedSystem.fluid ?? null)"
                  >
                    <option value="">(모름)</option>
                    <option v-for="k in SYSTEM_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
                  </select>
                </label>
                <label v-if="selectedSystem.kind && FLUID_KINDS.includes(selectedSystem.kind)">
                  유체
                  <select
                    :value="selectedSystem.fluid ?? ''"
                    @change="setSystemKindTo(selectedSystem.id, selectedSystem.kind ?? null, (($event.target as HTMLSelectElement).value || null) as Fluid | null)"
                  >
                    <option value="">(모름)</option>
                    <option v-for="f in FLUIDS" :key="f.fluid" :value="f.fluid">{{ f.label }}</option>
                  </select>
                </label>
              </p>
              <p v-if="editing" class="system-edit">
                <button type="button" class="ghost danger" title="계통을 지웁니다. 구성원은 이 계통 자리만 잃습니다 (Ctrl+Z 로 되돌림)" @click="removeSystem(selectedSystem.id)">
                  계통 지우기
                </button>
                <span v-if="selectedSystem.added" class="muted">에디터에서 만든 계통 <Src kind="edit" /></span>
              </p>
              <p v-else-if="selectedSystem.kind && FLUID_KINDS.includes(selectedSystem.kind) && !selectedSystem.fluid" class="hint">
                유체(냉수·온수)를 모릅니다. 편집 모드에서 고르면 TTL 계통 클래스가 유체 클래스가 됩니다.
              </p>
            </section>

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
        </aside>
      </div>

      <section class="review">
        <h3 class="section-title">요약</h3>
        <p class="stats">{{ model.siteName || '(대지 이름 없음)' }} › {{ model.buildingName || '(건물 이름 없음)' }}</p>

        <!-- PRD #6 의 임포트 결과 검토 항목이다. 무엇이 만들어졌는지 숫자로 먼저 본다. -->
        <ul class="tiles">
          <li v-flash="counts.storeys"><b><Roll :value="counts.storeys" /></b><span>층</span><Src kind="bim" /></li>
          <li v-flash="counts.spaces"><b><Roll :value="counts.spaces" /></b><span>물리존</span><Src kind="bim" /></li>
          <!-- 읽지 않기로 한 피처는 0 이 아니라 "읽지 않음" 이다. 0 이면 BIM 에 없다는 말이 된다. -->
          <li v-if="skipped.has('walls')" class="skipped"><b>–</b><span>벽</span><small>읽지 않음</small></li>
          <li v-else v-flash="counts.walls"><b><Roll :value="counts.walls" /></b><span>벽</span><Src kind="bim" /></li>
          <li v-if="skipped.has('doors')" class="skipped"><b>–</b><span>문</span><small>읽지 않음</small></li>
          <li v-else v-flash="counts.doors" :class="{ wide: doorLinks.total > 0 }">
            <b><Roll :value="counts.doors" /></b><span>문</span><Src kind="bim" />
            <!-- 방-문-방. BIM 의 공간 경계가 말하면 BIM, 없으면 문 양쪽을 좌표로 짚은 계산이다. -->
            <small v-if="doorLinks.total > 0">
              방과 방을 잇는 문 {{ doorLinks.two }}
              <template v-if="doorLinks.bim"><Src kind="bim" /></template>
              <template v-if="doorLinks.calc"><Src kind="calc" /></template>
            </small>
          </li>
          <li v-if="skipped.has('windows')" class="skipped"><b>–</b><span>창문</span><small>읽지 않음</small></li>
          <li v-else v-flash="counts.windows"><b><Roll :value="counts.windows" /></b><span>창문</span><Src kind="bim" /></li>
          <li v-if="!skipped.has('walls')" v-flash="counts.loadBearingWalls"><b><Roll :value="counts.loadBearingWalls" /></b><span>내력벽</span><Src kind="bim" /></li>
          <li v-if="model.hvac" class="wide" v-flash="model.hvac.zones.length">
            <b><Roll :value="model.hvac.zones.length" /></b><span>공조존</span><Src kind="idf" />
            <small v-if="idfReport">
              방이 든 존 {{ idfReport.zonesWithSpaces }} · 존에 든 방 {{ idfReport.spacesInZones }}/{{ idfReport.spaces }} <Src kind="calc" />
              <template v-if="idfReport.straddling"> · 두 존에 걸친 방 {{ idfReport.straddling }}</template>
              <template v-if="idfReport.partial"> · 절반 못 덮인 방 {{ idfReport.partial }}</template>
            </small>
          </li>
          <!-- 설비를 하나로 세면 대수가 부푼다. 실측에서 85%가 덕트·배관이었다.
               Proxy 는 IFC 가 설비라고 말하지 않은 것을 사전이 설비로 받은 것이라 따로 센다. -->
          <li :class="{ wide: proxyDevices.ported + proxyDevices.named > 0 }" v-flash="counts.devices">
            <b><Roll :value="counts.devices" /></b><span>기기</span><Src kind="bim" />
            <small v-if="proxyDevices.ported + proxyDevices.named > 0">
              그중 Proxy
              <template v-if="proxyDevices.ported">포트 {{ proxyDevices.ported }} <Src kind="calc" /></template>
              <template v-if="proxyDevices.named">이름 {{ proxyDevices.named }} <Src kind="dict" /></template>
            </small>
          </li>
          <li v-flash="counts.conduits"><b><Roll :value="counts.conduits" /></b><span>덕트·배관</span><Src kind="bim" /></li>
          <li v-flash="counts.systems"><b><Roll :value="counts.systems" /></b><span>계통</span><Src kind="bim" /></li>
          <li :class="{ wide: connectionSources.geometry > 0 && connectionSources.port > 0 }" v-flash="counts.connections">
            <b><Roll :value="counts.connections" /></b><span>연결</span>
            <template v-if="connectionSources.geometry === 0"><Src kind="bim" /></template>
            <template v-else-if="connectionSources.port === 0"><Src kind="calc" /></template>
            <small v-else>포트 {{ connectionSources.port }} <Src kind="bim" /> · 형상 {{ connectionSources.geometry }} <Src kind="calc" /></small>
          </li>
          <li v-flash="counts.directedConnections"><b><Roll :value="counts.directedConnections" /></b><span>흐름 방향</span><Src kind="bim" /></li>
          <li v-if="ruleReport && ruleReport.oriented > 0" v-flash="ruleReport.oriented">
            <b><Roll :value="ruleReport.oriented" /></b><span>규칙 방향</span><Src kind="dict" />
          </li>
        </ul>

        <ul v-if="mergeLines.length" class="merge">
          <li class="merge-src"><Src kind="calc" /> 두 파일을 층 이름·높이와 좌표로 맞춰 합쳤습니다.</li>
          <li v-for="line in mergeLines" :key="line">{{ line }}</li>
        </ul>

        <ul v-if="warnings.length" id="warnings" class="warnings">
          <li v-for="w in warnings" :key="w">{{ w }}</li>
        </ul>

        <!-- 미배치 목록(OE-BIM-07). 좌표가 없어 3D 에 없는 설비. 층은 BIM 이 말한 것이고, TTL 에는 그 층까지만 나간다. 놓기는 편집
             팔레트의 미배치 목록에서 한다(OE-EQP-02 — 따로 [3D에서 놓기] 버튼을 두지 않는다). -->
        <Fold v-if="unplaced.length" title="미배치 설비" :meta="`${unplaced.length.toLocaleString()}대 — 좌표가 없어 3D에 없습니다`" :default-open="unplaced.length <= 30" class="unplaced">
          <ul class="unplaced-list">
            <li v-for="u in unplaced.slice(0, UNPLACED_SHOWN)" :key="u.equipment.id">
              <button type="button" class="link" @click="selectAndShow(u.equipment.id)">{{ u.equipment.name ? shortName(u.equipment.name) : '(이름 없음)' }}</button>
              <span class="muted">{{ u.storey.name }} · {{ whatIs(u.equipment)?.label ?? ifcClassLabel(u.equipment.ifcClass) ?? u.equipment.ifcClass }}</span>
            </li>
          </ul>
          <p v-if="unplaced.length > UNPLACED_SHOWN" class="muted">외 {{ (unplaced.length - UNPLACED_SHOWN).toLocaleString() }}대 — 설비 표에서 좌표 칸이 빈 것입니다</p>
        </Fold>

        <!-- 계통 없는 VAV·토출구(OE-EQP-10). BIM 에서 연 그대로는 드물고, VAV 를 새로 놓거나 계통을 지우면 생긴다. -->
        <Fold v-if="systemless.length" title="계통 없는 VAV·토출구" :meta="`${systemless.length.toLocaleString()}대 — 어느 계통에도 들지 않습니다`" :default-open="systemless.length <= 30" class="systemless">
          <ul class="unplaced-list">
            <li v-for="x in systemless.slice(0, UNPLACED_SHOWN)" :key="x.equipment.id">
              <button type="button" class="link" @click="selectAndShow(x.equipment.id)">{{ x.equipment.name ? shortName(x.equipment.name) : '(이름 없음)' }}</button>
              <span class="muted">{{ x.storeyName }} · {{ whatIs(x.equipment)?.label ?? x.equipment.ifcClass }}</span>
            </li>
          </ul>
          <p v-if="systemless.length > UNPLACED_SHOWN" class="muted">외 {{ (systemless.length - UNPLACED_SHOWN).toLocaleString() }}대</p>
        </Fold>

        <!-- 고객사 BIM 요구사항(정본 4장)에 대 본 것. IDS 와 달리 "다른 자리에 있다(우리는 읽는다)"를 따로 센다. -->
        <Fold v-if="currentRequirements.length" title="요구사항" :meta="requirementsMeta" :default-open="false" class="requirements">
          <table class="req-table">
            <thead>
              <tr><th>#</th><th>요구</th><th>상태</th><th class="num" title="표준 자리 · 다른 자리 / 전체">개수</th><th>설명</th><th>고객사에 할 요청</th></tr>
            </thead>
            <tbody v-for="g in requirementGroups" :key="g.level">
              <tr class="req-group">
                <th colspan="6">{{ g.level }}{{ g.level === '필수' ? ' — 없으면 대신 채울 방법이 없음' : ' — 없으면 계산·사전·수작업으로 채움' }}</th>
              </tr>
              <tr v-for="r in g.rows" :key="r.id" v-flash="`${r.state}:${r.counts?.standard}:${r.counts?.elsewhere}`">
                <td class="mono">{{ r.id }}</td>
                <td>{{ r.title }}</td>
                <td><span :class="['req-state', r.state]">{{ REQUIREMENT_STATE[r.state] }}</span></td>
                <td class="num mono">
                  <template v-if="r.counts && r.counts.of">
                    <Roll :value="r.counts.standard" /><template v-if="r.counts.elsewhere"> · <Roll :value="r.counts.elsewhere" /></template> / {{ r.counts.of }}
                    <Meter
                      :parts="[
                        { value: r.counts.standard / r.counts.of, tone: 'accent' },
                        { value: r.counts.elsewhere / r.counts.of, tone: 'soft' },
                      ]"
                      :label="`표준 자리 ${r.counts.standard}, 다른 자리 ${r.counts.elsewhere} / ${r.counts.of}`"
                    />
                  </template>
                </td>
                <td class="muted">{{ r.note }}</td>
                <td class="req-ask" :class="{ setting: r.state === 'elsewhere' || (r.counts?.elsewhere ?? 0) > 0 }">{{ r.ask || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p class="hint">
            표준 자리는 IDS(<span class="mono">docs/requirements.ids</span>) 검사도 통과합니다. 다른 자리는 값이 있어 읽을 수 있지만
            표준 자리가 아니라서, 고객사에 내보내기 설정을 바꿔 달라고 합니다(요청 칸에 무엇을 바꿀지). 기준은 정본 4장을 보세요.
          </p>
        </Fold>

        <!-- 판본 비교(PRD #6, R13). 이전 판본과 짝지어 무엇이 바뀌었는지와, GUID 가 판본 사이에 남는지를 잰다. -->
        <Fold
          title="판본 비교"
          :meta="versionDiff ? `이전 판본: ${versionDiff.name}` : '이전 판본과 무엇이 바뀌었는지 봅니다'"
          :default-open="false"
          class="versions"
        >
          <p class="version-pick">
            <label class="ghost file-pick">
              {{ versionDiff ? '다른 판본' : '이전 판본 열기' }}
              <input type="file" accept=".ifc" :disabled="versionBusy || busy" @change="onVersionPick" />
            </label>
            <span v-if="versionBusy" class="muted">여는 중…</span>
            <span v-else class="muted">같은 건물의 이전 IFC를 여세요. 비교에만 쓰고, 화면과 내보내기는 지금 파일 그대로입니다.</span>
          </p>
          <p v-if="versionError" class="edit-notice inline" role="alert">{{ versionError }}</p>
          <template v-if="versionDiff">
            <p v-if="versionDiff.diff.storeyScale" class="edit-notice inline" role="alert">
              이름이 같은 층의 높이가 이전 판본의 {{ ratioLabel(versionDiff.diff.storeyScale.ratio) }}입니다({{
                versionDiff.diff.storeyScale.storeys.slice(0, 3).map(([n, x, y]) => `${n} ${+x.toPrecision(4)}m → ${+y.toPrecision(4)}m`).join(', ')
              }}). {{ { first: '층간 높이로 보면 이전 판본', second: '층간 높이로 보면 지금 파일', none: '한 판본' }[versionDiff.diff.storeyScale.suspect ?? 'none'] }}의 길이 단위 선언이 실제 값과 다른 것 같습니다({{ versionDiff.diff.storeyScale.what }}, 요구사항 R6).
            </p>
            <table class="version-sum">
              <thead>
                <tr>
                  <th></th>
                  <th class="num">이전 → 지금</th>
                  <th class="num">양쪽에 있는 것</th>
                  <th class="num" title="양쪽에 있는 것 중 GUID가 그대로인 비율(요구사항 R13)">GUID 유지</th>
                  <th>그중 GUID가 바뀐 것 <Src kind="calc" /></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="[label, k] in [['물리존', versionDiff.diff.spaces], ['설비', versionDiff.diff.equipment]] as const" :key="label">
                  <th>{{ label }}</th>
                  <td class="num mono">{{ k.prevCount }} → {{ k.nextCount }}</td>
                  <td class="num mono">{{ k.by.guid + k.by.revitId + k.by.name + k.by.position }}</td>
                  <td class="num mono">
                    {{ k.by.guid + k.by.revitId + k.by.name + k.by.position ? `${Math.round((k.by.guid / (k.by.guid + k.by.revitId + k.by.name + k.by.position)) * 100)}%` : '—' }}
                  </td>
                  <td>
                    <template v-if="k.by.revitId + k.by.name + k.by.position">
                      <b class="mono">{{ k.by.revitId + k.by.name + k.by.position }}</b>
                      <span class="muted">
                        ({{ (['revitId', 'name', 'position'] as const).filter((x) => k.by[x]).map((x) => `${MATCH_KEY_BY[x]} ${k.by[x]}개`).join(', ') }} 찾음)
                      </span>
                    </template>
                    <span v-else class="muted">없음</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="hint">
              GUID가 바뀌어도 편집 파일은 Revit 요소 ID·이름·위치로 찾아 적용합니다. 다만 DT 쪽에서는 다른 id가 됩니다(요구사항 R13 — 어느 것인지는
              [GUID가 바뀐 것] 목록, 고객사에 할 요청은 요구사항 칸의 R13).
              기준 하나에 여러 개가 걸리면 짝짓지 않고 새것·없어진 것으로 셉니다.
            </p>
            <div class="version-tabs" role="tablist">
              <button
                v-for="l in versionLists"
                :key="l.key"
                type="button"
                role="tab"
                :class="['ghost', { on: versionView === l.key }]"
                :aria-selected="versionView === l.key"
                :disabled="!l.rows.length"
                @click="versionView = l.key"
              >
                {{ l.label }} <b class="mono">{{ l.rows.length }}</b>
              </button>
            </div>
            <div v-if="versionRows.length" class="table-box">
              <table class="version-rows">
                <tbody>
                  <tr v-for="r in versionRows.slice(0, EDIT_LIMIT)" :key="r.id">
                    <td>
                      <button v-if="r.target === 'equipment'" type="button" class="link" @click="selectAndShow(r.id)">{{ r.name }}</button>
                      <span v-if="r.target === 'equipment' && whatIs(equipmentById.get(r.id))" class="muted what">
                        {{ whatIs(equipmentById.get(r.id))!.label }}
                      </span>
                      <button v-else-if="r.target === 'space'" type="button" class="link" @click="showSpace(r.id)">{{ r.name }}</button>
                      <span v-else>{{ r.name }}</span>
                    </td>
                    <td class="muted">{{ r.detail }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-if="versionRows.length > EDIT_LIMIT" class="hint">처음 {{ EDIT_LIMIT }}개만 표시합니다.</p>
            </div>
          </template>
        </Fold>
      </section>

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
            DT에서 쓰려면 연결돼 있어야 하는 것을 규칙별로 검사합니다. 원천·말단 구분은 <Src kind="dict" />, 흐름과 소속에는
            <Src kind="calc" /> 추정이 섞여 있습니다<template v-if="showRules && hasRules">(규칙 방향 포함)</template>. 줄을 누르면 위반한 것이
            3D에 표시되고, <kbd>N</kbd>으로 하나씩 넘어갑니다.
          </p>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>규칙</th>
                <th class="num">통과</th>
                <th class="num">위반</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="c in checks"
                :key="c.key"
                v-flash="c.failed.length"
                :class="{ chosen: openCheckKey === c.key, skipped: !!c.skipped }"
                @click="!c.skipped && c.failed.length && toggleCheck(c.key)"
              >
                <td class="state">
                  <i :class="c.skipped || c.total === 0 ? 'none' : c.failed.length ? 'warn' : 'ok'"></i>
                </td>
                <td>
                  {{ c.rule }}
                  <small class="muted">{{ c.skipped ?? (c.total === 0 ? '이 파일에는 검사할 대상이 없습니다.' : `영향: ${c.why}`) }}</small>
                </td>
                <td class="num mono">
                  <template v-if="!c.skipped && c.total">
                    <Roll :value="c.total - c.failed.length" /> / {{ c.total }}
                    <Meter
                      :parts="[{ value: (c.total - c.failed.length) / c.total, tone: c.failed.length ? 'warn' : 'ok' }]"
                      :label="`통과 ${c.total - c.failed.length} / ${c.total}`"
                    />
                  </template>
                  <span v-else class="muted">—</span>
                </td>
                <td class="num">
                  <button
                    v-if="!c.skipped && c.failed.length"
                    type="button"
                    class="link mono"
                    :aria-pressed="openCheckKey === c.key"
                  >
                    <Roll :value="c.failed.length" :count-up="false" />
                  </button>
                  <span v-else class="muted">·</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="openCheck && openCheck.failed.length" class="check-list">
            <h4>{{ openCheck.rule }} <span class="muted">위반 {{ openCheck.failed.length }}개(3D에 표시)</span></h4>
            <ul class="plain">
              <li v-for="id in openCheck.failed.slice(0, CHECK_LIMIT)" :key="id">
                <button type="button" class="link" :title="equipmentById.get(id)?.name" @click="selectAndShow(id)">
                  {{ shortName(equipmentById.get(id)?.name || equipmentById.get(id)?.ifcClass || id) }}
                </button>
                <span v-if="whatIs(equipmentById.get(id))" class="what">{{ whatIs(equipmentById.get(id))!.label }}</span>
                <div v-if="failReasons.get(id)?.text" class="muted reason">
                  {{ failReasons.get(id)!.text }}
                  <button v-if="failReasons.get(id)!.fix" type="button" class="ghost fix" @click="applyFix(id, failReasons.get(id)!.fix!)">
                    {{ fixLabel(failReasons.get(id)!.fix!) }}
                  </button>
                </div>
              </li>
            </ul>
            <p v-if="openCheck.failed.length > CHECK_LIMIT" class="hint">
              {{ CHECK_LIMIT }}개만 표시합니다(전체 {{ openCheck.failed.length }}개). 3D에는 모두 표시했습니다.
            </p>
          </div>
        </Fold>

        <!-- 규칙 방향을 계통별로. 확정할 것이 무엇이 남았는지와 그 근거(포트와의 일치율)를 한 표로 본다. -->
        <Fold
          v-if="ruleSystems.length"
          title="규칙 방향 확정 (계통별)"
          :meta="`계통 ${ruleSystems.length}개 · 확정 ${ruleSystems.filter((r) => r.confirmed).length}개`"
          :default-open="false"
          class="rule-systems"
        >
          <p class="hint">
            <Src kind="dict" /> 계통 종류와 설비 종류로 추정한 방향입니다. 확정한 계통만 brick:feeds로 내보냅니다. 일치율은
            포트(BIM)에 방향이 있는 연결과 비교한 값이고, 비교할 연결이 없으면 비워 둡니다. 이름을 누르면 3D에
            그 계통만 표시합니다.
          </p>
          <p v-if="editing" class="bulk-confirm">
            <label>
              포트와
              <select v-model.number="bulkThreshold" aria-label="한꺼번에 확정할 일치율">
                <option :value="98">98%</option>
                <option :value="95">95%</option>
                <option :value="90">90%</option>
                <option :value="80">80%</option>
              </select>
              이상 맞는 계통
            </label>
            <button type="button" class="ghost" :disabled="!bulkCandidates.length" @click="confirmMatching">
              {{ bulkCandidates.length }}개 한꺼번에 확정
            </button>
            <span class="muted">대 본 연결이 {{ BULK_MIN_CHECKED }}개 넘는 계통만. 비교할 것이 없는 계통은 하나씩 확정합니다.</span>
          </p>
          <table>
            <thead>
              <tr>
                <th>계통 <Src kind="bim" /></th>
                <th>종류 <Src kind="dict" /></th>
                <th class="num">규칙 방향</th>
                <th class="num">포트와 일치</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in ruleSystems" :key="r.id" v-flash="`${r.confirmed}:${r.pct}:${r.count}`" :class="{ chosen: selectedSystemId === r.id }">
                <td class="sys">
                  <i :style="{ background: r.color ?? 'transparent' }"></i>
                  <button type="button" class="link" :aria-pressed="selectedSystemId === r.id" @click="toggleSystem(r.id)">
                    {{ r.name }}
                  </button>
                </td>
                <td :class="{ muted: !r.kind }">{{ r.kind || '모름' }}</td>
                <td class="num mono"><Roll :value="r.count" /></td>
                <td class="num mono">
                  <template v-if="r.pct !== null">
                    <b :class="{ low: r.pct < 80 }"><Roll :value="r.pct" />%</b> <span class="muted">{{ r.agree }}/{{ r.checked }}</span>
                    <Meter :parts="[{ value: r.pct / 100, tone: r.pct < 80 ? 'warn' : 'accent' }]" :label="`포트와 일치 ${r.pct}%`" />
                  </template>
                  <span v-else class="muted">—</span>
                </td>
                <td class="rule-state">
                  <span v-if="r.confirmed" class="confirmed">확정함</span>
                  <button v-else-if="editing" type="button" class="ghost" @click="confirmRule(r.id, r.name)">확정</button>
                  <span v-else class="muted">편집 모드에서 확정</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="ruleSystems.some((r) => !r.confirmed && r.pct !== null && r.pct < 80)" class="hint">
            일치율이 80% 미만인 계통은 규칙이 잘 맞지 않습니다. 확정하기 전에 3D에서 흐름을 확인하세요.
          </p>
        </Fold>

        <Fold title="층별 요약" :meta="`${model.storeys.length}개 층 · 완료 ${storeysDoneCount}/${model.storeys.length}`" class="storeys">
          <!-- 층 단위 진행(OE-MAN-06). 완료한 층·고친 층·남은 층. -->
          <p class="storey-progress hint" role="status">
            완료 <b>{{ storeysDoneCount }}/{{ model.storeys.length }}</b>층
            <template v-if="storeyProgressRows.some((p) => p.state === 'changed')">
              · <span class="height-mismatch">완료 뒤 고침 {{ storeyProgressRows.filter((p) => p.state === 'changed').map((p) => p.name).join(', ') }}</span>
            </template>
            <template v-if="storeyProgressRows.some((p) => p.state === 'todo')">
              · 남은 층 {{ storeyProgressRows.filter((p) => p.state === 'todo').map((p) => p.name).join(', ') }}
            </template>
          </p>
          <table>
            <thead>
              <tr>
                <th>층</th>
                <th class="num">높이</th>
                <th class="num">층고</th>
                <th class="num" title="반자(천장 마감면) 높이 h_c, 층 바닥 기준">반자</th>
                <th>물리존</th>
                <th class="num">넓이 합</th>
                <th class="num">벽</th>
                <th class="num">설비</th>
                <th>진행</th>
                <th aria-label="층 단위 구축"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in model.storeys" :key="s.id">
                <td>{{ s.name }}</td>
                <td class="num mono">{{ (Math.abs(s.elevation) < 0.005 ? 0 : s.elevation).toFixed(2) }} m</td>
                <!-- 층고(OE-BIM-02). 출처 BIM 이면 그 값, 계산이면 윗층 바닥과의 차. 둘이 다르면 계산한 값도 옆에 보인다. -->
                <td class="num mono storey-height">
                  <template v-if="storeyHeightOf.get(s.id)">
                    <span :title="storeyHeightTitle(storeyHeightOf.get(s.id)!)">{{ meters(storeyHeightOf.get(s.id)!.value) }}</span>
                    <Src :kind="storeyHeightOf.get(s.id)!.source" />
                    <span v-if="storeyHeightOf.get(s.id)!.mismatch" class="height-mismatch" :title="storeyHeightTitle(storeyHeightOf.get(s.id)!)">
                      계산 {{ meters(storeyHeightOf.get(s.id)!.calc!) }}
                    </span>
                  </template>
                  <span v-else class="muted" title="맨 위층이고 BIM 이 층 높이를 적지 않았습니다. 지어내지 않습니다.">모름</span>
                </td>
                <!-- 반자 높이(OE-EQP-03). 모르면 0 이나 층고로 채우지 않고 입력을 받는다. 후보(계산)는 입력창 기본값이다. -->
                <td class="num mono storey-ceiling">
                  <template v-if="ceilingEditing === s.id">
                    <input
                      v-model="ceilingInput"
                      type="number"
                      step="0.05"
                      min="0.3"
                      class="ceiling-input"
                      :aria-label="`${s.name} 반자 높이(m)`"
                      @keydown.enter.prevent="saveCeiling(s.id, Number(ceilingInput))"
                      @keydown.esc.stop="ceilingEditing = null"
                    />
                    m
                    <button type="button" class="link" @click="saveCeiling(s.id, Number(ceilingInput))">확인</button>
                    <button type="button" class="link" @click="ceilingEditing = null">취소</button>
                  </template>
                  <template v-else-if="ceilingOf(s)">
                    <span :title="ceilingTitle(s)">{{ meters(ceilingOf(s)!.height) }}</span>
                    <Src :kind="ceilingOf(s)!.source" />
                    <span v-if="ceilingGuessApart(s)" class="height-mismatch" :title="ceilingTitle(s)">후보 {{ meters(ceilingGuessOf.get(s.id)!.height) }}</span>
                    <button type="button" class="link" :aria-label="`${s.name} 반자 높이 고치기`" @click="startCeiling(s.id)">고치기</button>
                    <button v-if="s.ceilingSet != null" type="button" class="link" @click="saveCeiling(s.id, null)">{{ s.ceiling ? 'BIM 값으로' : '지우기' }}</button>
                  </template>
                  <template v-else>
                    <span class="muted" :title="ceilingTitle(s)">모름</span>
                    <button type="button" class="link" :aria-label="`${s.name} 반자 높이 입력`" @click="startCeiling(s.id)">입력</button>
                  </template>
                </td>
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
                <td class="num mono storey-equipment">{{ s.equipment.length }}</td>
                <td class="storey-done" :data-state="progressById.get(s.id)?.state">
                  <template v-if="progressById.get(s.id)?.state === 'done'">
                    <span class="done-mark" :title="`완료 표시: ${doneTime(progressById.get(s.id)?.at)}`">완료 ✓</span>
                    <button type="button" class="link" :aria-label="`${s.name} 완료 지우기`" @click="setStoreyDone(s.id, false)">지우기</button>
                  </template>
                  <template v-else-if="progressById.get(s.id)?.state === 'changed'">
                    <span class="height-mismatch" :title="`${doneTime(progressById.get(s.id)?.at)} 에 완료한 뒤 이 층을 고쳤습니다`">완료 뒤 고침</span>
                    <button type="button" class="link" :aria-label="`${s.name} 다시 완료`" @click="setStoreyDone(s.id, true)">다시 완료</button>
                  </template>
                  <button v-else type="button" class="ghost" :aria-label="`${s.name} 완료 표시`" @click="setStoreyDone(s.id, true)">완료 표시</button>
                </td>
                <td class="storey-build">
                  <button
                    type="button"
                    class="ghost"
                    :aria-label="`${s.name} 구축`"
                    title="이 층만 온톨로지로 받습니다(TTL·GeoJSON 한 쌍). 다른 층을 가리키는 줄은 id 로 남습니다."
                    :disabled="busy"
                    :class="{ done: justDone === `build:${s.id}` }"
                    @click="buildStorey(s.id)"
                  >
                    구축
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- 설치면 판정(OE-EQP-03). 설비 z(층 바닥 기준)로 판정한다. 허용 설치면 밖인 설비를 따로 보인다(Q9). -->
          <p v-if="surfaceRows.length" class="surface-summary hint">
            설치면 판정 <Src kind="calc" /> 천장 {{ surfaceCounts.ceiling }} · 플레넘 {{ surfaceCounts.plenum }} · 바닥 {{ surfaceCounts.floor }} · 벽 {{ surfaceCounts.wall }} ·
            미정 {{ surfaceCounts.unknown }}
            <template v-if="model.storeys.some((x) => !ceilingOf(x) && x.equipment.length)">
              <span class="muted">(반자 높이를 모르는 층은 천장을 판정하지 않습니다)</span>
            </template>
          </p>
          <details v-if="surfaceMismatch.length" class="surface-mismatch">
            <summary><span class="height-mismatch">허용 설치면 밖 {{ surfaceMismatch.length }}대</span> — 판정한 면이 종류의 허용 설치면(사전)에 없습니다</summary>
            <ul>
              <li v-for="r in surfaceMismatch.slice(0, 50)" :key="r.equipment.id">
                <button type="button" class="link" @click="select(r.equipment.id)">{{ r.equipment.name }}</button>
                <span class="muted"> {{ r.storey.name }} · {{ equipmentKind(r.equipment.kind)?.label }} · 판정 {{ JUDGED_LABEL[r.judged!] }} (z {{ (r.equipment.position![2] - r.storey.elevation).toFixed(2) }}m) · 허용 {{ allowedLabel(r.equipment.kind) }}</span>
              </li>
              <li v-if="surfaceMismatch.length > 50" class="muted">외 {{ surfaceMismatch.length - 50 }}대</li>
            </ul>
          </details>
        </Fold>

        <Fold
          v-if="kindSummary"
          title="종류와 관제점 후보"
          :meta="`기기 종류 ${kindSummary.kinds.length}종 · 모름 ${kindSummary.unknown}대 · 관제점 후보 ${kindSummary.points.reduce((n, k) => n + k.count, 0)}`"
          :default-open="false"
          class="kinds"
        >
          <p class="hint">
            <Src kind="dict" /> Revit 패밀리 이름으로 종류와 Brick 클래스를 정했습니다. 사전에 없는 이름은 비워
            둡니다<template v-if="kindEditLines.length">. <Src kind="edit" /> 직접 정한 패밀리
            {{ kindEditLines.length }}개가 포함되어 있습니다</template>.
          </p>
          <!-- 편집 모드에서만. 사전이 모르는 기기를 패밀리로 묶어 대수 순으로. 한 번 고르면 그 패밀리 전부에 붙는다. -->
          <p v-if="editing && kindWarning" class="edit-notice inline" role="alert">{{ kindWarning }}</p>
          <div v-if="editing && unknownTypes.length" class="unknown-types">
            <h4>
              종류를 모르는 패밀리 {{ unknownTypes.length }}개
              <span class="muted">(기기 {{ unknownTypes.reduce((n, t) => n + t.count, 0) }}대)</span>
            </h4>
            <p class="hint">한 번 고르면 같은 패밀리(크기만 다른 유형 포함) 전체에 적용됩니다.</p>
            <table>
              <tbody>
                <tr v-for="t in unknownTypes.slice(0, TYPE_LIMIT)" :key="t.key">
                  <td class="names" :title="t.label">
                    {{ t.label }}<small v-if="t.types.size > 1" class="muted"> · 유형 {{ t.types.size }}개</small>
                  </td>
                  <td class="num mono">{{ t.count }}</td>
                  <td class="muted">{{ t.ifcClass }} <Src kind="bim" /></td>
                  <td class="clues">
                    <template v-if="familyClues.get(t.key)">
                      <span>계통: {{ familyClues.get(t.key)!.system }}</span>
                      <span>이웃: {{ familyClues.get(t.key)!.neighbors }}</span>
                      <span>위치: {{ familyClues.get(t.key)!.place }}</span>
                    </template>
                    <span v-if="kindSuggestions.get(t.key)?.length" class="suggest">
                      후보:
                      <button
                        v-for="s in kindSuggestions.get(t.key)"
                        :key="s.kind"
                        type="button"
                        class="link"
                        :title="suggestionWhy(s)"
                        @click="setKind(t.key, s.kind, t.label)"
                      >{{ equipmentKind(s.kind)?.label }}</button>
                      <Src kind="dict" />
                    </span>
                  </td>
                  <td>
                    <select :aria-label="`${t.label} 의 종류`" @change="pickTypeKind($event, t.key, t.label)">
                      <option value="" selected>(모름)</option>
                      <optgroup v-for="g in KIND_GROUPS" :key="g.label" :label="g.label">
                  <option v-for="k in g.kinds" :key="k.kind" :value="k.kind">{{ k.label }}</option>
                </optgroup>
                    </select>
                  </td>
                  <td><button type="button" class="link" @click="selectAndShow(t.sampleId)">하나 보기</button></td>
                </tr>
              </tbody>
            </table>
            <p v-if="unknownTypes.length > TYPE_LIMIT" class="hint">
              대수가 많은 {{ TYPE_LIMIT }}개만 표시합니다(전체 {{ unknownTypes.length }}개).
            </p>
          </div>
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
              <p v-if="!kindSummary.points.length" class="empty">감지기·CCTV가 없습니다.</p>
              <ul v-else class="plain">
                <li v-for="k in kindSummary.points" :key="k.label">
                  {{ k.label }} <b class="mono">{{ k.count }}</b>
                  <span class="muted"> · 소속 방 {{ k.located }}</span>
                </li>
              </ul>
              <p class="hint">위치와 소속 방은 있습니다. 관제점 ID는 BAS에서 받아 연결해야 합니다.</p>
              <h4>방 종류</h4>
              <p class="muted">
                {{ kindSummary.roomsTotal }}개 중 {{ kindSummary.roomsKnown }}개를 분류했습니다<template v-if="kindSummary.roomsKnown">
                  (OmniClass로 {{ kindSummary.roomsFromBim }}개 <Src kind="bim" />, 이름으로 {{ kindSummary.roomsKnown - kindSummary.roomsFromBim }}개 <Src kind="dict" />)</template>.
              </p>
              <ul class="plain">
                <li v-for="[label, n] in kindSummary.rooms" :key="label">{{ label }} <b class="mono">{{ n }}</b></li>
              </ul>
              <h4>계통 종류</h4>
              <ul class="plain">
                <li v-for="[label, n] in kindSummary.systems" :key="label">{{ label }} <b class="mono">{{ n }}</b></li>
              </ul>
              <p v-if="ruleReport && ruleReport.agree + ruleReport.disagree > 0" class="hint">
                규칙으로 방향을 정한 연결 {{ ruleReport.oriented }}개. 포트 방향이 있는 연결 {{ ruleReport.agree + ruleReport.disagree }}개로 검증하면
                {{ Math.round((ruleReport.agree / (ruleReport.agree + ruleReport.disagree)) * 100) }}% 일치합니다.
              </p>
            </div>
          </div>
        </Fold>

        <!-- 공조존(IDF, F12). 존마다 든 방과 담당(말단 → 원천). IDF 가 말한 것이라 규칙 방향과 달리 확정 없이 나간다. -->
        <Fold v-if="zoneRows.length" title="공조존 (IDF)" :meta="`${zoneRows.length}개 · ${model.hvac!.source}`" :default-open="zoneRows.length <= SMALL">
          <p class="hint">
            IDF 의 Zone 이 공조존이고, 존 설비 목록 → 말단 → 공조기(급기 분기)·실외기(실내기 목록)로 담당을 잇습니다. 방은 안쪽 점이
            존 바닥 안에 들면 그 존의 일부입니다. 이름이 BIM 설비 하나와 맞는 IDF 설비는 BIM 설비에 담당 관계를 얹습니다
            (IDF 설비 {{ idfReport?.equipment ?? model.hvac!.equipment.length }}대 중 {{ idfReport?.matchedEquipment ?? model.hvac!.equipment.filter((e) => e.bimId).length }}대).
            바닥면 넓이는 IDF 가 적은 넓이보다 큰 것이 보통입니다(DesignBuilder 는 순 넓이를 적고 바닥면은 벽 중심선까지 그립니다).
          </p>
          <div class="table-box">
            <table class="equipment zones">
              <thead>
                <tr><th>공조존</th><th>층</th><th class="num">바닥면 ㎡</th><th class="num">IDF ㎡</th><th>든 방</th><th>말단</th><th>원천</th></tr>
              </thead>
              <tbody>
                <tr v-for="z in zoneRows.slice(0, ZONE_LIMIT)" :key="z.id">
                  <td>{{ z.name }}</td>
                  <td>{{ z.storey }}</td>
                  <td class="num mono">{{ z.area.toFixed(1) }}</td>
                  <td class="num mono">{{ z.declared?.toFixed(1) ?? '' }}</td>
                  <td :title="z.spaces.join(', ')">{{ z.spaces.length ? z.spaces.slice(0, 3).join(', ') + (z.spaces.length > 3 ? ` 외 ${z.spaces.length - 3}` : '') : '' }}</td>
                  <td :title="z.terminals.join(', ')">{{ z.terminals.slice(0, 2).join(', ') }}{{ z.terminals.length > 2 ? ` 외 ${z.terminals.length - 2}` : '' }}</td>
                  <td :title="z.sources.join(', ')">{{ z.sources.join(', ') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="zoneRows.length > ZONE_LIMIT" class="hint">{{ ZONE_LIMIT }}개만 보입니다.</p>
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
            <Src kind="calc" /> 원천에서 흐름을 따라 말단까지 가서, 말단이 있는 방을 모았습니다. 급기는 하류, 환기·배기는 상류로
            찾고 다른 원천을 만나면 멈춥니다. 추정값이라 TTL로 내보내지 않습니다.
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
                <td><button type="button" class="link" @click="selectAndShow(r.id)">{{ r.name }}</button></td>
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
            말단이 많은 {{ SERVICE_LIMIT }}대만 표시합니다(전체 {{ serviceSummary.rows.length }}대).
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
            <label>
              설치면
              <select v-model="surfaceFilter" aria-label="설치면으로 거르기">
                <option value="">전체</option>
                <option value="ceiling">천장</option>
                <option value="floor">바닥</option>
                <option value="wall">벽</option>
                <option value="none">미정</option>
              </select>
            </label>
            <label class="grow">
              이름
              <input ref="searchInput" v-model="editQuery" type="search" :placeholder="editing ? '물리존·설비 이름이나 종류  ( / )' : '설비 이름·종류나 소속 방 이름  ( / )'" />
            </label>
            <span class="muted">{{ editing ? '아래 두 표에 함께 적용됩니다.' : '설비 목록에 적용됩니다.' }}</span>
          </div>

          <!-- 물리존 하나를 한 줄에서 고친다. 이름(E1)과 경계(E2)를 두 목록으로 나눴더니 같은 방을 두 번 찾아야 했다.
               긴 표는 제 상자 안에서 스크롤하고 머리줄은 붙어 있다 — 페이지가 표만큼 길어지면 3D 로 돌아가기가 멀다. -->
          <Fold v-if="editing" title="물리존 이름·경계 (E1 · E2)" :meta="`${narrowed ? `찾은 것 ${editSpaces.length} / ` : ''}${counts.spaces}개`" :default-open="counts.spaces <= SMALL" :reveal="!!editQuery.trim() && editSpaces.length > 0">
            <p class="hint">
              3D에서 바닥을 클릭하면 오른쪽 패널에서도 고칠 수 있습니다. 꼭짓점을 고치면 넓이와 설비 소속이 다시 계산됩니다.
            </p>
            <div class="table-box">
              <table class="spaces-edit">
                <thead>
                  <tr>
                    <th>층</th>
                    <th>이름</th>
                    <th>종류</th>
                    <th>방 번호</th>
                    <th class="num">넓이</th>
                    <th>꼭짓점 (x, y)</th>
                  </tr>
                </thead>
                <tbody class="rows">
                  <tr v-for="{ storey, space: sp } in editSpaces.slice(0, editLimit)" :key="sp.id" :class="{ chosen: sp.id === selectedSpaceId }">
                    <td><span class="tag mono">{{ storey.name }}</span></td>
                    <td>
                      <input
                        type="text"
                        v-keep-typing
                        :value="sp.longName"
                        :aria-label="`${sp.name} 이름`"
                        @change="applyRename(sp.id, ($event.target as HTMLInputElement).value)"
                      />
                    </td>
                    <!-- 이름을 고치면 따라 바뀐다(renameSpace). 옆에 두어야 고친 자리에서 바로 보인다. -->
                    <td class="space-kind">
                      <template v-if="roomKind(sp.kind)">{{ roomKind(sp.kind)!.label }} <Src :kind="sp.kindSource === 'bim' ? 'bim' : 'dict'" /></template>
                      <span v-else class="muted">모름</span>
                    </td>
                    <td class="mono muted">{{ sp.name }}</td>
                    <td class="num mono">{{ sp.areaM2.toFixed(1) }} ㎡</td>
                    <td class="vertices">
                      <!-- 닫는 점은 첫 점과 같으므로 보여 주지 않는다. 두 번 고치게 된다. -->
                      <span v-for="(p, i) in sp.footprint.slice(0, -1)" :key="i" class="vertex">
                        <input
                          class="coord mono"
                          type="number"
                          step="0.1"
                          v-keep-typing
                          :value="p[0]"
                          @change="applyVertex(sp.id, i, 0, ($event.target as HTMLInputElement).value, p)"
                        />
                        <input
                          class="coord mono"
                          type="number"
                          step="0.1"
                          v-keep-typing
                          :value="p[1]"
                          @change="applyVertex(sp.id, i, 1, ($event.target as HTMLInputElement).value, p)"
                        />
                      </span>
                      <span v-if="!sp.footprint.length" class="muted">
                        외곽선 없음 · <button type="button" class="link" @click="startDraw(sp.id)">3D에서 그리기</button>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="editSpaces.length > editLimit" class="hint more">
              {{ editLimit }}개만 표시합니다(전체 {{ editSpaces.length }}개). 층이나 이름으로 좁히거나
              <button type="button" class="link" @click="editLimit += EDIT_LIMIT">더 보기</button>
            </p>
          </Fold>
          <p v-if="editing && selfIntersecting" class="error" role="alert">
            경계선이 서로 교차합니다. 이 상태에서는 넓이와 소속이 맞지 않습니다.
          </p>

          <Fold
            :title="editing ? '설비 위치와 소속 (E5 · E6)' : '설비 목록'"
            :meta="`${narrowed ? `찾은 것 ${editEquipment.length} / ` : ''}기기 ${counts.devices} · 덕트·배관 ${counts.conduits}`"
            :default-open="counts.equipment <= SMALL"
            :reveal="!!editQuery.trim() && editEquipment.length > 0"
          >
            <div class="table-box">
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
                <tr v-for="e in editEquipment.slice(0, editLimit)" :key="e.id" :class="{ chosen: e.id === selectedId || group.includes(e.id) }">
                  <td>
                    <!-- 표에서 고른 것과 3D 에서 고른 것이 같은 선택이다. 두 화면이 따로 놀면
                         설비 목록에서 찾은 것을 3D 에서 다시 찾아야 한다. -->
                    <button type="button" class="link" @click="editing && $event.shiftKey ? toggleGroup(e.id) : selectAndShow(e.id)">{{ e.name || e.ifcClass }}</button>
                  </td>
                  <td class="muted">
                    {{ e.ifcClass }}<template v-if="whatIs(e)"> · {{ whatIs(e)!.label }} <Src :kind="whatIs(e)!.src" /></template>
                  </td>
                  <td v-for="axis in [0, 1, 2]" :key="axis" class="num">
                    <span v-if="!editing" class="mono">{{ e.position ? e.position[axis].toFixed(2) : '—' }}</span>
                    <input
                      v-else
                      class="coord mono"
                      type="number"
                      step="0.1"
                      v-keep-typing
                      :value="e.position ? mmOf(e.position[axis]) : (positionDrafts.get(e.id)?.[axis] ?? '')"
                      placeholder="—"
                      @change="applyMove(e.id, axis as 0 | 1 | 2, ($event.target as HTMLInputElement).value, e.position, $event.target as HTMLInputElement)"
                    />
                  </td>
                  <!-- 좌표 출처. 배치점이 형상에서 떨어져 형상 중심을 쓴 것(계산)과 사람이 옮긴 것(편집)을 가른다. -->
                  <td><Src v-if="e.position" :kind="positionSrc(e)" /></td>
                  <td :class="{ muted: !e.spaceId }">
                    {{ spaceNameOf(e.spaceId) }}
                    <Src v-if="e.spaceId" :kind="spaceSrc(e)" />
                    <small v-if="editing && positionDrafts.has(e.id)" class="draft-note">x·y·z를 모두 넣어야 옮겨집니다</small>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
            <p v-if="editEquipment.length > editLimit" class="hint more">
              {{ editLimit }}대만 표시합니다(전체 {{ editEquipment.length }}대). 층이나 이름으로 좁히거나
              <button type="button" class="link" @click="editLimit += EDIT_LIMIT">더 보기</button>
            </p>
            <p v-if="counts.equipment === 0" class="empty">이 BIM에는 설비가 없습니다.</p>
            <p v-else-if="editEquipment.length === 0" class="empty">
              {{ editQuery.trim() ? `"${editQuery.trim()}"에 맞는 설비가 없습니다(이름·종류·소속 방 이름으로 찾습니다).` : '이 층에는 설비가 없습니다.' }}
            </p>
          </Fold>

          <template v-if="editing || changeCount > 0">
          <div class="changes-head">
            <h3 id="changes">바뀐 내용</h3>
            <button type="button" class="ghost" :disabled="changeCount === 0" @click="saveEdits()">편집 저장</button>
            <label class="ghost load-edits">
              편집 불러오기
              <input type="file" accept=".json,application/json" @change="onEditFilePick" />
            </label>
          </div>
          <p v-if="editFileNote" class="hint edit-file-note" role="status">{{ editFileNote }}</p>
          <ul v-if="changeCount > 0 || areaChanges.length" class="report">
            <li v-for="c in report" :key="c.equipmentId">
              {{ c.equipmentName }}:
              <b>{{ spaceNameOf(c.fromSpaceId) }}</b> → <b>{{ spaceNameOf(c.toSpaceId) }}</b>
            </li>
            <li v-if="areaSummary" class="muted">{{ areaSummary }}</li>
            <li v-for="(c, i) in confirmations" :key="`rule-${i}`">
              계통 <b>{{ c.systemName }}</b>: 규칙 방향 {{ c.count }}개 확정 (brick:feeds)
            </li>
            <li v-for="(f, i) in flowEditLines" :key="`flow-${i}`">
              <b>{{ f.from }}</b> → <b>{{ f.to }}</b>: 방향 직접 지정 ({{ f.note }}, brick:feeds)
            </li>
            <li v-for="k in kindEditLines" :key="`kind-${k.key}`">
              <b>{{ k.label }}</b><template v-if="k.types > 1">(유형 {{ k.types }}개)</template> {{ k.count }}대: 종류 {{ k.from }} → <b>{{ k.to }}</b> (Brick 클래스)
            </li>
            <li v-for="r in sinceOpen.restoreyed" :key="`storey-${r.id}`">
              {{ r.name }}: 층 <b>{{ r.from }}</b> → <b>{{ r.to }}</b> (brick:hasPart)
            </li>
            <li v-for="(c, i) in sinceOpen.connected" :key="`join-${i}`">
              <b>{{ nameOfId(c.from) }}</b> — <b>{{ nameOfId(c.to) }}</b>: 연결했습니다(방향을 정하면 brick:feeds)
            </li>
            <li v-for="(c, i) in sinceOpen.disconnected" :key="`cut-${i}`">
              <b>{{ nameOfId(c.from) }}</b> — <b>{{ nameOfId(c.to) }}</b>: 연결을 끊었습니다
            </li>
            <li v-for="r in sinceOpen.spacesAdded" :key="`space-add-${r.id}`">
              물리존 <b>{{ r.name || r.id }}</b>{{ josa(r.name || r.id, '을/를') }} 만들었습니다 (brick:hasPart, GeoJSON)
            </li>
            <li v-for="r in sinceOpen.spacesRemoved" :key="`space-rm-${r.id}`">
              물리존 <b>{{ r.name }}</b>{{ josa(r.name, '이/가') }} 없어졌습니다(지우거나 합침). 그 안의 설비는 좌표로 다시 소속을 찾았습니다
            </li>
            <li v-for="r in sinceOpen.equipmentAdded" :key="`eq-add-${r.id}`">
              설비 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 더했습니다 (brick:hasLocation)
            </li>
            <li v-for="r in sinceOpen.equipmentRemoved" :key="`eq-rm-${r.id}`">
              설비 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 지웠습니다(붙은 연결도 같이)
            </li>
            <li v-for="r in sinceOpen.equipmentRenamed" :key="`eq-name-${r.id}`">
              설비 이름 <b>{{ r.from || '(없음)' }}</b> → <b>{{ r.to || '(없음)' }}</b> (rdfs:label)
            </li>
            <li v-for="r in sinceOpen.equipmentMounted" :key="`eq-wall-${r.id}`">
              설비 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} {{ r.wall ? `벽 ${r.wall}에 붙였습니다` : '벽에서 뗐습니다' }} (GeoJSON wallId)
            </li>
            <li v-for="r in sinceOpen.wallsAdded" :key="`wall-add-${r.id}`">벽 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 그었습니다 (GeoJSON)</li>
            <li v-for="r in sinceOpen.wallsRemoved" :key="`wall-rm-${r.id}`">벽 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 지웠습니다(뚫린 문·창도 같이, GeoJSON)</li>
            <li v-for="r in sinceOpen.wallsChanged" :key="`wall-ch-${r.id}`">
              벽 <b>{{ r.name }}</b>:
              <template v-if="r.moved">옮김</template><template v-if="r.moved && r.loadBearing"> · </template>
              <template v-if="r.loadBearing">내력 {{ r.loadBearing.from === null ? '모름' : r.loadBearing.from ? '내력' : '비내력' }} → <b>{{ r.loadBearing.to === null ? '모름' : r.loadBearing.to ? '내력' : '비내력' }}</b></template>
              <template v-if="r.resized"><template v-if="r.moved || r.loadBearing"> · </template>두께·높이</template>
              <template v-if="r.external"><template v-if="r.moved || r.loadBearing || r.resized"> · </template>외벽 여부 → <b>{{ r.external.to === null ? '모름' : r.external.to ? '외벽' : '내벽' }}</b></template>
              (GeoJSON)
            </li>
            <li v-for="r in sinceOpen.openingsAdded" :key="`op-add-${r.id}`">{{ elementLabel(r.kind) }} <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 놓았습니다 (GeoJSON)</li>
            <li v-for="r in sinceOpen.openingsRemoved" :key="`op-rm-${r.id}`">{{ elementLabel(r.kind) }} <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 지웠습니다 (GeoJSON)</li>
            <li v-for="r in sinceOpen.openingsMoved" :key="`op-mv-${r.id}`">
              {{ elementLabel(r.kind) }} <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }}
              {{ r.moved && r.resized ? '옮기고 크기를 바꿨습니다' : r.moved ? '옮겼습니다' : '크기를 바꿨습니다' }}
              ({{ r.moved ? 'GeoJSON 위치·잇는 방' : 'GeoJSON 가로·세로' }})
            </li>
            <li v-for="r in sinceOpen.customZones" :key="`cz-${r.id}`">
              커스텀존 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} {{ r.change === 'added' ? '만들었습니다' : r.change === 'removed' ? '지웠습니다' : '고쳤습니다' }}
              (TTL brick:Zone · GeoJSON)
            </li>
            <li v-for="r in sinceOpen.systemMoved" :key="`sys-mv-${r.id}`">
              {{ r.name }}: 계통 <b>{{ systemNameOf(r.from) }}</b> → <b>{{ systemNameOf(r.to) }}</b> (brick:hasPart)
            </li>
            <li v-for="r in sinceOpen.systemsAdded" :key="`sys-add-${r.id}`">계통 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 만들었습니다 (brick:hasPart)</li>
            <li v-for="r in sinceOpen.systemsRemoved" :key="`sys-rm-${r.id}`">계통 <b>{{ r.name || r.id }}</b>{{ josa(r.name || r.id, '을/를') }} 지웠습니다</li>
            <li v-for="r in sinceOpen.systemNames" :key="`sys-name-${r.id}`">
              계통 이름 <b>{{ r.from }}</b> → <b>{{ r.to }}</b> (rdfs:label)
            </li>
            <li v-for="r in sinceOpen.systemKinds" :key="`sys-kind-${r.id}`">
              계통 <b>{{ r.name || r.id }}</b>: 종류 {{ systemKindText(r.from.kind, r.from.fluid) }} → <b>{{ systemKindText(r.to.kind, r.to.fluid) }}</b> (계통 클래스)
            </li>
            <li v-for="r in sinceOpen.renamed" :key="`name-${r.spaceId}`">
              물리존 이름 <b>{{ r.from || '(없음)' }}</b> → <b>{{ r.to || '(없음)' }}</b> (rdfs:label)
            </li>
            <li v-if="sinceOpen.moved.length" class="moved-only">
              소속은 같고 좌표만 바뀐 설비 {{ sinceOpen.moved.length }}대 (GeoJSON 위치):
              {{ sinceOpen.moved.slice(0, MOVED_NAMES).map((m) => m.name).join(', ')
              }}<template v-if="sinceOpen.moved.length > MOVED_NAMES"> 외 {{ sinceOpen.moved.length - MOVED_NAMES }}대</template>
            </li>
          </ul>
          <p v-else class="empty">아직 바뀐 것이 없습니다.</p>
          </template>
        </section>
      </div>

      <!-- 내보내기 버튼은 위 도구막대에 있다. 여기는 두 파일이 무엇을 나눠 갖는지만 적는다. -->
      <section class="actions">
        <p class="note">
          <b>내보내기</b>(도구막대의 GeoJSON · TTL · GLB · OBJ).
          두 파일은 같은 id로 연결됩니다. 형상은 GeoJSON, 설비와 계통의 관계는 TTL에 들어갑니다.
          벽·문·창과 문이 잇는 방은 GeoJSON에만 있습니다(Brick에 건축 부재 클래스가 없음).
          벽·문·창은 '읽을 것'에서 켠 것만 들어가고, 문·창 위치는 '문·창 자리'를 켜고 연 파일에서만 나갑니다.
          TTL의 설비·방 클래스는 <Src kind="dict" /> 기준이고, 규칙 방향은 확정한 계통만 들어갑니다.
          GLB · OBJ는 보여 주기용 3D 형상입니다. 요소 이름이 같은 id(GlobalId)이고, 좌표는 y가 위인 미터입니다.
          고친 벽은 지금 외곽선을 층 높이로 세우고, 방은 얇은 판입니다. 큰 파일은 OBJ가 GLB보다 몇 배 크니 GLB를 권합니다.
        </p>
      </section>
    </template>
    <ShortcutHelp :open="helpOpen" :editing="editing" @close="helpOpen = false" />
    <ExitEditDialog :open="!!exitAsk" :count="exitAsk?.count ?? 0" :server="!!serverKey" :floor="exitAsk?.floor ? { from: floorName(exitAsk.floor.from), to: floorName(exitAsk.floor.to) } : null" @commit="exitCommitting" @save="exitSaving" @discard="exitDiscarding" @cancel="exitAsk = null" />
    <!-- 진행 표시. 스크롤 위치와 상관없이 보이도록 화면 아래에 띄운다. -->
    <div v-if="progress" class="progress-toast" role="status" aria-live="polite">
      <div v-if="progressFile" class="muted progress-file">{{ progressFile }}</div>
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
