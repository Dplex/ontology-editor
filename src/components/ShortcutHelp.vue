<script setup lang="ts">
// `?` 로 뜨는 단축키 안내. 내용은 lib/shortcuts.ts 의 표 그대로다 — 키를 받는 쪽과 같은 표를 읽어야
// 안내와 실제가 어긋나지 않는다. 네이티브 <dialog> 라 Esc·바깥 누르기로 닫히고, 열린 동안 뒤는 눌리지 않는다.
import { computed, ref, watch } from 'vue'
import { SHORTCUT_GROUPS, SHORTCUTS } from '../lib/shortcuts'

const props = defineProps<{ open: boolean; editing: boolean }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
watch(
  () => [props.open, dialog.value] as const,
  ([open, el]) => {
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
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
  <dialog ref="dialog" class="shortcut-help" aria-labelledby="shortcut-help-title" @close="emit('close')" @click="onClick">
    <div class="shortcut-help-body">
      <header>
        <h2 id="shortcut-help-title">단축키</h2>
        <button type="button" class="ghost" @click="emit('close')">닫기 <kbd>Esc</kbd></button>
      </header>
      <p class="hint">
        글자를 치는 칸과 선택 상자에 커서가 있을 때는 그 칸이 키를 받습니다. 글자 칸에서 <kbd>Esc</kbd> 를 누르면 칸에서 나옵니다.
        <template v-if="!editing"> <b>편집</b> 표시가 붙은 키는 편집 모드(<kbd>E</kbd>)에서만 먹습니다.</template>
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
      <p class="hint">
        마우스: 끌면 시점이 돌고, 휠은 확대, 오른쪽 끌기는 이동입니다. 편집 모드에서 고른 설비를 끌면 옮기고, 바닥을 누르면
        물리존 꼭짓점이 뜨고, 화살표를 누르면 흐름 방향이 바뀝니다.
      </p>
    </div>
  </dialog>
</template>
