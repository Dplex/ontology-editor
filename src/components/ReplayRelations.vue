<script setup lang="ts">
// 편집 리플레이 카드의 관계 그래프(lib/replay-relations.ts). 주어마다 왼쪽에 한 마디, 오른쪽에 대상들. 끊긴 대상은 빨간 점선으로
// 흐려지고, 새 대상은 초록 선이 그어지며 나타난다 — TTL 의 어느 관계가 바뀌었는지를 줄 글보다 먼저 한눈에.
import { computed } from 'vue'
import type { Relation } from '../lib/replay-relations'

const props = defineProps<{ rels: readonly Relation[]; name: (ref: string) => string }>()

/** 그리는 주어 수와 주어마다 대상 수. 넘치면 "+n". */
const MAX_RELS = 2
const MAX_OBJECTS = 3
const ROW = 22
const W = 360
const cut = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const blocks = computed(() => {
  let y = 4
  return props.rels.slice(0, MAX_RELS).map((r) => {
    const all = [...r.gone.map((o) => ({ o, kind: 'gone' as const })), ...r.came.map((o) => ({ o, kind: 'came' as const }))]
    const shown = all.slice(0, MAX_OBJECTS)
    const h = Math.max(1, shown.length) * ROW
    const top = y
    y += h + 8
    const cy = top + h / 2
    return {
      key: `${r.subject}|${r.predicate}`,
      subject: cut(props.name(r.subject)),
      predicate: r.predicate,
      cy,
      more: all.length - shown.length,
      objects: shown.map((x, i) => {
        const oy = top + i * ROW + ROW / 2
        return { ...x, label: cut(props.name(x.o)), oy, path: `M 122 ${cy} C 176 ${cy}, 176 ${oy}, 230 ${oy}` }
      }),
    }
  })
})
const height = computed(() => blocks.value.reduce((h, b) => Math.max(h, b.cy + (b.objects.length * ROW) / 2 + 6), 0))
</script>

<template>
  <svg v-if="blocks.length" class="rels" :viewBox="`0 0 ${W} ${height}`" :style="{ height: `${height}px` }" preserveAspectRatio="xMinYMin meet">
    <g v-for="(b, bi) in blocks" :key="b.key" :style="{ '--d': `${bi * 180}ms` }">
      <rect class="node subj" x="2" :y="b.cy - 10" width="120" height="20" rx="3" />
      <text class="t" x="10" :y="b.cy + 4">{{ b.subject }}</text>
      <g v-for="x in b.objects" :key="x.o" :class="x.kind">
        <path class="edge" :d="x.path" pathLength="1" />
        <rect class="node" x="230" :y="x.oy - 9" width="128" height="18" rx="3" />
        <text class="t" x="237" :y="x.oy + 4">{{ x.label }}</text>
      </g>
      <text class="pred" x="128" :y="b.cy - 6">{{ b.predicate }}</text>
      <text v-if="b.more > 0" class="more" x="356" :y="b.cy + b.objects.length * 11 + 10" text-anchor="end">+{{ b.more }}</text>
    </g>
  </svg>
</template>

<style scoped>
.rels {
  display: block;
  width: 100%;
  margin: 4px 0 6px;
  overflow: visible;
  font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
}
.node {
  fill: #0b1220;
  stroke: rgba(200, 215, 240, 0.35);
}
.node.subj {
  stroke: rgba(255, 255, 255, 0.7);
}
.t {
  fill: #e6ecf5;
}
.pred {
  fill: #8a9ab3;
  font-size: 10px;
}
.more {
  fill: #8a9ab3;
}
.edge {
  fill: none;
  stroke-width: 1.6;
}
/* 끊긴 관계: 그어진 채로 있다가 빨간 점선이 되며 흐려진다. */
.gone .edge {
  stroke: #ff6b9a;
  stroke-dasharray: 0.04 0.03;
  animation: gone 700ms ease-out calc(var(--d) + 200ms) both;
}
.gone .node {
  stroke: #ff6b9a;
  animation: gone 700ms ease-out calc(var(--d) + 200ms) both;
}
.gone .t {
  fill: #ff8fb0;
  text-decoration: line-through;
  animation: gone 700ms ease-out calc(var(--d) + 200ms) both;
}
/* 새 관계: 선이 주어에서 대상으로 그어지고, 그 끝에 대상이 나타난다. */
.came .edge {
  stroke: #5ef2c2;
  stroke-dasharray: 1;
  animation: draw 650ms cubic-bezier(0.4, 0, 0.2, 1) calc(var(--d) + 550ms) both;
}
.came .node {
  stroke: #5ef2c2;
  animation: pop 380ms cubic-bezier(0.2, 1.4, 0.35, 1) calc(var(--d) + 1100ms) both;
  transform-box: fill-box;
  transform-origin: left center;
}
.came .t {
  fill: #c9fff0;
  animation: pop 380ms cubic-bezier(0.2, 1.4, 0.35, 1) calc(var(--d) + 1100ms) both;
  transform-box: fill-box;
  transform-origin: left center;
}
@keyframes gone {
  to {
    opacity: 0.35;
  }
}
@keyframes draw {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rels * {
    animation: none !important;
  }
}
</style>
