<script setup lang="ts">
import type { PropType } from 'vue'
import { type Fluid, FLUID_KINDS, FLUIDS, SYSTEM_KINDS } from '../../lib/kinds'
import { replayMemo } from '../../lib/replay-player'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { selectedElementId } from '../../editor/equipment-edit'
import { selectedElement } from '../../editor/export-compare'
import { selected, selectedSystemBasis, showRules } from '../../editor/flow-rules'
import { selectedSystem } from '../../editor/kinds'
import { groupItems } from '../../editor/multi-select'
import { clearInspectorSelection, hasInspectorSelection, inspectorBadge } from '../../editor/panels'
import { openDrawer } from '../../editor/shell'
import { selectedRoom } from '../../editor/rooms'
import { selectedCustomZone } from '../../editor/space-edit'
import { selectedObject, selectedSpace } from '../../editor/space-objects'
import { removeSystem, renameSystemTo, setSystemKindTo, systemFlow, systemKindSrc, systemKindText, systemNameAtOpen } from '../../editor/systems'
import { selectedVertical, selectedVerticalId, verticalCreate } from '../../editor/vertical'
import FlowBasis from '../FlowBasis.vue'
import Src from '../Src.vue'
import CustomZoneInspector from './CustomZoneInspector.vue'
import ElementInspector from './ElementInspector.vue'
import ExportLines from './ExportLines.vue'
import EquipmentInspector from './EquipmentInspector.vue'
import GroupInspector from './GroupInspector.vue'
import ObjectInspector from './ObjectInspector.vue'
import FloorStatus from './FloorStatus.vue'
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
  <!-- 위 카드 = 선택 오브젝트(design-system.md 4장, 2026-10-16 PM 결정). 늘 맨 위에 있고 고른 것의 종류에 따라 내용이 바뀐다. 넘치면 이 카드만 스크롤. -->
  <section class="shell-sel" aria-label="선택 오브젝트">
  <header class="shell-card-head">
    <h3>선택 오브젝트<template v-if="hasInspectorSelection"> · {{ inspectorBadge }}</template></h3>
    <button v-if="hasInspectorSelection" type="button" class="link side-clear" title="선택을 해제합니다 (Esc)" @click="clearInspectorSelection">선택 해제 ×</button>
  </header>
  <!-- 고른 설비의 연결. 상류·하류를 아는지 모르는지를 여기서 분명히 말한다. -->
  <!-- 고른 것이 바뀌면 패널을 살짝 갈아 끼운다. 같은 것을 고친 것은 key 가 같아 가만히 있고, 바뀐 값만 v-flash 가 번쩍인다. -->
  <div class="side-inspector-wrap">
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
  <div v-else key="overview" class="shell-empty-sel" data-testid="empty-selection">
    <p class="shell-empty-title">고른 것 없음</p>
    <p class="muted">캔버스나 아래 층 현황 목록에서 오브젝트를 고르면 여기에 그 정보가 보입니다. 물리존 · 커스텀존 · 공조존을 고르면 그 존의 정보를, 설비를 고르면 설비 정보를 보입니다.</p>
    <p class="muted">생성 기준 · 수용 기준선 등급 · 규칙 경고는 위 <button type="button" class="link" @click="openDrawer()">[기준 ▾]</button> 에서 봅니다.</p>
  </div>
  </Transition>
  <!-- 고른 것이 내보내는 TTL·GeoJSON 의 줄. 계통만 고른 때는 그 계통의 블록이다. -->
  <ExportLines />
  </div>

      <!-- 범례에서 고른 계통. 종류·유체는 규칙 방향과 TTL 계통 클래스를 정한다. 편집 모드에서 고친다(E8). -->
      <section v-if="selectedSystem" class="picked system-picked">
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

  </section>
  <!-- 아래 카드 = 층 현황(OE-UI-04 ③). 높이 고정, 종류 칸 다섯. 계통 범례는 설비 칸의 계통 칩으로 옮겼다. -->
  <FloorStatus />
  </aside>
</template>
