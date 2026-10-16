<script setup lang="ts">
// 상태줄(OE-UI-18, design-system.md 4장 "상태줄 28"). 값만, 문장 없이. 한 줄을 넘으면 자른다.
import { editPart, ceilingMode } from '../../editor/ceiling'
import { changeCount } from '../../editor/changes'
import { editing } from '../../editor/core'
import { grid, snap } from '../../editor/grid-snap'
import { history } from '../../editor/history'
import { multiRange } from '../../editor/multi-view'
import { hasInspectorSelection, inspectorBadge } from '../../editor/panels'
import { openDrawer } from '../../editor/shell'
</script>

<template>
  <footer class="shell-status" role="status" aria-label="상태줄" data-testid="status-bar">
    <span>그리드 {{ grid.on ? `${grid.spacing} m` : '끔' }}</span>
    <span>스냅 {{ snap.on ? `${snap.radius} m` : '끔' }}</span>
    <span>선택 {{ hasInspectorSelection ? inspectorBadge : '—' }}</span>
    <span>{{ editing ? (editPart === 'space' ? '공간 편집' : ceilingMode ? '설비 편집 · 천장' : '설비 편집') : '보기' }}</span>
    <span v-if="multiRange">다중층 {{ multiRange[0].name }}~{{ multiRange.at(-1)!.name }}</span>
    <span class="grow"></span>
    <span v-if="editing" :title="history.at(-1)?.label">편집 {{ history.length }}단계</span>
    <button v-if="changeCount" type="button" class="warn" title="바뀐 내용을 기준 · 검증 패널에서 봅니다" @click="openDrawer('changes')">● 바뀐 것 {{ changeCount }}건</button>
    <span v-else>변경 없음</span>
    <span>좌표 건물 로컬 · m</span>
  </footer>
</template>
