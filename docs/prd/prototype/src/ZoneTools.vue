<script setup lang="ts">
// 공간 단위 편집 도구(OE-SPC-02·03·04·08, OE-OBJ-01·02). 고른 물리존·커스텀존을 나누고(선 긋기) 합치고 지운다. 경계 꼭짓점은 평면에서 끌어 옮긴다.
// 로직은 lib/edit.ts(splitSpace·mergeSpaces·deleteSpace·insertSpaceVertex)와 lib/custom-zone.ts 를 그대로 쓴다.
import { computed, ref, watch } from 'vue'
import type { Model, Storey } from '../../../../src/lib/model'
import { deleteSpace, mergeSpaces, insertSpaceVertex } from '../../../../src/lib/edit'
import { deleteCustomZone, mergeCustomZones, renameCustomZone } from '../../../../src/lib/custom-zone'

const props = defineProps<{ model: Model; floor: Storey; kind: 'space' | 'custom'; id: string }>()
const emit = defineEmits<{ before: []; changed: [message: string]; refused: [message: string]; deleted: []; split: []; select: [id: string] }>()
const other = ref('')
const name = ref('')
const target = computed(() => props.kind === 'space' ? props.floor.spaces.find(s => s.id === props.id) : props.floor.customZones?.find(z => z.id === props.id))
const others = computed(() => (props.kind === 'space' ? props.floor.spaces : props.floor.customZones ?? []).filter(x => x.id !== props.id))
const label = (x: { name: string; longName?: string }) => ('longName' in x && x.longName) ? x.longName : x.name
watch(() => props.id, () => { other.value = ''; name.value = (target.value as { name: string } | undefined)?.name ?? '' }, { immediate: true })

const kindName = computed(() => props.kind === 'space' ? '물리존' : '커스텀존')
const fail = (r: unknown) => typeof r === 'object' && r !== null && 'refused' in r ? (r as { refused: string }).refused : null

function remove() {
  emit('before')
  const r = props.kind === 'space' ? deleteSpace(props.model, props.id) : deleteCustomZone(props.model, props.id)
  const why = fail(r)
  if (why) { emit('refused', why); return }
  const moved = props.kind === 'space' && r && typeof r === 'object' && 'equipment' in r ? (r as { equipment: unknown[] }).equipment.length : 0
  emit('deleted'); emit('changed', kindName.value + '을 지웠습니다.' + (moved ? ' 설비 ' + moved + '대의 소속을 다시 판정했습니다.' : ''))
}
function merge() {
  if (!other.value) return
  emit('before')
  const r = props.kind === 'space' ? mergeSpaces(props.model, props.id, other.value) : mergeCustomZones(props.model, props.id, other.value)
  const why = fail(r)
  if (why) { emit('refused', why); return }
  other.value = ''; emit('changed', kindName.value + '을 합쳤습니다.')
}
function addVertex() {
  if (props.kind !== 'space') return
  const sp = props.floor.spaces.find(s => s.id === props.id); if (!sp) return
  emit('before'); insertSpaceVertex(props.model, props.id, 0); emit('changed', '꼭짓점을 더했습니다. 평면에서 끌어 옮기세요.')
}
function rename() {
  if (props.kind !== 'custom' || !name.value.trim()) return
  emit('before'); const r = renameCustomZone(props.model, props.id, name.value); const why = fail(r)
  if (why) emit('refused', why); else emit('changed', '커스텀존 이름을 바꿨습니다.')
}
</script>
<template>
  <div class="zone-tools" data-testid="zone-tools">
    <h4>{{ kindName }} 편집</h4>
    <label v-if="kind === 'custom'">이름<input v-model="name" :aria-label="kindName + ' 이름'" @change="rename"></label>
    <div class="button-row">
      <button data-testid="zone-split" @click="emit('split')">나누기 (선 긋기)</button>
      <button v-if="kind === 'space'" @click="addVertex">꼭짓점 추가</button>
      <button class="danger" data-testid="zone-delete" @click="remove">지우기</button>
    </div>
    <div class="merge-row">
      <select v-model="other" :aria-label="kindName + ' 합칠 대상'"><option value="">합칠 {{ kindName }} 고르기</option><option v-for="o in others" :key="o.id" :value="o.id">{{ label(o) }}</option></select>
      <button :disabled="!other" data-testid="zone-merge" @click="merge">합치기</button>
    </div>
    <p class="footnote">평면도에서 꼭짓점을 끌어 경계를 고치고, 꼭짓점을 두 번 누르면 지웁니다. 나누기는 평면에서 점 두 개를 찍어 선을 긋습니다. 합치기는 변을 맞댄 존끼리만 됩니다.</p>
  </div>
</template>
