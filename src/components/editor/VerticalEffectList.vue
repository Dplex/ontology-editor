<script setup lang="ts">
import { computed } from 'vue'
import { SLAB_OPENING_LABEL } from '../../lib/slab-opening'
import { STOP_LABEL, type VerticalEffect } from '../../lib/vertical-edit'

// 지우기·구간 줄이기 전에 보이는 개구부·물리존 면적·엘리베이터 정차(OE-ML-08 AC1 · OE-ML-09 AC1). `<ul>` 안에 `<li>` 로 들어간다.
// `range` 는 빠지는 층 몫만 보인다 — 남는 층의 개구부는 구간을 줄여도 그대로다. 숫자는 verticalEffect(vertical-edit.ts)가 잰다.
const props = defineProps<{ effect: VerticalEffect; mode: 'delete' | 'range' }>()

const m2 = (v: number) => `${v.toFixed(2)}㎡`
const openings = computed(() => props.effect.openings.filter((o) => props.mode === 'delete' || o.gone))
const stops = computed(() => (props.effect.stops ?? []).filter((s) => props.mode === 'delete' || s.gone))
// 확정한 편집 개구부(`cut`)만 슬래브를 뚫은 것이라 사라진다. 초안은 계산한 제안일 뿐이고, BIM 개구부와 이미 비어 있음은 슬래브 쪽 원본이라 그대로다.
const removable = computed(() => openings.value.filter((o) => o.state === 'cut').length)
</script>

<template>
  <li v-if="openings.length" data-testid="effect-openings">
    {{ mode === 'delete' ? '슬래브 개구부' : '빠지는 층의 슬래브 개구부' }}:
    <template v-for="(o, i) in openings" :key="o.storeyId">{{ i ? ' · ' : '' }}{{ o.storey }} 바닥 {{ SLAB_OPENING_LABEL[o.state] }}</template>
    —
    {{ removable ? `확정한 편집 개구부 ${removable}곳은 함께 사라지고, ` : '' }}BIM 원본 개구부는 슬래브에 그대로 남습니다
  </li>
  <li v-if="effect.spaces.length" data-testid="effect-areas">
    물리존 면적이 돌아옵니다:
    <template v-for="(s, i) in effect.spaces" :key="s.storey + s.space">{{ i ? ' · ' : '' }}{{ s.storey }} {{ s.space }} +{{ m2(s.m2) }}</template>
  </li>
  <li v-if="stops.length" data-testid="effect-stops">
    {{ mode === 'delete' ? '정차 층 목록' : '정차 목록에서 빠지는 층' }}:
    <template v-for="(s, i) in stops" :key="s.storeyId">{{ i ? ' · ' : '' }}{{ s.storey }} {{ STOP_LABEL[s.stop] }}</template>
    <template v-if="mode === 'delete'"> — 목록도 함께 없어집니다</template>
  </li>
</template>
