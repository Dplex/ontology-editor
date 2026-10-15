<script setup lang="ts">
// 저장하지 않은 편집이 있는데 편집을 끝내거나 다른 층으로 가려 하면 묻는다(OE-COM-08).
// - 편집 종료(OE-UI-04 AC11): "임시 저장하시겠습니까?" — 저장 안 한 층을 보이고 [임시 저장 후 종료]·[저장하지 않고 종료]·[취소].
// - 층 바꾸기: [임시 저장]·[그대로 이동](편집을 화면에 남긴 채 간다, OE-UI-04 AC10)·[저장 안 함]·[취소].
// 저장(8084 에 둔다 — data/ 에서 연 파일만)은 두 경우 모두 있다. `floor` 가 있으면 층을 바꾸려던 것이다.
// ShortcutHelp 와 같은 네이티브 <dialog> 라 Esc 는 취소다.
import { ref, watch } from 'vue'

/** `server`: 8084 에 저장할 수 있는가(data/ 에서 연 파일). */
const props = defineProps<{ open: boolean; count: number; server?: boolean; floor?: { from: string; to: string } | null; floors?: string[] }>()
const emit = defineEmits<{ commit: []; save: []; keep: []; discard: []; cancel: [] }>()

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
      <h2 id="exit-edit-title">{{ floor ? '저장하지 않은 편집이 있습니다' : '임시 저장하시겠습니까?' }}</h2>
      <p v-if="floor">
        <b>{{ floor.from }}</b>에서 마지막으로 저장한 뒤 변경 내역이 <b>{{ count }}건</b> 있습니다. {{ floor.to }}(으)로 이동하기 전에 어떻게 할까요?
      </p>
      <p v-else>
        마지막으로 저장한 뒤 변경 내역이 <b>{{ count }}건</b> 있습니다<template v-if="floors?.length"> — 저장하지 않은 층: <b data-testid="exit-floors">{{ floors.join(' · ') }}</b></template>.
        편집을 종료하기 전에 어떻게 할까요?
      </p>
      <ul class="hint">
        <li v-if="server"><b>저장</b>: 서버에 저장합니다. 이 파일을 여는 모든 사용자가 같은 편집 내용을 봅니다.</li>
        <li><b>임시 저장</b>: {{ floor ? '이 층의' : '위 층들의' }} 편집을 층별로 보관합니다(DT에는 반영되지 않습니다). 해당 층을 다시 열면 이어서 편집할 수 있습니다.</li>
        <li v-if="floor"><b>그대로 이동</b>: 저장하지 않고 {{ floor.to }}(으)로 이동합니다. {{ floor.from }}의 편집은 화면에 유지되며, 편집을 종료하거나 구축할 때 다시 확인합니다.</li>
        <li><b>{{ floor ? '저장 안 함' : '저장하지 않고 종료' }}</b>: {{ floor ? '이 층을' : '' }} 마지막으로 저장한 상태로 되돌립니다. 취소한 편집은 상단 바의 자동 저장 질문에서 [예]로 복구할 수 있습니다.</li>
      </ul>
      <div class="exit-edit-actions">
        <button v-if="server" type="button" class="ghost primary-action" @click="emit('commit')">저장</button>
        <button ref="saveButton" type="button" class="ghost" :class="{ 'primary-action': !server }" @click="emit('save')">{{ floor ? '임시 저장' : '임시 저장 후 종료' }}</button>
        <button v-if="floor" type="button" class="ghost" @click="emit('keep')">그대로 이동</button>
        <button type="button" class="ghost danger" @click="emit('discard')">{{ floor ? '저장 안 함' : '저장하지 않고 종료' }}</button>
        <button type="button" class="ghost" @click="emit('cancel')">취소</button>
      </div>
    </div>
  </dialog>
</template>
