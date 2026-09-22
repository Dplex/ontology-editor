<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ifcApi } from './lib/ifc/open'
import { importIfc } from './lib/ifc/import'
import { countOf, type Model } from './lib/model'
import { modelToGeoJSON } from './lib/export/geojson'
import { modelToTTL } from './lib/export/ttl'
import { createViewer, type Viewer } from './lib/viewer'

const fileName = ref('')
const busy = ref(false)
const error = ref('')
const dragging = ref(false)
const model = shallowRef<Model | null>(null)

const canvas = ref<HTMLCanvasElement | null>(null)
let viewer: Viewer | null = null

const counts = computed(() => (model.value ? countOf(model.value) : null))

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
              <td class="num mono">{{ s.equipment.length }}</td>
            </tr>
          </tbody>
        </table>
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
