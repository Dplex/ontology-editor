<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { zoneRoomLabel } from '../../editor/ceiling'
import { whatIs } from '../../editor/checks'
import { nameOfId } from '../../editor/connections'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { equipmentById } from '../../editor/flow-rules'
import { mergeZone, removeZone, renameZone, setZoneAliases, startCustomSplit } from '../../editor/offset'
import { selectedCustomZoneId } from '../../editor/space-edit'
import { select } from '../../editor/systems'
import Src from '../Src.vue'
import type { selectedCustomZone as selectedCustomZoneRef } from '../../editor/space-edit'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  selectedCustomZone: { type: null as unknown as PropType<NonNullable<typeof selectedCustomZoneRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked custom-zone-picked">
    <div class="picked-head">
      <div>
        <h3>{{ selectedCustomZone.zone.name }}</h3>
        <dl class="stats facts">
          <div v-if="selectedCustomZone.zone.aliases?.length">
            <dt>다른 별명</dt>
            <dd data-testid="zone-aliases">{{ selectedCustomZone.zone.aliases.join(', ') }} <Src kind="edit" /></dd>
          </div>
          <div>
            <dt>커스텀존</dt>
            <dd>{{ selectedCustomZone.storey.name }} <Src kind="edit" /></dd>
          </div>
          <div>
            <dt>넓이</dt>
            <dd><b class="mono">{{ selectedCustomZone.areaM2.toFixed(1) }}</b> ㎡ <Src kind="calc" /></dd>
          </div>
          <div>
            <dt>포함 물리존</dt>
            <dd data-testid="zone-spaces">
              <!-- 방 번호를 같이 — 거울 대칭 세대는 이름이 같은 방이 둘이다(Duplex 의 Bathroom 1 A104·B104). -->
              <template v-if="selectedCustomZone.spaces.length">{{ selectedCustomZone.spaces.map(zoneRoomLabel).join(', ') }}</template>
              <span v-else class="muted">없음(방 바닥의 절반 넘게 덮는 방만)</span>
              <Src kind="calc" />
            </dd>
          </div>
          <div>
            <dt>포함 설비</dt>
            <dd data-testid="zone-equipment">{{ selectedCustomZone.equipment.length }}대 <Src kind="calc" /></dd>
          </div>
        </dl>
      </div>
      <div class="picked-actions">
        <button type="button" class="ghost" @click="selectedCustomZoneId = null">선택 해제</button>
      </div>
    </div>
    <label v-if="editing" class="space-name">
      이름
      <input type="text" data-testid="zone-name" v-keep-typing :value="selectedCustomZone.zone.name" @change="renameZone($event.target as HTMLInputElement)" />
    </label>
    <!-- 별명은 여러 개(ADR-0004). 첫 이름이 TTL rdfs:label, 여기 적은 것은 ex:alias 다. 쉼표로 가른다. -->
    <label v-if="editing" class="space-name">
      다른 별명
      <input
        type="text"
        data-testid="zone-aliases-input"
        v-keep-typing
        placeholder="쉼표로 여러 개 (예: 임원 구역, 경영진석)"
        :value="(selectedCustomZone.zone.aliases ?? []).join(', ')"
        @change="setZoneAliases($event.target as HTMLInputElement)"
      />
    </label>
    <p v-if="editing" class="space-tools">
      <button type="button" class="ghost" title="바닥에 선의 두 점을 찍어 둘로 나눕니다" @click="startCustomSplit">나누기</button>
      <label v-if="(selectedCustomZone.storey.customZones ?? []).length > 1">
        <select :value="''" aria-label="합칠 커스텀존" @change="mergeZone(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>합칠 커스텀존 고르기…</option>
          <option v-for="z in selectedCustomZone.storey.customZones!.filter((x) => x.id !== selectedCustomZone!.zone.id)" :key="z.id" :value="z.id">{{ z.name }}</option>
        </select>
      </label>
    </p>
    <p class="hint">
      TTL 에 brick:Zone 으로 나갑니다. 포함 물리존은 hasPart, 포함 설비는 이 존을 위치(hasLocation)로 하나 더 갖습니다. 공조존과는 같은 방을
      품는 것으로 이어집니다.
    </p>
    <ul v-if="selectedCustomZone.equipment.length" class="plain space-members">
      <li v-for="id in selectedCustomZone.equipment.slice(0, 12)" :key="id">
        <button type="button" class="link" @click="select(id)">{{ nameOfId(id) }}</button>
        <span class="muted">{{ equipmentById.get(id) ? whatIs(equipmentById.get(id)!)?.label : '' }}</span>
      </li>
    </ul>
    <p v-if="editing" class="danger-zone">
      <button type="button" class="ghost danger" @click="removeZone">커스텀존 지우기</button>
      <span class="muted">물리존·설비는 그대로입니다. Ctrl+Z 로 되돌립니다.</span>
    </p>
  </section>
</template>
