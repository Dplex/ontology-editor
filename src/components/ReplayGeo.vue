<script setup lang="ts">
// 편집 리플레이(PoC)의 GeoJSON 패널. 그 장면이 층 파일(floor-*.geojson)의 어느 feature 를 어떻게 바꿨는지를, 작은 평면(그
// 자리의 물리존·벽·설비 점)과 그 feature 의 JSON 으로 보인다. 다시 하기 전(카메라가 가는 중)에는 지금 파일 그대로를, 다시 한
// 순간부터 1.1초 동안(3D 의 미끄러짐과 같은 시간) 점이 옮겨 가고 다각형이 새 모양으로 바뀌며 JSON 의 숫자가 굴러 바뀐다.
// 내용은 워커가 내보내기와 같은 함수로 만든 feature 다(lib/replay-geo.ts).
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Geometry } from '../lib/export/geojson'
import type { GeoLine } from '../lib/replay-geo'
import type { ReplayStep } from '../lib/replay'
import { still } from '../lib/motion'

const props = defineProps<{ step: ReplayStep; applied: boolean; color: string }>()
const MORPH_MS = 1100
const geo = computed(() => props.step.geojson)
const main = computed(() => geo.value?.features[0] ?? null)

// --- 진행(0 → 1). 다시 한 장면만 움직인다. ---
const k = ref(0)
let raf = 0
onMounted(() => {
  if (!props.applied) return
  if (still()) {
    k.value = 1
    return
  }
  let t0: number | null = null
  const frame = (now: number) => {
    if (t0 === null) t0 = now
    const x = Math.min(1, (now - t0) / MORPH_MS)
    k.value = x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2
    if (x < 1) raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

// --- 평면 ---
const view = computed(() => geo.value?.map?.view ?? [0, 0, 1, 1])
/** SVG 는 y 가 아래로 자란다. IFC 평면은 위로 — 뒤집어 그린다(평면도와 같은 방위). */
const sx = (x: number) => x - view.value[0]
const sy = (y: number) => view.value[3] - y
const viewBox = computed(() => `0 0 ${view.value[2] - view.value[0]} ${view.value[3] - view.value[1]}`)
const unit = computed(() => (view.value[2] - view.value[0]) / 300)
const poly = (ring: number[][]) => ring.map(([x, y]) => `${sx(x).toFixed(2)},${sy(y).toFixed(2)}`).join(' ')

const ringOf = (g: Geometry | null): number[][] | null => {
  if (!g || g.type === 'Point') return null
  const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]
  // 닫는 점(처음과 같은 끝)은 뺀다.
  const last = ring[ring.length - 1]
  return ring.length > 1 && last[0] === ring[0][0] && last[1] === ring[0][1] ? ring.slice(0, -1) : ring
}
const pointOf = (g: Geometry | null) => (g?.type === 'Point' ? g.coordinates : null)
const key = (p: number[]) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`

/**
 * 두 외곽선의 꼭짓점을 짝짓는다(같은 점끼리 LCS). 짝 없는 옛 꼭짓점은 새 외곽선의 이웃 꼭짓점으로 빨려 들어가고, 새 꼭짓점은
 * 옛 이웃에서 솟는다 — 꼭짓점을 지우거나 더한 편집도 모양이 이어지며 바뀐다.
 */
function align(a: number[][], b: number[][]): [number[][], number[][]] {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const from: number[][] = []
  const to: number[][] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && key(a[i]) === key(b[j])) {
      from.push(a[i++])
      to.push(b[j++])
    } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) {
      from.push(a[i++])
      to.push(b[Math.min(j, m - 1)] ?? a[i - 1])
    } else {
      from.push(a[Math.max(0, i - 1)] ?? b[j])
      to.push(b[j++])
    }
  }
  return [from, to]
}
const shape = computed(() => {
  const f = main.value
  if (!f) return null
  const before = ringOf(f.before)
  const after = ringOf(f.after)
  if (before && after) {
    const [from, to] = align(before, after)
    return { kind: 'ring' as const, before, from, to }
  }
  if (before || after) return { kind: 'ring' as const, before: before ?? [], from: before ?? after!, to: after ?? before!, only: after ? 'add' : 'del' }
  const pb = pointOf(f.before)
  const pa = pointOf(f.after)
  return pb || pa ? { kind: 'point' as const, before: pb, after: pa } : null
})
const t = computed(() => (props.applied ? k.value : 0))
const lerp = (a: number[], b: number[], x: number) => [a[0] + (b[0] - a[0]) * x, a[1] + (b[1] - a[1]) * x]
const morph = computed(() => {
  const s = shape.value
  if (!s || s.kind !== 'ring') return ''
  return poly(s.from.map((p, i) => lerp(p, s.to[i], t.value)))
})
const dot = computed(() => {
  const s = shape.value
  if (!s || s.kind !== 'point') return null
  const a = s.before ?? s.after!
  const b = s.after ?? s.before!
  return { at: lerp(a, b, t.value), from: a, moved: !!(s.before && s.after) }
})

// --- JSON ---
type Token = { text: string; cls: string; from?: number; to?: number; digits?: number }
/** chg: 숫자만 바뀐 줄. old 는 옛 줄의 낱말(바뀐 숫자는 hot), deltas 는 바뀐 숫자마다 "옛 값 → 새 값 (차이)". */
type Row = { kind: GeoLine['kind'] | 'chg'; tokens: Token[]; old?: Token[]; deltas?: string[] }
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([^"\d-]+|.)/g
function tokens(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(TOKEN)) {
    if (m[1]) {
      out.push({ text: m[1], cls: m[2] ? 'k' : 's' })
      if (m[2]) out.push({ text: m[2], cls: 'p' })
    } else if (m[3]) out.push({ text: m[3], cls: 'n' })
    else if (m[4]) out.push({ text: m[4], cls: 'b' })
    else out.push({ text: m[0], cls: 'p' })
  }
  return out
}
const shapeOf = (text: string) => text.replace(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g, '#')
/** 지운 줄 다음에 같은 모양의 더한 줄이 오면 한 줄로 합쳐, 바뀐 숫자만 굴린다. */
const rows = computed((): Row[] => {
  const lines = main.value?.lines ?? []
  const out: Row[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (l.kind === 'del') {
      let d = i
      while (d < lines.length && lines[d].kind === 'del') d++
      let a = d
      while (a < lines.length && lines[a].kind === 'add') a++
      const dels = lines.slice(i, d)
      const adds = lines.slice(d, a)
      if (dels.length === adds.length && dels.every((x, n) => shapeOf(x.text) === shapeOf(adds[n].text))) {
        dels.forEach((x, n) => {
          const before = tokens(x.text)
          const after = tokens(adds[n].text)
          const hot = (q: number) => after[q].cls === 'n' && before[q]?.text !== after[q].text
          const deltas: string[] = []
          after.forEach((tk, q) => {
            if (!hot(q)) return
            const a = Number(before[q].text)
            const b = Number(tk.text)
            const digits = Math.max(2, (before[q].text.split('.')[1] ?? '').length, (tk.text.split('.')[1] ?? '').length)
            const d = b - a
            deltas.push(`${before[q].text} → ${tk.text} (${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d).toFixed(Math.min(digits, 3))})`)
          })
          out.push({
            kind: 'chg',
            old: before.map((tk, q) => (hot(q) ? { ...tk, cls: 'n was' } : tk)),
            tokens: after.map((tk, q) => (hot(q) ? { ...tk, cls: 'n hot', from: Number(before[q].text), to: Number(tk.text), digits: (tk.text.split('.')[1] ?? '').length } : tk)),
            deltas,
          })
        })
        i = a - 1
        continue
      }
    }
    out.push({ kind: l.kind, tokens: tokens(l.text) })
  }
  return out
})
/**
 * 다시 한 순간: 먼저 새 내용(새로 생긴 줄·바뀐 줄의 새 값)이 위에서부터 차례로 나온다 — 연두 망점 빛 띠가 줄을 훑고 지나가고
 * 그 뒤를 따라 글자가 커서와 함께 한 자씩 쳐진다(After Effects 의 레이어 이름 고치기 같은 느낌). 그동안은 diff 색·표시 없이 담담하게.
 * 다 쳐지면 diff 가 들어온다: 지운 줄·옛 줄(−)이 끼어들고, 줄 색·+/− 표시가 물들고, "옛 값 → 새 값" 줄이 같은 효과로 나온다.
 */
const FX_START_MS = 200
/** 줄 사이 간격. 줄이 많으면(feature 를 통째로 더함) 좁혀서 마지막 줄이 FX_LAST_MS 안에 나오게 한다 — 장면이 넘어가기 전에 diff 까지 보이게. */
const FX_STEP_MS = 220
const FX_LAST_MS = 1200
/** 띠가 지나간 뒤 글자가 쳐지기 시작하기까지, 한 자의 시간, 한 줄이 쳐지는 시간의 상한(자). 아래 CSS 와 같은 값이다. */
const TYPE_AFTER_MS = 160
const CHAR_MS = 14
const CHAR_CAP = 60
const chars = (tks: Token[]) => tks.reduce((k, tk) => k + tk.text.length, 0)
const fx = computed(() => {
  const count = rows.value.filter((r) => r.kind === 'add' || r.kind === 'chg').length
  const step = Math.min(FX_STEP_MS, FX_LAST_MS / Math.max(1, count - 1))
  let n = 0
  return rows.value.map((r) => ({
    main: r.kind === 'add' || r.kind === 'chg' ? { '--d': `${Math.round(FX_START_MS + n++ * step)}ms`, '--n': chars(r.tokens) } : null,
    // diff 와 함께 나온다(그 줄이 그려지는 때부터 잰다).
    delta: r.kind === 'chg' && r.deltas?.length ? { '--d': '120ms', '--n': r.deltas.reduce((k, d) => k + d.length + 3, 0) } : null,
  }))
})
/** 새 내용이 다 쳐지는 때(ms). */
const typedAt = computed(() =>
  fx.value.reduce((end, f) => (f.main ? Math.max(end, parseInt(f.main['--d']) + TYPE_AFTER_MS + Math.min(f.main['--n'], CHAR_CAP) * CHAR_MS) : end), 0),
)
/** diff 를 보이나. 다시 하기 전(지금 파일 그대로)은 늘, 다시 한 뒤에는 새 내용이 다 쳐진 다음부터. */
const diff = ref(!props.applied)
let diffTimer = 0
onMounted(() => {
  if (!props.applied) return
  if (still()) diff.value = true
  else diffTimer = window.setTimeout(() => (diff.value = true), typedAt.value + 150)
})
onBeforeUnmount(() => window.clearTimeout(diffTimer))
const shown = (tk: Token) =>
  tk.from === undefined ? tk.text : (props.applied ? tk.from + (tk.to! - tk.from) * k.value : tk.from).toFixed(tk.digits)

// 처음 바뀌는 줄이 보이게 내린다.
const code = ref<HTMLElement | null>(null)
onMounted(async () => {
  await nextTick()
  const el = code.value
  const hit = el?.querySelector<HTMLElement>('.jl.chg, .jl.was, .jl.del, .jl.add')
  if (el && hit) el.scrollTop = Math.max(0, hit.offsetTop - el.clientHeight * 0.3)
})

const KIND: Record<string, string> = { space: '물리존', equipment: '설비', wall: '벽', door: '문', window: '창', customZone: '커스텀존', hvacZone: '공조존' }
const others = computed(() => {
  const g = geo.value
  if (!g) return ''
  const n = g.count.changed + g.count.added + g.count.removed
  return n > 1 ? `이 밖에 feature ${n - 1}개 더 바뀜` : ''
})
</script>

<template>
  <section class="replay-geo" :class="{ applied, typing: applied && !diff }" :style="{ '--c': color }">
    <header>
      <span class="geo-tag">GeoJSON</span>
      <b class="file">{{ geo?.file ?? '—' }}</b>
      <span v-if="geo" class="counts">
        <i class="chg">~{{ geo.count.changed }}</i> <i class="add">+{{ geo.count.added }}</i> <i class="del">−{{ geo.count.removed }}</i>
      </span>
    </header>
    <template v-if="geo && main">
      <svg v-if="geo.map" class="map" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
        <polygon v-for="(r, i) in geo.map.walls" :key="`w${i}`" class="wall" :points="poly(r)" />
        <polygon v-for="(r, i) in geo.map.spaces" :key="`s${i}`" class="space" :points="poly(r)" :stroke-width="unit" />
        <circle v-for="(p, i) in geo.map.points" :key="`p${i}`" class="pt" :cx="sx(p[0])" :cy="sy(p[1])" :r="unit * 1.6" />
        <template v-for="(mv, i) in geo.map.moves" :key="`m${i}`">
          <line v-if="applied" class="trail minor" :x1="sx(mv[0][0])" :y1="sy(mv[0][1])" :x2="sx(lerp(mv[0], mv[1], k)[0])" :y2="sy(lerp(mv[0], mv[1], k)[1])" :stroke-width="unit * 0.9" />
          <circle class="follow" :cx="sx(lerp(mv[0], mv[1], t)[0])" :cy="sy(lerp(mv[0], mv[1], t)[1])" :r="unit * 2.2" />
        </template>
        <template v-if="shape?.kind === 'ring'">
          <polygon v-if="shape.before.length && applied" class="ghost" :points="poly(shape.before)" :stroke-width="unit * 1.2" :stroke-dasharray="`${unit * 4} ${unit * 3}`" />
          <polygon class="main" :points="morph" :stroke-width="unit * 2.2" />
        </template>
        <template v-if="dot">
          <template v-if="dot.moved && applied">
            <circle class="ghost" :cx="sx(dot.from[0])" :cy="sy(dot.from[1])" :r="unit * 5" :stroke-width="unit" :stroke-dasharray="`${unit * 3} ${unit * 2}`" />
            <line class="trail" :x1="sx(dot.from[0])" :y1="sy(dot.from[1])" :x2="sx(dot.at[0])" :y2="sy(dot.at[1])" :stroke-width="unit * 1.6" />
          </template>
          <circle class="halo" :cx="sx(dot.at[0])" :cy="sy(dot.at[1])" :r="unit * (applied ? 6 + 10 * k : 7)" :stroke-width="unit * 0.8" :opacity="applied ? 1 - k * 0.7 : 0.5" />
          <circle class="main" :cx="sx(dot.at[0])" :cy="sy(dot.at[1])" :r="unit * 4" />
        </template>
      </svg>
      <div class="feature">
        <span class="kind">{{ KIND[main.kind] ?? main.kind }}</span>
        <span class="name">{{ main.name }}</span>
        <span class="status">{{ main.status === 'added' ? '추가' : main.status === 'removed' ? '삭제' : '수정' }}</span>
      </div>
      <div ref="code" class="code">
        <template v-for="(r, i) in rows" :key="i">
          <!-- 숫자만 바뀐 줄: 다시 하기 전에는 지금 줄을 짚고, 다시 하면 옛 줄(−)·새 줄(+, 숫자가 굴러간다)·옛 값 → 새 값 을 잇달아 -->
          <div v-if="r.kind === 'chg' && diff" :class="['jl', applied ? 'was' : 'chg', { 'diff-in': applied }]">
            <span class="gut">{{ applied ? '−' : '~' }}</span>
            <span class="txt"><span v-for="(tk, q) in r.old" :key="q" :class="tk.cls">{{ tk.text }}</span></span>
          </div>
          <div
            v-if="(r.kind !== 'chg' || applied) && (r.kind !== 'del' || diff)"
            :class="['jl', r.kind, { fx: applied && fx[i].main, 'diff-in': applied && r.kind === 'del' }]"
            :style="applied ? (fx[i].main ?? undefined) : undefined"
          >
            <span class="gut">{{ r.kind === 'add' || r.kind === 'chg' ? '+' : r.kind === 'del' ? '−' : '' }}</span>
            <span class="txt">
              <template v-if="r.kind === 'gap'"><span class="p">⋯</span></template>
              <template v-else>
                <span v-for="(tk, q) in r.tokens" :key="q" :class="tk.cls">{{ shown(tk) }}</span>
              </template>
            </span>
          </div>
          <div v-if="r.kind === 'chg' && applied && diff && r.deltas?.length" class="jl delta fx" :style="fx[i].delta ?? undefined">
            <span class="gut">↳</span>
            <span class="txt"><span v-for="(d, q) in r.deltas" :key="q" class="dv">{{ d }}</span></span>
          </div>
        </template>
      </div>
      <div v-if="others" class="others">{{ others }}<template v-if="geo.features.length > 1"> — {{ geo.features.slice(1).map((f) => f.name).join(', ') }} …</template></div>
    </template>
    <div v-else class="none">
      <span class="brace">{ }</span>
      <b>GeoJSON 변화 없음 — 층 파일 그대로</b>
      이 편집은 TTL 에만 남는다 — 연결·흐름 방향·계통 관계는 GeoJSON 에 없다.
    </div>
  </section>
</template>

<style scoped>
.replay-geo {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 10px 12px;
  border: 1px solid #3a424d;
  background: #11151b;
  animation: geo-in 450ms cubic-bezier(0.2, 0.9, 0.25, 1.1) both;
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.geo-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border: 1px solid #3a424d;
  color: #c9ced6;
  font-weight: 500;
}
/* 갈래 표시: 작은 네모 하나(기록판·장면 제목과 같다). */
.geo-tag::before {
  content: '';
  width: 7px;
  height: 7px;
  background: var(--c);
}
.file {
  overflow: hidden;
  color: #e9f1ff;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.counts {
  margin-left: auto;
  white-space: nowrap;
}
.counts i {
  font-style: normal;
}
.chg {
  color: #e5c07b;
}
.add {
  color: #7bd88f;
}
.del {
  color: #f07178;
}
.map {
  flex: none;
  width: 100%;
  height: clamp(90px, 17vh, 180px);
  margin: 10px 0 8px;
  background:
    linear-gradient(rgba(120, 160, 220, 0.06) 1px, transparent 1px) 0 0 / 16px 16px,
    linear-gradient(90deg, rgba(120, 160, 220, 0.06) 1px, transparent 1px) 0 0 / 16px 16px,
    #070c15;
}
.map .wall {
  fill: rgba(170, 190, 220, 0.28);
}
.map .space {
  fill: rgba(120, 160, 220, 0.05);
  stroke: rgba(160, 190, 230, 0.35);
}
.map .pt {
  fill: rgba(170, 200, 240, 0.4);
}
.map .ghost {
  fill: none;
  stroke: rgba(255, 255, 255, 0.55);
}
.map polygon.main {
  fill: color-mix(in srgb, var(--c) 28%, transparent);
  stroke: var(--c);
}
.map circle.main {
  fill: var(--c);
}
.map .halo {
  fill: none;
  stroke: var(--c);
}
.map .follow {
  fill: color-mix(in srgb, var(--c) 70%, white);
  opacity: 0.85;
}
.map .trail.minor {
  opacity: 0.45;
}
.map .trail {
  stroke: var(--c);
  stroke-linecap: round;
  opacity: 0.8;
}
.feature {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}
.feature .kind {
  color: var(--c);
  font-weight: 700;
}
.feature .name {
  overflow: hidden;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.feature .status {
  margin-left: auto;
  color: rgba(200, 215, 240, 0.6);
  font-size: 12px;
}
.code {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 6px 0;
  background: #070b13;
  font: 11.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
  scroll-behavior: smooth;
  mask-image: linear-gradient(to bottom, transparent 0, #000 12%, #000 88%, transparent 100%);
}
.jl {
  display: flex;
  white-space: nowrap;
}
.txt > span {
  white-space: pre;
}
.gut {
  flex: none;
  width: 18px;
  text-align: center;
  color: rgba(200, 215, 240, 0.4);
}
.txt {
  overflow: hidden;
  text-overflow: ellipsis;
}
.jl.same {
  opacity: 0.55;
}
.jl.gap {
  opacity: 0.35;
}
/* 다시 하기 전에는 곧 바뀔 줄을 살짝 짚는다. */
.jl.chg,
.jl.del {
  background: rgba(229, 192, 123, 0.08);
}
.replay-geo:not(.applied) .jl.add {
  display: none;
}
.jl.was {
  background: rgba(240, 113, 120, 0.1);
  box-shadow: none;
}
.jl.was .gut {
  color: #f07178;
}
.jl.was .txt {
  opacity: 0.8;
}
.n.was {
  color: #ff8fb0;
  font-weight: 700;
  text-decoration: line-through;
  text-decoration-color: rgba(240, 113, 120, 0.8);
}
.jl.delta .gut {
  color: #e5c07b;
}
.dv {
  margin-right: 10px;
  padding: 0 6px;
  background: rgba(229, 192, 123, 0.14);
  color: #e5c07b;
  font-weight: 700;
}
.applied .jl.chg {
  background: rgba(229, 192, 123, 0.16);
  box-shadow: none;
  animation: row-flash 1.2s ease-out both;
}
.applied .jl.chg .gut {
  color: #e5c07b;
}
.applied .jl.del {
  background: rgba(240, 113, 120, 0.12);
  box-shadow: none;
}
.applied .jl.del .txt {
  text-decoration: line-through;
  text-decoration-color: rgba(240, 113, 120, 0.7);
  opacity: 0.75;
}
.applied .jl.del .gut {
  color: #f07178;
}
.applied .jl.add {
  background: rgba(123, 216, 143, 0.12);
  box-shadow: none;
}
.applied .jl.add .gut {
  color: #7bd88f;
}
.k {
  color: #8ab4ff;
}
.s {
  color: #f6c48f;
}
.n {
  color: #7bd88f;
}
.b {
  color: #ef8fd0;
}
.p {
  color: rgba(200, 215, 240, 0.6);
}
.n.hot {
  color: #fff;
  font-weight: 700;
  text-shadow: 0 0 8px #e5c07b;
}
.others {
  margin-top: 6px;
  overflow: hidden;
  color: rgba(200, 215, 240, 0.6);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.none {
  display: grid;
  gap: 6px;
  place-content: center;
  flex: 1;
  color: rgba(200, 215, 240, 0.65);
  font-size: 13px;
  text-align: center;
}
.none .brace {
  color: color-mix(in srgb, var(--c) 45%, transparent);
  font: 300 64px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  animation: geo-in 600ms 150ms both;
}
.none b {
  color: #e9f1ff;
  font-size: 15px;
}
/* --- 쳐지는 동안은 diff 색·표시 없이. 다 쳐지면 물든다(transition) --- */
.jl {
  transition:
    background-color 450ms ease,
    box-shadow 450ms ease;
}
.gut {
  transition: opacity 350ms ease;
}
.typing .jl {
  background: transparent !important;
  box-shadow: none !important;
}
.typing .gut {
  opacity: 0;
}
/* 다 쳐진 뒤 끼어드는 지운 줄·옛 줄(−). */
.jl.diff-in {
  animation: diff-in 420ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
}
@keyframes diff-in {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
}

/* --- 새 줄이 나오기: 옅은 망점 띠가 훑고, 그 뒤로 한 자씩 쳐진다 --- */
.applied .jl.fx {
  position: relative;
  animation: none;
}
.applied .jl.fx .txt {
  /* 커서: 2px 회색 막대를 배경으로 깔고, 드러나는 끝을 따라 옮긴다(드러내기와 같은 계단). 다 쳐지면 잠깐 뒤 사라진다. 줄 너비를
     글자 수만큼 계단으로 열어서 글꼴의 글자 폭(ch)에 기대지 않는다. 한 자 14ms, 긴 줄(외곽선 좌표)도 0.84초 안에 다 쳐진다(ReplayGeo 스크립트의 CHAR_MS·CHAR_CAP 과 같은 값). */
  background: linear-gradient(#c9ced6, #c9ced6) 0 0 / 2px 100% no-repeat;
  animation:
    type-reveal calc(min(var(--n), 60) * 14ms) steps(var(--n), end) calc(var(--d) + 160ms) both,
    caret-off 200ms linear calc(var(--d) + 160ms + min(var(--n), 60) * 14ms + 350ms) both;
}
.applied .jl.fx::after {
  content: '';
  position: absolute;
  inset: -1px 0;
  pointer-events: none;
  background: radial-gradient(circle, rgba(232, 235, 239, 0.35) 0.9px, transparent 1.6px) 0 0 / 4px 4px;
  mask-image: linear-gradient(90deg, transparent 0%, #000 35%, #000 65%, transparent 100%);
  mask-size: 45% 100%;
  mask-repeat: no-repeat;
  animation: halftone 900ms cubic-bezier(0.4, 0, 0.2, 1) var(--d) both;
}
@keyframes type-reveal {
  from {
    clip-path: inset(0 100% 0 0);
    background-position-x: 0%;
  }
  to {
    clip-path: inset(0 0 0 0);
    background-position-x: 100%;
  }
}
@keyframes caret-off {
  to {
    background-size: 0 100%;
  }
}
@keyframes halftone {
  0% {
    mask-position: -100% 0;
    opacity: 1;
  }
  75% {
    opacity: 1;
  }
  100% {
    mask-position: 200% 0;
    opacity: 0;
  }
}
@keyframes geo-in {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
}
@keyframes row-flash {
  from {
    background: rgba(229, 192, 123, 0.45);
  }
}
@media (prefers-reduced-motion: reduce) {
  .replay-geo,
  .jl,
  .applied .jl.fx .txt,
  .applied .jl.fx::after {
    animation: none !important;
  }
  .applied .jl.fx::after {
    display: none;
  }
}
</style>
