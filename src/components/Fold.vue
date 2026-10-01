<script setup lang="ts">
// 제목을 누르면 접히고 펼쳐지는 칸. 접힌 동안에는 내용을 **그리지 않는다**(v-if).
// 성수처럼 설비가 1만 대를 넘는 모델에서 표를 CSS 로만 숨기면, 보이지도 않는 행 수만 개를
// 브라우저가 여전히 만들고 갱신한다.
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{ title: string; meta?: string; defaultOpen?: boolean; reveal?: boolean }>(), {
  meta: '',
  defaultOpen: true,
  reveal: false,
})
const open = ref(props.defaultOpen)
// 바깥에서 "보여야 할 것이 생겼다" 고 알리면 펼친다(이름 찾기에 걸린 행). 닫지는 않는다 — 사람이 연 것을 뺏지 않는다.
// 성수에서 / 로 FCU 를 찾으면 "찾은 것 128" 만 뜨고 표는 접힌 채라 한 번 더 눌러야 했다.
watch(
  () => props.reveal,
  (r) => {
    if (r) open.value = true
  },
)
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
