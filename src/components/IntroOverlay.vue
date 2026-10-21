<script setup lang="ts">
// 첫 화면 인트로를 창 전체에 띄운다(src/editor/intro.ts). 그림은 iframe 안의 public/intro/ 가 그린다 — kit 이 창 전체를 쓰는
// 한 장짜리 페이지라 앱 화면과 섞지 않는다. [에디터로] 를 누르거나 Esc 로 닫는다.
import { onBeforeUnmount, onMounted } from 'vue'
import { closeIntro, introOpen, introScene, loadIntro } from '../editor/intro'

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && introOpen.value) closeIntro()
}
// 장면을 못 읽으면 페이지가 알려 준다. 빈 화면을 덮어 두지 않고 닫는다.
function onMessage(e: MessageEvent) {
  if (e.data?.intro === 'empty') closeIntro()
}
onMounted(() => {
  loadIntro()
  addEventListener('keydown', onKey)
  addEventListener('message', onMessage)
})
onBeforeUnmount(() => {
  removeEventListener('keydown', onKey)
  removeEventListener('message', onMessage)
})
</script>

<template>
  <div v-if="introOpen && introScene" class="intro" role="dialog" aria-label="인트로">
    <iframe :src="`./intro/index.html?name=${encodeURIComponent(introScene)}`" title="BIM 에서 DT 온톨로지로" />
    <button type="button" class="go" @click="closeIntro">에디터로 <kbd>Esc</kbd></button>
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
.go {
  position: absolute;
  top: 38px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.55rem 1.1rem;
  border: 1px solid rgba(241, 239, 233, 0.35);
  border-radius: 999px;
  background: rgba(13, 14, 16, 0.6);
  color: #f1efe9;
  font: 500 0.9rem/1 system-ui, sans-serif;
  cursor: pointer;
}
.go:hover {
  background: #f1efe9;
  color: #0d0e10;
}
.go kbd {
  margin-left: 0.4rem;
  font: 0.72rem ui-monospace, monospace;
  opacity: 0.6;
}
</style>
