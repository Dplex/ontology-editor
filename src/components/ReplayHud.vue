<script setup lang="ts">
// 편집 리플레이(PoC)의 3D 위 표시. 움직임은 3D 가 한다(App.vue 가 되돌리기로 처음까지 돌리고 다시 하기로 하나씩 다시 한다) —
// 여기는 지금 몇 번째인지, 그 편집이 TTL·GeoJSON 의 어디를 바꿨는지를 채팅처럼 카드로 쌓고, 조작 막대를 둔다.
// 카드 내용은 워커가 모델 사본으로 계산한 것이다(lib/replay.ts).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { nameTable, pickHighlights, readableTtl, replayReport } from '../lib/replay-report'
import ReplayGeo from './ReplayGeo.vue'
import ReplayRelations from './ReplayRelations.vue'
import { impactLines, relationsOf } from '../lib/replay-relations'
import Roll from './Roll.vue'
import { CATEGORIES, CATEGORY_COLOR, type Category, type ReplayStart, type ReplayStep } from '../lib/replay'

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
  /** ? 를 누른 횟수. 바뀔 때마다 단축키 안내를 켜고 끈다. */
  helpToggles?: number
  /** 변경 지도를 켰으면 더한·고친·지운 것의 수. */
  diff?: { added: number; modified: number; removed: number } | null
  /** 끝 화면의 층 펼치기(E). 펼칠 수 없으면(층 하나·맨 위층만 고침·끝 화면 아님) null. */
  spread?: boolean | null
  /** 요약 재생 중이면 그 장면 번호들(나머지는 연출 없이 지나간다). */
  highlights?: readonly number[] | null
  /** Esc 를 눌러 닫을지 묻는 중. */
  askClose?: boolean
  /** 판 모양: plan(도면) · show(중계). */
  theme?: 'plan' | 'show'
}>()
const emit = defineEmits<{ toggle: []; prev: []; next: []; restart: []; speed: [number]; close: []; scene: [number]; seek: [number]; filter: [Category | null]; record: []; diff: []; spread: []; highlights: []; stay: []; theme: [] }>()

const CAT_COLOR = CATEGORY_COLOR

/**
 * 화면에 보이는 장면 수. B 로 편집 전을 보는 동안(comparing)은 편집 하나를 되돌려 at 이 하나 줄지만, 보는 것은 여전히 그 장면이라
 * 제목·카드·번호는 그 장면에 둔다(GeoJSON 패널만 편집 전 모양으로).
 */
const shownAt = computed(() => props.at + (props.comparing ? 1 : 0))

/** TTL 의 `ex:<id>` → 이름. GUID 로는 무엇이 바뀌었는지 못 읽어서 화면에서만 바꿔 보인다(변경 리포트와 같은 표). */
const names = computed(() => nameTable(props.start, props.steps))
const readable = (line: string) => readableTtl(line, names.value)

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
const wanted = (s: ReplayStep | null | undefined) => !!s && (!props.filter || s.category === props.filter) && (!props.highlights || props.highlights.includes(s.index))
const scene = computed(() => (props.phase === 'play' && wanted(current.value) ? current.value : null))
/** 요약 재생에 들 장면 수(끝 화면 버튼). 장면이 적거나 카드 계산 전이면 0 — 버튼을 숨긴다. */
const highlightCount = computed(() => pickHighlights(props.steps, props.total).length)

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
/** 장면마다의 값 → 작은 막대그래프(스파크라인)의 높이(0~1). 장면 순서대로라 어디서 많이 바뀌었는지 한눈에. */
const spark = (vals: number[]) => {
  const max = Math.max(1, ...vals)
  return vals.map((v) => v / max)
}
/** 층마다(아래층부터) 그 층을 고친 장면 수. 층이 하나면 막대 하나라 그리지 않는다. */
const floorSpark = computed(() => {
  const storeys = [...(props.start?.storeys ?? [])].sort((a, b) => a.elevation - b.elevation)
  return spark(storeys.map((st) => props.steps.filter((s) => s.storeyIds.includes(st.id)).length))
})
const geoCount = (s: ReplayStep) => (s.geojson ? s.geojson.count.changed + s.geojson.count.added + s.geojson.count.removed : 0)
const stats = computed(() => [
  { n: props.total, label: 'edits', sub: '고친 편집', spark: spark(props.steps.map((s) => s.changes.length)) },
  { n: new Set(props.steps.flatMap((s) => s.storeyIds)).size, label: 'floors', sub: '고친 층', spark: floorSpark.value },
  { n: props.steps.reduce((n, s) => n + geoCount(s), 0), label: 'features', sub: 'GeoJSON feature', spark: spark(props.steps.map(geoCount)) },
  { n: props.steps.reduce((n, s) => n + s.ttlCount.added + s.ttlCount.removed, 0), label: 'ttl', sub: 'TTL 줄 (더함·지움)', spark: spark(props.steps.map((s) => s.ttlCount.added + s.ttlCount.removed)) },
])
const two = (n: number) => String(n).padStart(2, '0')

/** 변경 리포트(마크다운)를 내려받는다 — 장면마다 TTL 의 어느 줄, GeoJSON 의 어느 feature 가 바뀌었나(replay-report.ts). */
function downloadReport() {
  const md = replayReport({ title: props.title, start: props.start, steps: props.steps })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
  a.download = `replay-report-${props.title.replace(/\.ifc\b/gi, '').replace(/[^\w가-힣.-]+/g, '_') || 'edit'}.md`
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

/** 단축키 안내(? 로 켜고 끈다). 리플레이 키는 replay-player.ts 의 replayKey 와 같다. */
const help = ref(false)
const KEYS: [string, string][] = [
  ['Space', '재생 · 멈춤 (반복 중이면 다음 장면부터)'],
  ['← →', '편집 하나 앞뒤'],
  ['Home', '처음부터'],
  ['B 누른 채', '지금 장면의 편집 전 보기'],
  ['R', '녹화 시작 · 멈추고 내려받기'],
  ['D', '끝 화면에서 변경 지도(더함·고침·지움 색) 켜고 끄기'],
  ['E', '끝 화면에서 층 펼치기 — 고친 층 위를 들어 올려 들여다보기'],
  ['S', '요약 재생 — 바뀐 양이 큰 장면 몇 개만(갈래마다 하나 먼저) 처음부터'],
  ['T', '판 모양 바꾸기 — 도면(가는 선) · 중계(색과 빛)'],
  ['?', '이 안내'],
  ['Esc', '닫기 — 한 번 묻는다(Enter 로 닫기). 편집한 상태로 돌아감'],
]
// 키보드의 ? 는 App 이 받아 리플레이로 넘긴다(replayKey) — 누를 때마다 helpToggles 가 하나 는다.
watch(
  () => props.helpToggles ?? 0,
  (n, before) => {
    if (n !== before) help.value = !help.value
  },
)

/** 시간줄 눈금 위에 올린 장면(미리보기 판). */
const hoverTick = ref<{ k: number; x: number } | null>(null)
const hovered = computed(() => (hoverTick.value ? (props.steps[hoverTick.value.k - 1] ?? null) : null))

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
// 끝 화면에는 왼쪽 아래에 요약판이 서서 레일에 줄 수 있는 높이가 줄어든다(합성 20층에서 겹쳤다).
const railRow = computed(() => (rail.value ? Math.max(6, Math.min(22, Math.floor((props.phase === 'done' ? 240 : 300) / rail.value.length))) : 0))

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
  <div class="replay-hud" :data-phase="phase" :data-at="at" :data-total="total" :data-ready="steps.length" :data-loop="loop ?? ''" :data-theme="theme ?? 'plan'" :style="{ '--scene-c': current && phase !== 'opening' ? CAT_COLOR[current.category] : '#7c5cff' }">
    <!-- 위아래 검은 띠(영화 화면비) -->
    <div class="lb top"></div>
    <div class="lb bottom"></div>
    <!-- 다시 한 순간 -->
    <div v-if="impact" :key="impact" class="impact" :style="{ '--c': current ? CAT_COLOR[current.category] : '#5ef2c2' }"></div>

    <!-- 왼쪽 위: 리플레이 표시(위 검은 띠 안). 가는 테두리 판 셋 — REPLAY · 몇 번째 · 갈래. -->
    <div class="bug" :style="{ '--c': current ? CAT_COLOR[current.category] : '#5ef2c2' }">
      <span class="bug-replay">리플레이</span>
      <span v-if="phase !== 'opening'" class="bug-count">
        <transition name="roll" mode="out-in"><b :key="counter">{{ counter }}</b></transition>
        <i>/{{ two(total) }}</i>
      </span>
      <transition name="chip" mode="out-in">
        <span v-if="current && phase !== 'opening' && wanted(current)" :key="current.index" class="bug-cat">{{ current.category }}</span>
      </transition>
      <!-- 한 층만 보일 때 그 층. 장면이 다른 층으로 가면 바뀌고, 건물 전체로 물러나면 사라진다. -->
      <transition name="chip" mode="out-in">
        <span v-if="storey && phase !== 'opening'" :key="storey.name" class="bug-storey">
          {{ storey.name }}<i>{{ storey.elevation >= 0 ? '+' : '' }}{{ storey.elevation.toFixed(2) }} m</i>
        </span>
      </transition>
    </div>

    <!-- 변경 지도 범례(D 로 켜고 끈다) -->
    <div v-if="diff" class="diff-legend">
      <b>변경 지도</b>
      <span><i class="sw add"></i>더함 {{ diff.added }}</span>
      <span><i class="sw mod"></i>고침 {{ diff.modified }}</span>
      <span><i class="sw del"></i>지움 {{ diff.removed }}</span>
      <kbd>D</kbd>
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
        <div class="op-kicker">편집 리플레이</div>
        <div class="op-title">
          <span v-for="(t, i) in openingTitle" :key="i" class="wd" :style="{ animationDelay: `${150 + i * 90}ms` }">{{ t.w }}</span>
        </div>
        <div class="op-sub">
          편집 <b>{{ total }}</b>건<template v-if="start?.building"> <i>·</i> {{ title }}</template>
        </div>
      </div>
    </transition>

    <!-- 오른쪽 기둥 -->
    <aside class="rp-side">
      <div class="hud-geo">
        <ReplayGeo v-if="geoStep" :key="`${geoStep.index}:${geoApplied}`" :step="geoStep" :applied="geoApplied" :color="CAT_COLOR[geoStep.category]" />
        <!-- 첫 장면 전(오프닝): 빈 칸 대신 무엇이 여기 뜰지 자리를 잡아 둔다. -->
        <div v-else class="geo-wait" aria-hidden="true">
          <span class="wait-tag">GeoJSON</span>
          <i class="sk w60"></i><i class="sk w85"></i><i class="sk w40"></i><i class="sk w70"></i>
          <p>장면마다 층 파일(floor-*.geojson)에서 바뀐 feature 가 여기 뜹니다</p>
        </div>
      </div>
      <div class="log-head">
        <span>TTL 변경 기록</span>
        <!-- 반복 중에는 되돌릴 때마다 하나 내려갔다 오르지 않게 반복하는 장면 번호에 둔다. -->
        <b>{{ two(loop !== null ? loop + 1 : shownAt) }}<i>/{{ two(total) }}</i></b>
      </div>
      <div class="log">
        <transition name="next">
          <div v-if="upcoming && loop === null" :key="`up${upcoming.index}`" class="next" :style="{ '--c': CAT_COLOR[upcoming.category] }">
            <span class="next-tag">다음</span>
            <span class="next-label">{{ upcoming.label }}</span>
            <span class="next-arrow">▶</span>
          </div>
        </transition>
        <div v-if="!cards.length && !upcoming" class="log-wait" aria-hidden="true">
          <i class="sk w70"></i><i class="sk w50"></i>
          <p>편집 {{ total }}건을 고친 순서대로 다시 틉니다 — 장면마다 TTL 에서 바뀐 줄이 카드로 쌓입니다</p>
        </div>
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
            <div class="idx">{{ two(c.step.index + 1) }}</div>
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
                <!-- 그 관계 변화가 DT 질의의 답을 어떻게 바꾸나(말로) -->
                <div v-for="(l, i) in impactLines(c.rels, readable).slice(0, 2)" :key="`im${i}`" class="line query" :style="{ animationDelay: `${450 + i * 120}ms`, '--mk': `${900 + i * 120}ms` }">⇢ <span class="mk">{{ l }}</span></div>
                <template v-if="c.rows.length">
                  <!-- 더한 줄은 쳐진 뒤 형광펜이 왼쪽에서 오른쪽으로 그어진다(새로 들어간 값이 눈에 먼저 들어오게). -->
                  <div v-for="(r, i) in c.rows.slice(0, c.rels.length ? ROWS - 3 : ROWS)" :key="i" :class="['line', r.kind]" :style="{ animationDelay: `${250 + i * 70}ms`, '--mk': `${700 + i * 70}ms` }">
                    {{ r.kind === 'add' ? '+ ' : r.kind === 'del' ? '− ' : '▸ ' }}<span v-if="r.kind === 'add'" class="mk">{{ r.text }}</span><template v-else>{{ r.text }}</template>
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
          <span>{{ st.sub }}</span>
          <svg v-if="st.spark && st.spark.length > 1" class="spark" :viewBox="`0 0 ${st.spark.length} 1`" preserveAspectRatio="none" aria-hidden="true">
            <rect v-for="(v, k) in st.spark" :key="k" :x="k + 0.15" :y="1 - Math.max(v, 0.06)" width="0.7" :height="Math.max(v, 0.06)" :style="{ animationDelay: `${400 + k * 30}ms` }" />
          </svg>
        </div>
      </div>
    </transition>
    <transition name="fade">
      <div v-if="phase === 'done'" class="hud-done">
        <div class="done-head"><span>끝까지 봤습니다</span><b>편집 {{ total }}건</b></div>
        <h2>수정내역</h2>
        <button
          v-for="b in summary.bars"
          :key="b.c"
          type="button"
          :class="['sum-row', { on: filter === b.c }]"
          :title="filter === b.c ? '모든 갈래를 처음부터' : `${b.c} 장면만 처음부터 다시 보기`"
          @click="emit('filter', filter === b.c ? null : b.c)"
        >
          <span>{{ b.c }}</span>
          <i :style="{ width: `${b.w}%`, background: CAT_COLOR[b.c], '--bc': CAT_COLOR[b.c] }"></i>
          <b>{{ b.n }}</b>
        </button>
        <p class="sum-hint">갈래를 누르면 그 갈래 장면만 처음부터</p>
        <button v-if="highlightCount || highlights" type="button" :class="['report', 'highlight', { on: !!highlights }]" :title="highlights ? '요약 풀고 모든 장면을 처음부터 (S)' : '바뀐 양이 큰 장면만 골라 처음부터 — 녹화와 같이 쓰면 짧은 영상 (S)'" @click="emit('highlights')">★ 요약 재생 · {{ highlights?.length ?? highlightCount }}장면</button>
        <button type="button" :class="['report', { on: diff }]" title="더한·고친·지운 것을 3D 에 색으로 한꺼번에 (D)" @click="emit('diff')">▦ 변경 지도</button>
        <button v-if="spread != null" type="button" :class="['report', 'spread', { on: spread }]" title="고친 층 위의 층을 들어 올려 고친 층을 들여다보기 (E)" @click="emit('spread')">☰ 층 펼치기</button>
        <button type="button" class="report" title="장면마다 TTL·GeoJSON 에서 바뀐 것을 마크다운으로" @click="downloadReport">⇩ 변경 리포트 (.md)</button>
        <div class="totals">
          <span class="add">TTL +{{ summary.added }}</span>
          <span class="del">TTL −{{ summary.removed }}</span>
          <span>GeoJSON {{ summary.geo }}곳</span>
        </div>
      </div>
    </transition>

    <!-- 단축키 안내: GeoJSON 패널 바로 왼쪽에 붙어 열리고 닫힌다(가운데를 덮으면 보던 장면이 가린다). 끝 화면에서는 통계 타일 아래. -->
    <transition name="help">
      <div v-if="help" :class="['hud-help', { below: phase === 'done' }]" title="누르면 닫기 (?)" @click="help = false">
        <h4>리플레이 단축키<i>?</i></h4>
        <div v-for="[k, what] in KEYS" :key="k" class="help-row"><kbd>{{ k }}</kbd><span>{{ what }}</span></div>
        <p>시간줄을 끌면 편집 하나씩 훑고, 눈금·카드·빛기둥을 누르면 그 장면을 반복합니다.</p>
      </div>
    </transition>

    <!-- Esc 로 닫기 전에 묻는다(실수로 누르면 보던 장면을 잃는다). -->
    <transition name="fade">
      <div v-if="askClose" class="ask-close" role="alertdialog" aria-label="리플레이 닫기">
        <b>리플레이를 닫을까요?</b>
        <span>남은 편집을 다시 해서 리플레이 전 상태로 돌아갑니다.</span>
        <div class="ask-buttons">
          <button type="button" class="ask-yes" @click="emit('close')">닫기 <kbd>Enter</kbd></button>
          <button type="button" @click="emit('stay')">계속 보기 <kbd>Esc</kbd></button>
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
          :class="{ done: k <= shownAt, looping: k - 1 === loop, off: (!!filter || !!highlights) && !!steps[k - 1] && !wanted(steps[k - 1]), star: !!highlights?.includes(k - 1) }"
          :title="steps[k - 1] ? `#${two(k)} ${steps[k - 1].label} · 바뀐 것 ${steps[k - 1].changes.length} — 이 장면만 반복해서 보기` : undefined"
          :style="{ left: `${(100 * (k - 0.5)) / total}%`, background: steps[k - 1] ? CAT_COLOR[steps[k - 1].category] : undefined, '--w': weights[k - 1] ?? 0 }"
          @click="onTick(k)"
          @pointerenter="hoverTick = { k, x: (100 * (k - 0.5)) / total }"
          @pointerleave="hoverTick = null"
        ></i>
        <!-- 눈금 미리보기: 그 장면의 갈래·제목·바뀐 양 -->
        <div v-if="hovered && !scrub?.moved" class="tick-tip" :style="{ left: `${hoverTick!.x}%`, '--c': CAT_COLOR[hovered.category] }">
          <span class="tt-cat">#{{ two(hovered.index + 1) }} {{ hovered.category }}</span>
          <b>{{ hovered.label }}</b>
          <span class="tt-n">
            TTL +{{ hovered.ttlCount.added }} −{{ hovered.ttlCount.removed }}<template v-if="hovered.geojson"> · GeoJSON {{ hovered.geojson.count.changed + hovered.geojson.count.added + hovered.geojson.count.removed }}</template>
            · 바뀐 것 {{ hovered.changes.length }}
          </span>
        </div>
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
          <template v-else-if="highlights && phase !== 'done'"><button type="button" class="filter-chip" style="--c: #9aa3ae" title="요약 풀기" @click="emit('highlights')">★ 요약 {{ highlights.length }}장면 ✕</button> · 편집 {{ at }}/{{ total }}</template>
          <template v-else-if="filter && phase !== 'done'"><button type="button" class="filter-chip" :style="{ '--c': CAT_COLOR[filter] }" title="거르기 풀기" @click="emit('filter', null)">{{ filter }}만 ✕</button> · 편집 {{ at }}/{{ total }}</template>
          <template v-else-if="comparing">편집 전 보는 중 · <kbd>B</kbd> 떼면 편집 후</template>
          <template v-else>{{ phase === 'opening' ? '여는 중' : phase === 'done' ? '끝' : playing ? '재생 중' : '멈춤' }} · 편집 {{ at }}/{{ total }} · <kbd>B</kbd> 누르고 있으면 편집 전</template>
        </span>
        <span class="themes" role="group" aria-label="판 모양">
          <button type="button" :aria-pressed="(theme ?? 'plan') === 'plan'" title="도면 — 무채색 가는 선 (T)" @click="(theme ?? 'plan') !== 'plan' && emit('theme')">도면</button>
          <button type="button" :aria-pressed="theme === 'show'" title="중계 — 갈래 색과 빛 (T)" @click="theme !== 'show' && emit('theme')">중계</button>
        </span>
        <button type="button" class="help-btn" title="단축키 (?)" @click="help = !help">?</button>
        <button
          type="button"
          :class="['rec', { on: recording != null }]"
          :title="recording != null ? '녹화 멈추고 내려받기 (R)' : '처음부터 끝 화면까지 녹화해 webm 으로 내려받기 (R) — 브라우저가 이 탭을 공유할지 묻습니다'"
          @click="emit('record')"
        >
          <template v-if="recording != null">■ {{ Math.floor(recSec / 60) }}:{{ two(recSec % 60) }}</template>
          <template v-else>● 녹화</template>
        </button>
        <button type="button" class="close" title="닫기 (Esc 는 한 번 묻는다) — 남은 편집을 다시 해서 원래 상태로" @click="emit('close')">✕ 닫기</button>
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
  /* 도면 톤: 무채색 판과 가는 선. 색은 갈래 표시(작은 네모)와 더함·지움 글자에만 쓴다. */
  --mint: #7bd88f;
  --pink: #f07178;
  --chg: #e5c07b;
  --ink: #e8ebef;
  --sub: #9aa3ae;
  --mute: #6b7480;
  --panel: #0c0f13;
  --card: #11151b;
  --line: #262d36;
  --line-2: #3a424d;
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

/* 갈래 표시: CAD 레이어 색처럼 글 앞의 작은 네모 하나. 판 테두리·배경은 갈래 색을 쓰지 않는다. */
.bug-cat::before,
.card .cat::before,
.scene-kicker span::before,
.tt-cat::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 7px;
  background: var(--c);
  vertical-align: 0;
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
  border: 1px solid var(--line-2);
  background: rgba(8, 10, 13, 0.86);
  color: var(--ink);
  font-size: 13px;
}
.compare b {
  font-size: 12px;
  font-weight: 600;
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
  border: 1px solid var(--line);
  /* 밝은 3D(밤 다이오라마의 방 불빛) 위에서도 읽히게 반투명 검은 판을 깐다. */
  background: rgba(8, 10, 13, 0.78);
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
  background: var(--ink);
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

/* 가는 무채색 테두리의 칸들. 갈래는 글 앞 네모로만. */
.bug > span {
  display: flex;
  align-items: center;
  padding: 0 12px;
  border: 1px solid var(--line-2);
  background: rgba(8, 10, 13, 0.86);
  color: var(--ink);
}
.bug-replay {
  color: var(--sub) !important;
  font-size: 12px;
  font-weight: 500;
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
  font-size: 13px;
}
/* 층은 갈래가 아니라 자리라서 갈래 색을 쓰지 않는다. */
.bug-storey {
  gap: 8px;
  font-size: 13px;
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
  color: var(--sub);
  font-size: 15px;
  font-weight: 500;
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
  color: var(--sub);
  font-size: 17px;
  font-weight: 400;
  animation: kicker-in 400ms 500ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
.op-sub b {
  color: var(--ink);
  font-weight: 600;
}
.op-sub i {
  margin: 0 6px;
  font-style: normal;
  opacity: 0.5;
}

/* --- 끝 통계 타일 --- */
/* 도면 표제란처럼 한 틀을 가는 선으로 칸 나눈다. */
.rp-stats {
  position: absolute;
  top: 18px;
  right: calc(var(--feed) + 18px);
  display: flex;
  border: 1px solid var(--line-2);
  background: rgba(8, 10, 13, 0.88);
}
.stat {
  display: grid;
  align-content: start;
  gap: 4px;
  box-sizing: border-box;
  width: 132px;
  padding: 10px 16px 12px;
  animation: tile 520ms cubic-bezier(0.2, 0.9, 0.35, 1) both;
}
.stat + .stat {
  border-left: 1px solid var(--line-2);
}
.stat-n {
  font-size: 40px;
  font-weight: 300;
  line-height: 1;
}
.stat > span {
  color: var(--sub);
  font-size: 12px;
}
/* 장면마다 얼마나 바뀌었나(스파크라인). 도면에서는 회색 가는 막대. */
.spark {
  display: block;
  width: 100%;
  height: 16px;
  margin-top: 4px;
}
.spark rect {
  fill: #5b6573;
  transform-origin: 50% 100%;
  transform-box: fill-box;
  animation: spark-up 500ms cubic-bezier(0.2, 0.9, 0.3, 1) both;
}
@keyframes spark-up {
  from {
    transform: scaleY(0);
  }
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
  border-left: 1px solid var(--line-2);
  background: var(--panel);
}
.geo-wait,
.log-wait {
  display: grid;
  align-content: start;
  gap: 9px;
  padding: 14px 14px;
  border: 1px dashed var(--line-2);
  color: var(--mute);
  font-size: 12px;
}
.geo-wait {
  box-sizing: border-box;
  height: 100%;
}
.geo-wait p,
.log-wait p {
  margin: 6px 0 0;
  line-height: 1.5;
}
.wait-tag {
  justify-self: start;
  padding: 2px 7px;
  border: 1px solid var(--line-2);
  color: var(--sub);
  font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
/* 자리 표시 막대(뼈대). */
.sk {
  display: block;
  height: 8px;
  background: rgba(255, 255, 255, 0.06);
}
.sk.w40 {
  width: 40%;
}
.sk.w50 {
  width: 50%;
}
.sk.w60 {
  width: 60%;
}
.sk.w70 {
  width: 70%;
}
.sk.w85 {
  width: 85%;
}
.hud-geo {
  flex: none;
  height: var(--geo-h);
  padding: 12px 12px 0;
}
.log-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 12px 12px 0;
  padding: 6px 2px 8px;
  border-bottom: 1px solid var(--line-2);
  color: var(--sub);
  font-size: 13px;
  font-weight: 500;
}
.log-head b {
  color: var(--ink);
  font-size: 15px;
  font-weight: 500;
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
  border: 1px dashed var(--line-2);
  font-size: 14px;
  font-weight: 500;
}
.next-tag {
  display: flex;
  align-items: center;
  padding: 0 10px;
  color: var(--sub);
  font-weight: 500;
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
  color: var(--sub);
  animation: nudge 0.7s ease-in-out infinite;
}
/* 기록판은 도면의 개정 이력표처럼: 번호 | 내용 | 시각. 지금 장면은 펼친 칸, 지난 장면은 한 줄짜리 행. */
.card {
  display: grid;
  grid-template-columns: 44px 1fr;
  flex: none;
  border: 1px solid var(--line-2);
  background: var(--card);
  cursor: pointer;
}
.card:hover {
  border-color: #6b7480;
}
.idx {
  display: grid;
  align-content: start;
  justify-items: center;
  padding-top: 10px;
  border-right: 1px solid var(--line);
  color: var(--sub);
  font-size: 14px;
  font-weight: 500;
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
  color: var(--sub);
  font-weight: 500;
}
.card .time {
  margin-left: auto;
  color: var(--mute);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.card h3 {
  margin: 4px 0 6px;
  overflow: hidden;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 지난 장면은 표의 한 줄: 판 없이 아래 가는 선만. 갈래는 번호 앞 네모. */
.card.old {
  grid-template-columns: 44px 1fr;
  border-color: transparent;
  border-bottom-color: var(--line);
  background: transparent;
}
.card.old:hover {
  background: rgba(255, 255, 255, 0.03);
}
.card.old .idx {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding-top: 0;
  border-right: 0;
  color: var(--mute);
  font-size: 13px;
}
.card.old .idx::before {
  content: '';
  width: 6px;
  height: 6px;
  background: var(--c);
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
  color: #c9ced6;
  font-size: 14px;
  font-weight: 400;
}
/* 아직 다시 하지 않은 장면(카드를 눌러 앞 장면으로 돌아갔을 때 그 뒤). 남기되 지금 모델에는 없다는 것만 보인다. */
.card.ahead {
  opacity: 0.55;
}
/* 반복 중인 장면. 테두리를 밝게 두고, 번호 칸에 반복 표시를 단다. */
.card.looping {
  border-color: var(--ink);
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
  font: 500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--sub);
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
  color: var(--chg);
}
.line {
  overflow: hidden;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  text-overflow: ellipsis;
  animation: type-in 380ms both cubic-bezier(0.2, 0.9, 0.25, 1);
}
.line.subject {
  color: var(--sub);
}
.line.del {
  text-decoration: line-through;
}
/* 형광펜: 글 아래쪽 절반에 옅은 색이 왼쪽에서 오른쪽으로 칠해진다. 도면에서는 옅게. */
.mk {
  padding: 0 2px;
  background: linear-gradient(transparent 58%, color-mix(in srgb, var(--mint) 26%, transparent) 58%) no-repeat 0 0 / 0% 100%;
  animation: marker 650ms cubic-bezier(0.6, 0, 0.2, 1) var(--mk, 700ms) forwards;
}
.line.query .mk {
  background-image: linear-gradient(transparent 58%, rgba(229, 192, 123, 0.24) 58%);
}
@keyframes marker {
  to {
    background-size: 100% 100%;
  }
}
.line.none,
.line.more {
  color: var(--mute);
}

/* --- 끝 --- */
.hud-done {
  /* 끝 화면은 건물 전체에 고친 자리 빛기둥이 서 있다 — 가리지 않게 왼쪽 아래에 둔다. */
  position: absolute;
  left: 18px;
  bottom: 104px;
  width: min(420px, 45%);
  border: 1px solid var(--line-2);
  background: var(--panel);
  pointer-events: auto;
  animation: slam 500ms cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
}
.done-head {
  display: flex;
  justify-content: space-between;
  padding: 9px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--sub);
  font-size: 13px;
}
.done-head b {
  color: var(--ink);
  font-weight: 500;
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
/* 변경 지도 범례. 위 띠 가운데. 색은 replay-viewer.ts 의 DIFF_COLOR 와 같다. */
.diff-legend {
  position: absolute;
  top: 1.6%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid #344560;
  background: rgba(5, 6, 8, 0.72);
  color: #e6ecf5;
  font-size: 13px;
}
.diff-legend b {
  font-size: 12px;
  font-weight: 600;
}
.diff-legend .sw {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  vertical-align: -1px;
}
.sw.add {
  background: #4da3ff;
}
.sw.mod {
  background: #ffb020;
}
.sw.del {
  background: #ff4d5e;
}
/* 카드의 질의 영향 줄. 관계 그림 바로 아래, 줄 글보다 앞. */
.line.query {
  color: #d7c4a3;
  white-space: normal;
}
/* 끝 요약판의 변경 지도·리포트 버튼. */
.hud-done .report.on {
  border-color: var(--ink);
  background: rgba(255, 255, 255, 0.08);
}
.hud-done .report + .report {
  margin-left: 0;
}
.hud-done .report {
  margin: 10px 8px 14px 16px;
  padding: 5px 12px;
  border: 1px solid var(--line-2);
  background: transparent;
  color: var(--ink);
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}
.hud-done .report:hover {
  border-color: #8b939e;
}
/* 요약 재생은 갈래 줄 바로 아래 한 줄을 다 쓴다(다시 보기 방법이라 갈래 거르기 곁에). */
.hud-done .report.highlight {
  display: block;
  margin: 10px 16px 0;
}
.hud-done .report.highlight + .report {
  margin-left: 16px;
}
/* 요약 재생에 든 장면의 눈금은 조금 더 높다. */
.track .tick.star {
  height: calc(18px + 18px * var(--w, 0));
}
/* 눈금 미리보기 판. 눈금 위에 뜬다. */
.tick-tip {
  position: absolute;
  bottom: 26px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 180px;
  max-width: 340px;
  padding: 8px 10px;
  border: 1px solid var(--line-2);
  background: rgba(8, 10, 13, 0.94);
  color: var(--ink);
  font-size: 12px;
  pointer-events: none;
  white-space: nowrap;
}
.tick-tip b {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
}
.tick-tip .tt-cat {
  color: var(--sub);
  font-size: 11px;
}
.tick-tip .tt-n {
  color: #b9bec6;
  font: 400 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
/* 단축키 안내 판. GeoJSON 패널 바로 왼쪽. */
.hud-help {
  position: absolute;
  top: 86px;
  right: calc(var(--feed) + 12px);
  width: 330px;
  padding: 14px 16px;
  border: 1px solid var(--line-2);
  background: rgba(8, 10, 13, 0.94);
  color: #e6ecf5;
  font-size: 12px;
  cursor: pointer;
  z-index: 5;
}
/* 끝 화면은 같은 자리에 통계 타일이 있다 — 그 아래로. */
.hud-help.below {
  top: 222px;
}
.hud-help h4 {
  display: flex;
  justify-content: space-between;
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.hud-help h4 i {
  font-style: normal;
  color: #8b939c;
  letter-spacing: 0;
}
.help-row {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px;
  margin: 5px 0;
  line-height: 1.35;
}
.help-row kbd {
  justify-self: start;
  align-self: start;
  padding: 1px 6px;
  border: 1px solid #4a5568;
  border-radius: 3px;
  background: #11161f;
  color: #e6ecf5;
  font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.hud-help p {
  margin: 10px 0 0;
  color: #b9bec6;
  font-size: 11px;
  line-height: 1.4;
}
.help-enter-active,
.help-leave-active {
  transition: transform 0.22s ease, opacity 0.22s ease;
}
.help-enter-from,
.help-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .help-enter-active,
  .help-leave-active {
    transition: none;
  }
}

/* Esc 닫기 확인. 3D 가운데 위(장면 제목과 겹치지 않게 위쪽). */
.ask-close {
  position: absolute;
  top: 34%;
  left: calc((100% - var(--feed)) / 2);
  transform: translate(-50%, -50%);
  display: grid;
  gap: 8px;
  min-width: 320px;
  padding: 16px 20px;
  border: 1px solid var(--line-2);
  background: rgba(8, 10, 13, 0.96);
  color: #e6ecf5;
  font-size: 13px;
  pointer-events: auto;
  z-index: 6;
}
.ask-close b {
  font-size: 15px;
}
.ask-close span {
  color: #b9bec6;
  font-size: 12px;
}
.ask-buttons {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.ask-buttons button {
  padding: 5px 12px;
  border: 1px solid #344560;
  background: transparent;
  color: #e6ecf5;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.ask-buttons .ask-yes {
  border-color: var(--ink);
  background: var(--ink);
  color: #0c0f13;
}
.ask-buttons kbd {
  margin-left: 4px;
  opacity: 0.7;
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
  background: #8b939e;
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
.themes {
  display: inline-flex;
  flex: none;
  gap: 2px;
}
.themes button[aria-pressed='true'],
.speeds button[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: #0c0f13;
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
  align-items: center;
  height: auto;
  margin-bottom: 10px;
  font-weight: 400;
}
.replay-hud .scene-kicker b,
.replay-hud .scene-kicker span {
  padding: 0 8px;
  background: transparent;
  color: #d7dbe0;
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
  background: rgba(8, 10, 13, 0.88);
  animation: rise-soft 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
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
  .mk {
    animation: none;
    background-size: 100% 100%;
  }
}

/* 반복 중인 카드. 지난 장면 행(.card.old)의 테두리 규칙보다 뒤에 두어 밝은 테두리가 이긴다. */
.replay-hud .card.looping {
  border-color: var(--ink);
}

/* ===== 중계 모양(data-theme='show', T 로 바꾼다) =====
 * 요즘 쇼케이스 화면의 말투를 한데 모은다: 리퀴드 글래스 판(반투명·윗면 하이라이트·뒤 흐림), 테두리를 따라 도는 빛줄기
 * (border beam), 오른쪽 기둥의 흐르는 오로라와 필름 그레인, 흐림에서 또렷해지는 제목, 반짝이며 지나가는 숫자,
 * 빛나는 재생 위치 점. 도면 모양(위)의 규칙을 덮어쓰기만 한다 — 자리·크기는 같아서 이름표 겹침 정리·시간줄 끌기가 같다.
 * 뒤 흐림(backdrop-filter)은 3D 위에 뜨는 작은 판에만 — 오른쪽 기둥은 3D 가 뒤에 없어 흐림 대신 오로라를 깐다. */
@property --beam {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
.replay-hud[data-theme='show'] {
  --g: linear-gradient(90deg, #22d3ee, #7c5cff 50%, #f472b6);
  --glass: rgba(14, 16, 28, 0.58);
  --glass-edge: rgba(255, 255, 255, 0.14);
  --hi: inset 0 1px 0 rgba(255, 255, 255, 0.14);
  --drop: 0 12px 32px rgba(0, 0, 0, 0.38);
  --panel: #07080f;
  --line-2: rgba(255, 255, 255, 0.12);
  --mint: #34f5b0;
  --pink: #ff5c8a;
  --chg: #ffc861;
  --sub: #a9b0c8;
  --grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* --- 유리판: 3D 위에 뜨는 판 --- */
.replay-hud[data-theme='show'] .bug > span,
.replay-hud[data-theme='show'] .rail,
.replay-hud[data-theme='show'] .compare,
.replay-hud[data-theme='show'] .stat,
.replay-hud[data-theme='show'] .hud-done,
.replay-hud[data-theme='show'] .hud-bar,
.replay-hud[data-theme='show'] .tick-tip,
.replay-hud[data-theme='show'] .hud-help,
.replay-hud[data-theme='show'] .ask-close,
.replay-hud[data-theme='show'] .diff-legend {
  border: 1px solid var(--glass-edge);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.015) 40%), var(--glass);
  backdrop-filter: blur(14px) saturate(160%);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
  box-shadow: var(--hi), var(--drop);
}

/* --- 테두리를 도는 빛줄기 --- */
.replay-hud[data-theme='show'] .card:not(.old)::before,
.replay-hud[data-theme='show'] .hud-done::before,
.replay-hud[data-theme='show'] .op-kicker::before {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: conic-gradient(from var(--beam), transparent 0 70%, color-mix(in srgb, var(--beam-c, #7c5cff) 80%, transparent) 82%, #ffffff 86%, transparent 93%);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  animation: beam 4.5s linear infinite;
  pointer-events: none;
}
@keyframes beam {
  to {
    --beam: 360deg;
  }
}

/* --- 갈래 표시: 옅게 물든 알약과 빛나는 점 --- */
.replay-hud[data-theme='show'] .bug-cat::before,
.replay-hud[data-theme='show'] .card .cat::before,
.replay-hud[data-theme='show'] .scene-kicker span::before,
.replay-hud[data-theme='show'] .tt-cat::before,
.replay-hud[data-theme='show'] .card.old .idx::before {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  box-shadow: 0 0 8px var(--c);
}
.replay-hud[data-theme='show'] .card .cat,
.replay-hud[data-theme='show'] .bug .bug-cat {
  padding: 2px 10px;
  border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--c) 16%, transparent);
  color: color-mix(in srgb, var(--c) 60%, #ffffff);
  font-weight: 600;
}

/* --- 왼쪽 위 --- */
.replay-hud[data-theme='show'] .bug > span {
  border-radius: 999px;
  padding: 0 14px;
}
.replay-hud[data-theme='show'] .bug .bug-cat {
  padding: 0 14px;
}
.replay-hud[data-theme='show'] .bug-count b {
  background: var(--g);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 800;
}
.replay-hud[data-theme='show'] .compare {
  border-color: color-mix(in srgb, var(--c) 55%, transparent);
  border-radius: 999px;
}
.replay-hud[data-theme='show'] .rail {
  border-radius: 14px;
}
.replay-hud[data-theme='show'] .rail-row.here::before {
  height: 2px;
  border-radius: 2px;
  background: var(--g);
  box-shadow: 0 0 10px #7c5cff;
}
.replay-hud[data-theme='show'] .rail-dots i.done {
  box-shadow: 0 0 6px var(--c);
}
.replay-hud[data-theme='show'] .impact {
  border: 0;
  background: radial-gradient(ellipse at center, transparent 45%, color-mix(in srgb, var(--c) 30%, transparent));
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--c) 70%, transparent);
}

/* --- 장면 제목: 알약 둘, 흐림에서 또렷해지는 그라데이션 낱말 --- */
.replay-hud[data-theme='show'] .scene-kicker {
  gap: 8px;
}
.replay-hud[data-theme='show'] .scene-kicker b,
.replay-hud[data-theme='show'] .scene-kicker span {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 700;
  text-shadow: none;
}
.replay-hud[data-theme='show'] .scene-kicker b {
  background: linear-gradient(135deg, color-mix(in srgb, var(--c) 70%, #ffffff), var(--c));
  color: #07080f;
  box-shadow: 0 0 18px color-mix(in srgb, var(--c) 55%, transparent);
}
.replay-hud[data-theme='show'] .scene-kicker span {
  border: 1px solid var(--glass-edge);
  background: rgba(14, 16, 28, 0.6);
  backdrop-filter: blur(10px);
  color: #eef0ff;
}
.replay-hud[data-theme='show'] .scene-title {
  font-size: 52px;
  font-weight: 700;
  letter-spacing: -0.025em;
  text-shadow: none;
  filter: drop-shadow(0 0 22px color-mix(in srgb, var(--c) 40%, transparent)) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.8));
}
.replay-hud[data-theme='show'] .wd {
  background: linear-gradient(180deg, #ffffff 40%, color-mix(in srgb, var(--c, #7c5cff) 45%, #ffffff));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: blur-in 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.replay-hud[data-theme='show'] .wd.key {
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 35%, #ffffff), var(--c));
  -webkit-background-clip: text;
  background-clip: text;
  font-weight: 800;
}
@keyframes blur-in {
  from {
    opacity: 0;
    filter: blur(12px);
    transform: translateY(35%);
  }
}

/* --- 오프닝: 오로라가 터지고, 제목이 흐림에서 또렷해지며 빛이 한 번 훑는다 --- */
.replay-hud[data-theme='show'] .hud-rewind.opening::before {
  content: '';
  position: absolute;
  left: 4%;
  top: 50%;
  width: 70%;
  aspect-ratio: 2.2;
  translate: 0 -50%;
  background:
    radial-gradient(closest-side at 30% 50%, rgba(124, 92, 255, 0.45), transparent),
    radial-gradient(closest-side at 65% 40%, rgba(34, 211, 238, 0.35), transparent),
    radial-gradient(closest-side at 55% 70%, rgba(244, 114, 182, 0.3), transparent);
  filter: blur(40px);
  animation: aurora-burst 2.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  pointer-events: none;
}
@keyframes aurora-burst {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
  40% {
    opacity: 1;
  }
}
.replay-hud[data-theme='show'] .op-kicker {
  position: relative;
  padding: 5px 14px;
  border: 1px solid var(--glass-edge);
  border-radius: 999px;
  background: rgba(14, 16, 28, 0.6);
  color: #eef0ff;
  font-size: 13px;
  font-weight: 600;
}
.replay-hud[data-theme='show'] .op-title {
  position: relative;
  font-size: 84px;
  font-weight: 750;
  letter-spacing: -0.035em;
  text-shadow: none;
  filter: drop-shadow(0 0 30px rgba(124, 92, 255, 0.45));
}
.replay-hud[data-theme='show'] .op-title .wd {
  background: linear-gradient(100deg, #ffffff 0%, #ffffff 35%, #c7b8ff 50%, #ffffff 65%, #ffffff 100%) 0 0 / 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation:
    blur-in 1000ms cubic-bezier(0.2, 0.7, 0.2, 1) both,
    shimmer-text 2.2s 600ms ease-in-out both;
}
@keyframes shimmer-text {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0% 0;
  }
}
.replay-hud[data-theme='show'] .op-sub {
  position: relative;
  color: #c9cde0;
}
.replay-hud[data-theme='show'] .op-sub b {
  background: var(--g);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* --- 끝 통계: 벤토 타일, 그라데이션 숫자에 빛이 지나가고 장면마다의 막대 --- */
.replay-hud[data-theme='show'] .rp-stats {
  gap: 10px;
  border: 0;
  background: none;
}
.replay-hud[data-theme='show'] .stat {
  position: relative;
  width: 140px;
  padding: 12px 16px 12px;
  border-radius: 16px;
  overflow: hidden;
}
.replay-hud[data-theme='show'] .stat + .stat {
  border-left: 1px solid var(--glass-edge);
}
.replay-hud[data-theme='show'] .stat::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(90% 70% at 0% 0%, rgba(124, 92, 255, 0.22), transparent 60%);
  pointer-events: none;
}
.replay-hud[data-theme='show'] .stat-n {
  font-size: 50px;
  font-weight: 750;
  letter-spacing: -0.03em;
  background: linear-gradient(100deg, #8be9ff 0%, #a78bfa 40%, #ffffff 50%, #f9a8d4 60%, #f472b6 100%) 0 0 / 250% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: shimmer-text 1.8s 700ms ease-in-out both;
}
.replay-hud[data-theme='show'] .stat > span {
  color: var(--sub);
}
.replay-hud[data-theme='show'] .spark rect {
  fill: #a78bfa;
  opacity: 0.85;
}
.replay-hud[data-theme='show'] .spark rect:nth-child(3n + 1) {
  fill: #22d3ee;
}
.replay-hud[data-theme='show'] .spark rect:nth-child(3n) {
  fill: #f472b6;
}

/* --- 오른쪽 기둥: 흐르는 오로라 + 필름 그레인 --- */
.replay-hud[data-theme='show'] .rp-side {
  overflow: hidden;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  background: var(--panel);
}
.replay-hud[data-theme='show'] .rp-side::before {
  content: '';
  position: absolute;
  inset: -25%;
  background:
    radial-gradient(38% 28% at 22% 12%, rgba(124, 92, 255, 0.32), transparent 70%),
    radial-gradient(34% 26% at 82% 38%, rgba(34, 211, 238, 0.22), transparent 70%),
    radial-gradient(40% 30% at 38% 88%, rgba(244, 114, 182, 0.2), transparent 70%);
  /* 흐림 필터도 움직임도 주지 않는다 — 흐림을 건 판을 움직이면 3D 를 그리는 프레임마다 다시 합성해서 무거웠다(Institute 2×
     프레임 중앙값: 흐리고 움직이면 183ms, 움직이기만 133ms, 멈추면 117ms, 도면 100ms — GPU 없는 시험 환경). 둥근 그라데이션의
     끝을 넉넉히(70%) 옅게 해 흐린 것처럼 보인다. */
  pointer-events: none;
}
.replay-hud[data-theme='show'] .rp-side::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--grain);
  opacity: 0.07;
  mix-blend-mode: overlay;
  pointer-events: none;
}
.replay-hud[data-theme='show'] .rp-side > * {
  position: relative;
  z-index: 1;
}
.replay-hud[data-theme='show'] .log-head {
  padding: 8px 4px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.replay-hud[data-theme='show'] .log-head > span {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--g);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 700;
}
/* 생방송 표시처럼 숨 쉬는 점. */
.replay-hud[data-theme='show'] .log-head > span::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #34f5b0;
  box-shadow: 0 0 0 0 rgba(52, 245, 176, 0.6);
  animation: live 1.6s ease-out infinite;
}
@keyframes live {
  to {
    box-shadow: 0 0 0 8px rgba(52, 245, 176, 0);
  }
}
.replay-hud[data-theme='show'] .log-head b {
  padding: 2px 10px;
  border: 1px solid var(--glass-edge);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
/* 다음 장면: 유리 알약 위로 빛이 계속 훑는다(불러오는 중처럼). */
.replay-hud[data-theme='show'] .next {
  border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  border-radius: 999px;
  background:
    linear-gradient(110deg, transparent 30%, rgba(255, 255, 255, 0.1) 50%, transparent 70%) 0 0 / 220% 100%,
    color-mix(in srgb, var(--c) 10%, rgba(14, 16, 28, 0.7));
  animation: sweep 1.8s linear infinite;
  overflow: hidden;
}
@keyframes sweep {
  from {
    background-position: 120% 0, 0 0;
  }
  to {
    background-position: -120% 0, 0 0;
  }
}
.replay-hud[data-theme='show'] .next-tag {
  padding-left: 14px;
  color: color-mix(in srgb, var(--c) 60%, #ffffff);
  font-weight: 600;
}
.replay-hud[data-theme='show'] .next-arrow {
  color: var(--c);
}

/* --- 기록 카드: 유리 카드, 갈래 색이 왼쪽 위에서 번지고 테두리를 빛이 돈다 --- */
.replay-hud[data-theme='show'] .card {
  --beam-c: var(--c);
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background:
    radial-gradient(110% 90% at 0% 0%, color-mix(in srgb, var(--c) 24%, transparent), transparent 62%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.01)),
    rgba(14, 16, 28, 0.72);
  box-shadow: var(--hi), 0 10px 28px rgba(0, 0, 0, 0.35);
}
.replay-hud[data-theme='show'] .card:not(.old)::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, 0.16) 50%, transparent 65%);
  transform: translateX(-110%);
  animation: shine 1200ms 250ms cubic-bezier(0.3, 0.6, 0.2, 1) both;
  pointer-events: none;
}
@keyframes shine {
  to {
    transform: translateX(110%);
  }
}
.replay-hud[data-theme='show'] .idx {
  border-right: 0;
  background: linear-gradient(180deg, #ffffff, color-mix(in srgb, var(--c) 70%, #ffffff));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.replay-hud[data-theme='show'] .card h3 {
  font-weight: 700;
  letter-spacing: -0.01em;
}
.replay-hud[data-theme='show'] .card .time {
  color: #7d84a0;
}
.replay-hud[data-theme='show'] .card.old {
  margin-top: 2px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  box-shadow: none;
}
.replay-hud[data-theme='show'] .card.old:hover {
  background: rgba(255, 255, 255, 0.06);
}
.replay-hud[data-theme='show'] .card.old .idx {
  background: none;
  color: color-mix(in srgb, var(--c) 65%, #ffffff);
  font-size: 13px;
  font-weight: 600;
}
.replay-hud[data-theme='show'] .card.old h3 {
  color: #e6e8f5;
  font-weight: 500;
}
.replay-hud[data-theme='show'] .card.looping {
  border-color: color-mix(in srgb, var(--c) 70%, #ffffff);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--c) 50%, transparent), 0 0 24px color-mix(in srgb, var(--c) 35%, transparent);
}
.replay-hud[data-theme='show'] .line.query {
  color: #ffd9a8;
}
/* GeoJSON 판(자식 부품): 둥근 판, 갈래 색으로 물드는 테두리, 옅게 물든 꼬리표. */
.replay-hud[data-theme='show'] :deep(.replay-geo) {
  border: 1px solid transparent;
  border-radius: 14px;
  background:
    radial-gradient(90% 60% at 100% 0%, color-mix(in srgb, var(--c) 14%, transparent), transparent 60%) padding-box,
    linear-gradient(rgba(14, 16, 28, 0.78), rgba(14, 16, 28, 0.78)) padding-box,
    linear-gradient(135deg, color-mix(in srgb, var(--c) 80%, transparent), rgba(255, 255, 255, 0.1) 45%, rgba(255, 255, 255, 0.04)) border-box;
  box-shadow: var(--hi), 0 10px 28px rgba(0, 0, 0, 0.35);
}
.replay-hud[data-theme='show'] :deep(.geo-tag) {
  border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--c) 16%, transparent);
  color: color-mix(in srgb, var(--c) 60%, #ffffff);
  font-weight: 600;
}
.replay-hud[data-theme='show'] :deep(.geo-tag)::before {
  border-radius: 50%;
  box-shadow: 0 0 8px var(--c);
}

/* --- 끝 요약 --- */
.replay-hud[data-theme='show'] .hud-done {
  border-radius: 18px;
}
.replay-hud[data-theme='show'] .done-head {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.replay-hud[data-theme='show'] .done-head span {
  background: var(--g);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-weight: 700;
}
.replay-hud[data-theme='show'] .done-head b {
  padding: 1px 10px;
  border: 1px solid var(--glass-edge);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
}
.replay-hud[data-theme='show'] .hud-done h2 {
  font-weight: 750;
  letter-spacing: -0.02em;
}
.replay-hud[data-theme='show'] .sum-row i {
  height: 7px;
  border-radius: 999px;
  background-image: linear-gradient(90deg, color-mix(in srgb, var(--bc) 60%, transparent), var(--bc)) !important;
  box-shadow: 0 0 12px color-mix(in srgb, var(--bc) 55%, transparent);
}
.replay-hud[data-theme='show'] button.sum-row:hover,
.replay-hud[data-theme='show'] button.sum-row.on {
  border-radius: 8px;
}
.replay-hud[data-theme='show'] .hud-done .report {
  border-color: var(--glass-edge);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}
.replay-hud[data-theme='show'] .hud-done .report:hover {
  background: rgba(255, 255, 255, 0.09);
}
.replay-hud[data-theme='show'] .hud-done .report.on {
  border-color: transparent;
  background: var(--g);
  color: #07080f;
  font-weight: 700;
  box-shadow: 0 0 20px rgba(124, 92, 255, 0.45);
}

/* --- 조작 막대: 유리 판, 빛나는 채움과 재생 위치 점 --- */
.replay-hud[data-theme='show'] .hud-bar {
  border-radius: 18px;
}
.replay-hud[data-theme='show'] .track {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}
.replay-hud[data-theme='show'] .track .fill {
  border-radius: 999px;
  background: var(--g);
  box-shadow: 0 0 14px rgba(124, 92, 255, 0.75);
}
.replay-hud[data-theme='show'] .track .fill::after {
  content: '';
  position: absolute;
  right: -6px;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  translate: 0 -50%;
  background: #ffffff;
  box-shadow: 0 0 0 4px rgba(244, 114, 182, 0.35), 0 0 16px #f472b6;
}
.replay-hud[data-theme='show'] .track .tick {
  border-radius: 2px;
}
.replay-hud[data-theme='show'] .buttons button {
  border-color: var(--glass-edge);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}
.replay-hud[data-theme='show'] .buttons button:hover {
  background: rgba(255, 255, 255, 0.1);
}
.replay-hud[data-theme='show'] .buttons .play,
.replay-hud[data-theme='show'] .speeds button[aria-pressed='true'],
.replay-hud[data-theme='show'] .themes button[aria-pressed='true'] {
  border-color: transparent;
  background: var(--g);
  color: #07080f;
  font-weight: 700;
  box-shadow: var(--hi), 0 0 18px rgba(124, 92, 255, 0.5);
}
.replay-hud[data-theme='show'] .status kbd {
  border-radius: 4px;
}
.replay-hud[data-theme='show'] .tick-tip,
.replay-hud[data-theme='show'] .hud-help,
.replay-hud[data-theme='show'] .ask-close,
.replay-hud[data-theme='show'] .diff-legend {
  border-radius: 14px;
}
.replay-hud[data-theme='show'] .diff-legend {
  border-radius: 999px;
}
.replay-hud[data-theme='show'] .tick-tip .tt-cat {
  color: color-mix(in srgb, var(--c) 60%, #ffffff);
}
.replay-hud[data-theme='show'] .help-row kbd {
  border-color: var(--glass-edge);
  background: rgba(255, 255, 255, 0.06);
}
.replay-hud[data-theme='show'] .ask-buttons button {
  border-radius: 999px;
}
.replay-hud[data-theme='show'] .ask-buttons .ask-yes {
  border-color: transparent;
  background: var(--g);
  color: #07080f;
}
/* --- 장면 색 오라: 3D 화면 아래 가장자리가 지금 장면의 갈래 색으로 물들고, 장면이 바뀌면 색이 천천히 넘어간다 ---
 * 움직이지 않는 덧칠이라 장면이 바뀔 때만 다시 칠한다(@property 로 색을 등록해 transition 이 먹는다). */
@property --scene-c {
  syntax: '<color>';
  inherits: true;
  initial-value: #7c5cff;
}
.replay-hud[data-theme='show'] {
  transition: --scene-c 900ms ease;
}
.replay-hud[data-theme='show']::before {
  content: '';
  position: absolute;
  inset: 0 var(--feed) 0 0;
  background:
    radial-gradient(120% 70% at 50% 115%, color-mix(in srgb, var(--scene-c) 26%, transparent), transparent 60%),
    radial-gradient(60% 50% at 0% 0%, rgba(124, 92, 255, 0.1), transparent 70%);
  pointer-events: none;
}
/* 새 카드는 흐림에서 또렷해지며 들어온다. */
.replay-hud[data-theme='show'] .card-enter-from {
  filter: blur(10px);
}
.replay-hud[data-theme='show'] .card-enter-active {
  transition:
    opacity 450ms,
    transform 450ms cubic-bezier(0.2, 0.9, 0.25, 1.1),
    filter 450ms ease;
}

/* --- 첫 장면 전 자리 표시: 유리 판 위로 빛이 훑는 뼈대 --- */
.replay-hud[data-theme='show'] .geo-wait,
.replay-hud[data-theme='show'] .log-wait {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background: rgba(14, 16, 28, 0.55);
  color: #8f96b2;
}
.replay-hud[data-theme='show'] .wait-tag {
  border-color: rgba(167, 139, 250, 0.4);
  border-radius: 999px;
  color: #c4b5fd;
}
.replay-hud[data-theme='show'] .sk {
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.05) 30%, rgba(167, 139, 250, 0.28) 50%, rgba(255, 255, 255, 0.05) 70%) 0 0 / 300% 100%;
  animation: skeleton 1.6s linear infinite;
}
@keyframes skeleton {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0% 0;
  }
}

/* --- 관계 그림(자식 부품): 둥근 알약 마디, 그라데이션처럼 빛나는 새 관계 선 --- */
.replay-hud[data-theme='show'] :deep(.rels) {
  font-family: system-ui, sans-serif;
}
.replay-hud[data-theme='show'] :deep(.rels .node) {
  rx: 9px;
  fill: rgba(255, 255, 255, 0.05);
  stroke: rgba(255, 255, 255, 0.18);
}
.replay-hud[data-theme='show'] :deep(.rels .node.subj) {
  fill: color-mix(in srgb, var(--c) 18%, transparent);
  stroke: color-mix(in srgb, var(--c) 60%, transparent);
}
.replay-hud[data-theme='show'] :deep(.rels .came .edge) {
  stroke: #34f5b0;
  stroke-width: 2;
  filter: drop-shadow(0 0 3px rgba(52, 245, 176, 0.8));
}
.replay-hud[data-theme='show'] :deep(.rels .came .node) {
  fill: rgba(52, 245, 176, 0.12);
  stroke: #34f5b0;
}
.replay-hud[data-theme='show'] :deep(.rels .gone .edge),
.replay-hud[data-theme='show'] :deep(.rels .gone .node) {
  stroke: #ff5c8a;
}
.replay-hud[data-theme='show'] :deep(.rels .pred) {
  fill: #a9b0c8;
}

/* --- 층이 바뀔 때: 검게 잠기는 대신 빛 띠가 위에서 아래로 훑는다(스캔) --- */
.replay-hud[data-theme='show'] .swipe {
  background:
    linear-gradient(180deg, transparent 0%, rgba(124, 92, 255, 0.18) 42%, rgba(255, 255, 255, 0.75) 50%, rgba(34, 211, 238, 0.18) 58%, transparent 100%) 0 -40% / 100% 30% no-repeat,
    rgba(7, 8, 15, 0.35);
  animation: scan 900ms cubic-bezier(0.5, 0, 0.3, 1) forwards;
}
@keyframes scan {
  0% {
    opacity: 0;
    background-position: 0 -40%, 0 0;
  }
  15% {
    opacity: 1;
  }
  85% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    background-position: 0 140%, 0 0;
  }
}

/* --- 끝 요약 제목 --- */
.replay-hud[data-theme='show'] .hud-done h2 {
  justify-self: start;
  background: linear-gradient(180deg, #ffffff 40%, #c4b5fd);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.replay-hud[data-theme='show'] .mk {
  border-radius: 3px;
  background-image: linear-gradient(90deg, rgba(52, 245, 176, 0.32), rgba(34, 211, 238, 0.32));
}
.replay-hud[data-theme='show'] .line.query .mk {
  background-image: linear-gradient(90deg, rgba(255, 200, 97, 0.32), rgba(244, 114, 182, 0.3));
}
@media (prefers-reduced-motion: reduce) {
  .replay-hud[data-theme='show'] .card::before,
  .replay-hud[data-theme='show'] .card::after,
  .replay-hud[data-theme='show'] .hud-done::before,
  .replay-hud[data-theme='show'] .op-kicker::before,
  .replay-hud[data-theme='show'] .next,
  .replay-hud[data-theme='show'] .log-head > span::before,
  .replay-hud[data-theme='show'] .hud-rewind.opening::before,
  .replay-hud[data-theme='show'] .stat-n,
  .replay-hud[data-theme='show'] .sk,
  .replay-hud[data-theme='show'] .swipe,
  .replay-hud[data-theme='show'] .wd,
  .replay-hud[data-theme='show'] .op-title .wd {
    animation: none !important;
  }
}
</style>
