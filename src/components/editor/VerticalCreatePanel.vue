<script setup lang="ts">
import type { PropType } from 'vue'
import type { VerticalKind } from '../../lib/model'
import { replayMemo } from '../../lib/replay-player'
import { SLAB_OPENING_LABEL } from '../../lib/slab-opening'
import { VERTICAL_DEFAULTS } from '../../lib/vertical-edit'
import { VERTICAL_KIND_LABEL } from '../../lib/vertical-object'
import { floorName } from '../../editor/autosave'
import { vKeepTyping } from '../../editor/edit-filter'
import { storeysByHeight } from '../../editor/multi-view'
import { drawing } from '../../editor/space-objects'
import { applyVerticalHeading, flightKind, placesByPoint, rotateTarget } from '../../editor/vertical'
import { applyCreateVertical, cancelCreateVertical, createAnchor, createAnchored, createCandidates, createDraft, createOpenings, createPlan, createSteps, draftBlock, draftFloors, draftOutside, draftRing, faceLabel, fillNext, fillRange, isFilling, openingImpact, placingVertical, RANGE_NEED, setCreateKind, startPlaceVertical } from '../../editor/vertical-create'
import Src from '../Src.vue'
import type { verticalCreate as verticalCreateRef } from '../../editor/vertical'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  verticalCreate: { type: null as unknown as PropType<NonNullable<typeof verticalCreateRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked vertical-create" data-testid="vertical-create">
    <div class="picked-head">
      <div>
        <h3>수직 관통 오브젝트 만들기</h3>
        <p class="hint">계단·에스컬레이터는 시작점만 찍으면 바로 위층까지의 기본 형상을, 엘리베이터는 위치를 찍으면 기본 크기 승강로를 만듭니다. 샤프트는 모든 층에 같이 쓰는 공통 축 형상을 그립니다.</p>
      </div>
    </div>
    <p class="vertical-move">
      <label>종류
        <select :value="verticalCreate.kind" aria-label="만들 종류" @change="setCreateKind(($event.target as HTMLSelectElement).value as VerticalKind)">
          <option v-for="k in (['stair', 'escalator', 'elevator', 'shaft'] as const)" :key="k" :value="k">{{ VERTICAL_KIND_LABEL[k] }}</option>
        </select>
      </label>
      <label>이름 <input v-model="verticalCreate.name" v-keep-typing type="text" aria-label="만들 이름" /></label>
    </p>
    <p class="vertical-move">
      <b>구간</b>
      <select v-model="verticalCreate.from" aria-label="만들 시작 층">
        <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
      </select>
      →
      <!-- 계단·ES 는 한 구간이 이웃한 두 층이라 끝 층은 높이 순서로 바로 위층이다(OE-ML-06). -->
      <span v-if="flightKind(verticalCreate.kind)" data-testid="vertical-create-to">{{ storeysByHeight.find((st) => st.id === verticalCreate!.to && st.id !== verticalCreate!.from)?.name ?? '위층 없음' }} <span class="muted">(바로 위층, 자동)</span></span>
      <select v-else v-model="verticalCreate.to" aria-label="만들 끝 층">
        <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
      </select>
    </p>
    <!-- 시작점·위치 하나로 만드는 종류(계단·ES·EL). 찍고 → 돌리고 → (ES) 운행 방향을 확인하면 만든다. -->
    <div v-if="placesByPoint(verticalCreate.kind)" data-testid="vertical-create-point">
      <ol class="vertical-steps">
        <li :class="{ done: !!verticalCreate.at, now: placingVertical }">
          <span class="step-mark" aria-hidden="true">{{ verticalCreate.at ? '✓' : '' }}</span>
          <span class="step-text">{{ storeysByHeight.find((st) => st.id === verticalCreate!.from)?.name }} · {{ flightKind(verticalCreate.kind) ? '시작점' : '승강로 위치' }}</span>
          <span v-if="placingVertical" class="step-now">찍는 중</span>
          <button v-else type="button" class="link" data-testid="vertical-create-place" @click="startPlaceVertical">{{ verticalCreate.at ? '다시 찍기' : '찍기' }}</button>
        </li>
        <li :class="{ done: !!verticalCreate.at }">
          <span class="step-mark" aria-hidden="true"></span>
          <span class="step-text">방향 — 3D 의 파란 손잡이를 끌거나 각도를 넣습니다</span>
        </li>
        <li v-if="verticalCreate.kind === 'escalator'" :class="{ done: verticalCreate.directionOk }">
          <span class="step-mark" aria-hidden="true">{{ verticalCreate.directionOk ? '✓' : '' }}</span>
          <span class="step-text">운행 방향</span>
        </li>
      </ol>
      <p v-if="verticalCreate.at && rotateTarget?.draft" class="vertical-move" data-testid="vertical-create-heading">
        <span>회전각</span>
        <label><input :key="rotateTarget.heading" :value="rotateTarget.heading.toFixed(1)" v-keep-typing type="number" step="0.1" aria-label="만들 회전각(°)" @change="applyVerticalHeading($event.target as HTMLInputElement)" /></label>
        ° <span class="muted">{{ flightKind(verticalCreate.kind) ? '시작점' : '승강로 가운데' }} 기준</span>
      </p>
      <p v-if="createDraft && !('refused' in createDraft) && createDraft.flight" class="muted" data-testid="vertical-create-length">
        층고 차 {{ createDraft.flight.rise.toFixed(2) }}m ÷ tan {{ VERTICAL_DEFAULTS[verticalCreate.kind as 'stair' | 'escalator'].slope }}° = 수평 길이 {{ createDraft.flight.length.toFixed(2) }}m · 폭 {{ VERTICAL_DEFAULTS[verticalCreate.kind as 'stair' | 'escalator'].width }}m
      </p>
      <p v-else-if="verticalCreate.kind === 'elevator'" class="muted">승강로 {{ VERTICAL_DEFAULTS.elevator.size }} × {{ VERTICAL_DEFAULTS.elevator.size }}m · 관통 구간 전 층 정차로 시작합니다</p>
      <!-- EL 정차 층·진입 지점(OE-ML-10 AC1). 처음은 전 층 정차·첫 면이고, 층마다 고친 뒤 확인해야 만든다. 진입 지점은 3D 에 초록 점. -->
      <fieldset v-if="verticalCreate.kind === 'elevator' && verticalCreate.at && draftRing.length" class="vertical-move elevator-draft" data-testid="vertical-create-stops">
        <legend>정차 층·진입 지점</legend>
        <span v-for="st in draftFloors" :key="st.id" class="elevator-stop">
          <label><input type="checkbox" :checked="verticalCreate.stops[st.id] !== false" :aria-label="`${st.name} 정차`" @change="verticalCreate.stops[st.id] = ($event.target as HTMLInputElement).checked; verticalCreate.stopsOk = false" /> {{ st.name }}</label>
          <select :value="verticalCreate.faces[st.id] ?? 0" :aria-label="`${st.name} 진입 면`" @change="verticalCreate.faces[st.id] = Number(($event.target as HTMLSelectElement).value); verticalCreate.stopsOk = false">
            <option v-for="(_, i) in draftRing" :key="i" :value="i">{{ faceLabel(draftRing, i) }}</option>
          </select>
        </span>
        <label><input v-model="verticalCreate.stopsOk" type="checkbox" /> 정차 층·진입 지점을 확인했습니다</label>
      </fieldset>
      <!-- ES 운행 방향(OE-ML-11 AC2). 상행이 처음 선택이고, 확인해야 만든다. -->
      <fieldset v-if="verticalCreate.kind === 'escalator'" class="vertical-move" data-testid="vertical-create-direction">
        <legend>운행 방향</legend>
        <label><input v-model="verticalCreate.direction" type="radio" value="up" @change="verticalCreate.directionOk = false" /> 상행(처음 선택)</label>
        <label><input v-model="verticalCreate.direction" type="radio" value="down" @change="verticalCreate.directionOk = false" /> 하행</label>
        <label><input v-model="verticalCreate.directionOk" type="checkbox" /> 이 방향이 맞습니다</label>
      </fieldset>
      <!-- 이어 놓기(OE-ML-06 AC4). 찍는 동안 고정했으면 안내를, 찍은 뒤에는 무엇에 이어 붙었는지 보인다. -->
      <p v-if="placingVertical && createAnchor" class="vertical-move" data-testid="vertical-create-anchor">
        {{ createAnchor.name }}의 {{ createAnchor.kind === 'start' ? '끝점에 시작점' : '시작점에 끝점' }} 고정 · 커서로 방향{{ createAnchored ? ` ${createAnchored.heading.toFixed(1)}°` : '' }}{{ createAnchored?.by ? `(${createAnchored.by})` : '' }} · 클릭 확정 · 멀리 빼거나 Alt 로 해제
      </p>
      <p v-else-if="placingVertical && createCandidates.length" class="muted">주황 점이 이어 놓을 수 있는 지점입니다. 커서를 1m 안으로 가져가면 붙습니다</p>
      <p v-if="verticalCreate.link && !placingVertical" class="vertical-move" data-testid="vertical-create-link">
        이어 붙음: {{ verticalCreate.link.name }}의 {{ verticalCreate.link.kind === 'start' ? '끝점에 이 구간 시작점' : '시작점에 이 구간 끝점' }}
      </p>
      <p v-if="draftBlock && (verticalCreate.at || draftBlock.includes('최상층'))" :class="draftOutside || draftBlock.includes('최상층') ? 'edit-warn' : 'muted'" data-testid="vertical-create-block">{{ draftBlock }}</p>
      <p v-if="createPlan && !('refused' in createPlan) && createPlan.link && verticalCreate.at" class="vertical-move">연결 물리존: {{ createPlan.link.from ?? '없음' }} ↔ {{ createPlan.link.to ?? '없음' }}</p>
    </div>
    <template v-else-if="createPlan">
      <p v-if="'refused' in createPlan" class="edit-warn" data-testid="vertical-create-refused">{{ createPlan.refused }}</p>
      <div v-else data-testid="vertical-create-plan">
        <p class="vertical-move">지나는 층: {{ createPlan.storeys.map((s) => s.name).join(' → ') }}</p>
        <!-- 채울 것 전부를 순서대로. 하나를 채우면 다음 것을 바로 이어 그린다(finishDraw) — 단추는 다시 그리거나 순서를 건너뛸 때 쓴다. -->
        <ol class="vertical-steps" data-testid="vertical-create-steps">
          <li v-for="s in createSteps" :key="`${s.storey.id}:${s.what}`" :class="{ done: s.done, now: isFilling(s.storey.id, s.what) }">
            <span class="step-mark" aria-hidden="true">{{ s.done ? '✓' : '' }}</span>
            <span class="step-text">{{ s.storey.name }} · {{ RANGE_NEED[s.what] }}</span>
            <span v-if="isFilling(s.storey.id, s.what)" class="step-now">{{ s.what === 'footprint' ? '그리는 중' : '찍는 중' }}</span>
            <button v-else type="button" class="link" :disabled="!!drawing" @click="fillRange(s.storey.id, s.what)">
              {{ s.done ? '다시 ' : '' }}{{ RANGE_NEED[s.what] }} {{ s.what === 'footprint' ? '그리기' : '찍기' }}
            </button>
          </li>
        </ol>
        <p v-if="!createPlan.needs.length" class="muted">다 채웠습니다</p>
        <p v-if="createPlan.link" class="vertical-move">연결 물리존: {{ createPlan.link.from ?? '없음' }} ↔ {{ createPlan.link.to ?? '없음' }}</p>
        <p class="muted">엘리베이터는 전 층 정차로 시작하고, 에스컬레이터 운행 방향은 만든 뒤 패널에서 정합니다(정하기 전에는 미확인)</p>
      </div>
    </template>
    <!-- 슬래브 개구부 미리보기(OE-ML-06 AC5). 만든 뒤 패널과 같은 판정이고, 찍거나 돌리면 다시 잰다. 3D 에는 확정 보라 · 초안 노랑 점선. -->
    <table v-if="createOpenings.length" class="slab-openings" data-testid="vertical-create-openings">
      <caption>슬래브 개구부 미리보기 <Src kind="calc" /></caption>
      <tbody>
        <tr v-for="o in createOpenings" :key="o.storeyId" :class="`slab-${o.state}`" :title="o.reason">
          <th scope="row">{{ floorName(o.storeyId) }} 바닥</th>
          <td><span :class="['slab-state', o.state]">{{ SLAB_OPENING_LABEL[o.state] }}</span></td>
          <td class="muted" data-testid="vertical-create-opening-impact">{{ openingImpact(o) }}</td>
        </tr>
      </tbody>
    </table>
    <p>
      <button v-if="!placesByPoint(verticalCreate.kind) && createPlan && !('refused' in createPlan) && createPlan.needs.length && !drawing" type="button" class="ghost go" data-testid="vertical-create-start" @click="fillNext">
        {{ createSteps.some((s) => s.done) ? '이어서 채우기' : '그리기 시작' }}
      </button>
      <button v-if="placesByPoint(verticalCreate.kind) && !verticalCreate.at && !placingVertical" type="button" class="ghost go" data-testid="vertical-create-start" @click="startPlaceVertical">{{ flightKind(verticalCreate.kind) ? '시작점 찍기' : '위치 찍기' }}</button>
      <button type="button" :class="['ghost', { go: !!createPlan && !('refused' in createPlan) && !createPlan.needs.length && !draftBlock }]" :disabled="!createPlan || 'refused' in createPlan || !!createPlan.needs.length || !verticalCreate.name.trim() || !!draftBlock" :title="draftBlock ?? undefined" @click="applyCreateVertical">만들기</button>
      <button type="button" class="ghost" @click="cancelCreateVertical">취소</button>
    </p>
  </section>
</template>
