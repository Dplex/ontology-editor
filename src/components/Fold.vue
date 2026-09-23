<script setup lang="ts">
// 제목을 누르면 접히고 펼쳐지는 칸. 접힌 동안에는 내용을 **그리지 않는다**(v-if).
// 성수처럼 설비가 1만 대를 넘는 모델에서 표를 CSS 로만 숨기면, 보이지도 않는 행 수만 개를
// 브라우저가 여전히 만들고 갱신한다.
import { ref } from 'vue'

const props = withDefaults(defineProps<{ title: string; meta?: string; defaultOpen?: boolean }>(), {
  meta: '',
  defaultOpen: true,
})
const open = ref(props.defaultOpen)
</script>

<template>
  <section class="fold" :class="{ open }">
    <button type="button" class="fold-head" :aria-expanded="open" @click="open = !open">
      <span class="chev" aria-hidden="true">▸</span>
      <span class="fold-title">{{ title }}</span>
      <span v-if="meta" class="fold-meta">{{ meta }}</span>
    </button>
    <div v-if="open" class="fold-body">
      <slot />
    </div>
  </section>
</template>
