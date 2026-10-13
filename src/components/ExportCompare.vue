<script setup lang="ts">
// 편집기 3D 옆의 비교 판(ADR-0061). 왼쪽 3D 는 모델(BIM + 편집)을, 이 판은 그 모델을 내보낸 TTL·층 GeoJSON 을 받는 쪽처럼 다시 읽은 것을
// 그린다(lib/export/compare.ts). 고르기는 GlobalId 하나로 양쪽이 같다 — 3D 에서 고르면 여기서 칠하고, 여기서 누르면 3D 가 고른다.
// 평면은 3D 시점을 따라간다(바라보는 점이 가운데, 화면 폭이 같은 길이). 카드는 그 요소가 TTL 의 어느 블록·GeoJSON 의 어느 feature 가
// 되었는지와, 받는 쪽이 아는 출처(…Source 속성)를 보인다. 내보낸 파일 뷰어(viewer.html)와 평면 모양을 같이 쓴다(plan-shapes.ts).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CompareReading } from '../lib/export/compare'
import { crossCheck } from '../lib/export/read-export'
import { KIND_LABEL, planOf } from '../lib/export/plan-shapes'
import Src, { type SrcKind } from './Src.vue'

const props = defineProps<{
  reading: CompareReading | null
  /** 다시 쓰는 중(편집 뒤). 앞의 결과를 그대로 보이며 표시만 한다. */
  pending: boolean
  error: string
  /** 3D 가 보는 층. null(모든 층·다중층 뷰)이면 고른 것의 층, 그것도 없으면 첫 층. */
  storeyId: string | null
  selectedId: string | null
  /** 3D 시점(viewer.onView). 평면이 따라간다. */
  view: { target: readonly [number, number]; halfWidth: number } | null
}>()
const emit = defineEmits<{ select: [id: string, kind: string]; close: [] }>()

const byKey = computed(() => new Map((props.reading?.ttl.entities ?? []).map((e) => [e.key, e])))
const unread = computed(() => new Map((props.reading?.ttl.unread ?? []).map((u) => [u.key, u])))
const featureAt = computed(() => {
  const out = new Map<string, { storeyId: string; index: number }>()
  props.reading?.floors.forEach((f, i) => f.floor.features.forEach((x) => out.set(x.id, { storeyId: f.storeyId, index: i })))
  return out
})
/** 받는 쪽이 읽었을 때 TTL 에 없는 feature(물리존·설비·존) — 파일 사이 끊김. 평면에 붉게. */
const notInTtl = computed(() => {
  const r = props.reading
  return new Set(r ? crossCheck(r.ttl, r.floors.map((f) => f.floor)).notInTtl.map((x) => x.id) : [])
})

/** 보일 층. 3D 의 층 → 고른 것의 층 → 첫 층. 사람이 판에서 고른 층은 3D 가 층을 바꿀 때까지 둔다. */
const chosenFloor = ref<string | null>(null)
watch(() => props.storeyId, () => (chosenFloor.value = null))
const floorIndex = computed(() => {
  const list = props.reading?.floors ?? []
  const want = chosenFloor.value ?? props.storeyId ?? (props.selectedId ? featureAt.value.get(props.selectedId)?.storeyId : null)
  const i = list.findIndex((f) => f.storeyId === want)
  return i < 0 ? 0 : i
})
const floor = computed(() => props.reading?.floors[floorIndex.value]?.floor ?? null)
const plan = computed(() => (floor.value ? planOf(floor.value, new Set(unread.value.keys())) : null))

// --- 3D 를 따라가는 평면 ---
const follow = ref(true)
const svg = ref<SVGSVGElement | null>(null)
const ratio = ref(0.75)
let resize: ResizeObserver | null = null
onMounted(() => {
  resize = new ResizeObserver(([e]) => {
    const { width, height } = e.contentRect
    if (width > 0) ratio.value = height / width
  })
  if (svg.value) resize.observe(svg.value)
})
watch(svg, (el, was) => {
  if (was) resize?.unobserve(was)
  if (el) resize?.observe(el)
})
onBeforeUnmount(() => resize?.disconnect())
const viewBox = computed(() => {
  const p = plan.value
  if (!p) return '0 0 1 1'
  const v = props.view
  if (!follow.value || !v) return p.viewBox
  const w = Math.max(v.halfWidth, 1) * 2
  const h = w * ratio.value
  return `${v.target[0] - w / 2} ${-v.target[1] - h / 2} ${w} ${h}`
})
/** 점 크기. 3D 를 따라가면 보이는 폭에 맞춘다(가까이 가면 점이 작아져 겹친 설비가 갈린다). */
const dotR = computed(() => {
  const p = plan.value
  if (!p) return 0.1
  return follow.value && props.view ? Math.max(props.view.halfWidth, 1) / 90 : p.r
})

// --- 고른 것 ---
const nameOf = (id: string) => {
  const f = featureAt.value.get(id)
  const feature = f ? props.reading?.floors[f.index].floor.features.find((x) => x.id === id) : undefined
  return byKey.value.get(id)?.label || (typeof feature?.properties.name === 'string' ? feature.properties.name : '') || id
}
const SRC: Record<string, SrcKind> = { bim: 'bim', calc: 'calc', dict: 'dict', edit: 'edit', IDF: 'idf', idf: 'idf' }
const SOURCE_LABEL: Record<string, string> = {
  spaceSource: '소속',
  connectsSource: '잇는 방',
  externalSource: '외벽',
  passableSource: '통과',
  verticalConnectsSource: '층간 연결',
  source: '출처',
}
const selected = computed(() => {
  const id = props.selectedId
  const r = props.reading
  if (!id || !r) return null
  const at = featureAt.value.get(id)
  const feature = at ? r.floors[at.index].floor.features.find((x) => x.id === id) ?? null : null
  const entity = byKey.value.get(id) ?? null
  const skip = unread.value.get(id) ?? null
  const sources = feature
    ? Object.entries(feature.properties)
        .filter(([k, v]) => /source$/i.test(k) && typeof v === 'string' && SRC[v])
        .map(([k, v]) => ({ key: k, label: SOURCE_LABEL[k] ?? k, kind: SRC[v as string] }))
    : []
  const incoming = r.ttl.entities.flatMap((e) =>
    (
      [
        ['hasLocation', e.locations],
        ['feeds', e.feeds],
        ['hasPart', e.parts],
        ['hasPoint', e.points],
      ] as const
    ).flatMap(([p, to]) => (to.includes(id) ? [{ from: e.key, predicate: p }] : [])),
  )
  return {
    id,
    kind: typeof feature?.properties.kind === 'string' ? feature.properties.kind : null,
    fileName: at ? r.floors[at.index].floor.fileName : null,
    feature,
    entity,
    skip,
    sources,
    out: entity
      ? ([
          ['hasLocation', entity.locations],
          ['feeds', entity.feeds],
          ['hasPart', entity.parts],
          ['hasPoint', entity.points],
        ] as const).filter(([, to]) => to.length)
      : [],
    incoming,
  }
})
/** feature JSON. 좌표가 긴 다각형은 앞 몇 점만 — 카드가 좌표로 넘친다. */
const featureText = computed(() => {
  const f = selected.value?.feature
  if (!f) return ''
  const g = f.geometry
  const short = g && Array.isArray(g.coordinates) && JSON.stringify(g.coordinates).length > 400 ? { type: g.type, coordinates: `… ${JSON.stringify(g.coordinates).length.toLocaleString()}자` } : g
  return JSON.stringify({ ...f, geometry: short }, null, 2)
})
// 고른 것이 다른 층이면 그 층으로(3D 가 모든 층을 볼 때).
watch(
  () => props.selectedId,
  (id) => {
    if (!id || props.storeyId) return
    const at = featureAt.value.get(id)
    if (at) chosenFloor.value = at.storeyId
  },
)
const counts = computed(() => {
  const r = props.reading
  if (!r) return null
  const rel = r.ttl.entities.reduce((n, e) => n + e.locations.length + e.feeds.length + e.parts.length + e.points.length, 0)
  return { subjects: r.ttl.entities.length, relations: rel, features: r.floors.reduce((n, f) => n + f.floor.features.length, 0), unread: r.ttl.unread.length }
})
</script>

<template>
  <aside class="export-compare" data-testid="export-compare" aria-label="내보낸 결과 비교">
    <header class="ec-head">
      <div>
        <b>내보낸 결과</b> <span class="muted">— 받는 쪽이 읽는 TTL · GeoJSON</span>
        <p v-if="counts" class="ec-counts muted" data-testid="export-compare-counts">
          주어 {{ counts.subjects.toLocaleString() }} · 관계 {{ counts.relations.toLocaleString() }} · feature {{ counts.features.toLocaleString() }}
          <template v-if="counts.unread"> · DT 가 읽지 않는 덕트·배관 {{ counts.unread.toLocaleString() }}</template>
          <span v-if="pending" class="ec-pending">· 다시 쓰는 중…</span>
          <span v-else-if="reading" class="ec-ms">· {{ reading.ms.toLocaleString() }}ms</span>
        </p>
        <p v-else-if="pending" class="ec-counts muted">내보내는 중…</p>
      </div>
      <button type="button" class="ghost" title="비교 판 닫기" @click="emit('close')">닫기</button>
    </header>
    <p v-if="error" class="edit-warn">{{ error }}</p>
    <template v-if="reading">
      <div class="ec-bar">
        <select :value="reading.floors[floorIndex]?.storeyId" aria-label="비교할 층 파일" @change="chosenFloor = ($event.target as HTMLSelectElement).value">
          <option v-for="f in reading.floors" :key="f.storeyId" :value="f.storeyId">{{ f.floor.fileName }}</option>
        </select>
        <label class="ec-follow" title="평면이 3D 시점을 따라갑니다(바라보는 점이 가운데)"><input v-model="follow" type="checkbox" /> 3D 따라가기</label>
      </div>
      <svg v-if="plan && !plan.empty" ref="svg" :viewBox="viewBox" class="ec-plan" role="img" :aria-label="`${floor?.fileName} 평면`" preserveAspectRatio="xMidYMid meet">
        <template v-for="s in plan.shapes" :key="s.id">
          <path
            v-if="s.d"
            :d="s.d"
            :class="['shape', s.kind, { sel: s.id === selectedId, missing: notInTtl.has(s.id) }]"
            :data-id="s.id"
            fill-rule="evenodd"
            vector-effect="non-scaling-stroke"
            @click="emit('select', s.id, s.kind)"
          >
            <title>{{ KIND_LABEL[s.kind] ?? s.kind }} · {{ nameOf(s.id) }}</title>
          </path>
          <circle
            v-else
            :cx="s.cx"
            :cy="s.cy"
            :r="(s.kind === 'equipment' ? dotR : dotR * 0.7) * (s.id === selectedId ? 2.2 : 1)"
            :class="['shape', s.kind, { sel: s.id === selectedId, unread: unread.has(s.id) }]"
            :data-id="s.id"
            vector-effect="non-scaling-stroke"
            @click="emit('select', s.id, s.kind)"
          >
            <title>{{ KIND_LABEL[s.kind] ?? s.kind }} · {{ nameOf(s.id) }}</title>
          </circle>
        </template>
      </svg>
      <p v-else class="muted ec-empty">이 층 파일에는 그릴 형상이 없습니다.</p>

      <section v-if="selected" class="ec-card" data-testid="export-compare-card">
        <h4>
          {{ nameOf(selected.id) }}
          <span v-if="selected.kind" class="muted">· {{ KIND_LABEL[selected.kind] ?? selected.kind }}</span>
        </h4>
        <p v-if="selected.entity" class="ec-cls"><code>brick:{{ selected.entity.cls }}</code> <span class="muted">TTL 주어</span></p>
        <p v-else-if="selected.skip" class="ec-cls"><code>{{ selected.skip.cls }}</code> <span class="muted">DT 가 읽지 않는 주어(덕트·배관)</span></p>
        <p v-else-if="selected.feature" class="ec-cls muted" data-testid="export-compare-no-ttl">TTL 에는 없고 GeoJSON 에만 있습니다.</p>
        <p v-else class="ec-cls edit-warn" data-testid="export-compare-missing">이 요소는 내보낸 파일에 없습니다.</p>
        <p v-if="selected.sources.length" class="ec-sources">
          <span v-for="s in selected.sources" :key="s.key">{{ s.label }} <Src :kind="s.kind" /></span>
        </p>
        <ul v-if="selected.out.length || selected.incoming.length" class="ec-rels">
          <li v-for="[p, to] in selected.out" :key="p">
            <code>{{ p }}</code> →
            <button v-for="t in to.slice(0, 6)" :key="t" type="button" class="link" @click="emit('select', t, '')">{{ nameOf(t) }}</button>
            <span v-if="to.length > 6" class="muted">외 {{ to.length - 6 }}</span>
          </li>
          <li v-for="(x, i) in selected.incoming.slice(0, 6)" :key="`in${i}`">
            ← <button type="button" class="link" @click="emit('select', x.from, '')">{{ nameOf(x.from) }}</button> <code>{{ x.predicate }}</code>
          </li>
          <li v-if="selected.incoming.length > 6" class="muted">← 외 {{ selected.incoming.length - 6 }}</li>
        </ul>
        <details v-if="selected.entity || selected.skip" open>
          <summary>TTL 블록 <span class="muted">ontology.ttl</span></summary>
          <pre data-testid="export-compare-ttl">{{ (selected.entity ?? selected.skip)!.source }}</pre>
        </details>
        <details v-if="selected.feature">
          <summary>GeoJSON feature <span class="muted">{{ selected.fileName }}</span></summary>
          <pre data-testid="export-compare-geojson">{{ featureText }}</pre>
        </details>
      </section>
      <p v-else class="muted ec-hint">3D 나 이 평면에서 고르면, 그 요소가 TTL 의 어느 블록·GeoJSON 의 어느 feature 가 됐는지 보입니다.</p>
    </template>
  </aside>
</template>

<style scoped>
.export-compare {
  display: flex;
  flex-direction: column;
  width: 42%;
  min-width: 18rem;
  max-width: 34rem;
  border-left: 1px solid var(--line);
  background: var(--surface);
  font-size: 0.8rem;
  overflow-y: auto;
}
.ec-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem 0.3rem;
}
.ec-counts {
  margin: 0.15rem 0 0;
}
.ec-head .ghost {
  flex: none;
  white-space: nowrap;
}
.ec-pending {
  color: var(--accent);
}
.ec-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0 0.7rem 0.4rem;
}
.ec-bar select {
  max-width: 60%;
}
.ec-follow {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.ec-plan {
  display: block;
  flex: none;
  width: 100%;
  height: 16rem;
  background: var(--surface-soft);
  border-block: 1px solid var(--line);
}
.ec-empty,
.ec-hint {
  padding: 0.6rem 0.7rem;
}
.shape {
  cursor: pointer;
  stroke-width: 1;
}
.shape.space {
  fill: var(--accent-soft);
  stroke: var(--accent);
  fill-opacity: 0.8;
}
.shape.wall {
  fill: var(--muted);
  stroke: none;
  fill-opacity: 0.55;
}
.shape.hvacZone,
.shape.customZone {
  fill: none;
  stroke: #c2410c;
  stroke-dasharray: 4 3;
  stroke-width: 1.5;
}
.shape.room {
  fill: none;
  stroke: var(--accent);
  stroke-dasharray: 2 2;
  stroke-width: 1.5;
}
.shape.spaceObject {
  fill: #7c3aed;
  fill-opacity: 0.35;
  stroke: #7c3aed;
}
.shape.vertical {
  fill: #be185d;
  fill-opacity: 0.3;
  stroke: #be185d;
  stroke-width: 1.5;
}
.shape.equipment {
  fill: #0f766e;
  stroke: none;
}
.shape.equipment.unread {
  fill: var(--muted);
  fill-opacity: 0.45;
}
.shape.door,
.shape.window {
  fill: #a16207;
}
/* TTL 에 없는 feature — 두 파일 사이가 끊긴 것. */
.shape.missing {
  fill: var(--error-soft);
  stroke: var(--error);
}
/* 고른 것. 3D 의 고른 색(#2f6fed)과 같은 쪽으로 — 두 화면에서 같은 것을 짚는다. */
.shape.sel {
  stroke: #2f6fed;
  stroke-width: 3;
  fill-opacity: 1;
}
circle.shape.sel {
  fill: #2f6fed;
  stroke: #fff;
  stroke-width: 2;
}
.ec-card {
  padding: 0.6rem 0.7rem 0.8rem;
}
.ec-card h4 {
  margin: 0 0 0.3rem;
  font-size: 0.9rem;
}
.ec-cls,
.ec-sources {
  margin: 0.2rem 0;
}
.ec-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.7rem;
}
.ec-rels {
  margin: 0.35rem 0;
  padding-left: 1rem;
}
.ec-rels li {
  margin: 0.15rem 0;
}
.ec-rels .link {
  margin-right: 0.35rem;
}
.ec-card details {
  margin-top: 0.4rem;
}
.ec-card pre {
  max-height: 12rem;
  margin: 0.25rem 0 0;
  padding: 0.45rem 0.55rem;
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: 0.72rem;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
