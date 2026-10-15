<script setup lang="ts">
import type { PropType } from 'vue'
import { mediaLabel } from '../../lib/connect-candidates'
import { checkCode, issueText, issueTitle } from '../../lib/issue-code'
import { ASSIGN_SNAP_RANGE } from '../../lib/mapping'
import { vFlash } from '../../lib/motion'
import { replayMemo } from '../../lib/replay-player'
import { selectAndShow } from '../../editor/chat-view'
import { applyFix, CHECK_LIMIT, checksEmpty, checksMeasured, connectCandidate, failReasons, fixCandidates, fixLabel, fixOpen, openCheck, openCheckKey, toggleCheck, whatIs } from '../../editor/checks'
import { nameOfId } from '../../editor/connections'
import { vKeepTyping } from '../../editor/edit-filter'
import { shortName } from '../../editor/equipment-shape'
import { equipmentById, hasRules, showRules } from '../../editor/flow-rules'
import { assignSnap, changeAssignSnap } from '../../editor/read-settings'
import Fold from '../Fold.vue'
import Meter from '../Meter.vue'
import Roll from '../Roll.vue'
import Src from '../Src.vue'
import type { checks as checksRef } from '../../editor/checks'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  checks: { type: null as unknown as PropType<NonNullable<typeof checksRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()"
    title="완전성 검사"
    :meta="`규칙 ${checks.length}개 · 전부 통과 ${checks.filter((c) => !c.skipped && c.total > 0 && c.failed.length === 0).length}개`"
    class="checks"
  >
    <p class="hint">
      DT에서 쓰려면 연결돼 있어야 하는 것을 규칙별로 검사합니다. 원천·말단 구분은 <Src kind="dict" />, 흐름과 소속에는
      <Src kind="calc" /> 추정이 섞여 있습니다<template v-if="showRules && hasRules">(규칙 방향 포함)</template>. 줄을 누르면 위반한 것이
      3D에 표시되고, <kbd>N</kbd>으로 하나씩 넘어갑니다.
    </p>
    <p class="hint assign-snap">
      <label>
        소속 허용 거리(사이트 설정)
        <input
          type="number"
          step="0.01"
          :min="ASSIGN_SNAP_RANGE.min"
          :max="ASSIGN_SNAP_RANGE.max"
          class="riser-height"
          data-testid="assign-snap"
          v-keep-typing
          :value="assignSnap"
          @change="changeAssignSnap(($event.target as HTMLInputElement).value); ($event.target as HTMLInputElement).value = String(assignSnap)"
        />
        m
      </label>
      — 외곽선 밖이어도 이만큼 안이면 가장 가까운 물리존에 붙입니다. 승강로 안의 설비는 붙이지 않습니다(사람이 정합니다).
    </p>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>규칙</th>
          <th class="num">통과</th>
          <th class="num">위반</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="c in checksMeasured"
          :key="c.key"
          v-flash="c.failed.length"
          :class="{ chosen: openCheckKey === c.key, skipped: !!c.skipped }"
          @click="!c.skipped && c.failed.length && toggleCheck(c.key)"
        >
          <td class="state">
            <i :class="c.skipped || c.total === 0 ? 'none' : c.failed.length ? 'warn' : 'ok'"></i>
          </td>
          <td>
            <span v-if="checkCode(c.key)" class="issue-code" :data-class="checkCode(c.key)!.cls" :title="issueTitle(checkCode(c.key)!)">{{ issueText(checkCode(c.key)!) }}</span>
            {{ c.rule }}
            <small class="muted">{{ c.skipped ?? (c.total === 0 ? '이 파일에는 검사할 대상이 없습니다.' : `영향: ${c.why}`) }}</small>
          </td>
          <td class="num mono">
            <template v-if="!c.skipped && c.total">
              <Roll :value="c.total - c.failed.length" /> / {{ c.total }}
              <Meter
                :parts="[{ value: (c.total - c.failed.length) / c.total, tone: c.failed.length ? 'warn' : 'ok' }]"
                :label="`통과 ${c.total - c.failed.length} / ${c.total}`"
              />
            </template>
            <span v-else class="muted">—</span>
          </td>
          <td class="num">
            <button
              v-if="!c.skipped && c.failed.length"
              type="button"
              class="link mono"
              :aria-pressed="openCheckKey === c.key"
            >
              <Roll :value="c.failed.length" :count-up="false" />
            </button>
            <span v-else class="muted">{{ c.skipped ? '—' : 0 }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <!-- 이 파일에 잴 대상이 없는 규칙(열원·스프링클러가 없는 건축 파일 등). 표에 "검사할 대상이 없습니다" 줄이 열 줄씩 이어져 위반을 가렸다. -->
    <details v-if="checksEmpty.length" class="checks-empty" data-testid="checks-empty">
      <summary>이 파일에 검사할 대상이 없는 규칙 {{ checksEmpty.length }}개</summary>
      <ul class="plain">
        <li v-for="c in checksEmpty" :key="c.key">
          <span v-if="checkCode(c.key)" class="issue-code" :data-class="checkCode(c.key)!.cls" :title="issueTitle(checkCode(c.key)!)">{{ issueText(checkCode(c.key)!) }}</span>
          {{ c.rule }}
        </li>
      </ul>
    </details>
    <div v-if="openCheck && openCheck.failed.length" class="check-list">
      <h4>{{ openCheck.rule }} <span class="muted">위반 {{ openCheck.failed.length }}개(3D에 표시)</span></h4>
      <ul class="plain">
        <li v-for="id in openCheck.failed.slice(0, CHECK_LIMIT)" :key="id">
          <button type="button" class="link" :title="equipmentById.get(id)?.name" @click="selectAndShow(id)">
            {{ shortName(equipmentById.get(id)?.name || equipmentById.get(id)?.ifcClass || id) }}
          </button>
          <span v-if="whatIs(equipmentById.get(id))" class="what">{{ whatIs(equipmentById.get(id))!.label }}</span>
          <div v-if="failReasons.get(id)?.text" class="muted reason">
            {{ failReasons.get(id)!.text }}
            <button
              v-if="failReasons.get(id)!.fix"
              type="button"
              class="ghost fix"
              :aria-expanded="failReasons.get(id)!.fix!.kind === 'connect' ? fixOpen === id : undefined"
              @click="applyFix(id, failReasons.get(id)!.fix!)"
            >
              {{ fixLabel(failReasons.get(id)!.fix!) }}
            </button>
          </div>
          <!-- 연결 후보(OE-PIP-08). 잇으면 출처는 직접 이음(manual)이고 방향은 정하지 않은 채다. -->
          <ul v-if="fixOpen === id" class="plain fix-candidates" data-testid="fix-candidates">
            <li v-for="c in fixCandidates" :key="c.id">
              <b>{{ nameOfId(c.id) }}</b>
              <span class="muted"> · {{ Math.round(c.distance * 1000) }}mm · {{ c.system ?? '계통 없음' }} · {{ mediaLabel(c.media) }}</span>
              <button type="button" class="ghost" data-testid="fix-connect" @click="connectCandidate(id, c.id)">연결하기</button>
            </li>
            <li class="muted">연결하면 출처는 수동 연결, 방향은 정하지 않은 채입니다. 규칙 방향은 확정 전까지 추정으로만 보입니다.</li>
          </ul>
        </li>
      </ul>
      <p v-if="openCheck.failed.length > CHECK_LIMIT" class="hint">
        {{ CHECK_LIMIT }}개만 표시합니다(전체 {{ openCheck.failed.length }}개). 3D에는 모두 표시했습니다.
      </p>
    </div>
  </Fold>
</template>
