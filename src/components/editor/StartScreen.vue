<script setup lang="ts">
import { josa } from '../../lib/josa'
import { appendData, baseName, dataFiles, dataPicked, idfAt, mb, openableDataFiles, openData, openDataSet, openSetList, partnerOf, profileAt, profiles, roleHint, toggleDataPick } from '../../editor/chat-view'
import { busy, dark, dragging, model, toggleTheme } from '../../editor/core'
import { canAppend } from '../../editor/open-file'
import { onDrop, onPick } from '../../editor/open-many'
import { currentUser, people, PERSON_ROLE } from '../../editor/people'
import { createProject, fieldOf, openProject, openWithMode, projectBlock, projectList, projectRows, publishedFor, savedFor, savedSets, when } from '../../editor/projects'
import { readFeatures, readOpenings } from '../../editor/read-settings'
import Fold from '../Fold.vue'
import ProjectList from '../ProjectList.vue'
import ThemeIcon from '../ThemeIcon.vue'
import TierChips from '../TierChips.vue'
</script>

<template>
  <header v-if="!model">
    <div class="title">
      <div>
        <h1>ontology-editor</h1>
        <p class="sub">BIM(IFC)을 읽어 공간 온톨로지 초안을 만듭니다. 내보낸 TTL·GeoJSON 은 <a href="./viewer.html">내보낸 파일 보기</a>에서 다시 열어 봅니다.</p>
      </div>
      <button type="button" class="theme icon-btn" :aria-pressed="dark" aria-label="다크 모드" :title="dark ? '라이트 모드로 바꿉니다' : '다크 모드로 바꿉니다'" @click="toggleTheme">
        <ThemeIcon :dark="dark" />
      </button>
    </div>
  </header>

  <!-- 프로젝트 목록(OE-UI-02·03). 첫 화면이다. 서버가 없으면 보이지 않고 아래 파일 상자부터다. -->
  <template v-if="!model && projectRows">
    <label v-if="people" class="who projects-who" title="프로젝트를 만든 사람·임시 저장한 사람으로 남습니다(data/.users.json)">
      <select v-model="currentUser" aria-label="사용자">
        <option value="">사용자 고르기…</option>
        <option v-for="p in people" :key="p.name" :value="p.name">{{ p.name }} · {{ PERSON_ROLE[p.role] }}</option>
      </select>
    </label>
    <ProjectList ref="projectList" :rows="projectRows" :create-block="projectBlock" :busy="busy" :field-of="fieldOf" :when="when" @open="openProject" @create="createProject" />
  </template>

  <section
    v-if="!model"
    class="drop"
    :class="{ over: dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <p v-if="busy">읽는 중…</p>
    <template v-else>
      <p>IFC 파일을 여기에 드래그해서 놓으세요.</p>
      <p class="muted drop-multi">건축과 설비가 다른 파일이면 <b>둘을 같이</b> 놓거나 고르세요(Ctrl·Shift 로 여러 개). 하나로 합쳐 엽니다. IDF 도 같이 고르면 공조존까지 얹고, IDF 만 열면 공조존을 3D 로 봅니다.</p>
    </template>
    <label class="pick">
      파일 선택
      <input type="file" accept=".ifc,.idf" multiple :disabled="busy" @change="onPick" />
    </label>

  </section>

  <!-- 읽을 것(피처 단위). 파일 상자 안에 두었더니 [파일 선택] 에만 걸리는 옵션처럼 보였다 — 파일 선택·드래그 앤 드롭·바로 열기·data/ 목록·
       덧붙이기 어디서 열든 같은 값을 쓴다(load 의 options). 그래서 상자 밖 한 줄로 둔다. 다음에 여는 파일부터 적용된다. -->
  <section v-if="!model" class="read-settings" aria-label="읽을 것">
    <fieldset class="read-option features" :disabled="busy">
      <legend>읽을 것</legend>
      <label><input v-model="readFeatures.walls" type="checkbox" /> 벽</label>
      <label><input v-model="readFeatures.doors" type="checkbox" /> 문</label>
      <label><input v-model="readFeatures.windows" type="checkbox" /> 창</label>
      <label :class="{ off: !readFeatures.doors && !readFeatures.windows }">
        <input v-model="readOpenings" type="checkbox" :disabled="!readFeatures.doors && !readFeatures.windows" /> 문·창 자리(형상)
      </label>
      <span class="muted">
        어디서 열든 적용됩니다(파일 선택·드래그 앤 드롭·바로 열기·data/ 목록·덧붙이기). 물리존·설비는 늘 읽습니다. 벽·문·창은 GeoJSON에만
        나가고 온톨로지(TTL)에는 필요 없어서, 끄면 큰 파일이 빨리 열립니다. 문·창 자리는 로봇 경로와 문·창 옮기기에 씁니다.
      </span>
    </fieldset>
  </section>

  <!-- 바로 열기(data/.open-sets.json). 같이 여는 파일 묶음을 한 번에 — [합쳐서 열기] 와 같다. -->
  <section v-if="openSetList.length && !model" class="open-sets" aria-label="바로 열기">
    <b>바로 열기</b>
    <button
      v-for="set in openSetList"
      :key="set.title"
      type="button"
      class="ghost"
      :disabled="busy"
      :title="set.paths.join(' + ')"
      @click="openDataSet(set.paths)"
    >
      {{ set.title }} <small class="muted">{{ set.paths.length }}개</small>
    </button>
  </section>

  <!-- 합쳐 연 판의 8084 저장본. 한 파일의 저장본은 아래 data/ 목록의 그 줄에 보인다. 임시 저장본은 목록을 두지 않는다 —
       층마다 하나라 그 층에 들어가면 바로 얹힌다(OE-COM-08 · OE-WF-03). -->
  <section v-if="savedSets.some((s) => s.paths.length > 1)" class="catalog resume">
    <Fold :key="model ? 'loaded' : 'empty'" title="서버에 저장한 편집" :meta="`${savedSets.filter((s) => s.paths.length > 1).length}건`" :default-open="!model">
      <table>
        <tbody>
          <tr v-for="sv in savedSets.filter((s) => s.paths.length > 1)" :key="'saved:' + sv.key" class="saved-row">
            <td class="name">
              <span>{{ sv.paths.map(baseName).join(' + ') }}</span>
              <span class="muted">서버 저장 · 편집 {{ sv.count }}건 · {{ when(sv.savedAt) }}</span>
            </td>
            <td class="row-actions">
              <button type="button" class="ghost" :disabled="busy" @click="openDataSet(sv.paths)">합쳐서 열기</button>
            </td>
          </tr>
        </tbody>
      </table>
    </Fold>
  </section>

  <!-- data/ 의 샘플. 파일마다 온톨로지를 어디까지 채우는지 먼저 보고 고른다. -->
  <section v-if="dataFiles.length" class="catalog">
    <!-- 파일을 연 뒤에는 접어 둔다. 목록이 3D 와 검토 화면을 아래로 밀어낸다. 덧붙일 때 다시 편다. -->
    <Fold :key="model ? 'loaded' : 'empty'" title="data/ 의 IFC·IDF" :meta="`${openableDataFiles.length}개`" :default-open="!model">
      <p v-if="dataPicked.length" class="catalog-pick">
        <button type="button" class="pick" :disabled="busy" @click="openDataSet(dataPicked)">
          고른 {{ dataPicked.length }}개 {{ dataPicked.length > 1 ? '합쳐서 열기' : '열기' }}
        </button>
        <span class="muted">{{ dataPicked.map(baseName).join(' + ') }}</span>
        <button type="button" class="link" @click="dataPicked = []">고르기 취소</button>
      </p>
      <p class="hint">
        건축·설비를 같이 쓰려면 왼쪽 칸에 둘 다 표시하고 [합쳐서 열기]를 누르세요.
        칸마다 얼마나 채워졌는지 보입니다. 공간(외곽선이 있는 물리존) · 설비(좌표가 있는 기기) · 소속(방을 찾은 기기) ·
        연결망(연결 수) · 방향(흐름 방향을 아는 기기 비율). 마우스를 올리면 자세히 보입니다.
      </p>
      <table>
        <tbody>
          <!-- 열 수 없는 파일(STEP 구문 오류 등 — 55 의 Duplex COBie 셋)은 목록에서 뺀다. 열어도 오류뿐이라 고를 까닭이 없다(2026-10-15 사용자). -->
          <tr v-for="f in openableDataFiles" :key="f.path" :class="{ picked: dataPicked.includes(f.path) }">
            <td class="pick-cell">
              <input type="checkbox" :checked="dataPicked.includes(f.path)" :aria-label="`${f.path} 같이 열기`" @change="toggleDataPick(f.path)" />
            </td>
            <td class="name">
              <span>{{ f.path }}</span>
              <span class="muted">{{ mb(f.size) }}<template v-if="profileAt(f.path)"> · {{ profileAt(f.path)!.schema }}</template></span>
            </td>
            <td class="chips">
              <span v-if="!profiles[f.path]" class="muted">분석 중…</span>
              <!-- 모양이 다른 응답(옛 서버 등)이 오면 칩 없이 둔다. `!` 로 밀어붙였더니 목록 렌더가 멈춰 그 뒤 화면 갱신이 꼬였다. -->
              <span v-else-if="idfAt(f.path)" class="muted">
                IDF · 공조존 {{ idfAt(f.path)!.zones }} · 바닥 {{ idfAt(f.path)!.floors }} · 설비 {{ idfAt(f.path)!.equipment }} — 혼자 열면 공조존만, IFC 와 합쳐 열면 방에 얹습니다
              </span>
              <template v-else-if="profileAt(f.path)">
                <TierChips :tiers="profileAt(f.path)!.tiers" />
                <span v-if="roleHint(profileAt(f.path)!)" class="muted role">{{ roleHint(profileAt(f.path)!) }}</span>
                <button
                  v-if="!model && partnerOf(f.path)"
                  type="button"
                  class="link pair"
                  :disabled="busy"
                  :title="`${f.path} + ${partnerOf(f.path)}`"
                  @click="openDataSet([f.path, partnerOf(f.path)!])"
                >
                  짝 {{ baseName(partnerOf(f.path)!) }}{{ josa(baseName(partnerOf(f.path)!), '과/와') }} 합쳐서 열기
                </button>
              </template>
            </td>
            <td class="row-actions">
              <span v-if="savedFor(f.path)" class="saved-chip" :title="`서버에 저장된 편집 ${savedFor(f.path)!.count}건 — 열면 적용되어 표시됩니다`">
                저장 {{ savedFor(f.path)!.count }}건 · {{ when(savedFor(f.path)!.savedAt) }}
              </span>
              <span v-if="!model && publishedFor(f.path)" class="saved-chip published-chip" :title="`${publishedFor(f.path)!.by} · ${when(publishedFor(f.path)!.at)}`">반영 v{{ publishedFor(f.path)!.current }}</span>
              <button type="button" class="ghost" :disabled="busy" @click="openData(f.path)">열기</button>
              <!-- 모드 버튼(OE-UI-03). 반영된 온톨로지가 있는지로 하나만 켜진다. -->
              <template v-if="!model">
                <button
                  type="button"
                  class="ghost"
                  :disabled="busy || !!publishedFor(f.path)"
                  :title="publishedFor(f.path) ? `반영된 온톨로지(v${publishedFor(f.path)!.current})가 있어 운영 편집으로 엽니다` : '온톨로지가 없는 건물을 BIM 에서 처음 만듭니다'"
                  @click="openWithMode(f.path)"
                >
                  초기 구축
                </button>
                <button
                  type="button"
                  class="ghost"
                  :disabled="busy || !publishedFor(f.path)"
                  :title="publishedFor(f.path) ? `반영된 v${publishedFor(f.path)!.current} 에서 이어 고칩니다` : '반영된 온톨로지가 없습니다. 초기 구축으로 먼저 만듭니다'"
                  @click="openWithMode(f.path)"
                >
                  운영 편집
                </button>
              </template>
              <button v-if="canAppend" type="button" class="ghost" :disabled="busy" @click="appendData(f.path)">덧붙이기</button>
            </td>
          </tr>
        </tbody>
      </table>
    </Fold>
  </section>
</template>
