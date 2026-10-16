<script setup lang="ts">
import type { PropType } from 'vue'
import { ZONE_SERVE_COLOR, ZONE_SERVE_LABEL } from '../../lib/idf/zone-view'
import { equipmentKind } from '../../lib/kinds'
import { LAYA_SURE } from '../../lib/laya'
import { replayOpen } from '../../lib/replay-player'
import { PICK_COLORS } from '../../lib/viewer'
import { activeTab, ctxMenu } from '../../editor/context-menu'
import { canvas, editing, fileName } from '../../editor/core'
import { acceptAddKind, adding, addKind, addMountHint, addName, addNameInput, addSuggestions, archMode, cancelAddEquipment, selectedElementId } from '../../editor/equipment-edit'
import { compareError, compareOpen, comparePending, compareReading, compareSelected, compareShown, compareView, selectedElement, selectFromCompare, wallDims } from '../../editor/export-compare'
import { facadeGroup } from '../../editor/facade'
import { arrowPalette, flowDraft, hasArrows, selected, selectedId, showRules, tracedRules } from '../../editor/flow-rules'
import { activeVertex, gridView } from '../../editor/grid-snap'
import { planZones, selectedZone, selectZone } from '../../editor/idf-zones'
import { dropVertex, flying, helpOpen, keyNote, pickVertex } from '../../editor/keyboard'
import { hex, selectedSystemId } from '../../editor/kinds'
import { equipmentLabels, planStorey, replay } from '../../editor/labels'
import { addBoxToGroup, editNotice, group, groupItems, toggleGroup } from '../../editor/multi-select'
import { elevationText, multiRange, viewStorey } from '../../editor/multi-view'
import { perfOn, perfStats } from '../../editor/panels'
import { pickSpace, selectedSpaceId } from '../../editor/rooms'
import { drawing, selectedSpace } from '../../editor/space-objects'
import { select } from '../../editor/systems'
import { multiView, selectedVerticalId, verticalCreate } from '../../editor/vertical'
import { startCreateVertical } from '../../editor/vertical-create'
import { classFocus, classLegend, classTintBy, classTintOn, filteredExplorerFacets, filterOpen, TINT_BY_LABEL, UNKNOWN_CLASS, viewFacets } from '../../editor/view-filter'
import ExportCompare from '../ExportCompare.vue'
import FloorPlan from '../FloorPlan.vue'
import ReplayHud from '../ReplayHud.vue'
import Src from '../Src.vue'
import BottomViewDock from './BottomViewDock.vue'
import ContextMenu from './ContextMenu.vue'
import DrawBar from './DrawBar.vue'
import FilterPanel from './FilterPanel.vue'
import RightCol from './RightCol.vue'
import ViewLayers from './ViewLayers.vue'
import type { counts as countsRef, model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <section :class="['viewport', { theater: replayOpen }]">
    <div class="canvas-wrap">
      <!-- 3D 는 마우스로만 다룬다. 같은 내용(층·물리존·설비·경고)은 오른쪽 패널과 아래 목록이 글로 준다 — 캔버스는 그 사실만 이름으로 알린다. -->
      <canvas v-show="activeTab === '3d'" ref="canvas" role="img" :aria-label="`${fileName} 3D 보기 — 같은 내용은 오른쪽 패널과 3D 아래 목록에 있습니다`"></canvas>
      <p v-if="flying" class="fly-badge" role="status" data-testid="fly-badge">
        <b>비행 모드</b> · WASD 이동 · Q/E 내려가기·올라가기 · 드래그 둘러보기 · 휠 빠르기 · Shift 빠르게 · <kbd>G</kbd>·<kbd>Esc</kbd> 나가기
      </p>
      <!-- 3D 우클릭 메뉴(E3, ui-notes 보기 필터). 끌지 않은 우클릭만 — 오른쪽 드래그는 그대로 회전이다. -->
      <ContextMenu v-if="ctxMenu && activeTab === '3d'" :ctx-menu="ctxMenu" />
      <!-- 왼쪽 위: [3D | 평면도] 와 레이어(OE-UI-19 · OE-UI-20). 편집 도구는 왼쪽 레일(ToolRail)에 있다. -->
      <ViewLayers v-if="!replayOpen" :model="model" />
      <!-- 보기 필터 패널(V2 · FACADE 스타일 좌측 탐색 드로어). 항목마다 설비 대수. 클래스는 TTL 에 나가는 그 클래스다. -->
      <FilterPanel v-if="filterOpen && viewFacets && filteredExplorerFacets && activeTab === '3d'" :filtered-explorer-facets="filteredExplorerFacets" :view-facets="viewFacets" />
      <!-- 성능 표(개발용, ` 키). 3D 는 바뀔 때만 그려서 가만히 있으면 그린 장수가 0 이다. -->
      <dl v-if="perfOn && perfStats" class="perf-hud" data-testid="perf-hud">
        <div><dt>FPS</dt><dd>{{ perfStats.fps }}</dd></div>
        <div><dt>렌더링</dt><dd>{{ perfStats.renderMs.toFixed(1) }} ms</dd></div>
        <div><dt>draw call</dt><dd>{{ perfStats.calls.toLocaleString() }}</dd></div>
        <div><dt>삼각형</dt><dd>{{ perfStats.triangles.toLocaleString() }}</dd></div>
      </dl>
      <ReplayHud v-if="replayOpen" v-bind="replay.hud.value" v-on="replay.hudOn" />
      <!-- 평면도. 3D 와 탭으로 갈아 끼우고, 층 하나를 골랐을 때만 그린다. -->
      <FloorPlan
        v-if="activeTab === 'plan' && planStorey"
        :storey="planStorey"
        :selected-id="selectedId"
        :selected-space-id="selectedSpaceId"
        :selected-vertical-id="selectedVerticalId"
        :selected-element-id="selectedElementId"
        :also-chosen="facadeGroup ? facadeGroup.map((x) => x.id) : undefined"
        :editing="editing"
        :active-vertex="activeVertex"
        :pick-walls="editing && archMode"
        :group="group"
        :grid="gridView && gridView.storeyId === planStorey.id ? { x: gridView.x, y: gridView.y } : null"
        :dimension="wallDims && wallDims.storeyId === planStorey.id ? wallDims : null"
        :zones="planZones"
        :zone-devices="selectedZone ? [...selectedZone.devices.terminals, ...selectedZone.devices.sources] : undefined"
        @pick-zone="selectZone"
        @select="(id, additive) => (editing && additive ? toggleGroup(id) : select(id))"
        @select-box="addBoxToGroup"
        @pick-space="pickSpace"
        @pick-element="selectedElementId = $event"
        @pick-vertex="pickVertex"
        @move-vertex="dropVertex"
      />
      <p v-else-if="activeTab === 'plan'" class="plan-empty">
        평면도는 층 하나를 그립니다. 오른쪽 위에서 층을 고르세요.
      </p>
      <!-- 치수(OE-UI-08). 고른 벽의 크기와 가까운 벽까지 거리. 평면도에는 치수선으로 그린다. -->
      <p v-if="wallDims && activeTab === '3d' && !drawing" class="dim-chip" role="status" data-testid="dim-chip">{{ wallDims.text }}</p>
      <!-- 고른 IDF 공조존(ADR-0069). 담당 방식·담당 BIM 기기 수·겹친 방을 3D·평면도 위에 띄운다. -->
      <div v-if="selectedZone" class="zone-chip" role="status" data-testid="zone-chip">
        <div>
          <i class="zone-swatch" :style="{ background: ZONE_SERVE_COLOR[selectedZone.serve] }" />
          <b>{{ selectedZone.zone.name }}</b> · {{ selectedZone.storey }} · {{ ZONE_SERVE_LABEL[selectedZone.serve] }} <Src kind="idf" />
          <button type="button" class="ghost close" aria-label="공조존 고르기 풀기" @click="selectZone(null)">×</button>
        </div>
        <div>
          담당 BIM 기기 {{ selectedZone.devices.terminals.length }}대<template v-if="selectedZone.devices.sources.length"> · 원천 {{ selectedZone.devices.sources.length }}대</template>
          <template v-if="selectedZone.zone.idfAirflowCMH"> · IDF 풍량 {{ selectedZone.zone.idfAirflowCMH.toLocaleString() }} CMH</template>
          · 바닥면 {{ selectedZone.zone.areaM2.toFixed(1) }}㎡
        </div>
        <div v-if="selectedZone.overlaps.length">
          겹친 방 <Src kind="calc" />
          {{ selectedZone.overlaps.slice(0, 4).map((o) => `${o.name} ${Math.round(o.share * 100)}%`).join(', ') }}{{ selectedZone.overlaps.length > 4 ? ` 외 ${selectedZone.overlaps.length - 4}` : '' }}
        </div>
        <div v-else class="muted">BIM 방과 겹치지 않습니다(방 없는 공조존).</div>
      </div>
      <!-- 외곽선 그리기 중. 찍은 점 수와 마침·한 점 지우기·취소. -->
      <!-- 다중층 뷰에서는 위의 보기 범위 칸을 가리지 않게 한 줄 내린다 — 층간 배관을 그리다 범위를 넓힌다(OE-ML-12). -->
      <DrawBar v-if="drawing" :drawing="drawing" :model="model" />
      <!-- 편집 도구 팔레트(PRD #9 화면 레이아웃의 왼쪽). 편집 모드에서만, 무엇을 만드는지로 묶는다. 넣을 층은 층 하나만
           보는 중이면 그 층이다(targetStorey). 왼쪽 위는 색 안내 자리라 아래쪽에 둔다. -->
      <!-- 다중층 뷰(OE-ML-01). 도구 상자 자리에 보기 범위와 지금은 보기만 한다는 말을 둔다. -->
      <p v-if="multiView && multiRange" class="multi-banner" role="status" data-testid="multi-banner">
        <b>다중층 뷰</b> · {{ multiRange[0].name }} ~ {{ multiRange.at(-1)!.name }} ({{ multiRange.length }}개 층) · 바닥 높이
        {{ elevationText(multiRange[0].elevation) }} ~ {{ elevationText(multiRange.at(-1)!.elevation) }} m <Src kind="bim" /><br />
        <span class="muted">보기 범위만 바꿉니다. 오브젝트의 관통 구간은 그대로입니다. {{ editing ? '여기서는 수직 관통 오브젝트를 만들고 옮기고 지우고 구간을 바꿉니다. 설비를 고르면 다른 층 설비까지 층간 배관을 그립니다.' : '' }}</span>
        <button v-if="editing && !verticalCreate" type="button" class="ghost banner-action" @click="startCreateVertical()">수직 관통 오브젝트 만들기</button>
      </p>
      <!-- 설비 라벨(V4, lib/equipment-labels.ts). 점 위에 이름과 소속·종류 배지, 아래로 짧은 지시선. 누르면 그 설비를 고른다. -->
      <div v-if="equipmentLabels.length" class="eq-labels" data-testid="eq-labels">
        <button
          v-for="l in equipmentLabels"
          :key="l.id"
          type="button"
          :class="['eq-label', { chosen: l.id === selectedId }]"
          :style="{ left: `${l.x}px`, top: `${l.y}px` }"
          :data-id="l.id"
          @click="select(l.id)"
        >
          <span class="eq-label-name">{{ l.name }}</span>
          <span v-for="b in l.badges" :key="b.text" :class="['eq-badge', b.tone]" :title="b.title">{{ b.text }}</span>
        </button>
      </div>
      <!-- 3D 오른쪽 위 세로 줄: 시점 막대 → 보기 필터 칩 → [벽 범례 | 방향 큐브] → 층별 칩. 한 줄에 차례로 쌓아서
         막대가 두 줄로 꺾이거나 층이 많아도(성수 20층) 서로 덮지 않는다. -->
      <RightCol :model="model" />
      <!-- 시점 바로가기(아래 가운데). 3D 조작이 낯선 사람도 길을 잃으면 여기서 돌아온다. 평면도·비행은 위 막대에 이미 있어 두지 않는다.
           보기 모드에서만 — 편집 모드의 아래는 조작 안내·치수 풍선 자리라 겹쳤다. 키(0·O·F)는 편집에서도 먹는다. -->
      <BottomViewDock v-if="!replayOpen" />
    </div>

    <!-- 종류별 색의 범례(독의 [Explode]). 줄을 누르면 그 종류만 색으로 남긴다. 클래스 원문은 TTL 에 나가는 그 클래스다. -->
    <div v-if="classTintOn && activeTab === '3d' && !replayOpen" class="class-key" data-testid="class-key">
      <p class="class-key-head">
        <b>{{ classTintBy === 'class' ? '종류별 색' : classTintBy === 'kind' ? 'Brick 클래스를 어디서 알았나' : '소속을 어디서 알았나' }}</b> <span class="muted">기기 {{ classLegend.reduce((n, r) => n + r.ids.length, 0) }}대 · 덕트·배관은 회색</span>
        <button v-if="classFocus" type="button" class="link" @click="classFocus = null">모두</button>
      </p>
      <!-- 칠하는 기준. 출처로 칠하면 BIM 이 말한 것과 사전·계산으로 메운 것이 3D 에서 갈린다(view-filter.ts 의 classTintBy). -->
      <p class="class-key-by" role="group" aria-label="색 기준" data-testid="tint-by">
        <button v-for="(label, k) in TINT_BY_LABEL" :key="k" type="button" :class="{ on: classTintBy === k }" :aria-pressed="classTintBy === k" @click="classTintBy = k">{{ label }}</button>
      </p>
      <p v-if="!classLegend.length" class="muted">칠할 기기가 없습니다(건축 파일이면 설비 IFC 를 덧붙입니다)</p>
      <ul>
        <li v-for="r in classLegend" :key="r.key">
          <button
            type="button"
            :class="{ on: classFocus === r.key, off: !!classFocus && classFocus !== r.key, unknown: r.key === UNKNOWN_CLASS || r.key === 'src:none' }"
            :aria-pressed="classFocus === r.key"
            :title="`${r.cls} — 누르면 이것만 색으로 남깁니다`"
            @click="classFocus = classFocus === r.key ? null : r.key"
          >
            <i :style="{ background: hex(r.color) }" aria-hidden="true"></i>
            <span class="class-name">{{ r.label }}</span>
            <b>{{ r.ids.length }}</b>
            <!-- 출처로 칠할 때는 몫도 — "BIM 이 종류를 적은 기기 12%" 가 고객사에 할 말이다. -->
            <small v-if="classTintBy !== 'class'">{{ Math.round((r.ids.length / Math.max(1, classLegend.reduce((n, x) => n + x.ids.length, 0))) * 100) }}%</small>
          </button>
        </li>
      </ul>
    </div>
    <!-- 3D 색이 무엇을 뜻하는지. 진한 색은 BIM 포트가 말한 흐름, 옅은 색은 규칙으로 정한 흐름이다. -->
    <ul v-if="selected && activeTab === '3d' && !classTintOn" class="color-key">
      <li><i :style="{ background: hex(PICK_COLORS.upstream) }"></i>상류 <Src kind="bim" /></li>
      <li><i :style="{ background: hex(PICK_COLORS.downstream) }"></i>하류 <Src kind="bim" /></li>
      <template v-if="showRules && tracedRules">
        <li><i :style="{ background: hex(PICK_COLORS.ruleUpstream) }"></i>상류 <Src kind="dict" /></li>
        <li><i :style="{ background: hex(PICK_COLORS.ruleDownstream) }"></i>하류 <Src kind="dict" /></li>
      </template>
      <li><i :style="{ background: hex(PICK_COLORS.linked) }"></i>방향 모름</li>
      <!-- 편집 모드의 연결 화살표. 색은 상류·하류가 아니라 그 방향을 누가 말했는가다. -->
      <template v-if="editing && hasArrows">
        <li class="key-head">화살표 (누르면 방향 미리보기)</li>
        <li><i class="bar" :style="{ background: hex(arrowPalette.port) }"></i>포트 방향 (고정) <Src kind="bim" /></li>
        <li><i class="bar" :style="{ background: hex(arrowPalette.edit) }"></i>직접 정한 방향 <Src kind="edit" /></li>
        <li v-if="flowDraft"><i class="bar dashed" :style="{ color: hex(arrowPalette.preview) }"></i>미리보기 (적용 전)</li>
        <li v-if="showRules"><i class="bar dashed" :style="{ color: hex(arrowPalette.rule) }"></i>규칙 방향 <Src kind="dict" /></li>
        <li><i class="bar dashed" :style="{ color: hex(arrowPalette.none) }"></i>방향 모름</li>
      </template>
    </ul>

    <!-- 놓기 전에 이름을 치면 종류 후보(사전 → Laya, ADR-0057). 고른 것만 붙는다 — 안 고르면 종류 미상으로 놓인다.
         3D 왼쪽 위에 띄운다. 팔레트(왼쪽 아래)에 두면 팔레트가 커져 바닥을 가리고, 바닥을 누른 것이 [천장] 토글에 떨어졌다. -->
    <div v-if="adding?.what === 'equipment'" class="add-name">
      <input
        ref="addNameInput"
        v-model="addName"
        type="text"
        aria-label="새 설비 이름"
        placeholder="이름(선택) — 치면 종류 후보"
        @keydown.enter.prevent="acceptAddKind"
        @keydown.esc.stop.prevent="cancelAddEquipment"
      />
      <span v-if="addSuggestions.length" class="add-kinds" role="group" aria-label="새 설비 종류 후보">
        <button
          v-for="s in addSuggestions"
          :key="s.kind"
          type="button"
          :class="['ghost', { on: addKind === s.kind, unsure: s.p !== null && s.p < LAYA_SURE }]"
          :aria-pressed="addKind === s.kind"
          :title="s.p === null ? '이름 사전이 읽은 종류' : `Laya 가 이름으로 고른 종류 (${Math.round(s.p * 100)}%)`"
          @click="addKind = addKind === s.kind ? null : s.kind"
        >
          {{ equipmentKind(s.kind)?.label }}
          <small class="muted">{{ s.p === null ? '사전' : `Laya ${Math.round(s.p * 100)}%` }}</small>
        </button>
      </span>
      <small v-if="addMountHint" class="muted">{{ addMountHint }}</small>
    </div>
    <p v-if="editNotice" class="edit-notice" :class="{ 'over-note': keyNote }" role="alert">{{ editNotice }}</p>
    <!-- 경고가 떠 있어도 키로 한 일은 보인다. 남아 있는 경고(소속을 잃은 설비 등)가 뒤이어 막힌 이유("꼭짓점이 셋이라 …")를
         가리면 안 된다. 경고는 그 위로 한 줄 비킨다(.over-note). -->
    <p v-if="keyNote" class="hint pick-hint key-note" role="status">{{ keyNote }}</p>
    <!-- 다중층 뷰는 보기만 해서 편집 안내가 맞지 않는다. 그 자리는 다중층 안내 상자다. -->
    <p v-else-if="editing && !multiView && !editNotice" class="hint pick-hint">
      <template v-if="groupItems.length >= 2">
        설비 {{ groupItems.length }}대 · <kbd>←↑→↓</kbd>·드래그: 같이 옮기기 · <kbd>Delete</kbd>: 같이 지우기 · <kbd>Ctrl</kbd>+클릭: 넣고 빼기 · <kbd>Esc</kbd>: 풀기
      </template>
      <template v-else-if="selectedSpace">
        꼭짓점 핸들 드래그 또는 <kbd>[ ]</kbd> 후 <kbd>←↑→↓</kbd>: 꼭짓점 옮기기 · <kbd>F</kbd>: 이 물리존 보기
      </template>
      <template v-else-if="selected">
        드래그 또는 <kbd>←↑→↓</kbd>: 옮기기 · <kbd>PageUp/Down</kbd>: 층 바꾸기 · 화살표 클릭 또는 <kbd>[ ]</kbd>: 연결 고르기 ·
        <kbd>D</kbd>: 방향 미리보기 · <kbd>K</kbd>: 종류 고르기
      </template>
      <template v-else-if="selectedElement">
        <kbd>←↑→↓</kbd>: 옮기기(<kbd>Shift</kbd> 1m) · 다른 {{ activeTab === 'plan' ? '벽' : '벽·문·창' }} 클릭: 바꿔 고르기
      </template>
      <template v-else-if="archMode">
        {{ activeTab === 'plan' ? '벽' : '벽·문·창' }} 클릭: 선택 · 바닥 클릭: 물리존 꼭짓점 보기 ·
        <kbd>U</kbd>: 종류 모르는 설비로
      </template>
      <template v-else>
        설비 클릭: 선택 · <kbd>Ctrl</kbd>+클릭·드래그: 여러 개 · 선택한 설비 드래그: 옮기기 · 바닥 클릭: 물리존 꼭짓점 보기 ·
        <kbd>U</kbd>: 종류 모르는 설비로
      </template>
      · <button type="button" class="link" @click="helpOpen = true">단축키 전체 <kbd>?</kbd></button>
    </p>
    <p v-else-if="counts.equipment > 0 && !editNotice" class="hint pick-hint">
      {{
              activeTab === 'plan'
                ? '방이나 설비(점)를 클릭하면 오른쪽에 뜹니다. 휠로 확대, 드래그해서 이동합니다.'
                : selectedSystemId
                  ? '계통 하나만 보는 중입니다. 다시 누르면 전체를 봅니다.'
                  : '설비·배관을 클릭하면 연결된 것이 색으로 표시됩니다. 바닥을 누르면 그 방이 뜹니다. 계통은 오른쪽 범례에서 고르세요.'
            }}
    </p>
    <ExportCompare
      v-if="compareShown"
      :reading="compareReading"
      :pending="comparePending"
      :error="compareError"
      :storey-id="multiView ? null : viewStorey"
      :selected-id="compareSelected"
      :view="compareView"
      @select="selectFromCompare"
      @close="compareOpen = false"
    />
  </section>
</template>
