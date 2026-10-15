<script setup lang="ts">
import { BASIS_LABEL, cmhText } from '../../lib/airflow'
import { deleteHvacZone, renameHvacZone } from '../../lib/hvac-zone'
import { replayMemo } from '../../lib/replay-player'
import { whatIs } from '../../editor/checks'
import { nameOfId } from '../../editor/connections'
import { vKeepTyping } from '../../editor/edit-filter'
import { spaceNameOf } from '../../editor/edit-report'
import { shortName } from '../../editor/equipment-shape'
import { zoneActiveVertex, zoneVertexEdit } from '../../editor/grid-snap'
import { changeHvacZones, makeZoneFromPick, zonePick, zoneReveal, zonesHere, zoneStorey } from '../../editor/manual-draw'
import { addZoneServed, applyZoneAirflow, editZoneVertex, removeZoneServed, setZoneSpaceList, startHvacZone, startHvacZoneOutline, startZoneVertices, zoneAirflows, zoneCheckList, zoneEdited, zoneEquipmentChoices, zoneFlow } from '../../editor/offset'
import Fold from '../Fold.vue'
import Src from '../Src.vue'
</script>

<template>
  <Fold v-memo="replayMemo()" title="공조존" :meta="zoneStorey ? `${zoneStorey.name} · ${zonesHere.length}개` : '층을 고르세요'" :reveal="zoneReveal" class="hvac-zones" data-testid="hvac-zones">
    <p class="hint">
      공조존은 설비가 담당하는 구역입니다. 담당 물리존을 골라 만들면 그 물리존들이 담당이 되고, 한 물리존을 나눌 때는 경계를 그립니다(겹치는 물리존이 담당).
      담당 설비가 공조존을 공급하는 것으로 TTL 에 나갑니다.
    </p>
    <template v-if="zoneStorey">
      <ul class="plain zone-list">
        <li v-for="z in zonesHere" :key="z.id" :data-zone="z.id">
          <input
            type="text"
            v-keep-typing
            :value="z.name"
            :aria-label="`${z.name} 공조존 이름`"
            @change="changeHvacZones(zoneStorey!.id, '공조존 이름', (m) => renameHvacZone(m, z.id, ($event.target as HTMLInputElement).value))"
          />
          <span class="zone-served">
            담당 물리존
            <button
              v-for="id in z.spaceIds"
              :key="id"
              type="button"
              class="chip"
              :title="`${spaceNameOf(id)} 빼기`"
              @click="setZoneSpaceList(z.id, zoneStorey!.id, z.spaceIds.filter((x) => x !== id))"
            >
              {{ spaceNameOf(id) }}{{ z.drawn && z.spaceShares?.[id] !== undefined ? ` ${Math.round(z.spaceShares[id] * 100)}%` : '' }} ×
            </button>
            <select :value="''" :aria-label="`${z.name} 담당 물리존 더하기`" @change="setZoneSpaceList(z.id, zoneStorey!.id, [...z.spaceIds, ($event.target as HTMLSelectElement).value])">
              <option value="">더하기…</option>
              <option v-for="sp in zoneStorey!.spaces.filter((x) => !z.spaceIds.includes(x.id))" :key="sp.id" :value="sp.id">{{ sp.longName || sp.name || sp.id }}</option>
            </select>
            <span class="muted">· {{ z.areaM2.toFixed(1) }}㎡</span> <Src kind="edit" />
          </span>
          <span class="zone-served">
            담당 설비
            <button v-for="id in z.servedBy ?? []" :key="id" type="button" class="chip" :title="`${nameOfId(id)} 빼기`" @click="removeZoneServed(z.id, zoneStorey!.id, id, z.servedBy ?? [])">
              {{ shortName(nameOfId(id)) }} ×
            </button>
            <select :value="''" :aria-label="`${z.name} 담당 설비 더하기`" @change="addZoneServed(z.id, zoneStorey!.id, ($event.target as HTMLSelectElement).value, z.servedBy ?? [])">
              <option value="">더하기…</option>
              <option v-for="e in zoneEquipmentChoices.filter((x) => !(z.servedBy ?? []).includes(x.id))" :key="e.id" :value="e.id">
                {{ shortName(e.name) }}{{ whatIs(e) ? ` · ${whatIs(e)!.label}` : '' }}
              </option>
            </select>
          </span>
          <!-- 설계 풍량(OE-ZON-06). 담당 물리존의 BIM 값을 다 더할 수 있으면 그 합이고 고치지 않는다. 아니면 사람이 넣는다.
               용량 검증 Z-03 이 이 값을 담당 설비의 정격 풍량과 견준다. 값이 없으면 판정 불가(경고 아님)다. -->
          <span class="zone-served zone-airflow" :data-testid="`zone-airflow-${z.name}`">
            설계 풍량
            <template v-if="zoneAirflows.get(z.id)?.from === 'bim'">
              <b class="mono">{{ cmhText(zoneAirflows.get(z.id)!.cmh!) }}</b> CMH ({{ BASIS_LABEL[zoneAirflows.get(z.id)!.basis!] }}, 담당 물리존 합)
              <Src kind="bim" />
            </template>
            <template v-else>
              <label>냉방 <input type="number" min="0" step="any" class="airflow-input" :value="z.designAirflow?.cooling ?? ''" :aria-label="`${z.name} 냉방 설계 풍량(CMH)`" @change="applyZoneAirflow(z, 'cooling', $event)" /></label>
              <label>난방 <input type="number" min="0" step="any" class="airflow-input" :value="z.designAirflow?.heating ?? ''" :aria-label="`${z.name} 난방 설계 풍량(CMH)`" @change="applyZoneAirflow(z, 'heating', $event)" /></label>
              CMH
              <span v-if="zoneAirflows.get(z.id)?.from" class="muted">
                → {{ cmhText(zoneAirflows.get(z.id)!.cmh!) }} CMH({{ BASIS_LABEL[zoneAirflows.get(z.id)!.basis!] }}{{ zoneAirflows.get(z.id)!.from === 'spaces' ? ', 담당 물리존 합' : '' }})
                <Src kind="edit" />
              </span>
              <span v-else class="muted">판정 불가 — {{ zoneAirflows.get(z.id)?.missing }}</span>
            </template>
          </span>
          <!-- 연결 기준 후보(OE-MAP-02). 담당을 대신 정하지 않고, 빠진 방을 한 번에 더하게만 한다. -->
          <span v-if="zoneFlow.get(z.id)" class="zone-served zone-flow" :data-testid="`zone-flow-${z.name}`">
            흐름이 닿는 물리존
            <template v-for="id in zoneFlow.get(z.id)" :key="id">
              <span v-if="z.spaceIds.includes(id)" class="muted">{{ spaceNameOf(id) }} ✓</span>
              <button v-else type="button" class="chip candidate" :title="`${spaceNameOf(id)}을 담당 물리존에 더하기`" @click="setZoneSpaceList(z.id, zoneStorey!.id, [...z.spaceIds, id])">
                + {{ spaceNameOf(id) }}
              </button>
            </template>
            <Src kind="calc" />
          </span>
          <button v-if="zoneVertexEdit !== z.id" type="button" class="ghost" :disabled="z.footprint.length !== 1" :title="z.footprint.length !== 1 ? '떨어진 조각이 있는 공조존은 [경계 다시 그리기] 로 고칩니다' : '3D 의 손잡이를 끌어 옮깁니다'" @click="startZoneVertices(z)">꼭짓점 고치기</button>
          <span v-else class="vertex-tools">
            <span>{{ zoneActiveVertex === null ? '손잡이를 끌거나 [ ]로 짚습니다' : `꼭짓점 ${zoneActiveVertex + 1}/${zoneEdited?.corners.length}` }}</span>
            <button type="button" class="ghost" :disabled="zoneActiveVertex === null" title="다음 꼭짓점과의 가운데에 넣습니다 (Insert)" @click="editZoneVertex('insert')">꼭짓점 넣기</button>
            <button type="button" class="ghost" :disabled="zoneActiveVertex === null || (zoneEdited?.corners.length ?? 0) <= 3" title="Delete" @click="editZoneVertex('delete')">꼭짓점 지우기</button>
            <button type="button" class="ghost" @click="zoneVertexEdit = null">마치기</button>
          </span>
          <button type="button" class="ghost" @click="startHvacZoneOutline(z)">경계 다시 그리기</button>
          <button type="button" class="ghost danger" @click="changeHvacZones(zoneStorey!.id, '공조존 지우기', (m) => deleteHvacZone(m, z.id))">지우기</button>
        </li>
        <li v-if="!zonesHere.length" class="muted">이 층에 만든 공조존이 없습니다.</li>
      </ul>
      <!-- 공조존 검증(OE-ZON-05). 경고만 하고 막지 않는다. Z-03 판정 불가는 경고가 아니라 따로 센다(값이 없다). -->
      <ul v-if="zoneCheckList" class="plain zone-checks" data-testid="zone-checks">
        <li v-for="c in zoneCheckList.checks" :key="`${c.rule}${c.undetermined ? '?' : ''}`" :class="{ warn: c.items.length && !c.undetermined }">
          <b>{{ c.rule }}</b> {{ c.text }}:
          <template v-if="c.items.length">
            {{ c.items.length }}개 — {{ c.items.slice(0, 5).map((x) => x.label).join(', ') }}<template v-if="c.items.length > 5"> 외 {{ c.items.length - 5 }}개</template>
          </template>
          <span v-else class="muted">없음</span>
        </li>
        <li v-if="zoneCheckList.untouched.length" class="muted">공조존이 아직 없는 층은 Z-01 을 세지 않습니다: {{ zoneCheckList.untouched.join(', ') }}</li>
      </ul>
      <div class="zone-make">
        <span>담당 물리존을 골라 만들기</span>
        <label v-for="sp in zoneStorey.spaces" :key="sp.id" class="zone-pick">
          <input v-model="zonePick" type="checkbox" :value="sp.id" />
          {{ sp.longName || sp.name || sp.id }}
        </label>
        <button type="button" :disabled="!zonePick.length" @click="makeZoneFromPick">고른 물리존으로 만들기</button>
        <button type="button" class="ghost" @click="startHvacZone">경계를 그려 만들기</button>
      </div>
    </template>
  </Fold>
</template>
