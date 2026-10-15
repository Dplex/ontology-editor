<script setup lang="ts">
import { CONNECTION_CLASS_LABEL, connectionClass } from '../../lib/connection-class'
import { againstRule } from '../../lib/connection-release'
import { replayMemo } from '../../lib/replay-player'
import { flowEditLines } from '../../editor/checks'
import { connectFrom, disconnect, logTime, openRelease, releaseDraft, releaseReason, selectedReleases, settleRelease, startConnect, submitRelease } from '../../editor/connections'
import { editing } from '../../editor/core'
import { detailOpen, flowMap, flowSystemKey, foldDetail, kindsText, routeView, systemRows, toggleFlowSystem } from '../../editor/flow-map'
import { activeArrow, clearManualFlow, confirmRule, deviceCount, flowDraft, flowLabel, flowReason, flowText, hasRules, otherFloor, previewFlow, relClass, relLabel, selectedFlowBasis, selectedId, selectedNeighbors, selectedRule, showRules, submitFlow, tracedRules } from '../../editor/flow-rules'
import { sourceLabel } from '../../editor/kinds'
import { select } from '../../editor/systems'
import FlowBasis from '../FlowBasis.vue'
import Src from '../Src.vue'
</script>

<template>
  <component v-memo="replayMemo()" :is="foldDetail ? 'details' : 'div'" :class="foldDetail ? 'picked-more' : 'picked-more-flat'" :open="foldDetail ? detailOpen : undefined" data-testid="picked-more" @toggle="foldDetail && (detailOpen = ($event.target as HTMLDetailsElement).open)">
  <summary v-if="foldDetail" class="picked-sub">
    연결·방향 자세히 <span class="muted">직접 연결 {{ selectedNeighbors.length }} · 방향 근거 · 경로</span>
  </summary>
  <!-- 규칙 방향. 위 숫자는 BIM 포트가 말한 것만이고, 여기부터가 계통·설비 종류로 정한 것이다. -->
  <div v-if="tracedRules" class="rule-box">
    <p>
      <Src kind="dict" /> 규칙 방향<template v-if="flowEditLines.length">과 <Src kind="edit" /> 직접 정한 방향</template>까지
      포함하면 상류 <b>{{ tracedRules.upstream.size }}</b> · 하류 <b>{{ tracedRules.downstream.size }}</b> ·
      방향 모름 <b>{{ tracedRules.linked.size }}</b>
      <template v-if="tracedRules.linked.size">(그중 기기 {{ deviceCount(tracedRules.linked) }})</template>
      <label v-if="!foldDetail" class="rule-toggle">
        <input v-model="showRules" type="checkbox" />
        3D에 규칙 방향 표시
      </label>
    </p>
    <!-- 흐름 방향의 근거(flow-cascade.ts). 이 계통의 연결이 방향을 어디서 얻었고, 그래서 TTL 에 brick:feeds 로 몇 개가 나가는지. -->
    <FlowBasis v-if="selectedFlowBasis && selectedRule" :basis="selectedFlowBasis" :name="selectedRule.name" />
    <p v-if="selectedRule" class="rule-system">
      <b>{{ selectedRule.name }}</b><template v-if="selectedRule.kind">({{ selectedRule.kind }})</template>: 규칙으로 방향을 정한 연결
      {{ selectedRule.count }}개.
      <template v-if="selectedRule.pct !== null">
        포트 방향이 있는 연결 {{ selectedRule.checked }}개로 검증하면
        <b :class="{ low: selectedRule.pct < 80 }">{{ selectedRule.pct }}%</b> 일치합니다(일치 {{ selectedRule.agree }} · 불일치
        {{ selectedRule.disagree }} · 추정 불가 {{ selectedRule.unestimated }}).
      </template>
      <template v-else> 포트 방향과 견줄 연결이 없어 일치율은 비교 불가입니다<template v-if="selectedRule.unestimated">(추정 불가 {{ selectedRule.unestimated }})</template>.</template>
      <span v-if="selectedRule.recheck" class="edit-notice inline recheck" data-testid="rule-recheck">
        확정한 뒤 근거가 바뀐 규칙 방향 {{ selectedRule.recheck }}개는 재검토 중이라 brick:feeds 로 내보내지 않습니다.
      </span>
      <span v-if="selectedRule.confirmed" class="confirmed">확정했습니다. brick:feeds로 내보냅니다.</span>
      <button
        v-else-if="editing"
        type="button"
        class="ghost"
        :disabled="selectedRule.count === 0"
        data-testid="rule-confirm"
        @click="confirmRule(selectedRule.systemId, selectedRule.name)"
      >
        {{ selectedRule.recheck ? '이 계통 방향 다시 확정' : '이 계통 방향 확정' }}
      </button>
      <span v-else class="muted"> 확정은 편집 모드에서 할 수 있습니다.</span>
    </p>
    <p v-if="selectedRule && selectedRule.pct !== null && selectedRule.pct < 80" class="hint">
      일치율이 낮습니다. 확정하기 전에 3D에서 흐름을 확인하세요.
    </p>
  </div>

  <!-- 바로 붙은 연결. 편집 모드에서 방향을 정하는 자리라 계통·담당 공간(길어질 수 있다)보다 앞에 둔다.
       맨 아래에 두었더니 병원 공조기에서 담당 방 150줄 아래로 묻혔다. -->
  <h4 class="picked-sub">
    직접 연결 <span class="muted">{{ selectedNeighbors.length }}</span>
    <button
      v-if="editing"
      type="button"
      :class="['ghost', 'connect', { on: connectFrom }]"
      :aria-pressed="!!connectFrom"
      @click="connectFrom ? (connectFrom = null) : startConnect()"
    >
      {{ connectFrom ? '연결하기 취소' : '연결하기' }}
    </button>
  </h4>
  <p v-if="connectFrom" class="edit-notice inline">연결할 설비를 3D나 목록에서 고르세요. <kbd>Esc</kbd>로 취소합니다.</p>
  <p v-if="selectedNeighbors.length === 0" class="hint">
    이 설비에 연결된 것이 없습니다.
  </p>
  <table v-else class="neighbors">
    <tbody>
      <tr v-for="(n, i) in selectedNeighbors" :key="`${n.id}-${i}`" :class="{ active: editing && i === activeArrow }">
        <td :class="['rel', ...relClass(n)]">{{ relLabel(n) }}</td>
        <td class="name-cell">
          <button type="button" class="link" @click="select(n.id)">{{ n.name }}</button>
          <span v-if="n.what" class="what">{{ n.what.label }} <Src :kind="n.what.src" /></span>
          <!-- 출처는 이름 아래 한 줄. 글과 출처 꼬리표가 따로 꺾이지 않게 한 덩어리씩 묶는다. -->
          <div class="muted src-cell">
            <span v-if="n.source === 'port'" data-testid="neighbor-source">{{ CONNECTION_CLASS_LABEL[connectionClass(n.connection)] }} <Src kind="bim" /></span>
            <span v-else-if="n.source === 'manual'">수동 연결 <Src kind="edit" /></span>
            <span v-else>{{ sourceLabel(n.tolerance) }} <Src kind="calc" /></span>
            <span v-if="n.edited">직접 정한 방향 <Src kind="edit" /></span>
            <span v-else-if="n.rule">{{ n.rule.recheck ? '규칙 방향(확정 · 재검토, 내보내지 않음)' : n.rule.confirmed ? '규칙 방향(확정)' : '규칙 방향(추정)' }} <Src kind="dict" /></span>
            <!-- 한 층만 보는 중이면 다른 층 것은 3D 에 없고 화살표도 안 그린다(OE-UI-12). 왜 안 보이는지 적는다. -->
            <span v-if="otherFloor(n.id)" class="other-floor">다른 층({{ otherFloor(n.id) }}) — 3D에 안 보임</span>
            <!-- 유체 흐름이 아닌 BIM·사람 연결(OE-PIP-18). 지우지 않고 검토 대상으로 둔다. 공급 관계(brick:feeds)로는 나가지 않는다. -->
            <span v-if="n.review" class="flow-review" data-testid="flow-review" :title="n.review">검토 — 흐름 아님, feeds 제외</span>
          </div>
          <!-- 방향 버튼은 이름 아래 줄에 둔다. 좁은 패널에서 네 번째 칸으로 두었더니 이름이 한 글자씩 꺾이고 버튼이 잘렸다.
               포트가 방향을 말한 연결은 고칠 수 없다. BIM 이 말한 것을 덮어쓰지 않는다. -->
          <div v-if="editing && !n.connection.directed" class="flow-edit">
            <!-- 'A → B' 를 누르면 미리보기다(OE-PIP-04). [적용] 해야 연결에 남는다. -->
            <button
              type="button"
              class="ghost"
              data-testid="flow-out"
              :aria-pressed="flowDraft?.connection === n.connection ? flowDraft.from === selectedId : n.edited === 'downstream'"
              :title="`이 설비 → ${n.name} (미리보기)`"
              @click="previewFlow(n.connection, selectedId)"
            >
              {{ flowLabel(selectedId ?? '') }} → {{ flowLabel(n.id) }}
            </button>
            <button
              type="button"
              class="ghost"
              data-testid="flow-in"
              :aria-pressed="flowDraft?.connection === n.connection ? flowDraft.from === n.id : n.edited === 'upstream'"
              :title="`${n.name} → 이 설비 (미리보기)`"
              @click="previewFlow(n.connection, n.id)"
            >
              {{ flowLabel(n.id) }} → {{ flowLabel(selectedId ?? '') }}
            </button>
            <!-- 자리는 늘 잡아 둔다. 누를 때 생기면 옆 버튼이 밀려 마우스 아래로 다른 버튼이 온다. -->
            <button
              type="button"
              :class="['ghost', { hidden: !n.edited }]"
              :disabled="!n.edited"
              data-testid="flow-clear"
              title="직접 정한 방향을 지워 규칙 방향(있으면)이나 방향 미지정으로 돌아갑니다"
              @click="clearManualFlow(n.connection)"
            >
              수동 지정 해제
            </button>
            <button v-if="n.source !== 'port'" type="button" class="ghost cut" title="이 연결을 끊습니다" @click="disconnect(n.connection)">연결 끊기</button>
          </div>
          <form v-if="flowDraft?.connection === n.connection" class="flow-preview" data-testid="flow-preview" @submit.prevent="submitFlow">
            <p>미리보기 <b>{{ flowText(n.connection, flowDraft.from) }}</b> · 적용 전이라 TTL에 나가지 않습니다</p>
            <template v-if="n.connection.inferred && againstRule(n.connection, flowDraft.from)">
              <p class="edit-notice inline">
                규칙 방향({{ n.connection.inferred.confirmed ? '확정' : '추정' }}) {{ flowText(n.connection, n.connection.inferred.from) }}과 반대입니다. 보정 사유를 적어 주세요
              </p>
              <input v-model="flowReason" type="text" data-testid="flow-reason" placeholder="보정 사유 (예: 현장 확인 결과 반대로 흐름)" />
            </template>
            <div class="flow-edit">
              <button type="submit" class="ghost" data-testid="flow-apply">적용</button>
              <button type="button" class="ghost" @click="flowDraft = null">취소</button>
            </div>
          </form>
          <div v-else-if="n.connection.edited?.at" class="release-why">
            직접 정한 방향 · {{ logTime(n.connection.edited.at) }}<template v-if="n.connection.edited.reason"> · 사유: {{ n.connection.edited.reason }}</template>
          </div>
          <!-- BIM 포트 연결은 끊지 않고 해제 보정한다(OE-PIP-06). 원본은 남고 온톨로지의 유효 연결에서만 빠진다. -->
          <div v-if="editing && n.source === 'port' && releaseDraft?.connection !== n.connection" class="flow-edit">
            <button type="button" class="ghost cut" data-testid="release-connection" title="BIM 원본은 두고 이 연결을 규칙 방향·계통 추적·TTL feeds 에서 뺍니다" @click="openRelease(n.connection, 'release')">연결 해제 보정</button>
          </div>
          <form v-if="releaseDraft?.connection === n.connection" class="release-form" @submit.prevent="submitRelease">
            <input v-model="releaseReason" type="text" data-testid="release-reason" :placeholder="releaseDraft.mode === 'release' ? '해제 사유 (예: 현장에서 철거)' : '취소 사유 (예: 철거 계획 철회)'" />
            <button type="submit" class="ghost" data-testid="release-submit">{{ releaseDraft.mode === 'release' ? '해제' : '해제 취소' }}</button>
            <button type="button" class="ghost" @click="releaseDraft = null">닫기</button>
          </form>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 해제 보정한 BIM 연결. 원본은 남아 있어 비활성으로 보이고, 취소하면 원본 방향 그대로 위 표로 돌아간다. -->
  <template v-if="selectedReleases.length">
    <h4 class="picked-sub">해제한 연결 <span class="muted">{{ selectedReleases.length }}</span></h4>
    <table class="neighbors released" data-testid="released-connections">
      <tbody>
        <tr v-for="(r, i) in selectedReleases" :key="`released-${r.id}-${i}`">
          <td class="rel released-rel">해제</td>
          <td class="name-cell">
            <button type="button" class="link" @click="select(r.id)">{{ r.name }}</button>
            <div class="muted src-cell">
              <span>포트 <Src kind="bim" /></span>
              <span v-if="r.relation">원본 방향 {{ r.relation === 'upstream' ? '상류' : '하류' }}</span>
              <span>해제 보정 <Src kind="edit" /></span>
            </div>
            <div class="release-why">{{ logTime(r.entry.at) }} · {{ r.entry.reason }}</div>
            <p v-if="r.entry.review" class="edit-notice inline" data-testid="release-review">
              {{
                        r.entry.review === 'direction'
                          ? '다시 연 판본에서 이 연결의 방향이 바뀌었습니다. 해제를 유지할지 취소할지 정해 주세요. 정하기 전에는 TTL에 나가지 않습니다'
                          : '다시 연 판본에 이 연결이 없습니다. 보정을 지우면 이력만 남습니다'
                      }}
            </p>
            <div v-if="editing && releaseDraft?.connection !== r.entry.connection" class="flow-edit">
              <button v-if="r.entry.review !== 'missing'" type="button" class="ghost" data-testid="release-cancel" @click="openRelease(r.entry.connection, 'restore')">해제 취소</button>
              <button v-if="r.entry.review === 'direction'" type="button" class="ghost" data-testid="release-keep" @click="settleRelease(r.entry.connection, 'keep')">해제 유지</button>
              <button v-if="r.entry.review === 'missing'" type="button" class="ghost" data-testid="release-drop" @click="settleRelease(r.entry.connection, 'drop')">보정 지우기</button>
            </div>
            <form v-if="releaseDraft?.connection === r.entry.connection" class="release-form" @submit.prevent="submitRelease">
              <input v-model="releaseReason" type="text" data-testid="release-reason" :placeholder="releaseDraft.mode === 'release' ? '해제 사유 (예: 현장에서 철거)' : '취소 사유 (예: 철거 계획 철회)'" />
              <button type="submit" class="ghost" data-testid="release-submit">{{ releaseDraft.mode === 'release' ? '해제' : '해제 취소' }}</button>
              <button type="button" class="ghost" @click="releaseDraft = null">닫기</button>
            </form>
          </td>
        </tr>
      </tbody>
    </table>
  </template>

  <!-- 계통별로 보기. 한 기기에 물·바람·배수가 같이 붙으므로 계통마다 나눠 센다. 패널이 좁아 표가 아니라
       줄마다 두세 줄짜리 목록이다 — 일곱 칸 표는 오른쪽 넷(방향 모름·덕트·이어진 기기)이 잘렸다. -->
  <div v-if="systemRows.length && !flowMap" class="by-system">
    <h4 class="picked-sub">
      계통별로 보기 <Src kind="bim" />
      <span class="muted">
        기기 대수입니다<template v-if="showRules && hasRules">(규칙 방향 포함 <Src kind="dict" />)</template>. 방향을 모르는 연결은 다음 기기까지만
        셉니다. 누르면 3D에 그 계통만 보입니다.
      </span>
    </h4>
    <ul class="sys-list">
      <li v-for="r in systemRows" :key="r.key" :class="{ chosen: flowSystemKey === r.key }">
        <button type="button" :aria-pressed="flowSystemKey === r.key" @click="toggleFlowSystem(r.key)">
          <span class="sys">
            <i :style="{ background: r.color ?? 'transparent' }"></i>
            <span class="sys-name">{{ r.name }}</span>
            <span :class="['sys-kind', { muted: !r.kind }]">{{ r.kind ?? '종류 모름' }}<Src v-if="r.kind" kind="dict" /></span>
          </span>
          <span class="sys-counts">
            <span v-if="r.up" class="upstream">상류 <b>{{ r.up }}</b></span>
            <span v-if="r.down" class="downstream">하류 <b>{{ r.down }}</b></span>
            <span v-if="r.unknown" class="linked">방향 모름 <b>{{ r.unknown }}</b></span>
            <span v-if="r.conduits" class="muted">덕트·배관 {{ r.conduits }}</span>
          </span>
          <span class="sys-kinds" :title="r.kinds.map(([l, n]) => `${l} ${n}`).join(', ')">
            <template v-if="r.kinds.length">{{ kindsText(r.kinds) }}</template>
            <!-- Revit 은 급기 계통을 가지마다 쪼개서, 관이 다른 계통으로 이어질 수 있다. 끊겼다고 단정하지 않는다. -->
            <span v-else class="muted">이 계통에 연결된 기기 없음</span>
          </span>
        </button>
      </li>
    </ul>
  </div>

  <!-- 흐름 경로(OE-ML-16). 방향을 아는 연결만 따라 닿은 원천·말단과 그 길. 원천이 여럿이면 다 보이고, 고리가 있으면 알린다.
       기기를 고르면 위 흐름 지도가 먼저 답하므로 접어 둔다. 계통을 섞어 가까운 순으로 늘어놓아, 병원 공조기는 환기 그릴 여섯 줄과
       "원천 외 177개" 가 먼저 보였다. 대체 경로·순환을 볼 때 편다. -->
  <details v-if="routeView" class="trace-routes" data-testid="trace-routes" :open="!flowMap">
    <summary class="picked-sub">
      {{ flowMap ? '경로 자세히' : '흐름 경로' }}
      <span class="muted">
        <template v-if="flowMap">원천 {{ routeView.sources.length + routeView.moreSources }} · 도달 {{ routeView.targets.length + routeView.moreTargets }}<template v-if="routeView.cycle.length"> · 순환 있음</template>. </template>
        확정한 방향만 따라갑니다<template v-if="routeView.preview">(지금은 확정 전 규칙 방향 미리보기 포함 <Src kind="dict" />)</template>. 원천이 여럿이면 모두
        보이고, 대체 경로는 갈래 수로 적습니다.
      </span>
    </summary>
    <p v-if="routeView.cycle.length" class="edit-notice inline" data-testid="trace-cycle">
      순환이 있습니다: {{ routeView.cycle.join(', ') }}<template v-if="routeView.moreCycle"> 외 {{ routeView.moreCycle }}개</template>. 한 번 지난 곳은 다시 따라가지 않아
      추적이 끝납니다.
    </p>
    <ul class="route-list">
      <li v-for="r in routeView.sources" :key="`up-${r.id}`" data-kind="source">
        <span class="upstream">원천</span> <button type="button" class="link" @click="select(r.id)">{{ r.name }}</button> <span class="muted">{{ r.detail }}</span>
      </li>
      <li v-if="routeView.moreSources" class="muted">원천 외 {{ routeView.moreSources }}개</li>
      <li v-for="r in routeView.targets" :key="`down-${r.id}`" data-kind="target">
        <span class="downstream">도달</span> <button type="button" class="link" @click="select(r.id)">{{ r.name }}</button> <span class="muted">{{ r.detail }}</span>
      </li>
      <li v-if="routeView.moreTargets" class="muted">도달 외 {{ routeView.moreTargets }}개</li>
      <li v-for="r in routeView.looped" :key="`loop-${r.id}`" data-kind="looped" title="위로도 아래로도 닿아 원천·말단으로 정하지 않습니다">
        <span class="linked">순환 위</span> <button type="button" class="link" @click="select(r.id)">{{ r.name }}</button> <span class="muted">{{ r.detail }}</span>
      </li>
      <li v-if="routeView.moreLooped" class="muted">순환 위 외 {{ routeView.moreLooped }}개</li>
    </ul>
  </details>
  </component>
</template>
