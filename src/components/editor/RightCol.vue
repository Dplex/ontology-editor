<script setup lang="ts">
import { ref, type PropType } from 'vue'
import { replayOpen } from '../../lib/replay-player'
import { WALL_COLORS } from '../../lib/viewer'
import { activeTab, cubeCanvas } from '../../editor/context-menu'
import { spaceView } from '../../editor/flow-map'
import { drawnWalls, showWalls } from '../../editor/idf-zones'
import { flying, setFlying } from '../../editor/keyboard'
import { hex } from '../../editor/kinds'
import { breadcrumb, floorStates, storeyGroup } from '../../editor/layout-storeys'
import { closeMultiView, multiRange, openMultiView, storeysByHeight, viewStorey } from '../../editor/multi-view'
import { pickStoreyChip, storeyChipList, storeyChips } from '../../editor/panels'
import { viewer } from '../../editor/scene'
import { multiView } from '../../editor/vertical'
import { clearViewFilter, exitSpaceView, exploded, filterOn, filterOpen, filterText, spaceViewName } from '../../editor/view-filter'
import Src from '../Src.vue'
import type { model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})

// 다중층 범위 팝오버. 고르는 동안은 화면을 바꾸지 않고 [다중층 보기] 에서 한 번에 연다.
const multiOpen = ref(false)
const rangeFrom = ref<string | null>(null)
const rangeTo = ref<string | null>(null)
function onMultiToggle(open: boolean) {
  multiOpen.value = open
  if (!open) return
  // 열 때 지금 범위(다중층 중이면 그 범위, 아니면 지금 층 ±1, 층을 안 골랐으면 전체)를 채운다.
  if (multiView.value) [rangeFrom.value, rangeTo.value] = [multiView.value.from, multiView.value.to]
  else if (viewStorey.value) pickAround()
  else pickAll()
}
function pickAll() {
  const list = storeysByHeight.value
  rangeFrom.value = list[0]?.id ?? null
  rangeTo.value = list.at(-1)?.id ?? null
}
function pickAround() {
  const list = storeysByHeight.value
  const i = list.findIndex((st) => st.id === viewStorey.value)
  if (i < 0) return
  rangeFrom.value = list[Math.max(0, i - 1)].id
  rangeTo.value = list[Math.min(list.length - 1, i + 1)].id
}
async function applyRange() {
  if (!rangeFrom.value || !rangeTo.value) pickAround()
  if (!rangeFrom.value || !rangeTo.value) pickAll()
  if (multiView.value && rangeFrom.value && rangeTo.value) multiView.value = { ...multiView.value, from: rangeFrom.value, to: rangeTo.value }
  else await openMultiView(rangeFrom.value ?? undefined, rangeTo.value ?? undefined)
  multiOpen.value = false
}
</script>

<template>
  <div class="right-col">
    <!-- 층 범위 칩 [현재층 ▾ · 다중층 ▾](design-system.md 5장, OE-ML-01 진입 ④). 3D/평면도 · 레이어는 왼쪽 위, 라벨 · 결과 비교 · 전체 화면은
         아래 뷰 컨트롤로 옮겼다. -->
    <div v-if="model.storeys.length > 1" class="shell-range" role="group" aria-label="층 범위">
      <label :class="['seg', { on: !multiView }]" :title="multiView ? '누르면 한 층 보기로 돌아갑니다' : '이 층만 봅니다'" @click="multiView && closeMultiView()">
        <span>현재층</span>
        <select v-if="!multiView" v-model="viewStorey" class="storey-view" aria-label="보일 층">
          <option :value="null">모든 층</option>
          <!-- 건물별로 묶고 머리에 층 범위·임시 저장한 층 수(OE-UI-04 AC13). 낮은 층부터다(OE-UI-03 공통 표시 규칙). -->
          <optgroup v-if="storeyGroup" :label="storeyGroup.label" data-testid="storey-group-label">
            <option v-for="st in storeyGroup.storeys" :key="st.key" :value="st.key" :title="floorStates.get(st.key)">{{ st.name }}</option>
          </optgroup>
        </select>
        <b v-else>{{ breadcrumb?.storey }}</b>
      </label>
      <details class="seg multi" :open="multiOpen" @toggle="onMultiToggle(($event.target as HTMLDetailsElement).open)">
        <summary :class="['multi-open', { on: !!multiView }]" title="층 범위를 골라 여러 층과 수직 관통 요소를 함께 봅니다">
          {{ multiView && multiRange ? `${multiRange[0].name}~${multiRange.at(-1)!.name} · ${multiRange.length}개 층` : '다중층' }} ▾
        </summary>
        <div class="shell-pop multi-range" role="group" aria-label="다중층 보기 범위">
          <p class="muted">지하층부터 고릅니다</p>
          <span class="multi-pick">
            <select v-model="rangeFrom" aria-label="다중층 시작 층">
              <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
            </select>
            ~
            <select v-model="rangeTo" aria-label="다중층 끝 층">
              <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
            </select>
          </span>
          <span class="multi-quick">
            <button type="button" class="ghost" @click="pickAll">전체</button>
            <button type="button" class="ghost" :disabled="!viewStorey" @click="pickAround">지금 층 ±1</button>
          </span>
          <p class="muted">보기 범위만 바꿉니다. 오브젝트의 관통 구간은 그대로입니다.</p>
          <span class="multi-quick">
            <button type="button" class="ghost primary-action" @click="applyRange">다중층 보기</button>
            <button v-if="multiView" type="button" class="ghost" @click="closeMultiView(); multiOpen = false">층 편집으로</button>
          </span>
        </div>
      </details>
    </div>
    <!-- 공간 보기 중임을 3D 위에 늘 보인다. 보기 필터 띠와 같은 까닭이다. -->
    <p v-if="spaceView && activeTab === '3d' && !replayOpen" class="filter-chip space-chip" role="status" data-testid="space-chip">
      <b>공간 보기</b>
      <span class="space-crumbs" data-testid="space-crumbs">
        <button type="button" class="link" title="모든 층으로" @click="viewStorey = null">{{ breadcrumb?.building || '건물' }}</button> ›
        <button type="button" class="link" title="층 전체로 (Esc)" @click="exitSpaceView">{{ breadcrumb?.storey }}</button> ›
        <b>{{ spaceViewName }}</b>
      </span>
      · 방 안 설비와 공기 원천만 · 화면에서만
      <button type="button" class="link" title="이 방에 다시 맞춥니다" @click="viewer?.frameSpace(spaceView.id, true)">방에 맞추기</button>
      <button type="button" class="link" title="층 전체로 (Esc)" @click="exitSpaceView">층 전체</button>
    </p>
    <!-- 걸러 보는 중임을 3D 위에 늘 보인다(패널을 닫아도). 안 보이는 것을 없는 것으로 오해하지 않게. -->
    <p v-if="(filterOn || exploded) && !filterOpen && activeTab === '3d'" class="filter-chip" role="status" data-testid="filter-chip">
      <b>보기 필터</b> {{ exploded ? '분해도 · ' : '' }}{{ filterText || '전부' }} · 화면에서만
      <button type="button" class="link" title="보기 필터 열기 (V)" @click="filterOpen = true">고치기</button>
      <button type="button" class="link" @click="clearViewFilter">모두 보이기</button>
    </p>
    <div class="rail-row">
      <!-- 내력 여부는 BIM 의 LoadBearing 속성 그대로다. 비내력벽(칸막이)도 그린다 — 빼면 방이 뚫려 보인다(#599). -->
      <ul v-if="showWalls && drawnWalls" class="wall-key">
        <li v-if="drawnWalls.loadBearing"><i :style="{ background: hex(WALL_COLORS.loadBearing) }"></i>내력벽 {{ drawnWalls.loadBearing }} <Src kind="bim" /></li>
        <li v-if="drawnWalls.unknown">
          <i :style="{ background: hex(WALL_COLORS.unknown) }"></i>내력 여부 모름 {{ drawnWalls.unknown }}
        </li>
        <li v-if="drawnWalls.ordinary"><i :style="{ background: hex(WALL_COLORS.ordinary) }"></i>비내력벽 {{ drawnWalls.ordinary }} <Src kind="bim" /></li>
      </ul>
      <!-- 방향 큐브(nav-cube.ts)와 비행 모드. 면·모서리·꼭짓점을 누르면 그 방향에서 보고, 끌면 돈다. 3D 일 때만, 리플레이 극장에서는 뺀다. -->
      <div v-if="model && activeTab === '3d' && !replayOpen" class="nav-cube" data-testid="nav-cube">
        <canvas ref="cubeCanvas" aria-label="방향 큐브 — 면을 누르면 그 방향에서 보고, 끌면 돕니다"></canvas>
        <button
          type="button"
          :class="['ghost', 'fly-toggle', { on: flying }]"
          :aria-pressed="flying"
          title="비행 모드 켜기·끄기 (G) — WASD 이동 · Q/E 내려가기·올라가기 · 드래그 둘러보기 · 휠 빠르기 · Shift 빠르게"
          @click="setFlying(!flying)"
        >
          비행 <kbd>G</kbd>
        </button>
      </div>
    </div>
    <!-- 층별 칩. 위층이 위. 누르면 그 층만 보고, 다시 누르면 전체. 다중층 뷰·리플레이에서는 뺀다. -->
    <nav v-if="storeyChips.length && activeTab === '3d' && !replayOpen && !multiView" class="storey-chips" aria-label="층별 손볼 것" data-testid="storey-chips">
      <div ref="storeyChipList" class="sc-list">
      <button
        v-for="c in storeyChips"
        :key="c.id"
        type="button"
        :class="{ on: viewStorey === c.id, clean: !c.unplaced && !c.noSpace && !c.failed }"
        :aria-pressed="viewStorey === c.id"
        :aria-label="!c.unplaced && !c.noSpace && !c.failed ? `${c.name} — 손볼 것 없음` : `${c.name} — 미배치 ${c.unplaced} · 소속 없음 ${c.noSpace} · 위반 ${c.failed}`"
        :title="`${c.name} — 미배치 ${c.unplaced} · 소속 없음 ${c.noSpace} · 그 밖의 검사 위반 ${c.failed}. 누르면 이 층만 봅니다`"
        @click="pickStoreyChip(c.id)"
      >
        <span class="sc-name">{{ c.name }}</span>
        <span v-if="c.unplaced" class="sc-n unplaced" title="미배치">{{ c.unplaced }}</span>
        <span v-if="c.noSpace" class="sc-n nospace" title="소속 없음">{{ c.noSpace }}</span>
        <span v-if="c.failed" class="sc-n failed" title="검사 위반">{{ c.failed }}</span>
        <span v-if="!c.unplaced && !c.noSpace && !c.failed" class="sc-ok" aria-label="손볼 것 없음">✓</span>
      </button>
      </div>
      <p class="sc-key"><i class="unplaced"></i>미배치 <i class="nospace"></i>소속 없음 <i class="failed"></i>위반</p>
    </nav>
  </div>
</template>
