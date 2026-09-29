<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, triggerRef, watch, type Directive } from 'vue'
import type { MeshMap } from './lib/ifc/import'
import { countOf, isConduit, type Connection, type Equipment, type Model, type Opening, type Vec2, type Vec3, type Wall } from './lib/model'
import { mergeModels, type MergeReport } from './lib/merge'
import { partnerOf as findPartner, profileOf, type Profile } from './lib/profile'
import { requirementsReport, type RequirementRow, type RequirementState } from './lib/requirements'
import TierChips from './components/TierChips.vue'
import Fold from './components/Fold.vue'
import Src, { type SrcKind } from './components/Src.vue'
import ShortcutHelp from './components/ShortcutHelp.vue'
import HoverTip from './components/HoverTip.vue'
import FloorPlan from './components/FloorPlan.vue'
import { matchShortcut, snapAxis, type Shortcut } from './lib/shortcuts'
import { narrowOptions } from './lib/options'
import { applyEdits, exportEdits, parseEditFile, type EditFile } from './lib/edit-file'
import { compareVersions, MATCH_KEY_BY, type MatchKey, type VersionDiff } from './lib/versions'
import { neighbors, trace, traceBySystem, TOLERANCE, type Neighbor } from './lib/topology'
import { airServices, servedSpaces } from './lib/served'
import { completenessChecks, diagnoseFailure, type Box, type FailureFix } from './lib/checks'
import { confirmSystemFlow, inferFlowByRules, newlyDisagreeing, withInferred, type RuleReport } from './lib/flow-rules'
import { EQUIPMENT_KINDS, equipmentKind, FLUID_KINDS, FLUIDS, fluidInfo, ifcClassLabel, roomKind, SYSTEM_KINDS, systemKind, type Fluid } from './lib/kinds'
import { modelToGeoJSON } from './lib/export/geojson'
import { modelToTTL } from './lib/export/ttl'
import {
  arrowColors,
  createViewer,
  PICK_COLORS,
  systemColors,
  toScene,
  WALL_COLORS,
  type Arrow,
  type Viewer,
  type HoverTarget,
} from './lib/viewer'
import {
  flowEdits,
  moveEquipment,
  moveEquipmentToStorey,
  moveSpaceVertex,
  completePosition,
  renameSpace,
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
  type Baseline,
  type BoundaryChange,
  type Change,
  type SpaceSetChange,
  type Snapshot,
} from './lib/edit'
import { MERGE_GAP } from './lib/polygon'
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
const dragging = ref(false)
const model = shallowRef<Model | null>(null)

const canvas = ref<HTMLCanvasElement | null>(null)
let viewer: Viewer | null = null

// 설비 형상. **모델과 따로 들고 다닌다** — 모델은 내보내기가 그대로 읽는 것이라 여기에
// 삼각형이 섞이면 TTL 로 기하가 새는 길이 생긴다. 반응형으로 감쌀 이유도 없다(화면이
// 값을 읽지 않고 3D 에만 넘긴다). 926개짜리 Map 을 반응형으로 만들면 그만큼 느려진다.
let meshes: MeshMap = new Map()

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
    sinceOpen.value.wallsAdded.length +
    sinceOpen.value.wallsRemoved.length +
    sinceOpen.value.wallsChanged.length +
    sinceOpen.value.openingsAdded.length +
    sinceOpen.value.openingsRemoved.length +
    sinceOpen.value.openingsMoved.length +
    sinceOpen.value.systemMoved.length +
    sinceOpen.value.systemKinds.length +
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
        wallsAdded: [],
        wallsRemoved: [],
        wallsChanged: [],
        openingsAdded: [],
        openingsRemoved: [],
        openingsMoved: [],
        systemMoved: [],
        systemKinds: [],
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
      const members = storey.equipment.filter((e) => e.spaceId === sp.id).length
      return {
        title: sp.longName || sp.name,
        lines: [`물리존 ${sp.name} · ${storey.name} · ${sp.areaM2.toFixed(1)}㎡ · 설비 ${members}대`, '클릭하면 꼭짓점을 고칠 수 있습니다'],
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
  if (text) tip.show(text.title, text.lines, at)
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
function moveInScene(id: string, from: Vec3 | null, to: Vec3 | null) {
  shiftMesh(id, from, to)
  if (from && to && viewer?.shiftEquipment(id, [to[0] - from[0], to[1] - from[1], to[2] - from[2]])) sceneVersion.value++
  else redraw()
}

/**
 * 설비를 옮기는 길은 표(숫자)와 3D(끌기) 둘이지만 하는 일은 하나다. 소속 재판정은 edit.ts 가 한다.
 * `drawnAt` 은 3D 가 이미 그려 둔 자리다(끌어 놓은 경우). 그 자리와 저장한 좌표의 차만큼만 형상을 옮긴다.
 */
function relocate(equipmentId: string, to: Vec3, drawnAt?: Vec3, coalesce?: string): boolean {
  if (!model.value) return false
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  const snapshot = snapshotEquipment(model.value, equipmentId)
  const at = mark()
  const change = moveEquipment(model.value, equipmentId, to)
  if (!change) return false
  remember(`${shortName(change.equipmentName)} 옮김`, snapshot, at, coalesce)
  if (drawnAt) shiftMesh(equipmentId, before, drawnAt)
  moveInScene(equipmentId, drawnAt ?? before, to)
  changes.value = [...changes.value, change]
  triggerRef(model)
  return true
}

// 좌표가 없는 설비(E6)에 표로 넣은 축. 셋이 다 차야 옮긴다(completePosition). 새 파일을 열면 비운다.
const positionDrafts = ref(new Map<string, (number | null)[]>())

function applyMove(equipmentId: string, axis: 0 | 1 | 2, raw: string, current: readonly number[] | null) {
  if (!model.value) return
  const value = raw.trim() === '' ? null : Number(raw)
  if (value !== null && !Number.isFinite(value)) return

  if (current) {
    if (value === null) return
    const base: [number, number, number] = [current[0], current[1], current[2]]
    base[axis] = value
    relocate(equipmentId, base)
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
  if (to) relocate(equipmentId, to)
}

/** 3D 에서 고른 설비를 끌어 놓았다. 3D 는 이미 놓은 자리에 그려져 있어 다시 만들지 않는다. */
function dropEquipment(equipmentId: string, delta: Vec3) {
  const position = equipmentById.value.get(equipmentId)?.position
  if (!position) return
  const drawnAt: Vec3 = [position[0] + delta[0], position[1] + delta[1], position[2]]
  relocate(equipmentId, [cm(drawnAt[0]), cm(drawnAt[1]), position[2]], drawnAt)
}

/** 설비를 다른 층으로(E6). 높이도 두 층 바닥의 차만큼 옮기므로 3D 를 다시 그린다. */
function moveToStorey(equipmentId: string, storeyId: string) {
  if (!model.value) return
  const before = equipmentById.value.get(equipmentId)?.position ?? null
  const snapshot = snapshotEquipment(model.value, equipmentId)
  const at = mark()
  const change = moveEquipmentToStorey(model.value, equipmentId, storeyId)
  if (!change) return
  remember(`${shortName(change.equipmentName)} 층 옮김`, snapshot, at)
  moveInScene(equipmentId, before, equipmentById.value.get(equipmentId)?.position ?? null)
  changes.value = [...changes.value, change]
  storeyMoved.value = new Set([...storeyMoved.value, equipmentId])
  triggerRef(model)
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

function undo() {
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
  editNotice.value = `되돌렸습니다: ${entry.label}`
}

function redo() {
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
  editNotice.value = `다시 했습니다: ${next.entry.label}`
}

/** 스냅숏을 모델에 되돌려 놓고, 바뀐 것에 맞춰 3D 와 화면을 고친다. 되돌리기와 다시 하기가 같이 쓴다. */
function applySnapshot(s: Snapshot) {
  const m = model.value
  if (!m) return
  const drawnAt = s.kind === 'equipment' ? (equipmentById.value.get(s.id)?.position ?? null) : null
  const rules = restore(m, s)
  if (s.kind === 'equipment') {
    triggerRef(model)
    // 형상도 되돌린다. 안 하면 다시 그릴 때 옮긴 자리에 남는다.
    moveInScene(s.id, drawnAt, s.position)
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
    viewer?.updateSpaces(m)
    sceneVersion.value++
  } else if (s.kind === 'storey-elements') {
    if (selectedElementId.value && !m.storeys.some((st) => st.walls.some((w) => w.id === selectedElementId.value) || st.openings.some((o) => o.id === selectedElementId.value))) {
      selectedElementId.value = null
    }
    archEdited = true
    triggerRef(model)
    sceneVersion.value++
  } else if (s.kind === 'storey-spaces') {
    if (selectedSpaceId.value && !m.storeys.some((st) => st.spaces.some((x) => x.id === selectedSpaceId.value))) selectedSpaceId.value = null
    triggerRef(model)
    viewer?.updateSpaces(m)
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
      mode.value = editing.value ? 'view' : 'edit'
      note(editing.value ? '편집 모드' : '보기 모드')
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
      saveEdits()
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
    note(purpose === 'split' ? '나누기를 취소했습니다' : purpose === 'create' ? '물리존 그리기를 취소했습니다' : '외곽선 그리기를 취소했습니다')
  } else if (adding.value) {
    const what = adding.value.what
    stopAdd()
    note(what === 'equipment' ? '설비 더하기를 취소했습니다' : what === 'door' ? '문 놓기를 취소했습니다' : '창 놓기를 취소했습니다')
  } else if (selectedElementId.value) {
    selectedElementId.value = null
  } else if (placing.value) {
    stopPlace()
    note('놓기를 취소했습니다')
  } else if (connectFrom.value) {
    connectFrom.value = null
    note('잇기를 취소했습니다')
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
  else if (selectedSystemId.value) viewer?.frame(systemById.value.get(selectedSystemId.value)?.memberIds ?? [])
  else if (openCheck.value?.failed.length) viewer?.frame(openCheck.value.failed)
  else viewer?.frameAll()
  return true
}

/** 방향키. 화면의 오른쪽·위쪽에 가장 가까운 평면 축으로 옮긴다(snapAxis). */
function nudge(code: string, step: number): boolean {
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
  pendingNudge = { id: e.id, dx, dy }
  requestAnimationFrame(flushNudge)
  return true
}

// 방향키는 한 프레임에 모아 한 번에 옮긴다. 성수에서 한 번 옮기는 데 0.2초가 들어서, 꾹 누른 키(초당 수십 번)를
// 하나씩 옮기면 키가 줄을 서서 손을 뗀 뒤에도 몇 초씩 따라 움직였다.
let pendingNudge: { id: string; dx: number; dy: number } | null = null
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
  moveToStorey(e.id, next.id)
  note(`${shortName(e.name)} → ${next.name}`)
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
watch([model, canvas], ([m, el]) => {
  if (!m || !el) return
  if (!viewer) {
    viewer = createViewer(el)
    viewer.onPick((id) => {
      if (connectFrom.value && id) return connectTo(id)
      selectedId.value = id
    })
    viewer.onHover(onHover)
    viewer.onPlace((at) => placeAt(at))
    viewer.onPickSpace((id) => {
      selectedSpaceId.value = id
      if (id) {
        selectedId.value = null
        selectedSystemId.value = null
      }
    })
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
/** 외곽선이 없던 물리존에 3D 에서 찍어 가는 꼭짓점. 아래 "외곽선 그리기" 참조. */
/**
 * 3D 바닥에 점을 찍는 편집. `footprint` 는 외곽선이 없던 물리존에 외곽선을 그리는 것, `create` 는 새 물리존을 그리는
 * 것(E3), `split` 은 두 점으로 나눌 선을 긋는 것(E3)이다.
 */
type Drawing = { purpose: 'footprint' | 'create' | 'split' | 'wall'; spaceId: string | null; storeyId: string; name: string; elevation: number; points: Vec2[] }
const drawing = ref<Drawing | null>(null)
watch([selectedSpace, editing, sceneVersion, drawing], () => {
  const picked = selectedSpace.value
  if (!viewer) return
  if (drawing.value) {
    const d = drawing.value
    viewer.setSpaceHandles({ id: d.spaceId ?? 'new', ring: d.points, elevation: d.elevation, active: d.points.length ? d.points.length - 1 : null })
    return
  }
  if (!picked || !editing.value) {
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
const checks = computed(() => (model.value ? completenessChecks(model.value, airServiceList.value) : []))
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
    boxes: c.key === 'device-connected' ? meshBoxes() : undefined,
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
const fixLabel = (fix: FailureFix) => (fix.kind === 'move-into' ? `${fix.spaceName} 안으로 옮기기` : `잇기: ${nameOfId(fix.other)}`)
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
  note(`계통 ${name}을 만들고 ${shortName(e.name)}을 넣었습니다`)
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
  note(`계통 ${system.name || systemId}을 지웠습니다. 구성원 ${system.memberIds.length}개는 이 계통 자리만 잃습니다(Ctrl+Z 로 되돌림)`)
}
/** 계통 종류의 출처. 사람이 고쳤으면 편집, 아니면 PredefinedType(BIM)·이름(사전). */
const systemKindSrc = (s: { kindEdited?: unknown; kindSource?: 'bim' | 'dict' }): SrcKind => (s.kindEdited ? 'edit' : (s.kindSource ?? 'dict'))

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
  // 잇기 중이면 고른 것이 이을 상대다. 표·목록에서 골라도, 3D 에서 눌러도 같다.
  if (connectFrom.value && id) return connectTo(id)
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
  void openMany([{ name: baseName(path), read: () => fetchData(path) }], 'open').then(() => {
    openedDataPath.value = fileName.value === baseName(path) ? path : null
  })
}

function appendData(path: string) {
  void append(baseName(path), () => fetchData(path))
}

/** 목록에서 고른 파일. 건축·설비를 같이 골라 한 번에 연다. */
const dataPicked = ref<string[]>([])
function toggleDataPick(path: string) {
  dataPicked.value = dataPicked.value.includes(path) ? dataPicked.value.filter((p) => p !== path) : [...dataPicked.value, path]
}
function openDataSet(paths: readonly string[]) {
  const list = [...paths]
  dataPicked.value = []
  void openMany(list.map((path) => ({ name: baseName(path), read: () => fetchData(path) })), 'open').then(() => {
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

function saveEdits() {
  const m = model.value
  if (!m || !baseline.value) return
  if (!hasEdits.value && changeCount.value === 0) {
    note('저장할 편집이 없습니다')
    return
  }
  const file = exportEdits(m, baseline.value, fileName.value)
  const stem = fileName.value.replace(/\.ifc/gi, '').replace(/[^\w가-힣.+-]+/g, '_') || 'model'
  download(`${stem}.edits.json`, JSON.stringify(file, null, 2), 'application/json')
  note(`편집을 저장했습니다: ${stem}.edits.json`)
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
}

/** 편집 파일을 지금 모델에 얹는다. 파일에서 불러올 때와 자동 저장을 되살릴 때가 같이 쓴다. */
function applyEditFile(file: EditFile, from: string) {
  const m = model.value
  if (!m) return
  // 옮길 설비의 형상도 같이 옮겨야 다시 그릴 때 예전 자리로 튀지 않는다. 얹기 전 좌표를 떠 둔다.
  const before = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.position]))
  const result = applyEdits(m, file)
  for (const e of m.storeys.flatMap((s) => s.equipment)) {
    const was = before.get(e.id) ?? null
    if (was !== e.position) shiftMesh(e.id, was, e.position)
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
  const MISSING_LABEL: Record<string, string> = { equipment: '설비', spaces: '물리존', kinds: '타입', flows: '방향', systems: '계통', connections: '연결', elements: '벽·문·창' }
  // GUID 가 바뀐 판본에서 다른 열쇠로 찾은 것. 사람이 확인할 수 있게 무엇으로 찾았는지까지 말한다.
  const rematched = (Object.entries(result.rematched) as [Exclude<MatchKey, 'guid'>, number][]).filter(([, n]) => n > 0)
  autosaveArmed = true
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
watch(baseline, () => (viewStorey.value = null))
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
watch(viewStorey, () => viewer?.frameAll())

// --- 3D / 평면도 ---------------------------------------------------------------------
//
// 평면도는 3D 와 탭으로 갈아 끼운다(한 번에 하나만 그린다). 층 하나를 골랐을 때만 그리고, 고른 층·고른 설비는
// 3D 와 같은 상태(viewStorey, selectedId)를 쓴다. 꼭짓점 끌기는 3D 에서 놓는 것과 같은 길(dropVertex — 자기 교차
// 막기, cm 로 자르기, 되돌리기 이력)을 탄다.
const activeTab = ref<'3d' | 'plan'>('3d')
const planStorey = computed(() => model.value?.storeys.find((s) => s.id === viewStorey.value) ?? null)
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
function startPlace(id: string) {
  const home = storeyOf(id)
  if (!home) return
  connectFrom.value = null
  placing.value = id
  viewer?.setPlaceMode(home.elevation)
  note(`${nameOfId(id)}을 놓을 바닥을 3D에서 클릭하세요 (Esc 취소)`)
}
function stopPlace() {
  placing.value = null
  viewer?.setPlaceMode(null)
}
watch([selectedId, editing, viewStorey], () => {
  if (placing.value && (selectedId.value !== placing.value || !editing.value)) stopPlace()
})
function placeAt(at: Vec2) {
  if (drawing.value) {
    drawing.value = { ...drawing.value, points: [...drawing.value.points, [cm(at[0]), cm(at[1])]] }
    // 나눌 선은 두 점이면 끝난다.
    if ((drawing.value.purpose === 'split' || drawing.value.purpose === 'wall') && drawing.value.points.length === 2) finishDraw()
    return
  }
  if (adding.value) {
    if (adding.value.what === 'equipment') addEquipmentAt(at)
    else addOpeningAt(at)
    return
  }
  const id = placing.value
  const m = model.value
  stopPlace()
  const home = id ? storeyOf(id) : null
  const target = id ? equipmentById.value.get(id) : null
  if (!m || !id || !home || !target) return
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
    if (changeElements(d.storeyId, '벽 긋기', (m) => (made = addWall(m, d.storeyId, a, b)))) {
      selectedElementId.value = made!.id
      note('벽을 그었습니다. 내력 여부는 오른쪽 패널에서 정합니다')
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
      note(`${d.name}을 둘로 나눴습니다. 새 조각의 이름은 오른쪽 패널에서 고칩니다`)
    }
    return true
  }
  if (d.points.length < 3) {
    note('꼭짓점을 셋 이상 찍어야 합니다')
    return true
  }
  stopDraw()
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
      note(`새 물리존 ${n}을 만들었습니다. 이름은 오른쪽 패널에서 고칩니다`)
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

function startCreateSpace() {
  const storey = targetStorey()
  if (!storey) return note('물리존을 그릴 층을 먼저 고르세요(3D 오른쪽 위의 층 목록)')
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
  note(`${name}을 나눌 선의 두 점을 바닥에 찍으세요 (Esc 취소)`)
}

function removeSpace() {
  const picked = selectedSpace.value
  if (!picked) return
  const name = picked.space.longName || picked.space.name
  const id = picked.space.id
  if (changeSpaces(picked.storey.id, `${name} 지우기`, (m) => deleteSpace(m, id))) {
    selectedSpaceId.value = null
    note(`${name}을 지웠습니다. 그 안의 설비는 좌표로 다시 소속을 찾았습니다(Ctrl+Z 로 되돌립니다)`)
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
  if (ok) note(`${otherName}을 ${name}에 합쳤습니다${bridged ? '. 사이의 벽 자리도 방에 넣었습니다' : ''}`)
}

// --- 설비 더하기·지우기·이름 (E7) ---------------------------------------------------------
//
// 더하기는 [설비 더하기] 를 누르고 바닥을 누른다. 종류는 모르는 채 바닥 높이에 놓고 고르게 한다 — 종류와 높이를
// 지어내지 않는다. 지우면 붙은 연결·계통 자리도 같이 빠지고 Ctrl+Z 로 그대로 돌아온다(edit.ts).
const adding = ref<{ storeyId: string; elevation: number; what: 'equipment' | 'door' | 'window' } | null>(null)
function startAddEquipment() {
  const storey = targetStorey()
  if (!storey) return note('설비를 더할 층을 먼저 고르세요(3D 오른쪽 위의 층 목록)')
  stopPlace()
  stopDraw()
  connectFrom.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  adding.value = { storeyId: storey.id, elevation: storey.elevation, what: 'equipment' }
  viewer?.setPlaceMode(storey.elevation)
  note(`${storey.name}에 설비를 놓을 바닥을 3D에서 클릭하세요 (Esc 취소)`)
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
  const mk = mark()
  const e = addEquipment(m, target.storeyId, { name: `새 설비 ${n}`, kind: null, position: [cm(at[0]), cm(at[1]), cm(target.elevation)] })
  if (!e) return
  const snapshot = snapshotEquipmentSet(m, e.id)
  if (snapshot?.kind === 'equipment-set') remember(`${e.name} 더하기`, { ...snapshot, present: false }, mk)
  triggerRef(model)
  redraw()
  selectedId.value = e.id
  note(`${e.name}을 바닥 높이에 놓았습니다. 종류·이름·높이를 오른쪽 패널에서 정하세요`)
}
function removeEquipment(id: string) {
  const m = model.value
  if (!m) return
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
  note(`${name}을 지웠습니다${done.connections ? `(연결 ${done.connections}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
}
function renameEquipmentTo(id: string, name: string) {
  const m = model.value
  const trimmed = name.trim()
  if (!m || !trimmed) return
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
let archEdited = false
const selectedElement = computed(() => {
  const m = model.value
  const id = selectedElementId.value
  if (!m || !id) return null
  for (const storey of m.storeys) {
    const wall = storey.walls.find((w) => w.id === id)
    if (wall) return { kind: 'wall' as const, storey, wall, opening: null }
    const opening = storey.openings.find((o) => o.id === id)
    if (opening) return { kind: opening.kind, storey, wall: null, opening }
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
const elementLabel = (kind: 'wall' | 'door' | 'window') => (kind === 'wall' ? '벽' : kind === 'door' ? '문' : '창')
const nameOfSpace = (id: string) => spaceNameOf(id)

function changeElements(storeyId: string, label: string, apply: (m: Model) => unknown, coalesce?: string): boolean {
  const m = model.value
  if (!m) return false
  const snapshot = snapshotStoreyElements(m, storeyId)
  const at = mark()
  const done = apply(m)
  if (!done) return false
  if (typeof done === 'object' && 'refused' in (done as object)) {
    note((done as { refused: string }).refused)
    return false
  }
  remember(label, snapshot, at, coalesce)
  archEdited = true
  triggerRef(model)
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
  const done = moveWallWithSpaces(m, wall.id, delta, carryPlan)
  if (!done || !elements || !spaces) return
  carryPlan = done.plan
  remember(`${wall.name || '벽'} 옮김(방 경계 같이)`, { kind: 'many', parts: [elements, spaces] }, at, `el:${wall.id}:rooms`)
  areaChanges.value = [...areaChanges.value, ...done.changes]
  changes.value = [...changes.value, ...done.changes.flatMap((c) => c.equipment)]
  archEdited = true
  triggerRef(model)
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
  note(`${what} ${name}을 지웠습니다${openings ? `(뚫린 문·창 ${openings}개도 같이)` : ''}. Ctrl+Z 로 되돌립니다`)
}

/** 방향키로 고른 벽·문·창을 옮긴다. 화면 방향에 가장 가까운 평면 축이다(설비 옮기기와 같다). */
/**
 * 벽을 옮길 때 방 경계도 같이 옮기나(edit.ts 의 moveWallWithSpaces). 기본은 끔 — 방은 IfcSpace 가 따로 그린 것이라 벽이 방을
 * 지어내지 않는다. 켜면 벽 가까이 있던 방 변이 벽이 움직인 만큼 따라온다. 같은 벽을 방향키로 옮기는 동안은 처음 세운 계획을
 * 다시 쓴다(되돌아오면 제자리).
 */
const carryRooms = ref(false)
let carryPlan: WallCarryPlan | null = null
watch(selectedElementId, () => (carryPlan = null))

function nudgeElement(code: string, step: number): boolean {
  const picked = selectedElement.value
  if (!picked || !viewer) return false
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  const delta: Vec2 = [cm(sign * ax * step), cm(sign * ay * step)]
  if (picked.wall) {
    if (!picked.wall.footprint?.length) {
      note('외곽선이 없는 벽은 옮길 수 없습니다')
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

function applyOpeningPosition(o: Opening, axis: 0 | 1, raw: string) {
  const value = Number(raw)
  const storey = selectedElement.value?.storey
  if (!o.position || !storey || raw.trim() === '' || !Number.isFinite(value)) return
  const to: [number, number] = [o.position[0], o.position[1]]
  to[axis] = value
  changeElements(storey.id, `${o.name || elementLabel(o.kind)} 옮김`, (m) => moveOpening(m, o.id, to))
}

function startWall() {
  const storey = targetStorey()
  if (!storey) return note('벽을 그을 층을 먼저 고르세요(3D 오른쪽 위의 층 목록)')
  stopPlace()
  stopAdd()
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  drawing.value = { purpose: 'wall', spaceId: null, storeyId: storey.id, name: `${storey.name} 벽`, elevation: storey.elevation, points: [] }
  viewer?.setPlaceMode(storey.elevation)
}

function startOpening(kind: 'door' | 'window') {
  const storey = targetStorey() ?? selectedElement.value?.storey ?? null
  if (!storey) return note('문·창을 놓을 층을 먼저 고르세요(3D 오른쪽 위의 층 목록)')
  stopPlace()
  stopDraw()
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  adding.value = { storeyId: storey.id, elevation: storey.elevation, what: kind }
  viewer?.setPlaceMode(storey.elevation)
  note(`${elementLabel(kind)}을 놓을 벽을 3D에서 클릭하세요 (Esc 취소)`)
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
    note(`${elementLabel(kind)}을 놓았습니다. 방향키로 벽을 따라 옮깁니다`)
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
  note(`${nameOfId(selectedId.value)}에 이을 상대를 3D나 목록에서 고르세요 (Esc 취소)`)
}
function connectTo(id: string) {
  const m = model.value
  const from = connectFrom.value
  connectFrom.value = null
  if (!m || !from) return
  if (id === from) return note('같은 설비끼리는 이을 수 없습니다')
  if (connectionBetween(m, from, id)) return note('이미 이어져 있습니다')
  const at = mark()
  const done = addConnection(m, from, id)
  if (!done) return
  remember(`${nameOfId(from)}–${nameOfId(id)} 잇기`, { kind: 'connection', connection: done.connection, present: false, index: m.connections.length - 1 }, at)
  ruleReport.value = done.rules
  triggerRef(model)
  flowVersion.value++
  selectedId.value = from
  note(`${nameOfId(from)}–${nameOfId(id)}을 이었습니다. 방향은 상류로·하류로로 정합니다`)
}
function disconnect(c: Connection) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotConnection(m, c)
  const at = mark()
  const rules = removeConnection(m, c)
  if (!rules) return
  remember(`${nameOfId(c.from)}–${nameOfId(c.to)} 끊기`, snapshot, at)
  ruleReport.value = rules
  triggerRef(model)
  flowVersion.value++
}

// --- 자동 저장 ------------------------------------------------------------------------
//
// 편집은 탭 안에만 있어서 브라우저가 죽거나 PC 가 다시 켜지면 사라졌다(창 닫기는 묻지만 그 밖은 못 막는다). 편집할
// 때마다 "편집 저장" 과 같은 파일(lib/edit-file.ts)을 브라우저에 적어 두고, 같은 IFC 를 다시 열면 이어서 할지 묻는다.
// 되살리기도 편집 파일 불러오기와 같은 길이다 — 값을 덮지 않고 편집 함수에 다시 넣는다.
//
// 열자마자 지우면 안 된다. 연 직후에는 바뀐 것이 0 이라, 그대로 저장하면 되살릴 기록을 지운다. 사람이 편집을
// 시작하거나(되살리기를 고르지 않고 새로 고친 것이다) 되살린 뒤부터 적는다.
const DRAFT_PREFIX = 'oe-draft:'
const draft = shallowRef<{ file: EditFile; count: number; savedAt: string } | null>(null)
let autosaveArmed = false
let autosaveTimer: number | undefined
const draftKey = () => DRAFT_PREFIX + fileName.value
const editCount = (f: EditFile) =>
  f.equipment.length + f.spaces.length + f.kinds.length + f.flows.length + f.confirmedSystems.length +
  (f.connections?.add.length ?? 0) + (f.connections?.remove.length ?? 0) +
  (f.equipmentAdded?.length ?? 0) + (f.equipmentRemoved?.length ?? 0) + (f.spacesAdded?.length ?? 0) + (f.spacesRemoved?.length ?? 0) +
  (f.walls?.length ?? 0) + (f.wallsAdded?.length ?? 0) + (f.wallsRemoved?.length ?? 0) +
  (f.openings?.length ?? 0) + (f.openingsAdded?.length ?? 0) + (f.openingsRemoved?.length ?? 0)

watch(baseline, (b) => {
  autosaveArmed = false
  draft.value = null
  if (!b) return
  try {
    const raw = localStorage.getItem(draftKey())
    const file = raw ? parseEditFile(raw) : null
    if (file && typeof file !== 'string' && editCount(file) > 0) draft.value = { file, count: editCount(file), savedAt: file.savedAt }
  } catch {
    // 브라우저 저장소를 못 읽으면 되살릴 것도 없다.
  }
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
watch([changeCount, flowVersion, () => history.value.length], () => {
  if (!autosaveArmed) return
  window.clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => {
    const m = model.value
    if (!m || !baseline.value) return
    try {
      const file = exportEdits(m, baseline.value, fileName.value)
      if (editCount(file) > 0) localStorage.setItem(draftKey(), JSON.stringify(file))
      else localStorage.removeItem(draftKey())
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
  applyEditFile(d.file, '자동 저장')
}
function discardDraft() {
  draft.value = null
  try {
    localStorage.removeItem(draftKey())
  } catch {
    // 못 지워도 다음 편집이 덮는다.
  }
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
  return { name: v.name, kept: a.kept + b.kept, rematched: a.rematched + b.rematched }
})

type VersionRow = { id: string; name: string; detail: string; target: 'equipment' | 'space' | null }
const versionLists = computed((): { key: string; label: string; rows: VersionRow[] }[] => {
  const d = versionDiff.value?.diff
  if (!d) return []
  const eq = (r: { id: string; name: string }, detail = ''): VersionRow => ({ ...r, detail, target: 'equipment' })
  const sp = (r: { id: string; name: string }, detail = ''): VersionRow => ({ ...r, detail, target: 'space' })
  const gone = (r: { id: string; name: string }): VersionRow => ({ ...r, detail: '', target: null })
  const spaceName = (id: string) => spaceNameOf(id)
  return [
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
const hasEdits = computed(() => changeCount.value > 0 || history.value.length > 0)
watch(fileName, () => (editFileNote.value = ''))
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!hasEdits.value) return
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
    // 임포터가 이미 한 번 돌렸다. 계통별 채점표를 화면이 쓰려고 다시 받는다(같은 입력이면 같은 결과다).
    ruleReport.value = inferFlowByRules(result.model)
    confirmations.value = []
    baseline.value = baselineOf(result.model)
    pristine = structuredClone(result.model)
    model.value = result.model
    fileName.value = name
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
    fileName.value = ''
    mergeReport.value = null
    error.value = `${isIdf(name) ? 'IDF' : 'IFC'}를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
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

async function append(name: string, read: () => Promise<ArrayBuffer>) {
  if (!model.value) return
  busy.value = true
  error.value = ''
  beginProgress('파일 읽는 중')
  // 편집이 있으면 떠 두고, 3D 형상도 연 때 자리로 되돌린다. 합친 뒤 편집을 다시 얹으면서 형상도 다시 옮긴다.
  const edits = hasEdits.value && baseline.value && pristine ? exportEdits(model.value, baseline.value, fileName.value) : null
  const unedited = () => (edits ? structuredClone(pristine!) : model.value!)
  const restoreMeshes = () => {
    if (!edits) return
    const opened = new Map(pristine!.storeys.flatMap((st) => st.equipment).map((e) => [e.id, e.position]))
    for (const e of model.value!.storeys.flatMap((st) => st.equipment)) shiftMesh(e.id, e.position, opened.get(e.id) ?? null)
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
  return `${what}는 소속 물리존을 찾지 못했습니다. 위치는 층까지만 내보냅니다.`
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
    measure()
  } else {
    tiersTimer = window.setTimeout(measure, TIERS_DELAY)
  }
}, { immediate: true })

const warnings = computed(() => [...(model.value?.warnings ?? []), ...(unlocatedLine.value ? [unlocatedLine.value] : [])])

const REQUIREMENT_STATE: Record<RequirementState, string> = {
  standard: '표준 자리',
  elsewhere: '다른 자리',
  partial: '일부',
  missing: '없음',
  none: '해당 없음',
  unmeasured: '잴 수 없음',
}
// 접힌 칸의 제목 옆에 붙는 한 줄. 고객사에 할 말이 셋으로 갈린다 — 할 말 없음, 설정을 바꿔 달라, 값을 넣어 달라.
// 파일 하나로 잴 수 없는 것(R8·R12·R13)을 분모에 넣으면 필수가 반쯤 빠진 것처럼 읽힌다. 잰 것만 센다.
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
type FileSource = { name: string; read: () => Promise<ArrayBuffer> }
async function openMany(files: readonly FileSource[], into: 'open' | 'append') {
  const ordered = [...files.filter((f) => !isIdf(f.name)), ...files.filter((f) => isIdf(f.name))]
  if (!ordered.length) return
  let rest = ordered
  if (into === 'open' || !model.value) {
    await load(ordered[0].name, ordered[0].read)
    // 편집이 남아 열기를 물리쳤거나 읽지 못했으면 멈춘다.
    if (!model.value || fileName.value !== ordered[0].name || error.value) return
    rest = ordered.slice(1)
  }
  for (const f of rest) {
    await append(f.name, f.read)
    if (error.value) return
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

function download(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
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
async function exportGeoJSON() {
  if (!model.value) return
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
      return
    } catch (e) {
      // 사람이 폴더 고르기를 닫은 것이면 아무것도 하지 않는다. 권한이 막힌 것이면 내려받기로 넘어간다.
      if ((e as DOMException)?.name === 'AbortError') return
    }
  }
  // 크롬은 잇달아 누른 내려받기를 10개에서 끊는다(성수 19개 층 중 9개가 조용히 빠졌다). 하나씩 틈을 둔다.
  for (const [i, f] of files.entries()) {
    if (i) await new Promise((r) => window.setTimeout(r, 250))
    download(f.name, f.text, 'application/geo+json')
  }
}

function exportTTL() {
  if (!model.value) return
  download('ontology.ttl', modelToTTL(model.value), 'text/turtle')
}
</script>

<template>
  <main :class="model ? ['has-model', `mode-${mode}`] : ''">
    <header v-if="!model">
      <div class="title">
        <div>
          <h1>ontology-editor</h1>
          <p class="sub">BIM(IFC)을 읽어 공간 온톨로지 초안을 만듭니다.</p>
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
                <template v-else>
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
                    짝 {{ baseName(partnerOf(f.path)!) }}와 합쳐서 열기
                  </button>
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
              <button type="button" :aria-pressed="mode === 'view'" @click="mode = 'view'">보기</button>
              <button type="button" :aria-pressed="mode === 'edit'" @click="mode = 'edit'">편집</button>
            </div>
            <span class="bar-sep" aria-hidden="true"></span>
            <button type="button" class="ghost" aria-label="기하 내보내기 (GeoJSON)" title="형상 내보내기 (층마다 GeoJSON 파일 하나)" @click="exportGeoJSON">GeoJSON</button>
            <button type="button" class="ghost" aria-label="의미 내보내기 (Brick TTL)" title="관계 내보내기 (Brick TTL 파일 하나)" @click="exportTTL">TTL</button>
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
          <span class="state"><b>편집 중</b> · <a href="#changes" class="link">바뀐 것 {{ changeCount }}건</a></span>
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
            title="편집 저장 (Ctrl+S). 바뀐 내용을 JSON으로 내려받습니다. 같은 IFC를 다시 열고 불러오면 이어서 편집할 수 있습니다."
            @click="saveEdits"
          >
            편집 저장
          </button>
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
              :editing="editing"
              @select="select"
              @move-vertex="dropVertex"
            />
            <p v-else-if="activeTab === 'plan'" class="plan-empty">
              평면도는 층 하나를 그립니다. 오른쪽 위에서 층을 고르세요.
            </p>
            <!-- 외곽선 그리기 중. 찍은 점 수와 마침·한 점 지우기·취소. -->
            <div v-if="drawing" class="draw-bar" role="status">
              <template v-if="drawing.purpose === 'split'">
                <b>{{ drawing.name }}</b> 나누기 · 나눌 선의 두 점을 바닥에 찍습니다 · {{ drawing.points.length }}/2
              </template>
              <template v-else-if="drawing.purpose === 'wall'">
                <b>{{ drawing.name }}</b> 긋기 · 벽의 두 끝점을 바닥에 찍습니다 · {{ drawing.points.length }}/2
              </template>
              <template v-else>
                <b>{{ drawing.name }}</b> {{ drawing.purpose === 'create' ? '그리기' : '외곽선 그리기' }} · 바닥을 눌러 꼭짓점을 찍습니다 ·
                {{ drawing.points.length }}개
              </template>
              <button v-if="drawing.purpose !== 'split' && drawing.purpose !== 'wall'" type="button" class="ghost" :disabled="drawing.points.length < 3" @click="finishDraw">마침 <kbd>Enter</kbd></button>
              <button type="button" class="ghost" :disabled="!drawing.points.length" @click="undoDrawPoint">한 점 지우기</button>
              <button type="button" class="ghost" @click="stopDraw">취소 <kbd>Esc</kbd></button>
            </div>
            <div class="view-tools">
              <!-- 보기 ↔ 편집, 단축키 안내. 위 도구막대와 같은 일이라 전체 화면(도구막대가 안 보인다)에서만 둔다.
                   평소에도 두었더니 같은 스위치가 한 화면에 둘이었다. -->
              <label v-if="fullscreen" class="edit-toggle" title="켜면 3D에서 설비와 물리존 꼭짓점을 옮기고 연결 방향을 정할 수 있습니다.">
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
              <!-- 새 물리존·설비(E3·E7). 넣을 층은 층 하나만 보는 중이면 그 층이다(targetStorey). -->
              <template v-if="editing && !drawing">
                <button type="button" class="ghost" title="바닥에 꼭짓점을 찍어 새 물리존을 그립니다" @click="startCreateSpace">물리존 그리기</button>
                <button
                  type="button"
                  :class="['ghost', { on: adding?.what === 'equipment' }]"
                  :aria-pressed="adding?.what === 'equipment'"
                  title="바닥을 눌러 새 설비를 놓습니다"
                  @click="adding?.what === 'equipment' ? stopAdd() : startAddEquipment()"
                >
                  {{ adding?.what === 'equipment' ? '더하기 취소' : '설비 더하기' }}
                </button>
                <!-- 벽·문·창(E4). 켜면 3D 에 벽·문·창이 서고 바닥 누르기가 그것을 먼저 고른다. -->
                <button
                  type="button"
                  :class="['ghost', { on: archMode }]"
                  :aria-pressed="archMode"
                  title="벽·문·창을 3D에 세우고 고쳐 봅니다"
                  @click="archMode = !archMode"
                >
                  벽·문·창
                </button>
                <template v-if="archMode">
                  <button type="button" class="ghost" title="바닥에 두 점을 찍어 벽을 긋습니다" @click="startWall">벽 긋기</button>
                  <button type="button" :class="['ghost', { on: adding?.what === 'door' }]" title="벽 가까이 눌러 문을 놓습니다" @click="adding?.what === 'door' ? stopAdd() : startOpening('door')">문 놓기</button>
                  <button type="button" :class="['ghost', { on: adding?.what === 'window' }]" title="벽 가까이 눌러 창을 놓습니다" @click="adding?.what === 'window' ? stopAdd() : startOpening('window')">창 놓기</button>
                </template>
              </template>
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
                <button type="button" :aria-pressed="activeTab === 'plan'" @click="activeTab = 'plan'">평면도</button>
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
            <template v-if="selectedSpace">
              파란 손잡이 끌기 또는 <kbd>[ ]</kbd> 후 <kbd>←↑→↓</kbd>: 꼭짓점 옮기기 · <kbd>F</kbd>: 이 물리존 보기
            </template>
            <template v-else-if="selected">
              끌기 또는 <kbd>←↑→↓</kbd>: 옮기기 · <kbd>PageUp/Down</kbd>: 층 바꾸기 · 화살표 클릭 또는 <kbd>[ ]</kbd>: 연결 고르기 ·
              <kbd>D</kbd>: 방향 바꾸기 · <kbd>K</kbd>: 종류 고르기
            </template>
            <template v-else>
              설비 클릭: 고르기 · 고른 설비 끌기: 옮기기 · 바닥 클릭: 물리존 꼭짓점 보기 ·
              <kbd>U</kbd>: 종류 모르는 설비로
            </template>
            · <button type="button" class="link" @click="helpOpen = true">단축키 전체 <kbd>?</kbd></button>
          </p>
          <p v-else-if="counts.equipment > 0" class="hint pick-hint">
            {{
              selectedSystemId
                ? '계통 하나만 보는 중입니다. 다시 누르면 전체를 봅니다.'
                : '설비·배관을 클릭하면 연결된 것이 색으로 표시됩니다. 계통은 오른쪽 범례에서 고르세요.'
            }}
          </p>
        </section>

        <aside class="side">
        <!-- 고른 설비의 연결. 상류·하류를 아는지 모르는지를 여기서 분명히 말한다. -->
        <section v-if="selected" class="picked">
          <div class="picked-head">
            <div>
              <h3>{{ selected.name || '(이름 없음)' }}</h3>
              <p class="stats">
                <template v-if="whatIs(selected)">{{ whatIs(selected)!.label }} <Src :kind="whatIs(selected)!.src" /> · </template>
                <template v-if="selected.added">에디터에서 더한 설비 <Src kind="edit" /></template>
                <template v-else>{{ selected.declaredType ?? selected.ifcClass }} <Src kind="bim" /></template>
                <template v-if="roleLabel(selected.role)"> · {{ roleLabel(selected.role) }} <Src :kind="roleSrc(selected)" /></template> ·
                {{ selected.systemId ? systemById.get(selected.systemId)?.name : '(계통 없음)' }}
                <Src v-if="selected.systemEdited" kind="edit" /><Src v-else-if="selected.systemId" kind="bim" /> ·
                {{ spaceNameOf(selected.spaceId) }}
                <Src v-if="selected.spaceId" :kind="spaceSrc(selected)" />
              </p>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="frameNetwork">연결망 보기</button>
              <button type="button" class="ghost" @click="select(null)">선택 해제</button>
            </div>
          </div>

          <!-- 이름(태그) 고치기와 지우기(E7). 지우면 붙은 연결·계통 자리도 빠지고 Ctrl+Z 로 돌아온다. -->
          <p v-if="editing" class="equipment-name-edit">
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
            <button type="button" class="ghost danger" title="이 설비와 붙은 연결을 지웁니다 (Ctrl+Z 로 되돌림)" @click="removeEquipment(selected.id)">
              설비 지우기
            </button>
          </p>

          <!-- 종류 지정. 사전이 모르거나 잘못 읽은 종류를 같은 패밀리 전부에 한 번에 정한다. -->
          <p v-if="editing" class="kind-edit">
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

          <!-- 계통(E8). 설비의 계통 한 자리를 바꾼다. 규칙 방향을 다시 돌리고 TTL 의 brick:hasPart 가 바뀐다. -->
          <p v-if="editing" class="system-edit">
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
          <form v-if="editing && newSystemOpen" class="system-edit new-system" @submit.prevent="createSystemFor(selected.id)">
            <input v-model="newSystemName" v-keep-typing type="text" placeholder="계통 이름" aria-label="새 계통 이름" required />
            <select v-model="newSystemKind" aria-label="새 계통 종류">
              <option value="">(종류 모름)</option>
              <option v-for="k in SYSTEM_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
            </select>
            <button type="submit" class="ghost" :disabled="!newSystemName.trim()">만들어 넣기</button>
          </form>

          <!-- 위치(E5·E6). 아래 설비 표와 같은 칸이다. N 으로 소속 없는 설비에 오면 좌표를 여기서 바로 넣는다 — 표는
               화면 아래 멀리 있다. 좌표가 없는 설비는 셋이 다 차야 옮긴다(0 으로 채우지 않는다). -->
          <p v-if="editing" class="position-edit">
            위치
            <label v-for="axis in [0, 1, 2] as const" :key="axis">
              {{ 'xyz'[axis] }}
              <input
                class="coord mono"
                type="number"
                step="0.1"
                v-keep-typing
                :value="selected.position ? selected.position[axis] : (positionDrafts.get(selected.id)?.[axis] ?? '')"
                placeholder="—"
                @change="applyMove(selected.id, axis, ($event.target as HTMLInputElement).value, selected.position)"
              />
            </label>
            <Src v-if="selected.position" :kind="positionSrc(selected)" />
            <button
              v-if="!selected.position"
              type="button"
              :class="['ghost', 'place', { on: placing === selected.id }]"
              :aria-pressed="placing === selected.id"
              @click="placing === selected.id ? stopPlace() : startPlace(selected.id)"
            >
              {{ placing === selected.id ? '놓기 취소' : '3D에서 놓기' }}
            </button>
            <span class="muted">
              {{
                selected.position
                  ? `${selected.spaceId ? `소속 ${spaceNameOf(selected.spaceId)}` : '소속 방 없음'} · 방향키로도 옮길 수 있습니다`
                  : positionDrafts.has(selected.id)
                    ? 'x·y·z를 모두 넣어야 옮겨집니다'
                    : '좌표가 없습니다. x·y·z를 넣으면 소속 방을 찾습니다'
              }}
            </span>
          </p>

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
              {{ connectFrom ? '잇기 취소' : '잇기' }}
            </button>
          </h4>
          <p v-if="connectFrom" class="edit-notice inline">이을 상대를 3D나 목록에서 고르세요. <kbd>Esc</kbd>로 취소합니다.</p>
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
                    <button v-if="n.source !== 'port'" type="button" class="ghost cut" title="이 연결을 끊습니다" @click="disconnect(n.connection)">끊기</button>
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

        </section>

        <!-- 3D 에서 고른 물리존(E2). 편집 모드에서 바닥을 누르면 뜬다. -->
        <!-- 3D 에서 고른 벽·문·창(E4). [벽·문·창] 을 켰을 때만 골라진다. -->
        <section v-else-if="selectedElement" class="picked element-picked">
          <div class="picked-head">
            <div>
              <h3>{{ selectedElement.wall?.name || selectedElement.opening?.name || elementLabel(selectedElement.kind) }}</h3>
              <p class="stats">
                {{ elementLabel(selectedElement.kind) }}
                <Src :kind="(selectedElement.wall ?? selectedElement.opening)?.added ? 'edit' : 'bim'" /> ·
                {{ selectedElement.storey.name }}
                <template v-if="selectedElement.wall">
                  · 두께 {{ selectedElement.wall.thickness !== null ? `${selectedElement.wall.thickness.toFixed(2)}m` : '모름' }}
                </template>
                <template v-if="selectedElement.opening?.width">· 너비 {{ selectedElement.opening.width.toFixed(2) }}m</template>
              </p>
            </div>
            <div class="picked-actions">
              <button type="button" class="ghost" @click="selectedElementId = null">선택 해제</button>
            </div>
          </div>
          <p v-if="selectedElement.wall" class="storey-move carry-rooms">
            <label title="벽 면에서 0.6m 안의 방 변이 벽이 움직인 만큼 따라옵니다. 끄면 방 경계는 그대로입니다(방은 IfcSpace 가 따로 그린 것)">
              <input v-model="carryRooms" type="checkbox" /> 옮길 때 방 경계도 같이
            </label>
          </p>
          <p v-if="selectedElement.wall" class="storey-move">
            <label>
              내력
              <select
                :value="String(selectedElement.wall.loadBearing)"
                @change="setBearing(selectedElement.wall!, ($event.target as HTMLSelectElement).value)"
              >
                <option value="true">내력벽</option>
                <option value="false">비내력벽</option>
                <option value="null">모름</option>
              </select>
            </label>
            <Src :kind="selectedElement.wall.added ? 'edit' : 'bim'" />
            <span class="muted">모름은 아니오가 아닙니다.</span>
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
                :value="selectedElement.opening.position[axis]"
                @change="applyOpeningPosition(selectedElement.opening!, axis, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </p>
          <p v-if="selectedElement.opening?.kind === 'door'" class="stats">
            잇는 방:
            {{ selectedElement.opening.connects?.length ? selectedElement.opening.connects.map(nameOfSpace).join(' · ') : '(없음)' }}
            <Src v-if="selectedElement.opening.connectsSource" :kind="selectedElement.opening.connectsSource === 'bim' ? 'bim' : 'calc'" />
          </p>
          <p class="space-tools">
            <button type="button" class="ghost danger" @click="removeElement">
              {{ elementLabel(selectedElement.kind) }} 지우기
            </button>
            <span class="muted">
              {{ selectedElement.wall ? '뚫린 문·창도 같이 지워집니다. ' : '' }}방향키로 옮깁니다(Shift 1m).
              {{ selectedElement.wall && carryRooms ? '벽 가까운 방 변이 벽에 수직으로 따라옵니다.' : '방 경계는 따라 바뀌지 않습니다.' }}
            </span>
          </p>
        </section>
        <section v-else-if="selectedSpace" class="picked space-picked">
          <div class="picked-head">
            <div>
              <h3>{{ selectedSpace.space.longName || selectedSpace.space.name }}</h3>
              <p class="stats">
                물리존 {{ selectedSpace.space.name }} <Src kind="bim" /> · {{ selectedSpace.storey.name }} <Src kind="bim" /> ·
                <b class="mono">{{ selectedSpace.space.areaM2.toFixed(1) }}</b> ㎡
                <Src :kind="selectedSpace.edited ? 'edit' : 'calc'" /> · 소속 설비 {{ selectedSpace.equipment.length }}대
                <Src kind="calc" />
                <template v-if="zoneOfSpace.get(selectedSpace.space.id)">
                  · 공조존 {{ zoneOfSpace.get(selectedSpace.space.id)!.name }} <Src kind="idf" />
                </template>
              </p>
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
          <p class="hint">
            파란 손잡이를 끌어 경계를 고칩니다. 넓이와 설비 소속은 다시 계산됩니다. 경계선이 서로 교차하는 곳으로는
            옮길 수 없습니다. <kbd>[ ]</kbd>로 꼭짓점을 고르면 넣거나 지울 수 있습니다.
          </p>
          <!-- 나누기·합치기·지우기(E3). 합칠 방은 벽 두께 안의 같은 층 방만 가까운 순으로 보인다. -->
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
            <button type="button" class="ghost danger" :disabled="selectedSpace.storey.spaces.length <= 1" title="이 물리존을 지웁니다. 안의 설비는 좌표로 다시 소속을 찾습니다" @click="removeSpace">
              지우기
            </button>
          </p>
          <p v-if="editing && activeVertex !== null" class="vertex-tools">
            <span>꼭짓점 {{ activeVertex + 1 }}/{{ vertexCount }}</span>
            <button type="button" class="ghost" title="다음 꼭짓점과의 가운데에 넣습니다 (Insert)" @click="editVertex('insert')">꼭짓점 넣기</button>
            <button type="button" class="ghost" :disabled="vertexCount <= 3" title="Delete" @click="editVertex('delete')">꼭짓점 지우기</button>
          </p>
          <ul v-if="selectedSpace.equipment.length" class="plain space-members">
            <li v-for="e in selectedSpace.equipment" :key="e.id">
              <button type="button" class="link" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
              <span class="muted">{{ whatIs(e)?.label }}</span>
            </li>
          </ul>
          <p v-else class="empty">이 물리존에 속한 설비가 없습니다.</p>
        </section>
        <!-- 아무것도 고르지 않았을 때. 이 파일이 어디까지 찼는지와, 무엇을 누르면 여기 무엇이 뜨는지. -->
        <section v-else class="overview">
          <h3>이 파일</h3>
          <TierChips :tiers="currentTiers" />
          <div v-if="pairHint && canAppend" class="pair-hint">
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

            <!-- 범례에서 고른 계통. 종류·유체는 규칙 방향과 TTL 계통 클래스를 정한다. 편집 모드에서 고친다(E8). -->
            <section v-if="selectedSystem" class="picked system-picked">
              <h3>{{ selectedSystem.name || '(이름 없는 계통)' }}</h3>
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
          <li><b>{{ counts.storeys }}</b><span>층</span><Src kind="bim" /></li>
          <li><b>{{ counts.spaces }}</b><span>물리존</span><Src kind="bim" /></li>
          <!-- 읽지 않기로 한 피처는 0 이 아니라 "읽지 않음" 이다. 0 이면 BIM 에 없다는 말이 된다. -->
          <li v-if="skipped.has('walls')" class="skipped"><b>–</b><span>벽</span><small>읽지 않음</small></li>
          <li v-else><b>{{ counts.walls }}</b><span>벽</span><Src kind="bim" /></li>
          <li v-if="skipped.has('doors')" class="skipped"><b>–</b><span>문</span><small>읽지 않음</small></li>
          <li v-else :class="{ wide: doorLinks.total > 0 }">
            <b>{{ counts.doors }}</b><span>문</span><Src kind="bim" />
            <!-- 방-문-방. BIM 의 공간 경계가 말하면 BIM, 없으면 문 양쪽을 좌표로 짚은 계산이다. -->
            <small v-if="doorLinks.total > 0">
              방과 방을 잇는 문 {{ doorLinks.two }}
              <template v-if="doorLinks.bim"><Src kind="bim" /></template>
              <template v-if="doorLinks.calc"><Src kind="calc" /></template>
            </small>
          </li>
          <li v-if="skipped.has('windows')" class="skipped"><b>–</b><span>창문</span><small>읽지 않음</small></li>
          <li v-else><b>{{ counts.windows }}</b><span>창문</span><Src kind="bim" /></li>
          <li v-if="!skipped.has('walls')"><b>{{ counts.loadBearingWalls }}</b><span>내력벽</span><Src kind="bim" /></li>
          <li v-if="model.hvac" class="wide">
            <b>{{ model.hvac.zones.length }}</b><span>공조존</span><Src kind="idf" />
            <small v-if="idfReport">
              방이 든 존 {{ idfReport.zonesWithSpaces }} · 존에 든 방 {{ idfReport.spacesInZones }}/{{ idfReport.spaces }} <Src kind="calc" />
              <template v-if="idfReport.straddling"> · 두 존에 걸친 방 {{ idfReport.straddling }}</template>
              <template v-if="idfReport.partial"> · 절반 못 덮인 방 {{ idfReport.partial }}</template>
            </small>
          </li>
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

        <ul v-if="mergeLines.length" class="merge">
          <li class="merge-src"><Src kind="calc" /> 두 파일을 층 이름·높이와 좌표로 맞춰 합쳤습니다.</li>
          <li v-for="line in mergeLines" :key="line">{{ line }}</li>
        </ul>

        <ul v-if="warnings.length" id="warnings" class="warnings">
          <li v-for="w in warnings" :key="w">{{ w }}</li>
        </ul>

        <!-- 고객사 BIM 요구사항(정본 4장)에 대 본 것. IDS 와 달리 "다른 자리에 있다(우리는 읽는다)"를 따로 센다. -->
        <Fold v-if="currentRequirements.length" title="요구사항" :meta="requirementsMeta" :default-open="false" class="requirements">
          <table class="req-table">
            <thead>
              <tr><th>#</th><th>요구</th><th>상태</th><th class="num" title="표준 자리 · 다른 자리 / 전체">개수</th><th>설명</th></tr>
            </thead>
            <tbody v-for="g in requirementGroups" :key="g.level">
              <tr class="req-group">
                <th colspan="5">{{ g.level }}{{ g.level === '필수' ? ' — 없으면 대신 채울 방법이 없음' : ' — 없으면 계산·사전·수작업으로 채움' }}</th>
              </tr>
              <tr v-for="r in g.rows" :key="r.id">
                <td class="mono">{{ r.id }}</td>
                <td>{{ r.title }}</td>
                <td><span :class="['req-state', r.state]">{{ REQUIREMENT_STATE[r.state] }}</span></td>
                <td class="num mono">
                  <template v-if="r.counts && r.counts.of">{{ r.counts.standard }}<template v-if="r.counts.elsewhere"> · {{ r.counts.elsewhere }}</template> / {{ r.counts.of }}</template>
                </td>
                <td class="muted">{{ r.note }}</td>
              </tr>
            </tbody>
          </table>
          <p class="hint">
            표준 자리는 IDS(<span class="mono">docs/requirements.ids</span>) 검사도 통과합니다. 다른 자리는 값이 있어 읽을 수 있지만,
            내보내기 설정을 바꾸면 표준 자리로 옮길 수 있습니다. 기준은 정본 4장을 보세요.
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
            <table class="version-sum">
              <thead>
                <tr>
                  <th></th>
                  <th class="num">이전 → 지금</th>
                  <th class="num">양쪽에 있는 것</th>
                  <th>그중 GUID가 바뀐 것 <Src kind="calc" /></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="[label, k] in [['물리존', versionDiff.diff.spaces], ['설비', versionDiff.diff.equipment]] as const" :key="label">
                  <th>{{ label }}</th>
                  <td class="num mono">{{ k.prevCount }} → {{ k.nextCount }}</td>
                  <td class="num mono">{{ k.by.guid + k.by.revitId + k.by.name + k.by.position }}</td>
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
              GUID가 바뀌어도 편집 파일은 Revit 요소 ID·이름·위치로 찾아 적용합니다. 다만 DT 쪽에서는 다른 id가 됩니다(요구사항 R13).
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
              <tr v-for="r in ruleSystems" :key="r.id" :class="{ chosen: selectedSystemId === r.id }">
                <td class="sys">
                  <i :style="{ background: r.color ?? 'transparent' }"></i>
                  <button type="button" class="link" :aria-pressed="selectedSystemId === r.id" @click="toggleSystem(r.id)">
                    {{ r.name }}
                  </button>
                </td>
                <td :class="{ muted: !r.kind }">{{ r.kind || '모름' }}</td>
                <td class="num mono">{{ r.count }}</td>
                <td class="num mono">
                  <template v-if="r.pct !== null">
                    <b :class="{ low: r.pct < 80 }">{{ r.pct }}%</b> <span class="muted">{{ r.agree }}/{{ r.checked }}</span>
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
                <td class="num mono">{{ (Math.abs(s.elevation) < 0.005 ? 0 : s.elevation).toFixed(2) }} m</td>
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
            <label class="grow">
              이름
              <input ref="searchInput" v-model="editQuery" type="search" placeholder="물리존·설비 이름이나 종류  ( / )" />
            </label>
            <span class="muted">{{ editing ? '아래 두 표에 함께 적용됩니다.' : '설비 목록에 적용됩니다.' }}</span>
          </div>

          <!-- 물리존 하나를 한 줄에서 고친다. 이름(E1)과 경계(E2)를 두 목록으로 나눴더니 같은 방을 두 번 찾아야 했다.
               긴 표는 제 상자 안에서 스크롤하고 머리줄은 붙어 있다 — 페이지가 표만큼 길어지면 3D 로 돌아가기가 멀다. -->
          <Fold v-if="editing" title="물리존 이름·경계 (E1 · E2)" :meta="`${counts.spaces}개`" :default-open="counts.spaces <= SMALL">
            <p class="hint">
              3D에서 바닥을 클릭하면 오른쪽 패널에서도 고칠 수 있습니다. 꼭짓점을 고치면 넓이와 설비 소속이 다시 계산됩니다.
            </p>
            <div class="table-box">
              <table class="spaces-edit">
                <thead>
                  <tr>
                    <th>층</th>
                    <th>이름</th>
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
            :meta="`기기 ${counts.devices} · 덕트·배관 ${counts.conduits}`"
            :default-open="counts.equipment <= SMALL"
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
                <tr v-for="e in editEquipment.slice(0, editLimit)" :key="e.id" :class="{ chosen: e.id === selectedId }">
                  <td>
                    <!-- 표에서 고른 것과 3D 에서 고른 것이 같은 선택이다. 두 화면이 따로 놀면
                         설비 목록에서 찾은 것을 3D 에서 다시 찾아야 한다. -->
                    <button type="button" class="link" @click="selectAndShow(e.id)">{{ e.name || e.ifcClass }}</button>
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
                      :value="e.position ? e.position[axis] : (positionDrafts.get(e.id)?.[axis] ?? '')"
                      placeholder="—"
                      @change="applyMove(e.id, axis as 0 | 1 | 2, ($event.target as HTMLInputElement).value, e.position)"
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
          </Fold>

          <template v-if="editing || changeCount > 0">
          <div class="changes-head">
            <h3 id="changes">바뀐 내용</h3>
            <button type="button" class="ghost" :disabled="changeCount === 0" @click="saveEdits">편집 저장</button>
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
              <b>{{ nameOfId(c.from) }}</b> — <b>{{ nameOfId(c.to) }}</b>: 연결을 이었습니다(방향을 정하면 brick:feeds)
            </li>
            <li v-for="(c, i) in sinceOpen.disconnected" :key="`cut-${i}`">
              <b>{{ nameOfId(c.from) }}</b> — <b>{{ nameOfId(c.to) }}</b>: 연결을 끊었습니다
            </li>
            <li v-for="r in sinceOpen.spacesAdded" :key="`space-add-${r.id}`">
              물리존 <b>{{ r.name || r.id }}</b>을 만들었습니다 (brick:hasPart, GeoJSON)
            </li>
            <li v-for="r in sinceOpen.spacesRemoved" :key="`space-rm-${r.id}`">
              물리존 <b>{{ r.name }}</b>이 없어졌습니다(지우거나 합침). 그 안의 설비는 좌표로 다시 소속을 찾았습니다
            </li>
            <li v-for="r in sinceOpen.equipmentAdded" :key="`eq-add-${r.id}`">
              설비 <b>{{ r.name }}</b>을 더했습니다 (brick:hasLocation)
            </li>
            <li v-for="r in sinceOpen.equipmentRemoved" :key="`eq-rm-${r.id}`">
              설비 <b>{{ r.name }}</b>을 지웠습니다(붙은 연결도 같이)
            </li>
            <li v-for="r in sinceOpen.equipmentRenamed" :key="`eq-name-${r.id}`">
              설비 이름 <b>{{ r.from || '(없음)' }}</b> → <b>{{ r.to || '(없음)' }}</b> (rdfs:label)
            </li>
            <li v-for="r in sinceOpen.wallsAdded" :key="`wall-add-${r.id}`">벽 <b>{{ r.name }}</b>을 그었습니다 (GeoJSON)</li>
            <li v-for="r in sinceOpen.wallsRemoved" :key="`wall-rm-${r.id}`">벽 <b>{{ r.name }}</b>을 지웠습니다(뚫린 문·창도 같이, GeoJSON)</li>
            <li v-for="r in sinceOpen.wallsChanged" :key="`wall-ch-${r.id}`">
              벽 <b>{{ r.name }}</b>:
              <template v-if="r.moved">옮김</template><template v-if="r.moved && r.loadBearing"> · </template>
              <template v-if="r.loadBearing">내력 {{ r.loadBearing.from === null ? '모름' : r.loadBearing.from ? '내력' : '비내력' }} → <b>{{ r.loadBearing.to === null ? '모름' : r.loadBearing.to ? '내력' : '비내력' }}</b></template>
              (GeoJSON)
            </li>
            <li v-for="r in sinceOpen.openingsAdded" :key="`op-add-${r.id}`">{{ elementLabel(r.kind) }} <b>{{ r.name }}</b>을 놓았습니다 (GeoJSON)</li>
            <li v-for="r in sinceOpen.openingsRemoved" :key="`op-rm-${r.id}`">{{ elementLabel(r.kind) }} <b>{{ r.name }}</b>을 지웠습니다 (GeoJSON)</li>
            <li v-for="r in sinceOpen.openingsMoved" :key="`op-mv-${r.id}`">{{ elementLabel(r.kind) }} <b>{{ r.name }}</b>을 옮겼습니다 (GeoJSON 위치·잇는 방)</li>
            <li v-for="r in sinceOpen.systemMoved" :key="`sys-mv-${r.id}`">
              {{ r.name }}: 계통 <b>{{ systemNameOf(r.from) }}</b> → <b>{{ systemNameOf(r.to) }}</b> (brick:hasPart)
            </li>
            <li v-for="r in sinceOpen.systemsAdded" :key="`sys-add-${r.id}`">계통 <b>{{ r.name }}</b>을 만들었습니다 (brick:hasPart)</li>
            <li v-for="r in sinceOpen.systemsRemoved" :key="`sys-rm-${r.id}`">계통 <b>{{ r.name || r.id }}</b>을 지웠습니다</li>
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
          <b>내보내기</b>(도구막대의 GeoJSON · TTL).
          두 파일은 같은 id로 연결됩니다. 형상은 GeoJSON, 설비와 계통의 관계는 TTL에 들어갑니다.
          벽·문·창과 문이 잇는 방은 GeoJSON에만 있습니다(Brick에 건축 부재 클래스가 없음).
          벽·문·창은 '읽을 것'에서 켠 것만 들어가고, 문·창 위치는 '문·창 자리'를 켜고 연 파일에서만 나갑니다.
          TTL의 설비·방 클래스는 <Src kind="dict" /> 기준이고, 규칙 방향은 확정한 계통만 들어갑니다.
        </p>
      </section>
    </template>
    <ShortcutHelp :open="helpOpen" :editing="editing" @close="helpOpen = false" />
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
