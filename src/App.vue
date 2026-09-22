<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, triggerRef, watch } from 'vue'
import { ifcApi } from './lib/ifc/open'
import { importIfcWithMeshes, type MeshMap } from './lib/ifc/import'
import { countOf, type Equipment, type Model } from './lib/model'
import { neighbors, trace } from './lib/topology'
import { modelToGeoJSON } from './lib/export/geojson'
import { modelToTTL } from './lib/export/ttl'
import { createViewer, systemColors, type Viewer } from './lib/viewer'
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

// 바로 붙은 이웃. 몇 개인지보다 무엇에 붙어 있는지가 먼저 궁금한 자리다.
const selectedNeighbors = computed(() => {
  if (!model.value || !selectedId.value) return []
  return neighbors(model.value.connections, selectedId.value).map((n) => ({
    ...n,
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

watch([selectedId, selectedSystemId, model], () => {
  if (!viewer) return

  const t = traced.value
  if (selectedId.value && t) {
    viewer.setHighlight({
      selected: selectedId.value,
      upstream: t.upstream,
      downstream: t.downstream,
      linked: t.linked,
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
  const t = traced.value
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
const dataPick = ref('')

fetch('./__data/')
  .then((r) => (r.ok ? r.json() : []))
  .then((files) => (dataFiles.value = Array.isArray(files) ? files : []))
  .catch(() => {})

function onDataPick() {
  const path = dataPick.value
  if (!path) return
  void load(path.split('/').pop() ?? path, async () => {
    const r = await fetch(`./__data/${path.split('/').map(encodeURIComponent).join('/')}`)
    if (!r.ok) throw new Error(`data/${path} 를 받지 못했습니다 (HTTP ${r.status})`)
    return r.arrayBuffer()
  })
}

function mb(bytes: number) {
  return `${(bytes / 1048576).toFixed(1)} MB`
}

async function load(name: string, read: () => Promise<ArrayBuffer>) {
  busy.value = true
  error.value = ''
  try {
    const api = await ifcApi()
    const result = importIfcWithMeshes(api, new Uint8Array(await read()))
    meshes = result.meshes
    model.value = result.model
    fileName.value = name
    selectedId.value = null
    // 새 파일을 열면 이전 파일의 편집 이력은 뜻이 없다.
    changes.value = []
    areaChanges.value = []
  } catch (e) {
    // 실패한 채로 이전 모델을 남겨 두면 화면이 방금 연 파일을 보여 주는 것처럼 보인다.
    model.value = null
    meshes = new Map()
    fileName.value = ''
    error.value = `IFC 를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

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
      <p v-if="busy">읽는 중…</p>
      <p v-else>.ifc 파일을 여기에 끌어다 놓으세요.</p>
      <label class="pick">
        파일 선택
        <input type="file" accept=".ifc" :disabled="busy" @change="onPick" />
      </label>
      <div v-if="dataFiles.length" class="data-pick">
        <span>또는 data/ 에서</span>
        <select v-model="dataPick" :disabled="busy" @change="onDataPick">
          <option value="" disabled>샘플 고르기</option>
          <option v-for="f in dataFiles" :key="f.path" :value="f.path">
            {{ f.path }} · {{ mb(f.size) }}
          </option>
        </select>
      </div>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="model && counts">
      <section class="review">
        <h2>{{ fileName }}</h2>
        <p class="stats">
          {{ model.schema }} · {{ model.siteName || '(대지 이름 없음)' }} ›
          {{ model.buildingName || '(건물 이름 없음)' }}
        </p>

        <!-- PRD #6 의 임포트 결과 검토 항목이다. 무엇이 만들어졌는지 숫자로 먼저 본다. -->
        <ul class="tiles">
          <li><b>{{ counts.storeys }}</b><span>층</span></li>
          <li><b>{{ counts.spaces }}</b><span>물리존</span></li>
          <li><b>{{ counts.walls }}</b><span>벽</span></li>
          <li><b>{{ counts.doors }}</b><span>문</span></li>
          <li><b>{{ counts.windows }}</b><span>창문</span></li>
          <li><b>{{ counts.loadBearingWalls }}</b><span>내력벽</span></li>
          <!-- 설비를 하나로 세면 대수가 부푼다. 실측에서 85%가 덕트·배관이었다. -->
          <li><b>{{ counts.devices }}</b><span>기기</span></li>
          <li><b>{{ counts.conduits }}</b><span>덕트·배관</span></li>
          <li><b>{{ counts.systems }}</b><span>계통</span></li>
          <li><b>{{ counts.connections }}</b><span>연결</span></li>
          <li><b>{{ counts.directedConnections }}</b><span>흐름 방향</span></li>
        </ul>

        <ul v-if="model.warnings.length" class="warnings">
          <li v-for="w in model.warnings" :key="w">{{ w }}</li>
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
              {{ selected.ifcClass }}<template v-if="roleLabel(selected.role)"> ({{ roleLabel(selected.role) }})</template> ·
              {{ selected.systemId ? systemById.get(selected.systemId)?.name : '(계통 없음)' }} ·
              {{ spaceNameOf(selected.spaceId) }}
            </p>
          </div>
          <div class="picked-actions">
            <button type="button" class="ghost" @click="frameNetwork">연결망에 맞추기</button>
            <button type="button" class="ghost" @click="select(null)">선택 해제</button>
          </div>
        </div>

        <ul class="flow">
          <li class="upstream">
            <b>{{ traced?.upstream.size ?? 0 }}</b><span>상류</span>
          </li>
          <li class="downstream">
            <b>{{ traced?.downstream.size ?? 0 }}</b><span>하류</span>
          </li>
          <li class="linked">
            <b>{{ traced?.linked.size ?? 0 }}</b><span>이어짐 · 방향 모름</span>
          </li>
        </ul>

        <p v-if="selectedNeighbors.length === 0" class="hint">
          이 설비에 붙은 연결이 없습니다.
        </p>
        <table v-else class="neighbors">
          <tbody>
            <tr v-for="(n, i) in selectedNeighbors" :key="`${n.id}-${i}`">
              <td :class="['rel', n.relation]">
                {{ n.relation === 'upstream' ? '상류' : n.relation === 'downstream' ? '하류' : '연결' }}
              </td>
              <td>
                <button type="button" class="link" @click="select(n.id)">{{ n.name }}</button>
              </td>
              <td class="muted">
                {{ n.source === 'port' ? 'BIM 포트' : '형상 추정' }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="storeys">
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
              <td>{{ s.spaces.map((x) => x.longName || x.name).join(', ') || '—' }}</td>
              <td class="num mono">
                {{ s.spaces.reduce((n, x) => n + x.areaM2, 0).toFixed(1) }} ㎡
              </td>
              <td class="num mono">
                {{ s.walls.length }}<template v-if="s.walls.some((w) => w.thickness !== null)">
                  <span class="muted"> · {{ wallThicknessOf(s) }}</span>
                </template>
              </td>
              <td class="num mono">{{ s.equipment.length }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 편집. 3D 조작 대신 값을 직접 고친다. PoC 에서 확인할 것은 조작감이 아니라
           한 번의 편집이 온톨로지의 어느 관계를 바꾸는가이기 때문이다. -->
      <section class="editor">
        <h3>물리존 이름 (E1)</h3>
        <ul class="rows">
          <li v-for="s in model.storeys" :key="s.id">
            <template v-for="sp in s.spaces" :key="sp.id">
              <label class="row">
                <span class="tag mono">{{ s.name }}</span>
                <input
                  type="text"
                  :value="sp.longName"
                  @change="applyRename(sp.id, ($event.target as HTMLInputElement).value)"
                />
              </label>
            </template>
          </li>
        </ul>

        <h3>물리존 경계 (E2)</h3>
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
            <template v-for="s in model.storeys" :key="s.id">
              <tr v-for="sp in s.spaces" :key="sp.id">
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
            </template>
          </tbody>
        </table>
        <p v-if="selfIntersecting" class="error" role="alert">
          경계가 자기 자신과 교차합니다. 이 상태에서는 넓이와 소속 판정이 뜻을 잃습니다.
        </p>

        <h3>설비 위치와 소속 (E5 · E6)</h3>
        <table class="equipment">
          <thead>
            <tr>
              <th>설비</th>
              <th>종류</th>
              <th class="num">x</th>
              <th class="num">y</th>
              <th class="num">z</th>
              <th>소속 물리존</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="s in model.storeys" :key="s.id">
              <tr v-for="e in s.equipment" :key="e.id" :class="{ chosen: e.id === selectedId }">
                <td>
                  <!-- 표에서 고른 것과 3D 에서 고른 것이 같은 선택이다. 두 화면이 따로 놀면
                       설비 목록에서 찾은 것을 3D 에서 다시 찾아야 한다. -->
                  <button type="button" class="link" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
                </td>
                <td class="muted">{{ e.ifcClass }}</td>
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
                <td :class="{ muted: !e.spaceId }">{{ spaceNameOf(e.spaceId) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <p v-if="counts.equipment === 0" class="empty">이 BIM 에는 설비가 없습니다.</p>

        <h3>바뀌는 것 (PRD #21)</h3>
        <ul v-if="report.length || areaChanges.length" class="report">
          <li v-for="c in report" :key="c.equipmentId">
            {{ c.equipmentName }}:
            <b>{{ spaceNameOf(c.fromSpaceId) }}</b> → <b>{{ spaceNameOf(c.toSpaceId) }}</b>
          </li>
          <li v-if="areaSummary" class="muted">{{ areaSummary }}</li>
        </ul>
        <p v-else class="empty">아직 바뀐 소속 관계가 없습니다.</p>
      </section>

      <section class="actions">
        <button type="button" @click="exportGeoJSON">기하 내보내기 (GeoJSON)</button>
        <button type="button" @click="exportTTL">의미 내보내기 (Brick TTL)</button>
        <p class="note">
          두 파일은 같은 id 로 이어집니다. 기하는 GeoJSON 이 갖고, 설비와 계통은 TTL 이 갖습니다.
        </p>
      </section>
    </template>
  </main>
</template>
