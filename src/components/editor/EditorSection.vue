<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { changeCount } from '../../editor/changes'
import { editing } from '../../editor/core'
import { serverKey } from '../../editor/projects'
import { layoutState } from '../../editor/publish'
import ChangeReport from './ChangeReport.vue'
import VersionHistoryFold from './VersionHistoryFold.vue'
import type { counts as countsRef, model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <!-- 기준 · 검증 패널은 보기만 한다(2026-10-16 사용자 결정, design-system.md 4장). 예전 3D 아래의 편집 표(물리존 이름 · 경계, 설비 위치 · 소속)와
       공조존 · 평면도 배경 만들기는 뺐다 — 고치는 것은 레일 도구와 오른쪽 카드에서 한다(ToolRail 의 펼침 칸). 여기는 반영 버전과 바뀐 내용만. -->
  <section v-memo="replayMemo()" class="editor">
    <!-- 버전 히스토리(OE-WF-18~20). 최근 7일의 반영 버전과 지금 버전. 되돌리기는 옛 버전을 새 버전으로 다시 반영한다. -->
    <VersionHistoryFold v-if="serverKey && layoutState?.versions.length" :layout-state="layoutState" />

    <ChangeReport v-if="editing || changeCount > 0" :model="model" />
  </section>
</template>
