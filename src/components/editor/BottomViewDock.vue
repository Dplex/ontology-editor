<script setup lang="ts">
import { selectedId } from '../../editor/flow-rules'
import { runShortcut } from '../../editor/keyboard'
import { group } from '../../editor/multi-select'
import { selectedSpaceId } from '../../editor/rooms'
import { viewer } from '../../editor/scene'
import { topDownView } from '../../editor/view-filter'
</script>

<template>
  <nav class="bottom-view-dock" aria-label="시점 바로가기">
    <button type="button" class="view-pill" title="건물 전체가 한눈에 들어오게 시점을 맞춥니다 (0 · Home)" @click="viewer?.frameAll()">전체 <kbd>0</kbd></button>
    <button type="button" class="view-pill" title="위에서 똑바로 내려다봅니다 (O)" @click="topDownView">위에서 <kbd>O</kbd></button>
    <button
      type="button"
      class="view-pill"
      :disabled="!selectedId && !selectedSpaceId && !group.length"
      title="고른 설비·물리존·계통에 시점을 맞춥니다 (F)"
      @click="runShortcut('frame')"
    >
      선택 항목 <kbd>F</kbd>
    </button>
  </nav>
</template>
