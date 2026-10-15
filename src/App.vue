<script setup lang="ts">
// 편집기 화면의 껍데기. 상태·동작은 src/editor/, 화면 조각은 src/components/editor/ 에 있다(docs/dev/app-structure.md).
import { replayMemo } from './lib/replay-player'
import ExitEditDialog from './components/ExitEditDialog.vue'
import HoverTip from './components/HoverTip.vue'
import PublishDialog from './components/PublishDialog.vue'
import ShortcutHelp from './components/ShortcutHelp.vue'
import Src from './components/Src.vue'
import { floorName } from './editor/autosave'
import { changeCount } from './editor/changes'
import { fullscreen, stage } from './editor/chat-view'
import { checks, serviceSummary } from './editor/checks'
import { counts, editing, error, errorEl, fileName, mode, model } from './editor/core'
import { dirtyFloorNames, exitAsk, exitCommitting, exitDiscarding, exitKeeping, exitSaving } from './editor/exit-edit'
import { ruleSystems } from './editor/flow-rules'
import { hoverTip } from './editor/hover-tip'
import { zoneRows } from './editor/idf-zones'
import { helpOpen } from './editor/keyboard'
import { kindSummary } from './editor/kinds'
import { previewFromPublish, previewText } from './editor/open-many'
import { currentUser, people } from './editor/people'
import { elapsed, progress, progressDetail, progressFile, progressPct, progressTitle } from './editor/progress'
import { serverKey } from './editor/projects'
import { firstPublish } from './editor/publish'
import { nextVersion, publishAsk, publisher, publishFloors, publishing, publishLayout } from './editor/reports'
import AppBar from './components/editor/AppBar.vue'
import ChecksFold from './components/editor/ChecksFold.vue'
import EditorSection from './components/editor/EditorSection.vue'
import IdfZonesFold from './components/editor/IdfZonesFold.vue'
import KindsFold from './components/editor/KindsFold.vue'
import ReviewPanel from './components/editor/ReviewPanel.vue'
import RuleSystemsFold from './components/editor/RuleSystemsFold.vue'
import ServiceFold from './components/editor/ServiceFold.vue'
import SidePanel from './components/editor/SidePanel.vue'
import StartScreen from './components/editor/StartScreen.vue'
import StoreysFold from './components/editor/StoreysFold.vue'
import ViewportPanel from './components/editor/ViewportPanel.vue'
import { setupEditor } from './editor/index'

setupEditor()

</script>

<template>
  <main :class="model ? ['has-model', `mode-${mode}`] : ''">
    <StartScreen />

    <p v-if="error" ref="errorEl" class="error" role="alert">{{ error }}</p>

    <template v-if="model && counts">
      <!-- 파일을 연 뒤의 도구막대. 스크롤과 상관없이 위에 붙는다. 파일·모드·내보내기가 여기 모이고, 편집 중에는 한 줄이
           더 붙어 바뀐 것의 수와 되돌리기가 따라온다. 온종일 3D 를 보며 고치는 화면이라 큰 머리말과 파일 받는 칸은 접는다. -->
      <AppBar :model="model" />

      <!-- 작업 화면: 3D 와 오른쪽 패널이 화면 높이를 나눠 쓴다. 3D 에서 누른 것이 스크롤 없이 바로 옆에 뜬다.
           전체 화면도 이 둘을 같이 띄운다. -->
      <div ref="stage" :class="['stage', 'workspace', { full: fullscreen }]">
        <HoverTip ref="hoverTip" />
        <ViewportPanel :counts="counts" :model="model" />

        <!-- 편집 리플레이 동안(극장이 창을 덮는다) 아래 패널은 다시 그리지 않는다(replayMemo). 닫으면 그때 상태로 한 번 그린다. -->
        <SidePanel :counts="counts" :model="model" />
      </div>

      <ReviewPanel :counts="counts" :model="model" />

      <!-- 3D 아래는 전부 접을 수 있다. 행이 많은 목록은 처음부터 접혀 있다(SMALL).
           파일이 바뀌면(key) 접힘 상태도 그 파일 기준으로 다시 정한다. -->
      <div :key="fileName" v-memo="replayMemo()" class="folds">
        <!-- 완전성 검사. 규칙마다 통과 수와 어긴 것. 펼치면 목록과 3D 에 어긴 것이 뜬다. -->
        <ChecksFold v-if="checks.length" :checks="checks" />

        <!-- 규칙 방향을 계통별로. 확정할 것이 무엇이 남았는지와 그 근거(포트와의 일치율)를 한 표로 본다. -->
        <RuleSystemsFold v-if="ruleSystems.length" :rule-systems="ruleSystems" />

        <StoreysFold :model="model" />

        <KindsFold v-if="kindSummary" :kind-summary="kindSummary" />

        <!-- 공조존(IDF, F12). 존마다 든 방과 담당(말단 → 원천). IDF 가 말한 것이라 규칙 방향과 달리 확정 없이 나간다. -->
        <IdfZonesFold v-if="zoneRows.length" :model="model" :zone-rows="zoneRows" />

        <!-- 원천별 담당 공간. 계통도를 그리기 전에 "어느 기기가 어느 방을 맡는가" 를 한 장으로 본다. -->
        <ServiceFold v-if="serviceSummary && serviceSummary.rows.length" :service-summary="serviceSummary" />

        <!-- 편집. 3D 조작 대신 값을 직접 고친다. PoC 에서 확인할 것은 조작감이 아니라
             한 번의 편집이 온톨로지의 어느 관계를 바꾸는가이기 때문이다. -->
        <!-- 보기 모드에서도 설비 목록은 남긴다(이름으로 찾아 고르는 길이다). 고치는 칸과 물리존 편집만 숨긴다. -->
        <EditorSection :counts="counts" :model="model" />
      </div>

      <!-- 내보내기 버튼은 위 도구막대에 있다. 여기는 두 파일이 무엇을 나눠 갖는지만 적는다. -->
      <section v-memo="replayMemo()" class="actions">
        <p class="note">
          <b>내보내기</b>(도구막대의 GeoJSON · TTL · GLB · OBJ).
          두 파일은 같은 id로 연결됩니다. 형상은 GeoJSON, 설비와 계통의 관계는 TTL에 들어갑니다.
          벽·문·창과 문이 연결하는 공간은 GeoJSON에만 있습니다(Brick에 건축 부재 클래스가 없음).
          벽·문·창은 '읽을 것'에서 켠 것만 들어가고, 문·창 위치는 '문·창 자리'를 켜고 연 파일에서만 나갑니다.
          TTL의 설비·방 클래스는 <Src kind="dict" /> 기준이고, 규칙 방향은 확정한 계통만 들어갑니다.
          GLB · OBJ는 보여 주기용 3D 형상입니다. 요소 이름이 같은 id(GlobalId)이고, 좌표는 y가 위인 미터입니다.
          고친 벽은 지금 외곽선을 층 높이로 세우고, 방은 얇은 판입니다. 큰 파일은 OBJ가 GLB보다 몇 배 크니 GLB를 권합니다.
        </p>
      </section>
    </template>
    <ShortcutHelp :open="helpOpen" :editing="editing" @close="helpOpen = false" />
    <PublishDialog
      :open="publishAsk"
      :first="firstPublish"
      :next="nextVersion"
      :floors="publishFloors"
      :edits="changeCount"
      :busy="publishing"
      :by="people ? currentUser : publisher"
      :fixed="!!people"
      :summary="previewText"
      :unsaved="publishAsk ? dirtyFloorNames() : []"
      @preview="previewFromPublish"
      @publish="publishLayout"
      @cancel="publishAsk = false"
    />
    <ExitEditDialog :open="!!exitAsk" :count="exitAsk?.count ?? 0" :server="!!serverKey" :floor="exitAsk?.floor ? { from: floorName(exitAsk.floor.from), to: floorName(exitAsk.floor.to) } : null" :floors="exitAsk && !exitAsk.floor ? dirtyFloorNames() : []" @commit="exitCommitting" @save="exitSaving" @keep="exitKeeping" @discard="exitDiscarding" @cancel="exitAsk = null" />
    <!-- 진행 표시. 스크롤 위치와 상관없이 보이도록 화면 아래에 띄운다. -->
    <div v-if="progress" class="progress-toast" role="status" aria-live="polite">
      <div v-if="progressFile" class="muted progress-file">{{ progressFile }}</div>
      <div class="progress-head">
        <span>{{ progressTitle }}</span>
        <span class="muted mono">{{ elapsed }}초</span>
      </div>
      <div class="bar" :class="{ indeterminate: progressPct === null }">
        <i :style="progressPct !== null ? { width: `${progressPct}%` } : undefined"></i>
      </div>
      <div v-if="progressDetail" class="muted progress-detail mono">{{ progressDetail }} · {{ progressPct }}%</div>
    </div>
  </main>
</template>
