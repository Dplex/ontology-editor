<script setup lang="ts">
import type { PropType } from 'vue'
import { airflowText } from '../../lib/airflow'
import { ceilingOf } from '../../lib/ceiling'
import { ROOM_KINDS, roomKind } from '../../lib/kinds'
import { vFlash } from '../../lib/motion'
import { replayMemo } from '../../lib/replay-player'
import { CHECK_LABELS, isFull } from '../../lib/space-checklist'
import { checkFixLabel, fixCheck, selectedChecklist, selectedSpaceInfluence, whatIs } from '../../editor/checks'
import { editing } from '../../editor/core'
import { applyRename, applySpaceKind, dictKindOfSelected, sameNameGroup, vKeepTyping } from '../../editor/edit-filter'
import { spaceNameOf } from '../../editor/edit-report'
import { shortName } from '../../editor/equipment-shape'
import { equipmentStorey, spaceView } from '../../editor/flow-map'
import { equipmentById } from '../../editor/flow-rules'
import { activeVertex, vertexCount } from '../../editor/grid-snap'
import { selectZone, zonesOfSpace } from '../../editor/idf-zones'
import { applySpaceAirflow, mergeCandidates, mergeInto, removeSpace } from '../../editor/offset'
import { editVertex } from '../../editor/place'
import { selectedSpaceId, spaceConduits, spaceDevices, spaceKinds } from '../../editor/rooms'
import { startSplit } from '../../editor/space-edit'
import { applySpaceNumber } from '../../editor/storey-name'
import { select } from '../../editor/systems'
import { enterSpaceView, exitSpaceView } from '../../editor/view-filter'
import Src from '../Src.vue'
import ChangeBadge from './ChangeBadge.vue'
import type { selectedSpace as selectedSpaceRef } from '../../editor/space-objects'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  selectedSpace: { type: null as unknown as PropType<NonNullable<typeof selectedSpaceRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked space-picked">
    <div class="picked-head">
      <div>
        <div class="picked-title">
          <h3>{{ selectedSpace.space.longName || selectedSpace.space.name }}</h3>
          <ChangeBadge :id="selectedSpace.space.id" />
        </div>
        <dl class="stats facts">
          <div>
            <dt>물리존</dt>
            <dd>{{ selectedSpace.space.name }} <Src kind="bim" /> · {{ selectedSpace.storey.name }} <Src kind="bim" /></dd>
          </div>
          <!-- 방 종류(TTL 의 Brick 클래스). 이름을 고치면 따라 바뀌므로, 고친 사람이 무엇이 됐는지 여기서 본다. -->
          <div>
            <dt>종류</dt>
            <dd v-flash="selectedSpace.space.kind" class="space-kind">
              <!-- 방 종류를 사람이 정한다(OE-SPC-17). 같은 공간명의 방(모든 층)에 함께 붙는다. -->
              <template v-if="editing">
                <select
                  data-testid="space-kind"
                  :value="selectedSpace.space.kindSource === 'edit' ? (selectedSpace.space.kind ?? '') : '__name'"
                  @change="
                          applySpaceKind(
                            selectedSpace.space.id,
                            (($event.target as HTMLSelectElement).value === '__name' ? undefined : ($event.target as HTMLSelectElement).value || null),
                          )
                        "
                >
                  <option value="__name">이름으로 정하기({{ dictKindOfSelected }})</option>
                  <option value="">모름</option>
                  <option v-for="k in ROOM_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option>
                </select>
                <Src :kind="selectedSpace.space.kindSource === 'edit' ? 'edit' : selectedSpace.space.kindSource === 'bim' ? 'bim' : 'dict'" />
                <small v-if="sameNameGroup.length > 1" class="muted" data-testid="space-kind-group">
                  공간명이 같은 방 {{ sameNameGroup.length }}개(모든 층)에 함께 적용됩니다
                </small>
              </template>
              <template v-else-if="roomKind(selectedSpace.space.kind)">
                {{ roomKind(selectedSpace.space.kind)!.label }}
                <Src :kind="selectedSpace.space.kindSource === 'edit' ? 'edit' : selectedSpace.space.kindSource === 'bim' ? 'bim' : 'dict'" />
              </template>
              <span v-else class="muted">모름</span>
            </dd>
          </div>
          <div>
            <dt>넓이</dt>
            <dd v-flash="(selectedSpace.space.areaM2 - selectedSpace.slabCutM2).toFixed(1)">
              <b class="mono">{{ Math.max(0, selectedSpace.space.areaM2 - selectedSpace.slabCutM2).toFixed(1) }}</b> ㎡ <Src :kind="selectedSpace.edited ? 'edit' : 'calc'" />
              <!-- 수직 관통 오브젝트가 뚫은 확정 편집 개구부를 뺀 넓이가 내보내는 값이다(OE-ML-03). 외곽선 넓이와 뺀 넓이를 같이 보인다. -->
              <span v-if="selectedSpace.slabCutM2 > 0" class="muted" data-testid="space-slab-cut">(외곽선 {{ selectedSpace.space.areaM2.toFixed(1) }}㎡ − 슬래브 개구부 {{ selectedSpace.slabCutM2.toFixed(2) }}㎡)</span>
            </dd>
          </div>
          <!-- 방 높이·반자 높이(OE-BIM-03). 방이 BIM 에 적은 값만 보인다. 없으면 "모름" 이고 0 이나 층고로 채우지 않는다.
               반자 높이는 방 값이 없으면 층 값(층별 요약에서 고친다)을 괄호로 같이 보인다 — 설정 단위가 층이라서다(Q7). -->
          <div data-testid="space-heights">
            <dt title="방 높이 · 반자 높이(층 바닥에서)">높이</dt>
            <dd>
              방
              <template v-if="selectedSpace.space.roomHeight"><span class="mono">{{ selectedSpace.space.roomHeight.m.toFixed(2) }}</span>m <Src kind="bim" /></template>
              <span v-else class="muted">모름</span>
              · 반자
              <template v-if="selectedSpace.space.ceilingHeight"><span class="mono">{{ selectedSpace.space.ceilingHeight.m.toFixed(2) }}</span>m <Src kind="bim" /></template>
              <span v-else class="muted">모름<template v-if="ceilingOf(selectedSpace.storey)"> (층 값 {{ ceilingOf(selectedSpace.storey)!.height.toFixed(2) }}m <Src :kind="ceilingOf(selectedSpace.storey)!.source" />)</template></span>
            </dd>
          </div>
          <!-- 설계 급기 풍량(OE-ZON-06 · R26). BIM 값이 있으면 그 값이고 고치지 않는다. 없으면 편집 모드에서 사람이 넣는다.
               에디터가 계산하거나 기본값을 넣지 않는다 — 비어 있으면 그 방을 담당하는 공조존의 용량 검증(Z-03)이 판정 불가다. -->
          <div data-testid="space-airflow">
            <!-- 이름 칸이 두 글자 폭이라(3.2rem) "설계 풍량" 은 두 줄로 꺾인다. 짧게 두고 뜻은 툴팁으로. -->
            <dt title="설계 급기 풍량(OE-ZON-06)">풍량</dt>
            <dd v-flash="JSON.stringify(selectedSpace.space.designAirflow ?? null)" class="space-airflow">
              <template v-if="selectedSpace.space.designAirflow?.source === 'bim'">
                {{ airflowText(selectedSpace.space.designAirflow) }} <Src kind="bim" />
              </template>
              <template v-else-if="editing">
                <label>냉방 <input type="number" min="0" step="any" class="airflow-input" :value="selectedSpace.space.designAirflow?.cooling ?? ''" aria-label="냉방 설계 풍량(CMH)" @change="applySpaceAirflow(selectedSpace.space, 'cooling', $event)" /></label>
                <label>난방 <input type="number" min="0" step="any" class="airflow-input" :value="selectedSpace.space.designAirflow?.heating ?? ''" aria-label="난방 설계 풍량(CMH)" @change="applySpaceAirflow(selectedSpace.space, 'heating', $event)" /></label>
                CMH <Src v-if="selectedSpace.space.designAirflow" kind="edit" />
              </template>
              <template v-else-if="selectedSpace.space.designAirflow">{{ airflowText(selectedSpace.space.designAirflow) }} <Src kind="edit" /></template>
              <span v-else class="muted">없음</span>
            </dd>
          </div>
          <div>
            <dt>소속</dt>
            <dd v-flash="`${spaceDevices.length}/${spaceConduits.length}`">
              기기 {{ spaceDevices.length }}대<template v-if="spaceConduits.length"> · 덕트·배관 {{ spaceConduits.length }}개</template>
              <Src kind="calc" />
            </dd>
          </div>
          <div v-if="zonesOfSpace.get(selectedSpace.space.id)">
            <dt>공조존</dt>
            <dd data-testid="space-zones">
              <template v-for="(z, i) in zonesOfSpace.get(selectedSpace.space.id)" :key="z.id"
                >{{ i ? ' · ' : '' }}<button v-if="z.source !== 'edit'" type="button" class="link" @click="selectZone(z.id)">{{ z.name }}</button><template v-else>{{ z.name }}</template
                >{{ z.share !== undefined ? ` ${Math.round(z.share * 100)}%` : '' }} <Src :kind="z.source" /></template>
            </dd>
          </div>
        </dl>
      </div>
      <div class="picked-actions">
        <button
          type="button"
          :class="['ghost', { on: spaceView?.id === selectedSpace.space.id }]"
          :aria-pressed="spaceView?.id === selectedSpace.space.id"
          data-testid="space-view-toggle"
          title="이 방으로 가서 방 안 설비와 바람을 대는 공기 원천만 3D 에 남깁니다 — 화면에서만"
          @click="spaceView?.id === selectedSpace.space.id ? exitSpaceView() : enterSpaceView(selectedSpace.space.id)"
        >
          {{ spaceView?.id === selectedSpace.space.id ? '층 전체 보기' : '공간 보기' }}
        </button>
        <button type="button" class="ghost" @click="selectedSpaceId = null">선택 해제</button>
      </div>
    </div>
    <!-- 방별 체크리스트(lib/space-checklist.ts). 이 방이 온톨로지로 얼마나 찼는지 — 해당 없음은 점수에서 뺀다. [고치기] 는 이미 있는 편집으로 데려간다. -->
    <div v-if="selectedChecklist" class="space-checklist" data-testid="space-checklist">
      <p class="checklist-head">
        <b>온톨로지 체크리스트</b>
        <span :class="['checklist-score', { full: isFull(selectedChecklist) }]" data-testid="checklist-score">{{ selectedChecklist.have }} / {{ selectedChecklist.of }} 채움</span>
      </p>
      <ul class="plain">
        <li v-for="it in selectedChecklist.items" :key="it.key" :class="['check-row', it.state]" :data-check="it.key" :data-state="it.state">
          <span class="check-mark" aria-hidden="true">{{ it.state === 'ok' ? '✓' : it.state === 'empty' ? '✗' : '–' }}</span>
          <span class="check-name">{{ CHECK_LABELS[it.key] }}<span class="sr-only">{{ it.state === 'ok' ? ' 채움' : it.state === 'empty' ? ' 빔' : ' 해당 없음' }}</span></span>
          <Src v-if="it.source" :kind="it.source" />
          <small v-if="it.key === 'number' && it.state === 'ok'" class="muted" title="받는 쪽 파서(ttl.go)는 ex: 속성을 읽지 않습니다">받는 쪽이 버림</small>
          <small v-if="it.note" class="muted check-note">{{ it.note }}</small>
          <button v-if="it.state === 'empty' && checkFixLabel(it)" type="button" class="link check-fix" @click="fixCheck(it)">{{ checkFixLabel(it) }}</button>
        </li>
      </ul>
    </div>
    <!-- 방번호(OE-OBJ-02). IfcSpace 의 Name 이고 한 층 안에서 겹치지 않는다. 공간명(아래)은 겹쳐도 된다. -->
    <label v-if="editing" class="space-number">
      방번호
      <input
        type="text"
        v-keep-typing
        data-testid="space-number"
        :value="selectedSpace.space.name"
        :placeholder="selectedSpace.space.added ? '방번호를 넣으세요' : ''"
        @change="applySpaceNumber(selectedSpace.space.id, $event.target as HTMLInputElement)"
      />
    </label>
    <!-- 3D 에서 고른 방의 이름을 그 자리에서 고친다(E1). 아래 표에서 같은 방을 다시 찾지 않게. -->
    <label v-if="editing" class="space-name">
      공간명
      <input
        type="text"
        v-keep-typing
        :value="selectedSpace.space.longName"
        @change="applyRename(selectedSpace.space.id, ($event.target as HTMLInputElement).value)"
      />
    </label>
    <!-- 다섯 줄 설명이 이름 칸과 나누기·합치기 사이에 있어 도구를 아래로 밀었다. 손잡이·꼭짓점 조작은 3D 아래 안내줄과
         ? 안내에 이미 있어 여기서는 이 패널에서만 알 수 있는 것(이름 → 종류)만 둔다. -->
    <p v-if="editing" class="hint">
      이름을 고치면 종류도 새 이름으로 다시 읽습니다(사전이 모르면 BIM 방 분류). 경계는 3D·평면도의 꼭짓점 핸들로 고치고,
      넓이·설비 소속은 다시 계산됩니다.
    </p>
    <!-- 나누기·합치기(E3). 합칠 방은 벽 두께 안의 같은 층 방만 가까운 순으로 보인다. 지우기는 맨 아래. -->
    <p v-if="editing" class="space-tools">
      <button type="button" class="ghost" :disabled="selectedSpace.space.footprint.length < 4" title="바닥에 선의 두 점을 찍어 둘로 나눕니다" @click="startSplit">
        나누기
      </button>
      <label v-if="mergeCandidates.length">
        <select :value="''" aria-label="합칠 물리존" @change="mergeInto(($event.target as HTMLSelectElement).value)">
          <option value="" disabled>합칠 방 고르기…</option>
          <option v-for="c in mergeCandidates" :key="c.space.id" :value="c.space.id">
            {{ c.space.longName || c.space.name || c.space.id }}{{ c.gap > 0.005 ? ` (벽 ${c.gap.toFixed(2)}m 너머)` : '' }}
          </option>
        </select>
      </label>
      <span v-else class="muted">맞닿은 방이 없어 합칠 수 없습니다</span>
    </p>
    <p v-if="editing && activeVertex !== null" class="vertex-tools">
      <span>꼭짓점 {{ activeVertex + 1 }}/{{ vertexCount }}</span>
      <button type="button" class="ghost" title="다음 꼭짓점과의 가운데에 넣습니다 (Insert)" @click="editVertex('insert')">꼭짓점 넣기</button>
      <button type="button" class="ghost" :disabled="vertexCount <= 3" title="Delete" @click="editVertex('delete')">꼭짓점 지우기</button>
    </p>
    <!-- 기기를 먼저 둔다. 성수 기계실은 107대 중 88개가 덕트·이음쇠라 공조기가 그 사이에 묻혔다. -->
    <p v-if="spaceDevices.length > 12" class="space-kinds muted">{{ spaceKinds }}</p>
    <ul v-if="spaceDevices.length" class="plain space-members">
      <li v-for="e in spaceDevices" :key="e.id">
        <button type="button" class="link" :title="e.name || e.ifcClass" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
        <span class="muted">{{ whatIs(e)?.label }}</span>
      </li>
    </ul>
    <details v-if="spaceConduits.length" class="space-conduits">
      <summary>덕트·배관 {{ spaceConduits.length }}개</summary>
      <ul class="plain space-members">
        <li v-for="e in spaceConduits" :key="e.id">
          <button type="button" class="link" :title="e.name || e.ifcClass" @click="select(e.id)">{{ e.name || e.ifcClass }}</button>
          <span class="muted">{{ whatIs(e)?.label }}</span>
        </li>
      </ul>
    </details>
    <p v-if="!selectedSpace.equipment.length" class="empty">이 물리존에 속한 설비가 없습니다.</p>
    <!-- 이 방에 바람을 대는 공기 원천(served.ts 를 방 쪽에서 본 것). 3D 에서는 상류 색이다. 흐름 방향이 추정이면 TTL 에 없을 수 있다. -->
    <div v-if="selectedSpaceInfluence?.sources.length" class="space-sources" data-testid="space-sources">
      <h4>바람을 대는 공기 원천 <Src kind="calc" /></h4>
      <ul class="plain space-members">
        <li v-for="x in selectedSpaceInfluence.sources" :key="x.id">
          <button type="button" class="link" :title="equipmentById.get(x.id)?.name || x.id" @click="select(x.id)">{{ shortName(equipmentById.get(x.id)?.name || x.id) }}</button>
          <span class="muted">
            {{ equipmentById.get(x.id) ? whatIs(equipmentById.get(x.id)!)?.label : '' }}
            · 급기 {{ x.supply }}<template v-if="x.extract"> · 환기 {{ x.extract }}</template>
            <template v-if="equipmentById.get(x.id)?.spaceId !== selectedSpace.space.id"> · {{ [equipmentStorey.get(x.id)?.name, equipmentById.get(x.id)?.spaceId ? spaceNameOf(equipmentById.get(x.id)!.spaceId) : '방 밖'].filter(Boolean).join(' ') }}</template>
          </span>
        </li>
      </ul>
    </div>
    <p v-if="editing" class="danger-zone">
      <button type="button" class="ghost danger" :disabled="selectedSpace.storey.spaces.length <= 1" title="이 물리존을 지웁니다. 안의 설비는 좌표로 다시 소속을 찾습니다" @click="removeSpace">
        물리존 지우기
      </button>
      <span class="muted">안의 설비는 좌표로 다시 소속을 찾습니다. Ctrl+Z 로 되돌립니다.</span>
    </p>
  </section>
</template>
