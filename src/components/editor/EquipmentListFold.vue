<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { isMultiSelect } from '../../lib/shortcuts'
import { selectAndShow } from '../../editor/chat-view'
import { whatIs } from '../../editor/checks'
import { editing } from '../../editor/core'
import { EDIT_LIMIT, editEquipment, editLimit, editQuery, narrowed, SMALL, vKeepTyping } from '../../editor/edit-filter'
import { locationOf } from '../../editor/edit-report'
import { applyMove, mmOf, positionDrafts } from '../../editor/equipment-shape'
import { selectedId } from '../../editor/flow-rules'
import { positionSrc, spaceSrc } from '../../editor/kinds'
import { group, toggleGroup } from '../../editor/multi-select'
import Fold from '../Fold.vue'
import Src from '../Src.vue'
import type { counts as countsRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()"
    :title="editing ? '설비 위치와 소속 (E5 · E6)' : '설비 목록'"
    :meta="`${narrowed ? `찾은 것 ${editEquipment.length} / ` : ''}기기 ${counts.devices} · 덕트·배관 ${counts.conduits}`"
    :default-open="counts.equipment <= SMALL"
    :reveal="!!editQuery.trim() && editEquipment.length > 0"
  >
    <div class="table-box">
    <table class="equipment">
      <thead>
        <tr>
          <th>설비</th>
          <th>종류</th>
          <th class="num">x</th>
          <th class="num">y</th>
          <th class="num">z</th>
          <th></th>
          <th>소속 물리존</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in editEquipment.slice(0, editLimit)" :key="e.id" :class="{ chosen: e.id === selectedId || group.includes(e.id) }">
          <td>
            <!-- 표에서 고른 것과 3D 에서 고른 것이 같은 선택이다. 두 화면이 따로 놀면
                 설비 목록에서 찾은 것을 3D 에서 다시 찾아야 한다. -->
            <button type="button" class="link" @click="editing && isMultiSelect($event) ? toggleGroup(e.id) : selectAndShow(e.id)">{{ e.name || e.ifcClass }}</button>
          </td>
          <td class="muted">
            {{ e.ifcClass }}<template v-if="whatIs(e)"> · {{ whatIs(e)!.label }} <Src :kind="whatIs(e)!.src" /></template>
          </td>
          <td v-for="axis in [0, 1, 2]" :key="axis" class="num">
            <span v-if="!editing" class="mono">{{ e.position ? e.position[axis].toFixed(2) : '—' }}</span>
            <input
              v-else
              class="coord mono"
              type="number"
              step="0.1"
              v-keep-typing
              :value="e.position ? mmOf(e.position[axis]) : (positionDrafts.get(e.id)?.[axis] ?? '')"
              placeholder="—"
              @change="applyMove(e.id, axis as 0 | 1 | 2, ($event.target as HTMLInputElement).value, e.position, $event.target as HTMLInputElement)"
            />
          </td>
          <!-- 좌표 출처. 배치점이 형상에서 떨어져 형상 중심을 쓴 것(계산)과 사람이 옮긴 것(편집)을 가른다. -->
          <td><Src v-if="e.position" :kind="positionSrc(e)" /></td>
          <td :class="{ muted: !e.spaceId }">
            {{ locationOf(e) }}
            <Src v-if="e.spaceId" :kind="spaceSrc(e)" />
            <small v-if="editing && positionDrafts.has(e.id)" class="draft-note">x·y·z를 모두 넣어야 옮겨집니다</small>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
    <p v-if="editEquipment.length > editLimit" class="hint more">
      {{ editLimit }}대만 표시합니다(전체 {{ editEquipment.length }}대). 층이나 이름으로 좁히거나
      <button type="button" class="link" @click="editLimit += EDIT_LIMIT">더 보기</button>
    </p>
    <p v-if="counts.equipment === 0" class="empty">이 BIM에는 설비가 없습니다.</p>
    <p v-else-if="editEquipment.length === 0" class="empty">
      {{ editQuery.trim() ? `"${editQuery.trim()}"에 맞는 설비가 없습니다(이름·종류·소속 방 이름으로 찾습니다).` : '이 층에는 설비가 없습니다.' }}
    </p>
  </Fold>
</template>
