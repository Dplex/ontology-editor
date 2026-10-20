<script setup lang="ts">
import type { PropType } from 'vue'
import { ZONE_SERVE_COLOR, ZONE_SERVE_LABEL } from '../../lib/idf/zone-view'
import { replayMemo } from '../../lib/replay-player'
import { SMALL } from '../../editor/edit-filter'
import { confirmZoneMatches, idfPlacementForm, idfReport, placeIdf, selectedZoneId, selectZone, ZONE_LIMIT, zoneLegend } from '../../editor/idf-zones'
import Fold from '../Fold.vue'
import Src from '../Src.vue'
import type { model as modelRef } from '../../editor/core'
import type { zoneRows as zoneRowsRef } from '../../editor/idf-zones'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
  zoneRows: { type: null as unknown as PropType<NonNullable<typeof zoneRowsRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()" title="공조존 (IDF)" :meta="`${zoneRows.length}개 · ${model.hvac!.source}`" :default-open="zoneRows.length <= SMALL">
    <p class="hint">
      IDF 의 Zone 이 공조존입니다. 시뮬레이션의 열 존이라 방과 단위가 달라서, 겹친 방을 몫과 함께 모두 적고 방 바닥의 절반 넘게를 덮으면
      그 방을 존의 일부로 둡니다. 담당은 존 설비 목록 → 말단 → 공조기(급기 분기)·실외기(실내기 목록)로 잇습니다. IDF 설비는 BIM 설비와
      이름 → 존 안의 같은 종류 → 같은 층에 하나뿐인 같은 종류 순으로 잇습니다
      (IDF 설비 {{ idfReport?.equipment ?? model.hvac!.equipment.length }}대 중 {{ idfReport?.matchedEquipment ?? model.hvac!.equipment.filter((e) => e.bimId || e.bimIds).length }}대<template v-if="idfReport"
        >: 이름 {{ idfReport.byName }} · 존 {{ idfReport.byZone }}(BIM {{ idfReport.bimInZones }}대) · 층 {{ idfReport.byStorey }}</template
      >). 바닥면 넓이는 IDF 가 적은 넓이보다 큰 것이 보통입니다(DesignBuilder 는 순 넓이를 적고 바닥면은 벽 중심선까지 그립니다).
    </p>
    <!-- IDF 평면을 BIM 에 놓은 법(idf/place.ts). 찾은 값을 보이고 사람이 고친다. -->
    <form v-if="idfPlacementForm && idfReport?.placement" class="idf-placement" data-testid="idf-placement" @submit.prevent="placeIdf({ ...idfPlacementForm })">
      <span>IDF 위치 <Src :kind="idfReport.placement.source === 'edit' ? 'edit' : 'calc'" /></span>
      <label>x <input v-model.number="idfPlacementForm.dx" type="number" step="0.01" aria-label="IDF x 이동(m)" /> m</label>
      <label>y <input v-model.number="idfPlacementForm.dy" type="number" step="0.01" aria-label="IDF y 이동(m)" /> m</label>
      <label>
        회전
        <select v-model.number="idfPlacementForm.rotation" aria-label="IDF 회전">
          <option :value="0">0°</option>
          <option :value="90">90°</option>
          <option :value="180">180°</option>
          <option :value="270">270°</option>
        </select>
      </label>
      <small v-if="idfReport.placement.overlap !== null">기준층 존 넓이의 {{ Math.round(idfReport.placement.overlap * 100) }}% 가 방과 겹침</small>
      <button type="submit" class="ghost">다시 얹기</button>
      <button v-if="idfReport.placement.source === 'edit'" type="button" class="ghost" @click="placeIdf(null)">자동으로</button>
    </form>
    <p class="zone-legend" data-testid="zone-legend">
      <span v-for="l in zoneLegend" :key="l.key"><i :style="{ background: l.color }" />{{ l.label }} {{ l.count }}</span>
      <small>줄을 누르면 그 층의 3D·평면도에서 공조존과 담당 BIM 기기를 짚습니다.</small>
    </p>
    <!-- 존↔물리존 매칭 확인(OE-ZON-07). 든 방은 계산한 초안이라 확인한 것만 TTL·GeoJSON 에 나간다. 설비↔존 담당은 IDF 가 적은 값이라 확인 없이 나간다(D13). -->
    <p class="zone-confirm" data-testid="zone-confirm">
      존↔물리존 매칭 {{ zoneRows.reduce((n, z) => n + z.match.confirmed, 0) }} / {{ zoneRows.reduce((n, z) => n + z.match.total, 0) }}쌍 확인 <Src kind="calc" />
      <small>확인한 매칭만 온톨로지에 나갑니다.</small>
      <button type="button" class="ghost" data-testid="zone-confirm-all" @click="confirmZoneMatches(null, true)">모두 확인</button>
      <button type="button" class="ghost" @click="confirmZoneMatches(null, false)">모두 풀기</button>
    </p>
    <div class="table-box">
      <table class="equipment zones">
        <thead>
          <tr><th>공조존</th><th>층</th><th class="num">바닥면 ㎡</th><th class="num">IDF ㎡</th><th>포함 공간</th><th>확인</th><th>겹친 공간</th><th>말단</th><th class="num">IDF 풍량 CMH</th><th>원천</th></tr>
        </thead>
        <tbody>
          <tr
            v-for="z in zoneRows.slice(0, ZONE_LIMIT)"
            :key="z.id"
            :class="['pickable', { chosen: z.id === selectedZoneId }]"
            :data-zone-row="z.id"
            @click="selectZone(z.id)"
          >
            <td><i class="zone-swatch" :style="{ background: ZONE_SERVE_COLOR[z.serve] }" :title="ZONE_SERVE_LABEL[z.serve]" />{{ z.name }}</td>
            <td>{{ z.storey }}</td>
            <td class="num mono">{{ z.area.toFixed(1) }}</td>
            <td class="num mono">{{ z.declared?.toFixed(1) ?? '' }}</td>
            <td :title="z.spaces.join(', ')">{{ z.spaces.length ? z.spaces.slice(0, 3).join(', ') + (z.spaces.length > 3 ? ` 외 ${z.spaces.length - 3}` : '') : '' }}</td>
            <td class="zone-match" @click.stop>
              <template v-if="z.match.total">
                <button
                  type="button"
                  class="ghost"
                  :data-testid="`zone-match-${z.id}`"
                  :title="z.match.confirmed === z.match.total ? '확인을 풉니다' : '이 존의 포함 공간 매칭을 확인합니다'"
                  @click="confirmZoneMatches(z.id, z.match.confirmed !== z.match.total)"
                >
                  {{ z.match.confirmed === z.match.total ? '✓ 확인함' : '확인' }} {{ z.match.confirmed }}/{{ z.match.total }}
                </button>
              </template>
            </td>
            <td :title="z.overlaps.join(', ')">{{ z.overlaps.length ? z.overlaps.slice(0, 2).join(', ') + (z.overlaps.length > 2 ? ` 외 ${z.overlaps.length - 2}` : '') : '' }}</td>
            <td :title="z.terminals.join(', ')">{{ z.terminals.slice(0, 2).join(', ') }}{{ z.terminals.length > 2 ? ` 외 ${z.terminals.length - 2}` : '' }}</td>
            <td class="num mono">{{ z.airflow?.toFixed(0) ?? '' }}</td>
            <td :title="z.sources.join(', ')">{{ z.sources.join(', ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="zoneRows.length > ZONE_LIMIT" class="hint">{{ ZONE_LIMIT }}개만 보입니다.</p>
  </Fold>
</template>
