<script setup lang="ts">
// 테마 단추의 아이콘. 누르면 될 쪽을 그린다 — 라이트일 때 달(다크로), 다크일 때 해(라이트로). 이름은 단추가 `다크 모드` + aria-pressed 로 준다.
defineProps<{ dark: boolean }>()
</script>

<template>
  <svg class="theme-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="dark">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </template>
    <path v-else d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
</template>
