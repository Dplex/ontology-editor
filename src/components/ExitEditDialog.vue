<script setup lang="ts">
// 편집을 끝낼 때 저장하지 않은 편집이 있으면 묻는다(OE-COM-08). 저장(8084 에 두고 끝낸다 — data/ 에서 연 파일만),
// 임시 저장(브라우저에 남기고 끝낸다), 저장 안 함(마지막 저장으로 되돌리고 끝낸다), 취소(편집을 이어 한다).
// ShortcutHelp 와 같은 네이티브 <dialog> 라 Esc 는 취소다.
import { ref, watch } from 'vue'

/** `server`: 8084 에 저장할 수 있는가(data/ 에서 연 파일). */
const props = defineProps<{ open: boolean; count: number; server?: boolean }>()
const emit = defineEmits<{ commit: []; save: []; discard: []; cancel: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const saveButton = ref<HTMLButtonElement | null>(null)
watch(
  () => [props.open, dialog.value] as const,
  ([open, el]) => {
    if (!el) return
    if (open && !el.open) {
      el.showModal()
      // 엔터 한 번이 편집을 버리지 않게, 처음 초점은 지우지 않는 쪽에 둔다.
      saveButton.value?.focus()
    } else if (!open && el.open) el.close()
  },
)
</script>

<template>
  <dialog ref="dialog" class="exit-edit" aria-labelledby="exit-edit-title" @close="open && emit('cancel')">
    <div class="exit-edit-body">
      <h2 id="exit-edit-title">저장하지 않은 편집이 있습니다</h2>
      <p>
        마지막으로 저장한 뒤 바뀐 것이 <b>{{ count }}건</b> 있습니다. 편집을 끝내기 전에 어떻게 할까요?
      </p>
      <ul class="hint">
        <li v-if="server"><b>저장</b>: 8084 에 두고 끝냅니다. 이 파일을 여는 사람 모두 같은 편집을 봅니다.</li>
        <li><b>임시 저장</b>: 이 브라우저에만 남기고 끝냅니다(웹에는 반영되지 않습니다). 처음 화면의 임시 저장 목록에서 이어 갑니다.</li>
        <li><b>저장 안 함</b>: 마지막으로 저장한 때로 되돌리고 끝냅니다. 버린 편집은 위 줄의 [이어서 하기]로 한 번 되살릴 수 있습니다.</li>
      </ul>
      <div class="exit-edit-actions">
        <button v-if="server" type="button" class="ghost primary-action" @click="emit('commit')">저장</button>
        <button ref="saveButton" type="button" class="ghost" :class="{ 'primary-action': !server }" @click="emit('save')">임시 저장</button>
        <button type="button" class="ghost danger" @click="emit('discard')">저장 안 함</button>
        <button type="button" class="ghost" @click="emit('cancel')">취소</button>
      </div>
    </div>
  </dialog>
</template>
