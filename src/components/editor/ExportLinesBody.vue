<script setup lang="ts">
// "내보내면" 칸의 몸통(ExportLines.vue). 칸을 펼쳤을 때만 붙어서, 붙어 있는 동안만 내보내기를 다시 돈다(editor/export-lines.ts).
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { nameIn, type ExportIndex, type Relation } from '../../lib/export/entity-export'
import { formatFeature } from '../../lib/replay-geo'
import { model } from '../../editor/core'
import { shortName } from '../../editor/equipment-shape'
import { buildExportIndex, canShow, entityExport, showEntity } from '../../editor/export-lines'
import { sceneVersion } from '../../editor/redraw'

const props = defineProps<{ id: string; what: string }>()

// 편집이 이어지는 동안(방향키를 누르고 있는 동안)은 다시 돌지 않고, 멎은 뒤 한 번 돈다. 그동안은 앞의 결과에 "고치는 중" 을 붙인다.
const WAIT_MS = 300
const index = shallowRef<ExportIndex | null>(null)
const stale = shallowRef(false)
let timer: number | undefined
function rebuild() {
  timer = undefined
  index.value = buildExportIndex()
  stale.value = false
}
watch(
  [model, sceneVersion],
  () => {
    if (!index.value) return rebuild()
    stale.value = true
    window.clearTimeout(timer)
    timer = window.setTimeout(rebuild, WAIT_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.clearTimeout(timer))

const x = computed(() => (index.value ? entityExport(index.value, props.id) : null))
const name = (id: string) => (index.value ? nameIn(index.value, id) : id)
/** 칩에 보이는 이름. Revit 설비 이름(`패밀리:유형:요소 ID`)은 줄이고, 방과 이름이 같은 층·건물은 꼬리표로 가른다(Duplex 의 층 Roof · 방 Roof). */
const TAG: Record<string, string> = { Floor: '층', Building: '건물' }
function chip(id: string) {
  const tag = TAG[index.value?.read.get(id)?.cls ?? '']
  // 층은 인스펙터가 없어서 누르면 그 층 보기로 옮긴다. 고른 것은 그대로다.
  return { text: shortName(name(id)), tag, title: [name(id), id, tag === '층' ? '누르면 이 층만 봅니다' : ''].filter(Boolean).join('\n') }
}

/** 술어의 뜻. 받는 쪽(ttl.go)이 읽는 관계 넷이다(docs/ontology.md "TTL 술어"). */
const GLOSS: Record<Relation, { out: string; in: string }> = {
  hasLocation: { out: '있는 곳', in: '여기 있는 것' },
  feeds: { out: '공급하는 곳', in: '여기로 공급하는 것' },
  hasPart: { out: '부분', in: '이것을 부분으로 가진 것' },
  hasPoint: { out: '관제점', in: '이 관제점을 가진 것' },
}
/** 한 줄에 보이는 상대 수. 층·계통은 방·구성원이 수백이라 접는다. */
const SHOWN = 8
const opened = shallowRef(new Set<string>())
function shown(key: string, ids: readonly string[]) {
  return opened.value.has(key) ? ids : ids.slice(0, SHOWN)
}
function more(key: string) {
  opened.value = new Set([...opened.value, key])
}

const featureLines = computed(() => (x.value?.feature ? formatFeature(x.value.feature.feature) : []))
const geometryText = computed(() => {
  const g = x.value?.feature?.feature.geometry
  if (!g) return 'geometry: null'
  if (g.type === 'Point') return 'Point'
  if (g.type === 'LineString') return `LineString · 점 ${g.coordinates.length}`
  const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
  return `${g.type} · 꼭짓점 ${rings.reduce((n, r) => n + Math.max(0, r.length - 1), 0)}`
})
/** TTL 에 없거나 GeoJSON 에 없는 까닭. 엔티티 종류마다 다르다(docs/ontology.md). */
const noFeature = computed(() => (props.what === '계통' ? '계통은 GeoJSON 에 없습니다. 구성원 설비의 feature 가 systemId 로 가리킵니다.' : 'GeoJSON feature 가 없습니다.'))
</script>

<template>
  <div class="export-lines-body" :class="{ stale }" data-testid="export-lines-body">
    <p v-if="!x" class="muted">내보내는 중…</p>
    <template v-else>
      <p class="export-status" :data-ttl="x.ttl" data-testid="export-status">
        <template v-if="x.ttl === 'read'">
          TTL 에 <b class="mono">{{ x.cls }}</b> 엔티티로 나가고 DT 플랫폼(ttl.go)이 읽습니다.
        </template>
        <template v-else-if="x.ttl === 'unread'">
          TTL 에 <b class="mono">{{ x.cls }}</b> 엔티티로 나가지만 DT 플랫폼(ttl.go)은 이 블록을 통째로 읽지 않습니다.
          <template v-if="x.cls?.startsWith('fso:')">기기끼리의 <code>brick:feeds</code> 는 덕트·배관을 건너뛰어 기기 블록에 적힙니다.</template>
        </template>
        <template v-else>TTL 에 없습니다 — Brick 에 {{ what }} 자리가 없어 GeoJSON 에만 나갑니다.</template>
        <span v-if="stale" class="muted"> 고치는 중…</span>
      </p>

      <table v-if="x.out.length || x.incoming.length" class="export-rels" data-testid="export-rels">
        <tbody>
          <tr v-for="r in x.out" :key="`o:${r.predicate}`">
            <th scope="row"><code>brick:{{ r.predicate }}</code><small>{{ GLOSS[r.predicate].out }}</small></th>
            <td>
              <button v-for="to in shown(`o:${r.predicate}`, r.to)" :key="to" type="button" class="rel-chip" :disabled="!canShow(to)" :title="chip(to).title" @click="showEntity(to)">{{ chip(to).text }}<small v-if="chip(to).tag">{{ chip(to).tag }}</small></button>
              <button v-if="r.to.length > SHOWN && !opened.has(`o:${r.predicate}`)" type="button" class="link" @click="more(`o:${r.predicate}`)">+{{ r.to.length - SHOWN }}</button>
            </td>
          </tr>
          <tr v-for="r in x.incoming" :key="`i:${r.predicate}`" class="incoming">
            <th scope="row"><code>← brick:{{ r.predicate }}</code><small>{{ GLOSS[r.predicate].in }}</small></th>
            <td>
              <button v-for="from in shown(`i:${r.predicate}`, r.from)" :key="from" type="button" class="rel-chip" :disabled="!canShow(from)" :title="chip(from).title" @click="showEntity(from)">{{ chip(from).text }}<small v-if="chip(from).tag">{{ chip(from).tag }}</small></button>
              <button v-if="r.from.length > SHOWN && !opened.has(`i:${r.predicate}`)" type="button" class="link" @click="more(`i:${r.predicate}`)">+{{ r.from.length - SHOWN }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="x.ttl === 'read'" class="muted">DT 플랫폼이 읽는 관계가 없습니다(이름과 클래스만 나갑니다).</p>

      <div v-if="x.dropped.length" class="export-dropped" data-testid="export-dropped">
        <span class="muted">TTL 에 있지만 DT 플랫폼이 읽지 않는 줄</span>
        <code v-for="(c, i) in x.dropped" :key="i">{{ c }}</code>
      </div>

      <details v-if="x.source" class="export-source">
        <summary>Turtle 원문</summary>
        <pre>{{ x.source }}</pre>
      </details>

      <p class="export-geo">
        <template v-if="x.feature">
          GeoJSON <b class="mono">{{ x.feature.fileName }}</b> · <code>kind: {{ x.feature.feature.properties.kind }}</code> · {{ geometryText }}
        </template>
        <span v-else class="muted">{{ noFeature }}</span>
      </p>
      <details v-if="x.feature" class="export-source" data-testid="export-feature">
        <summary>feature 원문</summary>
        <pre>{{ featureLines.join('\n') }}</pre>
      </details>
    </template>
  </div>
</template>

<style scoped>
.export-lines-body {
  display: grid;
  /* Turtle 원문(pre)이 길어도 열이 카드 폭을 넘지 않게 — 넘는 줄은 pre 안에서 가로로 민다. */
  grid-template-columns: minmax(0, 1fr);
  gap: 0.5rem;
  font-size: 0.85rem;
}
.export-lines-body.stale {
  opacity: 0.7;
}
.export-status {
  margin: 0;
}
.export-status[data-ttl='unread'] {
  color: var(--warn-fg);
}
.export-rels {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.export-rels th {
  width: 11rem;
  padding: 0.3rem 0.5rem 0.3rem 0;
  font-weight: 400;
  text-align: left;
  vertical-align: top;
}
.export-rels th code {
  white-space: nowrap;
}
.export-rels th small {
  display: block;
  color: var(--muted);
}
.export-rels td {
  padding: 0.25rem 0;
  border-top: 1px solid var(--line-soft);
}
.export-rels th {
  border-top: 1px solid var(--line-soft);
}
.export-rels .incoming code {
  color: var(--muted);
}
.rel-chip {
  max-width: 100%;
  margin: 0 0.25rem 0.25rem 0;
  padding: 0.1rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  /* 이름 끝의 Revit 요소 ID(#602113)가 같은 패밀리 둘을 가른다 — 말줄임으로 자르지 않고 꺾는다. */
  overflow-wrap: anywhere;
  text-align: left;
  background: var(--surface-soft);
  color: var(--fg);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.rel-chip small {
  margin-left: 0.3rem;
  color: var(--muted);
}
.rel-chip:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.rel-chip:disabled {
  cursor: default;
  opacity: 0.75;
}
.export-dropped {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  align-items: baseline;
}
.export-dropped code {
  color: var(--muted);
}
.export-geo {
  margin: 0;
}
.export-source summary {
  color: var(--muted);
  cursor: pointer;
}
.export-source pre {
  max-height: 16rem;
  margin: 0.25rem 0 0;
  padding: 0.5rem;
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: 0.75rem;
  white-space: pre;
}
</style>
