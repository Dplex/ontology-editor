<script setup lang="ts">
// 흐름 카드의 줄들. 설비별로 묶는다 — `받는 곳  냉동기 #725669 ─순환수 공급·환수→ ●`, `보내는 곳  ● ─급기→ VAV 54 → 디퓨저 143`.
//
// 계통(덕트·배관망)은 줄이 아니라 화살표 위 꼬리표다. 계통마다 줄을 두었더니 공조기 하나가 급기·환기·냉수 공급·냉수 환수 네 줄이 되고,
// 냉동기가 공급관 줄과 환수관 줄에 두 번 나왔다. 보는 사람이 묻는 것은 "어느 설비에서 받아 어느 설비로 보내나" 다.
//
// 칸 하나가 한 단계의 한 종류다. 한 대면 누르는 대로 그 설비로 건너가고, 여러 대면 그 줄 아래에 목록을 펼친다. 펼친 칸은 부모가
// 하나만 쥔다(`open`) — 둘을 펼치면 3D 에 무엇을 칠한 건지 모른다.
import { computed, ref, watch } from 'vue'

export type LadderChip = {
  /** 펼친 칸을 가르는 열쇠. 줄 사이에서도 겹치지 않는다. */
  key: string
  /** `VAV 54`, `냉동기 #725669` */
  label: string
  ids: string[]
  /** 기기면 고르고, 방이면 방을 연다. */
  target: 'device' | 'room'
  /** 칸에 마우스를 올리면 보이는 말. 무엇을 누르면 무엇이 되는지. */
  title: string
}
export type LadderPart =
  | { kind: 'chips'; chips: LadderChip[]; tone: 'up' | 'down' | 'linked' }
  /** 화살표. `label` 은 건너간 계통의 종류(급기), `title` 은 BIM 계통 이름. 앞 화살표와 같은 계통이면 글 없이 → 만. */
  | { kind: 'arrow'; label: string; title: string }
  /** 고른 설비. 화면에는 ● 만 두고 `label` 은 툴팁이다. */
  | { kind: 'me'; label: string }
  /** 줄 끝의 꼬리표. 방향 모름 줄이 어느 계통으로 이어졌는지. */
  | { kind: 'tag'; label: string; title: string }
export type LadderLine = { key: string; head: string; parts: LadderPart[] }
export type LadderRow = { id: string; name: string; where: string }

const props = defineProps<{
  lines: LadderLine[]
  open: string | null
  describe: (id: string, target: LadderChip['target']) => LadderRow
}>()
const emit = defineEmits<{ toggle: [chip: LadderChip | null]; pick: [id: string, target: LadderChip['target']] }>()

const chipsOf = (line: LadderLine) => line.parts.flatMap((p) => (p.kind === 'chips' ? p.chips : []))
const opened = computed(() => props.lines.flatMap(chipsOf).find((c) => c.key === props.open) ?? null)
/** 펼친 칸이 든 줄. 목록은 그 줄 바로 아래에 뜬다. */
const openLine = computed(() => props.lines.find((l) => chipsOf(l).some((c) => c.key === props.open))?.key ?? null)

/** 한 번에 그리는 줄 수. 성수 공조기 아래 디퓨저는 수백 개다. 목록 칸은 높이가 묶여 있어 그 안에서 굴린다. */
const PAGE = 40
const shown = ref(PAGE)
watch(() => props.open, () => (shown.value = PAGE))
const rows = computed(() => (opened.value ? opened.value.ids.slice(0, shown.value).map((id) => props.describe(id, opened.value!.target)) : []))

function press(chip: LadderChip) {
  if (chip.ids.length === 1) emit('pick', chip.ids[0], chip.target)
  else emit('toggle', props.open === chip.key ? null : chip)
}
</script>

<template>
  <div class="ladder">
    <template v-for="line in lines" :key="line.key">
      <div class="ladder-row" :data-line="line.key">
        <span class="ladder-head">{{ line.head }}</span>
        <div class="ladder-line">
          <template v-for="(p, i) in line.parts" :key="i">
            <span v-if="p.kind === 'chips'" class="ladder-step">
              <button
                v-for="c in p.chips"
                :key="c.key"
                type="button"
                :class="['ladder-chip', c.target === 'room' ? 'room' : p.tone, { on: open === c.key, one: c.ids.length === 1 }]"
                :aria-expanded="c.ids.length > 1 ? open === c.key : undefined"
                :title="c.title"
                @click="press(c)"
              >
                {{ c.label }}
              </button>
            </span>
            <span v-else-if="p.kind === 'arrow'" class="ladder-arrow" :title="p.title || undefined">
              <small v-if="p.label">{{ p.label }}</small>→
            </span>
            <span v-else-if="p.kind === 'me'" class="ladder-me" :title="p.label" :aria-label="p.label">●</span>
            <span v-else class="ladder-tag" :title="p.title">{{ p.label }}</span>
          </template>
        </div>
      </div>
      <div v-if="opened && openLine === line.key" class="ladder-list" data-testid="ladder-list">
        <slot name="note" />
        <ul>
          <li v-for="r in rows" :key="r.id">
            <span class="where">{{ r.where }}</span>
            <button type="button" class="link" @click="emit('pick', r.id, opened.target)">{{ r.name }}</button>
          </li>
        </ul>
        <button v-if="opened.ids.length > shown" type="button" class="link more" @click="shown += PAGE * 5">
          나머지 {{ opened.ids.length - shown }}개 더 보기
        </button>
      </div>
    </template>
  </div>
</template>
