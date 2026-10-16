<script setup lang="ts">
// 고른 것이 내보내는 파일의 어디에 어떻게 남나(editor/export-lines.ts). 인스펙터 아래에 늘 같은 자리로 두어, 한 번 펴면
// 다른 것을 골라도 편 채로 따라온다. 접힌 동안에는 몸통이 붙지 않아 내보내기를 돌지 않는다.
import { replayMemo } from '../../lib/replay-player'
import { inspected } from '../../editor/export-lines'
import Fold from '../Fold.vue'
import ExportLinesBody from './ExportLinesBody.vue'
</script>

<template>
  <section v-if="inspected" v-memo="replayMemo()" class="export-lines" data-testid="export-lines">
    <Fold title="내보내면" :meta="`이 ${inspected.what}의 TTL·GeoJSON 줄`" :default-open="false">
      <ExportLinesBody :id="inspected.id" :what="inspected.what" />
    </Fold>
  </section>
</template>

<style scoped>
/* 인스펙터 카드(.picked)와 같은 모양. .picked 는 쓰지 않는다 — e2e 여럿이 .picked 를 고른 것의 패널 하나로 짚는다. */
.export-lines {
  margin-top: 1rem;
  padding: 0.25rem 1.25rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}
</style>
