<script setup lang="ts">
// 규칙 기반 경고 W-01~W-03(OE-P3-01~04). 켜고 끄고 기준을 바꾸면 경고 대상이 바뀐다. 반영은 막지 않는다.
import { computed, reactive } from 'vue'
import type { Model, Storey } from '../../../../src/lib/model'
import { DEFAULT_WARN, warningsFor } from './warnings'
const props = defineProps<{ model: Model; floor: Storey; revision: number; compact?: boolean }>()
const opts = reactive({ ...DEFAULT_WARN })
const w = computed(() => { void props.revision; return warningsFor(props.model, props.floor, opts) })
const name = (s: { name: string; longName?: string }) => s.longName || s.name
const total = computed(() => w.value.w01.length + w.value.w02.length + w.value.w03.length)
</script>
<template>
  <div class="warn-panel" data-testid="warnings">
    <h4>규칙 경고 <small>{{ total }}건 · 반영은 막지 않습니다</small></h4>
    <label v-if="!compact" class="check">W-01 최소 면적 <input v-model.number="opts.minArea" type="number" min="0" step="0.5" aria-label="최소 면적(㎡)" style="width:60px"> ㎡ 미만</label>
    <div class="warn-row" data-testid="w01"><b>W-01</b> 물리존 {{ opts.minArea }}㎡ 미만 <span>{{ w.w01.length }}</span><small v-if="w.w01.length">{{ w.w01.map(name).join(', ') }}</small></div>
    <label v-if="!compact" class="check"><input v-model="opts.w02" type="checkbox" aria-label="W-02 켜기"> W-02 설비 0개 물리존 경고</label>
    <div class="warn-row" data-testid="w02"><b>W-02</b> 설비가 없는 물리존 <span>{{ w.w02.length }}</span><small v-if="w.w02.length">{{ w.w02.map(name).join(', ') }}</small></div>
    <label v-if="!compact" class="check"><input v-model="opts.w03" type="checkbox" aria-label="W-03 켜기"> W-03 공조존 미매핑 물리존 경고</label>
    <div class="warn-row" data-testid="w03"><b>W-03</b> 공조존에 안 든 물리존(Z-01) <span>{{ w.w03.length }}</span><small v-if="w.w03.length">{{ w.w03.map(name).join(', ') }}</small></div>
  </div>
</template>
