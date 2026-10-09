<script setup lang="ts">
// [임시 — 리플레이 데모] 상단 바의 [데모]. 누르면 App 이 미리 정한 편집을 심고 리플레이를 연다.
// 뺄 때 지울 곳은 lib/replay-demo.ts 맨 위에 모아 두었다.
defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ pick: [] }>()
</script>

<template>
  <button
    type="button"
    class="ghost demo-button"
    :disabled="disabled"
    title="공간·벽·문·창·설비·연결·종류·계통·천장 편집 스무 개 남짓을 두 층에 심고 리플레이를 엽니다 (임시 데모)"
    @click="emit('pick')"
  >
    데모
  </button>
</template>
