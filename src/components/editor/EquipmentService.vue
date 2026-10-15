<script setup lang="ts">
import type { PropType } from 'vue'
import { CAPACITY_CHECK_KINDS, cmhText } from '../../lib/airflow'
import { replayMemo } from '../../lib/replay-player'
import { selectedLock } from '../../editor/ceiling'
import { servedAll, servedView } from '../../editor/checks'
import { editing } from '../../editor/core'
import { spaceNameOf } from '../../editor/edit-report'
import { selectedService } from '../../editor/flow-map'
import { hasRules, showRules } from '../../editor/flow-rules'
import { addZoneServed, applyRatedAirflow, makeZoneForSelected, removeZoneServed, selectedZones } from '../../editor/offset'
import Src from '../Src.vue'
import type { counts as countsRef } from '../../editor/core'
import type { selected as selectedRef } from '../../editor/flow-rules'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  selected: { type: null as unknown as PropType<NonNullable<typeof selectedRef.value>>, required: true },
})
</script>

<template>
  <div v-memo="replayMemo()" v-if="selected.ratedAirflow || (editing && CAPACITY_CHECK_KINDS.has(selected.kind ?? ''))" class="rated-airflow" data-testid="rated-airflow">
    <h4 class="picked-sub">
      정격 풍량
      <template v-if="selected.ratedAirflow?.source === 'bim'">
        <b class="mono">{{ cmhText(selected.ratedAirflow.cmh) }}</b> CMH <Src kind="bim" />
        <span class="muted">{{ selected.ratedAirflow.property }}</span>
      </template>
      <template v-else-if="editing && !selectedLock">
        <input type="number" min="0" step="any" class="airflow-input" :value="selected.ratedAirflow?.cmh ?? ''" aria-label="정격 풍량(CMH)" @change="applyRatedAirflow(selected, $event)" />
        CMH <Src v-if="selected.ratedAirflow" kind="edit" />
      </template>
      <template v-else-if="selected.ratedAirflow">
        <b class="mono">{{ cmhText(selected.ratedAirflow.cmh) }}</b> CMH <Src kind="edit" />
      </template>
      <span v-else class="muted">없음 — 담당 공조존의 용량 검증(Z-03)이 판정 불가입니다</span>
    </h4>
  </div>

  <!-- 담당 공조존(OE-ZON-01). 공조존 목록의 담당 설비와 같은 값을 설비 쪽에서 고친다. 보기 모드에서는 담당하는 공조존이 있을 때만. -->
  <div v-memo="replayMemo()" v-if="selectedZones && (editing ? !selectedLock : selectedZones.serving.length)" class="served-zones" data-testid="served-zones">
    <h4 class="picked-sub">
      담당 공조존 <span class="muted">{{ selectedZones.serving.length }}</span> <Src kind="edit" />
    </h4>
    <p class="zone-served">
      <template v-for="z in selectedZones.serving" :key="z.id">
        <button v-if="editing" type="button" class="chip" :title="`${z.name} 담당에서 빼기`" @click="removeZoneServed(z.id, selectedZones.storeyId, selected.id, z.servedBy ?? [])">{{ z.name }} ×</button>
        <span v-else class="chip">{{ z.name }}</span>
      </template>
      <template v-if="editing">
        <select v-if="selectedZones.others.length" :value="''" aria-label="담당할 공조존 더하기" @change="addZoneServed(($event.target as HTMLSelectElement).value, selectedZones.storeyId, selected.id, selectedZones.others.find((z) => z.id === ($event.target as HTMLSelectElement).value)?.servedBy ?? [])">
          <option value="">공조존 더하기…</option>
          <option v-for="z in selectedZones.others" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
        <button v-if="selectedZones.flow.length" type="button" class="ghost" @click="makeZoneForSelected">
          흐름이 닿는 물리존으로 새 공조존 ({{ selectedZones.flow.map((id) => spaceNameOf(id)).join(', ') }})
        </button>
        <span v-else-if="!selectedZones.serving.length" class="muted">
          흐름이 닿는 말단이 없습니다. 담당 물리존은 아래 "공조존" 에서 골라 공조존을 만듭니다.
        </span>
      </template>
    </p>
  </div>

  <!-- 담당 공간. 공기 원천을 골랐을 때만 뜬다. 계통도가 묻는 "이 공조기가 담당하는 방" 의 근사다.
       병원 공조기 하나가 방 150개에 닿아 패널이 8,000px 이 됐었다. 층으로 묶고 말단이 많은 방부터 몇 줄만 보인다. -->
  <div v-memo="replayMemo()" v-if="selectedService" class="served">
    <h4 class="picked-sub">
      담당 공간 <Src kind="calc" />
      <span class="muted">
        흐름을 따라 닿는 말단(디퓨저·그릴)이 있는 방입니다<template v-if="showRules && hasRules">(규칙 방향 포함 <Src kind="dict" />)</template>.
        추정값이라 내보내지 않습니다.
      </span>
    </h4>
    <p v-if="!selectedService.supply.length && !selectedService.extract.length" class="muted">
      흐름을 따라 닿는 말단이 없습니다. 방향을 모르는 연결에서 끊겼거나, 덕트 없이 방에 놓인 기기(카세트형 등)일 수 있습니다.
    </p>
    <template v-else>
      <p class="served-sum">
        방 <b>{{ selectedService.rooms.filter((r) => r.spaceId).length }}</b> ·
        급기 말단 <b class="downstream">{{ selectedService.supply.length }}</b> ·
        환기·배기 말단 <b class="upstream">{{ selectedService.extract.length }}</b>
      </p>
      <table>
        <thead>
          <tr>
            <th>방</th>
            <th class="num">급기</th>
            <th class="num">환기·배기</th>
          </tr>
        </thead>
        <tbody v-for="g in servedView.groups" :key="g.label">
          <tr class="group">
            <th colspan="3">{{ g.label }}</th>
          </tr>
          <tr v-for="r in g.rooms" :key="r.spaceId ?? '-'">
            <td :class="{ muted: !r.spaceId }">{{ r.spaceId ? spaceNameOf(r.spaceId) : '소속 방 없는 말단' }}</td>
            <td :class="['num', 'mono', r.supply ? 'downstream' : 'muted']">{{ r.supply || '·' }}</td>
            <td :class="['num', 'mono', r.extract ? 'upstream' : 'muted']">{{ r.extract || '·' }}</td>
          </tr>
        </tbody>
      </table>
      <button v-if="servedView.hidden" type="button" class="link more" @click="servedAll = true">
        나머지 {{ servedView.hidden }}개 더 보기
      </button>
    </template>
    <p v-if="selectedService.rooms.some((r) => !r.spaceId) && counts.spaces === 0" class="hint">
      이 파일에는 방이 없습니다. 건축 파일을 덧붙이면 방이 나옵니다.
    </p>
  </div>
</template>
