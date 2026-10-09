<script setup lang="ts">
// 편집 리플레이(PoC)의 3D 위 표시. 움직임은 3D 가 한다(App.vue 가 되돌리기로 되감고 다시 하기로 하나씩 다시 한다) —
// 여기는 지금 몇 번째인지, 그 편집이 TTL·GeoJSON 의 어디를 바꿨는지를 채팅처럼 카드로 쌓고, 조작 막대를 둔다.
// 카드 내용은 워커가 모델 사본으로 계산한 것이다(lib/replay.ts).
import { computed, ref, watch } from 'vue'
import { escapeLocalName } from '../lib/export/ttl'
import ReplayGeo from './ReplayGeo.vue'
import Roll from './Roll.vue'
import { CATEGORIES, CATEGORY_COLOR, type Category, type PlanItem, type ReplayStart, type ReplayStep } from '../lib/replay'

const props = defineProps<{
  title: string
  total: number
  /** 다시 한 편집 수(= 지금 이력 길이). 카드는 이만큼 쌓인다. */
  at: number
  phase: 'rewind' | 'play' | 'done'
  playing: boolean
  speed: number
  /** 다음 편집으로 카메라가 가는 중이면 그 번호. 채팅의 "입력 중" 처럼 다음 카드 자리를 미리 띄운다. */
  aiming: number | null
  start: ReplayStart | null
  steps: readonly ReplayStep[]
  error: string
}>()
const emit = defineEmits<{ toggle: []; prev: []; next: []; restart: []; speed: [number]; close: []; scene: [number] }>()

const CAT_COLOR = CATEGORY_COLOR

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
  // 되감는 동안은 비운다 — 한 장씩 빠지는 것보다 처음부터 다시 쌓이는 것이 보여야 한다.
  if (props.phase === 'rewind') return []
  const shown = props.steps.slice(0, props.at).slice(-5).reverse()
  return shown.map((s, i) => ({ step: s, rows: rows(s), old: i > 0 }))
})
const upcoming = computed(() => (props.aiming !== null && props.aiming >= props.at ? (props.steps[props.aiming] ?? null) : null))
const current = computed(() => upcoming.value ?? props.steps[props.at - 1] ?? null)
const counter = computed(() => String(Math.min(props.total, props.aiming !== null ? props.aiming + 1 : props.at)).padStart(2, '0'))

/** GeoJSON 패널의 장면. 카메라가 가는 중이면 그 장면의 지금 파일을, 다시 했으면 바뀐 파일을 보인다. */
const geoStep = computed(() => (props.phase === 'rewind' ? null : (upcoming.value ?? props.steps[props.at - 1] ?? null)))
const geoApplied = computed(() => !!geoStep.value && props.at > geoStep.value.index)

/** 장면 제목. 카메라가 가는 중(aiming)부터 그 장면의 것이다. */
const scene = computed(() => (props.phase === 'play' ? current.value : null))
/** 키네틱 캡션: 장면 제목을 낱말로 나눠 차례로 튀어 오르게 한다. 숫자·# 이 든 낱말(설비 번호, 면적)은 갈래 색으로 짚는다. */
const words = (label: string) => label.split(/\s+/).filter(Boolean).map((w) => ({ w, key: /[#\d]/.test(w) }))
/** 오프닝: 열고 되감기 전(아직 한 단계도 되돌리지 않았다). 건물 이름과 편집 수를 크게. */
const opening = computed(() => props.phase === 'rewind' && props.at === props.total)
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

/**
 * 연출 스타일. 장면 구성과 갈래 색(무엇을 고쳤나)은 같고, 판·글꼴·전환·배경만 바뀐다. 고른 것은 이 브라우저에만 남긴다
 * (보는 사람마다의 취향이라 모델·편집 파일과 상관없다).
 */
const STYLES = [
  { id: 'broadcast', label: '중계' },
  { id: 'cinema', label: '시네마' },
  { id: 'neon', label: '네온' },
  { id: 'swiss', label: '스위스' },
] as const
type StyleId = (typeof STYLES)[number]['id']
const STYLE_KEY = 'oe-replay-style'
function readStyle(): StyleId {
  try {
    const v = localStorage.getItem(STYLE_KEY)
    return STYLES.find((x) => x.id === v)?.id ?? 'broadcast'
  } catch {
    return 'broadcast'
  }
}
const style = ref<StyleId>(readStyle())
function pickStyle(id: StyleId) {
  style.value = id
  try {
    localStorage.setItem(STYLE_KEY, id)
  } catch {
    // 저장소가 막혀 있으면 이번 리플레이에서만 쓴다.
  }
}

/** 다시 한 순간의 번쩍임. at 이 늘 때마다 한 번. */
const impact = ref(0)
watch(
  () => props.at,
  (at, before) => {
    if (props.phase !== 'rewind' && at > before) impact.value++
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
  <div class="replay-hud" :data-phase="phase" :data-at="at" :data-total="total" :data-ready="steps.length" :data-style="style">
    <!-- 시네마: 위아래 검은 띠 -->
    <template v-if="style === 'cinema'"><div class="lb top"></div><div class="lb bottom"></div></template>
    <!-- 다시 한 순간 -->
    <div v-if="impact" :key="impact" class="impact" :style="{ '--c': current ? CAT_COLOR[current.category] : '#5ef2c2' }"></div>

    <!-- 왼쪽 위: 중계 화면의 리플레이 표시 -->
    <div class="bug" :style="{ '--c': current ? CAT_COLOR[current.category] : '#5ef2c2' }">
      <span class="bug-replay">▶ REPLAY</span>
      <span v-if="phase !== 'rewind'" class="bug-count">
        <transition name="roll" mode="out-in"><b :key="counter">{{ counter }}</b></transition>
        <i>/{{ two(total) }}</i>
      </span>
      <transition name="chip" mode="out-in">
        <span v-if="current && phase !== 'rewind'" :key="current.index" class="bug-cat">{{ current.category }}</span>
      </transition>
    </div>
    <div class="bug-file">{{ title }}</div>

    <!-- 장면 전환: 기하 도형 띠 셋이 비스듬히 화면을 쓸고 지나간다(카메라가 다음 자리로 떠나는 순간) -->
    <div v-if="scene" :key="`sw${scene.index}`" class="swipe" :style="{ '--c': CAT_COLOR[scene.category] }"><i></i><i></i><i></i></div>

    <!-- 장면 제목: 판이 펼쳐지고 낱말이 차례로 튀어 오른다(키네틱 캡션) -->
    <transition name="scene">
      <div v-if="scene" :key="scene.index" class="scene" :style="{ '--c': CAT_COLOR[scene.category] }">
        <div class="scene-kicker"><b>{{ two(scene.index + 1) }}</b><span>{{ scene.category }}</span></div>
        <div class="scene-title">
          <span v-for="(t, i) in words(scene.label)" :key="i" :class="['wd', { key: t.key }]" :style="{ animationDelay: `${380 + i * 70}ms` }">{{ t.w }}</span>
        </div>
      </div>
    </transition>

    <!-- 되감기 -->
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
      <div v-else-if="phase === 'rewind'" class="hud-rewind">
        <div class="streaks"><i v-for="n in 7" :key="n" :style="{ top: `${8 + n * 12}%`, animationDelay: `${(n * 137) % 600}ms` }"></i></div>
        <div class="rw-title"><span class="rw-icon">◀◀</span> REWIND</div>
        <div class="rw-sub">처음 상태로 되감는 중 · {{ total - at }} / {{ total }}</div>
      </div>
    </transition>

    <!-- 오른쪽 기둥 -->
    <aside class="rp-side">
      <div class="hud-geo">
        <ReplayGeo v-if="geoStep" :key="`${geoStep.index}:${geoApplied}`" :step="geoStep" :applied="geoApplied" :color="CAT_COLOR[geoStep.category]" />
      </div>
      <div class="log-head">
        <span>TTL 변경 기록</span>
        <b>{{ two(at) }}<i>/{{ two(total) }}</i></b>
      </div>
      <div class="log">
        <transition name="next">
          <div v-if="upcoming" :key="`up${upcoming.index}`" class="next" :style="{ '--c': CAT_COLOR[upcoming.category] }">
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
            :class="{ old: c.old }"
            :style="{ '--c': CAT_COLOR[c.step.category] }"
            title="이 장면만 다시 보기"
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
                <template v-if="c.rows.length">
                  <div v-for="(r, i) in c.rows.slice(0, ROWS)" :key="i" :class="['line', r.kind]" :style="{ animationDelay: `${250 + i * 70}ms` }">
                    {{ r.kind === 'add' ? '+ ' : r.kind === 'del' ? '− ' : '▸ ' }}{{ r.text }}
                  </div>
                  <div v-if="c.rows.length > ROWS" class="line more">… 외 {{ c.rows.length - ROWS }}줄</div>
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
        <div v-for="b in summary.bars" :key="b.c" class="sum-row">
          <span>{{ b.c }}</span>
          <i :style="{ width: `${b.w}%`, background: CAT_COLOR[b.c] }"></i>
          <b>{{ b.n }}</b>
        </div>
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
      <div class="track">
        <i class="fill" :style="{ width: `${(100 * at) / Math.max(1, total)}%` }"></i>
        <i
          v-for="k in total"
          :key="k"
          class="tick"
          :class="{ done: k <= at }"
          :title="steps[k - 1] ? `#${two(k)} ${steps[k - 1].label} — 이 장면만 다시 보기` : undefined"
          :style="{ left: `${(100 * (k - 0.5)) / total}%`, background: steps[k - 1] ? CAT_COLOR[steps[k - 1].category] : undefined }"
          @click="emit('scene', k - 1)"
        ></i>
      </div>
      <div class="buttons">
        <button type="button" title="처음부터 (Home)" @click="emit('restart')">⏮</button>
        <button type="button" title="이전 편집 (←)" @click="emit('prev')">◀</button>
        <button type="button" class="play" :title="playing ? '멈춤 (Space)' : '재생 (Space)'" @click="emit('toggle')">{{ playing ? '❚❚' : '▶' }}</button>
        <button type="button" title="다음 편집 (→)" @click="emit('next')">▶▶</button>
        <span class="styles" title="연출 스타일 — 이 브라우저에 기억한다">
          <button v-for="st in STYLES" :key="st.id" type="button" :aria-pressed="style === st.id" :data-style-id="st.id" @click="pickStyle(st.id)">{{ st.label }}</button>
        </span>
        <span class="speeds">
          <button v-for="s in [0.5, 1, 2]" :key="s" type="button" :aria-pressed="speed === s" @click="emit('speed', s)">{{ s }}×</button>
        </span>
        <span class="status">
          {{ phase === 'rewind' ? '되감는 중' : phase === 'done' ? '끝' : playing ? '재생 중' : '멈춤' }} · 편집 {{ at }}/{{ total }}
        </span>
        <button type="button" class="close" title="닫기 (Esc · P) — 남은 편집을 다시 해서 원래 상태로" @click="emit('close')">✕ 닫기</button>
      </div>
    </div>
  </div>
</template>

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
  top: 18px;
  left: 18px;
  display: flex;
  align-items: stretch;
  height: 40px;
  font-weight: 900;
}
.bug > span {
  display: flex;
  align-items: center;
  padding: 0 16px;
  clip-path: polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%);
  margin-right: -6px;
}
.bug-replay {
  padding-left: 14px !important;
  background: #fff;
  color: #05080d;
  font-size: 17px;
  font-style: italic;
  letter-spacing: 0.04em;
  clip-path: polygon(0 0, 100% 0, calc(100% - 10px) 100%, 0 100%) !important;
}
.bug-count {
  gap: 2px;
  background: var(--c);
  color: #05080d;
  font-size: 24px;
}
.bug-count b {
  display: inline-block;
}
.bug-count i {
  font-size: 14px;
  font-style: normal;
  opacity: 0.7;
}
.bug-cat {
  background: #05080d;
  color: var(--c);
  font-size: 14px;
  letter-spacing: 0.04em;
}
.bug-file {
  position: absolute;
  top: 64px;
  left: 20px;
  max-width: calc(100% - var(--feed) - 60px);
  overflow: hidden;
  color: #c9d6ea;
  font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  text-overflow: ellipsis;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.9);
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

/* --- 장면 전환 띠 --- */
.swipe {
  position: absolute;
  inset: 0 var(--feed) 0 0;
  overflow: hidden;
  pointer-events: none;
}
.swipe i {
  position: absolute;
  top: -10%;
  bottom: -10%;
  left: -60%;
  width: 34%;
  transform: skewX(-16deg);
  will-change: left;
  animation: swipe 720ms cubic-bezier(0.7, 0, 0.25, 1) forwards;
}
.swipe i:nth-child(1) {
  background: var(--c);
}
.swipe i:nth-child(2) {
  width: 9%;
  background: #fff;
  animation-delay: 70ms;
}
.swipe i:nth-child(3) {
  width: 20%;
  background: #05080d;
  animation-delay: 130ms;
}

/* --- 오프닝 --- */
.opening {
  justify-items: start;
  padding-left: 8%;
  text-align: left;
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

/* --- 되감기 --- */
.hud-rewind {
  position: absolute;
  inset: 0 var(--feed) 0 0;
  display: grid;
  place-content: center;
  overflow: hidden;
  text-align: center;
}
.streaks i {
  position: absolute;
  right: -40%;
  width: 40%;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--mint), #fff);
  animation: streak 700ms linear infinite;
}
.rw-title {
  font-size: 84px;
  font-style: italic;
  font-weight: 900;
  letter-spacing: 0.02em;
  text-shadow:
    0 0 30px rgba(94, 242, 194, 0.6),
    0 6px 0 #05080d;
  animation: slam 500ms cubic-bezier(0.2, 0.9, 0.25, 1.3) both;
}
.rw-icon {
  color: var(--mint);
  animation: blink 0.6s infinite;
}
.rw-sub {
  justify-self: center;
  margin-top: 14px;
  padding: 6px 14px;
  background: #fff;
  color: #05080d;
  font-size: 16px;
  font-weight: 800;
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
.track .tick {
  position: absolute;
  top: -5px;
  width: 4px;
  height: 16px;
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
.buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
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
@keyframes wipe {
  0% {
    transform: scaleX(0);
    transform-origin: left;
  }
  45% {
    transform: scaleX(1);
    transform-origin: left;
  }
  55% {
    transform: scaleX(1);
    transform-origin: right;
  }
  100% {
    transform: scaleX(0);
    transform-origin: right;
  }
}
/* ===== 연출 스타일 ===== 기본(중계)은 위의 규칙이다. 아래는 스타일마다 덮어쓰는 것만. */
.styles {
  display: inline-flex;
  gap: 2px;
  margin-left: 6px;
}
.styles button[aria-pressed='true'] {
  border-color: #fff;
  background: #fff;
  color: #05080d;
}

/* --- 시네마: 위아래 띠, 가늘고 큰 자막, 검게 잠겼다 밝아지는 전환 --- */
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
[data-style='cinema'] {
  --panel: #07080a;
  --line: #24262b;
}
[data-style='cinema'] .bug {
  top: 2.2%;
  height: 32px;
}
[data-style='cinema'] .bug > span,
[data-style='cinema'] .bug-replay {
  margin-right: 14px;
  padding: 0 !important;
  background: transparent !important;
  color: #e9e9e9;
  font-size: 13px;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0.35em;
  clip-path: none !important;
}
[data-style='cinema'] .bug-count {
  font-size: 18px !important;
}
[data-style='cinema'] .bug-cat {
  color: var(--c) !important;
}
[data-style='cinema'] .bug-file {
  display: none;
}
[data-style='cinema'] .scene {
  left: calc((100% - var(--feed)) / 2);
  bottom: calc(8% + 88px);
  max-width: calc(100% - var(--feed) - 80px);
  text-align: center;
  translate: -50% 0;
}
[data-style='cinema'] .scene-kicker {
  justify-content: center;
  height: auto;
  margin-bottom: 10px;
  font-weight: 400;
  letter-spacing: 0.4em;
}
[data-style='cinema'] .scene-kicker b,
[data-style='cinema'] .scene-kicker span {
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
[data-style='cinema'] .scene-title {
  border: 0;
  background: transparent;
  font-size: 42px;
  font-weight: 300;
  letter-spacing: 0.01em;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.9);
  animation: none;
}
[data-style='cinema'] .wd {
  animation: rise-soft 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
[data-style='cinema'] .wd.key {
  color: #fff;
  font-weight: 600;
}
[data-style='cinema'] .swipe i {
  display: none;
}
[data-style='cinema'] .swipe {
  background: #000;
  animation: dip 900ms ease-in-out forwards;
}
[data-style='cinema'] .impact {
  border: 0;
  background: rgba(255, 255, 255, 0.12);
}
[data-style='cinema'] .log-head {
  border-bottom: 1px solid #3a3d44;
  background: transparent;
  color: #e9e9e9;
  font-weight: 500;
  letter-spacing: 0.2em;
}
[data-style='cinema'] .card {
  background: #0d0e11;
}
[data-style='cinema'] .idx {
  background: transparent !important;
  color: var(--c) !important;
  font-weight: 400;
}
[data-style='cinema'] .card h3 {
  font-weight: 500;
}
[data-style='cinema'] .hud-bar {
  bottom: 1.2%;
  border-color: #24262b;
}
[data-style='cinema'] .rp-stats .stat {
  border-top: 1px solid #fff;
}
[data-style='cinema'] .stat-n {
  font-weight: 200;
}
[data-style='cinema'] .op-title {
  font-weight: 200;
  text-shadow: none;
}

/* --- 네온: 보라 바탕, 자홍·하늘 테두리 빛, 기운 굵은 글씨 --- */
[data-style='neon'] {
  --panel: #0f0522;
  --line: #3b1d6e;
  --mint: #22e1ff;
  --pink: #ff3dcd;
}
[data-style='neon'] .bug > span {
  margin-right: 8px;
  border: 2px solid var(--c);
  background: rgba(15, 5, 34, 0.85) !important;
  color: #fff;
  clip-path: none !important;
  box-shadow:
    0 0 10px var(--c),
    inset 0 0 6px var(--c);
  text-shadow: 0 0 8px var(--c);
}
[data-style='neon'] .bug-replay {
  --c: #ff3dcd;
}
[data-style='neon'] .scene-kicker b {
  border: 2px solid var(--c);
  background: transparent;
  color: var(--c);
  box-shadow: 0 0 10px var(--c);
}
[data-style='neon'] .scene-kicker span {
  background: #ff3dcd;
  color: #fff;
}
[data-style='neon'] .scene-title {
  border-left-color: var(--c);
  background: rgba(15, 5, 34, 0.92);
  font-style: italic;
  box-shadow:
    0 0 0 2px var(--c),
    0 0 22px var(--c);
}
[data-style='neon'] .wd.key {
  text-shadow: 0 0 12px var(--c);
}
[data-style='neon'] .swipe i:nth-child(1) {
  background: linear-gradient(90deg, #ff3dcd, #22e1ff);
}
[data-style='neon'] .swipe i:nth-child(3) {
  background: #0f0522;
}
[data-style='neon'] .log-head {
  background: linear-gradient(90deg, #ff3dcd, #22e1ff);
  color: #fff;
}
[data-style='neon'] .card {
  border-color: #3b1d6e;
  background: #170a33;
}
[data-style='neon'] .card:hover {
  box-shadow: 0 0 12px var(--c);
}
[data-style='neon'] .idx {
  box-shadow: 0 0 14px var(--c);
}
[data-style='neon'] .card.old {
  background: #12072a;
}
[data-style='neon'] .buttons .play {
  border-color: #ff3dcd;
  background: #ff3dcd;
  color: #fff;
}
[data-style='neon'] .rw-title {
  text-shadow:
    0 0 24px #ff3dcd,
    0 6px 0 #0f0522;
}
[data-style='neon'] .stat {
  border-top-color: #ff3dcd;
  box-shadow: 0 0 16px rgba(255, 61, 205, 0.5);
}
[data-style='neon'] :deep(.replay-geo) {
  border-color: #3b1d6e;
  background: #170a33;
}
[data-style='neon'] :deep(.replay-geo .code),
[data-style='neon'] :deep(.replay-geo .map) {
  background-color: #0f0522;
}

/* --- 스위스(바우하우스): 종이색 판, 검은 글씨, 빨간 점, 원이 퍼지는 전환 --- */
[data-style='swiss'] {
  --panel: #f3efe6;
  --line: #111;
  --mint: #e63b2e;
  --pink: #e63b2e;
}
[data-style='swiss'] .bug > span {
  margin-right: 0;
  clip-path: none !important;
}
[data-style='swiss'] .bug-replay {
  background: #e63b2e !important;
  color: #fff;
  font-style: normal;
}
[data-style='swiss'] .bug-replay::before {
  content: '';
  width: 12px;
  height: 12px;
  margin-right: 8px;
  border-radius: 50%;
  background: #f3efe6;
}
[data-style='swiss'] .bug-count {
  background: #f3efe6;
  color: #111;
}
[data-style='swiss'] .bug-cat {
  background: #111;
  color: #f3efe6;
}
[data-style='swiss'] .scene-kicker b {
  background: #111;
  color: #f3efe6;
}
[data-style='swiss'] .scene-kicker span {
  background: var(--c);
  color: #111;
  clip-path: none;
}
[data-style='swiss'] .scene-title {
  border-left: 12px solid #e63b2e;
  background: #f3efe6;
  color: #111;
  letter-spacing: -0.02em;
}
[data-style='swiss'] .wd.key {
  color: #e63b2e;
}
[data-style='swiss'] .swipe i {
  display: none;
}
[data-style='swiss'] .swipe::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 20px;
  height: 20px;
  margin: -10px 0 0 -10px;
  border-radius: 50%;
  background: #e63b2e;
  animation: iris 800ms cubic-bezier(0.7, 0, 0.25, 1) forwards;
}
[data-style='swiss'] .impact {
  border-color: #e63b2e;
  background: none;
}
[data-style='swiss'] .rp-side {
  border-left: 4px solid #111;
  color: #111;
}
[data-style='swiss'] .log-head {
  background: #111;
  color: #f3efe6;
}
[data-style='swiss'] .card {
  border: 2px solid #111;
  background: #fff;
  color: #111;
}
/* 갈래 색 글씨는 종이 바탕에서 묻힌다(노랑·하늘). 색 칩으로 바꾼다. */
[data-style='swiss'] .card .cat,
[data-style='swiss'] :deep(.replay-geo .feature .kind) {
  padding: 1px 6px;
  background: var(--c);
  color: #111;
}
[data-style='swiss'] .ttl-head .chg {
  color: #8a5a00;
}
[data-style='swiss'] .card.old {
  background: #ece7dc;
}
[data-style='swiss'] .card.old h3 {
  color: #222;
}
[data-style='swiss'] .card.old .idx {
  background: #111;
  color: #f3efe6;
}
[data-style='swiss'] .card .time,
[data-style='swiss'] .ttl-head,
[data-style='swiss'] .line.subject,
[data-style='swiss'] .line.none,
[data-style='swiss'] .line.more {
  color: #555;
}
[data-style='swiss'] .line.add,
[data-style='swiss'] .ttl-head .add {
  color: #1a7f37;
}
[data-style='swiss'] .line.del,
[data-style='swiss'] .ttl-head .del {
  color: #c62828;
}
[data-style='swiss'] .next {
  border-color: #111;
  color: #111;
}
[data-style='swiss'] .next-tag {
  background: #111;
  color: #fff;
}
[data-style='swiss'] .hud-bar {
  border: 2px solid #111;
  color: #111;
}
[data-style='swiss'] .buttons button {
  border-color: #111;
}
[data-style='swiss'] .buttons .play,
[data-style='swiss'] .styles button[aria-pressed='true'] {
  border-color: #e63b2e;
  background: #e63b2e;
  color: #fff;
}
[data-style='swiss'] .speeds button[aria-pressed='true'] {
  border-color: #111;
  background: #111;
  color: #fff;
}
[data-style='swiss'] .status {
  color: #333;
}
[data-style='swiss'] .track {
  background: #d6d0c4;
}
[data-style='swiss'] .hud-done {
  border: 3px solid #111;
  color: #111;
}
[data-style='swiss'] .done-head {
  background: #111;
  color: #f3efe6;
}
[data-style='swiss'] .stat {
  border-top-color: #e63b2e;
  background: #f3efe6;
  color: #111;
}
[data-style='swiss'] .stat > span {
  color: #555;
}
[data-style='swiss'] .rw-sub,
[data-style='swiss'] .op-kicker {
  background: #e63b2e;
  color: #fff;
}
[data-style='swiss'] .op-sub {
  border-left-color: #111;
  background: #f3efe6;
  color: #111;
}
[data-style='swiss'] :deep(.replay-geo) {
  border: 2px solid #111;
  border-top: 6px solid var(--c);
  background: #fff;
  color: #111;
}
[data-style='swiss'] :deep(.replay-geo .file),
[data-style='swiss'] :deep(.replay-geo .feature .name) {
  color: #111;
}
[data-style='swiss'] :deep(.replay-geo .code) {
  background: #f7f4ee;
}
[data-style='swiss'] :deep(.replay-geo .k) {
  color: #1f4fd1;
}
[data-style='swiss'] :deep(.replay-geo .s) {
  color: #a45a00;
}
[data-style='swiss'] :deep(.replay-geo .n) {
  color: #0b7a52;
}
[data-style='swiss'] :deep(.replay-geo .p),
[data-style='swiss'] :deep(.replay-geo .others),
[data-style='swiss'] :deep(.replay-geo .status) {
  color: #555;
}
[data-style='swiss'] :deep(.replay-geo .n.hot) {
  color: #111;
  text-shadow: none;
}
[data-style='swiss'] :deep(.replay-geo .dv) {
  background: #111;
  color: #ffd166;
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
@keyframes iris {
  0% {
    transform: scale(0);
    opacity: 1;
  }
  55% {
    transform: scale(140);
    opacity: 1;
  }
  100% {
    transform: scale(140);
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
@keyframes swipe {
  to {
    left: 130%;
  }
}
@keyframes tile {
  from {
    opacity: 0;
    transform: translateY(-24px) scale(0.9);
  }
}
@keyframes reveal {
  0%,
  49% {
    opacity: 0;
  }
  50%,
  100% {
    opacity: 1;
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
@keyframes streak {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-380%);
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
@keyframes blink {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
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
  .rw-title,
  .rw-icon,
  .streaks i,
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
  .streaks,
  .swipe {
    display: none;
  }
  .wd {
    animation: none !important;
  }
}
</style>
