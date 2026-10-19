<script setup lang="ts">
import type { PropType } from 'vue'
import { ceilingOf } from '../../lib/ceiling'
import { ifcClassLabel } from '../../lib/kinds'
import { CEILING_RING_COLORS } from '../../lib/viewer'
import { ceilingAsk, ceilingAskInput, ceilingMode, ceilingStorey, editPart, lockedTool, setCeilingMode, startCustomZone } from '../../editor/ceiling'
import { whatIs } from '../../editor/checks'
import { vKeepTyping } from '../../editor/edit-filter'
import { meters, saveCeiling } from '../../editor/edit-report'
import { adding, archMode, cancelAddEquipment, startAddEquipment, stopAdd } from '../../editor/equipment-edit'
import { shortName } from '../../editor/equipment-shape'
import { carryConduits, exteriorEditor, startOpening, startWall } from '../../editor/facade'
import { hex } from '../../editor/kinds'
import { openMultiView } from '../../editor/multi-view'
import { startRoom } from '../../editor/offset'
import { placeFromList, UNPLACED_SHOWN, unplacedHere, unplacedOpen } from '../../editor/panels'
import { placing, stopPlace } from '../../editor/place'
import { ceilingMarks, startCreateSpace } from '../../editor/space-edit'
import { importObjectModel, modelInput, objectLibrary, objectsOpen, startAddObject } from '../../editor/space-objects'
import { startCreateVertical } from '../../editor/vertical-create'
import Src from '../Src.vue'
import type { model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <nav class="tool-palette" aria-label="편집 도구">
    <!-- 천장 편집 모드(OE-OBJ-08). 천장 쪽에서는 공간 도구와 바닥·벽 도구가 잠기고, 누르면 어디서 편집하는지 알린다. -->
    <template v-if="editPart === 'space'">
    <span class="palette-head">공간 그리기</span>
    <!-- 두 버튼을 한 줄에 둔다. 팔레트가 높아지면 3D 왼쪽 아래(작은 파일에서는 건물이 있는 자리)를 가린다. -->
    <span class="palette-row">
      <button data-ico="▢" type="button" :class="['ghost', { locked: ceilingMode }]" aria-label="물리존 그리기" title="바닥에 꼭짓점을 찍어 새 물리존(방)을 그립니다" @click="ceilingMode ? lockedTool() : startCreateSpace()">물리존</button>
      <button data-ico="⊡" type="button" :class="['ghost', { locked: ceilingMode }]" aria-label="룸 그리기" title="물리존 안에 대각선 두 꼭짓점을 찍어 세부 룸을 그립니다" @click="ceilingMode ? lockedTool() : startRoom()">룸</button>
      <button data-ico="⬚" type="button" :class="['ghost', { locked: ceilingMode }]" aria-label="커스텀존 그리기" title="물리존 위에 운영 구역(임원석·식당 등)을 다각형으로 그립니다. 서로 겹쳐도 됩니다" @click="ceilingMode ? lockedTool() : startCustomZone()">커스텀존</button>
    </span>
    <!-- 켜면 3D 에 벽·문·창이 서고 바닥 누르기가 그것을 먼저 고른다(E4). 옆의 [오브젝트] 는 추가 공간 오브젝트 라이브러리를 편다
         (OE-SPC-14). 둘을 한 줄에 두고 머리말도 따로 두지 않는다 — 팔레트가 높아지면 3D 왼쪽 아래(작은 파일에서는 건물이 있는 자리)를 가린다. -->
    <span class="palette-row">
      <button data-plan data-ico="▥" type="button" :class="['ghost', { on: archMode, locked: ceilingMode }]" :aria-pressed="archMode" title="벽·문·창을 3D에 세우고 고쳐 봅니다" @click="ceilingMode ? lockedTool() : (archMode = !archMode)">
        벽·문·창
      </button>
      <button data-ico="▦"
        type="button"
        :class="['ghost', 'objects-toggle', { on: objectsOpen || adding?.what === 'object', locked: ceilingMode }]"
        :aria-expanded="objectsOpen"
        title="책상·의자 같은 추가 공간 오브젝트를 라이브러리에서 골라 놓습니다"
        @click="ceilingMode ? lockedTool() : (objectsOpen = !objectsOpen)"
      >
        오브젝트
      </button>
    </span>
    <!-- 수직 관통 오브젝트는 다중층 뷰에서 만든다(OE-ML-06). 여기서 누르면 지금 층과 위층으로 열고 만들기 칸을 띄운다 — 다중층 뷰
         안쪽에만 길이 있으면 찾지 못했다(2026-10-13). 위 줄에 붙이면 팔레트 밖으로 삐져나와 제 줄에 둔다. -->
    <button data-ico="⫶" v-if="model && model.storeys.length > 1" type="button" :class="['ghost', { locked: ceilingMode }]" title="다중층 뷰(지금 층과 위층)를 열어 계단·샤프트를 만듭니다" @click="ceilingMode ? lockedTool() : startCreateVertical('stair')">계단·샤프트</button>
    <div v-if="objectsOpen && !ceilingMode" class="object-library" role="group" aria-label="오브젝트 라이브러리">
      <button
        v-for="item in objectLibrary"
        :key="item.key"
        type="button"
        :class="['ghost', { on: adding?.what === 'object' && adding.item === item.key }]"
        :title="`${item.name} · ${item.size.map((v) => v.toFixed(2)).join(' × ')} m`"
        @click="adding?.what === 'object' && adding.item === item.key ? stopAdd() : startAddObject(item.key)"
      >
        {{ item.name }}
      </button>
      <button type="button" class="ghost object-import" title="GLB(또는 glTF) 3D 모델 파일을 불러와 라이브러리 항목을 추가합니다" @click="modelInput?.click()">
        + 3D 모델
      </button>
      <input
        ref="modelInput"
        type="file"
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        hidden
        data-testid="object-model-input"
        @change="(ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) importObjectModel(f); (ev.target as HTMLInputElement).value = '' }"
      />
    </div>
    <template v-if="archMode">
      <button data-ico="╱" type="button" class="ghost" title="바닥에 두 점을 찍어 벽을 긋습니다" @click="startWall">벽 긋기</button>
      <button data-ico="◫" type="button" :class="['ghost', { on: adding?.what === 'door' }]" title="벽 가까이 눌러 문을 놓습니다" @click="adding?.what === 'door' ? stopAdd() : startOpening('door')">문 놓기</button>
      <button data-ico="▭" type="button" :class="['ghost', { on: adding?.what === 'window' }]" title="벽 가까이 눌러 창을 놓습니다" @click="adding?.what === 'window' ? stopAdd() : startOpening('window')">창 놓기</button>
      <!-- 외벽 에디터(OE-EXT-03). 외벽을 고르면 다른 층의 같은 면 외벽까지 묶어 함께 옮긴다. -->
      <button data-ico="⧉"
        type="button"
        :class="['ghost', { on: exteriorEditor }]"
        :aria-pressed="exteriorEditor"
        title="외벽을 고르면 다른 층에서 같은 면에 쌓인 외벽까지 묶어, 방향키로 전 층을 함께 옮깁니다"
        data-testid="exterior-editor"
        @click="exteriorEditor = !exteriorEditor"
      >
        외벽 에디터
      </button>
    </template>
    </template>
    <template v-else>
    <!-- [바닥·벽 / 천장] 토글(T). 제목 줄에 둔다 — 줄을 하나 더 쓰면 팔레트가 3D 왼쪽 아래 바닥을 가린다. -->
    <span class="palette-head palette-head-row">
      설비
      <span class="ceiling-toggle" role="group" aria-label="설비 편집 면">
        <button type="button" :class="{ on: !ceilingMode }" :aria-pressed="!ceilingMode" title="바닥·벽 설비와 배관을 편집합니다" @click="setCeilingMode(false)">바닥·벽</button>
        <button type="button" :class="{ on: ceilingMode }" :aria-pressed="ceilingMode" title="천장 설비만 편집합니다. 위에서 내려다보고 천장고에 천장면을 그립니다 (T)" @click="setCeilingMode(true)">천장</button>
      </span>
    </span>
    <!-- 천장 모드에서 지금 층의 반자 높이를 모르면 입력을 받는다. 그 전에는 천장 설비를 놓지 않는다(0 이나 층고로 채우지 않는다). -->
    <form v-if="ceilingAsk" class="ceiling-ask" @submit.prevent="saveCeiling(ceilingStorey!.id, Number(ceilingAskInput))">
      <label>
        {{ ceilingStorey!.name }} 천장고
        <input
          v-model="ceilingAskInput"
          v-keep-typing
          type="number"
          step="0.05"
          min="0.3"
          aria-label="천장 모드 천장고(m)"
          @keydown.enter.prevent="saveCeiling(ceilingStorey!.id, Number(ceilingAskInput))"
        />
        m
      </label>
      <button type="submit" class="ghost">정하기</button>
    </form>
    <span v-else-if="ceilingStorey && ceilingOf(ceilingStorey)" class="ceiling-now muted">
      천장고 {{ meters(ceilingOf(ceilingStorey)!.height) }} <Src :kind="ceilingOf(ceilingStorey)!.source" />
    </span>
    <button data-ico="＋"
      type="button"
      :class="['ghost', { on: adding?.what === 'equipment' }]"
      :aria-pressed="adding?.what === 'equipment'"
      :disabled="ceilingAsk"
      :title="ceilingMode ? '천장을 눌러 새 설비를 천장고에 놓습니다' : '바닥을 눌러 새 설비를 놓습니다'"
      @click="adding?.what === 'equipment' ? cancelAddEquipment() : startAddEquipment()"
    >
      {{ adding?.what === 'equipment' ? '더하기 취소' : '설비 더하기' }}
    </button>
    <!-- 미배치 목록 펼치기. 작은 글자 한 줄로 둔다 — 버튼 줄을 더 쓰거나 [설비 더하기] 옆에 두면 팔레트가 커져 3D 왼쪽 아래 바닥을 가린다. -->
    <button v-if="unplacedHere.length" type="button" class="link unplaced-toggle" :aria-expanded="unplacedOpen" @click="unplacedOpen = !unplacedOpen">
      미배치 {{ unplacedHere.length.toLocaleString() }}대 {{ unplacedOpen ? '▾' : '▸' }}
    </button>
    <!-- 미배치 설비(OE-EQP-02). 누르면 바로 놓기 — 그 층 바닥(천장 모드면 천장)을 누르면 그 자리에 놓인다. 같은 설비를 다시
         누르거나 Esc 면 취소다. 접어 둔다 — 펼친 채면 팔레트가 3D 왼쪽 아래를 가린다. -->
    <template v-if="unplacedHere.length && unplacedOpen">
      <ul class="palette-unplaced" aria-label="미배치 설비">
        <li v-for="u in unplacedHere.slice(0, UNPLACED_SHOWN)" :key="u.equipment.id">
          <button
            type="button"
            :class="{ on: placing === u.equipment.id }"
            :aria-pressed="placing === u.equipment.id"
            :title="`${u.storey.name} · ${whatIs(u.equipment)?.label ?? ifcClassLabel(u.equipment.ifcClass) ?? u.equipment.ifcClass}`"
            @click="placing === u.equipment.id ? stopPlace() : placeFromList(u.equipment.id)"
          >
            {{ u.equipment.name ? shortName(u.equipment.name) : `(이름 없음 · ${whatIs(u.equipment)?.label ?? ifcClassLabel(u.equipment.ifcClass) ?? u.equipment.ifcClass})` }}
          </button>
        </li>
        <li v-if="unplacedHere.length > UNPLACED_SHOWN" class="muted">외 {{ (unplacedHere.length - UNPLACED_SHOWN).toLocaleString() }}대</li>
      </ul>
    </template>
    <label v-if="!ceilingMode" class="palette-check" title="설비를 옮기면 붙은 이음쇠는 같이 옮기고, 그 너머 덕트·배관은 먼 끝을 두고 늘입니다">
      <input v-model="carryConduits" type="checkbox" /> 배관도 같이
    </label>
    <!-- 천장 설비의 바닥 발자국 링(OE-EQP-04). 색은 구역이다. 왼쪽 위 색 안내에 넣었더니 길어져 3D 의 설비를 덮었다. -->
    <span v-if="ceilingMarks.length && !ceilingMode" class="ceiling-key" title="천장 설비는 바닥에 링으로 보입니다. 고르면 링까지 점선이 내려옵니다(OE-EQP-04)">
      <i class="ring" :style="{ color: hex(CEILING_RING_COLORS.attached) }"></i>반자 부착
      <i class="ring" :style="{ color: hex(CEILING_RING_COLORS.plenum) }"></i>플레넘
    </span>
    <!-- 라이저(OE-UI-04 · OE-ML-12). 층간 배관은 다중층 뷰에서 그린다 — 설비를 고르면 다른 층 설비까지 잇는 칸이 뜬다. -->
    <button data-ico="⇅" v-if="model && model.storeys.length > 1" type="button" class="ghost" title="다중층 뷰를 열어 층간 배관(라이저)을 그립니다" @click="openMultiView()">라이저</button>
    <button data-ico="⇕" v-if="model && model.storeys.length > 1" type="button" class="ghost" title="다중층 뷰(지금 층과 위층)를 열어 엘리베이터·에스컬레이터를 만듭니다" @click="startCreateVertical('elevator')">EL·ES</button>
    </template>
  </nav>
</template>
