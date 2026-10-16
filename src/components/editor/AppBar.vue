<script setup lang="ts">
import type { PropType } from 'vue'
import { replayMemo } from '../../lib/replay-player'
import { discardDraft, draft, restoreDraft } from '../../editor/autosave'
import { appbar, selectAndShow } from '../../editor/chat-view'
import { busy, dark, dragging, editing, fileName, mode, toggleTheme } from '../../editor/core'
import { vKeepTyping } from '../../editor/edit-filter'
import { reportPlace, spaceNameOf } from '../../editor/edit-report'
import { draftTime, keepDraft, leaveEdit } from '../../editor/exit-edit'
import { helpOpen } from '../../editor/keyboard'
import { breadcrumb, canDiscardDraft, discardAsk, discardFloorDraft } from '../../editor/layout-storeys'
import { canAppend, onAppendPick, warnings } from '../../editor/open-file'
import { appendOver, exportGeoJSONDone, justDone, onAppendDrop, onDrop, onPick, previewChanges, previewData, previewOpen, previewText, ruleWarnings, siteRules } from '../../editor/open-many'
import { currentUser, editBlock, people, PERSON_ROLE } from '../../editor/people'
import { saveEdits } from '../../editor/progress'
import { editKind, serverKey } from '../../editor/projects'
import { buildBlock, firstPublish, grades, loadedVersion, newerLayout, notices, noticesOpen, openNotices, reloadLayout, unseenNotices } from '../../editor/publish'
import { readFeatures, readOpenings } from '../../editor/read-settings'
import { askPublish, publishing, versionTime } from '../../editor/reports'
import { export3D, exporting3d, exportTTLDone, fbxServer } from '../../editor/storey-progress'
import { copyShareLink, shareQuery, shareUrl } from '../../editor/share-link'
import { hasEdits } from '../../editor/versions'
import { changeCount } from '../../editor/changes'
import Roll from '../Roll.vue'
import { drawerOpen, openDrawer } from '../../editor/shell'
import ThemeIcon from '../ThemeIcon.vue'
import type { model as modelRef } from '../../editor/core'

// 헤더 한 줄(design-system.md 4장 "헤더 56"): 왼쪽은 어디 · 무엇(위치 · 모드 배지 · 편집 기준), 오른쪽은 동작. 파일 · 내보내기처럼 하루에 몇 번
// 안 누르는 것은 [파일 ▾] 에 넣는다. 편집 모드 전환(공간 · 설비)과 되돌리기는 레일, 그리드 · 스냅은 캔버스 아래 뷰 컨트롤로 옮겼다.
// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  model: { type: null as unknown as PropType<NonNullable<typeof modelRef.value>>, required: true },
})
</script>

<template>
  <div ref="appbar" v-memo="replayMemo()" class="appbar shell-head">
    <div class="appbar-row">
      <div class="file">
        <b class="shell-brand">Ontology <span>Editor</span></b>
        <h2 :title="fileName">{{ fileName }}</h2>
        <!-- 위치 표시 사이트 › 건물 › 층(OE-UI-04 AC14). 층은 보는 층(모든 층이면 "모든 층"). -->
        <span v-if="breadcrumb" class="muted crumbs-wrap"><span class="crumbs" data-testid="breadcrumb">{{ breadcrumb.site }} › {{ breadcrumb.building }} › {{ breadcrumb.storey }}</span></span>
        <!-- 모드 배지(design-system.md 6장): 운영 편집 = 정상, 초기 구축 = 주의, 보기 = 중립. -->
        <span
          class="mode-chip"
          :class="editing ? editKind : 'view'"
          data-testid="edit-kind"
          :title="editing ? (editKind === 'operate' ? '반영된 온톨로지가 있는 층을 이어서 고칩니다' : '온톨로지가 없는 층을 처음 만듭니다') : '보기 모드입니다. 고치려면 [편집] 을 누릅니다 (E)'"
        >
          {{ editing ? (editKind === 'operate' ? '운영 편집' : '초기 구축') : '보기' }}
        </span>
        <!-- 편집 기준 버튼(OE-UI-18). 누르면 기준 · 검증 드로어 — 생성 기준 · 등급 · 경고 · 리포트 · 검사 · 표가 여기 있다. -->
        <button type="button" class="shell-basis" :aria-expanded="drawerOpen" data-testid="basis-button" title="생성 기준 · 수용 기준선 등급 · 규칙 경고 · 리포트를 엽니다" @click="drawerOpen = !drawerOpen">
          {{ editKind === 'operate' && loadedVersion ? `기준 v${loadedVersion}` : '기준 임포트 결과' }}
          <span v-if="grades" :class="['badge', grades.gate ? 'ok' : 'warn']">{{ grades.gate ? '생성 가능' : '보정 필요' }}</span>
          <span aria-hidden="true">{{ drawerOpen ? '▴' : '▾' }}</span>
        </button>
        <button v-if="warnings.length" type="button" class="warn-count" title="읽으면서 건너뛴 것. 목록은 기준 · 검증 패널에 있습니다." @click="openDrawer('warnings')">경고 {{ warnings.length }}</button>
      </div>
      <div class="bar-actions">
        <!-- 파일 · 내보내기 메뉴. 하루에 몇 번 안 누르는 것들이라 헤더에서 내렸다. -->
        <details class="shell-menu">
          <summary title="열기 · 덧붙이기 · 저장 · 내보내기">파일 ▾</summary>
          <div class="shell-menu-body">
            <label
              class="ghost drop compact"
              :class="{ over: dragging }"
              title="다른 IFC 열기 (여기에 드래그해서 놓아도 됩니다)"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="onDrop"
            >
              열기
              <input type="file" accept=".ifc,.idf" multiple :disabled="busy" @change="onPick" />
            </label>
            <label
              class="ghost append"
              :class="{ disabled: !canAppend, over: appendOver }"
              :aria-disabled="!canAppend"
              :title="
                hasEdits
                  ? '열린 파일에 합치기. 지금까지 한 편집은 합친 모델에 다시 얹습니다(되돌리기 이력은 끊깁니다). 여기에 드래그해서 놓아도 됩니다'
                  : '열린 파일에 합치기 — 건축·설비 IFC(합쳐야 설비가 어느 방에 있는지 나옵니다) 또는 IDF(공조존). 여기에 드래그해서 놓아도 됩니다'
              "
              @dragover.prevent="appendOver = canAppend"
              @dragleave.prevent="appendOver = false"
              @drop.prevent="onAppendDrop"
            >
              덧붙이기
              <input type="file" accept=".ifc,.idf" multiple :disabled="busy || !canAppend" @change="onAppendPick" />
            </label>
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
            <template v-if="editing">
              <span class="shell-menu-head">저장</span>
              <button v-if="serverKey" type="button" class="ghost" title="서버에 저장하지 않고 편집 파일(JSON)로만 내려받습니다" @click="saveEdits(true)">파일로</button>
            </template>
            <span class="shell-menu-head">내보내기</span>
            <!-- 여는·합치는 중(busy)에는 막는다. 건축·설비를 같이 열 때 설비를 읽는 동안 누르면 건축만 든 파일이 나갔다. -->
            <span class="shell-menu-row">
              <button type="button" class="ghost" aria-label="기하 내보내기 (GeoJSON)" title="형상 내보내기 (층마다 GeoJSON 파일 하나)" :disabled="busy" :class="{ done: justDone === 'geojson' }" @click="exportGeoJSONDone">GeoJSON</button>
              <button type="button" class="ghost" aria-label="의미 내보내기 (Brick TTL)" title="관계 내보내기 (Brick TTL 파일 하나)" :disabled="busy" :class="{ done: justDone === 'ttl' }" @click="exportTTLDone">TTL</button>
              <button type="button" class="ghost" aria-label="3D 형상 내보내기 (GLB)" title="3D 형상 내보내기 (GLB 파일 하나, 요소 이름은 GlobalId)" :disabled="busy || !!exporting3d" :aria-busy="exporting3d === 'glb'" :class="{ done: justDone === 'glb' }" @click="export3D('glb')">{{ exporting3d === 'glb' ? 'GLB…' : 'GLB' }}</button>
              <button type="button" class="ghost" aria-label="3D 형상 내보내기 (OBJ)" title="3D 형상 내보내기 (OBJ 파일 하나, 요소 이름은 GlobalId)" :disabled="busy || !!exporting3d" :aria-busy="exporting3d === 'obj'" :class="{ done: justDone === 'obj' }" @click="export3D('obj')">{{ exporting3d === 'obj' ? 'OBJ…' : 'OBJ' }}</button>
              <button type="button" class="ghost" aria-label="3D 형상 내보내기 (FBX)" :title="fbxServer.enabled ? '3D 형상 내보내기 (FBX 파일 하나, 요소 이름은 GlobalId, 서버에서 GLB 를 변환)' : fbxServer.reason" :disabled="busy || !!exporting3d || !fbxServer.enabled" :aria-busy="exporting3d === 'fbx'" :class="{ done: justDone === 'fbx' }" @click="export3D('fbx')">{{ exporting3d === 'fbx' ? 'FBX…' : 'FBX' }}</button>
            </span>
            <!-- 지금 파일·층·고른 것을 다시 여는 주소(share-link.ts). data/ 목록·프로젝트로 연 파일만 주소가 있다. -->
            <button
              v-if="shareUrl"
              type="button"
              class="link share-link"
              data-testid="share-link"
              :title="`이 파일${shareQuery?.get('storey') ? '·층' : ''}${shareQuery?.get('select') ? '·선택 항목' : ''}을 여는 링크를 복사합니다(편집은 담지 않습니다)`"
              @click="copyShareLink"
            >
              링크 복사
            </button>
          </div>
        </details>
        <!-- 사람(OE-COM-01) · 알림(OE-WF-16). -->
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
        <button type="button" class="ghost keys-help" title="조작·단축키 안내 (?)" aria-label="조작·단축키 안내" @click="helpOpen = true">?</button>
        <button type="button" class="ghost theme icon-btn" :aria-pressed="dark" aria-label="다크 모드" :title="dark ? '라이트 모드로 바꿉니다' : '다크 모드로 바꿉니다'" @click="toggleTheme"><ThemeIcon :dark="dark" /></button>
        <span class="bar-sep" aria-hidden="true"></span>
        <!-- 보기와 편집. 편집은 고치는 손잡이를 드러낼 뿐이고 편집한 결과는 모드를 바꿔도 남는다. -->
        <div v-if="!editing" class="mode-switch" role="group" aria-label="화면 모드">
          <button type="button" :aria-pressed="mode === 'view'" title="보기 모드로 전환 (E)" @click="leaveEdit()">보기</button>
          <button type="button" :aria-pressed="mode === 'edit'" :disabled="busy || !!editBlock" :title="editBlock ?? '편집 모드로 전환 (E)'" @click="mode = 'edit'">편집</button>
        </div>
        <!-- PRD #9 의 액션바. 채움 단추는 [반영하기]/[구축하기] 하나, [편집 종료] 는 위험 선 단추(design-system.md 4장). -->
        <div v-else class="edit-bar shell-actions" role="group" aria-label="편집 동작">
          <!-- 편집 저장과 임시 저장은 둘 다 보인다. 하나만 보이면 둘이 무엇이 다른지 더 헷갈린다. -->
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
          <button type="button" class="ghost" :title="people ? '반영하지 않고 이 층의 편집을 서버에 남깁니다. 층마다 하나이고, 누가 이 층에 들어오든 이어서 편집합니다' : '웹에 반영하지 않고 이 층의 편집을 이 브라우저에 남깁니다. 층마다 하나이고, 이 층에 다시 들어오면 이어서 편집합니다'" @click="keepDraft()">임시 저장</button>
          <button type="button" class="ghost" :aria-pressed="previewOpen" title="반영 전에 결과를 봅니다 — 변경 요약과 소속이 바뀔 설비(반영은 바뀌지 않습니다)" @click="previewChanges">미리보기</button>
          <!-- 막힌 이유 칩(design-system.md 5장). 누르면 기준 · 검증 드로어. -->
          <button v-if="buildBlock" type="button" class="shell-block" :title="buildBlock" @click="openDrawer()">{{ serverKey && !firstPublish ? '반영' : '구축' }} 막힘 · {{ buildBlock.startsWith('생성 전') ? '생성 전 검증' : '기준선 미달' }}</button>
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
          <button type="button" class="ghost shell-exit" title="보기 모드로 돌아갑니다. 저장하지 않은 편집이 있으면 먼저 묻습니다" @click="leaveEdit()">편집 종료</button>
        </div>
      </div>
    </div>
    <!-- 안내 바(OE-UI-18, 36). 지금 무엇을 기준으로 편집하는지 한 줄과, 그 상황을 푸는 단추 하나. -->
    <div class="shell-info" role="status" data-testid="info-bar">
      <template v-if="editing">
        <span class="shell-info-icon" aria-hidden="true">◇</span>
        <b>{{ canDiscardDraft ? '임시 저장본에서 이어서 편집 중' : editKind === 'operate' && loadedVersion ? `반영본 v${loadedVersion} 에서 편집 중` : '임포트 결과에서 편집 중' }}</b>
        <span class="muted">| {{ editKind === 'operate' ? '[반영하기]로 이 층을 DT 에 반영합니다.' : serverKey ? '층마다 임시 저장하고 [구축하기]로 v1 을 만듭니다.' : '[구축하기]로 온톨로지 두 파일(GeoJSON · TTL)을 냅니다.' }}</span>
        <span class="grow"></span>
        <!-- 바뀐 것의 수. 누르면 작업 화면 아래 바뀐 내용 목록으로 간다. -->
        <button type="button" class="link shell-changes" data-testid="changes-link" title="바뀐 내용 목록으로 갑니다" @click="openDrawer('changes')"><b>편집 중</b> · 바뀐 것 <Roll :value="changeCount" :count-up="false" />건</button>
        <!-- 임시 저장본 폐기(OE-WF-04). 한 번 더 묻고, 반영된 레이아웃(없으면 BIM)으로 돌린다. 되돌릴 수 없다. -->
        <template v-if="canDiscardDraft">
          <template v-if="discardAsk">
            <span class="muted">되돌릴 수 없습니다</span>
            <button type="button" class="ghost danger" @click="discardFloorDraft">폐기</button>
            <button type="button" class="ghost" @click="discardAsk = false">취소</button>
          </template>
          <button v-else type="button" class="ghost" title="이 층의 임시 저장본을 지우고 반영된 레이아웃으로 돌아갑니다" @click="discardAsk = true">임시 저장본 폐기</button>
        </template>
      </template>
      <template v-else>
        <span class="shell-info-icon" aria-hidden="true">◇</span>
        <b>보기 모드</b>
        <span class="muted">| 3D · 평면도에서 고르면 오른쪽에 뜹니다. 고치려면 [편집] 을 누릅니다 (E).</span>
      </template>
    </div>
    <!-- 자동 저장 복구(OE-HIST-04). 묻는 말과 [예]·[아니오] 는 PRD 문구 그대로다. -->
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
    <!-- 미리보기(OE-WF-07~09). 반영 전 결과 — 변경 요약과 영향 목록. 반영(서버 버전)은 바뀌지 않는다. 캔버스 위에 뜬다. -->
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
