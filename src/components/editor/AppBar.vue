<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { discardDraft, draft, restoreDraft } from '../../editor/autosave'
import { editPart, setEditPart } from '../../editor/ceiling'
import { changeCount } from '../../editor/changes'
import { appbar, selectAndShow } from '../../editor/chat-view'
import { busy, dark, dragging, editing, fileName, mode, toggleTheme } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { reportPlace, spaceNameOf } from '../../editor/edit-report'
import { draftTime, keepDraft, leaveEdit } from '../../editor/exit-edit'
import { grid, snap } from '../../editor/grid-snap'
import { future, history, redo, undo } from '../../editor/history'
import { helpOpen } from '../../editor/keyboard'
import { breadcrumb, canDiscardDraft, discardAsk, discardFloorDraft } from '../../editor/layout-storeys'
import { canAppend, onAppendPick, warnings } from '../../editor/open-file'
import { appendOver, exportGeoJSONDone, justDone, onAppendDrop, onDrop, onPick, previewChanges, previewData, previewOpen, previewText, ruleWarnings, siteRules } from '../../editor/open-many'
import { currentUser, editBlock, people, PERSON_ROLE } from '../../editor/people'
import { saveEdits } from '../../editor/progress'
import { editKind, serverKey } from '../../editor/projects'
import { buildBlock, firstPublish, loadedVersion, newerLayout, notices, noticesOpen, openNotices, reloadLayout, unseenNotices } from '../../editor/publish'
import { readFeatures, readOpenings } from '../../editor/read-settings'
import { askPublish, publishing, versionTime } from '../../editor/reports'
import { export3D, exporting3d, exportTTLDone, fbxServer } from '../../editor/storey-progress'
import { hasEdits } from '../../editor/versions'
import AlignToggles from '../AlignToggles.vue'
import Roll from '../Roll.vue'
import ThemeIcon from '../ThemeIcon.vue'
import type { model as modelRef } from '../../editor/core'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <div ref="appbar" v-memo="replayMemo()" class="appbar">
    <div class="appbar-row">
      <div class="file">
        <h2 :title="fileName">{{ fileName }}</h2>
        <!-- 위치 표시 사이트 › 건물 › 층(OE-UI-04 AC14). 층은 보는 층(모든 층이면 "모든 층"). -->
        <span v-if="breadcrumb" class="muted">{{ model.schema }} · <span class="crumbs" data-testid="breadcrumb">{{ breadcrumb.site }} › {{ breadcrumb.building }} › {{ breadcrumb.storey }}</span></span>
      </div>
      <div class="bar-actions">
        <label
          class="ghost drop compact"
          :class="{ over: dragging }"
          title="다른 IFC 열기 (여기에 끌어다 놓아도 됩니다)"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          열기
          <input type="file" accept=".ifc,.idf" multiple :disabled="busy" @change="onPick" />
        </label>
        <!-- 다음에 열 파일에서 읽을 피처. 첫 화면의 "읽을 것" 과 같은 값이다. -->
        <details class="read-menu">
          <summary title="다음에 여는 파일에서 읽을 것">읽을 것</summary>
          <fieldset class="read-option features" :disabled="busy">
            <label><input v-model="readFeatures.walls" type="checkbox" /> 벽</label>
            <label><input v-model="readFeatures.doors" type="checkbox" /> 문</label>
            <label><input v-model="readFeatures.windows" type="checkbox" /> 창</label>
            <label :class="{ off: !readFeatures.doors && !readFeatures.windows }">
              <input v-model="readOpenings" type="checkbox" :disabled="!readFeatures.doors && !readFeatures.windows" /> 문·창 자리(형상)
            </label>
            <span class="muted">다음에 여는 파일부터, 어디서 열든(파일·data/ 목록·덧붙이기) 적용됩니다.</span>
          </fieldset>
        </details>
        <!-- 건축과 설비가 다른 파일일 때. 편집을 시작한 뒤에는 닫는다(canAppend 주석 참조). -->
        <label
          class="ghost append"
          :class="{ disabled: !canAppend, over: appendOver }"
          :aria-disabled="!canAppend"
          :title="
                hasEdits
                  ? '열린 파일에 합치기. 지금까지 한 편집은 합친 모델에 다시 얹습니다(되돌리기 이력은 끊깁니다). 여기에 끌어다 놓아도 됩니다'
                  : '열린 파일에 합치기 — 건축·설비 IFC(합쳐야 설비가 어느 방에 있는지 나옵니다) 또는 IDF(공조존). 여기에 끌어다 놓아도 됩니다'
              "
          @dragover.prevent="appendOver = canAppend"
          @dragleave.prevent="appendOver = false"
          @drop.prevent="onAppendDrop"
        >
          덧붙이기
          <input type="file" accept=".ifc,.idf" multiple :disabled="busy || !canAppend" @change="onAppendPick" />
        </label>
        <a v-if="warnings.length" href="#warnings" class="warn-count" title="읽으면서 건너뛴 것. 목록은 아래 요약에 있습니다.">경고 {{ warnings.length }}</a>
        <!-- 보기와 편집. 편집은 고치는 손잡이를 드러낼 뿐이고 편집한 결과는 모드를 바꿔도 남는다. -->
        <div class="mode-switch" role="group" aria-label="화면 모드">
          <button type="button" :aria-pressed="mode === 'view'" title="보기 모드로 전환 (E)" @click="leaveEdit()">보기</button>
          <button type="button" :aria-pressed="mode === 'edit'" :disabled="busy || !!editBlock" :title="editBlock ?? '편집 모드로 전환 (E)'" @click="mode = 'edit'">편집</button>
        </div>
        <!-- 사람(OE-COM-01). 서버의 사람 목록에서 고른다. 보기 전용은 편집에 들어가지 않는다. -->
        <!-- 알림(OE-WF-16, GNB 시스템 알림 대신). 레이아웃 반영·되돌리기. -->
        <div v-if="people" class="notices">
          <button type="button" class="ghost" :aria-expanded="noticesOpen" aria-label="알림" @click="openNotices">
            알림<span v-if="unseenNotices" class="notice-count" data-testid="notice-count">{{ unseenNotices }}</span>
          </button>
          <ul v-if="noticesOpen" class="notice-list" data-testid="notice-list">
            <li v-for="(n, i) in notices" :key="i">
              <span><b>{{ n.type === 'rollback' ? '레이아웃 되돌리기' : '레이아웃 변경 반영' }}</b> · v{{ n.version }} · {{ n.floors.join(' · ') }} · {{ n.user }}</span>
              <span class="muted">{{ versionTime(n.at) }} · {{ n.key }}</span>
            </li>
            <li v-if="!notices.length" class="muted">알림이 없습니다</li>
          </ul>
        </div>
        <label v-if="people" class="who" title="반영자·로그에 남는 사람입니다(data/.users.json)">
          <select v-model="currentUser" aria-label="사용자">
            <option value="">사용자 고르기…</option>
            <option v-for="p in people" :key="p.name" :value="p.name">{{ p.name }} · {{ PERSON_ROLE[p.role] }}</option>
          </select>
        </label>
        <span class="bar-sep" aria-hidden="true"></span>
        <!-- 여는·합치는 중(busy)에는 막는다. 건축·설비를 같이 열 때 설비를 읽는 동안 누르면 건축만 든 파일이 나갔다. -->
        <button type="button" class="ghost" aria-label="기하 내보내기 (GeoJSON)" title="형상 내보내기 (층마다 GeoJSON 파일 하나)" :disabled="busy" :class="{ done: justDone === 'geojson' }" @click="exportGeoJSONDone">GeoJSON</button>
        <button type="button" class="ghost" aria-label="의미 내보내기 (Brick TTL)" title="관계 내보내기 (Brick TTL 파일 하나)" :disabled="busy" :class="{ done: justDone === 'ttl' }" @click="exportTTLDone">TTL</button>
        <!-- 만드는 동안 글자는 "GLB…" 로만 바꾼다. 무엇을 하는지는 진행 막대가 보인다. "만드는 중…" 으로 바꾸면 단추가 넓어져 1600px 에서 성수 이름과 함께 툴바가 두 줄로 넘어갔다. -->
        <button type="button" class="ghost" aria-label="3D 형상 내보내기 (GLB)" title="3D 형상 내보내기 (GLB 파일 하나, 요소 이름은 GlobalId)" :disabled="busy || !!exporting3d" :aria-busy="exporting3d === 'glb'" :class="{ done: justDone === 'glb' }" @click="export3D('glb')">{{ exporting3d === 'glb' ? 'GLB…' : 'GLB' }}</button>
        <button type="button" class="ghost" aria-label="3D 형상 내보내기 (OBJ)" title="3D 형상 내보내기 (OBJ 파일 하나, 요소 이름은 GlobalId)" :disabled="busy || !!exporting3d" :aria-busy="exporting3d === 'obj'" :class="{ done: justDone === 'obj' }" @click="export3D('obj')">{{ exporting3d === 'obj' ? 'OBJ…' : 'OBJ' }}</button>
        <button type="button" class="ghost" aria-label="3D 형상 내보내기 (FBX)" :title="fbxServer.enabled ? '3D 형상 내보내기 (FBX 파일 하나, 요소 이름은 GlobalId, 서버에서 GLB 를 변환)' : fbxServer.reason" :disabled="busy || !!exporting3d || !fbxServer.enabled" :aria-busy="exporting3d === 'fbx'" :class="{ done: justDone === 'fbx' }" @click="export3D('fbx')">{{ exporting3d === 'fbx' ? 'FBX…' : 'FBX' }}</button>
        <button type="button" class="ghost keys-help" title="조작·단축키 안내 (?)" aria-label="조작·단축키 안내" @click="helpOpen = true">?</button>
        <button type="button" class="ghost theme icon-btn" :aria-pressed="dark" aria-label="다크 모드" :title="dark ? '라이트 모드로 바꿉니다' : '다크 모드로 바꿉니다'" @click="toggleTheme"><ThemeIcon :dark="dark" /></button>
      </div>
    </div>
    <!-- 편집 모드에서만. 좁은 폭에서는 마지막 편집 이름이 남는 폭을 쓰고 넘치면 자른다. 단축키는 title 과 ? 안내로. -->
    <!-- 자동 저장된 편집이 남아 있으면 연 직후에 묻는다. 새로 편집을 시작하면 그 편집이 기록을 대신한다. -->
    <!-- 자동 저장 복구(OE-HIST-04). 묻는 말과 [예]·[아니오] 는 PRD 문구 그대로다. 아니오는 자동 저장을 지우고, 편집 모드에 들어가면
         그 층의 임시 저장본이 있으면 그것이 얹힌다(enterFloors). -->
    <div v-if="draft" class="draft-bar" role="status">
      <span>
        <b>자동 저장된 내용을 반영하시겠습니까?</b> 이 파일에서 저장하지 않은 편집 <b>{{ draft.count }}건</b>이 남아 있습니다({{ draftTime }}).
      </span>
      <button type="button" class="ghost on" title="자동 저장된 편집을 그대로 얹어 이어서 편집합니다" @click="restoreDraft">예</button>
      <button type="button" class="ghost" title="자동 저장을 지웁니다. 다시 열어도 묻지 않습니다" @click="discardDraft">아니오</button>
    </div>
    <!-- 새 레이아웃 배너(OE-WF-15). 새로고침하기 전까지 남는다. -->
    <div v-if="newerLayout" class="layout-banner" role="status" data-testid="layout-banner">
      <span>
        <b>새 레이아웃이 적용되었습니다</b>(v{{ newerLayout.version }} · {{ newerLayout.by }} · {{ newerLayout.floors.join(' · ') }}{{ newerLayout.kind === 'rollback' ? ` · v${newerLayout.from} 되돌리기` : '' }}). 새로고침하면 반영됩니다.
      </span>
      <button type="button" class="ghost primary-action" @click="reloadLayout">새로고침</button>
    </div>
    <div v-if="editing" class="edit-bar" role="status">
      <span class="mode-chip" :class="editKind" data-testid="edit-kind" :title="editKind === 'operate' ? '반영된 온톨로지가 있는 층을 이어서 고칩니다' : '온톨로지가 없는 층을 처음 만듭니다'">
        {{ editKind === 'operate' ? `운영 편집${loadedVersion ? ` · v${loadedVersion}` : ''}` : '초기 구축' }}
      </span>
      <!-- 편집 대상(OE-UI-04). 팔레트의 도구가 바뀐다. 다른 쪽 오브젝트는 고르고 볼 수만 있다. -->
      <span class="edit-part" role="group" aria-label="편집 대상">
        <button type="button" :class="{ on: editPart === 'space' }" :aria-pressed="editPart === 'space'" title="물리존·룸·커스텀존·벽·문·창·오브젝트를 고칩니다 (M)" @click="setEditPart('space')">공간</button>
        <button type="button" :class="{ on: editPart === 'equipment' }" :aria-pressed="editPart === 'equipment'" title="설비·배관·천장 설비를 고칩니다 (M)" @click="setEditPart('equipment')">설비</button>
      </span>
      <span class="state"><b>편집 중</b> · <a href="#changes" class="link">바뀐 것 <Roll :value="changeCount" :count-up="false" />건</a></span>
      <button
        type="button"
        class="ghost undo"
        :disabled="!history.length"
        :title="history.length ? `되돌리기 (Ctrl+Z): ${history.at(-1)!.label}` : '되돌릴 편집이 없습니다'"
        @click="undo"
      >
        ↶ 되돌리기
      </button>
      <button
        type="button"
        class="ghost redo"
        :disabled="!future.length"
        :title="future.length ? `다시 하기 (Ctrl+Shift+Z): ${future.at(-1)!.entry.label}` : '다시 할 편집이 없습니다'"
        @click="redo"
      >
        ↷ 다시
      </button>
      <!-- 그리드·스냅(OE-UI-06·07). 그리지 않을 때도 끄는 설비·오브젝트·꼭짓점에 걸려서 편집 막대에도 둔다. 팔레트에 두면
           팔레트가 높아져 3D 왼쪽 아래 바닥을 가린다. -->
      <AlignToggles v-model:grid="grid" v-model:snap="snap" class="bar-align" />
      <span class="muted last-edit" :title="history.at(-1)?.label">{{ history.at(-1)?.label ?? '' }}</span>
      <button
        type="button"
        class="ghost save-edits"
        :class="{ done: justDone === 'save' }"
        :title="serverKey
              ? '편집 저장 (Ctrl+S). 서버에 저장합니다 — 이 파일을 여는 모든 사용자가 같은 편집을 봅니다.'
              : '편집 저장 (Ctrl+S). 손으로 연 파일이라 바뀐 내용을 JSON으로 내려받습니다. 같은 IFC를 다시 열고 불러오면 이어서 편집할 수 있습니다.'"
        @click="saveEdits()"
      >
        편집 저장
      </button>
      <button v-if="serverKey" type="button" class="ghost" title="서버에 저장하지 않고 편집 파일(JSON)로만 내려받습니다" @click="saveEdits(true)">파일로</button>
      <button type="button" class="ghost" :title="people ? '반영하지 않고 이 층의 편집을 서버에 남깁니다. 층마다 하나이고, 누가 이 층에 들어오든 이어서 편집합니다' : '웹에 반영하지 않고 이 층의 편집을 이 브라우저에 남깁니다. 층마다 하나이고, 이 층에 다시 들어오면 이어서 편집합니다'" @click="keepDraft()">임시 저장</button>
      <!-- 임시 저장본 폐기(OE-WF-04). 한 번 더 묻고, 반영된 레이아웃(없으면 BIM)으로 돌린다. 되돌릴 수 없다. -->
      <template v-if="canDiscardDraft">
        <template v-if="discardAsk">
          <span class="muted">되돌릴 수 없습니다</span>
          <button type="button" class="ghost danger" @click="discardFloorDraft">폐기</button>
          <button type="button" class="ghost" @click="discardAsk = false">취소</button>
        </template>
        <button v-else type="button" class="ghost" title="이 층의 임시 저장본을 지우고 반영된 레이아웃으로 돌아갑니다" @click="discardAsk = true">임시 저장본 폐기</button>
      </template>
      <!-- PRD #9 의 액션바. data/ 에서 연 건물은 첫 반영이 [구축하기](v1), 그다음은 [반영하기] 다(서버 버전, src/server/layouts.ts). 손으로 연 파일은 두 파일 내보내기. -->
      <button type="button" class="ghost" :aria-pressed="previewOpen" title="반영 전에 결과를 봅니다 — 변경 요약과 소속이 바뀔 설비(반영은 바뀌지 않습니다)" @click="previewChanges">미리보기</button>
      <button
        type="button"
        class="ghost primary-action"
        :class="{ done: justDone === 'build' }"
        :disabled="busy || publishing || !!buildBlock"
        :title="buildBlock ?? (serverKey ? (firstPublish ? '초기 온톨로지를 서버에 v1으로 생성합니다' : '편집 내용을 DT 3D 맵과 온톨로지에 반영하고 새 버전을 만듭니다') : '온톨로지 두 파일을 냅니다 — 기하(GeoJSON)와 관계(Brick TTL)')"
        @click="askPublish"
      >
        {{ serverKey && !firstPublish ? '반영하기' : '구축하기' }}
      </button>
      <button type="button" class="ghost" title="보기 모드로 돌아갑니다. 저장하지 않은 편집이 있으면 먼저 묻습니다" @click="leaveEdit()">편집 종료</button>
    </div>
    <!-- 미리보기(OE-WF-07~09). 반영 전 결과 — 변경 요약과 영향 목록. 반영(서버 버전)은 바뀌지 않는다. -->
    <div v-if="editing && previewOpen && previewData" class="preview-panel" role="region" aria-label="미리보기" data-testid="preview">
      <div class="preview-head">
        <b>미리보기</b>
        <span class="muted">반영 전 결과입니다. 반영된 레이아웃은 바뀌지 않습니다.</span>
        <button type="button" class="ghost" @click="previewOpen = false">닫기</button>
      </div>
      <p class="preview-summary" data-testid="preview-summary">{{ previewText }}</p>
      <ul v-if="previewData.moves.length || previewData.released.length" class="preview-impact" data-testid="preview-impact">
        <li v-for="c in previewData.moves" :key="c.equipmentId">
          <button type="button" class="link" @click="selectAndShow(c.equipmentId)">{{ c.equipmentName }}</button> · {{ reportPlace(c.fromSpaceId, c.equipmentId) }} → <b>{{ reportPlace(c.toSpaceId, c.equipmentId) }}</b>
        </li>
        <li v-for="r in previewData.released" :key="`rel-${r.id}`" class="released">
          <b class="review-tag">사람 지정 해제</b> <button type="button" class="link" @click="selectAndShow(r.id)">{{ r.name }}</button> · {{ spaceNameOf(r.from) }} → {{ spaceNameOf(r.to) }} ({{ r.reason }})
        </li>
      </ul>
      <p v-else class="muted">소속이 바뀔 설비가 없습니다.</p>
      <!-- 규칙 기반 경고(OE-P3-01~04). 막지 않는다 — 반영은 그대로 된다. -->
      <div class="preview-rules" data-testid="preview-rules">
        <b>규칙 경고</b> <span class="muted">(막지 않습니다)</span>
        <label>W-01 최소 면적 <input v-model.number="siteRules.minAreaM2" v-keep-typing type="number" min="0" step="0.5" class="riser-height" aria-label="W-01 최소 면적(㎡)" />㎡</label>
        <label><input v-model="siteRules.emptySpace" type="checkbox" /> W-02 설비 0개</label>
        <label><input v-model="siteRules.unmappedSpace" type="checkbox" /> W-03 공조존 미매핑</label>
        <ul v-if="ruleWarnings.length">
          <li v-for="w in ruleWarnings" :key="w.rule" :data-rule="w.rule">
            <b>{{ w.rule }}</b> {{ w.text }}: {{ w.items.length }}개 — {{ w.items.slice(0, 5).map((x) => x.label).join(', ') }}<template v-if="w.items.length > 5"> 외 {{ w.items.length - 5 }}개</template>
          </li>
        </ul>
        <span v-else class="muted"> 없음</span>
      </div>
    </div>
  </div>
</template>
