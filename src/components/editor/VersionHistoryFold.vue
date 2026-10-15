<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { activity, ACTIVITY_LABEL } from '../../editor/publish'
import { openReport, reportView, rollbackAsk, rollbackFromReport, rollbackLayout, versionFileUrl, versionTime } from '../../editor/reports'
import Fold from '../Fold.vue'
import type { layoutState as layoutStateRef } from '../../editor/publish'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  layoutState: { type: null as unknown as PropType<NonNullable<typeof layoutStateRef.value>>, required: true },
})
</script>

<template>
  <Fold v-memo="replayMemo()" title="버전 히스토리" :meta="`지금 v${layoutState.current}`" class="versions" data-testid="versions">
    <table class="versions-table">
      <thead>
        <tr><th>버전</th><th>반영</th><th>반영자</th><th>대상 층</th><th>바뀐 것</th><th>파일</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="v in layoutState.versions" :key="v.version" :class="{ current: v.version === layoutState.current, 'rollback-ask': rollbackAsk === v.version }">
          <td><b>v{{ v.version }}</b> <span v-if="v.version === layoutState.current" class="muted">지금</span></td>
          <td>{{ versionTime(v.at) }}{{ v.kind === 'rollback' ? ` · v${v.from} 되돌리기` : '' }}</td>
          <td>{{ v.by }}</td>
          <td>{{ v.floors.join(' · ') }}</td>
          <td>{{ v.summary.edits ?? 0 }}건</td>
          <td class="version-files">
            <a v-for="f in v.files" :key="f" :href="versionFileUrl(v.version, f)" :download="f.split('/').at(-1)" class="link">{{ f.replace('geojson/', '') }}</a>
          </td>
          <td>
            <button type="button" class="ghost" @click="openReport(v.version)">리포트</button>
            <template v-if="v.version !== layoutState.current">
              <template v-if="rollbackAsk === v.version">
                <button type="button" class="ghost danger" @click="rollbackLayout(v.version)">v{{ v.version }} 다시 반영</button>
                <button type="button" class="ghost" @click="rollbackAsk = null">취소</button>
              </template>
              <button v-else type="button" class="ghost" @click="rollbackAsk = v.version">되돌리기</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <!-- 반영 결과 리포트(OE-SYNC-04~06)와 그 버전의 공간 계층(OE-SYNC-03, 탐색기 트리 대신). -->
    <div v-if="reportView" class="version-report" data-testid="version-report">
      <div class="version-report-head">
        <h4>v{{ reportView.version }} 반영 결과 리포트</h4>
        <button v-if="reportView.prev" type="button" class="ghost" @click="rollbackFromReport">되돌리기 (v{{ reportView.prev }})</button>
        <button type="button" class="ghost" @click="reportView = null">닫기</button>
      </div>
      <p class="hint">BIM 을 연 때와 견준 누적입니다. <b class="fresh-tag">새로</b> 는 직전 버전{{ reportView.prev ? ` v${reportView.prev}` : '' }}에 없던 줄입니다.</p>
      <section v-for="sec in reportView.sections" :key="sec.kind" class="report-section" :data-kind="sec.kind">
        <h5>{{ sec.label }} <span class="muted">{{ sec.lines.length || '없음' }}</span></h5>
        <ul v-if="sec.lines.length">
          <li v-for="(l, i) in sec.lines" :key="i"><b v-if="reportView.fresh.has(l)" class="fresh-tag">새로</b> {{ l }}</li>
        </ul>
      </section>
      <details v-if="reportView.tree" class="space-tree" data-testid="space-tree">
        <summary>공간 계층 — {{ reportView.tree.site || '(사이트)' }} › {{ reportView.tree.building.name || '(건물)' }} · {{ reportView.tree.storeys.length }}개 층</summary>
        <ul>
          <li v-for="st in reportView.tree.storeys" :key="st.id">
            <b>{{ st.name }}</b> <span class="muted">{{ st.spaces.length }}개</span> — {{ st.spaces.map((sp) => sp.longName || sp.name).join(', ') }}
          </li>
        </ul>
      </details>
    </div>
    <details v-if="activity.length" class="activity" data-testid="activity">
      <summary>최근 기록 {{ activity.length }}줄 (시스템 로그)</summary>
      <ul>
        <li v-for="(a, i) in activity" :key="i">{{ versionTime(a.at) }} · {{ ACTIVITY_LABEL[a.type] ?? a.type }}{{ a.version ? ` v${a.version}` : '' }} · {{ a.user }}{{ a.floors.length ? ` · ${a.floors.join(' · ')}` : '' }}</li>
      </ul>
    </details>
    <p class="hint">최근 {{ 7 }}일의 반영만 보입니다. 지난 버전은 파일만 서버에 남습니다. 되돌리기는 그 버전을 새 버전으로 다시 반영하고, 지금 화면의 편집은 그대로 둡니다.</p>
  </Fold>
</template>
