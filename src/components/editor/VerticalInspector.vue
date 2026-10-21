<script setup lang="ts">
import type { PropType } from 'vue'
import { verticalPartPassable } from '../../lib/export/geojson'
import { josa } from '../../lib/josa'
import type { ElevatorStop } from '../../lib/model'
import { replayMemo } from '../../lib/replay-player'
import { SLAB_OPENING_LABEL } from '../../lib/slab-opening'
import { COMMON_AXIS, DIRECTION_LABEL, escalatorTravel, landingFace, STOP_LABEL } from '../../lib/vertical-edit'
import { partId } from '../../lib/vertical-object'
import { floorName } from '../../editor/autosave'
import { editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { closeMultiView, openMultiViewFor, storeysByHeight } from '../../editor/multi-view'
import { pickSpace } from '../../editor/rooms'
import { drawing } from '../../editor/space-objects'
import { applyPartPoint, applyPartShift, applyVerticalHeading, applyVerticalShift, flightKind, multiView, partShift, relinkSelected, rotateTarget, selectedLinks, selectedVerticalId, selectVertical, setDirectionFrom, setStopFrom, shaftCarry, unlinkSelected, VERTICAL_PART_LOCKED, VERTICAL_ROLE, verticalDeleteAsk, verticalDeleteEffect, verticalDeleteImpact, verticalShift, verticalWarnings } from '../../editor/vertical'
import { applyRange, cancelRange, faceLabel, fillRange, fillRangeStart, isFilling, placingRangeAt, RANGE_NEED, rangeEffect, rangePlan, removeSelectedVertical, setLandingFrom, setRangeEnd, verticalRange } from '../../editor/vertical-create'
import Src from '../Src.vue'
import VerticalEffectList from './VerticalEffectList.vue'
import type { model as modelRef } from '../../editor/core'
import type { selectedVertical as selectedVerticalRef } from '../../editor/vertical'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
  selectedVertical: { type: null as unknown as PropType<NonNullable<typeof selectedVerticalRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked vertical-picked" data-testid="vertical-picked">
    <div class="picked-head">
      <div>
        <h3>{{ selectedVertical.part.name || selectedVertical.label }}</h3>
        <dl class="stats facts">
          <div>
            <dt>종류</dt>
            <dd>{{ selectedVertical.label }}(수직 관통 오브젝트) · {{ selectedVertical.storey.name }} <Src :kind="selectedVertical.part.source" /></dd>
          </div>
          <div>
            <dt>이 층</dt>
            <dd data-testid="vertical-role">{{ VERTICAL_ROLE[selectedVertical.role] }}</dd>
          </div>
          <div>
            <dt>관통</dt>
            <dd class="vertical-storeys" data-testid="vertical-storeys">
              <template v-for="(p, i) in selectedVertical.object.parts" :key="p.storey.id">
                <span v-if="i" aria-hidden="true"> → </span>
                <b v-if="i === selectedVertical.index">{{ p.storey.name }}</b>
                <button v-else type="button" class="link" @click="selectVertical(partId(selectedVertical.object.id, p.storey.id))">{{ p.storey.name }}</button>
              </template>
              <Src kind="calc" />
            </dd>
          </div>
          <div v-if="selectedVertical.part.entry">
            <dt>진입</dt>
            <dd class="mono" data-testid="vertical-entry">{{ selectedVertical.part.entry.map((v) => v.toFixed(2)).join(', ') }} <Src kind="calc" /></dd>
          </div>
          <div v-if="selectedVertical.part.exit">
            <dt>종료</dt>
            <dd class="mono" data-testid="vertical-exit">{{ selectedVertical.part.exit.map((v) => v.toFixed(2)).join(', ') }} <Src kind="calc" /></dd>
          </div>
          <div v-if="selectedVertical.part.entry || selectedVertical.part.exit || selectedVertical.part.landing">
            <dt>물리존</dt>
            <dd data-testid="vertical-spaces">
              <template v-if="selectedVertical.spaces.length">
                <button v-for="sp in selectedVertical.spaces" :key="sp.id" type="button" class="link" @click="pickSpace(sp.id)">{{ sp.name }}</button>
                <Src kind="calc" />
              </template>
              <span v-else class="muted">지점이 든 물리존이 없습니다</span>
            </dd>
          </div>
          <!-- 엘리베이터 정차 층(OE-ML-10). 층마다 정차·무정차·미확인. 다중층 뷰의 편집에서 고치고, 아니면 보기만 한다. -->
          <div v-if="selectedVertical.part.kind === 'elevator'">
            <dt>정차</dt>
            <dd class="elevator-stops" data-testid="elevator-stops">
              <span v-for="p in selectedVertical.object.parts" :key="p.storey.id" class="elevator-stop">
                {{ p.storey.name }}
                <select
                  v-if="multiView && editing"
                  :value="p.part.stop ?? 'unknown'"
                  :aria-label="`${p.storey.name} 정차`"
                  @change="setStopFrom(selectedVertical.object.id, p.storey.id, ($event.target as HTMLSelectElement).value as ElevatorStop)"
                >
                  <option v-for="(label, k) in STOP_LABEL" :key="k" :value="k">{{ label }}</option>
                </select>
                <b v-else>{{ STOP_LABEL[p.part.stop ?? 'unknown'] }}</b>
                <!-- 진입 면(OE-ML-10). 승강로 면 바깥의 점이 그 층 홀을 짚는다. -->
                <select
                  v-if="multiView && editing && p.part.footprint.length >= 3"
                  :value="landingFace(p.part.footprint, p.part.landing) ?? 0"
                  :aria-label="`${p.storey.name} 진입 면`"
                  @change="setLandingFrom(selectedVertical.object.id, p.storey.id, Number(($event.target as HTMLSelectElement).value))"
                >
                  <option v-for="(_, i) in p.part.footprint" :key="i" :value="i">{{ faceLabel(p.part.footprint, i) }}</option>
                </select>
                <span v-else-if="p.part.landing" class="muted">{{ faceLabel(p.part.footprint, landingFace(p.part.footprint, p.part.landing) ?? 0) }}</span>
              </span>
              <Src kind="edit" />
            </dd>
          </div>
          <!-- 에스컬레이터 운행 방향(OE-ML-11). 미확인이면 지어내지 않는다. 운행 시작·종료 지점은 방향과 진입·종료 지점으로 정한다. -->
          <div v-if="selectedVertical.part.kind === 'escalator'">
            <dt>운행</dt>
            <dd data-testid="escalator-direction">
              <select
                v-if="multiView && editing"
                :value="selectedVertical.part.direction ?? 'unknown'"
                aria-label="운행 방향"
                @change="setDirectionFrom(selectedVertical.object.id, ($event.target as HTMLSelectElement).value as 'up' | 'down' | 'unknown')"
              >
                <option v-for="(label, k) in DIRECTION_LABEL" :key="k" :value="k">{{ label }}</option>
              </select>
              <b v-else>{{ DIRECTION_LABEL[selectedVertical.part.direction ?? 'unknown'] }}</b>
              <Src v-if="selectedVertical.part.direction" kind="edit" />
              <span v-if="model && escalatorTravel(model, selectedVertical.object.id)" class="muted mono">
                {{ escalatorTravel(model, selectedVertical.object.id)!.from.map((v) => v.toFixed(2)).join(', ') }} → {{ escalatorTravel(model, selectedVertical.object.id)!.to.map((v) => v.toFixed(2)).join(', ') }}
              </span>
            </dd>
          </div>
          <div>
            <dt>로봇</dt>
            <dd data-testid="vertical-passable">
              <template v-if="selectedVertical.part.kind === 'elevator'">
                {{ selectedVertical.storey.name }}: {{ verticalPartPassable(selectedVertical.part).passable ? '통과 가능 — 정차를 확인한 층입니다' : (selectedVertical.part.stop ?? 'unknown') === 'skip' ? '통과 불가 — 서지 않는 층입니다' : '통과 불가 — 정차를 확인하지 않은 층입니다' }}
              </template>
              <template v-else>통과 불가 — 층을 이어도 로봇은 지나가지 못합니다</template>
            </dd>
          </div>
        </dl>
        <!-- 슬래브 개구부(OE-ML-03, slab-opening.ts). 지나는 층 바닥마다 판정과 까닭. 저장하지 않고 지금 형상에서 계산한다. -->
        <table v-if="selectedVertical.openings.length" class="slab-openings" data-testid="slab-openings">
          <caption>슬래브 개구부 <Src kind="calc" /></caption>
          <tbody>
            <tr v-for="o in selectedVertical.openings" :key="o.storeyId" :class="`slab-${o.state}`">
              <th scope="row">{{ floorName(o.storeyId) }} 바닥</th>
              <td><span :class="['slab-state', o.state]">{{ SLAB_OPENING_LABEL[o.state] }}</span></td>
              <td class="muted">{{ o.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="picked-actions">
        <button type="button" class="ghost" @click="selectedVerticalId = null">선택 해제</button>
      </div>
    </div>
    <p v-if="multiView" class="ceiling-lock" role="status">
      다중층 뷰입니다. 이 {{ selectedVertical.label }}의 관통 층 {{ selectedVertical.object.parts.length }}개 조각을 함께 칠했습니다.
      <button type="button" class="link" @click="closeMultiView">층 편집으로</button>
    </p>
    <!-- 이어진 구간(OE-ML-19 AC8 · OE-ML-07 AC6). 어긋나면 지우지 않고 재검토로 보인다. 고치는 단추는 다중층 뷰의 편집에서만. -->
    <div v-if="selectedLinks.length" class="vertical-links" data-testid="vertical-links">
      <h4 class="picked-sub">이어진 구간 <Src kind="edit" /></h4>
      <ul>
        <li v-for="x in selectedLinks" :key="`${x.link.lower}>${x.link.upper}`" :class="x.status.ok ? 'ok' : 'review'">
          {{ x.role === 'upper' ? '아래' : '위' }} 구간 <b>{{ x.otherName }}</b> · {{ x.storey }}:
          <span v-if="x.status.ok">이어짐</span>
          <span v-else class="edit-warn inline">재검토 — {{ x.status.why }}</span>
          <template v-if="multiView && editing">
            <button v-if="!x.status.ok" type="button" class="link" @click="relinkSelected(x)">다시 붙이기</button>
            <button type="button" class="link" @click="unlinkSelected(x)">연결 풀기</button>
          </template>
        </li>
      </ul>
    </div>
    <!-- 다중층 뷰의 편집(OE-ML-07·09). 모든 층 조각이 같이 움직이고, 지우기는 영향을 보이고 확인을 받는다. -->
    <template v-if="multiView && editing">
      <!-- 샤프트를 옮기면 같이 가는 배관(OE-ML-17). 옮기기 전에 보인다. 막히는 까닭이 있으면 옮기지 않는다. -->
      <p v-if="shaftCarry && (shaftCarry.rigid.length || shaftCarry.reasons.length)" class="vertical-move" data-testid="shaft-carry">
        옮기면 같이 갑니다: 안쪽 구간 {{ shaftCarry.segments.length }} · 분기점 {{ shaftCarry.fittings.length }} · 끝을 늘일 바깥 배관 {{ shaftCarry.outside.length }}
        <template v-if="shaftCarry.storeys.length"> · 영향 층 {{ shaftCarry.storeys.join(' · ') }}</template>
        <span v-if="shaftCarry.reasons.length" class="lock-note" role="alert"><br />옮길 수 없습니다 — {{ shaftCarry.reasons.join(' · ') }}</span>
      </p>
      <ul v-if="verticalWarnings.length" class="vertical-warnings" data-testid="vertical-v03" role="alert">
        <li v-for="w in verticalWarnings" :key="w.storeyId">
          <b>V-03</b> {{ w.storey }}:
          {{ w.reasons.includes('wall') ? `벽과 ${w.wall.toFixed(2)}㎡ 겹칩니다(연 때보다 늘었습니다)` : '' }}{{ w.reasons.length > 1 ? ' · ' : '' }}{{ w.reasons.includes('boundary') ? `한 물리존이 형상의 ${Math.round(w.share * 100)}%만 담습니다(물리존 경계를 넘었습니다)` : '' }}
        </li>
      </ul>
      <form class="vertical-move" data-testid="vertical-move" @submit.prevent="applyVerticalShift">
        <span>전체 이동</span>
        <label>Δx <input v-model="verticalShift[0]" v-keep-typing type="number" step="0.1" aria-label="전체 이동 x(m)" /></label>
        <label>Δy <input v-model="verticalShift[1]" v-keep-typing type="number" step="0.1" aria-label="전체 이동 y(m)" /></label>
        m
        <button type="submit" class="ghost">옮기기</button>
      </form>
      <p class="hint">방향키로도 옮깁니다(10cm, Shift 1m). 모든 층 조각과 진입·종료 지점이 같이 움직이고 높이는 그대로입니다. 벽·물리존 경계와 겹치면 V-03 을 알리지만 막지는 않습니다.</p>
      <!-- 전체 회전(OE-OBJ-15 AC6 · OE-ML-07 AC2). 3D 의 파란 손잡이를 끌거나 여기에 각도를 넣는다. 숫자는 붙이지 않고 그대로다. -->
      <form v-if="rotateTarget" class="vertical-move" data-testid="vertical-rotate" @submit.prevent>
        <span>회전각</span>
        <label><input :key="rotateTarget.heading" :value="rotateTarget.heading.toFixed(1)" v-keep-typing type="number" step="0.1" aria-label="회전각(°)" @change="applyVerticalHeading($event.target as HTMLInputElement)" /></label>
        °
        <span class="muted">{{ COMMON_AXIS.has(selectedVertical.part.kind) ? '승강로 가운데' : '시작점' }} 기준</span>
      </form>
      <p v-if="rotateTarget" class="hint">3D 의 파란 손잡이를 드래그해 돌립니다. 건물 축·가까운 벽 방향 ±3° 안에서는 그 각도에 붙고, Alt 를 누르면 붙지 않습니다. 끄는 중 Esc 면 돌리지 않습니다.</p>
      <!-- 이 층 조각만(OE-ML-07 "층별 형상·크기·진입/종료 위치"). 다른 층 조각은 그대로다. 형상은 3D 의 꼭짓점 손잡이로 고친다. -->
      <p v-if="COMMON_AXIS.has(selectedVertical.part.kind)" class="hint">모든 층이 같은 공통 축이라 한 층만 고치지 않습니다. 전체 이동으로 옮깁니다.</p>
      <div v-else class="vertical-part-edit" data-testid="vertical-part-edit">
        <b>{{ selectedVertical.storey.name }} 조각만</b>
        <form class="vertical-move" @submit.prevent="applyPartShift">
          <span>옮기기</span>
          <label>Δx <input v-model="partShift[0]" v-keep-typing type="number" step="0.1" aria-label="이 층 조각 이동 x(m)" /></label>
          <label>Δy <input v-model="partShift[1]" v-keep-typing type="number" step="0.1" aria-label="이 층 조각 이동 y(m)" /></label>
          m
          <button type="submit" class="ghost">옮기기</button>
        </form>
        <template v-for="which in (['entry', 'exit'] as const)" :key="which">
          <p v-if="selectedVertical.part[which]" class="vertical-move">
            <span>{{ which === 'entry' ? '진입 지점' : '종료 지점' }}</span>
            <label v-for="(axis, i) in ['x', 'y']" :key="axis">
              {{ axis }}
              <input
                type="number"
                step="0.1"
                :aria-label="`${which === 'entry' ? '진입' : '종료'} 지점 ${axis}(m)`"
                :value="selectedVertical.part[which]![i].toFixed(2)"
                @change="applyPartPoint(which, i as 0 | 1, $event.target as HTMLInputElement)"
                @keydown.enter="applyPartPoint(which, i as 0 | 1, $event.target as HTMLInputElement)"
              />
            </label>
            m
          </p>
        </template>
        <p class="hint">{{ selectedVertical.part.footprint.length >= 3 ? '형상은 3D 의 꼭짓점 손잡이를 드래그해 고칩니다. 변이 교차하면 되돌립니다.' : '이 층은 형상 없이 지점만 있습니다.' }}</p>
      </div>
      <!-- 구간 바꾸기(OE-ML-08). 보기 범위와 따로인 데이터다. 빈 층은 사람이 그리거나 찍어 채워야 적용된다(베껴 채우지 않는다). -->
      <div v-if="verticalRange" class="vertical-range" data-testid="vertical-range">
        <p class="vertical-move">
          <b>구간</b>
          <select :value="verticalRange.from" aria-label="구간 시작 층" @change="setRangeEnd('from', ($event.target as HTMLSelectElement).value)">
            <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
          </select>
          →
          <select :value="verticalRange.to" aria-label="구간 끝 층" @change="setRangeEnd('to', ($event.target as HTMLSelectElement).value)">
            <option v-for="st in storeysByHeight" :key="st.id" :value="st.id">{{ st.name }}</option>
          </select>
        </p>
        <template v-if="rangePlan">
          <p v-if="'refused' in rangePlan" class="edit-warn" data-testid="vertical-range-refused">{{ rangePlan.refused }}</p>
          <template v-else>
            <ul class="vertical-range-plan" data-testid="vertical-range-plan">
              <li v-if="rangePlan.added.length">더해지는 층: {{ rangePlan.added.map((s) => s.name).join(' · ') }}</li>
              <li v-if="rangePlan.removed.length">빠지는 층: {{ rangePlan.removed.map((s) => s.name).join(' · ') }} — 해당 층 형상을 삭제합니다</li>
              <li v-for="n in rangePlan.needs" :key="n.storey.id">
                {{ n.storey.name }}:
                <!-- 계단·ES 는 그 층 시작점 하나로 형상·위층 종료 지점을 계산한다(OE-ML-08). 손으로 그리는 길도 남긴다. -->
                <template v-if="flightKind(selectedVertical.object.kind) && n.what.includes('footprint')">
                  <span v-if="placingRangeAt === n.storey.id" class="step-now">시작점 찍는 중</span>
                  <button v-else type="button" class="link go" data-testid="range-start" :disabled="!!drawing || !!placingRangeAt" @click="fillRangeStart(n.storey.id)">시작점 찍기</button>
                  ·
                </template>
                <template v-for="(w, i) in n.what" :key="w">
                  {{ i ? ' · ' : '' }}<span v-if="isFilling(n.storey.id, w)" class="step-now">{{ RANGE_NEED[w] }} {{ w === 'footprint' ? '그리는 중' : '찍는 중' }}</span>
                  <button v-else type="button" class="link" :disabled="!!drawing || !!placingRangeAt" @click="fillRange(n.storey.id, w)">{{ RANGE_NEED[w] }} {{ w === 'footprint' ? '그리기' : '찍기' }}</button>
                </template>
                <span class="muted">(채워야 적용됩니다)</span>
              </li>
              <li v-if="rangePlan.link">적용 시 연결 물리존: {{ rangePlan.link.from ?? '없음' }} ↔ {{ rangePlan.link.to ?? '없음' }}</li>
              <VerticalEffectList v-if="rangeEffect" :effect="rangeEffect" mode="range" />
              <li v-if="selectedVertical.object.kind === 'escalator' && rangePlan.storeys.length" data-testid="effect-run">
                운행 구간: {{ rangePlan.storeys[0].name }} → {{ rangePlan.storeys[rangePlan.storeys.length - 1].name }}
              </li>
              <li v-if="selectedVertical.object.kind === 'shaft'" class="muted">샤프트 배관 소속은 아직 구간에 따라 바꾸지 않습니다</li>
            </ul>
          </template>
          <p>
            <button type="button" class="ghost" :disabled="'refused' in rangePlan || !!rangePlan.needs.length" @click="applyRange">구간 적용</button>
            <button type="button" class="ghost" @click="cancelRange">취소</button>
          </p>
        </template>
      </div>
      <div v-if="verticalDeleteImpact" class="vertical-delete-ask" data-testid="vertical-delete-ask" role="alertdialog" aria-label="수직 관통 오브젝트 지우기 확인">
        <p>
          <b>{{ selectedVertical.part.name || selectedVertical.label }}</b>{{ josa(selectedVertical.part.name || selectedVertical.label, '을/를') }} 지우면 —
        </p>
        <ul>
          <li>영향 층: {{ verticalDeleteImpact.storeys.join(' · ') }} ({{ verticalDeleteImpact.parts }}개 조각이 빠집니다)</li>
          <li v-if="verticalDeleteImpact.pipes" data-testid="vertical-delete-pipes">안의 덕트·배관 {{ verticalDeleteImpact.pipes }}개와 그 연결은 남고 샤프트 소속만 풀립니다(되돌리면 돌아옵니다)</li>
          <li v-if="verticalDeleteImpact.link">이 {{ selectedVertical.label }}{{ josa(selectedVertical.label, '이/가') }} 이은 {{ verticalDeleteImpact.link.from }} ↔ {{ verticalDeleteImpact.link.to }} 연결이 빠지고, 겹침 추정이 다시 잽니다</li>
          <VerticalEffectList v-if="verticalDeleteEffect" :effect="verticalDeleteEffect" mode="delete" />
          <li>계단실 같은 물리존과 BIM 원본은 그대로입니다. 편집 파일에 지움으로 남아 다시 열어도 되살아나지 않습니다</li>
        </ul>
        <button type="button" class="ghost danger" @click="removeSelectedVertical">지우기</button>
        <button type="button" class="ghost" @click="verticalDeleteAsk = false">취소</button>
      </div>
      <p v-else class="danger-zone">
        <button type="button" class="ghost danger" @click="verticalDeleteAsk = true">{{ selectedVertical.label }} 지우기</button>
        <span class="muted">Delete · 영향을 보이고 한 번 더 묻습니다.</span>
      </p>
    </template>
    <p v-else class="ceiling-lock" role="status">
      <template v-if="editing">{{ selectedVertical.label }}{{ josa(selectedVertical.label, '은/는') }} {{ VERTICAL_PART_LOCKED }}</template>
      <template v-else>관통 층을 함께 보려면</template>
      <!-- 진입 경로 ②: 이 오브젝트의 관통 층으로 연다(OE-ML-01). -->
      <button type="button" class="link" @click="openMultiViewFor(selectedVertical.object.parts)">다중층 뷰에서 편집</button>
    </p>
    <p class="hint">같은 자리를 한 번 더 누르면 그 아래 물리존이 골라집니다.</p>
  </section>
</template>
