<script setup lang="ts">
import type { PropType } from 'vue'
import { FLOW_TYPES } from '../../lib/flow-type'
import { josa } from '../../lib/josa'
import { replayMemo } from '../../lib/replay-player'
import { startPipe } from '../../editor/background'
import { selectedLock } from '../../editor/ceiling'
import { editing } from '../../editor/core'
import { riserEndStorey, riserStorey, riserTargets, startBranch, startRiser } from '../../editor/cross-storey'
import { vKeepTyping } from '../../editor/edit-filter'
import { shortName } from '../../editor/equipment-shape'
import { makePipe, pipeDraft, pipeTargets } from '../../editor/manual-draw'
import { multiRange } from '../../editor/multi-view'
import { applyOffsetHeight, changeShaft, offsetDraft, offsetPlan, offsetShafts, offsetStoreys, offsetTarget, selectedShaft } from '../../editor/offset'
import { drawing } from '../../editor/space-objects'
import { multiView } from '../../editor/vertical'
import Src from '../Src.vue'
import type { model as modelRef } from '../../editor/core'
import type { selected as selectedRef } from '../../editor/flow-rules'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
  selected: { type: null as unknown as PropType<NonNullable<typeof selectedRef.value>>, required: true },
})
</script>

<template>
  <div v-memo="replayMemo()" v-if="editing && !selectedLock && !multiView && selected.position && selected.role !== 'segment'" class="pipe-draw" data-testid="pipe-draw">
    <h4 class="picked-sub">배관 그리기 <Src kind="edit" /></h4>
    <p class="pipe-draw-row">
      <label>
        끝
        <select v-model="pipeDraft.to" aria-label="배관 끝 대상">
          <option value="">고르세요…</option>
          <option v-for="t in pipeTargets" :key="t.id" :value="t.id">{{ t.name }} · {{ t.d.toFixed(1) }}m</option>
        </select>
      </label>
      <label>
        Flow Type
        <select v-model="pipeDraft.flowType" aria-label="배관 Flow Type">
          <option v-for="f in FLOW_TYPES" :key="f.code" :value="f.code">{{ f.code }} · {{ f.label }}</option>
        </select>
      </label>
      <label>
        계통
        <select v-model="pipeDraft.systemId" aria-label="배관 계통">
          <option value="auto">양 끝이 같은 계통이면 그 계통</option>
          <option value="none">계통 없음</option>
          <option v-for="sys in model?.systems ?? []" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
        </select>
      </label>
    </p>
    <p class="pipe-draw-row">
      <button type="button" class="ghost" :disabled="!pipeDraft.to" @click="makePipe([])">곧게 연결하기</button>
      <button type="button" class="ghost" :disabled="!pipeDraft.to" @click="startPipe">꺾임점 찍기</button>
      <span class="muted">흐름 방향은 정하지 않습니다. 확정 전 규칙 방향은 TTL feeds 에 나가지 않습니다.</span>
    </p>
  </div>

  <!-- 층간 배관 그리기(다중층 뷰, OE-ML-12·14 · OE-PIP-15). 같은 배관 그리기에 끝 대상을 보기 범위의 다른 층에서 고르고 꺾임점마다 높이를 정한다. -->
  <!-- 구간을 고르면 같은 칸이 층별 분기(OE-ML-13)가 된다: 첫 점이 구간 위의 분기 자리다. -->
  <div v-memo="replayMemo()" v-if="editing && multiView && selected.position" class="pipe-draw" :data-testid="selected.role === 'segment' ? 'branch-draw' : 'riser-draw'">
    <h4 class="picked-sub">{{ selected.role === 'segment' ? '분기 그리기' : '층간 배관 그리기' }} <Src kind="edit" /></h4>
    <p v-if="selected.role === 'segment'" class="hint">
      이 구간 위의 한 자리에 분기점(이음쇠)을 넣어 구간을 나누고, 그 층의 설비·배관까지 잇습니다. 구간 끝 5cm 안이면 끝의 이음쇠를 분기점으로 다시 씁니다(Flow Type·계통이 같을 때만). 매체·Flow Type·계통이 주 배관과 다르면 잇지 않습니다.
    </p>
    <p v-else class="hint">보기 범위의 다른 층 설비·배관까지 잇습니다. 층을 지나는 구간은 수직으로만 찍고, 옆으로 옮기는 것은 수평 구간(오프셋)으로 찍습니다. 끝 설비는 옮기지 않습니다.</p>
    <p class="pipe-draw-row">
      <label>
        끝 층
        <select :value="riserEndStorey?.id" aria-label="층간 배관 끝 층" @change="(riserStorey = ($event.target as HTMLSelectElement).value), (pipeDraft.to = '')">
          <option v-for="st in multiRange ?? []" :key="st.id" :value="st.id">{{ st.name }}</option>
        </select>
      </label>
      <label>
        끝
        <select v-model="pipeDraft.to" aria-label="층간 배관 끝 대상">
          <option value="">고르세요…</option>
          <option v-for="t in riserTargets" :key="t.id" :value="t.id">{{ t.name }} · 수평 {{ t.d.toFixed(1) }}m</option>
        </select>
      </label>
      <label>
        Flow Type
        <select v-model="pipeDraft.flowType" aria-label="층간 배관 Flow Type">
          <option v-for="f in FLOW_TYPES" :key="f.code" :value="f.code">{{ f.code }} · {{ f.label }}</option>
        </select>
      </label>
      <label>
        계통
        <select v-model="pipeDraft.systemId" aria-label="층간 배관 계통">
          <option value="auto">{{ selected.role === 'segment' ? '주 배관의 계통' : '양 끝이 같은 계통이면 그 계통' }}</option>
          <option value="none">계통 없음</option>
          <option v-for="sys in model?.systems ?? []" :key="sys.id" :value="sys.id">{{ sys.name || sys.id }}</option>
        </select>
      </label>
    </p>
    <p class="pipe-draw-row">
      <button v-if="selected.role === 'segment'" type="button" class="ghost" :disabled="!pipeDraft.to || !!drawing" @click="startBranch">분기 그리기</button>
      <button v-else type="button" class="ghost" :disabled="!pipeDraft.to || !!drawing" @click="startRiser">경로 찍기</button>
      <span class="muted">흐름 방향은 정하지 않습니다.</span>
    </p>
    <!-- 오프셋 높이(OE-ML-14). 수평 구간이면 양 끝 꺾임점과 같이 올리거나 내린다. 바꾸기 전에 움직일 것을 보인다. -->
    <template v-if="offsetTarget">
      <h4 class="picked-sub">오프셋 높이 <Src kind="edit" /></h4>
      <form class="pipe-draw-row" data-testid="offset-height" @submit.prevent="applyOffsetHeight">
        <select :value="offsetTarget.storeyId" aria-label="오프셋 층" @change="offsetDraft = { ...offsetTarget!, storeyId: ($event.target as HTMLSelectElement).value }">
          <!-- 지금 오프셋이 있는 층은 보기 범위 밖이어도 넣는다. 빠지면 고른 것이 없는 빈칸이 된다. -->
          <option v-for="st in offsetStoreys" :key="st.id" :value="st.id">{{ st.name }}</option>
        </select>
        바닥에서
        <input v-keep-typing type="number" step="0.1" class="riser-height" :value="offsetTarget.height" aria-label="오프셋 높이(m)" @change="offsetDraft = { ...offsetTarget!, height: Number(($event.target as HTMLInputElement).value) }" />
        m
        <button type="submit" class="ghost" :disabled="!offsetPlan || 'refused' in offsetPlan">높이 바꾸기</button>
      </form>
      <p v-if="offsetPlan && 'refused' in offsetPlan" class="edit-warn" data-testid="offset-refused">{{ offsetPlan.refused }}</p>
      <p v-else-if="offsetPlan" class="hint" data-testid="offset-impact">
        바꾸면 꺾임점 {{ offsetPlan.fittings.map((f) => shortName(f.name)).join('·') }}{{ josa(shortName(offsetPlan.fittings.at(-1)!.name), '이/가') }} 같이 {{ offsetPlan.delta[2] > 0 ? '오르고' : '내려가고' }}({{ Math.abs(offsetPlan.delta[2]).toFixed(2) }}m), 구간
        {{ new Set(offsetPlan.stretch.map((x) => x.id)).size }}개가 늘거나 줄어듭니다{{ offsetPlan.branches.length ? ` · 분기점 ${offsetPlan.branches.map((f) => shortName(f.name)).join('·')}도 같이 움직입니다` : '' }}. 연결은 그대로입니다.
        <template v-if="offsetShafts.length"> 샤프트에 든 구간 {{ offsetShafts.map((x) => `${shortName(x.segment)}(${x.shaft})`).join('·') }}도 같이 늘어나며 소속은 그대로입니다.</template>
      </p>
    </template>
    <!-- 샤프트 소속(OE-ML-09·14). 두 끝이 샤프트 축 안인 구간만 넣는다. 위치만 겹쳐서는 붙이지 않는다. -->
    <template v-if="selected.role === 'segment' && selectedShaft">
      <h4 class="picked-sub">샤프트 <Src kind="edit" /></h4>
      <p class="pipe-draw-row" data-testid="segment-shaft">
        <select :value="selectedShaft.current?.id ?? ''" aria-label="샤프트 소속" @change="changeShaft(($event.target as HTMLSelectElement).value)">
          <option value="">넣지 않음</option>
          <option v-if="selectedShaft.deviated" :value="selectedShaft.current!.id">{{ selectedShaft.current!.name }}(축 밖)</option>
          <option v-for="o in selectedShaft.candidates" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
      </p>
      <p v-if="selectedShaft.deviated" class="edit-warn" data-testid="shaft-deviated">샤프트 {{ selectedShaft.current!.name }}의 축을 벗어났습니다(이탈). 배관을 축 안으로 옮기거나 소속을 풉니다.</p>
    </template>
  </div>
</template>
