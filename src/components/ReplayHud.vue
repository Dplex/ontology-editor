<script setup lang="ts">
// 편집 리플레이(PoC)의 3D 위 표시. 움직임은 3D 가 한다(App.vue 가 되돌리기로 되감고 다시 하기로 하나씩 다시 한다) —
// 여기는 지금 몇 번째인지, 그 편집이 TTL·GeoJSON 의 어디를 바꿨는지를 채팅처럼 카드로 쌓고, 조작 막대를 둔다.
// 카드 내용은 워커가 모델 사본으로 계산한 것이다(lib/replay.ts).
import { computed, ref, watch } from 'vue'
import { escapeLocalName } from '../lib/export/ttl'
import ReplayGeo from './ReplayGeo.vue'
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
const two = (n: number) => String(n).padStart(2, '0')

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
  <div class="replay-hud" :data-phase="phase" :data-at="at" :data-total="total" :data-ready="steps.length">
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

    <!-- 장면 제목: 갈래 색 블록이 쓸고 지나가며 드러난다 -->
    <transition name="scene">
      <div v-if="scene" :key="scene.index" class="scene" :style="{ '--c': CAT_COLOR[scene.category] }">
        <div class="scene-kicker"><b>{{ two(scene.index + 1) }}</b><span>{{ scene.category }}</span></div>
        <div class="scene-title"><span>{{ scene.label }}</span></div>
      </div>
    </transition>

    <!-- 되감기 -->
    <transition name="fade">
      <div v-if="phase === 'rewind'" class="hud-rewind">
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
  filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.45));
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
  position: absolute;
  inset: 0 var(--feed) 0 0;
  border: 4px solid var(--c);
  box-shadow: inset 0 0 120px color-mix(in srgb, var(--c) 45%, transparent);
  animation: impact 650ms ease-out both;
}

/* --- 장면 제목 --- */
.scene {
  position: absolute;
  left: 18px;
  bottom: 104px;
  max-width: calc(100% - var(--feed) - 60px);
  filter: drop-shadow(0 8px 24px rgba(0, 0, 0, 0.5));
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
.scene-title span {
  display: block;
  padding: 8px 18px 10px 14px;
  font-size: 34px;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: -0.01em;
  animation: reveal 800ms both;
}
.scene-title::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--c);
  animation: wipe 800ms cubic-bezier(0.7, 0, 0.2, 1) both;
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
  .scene-title::after,
  .impact,
  .next-arrow,
  .hud-done {
    animation: none;
  }
  .impact,
  .streaks {
    display: none;
  }
}
</style>
