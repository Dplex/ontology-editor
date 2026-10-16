<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { whatIs } from '../../editor/checks'
import { shortName } from '../../editor/equipment-shape'
import { deleteGroup, group, storeyOf } from '../../editor/multi-select'
import { select } from '../../editor/systems'
import type { groupItems as groupItemsRef } from '../../editor/multi-select'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  groupItems: { type: null as unknown as PropType<NonNullable<typeof groupItemsRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked group-picked">
    <div class="picked-head">
      <div>
        <h3>설비 {{ groupItems.length }}대 고름</h3>
        <p class="stats">{{ [...new Set(groupItems.map((e) => storeyOf(e.id)?.name ?? ''))].filter(Boolean).join(' · ') }}</p>
      </div>
      <div class="picked-actions">
        <button type="button" class="ghost" @click="group = []">선택 해제</button>
      </div>
    </div>
    <ul class="group-list">
      <li v-for="e in groupItems.slice(0, 12)" :key="e.id">
        <button type="button" class="link" :title="'이 설비만 고르기'" @click="select(e.id)">{{ shortName(e.name) }}</button>
        <span v-if="whatIs(e)" class="muted"> {{ whatIs(e)!.label }}</span>
      </li>
      <li v-if="groupItems.length > 12" class="muted">외 {{ groupItems.length - 12 }}대</li>
    </ul>
    <p class="hint">
      <kbd>←↑→↓</kbd>·드래그: 같이 옮기기(<kbd>Shift</kbd> 1m) · <kbd>Ctrl</kbd>+클릭: 넣고 빼기 · <kbd>Ctrl</kbd>+드래그: 상자로 더하기 ·
      <kbd>Esc</kbd>: 풀기. 붙은 배관은 따라오지 않습니다.
    </p>
    <p class="picked-actions">
      <button type="button" class="ghost danger" @click="deleteGroup()">설비 {{ groupItems.length }}대 지우기 <kbd>Delete</kbd></button>
    </p>
  </section>
</template>
