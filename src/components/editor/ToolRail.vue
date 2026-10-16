<script setup lang="ts">
// 왼쪽 도구 레일(OE-UI-04 ① 팔레트, design-system.md 4장 "도구 레일"). 맨 위 편집 모드(공간 · 설비) → 그 모드의 도구 → 맨 아래 되돌리기.
// 모드를 바꾸면 그 아래 도구가 바로 바뀐다. 도구 자체는 ToolPalette 그대로이고, 레일은 자리만 준다.
import type { PropType } from 'vue'
import { editPart, setEditPart } from '../../editor/ceiling'
import { activeTab } from '../../editor/context-menu'
import { busy, editing, mode } from '../../editor/core'
import { future, history, redo, undo } from '../../editor/history'
import { editBlock } from '../../editor/people'
import { drawing } from '../../editor/space-objects'
import { multiView } from '../../editor/vertical'
import ToolPalette from './ToolPalette.vue'
import type { model as modelRef } from '../../editor/core'

defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <nav class="shell-rail" aria-label="도구 레일">
    <div class="rail-mode" role="group" aria-label="편집 모드">
      <button type="button" :class="{ on: editing && editPart === 'space' }" :aria-pressed="editing && editPart === 'space'" :disabled="!editing" :title="editing ? '물리존 · 룸 · 커스텀존 · 벽 · 문 · 창 · 오브젝트를 고칩니다 (M)' : '편집 모드에서 고릅니다'" @click="setEditPart('space')">공간 편집</button>
      <button type="button" :class="{ on: editing && editPart === 'equipment' }" :aria-pressed="editing && editPart === 'equipment'" :disabled="!editing" :title="editing ? '설비 · 배관 · 천장 설비를 고칩니다 (M)' : '편집 모드에서 고릅니다'" @click="setEditPart('equipment')">설비 편집</button>
    </div>
    <template v-if="editing">
      <ToolPalette v-if="!drawing && activeTab === '3d' && !multiView" :model="model" />
      <p v-else class="rail-note muted">{{ drawing ? '그리는 중' : multiView ? '다중층 보기' : '평면도' }}</p>
    </template>
    <div v-else class="rail-view">
      <p class="rail-note muted">보기 모드</p>
      <button type="button" class="ghost rail-enter" :disabled="busy || !!editBlock" :title="editBlock ?? '편집 모드로 전환 (E)'" @click="mode = 'edit'">편집 시작</button>
    </div>
    <div class="rail-history">
      <button type="button" class="ghost" :disabled="!editing || !history.length" :title="history.length ? `되돌리기 (Ctrl+Z): ${history.at(-1)!.label}` : '되돌릴 편집이 없습니다'" @click="undo">↶ 실행취소</button>
      <button type="button" class="ghost" :disabled="!editing || !future.length" :title="future.length ? `다시 하기 (Ctrl+Shift+Z): ${future.at(-1)!.entry.label}` : '다시 할 편집이 없습니다'" @click="redo">↷ 다시실행</button>
    </div>
  </nav>
</template>
