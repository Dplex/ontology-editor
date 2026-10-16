<script setup lang="ts">
// 레일 펼침 칸 — 레일 도구 중 손이 많이 가는 것(공조존 · 평면도 배경 · 벽·문·창 설정)을 레일 오른쪽, 캔버스 왼쪽 위에 띄운다.
// 예전에는 3D 아래(비교판 첫 판에서는 기준 · 검증 패널 안)에 있었다. 기준 · 검증 패널은 보기만 하기로 해서 고치는 칸을 여기로 옮겼다(2026-10-16).
// 칸 자체는 그대로다(HvacZoneFold · BackgroundFold · 벽·문·창 설정) — 자리만 옮긴다.
import { OPENING_SNAP_RANGE } from '../../lib/edit'
import { vKeepTyping } from '../../editor/edit-filter'
import { elementSettings, setOpeningSnap, setSiteWallThickness, WALL_FROM, wallThicknessHere } from '../../editor/read-settings'
import { railPanel } from '../../editor/shell'
import BackgroundFold from './BackgroundFold.vue'
import HvacZoneFold from './HvacZoneFold.vue'

const TITLE = { hvac: '공조존', background: '평면도 배경', elements: '벽·문·창 설정' } as const
</script>

<template>
  <aside v-if="railPanel" class="shell-rail-panel" :aria-label="TITLE[railPanel]" data-testid="rail-panel" @keydown.esc.stop="railPanel = null">
    <header class="shell-rail-panel-head">
      <b>{{ TITLE[railPanel] }}</b>
      <button type="button" class="ghost close" :aria-label="`${TITLE[railPanel]} 닫기`" title="닫기" @click="railPanel = null">×</button>
    </header>
    <HvacZoneFold v-if="railPanel === 'hvac'" />
    <BackgroundFold v-else-if="railPanel === 'background'" />
    <!-- 벽·문·창 설정(OE-SPC-12 · OE-SPC-13). 레일의 [벽·문·창] 을 켰을 때 그 아래 [설정] 이 연다. -->
    <div v-else class="element-settings" data-testid="element-settings">
      <label>
        새 벽 사이트 기본 두께(내벽)
        <input
          type="number"
          step="0.01"
          min="0.01"
          placeholder="없음"
          data-testid="site-wall-thickness"
          v-keep-typing
          :value="elementSettings.interiorWall ?? ''"
          @change="setSiteWallThickness(($event.target as HTMLInputElement).value)"
        />
        m
      </label>
      <p v-if="wallThicknessHere" class="hint" data-testid="wall-thickness-here">
        {{ wallThicknessHere.storey }}에 새 벽을 그으면 <b class="mono">{{ wallThicknessHere.thickness }}m</b>({{ WALL_FROM[wallThicknessHere.from] }})입니다. 같은 층 BIM 내벽이 있으면 그 두께가 먼저입니다.
      </p>
      <label>
        문·창 스냅 거리
        <input
          type="number"
          step="0.1"
          :min="OPENING_SNAP_RANGE.min"
          :max="OPENING_SNAP_RANGE.max"
          data-testid="opening-snap"
          v-keep-typing
          :value="elementSettings.openingSnap"
          @change="setOpeningSnap(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = String(elementSettings.openingSnap)"
        />
        m
      </label>
      <p class="hint">벽에서 이 거리 안을 눌러야 문·창이 가장 가까운 벽에 붙습니다. 이 브라우저에만 남습니다.</p>
    </div>
  </aside>
</template>
