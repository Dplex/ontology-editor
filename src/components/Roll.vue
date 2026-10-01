<script setup lang="ts">
// 굴러서 바뀌는 숫자(lib/motion.ts). 처음 화면에 들어올 때 0 에서 올라오고, 그 뒤에는 바뀔 때만 굴러가며 한 번 튄다.
// 접힌 칸은 펼 때 처음 그려지므로(Fold 의 v-if) 펼치는 순간 올라온다.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { replay, roll, still } from '../lib/motion'

const props = withDefaults(defineProps<{ value: number; format?: (v: number) => string; countUp?: boolean }>(), {
  format: (v: number) => Math.round(v).toLocaleString(),
  countUp: true,
})
const el = ref<HTMLElement | null>(null)
const text = ref(props.countUp && !still() ? props.format(0) : props.format(props.value))
let stop = () => {}
let seen = false
let observer: IntersectionObserver | null = null

function go(from: number, to: number) {
  stop()
  // 표시가 같으면 굴리지 않는다. 12.31 → 12.34 를 "12.3" 으로 굴리는 것은 아무 말도 안 하는 움직임이다.
  if (props.format(from) === props.format(to)) {
    text.value = props.format(to)
    return
  }
  stop = roll(from, to, (v) => (text.value = props.format(v)))
}

onMounted(() => {
  if (!props.countUp || still() || typeof IntersectionObserver === 'undefined') {
    seen = true
    text.value = props.format(props.value)
    return
  }
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    observer?.disconnect()
    seen = true
    go(0, props.value)
  })
  observer.observe(el.value!)
})

watch(
  () => props.value,
  (to, from) => {
    if (!seen) return
    go(from, to)
    if (el.value && !still()) replay(el.value, 'num-bump')
  },
)

onBeforeUnmount(() => {
  stop()
  observer?.disconnect()
})
</script>

<template>
  <span ref="el" class="roll">{{ text }}</span>
</template>
