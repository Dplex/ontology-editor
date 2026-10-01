<script setup lang="ts">
// 편집을 끝낼 때 저장하지 않은 편집이 있으면 묻는다(OE-COM-08). 셋 중 하나다 — 임시 저장(브라우저에 남기고 끝낸다),
// 저장 안 함(연 때로 되돌리고 끝낸다), 취소(편집을 이어 한다). ShortcutHelp 와 같은 네이티브 <dialog> 라 Esc 는 취소다.
import { ref, watch } from 'vue'

const props = defineProps<{ open: boolean; count: number }>()
const emit = defineEmits<{ save: []; discard: []; cancel: [] }>()

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
        <li><b>임시 저장</b>: 이 브라우저에 남기고 끝냅니다. 같은 IFC 를 다시 열면 이어서 고칠지 묻습니다. 파일로 남기려면 [편집 저장]입니다.</li>
        <li><b>저장 안 함</b>: 연 때로 되돌리고 끝냅니다. 버린 편집은 위 줄의 [이어서 하기]로 한 번 되살릴 수 있습니다.</li>
      </ul>
      <div class="exit-edit-actions">
        <button ref="saveButton" type="button" class="ghost primary-action" @click="emit('save')">임시 저장</button>
        <button type="button" class="ghost danger" @click="emit('discard')">저장 안 함</button>
        <button type="button" class="ghost" @click="emit('cancel')">취소</button>
      </div>
    </div>
  </dialog>
</template>
