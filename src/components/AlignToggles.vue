<script setup lang="ts">
// 그리드 정렬(OE-UI-07)·스냅(OE-UI-06) 켜기 칸. 그리기 막대와 편집 도구 팔레트가 같이 쓴다 — 그리기에서 찍는 점과, 그리지 않을 때
// 끄는 설비·오브젝트·꼭짓점에 같이 걸려서 두 자리 모두에서 켜고 끈다.
import type { GridSettings } from '../lib/grid'
import type { SnapSettings } from '../lib/snap'

const grid = defineModel<GridSettings>('grid', { required: true })
const snap = defineModel<SnapSettings>('snap', { required: true })
</script>

<template>
  <span class="align-toggles">
    <label class="grid-toggle" title="클릭·드래그 지점을 그리드 교점으로 옮깁니다. 그리드를 켜도 이미 배치된 요소는 이동하지 않습니다(겹침 판정은 형상 기준 그대로)">
      <input v-model="grid.on" type="checkbox" aria-label="그리드 정렬" /> 그리드
      <input v-model.number="grid.spacing" type="number" min="0.05" step="0.05" class="align-num" aria-label="그리드 간격(m)" />m
    </label>
    <label class="grid-toggle" title="클릭·드래그 지점이 가까운 물리존·벽·룸·커스텀존의 꼭짓점·변에 붙습니다. 그리드 정렬보다 우선 적용됩니다">
      <input v-model="snap.on" type="checkbox" aria-label="스냅" /> 스냅
      <input v-model.number="snap.radius" type="number" min="0.05" max="2" step="0.05" class="align-num" aria-label="스냅 반경(m)" />m
    </label>
  </span>
</template>
