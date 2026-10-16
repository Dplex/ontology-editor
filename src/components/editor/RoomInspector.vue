<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { applyRoomName, removeRoom, selectedRoomId } from '../../editor/rooms'
import Src from '../Src.vue'
import type { selectedRoom as selectedRoomRef } from '../../editor/rooms'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  selectedRoom: { type: null as unknown as PropType<NonNullable<typeof selectedRoomRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked room-picked">
    <div class="picked-head">
      <div>
        <h3>{{ selectedRoom.room.name }}</h3>
        <dl class="stats facts">
          <div>
            <dt>룸</dt>
            <dd>{{ selectedRoom.storey.name }} · {{ selectedRoom.parent ? selectedRoom.parent.longName || selectedRoom.parent.name : '물리존 모름' }} 안 <Src kind="edit" /></dd>
          </div>
          <div>
            <dt>크기</dt>
            <dd data-testid="room-size"><b class="mono">{{ selectedRoom.width.toFixed(2) }} × {{ selectedRoom.depth.toFixed(2) }}</b> m <Src kind="edit" /></dd>
          </div>
        </dl>
      </div>
      <div class="picked-actions">
        <button type="button" class="ghost" @click="selectedRoomId = null">선택 해제</button>
      </div>
    </div>
    <label v-if="editing" class="space-name">
      이름
      <input type="text" data-testid="room-name" v-keep-typing :value="selectedRoom.room.name" @change="applyRoomName(($event.target as HTMLInputElement).value)" />
    </label>
    <p v-if="editing" class="hint">꼭짓점 손잡이를 드래그해 크기를, 방향키로 자리를 바꿉니다(Shift 1m). 물리존 밖으로 나가거나 다른 룸과 겹칠 수 없습니다.</p>
    <p v-if="editing" class="danger-zone">
      <button type="button" class="ghost danger" @click="removeRoom">룸 지우기</button>
      <span class="muted">그 자리는 물리존으로 돌아갑니다. Ctrl+Z 로 되돌립니다.</span>
    </p>
  </section>
</template>
