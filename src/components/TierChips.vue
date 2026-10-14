<script setup lang="ts">
// 등급별 채움 정도. 파일 목록과 검토 화면이 같은 모양으로 쓴다 — 목록에서 본 것과 열었을 때
// 본 것이 같은 모양이어야 둘을 견준다(특히 파일을 덧붙인 뒤 칸이 어떻게 찼는지).
//
// 칩마다 판정에 쓰는 본 숫자는 하나다(OE-BIM-16). 보정 후 값·미확정 규칙 값은 본 숫자와 다를 때만 옅게 따로 보이고 "목표에 안 셈" 을
// 붙인다 — 화살표로 이으면 개선한 수치처럼 읽힌다.
import type { Tier } from '../lib/profile'

defineProps<{ tiers: Tier[] }>()
</script>

<template>
  <ul class="tiers">
    <li v-for="t in tiers" :key="t.key" :class="t.level" :title="t.note" :data-tier="t.key">
      <span>{{ t.label }}</span><b>{{ t.figure }}</b>
      <small v-if="t.aux" class="aux">{{ t.aux.source === 'rule' ? '미확정 규칙' : '보정 후' }} {{ t.aux.figure }} · 판정 제외</small>
    </li>
  </ul>
</template>
