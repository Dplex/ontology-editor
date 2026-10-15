<script setup lang="ts">
import type { PropType } from 'vue'
import { vFlash } from '../../lib/motion'
import { replayMemo } from '../../lib/replay-player'
import { editing } from '../../editor/core'
import { BULK_MIN_CHECKED, bulkCandidates, bulkThreshold, confirmMatching, confirmRule } from '../../editor/flow-rules'
import { selectedSystemId } from '../../editor/kinds'
import { toggleSystem } from '../../editor/systems'
import Fold from '../Fold.vue'
import Meter from '../Meter.vue'
import Roll from '../Roll.vue'
import Src from '../Src.vue'
import type { ruleSystems as ruleSystemsRef } from '../../editor/flow-rules'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  ruleSystems: { type: null as unknown as PropType<NonNullable<typeof ruleSystemsRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()"
    title="규칙 방향 확정 (계통별)"
    :meta="`계통 ${ruleSystems.length}개 · 확정 ${ruleSystems.filter((r) => r.confirmed).length}개${ruleSystems.some((r) => r.recheck) ? ` · 재검토 ${ruleSystems.filter((r) => r.recheck).length}개` : ''}`"
    :default-open="false"
    class="rule-systems"
  >
    <p class="hint">
      <Src kind="dict" /> 계통 종류와 설비 종류로 추정한 방향입니다. 확정한 계통만 brick:feeds로 내보냅니다. 일치율은
      포트(BIM)에 방향이 있는 연결과 비교한 값이고, 비교할 연결이 없으면 비교 불가로 적습니다. 확정한 뒤 편집으로 근거가 바뀐
      방향은 재검토로 두고 다시 확정할 때까지 내보내지 않습니다. 이름을 누르면 3D에 그 계통만 표시합니다.
    </p>
    <p v-if="editing" class="bulk-confirm">
      <label>
        포트와
        <select v-model.number="bulkThreshold" aria-label="한꺼번에 확정할 일치율">
          <option :value="98">98%</option>
          <option :value="95">95%</option>
          <option :value="90">90%</option>
          <option :value="80">80%</option>
        </select>
        이상 맞는 계통
      </label>
      <button type="button" class="ghost" :disabled="!bulkCandidates.length" @click="confirmMatching">
        {{ bulkCandidates.length }}개 한꺼번에 확정
      </button>
      <span class="muted">대 본 연결이 {{ BULK_MIN_CHECKED }}개 이상인 계통만. 비교할 것이 없는 계통은 하나씩 확정합니다.</span>
    </p>
    <table>
      <thead>
        <tr>
          <th>계통 <Src kind="bim" /></th>
          <th>종류 <Src kind="dict" /></th>
          <th class="num">규칙 방향</th>
          <th class="num">포트와 일치</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in ruleSystems" :key="r.id" v-flash="`${r.confirmed}:${r.pct}:${r.count}`" :class="{ chosen: selectedSystemId === r.id }">
          <td class="sys">
            <i :style="{ background: r.color ?? 'transparent' }"></i>
            <button type="button" class="link" :aria-pressed="selectedSystemId === r.id" @click="toggleSystem(r.id)">
              {{ r.name }}
            </button>
          </td>
          <td :class="{ muted: !r.kind }">{{ r.kind || '모름' }}</td>
          <td class="num mono"><Roll :value="r.count" /></td>
          <td class="num mono">
            <template v-if="r.pct !== null">
              <b :class="{ low: r.pct < 80 }"><Roll :value="r.pct" />%</b> <span class="muted">{{ r.agree }}/{{ r.checked }}</span>
              <Meter :parts="[{ value: r.pct / 100, tone: r.pct < 80 ? 'warn' : 'accent' }]" :label="`포트와 일치 ${r.pct}%`" />
            </template>
            <span v-else class="muted">비교 불가</span>
          </td>
          <td class="rule-state">
            <span v-if="r.confirmed" class="confirmed">확정함</span>
            <template v-else-if="r.recheck">
              <span class="recheck">재검토 {{ r.recheck }}</span>
              <button v-if="editing" type="button" class="ghost" @click="confirmRule(r.id, r.name)">다시 확정</button>
            </template>
            <button v-else-if="editing" type="button" class="ghost" @click="confirmRule(r.id, r.name)">확정</button>
            <span v-else class="muted">편집 모드에서 확정</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="ruleSystems.some((r) => !r.confirmed && r.pct !== null && r.pct < 80)" class="hint">
      일치율이 80% 미만인 계통은 규칙이 잘 맞지 않습니다. 확정하기 전에 3D에서 흐름을 확인하세요.
    </p>
  </Fold>
</template>
