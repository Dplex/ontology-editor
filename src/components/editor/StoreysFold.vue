<script setup lang="ts">
import type { PropType } from 'vue'
import { ceilingOf } from '../../lib/ceiling'
import { equipmentKind } from '../../lib/kinds'
import { allowedLabel } from '../../lib/mount'
import { replayMemo } from '../../lib/replay-player'
import { storeyNamed } from '../../lib/storey-name'
import { busy, editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { ceilingEditing, ceilingGuessApart, ceilingGuessOf, ceilingInput, ceilingTitle, JUDGED_LABEL, meters, saveCeiling, startCeiling, storeyHeightOf, storeyHeightTitle, surfaceCounts, surfaceMismatch, surfaceRows, wallThicknessLabel, wallThicknessOf } from '../../editor/edit-report'
import { justDone } from '../../editor/open-many'
import { saveStoreyName, startStoreyName, storeyNameEditing, storeyNameInput } from '../../editor/storey-name'
import { buildStorey, doneTime, progressById, setStoreyDone, storeyProgressRows, storeysDoneCount } from '../../editor/storey-progress'
import { select } from '../../editor/systems'
import Fold from '../Fold.vue'
import Src from '../Src.vue'
import type { model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()" title="층별 요약" :meta="`${model.storeys.length}개 층 · 완료 ${storeysDoneCount}/${model.storeys.length}`" class="storeys">
    <!-- 층 단위 진행(OE-MAN-06). 완료한 층·고친 층·남은 층. -->
    <p class="storey-progress hint" role="status">
      완료 <b>{{ storeysDoneCount }}/{{ model.storeys.length }}</b>층
      <template v-if="storeyProgressRows.some((p) => p.state === 'changed')">
        · <span class="height-mismatch">완료 뒤 고침 {{ storeyProgressRows.filter((p) => p.state === 'changed').map((p) => p.name).join(', ') }}</span>
      </template>
      <template v-if="storeyProgressRows.some((p) => p.state === 'todo')">
        · 남은 층 {{ storeyProgressRows.filter((p) => p.state === 'todo').map((p) => p.name).join(', ') }}
      </template>
    </p>
    <table>
      <thead>
        <tr>
          <th>층</th>
          <th class="num">높이</th>
          <th class="num">층고</th>
          <th class="num" title="천장고(h_c, 천장 마감면 높이), 층 바닥 기준">천장고</th>
          <th>물리존</th>
          <th class="num">넓이 합</th>
          <th class="num">벽</th>
          <th class="num">설비</th>
          <th>진행</th>
          <th aria-label="층 단위 구축"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in model.storeys" :key="s.id">
          <!-- 층 이름. 편집 모드에서 고친다 — 이름 없는 층은 등급 0 을 떨어뜨려 [구축하기] 를 막는다. -->
          <td class="storey-name-cell">
            <template v-if="storeyNameEditing === s.id">
              <input
                v-model="storeyNameInput"
                v-keep-typing
                class="storey-name-input"
                :aria-label="`${s.name || '이름 없는 층'} 층 이름`"
                @keydown.enter.prevent="saveStoreyName(s.id)"
                @keydown.esc.stop="storeyNameEditing = null"
              />
              <button type="button" class="link" @click="saveStoreyName(s.id)">확인</button>
              <button type="button" class="link" @click="storeyNameEditing = null">취소</button>
            </template>
            <template v-else>
              <span v-if="s.name.trim()">{{ s.name }}</span>
              <span v-else class="height-mismatch" title="BIM 이 층 이름을 적지 않았습니다. 이름 없는 층이 있으면 등급 0 미달이라 구축하지 않습니다">이름 없음</span>
              <Src v-if="storeyNamed(s)" kind="edit" />
              <template v-if="editing">
                <button type="button" class="link" :aria-label="`${s.name || '이름 없는 층'} 층 이름 ${s.name.trim() ? '고치기' : '넣기'}`" @click="startStoreyName(s.id)">
                  {{ s.name.trim() ? '고치기' : '이름 넣기' }}
                </button>
                <button v-if="storeyNamed(s)" type="button" class="link" @click="saveStoreyName(s.id, true)">BIM 이름으로</button>
              </template>
            </template>
          </td>
          <td class="num mono">{{ (Math.abs(s.elevation) < 0.005 ? 0 : s.elevation).toFixed(2) }} m</td>
          <!-- 층고(OE-BIM-02). 출처 BIM 이면 그 값, 계산이면 윗층 바닥과의 차. 둘이 다르면 계산한 값도 옆에 보인다. -->
          <td class="num mono storey-height">
            <template v-if="storeyHeightOf.get(s.id)">
              <span :title="storeyHeightTitle(storeyHeightOf.get(s.id)!)">{{ meters(storeyHeightOf.get(s.id)!.value) }}</span>
              <Src :kind="storeyHeightOf.get(s.id)!.source" />
              <span v-if="storeyHeightOf.get(s.id)!.mismatch" class="height-mismatch" :title="storeyHeightTitle(storeyHeightOf.get(s.id)!)">
                계산 {{ meters(storeyHeightOf.get(s.id)!.calc!) }}
              </span>
            </template>
            <span v-else class="muted" title="맨 위층이고 BIM 이 층 높이를 적지 않았습니다. 지어내지 않습니다.">모름</span>
          </td>
          <!-- 반자 높이(OE-EQP-03). 모르면 0 이나 층고로 채우지 않고 입력을 받는다. 후보(계산)는 입력창 기본값이다. -->
          <td class="num mono storey-ceiling">
            <template v-if="ceilingEditing === s.id">
              <input
                v-model="ceilingInput"
                type="number"
                step="0.05"
                min="0.3"
                class="ceiling-input"
                :aria-label="`${s.name} 천장고(m)`"
                @keydown.enter.prevent="saveCeiling(s.id, Number(ceilingInput))"
                @keydown.esc.stop="ceilingEditing = null"
              />
              m
              <button type="button" class="link" @click="saveCeiling(s.id, Number(ceilingInput))">확인</button>
              <button type="button" class="link" @click="ceilingEditing = null">취소</button>
            </template>
            <template v-else-if="ceilingOf(s)">
              <span :title="ceilingTitle(s)">{{ meters(ceilingOf(s)!.height) }}</span>
              <Src :kind="ceilingOf(s)!.source" />
              <span v-if="ceilingGuessApart(s)" class="height-mismatch" :title="ceilingTitle(s)">후보 {{ meters(ceilingGuessOf.get(s.id)!.height) }}</span>
              <button type="button" class="link" :aria-label="`${s.name} 천장고 고치기`" @click="startCeiling(s.id)">고치기</button>
              <button v-if="s.ceilingSet != null" type="button" class="link" @click="saveCeiling(s.id, null)">{{ s.ceiling ? 'BIM 값으로' : '지우기' }}</button>
            </template>
            <template v-else>
              <span class="muted" :title="ceilingTitle(s)">모름</span>
              <button type="button" class="link" :aria-label="`${s.name} 천장고 입력`" @click="startCeiling(s.id)">입력</button>
            </template>
          </td>
          <!-- 한 층에 방이 수십 개면 이름이 줄을 넘친다. 한 줄로 자르고 전체는 툴팁으로. -->
          <td class="names" :title="s.spaces.map((x) => x.longName || x.name).join(', ')">
            <template v-if="s.spaces.length">
              <span class="muted">{{ s.spaces.length }}개 · </span>{{ s.spaces.map((x) => x.longName || x.name).join(', ') }}
            </template>
            <template v-else>—</template>
          </td>
          <td class="num mono">
            {{ s.spaces.reduce((n, x) => n + x.areaM2, 0).toFixed(1) }} ㎡
          </td>
          <!-- 두께가 한두 종류면 그대로 보이고, 많으면 종류 수만 보이고 목록은 툴팁으로 본다.
               성수는 한 층에 10종이 넘어 표가 오른쪽으로 넘쳤다. -->
          <td class="num mono" :title="wallThicknessOf(s)">
            {{ s.walls.length }}<template v-if="s.walls.some((w) => w.thickness !== null)">
              <span class="muted"> · {{ wallThicknessLabel(s) }}</span>
            </template>
          </td>
          <td class="num mono storey-equipment">{{ s.equipment.length }}</td>
          <td class="storey-done" :data-state="progressById.get(s.id)?.state">
            <template v-if="progressById.get(s.id)?.state === 'done'">
              <span class="done-mark" :title="`완료 표시: ${doneTime(progressById.get(s.id)?.at)}`">완료 ✓</span>
              <button type="button" class="link" :aria-label="`${s.name} 완료 지우기`" @click="setStoreyDone(s.id, false)">지우기</button>
            </template>
            <template v-else-if="progressById.get(s.id)?.state === 'changed'">
              <span class="height-mismatch" :title="`${doneTime(progressById.get(s.id)?.at)} 에 완료한 뒤 이 층을 고쳤습니다`">완료 뒤 고침</span>
              <button type="button" class="link" :aria-label="`${s.name} 다시 완료`" @click="setStoreyDone(s.id, true)">다시 완료</button>
            </template>
            <button v-else type="button" class="ghost" :aria-label="`${s.name} 완료 표시`" @click="setStoreyDone(s.id, true)">완료 표시</button>
          </td>
          <td class="storey-build">
            <button
              type="button"
              class="ghost"
              :aria-label="`${s.name} 구축`"
              title="이 층만 온톨로지로 받습니다(TTL·GeoJSON 한 쌍). 다른 층을 가리키는 줄은 id 로 남습니다."
              :disabled="busy"
              :class="{ done: justDone === `build:${s.id}` }"
              @click="buildStorey(s.id)"
            >
              구축
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <!-- 설치면 판정(OE-EQP-03). 설비 z(층 바닥 기준)로 판정한다. 허용 설치면 밖인 설비를 따로 보인다(Q9). -->
    <p v-if="surfaceRows.length" class="surface-summary hint">
      설치면 판정 <Src kind="calc" /> 천장 {{ surfaceCounts.ceiling }} · 플레넘 {{ surfaceCounts.plenum }} · 바닥 {{ surfaceCounts.floor }} · 벽 {{ surfaceCounts.wall }} ·
      미정 {{ surfaceCounts.unknown }}
      <template v-if="model.storeys.some((x) => !ceilingOf(x) && x.equipment.length)">
        <span class="muted">(천장고를 모르는 층은 천장을 판정하지 않습니다)</span>
      </template>
    </p>
    <details v-if="surfaceMismatch.length" class="surface-mismatch">
      <summary><span class="height-mismatch">허용 설치면 밖 {{ surfaceMismatch.length }}대</span> — 판정한 면이 종류의 허용 설치면(사전)에 없습니다</summary>
      <ul>
        <li v-for="r in surfaceMismatch.slice(0, 50)" :key="r.equipment.id">
          <button type="button" class="link" @click="select(r.equipment.id)">{{ r.equipment.name }}</button>
          <span class="muted"> {{ r.storey.name }} · {{ equipmentKind(r.equipment.kind)?.label }} · 판정 {{ JUDGED_LABEL[r.judged!] }} (z {{ (r.equipment.position![2] - r.storey.elevation).toFixed(2) }}m) · 허용 {{ allowedLabel(r.equipment.kind) }}</span>
        </li>
        <li v-if="surfaceMismatch.length > 50" class="muted">외 {{ surfaceMismatch.length - 50 }}대</li>
      </ul>
    </details>
  </Fold>
</template>
