<script setup lang="ts">
import type { PropType } from 'vue'
import { addPlumbPoint, branchAtWork, riserWorkZ, setRiserWork } from '../../editor/cross-storey'
import { vKeepTyping } from '../../editor/edit-filter'
import { grid, snap } from '../../editor/grid-snap'
import { multiRange } from '../../editor/multi-view'
import { finishDraw, pipeToMulti, undoDrawPoint } from '../../editor/pipe-handoff'
import { stopDraw } from '../../editor/place'
import { multiView } from '../../editor/vertical'
import AlignToggles from '../AlignToggles.vue'
import type { drawing as drawingRef } from '../../editor/space-objects'
import type { model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  drawing: { type: null as unknown as PropType<NonNullable<typeof drawingRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <div class="draw-bar" :class="{ low: !!multiView }" role="status">
    <template v-if="drawing.purpose === 'split' || drawing.purpose === 'customSplit'">
      <b>{{ drawing.name }}</b> 나누기 · 나눌 선의 두 점을 바닥에 찍습니다 · {{ drawing.points.length }}/2
    </template>
    <template v-else-if="drawing.purpose === 'wall'">
      <b>{{ drawing.name }}</b> 긋기 · 벽의 두 끝점을 바닥에 찍습니다 · {{ drawing.points.length }}/2
    </template>
    <template v-else-if="drawing.purpose === 'verticalPoint'">
      <b>{{ drawing.name }}</b> · 그 층 바닥을 한 번 누릅니다
    </template>
    <template v-else-if="drawing.purpose === 'pipe' && drawing.work">
      <b>{{ drawing.name }}</b> · 작업 높이
      <select :value="drawing.work.storeyId" aria-label="작업 층" @change="setRiserWork(($event.target as HTMLSelectElement).value, drawing.work.height)">
        <option v-for="st in multiRange ?? []" :key="st.id" :value="st.id">{{ st.name }}</option>
      </select>
      바닥에서
      <input v-keep-typing type="number" step="0.1" class="riser-height" :value="drawing.work.height" aria-label="층 바닥에서 높이(m)" @change="setRiserWork(drawing.work.storeyId, Number(($event.target as HTMLInputElement).value))" />
      m <span class="muted">(z {{ riserWorkZ?.toFixed(2) }}m)</span> ·
      <template v-if="drawing.branchOf && !drawing.points.length">
        첫 점은 분기 자리(구간 위)
        <button type="button" class="ghost" data-testid="branch-at" @click="branchAtWork">이 높이에서 분기</button>
      </template>
      <template v-else>
        {{ drawing.branchOf ? '분기 자리 + ' : '' }}꺾임점 {{ drawing.points.length - (drawing.branchOf ? 1 : 0) }}개
        <button type="button" class="ghost" data-testid="riser-plumb" @click="addPlumbPoint">수직으로 찍기</button>
      </template>
    </template>
    <template v-else>
      <b>{{ drawing.name }}</b> {{ drawing.purpose === 'create' || drawing.purpose === 'custom' || drawing.purpose === 'room' ? '그리기' : '외곽선 그리기' }} · 바닥을 눌러 꼭짓점을 찍습니다 ·
      {{ drawing.points.length }}개
    </template>
    <button v-if="drawing.purpose !== 'split' && drawing.purpose !== 'wall' && drawing.purpose !== 'customSplit' && drawing.purpose !== 'room' && drawing.purpose !== 'verticalPoint'" type="button" class="ghost" :disabled="drawing.purpose === 'pipe' ? false : drawing.points.length < 3" @click="finishDraw">마침 <kbd>Enter</kbd></button>
    <button
      v-if="drawing.purpose === 'pipe' && !drawing.levels && !multiView && (model?.storeys.length ?? 0) > 1"
      type="button"
      class="ghost"
      title="그리던 꺾임점을 들고 지금 층과 위층을 함께 보는 다중층 뷰로 갑니다(다른 층까지 잇기). [층 편집으로] 로 돌아오면 그대로입니다"
      @click="pipeToMulti"
    >
      다중층 뷰에서 편집
    </button>
    <button type="button" class="ghost" :disabled="!drawing.points.length" @click="undoDrawPoint">한 점 지우기</button>
    <button type="button" class="ghost" @click="stopDraw">취소 <kbd>Esc</kbd></button>
    <!-- 그리드 정렬(OE-UI-07)·스냅(OE-UI-06). 찍는 점을 옮긴다. 다중층 뷰는 층이 여럿이라 그리드만 받는다. -->
    <AlignToggles v-model:grid="grid" v-model:snap="snap" />
  </div>
</template>
