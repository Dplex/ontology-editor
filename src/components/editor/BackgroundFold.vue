<script setup lang="ts">
import { replayMemo } from '../../lib/replay-player'
import { applyBackgroundStep, bgBusy, bgHere, bgStep, bgStorey, dwgServer, pickBackground, removeBackground, setBackgroundOpacity, setBackgroundPage, startBackgroundStep } from '../../editor/background'
import Fold from '../Fold.vue'
</script>

<template>
  <Fold v-memo="replayMemo()" title="평면도 배경" :meta="bgStorey ? (bgHere ? `${bgStorey.name} · ${bgHere.name}` : `${bgStorey.name} · 없음`) : '층을 고르세요'" class="bg-plan" data-testid="bg-plan">
    <p class="hint">
      준공 도면(PNG·JPG·PDF·DWG)을 깔고 그 위에 물리존을 그립니다.
      <span v-if="dwgServer.enabled" data-testid="dwg-ready">DWG 는 서버가 그림으로 바꾸고, 도면 단위를 알면 실제 크기로 깝니다.</span>
      <span v-else class="muted" data-testid="dwg-off">DWG 는 지금 받을 수 없어 PDF 나 이미지로 내보낸 뒤 고릅니다({{ dwgServer.reason }}).</span>
      배경은 온톨로지와 편집 파일에 나가지 않고, 이 브라우저 탭에만 있습니다.
    </p>
    <template v-if="bgStorey">
      <p class="pipe-draw-row">
        <label class="file-pick" :class="{ disabled: bgBusy }">
          {{ bgBusy ? '도면 그리는 중…' : bgHere ? '다른 도면 고르기' : '도면 고르기' }}
          <input type="file" accept="image/png,image/jpeg,application/pdf,.pdf,.dwg" aria-label="평면도 배경 이미지" :disabled="bgBusy" @change="pickBackground($event.target as HTMLInputElement)" />
        </label>
        <template v-if="bgHere">
          <label v-if="bgHere.pdf && bgHere.pdf.pages > 1">
            쪽
            <input
              type="number"
              min="1"
              :max="bgHere.pdf.pages"
              :value="bgHere.pdf.page"
              :disabled="bgBusy"
              aria-label="PDF 쪽"
              class="bg-page"
              @change="setBackgroundPage(Number(($event.target as HTMLInputElement).value))"
            />
            / {{ bgHere.pdf.pages }}
          </label>
          <span class="muted" data-testid="bg-scale">1px = {{ (bgHere.scale * 1000).toFixed(1) }}mm · 왼쪽 위 ({{ bgHere.origin[0].toFixed(2) }}, {{ bgHere.origin[1].toFixed(2) }})</span>
          <label>
            진하기
            <input type="range" min="0.1" max="1" step="0.1" :value="bgHere.opacity" aria-label="배경 진하기" @input="setBackgroundOpacity(Number(($event.target as HTMLInputElement).value))" />
          </label>
        </template>
      </p>
      <p v-if="bgHere" class="pipe-draw-row">
        <button type="button" class="ghost" @click="startBackgroundStep('bgScale')">스케일 맞추기</button>
        <button type="button" class="ghost" @click="startBackgroundStep('bgAnchor')">원점 맞추기</button>
        <button type="button" class="ghost danger" @click="removeBackground">배경 제거</button>
      </p>
      <form v-if="bgStep?.kind === 'scale'" class="pipe-draw-row" @submit.prevent="applyBackgroundStep">
        <span>찍은 두 점의 실제 거리</span>
        <input v-model="bgStep.meters" type="number" step="0.01" min="0" aria-label="실제 거리(m)" />
        <span>m</span>
        <button type="submit">맞추기</button>
      </form>
      <form v-if="bgStep?.kind === 'anchor'" class="pipe-draw-row" @submit.prevent="applyBackgroundStep">
        <span>찍은 점의 실제 좌표</span>
        <input v-model="bgStep.x" type="number" step="0.01" aria-label="실제 x" />
        <input v-model="bgStep.y" type="number" step="0.01" aria-label="실제 y" />
        <button type="submit">맞추기</button>
      </form>
    </template>
  </Fold>
</template>
