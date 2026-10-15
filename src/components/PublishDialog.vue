<script setup lang="ts">
// [반영하기]·[구축하기] 확인 창(OE-WF-11·12). 반영 전 변경 요약(대상 층·바뀐 것)을 보이고 반영자를 받는다. 반영하면 서버에 새 버전이
// 생기고(src/server/layouts.ts), 다른 사람의 화면은 새로고침할 때 바뀐다(OE-WF-14). ExitEditDialog 와 같은 네이티브 <dialog> 라 Esc 는 취소다.
import { ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  /** 첫 반영이면 구축하기(v1, OE-GEN-05). */
  first: boolean
  next: number
  floors: string[]
  edits: number
  busy: boolean
  by: string
  /** 반영자가 화면 위에서 고른 사람이면 칸 대신 이름만 보인다(OE-COM-01). */
  fixed?: boolean
  /** 미리보기와 같은 변경 요약(OE-WF-12). */
  summary?: string
  /**
   * 임시 저장하지 않은 편집이 있는 층(OE-UI-04 AC12). 구축하기에서 있으면 [구축하기] 대신 [임시 저장 후 구축]·[저장한 내용으로 구축]을 둔다.
   * 각 층은 임시 저장한 내용(없으면 임포트 결과)으로 구축하는 것이 기준이라, 저장 안 한 편집을 넣을지 사람이 고른다.
   */
  unsaved?: string[]
}>()
/** `how`: 'save' 는 임시 저장한 뒤 구축, 'saved' 는 저장 안 한 편집을 빼고 구축, 'all' 은 지금 화면 그대로(저장 안 한 층이 없을 때). */
const emit = defineEmits<{ publish: [by: string, how: 'all' | 'save' | 'saved']; cancel: []; preview: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const primaryBtn = ref<HTMLButtonElement | null>(null)
const name = ref(props.by)
watch(
  () => [props.open, dialog.value] as const,
  ([open, el]) => {
    if (!el) return
    if (open && !el.open) {
      name.value = props.by
      el.showModal()
      primaryBtn.value?.focus()
    } else if (!open && el.open) el.close()
  },
)
</script>

<template>
  <dialog ref="dialog" class="publish-dialog" aria-modal="true" aria-labelledby="publish-title" @close="open && emit('cancel')">
    <form class="exit-edit-body" @submit.prevent="name.trim() && emit('publish', name.trim(), first && unsaved?.length ? 'save' : 'all')">
      <h2 id="publish-title">{{ first ? '구축하기' : '반영하기' }} — v{{ next }}</h2>
      <p>
        {{ first ? '초기 온톨로지를 v1으로 생성합니다.' : '편집 내용을 DT 3D 맵과 온톨로지에 한 번에 반영하고 새 버전을 만듭니다.' }}
        반영된 내용은 다른 사용자가 새로고침할 때 표시됩니다.
      </p>
      <ul class="hint" data-testid="publish-summary">
        <li><b>대상 층</b>: {{ floors.length ? floors.join(' · ') : '없음' }}</li>
        <li><b>변경 내역</b>: 편집 {{ edits }}건</li>
        <li v-if="summary"><b>변경 요약</b>: {{ summary }}</li>
        <li><b>생성 항목</b>: 온톨로지(TTL) · 층별 GeoJSON · 3D 형상(GLB) · 편집 파일 · 공간 계층 · 리포트</li>
      </ul>
      <p v-if="first && unsaved?.length" class="publish-unsaved" data-testid="publish-unsaved">
        임시 저장하지 않은 편집이 있는 층: <b>{{ unsaved.join(' · ') }}</b>. 각 층은 임시 저장한 내용(없으면 임포트 결과)으로 구축합니다.
        [저장한 내용으로 구축]을 선택하면 이 편집은 구축에서 제외하고 화면에서도 되돌립니다(상단 바의 [이어서 하기]로 복구할 수 있습니다).
      </p>
      <p v-if="fixed" class="publish-by" data-testid="publisher">반영자 <b>{{ by || '(사용자를 선택하세요)' }}</b></p>
      <label v-else class="publish-by">반영자 <input v-model="name" type="text" aria-label="반영자" required /></label>
      <div class="exit-edit-actions">
        <template v-if="first && unsaved?.length">
          <button type="submit" class="ghost primary-action" :disabled="busy || !name.trim()">{{ busy ? '올리는 중…' : '임시 저장 후 구축' }}</button>
          <button type="button" class="ghost" :disabled="busy || !name.trim()" @click="emit('publish', name.trim(), 'saved')">저장한 내용으로 구축</button>
        </template>
        <button v-else type="submit" class="ghost primary-action" :disabled="busy || !name.trim()">{{ busy ? '올리는 중…' : first ? '구축하기' : '반영하기' }}</button>
        <button type="button" class="ghost" :disabled="busy" @click="emit('preview')">미리보기</button>
        <button type="button" class="ghost" :disabled="busy" @click="emit('cancel')">취소</button>
      </div>
    </form>
  </dialog>
</template>
