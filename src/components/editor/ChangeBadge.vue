<script setup lang="ts">
// 선택 오브젝트의 변경 상태(OE-UI-22). 편집 중에만 늘 하나를 보인다 — 신규 · 변경 · 변경 없음. 기준은 연 때다(changes.ts 의 baseline).
import { computed } from 'vue'
import { objectChangeState } from '../../editor/changes'
import { editing } from '../../editor/core'

const props = defineProps<{ id: string }>()
const state = computed(() => objectChangeState.value.states.get(props.id))
const text = computed(() => (state.value === 'added' ? '신규' : state.value === 'changed' ? '변경' : '변경 없음'))
</script>

<template>
  <span v-if="editing" :class="['change-badge', state ?? 'none']" data-testid="change-badge" title="연 때와 견준 변경 상태입니다">{{ text }}</span>
</template>
