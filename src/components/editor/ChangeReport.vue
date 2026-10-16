<script setup lang="ts">
import type { PropType } from 'vue'
import { josa } from '../../lib/josa'
import { replayMemo } from '../../lib/replay-player'
import { VERTICAL_KIND_LABEL } from '../../lib/vertical-object'
import { changeCount, MOVED_NAMES, sinceOpen } from '../../editor/changes'
import { flowEditLines } from '../../editor/checks'
import { logTime, nameOfId, RELEASE_ACTION, releaseLines, releaseLog } from '../../editor/connections'
import { areaSummary, report, reportPlace, spaceNameOf } from '../../editor/edit-report'
import { elementLabel } from '../../editor/facade'
import { confirmations } from '../../editor/flow-rules'
import { history } from '../../editor/history'
import { assignLines, kindEditLines } from '../../editor/kinds'
import { replay } from '../../editor/labels'
import { areaChanges } from '../../editor/multi-select'
import { reportZoneChecks } from '../../editor/offset'
import { editFileNote } from '../../editor/progress'
import { roomLines } from '../../editor/rooms'
import { bimObjectLines, objectLines } from '../../editor/space-objects'
import { spaceKindLines, storeyNameLines } from '../../editor/storey-name'
import { systemKindText, systemNameOf } from '../../editor/systems'
import type { model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <div v-memo="replayMemo()" class="changes-head">
    <h3 id="changes">바뀐 내용</h3>
    <!-- 리플레이(P)를 단추로도 연다. 편집 막대는 1280 폭에서 이미 꽉 차서(단추 하나에 [편집 종료] 가 잘렸다) 바뀐 내용 머리에 둔다. -->
    <button
      type="button"
      class="ghost replay-open-btn"
      :disabled="!history.length"
      :title="history.length ? '이번 세션의 편집을 고친 순서대로 3D 에서 다시 봅니다 (P)' : '편집한 것이 있어야 다시 볼 수 있습니다 (P)'"
      @click="replay.open()"
    >
      ▶ 리플레이 <kbd>P</kbd>
    </button>
    <!-- [편집 저장] 은 헤더, [편집 불러오기] 는 헤더의 [파일 ▾] 에 있다. 기준 · 검증 패널은 보기만 한다. -->
  </div>
  <p v-memo="replayMemo()" v-if="editFileNote" class="hint edit-file-note" role="status">{{ editFileNote }}</p>
  <ul v-memo="replayMemo()" v-if="changeCount > 0 || areaChanges.length" class="report">
    <li v-for="c in report" :key="c.equipmentId" :data-kind="c.toSpaceId ? 'move' : 'unassigned'">
      {{ c.equipmentName }}:
      <b>{{ reportPlace(c.fromSpaceId, c.equipmentId) }}</b> → <b>{{ reportPlace(c.toSpaceId, c.equipmentId) }}</b>
    </li>
    <!-- 사람의 소속 지정(K17). 해제된 것도 조용히 바꾸지 않고 까닭과 함께 보인다. -->
    <li v-for="r in assignLines" :key="`assign-${r.id}`" :data-kind="r.released ? 'release' : 'move'">
      <template v-if="r.released">사람 지정 해제: <b>{{ r.name }}</b> {{ spaceNameOf(r.from) }} → {{ spaceNameOf(r.to) }}({{ r.reason }})</template>
      <template v-else>설비 <b>{{ r.name }}</b>의 소속을 {{ spaceNameOf(r.from) }}(으)로 정했습니다 (TTL hasLocation · GeoJSON spaceSource edit)</template>
    </li>
    <li v-if="areaSummary" class="muted" data-kind="space">{{ areaSummary }}</li>
    <li v-for="(c, i) in confirmations" :key="`rule-${i}`" data-kind="pipe">
      계통 <b>{{ c.systemName }}</b>: 규칙 방향 {{ c.count }}개 확정 (brick:feeds)
    </li>
    <li v-for="(f, i) in flowEditLines" :key="`flow-${i}`" data-kind="pipe">
      <b>{{ f.from }}</b> → <b>{{ f.to }}</b>: 방향 직접 지정 ({{ f.note }}, brick:feeds)
    </li>
    <li v-for="k in storeyNameLines" :key="`storey-name-${k.id}`" data-testid="storey-name-line">
      층 이름 {{ k.from }} → <b>{{ k.to }}</b> (rdfs:label · GeoJSON 층 파일)
    </li>
    <li v-for="k in spaceKindLines" :key="`room-kind-${k.key}`">
      공간명 <b>{{ k.name }}</b> {{ k.count }}개: 방 종류 {{ k.from }} → <b>{{ k.to }}</b> (Brick 클래스)
    </li>
    <li v-for="k in kindEditLines" :key="`kind-${k.key}`">
      <b>{{ k.label }}</b><template v-if="k.types > 1">(유형 {{ k.types }}개)</template> {{ k.count }}대: 종류 {{ k.from }} → <b>{{ k.to }}</b> (Brick 클래스)
    </li>
    <li v-for="r in sinceOpen.restoreyed" :key="`storey-${r.id}`">
      {{ r.name }}: 층 <b>{{ r.from }}</b> → <b>{{ r.to }}</b> (brick:hasPart)
    </li>
    <li v-for="(c, i) in sinceOpen.connected" :key="`join-${i}`" data-kind="pipe">
      <b>{{ nameOfId(c.from) }}</b> — <b>{{ nameOfId(c.to) }}</b>: 연결했습니다(방향을 정하면 brick:feeds)
    </li>
    <li v-for="(c, i) in sinceOpen.disconnected" :key="`cut-${i}`" data-kind="pipe">
      <b>{{ nameOfId(c.from) }}</b> — <b>{{ nameOfId(c.to) }}</b>: 연결을 끊었습니다
    </li>
    <li v-for="(r, i) in releaseLines" :key="`release-${i}`" data-kind="pipe">
      <b>{{ nameOfId(r.from) }}</b> — <b>{{ nameOfId(r.to) }}</b>: 연결 해제 보정(사유: {{ r.reason }}). BIM 원본은 그대로, brick:feeds 에서 뺐습니다
      <template v-if="r.review"> · <b class="review-tag">재검토</b> {{ r.review === 'direction' ? '다시 연 판본에서 방향이 바뀜' : '다시 연 판본에 원본 연결이 없음' }}</template>
    </li>
    <li v-for="r in sinceOpen.spacesAdded" :key="`space-add-${r.id}`" data-kind="space">
      물리존 <b>{{ r.name || r.id }}</b>{{ josa(r.name || r.id, '을/를') }} 만들었습니다 (brick:hasPart, GeoJSON)
    </li>
    <li v-for="r in sinceOpen.spacesRemoved" :key="`space-rm-${r.id}`" data-kind="space">
      물리존 <b>{{ r.name }}</b>{{ josa(r.name, '이/가') }} 없어졌습니다(지우거나 합침). 그 안의 설비는 좌표로 다시 소속을 찾았습니다
    </li>
    <li v-for="r in sinceOpen.equipmentAdded" :key="`eq-add-${r.id}`">
      설비 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 더했습니다 (brick:hasLocation)
    </li>
    <li v-for="r in sinceOpen.equipmentRemoved" :key="`eq-rm-${r.id}`">
      설비 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 지웠습니다(붙은 연결도 같이)
    </li>
    <li v-for="r in sinceOpen.equipmentRenamed" :key="`eq-name-${r.id}`">
      설비 이름 <b>{{ r.from || '(없음)' }}</b> → <b>{{ r.to || '(없음)' }}</b> (rdfs:label)
    </li>
    <li v-for="r in sinceOpen.equipmentShaft ?? []" :key="`eq-shaft-${r.id}`">
      덕트·배관 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} {{ r.shaft ? `샤프트 ${r.shaft}에 넣었습니다` : '샤프트에서 뺐습니다' }} (GeoJSON shaftId)
    </li>
    <li v-for="r in sinceOpen.equipmentMounted" :key="`eq-wall-${r.id}`">
      설비 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} {{ r.wall ? `벽 ${r.wall}에 붙였습니다` : '벽에서 뗐습니다' }} (GeoJSON wallId)
    </li>
    <li v-for="r in sinceOpen.wallsAdded" :key="`wall-add-${r.id}`">벽 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 그었습니다 (GeoJSON)</li>
    <li v-for="r in sinceOpen.verticals ?? []" :key="`vertical-${r.id}`">
  <template v-if="r.created">{{ VERTICAL_KIND_LABEL[r.created] }} <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 만들었습니다(모든 층, GeoJSON)</template>
      <template v-else-if="r.removed">계단 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 지웠습니다(모든 층, GeoJSON)</template>
      <template v-else-if="r.reshaped">계단 <b>{{ r.name }}</b>의 층별 모양을 고쳤습니다({{ r.reshaped.map((id) => model?.storeys.find((st) => st.id === id)?.name ?? id).join(' · ') }}, GeoJSON)</template>
      <template v-else>계단 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} {{ r.move![0].toFixed(2) }}, {{ r.move![1].toFixed(2) }} m 옮겼습니다(모든 층, GeoJSON)</template>
    </li>
    <li v-for="r in sinceOpen.wallsRemoved" :key="`wall-rm-${r.id}`">벽 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 지웠습니다(뚫린 문·창도 같이, GeoJSON)</li>
    <li v-for="r in sinceOpen.wallsChanged" :key="`wall-ch-${r.id}`">
      벽 <b>{{ r.name }}</b>:
      <template v-if="r.moved">옮김</template><template v-if="r.moved && r.loadBearing"> · </template>
      <template v-if="r.loadBearing">내력 {{ r.loadBearing.from === null ? '모름' : r.loadBearing.from ? '내력' : '비내력' }} → <b>{{ r.loadBearing.to === null ? '모름' : r.loadBearing.to ? '내력' : '비내력' }}</b></template>
      <template v-if="r.resized"><template v-if="r.moved || r.loadBearing"> · </template>두께·높이</template>
      <template v-if="r.external"><template v-if="r.moved || r.loadBearing || r.resized"> · </template>외벽 여부 → <b>{{ r.external.to === null ? '모름' : r.external.to ? '외벽' : '내벽' }}</b></template>
      (GeoJSON)
    </li>
    <li v-for="r in sinceOpen.openingsAdded" :key="`op-add-${r.id}`">{{ elementLabel(r.kind) }} <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 놓았습니다 (GeoJSON)</li>
    <li v-for="r in sinceOpen.openingsRemoved" :key="`op-rm-${r.id}`">{{ elementLabel(r.kind) }} <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 지웠습니다 (GeoJSON)</li>
    <li v-for="r in sinceOpen.openingsMoved" :key="`op-mv-${r.id}`">
      {{ elementLabel(r.kind) }} <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }}
      {{ r.moved && r.resized ? '옮기고 크기를 바꿨습니다' : r.moved ? '옮겼습니다' : '크기를 바꿨습니다' }}
      ({{ r.moved ? 'GeoJSON 위치·연결 공간' : 'GeoJSON 가로·세로' }})
    </li>
    <!-- 룸(OE-OBJ-03). BIM 에는 없어서 있는 룸이 곧 사람이 그린 것이다. 온톨로지(TTL·GeoJSON)로는 아직 나가지 않는다. -->
    <li v-for="r in roomLines" :key="`room-${r.id}`">
      룸 <b>{{ r.name }}</b> ({{ r.storey }} · {{ r.parent }} 안, {{ r.size }}) — 편집 파일에만 남습니다
    </li>
    <!-- 추가 공간 오브젝트(OE-OBJ-09). 룸처럼 편집 파일에만 남는다. -->
    <li v-for="r in objectLines" :key="`object-${r.id}`">
      오브젝트 <b>{{ r.name }}</b> ({{ r.storey }} · {{ r.item }}, {{ r.size }} m) — 편집 파일에만 남습니다
    </li>
    <li v-for="r in bimObjectLines" :key="`bim-object-${r.id}`">BIM 오브젝트 {{ r.name }} — {{ r.what }}</li>
    <li v-for="r in sinceOpen.customZones" :key="`cz-${r.id}`">
      커스텀존 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} {{ r.change === 'added' ? '만들었습니다' : r.change === 'removed' ? '지웠습니다' : '고쳤습니다' }}
      (TTL brick:Zone · GeoJSON)
    </li>
    <li v-for="r in sinceOpen.hvacZones" :key="`hz-${r.id}`" data-kind="zone">
      공조존 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} {{ r.change === 'added' ? '만들었습니다' : r.change === 'removed' ? '지웠습니다' : '고쳤습니다' }}
      (TTL brick:HVAC_Zone · 담당 설비 brick:feeds · GeoJSON)
    </li>
    <li v-for="r in sinceOpen.systemMoved" :key="`sys-mv-${r.id}`">
      {{ r.name }}: 계통 <b>{{ systemNameOf(r.from) }}</b> → <b>{{ systemNameOf(r.to) }}</b> (brick:hasPart)
    </li>
    <li v-for="r in sinceOpen.systemsAdded" :key="`sys-add-${r.id}`">계통 <b>{{ r.name }}</b>{{ josa(r.name, '을/를') }} 만들었습니다 (brick:hasPart)</li>
    <li v-for="r in sinceOpen.systemsRemoved" :key="`sys-rm-${r.id}`">계통 <b>{{ r.name || r.id }}</b>{{ josa(r.name || r.id, '을/를') }} 지웠습니다</li>
    <li v-for="r in sinceOpen.systemNames" :key="`sys-name-${r.id}`">
      계통 이름 <b>{{ r.from }}</b> → <b>{{ r.to }}</b> (rdfs:label)
    </li>
    <li v-for="r in sinceOpen.systemKinds" :key="`sys-kind-${r.id}`">
      계통 <b>{{ r.name || r.id }}</b>: 종류 {{ systemKindText(r.from.kind, r.from.fluid) }} → <b>{{ systemKindText(r.to.kind, r.to.fluid) }}</b> (계통 클래스)
    </li>
    <li v-for="r in sinceOpen.renamed" :key="`name-${r.spaceId}`" data-kind="space">
      물리존 이름 <b>{{ r.from || '(없음)' }}</b> → <b>{{ r.to || '(없음)' }}</b> (rdfs:label)
    </li>
    <li v-for="r in sinceOpen.renumbered ?? []" :key="`number-${r.spaceId}`" data-kind="space">
      물리존 방번호 <b>{{ r.from || '(없음)' }}</b> → <b>{{ r.to || '(없음)' }}</b>
    </li>
    <li v-if="sinceOpen.moved.length" class="moved-only">
      소속은 같고 좌표만 바뀐 설비 {{ sinceOpen.moved.length }}대 (GeoJSON 위치):
      {{ sinceOpen.moved.slice(0, MOVED_NAMES).map((m) => m.name).join(', ')
              }}<template v-if="sinceOpen.moved.length > MOVED_NAMES"> 외 {{ sinceOpen.moved.length - MOVED_NAMES }}대</template>
    </li>
  </ul>
  <p v-memo="replayMemo()" v-else class="empty">아직 바뀐 것이 없습니다.</p>
  <!-- 공조존 검증 경고(OE-MAP-04 · OE-ZON-05 "결과는 반영 결과 리포트에 든다"). 반영(D10)이 없어 바뀐 내용 아래에 둔다.
       막지 않는다. 공조존을 하나도 만들지 않았으면 보이지 않는다(Z-01 이 층마다 전부 공백이 된다). -->
  <ul v-memo="replayMemo()" v-if="reportZoneChecks.length" class="report report-checks" data-testid="report-zone-checks">
    <li v-for="c in reportZoneChecks" :key="`${c.rule}${c.undetermined ? '?' : ''}`" :class="{ warn: !c.undetermined }" data-kind="zone">
      <b>{{ c.rule }}</b> {{ c.text }}: {{ c.items.length }}개 — {{ c.items.slice(0, 5).map((x) => x.label).join(', ') }}<template v-if="c.items.length > 5"> 외 {{ c.items.length - 5 }}개</template>
    </li>
  </ul>
  <!-- 해제 보정·취소(OE-PIP-06)와 방향 적용·해제(OE-PIP-04)의 시각·사유. 취소해서 지금은 바뀐 것이 없어도 기록은 남는다.
       수행자는 로그인(OE-COM-01) 뒤에 적는다. -->
  <div v-memo="replayMemo()" v-if="releaseLog.length" class="release-log" data-testid="release-log">
    <h4>연결 편집 이력</h4>
    <ol>
      <li v-for="(e, i) in releaseLog" :key="`log-${i}`">
        <span class="muted">{{ logTime(e.at) }}</span> {{ RELEASE_ACTION[e.action] }}: <b>{{ nameOfId(e.from) }}</b> {{ e.action === 'flow' || e.action === 'unflow' ? '→' : '—' }} <b>{{ nameOfId(e.to) }}</b
        ><template v-if="e.reason"> · {{ e.reason }}</template>
      </li>
    </ol>
  </div>
</template>
