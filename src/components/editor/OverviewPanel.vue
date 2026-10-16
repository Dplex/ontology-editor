<script setup lang="ts">
import type { PropType } from 'vue'
import { OPENING_SNAP_RANGE } from '../../lib/edit'
import { GATE, percent, TARGET } from '../../lib/grade'
import { hvacZonesOf } from '../../lib/hvac-zone'
import { replayMemo } from '../../lib/replay-player'
import { appendData, baseName } from '../../editor/chat-view'
import { busy, editing } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { archMode } from '../../editor/equipment-edit'
import { startManualZones } from '../../editor/manual-draw'
import { canAppend, currentTiers, onAppendPick, pairHint, warnings } from '../../editor/open-file'
import { editBlock } from '../../editor/people'
import { gradeLines, grades, gradesOpen, resetGradeLines } from '../../editor/publish'
import { elementSettings, setOpeningSnap, setSiteWallThickness, WALL_FROM, wallThicknessHere } from '../../editor/read-settings'
import { allCustomZones, selectedCustomZoneId } from '../../editor/space-edit'
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
    <ul class="overview-counts">
      <li><b>{{ counts.storeys }}</b> 층</li>
      <li><b>{{ counts.spaces }}</b> 물리존</li>
      <li><b>{{ counts.devices }}</b> 기기</li>
      <li><b>{{ counts.conduits }}</b> 덕트·배관</li>
      <li><b>{{ counts.systems }}</b> 계통</li>
      <li><b>{{ counts.connections }}</b> 연결</li>
    </ul>
    <!-- 공조존 생성 방법(OE-BIM-15). R1 은 직접 만들기만 보인다. IDF·gbXML 추가로 가져오기는 R2 에서 이 목록에 더한다. -->
    <div v-if="counts.spaces" class="zone-route" data-testid="zone-route">
      <h4>공조존 생성 방법</h4>
      <p class="muted">
        {{ model && hvacZonesOf(model).length ? `공조존 ${hvacZonesOf(model).length}개가 있습니다.` : '아직 공조존이 없습니다.' }} 나중에 만들어도 불러온 BIM 은 그대로입니다.
      </p>
      <p>
        <button type="button" class="ghost" :disabled="busy || !!editBlock" @click="startManualZones">공조존 직접 만들기</button>
        <span class="muted">공간 편집 모드에서 담당 물리존을 골라 공조존을 직접 구성합니다.</span>
      </p>
    </div>
    <!-- 커스텀존(OE-OBJ-01). 3D 에서는 점선이라 누르기 어려워 여기서 고른다. -->
    <div v-if="allCustomZones.length" class="overview-zones">
      <h4>커스텀존 {{ allCustomZones.length }}</h4>
      <ul class="plain">
        <li v-for="x in allCustomZones" :key="x.zone.id">
          <button type="button" class="link" @click="selectedCustomZoneId = x.zone.id">{{ x.zone.name }}</button>
          <span class="muted">{{ x.storey.name }}</span>
        </li>
      </ul>
    </div>
    <!-- 벽·문·창 설정(OE-SPC-12 · OE-SPC-13). [벽·문·창] 을 켰을 때만. 3D 위 팔레트에 두면 바닥을 가린다. -->
    <div v-if="editing && archMode" class="element-settings" data-testid="element-settings">
      <h4>벽·문·창 설정</h4>
      <label>
        새 벽 사이트 기본 두께(내벽)
        <input
          type="number"
          step="0.01"
          min="0.01"
          placeholder="없음"
          data-testid="site-wall-thickness"
          v-keep-typing
          :value="elementSettings.interiorWall ?? ''"
          @change="setSiteWallThickness(($event.target as HTMLInputElement).value)"
        />
        m
      </label>
      <p v-if="wallThicknessHere" class="hint" data-testid="wall-thickness-here">
        {{ wallThicknessHere.storey }}에 새 벽을 그으면 <b class="mono">{{ wallThicknessHere.thickness }}m</b>({{ WALL_FROM[wallThicknessHere.from] }})입니다. 같은 층 BIM 내벽이 있으면 그 두께가 먼저입니다.
      </p>
      <label>
        문·창 스냅 거리
        <input
          type="number"
          step="0.1"
          :min="OPENING_SNAP_RANGE.min"
          :max="OPENING_SNAP_RANGE.max"
          data-testid="opening-snap"
          v-keep-typing
          :value="elementSettings.openingSnap"
          @change="setOpeningSnap(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = String(elementSettings.openingSnap)"
        />
        m
      </label>
      <p class="hint">벽에서 이 거리 안을 눌러야 문·창이 가장 가까운 벽에 붙습니다. 이 브라우저에만 남습니다.</p>
    </div>
    <p class="hint">
      3D에서 설비를 클릭하면 연결과 소속이, 바닥을 클릭하면 물리존 정보가 오른쪽 위 카드에 표시됩니다.
      <template v-if="warnings.length"><a href="#warnings" class="link">경고 {{ warnings.length }}건</a>, </template>
      요구사항, 검사, 표는 이 패널 아래에 있습니다.
    </p>
    <!-- 출처 표. 숫자·표·3D 색에 붙는 꼬리표가 무엇을 뜻하는지. -->
    <p class="src-key">
      <Src kind="bim" /> 파일에 적힌 그대로<br />
      <Src kind="calc" /> BIM 좌표·형상으로 계산<br />
      <Src kind="dict" /> 이름 사전·흐름 규칙으로 추정
    </p>
  </section>
</template>
