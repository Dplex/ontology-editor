<script setup lang="ts">
import type { PropType } from 'vue'
import { GATE, percent, TARGET } from '../../lib/grade'
import { replayMemo } from '../../lib/replay-player'
import { appendData, baseName } from '../../editor/chat-view'
import { busy } from '../../editor/core'
import { canAppend, currentTiers, onAppendPick, pairHint } from '../../editor/open-file'
import { gradeLines, grades, gradesOpen, resetGradeLines } from '../../editor/publish'
import Src from '../Src.vue'
import TierChips from '../TierChips.vue'
import type { counts as countsRef, model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="overview">
    <h3>이 파일</h3>
    <TierChips :tiers="currentTiers" />
    <!-- 수용 기준선 판정(OE-BIM-21, D1·D12 제안안). 게이트(등급 0~3) 통과/미달과 목표선(등급 4). 미달이면 재제출 항목. 등급 칩 바로 아래 —
       위쪽 막대에 두면 3D 가 밀린다. -->
    <div v-if="grades" class="grade-banner" :class="{ fail: !grades.gate }" role="status" data-testid="grade-banner">
      <!-- 결론(통과/미달) 한 줄을 먼저, 세부(게이트·목표선·평가 불가)와 재제출은 그 아래 줄로 나눈다. 한 줄에 개념 다섯 개가 이어져 읽히지 않았다.
           기준값이 PRD 열린 결정(D1·D12)의 제안안이라는 것은 화면 글이 아니라 툴팁으로 둔다. -->
      <span class="grade-lines" title="게이트·목표선 기준값은 PRD 열린 결정 D1·D12 의 제안안입니다">
        <span class="grade-head"><b>수용 기준선 {{ grades.gate ? '통과' : '미달' }}</b><template v-if="grades.gate && !grades.bimGate"> · 원본 BIM 은 미달(보정 후 통과)</template></span>
        <span class="grade-detail muted">
          게이트(등급 0~{{ GATE }}) {{ grades.gate ? '통과' : '미달' }} · 목표선(등급 {{ TARGET }}) {{ grades.target ? '도달' : '미도달' }}<template v-if="grades.rows.some((r) => r.ratio === null)"> · 등급 {{ grades.rows.filter((r) => r.ratio === null).map((r) => r.grade).join('·') }} 은 잴 대상이 없어 평가하지 않음</template>
        </span>
        <span v-if="!grades.bimGate" class="grade-detail">재제출: {{ grades.bimFailing.map((r) => `등급 ${r.grade} ${r.label} ${r.why && !r.why.includes('<') ? r.why : percent(r.ratio)}`).join(' · ') }}</span>
      </span>
      <button type="button" class="link" :aria-expanded="gradesOpen" @click="gradesOpen = !gradesOpen">{{ gradesOpen ? '접기' : '등급 판정 보기' }}</button>
      <div v-if="gradesOpen" class="grade-table" data-testid="grade-table">
        <ul class="grade-rows">
          <li v-for="r in grades.rows" :key="r.grade" :class="{ fail: !r.pass, gate: r.grade <= GATE }">
            <div>
              <b>{{ r.grade }} {{ r.label }}</b><span class="muted">{{ r.grade <= GATE ? ' · 게이트' : r.grade === TARGET ? ' · 목표선' : '' }}</span> —
              {{ r.grade <= GATE ? 'BIM' : 'BIM 포트·확정' }} {{ r.of ? `${r.have}/${r.of} · ` : '' }}{{ percent(r.ratio) }}
              <span v-if="r.aux" class="aux-figure" data-testid="grade-aux">({{ r.aux.source === 'rule' ? '미확정 규칙' : '보정 후' }} {{ r.aux.have }}/{{ r.aux.of }} · {{ percent(r.aux.ratio) }} · 판정 제외)</span>
              · 통과선
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                class="grade-line"
                :value="Math.round(gradeLines[r.grade] * 100)"
                :aria-label="`등급 ${r.grade} 통과선(%)`"
                @change="gradeLines = { ...gradeLines, [r.grade]: Math.min(100, Math.max(0, Number(($event.target as HTMLInputElement).value))) / 100 }"
              />% · <b>{{ r.ratio === null ? '평가 불가(막지 않음)' : r.pass ? '통과' : r.grade <= GATE ? '미달' : '미달(경고)' }}</b>
            </div>
            <div class="muted">
              {{ r.measure }}<template v-if="!r.pass && r.grade <= GATE"> · 재제출: {{ r.resubmit }}</template>
              <template v-if="r.dictKinds?.of"> · 계통 종류(사전) {{ r.dictKinds.have }}/{{ r.dictKinds.of }} · {{ percent(r.dictKinds.ratio) }}(판정에 안 씀)</template>
            </div>
          </li>
        </ul>
        <p class="hint">
          본 숫자로 판정합니다. 게이트(0~3)는 연 때의 BIM·계산 수치, 목표선(4)은 BIM 포트와 사람이 확정한 방향입니다. 괄호 안 보조 숫자(보정 후 · 미확정 규칙)는 판정에 쓰지 않습니다. [구축하기] 는 보정 후 수치로 막고 풉니다(D12 안). 통과선은 PRD 1.8 의 안(D1)이고 이 브라우저의
          설정입니다. <button type="button" class="link" @click="resetGradeLines">기본값으로</button>
        </p>
      </div>
    </div>
    <!-- 여는 중에는 숨긴다. 건축·설비를 같이 열면 설비를 읽는 동안 건축만 보여 "설비를 덧붙이라" 가 떴다. -->
    <div v-if="pairHint && canAppend && !busy" class="pair-hint">
      <p>{{ pairHint.text }}</p>
      <button v-if="pairHint.partner" type="button" class="pick" :disabled="busy" @click="appendData(pairHint.partner!)">
        {{ baseName(pairHint.partner) }} 덧붙이기
      </button>
      <label :class="pairHint.partner ? 'ghost other' : 'pick'">
        {{ pairHint.partner ? '다른 파일 고르기' : pairHint.button }}
        <input type="file" accept=".ifc,.idf" multiple :disabled="busy" @change="onAppendPick" />
      </label>
    </div>
    <!-- 층 · 물리존 · 기기 수는 바로 아래 "요약" 카드에 출처와 같이 있다. 여기 따로 두었더니 같은 숫자가 세 번 나왔다(2026-10-16).
         공조존 만들기 · 커스텀존 목록 · 벽·문·창 설정은 고치는 일이라 레일(ToolRail 의 펼침 칸)과 층 현황으로 옮겼다 — 이 패널은 보기만 한다. -->
    <!-- 출처 표. 숫자·표·3D 색에 붙는 꼬리표가 무엇을 뜻하는지. -->
    <p class="src-key">
      <Src kind="bim" /> 파일에 적힌 그대로<br />
      <Src kind="calc" /> BIM 좌표·형상으로 계산<br />
      <Src kind="dict" /> 이름 사전·흐름 규칙으로 추정
    </p>
  </section>
</template>
