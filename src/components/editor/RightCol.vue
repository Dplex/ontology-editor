<script setup lang="ts">
import type { PropType } from 'vue'
import { replayOpen } from '../../lib/replay-player'
import { WALL_COLORS } from '../../lib/viewer'
import { fullscreen, toggleFullscreen } from '../../editor/chat-view'
import { activeTab, cubeCanvas } from '../../editor/context-menu'
import { editing } from '../../editor/core'
import { onEditToggle } from '../../editor/exit-edit'
import { compareOpen } from '../../editor/export-compare'
import { spaceView } from '../../editor/flow-map'
import { drawnWalls, showWalls, showZones } from '../../editor/idf-zones'
import { flying, helpOpen, setFlying } from '../../editor/keyboard'
import { hex } from '../../editor/kinds'
import { labelStorey, showLabels, showPlan } from '../../editor/labels'
import { breadcrumb, floorStates, storeyGroup } from '../../editor/layout-storeys'
import { closeMultiView, openMultiView, setMultiAll, storeysByHeight, viewStorey } from '../../editor/multi-view'
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
</script>

<template>
  <div class="right-col">
    <div class="view-tools">
      <!-- 보기 ↔ 편집, 단축키 안내. 위 도구막대와 같은 일이라 전체 화면(도구막대가 안 보인다)에서만 둔다.
           평소에도 두었더니 같은 스위치가 한 화면에 둘이었다. -->
      <label v-if="fullscreen" class="edit-toggle" title="켜면 3D에서 설비와 물리존 꼭짓점을 옮기고 연결 방향을 정할 수 있습니다 (E)">
        <input
          type="checkbox"
          :checked="editing"
          @change="onEditToggle($event.target as HTMLInputElement)"
        />
        편집
      </label>
      <!-- 3D 벽은 왼쪽 위 독의 [Walls] 가 켜고 끈다. 독이 없는 리플레이 동안에만 여기에 둔다 — 같은 단추가 한 화면에 둘이었다. -->
      <button
        v-if="drawnWalls && activeTab === '3d' && replayOpen"
        type="button"
        :class="['ghost', { on: showWalls }]"
        :aria-pressed="showWalls"
        title="3D 벽 표시 켜기·끄기 (W)"
        @click="showWalls = !showWalls"
      >
        Walls
      </button>
      <!-- 공조존(IDF) 외곽선. IDF 를 열거나 덧붙였을 때만. -->
      <button
        v-if="model.hvac?.zones.length"
        type="button"
        :class="['ghost', { on: showZones }]"
        :aria-pressed="showZones"
        title="IDF 공조존의 바닥 외곽선 표시 켜기·끄기"
        @click="showZones = !showZones"
      >
        공조존
      </button>
      <!-- 보기 필터(ui-notes 보기 필터). 층 여러 개·Brick 클래스·계통으로 거르고, 숨기기·격리·분해도. 화면에만 적용된다.
           평소에는 왼쪽 위 독의 [Filter] 가 연다. 독이 없는 리플레이 동안에만 여기에 둔다. -->
      <button
        v-if="activeTab === '3d' && replayOpen"
        type="button"
        :class="['ghost', 'filter-toggle', { on: filterOpen || filterOn || exploded }]"
        :aria-expanded="filterOpen"
        title="층·Brick 클래스·계통으로 걸러 봅니다 (V). 화면에서만이고 편집 파일·TTL·GeoJSON 에는 남지 않습니다"
        @click="filterOpen = !filterOpen"
      >
        보기 필터<b v-if="filterOn || exploded" class="filter-dot" aria-label="켜짐">●</b>
      </button>
      <!-- 설비 라벨(V4). 층 하나를 볼 때 설비마다 이름과 소속·종류 출처 배지를 3D 위에 띄운다. -->
      <button
        v-if="activeTab === '3d'"
        type="button"
        :class="['ghost', 'labels-toggle', { on: showLabels }]"
        :aria-pressed="showLabels"
        :disabled="!labelStorey"
        :title="labelStorey ? '설비마다 이름과 소속·종류 출처를 3D 위에 띄웁니다 (L)' : '층 하나를 고르면 설비 라벨을 띄웁니다 (L)'"
        @click="showLabels = !showLabels"
      >
        라벨
      </button>
      <!-- 내보낸 결과와 나란히 보기(ADR-0061). 3D 오른쪽에 받는 쪽이 읽는 TTL·GeoJSON 판을 띄운다. -->
      <button
        v-if="activeTab === '3d'"
        type="button"
        :class="['ghost', { on: compareOpen }]"
        :aria-pressed="compareOpen"
        data-testid="compare-toggle"
        title="3D 오른쪽에 지금 모델을 내보낸 TTL·GeoJSON 을 DT 플랫폼처럼 읽어 나란히 봅니다 (B). 고르면 양쪽이 같은 것을 짚습니다"
        @click="compareOpen = !compareOpen"
      >
        결과 비교
      </button>
      <div class="tabs" role="group" aria-label="보기">
        <button type="button" :aria-pressed="activeTab === '3d'" title="3D 입체 뷰로 보기 (Shift+V)" @click="activeTab = '3d'">3D</button>
        <button type="button" :aria-pressed="activeTab === 'plan'" :disabled="!!multiView" :title="multiView ? '평면도는 층 하나를 그립니다. 다중층 뷰는 3D 입니다' : '2D 평면도로 전환 (Shift+V)'" @click="showPlan">평면도</button>
      </div>
      <!-- 층별로 보기. 층이 하나면 둘 까닭이 없다. -->
      <select v-if="model.storeys.length > 1 && !multiView" v-model="viewStorey" class="storey-view" aria-label="보일 층" title="이 층만 보기">
        <option :value="null">모든 층</option>
        <!-- 건물별로 묶고 머리에 층 범위·임시 저장한 층 수(OE-UI-04 AC13). 낮은 층부터다(OE-UI-03 공통 표시 규칙). -->
        <optgroup v-if="storeyGroup" :label="storeyGroup.label" data-testid="storey-group-label">
          <option v-for="st in storeyGroup.storeys" :key="st.key" :value="st.key" :title="floorStates.get(st.key)">{{ st.name }}만</option>
        </optgroup>
      </select>
      <!-- 다중층 뷰(OE-ML-01 ①). 누르면 지금 층과 위층으로 열고, 범위는 시작·끝 층으로 고쳐 고른다. -->
      <button v-if="model.storeys.length > 1 && !multiView" type="button" class="ghost multi-open" title="층 범위를 골라 여러 층과 수직 관통 요소를 함께 봅니다" @click="openMultiView()">
        다중층 뷰에서 편집
      </button>
      <span v-if="multiView" class="multi-range" role="group" aria-label="다중층 보기 범위">
        <select v-model="multiView.from" aria-label="다중층 시작 층">
          <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
        </select>
        ~
        <select v-model="multiView.to" aria-label="다중층 끝 층">
          <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
        </select>
        <button type="button" class="ghost" @click="setMultiAll">전체</button>
        <button type="button" class="ghost" @click="closeMultiView">층 편집으로</button>
      </span>
      <button v-if="fullscreen" type="button" class="ghost keys-help" title="조작·단축키 안내 (?)" aria-label="조작·단축키 안내" @click="helpOpen = true">?</button>
      <button type="button" class="ghost fullscreen" :aria-pressed="fullscreen" title="작업 영역 전체 화면 전환 (나가기: Esc)" @click="toggleFullscreen">
        {{ fullscreen ? '전체 화면 나가기 (Esc)' : '전체 화면' }}
      </button>
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
