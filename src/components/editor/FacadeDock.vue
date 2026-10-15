<script setup lang="ts">
import { drawnWalls, showWalls } from '../../editor/idf-zones'
import { classTintOn, clearViewFilter, exploded, filterOn, filterOpen } from '../../editor/view-filter'
</script>

<template>
  <nav class="facade-dock" aria-label="3D 탐색 독">
    <button
      type="button"
      :class="['dock-btn', { on: filterOpen || filterOn }]"
      :aria-expanded="filterOpen"
      aria-label="Filter (보기 필터)"
      data-testid="filter-toggle"
      title="층 · Brick 클래스 · 계통 탐색 필터 열기·닫기 (V)"
      @click="filterOpen = !filterOpen"
    >
      <span class="dock-icon" aria-hidden="true">⧩</span>
      <span>Filter</span>
      <b v-if="filterOn" class="dock-dot" aria-label="필터 켜짐"></b>
    </button>
    <!-- 종류별 색(2026-10-15). 예전에는 Brick 클래스별로 공중에 띄웠는데(분해도) 높이에 뜻이 없어 읽히지 않았다. 띄우기는 서랍·우클릭에 남는다. -->
    <button
      type="button"
      :class="['dock-btn', { on: classTintOn }]"
      :aria-pressed="classTintOn"
      aria-label="Explode (종류별 색)"
      title="기기를 제자리에서 Brick 종류별 색으로 칠하고 범례에 종류·대수를 보입니다 (X)"
      data-testid="class-tint-toggle"
      @click="classTintOn = !classTintOn"
    >
      <span class="dock-icon" aria-hidden="true">❖</span>
      <span>Explode</span>
    </button>
    <button
      v-if="drawnWalls"
      type="button"
      :class="['dock-btn', 'walls-toggle', { on: showWalls }]"
      :aria-pressed="showWalls"
      aria-label="Walls (3D 벽)"
      title="3D 벽 표시 켜기·끄기 (W)"
      @click="showWalls = !showWalls"
    >
      <span class="dock-icon" aria-hidden="true">▣</span>
      <span>Walls</span>
    </button>
    <button
      v-if="filterOn || exploded || classTintOn"
      type="button"
      class="dock-btn reset"
      title="적용된 모든 필터·분해도·종류별 색을 초기화합니다"
      @click="clearViewFilter"
    >
      Reset
    </button>
  </nav>
</template>
