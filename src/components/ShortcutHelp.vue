<script setup lang="ts">
// `?` 로 뜨는 조작·단축키 안내. 마우스 조작은 여기 적고, 단축키는 lib/shortcuts.ts 의 표 그대로다 — 키를 받는 쪽과 같은 표를 읽어야
// 안내와 실제가 어긋나지 않는다. 네이티브 <dialog> 라 Esc·바깥 누르기로 닫히고, 열린 동안 뒤는 눌리지 않는다.
import { computed, ref, watch } from 'vue'
import { SHORTCUT_GROUPS, SHORTCUTS } from '../lib/shortcuts'

const props = defineProps<{ open: boolean; editing: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
watch(
  () => [props.open, dialog.value] as const,
  ([open, el]) => {
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      closeButton.value?.focus()
    } else if (!open && el.open) el.close()
  },
)

const groups = computed(() =>
  SHORTCUT_GROUPS.map((group) => ({ group, rows: SHORTCUTS.filter((s) => s.group === group) })).filter((g) => g.rows.length),
)

/** 바깥(배경)을 누르면 닫는다. 대화상자 안의 빈 곳을 누른 것과 가른다. */
function onClick(e: MouseEvent) {
  if (e.target === dialog.value) emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="shortcut-help" aria-modal="true" aria-labelledby="shortcut-help-title" @close="emit('close')" @click="onClick">
    <div class="shortcut-help-body">
      <header>
        <h2 id="shortcut-help-title">조작·단축키 안내</h2>
        <button ref="closeButton" type="button" class="ghost" @click="emit('close')">닫기 <kbd>Esc</kbd></button>
      </header>
      <!-- 마우스가 먼저다 — 처음 쓰는 사람이 찾는 것은 "3D 를 어떻게 돌리나" 다. viewer.ts 의 mouseButtons(왼쪽 이동 · 가운데 확대 · 오른쪽 회전)와
           맞춘다. 예전 글은 "끌기로 회전 · 오른쪽 끌기로 이동" 이라 실제와 반대였다. -->
      <div class="shortcut-groups">
        <section>
          <h3>마우스 · 3D</h3>
          <dl>
            <dt>왼쪽 드래그</dt>
            <dd>화면 이동(지도처럼)</dd>
            <dt>오른쪽 드래그 <span class="muted">또는</span> <kbd>Shift</kbd>+드래그</dt>
            <dd>돌려 보기</dd>
            <dt>휠</dt>
            <dd>확대·축소</dd>
            <dt>휠 클릭</dt>
            <dd>누른 자리를 돌리는 중심으로</dd>
            <dt>설비 클릭</dt>
            <dd>고르기 — 이어진 것이 색으로 보입니다</dd>
            <dt>바닥 클릭</dt>
            <dd>그 물리존 고르기(평면도에서는 방)</dd>
            <dt>오른쪽 클릭</dt>
            <dd>숨기기·격리·모두 보이기 메뉴(화면에서만)</dd>
          </dl>
        </section>
        <section>
          <h3>마우스 · 편집 모드</h3>
          <dl>
            <dt>선택한 설비 드래그</dt>
            <dd :class="{ muted: !editing }">옮기기</dd>
            <dt><kbd>Ctrl</kbd>+드래그</dt>
            <dd :class="{ muted: !editing }">상자 안의 설비 여러 개 선택</dd>
            <dt>꼭짓점 드래그</dt>
            <dd :class="{ muted: !editing }">고른 물리존의 외곽선 고치기</dd>
            <dt>화살표 클릭</dt>
            <dd :class="{ muted: !editing }">연결의 흐름 방향 바꾸기</dd>
          </dl>
        </section>
      </div>
      <h3 class="keys-head">단축키</h3>
      <p class="hint">
        입력 칸에 커서가 있으면 단축키가 동작하지 않습니다. <kbd>Esc</kbd>로 칸에서 나올 수 있습니다.
        <template v-if="!editing"> <b>편집</b> 표시가 붙은 키는 편집 모드(<kbd>E</kbd>)에서만 동작합니다.</template>
      </p>
      <div class="shortcut-groups">
        <section v-for="g in groups" :key="g.group">
          <h3>{{ g.group }}</h3>
          <dl>
            <template v-for="s in g.rows" :key="s.id">
              <dt>
                <template v-for="(k, i) in s.keys" :key="k"><span v-if="i" class="muted"> 또는 </span><kbd>{{ k }}</kbd></template>
              </dt>
              <dd :class="{ muted: s.edit && !editing }">
                {{ s.label }}
                <span v-if="s.edit && !editing" class="tag">편집</span>
              </dd>
            </template>
          </dl>
        </section>
      </div>
    </div>
  </dialog>
</template>
