<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, triggerRef, watch } from 'vue'
import { ifcApi } from './lib/ifc/open'
import { importIfc } from './lib/ifc/import'
import { countOf, type Model } from './lib/model'
import { modelToGeoJSON } from './lib/export/geojson'
import { modelToTTL } from './lib/export/ttl'
import { createViewer, type Viewer } from './lib/viewer'
import {
  moveEquipment,
  moveSpaceVertex,
  renameSpace,
  summarize,
  type BoundaryChange,
  type Change,
} from './lib/edit'

const fileName = ref('')
const busy = ref(false)
const error = ref('')
const dragging = ref(false)
const model = shallowRef<Model | null>(null)

const canvas = ref<HTMLCanvasElement | null>(null)
let viewer: Viewer | null = null

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
  viewer?.setModel(model.value)
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
  viewer?.setModel(model.value)
}

function applyRename(spaceId: string, name: string) {
  if (!model.value) return
  renameSpace(model.value, spaceId, name)
  triggerRef(model)
}

watch([model, canvas], ([m, el]) => {
  if (!m || !el) return
  if (!viewer) viewer = createViewer(el)
  viewer.setModel(m)
})

onBeforeUnmount(() => viewer?.dispose())

async function load(file: File) {
  busy.value = true
  error.value = ''
  try {
    const api = await ifcApi()
    model.value = importIfc(api, new Uint8Array(await file.arrayBuffer()))
    fileName.value = file.name
    // 새 파일을 열면 이전 파일의 편집 이력은 뜻이 없다.
    changes.value = []
    areaChanges.value = []
  } catch (e) {
    // 실패한 채로 이전 모델을 남겨 두면 화면이 방금 연 파일을 보여 주는 것처럼 보인다.
    model.value = null
    fileName.value = ''
    error.value = `IFC 를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void load(file)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void load(file)
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
      <h1>ontology-editor</h1>
      <p class="sub">BIM(IFC4)을 읽어 공간 온톨로지 초안을 만듭니다.</p>
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
          <li><b>{{ counts.equipment }}</b><span>설비</span></li>
          <li><b>{{ counts.systems }}</b><span>계통</span></li>
        </ul>

        <ul v-if="model.warnings.length" class="warnings">
          <li v-for="w in model.warnings" :key="w">{{ w }}</li>
        </ul>
      </section>

      <section class="viewport">
        <canvas ref="canvas"></canvas>
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
              <tr v-for="e in s.equipment" :key="e.id">
                <td>{{ e.name }}</td>
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
