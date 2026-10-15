<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { applyObjectName, applyObjectSize, removeObject, selectedObjectId } from '../../editor/space-objects'
import Src from '../Src.vue'
import type { selectedObject as selectedObjectRef } from '../../editor/space-objects'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  selectedObject: { type: null as unknown as PropType<NonNullable<typeof selectedObjectRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked object-picked">
    <div class="picked-head">
      <div>
        <h3>{{ selectedObject.object.name }}</h3>
        <dl class="stats facts">
          <div>
            <dt>오브젝트</dt>
            <dd>{{ selectedObject.item?.name ?? selectedObject.object.item }} · {{ selectedObject.storey.name }} <Src kind="edit" /></dd>
          </div>
          <div>
            <dt>자리</dt>
            <dd class="mono">{{ selectedObject.object.at[0].toFixed(2) }}, {{ selectedObject.object.at[1].toFixed(2) }}</dd>
          </div>
          <div v-if="!editing">
            <dt>크기</dt>
            <dd><b class="mono">{{ selectedObject.object.size.map((v) => v.toFixed(2)).join(' × ') }}</b> m</dd>
          </div>
        </dl>
      </div>
      <div class="picked-actions">
        <button type="button" class="ghost" @click="selectedObjectId = null">선택 해제</button>
      </div>
    </div>
    <template v-if="editing">
      <label class="space-name">
        이름
        <input type="text" data-testid="object-name" v-keep-typing :value="selectedObject.object.name" @change="applyObjectName(($event.target as HTMLInputElement).value)" />
      </label>
      <div class="object-size" data-testid="object-size">
        <label v-for="(label, axis) in ['가로', '세로', '높이']" :key="label">
          {{ label }}
          <input
            type="number"
            step="0.05"
            min="0.05"
            :data-testid="`object-size-${axis}`"
            :value="selectedObject.object.size[axis]"
            @change="applyObjectSize(axis as 0 | 1 | 2, $event.target as HTMLInputElement)"
            @keydown.enter="applyObjectSize(axis as 0 | 1 | 2, $event.target as HTMLInputElement)"
          />
          m
        </label>
      </div>
      <p class="hint">끌거나 방향키로 옮깁니다(Shift 1m). 다른 오브젝트와 겹치는 자리로는 옮기거나 키울 수 없습니다.</p>
      <p class="danger-zone">
        <button type="button" class="ghost danger" @click="removeObject">오브젝트 지우기</button>
        <span class="muted">Delete · Ctrl+Z 로 되돌립니다.</span>
      </p>
    </template>
  </section>
</template>
