<script setup lang="ts">
// 왼쪽 도구 레일(OE-UI-04 ① 팔레트, design-system.md 4장 "도구 레일"). 편집 모드에서만 붙는다(App.vue). 맨 위 편집 모드(공간 · 설비) → 그 모드의 도구 → 맨 아래 되돌리기.
// 모드를 바꾸면 그 아래 도구가 바로 바뀐다. 도구 자체는 ToolPalette 그대로이고, 레일은 자리만 준다.
import type { PropType } from 'vue'
import { editPart, setEditPart } from '../../editor/ceiling'
import { activeTab } from '../../editor/context-menu'
import { future, history, redo, undo } from '../../editor/history'
import { drawing } from '../../editor/space-objects'
import { multiView } from '../../editor/vertical'
import ToolPalette from './ToolPalette.vue'
import type { model as modelRef } from '../../editor/core'

// 평면도에서 그리기 · 놓기 도구를 누르면 먼저 3D 로 바꾼다. 도구는 3D 바닥을 찍어 그린다. 평면도에서도 되는 것(data-plan, 벽 · 문 · 창 고르기)과
// 켜고 끄는 칸(천장 토글 · 체크)은 그대로 둔다.
function onPlanTool(ev: MouseEvent) {
  if (activeTab.value !== 'plan') return
  const b = (ev.target as HTMLElement).closest('button[data-ico]')
  if (b && !b.hasAttribute('data-plan')) activeTab.value = '3d'
}

defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <nav class="shell-rail" aria-label="도구 레일">
    <div class="rail-mode" role="group" aria-label="편집 모드">
      <button type="button" :class="{ on: editPart === 'space' }" :aria-pressed="editPart === 'space'" title="물리존 · 룸 · 커스텀존 · 벽 · 문 · 창 · 오브젝트를 고칩니다 (M)" @click="setEditPart('space')">공간 편집</button>
      <button type="button" :class="{ on: editPart === 'equipment' }" :aria-pressed="editPart === 'equipment'" title="설비 · 배관 · 천장 설비를 고칩니다 (M)" @click="setEditPart('equipment')">설비 편집</button>
    </div>
    <!-- 평면도에서도 도구를 보인다. 그리기 · 놓기는 3D 에서 하므로 누르면 3D 로 바꿔 켠다(onPlanTool). 평면도에서 되는 것은 위 한 줄에 적는다. -->
      <p v-if="activeTab === 'plan' && !drawing" class="rail-plan-note">평면도: 고르기 · 꼭짓점 끌기 · 벽 고르기<br />그리기는 3D 로 바뀝니다</p>
      <div v-if="!drawing && !multiView" @click.capture="onPlanTool">
        <ToolPalette :model="model" />
      </div>
    <p v-else class="rail-note muted">{{ drawing ? '그리는 중' : '다중층 보기' }}</p>
    <div class="rail-history">
      <button type="button" class="ghost" :disabled="!history.length" :title="history.length ? `되돌리기 (Ctrl+Z): ${history.at(-1)!.label}` : '되돌릴 편집이 없습니다'" @click="undo">↶ 실행취소</button>
      <button type="button" class="ghost" :disabled="!future.length" :title="future.length ? `다시 하기 (Ctrl+Shift+Z): ${future.at(-1)!.entry.label}` : '다시 할 편집이 없습니다'" @click="redo">↷ 다시실행</button>
    </div>
  </nav>
</template>
