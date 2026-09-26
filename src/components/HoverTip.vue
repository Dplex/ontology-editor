<script setup lang="ts">
// 3D 에서 마우스 아래 있는 것이 무엇인지 보이는 풍선. 누르지 않고도 설비 이름·종류·계통·소속을 본다.
//
// 상태를 이 안에만 둔다. App 에 두면 마우스가 움직일 때마다 App 전체(표·검사·3D 아래 전부)가 다시 그려진다 —
// 병원 MEP 에서 App 한 번 그리기가 0.2초라 마우스를 따라가지 못한다. App 은 show·move·hide 만 부른다.
import { ref } from 'vue'

const on = ref(false)
const title = ref('')
const lines = ref<string[]>([])
const left = ref(0)
const top = ref(0)
const box = ref<HTMLElement | null>(null)

const GAP = 14

function place(at: { x: number; y: number }) {
  const w = box.value?.offsetWidth ?? 240
  const h = box.value?.offsetHeight ?? 60
  // 오른쪽·아래가 모자라면 커서 반대편에 둔다.
  left.value = at.x + GAP + w > window.innerWidth ? Math.max(4, at.x - GAP - w) : at.x + GAP
  top.value = at.y + GAP + h > window.innerHeight ? Math.max(4, at.y - GAP - h) : at.y + GAP
}

function show(t: string, detail: string[], at: { x: number; y: number }) {
  title.value = t
  lines.value = detail
  on.value = true
  place(at)
}

function move(at: { x: number; y: number }) {
  if (on.value) place(at)
}

function hide() {
  on.value = false
}

defineExpose({ show, move, hide })
</script>

<template>
  <div v-show="on" ref="box" class="hover-tip" role="tooltip" :style="{ left: `${left}px`, top: `${top}px` }">
    <b>{{ title }}</b>
    <span v-for="l in lines" :key="l">{{ l }}</span>
  </div>
</template>
