<script setup lang="ts">
import { issueText, issueTitle, warningCode } from '../../lib/issue-code'
import { replayMemo } from '../../lib/replay-player'
import { systemless } from '../../editor/checks'
import { vKeepTyping } from '../../editor/edit-filter'
import { warnings } from '../../editor/open-file'
import { clearInspectorSelection, failedCheckRules, failedChecksTotal, filteredWarnings, jumpToSection, outlineless, sideTab, splitWarning, unplaced, warnCounts, warnFilter, warningsCollapsed, warnSearch } from '../../editor/panels'
import { grades, gradesOpen } from '../../editor/publish'
</script>

<template>
  <div v-memo="replayMemo()" class="diag-hub" data-testid="diag-hub">
    <!-- 행동 중심 진단 요약 바(P2): 어디부터 보정해야 하는지 한눈에 보고 클릭 시 해당 섹션으로 바로 이동·열기 -->
    <div class="diag-bar" role="region" aria-label="보정 할 일 요약">
      <span class="diag-title">진단 요약</span>
      <button
        v-if="grades"
        type="button"
        :class="['diag-chip', grades.gate ? 'ok' : 'fail']"
        title="우측 파일 개요의 수용 기준선 등급 판정 표를 봅니다"
        @click="sideTab = 'inspector'; clearInspectorSelection(); gradesOpen = true; jumpToSection('.overview .grade-banner')"
      >
        수용 기준선 <b>{{ grades.gate ? '통과' : '미달' }}</b>
      </button>
      <button v-if="outlineless.length" type="button" class="diag-chip warn" title="외곽선 없는 물리존 목록으로 이동합니다" @click="jumpToSection('.fold.outlineless')">
        외곽선 없는 물리존 <b>{{ outlineless.length.toLocaleString() }}개</b>
      </button>
      <button v-if="unplaced.length" type="button" class="diag-chip warn" title="미배치 설비 목록으로 이동합니다" @click="jumpToSection('.fold.unplaced')">
        미배치 설비 <b>{{ unplaced.length.toLocaleString() }}대</b>
      </button>
      <button v-if="systemless.length" type="button" class="diag-chip warn" title="계통 없는 VAV·토출구 목록으로 이동합니다" @click="jumpToSection('.fold.systemless')">
        계통 미지정 <b>{{ systemless.length.toLocaleString() }}대</b>
      </button>
      <button v-if="failedChecksTotal > 0" type="button" class="diag-chip warn" title="완전성 검사 위반 항목으로 이동합니다" @click="jumpToSection('.fold.checks')">
        검사 위반 <b>{{ failedChecksTotal.toLocaleString() }}건</b> <small>({{ failedCheckRules.length }}규칙)</small>
      </button>
      <button type="button" class="diag-chip ghost-link" title="전체 요구사항 판정표를 봅니다" @click="jumpToSection('.fold.requirements')">
        판정표 →
      </button>
    </div>

    <!-- 구조화된 경고 패널(P1): 분류별 필터 칩 + 검색 + 카드형 리스트 (E2E #warnings > li 및 .issue-code 유지) -->
    <div v-if="warnings.length" class="warnings-panel">
      <div class="warnings-head">
        <div class="warnings-title">
          <b>모델 진단 알림</b>
          <span class="muted">총 {{ warnings.length }}건</span>
        </div>
        <div class="warn-filters" role="group" aria-label="경고 분류 필터">
          <button type="button" :class="['warn-chip', { on: warnFilter === 'all' }]" :aria-pressed="warnFilter === 'all'" @click="warnFilter = 'all'; warningsCollapsed = false">
            전체 <b>{{ warnCounts.all }}</b>
          </button>
          <button v-if="warnCounts.A" type="button" :class="['warn-chip', 'cls-A', { on: warnFilter === 'A' }]" :aria-pressed="warnFilter === 'A'" title="내보내기 설정 변경이 필요한 항목" @click="warnFilter = warnFilter === 'A' ? 'all' : 'A'; warningsCollapsed = false">
            A-설정 <b>{{ warnCounts.A }}</b>
          </button>
          <button v-if="warnCounts.B" type="button" :class="['warn-chip', 'cls-B', { on: warnFilter === 'B' }]" :aria-pressed="warnFilter === 'B'" title="원본 BIM에 값이나 요소 추가가 필요한 항목" @click="warnFilter = warnFilter === 'B' ? 'all' : 'B'; warningsCollapsed = false">
            B-부재 <b>{{ warnCounts.B }}</b>
          </button>
          <button v-if="warnCounts.C" type="button" :class="['warn-chip', 'cls-C', { on: warnFilter === 'C' }]" :aria-pressed="warnFilter === 'C'" title="에디터에서 보정 가능한 항목" @click="warnFilter = warnFilter === 'C' ? 'all' : 'C'; warningsCollapsed = false">
            C-보정 <b>{{ warnCounts.C }}</b>
          </button>
          <button v-if="warnCounts.X" type="button" :class="['warn-chip', 'cls-X', { on: warnFilter === 'X' }]" :aria-pressed="warnFilter === 'X'" title="BIM 범위 밖 항목" @click="warnFilter = warnFilter === 'X' ? 'all' : 'X'; warningsCollapsed = false">
            X-외부 <b>{{ warnCounts.X }}</b>
          </button>
          <button v-if="warnCounts.other" type="button" :class="['warn-chip', 'cls-other', { on: warnFilter === 'other' }]" :aria-pressed="warnFilter === 'other'" title="일반 참고 알림" @click="warnFilter = warnFilter === 'other' ? 'all' : 'other'; warningsCollapsed = false">
            기타 <b>{{ warnCounts.other }}</b>
          </button>
        </div>
        <div class="warnings-tools">
          <input
            v-if="warnings.length > 4 && !warningsCollapsed"
            v-model="warnSearch"
            v-keep-typing
            type="text"
            class="warn-search"
            placeholder="경고 내용 검색…"
            aria-label="경고 내용 검색"
          />
          <button type="button" class="link warn-collapse" :aria-expanded="!warningsCollapsed" @click="warningsCollapsed = !warningsCollapsed">
            {{ warningsCollapsed ? `펼치기 (${filteredWarnings.length}건) ▸` : '접기 ▾' }}
          </button>
        </div>
      </div>
      <ul v-show="!warningsCollapsed" id="warnings" class="warnings">
        <!-- 누락 분류 코드와 R 번호(OE-BIM-20). 어느 R 을 고쳐 달라고 할지가 경고마다 보인다. -->
        <li v-for="w in filteredWarnings" :key="w" :data-class="warningCode(w)?.cls ?? 'other'">
          <span v-if="warningCode(w)" class="issue-code" :data-class="warningCode(w)!.cls" :title="issueTitle(warningCode(w)!)">{{ issueText(warningCode(w)!) }}</span>
          <span class="warn-body"><b v-if="splitWarning(w).prefix" class="warn-file">{{ splitWarning(w).prefix }}</b><span class="warn-main">{{ splitWarning(w).main }}</span><span v-if="splitWarning(w).rest" class="warn-rest">{{ splitWarning(w).rest }}</span></span>
        </li>
      </ul>
    </div>
  </div>
</template>
