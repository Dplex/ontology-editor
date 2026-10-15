<script setup lang="ts">
import type { PropType } from 'vue'
import { equipmentKind } from '../../lib/kinds'
import { LAYA_SURE } from '../../lib/laya'
import { replayMemo } from '../../lib/replay-player'
import { selectAndShow } from '../../editor/chat-view'
import { KIND_GROUPS } from '../../editor/checks'
import { editing } from '../../editor/core'
import { ruleReport } from '../../editor/flow-rules'
import { familyClues, kindEditLines, kindSuggestions, kindWarning, layaPicks, layaResults, layaState, pickTypeKind, setKind, suggestionWhy, TYPE_LIMIT, unknownTypes } from '../../editor/kinds'
import Fold from '../Fold.vue'
import Src from '../Src.vue'
import type { kindSummary as kindSummaryRef } from '../../editor/kinds'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  kindSummary: { type: null as unknown as PropType<NonNullable<typeof kindSummaryRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()"
    title="종류와 관제점 후보"
    :meta="`기기 종류 ${kindSummary.kinds.length}종 · 모름 ${kindSummary.unknown}대 · 관제점 후보 ${kindSummary.points.reduce((n, k) => n + k.count, 0)}`"
    :default-open="false"
    class="kinds"
  >
    <p class="hint">
      <Src kind="dict" /> Revit 패밀리 이름으로 종류와 Brick 클래스를 정했습니다. 사전에 없는 이름은 비워
      둡니다<template v-if="kindEditLines.length">. <Src kind="edit" /> 직접 정한 패밀리
      {{ kindEditLines.length }}개가 포함되어 있습니다</template>.
    </p>
    <!-- 편집 모드에서만. 사전이 모르는 기기를 패밀리로 묶어 대수 순으로. 한 번 고르면 그 패밀리 전부에 붙는다. -->
    <p v-if="editing && kindWarning" class="edit-notice inline" role="alert">{{ kindWarning }}</p>
    <div v-if="editing && unknownTypes.length" class="unknown-types">
      <h4>
        종류를 모르는 패밀리 {{ unknownTypes.length }}개
        <span class="muted">(기기 {{ unknownTypes.reduce((n, t) => n + t.count, 0) }}대)</span>
      </h4>
      <p class="hint">한 번 고르면 같은 패밀리(크기만 다른 유형 포함) 전체에 적용됩니다.</p>
      <table>
        <tbody>
          <tr v-for="t in unknownTypes.slice(0, TYPE_LIMIT)" :key="t.key">
            <td class="names" :title="t.label">
              {{ t.label }}<small v-if="t.types.size > 1" class="muted"> · 유형 {{ t.types.size }}개</small>
            </td>
            <td class="num mono">{{ t.count }}</td>
            <td class="muted">{{ t.ifcClass }} <Src kind="bim" /></td>
            <td class="clues">
              <template v-if="familyClues.get(t.key)">
                <span>계통: {{ familyClues.get(t.key)!.system }}</span>
                <span>이웃: {{ familyClues.get(t.key)!.neighbors }}</span>
                <span>위치: {{ familyClues.get(t.key)!.place }}</span>
              </template>
              <span v-if="kindSuggestions.get(t.key)?.length" class="suggest">
                후보:
                <button
                  v-for="s in kindSuggestions.get(t.key)"
                  :key="s.kind"
                  type="button"
                  class="link"
                  :title="suggestionWhy(s)"
                  @click="setKind(t.key, s.kind, t.label)"
                >{{ equipmentKind(s.kind)?.label }}</button>
                <Src kind="dict" />
              </span>
              <span
                v-if="layaPicks(t.key).length"
                class="suggest laya"
                :class="{ unsure: layaResults.get(t.key)!.confidence < LAYA_SURE }"
                :title="`Laya(${layaState?.model ?? ''})가 단서 글로 고른 종류와 확률입니다. 누르면 이 패밀리 전체에 붙습니다(출처 사람).`"
              >
                Laya<template v-if="layaResults.get(t.key)!.confidence < LAYA_SURE"> · 신뢰도 낮음</template>:
                <button
                  v-for="s in layaPicks(t.key)"
                  :key="s.kind"
                  type="button"
                  class="link"
                  @click="setKind(t.key, s.kind, t.label)"
                >{{ equipmentKind(s.kind)?.label }} <small class="muted">{{ Math.round(s.p * 100) }}%</small></button>
              </span>
            </td>
            <td>
              <select :aria-label="`${t.label} 의 종류`" @change="pickTypeKind($event, t.key, t.label)">
                <option value="" selected>(모름)</option>
                <optgroup v-for="g in KIND_GROUPS" :key="g.label" :label="g.label">
            <option v-for="k in g.kinds" :key="k.kind" :value="k.kind">{{ k.label }}</option>
          </optgroup>
              </select>
            </td>
            <td><button type="button" class="link" @click="selectAndShow(t.sampleId)">하나 보기</button></td>
          </tr>
        </tbody>
      </table>
      <p v-if="unknownTypes.length > TYPE_LIMIT" class="hint">
        대수가 많은 {{ TYPE_LIMIT }}개만 표시합니다(전체 {{ unknownTypes.length }}개).
      </p>
    </div>
    <div class="kind-grid">
      <table>
        <thead>
          <tr><th>기기 종류</th><th class="num">대수</th><th>Brick</th></tr>
        </thead>
        <tbody>
          <tr v-for="k in kindSummary.kinds" :key="k.label">
            <td>{{ k.label }}</td>
            <td class="num mono">{{ k.count }}</td>
            <td class="muted mono">{{ k.brick }}</td>
          </tr>
          <tr v-if="kindSummary.unknown">
            <td class="muted">(사전에 없음)</td>
            <td class="num mono">{{ kindSummary.unknown }}</td>
            <td class="muted mono">ex:</td>
          </tr>
        </tbody>
      </table>
      <div>
        <h4>관제점 후보 (F13)</h4>
        <p v-if="!kindSummary.points.length" class="empty">감지기·CCTV가 없습니다.</p>
        <ul v-else class="plain">
          <li v-for="k in kindSummary.points" :key="k.label">
            {{ k.label }} <b class="mono">{{ k.count }}</b>
            <span class="muted"> · 소속 방 {{ k.located }}</span>
          </li>
        </ul>
        <p class="hint">위치와 소속 방은 있습니다. 관제점 ID는 BAS에서 받아 연결해야 합니다.</p>
        <h4>방 종류</h4>
        <p class="muted">
          {{ kindSummary.roomsTotal }}개 중 {{ kindSummary.roomsKnown }}개를 분류했습니다<template v-if="kindSummary.roomsKnown">
            (OmniClass로 {{ kindSummary.roomsFromBim }}개 <Src kind="bim" />, 이름으로 {{ kindSummary.roomsKnown - kindSummary.roomsFromBim }}개 <Src kind="dict" />)</template>.
        </p>
        <ul class="plain">
          <li v-for="[label, n] in kindSummary.rooms" :key="label">{{ label }} <b class="mono">{{ n }}</b></li>
        </ul>
        <h4>계통 종류</h4>
        <ul class="plain">
          <li v-for="[label, n] in kindSummary.systems" :key="label">{{ label }} <b class="mono">{{ n }}</b></li>
        </ul>
        <p v-if="ruleReport && ruleReport.agree + ruleReport.disagree > 0" class="hint">
          규칙으로 방향을 정한 연결 {{ ruleReport.oriented }}개. 포트 방향이 있는 연결 {{ ruleReport.agree + ruleReport.disagree }}개로 검증하면
          {{ Math.round((ruleReport.agree / (ruleReport.agree + ruleReport.disagree)) * 100) }}% 일치합니다(일치 {{ ruleReport.agree }} · 불일치
          {{ ruleReport.disagree }} · 추정 불가 {{ ruleReport.unestimated }}).
        </p>
        <p v-else-if="ruleReport && ruleReport.oriented > 0" class="hint">
          규칙으로 방향을 정한 연결 {{ ruleReport.oriented }}개. 포트 방향과 견줄 연결이 없어 일치율은 비교 불가입니다.
        </p>
        <p v-if="ruleReport?.recheck" class="hint recheck" data-testid="rule-recheck-total">
          확정한 뒤 근거가 바뀐 규칙 방향 {{ ruleReport.recheck }}개가 재검토 중입니다. 다시 확정하기 전에는 brick:feeds 로 내보내지 않습니다.
        </p>
      </div>
    </div>
  </Fold>
</template>
