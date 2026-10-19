<script setup lang="ts">
// 지금 층의 이름 · 천장고 고치기(층 현황 카드 머리 아래, 편집 모드에서 층 하나를 볼 때). 예전에는 3D 아래 층별 요약 표의 칸이었는데,
// 그 표가 보기만 하는 기준 · 검증 패널로 들어가며 여기로 옮겼다(2026-10-16). 이름 없는 층은 등급 0 을 떨어뜨려 [구축하기] 를 막는다.
import { ceilingOf } from '../../lib/ceiling'
import { storeyNamed } from '../../lib/storey-name'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { ceilingEditing, ceilingInput, ceilingTitle, meters, saveCeiling, startCeiling } from '../../editor/edit-report'
import { shellStorey } from '../../editor/shell'
import { saveStoreyName, startStoreyName, storeyNameEditing, storeyNameInput } from '../../editor/storey-name'
import Src from '../Src.vue'
</script>

<template>
  <div v-if="editing && shellStorey" class="shell-storey-edit" data-testid="storey-edit">
    <span class="item">
      <span class="muted">층 이름</span>
      <template v-if="storeyNameEditing === shellStorey.id">
        <input
          v-model="storeyNameInput"
          v-keep-typing
          class="storey-name-input"
          :aria-label="`${shellStorey.name || '이름 없는 층'} 층 이름`"
          @keydown.enter.prevent="saveStoreyName(shellStorey.id)"
          @keydown.esc.stop="storeyNameEditing = null"
        />
        <button type="button" class="link" @click="saveStoreyName(shellStorey.id)">확인</button>
        <button type="button" class="link" @click="storeyNameEditing = null">취소</button>
      </template>
      <template v-else>
        <b v-if="shellStorey.name.trim()">{{ shellStorey.name }}</b>
        <span v-else class="height-mismatch" title="BIM 이 층 이름을 적지 않았습니다. 이름 없는 층이 있으면 등급 0 미달이라 구축하지 않습니다">이름 없음</span>
        <Src v-if="storeyNamed(shellStorey)" kind="edit" />
        <button type="button" class="link" :aria-label="`${shellStorey.name || '이름 없는 층'} 층 이름 ${shellStorey.name.trim() ? '고치기' : '넣기'}`" @click="startStoreyName(shellStorey.id)">
          {{ shellStorey.name.trim() ? '고치기' : '이름 넣기' }}
        </button>
        <button v-if="storeyNamed(shellStorey)" type="button" class="link" @click="saveStoreyName(shellStorey.id, true)">BIM 이름으로</button>
      </template>
    </span>
    <span class="item">
      <span class="muted" title="천장고(h_c, 천장 마감면 높이), 층 바닥 기준">천장고</span>
      <template v-if="ceilingEditing === shellStorey.id">
        <input
          v-model="ceilingInput"
          type="number"
          step="0.05"
          min="0.3"
          class="ceiling-input"
          :aria-label="`${shellStorey.name} 천장고(m)`"
          @keydown.enter.prevent="saveCeiling(shellStorey.id, Number(ceilingInput))"
          @keydown.esc.stop="ceilingEditing = null"
        />
        m
        <button type="button" class="link" @click="saveCeiling(shellStorey.id, Number(ceilingInput))">확인</button>
        <button type="button" class="link" @click="ceilingEditing = null">취소</button>
      </template>
      <template v-else-if="ceilingOf(shellStorey)">
        <b class="mono" :title="ceilingTitle(shellStorey)">{{ meters(ceilingOf(shellStorey)!.height) }}</b>
        <Src :kind="ceilingOf(shellStorey)!.source" />
        <button type="button" class="link" :aria-label="`${shellStorey.name} 천장고 고치기`" @click="startCeiling(shellStorey.id)">고치기</button>
        <button v-if="shellStorey.ceilingSet != null" type="button" class="link" @click="saveCeiling(shellStorey.id, null)">{{ shellStorey.ceiling ? 'BIM 값으로' : '지우기' }}</button>
      </template>
      <template v-else>
        <span class="muted" :title="ceilingTitle(shellStorey)">모름</span>
        <button type="button" class="link" :aria-label="`${shellStorey.name} 천장고 입력`" @click="startCeiling(shellStorey.id)">입력</button>
      </template>
    </span>
  </div>
</template>
