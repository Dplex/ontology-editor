<script setup lang="ts">
// 편집 리플레이(PoC)의 3D 위 표시. 움직임은 3D 가 한다(App.vue 가 되돌리기로 처음까지 돌리고 다시 하기로 하나씩 다시 한다) —
// 여기는 지금 몇 번째인지, 그 편집이 TTL·GeoJSON 의 어디를 바꿨는지를 채팅처럼 카드로 쌓고, 조작 막대를 둔다.
// 카드 내용은 워커가 모델 사본으로 계산한 것이다(lib/replay.ts).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { escapeLocalName } from '../lib/export/ttl'
import ReplayGeo from './ReplayGeo.vue'
import ReplayRelations from './ReplayRelations.vue'
import { relationsOf } from '../lib/replay-relations'
import Roll from './Roll.vue'
import { CATEGORIES, CATEGORY_COLOR, type Category, type PlanItem, type ReplayStart, type ReplayStep } from '../lib/replay'

const props = defineProps<{
  title: string
  total: number
  /** 다시 한 편집 수(= 지금 이력 길이). 카드는 이만큼 쌓인다. */
  at: number
  phase: 'opening' | 'play' | 'done'
  playing: boolean
  speed: number
  /** 다음 편집으로 카메라가 가는 중이면 그 번호. 채팅의 "입력 중" 처럼 다음 카드 자리를 미리 띄운다. */
  aiming: number | null
  start: ReplayStart | null
  steps: readonly ReplayStep[]
  error: string
  /** 3D 에 한 층만 보일 때 그 층. 건물 전체를 볼 때는 null. */
  storey: { name: string; elevation: number } | null
  /** 지금까지 다시 한 장면 수의 최댓값. 앞 장면으로 돌아가도(카드를 눌러 다시 보기, ←) 그 뒤 카드는 남긴다. */
  seen: number
  /** 카드를 눌러 반복해 보는 장면 번호. 없으면 null. */
  loop: number | null
  /** B 를 누르고 있어 지금 장면을 편집 전으로 보이는 중. */
  comparing?: boolean
  /** 이 갈래 장면만 트는 중(나머지는 연출 없이 지나간다). */
  filter?: Category | null
  /** 녹화 중이면 시작 시각(performance.now). */
  recording?: number | null
}>()
const emit = defineEmits<{ toggle: []; prev: []; next: []; restart: []; speed: [number]; close: []; scene: [number]; seek: [number]; filter: [Category | null]; record: [] }>()

const CAT_COLOR = CATEGORY_COLOR

/**
 * 화면에 보이는 장면 수. B 로 편집 전을 보는 동안(comparing)은 편집 하나를 되돌려 at 이 하나 줄지만, 보는 것은 여전히 그 장면이라
 * 제목·카드·번호는 그 장면에 둔다(GeoJSON 패널만 편집 전 모양으로).
 */
const shownAt = computed(() => props.at + (props.comparing ? 1 : 0))

/** App.vue 의 shortName 과 같은 규칙. Revit 의 "패밀리:유형:…:요소ID" 를 "패밀리 #요소ID" 로. */
function shortName(name: string): string {
  const revit = /^([^:]+):.+:(\d+)$/.exec(name)
  return revit ? `${revit[1]} #${revit[2]}` : name
}

/** TTL 의 `ex:<id>` → 이름. GUID 로는 무엇이 바뀌었는지 못 읽어서 화면에서만 바꿔 보인다. */
const names = computed(() => {
  const out = new Map<string, string>()
  const learn = (it: PlanItem | null) => {
    if (!it || it.t === 'link' || it.t === 'wall' || it.t === 'opening') return
    out.set(escapeLocalName(it.id), it.t === 'equip' ? shortName(it.name) : it.name || it.id)
  }
  for (const it of props.start?.plan ?? []) learn(it)
  for (const s of props.start?.storeys ?? []) out.set(escapeLocalName(s.id), s.name)
  for (const s of props.steps) for (const c of s.changes) learn(c.after)
  return out
})
const plain = (s: string) => s.replace(/\\(.)/g, '$1')
const readable = (line: string) => line.replace(/ex:((?:\\.|[\w가-힣])+)/g, (m, id: string) => names.value.get(id) ?? plain(m))

type Row = { text: string; kind: 'subject' | 'add' | 'del' }
function rows(s: ReplayStep): Row[] {
  const out: Row[] = []
  for (const c of s.ttl) {
    out.push({ text: readable(c.subject), kind: 'subject' })
    for (const l of c.removed) out.push({ text: readable(l), kind: 'del' })
    for (const l of c.added) out.push({ text: readable(l), kind: 'add' })
  }
  return out
}
const ROWS = 7

/** 기록판. 최신 장면이 맨 위에 펼쳐지고, 지난 장면은 그 아래 한 줄씩. */
const cards = computed(() => {
  // 오프닝 동안은 비운다 — 첫 장면부터 쌓인다.
  if (props.phase === 'opening') return []
  // 펼치는 카드는 지금 장면(반복 중이면 그 장면)이고 나머지는 한 줄이다. 그 장면이 다섯 장 창 밖이면 창을 그쪽으로 당긴다.
  const end = Math.max(shownAt.value, props.seen)
  let start = Math.max(0, end - 5)
  if (focus.value >= 0 && focus.value < start) start = focus.value
  const shown = props.steps.slice(start, Math.min(end, start + 5)).reverse()
  return shown.map((s) => ({ step: s, rows: rows(s), rels: relationsOf(s.ttl), old: s.index !== focus.value, ahead: s.index >= shownAt.value && s.index !== props.loop }))
})
const focus = computed(() => props.loop ?? shownAt.value - 1)
const upcoming = computed(() => (props.aiming !== null && props.aiming >= shownAt.value ? (props.steps[props.aiming] ?? null) : null))
const current = computed(() => upcoming.value ?? props.steps[shownAt.value - 1] ?? null)
const counter = computed(() => String(Math.min(props.total, props.aiming !== null ? props.aiming + 1 : shownAt.value)).padStart(2, '0'))

/** GeoJSON 패널의 장면. 카메라가 가는 중이면 그 장면의 지금 파일을, 다시 했으면 바뀐 파일을 보인다. */
const geoStep = computed(() => (props.phase === 'opening' ? null : (upcoming.value ?? props.steps[shownAt.value - 1] ?? null)))
const geoApplied = computed(() => !!geoStep.value && !props.comparing && props.at > geoStep.value.index)

/** 장면 제목. 카메라가 가는 중(aiming)부터 그 장면의 것이다. */
// 갈래를 거르는 중이면 그 갈래 장면만 — 연출 없이 지나가는 다른 갈래 편집의 제목이 깜빡이지 않게.
const scene = computed(() => (props.phase === 'play' && (!props.filter || current.value?.category === props.filter) ? current.value : null))

/**
 * 장면 전환(화면이 검게 잠겼다 밝아짐)은 한 층에서 다른 층으로 넘어갈 때만 한다. 같은 층 안에서 다음 장면으로 가는 것은 카메라
 * 이동으로 충분하고, 건물 전체에서 첫 층으로 들어갈 때는 3D 의 단면 자르기(viewer.sectionTo)가 전환이다. 끝 화면에서 건물
 * 전체로 물러날 때는 이미 재생이 아니라 하지 않는다. 층이 하나뿐인 파일은 층이 바뀌지 않아 하지 않는다.
 */
const dip = ref(0)
watch(
  () => props.storey?.name ?? null,
  (now, before) => {
    if (props.phase === 'play' && now !== null && before !== null && now !== before) dip.value++
  },
)

/** 키네틱 캡션: 장면 제목을 낱말로 나눠 차례로 튀어 오르게 한다. 숫자·# 이 든 낱말(설비 번호, 면적)은 갈래 색으로 짚는다. */
const words = (label: string) => label.split(/\s+/).filter(Boolean).map((w) => ({ w, key: /[#\d]/.test(w) }))
/** 오프닝: 열고 첫 장면 전. 건물 이름과 편집 수를 크게. */
const opening = computed(() => props.phase === 'opening')
// 건물 이름이 없는 IFC(성수)는 파일 이름에서 확장자를 뗀다.
const openingTitle = computed(() => words(props.start?.building || props.title.replace(/\.ifc\b/gi, '')))
/** 끝의 통계 타일. 차례로 굴러 올라온다. */
const stats = computed(() => [
  { n: props.total, label: 'EDITS', sub: '고친 편집' },
  { n: new Set(props.steps.flatMap((s) => s.storeyIds)).size, label: 'FLOORS', sub: '고친 층' },
  { n: props.steps.reduce((n, s) => n + (s.geojson ? s.geojson.count.changed + s.geojson.count.added + s.geojson.count.removed : 0), 0), label: 'FEATURES', sub: 'GeoJSON 에서 바뀐 것' },
  { n: props.steps.reduce((n, s) => n + s.ttlCount.added + s.ttlCount.removed, 0), label: 'TTL LINES', sub: '더하고 지운 줄' },
])
const two = (n: number) => String(n).padStart(2, '0')

/** 녹화 시간(초). 녹화 중일 때만 1초마다 센다. */
const recSec = ref(0)
let recTimer: number | undefined
watch(
  () => props.recording ?? null,
  (since) => {
    window.clearInterval(recTimer)
    recSec.value = 0
    if (since === null) return
    recTimer = window.setInterval(() => (recSec.value = Math.floor((performance.now() - since) / 1000)), 500)
  },
  { immediate: true },
)
onBeforeUnmount(() => window.clearInterval(recTimer))

/**
 * 층 레일. 층이 둘 이상이면 왼쪽에 위층부터 층을 세우고, 층마다 그 층을 고친 장면을 점으로 찍는다. 지금 보는 층은 밝게, 다시 한
 * 장면의 점은 채운다. 고층(성수 19층)에서 장면이 어느 층을 오가는지, 어느 층에 편집이 몰렸는지가 3D 를 돌려 보지 않아도 보인다.
 * 층을 누르면 그 층의 첫 장면을 반복해서 튼다(카드 누르기와 같다).
 */
const rail = computed(() => {
  const storeys = [...(props.start?.storeys ?? [])].sort((a, b) => b.elevation - a.elevation)
  if (storeys.length < 2) return null
  const scenes = new Map<string, ReplayStep[]>()
  for (const s of props.steps) for (const id of new Set(s.storeyIds)) scenes.set(id, [...(scenes.get(id) ?? []), s])
  const here = props.storey
  return storeys.map((st) => ({
    id: st.id,
    name: st.name,
    here: !!here && here.name === st.name && Math.abs(here.elevation - st.elevation) < 1e-6,
    scenes: (scenes.get(st.id) ?? []).map((s) => ({ index: s.index, color: CAT_COLOR[s.category], done: s.index < shownAt.value })),
  }))
})
/** 층이 많으면 한 줄을 낮춘다(레일 전체 높이는 그대로). 이름은 줄이 넉넉할 때만. */
const railRow = computed(() => (rail.value ? Math.max(6, Math.min(22, Math.floor(300 / rail.value.length))) : 0))

/**
 * 시간줄 끌기. 시간이 아니라 편집 하나가 한 칸이다(편집이 몰린 때와 뜸한 때가 같은 너비) — 끄는 자리의 칸까지 한 편집 상태로
 * 간다(seek). 거의 안 끌고 놓으면 끌기가 아니라 눈금 누르기(그 장면 반복)로 둔다.
 */
const scrub = ref<{ x: number; moved: boolean; n: number } | null>(null)
function seekAt(e: PointerEvent, el: HTMLElement) {
  const r = el.getBoundingClientRect()
  const n = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * props.total)
  if (scrub.value && n !== scrub.value.n) {
    scrub.value.n = n
    emit('seek', n)
  }
}
function onTrackDown(e: PointerEvent) {
  if (e.button !== 0) return
  scrub.value = { x: e.clientX, moved: false, n: props.at }
}
function onTrackMove(e: PointerEvent) {
  const s = scrub.value
  if (!s) return
  if (!s.moved && Math.abs(e.clientX - s.x) < 4) return
  if (!s.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  s.moved = true
  seekAt(e, e.currentTarget as HTMLElement)
}
/** 끌고 놓은 뒤 따라오는 click(눈금 위에서 놓았으면 그 장면 반복)은 버린다. */
let swallowClick = false
function onTrackUp() {
  swallowClick = !!scrub.value?.moved
  scrub.value = null
}
function onTick(k: number) {
  if (swallowClick) return void (swallowClick = false)
  emit('scene', k - 1)
}

/**
 * 시간줄 눈금의 높이. 그 편집이 바꾼 것(평면의 열쇠 수)이 많을수록 높다 — 영상 기록 플레이어가 사건이 몰린 곳을 막대 높이로
 * 보이듯, 계통 확정처럼 수백 곳이 바뀐 장면이 한눈에 걸린다. 로그로 눌러 한두 개짜리도 보이게 한다. 카드 계산 전이면 0.
 */
const weights = computed(() => {
  const n = props.steps.map((s) => s.changes.length)
  const max = Math.log1p(Math.max(1, ...n))
  return n.map((x) => Math.log1p(x) / max)
})

/** 다시 한 순간의 번쩍임. at 이 늘 때마다 한 번. */
const impact = ref(0)
watch(
  () => props.at,
  (at, before) => {
    if (props.phase !== 'opening' && at > before) impact.value++
  },
)

const time = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

const summary = computed(() => {
  const counts = new Map<Category, number>()
  for (const s of props.steps) counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
  const max = Math.max(1, ...counts.values())
  return {
    bars: CATEGORIES.filter((c) => counts.get(c)).map((c) => ({ c, n: counts.get(c)!, w: (100 * counts.get(c)!) / max })),
    added: props.steps.reduce((n, s) => n + s.ttlCount.added, 0),
    removed: props.steps.reduce((n, s) => n + s.ttlCount.removed, 0),
    geo: props.steps.reduce((n, s) => n + s.geo.length, 0),
  }
})
</script>

<template>
  <div class="replay-hud" :data-phase="phase" :data-at="at" :data-total="total" :data-ready="steps.length" :data-loop="loop ?? ''">
    <!-- 위아래 검은 띠(영화 화면비) -->
    <div class="lb top"></div>
    <div class="lb bottom"></div>
    <!-- 다시 한 순간 -->
    <div v-if="impact" :key="impact" class="impact" :style="{ '--c': current ? CAT_COLOR[current.category] : '#5ef2c2' }"></div>

    <!-- 왼쪽 위: 리플레이 표시(위 검은 띠 안). 가는 테두리 판 셋 — REPLAY · 몇 번째 · 갈래. -->
    <div class="bug" :style="{ '--c': current ? CAT_COLOR[current.category] : '#5ef2c2' }">
      <span class="bug-replay">REPLAY</span>
      <span v-if="phase !== 'opening'" class="bug-count">
        <transition name="roll" mode="out-in"><b :key="counter">{{ counter }}</b></transition>
        <i>/{{ two(total) }}</i>
      </span>
      <transition name="chip" mode="out-in">
        <span v-if="current && phase !== 'opening' && (!filter || current.category === filter)" :key="current.index" class="bug-cat">{{ current.category }}</span>
      </transition>
      <!-- 한 층만 보일 때 그 층. 장면이 다른 층으로 가면 바뀌고, 건물 전체로 물러나면 사라진다. -->
      <transition name="chip" mode="out-in">
        <span v-if="storey && phase !== 'opening'" :key="storey.name" class="bug-storey">
          {{ storey.name }}<i>{{ storey.elevation >= 0 ? '+' : '' }}{{ storey.elevation.toFixed(2) }} m</i>
        </span>
      </transition>
    </div>

    <!-- 층 레일: 위층부터, 층마다 그 층을 고친 장면의 점. 지금 보는 층이 밝다. -->
    <nav v-if="rail && phase !== 'opening'" class="rail" :style="{ '--row': `${railRow}px` }" aria-label="층별 장면">
      <button
        v-for="r in rail"
        :key="r.id"
        type="button"
        :class="['rail-row', { here: r.here, quiet: !r.scenes.length }]"
        :title="`${r.name} — 장면 ${r.scenes.length}개${r.scenes.length ? ' · 누르면 이 층의 첫 장면' : ''}`"
        :disabled="!r.scenes.length"
        @click="emit('scene', r.scenes[0].index)"
      >
        <span v-if="railRow >= 14" class="rail-name">{{ r.name }}</span>
        <span class="rail-dots">
          <i v-for="s in r.scenes.slice(0, 12)" :key="s.index" :class="{ done: s.done }" :style="{ '--c': s.color }"></i>
          <b v-if="r.scenes.length > 12">+{{ r.scenes.length - 12 }}</b>
        </span>
      </button>
    </nav>

    <!-- 편집 전·후 비교(B 를 누르고 있는 동안) -->
    <div v-if="comparing" class="compare" :style="{ '--c': current ? CAT_COLOR[current.category] : '#5ef2c2' }">
      <b>BEFORE</b><span>편집 전 — B 를 떼면 편집 후</span>
    </div>

    <!-- 장면 전환: 다른 층으로 넘어가는 순간 화면이 검게 잠겼다 밝아진다(같은 층이면 카메라만 옮긴다) -->
    <div v-if="dip" :key="`sw${dip}`" class="swipe"></div>

    <!-- 장면 제목: 판이 펼쳐지고 낱말이 차례로 튀어 오른다(키네틱 캡션) -->
    <transition name="scene">
      <div v-if="scene" :key="scene.index" class="scene" :style="{ '--c': CAT_COLOR[scene.category] }">
        <div class="scene-kicker"><b>{{ two(scene.index + 1) }}</b><span>{{ scene.category }}</span></div>
        <div class="scene-title">
          <span v-for="(t, i) in words(scene.label)" :key="i" :class="['wd', { key: t.key }]" :style="{ animationDelay: `${380 + i * 70}ms` }">{{ t.w }}</span>
        </div>
      </div>
    </transition>

    <!-- 오프닝 -->
    <transition name="fade">
      <div v-if="opening" class="hud-rewind opening">
        <div class="op-kicker">▶ EDIT REPLAY</div>
        <div class="op-title">
          <span v-for="(t, i) in openingTitle" :key="i" class="wd" :style="{ animationDelay: `${150 + i * 90}ms` }">{{ t.w }}</span>
        </div>
        <div class="op-sub">
          <b>{{ two(total) }}</b> EDITS<template v-if="start?.building"> <i>·</i> {{ title }}</template>
        </div>
      </div>
    </transition>

    <!-- 오른쪽 기둥 -->
    <aside class="rp-side">
      <div class="hud-geo">
        <ReplayGeo v-if="geoStep" :key="`${geoStep.index}:${geoApplied}`" :step="geoStep" :applied="geoApplied" :color="CAT_COLOR[geoStep.category]" />
      </div>
      <div class="log-head">
        <span>TTL 변경 기록</span>
        <!-- 반복 중에는 되돌릴 때마다 하나 내려갔다 오르지 않게 반복하는 장면 번호에 둔다. -->
        <b>{{ two(loop !== null ? loop + 1 : shownAt) }}<i>/{{ two(total) }}</i></b>
      </div>
      <div class="log">
        <transition name="next">
          <div v-if="upcoming && loop === null" :key="`up${upcoming.index}`" class="next" :style="{ '--c': CAT_COLOR[upcoming.category] }">
            <span class="next-tag">NEXT</span>
            <span class="next-label">{{ upcoming.label }}</span>
            <span class="next-arrow">▶</span>
          </div>
        </transition>
        <transition-group name="card">
          <article
            v-for="c in cards"
            :key="c.step.index"
            class="card"
            :class="{ old: c.old, ahead: c.ahead, looping: c.step.index === loop }"
            :style="{ '--c': CAT_COLOR[c.step.category] }"
            :title="c.step.index === loop ? '반복 중 — Space 로 다음 장면부터 이어서' : '이 장면만 반복해서 보기'"
            @click="emit('scene', c.step.index)"
          >
            <div class="idx">#{{ two(c.step.index + 1) }}</div>
            <div class="body">
              <header>
                <span class="cat">{{ c.step.category }}</span>
                <span class="time">{{ time(c.step.time) }}</span>
              </header>
              <h3>{{ c.step.label }}</h3>
              <template v-if="!c.old">
                <div class="ttl-head">
                  TTL <b class="add">+{{ c.step.ttlCount.added }}</b> <b class="del">−{{ c.step.ttlCount.removed }}</b>
                  <template v-if="c.step.geojson">
                    · GeoJSON feature <b class="chg">~{{ c.step.geojson.count.changed }}</b> <b class="add">+{{ c.step.geojson.count.added }}</b>
                    <b class="del">−{{ c.step.geojson.count.removed }}</b>
                  </template>
                </div>
                <!-- 관계가 바뀐 장면은 그 관계를 그림으로 먼저(소속 방이 바뀜 · 공급 대상이 바뀜 …). 그만큼 줄 글은 줄인다. -->
                <ReplayRelations v-if="c.rels.length" :rels="c.rels" :name="readable" />
                <template v-if="c.rows.length">
                  <div v-for="(r, i) in c.rows.slice(0, c.rels.length ? ROWS - 3 : ROWS)" :key="i" :class="['line', r.kind]" :style="{ animationDelay: `${250 + i * 70}ms` }">
                    {{ r.kind === 'add' ? '+ ' : r.kind === 'del' ? '− ' : '▸ ' }}{{ r.text }}
                  </div>
                  <div v-if="c.rows.length > (c.rels.length ? ROWS - 3 : ROWS)" class="line more">… 외 {{ c.rows.length - (c.rels.length ? ROWS - 3 : ROWS) }}줄</div>
                </template>
                <div v-else class="line none">TTL 변화 없음<template v-if="c.step.geojson"> — 좌표·외곽선은 GeoJSON 에만 남는다</template></div>
              </template>
            </div>
          </article>
        </transition-group>
      </div>
    </aside>

    <!-- 끝: 요약 -->
    <transition name="fade">
      <div v-if="phase === 'done'" class="rp-stats">
        <div v-for="(st, i) in stats" :key="st.label" class="stat" :style="{ animationDelay: `${i * 160}ms` }">
          <div class="stat-n"><Roll :value="st.n" /></div>
          <b>{{ st.label }}</b>
          <span>{{ st.sub }}</span>
        </div>
      </div>
    </transition>
    <transition name="fade">
      <div v-if="phase === 'done'" class="hud-done">
        <div class="done-head"><span>REPLAY COMPLETE</span><b>{{ two(total) }} EDITS</b></div>
        <h2>사람이 고친 곳</h2>
        <button
          v-for="b in summary.bars"
          :key="b.c"
          type="button"
          :class="['sum-row', { on: filter === b.c }]"
          :title="filter === b.c ? '모든 갈래를 처음부터' : `${b.c} 장면만 처음부터 다시 보기`"
          @click="emit('filter', filter === b.c ? null : b.c)"
        >
          <span>{{ b.c }}</span>
          <i :style="{ width: `${b.w}%`, background: CAT_COLOR[b.c] }"></i>
          <b>{{ b.n }}</b>
        </button>
        <p class="sum-hint">갈래를 누르면 그 갈래 장면만 처음부터</p>
        <div class="totals">
          <span class="add">TTL +{{ summary.added }}</span>
          <span class="del">TTL −{{ summary.removed }}</span>
          <span>GeoJSON {{ summary.geo }}곳</span>
        </div>
      </div>
    </transition>

    <div v-if="error" class="hud-error">TTL 비교를 만들지 못했습니다: {{ error }}</div>

    <!-- 아래: 조작 막대와 시간줄 -->
    <div class="hud-bar">
      <div class="track" :class="{ scrubbing: scrub?.moved }" title="끌어서 편집 하나씩 훑기" @pointerdown="onTrackDown" @pointermove="onTrackMove" @pointerup="onTrackUp" @pointercancel="onTrackUp">
        <i class="fill" :style="{ width: `${(100 * shownAt) / Math.max(1, total)}%` }"></i>
        <i
          v-for="k in total"
          :key="k"
          class="tick"
          :class="{ done: k <= shownAt, looping: k - 1 === loop, off: !!filter && !!steps[k - 1] && steps[k - 1].category !== filter }"
          :title="steps[k - 1] ? `#${two(k)} ${steps[k - 1].label} · 바뀐 것 ${steps[k - 1].changes.length} — 이 장면만 반복해서 보기` : undefined"
          :style="{ left: `${(100 * (k - 0.5)) / total}%`, background: steps[k - 1] ? CAT_COLOR[steps[k - 1].category] : undefined, '--w': weights[k - 1] ?? 0 }"
          @click="onTick(k)"
        ></i>
      </div>
      <div class="buttons">
        <button type="button" title="처음부터 (Home)" @click="emit('restart')">⏮</button>
        <button type="button" title="이전 편집 (←)" @click="emit('prev')">◀</button>
        <button type="button" class="play" :title="playing ? '멈춤 (Space)' : loop !== null ? '다음 장면부터 이어서 재생 (Space)' : '재생 (Space)'" @click="emit('toggle')">{{ playing ? '❚❚' : '▶' }}</button>
        <button type="button" title="다음 편집 (→)" @click="emit('next')">▶▶</button>
        <span class="speeds">
          <button v-for="s in [0.5, 1, 2, 4]" :key="s" type="button" :aria-pressed="speed === s" @click="emit('speed', s)">{{ s }}×</button>
        </span>
        <span class="status">
          <template v-if="loop !== null">#{{ two(loop + 1) }} 반복 중 · <kbd>Space</kbd> 다음 장면부터 이어서</template>
          <template v-else-if="filter && phase !== 'done'"><button type="button" class="filter-chip" :style="{ '--c': CAT_COLOR[filter] }" title="거르기 풀기" @click="emit('filter', null)">{{ filter }}만 ✕</button> · 편집 {{ at }}/{{ total }}</template>
          <template v-else-if="comparing">편집 전 보는 중 · <kbd>B</kbd> 떼면 편집 후</template>
          <template v-else>{{ phase === 'opening' ? '여는 중' : phase === 'done' ? '끝' : playing ? '재생 중' : '멈춤' }} · 편집 {{ at }}/{{ total }} · <kbd>B</kbd> 누르고 있으면 편집 전</template>
        </span>
        <button
          type="button"
          :class="['rec', { on: recording != null }]"
          :title="recording != null ? '녹화 멈추고 내려받기 (R)' : '처음부터 끝 화면까지 녹화해 webm 으로 내려받기 (R) — 브라우저가 이 탭을 공유할지 묻습니다'"
          @click="emit('record')"
        >
          <template v-if="recording != null">■ {{ Math.floor(recSec / 60) }}:{{ two(recSec % 60) }}</template>
          <template v-else>● 녹화</template>
        </button>
        <button type="button" class="close" title="닫기 (Esc · P) — 남은 편집을 다시 해서 원래 상태로" @click="emit('close')">✕ 닫기</button>
      </div>
    </div>
  </div>
</template>

<!-- 극장은 App 의 3D 칸(.viewport)을 바꾸는 것이라 scoped 로 둘 수 없다. styles.css 대신 여기 둬서 리플레이 것을 이 폴더에 모은다. -->
<style>
/* 편집 리플레이(PoC)의 극장. 3D 를 창 전체로 키우고 나머지 화면은 가린다 — 리플레이 동안 다른 편집이 끼면 되감은 이력이 깨진다. */
.viewport.theater {
  position: fixed;
  inset: 0;
  z-index: 1000;
  height: auto;
  margin: 0;
  border: none;
  border-radius: 0;
  /* 영화 화면 톤의 거의 검은 무대(ReplayHud 의 위아래 띠와 이어진다). */
  background: #07090c;
  box-shadow: none;
}
/* 오른쪽 칼럼은 장면 카드(ReplayHud 의 .hud-feed) 자리다. 3D 를 그만큼 좁혀 카드가 건물을 가리지 않게 한다. */
.viewport.theater .canvas-wrap canvas {
  width: calc(100% - var(--replay-feed, 440px)) !important;
}
.viewport.theater > :not(.canvas-wrap),
.viewport.theater .canvas-wrap > :not(canvas):not(.replay-hud) {
  display: none !important;
}
</style>

<style scoped>
/* 중계 화면의 리플레이처럼: 불투명한 판, 각진 모서리, 진한 색. 흐림·유리·필터는 쓰지 않는다 — 3D 가 또렷해야 한다. */
.replay-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
  color: #f2f6ff;
  font-family: system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  --mint: #5ef2c2;
  --pink: #ff6b9a;
  --panel: #0b1018;
  --line: #223047;
  --feed: var(--replay-feed, 440px);
  /* 오른쪽 기둥의 위쪽(GeoJSON 패널) 높이. 아래는 TTL 기록판이다. */
  --geo-h: 50%;
}
.replay-hud button,
.card,
.hud-bar,
.rp-side {
  pointer-events: auto;
}

/* --- 왼쪽 위 표시 --- */
.bug {
  position: absolute;
  top: 1.6%;
  left: 18px;
  display: flex;
  align-items: stretch;
  gap: 6px;
  height: 32px;
  font-weight: 600;
}
/* 편집 전 보기 표시. 위 검은 띠 가운데(끝 화면의 통계 타일과 겹치지 않게), 갈래 색 테두리. */
.compare {
  position: absolute;
  top: 1.6%;
  height: 32px;
  box-sizing: border-box;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border: 1px solid var(--c);
  background: rgba(5, 6, 8, 0.72);
  color: #fff;
  font-size: 13px;
  box-shadow: 0 0 18px color-mix(in srgb, var(--c) 40%, transparent);
}
.compare b {
  font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.2em;
  color: var(--c);
}

/* 층 레일. 왼쪽, 리플레이 표시 아래. 끝 화면의 요약판(.hud-done)보다 위에서 끝난다. */
.rail {
  position: absolute;
  top: 92px;
  left: 18px;
  display: flex;
  flex-direction: column;
  max-width: 240px;
  padding: 6px 0;
  border-left: 1px solid rgba(255, 255, 255, 0.14);
  /* 밝은 3D(밤 다이오라마의 방 불빛) 위에서도 읽히게 자막 판처럼 반투명 검은 판을 깐다. */
  background: rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(4px);
}
.rail-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: var(--row);
  padding: 0 10px 0 0;
  border: none;
  background: none;
  color: rgba(230, 236, 245, 0.55);
  font: 500 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: left;
  cursor: pointer;
  position: relative;
}
.rail-row::before {
  content: '';
  width: 8px;
  height: 1px;
  background: rgba(255, 255, 255, 0.25);
  flex: none;
  transition: width 300ms, background 300ms;
}
.rail-row.quiet {
  cursor: default;
  opacity: 0.45;
}
.rail-row.here {
  color: #fff;
}
.rail-row.here::before {
  width: 18px;
  height: 2px;
  background: var(--mint);
  box-shadow: 0 0 8px var(--mint);
}
.rail-row:not(.quiet):hover {
  color: #fff;
}
.rail-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rail-dots {
  display: flex;
  align-items: center;
  gap: 3px;
}
.rail-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid var(--c);
  opacity: 0.6;
}
.rail-dots i.done {
  background: var(--c);
  opacity: 1;
}
.rail-dots b {
  font-weight: 500;
  font-size: 10px;
}

/* 갈래 색은 가는 테두리와 아주 옅은 빛에만 둔다. 판은 반투명 검정이라 띠 위에 얹혀도 튀지 않는다. */
.bug > span {
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
  background: rgba(5, 6, 8, 0.72);
  color: #e6e9ee;
  box-shadow: 0 0 6px color-mix(in srgb, var(--c) 18%, transparent);
}
.bug-replay {
  --c: #ffffff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.28em;
}
.bug-count {
  gap: 2px;
  font-size: 17px;
}
.bug-count b {
  display: inline-block;
}
.bug-count i {
  font-size: 12px;
  font-style: normal;
  opacity: 0.6;
}
.bug-cat {
  color: var(--c);
  font-size: 13px;
  letter-spacing: 0.08em;
}
/* 층은 갈래가 아니라 자리라서 갈래 색을 쓰지 않는다. */
.bug-storey {
  --c: #ffffff;
  gap: 8px;
  font-size: 13px;
  letter-spacing: 0.04em;
}
.bug-storey i {
  color: #9aa0a8;
  font-size: 11px;
  font-style: normal;
  font-weight: 400;
}

/* --- 다시 한 순간 --- */
.impact {
  /* 흐림 그림자(box-shadow blur)는 화면 전체를 다시 칠해 다시 하는 순간 프레임이 끊겼다. 테두리와 그라데이션만 쓴다. */
  position: absolute;
  inset: 0 var(--feed) 0 0;
  border: 4px solid var(--c);
  background: radial-gradient(ellipse at center, transparent 55%, color-mix(in srgb, var(--c) 22%, transparent));
  will-change: opacity;
  animation: impact 650ms ease-out both;
}

/* --- 장면 제목 --- */
.scene {
  position: absolute;
  left: 18px;
  bottom: 104px;
  max-width: calc(100% - var(--feed) - 60px);
}
.scene-kicker {
  display: flex;
  align-items: stretch;
  height: 30px;
  font-weight: 900;
  animation: kicker-in 450ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
.scene-kicker b {
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--c);
  color: #05080d;
  font-size: 18px;
}
.scene-kicker span {
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: #fff;
  color: #05080d;
  font-size: 14px;
  clip-path: polygon(0 0, 100% 0, calc(100% - 9px) 100%, 0 100%);
  padding-right: 20px;
}
.scene-title {
  position: relative;
  display: inline-block;
  overflow: hidden;
  background: #05080d;
  border-left: 6px solid var(--c);
}
.scene-title {
  padding: 8px 18px 10px 14px;
  font-size: 34px;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: -0.01em;
  transform-origin: left;
  animation: plate 380ms cubic-bezier(0.7, 0, 0.2, 1) both;
}
.wd {
  display: inline-block;
  margin-right: 0.28em;
  animation: word 460ms cubic-bezier(0.2, 1.5, 0.35, 1) both;
}
.wd.key {
  color: var(--c);
}

/* --- 장면 전환 --- */
.swipe {
  position: absolute;
  inset: 0 var(--feed) 0 0;
  background: #000;
  pointer-events: none;
  animation: dip 900ms ease-in-out forwards;
}

/* --- 오프닝 --- */
.opening {
  justify-items: start;
  padding-left: 8%;
  text-align: left;
  /* 건물이 솟아오르는 것(viewer.buildUp)이 주인공이다. 제목은 잠깐 보이고 걷힌다. */
  animation: op-out 700ms ease-in 1.9s forwards;
}
@keyframes op-out {
  to {
    opacity: 0;
    transform: translateY(-12px);
  }
}
.op-kicker {
  padding: 6px 12px;
  background: #fff;
  color: #05080d;
  font-size: 16px;
  font-style: italic;
  font-weight: 900;
  animation: kicker-in 400ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
.op-title {
  margin: 14px 0 10px;
  font-size: 68px;
  font-weight: 900;
  line-height: 1.05;
  letter-spacing: -0.02em;
  text-shadow: 0 4px 0 #05080d;
}
.op-sub {
  padding: 6px 12px;
  border-left: 6px solid var(--mint);
  background: #05080d;
  font-size: 18px;
  font-weight: 800;
  animation: kicker-in 400ms 500ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
.op-sub b {
  color: var(--mint);
}
.op-sub i {
  margin: 0 6px;
  font-style: normal;
  opacity: 0.5;
}

/* --- 끝 통계 타일 --- */
.rp-stats {
  position: absolute;
  top: 18px;
  right: calc(var(--feed) + 18px);
  display: flex;
  gap: 8px;
}
.stat {
  display: grid;
  min-width: 112px;
  padding: 10px 14px 12px;
  border-top: 4px solid var(--mint);
  background: #05080d;
  animation: tile 520ms cubic-bezier(0.2, 1.4, 0.35, 1) both;
}
.stat-n {
  font-size: 46px;
  font-weight: 900;
  line-height: 1;
}
.stat > b {
  margin-top: 6px;
  color: var(--mint);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
}
.stat > span {
  color: #9fb0c8;
  font-size: 11px;
}
.scene-leave-active {
  transition:
    opacity 250ms,
    transform 250ms;
}
.scene-leave-to {
  opacity: 0;
  transform: translateX(-40px);
}

/* --- 오프닝 판(제목이 뜨는 자리) --- */
.hud-rewind {
  position: absolute;
  inset: 0 var(--feed) 0 0;
  display: grid;
  place-content: center;
  overflow: hidden;
  text-align: center;
}
/* --- 오른쪽 기둥 --- */
.rp-side {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: var(--feed);
  border-left: 2px solid var(--line);
  background: var(--panel);
}
.hud-geo {
  flex: none;
  height: var(--geo-h);
  padding: 12px 12px 0;
}
.log-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 12px 12px 0;
  padding: 6px 10px;
  background: #fff;
  color: #05080d;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.04em;
}
.log-head b {
  font-size: 15px;
}
.log-head i {
  font-style: normal;
  opacity: 0.55;
}
.log {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px 12px;
  overflow: hidden;
}
.next {
  display: flex;
  align-items: stretch;
  flex: none;
  height: 34px;
  border: 2px solid var(--c);
  font-size: 14px;
  font-weight: 800;
}
.next-tag {
  display: flex;
  align-items: center;
  padding: 0 10px;
  background: var(--c);
  color: #05080d;
  font-weight: 900;
}
.next-label {
  flex: 1;
  align-self: center;
  overflow: hidden;
  padding: 0 10px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.next-arrow {
  align-self: center;
  padding: 0 10px;
  color: var(--c);
  animation: nudge 0.7s ease-in-out infinite;
}
.card {
  display: grid;
  grid-template-columns: 48px 1fr;
  flex: none;
  border: 1px solid var(--line);
  background: #111826;
  cursor: pointer;
}
.card:hover {
  border-color: var(--c);
}
.idx {
  display: grid;
  place-items: center;
  background: var(--c);
  color: #05080d;
  font-size: 15px;
  font-weight: 900;
}
.body {
  min-width: 0;
  padding: 9px 12px 10px;
}
.card header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.card .cat {
  color: var(--c);
  font-weight: 800;
}
.card .time {
  margin-left: auto;
  color: #7f8fa8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.card h3 {
  margin: 4px 0 6px;
  overflow: hidden;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 지난 장면은 한 줄. 흐리지 않는다 — 색만 한 단계 낮춘다. */
.card.old {
  grid-template-columns: 40px 1fr;
  background: #0d131e;
}
.card.old .idx {
  background: color-mix(in srgb, var(--c) 30%, #0d131e);
  color: #f2f6ff;
  font-size: 13px;
}
.card.old .body {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
}
.card.old header {
  order: 2;
  margin-left: auto;
}
.card.old .cat {
  display: none;
}
.card.old h3 {
  margin: 0;
  color: #c3cfe2;
  font-size: 14px;
  font-weight: 700;
}
/* 아직 다시 하지 않은 장면(카드를 눌러 앞 장면으로 돌아갔을 때 그 뒤). 남기되 지금 모델에는 없다는 것만 보인다. */
.card.ahead {
  opacity: 0.55;
}
/* 반복 중인 장면. 테두리를 그 갈래 색으로 두고, 번호 칸에 반복 표시를 단다. */
.card.looping {
  border-color: var(--c);
  box-shadow: 0 0 0 1px var(--c);
}
.card.looping .idx::after {
  content: '⟲';
  display: block;
  font-size: 15px;
  animation: spin 1.6s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(-360deg);
  }
}
.status kbd {
  padding: 0 4px;
  border: 1px solid #344560;
  font: inherit;
  font-size: 11px;
}
.ttl-head {
  margin-bottom: 4px;
  font: 700 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #8a9ab3;
}
.ttl-head .add,
.totals .add,
.line.add {
  color: var(--mint);
}
.ttl-head .del,
.totals .del,
.line.del {
  color: var(--pink);
}
.ttl-head .chg {
  color: #ffd166;
}
.line {
  overflow: hidden;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  text-overflow: ellipsis;
  animation: type-in 380ms both cubic-bezier(0.2, 0.9, 0.25, 1);
}
.line.subject {
  color: #9fb0c8;
}
.line.del {
  text-decoration: line-through;
}
.line.none,
.line.more {
  color: #8a9ab3;
}

/* --- 끝 --- */
.hud-done {
  /* 끝 화면은 건물 전체에 고친 자리 빛기둥이 서 있다 — 가리지 않게 왼쪽 아래에 둔다. */
  position: absolute;
  left: 18px;
  bottom: 104px;
  width: min(420px, 45%);
  border: 2px solid #fff;
  background: var(--panel);
  pointer-events: auto;
  animation: slam 500ms cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
}
.done-head {
  display: flex;
  justify-content: space-between;
  padding: 7px 14px;
  background: #fff;
  color: #05080d;
  font-size: 14px;
  font-weight: 900;
  font-style: italic;
}
.hud-done h2 {
  margin: 12px 16px 8px;
  font-size: 24px;
  font-weight: 900;
}
.sum-row {
  display: grid;
  grid-template-columns: 100px 1fr 30px;
  align-items: center;
  gap: 10px;
  margin: 6px 16px;
  font-size: 14px;
  font-weight: 700;
}
/* 녹화 버튼. 녹화 중에는 붉게 숨 쉰다. */
.buttons .rec.on {
  color: #ff4d5e;
  border-color: #ff4d5e;
  animation: rec-pulse 1.2s ease-in-out infinite;
}
@keyframes rec-pulse {
  50% {
    box-shadow: 0 0 10px rgba(255, 77, 94, 0.6);
  }
}

/* 갈래 줄은 누를 수 있다(그 갈래만 다시 보기). */
button.sum-row {
  width: calc(100% - 32px);
  padding: 2px 0;
  border: none;
  background: none;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
button.sum-row:hover,
button.sum-row.on {
  background: rgba(255, 255, 255, 0.06);
  box-shadow: -6px 0 0 rgba(255, 255, 255, 0.06), 6px 0 0 rgba(255, 255, 255, 0.06);
}
button.sum-row.on span {
  color: var(--mint);
}
.sum-hint {
  margin: 2px 16px 0;
  font-size: 11px;
  color: rgba(230, 236, 245, 0.5);
}
.track .tick.off {
  opacity: 0.15;
}
.filter-chip {
  padding: 1px 8px;
  border: 1px solid var(--c);
  background: none;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.sum-row i {
  height: 12px;
  animation: grow 800ms both cubic-bezier(0.2, 0.9, 0.25, 1);
  transform-origin: left;
}
.totals {
  display: flex;
  gap: 18px;
  margin: 12px 16px 14px;
  font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace;
}
.hud-error {
  position: absolute;
  left: 18px;
  bottom: 90px;
  padding: 6px 10px;
  background: #5a0d1c;
  font-size: 12px;
}

/* --- 조작 막대 --- */
.hud-bar {
  position: absolute;
  left: 18px;
  right: calc(var(--feed) + 18px);
  bottom: 14px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  background: var(--panel);
}
.track {
  position: relative;
  cursor: ew-resize;
  touch-action: none;
  height: 6px;
  margin: 2px 0 10px;
  background: #1c2738;
}
.track .fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--mint);
  transition: width 500ms cubic-bezier(0.2, 0.9, 0.25, 1);
}
/* 6px 줄은 잡기 어렵다 — 위아래로 잡는 자리를 넓힌다. */
.track::before {
  content: '';
  position: absolute;
  inset: -12px 0;
}
/* 끄는 동안은 채움이 손을 바로 따라온다. */
.track.scrubbing .fill {
  transition: none;
}
.track .tick {
  position: absolute;
  /* 아래를 시간줄 밑에 붙이고 바뀐 양(--w, 0~1)만큼 위로 키운다. */
  bottom: -5px;
  width: 4px;
  height: calc(12px + 18px * var(--w, 0));
  transform-origin: bottom;
  margin-left: -2px;
  background: #8a9ab3;
  opacity: 0.55;
  pointer-events: auto;
  cursor: pointer;
}
/* 눈금은 4px 라 누르기 어렵다. 누를 자리를 넓힌다. */
.track .tick::before {
  content: '';
  position: absolute;
  inset: -8px -7px;
}
.track .tick:hover {
  transform: scaleY(1.5);
  opacity: 1;
}
.track .tick.done {
  opacity: 1;
}
.track .tick.looping {
  opacity: 1;
  transform: scaleY(1.6);
  box-shadow: 0 0 6px currentColor;
}
.buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.buttons > button,
.buttons .speeds {
  flex: none;
}
.buttons button {
  padding: 4px 10px;
  border: 1px solid #344560;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.buttons button:hover {
  border-color: #fff;
}
.buttons .play {
  min-width: 46px;
  border-color: #fff;
  background: #fff;
  color: #05080d;
}
.speeds {
  display: inline-flex;
  gap: 2px;
  margin-left: 6px;
}
.speeds button[aria-pressed='true'] {
  border-color: var(--mint);
  background: var(--mint);
  color: #05080d;
}
.status {
  margin-left: auto;
  /* 한 줄로 둔다 — 재생 중·멈춤으로 글 길이가 바뀔 때 줄이 바뀌면 막대 높이가 들썩여 시간줄이 움직였다. 넘치면 말줄임. */
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: #c3cfe2;
  font-weight: 600;
}
.close {
  margin-left: 6px;
}

/* --- 움직임 --- */
.card-enter-active {
  transition:
    opacity 350ms,
    transform 350ms cubic-bezier(0.2, 0.9, 0.25, 1.1);
}
.card-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.card-leave-active {
  display: none;
}
.card-move {
  transition: transform 350ms cubic-bezier(0.2, 0.9, 0.25, 1);
}
.next-enter-active {
  transition:
    opacity 250ms,
    transform 250ms;
}
.next-enter-from {
  opacity: 0;
  transform: translateX(40px);
}
.next-leave-active {
  display: none;
}
.roll-enter-active,
.roll-leave-active {
  transition:
    transform 250ms cubic-bezier(0.2, 0.9, 0.25, 1),
    opacity 250ms;
}
.roll-enter-from {
  opacity: 0;
  transform: translateY(60%);
}
.roll-leave-to {
  opacity: 0;
  transform: translateY(-60%);
}
.chip-enter-active {
  transition:
    opacity 250ms,
    transform 250ms;
}
.chip-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 300ms;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@keyframes impact {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
/* ===== 화면 톤 =====
 * 위의 판(중계 화면 모양)에 영화 화면 톤을 덮는다: 위아래 검은 띠, 가운데 가늘고 큰 자막, 검게 잠겼다 밝아지는 장면 전환,
 * 가는 글씨의 끝 요약. 오른쪽 기둥(GeoJSON·카드)은 위의 판 그대로다. */
.lb {
  position: absolute;
  left: 0;
  right: var(--feed);
  height: 8%;
  background: #000;
}
.lb.top {
  top: 0;
}
.lb.bottom {
  bottom: 0;
}
.replay-hud .scene {
  left: calc((100% - var(--feed)) / 2);
  bottom: calc(8% + 88px);
  max-width: calc(100% - var(--feed) - 80px);
  text-align: center;
  translate: -50% 0;
}
.replay-hud .scene-kicker {
  justify-content: center;
  height: auto;
  margin-bottom: 10px;
  font-weight: 400;
  letter-spacing: 0.4em;
}
.replay-hud .scene-kicker b,
.replay-hud .scene-kicker span {
  padding: 0 8px;
  background: transparent;
  color: var(--c);
  font-size: 14px;
  font-weight: 700;
  clip-path: none;
  text-shadow:
    0 1px 2px #000,
    0 0 10px rgba(0, 0, 0, 0.9);
}
.replay-hud .scene-title {
  border: 0;
  background: transparent;
  font-size: 42px;
  font-weight: 300;
  letter-spacing: 0.01em;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.9);
  animation: none;
}
.replay-hud .wd {
  animation: rise-soft 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.replay-hud .wd.key {
  color: #fff;
  font-weight: 600;
}
.replay-hud .impact {
  border: 0;
  background: rgba(255, 255, 255, 0.12);
}
.replay-hud .hud-bar {
  bottom: 1.2%;
  border-color: #24262b;
}
.replay-hud .rp-stats .stat {
  border-top: 1px solid #fff;
}
.replay-hud .stat-n {
  font-weight: 200;
}
.replay-hud .op-title {
  font-weight: 200;
  text-shadow: none;
}

/* 끝 통계 타일은 위 검은 띠 아래로 — 띠 안의 왼쪽 위 표시와 겹치지 않고 띠를 비워 둔다. */
.replay-hud .rp-stats {
  top: calc(8% + 14px);
}
/* 끝 요약: 흰 판이 내리꽂히지 않고, 가는 선 위에 가는 글씨로 떠오른다. 갈래 색은 막대에만 둔다. */
.replay-hud .hud-done {
  border: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.7);
  background: rgba(5, 6, 8, 0.82);
  animation: rise-soft 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.replay-hud .done-head {
  background: transparent;
  color: #9aa0a8;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0.3em;
}
.replay-hud .hud-done h2 {
  font-size: 26px;
  font-weight: 300;
}
.replay-hud .sum-row {
  font-weight: 400;
  color: #d9dce1;
}
.replay-hud .sum-row i {
  height: 3px;
}
.replay-hud .totals,
.replay-hud .totals span {
  color: #b9bec6 !important;
  font-weight: 400;
}
@keyframes rise-soft {
  from {
    opacity: 0;
    transform: translateY(14px);
  }
}
@keyframes dip {
  0% {
    opacity: 0;
  }
  45% {
    opacity: 0.85;
  }
  100% {
    opacity: 0;
  }
}
@keyframes plate {
  from {
    transform: scaleX(0);
  }
}
@keyframes word {
  from {
    opacity: 0;
    transform: translateY(65%) scale(0.85);
  }
}
@keyframes tile {
  from {
    opacity: 0;
    transform: translateY(-24px) scale(0.9);
  }
}
@keyframes kicker-in {
  from {
    opacity: 0;
    transform: translateX(-30px);
  }
}
@keyframes slam {
  from {
    opacity: 0;
    transform: scale(1.25);
  }
}
@keyframes nudge {
  50% {
    transform: translateX(4px);
  }
}
@keyframes type-in {
  from {
    opacity: 0;
    transform: translateX(14px);
    clip-path: inset(0 100% 0 0);
  }
  to {
    opacity: 1;
    transform: none;
    clip-path: inset(0 0 0 0);
  }
}
@keyframes grow {
  from {
    transform: scaleX(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .line,
  .sum-row i,
  .scene *,
  .scene-title,
  .wd,
  .op-kicker,
  .op-sub,
  .stat,
  .impact,
  .next-arrow,
  .hud-done {
    animation: none;
  }
  .impact,
  .swipe {
    display: none;
  }
  .wd {
    animation: none !important;
  }
}

/* 반복 중인 카드. 카드 판의 테두리 규칙보다 뒤에 두어 갈래 색 테두리가 이긴다. */
.replay-hud .card.looping {
  border-color: var(--c);
  box-shadow: 0 0 0 2px var(--c);
}
</style>
