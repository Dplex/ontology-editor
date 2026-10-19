<script setup lang="ts">
import type { PropType } from 'vue'
import { MISSING_LABEL, missingClass } from '../../lib/build-report'
import { ifcClassLabel } from '../../lib/kinds'
import { vFlash } from '../../lib/motion'
import { replayMemo } from '../../lib/replay-player'
import { ratioLabel } from '../../lib/unit-check'
import { MATCH_KEY_BY } from '../../lib/versions'
import { selectAndShow } from '../../editor/chat-view'
import { systemless, whatIs } from '../../editor/checks'
import { busy, doorLinks, fileName, skipped } from '../../editor/core'
import { EDIT_LIMIT } from '../../editor/edit-filter'
import { shortName } from '../../editor/equipment-shape'
import { equipmentById, ruleReport } from '../../editor/flow-rules'
import { idfReport } from '../../editor/idf-zones'
import { connectionSources, proxyDevices } from '../../editor/kinds'
import { currentRequirements, mergeLines, warnings } from '../../editor/open-file'
import { justDone } from '../../editor/open-many'
import { drawOutlineFromList, failedChecksTotal, outlineless, REQUIREMENT_STATE, requirementGroups, requirementsMeta, unplaced, UNPLACED_SHOWN } from '../../editor/panels'
import { downloadCustomerReport, downloadIssuesBCF, downloadIssuesCSV, generation, issueItems, issueRows, makeGenerationReport } from '../../editor/reports'
import { isolateRequirement, itemCount, ITEM_LABEL, ITEMS_SHOWN, openRequirement, openRequirementItems, pulseRequirement, showRequirementItem, toggleRequirement } from '../../editor/requirement-items'
import { onVersionPick, showSpace, versionBusy, versionDiff, versionError, versionLists, versionNormalized, versionRows, versionView } from '../../editor/versions'
import Fold from '../Fold.vue'
import Meter from '../Meter.vue'
import Roll from '../Roll.vue'
import Src from '../Src.vue'
import DiagHub from './DiagHub.vue'
import type { counts as countsRef, model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="review">
    <h3 class="section-title">요약</h3>
    <p class="stats">{{ model.siteName || '(대지 이름 없음)' }} › {{ model.buildingName || '(건물 이름 없음)' }}</p>

    <!-- PRD #6 의 임포트 결과 검토 항목이다. 무엇이 만들어졌는지 숫자로 먼저 본다. -->
    <ul class="tiles">
      <li v-flash="counts.storeys"><b><Roll :value="counts.storeys" /></b><span>층</span><Src kind="bim" /></li>
      <li v-flash="counts.spaces"><b><Roll :value="counts.spaces" /></b><span>물리존</span><Src kind="bim" /></li>
      <!-- 읽지 않기로 한 피처는 0 이 아니라 "읽지 않음" 이다. 0 이면 BIM 에 없다는 말이 된다. -->
      <li v-if="skipped.has('walls')" class="skipped"><b>–</b><span>벽</span><small>읽지 않음</small></li>
      <li v-else v-flash="counts.walls"><b><Roll :value="counts.walls" /></b><span>벽</span><Src kind="bim" /></li>
      <li v-if="skipped.has('doors')" class="skipped"><b>–</b><span>문</span><small>읽지 않음</small></li>
      <li v-else v-flash="counts.doors" :class="{ wide: doorLinks.total > 0 }">
        <b><Roll :value="counts.doors" /></b><span>문</span><Src kind="bim" />
        <!-- 방-문-방. BIM 의 공간 경계가 말하면 BIM, 없으면 문 양쪽을 좌표로 짚은 계산이다. -->
        <small v-if="doorLinks.total > 0">
          방과 방을 잇는 문 {{ doorLinks.two }}
          <template v-if="doorLinks.bim"><Src kind="bim" /></template>
          <template v-if="doorLinks.calc"><Src kind="calc" /></template>
        </small>
      </li>
      <li v-if="skipped.has('windows')" class="skipped"><b>–</b><span>창문</span><small>읽지 않음</small></li>
      <li v-else v-flash="counts.windows"><b><Roll :value="counts.windows" /></b><span>창문</span><Src kind="bim" /></li>
      <li v-if="!skipped.has('walls')" v-flash="counts.loadBearingWalls"><b><Roll :value="counts.loadBearingWalls" /></b><span>내력벽</span><Src kind="bim" /></li>
      <li v-if="model.hvac" class="wide" v-flash="model.hvac.zones.length">
        <b><Roll :value="model.hvac.zones.length" /></b><span>공조존</span><Src kind="idf" />
        <small v-if="idfReport">
          방이 든 존 {{ idfReport.zonesWithSpaces }} · 존에 든 방 {{ idfReport.spacesInZones }}/{{ idfReport.spaces }} <Src kind="calc" />
          <template v-if="idfReport.straddling"> · 두 존에 걸친 방 {{ idfReport.straddling }}</template>
          <template v-if="idfReport.partial"> · 절반 못 덮인 방 {{ idfReport.partial }}</template>
        </small>
      </li>
      <!-- 설비를 하나로 세면 대수가 부푼다. 실측에서 85%가 덕트·배관이었다.
           Proxy 는 IFC 가 설비라고 말하지 않은 것을 사전이 설비로 받은 것이라 따로 센다. -->
      <li :class="{ wide: proxyDevices.ported + proxyDevices.named > 0 }" v-flash="counts.devices">
        <b><Roll :value="counts.devices" /></b><span>기기</span><Src kind="bim" />
        <small v-if="proxyDevices.ported + proxyDevices.named > 0">
          그중 Proxy
          <template v-if="proxyDevices.ported">포트 {{ proxyDevices.ported }} <Src kind="calc" /></template>
          <template v-if="proxyDevices.named">이름 {{ proxyDevices.named }} <Src kind="dict" /></template>
        </small>
      </li>
      <li v-flash="counts.conduits"><b><Roll :value="counts.conduits" /></b><span>덕트·배관</span><Src kind="bim" /></li>
      <li v-flash="counts.systems"><b><Roll :value="counts.systems" /></b><span>계통</span><Src kind="bim" /></li>
      <!-- 연결의 근거(OE-BIM-09): BIM 포트(방향 명시 · 양방향/미지정) · 형상 추정(미확정 후보) · 사람이 이음. 한 가지뿐이면 출처 꼬리표만. -->
      <li :class="{ wide: connectionSources.kinds > 1 }" v-flash="counts.connections" data-testid="connection-classes">
        <b><Roll :value="counts.connections" /></b><span>연결</span>
        <template v-if="connectionSources.kinds <= 1">
          <Src v-if="connectionSources.port" kind="bim" /><Src v-else-if="connectionSources.geometry" kind="calc" /><Src v-else-if="connectionSources.manual" kind="edit" />
        </template>
        <small v-else>
          <template v-if="connectionSources.port">포트 {{ connectionSources.port }}(방향 명시 {{ connectionSources['port-directed'] }} · 양방향/미지정 {{ connectionSources['port-undirected'] }}) <Src kind="bim" /></template>
          <template v-if="connectionSources.geometry"> · 형상 추정 후보 {{ connectionSources.geometry }} <Src kind="calc" /></template>
          <template v-if="connectionSources.manual"> · 사람 {{ connectionSources.manual }} <Src kind="edit" /></template>
        </small>
      </li>
      <li v-flash="counts.directedConnections"><b><Roll :value="counts.directedConnections" /></b><span>흐름 방향</span><Src kind="bim" /></li>
      <li v-if="ruleReport && ruleReport.oriented > 0" v-flash="ruleReport.oriented">
        <b><Roll :value="ruleReport.oriented" /></b><span>규칙 방향</span><Src kind="dict" />
      </li>
    </ul>

    <ul v-if="mergeLines.length" class="merge">
      <li class="merge-src"><Src kind="calc" /> 두 파일을 층 이름·높이와 좌표로 맞춰 합쳤습니다.</li>
      <li v-for="line in mergeLines" :key="line">{{ line }}</li>
    </ul>

    <DiagHub v-if="warnings.length || outlineless.length || unplaced.length || systemless.length || failedChecksTotal > 0" />

    <!-- 미배치 목록(OE-BIM-07). 좌표가 없어 3D 에 없는 설비. 층은 BIM 이 말한 것이고, TTL 에는 그 층까지만 나간다. 놓기는 편집
         팔레트의 미배치 목록에서 한다(OE-EQP-02 — 따로 [3D에서 놓기] 버튼을 두지 않는다). -->
    <!-- 아래 세 목록은 처음에 접는다. 패널은 파일을 여는 동안 이미 그려져서, "30개 이하면 펼침" 이 0개일 때 정해져 성수 344대도 펼친 채였다
         (패널이 13,000px 이 됐다, 2026-10-16). 진단 요약의 칩을 누르면 그 목록으로 가서 편다(jumpToSection). -->
    <!-- 외곽선 없는 물리존(OE-MAN-03). 모델을 합치며 다른 모델에서 외곽선을 빌려온 방은 이미 외곽선이 있어 나오지 않는다. -->
    <Fold
      v-if="outlineless.length"
      title="외곽선 없는 물리존"
      :meta="`${outlineless.length.toLocaleString()}개 — 3D 에 없고 설비 소속 판정에 쓰이지 않습니다`"
      :default-open="false"
      class="outlineless"
      data-testid="outlineless"
    >
      <ul class="unplaced-list">
        <li v-for="o in outlineless.slice(0, UNPLACED_SHOWN)" :key="o.space.id">
          <button type="button" class="link" :disabled="busy" @click="drawOutlineFromList(o.space.id)">{{ o.space.longName || o.space.name || o.space.id }}</button>
          <span class="muted">
            {{ o.storey.name }}<template v-if="o.space.name"> · 번호 {{ o.space.name }}</template> ·
            {{ o.space.bimArea ? `BIM 면적 ${o.space.bimArea.m2.toFixed(1)}㎡` : 'BIM 면적 없음' }}
          </span>
        </li>
      </ul>
      <p v-if="outlineless.length > UNPLACED_SHOWN" class="muted">외 {{ (outlineless.length - UNPLACED_SHOWN).toLocaleString() }}개 — 편집의 물리존 표에서 "외곽선 없음" 인 것입니다</p>
      <p class="hint">누르면 그 층 3D 에서 점을 차례로 찍어 외곽선을 그립니다(Enter·첫 점으로 닫기, Esc 취소). 물리존 수는 늘지 않고 이름·번호·종류는 그대로입니다.</p>
    </Fold>

    <Fold v-if="unplaced.length" title="미배치 설비" :meta="`${unplaced.length.toLocaleString()}대 — 좌표가 없어 3D에 없습니다`" :default-open="false" class="unplaced">
      <ul class="unplaced-list">
        <li v-for="u in unplaced.slice(0, UNPLACED_SHOWN)" :key="u.equipment.id">
          <button type="button" class="link" @click="selectAndShow(u.equipment.id)">{{ u.equipment.name ? shortName(u.equipment.name) : '(이름 없음)' }}</button>
          <span class="muted">{{ u.storey.name }} · {{ whatIs(u.equipment)?.label ?? ifcClassLabel(u.equipment.ifcClass) ?? u.equipment.ifcClass }}</span>
        </li>
      </ul>
      <p v-if="unplaced.length > UNPLACED_SHOWN" class="muted">외 {{ (unplaced.length - UNPLACED_SHOWN).toLocaleString() }}대 — 설비 표에서 좌표 칸이 빈 것입니다</p>
    </Fold>

    <!-- 계통 없는 VAV·토출구(OE-EQP-10). BIM 에서 연 그대로는 드물고, VAV 를 새로 놓거나 계통을 지우면 생긴다. -->
    <Fold v-if="systemless.length" title="계통 없는 VAV·토출구" :meta="`${systemless.length.toLocaleString()}대 — 어느 계통에도 들지 않습니다`" :default-open="false" class="systemless">
      <ul class="unplaced-list">
        <li v-for="x in systemless.slice(0, UNPLACED_SHOWN)" :key="x.equipment.id">
          <button type="button" class="link" @click="selectAndShow(x.equipment.id)">{{ x.equipment.name ? shortName(x.equipment.name) : '(이름 없음)' }}</button>
          <span class="muted">{{ x.storeyName }} · {{ whatIs(x.equipment)?.label ?? x.equipment.ifcClass }}</span>
        </li>
      </ul>
      <p v-if="systemless.length > UNPLACED_SHOWN" class="muted">외 {{ (systemless.length - UNPLACED_SHOWN).toLocaleString() }}대</p>
    </Fold>

    <!-- 고객사 BIM 요구사항(정본 4장)에 대 본 것. IDS 와 달리 "다른 자리에 있다(우리는 읽는다)"를 따로 센다. -->
    <Fold v-if="currentRequirements.length" title="요구사항" :meta="requirementsMeta" :default-open="false" class="requirements">
      <table class="req-table">
        <thead>
          <tr><th>#</th><th>요구</th><th>상태</th><th title="누락 분류(OE-BIM-20) — X 외부 · A 설정 · B 부재 · C 보정">분류</th><th class="num" title="충족(표준 자리 · 다른 자리) / 검사 — 대상이 검사보다 많으면 대상도(판정하지 못한 것이 있다)">충족 / 검사 · 대상</th><th>설명</th><th>고객사에 할 요청</th></tr>
        </thead>
        <tbody v-for="g in requirementGroups" :key="g.level">
          <tr class="req-group">
            <th colspan="7">{{ g.level }}{{ g.level === '필수' ? ' — 없으면 대신 채울 방법이 없음' : ' — 없으면 계산·사전·수작업으로 채움' }}</th>
          </tr>
          <template v-for="r in g.rows" :key="r.id">
          <tr v-flash="`${r.state}:${r.counts?.standard}:${r.counts?.elsewhere}`" :class="{ chosen: openRequirement === r.id }">
            <td class="mono">{{ r.id }}</td>
            <td>{{ r.title }}</td>
            <td><span :class="['req-state', r.state]">{{ REQUIREMENT_STATE[r.state] }}<template v-if="r.unread"> · 읽지 않음</template></span></td>
            <td class="req-class" :data-class="missingClass(r) ?? ''">{{ missingClass(r) ? MISSING_LABEL[missingClass(r)!] : '—' }}</td>
            <td class="num mono">
              <template v-if="r.counts && r.counts.of">
                <Roll :value="r.counts.standard" /><template v-if="r.counts.elsewhere"> · <Roll :value="r.counts.elsewhere" /></template> / {{ r.counts.of }}<template v-if="r.counts.target !== r.counts.of"> · 대상 {{ r.counts.target }}</template>
                <Meter
                  :parts="[
                        { value: r.counts.standard / r.counts.of, tone: 'accent' },
                        { value: r.counts.elsewhere / r.counts.of, tone: 'soft' },
                      ]"
                  :label="`표준 자리 ${r.counts.standard}, 다른 자리 ${r.counts.elsewhere} / ${r.counts.of}`"
                />
                <!-- 표준 자리가 아닌 것을 펼쳐 이름으로 보고, 3D 에서 짚는다(editor/requirement-items.ts). -->
                <button
                  v-if="itemCount(r)"
                  type="button"
                  class="link req-items-toggle"
                  :aria-expanded="openRequirement === r.id"
                  :data-testid="`req-items-${r.id}`"
                  :title="`표준 자리가 아닌 ${ITEM_LABEL[r.items!.kind]} ${itemCount(r)}개를 펼칩니다`"
                  @click="toggleRequirement(r.id)"
                >
                  {{ openRequirement === r.id ? '접기' : `${ITEM_LABEL[r.items!.kind]} ${itemCount(r).toLocaleString()}개 보기` }}
                </button>
              </template>
            </td>
            <td class="muted">{{ r.note }}</td>
            <td class="req-ask" :class="{ setting: r.state === 'elsewhere' || (r.counts?.elsewhere ?? 0) > 0 }">{{ r.ask || '—' }}</td>
          </tr>
          <tr v-if="openRequirement === r.id && r.items" class="req-items-row" data-testid="req-items">
            <td colspan="7">
              <p class="req-items-head">
                <b>{{ r.id }} {{ r.title }}</b> — 표준 자리가 아닌 {{ ITEM_LABEL[r.items.kind] }}
                <template v-if="r.items.elsewhere.length">다른 자리 {{ r.items.elsewhere.length.toLocaleString() }}</template>
                <template v-if="r.items.elsewhere.length && r.items.missing.length"> · </template>
                <template v-if="r.items.missing.length">없음 {{ r.items.missing.length.toLocaleString() }}</template>
                <button v-if="r.items.kind === 'equipment'" type="button" class="ghost" data-testid="req-isolate" title="이 설비만 3D 에 남깁니다(화면에서만). [모두 보이기] 로 돌아옵니다" @click="isolateRequirement(r)">3D 에서 이것만 보기</button>
                <button v-else-if="r.items.kind === 'space'" type="button" class="ghost" title="바닥 외곽선이 있는 물리존을 3D 에서 잠깐 밝힙니다" @click="pulseRequirement(r)">3D 에서 밝히기</button>
                <button v-else type="button" class="ghost" title="3D 벽을 켭니다 — 고르면 그 자리로 갑니다" @click="pulseRequirement(r)">3D 벽 켜기</button>
              </p>
              <ul class="req-items-list">
                <li v-for="x in openRequirementItems.slice(0, ITEMS_SHOWN)" :key="x.id">
                  <button type="button" class="link" :title="`${x.name} · ${x.id}`" @click="showRequirementItem(r.items.kind, x.id)">{{ x.name }}</button>
                  <small class="muted">{{ x.where }}<template v-if="x.elsewhere"> · 다른 자리</template><template v-if="!x.placed"> · {{ r.items.kind === 'space' ? '외곽선 없음' : '좌표 없음' }}</template></small>
                </li>
              </ul>
              <p v-if="openRequirementItems.length > ITEMS_SHOWN" class="muted">앞 {{ ITEMS_SHOWN }}개만 보입니다(전체 {{ openRequirementItems.length.toLocaleString() }}개).</p>
            </td>
          </tr>
          </template>
        </tbody>
      </table>
      <p class="hint">
        표준 자리는 IDS(<span class="mono">docs/requirements.ids</span>) 검사도 통과합니다. 다른 자리는 값이 있어 읽을 수 있지만
        표준 자리가 아니라서, 고객사에 내보내기 설정을 바꿔 달라고 합니다(요청 칸에 무엇을 바꿀지). 기준은 정본 4장을 보세요.
      </p>
    </Fold>

    <!-- 생성 리포트(B-2, OE-GEN-07)와 고객사 결과 리포트(B-1, OE-GEN-08). B-2 는 반영할 때 버전에도 붙는다. -->
    <Fold title="리포트" meta="생성 리포트(B-2) · 고객사 결과 리포트(B-1)" :default-open="false" class="reports" data-testid="reports">
      <p class="report-actions">
        <button type="button" class="ghost" @click="makeGenerationReport">생성 리포트 만들기</button>
        <button type="button" class="ghost" :class="{ done: justDone === 'customer-report' }" @click="downloadCustomerReport">고객사 결과 리포트(HTML)</button>
        <span class="muted">고객사 리포트는 등급·요구사항 판정과 수정 방법·재제출(A·B)·보정(C) 항목을 담은 HTML 한 파일입니다.</span>
      </p>
      <!-- 어긴 요소 목록(ADR-0051). 설계사가 원본 BIM 에서 그 요소를 찾아 고치게 요소마다 GlobalId·Revit 요소 ID 를 붙여 낸다. -->
      <div class="issue-export" data-testid="issue-export">
        <p class="report-actions">
          <button type="button" class="ghost" :disabled="!issueItems.length" :class="{ done: justDone === 'issues-csv' }" @click="downloadIssuesCSV">누락 요소 목록(CSV)</button>
          <button type="button" class="ghost" :disabled="!issueItems.length" :class="{ done: justDone === 'issues-bcf' }" @click="downloadIssuesBCF">누락 요소 BCF</button>
          <span class="muted">요구사항·완전성 검사를 어긴 요소 {{ issueItems.length.toLocaleString() }}개. BCF 는 BIMcollab Zoom(무료)에서 IFC 와 같이 열면 R·층마다 그 요소가 골라집니다. 편집기에서 고친 것은 빠집니다.</span>
        </p>
        <table v-if="issueRows.length" class="issue-summary">
          <thead><tr><th>R</th><th>분류</th><th>규칙</th><th>요소</th></tr></thead>
          <tbody>
            <tr v-for="row in issueRows" :key="row.r + row.cls + row.rule">
              <td>{{ row.r }}</td>
              <td>{{ MISSING_LABEL[row.cls] }}</td>
              <td>{{ row.rule }}</td>
              <td class="num">{{ row.count.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <ol v-if="generation" class="generation" data-testid="generation">
        <li v-for="sec in generation" :key="sec.no">
          <b>{{ sec.title }}</b>
          <ul>
            <li v-for="(l, i) in sec.lines" :key="i">{{ l }}</li>
          </ul>
        </li>
      </ol>
    </Fold>

    <!-- 판본 비교(PRD #6, R13). 이전 판본과 짝지어 무엇이 바뀌었는지와, GUID 가 판본 사이에 남는지를 잰다. -->
    <Fold
      title="버전 비교"
      :meta="versionDiff ? `이전 버전: ${versionDiff.name}` : '이전 버전과 무엇이 바뀌었는지 비교합니다'"
      :default-open="false"
      class="versions"
    >
      <p class="version-pick">
        <label class="ghost file-pick">
          {{ versionDiff ? '다른 버전' : '이전 버전 열기' }}
          <input type="file" accept=".ifc" :disabled="versionBusy || busy" @change="onVersionPick" />
        </label>
        <span v-if="versionBusy" class="muted">여는 중…</span>
        <span v-else class="muted">같은 건물의 이전 IFC를 여세요. 비교에만 쓰고, 화면과 내보내기는 지금 파일 그대로입니다.</span>
      </p>
      <p v-if="versionError" class="edit-notice inline" role="alert">{{ versionError }}</p>
      <template v-if="versionDiff">
        <p v-if="versionDiff.diff.storeyScale" class="edit-notice inline" role="alert">
          이름이 같은 층의 높이가 이전 버전의 {{ ratioLabel(versionDiff.diff.storeyScale.ratio) }}입니다({{
                versionDiff.diff.storeyScale.storeys.slice(0, 3).map(([n, x, y]) => `${n} ${+x.toPrecision(4)}m → ${+y.toPrecision(4)}m`).join(', ')
              }}). {{ { first: '층간 높이로 보면 이전 버전', second: '층간 높이로 보면 지금 파일', none: '한 버전' }[versionDiff.diff.storeyScale.suspect ?? 'none'] }}의 길이 단위 선언이 실제 값과 다른 것 같습니다({{ versionDiff.diff.storeyScale.what }}, 요구사항 R6).
        </p>
        <!-- 파일 역할(OE-BIM-19): 어느 쪽이 기준이고 어느 쪽이 비교 대상인지. -->
        <p class="hint" data-testid="version-roles">
          기준: 지금 연 파일 <b>{{ fileName }}</b>(화면·내보내기) · 비교 대상 모델: <b>{{ versionDiff.name }}</b>(비교에만 씀)
        </p>
        <p class="hint" data-testid="version-normalized">비교 전에 맞춘 것: {{ versionNormalized }}</p>
        <table class="version-sum">
          <thead>
            <tr>
              <th></th>
              <th class="num">이전 → 지금</th>
              <th class="num" title="두 판본에서 짝지은 것. GUID 유지율의 분모입니다">양쪽에 있는 것(분모)</th>
              <th class="num" title="양쪽에 있는 것 중 GUID가 그대로인 것 / 양쪽에 있는 것(요구사항 R13)">GUID 유지</th>
              <th>그중 GUID가 바뀐 것 <Src kind="calc" /></th>
              <th class="num" title="이전 판본에만 있음 · 지금 판본에만 있음 — 어느 열쇠로도 후보가 없던 것(미매칭)">없어짐 · 새것</th>
              <th class="num" title="후보가 여럿이라 짝짓지 않은 것(모호). 분모에 들지 않습니다">짝 후보 여럿</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[label, k] in [['물리존', versionDiff.diff.spaces], ['설비', versionDiff.diff.equipment]] as const" :key="label">
              <th>{{ label }}</th>
              <td class="num mono">{{ k.prevCount }} → {{ k.nextCount }}</td>
              <td class="num mono">{{ k.by.guid + k.by.revitId + k.by.name + k.by.position }}</td>
              <td class="num mono">
                {{ k.by.guid + k.by.revitId + k.by.name + k.by.position ? `${k.by.guid}/${k.by.guid + k.by.revitId + k.by.name + k.by.position} · ${Math.round((k.by.guid / (k.by.guid + k.by.revitId + k.by.name + k.by.position)) * 100)}%` : '—' }}
              </td>
              <td>
                <template v-if="k.by.revitId + k.by.name + k.by.position">
                  <b class="mono">{{ k.by.revitId + k.by.name + k.by.position }}</b>
                  <span class="muted">
                    ({{ (['revitId', 'name', 'position'] as const).filter((x) => k.by[x]).map((x) => `${MATCH_KEY_BY[x]} ${k.by[x]}개`).join(', ') }} 찾음)
                  </span>
                </template>
                <span v-else class="muted">없음</span>
              </td>
              <td class="num mono">{{ k.removed.length }} · {{ k.added.length }}</td>
              <td class="num mono">{{ k.ambiguous.length }}</td>
            </tr>
          </tbody>
        </table>
        <p class="hint">
          GUID가 바뀌어도 편집 파일은 Revit 요소 ID·이름·위치로 찾아 적용합니다. 다만 DT 쪽에서는 다른 id가 됩니다(요구사항 R13 — 어느 것인지는
          [GUID가 바뀐 것] 목록, 고객사에 할 요청은 요구사항 칸의 R13).
          기준 하나에 여러 개가 걸리면 짝짓지 않고 [짝 후보가 여럿] 으로 따로 셉니다(없어진 것·새것과 GUID 유지율의 분모에 들지 않습니다).
        </p>
        <div class="version-tabs" role="tablist">
          <button
            v-for="l in versionLists"
            :key="l.key"
            type="button"
            role="tab"
            :class="['ghost', { on: versionView === l.key }]"
            :aria-selected="versionView === l.key"
            :disabled="!l.rows.length"
            @click="versionView = l.key"
          >
            {{ l.label }} <b class="mono">{{ l.rows.length }}</b>
          </button>
        </div>
        <div v-if="versionRows.length" class="table-box">
          <table class="version-rows">
            <tbody>
              <tr v-for="r in versionRows.slice(0, EDIT_LIMIT)" :key="r.id">
                <td>
                  <button v-if="r.target === 'equipment'" type="button" class="link" @click="selectAndShow(r.id)">{{ r.name }}</button>
                  <span v-if="r.target === 'equipment' && whatIs(equipmentById.get(r.id))" class="muted what">
                    {{ whatIs(equipmentById.get(r.id))!.label }}
                  </span>
                  <button v-else-if="r.target === 'space'" type="button" class="link" @click="showSpace(r.id)">{{ r.name }}</button>
                  <span v-else>{{ r.name }}</span>
                </td>
                <td class="muted">{{ r.detail }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="versionRows.length > EDIT_LIMIT" class="hint">처음 {{ EDIT_LIMIT }}개만 표시합니다.</p>
        </div>
      </template>
    </Fold>
  </section>
</template>
