<script setup lang="ts">
import type { PropType } from 'vue'
import { type Fluid, FLUID_KINDS, FLUIDS, SYSTEM_KINDS } from '../../lib/kinds'
import { replayMemo } from '../../lib/replay-player'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { selectedElementId } from '../../editor/equipment-edit'
import { selectedElement } from '../../editor/export-compare'
import { selected, selectedSystemBasis, showRules } from '../../editor/flow-rules'
import { legend, selectedSystem, selectedSystemId } from '../../editor/kinds'
import { breadcrumb, floorFullRooms, floorNow, floorNowStatus, pickFromSummary } from '../../editor/layout-storeys'
import { groupItems } from '../../editor/multi-select'
import { clearInspectorSelection, filteredLegend, hasInspectorSelection, inspectorBadge, legendOpen, legendSearch, sideTab } from '../../editor/panels'
import { selectedRoom } from '../../editor/rooms'
import { selectedCustomZone } from '../../editor/space-edit'
import { selectedObject, selectedSpace } from '../../editor/space-objects'
import { removeSystem, renameSystemTo, setSystemKindTo, systemFlow, systemKindSrc, systemKindText, systemNameAtOpen, toggleSystem } from '../../editor/systems'
import { selectedVertical, selectedVerticalId, verticalCreate } from '../../editor/vertical'
import FloorSummary from '../FloorSummary.vue'
import FlowBasis from '../FlowBasis.vue'
import Src from '../Src.vue'
import CustomZoneInspector from './CustomZoneInspector.vue'
import ElementInspector from './ElementInspector.vue'
import EquipmentInspector from './EquipmentInspector.vue'
import GroupInspector from './GroupInspector.vue'
import ObjectInspector from './ObjectInspector.vue'
import OverviewPanel from './OverviewPanel.vue'
import RoomInspector from './RoomInspector.vue'
import SpaceInspector from './SpaceInspector.vue'
import VerticalCreatePanel from './VerticalCreatePanel.vue'
import VerticalInspector from './VerticalInspector.vue'
import type { counts as countsRef, model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <aside v-memo="replayMemo()" class="side">
  <nav class="side-tabs" aria-label="우측 패널 구역">
    <button type="button" :class="{ on: sideTab === 'all' }" :aria-pressed="sideTab === 'all'" title="모든 우측 카드를 함께 표시합니다" @click="sideTab = 'all'">전체</button>
    <button type="button" :class="{ on: sideTab === 'inspector' }" :aria-pressed="sideTab === 'inspector'" title="선택한 요소 속성 또는 파일 개요만 표시합니다" @click="sideTab = 'inspector'">
      {{ inspectorBadge }}
    </button>
    <button v-if="floorNow && breadcrumb" type="button" :class="{ on: sideTab === 'floor' }" :aria-pressed="sideTab === 'floor'" title="현재 층의 공간·설비 현황만 표시합니다" @click="sideTab = 'floor'">
      현재 층
    </button>
    <button v-if="legend.length" type="button" :class="{ on: sideTab === 'systems' }" :aria-pressed="sideTab === 'systems'" title="계통 상세와 색상 범례만 표시합니다" @click="sideTab = 'systems'">
      계통 <small class="mono">{{ legend.length }}</small>
    </button>
    <button v-if="hasInspectorSelection" type="button" class="side-clear" title="선택을 해제하고 파일 개요로 돌아갑니다 (Esc)" @click="clearInspectorSelection">
      파일 개요로 ×
    </button>
  </nav>
  <!-- 고른 설비의 연결. 상류·하류를 아는지 모르는지를 여기서 분명히 말한다. -->
  <!-- 고른 것이 바뀌면 패널을 살짝 갈아 끼운다. 같은 것을 고친 것은 key 가 같아 가만히 있고, 바뀐 값만 v-flash 가 번쩍인다. -->
  <div v-show="sideTab === 'all' || sideTab === 'inspector'" class="side-inspector-wrap">
  <Transition name="swap" mode="out-in">
  <!-- 여러 개 고른 설비(OE-UI-09). 방향키·끌기로 같이 옮기고 Delete 로 같이 지운다. 되돌리기 한 번에 전부. -->
  <GroupInspector v-if="groupItems.length >= 2" key="group" :group-items="groupItems" />
  <EquipmentInspector v-else-if="selected" :key="`e:${selected.id}`" :counts="counts" :model="model" :selected="selected" />

  <!-- 3D·평면도에서 고른 물리존(E2). 바닥을 누르면 뜬다. 고치는 칸은 편집 모드에만. -->
  <!-- 3D 에서 고른 벽·문·창(E4). [벽·문·창] 을 켰을 때만 골라진다. -->
  <ElementInspector v-else-if="selectedElement" :key="`w:${selectedElementId}`" :selected-element="selectedElement" />
  <!-- 수직 관통 오브젝트 만들기(OE-ML-06). 계획·채우기는 모델을 바꾸지 않고 [만들기] 때 한 번에 넣는다. -->
  <VerticalCreatePanel v-else-if="verticalCreate" key="vertical-create" :vertical-create="verticalCreate" />
  <!-- 수직 관통 오브젝트의 층 조각(OE-ML-05). 층 편집 화면에서는 보기만 한다. 연관 물리존은 진입·종료 지점으로 그때 짚는다. -->
  <VerticalInspector v-else-if="selectedVertical" :key="`vertical:${selectedVerticalId}`" :model="model" :selected-vertical="selectedVertical" />
  <!-- 커스텀존(OE-OBJ-01). 품는 방·든 설비는 쓸 때 계산한 것이라 물리존·설비를 고치면 따라 바뀐다. -->
  <!-- 추가 공간 오브젝트(OE-OBJ-09). 끌거나 방향키로 옮기고, 칸으로 크기를 바꾼다. -->
  <ObjectInspector v-else-if="selectedObject" :key="`object:${selectedObject.object.id}`" :selected-object="selectedObject" />
  <!-- 룸(OE-OBJ-03 · OE-SPC-11). 물리존 안의 사각 편집 단위. 꼭짓점 손잡이로 크기, 방향키로 자리를 바꾼다. -->
  <RoomInspector v-else-if="selectedRoom" :key="`room:${selectedRoom.room.id}`" :selected-room="selectedRoom" />
  <CustomZoneInspector v-else-if="selectedCustomZone" :key="`cz:${selectedCustomZone.zone.id}`" :selected-custom-zone="selectedCustomZone" />
  <SpaceInspector v-else-if="selectedSpace" :key="`s:${selectedSpace.space.id}`" :selected-space="selectedSpace" />
  <!-- 아무것도 고르지 않았을 때. 이 파일이 어디까지 찼는지와, 무엇을 누르면 여기 무엇이 뜨는지. -->
  <OverviewPanel v-else key="overview" :counts="counts" :model="model" />
  </Transition>
  </div>
  <!-- 현재 층 현황(OE-UI-04 ③). 고른 것의 속성은 위에, 이것은 늘 그 아래에 보인다. -->
  <FloorSummary
    v-if="floorNow && breadcrumb"
    v-show="sideTab === 'all' || sideTab === 'floor'"
    :building="breadcrumb.building"
    :storey="breadcrumb.storey"
    :status="floorNowStatus"
    :summary="floorNow"
    :full-rooms="floorFullRooms"
    @pick="pickFromSummary"
  />

      <!-- 범례에서 고른 계통. 종류·유체는 규칙 방향과 TTL 계통 클래스를 정한다. 편집 모드에서 고친다(E8). -->
      <section v-if="selectedSystem" v-show="sideTab === 'all' || sideTab === 'systems'" class="picked system-picked">
        <h3>{{ selectedSystem.name || '(이름 없는 계통)' }}</h3>
        <p v-if="systemNameAtOpen(selectedSystem.id) !== null && systemNameAtOpen(selectedSystem.id) !== selectedSystem.name" class="stats system-renamed">
          BIM 이름 {{ systemNameAtOpen(selectedSystem.id) || '(없음)' }} <Src kind="bim" /> → 고친 이름 <Src kind="edit" />
        </p>
        <p class="stats">
          구성 {{ selectedSystem.memberIds.length }}개 <Src :kind="selectedSystem.added ? 'edit' : 'bim'" /> ·
          {{ systemKindText(selectedSystem.kind, selectedSystem.fluid) }}
          <Src v-if="selectedSystem.kind || selectedSystem.kindEdited" :kind="systemKindSrc(selectedSystem)" />
          <template v-if="!selectedSystem.kindEdited && selectedSystem.fluid && selectedSystem.fluidSource === 'rule'">
            (유체는 배관이 닿는 원천 기기로 짐작 <Src kind="dict" />)
          </template>
          <template v-else-if="!selectedSystem.kindEdited && selectedSystem.fluid && selectedSystem.fluidSource !== selectedSystem.kindSource">
            (유체 <Src :kind="selectedSystem.fluidSource === 'bim' ? 'bim' : 'dict'" />)
          </template>
        </p>
        <!-- 이 계통의 흐름 방향 근거(flow-cascade.ts). 규칙 방향이 없는 계통도 포트·사람 방향과 brick:feeds 수는 보인다. -->
        <FlowBasis v-if="selectedSystemBasis && selectedSystemBasis.total" :basis="selectedSystemBasis" :name="selectedSystem.name || selectedSystem.id" />
        <!-- 3D 의 흐르는 빛(flow-pulse.ts)이 어디에 있고 왜 드문지. 방향을 모르는 연결에는 빛이 없다. -->
        <p v-if="systemFlow && systemFlow.total" class="hint" data-testid="system-flow-note">
          <template v-if="systemFlow.edges.length">
            3D의 흐르는 빛은 방향을 아는 연결 {{ systemFlow.edges.length.toLocaleString() }}개에만 있습니다. 나머지
            {{ (systemFlow.total - systemFlow.edges.length).toLocaleString() }}개는 방향을 몰라 빛이 없습니다.
          </template>
          <template v-else>연결 {{ systemFlow.total.toLocaleString() }}개 모두 방향을 몰라 3D에 흐르는 빛이 없습니다.</template>
          <template v-if="!showRules"> 규칙 방향은 R 로 켜면 옅게 더해집니다.</template>
        </p>
        <p v-if="editing" class="system-edit system-name-edit">
          <label>
            이름
            <input
              type="text"
              v-keep-typing
              :value="selectedSystem.name"
              aria-label="계통 이름"
              @change="renameSystemTo(selectedSystem.id, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </p>
        <p v-if="editing" class="system-edit system-kind-edit">
          <label>
            종류
            <select
              :value="selectedSystem.kind ?? ''"
              @change="setSystemKindTo(selectedSystem.id, ($event.target as HTMLSelectElement).value || null, selectedSystem.fluid ?? null)"
            >
              <option value="">(모름)</option>
              <option v-for="k in SYSTEM_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
            </select>
          </label>
          <label v-if="selectedSystem.kind && FLUID_KINDS.includes(selectedSystem.kind)">
            유체
            <select
              :value="selectedSystem.fluid ?? ''"
              @change="setSystemKindTo(selectedSystem.id, selectedSystem.kind ?? null, (($event.target as HTMLSelectElement).value || null) as Fluid | null)"
            >
              <option value="">(모름)</option>
              <option v-for="f in FLUIDS" :key="f.fluid" :value="f.fluid">{{ f.label }}</option>
            </select>
          </label>
        </p>
        <p v-if="editing" class="system-edit">
          <button type="button" class="ghost danger" title="계통을 지웁니다. 구성원은 이 계통 자리만 잃습니다 (Ctrl+Z 로 되돌림)" @click="removeSystem(selectedSystem.id)">
            계통 지우기
          </button>
          <span v-if="selectedSystem.added" class="muted">에디터에서 만든 계통 <Src kind="edit" /></span>
        </p>
        <p v-else-if="selectedSystem.kind && FLUID_KINDS.includes(selectedSystem.kind) && !selectedSystem.fluid" class="hint">
          유체(냉수·온수)를 모릅니다. 편집 모드에서 고르면 TTL 계통 클래스가 유체 클래스가 됩니다.
        </p>
      </section>

      <!-- 계통 범례. 색이 스물이면 색만으로는 못 고르니, 여기서 짚는 쪽이 주된 길이다. -->
      <div v-if="legend.length" v-show="sideTab === 'all' || sideTab === 'systems'" class="legend">
        <div class="legend-head">
          <h3>
            계통 {{ legend.length }}
            <span v-if="legend[0].source === 'property'" class="tag">System Name 속성</span>
            <span v-else class="tag">IfcSystem</span>
            <Src kind="bim" />
          </h3>
          <button type="button" class="link legend-collapse" :aria-expanded="legendOpen" @click="legendOpen = !legendOpen">
            {{ legendOpen ? '접기 ▾' : '펼치기 ▸' }}
          </button>
        </div>
        <input
          v-if="legendOpen && legend.length > 6"
          v-model="legendSearch"
          v-keep-typing
          type="text"
          class="legend-search"
          placeholder="계통 이름 검색…"
          aria-label="계통 범례 검색"
        />
        <ul v-show="legendOpen">
          <li v-for="s in filteredLegend" :key="s.id">
            <button
              type="button"
              :class="{ on: s.id === selectedSystemId }"
              :aria-pressed="s.id === selectedSystemId"
              @click="toggleSystem(s.id)"
            >
              <i :style="{ background: s.color }"></i>
              <span v-if="s.kind" class="kind">{{ s.kind }}</span>
              <span class="name" :title="s.title">{{ s.name }}</span>
              <span class="mono muted" :title="s.title">기기 {{ s.devices }}</span>
            </button>
          </li>
        </ul>
      </div>
  </aside>
</template>
