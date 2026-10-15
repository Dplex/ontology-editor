<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { selectAndShow } from '../../editor/chat-view'
import { SERVICE_LIMIT } from '../../editor/checks'
import { selectedId } from '../../editor/flow-rules'
import Fold from '../Fold.vue'
import Src from '../Src.vue'
import type { serviceSummary as serviceSummaryRef } from '../../editor/checks'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  serviceSummary: { type: null as unknown as PropType<NonNullable<typeof serviceSummaryRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()"
    title="담당 공간"
    :meta="`공기 원천 ${serviceSummary.rows.length}대 · 말단에 닿는 것 ${serviceSummary.reaching}대`"
    :default-open="false"
    class="service"
  >
    <p class="hint">
      <Src kind="calc" /> 원천에서 흐름을 따라 말단까지 가서, 말단이 있는 방을 모았습니다. 급기는 하류, 환기·배기는 상류로
      찾고 다른 원천을 만나면 멈춥니다. 추정값이라 TTL로 내보내지 않습니다.
    </p>
    <table>
      <thead>
        <tr>
          <th>원천</th>
          <th>종류 <Src kind="dict" /></th>
          <th class="num">급기 말단</th>
          <th class="num">환기·배기 말단</th>
          <th>방</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in serviceSummary.rows.slice(0, SERVICE_LIMIT)" :key="r.id" :class="{ chosen: r.id === selectedId }">
          <td><button type="button" class="link" @click="selectAndShow(r.id)">{{ r.name }}</button></td>
          <td class="muted">{{ r.kind }}</td>
          <td :class="['num', 'mono', r.supply ? 'downstream' : 'muted']">{{ r.supply || '·' }}</td>
          <td :class="['num', 'mono', r.extract ? 'upstream' : 'muted']">{{ r.extract || '·' }}</td>
          <td class="names" :title="r.rooms.join(', ')">
            <template v-if="r.rooms.length">{{ r.rooms.length }}개 · {{ r.rooms.join(', ') }}</template>
            <span v-else class="muted">—</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="serviceSummary.rows.length > SERVICE_LIMIT" class="hint">
      말단이 많은 {{ SERVICE_LIMIT }}대만 표시합니다(전체 {{ serviceSummary.rows.length }}대).
    </p>
  </Fold>
</template>
