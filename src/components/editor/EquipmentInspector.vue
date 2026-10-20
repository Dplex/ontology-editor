<script setup lang="ts">
import type { PropType } from 'vue'
import { FLOW_TYPES } from '../../lib/flow-type'
import { systemKind } from '../../lib/kinds'
import { ANCHOR_MARGIN, isConduit } from '../../lib/model'
import { vFlash } from '../../lib/motion'
import { allowedLabel, allowedSurfaces, type Surface, SURFACE_LABEL } from '../../lib/mount'
import { replayMemo } from '../../lib/replay-player'
import { applyRetarget, retargetChoices, retargetDraft, segmentEnds } from '../../editor/background'
import { selectedLock } from '../../editor/ceiling'
import { roleLabel, selectedBasis, systemById, whatIs } from '../../editor/checks'
import { nameOfId } from '../../editor/connections'
import { editing } from '../../editor/core'
import { insertVertexHere, removeVertexHere, vertexAction } from '../../editor/cross-storey'
import { flowTypeText, JUDGED_LABEL, locationOf, onFlowTypePick, selectedFlowType, selectedJudged, setSurfaceOf, spaceNameOf } from '../../editor/edit-report'
import { removeEquipment, startDuplicate } from '../../editor/equipment-edit'
import { borrowedShape, mmOf, shortName } from '../../editor/equipment-shape'
import { flowMap } from '../../editor/flow-map'
import { deviceCount, traced } from '../../editor/flow-rules'
import { applyAssign, ASSIGN_RELEASE_REASON, assignInfo, roleSrc, spaceSrc } from '../../editor/kinds'
import { selectedImpact } from '../../editor/manual-draw'
import { selectedInsights } from '../../editor/panels'
import { frameNetwork, select, systemKindText } from '../../editor/systems'
import Src from '../Src.vue'
import ChangeBadge from './ChangeBadge.vue'
import EquipmentEdits from './EquipmentEdits.vue'
import EquipmentFlow from './EquipmentFlow.vue'
import EquipmentPipeTools from './EquipmentPipeTools.vue'
import EquipmentRules from './EquipmentRules.vue'
import EquipmentService from './EquipmentService.vue'
import type { counts as countsRef, model as modelRef } from '../../editor/core'
import type { selected as selectedRef } from '../../editor/flow-rules'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  counts: { type: null as unknown as PropType<NonNullable<typeof countsRef.value>>, required: true },
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
  selected: { type: null as unknown as PropType<NonNullable<typeof selectedRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked">
    <div class="picked-head">
      <div>
        <h3>{{ selected.name || '(이름 없음)' }} <ChangeBadge :id="selected.id" /></h3>
        <!-- 무엇을 하는 설비인지 한 줄(흐름 지도의 공급 사슬). 이름은 Revit 패밀리 이름이라 공조기인지조차 안 보인다. -->
        <p v-if="flowMap?.summary" class="picked-summary" data-testid="flow-summary">
          <b>{{ whatIs(selected)?.label ?? '설비' }}</b> · {{ flowMap.summary }} <Src kind="calc" />
        </p>
        <!-- 한 줄에 "공조기 사전 · UnitaryEquipment.AIRHANDLER BIM · 에너지 변환 BIM · …" 로 이었더니 출처 칩이 어느 값에
             붙은 것인지 읽기 어려웠다. 무엇에 대한 값인지를 앞에 두고 줄을 나눈다. -->
        <dl class="stats facts">
          <div>
            <dt>종류</dt>
            <dd v-flash="whatIs(selected)?.label">
              <template v-if="whatIs(selected)">{{ whatIs(selected)!.label }} <Src :kind="whatIs(selected)!.src" /> · </template>
              <template v-if="selected.added">에디터에서 더한 설비 <Src kind="edit" /></template>
              <span v-else class="muted">{{ selected.declaredType ?? selected.ifcClass }} <Src kind="bim" /></span>
            </dd>
          </div>
          <div v-if="roleLabel(selected.role)">
            <dt>역할</dt>
            <dd>{{ roleLabel(selected.role) }} <Src :kind="roleSrc(selected)" /></dd>
          </div>
          <div>
            <dt>계통</dt>
            <dd v-flash="selected.systemId">
              <!-- 종류를 앞에 둔다. 이름(`기계 급기 287`, `Hydronic Return 1`)은 BIM 이 붙인 번호라 그것만으로는 무엇인지 모른다. -->
              <template v-if="selected.systemId && systemKind(systemById.get(selected.systemId)?.kind)">{{ systemKindText(systemById.get(selected.systemId)?.kind, systemById.get(selected.systemId)?.fluid) }} · </template>
              {{ selected.systemId ? systemById.get(selected.systemId)?.name : '(계통 없음)' }}
              <Src v-if="selected.systemEdited" kind="edit" /><Src v-else-if="selected.systemId" kind="bim" />
            </dd>
          </div>
          <!-- Flow Type(OE-PIP-14). BIM 배관은 계통 종류·유체로 계산하고, 공급·환수가 섞여 정하지 못한 구간은 사람이 고른다. -->
          <div v-if="selectedFlowType" data-testid="flow-type-row">
            <dt>Flow Type</dt>
            <dd v-flash="selectedFlowType.now?.code">
              <select
                v-if="editing && !selectedLock && !selected.flowType"
                :value="selected.flowTypeSet ?? ''"
                aria-label="구간 Flow Type"
                @change="onFlowTypePick(selected.id, $event.target as HTMLSelectElement)"
              >
                <option value="">{{ selectedFlowType.calc ? `계산: ${flowTypeText(selectedFlowType.calc.code)}` : '미확정(계통 종류·유체 미상)' }}</option>
                <option v-for="f in FLOW_TYPES" :key="f.code" :value="f.code">{{ f.code }} {{ f.label }}</option>
              </select>
              <template v-else>{{ selectedFlowType.now ? flowTypeText(selectedFlowType.now.code) : '미확정(계통 종류·유체 미상)' }}</template>
              <Src v-if="selectedFlowType.now" :kind="selectedFlowType.now.source" />
            </dd>
          </div>
          <!-- 담당 근거(OE-EQP-10). VAV·말단을 어느 공조기가 맡는지 흐름 방향으로 찾은 것. -->
          <div v-if="selectedBasis" class="basis">
            <dt>담당</dt>
            <dd>
              <template v-if="selectedBasis.supplyFrom.length || selectedBasis.extractTo.length">
                <span v-if="selectedBasis.supplyFrom.length">급기 ← {{ selectedBasis.supplyFrom.join(', ') }}</span>
                <template v-if="selectedBasis.supplyFrom.length && selectedBasis.extractTo.length"> · </template>
                <span v-if="selectedBasis.extractTo.length">환기 → {{ selectedBasis.extractTo.join(', ') }}</span>
              </template>
              <span v-else class="muted">흐름 방향으로 닿는 공조기 없음</span>
              <template v-if="selected.kind === 'vav'"> · 말단 {{ selectedBasis.terminals }}개 · 방 {{ selectedBasis.rooms }}곳</template>
              <Src kind="calc" />
            </dd>
          </div>
          <div>
            <dt>소속</dt>
            <dd v-flash="selected.spaceId">
              {{ locationOf(selected) }}
              <Src v-if="selected.spaceId" :kind="spaceSrc(selected)" />
              <!-- 사람 지정 해제(K17). 지정은 남아 있고, 기계가 확신해 쓰지 않는 것이다. -->
              <small v-if="assignInfo?.state?.state === 'released'" class="assign-released" data-testid="assign-released">
                사람 지정 해제: {{ spaceNameOf(assignInfo.state.from) }} → {{ spaceNameOf(selected.spaceId) }}({{ ASSIGN_RELEASE_REASON[assignInfo.state.reason] }})
              </small>
            </dd>
          </div>
          <!-- 사람의 소속 지정(OE-MAP-01 · K17). 기계가 확신하지 못한 설비만 열린다. 막히면 까닭을 보인다. -->
          <div v-if="editing && assignInfo" class="assign">
            <dt title="사람의 소속 지정(OE-MAP-01)">지정</dt>
            <dd>
              <select
                data-testid="assign-space"
                :disabled="!assignInfo.can.ok && selected.spaceSet === undefined"
                :value="selected.spaceSet ?? ''"
                @change="applyAssign(selected.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">지정 안 함(좌표로 판정)</option>
                <option v-for="sp in assignInfo.storey.spaces" :key="sp.id" :value="sp.id">{{ sp.longName || sp.name }}</option>
              </select>
              <small v-if="!assignInfo.can.ok" class="muted" data-testid="assign-blocked">{{ assignInfo.can.reason }}</small>
            </dd>
          </div>
          <!-- 설치면(OE-OBJ-08 · OE-EQP-03). 허용 설치면은 종류(사전, glossary 설치면 type), 판정은 z(층 바닥 기준). -->
          <div v-if="!isConduit(selected.role)" class="mount">
            <dt>설치면</dt>
            <dd v-flash="selected.kind">
              <template v-if="allowedSurfaces(selected.kind)">허용 {{ allowedLabel(selected.kind) }} <Src kind="dict" /></template>
              <span v-else class="muted">허용 설치면을 정하지 않은 종류</span>
              <template v-if="selectedJudged && allowedSurfaces(selected.kind)?.length !== 0">
                <br />
                <template v-if="selectedJudged.judged">
                  판정 <span :class="{ 'height-mismatch': selectedJudged.outside }">{{ JUDGED_LABEL[selectedJudged.judged] }}</span>
                  <span v-if="selectedJudged.z !== null" class="muted">(z {{ selectedJudged.z.toFixed(2) }}m)</span>
                  <Src v-if="!selected.surfaceSet" kind="calc" />
                  <span v-if="selectedJudged.outside" class="height-mismatch"> 허용 밖</span>
                </template>
                <span v-else-if="selectedJudged.z !== null" class="muted">
                  판정 미정 (z {{ selectedJudged.z.toFixed(2) }}m{{ selectedJudged.hc ? '' : ' · 이 층 천장고 모름' }})
                </span>
                <!-- 사람이 정한 설치면(OE-EQP-05). 판정하지 못한 설비에 정하고, 지우면 z 판정으로 돌아간다. -->
                <template v-if="selected.surfaceSet">
                  <Src kind="edit" />
                  <button v-if="editing && !selectedLock" type="button" class="link" @click="setSurfaceOf(selected.id, null)">판정으로 되돌리기</button>
                </template>
                <label v-else-if="editing && !selectedLock && !selectedJudged.judged" class="surface-set">
                  <select aria-label="설치면 정하기" @change="setSurfaceOf(selected.id, (($event.target as HTMLSelectElement).value || null) as Surface | null)">
                    <option value="">설치면 정하기…</option>
                    <option v-for="x in allowedSurfaces(selected.kind) ?? (['ceiling', 'floor', 'wall'] as const)" :key="x" :value="x">{{ SURFACE_LABEL[x] }}</option>
                  </select>
                </label>
              </template>
            </dd>
          </div>
          <!-- 배치점 보정(OE-BIM-12). BIM 배치점이 형상에서 기준(0.5m)보다 멀어 형상 중심을 좌표로 쓴 설비. 원본과 보정 위치, 까닭을 같이 보인다. -->
          <div v-if="selected.anchored" data-testid="anchored">
            <dt>배치점</dt>
            <dd>
              형상 중심 <span class="mono">({{ selected.position ? selected.position.map((v) => mmOf(v).toFixed(2)).join(', ') : '—' }})</span> <Src kind="calc" />
              <span class="muted">— BIM 배치점 <span class="mono">({{ selected.anchored.from.map((v) => mmOf(v).toFixed(2)).join(', ') }})</span> <Src kind="bim" />이 형상에서 {{ selected.anchored.off.toFixed(2) }}m 떨어져(기준 {{ ANCHOR_MARGIN }}m 초과) 형상 중심을 씁니다</span>
            </dd>
          </div>
        </dl>
      </div>
      <div class="picked-actions">
        <button type="button" class="ghost" title="이어진 설비 전체가 보이게 시점을 맞춥니다 (F)" @click="frameNetwork">연결망 보기</button>
        <button type="button" class="ghost" title="선택 해제 (Esc)" @click="select(null)">선택 해제</button>
      </div>
    </div>

    <!-- 고른 설비에서 고칠 것(smart-insights). 왜 비었는지 한 줄과 바로 고치는 단추. 단추는 편집 모드로 들어가 여느 편집 함수를 부른다. -->
    <div v-if="selectedInsights.length" class="smart-insights" role="region" aria-label="이 설비의 보정 항목">
      <div class="insights-head">
        <span class="insights-badge">보정 항목</span>
        <span class="muted">{{ selectedInsights.length }}건</span>
      </div>
      <ul class="insights-list">
        <li v-for="ins in selectedInsights" :key="ins.key" :class="['insight-item', ins.tone]">
          <span class="insight-text">{{ ins.text }}</span>
          <button v-if="ins.actionLabel && ins.run" type="button" class="ghost insight-btn" @click="ins.run()">
            {{ ins.actionLabel }}
          </button>
        </li>
      </ul>
    </div>

    <!-- 천장 편집 모드(OE-OBJ-08). 지금 모드에서 고칠 수 없는 설비는 고르기·조회만 되고 편집 칸을 숨긴다. -->
    <EquipmentEdits :model="model" :selected="selected" />

    <!-- 흐름 지도. 기기를 고르면 관 조각을 건너뛰고 기기 단위로 위·아래를 잇는다. 덕트·배관을 고르면 요소 수(아래 세 칸)가 그대로 보인다 —
         기기에서 세면 관 조각까지 들어가 공조기 하나가 "상류 1110 · 하류 2305" 였다. -->
    <EquipmentFlow v-if="flowMap" :flow-map="flowMap" />

    <ul v-else class="flow">
      <li class="upstream">
        <b>{{ traced?.upstream.size ?? 0 }}</b><span>상류</span><Src kind="bim" />
      </li>
      <li class="downstream">
        <b>{{ traced?.downstream.size ?? 0 }}</b><span>하류</span><Src kind="bim" />
      </li>
      <li class="linked">
        <b>{{ traced?.linked.size ?? 0 }}</b><span>방향 모름</span>
        <small v-if="traced?.linked.size">그중 기기 {{ deviceCount(traced.linked) }}</small>
      </li>
    </ul>

    <!-- 보기 모드에서 흐름 카드가 답하면, 그 근거(규칙 방향·직접 연결·경로)는 접는다. 성수 FCU 패널이 1,650px 이었고 답(흐름 카드)
         아래로 검증용 숫자가 이어져 무엇을 봐야 할지 몰랐다. 편집 모드는 여기서 방향을 정하므로 펼친 그대로다. -->
    <EquipmentRules />

    <!-- 정격 풍량(OE-ZON-06). BIM 용량이 풍량이면 CMH 로 바꾼 값이고 고치지 않는다. 없으면 편집 모드에서 사람이 넣는다.
         값이 있는 설비, 그리고 편집 모드에서는 용량 검증 Z-03 의 판정 대상(VAV·FCU·실내기·공조기)에도 보인다. 보기 모드의 "없음" 줄은
         넣을 수 없는 자리라 패널만 길게 했다. -->
    <EquipmentService :counts="counts" :selected="selected" />

    <!-- 배관 그리기(OE-PIP-11). 이 설비에서 끝 대상까지 구간·이음쇠를 더하고 manual 연결로 잇는다. 방향은 정하지 않는다. -->
    <EquipmentPipeTools :model="model" :selected="selected" />

    <!-- 구간 끝의 연결 대상 바꾸기(OE-PIP-10). BIM 포트 연결은 해제 보정으로 남기고 새 대상과 manual 로 잇는다. -->
    <div v-if="editing && !selectedLock && selected.role === 'segment' && segmentEnds.length" class="retarget" data-testid="retarget">
      <h4 class="picked-sub">끝 대상 바꾸기</h4>
      <p class="pipe-draw-row">
        <label>
          바꿀 끝
          <select v-model="retargetDraft.from" aria-label="바꿀 끝">
            <option value="">고르세요…</option>
            <option v-for="x in segmentEnds" :key="x.id" :value="x.id">{{ x.name }}{{ x.port ? ' (BIM 포트)' : '' }}</option>
          </select>
        </label>
        <label>
          새 대상
          <select v-model="retargetDraft.to" aria-label="새 대상" :disabled="!retargetDraft.from">
            <option value="">고르세요…</option>
            <option v-for="x in retargetChoices" :key="x.id" :value="x.id">{{ x.name }} · {{ x.d.toFixed(1) }}m</option>
          </select>
        </label>
        <button type="button" class="ghost" :disabled="!retargetDraft.from || !retargetDraft.to" @click="applyRetarget">바꾸기</button>
      </p>
      <p v-if="retargetDraft.from && retargetDraft.to" class="hint" data-testid="retarget-preview">
        기존: {{ nameOfId(retargetDraft.from) }} → 변경: {{ nameOfId(retargetDraft.to) }}.
        {{ segmentEnds.find((x) => x.id === retargetDraft.from)?.port ? '옛 연결은 BIM 포트 연결이라 지우지 않고 해제 보정으로 남깁니다.' : '옛 연결은 지웁니다.' }}
        새 연결은 방향 없이 시작합니다.
      </p>
    </div>

    <!-- 더한 설비의 모양이 어디서 왔나(ADR-0059). 3D·GLB·OBJ·FBX 에만 쓰이고 TTL·GeoJSON 에는 모양이 없다. -->
    <p v-if="selected.added && !selected.flowType" class="hint" data-testid="borrowed-shape">
      3D 모양:
      <template v-if="borrowedShape.get(selected.id)">
        {{ shortName(nameOfId(borrowedShape.get(selected.id)!)) }}의 형상 <Src kind="edit" /> — {{ borrowedShape.get(selected.id) === selected.shapeOf ? '복제한 원본' : '같은 종류의 BIM 설비' }}. GLB·OBJ·FBX 에 나가고 TTL·GeoJSON 에는 모양이 없습니다.
      </template>
      <template v-else>상자 — {{ selected.kind ? '같은 종류에 형상이 있는 BIM 설비가 없습니다' : '종류를 정하면 같은 종류 BIM 설비의 모양을 따릅니다' }}.</template>
    </p>
    <!-- 복제(ADR-0059). 같은 종류·모양으로 하나 더 놓는다. -->
    <p v-if="editing && !selectedLock && !selected.flowType && !isConduit(selected.role)" class="copy-zone">
      <button type="button" class="ghost" data-testid="duplicate" title="종류·모양이 같은 설비를 바닥을 눌러 하나 더 놓습니다" @click="startDuplicate(selected)">
        같은 모양으로 더하기 <kbd>Ctrl+D</kbd>
      </button>
      <span class="muted">연결·계통은 비어 있습니다.</span>
    </p>
    <!-- 배관 꼭짓점 넣기·지우기(OE-PIP-10). 구간은 가운데에 넣고, 구간 둘 사이의 이음쇠는 지워 두 구간을 합친다. -->
    <p v-if="!selectedLock && vertexAction" class="copy-zone" data-testid="pipe-vertex">
      <button v-if="vertexAction === 'insert'" type="button" class="ghost" @click="insertVertexHere(selected)">가운데에 꼭짓점 넣기</button>
      <button v-else type="button" class="ghost" @click="removeVertexHere(selected)">꼭짓점 지우기</button>
      <span class="muted">{{ vertexAction === 'insert' ? '구간을 둘로 나눠 꺾을 자리를 만듭니다.' : '양쪽 구간을 하나로 곧게 합칩니다.' }} 연결 대상과 확정 방향은 그대로입니다.</span>
    </p>
    <!-- 지우기(E7). 지우면 붙은 연결·계통 자리도 빠지고 Ctrl+Z 로 돌아온다. 고치는 칸과 떨어뜨려 맨 아래에 둔다. -->
    <p v-if="editing && !selectedLock" class="danger-zone">
      <button type="button" class="ghost danger" title="이 설비와 붙은 연결을 지웁니다 (Ctrl+Z 로 되돌림)" @click="removeEquipment(selected.id)">
        설비 지우기
      </button>
      <span class="muted">붙은 연결·계통 자리도 같이 빠집니다. Ctrl+Z 로 되돌립니다.</span>
      <span v-if="selectedImpact" class="removal-impact" data-testid="removal-impact">{{ selectedImpact }}</span>
    </p>
  </section>
</template>
