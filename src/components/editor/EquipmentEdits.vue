<script setup lang="ts">
import type { PropType } from 'vue'
import { EXTERIOR_ONLY, familyKeyOf, typeNameOf } from '../../lib/edit'
import { SYSTEM_KINDS, systemKind } from '../../lib/kinds'
import { canMountOn } from '../../lib/mount'
import { replayMemo } from '../../lib/replay-player'
import { needsSystem } from '../../lib/served'
import { candidateText } from '../../lib/system-suggest'
import { CROSS_STOREY_LOCKED, openMultiViewForSegment, selectedLock, setCeilingMode, VERTICAL_LOCKED } from '../../editor/ceiling'
import { KIND_GROUPS, kindSrc, whatIs } from '../../editor/checks'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { exteriorIds, spaceNameOf } from '../../editor/edit-report'
import { renameEquipmentTo } from '../../editor/equipment-edit'
import { applyMove, mmOf, positionDrafts } from '../../editor/equipment-shape'
import { followPreview, wallNameOf } from '../../editor/facade'
import { kindSelect } from '../../editor/keyboard'
import { familyCounts, familyLabel, kindOnlyThis, kindWarning, pickKind, positionSrc, typeLabel } from '../../editor/kinds'
import { onStoreyPick, storeyMoved, storeyOf } from '../../editor/multi-select'
import { exteriorMisplaced, placing, placingOn, startPlace, stopPlace } from '../../editor/place'
import { applySystem, createSystemFor, filteredSystemOptions, newSystemKind, newSystemName, newSystemOpen, pickSystem, SYSTEM_FILTER_FROM, systemChips, systemFilter, systemOptions } from '../../editor/systems'
import { MULTI_VIEW_ONLY, multiView } from '../../editor/vertical'
import Src from '../Src.vue'
import type { model as modelRef } from '../../editor/core'
import type { selected as selectedRef } from '../../editor/flow-rules'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
  selected: { type: null as unknown as PropType<NonNullable<typeof selectedRef.value>>, required: true },
})
</script>

<template>
  <p v-memo="replayMemo()" v-if="editing && selectedLock" class="ceiling-lock" role="status">
    {{ selectedLock }}
    <button v-if="selectedLock.includes('천장 편집 모드에서')" type="button" class="link" @click="setCeilingMode(true)">천장 편집으로</button>
    <button v-else-if="selectedLock.includes('바닥·벽')" type="button" class="link" @click="setCeilingMode(false)">바닥·벽으로</button>
    <!-- 다중층 뷰(E18 OE-ML-01)는 아직 없다. 들어갈 자리를 보이되 누르지 못하게 둔다. -->
    <button v-else-if="selectedLock === CROSS_STOREY_LOCKED" type="button" class="link" @click="openMultiViewForSegment(selected)">다중층 뷰에서 편집</button>
    <button v-else-if="selectedLock === VERTICAL_LOCKED" type="button" class="link" disabled title="엘리베이터·에스컬레이터는 아직 수직 관통 오브젝트(OE-ML-02)로 읽지 않아 관통 층을 모릅니다">다중층 뷰에서 편집</button>
  </p>
  <!-- 이름(태그) 고치기(E7). 지우기는 패널 맨 아래에 둔다 — 이름 칸 바로 옆에 있어 고치려다 누르기 쉬웠다. -->
  <p v-memo="replayMemo()" v-if="editing && !selectedLock" class="equipment-name-edit">
    <label>
      이름
      <input
        class="name-input"
        type="text"
        v-keep-typing
        :value="selected.name"
        @change="renameEquipmentTo(selected.id, ($event.target as HTMLInputElement).value)"
      />
    </label>
  </p>

  <!-- 종류 지정. 사전이 모르거나 잘못 읽은 종류를 같은 패밀리 전부에 한 번에 정한다. 잠금(천장·바닥 모드, 수직 관통)은 놓기·옮기기를
       막는 것이라 종류는 그대로 고친다 — 천장 설비가 바닥·벽 쪽에서 숨으면 [U]→[K] 가 천장 설비에서 멈췄다(성수 H-2). 다중층 뷰는 보기만 한다. -->
  <p v-memo="replayMemo()" v-if="editing && selectedLock !== MULTI_VIEW_ONLY" class="kind-edit">
    <label>
      종류
      <select
        ref="kindSelect"
        :value="selected.kind ?? ''"
        @change="pickKind($event, selected)"
      >
        <option value="">(모름)</option>
        <optgroup v-for="g in KIND_GROUPS" :key="g.label" :label="g.label">
          <option v-for="k in g.kinds" :key="k.kind" :value="k.kind">{{ k.label }}</option>
        </optgroup>
      </select>
    </label>
    <Src v-if="selected.kind || selected.kindEdited" :kind="kindSrc(selected)" />
    <span class="muted" :title="typeLabel(selected)">
      {{
                !typeNameOf(selected)
                  ? '타입 정보가 없어 이 설비에만 적용됩니다'
                  : kindOnlyThis
                    ? '이 설비에만 적용됩니다'
                    : `같은 패밀리 ${familyLabel(selected)}${(familyCounts.get(familyKeyOf(selected))?.types.size ?? 1) > 1 ? `(유형 ${familyCounts.get(familyKeyOf(selected))!.types.size}개)` : ''} ${familyCounts.get(familyKeyOf(selected))?.count ?? 1}대에 함께 적용됩니다`
              }}
    </span>
    <!-- 같은 패밀리가 여럿일 때만 — 한 대짜리면 고를 것이 없다. -->
    <label v-if="typeNameOf(selected) && (familyCounts.get(familyKeyOf(selected))?.count ?? 1) > 1" class="kind-only">
      <input v-model="kindOnlyThis" type="checkbox" /> 이 설비만
    </label>
  </p>

  <p v-memo="replayMemo()" v-if="editing && kindWarning" class="edit-notice inline" role="alert">{{ kindWarning }}</p>
  <!-- 외벽 전용 설비(OE-OBJ-04)가 외벽 바깥 면에 있지 않다. 종류를 바꾸거나 BIM 이 방 안에 둔 외기 센서다. -->
  <p v-memo="replayMemo()" v-if="exteriorMisplaced(selected)" class="edit-notice inline exterior-misplaced" role="alert">
    {{ EXTERIOR_ONLY }} 지금 자리는 {{ selected.position ? '외벽 바깥 면이 아닙니다' : '없습니다' }}.
    {{ editing ? '[벽에 붙이기]로 외벽 바깥쪽을 누르세요.' : '편집 모드에서 [벽에 붙이기]로 옮기세요.' }}
  </p>
  <!-- 계통 없는 VAV·토출구(OE-EQP-10). 보기 모드에서도 띄운다 — 내보내면 어느 계통의 구성원으로도 나가지 않는다. -->
  <p v-memo="replayMemo()" v-if="needsSystem(selected) && !selected.systemId" class="edit-notice inline system-missing" role="alert">
    {{ whatIs(selected)?.label ?? 'VAV·토출구' }}에 계통이 없습니다. 내보내면 어느 계통의 구성원(brick:hasPart)으로도 나가지 않아,
    DT 에서 계통으로 찾을 때 빠집니다. {{ editing ? '아래 계통 칸에서 정하세요.' : '편집 모드에서 계통을 정하세요.' }}
  </p>

  <!-- 계통(E8). 설비의 계통 한 자리를 바꾼다. 규칙 방향을 다시 돌리고 TTL 의 brick:hasPart 가 바뀐다. -->
  <p v-memo="replayMemo()" v-if="editing && !selectedLock" class="system-edit">
    <label>
      계통
      <select :value="selected.systemId ?? ''" @change="pickSystem($event, selected.id)">
        <option value="">(계통 없음)</option>
        <option v-for="o in filteredSystemOptions.options" :key="o.id" :value="o.id">{{ o.label }}</option>
      </select>
    </label>
    <Src v-if="selected.systemEdited" kind="edit" />
    <input
      v-if="systemOptions.length > SYSTEM_FILTER_FROM"
      v-model="systemFilter"
      v-keep-typing
      class="system-filter"
      type="search"
      :placeholder="`계통 ${systemOptions.length}개에서 찾기`"
      aria-label="계통 찾기"
    />
    <span v-if="systemFilter && filteredSystemOptions.options.length <= 1" class="muted">맞는 계통이 없습니다</span>
    <span v-else-if="filteredSystemOptions.hidden" class="muted">{{ filteredSystemOptions.hidden }}개 더 있습니다. 찾기 칸으로 줄이세요</span>
    <button type="button" class="link" @click="newSystemOpen = !newSystemOpen">새 계통…</button>
  </p>
  <!-- 계통이 없으면 근처 계통 후보(ADR-0057). 거리 순 셋. 누르면 위 상자에서 고른 것과 같다. -->
  <p v-memo="replayMemo()" v-if="editing && !selectedLock && systemChips.length" class="system-suggest" role="group" aria-label="계통 후보">
    계통 후보:
    <button
      v-for="c in systemChips"
      :key="c.system.id"
      type="button"
      class="link"
      :title="`${candidateText(c)} · ${c.distance.toFixed(1)}m`"
      @click="applySystem(selected.id, c.system.id)"
    >
      {{ c.system.name }}
      <small class="muted">{{ systemKind(c.system.kind)?.label ?? '종류 모름' }} · {{ c.distance.toFixed(1) }}m</small>
    </button>
  </p>
  <!-- 새 계통(E8). 사람이 더한 설비처럼 넣을 계통이 없을 때. 만들면 고른 설비를 바로 넣는다. -->
  <form v-memo="replayMemo()" v-if="editing && !selectedLock && newSystemOpen" class="system-edit new-system" @submit.prevent="createSystemFor(selected.id)">
    <input v-model="newSystemName" v-keep-typing type="text" placeholder="계통 이름" aria-label="새 계통 이름" required />
    <select v-model="newSystemKind" aria-label="새 계통 종류">
      <option value="">(종류 모름)</option>
      <option v-for="k in SYSTEM_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
    </select>
    <button type="submit" class="ghost" :disabled="!newSystemName.trim()">만들어 넣기</button>
  </form>

  <!-- 위치(E5·E6). 아래 설비 표와 같은 칸이다. N 으로 소속 없는 설비에 오면 좌표를 여기서 바로 넣는다 — 표는
       화면 아래 멀리 있다. 좌표가 없는 설비는 셋이 다 차야 옮긴다(0 으로 채우지 않는다). -->
  <p v-memo="replayMemo()" v-if="editing && !selectedLock" class="position-edit">
    위치
    <label v-for="axis in [0, 1, 2] as const" :key="axis">
      {{ 'xyz'[axis] }}
      <input
        class="coord mono"
        type="number"
        step="0.1"
        v-keep-typing
        :value="selected.position ? mmOf(selected.position[axis]) : (positionDrafts.get(selected.id)?.[axis] ?? '')"
        placeholder="—"
        @change="applyMove(selected.id, axis, ($event.target as HTMLInputElement).value, selected.position, $event.target as HTMLInputElement)"
      />
    </label>
    <Src v-if="selected.position" :kind="positionSrc(selected)" />
    <!-- 외벽 전용 설비(OE-OBJ-04). 누른 자리에서 가장 가까운 벽 면에 붙이고, 벽을 옮기면 같이 간다. -->
    <button
      v-if="editing && canMountOn(selected, 'wall')"
      type="button"
      :class="['ghost', 'place', 'mount', { on: placing === selected.id && placingOn === 'wall' }]"
      :aria-pressed="placing === selected.id && placingOn === 'wall'"
      @click="placing === selected.id && placingOn === 'wall' ? stopPlace() : startPlace(selected.id, 'wall')"
    >
      {{ placing === selected.id && placingOn === 'wall' ? '붙이기 취소' : '벽에 붙이기' }}
    </button>
    <span class="muted">
      {{
                selected.position
                  ? `${selected.wallId ? `${wallNameOf(selected.wallId)}에 붙음 · ` : ''}${selected.spaceId ? `소속 ${spaceNameOf(selected.spaceId)}` : exteriorIds.has(selected.id) ? '외벽 설비(소속 방 없음)' : '소속 방 없음'} · 방향키로도 옮길 수 있습니다`
                  : positionDrafts.has(selected.id)
                    ? 'x·y·z를 모두 넣어야 옮겨집니다'
                    : '좌표가 없습니다. x·y·z를 넣거나 왼쪽 도구의 미배치 목록에서 눌러 3D에 놓으세요'
              }}
    </span>
  </p>
  <!-- 옮기면 따라오는 배관(OE-PIP-12). [배관도 같이] 를 켰을 때만. 분기 이음쇠·추종 불가는 옮기기 전에 보이게 한다. -->
  <p v-memo="replayMemo()" v-if="editing && !selectedLock && followPreview" class="hint follow-preview" data-testid="follow-preview">
    <template v-if="!followPreview.crossing && followPreview.rigid + followPreview.stretch">
      옮기면 이음쇠 {{ followPreview.rigid }}개가 같이 가고 덕트·배관 {{ followPreview.stretch }}개가 늘어납니다.
    </template>
    <span v-if="followPreview.left" class="follow-left">{{ followPreview.left }}</span>
  </p>

  <!-- 층 옮기기(E6). 층은 좌표로 판정하지 않고 사람이 고른다(edit.ts). -->
  <p v-memo="replayMemo()" v-if="editing && !selectedLock && !multiView" class="storey-move">
    <label>
      층
      <select
        :value="storeyOf(selected.id)?.id ?? ''"
        :disabled="model.storeys.length < 2"
        @change="onStoreyPick(selected.id, $event.target as HTMLSelectElement)"
      >
        <option v-for="s in model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
    </label>
    <Src :kind="storeyMoved.has(selected.id) ? 'edit' : 'bim'" />
    <span class="muted">
      {{
                model.storeys.length < 2
                  ? '층이 하나뿐입니다.'
                  : selected.position
                    ? '층을 바꾸면 높이도 층 차이만큼 옮기고 소속 방을 다시 찾습니다.'
                    : '좌표가 없어 층만 바뀝니다.'
              }}
    </span>
  </p>
</template>
