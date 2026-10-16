<script setup lang="ts">
// 뷰 컨트롤 바(OE-UI-20, design-system.md 5장 "어두운 독"). 캔버스 아래 가운데. 시점 바로가기 · 조작 안내 · 그리드 · 스냅 · 결과 비교 · 전체 화면.
// 3D 조작이 낯선 사람도 길을 잃으면 여기서 돌아온다. 키(0 · O · F)는 그대로다.
import { fullscreen, toggleFullscreen } from '../../editor/chat-view'
import { activeTab } from '../../editor/context-menu'
import { editing } from '../../editor/core'
import { compareOpen } from '../../editor/export-compare'
import { selectedId } from '../../editor/flow-rules'
import { grid, snap } from '../../editor/grid-snap'
import { runShortcut } from '../../editor/keyboard'
import { group } from '../../editor/multi-select'
import { selectedSpaceId } from '../../editor/rooms'
import { viewer } from '../../editor/scene'
import { topDownView } from '../../editor/view-filter'
import AlignToggles from '../AlignToggles.vue'
</script>

<template>
  <nav class="bottom-view-dock" aria-label="뷰 컨트롤">
    <template v-if="activeTab === '3d'">
      <button type="button" class="view-pill" title="건물 전체가 한눈에 들어오게 시점을 맞춥니다 (0 · Home)" @click="viewer?.frameAll()">⌂ 전체 보기</button>
      <button type="button" class="view-pill" title="위에서 똑바로 내려다봅니다 (O)" @click="topDownView">위에서 <kbd>O</kbd></button>
      <button
        type="button"
        class="view-pill"
        :disabled="!selectedId && !selectedSpaceId && !group.length"
        title="고른 설비 · 물리존 · 계통에 시점을 맞춥니다 (F)"
        @click="runShortcut('frame')"
      >
        선택 항목 <kbd>F</kbd>
      </button>
      <span class="dock-hint">드래그 이동 · Shift+드래그 회전 · 휠 확대</span>
    </template>
    <AlignToggles v-if="editing" v-model:grid="grid" v-model:snap="snap" class="bar-align" />
    <button
      v-if="activeTab === '3d'"
      type="button"
      :class="['view-pill', { on: compareOpen }]"
      :aria-pressed="compareOpen"
      data-testid="compare-toggle"
      title="3D 오른쪽에 지금 모델을 내보낸 TTL · GeoJSON 을 DT 플랫폼처럼 읽어 나란히 봅니다 (B)"
      @click="compareOpen = !compareOpen"
    >
      결과 비교
    </button>
    <button type="button" :class="['view-pill', 'fullscreen', { on: fullscreen }]" :aria-pressed="fullscreen" title="작업 영역 전체 화면 전환 (나가기: Esc)" @click="toggleFullscreen">
      {{ fullscreen ? '전체 화면 나가기' : '전체 화면' }}
    </button>
  </nav>
</template>
