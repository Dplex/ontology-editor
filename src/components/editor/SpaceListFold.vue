<script setup lang="ts">
import type { PropType } from 'vue'
import { ROOM_KINDS, roomKind } from '../../lib/kinds'
import { replayMemo } from '../../lib/replay-player'
import { applyRename, applySpaceKind, EDIT_LIMIT, editLimit, editQuery, editSpaces, narrowed, SMALL, vKeepTyping } from '../../editor/edit-filter'
import { applyVertex } from '../../editor/keyboard'
import { startDraw } from '../../editor/place'
import { selectedSpaceId } from '../../editor/rooms'
import Fold from '../Fold.vue'
import Src from '../Src.vue'
import type { counts as countsRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()" title="물리존 이름·경계 (E1 · E2)" :meta="`${narrowed ? `찾은 것 ${editSpaces.length} / ` : ''}${counts.spaces}개`" :default-open="counts.spaces <= SMALL" :reveal="!!editQuery.trim() && editSpaces.length > 0">
    <p class="hint">
      3D에서 바닥을 클릭하면 오른쪽 패널에서도 고칠 수 있습니다. 꼭짓점을 고치면 넓이와 설비 소속이 다시 계산됩니다.
    </p>
    <div class="table-box">
      <table class="spaces-edit">
        <thead>
          <tr>
            <th>층</th>
            <th>이름</th>
            <th>종류</th>
            <th>방 번호</th>
            <th class="num">넓이</th>
            <th>꼭짓점 (x, y)</th>
          </tr>
        </thead>
        <tbody class="rows">
          <tr v-for="{ storey, space: sp } in editSpaces.slice(0, editLimit)" :key="sp.id" :class="{ chosen: sp.id === selectedSpaceId }">
            <td><span class="tag mono">{{ storey.name }}</span></td>
            <td>
              <input
                type="text"
                v-keep-typing
                :value="sp.longName"
                :aria-label="`${sp.name} 이름`"
                @change="applyRename(sp.id, ($event.target as HTMLInputElement).value)"
              />
            </td>
            <!-- 이름을 고치면 따라 바뀐다(renameSpace). 옆에 두어야 고친 자리에서 바로 보인다. 사람이 고르면 같은 공간명의 방에 함께
                 붙는다(OE-SPC-17) — 성수 `S.T` 95개처럼 되풀이되는 이름을 한 번에 고친다. -->
            <td class="space-kind">
              <select
                :aria-label="`${sp.name} 종류`"
                :value="sp.kindSource === 'edit' ? (sp.kind ?? '') : '__name'"
                @change="
                          applySpaceKind(sp.id, ($event.target as HTMLSelectElement).value === '__name' ? undefined : ($event.target as HTMLSelectElement).value || null)
                        "
              >
                <option value="__name">{{ sp.kindSource === 'edit' ? '이름으로 정하기' : (roomKind(sp.kind)?.label ?? '모름') }}</option>
                <option value="">모름</option>
                <option v-for="k in ROOM_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
              </select>
              <Src :kind="sp.kindSource === 'edit' ? 'edit' : sp.kindSource === 'bim' ? 'bim' : 'dict'" />
            </td>
            <td class="mono muted">{{ sp.name }}</td>
            <td class="num mono">{{ sp.areaM2.toFixed(1) }} ㎡</td>
            <td class="vertices">
              <!-- 닫는 점은 첫 점과 같으므로 보여 주지 않는다. 두 번 고치게 된다. -->
              <span v-for="(p, i) in sp.footprint.slice(0, -1)" :key="i" class="vertex">
                <input
                  class="coord mono"
                  type="number"
                  step="0.1"
                  v-keep-typing
                  :value="p[0]"
                  @change="applyVertex(sp.id, i, 0, ($event.target as HTMLInputElement).value, p)"
                />
                <input
                  class="coord mono"
                  type="number"
                  step="0.1"
                  v-keep-typing
                  :value="p[1]"
                  @change="applyVertex(sp.id, i, 1, ($event.target as HTMLInputElement).value, p)"
                />
              </span>
              <span v-if="!sp.footprint.length" class="muted">
                외곽선 없음 · <button type="button" class="link" @click="startDraw(sp.id)">3D에서 그리기</button>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="editSpaces.length > editLimit" class="hint more">
      {{ editLimit }}개만 표시합니다(전체 {{ editSpaces.length }}개). 층이나 이름으로 좁히거나
      <button type="button" class="link" @click="editLimit += EDIT_LIMIT">더 보기</button>
    </p>
  </Fold>
</template>
