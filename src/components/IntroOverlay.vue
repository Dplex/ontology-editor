<script setup lang="ts">
// 첫 화면 인트로를 창 전체에 띄운다(src/editor/intro.ts). 그림은 iframe 안의 public/intro/ 가 그린다 — kit 이 창 전체를 쓰는
// 한 장짜리 페이지라 앱 화면과 섞지 않는다. 주소가 #intro 일 때만 뜨고, 들어가기 패널로 들어가거나 Esc 로 닫으면 주소도 / 로 돌아간다.
// 위쪽 [에디터로] 단추는 없앴다. 앞머리에는 [건너뛰기] 가 있고, 조립이 끝나면 패널이 그 자리를 맡는다(2026-10-22 사용자).
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { closeIntro, introOpen, introScene, loadIntro } from '../editor/intro'
import IntroSignIn, { type IntroMeta } from './IntroSignIn.vue'

// 조립이 끝났다는 신호를 받으면 오른쪽에 들어가기 패널을 띄우고, iframe 에 오른쪽 제목 칸을 비우라고 알린다.
const frame = ref<HTMLIFrameElement | null>(null)
const meta = ref<IntroMeta | null>(null)
const panel = ref<{ $el: HTMLElement } | null>(null)
// iframe 은 창 전체라 좌표가 같다. 패널의 아래 끝·오른쪽 여백·폭을 보내면 iframe 이 제목 칸을 그 아래에 맞춰 놓는다.
// 등장 애니메이션(translate)에 흔들리지 않게 offset 값으로 잰다.
function sendBox() {
  const el = panel.value?.$el
  if (!el) return
  const box = { bottom: el.offsetTop + el.offsetHeight, right: innerWidth - (el.offsetLeft + el.offsetWidth), width: el.offsetWidth }
  frame.value?.contentWindow?.postMessage({ intro: 'panel', box }, '*')
}
watch(introOpen, (on) => {
  if (!on) meta.value = null
})

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && introOpen.value) closeIntro()
}
// 장면을 못 읽으면 페이지가 알려 준다. 빈 화면을 덮어 두지 않고 닫는다.
function onMessage(e: MessageEvent) {
  if (e.source !== frame.value?.contentWindow) return
  if (e.data?.intro === 'empty') closeIntro()
  if (e.data?.intro === 'assembled') {
    const { title, files, place } = e.data
    meta.value = { title: String(title ?? ''), files: Array.isArray(files) ? files.map(String) : [], place: place ?? null }
    nextTick(sendBox)
  }
}
onMounted(() => {
  loadIntro()
  addEventListener('keydown', onKey)
  addEventListener('message', onMessage)
  addEventListener('resize', sendBox)
})
onBeforeUnmount(() => {
  removeEventListener('keydown', onKey)
  removeEventListener('message', onMessage)
  removeEventListener('resize', sendBox)
})
</script>

<template>
  <div v-if="introOpen && introScene" class="intro" role="dialog" aria-label="인트로">
    <iframe ref="frame" :src="`./intro/index.html?name=${encodeURIComponent(introScene)}`" title="BIM 에서 DT 온톨로지로" />
    <IntroSignIn v-if="meta" ref="panel" :meta="meta" @enter="closeIntro" />
  </div>
</template>

<style scoped>
.intro {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #0d0e10;
}
.intro iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
</style>
