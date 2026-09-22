<script setup lang="ts">
// 등급별 채움 정도. 파일 목록과 검토 화면이 같은 모양으로 쓴다 — 목록에서 본 것과 열었을 때
// 본 것이 같은 모양이어야 둘을 견준다(특히 파일을 덧붙인 뒤 칸이 어떻게 찼는지).
import type { Tier } from '../lib/profile'

defineProps<{ tiers: Tier[] }>()
</script>

<template>
  <ul class="tiers">
    <li v-for="t in tiers" :key="t.key" :class="t.level" :title="t.note">
      <span>{{ t.label }}</span><b>{{ t.figure }}</b>
    </li>
  </ul>
</template>
