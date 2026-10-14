<script setup lang="ts">
// 흐름 사다리 한 줄. `냉동기 1 → [이 설비] → VAV 54 → 디퓨저 143` 처럼 고른 설비의 위·아래를 기기 단계로 잇는다.
//
// 칸 하나가 한 단계의 한 종류다. 한 대면 누르는 대로 그 설비로 건너가고, 여러 대면 그 자리 아래에 목록을 펼친다. 펼친 칸은 부모가
// 하나만 쥔다(`open`) — 두 사다리에서 하나씩 펼치면 3D 에 무엇을 칠한 건지 모른다.
import { computed, ref, watch } from 'vue'

export type LadderChip = {
  /** 펼친 칸을 가르는 열쇠. 사다리 사이에서도 겹치지 않는다. */
  key: string
  /** `VAV 54`, `냉동기 Screw Chiller #725669` */
  label: string
  ids: string[]
  /** 기기면 고르고, 방이면 방을 연다. */
  target: 'device' | 'room'
  /** 칸에 마우스를 올리면 보이는 말. 무엇을 누르면 무엇이 되는지. */
  title: string
}
export type LadderRow = { id: string; name: string; where: string }

const props = defineProps<{
  up: LadderChip[][]
  down: LadderChip[][]
  /** 사다리 가운데 고른 설비의 이름. */
  me: string
  /** 방향을 모르는 칸. 사다리 끝이 아니라 아래 줄에 따로 둔다. */
  unknown?: LadderChip[]
  open: string | null
  describe: (id: string, target: LadderChip['target']) => LadderRow
}>()
const emit = defineEmits<{ toggle: [chip: LadderChip | null]; pick: [id: string, target: LadderChip['target']] }>()

const all = computed(() => [...props.up.flat(), ...props.down.flat(), ...(props.unknown ?? [])])
const opened = computed(() => all.value.find((c) => c.key === props.open) ?? null)

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
    <div class="ladder-line">
      <template v-for="(step, i) in up" :key="`u${i}`">
        <span class="ladder-step">
          <button
            v-for="c in step"
            :key="c.key"
            type="button"
            :class="['ladder-chip', 'up', { on: open === c.key, one: c.ids.length === 1 }]"
            :aria-expanded="c.ids.length > 1 ? open === c.key : undefined"
            :title="c.title"
            @click="press(c)"
          >
            {{ c.label }}
          </button>
        </span>
        <span class="ladder-arrow" aria-hidden="true">→</span>
      </template>
      <span class="ladder-me">{{ me }}</span>
      <template v-for="(step, i) in down" :key="`d${i}`">
        <span class="ladder-arrow" aria-hidden="true">→</span>
        <span class="ladder-step">
          <button
            v-for="c in step"
            :key="c.key"
            type="button"
            :class="['ladder-chip', c.target === 'room' ? 'room' : 'down', { on: open === c.key, one: c.ids.length === 1 }]"
            :aria-expanded="c.ids.length > 1 ? open === c.key : undefined"
            :title="c.title"
            @click="press(c)"
          >
            {{ c.label }}
          </button>
        </span>
      </template>
    </div>
    <div v-if="unknown?.length" class="ladder-line unknown">
      <span class="ladder-note">방향 모름</span>
      <button
        v-for="c in unknown"
        :key="c.key"
        type="button"
        :class="['ladder-chip', 'linked', { on: open === c.key, one: c.ids.length === 1 }]"
        :aria-expanded="c.ids.length > 1 ? open === c.key : undefined"
        :title="c.title"
        @click="press(c)"
      >
        {{ c.label }}
      </button>
    </div>
    <div v-if="opened" class="ladder-list" data-testid="ladder-list">
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
  </div>
</template>
