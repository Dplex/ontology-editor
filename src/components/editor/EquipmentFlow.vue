<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { describeFlow, flowOpen, flowOpenAway, foldDetail, pickFlow } from '../../editor/flow-map'
import { hasRules, showRules, tracedRules } from '../../editor/flow-rules'
import { viewStorey } from '../../editor/multi-view'
import FlowLadder from '../FlowLadder.vue'
import Src from '../Src.vue'
import type { flowMap as flowMapRef } from '../../editor/flow-map'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  flowMap: { type: null as unknown as PropType<NonNullable<typeof flowMapRef.value>>, required: true },
})
</script>

<template>
  <div v-memo="replayMemo()" class="flow-map" data-testid="flow-map">
    <h4 class="picked-sub">
      흐름
      <span class="muted">덕트·배관은 건너뛰고 설비만 잇습니다<template v-if="showRules && hasRules">(규칙 방향 포함 <Src kind="dict" />)</template>. 화살표 위 글은 거쳐 간 계통입니다.</span>
    </h4>
    <!-- 근거 칸을 접은 동안 규칙 방향 토글은 여기 둔다. 이 카드의 줄을 바꾸는 손잡이라 접힌 칸 안에 두면 보기 모드에서 끌 수 없다. -->
    <label v-if="foldDetail && tracedRules" class="rule-toggle flow-rule-toggle">
      <input v-model="showRules" type="checkbox" />
      규칙 방향 포함 <span class="muted">(3D에도 표시)</span>
    </label>
    <FlowLadder v-if="flowMap.lines.length" :lines="flowMap.lines" :open="flowOpen?.key ?? null" :describe="describeFlow" @toggle="flowOpen = $event" @pick="pickFlow">
      <template #note>
        <p v-if="flowOpenAway" class="ladder-away">
          {{ flowOpenAway.all ? '모두' : `${flowOpenAway.count}대가` }} 다른 층({{ flowOpenAway.storeys }})에 있어 지금 3D에 안 보입니다.
          <button type="button" class="link" @click="viewStorey = null">모든 층 보기</button>
        </p>
      </template>
    </FlowLadder>
    <p v-else class="muted flow-none">덕트·배관 너머로 이어진 설비가 없습니다.</p>
    <!-- Revit 은 급기 계통을 가지마다 쪼개서, 관이 다른 계통으로 이어질 수 있다. 끊겼다고 단정하지 않고 몇 개인지만 적는다. -->
    <p v-if="flowMap.quiet.length" class="muted flow-quiet" :title="flowMap.quiet.join(', ')">설비로 이어지지 않는 계통 {{ flowMap.quiet.length }}개</p>
    <!-- 받는 곳·보내는 곳이 빈 까닭. 줄이 없으면 "덕트만 보인다" 로 읽혔다. -->
    <p v-for="g in flowMap.gaps" :key="g" class="flow-gap" data-testid="flow-gap">{{ g }}</p>
  </div>
</template>
