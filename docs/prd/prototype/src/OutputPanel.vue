<script setup lang="ts">
// 온톨로지 결과물 형태(OE-GEN-01·06, OE-INT-02·03). 어떤 파일이 나가고, 각 파일이 무엇을 담고, BIM 의 무엇이 어느 줄이 되는지 보인다.
// R1 은 다운로드까지다 — DT 에 보이는지는 확인하지 않는다(OE-GEN-06). IMDF 는 범위 아님(OE-INT-03, D11).
import { computed, ref } from 'vue'
import type { Model, Storey } from '../../../../src/lib/model'
import type { MeshMap } from '../../../../src/lib/ifc/import'
import { readOntologyTTL } from '../../../../src/lib/export/read-ttl'
import { modelToScene, sceneToGLB, sceneToOBJ, disposeScene } from '../../../../src/lib/export/mesh3d'

type Output = { ttl: string; geojson: string; hash: string; entities: number; unread: number }
const props = defineProps<{ model: Model; floor: Storey; meshes?: MeshMap; output?: Output; busy: boolean }>()
const emit = defineEmits<{ build: []; download: [name: string, body: BlobPart, type: string]; notice: [message: string] }>()

const kb = (s: string) => (new Blob([s]).size / 1024).toFixed(1) + ' KB'
const reading = computed(() => props.output ? readOntologyTTL(props.output.ttl) : null)
const byClass = computed(() => {
  const m = new Map<string, number>()
  for (const e of reading.value?.entities ?? []) m.set(e.cls, (m.get(e.cls) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
})
const features = computed(() => { try { return (JSON.parse(props.output?.geojson ?? '{}').features ?? []).length as number } catch { return 0 } })
const coordsInTtl = computed(() => /(\d+\.\d+)\s*,\s*(\d+\.\d+)/.test((props.output?.ttl ?? '').replace(/"[^"]*"/g, '')))
const sample = computed(() => reading.value?.entities.find(e => e.cls.includes('Zone') || e.cls.includes('Room'))?.source ?? reading.value?.entities[0]?.source ?? '')
const hvacCount = computed(() => (props.model.hvac?.zones ?? []).filter(z => z.storeyId === props.floor.id).length + (props.floor.hvacZones?.length ?? 0))

// BIM 요소가 어디에 남는가 — 층의 실제 개수로 센다.
const provenance = computed(() => {
  const f = props.floor
  const equipment = f.equipment.filter(e => e.position).length
  return [
    { what: '물리존(IfcSpace)', n: f.spaces.length, ttl: '`ex:<id> a brick:Room` · `brick:hasPart`(층→방)', geo: '다각형 Feature(외곽선)', from: 'BIM · 사람이 그린 것은 사람' },
    { what: '커스텀존', n: f.customZones?.length ?? 0, ttl: '`ex:<id> a ex:CustomZone` + 담당 물리존', geo: '다각형 Feature', from: '사람' },
    { what: '공조존(IDF 에너지존)', n: hvacCount.value, ttl: '`ex:<id> a brick:HVAC_Zone` · `brick:hasPart`(물리존) · `brick:feeds`(설비)', geo: '다각형 Feature', from: 'IDF · 계산(매칭은 확인한 것만) · 사람' },
    { what: '설비(좌표 있음)', n: equipment, ttl: '`ex:<id> a brick:<종류>` · `brick:hasLocation`(소속 물리존)', geo: '점 Feature(좌표)', from: 'BIM · 계산(소속) · 사람' },
    { what: '설비(미배치)', n: f.equipment.length - equipment, ttl: 'TTL 에는 나가고(좌표 없음)', geo: '나가지 않음(`geometry: null` 아님, 제외)', from: 'BIM' },
    { what: '벽·문·창', n: f.walls.length + f.openings.length, ttl: '나가지 않음(의미 모델에 없음)', geo: '선·다각형 Feature(있는 형상만)', from: 'BIM' },
  ]
})

// 온톨로지 → BIM 역생성 검토 메모(요구사항 아님). 지금 결과물만으로 되살릴 수 있는 것과 없는 것.
const reverse = computed(() => [
  { item: '층·물리존 외곽선과 방 이름·번호', can: '됨', why: 'GeoJSON 다각형과 TTL 이름으로 IfcSpace 를 다시 만들 수 있다' },
  { item: '설비 위치와 종류', can: '됨(부분)', why: '점 좌표와 Brick 클래스는 있으나 형상·제조사 속성은 없다' },
  { item: '벽 두께·재료·문·창 개구', can: '안 됨', why: '온톨로지에 벽 형상이 없고 GeoJSON 도 외곽선뿐이다' },
  { item: '배관·덕트 경로 형상', can: '안 됨', why: '연결(`brick:feeds`)만 있고 경로 좌표가 없다' },
  { item: 'IFC 원본 GUID·속성 세트', can: '안 됨', why: '식별자는 이어지지만 속성은 담지 않는다(INT-06 Revit ID 보조 식별자 미정)' },
])

const made = ref('')
async function make(format: 'glb' | 'obj') {
  try {
    const scene = modelToScene(props.model, props.meshes ?? new Map())
    if (format === 'glb') {
      const buf = await sceneToGLB(scene); emit('download', props.floor.name + '.glb', buf, 'model/gltf-binary')
    } else {
      const parts = await sceneToOBJ(scene); emit('download', props.floor.name + '.obj', parts.join(''), 'text/plain')
    }
    disposeScene(scene); made.value = format.toUpperCase() + ' 형상을 만들어 내려받았습니다.'
  } catch (e) { emit('notice', '3D 형상 생성 실패: ' + (e instanceof Error ? e.message : String(e))) }
}
</script>
<template>
  <article class="output-panel" data-testid="output-panel">
    <h3>결과물 형태 <small>OE-GEN-01·06 · OE-INT-02·03</small></h3>
    <p class="footnote">R1 은 파일을 만들어 내려받는 데까지입니다. DT 에 보이는지는 확인하지 않습니다.</p>
    <div class="button-row"><button :disabled="busy" @click="emit('build')">{{ output ? '결과물 다시 만들기' : '결과물 미리 만들기' }}</button>
      <button :disabled="!output" @click="output && emit('download', floor.name + '.ttl', output.ttl, 'text/turtle')">TTL</button>
      <button :disabled="!output" @click="output && emit('download', floor.name + '.geojson', output.geojson, 'application/geo+json')">GeoJSON</button>
      <button data-testid="make-obj" @click="make('obj')">OBJ</button><button data-testid="make-glb" @click="make('glb')">GLB</button></div>
    <p v-if="made" class="footnote" role="status">{{ made }}</p>
    <table class="output-table"><tbody>
      <tr><th>파일</th><th>담는 것</th><th>상태</th></tr>
      <tr><td>Brick TTL</td><td>의미: 계층·소속·연결·담당. 좌표는 넣지 않는다</td><td data-testid="ttl-state">{{ output ? kb(output.ttl) + ' · ' + (reading?.entities.length ?? 0) + '개 개체' + (coordsInTtl ? ' · 좌표 같은 숫자가 보임' : ' · 좌표 리터럴 없음') : '아직 만들지 않음' }}</td></tr>
      <tr><td>GeoJSON</td><td>기하: 물리존·공조존 외곽선, 설비 좌표(층마다 한 파일)</td><td data-testid="geo-state">{{ output ? kb(output.geojson) + ' · Feature ' + features + '개' : '아직 만들지 않음' }}</td></tr>
      <tr><td>OBJ · BIN(GLB)</td><td>3D 형상: 판·벽·설비 상자. DT 3D Map 용</td><td>버튼으로 만들어 내려받음</td></tr>
      <tr><td>IMDF</td><td>실내 지도 변환</td><td>범위 아님(OE-INT-03 · D11 결정 전)</td></tr>
    </tbody></table>
    <p v-if="output" class="footnote">TTL 과 GeoJSON 은 같은 ID 로 이어집니다. SHA-256 <code>{{ output.hash.slice(0, 16) }}…</code></p>
    <details open><summary>BIM·IDF 가 결과물의 어느 줄이 되나 <small>{{ floor.name }}</small></summary>
      <table class="output-table" data-testid="provenance"><tbody>
        <tr><th>요소</th><th>개수</th><th>TTL</th><th>GeoJSON</th><th>출처</th></tr>
        <tr v-for="r in provenance" :key="r.what"><td>{{ r.what }}</td><td>{{ r.n }}</td><td>{{ r.ttl }}</td><td>{{ r.geo }}</td><td>{{ r.from }}</td></tr>
      </tbody></table>
    </details>
    <details v-if="output"><summary>TTL 클래스별 개체 수</summary>
      <ul class="detail-list"><li v-for="[c, n] in byClass" :key="c">{{ c }} <b>{{ n }}</b></li></ul>
      <pre v-if="sample" class="ttl-sample">{{ sample }}</pre></details>
    <details><summary>온톨로지에서 BIM 을 다시 만들 수 있나 <small>검토 메모</small></summary>
      <table class="output-table" data-testid="reverse"><tbody><tr><th>항목</th><th>가능</th><th>이유</th></tr>
        <tr v-for="r in reverse" :key="r.item"><td>{{ r.item }}</td><td>{{ r.can }}</td><td>{{ r.why }}</td></tr></tbody></table>
      <p class="footnote">결론: 지금 결과물만으로는 공간 골격과 설비 위치까지만 되살릴 수 있습니다. 벽·개구·배관 형상은 원본 BIM 이 있어야 합니다. PRD 요구사항이 아니라 검토 메모입니다.</p>
    </details>
  </article>
</template>
