<script setup lang="ts">
// 캔버스 왼쪽 위: [3D | 평면도] 와 그 아래 레이어 패널(design-system.md 4장 "캔버스 위 패널", OE-UI-19 · OE-UI-20).
// 레이어는 화면에서만이다 — 편집 파일 · TTL · GeoJSON 에는 남지 않는다. 묶음은 존 · 공간 · 설비 셋.
import type { PropType } from 'vue'
import { replayOpen } from '../../lib/replay-player'
import { activeTab } from '../../editor/context-menu'
import { ceilingMode, ceilingPlaneCount, showCeiling } from '../../editor/ceiling'
import { drawnWalls, showWalls, showZones } from '../../editor/idf-zones'
import { labelStorey, showLabels, showPlan } from '../../editor/labels'
import { multiView } from '../../editor/vertical'
import { classTintOn, clearViewFilter, exploded, filterOn, filterOpen } from '../../editor/view-filter'
import type { model as modelRef } from '../../editor/core'

defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <div class="shell-tl">
    <div class="tabs shell-viewtabs" role="group" aria-label="보기">
      <button type="button" :aria-pressed="activeTab === '3d'" title="3D 입체 뷰로 보기 (Shift+V)" @click="activeTab = '3d'">3D</button>
      <button type="button" :aria-pressed="activeTab === 'plan'" :disabled="!!multiView" :title="multiView ? '평면도는 층 하나를 그립니다. 다중층 뷰는 3D 입니다' : '2D 평면도로 전환 (Shift+V)'" @click="showPlan">평면도</button>
    </div>
    <section v-if="activeTab === '3d' && !replayOpen" class="shell-layers" aria-label="레이어">
      <header><b>레이어</b><span class="muted">화면에서만</span></header>
      <p class="layer-group">존</p>
      <label :class="{ off: !model.hvac?.zones.length }" :title="model.hvac?.zones.length ? 'IDF 공조존의 바닥 외곽선' : 'IDF 를 덧붙이면 켤 수 있습니다'">
        <input v-model="showZones" type="checkbox" :disabled="!model.hvac?.zones.length" /><i class="sw hvac"></i>공조존(IDF)<small>{{ model.hvac?.zones.length ?? 0 }}</small>
      </label>
      <p class="layer-group">공간</p>
      <label :class="{ off: !drawnWalls }" title="3D 벽 표시 (W)">
        <input v-model="showWalls" type="checkbox" :disabled="!drawnWalls" /><i class="sw wall"></i>벽<small v-if="drawnWalls">{{ (drawnWalls.loadBearing ?? 0) + (drawnWalls.ordinary ?? 0) + (drawnWalls.unknown ?? 0) }}</small>
      </label>
      <label :class="{ off: !ceilingPlaneCount && !ceilingMode }" :title="ceilingPlaneCount ? '반자 높이에 50% 반투명 천장면을 보입니다 (천장 편집 모드에서는 자동 표시)' : '천장고가 있는 층에서 반투명 천장면을 보입니다'">
        <input v-model="showCeiling" type="checkbox" data-testid="layer-ceiling" :disabled="!ceilingPlaneCount && !ceilingMode" /><i class="sw ceiling"></i>천장<small v-if="ceilingPlaneCount">{{ ceilingPlaneCount }}</small>
      </label>
      <p class="layer-group">설비</p>
      <label :class="{ off: !labelStorey }" :title="labelStorey ? '설비마다 이름과 소속 · 종류 출처를 3D 위에 띄웁니다 (L)' : '층 하나를 고르면 설비 라벨을 띄웁니다 (L)'">
        <input v-model="showLabels" type="checkbox" class="labels-toggle" :disabled="!labelStorey" /><i class="sw equip"></i>라벨
      </label>
      <label title="기기를 제자리에서 Brick 종류별 색으로 칠하고 범례에 종류 · 대수를 보입니다 (X)">
        <input v-model="classTintOn" type="checkbox" data-testid="class-tint-toggle" /><i class="sw tint"></i>종류별 색
      </label>
      <footer>
        <button type="button" :class="['ghost', { on: filterOpen || filterOn }]" :aria-expanded="filterOpen" data-testid="filter-toggle" title="층 · Brick 클래스 · 계통으로 걸러 봅니다 (V)" @click="filterOpen = !filterOpen">
          보기 필터<b v-if="filterOn" class="dock-dot" aria-label="필터 켜짐"></b>
        </button>
        <button v-if="filterOn || exploded || classTintOn" type="button" class="link" title="적용된 모든 필터 · 분해도 · 종류별 색을 초기화합니다" @click="clearViewFilter">초기화</button>
      </footer>
    </section>
  </div>
</template>
