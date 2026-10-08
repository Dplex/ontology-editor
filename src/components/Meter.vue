<script setup lang="ts">
// 얇은 막대(lib/motion.ts 의 짝). 처음 화면에 들어올 때 0 에서 차오르고, 값이 바뀌면 그만큼 미끄러진다.
// 조각을 여럿 이어 붙인다 — 요구사항은 표준 자리(진한 색) 뒤에 다른 자리(옅은 색)를 잇는다. 값은 전체에 대한 비율(0~1)이다.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { still } from '../lib/motion'

defineProps<{ parts: { value: number; tone: 'ok' | 'warn' | 'accent' | 'soft' }[]; label?: string }>()
const el = ref<HTMLElement | null>(null)
const shown = ref(still())
let observer: IntersectionObserver | null = null

onMounted(() => {
  if (shown.value || typeof IntersectionObserver === 'undefined') {
    shown.value = true
    return
  }
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    observer?.disconnect()
    // 한 프레임 미뤄야 0 → 값 전환이 보인다. 같은 프레임에 바꾸면 처음부터 값으로 그려진다.
    requestAnimationFrame(() => (shown.value = true))
  })
  observer.observe(el.value!)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <span ref="el" class="meter" role="img" :aria-label="label">
    <i
      v-for="(p, i) in parts"
      :key="i"
      :class="p.tone"
      :style="{ width: `${shown ? Math.max(0, Math.min(1, p.value)) * 100 : 0}%`, transitionDelay: shown ? `${i * 120}ms` : '0ms' }"
    ></i>
  </span>
</template>
