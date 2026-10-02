<script setup lang="ts">
// 내보낸 파일 뷰어. 에디터가 낸 ontology.ttl(의미)·floor-*.geojson(기하)·GLB/OBJ(3D 형상)를 **받는 쪽처럼** 다시 읽어 보인다.
//
// 에디터 화면은 모델을 그린다. 이 화면은 파일을 그린다 — DT 가 받는 것은 모델이 아니라 이 파일들이라, 내보내기에서
// 빠지거나 어긋난 것은 에디터 화면에서는 보이지 않는다. TTL 은 받는 쪽 DT 파서의 규칙(read-ttl.ts)으로, GeoJSON 은
// RFC 7946 모양으로, 3D 는 three 의 로더로 읽고, 셋이 id 로 이어지는지(read-export.ts·read-3d.ts)를 같이 보인다.
// 고른 것은 파일에 적힌 원문(TTL 블록·GeoJSON feature)까지 보인다. 파일은 브라우저 안에서만 읽는다.
import { computed, ref, shallowRef } from 'vue'
import { readOntologyTTL, type OntologyEntity, type TtlReading } from '../lib/export/read-ttl'
import { crossCheck, readGeoJSON, type ExportFloor, type ReadFeature } from '../lib/export/read-export'
import { check3D, read3D, type Reading3D } from '../lib/export/read-3d'
import Scene3D from './Scene3D.vue'

const ttl = shallowRef<TtlReading | null>(null)
const ttlName = ref('')
const floors = shallowRef<ExportFloor[]>([])
const models3d = shallowRef<Reading3D[]>([])
const model3dIndex = ref(0)
const view = ref<'plan' | '3d'>('plan')
/** 3D 에서 층 묶음 없이 다 보이기. 끄면 평면과 같은 층만 보인다. */
const allFloors3d = ref(false)
const floorIndex = ref(0)
const selectedId = ref<string | null>(null)
const dragging = ref(false)
const skipped = ref<string[]>([])
const loadErrors = ref<string[]>([])

const dark = ref(document.documentElement.getAttribute('data-theme') === 'dark')
function toggleTheme() {
  dark.value = !dark.value
  if (dark.value) document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
  try {
    localStorage.setItem('oe-theme', dark.value ? 'dark' : 'light')
  } catch {
    // 못 써도 이번 창에서는 그대로 돈다.
  }
}

/** 층 파일의 높이. 물리존·벽이 적은 elevation 이고, 없으면 뒤로 보낸다. */
function elevationOf(floor: ExportFloor): number {
  const e = floor.features.find((f) => typeof f.properties.elevation === 'number')?.properties.elevation
  return typeof e === 'number' ? e : Infinity
}

async function load(files: FileList | File[]) {
  const next = new Map(floors.value.map((f) => [f.fileName, f]))
  const next3d = new Map(models3d.value.map((m) => [m.fileName, m]))
  const ignored: string[] = []
  const errors: string[] = []
  for (const file of Array.from(files)) {
    const name = file.name
    if (/\.ttl$/i.test(name)) {
      ttl.value = readOntologyTTL(await file.text())
      ttlName.value = name
    } else if (/\.(geo)?json$/i.test(name)) {
      next.set(name, readGeoJSON(name, await file.text()))
    } else if (/\.(glb|obj)$/i.test(name)) {
      try {
        next3d.set(name, await read3D(name, await file.arrayBuffer()))
      } catch (e) {
        errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    } else ignored.push(name)
  }
  floors.value = [...next.values()].sort((a, b) => elevationOf(a) - elevationOf(b) || a.fileName.localeCompare(b.fileName))
  floorIndex.value = Math.min(floorIndex.value, Math.max(0, floors.value.length - 1))
  const had3d = models3d.value.length
  models3d.value = [...next3d.values()]
  if (models3d.value.length > had3d) model3dIndex.value = models3d.value.length - 1
  // 3D 만 놓았으면 그릴 평면이 없다.
  if (!floors.value.length && models3d.value.length) view.value = '3d'
  skipped.value = ignored
  loadErrors.value = errors
}
function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void load(input.files)
  input.value = ''
}
function onDrop(event: DragEvent) {
  dragging.value = false
  if (event.dataTransfer?.files.length) void load(event.dataTransfer.files)
}
function clear() {
  ttl.value = null
  ttlName.value = ''
  floors.value = []
  models3d.value = []
  view.value = 'plan'
  selectedId.value = null
  skipped.value = []
  loadErrors.value = []
}

const byKey = computed(() => new Map((ttl.value?.entities ?? []).map((e) => [e.key, e])))
const unreadByKey = computed(() => new Map((ttl.value?.unread ?? []).map((u) => [u.key, u.cls])))
const featureById = computed(() => {
  const out = new Map<string, { feature: ReadFeature; floor: number }>()
  floors.value.forEach((fl, i) => fl.features.forEach((f) => out.set(f.id, { feature: f, floor: i })))
  return out
})
type Predicate = 'feeds' | 'hasLocation' | 'hasPart' | 'hasPoint'
const relationsOf = (e: OntologyEntity): [Predicate, string[]][] => [
  ['hasLocation', e.locations],
  ['feeds', e.feeds],
  ['hasPart', e.parts],
  ['hasPoint', e.points],
]
/** 누가 이것을 가리키나. 방을 고르면 그 방을 위치로 가진 설비, 기기를 고르면 그것에 공급하는 것이 나온다. */
const incoming = computed(() => {
  const out = new Map<string, { from: string; predicate: Predicate }[]>()
  for (const e of ttl.value?.entities ?? [])
    for (const [predicate, targets] of relationsOf(e))
      for (const to of targets) out.set(to, [...(out.get(to) ?? []), { from: e.key, predicate }])
  return out
})
const relationCounts = computed(() => {
  const n: Record<Predicate, number> = { hasPart: 0, hasLocation: 0, feeds: 0, hasPoint: 0 }
  for (const e of ttl.value?.entities ?? []) for (const [p, t] of relationsOf(e)) n[p] += t.length
  return n
})
const classCounts = computed(() => {
  const n = new Map<string, number>()
  for (const e of ttl.value?.entities ?? []) n.set(e.cls, (n.get(e.cls) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])
})
const unreadCounts = computed(() => {
  const n = new Map<string, number>()
  for (const u of ttl.value?.unread ?? []) n.set(u.cls, (n.get(u.cls) ?? 0) + 1)
  return [...n]
})
const KIND_LABEL: Record<string, string> = {
  space: '물리존',
  equipment: '설비',
  wall: '벽',
  door: '문',
  window: '창',
  customZone: '커스텀존',
  hvacZone: '공조존',
}
const kindCounts = computed(() => {
  const n = new Map<string, number>()
  for (const fl of floors.value) for (const f of fl.features) n.set(String(f.properties.kind), (n.get(String(f.properties.kind)) ?? 0) + 1)
  return [...n]
})

const check = computed(() => (ttl.value && floors.value.length ? crossCheck(ttl.value, floors.value) : null))
type CheckRow = { label: string; note: string; ids: string[] }
const checks = computed<CheckRow[]>(() => {
  const rows: CheckRow[] = []
  const shape = floors.value.flatMap((f) => f.problems.map((p) => `${f.fileName} · ${p}`))
  if (floors.value.length) rows.push({ label: 'GeoJSON 모양(RFC 7946)', note: '위치·고리·id·properties', ids: shape })
  const c = check.value
  if (!c) return rows
  rows.push(
    { label: 'TTL 에 없는 feature', note: '물리존·설비·존인데 같은 id 의 주어가 없다', ids: c.notInTtl.map((x) => x.id) },
    { label: '끊긴 참조', note: '관계가 가리키는 주어가 TTL 에 없다', ids: c.dangling.map((d) => `${d.from} ${d.predicate} ${d.to}`) },
    { label: '소속 어긋남', note: 'GeoJSON 의 spaceId 가 TTL 의 hasLocation 에 없다', ids: c.locationMismatch.map((x) => x.id) },
    { label: '문이 잇는 방', note: '문의 connects 가 TTL 에 없는 방을 가리킨다', ids: c.doorLinks.map((x) => `${x.id} → ${x.to}`) },
  )
  return rows
})

// --- 3D -------------------------------------------------------------------------------------------
const model3d = computed(() => models3d.value[model3dIndex.value] ?? null)
/** 3D 파일마다 GeoJSON·TTL 과 견준 것. GeoJSON 이 없으면 "어디에도 없는 객체" 만 셀 수 있어 아예 재지 않는다. */
const checks3d = computed<CheckRow[]>(() =>
  floors.value.length
    ? models3d.value.flatMap((m) => {
        const c = check3D(m.parts, floors.value, ttl.value)
        // 같은 형식이 둘이면 파일 이름으로 가른다. 보통은 GLB·OBJ 하나씩이라 형식만 쓴다.
        const tag = models3d.value.filter((x) => x.format === m.format).length > 1 ? m.fileName : m.format.toUpperCase()
        return [
          { label: `${tag} — 어디에도 없는 객체`, note: `${m.fileName}: 3D 객체 이름(GlobalId)이 GeoJSON·TTL 에 없다`, ids: c.unknown },
          { label: `${tag} — 3D 에 없는 형상`, note: `${m.fileName}: 형상이 있는 물리존·설비·벽인데 3D 객체가 없다`, ids: c.missing.map((x) => x.id) },
          {
            label: `${tag} — 자리 어긋남`,
            note: `${m.fileName}: 방은 외곽선 범위와 1cm 넘게, 설비는 GeoJSON 점이 3D 범위에서 0.5m 넘게 다르다`,
            ids: c.misplaced.map((x) => `${x.id} ${x.by.toFixed(2)}m`),
          },
        ]
      })
    : [],
)
const allChecks = computed(() => [...checks.value, ...checks3d.value])
const kindOf = (id: string) => {
  const k = featureById.value.get(id)?.feature.properties.kind
  return typeof k === 'string' ? k : null
}
/** 3D 에 보일 id. 평면과 같은 층만. GeoJSON 에 없는 객체는 늘 보인다(어긋남을 숨기지 않는다). */
const visible3d = computed<Set<string> | null>(() => {
  const m = model3d.value
  if (!m || allFloors3d.value || !floors.value.length) return null
  return new Set(m.parts.map((p) => p.id).filter((id) => (featureById.value.get(id)?.floor ?? floorIndex.value) === floorIndex.value))
})

const floor = computed(() => floors.value[floorIndex.value] ?? null)

// --- 평면 -----------------------------------------------------------------------------------------
// 좌표는 건물 로컬 미터다(geojson.ts). y 를 뒤집어 북쪽이 위로 오게 그린다.
type Shape = { id: string; kind: string; d?: string; cx?: number; cy?: number; name: string }
const plan = computed(() => {
  const fl = floor.value
  if (!fl) return null
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  const add = (p: number[]) => {
    x0 = Math.min(x0, p[0])
    x1 = Math.max(x1, p[0])
    y0 = Math.min(y0, -p[1])
    y1 = Math.max(y1, -p[1])
  }
  const shapes: Shape[] = []
  for (const f of fl.features) {
    const g = f.geometry
    if (!g) continue
    const kind = String(f.properties.kind)
    const name = String(f.properties.name ?? '')
    if (g.type === 'Point') {
      const p = g.coordinates as number[]
      add(p)
      shapes.push({ id: f.id, kind, cx: p[0], cy: -p[1], name })
    } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
      const d = polys
        .flat()
        .map((ring) => {
          ring.forEach(add)
          return `M${ring.map((p) => `${p[0]},${-p[1]}`).join('L')}Z`
        })
        .join('')
      shapes.push({ id: f.id, kind, d, name })
    }
  }
  if (!Number.isFinite(x0)) return { viewBox: '0 0 1 1', shapes: [], r: 0.1, empty: true }
  const pad = Math.max(x1 - x0, y1 - y0, 1) * 0.04
  // 넓이가 큰 것부터 그려 작은 것이 위에 온다. 점(설비·문)은 맨 위이고, 기기는 같은 자리의 덕트·배관 위에 둔다(눌러지게).
  const order: Record<string, number> = { hvacZone: 0, customZone: 1, space: 2, wall: 3, window: 4, door: 5, equipment: 7 }
  const rank = (s: Shape) => (s.kind === 'equipment' && unreadByKey.value.has(s.id) ? 6 : (order[s.kind] ?? 9))
  shapes.sort((a, b) => rank(a) - rank(b))
  return {
    viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`,
    shapes,
    r: Math.max(x1 - x0, y1 - y0, 1) / 220,
    empty: false,
  }
})

function select(id: string) {
  selectedId.value = id
  const at = featureById.value.get(id)
  if (at && at.floor !== floorIndex.value) floorIndex.value = at.floor
}
const nameOf = (id: string) => {
  const f = featureById.value.get(id)?.feature.properties.name
  return byKey.value.get(id)?.label || (typeof f === 'string' ? f : '') || id
}

const selected = computed(() => {
  const id = selectedId.value
  if (!id) return null
  const at = featureById.value.get(id)
  const props = at
    ? Object.entries(at.feature.properties).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    : []
  return {
    id,
    feature: at?.feature ?? null,
    fileName: at ? floors.value[at.floor]?.fileName : '',
    props,
    entity: byKey.value.get(id) ?? null,
    unread: unreadByKey.value.get(id) ?? null,
    unreadSource: ttl.value?.unread.find((u) => u.key === id)?.source ?? null,
    incoming: incoming.value.get(id) ?? [],
    parts3d: model3d.value?.parts.filter((p) => p.id === id) ?? [],
  }
})
const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v))
const m = (v: number) => v.toFixed(2)

/**
 * feature 원문. 파일에 적힌 그대로 보이되, 좌표가 긴 고리는 앞 몇 점만 남긴다 — 방 하나가 수백 점이라 원문 칸이 좌표로만 찬다.
 * 줄인 자리는 `"… n점 더"` 로 적는다.
 */
function featureSource(f: ReadFeature): string {
  const SHOWN = 4
  const trim = (c: unknown): unknown => {
    if (!Array.isArray(c)) return c
    if (c.length && typeof c[0] === 'number') return c
    if (c.length && Array.isArray(c[0]) && typeof c[0][0] === 'number' && c.length > SHOWN + 1)
      return [...c.slice(0, SHOWN), `… ${c.length - SHOWN}점 더`]
    return c.map(trim)
  }
  const json = JSON.stringify({ ...f, geometry: f.geometry ? { ...f.geometry, coordinates: trim(f.geometry.coordinates) } : null }, null, 2)
  // 좌표 한 점([x, y])은 한 줄로 접는다. 접지 않으면 점 하나가 네 줄이다.
  return json.replace(/\[\s+(-?[\d.e+-]+),\s+(-?[\d.e+-]+)(?:,\s+(-?[\d.e+-]+))?\s+\]/g, (_, a, b, c) => `[${a}, ${b}${c !== undefined ? `, ${c}` : ''}]`)
}
const PARTS_SHOWN = 40
</script>

<template>
  <main class="viewer">
    <header>
      <div class="title">
        <div>
          <h1>내보낸 파일 보기</h1>
          <p class="sub">
            에디터가 낸 <code>ontology.ttl</code>(의미)·<code>floor-*.geojson</code>(기하)·<code>.glb</code>/<code>.obj</code>(3D 형상)를 DT 파서와 같은
            규칙으로 다시 읽어, 파일에 실제로 무엇이 적혔고 셋이 id 로 이어지는지 봅니다. 파일은 이 브라우저 안에서만 읽습니다.
          </p>
        </div>
        <div class="actions">
          <a class="ghost" href="./">에디터</a>
          <button type="button" class="ghost" :aria-pressed="dark" @click="toggleTheme">{{ dark ? '라이트' : '다크' }}</button>
        </div>
      </div>
    </header>

    <section
      class="drop"
      :class="{ over: dragging, compact: ttl || floors.length || models3d.length }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p>TTL·층마다의 GeoJSON·GLB/OBJ 를 함께 끌어다 놓으세요. 더 놓으면 같은 이름의 파일은 바뀌고 나머지는 더해집니다.</p>
      <label class="pick">
        파일 고르기
        <input type="file" multiple accept=".ttl,.geojson,.json,.glb,.obj" aria-label="내보낸 파일 고르기" @change="onPick" />
      </label>
      <button v-if="ttl || floors.length || models3d.length" type="button" class="ghost clear" @click="clear">비우기</button>
      <p v-if="skipped.length" class="muted">읽지 않은 파일: {{ skipped.join(', ') }}</p>
      <p v-for="e in loadErrors" :key="e" class="error" role="alert">읽지 못했습니다 — {{ e }}</p>
    </section>

    <template v-if="ttl || floors.length || models3d.length">
      <section class="summary" aria-label="요약">
        <div class="card">
          <h2>TTL <span class="muted mono">{{ ttlName || '없음' }}</span></h2>
          <template v-if="ttl">
            <p class="big"><b>{{ ttl.entities.length.toLocaleString() }}</b> 주어</p>
            <p class="muted">
              hasPart {{ relationCounts.hasPart.toLocaleString() }} · hasLocation {{ relationCounts.hasLocation.toLocaleString() }} ·
              feeds {{ relationCounts.feeds.toLocaleString() }} · hasPoint {{ relationCounts.hasPoint.toLocaleString() }}
            </p>
            <p v-if="unreadCounts.length" class="muted" title="주어 블록이지만 DT 파서가 읽지 않는 클래스. 덕트·배관(fso:)은 일부러다.">
              읽지 않는 주어: {{ unreadCounts.map(([cls, n]) => `${cls} ${n.toLocaleString()}`).join(' · ') }}
            </p>
          </template>
          <p v-else class="muted">ontology.ttl 을 놓으면 관계와 id 잇기를 봅니다.</p>
        </div>
        <div class="card">
          <h2>GeoJSON <span class="muted">층 파일 {{ floors.length }}</span></h2>
          <p class="big"><b>{{ floors.reduce((n, f) => n + f.features.length, 0).toLocaleString() }}</b> feature</p>
          <p class="muted">
            {{ kindCounts.map(([kind, n]) => `${KIND_LABEL[kind] ?? kind} ${n.toLocaleString()}`).join(' · ') }}
          </p>
          <template v-if="models3d.length">
            <h2 class="sub3d">3D</h2>
            <p v-for="m3 in models3d" :key="m3.fileName" class="muted">
              <span class="mono">{{ m3.fileName }}</span> · 객체 {{ m3.parts.length.toLocaleString() }} · 삼각형
              {{ m3.parts.reduce((n, p) => n + p.triangles, 0).toLocaleString() }}{{ m3.format === 'obj' ? ' · 색·종류 없음(OBJ)' : '' }}
            </p>
          </template>
        </div>
        <div class="card checks" aria-label="검사">
          <h2>검사</h2>
          <ul>
            <li v-for="c in allChecks" :key="c.label" :class="c.ids.length ? 'bad' : 'ok'">
              <details :open="c.ids.length > 0 && c.ids.length <= 5">
                <summary>
                  <span class="mark">{{ c.ids.length ? '✕' : '✓' }}</span> {{ c.label }}
                  <b>{{ c.ids.length ? c.ids.length.toLocaleString() : '0' }}</b>
                </summary>
                <p class="muted">{{ c.note }}</p>
                <ul v-if="c.ids.length" class="ids mono">
                  <li v-for="id in c.ids.slice(0, 20)" :key="id">
                    <button type="button" class="link" @click="select(id.split(' ')[0])">{{ id }}</button>
                  </li>
                  <li v-if="c.ids.length > 20" class="muted">… 외 {{ c.ids.length - 20 }}</li>
                </ul>
              </details>
            </li>
            <li v-if="!ttl || !floors.length" class="muted">TTL 과 GeoJSON 을 다 놓으면 파일끼리 id 로 이어지는지 봅니다(3D 는 GeoJSON 과 견줍니다).</li>
          </ul>
        </div>
      </section>

      <section v-if="floors.length || models3d.length" class="work">
        <div class="plan card">
          <div class="view-tabs" role="tablist" aria-label="보기">
            <button type="button" role="tab" :aria-selected="view === 'plan'" :class="{ on: view === 'plan' }" :disabled="!floors.length" @click="view = 'plan'">평면(GeoJSON)</button>
            <button
              v-for="(m3, i) in models3d"
              :key="m3.fileName"
              type="button"
              role="tab"
              :title="m3.fileName"
              :aria-selected="view === '3d' && i === model3dIndex"
              :class="{ on: view === '3d' && i === model3dIndex }"
              @click="(view = '3d'), (model3dIndex = i)"
            >
              3D · {{ m3.format.toUpperCase() }}{{ models3d.filter((x) => x.format === m3.format).length > 1 ? ` ${m3.fileName}` : '' }}
            </button>
            <span v-if="!models3d.length" class="muted hint">GLB·OBJ 를 놓으면 3D 로도 봅니다</span>
          </div>
          <div v-if="floors.length" class="floor-tabs" role="tablist" aria-label="층">
            <button
              v-for="(f, i) in floors"
              :key="f.fileName"
              type="button"
              role="tab"
              :aria-selected="i === floorIndex"
              :class="{ on: i === floorIndex, bad: f.problems.length }"
              @click="floorIndex = i"
            >
              {{ f.fileName.replace(/^floor-/, '').replace(/\.geojson$/, '') }}
            </button>
            <label v-if="view === '3d'" class="all-floors"><input v-model="allFloors3d" type="checkbox" /> 모든 층</label>
          </div>
          <template v-if="view === '3d' && model3d">
            <Scene3D :root="model3d.scene" :colored="model3d.format === 'glb'" :kind-of="kindOf" :selected-id="selectedId" :visible="visible3d" @select="select" />
            <p class="plan-note muted">
              끌어서 돌리고, 휠로 당기고, 누르면 고릅니다. 객체 이름이 GlobalId 라 누른 것의 TTL·GeoJSON 이 오른쪽에 나옵니다.
              {{ model3d.format === 'obj' ? 'OBJ 는 색이 없어 GeoJSON 종류로 칠했습니다.' : 'GLB 의 색(계통·벽 종류)은 파일에 든 그대로입니다.' }}
            </p>
          </template>
          <template v-else-if="floors.length">
          <svg v-if="plan && !plan.empty" :viewBox="plan.viewBox" class="svg" role="img" :aria-label="`${floor?.fileName} 평면`">
            <template v-for="s in plan.shapes" :key="s.id">
              <path
                v-if="s.d"
                :d="s.d"
                :class="['shape', s.kind, { sel: s.id === selectedId, missing: check?.notInTtl.some((x) => x.id === s.id) }]"
                fill-rule="evenodd"
                vector-effect="non-scaling-stroke"
                @click="select(s.id)"
              >
                <title>{{ KIND_LABEL[s.kind] ?? s.kind }} · {{ nameOf(s.id) }}</title>
              </path>
              <circle
                v-else
                :cx="s.cx"
                :cy="s.cy"
                :r="s.kind === 'equipment' ? plan.r : plan.r * 0.7"
                :class="['shape', s.kind, { sel: s.id === selectedId, unread: unreadByKey.has(s.id) }]"
                vector-effect="non-scaling-stroke"
                @click="select(s.id)"
              >
                <title>{{ KIND_LABEL[s.kind] ?? s.kind }} · {{ nameOf(s.id) }}</title>
              </circle>
            </template>
          </svg>
          <p v-else class="empty">이 층에는 그릴 형상이 없습니다(좌표 없는 feature 만 있음).</p>
          <p class="plan-note muted">
            <span class="sw space"></span>물리존 <span class="sw wall"></span>벽 <span class="sw zone"></span>존
            <span class="dot equipment"></span>기기 <span class="dot unread"></span>덕트·배관(DT 가 읽지 않음) <span class="dot door"></span>문·창
          </p>
          </template>
        </div>

        <aside class="detail card" aria-label="고른 것">
          <template v-if="selected">
            <h2>{{ nameOf(selected.id) }}</h2>
            <p class="mono iri">{{ selected.id }}</p>

            <h3>TTL</h3>
            <dl v-if="selected.entity">
              <dt>클래스</dt>
              <dd class="mono">{{ selected.entity.ns }}:{{ selected.entity.cls }}</dd>
              <template v-for="[p, targets] in relationsOf(selected.entity)" :key="p">
                <template v-if="targets.length">
                  <dt>{{ p }} <span class="muted">{{ targets.length }}</span></dt>
                  <dd>
                    <button v-for="t in targets.slice(0, PARTS_SHOWN)" :key="t" type="button" class="link" :class="{ broken: !byKey.has(t) && !unreadByKey.has(t) }" @click="select(t)">
                      {{ nameOf(t) }}
                    </button>
                    <span v-if="targets.length > PARTS_SHOWN" class="muted">… 외 {{ targets.length - PARTS_SHOWN }}</span>
                  </dd>
                </template>
              </template>
            </dl>
            <p v-else-if="selected.unread" class="muted">
              TTL 에 <code>{{ selected.unread }}</code> 로 있지만 DT 파서는 읽지 않습니다(덕트·배관은 일부러 Brick 밖에 둡니다).
            </p>
            <p v-else class="muted">TTL 에 이 id 의 주어가 없습니다{{ selected.feature && ['wall', 'door', 'window'].includes(String(selected.feature.properties.kind)) ? ' — 벽·문·창은 GeoJSON 에만 있습니다' : '' }}.</p>

            <template v-if="selected.incoming.length">
              <h3>가리키는 것 <span class="muted">{{ selected.incoming.length }}</span></h3>
              <ul class="incoming">
                <li v-for="r in selected.incoming.slice(0, PARTS_SHOWN)" :key="`${r.from}-${r.predicate}`">
                  <button type="button" class="link" @click="select(r.from)">{{ nameOf(r.from) }}</button>
                  <span class="muted mono"> {{ r.predicate }}</span>
                </li>
              </ul>
            </template>

            <h3>GeoJSON <span v-if="selected.fileName" class="muted mono">{{ selected.fileName }}</span></h3>
            <dl v-if="selected.feature">
              <dt>형상</dt>
              <dd>{{ selected.feature.geometry?.type ?? '없음(null)' }}</dd>
              <template v-for="[k, v] in selected.props" :key="k">
                <dt>{{ k }}</dt>
                <dd class="mono">{{ show(v) }}</dd>
              </template>
            </dl>
            <p v-else class="muted">GeoJSON 에 이 id 의 feature 가 없습니다(층·건물·계통은 TTL 에만 있습니다).</p>

            <template v-if="model3d">
              <h3>3D <span class="muted mono">{{ model3d.fileName }}</span></h3>
              <dl v-if="selected.parts3d.length">
                <template v-for="p in selected.parts3d" :key="p.name">
                  <dt>객체</dt>
                  <dd class="mono">{{ p.name }}{{ p.kind ? ` · ${p.kind}` : '' }}</dd>
                  <dt>삼각형</dt>
                  <dd>{{ p.triangles.toLocaleString() }}</dd>
                  <dt>범위(IFC m)</dt>
                  <dd class="mono">x {{ m(p.min[0]) }}~{{ m(p.max[0]) }} · y {{ m(p.min[1]) }}~{{ m(p.max[1]) }} · z {{ m(p.min[2]) }}~{{ m(p.max[2]) }}</dd>
                </template>
              </dl>
              <p v-else class="muted">이 3D 파일에 이 id 의 객체가 없습니다(좌표 없는 설비·외곽선 없는 방·층·계통은 3D 에 나가지 않습니다).</p>
            </template>

            <h3>원문</h3>
            <details v-if="selected.entity || selected.unreadSource" open>
              <summary class="muted mono">{{ ttlName }}</summary>
              <pre class="source">{{ selected.entity?.source ?? selected.unreadSource }}</pre>
            </details>
            <details v-if="selected.feature">
              <summary class="muted mono">{{ selected.fileName }}</summary>
              <pre class="source">{{ featureSource(selected.feature) }}</pre>
            </details>
          </template>
          <template v-else>
            <h2>클래스</h2>
            <p class="muted">평면이나 3D 에서 무엇이든 누르면 TTL·GeoJSON·3D 에 적힌 것을 나란히, 파일 원문까지 봅니다.</p>
            <table v-if="classCounts.length">
              <tbody>
                <tr v-for="[cls, n] in classCounts.slice(0, 20)" :key="cls">
                  <td class="mono">{{ cls }}</td>
                  <td>{{ n.toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </template>
        </aside>
      </section>
    </template>
  </main>
</template>

<style scoped>
.viewer {
  max-width: 90rem;
  padding-top: 2rem;
}
.title {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}
.actions a {
  text-decoration: none;
}
.drop.compact {
  margin-top: 1.25rem;
  padding: 1rem;
}
.drop.compact p {
  margin-bottom: 0.5rem;
}
.clear {
  margin-left: 0.5rem;
}
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1rem 1.25rem;
  box-shadow: var(--shadow);
}
.summary {
  display: grid;
  grid-template-columns: 1fr 1fr 1.3fr;
  gap: var(--gap);
  margin-top: 1.25rem;
}
.summary p {
  margin: 0.25rem 0 0;
  font-size: 0.88rem;
}
.big b {
  font-size: 1.5rem;
}
.checks ul {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  font-size: 0.9rem;
}
.checks summary {
  cursor: pointer;
}
.checks .ok .mark {
  color: var(--accent);
}
.checks .bad .mark,
.checks .bad b {
  color: var(--error);
}
.ids {
  font-size: 0.8rem;
  max-height: 12rem;
  overflow: auto;
}
.work {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24rem;
  gap: var(--gap);
  margin-top: var(--gap);
}
.view-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
  margin-bottom: 0.6rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--line-soft);
}
.view-tabs .hint {
  font-size: 0.8rem;
}
.floor-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
}
.all-floors {
  margin-left: auto;
  font-size: 0.85rem;
}
.sub3d {
  margin-top: 0.75rem;
}
.source {
  margin: 0.25rem 0 0.5rem;
  padding: 0.6rem 0.75rem;
  background: var(--surface-soft);
  border-radius: var(--radius-sm);
  font-family: ui-monospace, 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 0.76rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 18rem;
  overflow: auto;
}
.view-tabs button,
.floor-tabs button {
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--fg);
  border-radius: 999px;
  padding: 0.2rem 0.8rem;
  cursor: pointer;
  font-size: 0.85rem;
}
.view-tabs button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.view-tabs button.on,
.floor-tabs button.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.floor-tabs button.bad {
  border-color: var(--error);
}
.svg {
  display: block;
  width: 100%;
  height: 34rem;
  margin-top: 0.75rem;
  background: var(--surface-soft);
  border-radius: var(--radius-sm);
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
.shape.missing {
  fill: var(--error-soft);
  stroke: var(--error);
}
.shape.sel {
  stroke: var(--error);
  stroke-width: 3;
  fill-opacity: 1;
}
circle.shape.sel {
  fill: var(--error);
}
.plan-note {
  font-size: 0.8rem;
  margin: 0.5rem 0 0;
}
.sw,
.dot {
  display: inline-block;
  width: 0.8rem;
  height: 0.8rem;
  margin: 0 0.25rem 0 0.6rem;
  vertical-align: -0.1rem;
  border-radius: 2px;
}
.dot {
  border-radius: 50%;
}
.sw.space {
  background: var(--accent-soft);
  border: 1px solid var(--accent);
}
.sw.wall {
  background: var(--muted);
}
.sw.zone {
  border: 1.5px dashed #c2410c;
}
.dot.equipment {
  background: #0f766e;
}
.dot.unread {
  background: var(--muted);
  opacity: 0.5;
}
.dot.door {
  background: #a16207;
}
.detail {
  max-height: 42rem;
  overflow: auto;
  font-size: 0.88rem;
}
.detail h3 {
  margin: 1rem 0 0.25rem;
  font-size: 0.92rem;
}
.detail dl {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 0.2rem 0.75rem;
  margin: 0;
}
.detail dt {
  color: var(--muted);
}
.detail dd {
  margin: 0;
  word-break: break-all;
}
.link {
  border: none;
  background: none;
  padding: 0 0.4rem 0 0;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.link.broken {
  color: var(--error);
  text-decoration: line-through;
}
.incoming {
  list-style: none;
  padding: 0;
  margin: 0;
}
@media (max-width: 960px) {
  .summary,
  .work {
    grid-template-columns: 1fr;
  }
}
</style>
