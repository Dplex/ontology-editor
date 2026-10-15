<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { changeCount } from '../../editor/changes'
import { editing } from '../../editor/core'
import { editQuery, editStorey, SMALL, surfaceFilter } from '../../editor/edit-filter'
import { searchInput } from '../../editor/keyboard'
import { selfIntersecting } from '../../editor/multi-select'
import { serverKey } from '../../editor/projects'
import { layoutState } from '../../editor/publish'
import BackgroundFold from './BackgroundFold.vue'
import ChangeReport from './ChangeReport.vue'
import EquipmentListFold from './EquipmentListFold.vue'
import HvacZoneFold from './HvacZoneFold.vue'
import SpaceListFold from './SpaceListFold.vue'
import VersionHistoryFold from './VersionHistoryFold.vue'
import type { counts as countsRef, model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="editor">
    <div v-if="counts.spaces + counts.equipment > SMALL" class="edit-filter">
      <label>
        층
        <select v-model="editStorey">
          <option value="">전체</option>
          <option v-for="s in model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <label>
        설치면
        <select v-model="surfaceFilter" aria-label="설치면으로 거르기">
          <option value="">전체</option>
          <option value="ceiling">천장</option>
          <option value="floor">바닥</option>
          <option value="wall">벽</option>
          <option value="none">미정</option>
        </select>
      </label>
      <label class="grow">
        이름
        <input ref="searchInput" v-model="editQuery" type="search" :placeholder="editing ? '물리존·설비 이름이나 종류  ( / )' : '설비 이름·종류나 소속 방 이름  ( / )'" />
      </label>
      <span class="muted">{{ editing ? '아래 두 표에 함께 적용됩니다.' : '설비 목록에 적용됩니다.' }}</span>
    </div>

    <!-- 물리존 하나를 한 줄에서 고친다. 이름(E1)과 경계(E2)를 두 목록으로 나눴더니 같은 방을 두 번 찾아야 했다.
         긴 표는 제 상자 안에서 스크롤하고 머리줄은 붙어 있다 — 페이지가 표만큼 길어지면 3D 로 돌아가기가 멀다. -->
    <!-- 평면도 배경 이미지(OE-MAN-02). 준공 도면을 깔고 그 위에 물리존을 그린다. 온톨로지에 나가지 않고 이 탭에만 있다. -->
    <BackgroundFold v-if="editing" />

  <!-- 수동 공조존(OE-ZON-01·02). R1 에서 공조존을 만드는 유일한 길이다. 고른 층(층 하나만 보는 중이면 그 층)에서 만든다. -->
    <HvacZoneFold v-if="editing" />

    <SpaceListFold v-if="editing" :counts="counts" />
    <p v-if="editing && selfIntersecting" class="error" role="alert">
      경계선이 서로 교차합니다. 이 상태에서는 넓이와 소속이 맞지 않습니다.
    </p>

    <EquipmentListFold :counts="counts" />

    <!-- 버전 히스토리(OE-WF-18~20). 최근 7일의 반영 버전과 지금 버전. 되돌리기는 옛 버전을 새 버전으로 다시 반영한다. -->
    <VersionHistoryFold v-if="serverKey && layoutState?.versions.length" :layout-state="layoutState" />

    <ChangeReport v-if="editing || changeCount > 0" :model="model" />
  </section>
</template>
