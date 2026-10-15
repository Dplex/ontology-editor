<script setup lang="ts">
// 공조존 만들기(OE-ZON-01 물리존 고르기). 경계를 직접 그리는 방법(OE-ZON-02)은 평면에서 꼭짓점을 찍는다 — 에디터가 맡는다.
import { ref } from 'vue'
import type { Storey } from '../../../../src/lib/model'
const props = defineProps<{ floor: Storey }>()
const emit = defineEmits<{ create: [spec: { name: string; spaceIds: string[]; servedBy: string[] }]; draw: [name: string]; cancel: [] }>()
const name = ref('')
const spaces = ref<string[]>([])
const served = ref<string[]>([])
const equipment = props.floor.equipment.filter(e => e.position)
</script>
<template>
  <div class="eyebrow">HVAC ZONE</div><h2>공조존 만들기</h2>
  <p>{{ floor.name }}에 공조존을 만듭니다. 물리존을 골라 만들거나, 평면에서 경계를 직접 그릴 수 있습니다.</p>
  <label>공조존 이름<input v-model="name" aria-label="새 공조존 이름" placeholder="예: AHU-1 담당"></label>
  <div class="pick-list" aria-label="담당 물리존 고르기"><b>담당 물리존</b>
    <label v-for="s in floor.spaces" :key="s.id" class="check"><input v-model="spaces" type="checkbox" :value="s.id"> {{ s.longName || s.name }}</label>
    <small v-if="!floor.spaces.length">이 층에 물리존이 없습니다 — 경계를 그려 만드세요.</small>
  </div>
  <div class="pick-list" aria-label="담당 설비 고르기"><b>담당 설비 <small>(선택)</small></b>
    <label v-for="e in equipment" :key="e.id" class="check"><input v-model="served" type="checkbox" :value="e.id"> {{ e.name }}</label>
    <small v-if="!equipment.length">배치된 설비가 없습니다. 나중에 지정할 수 있습니다.</small>
  </div>
  <div class="button-row">
    <button class="primary" :disabled="!spaces.length" @click="emit('create', { name, spaceIds: spaces, servedBy: served })">물리존으로 만들기</button>
    <button @click="emit('draw', name)">경계 직접 그리기</button>
    <button @click="emit('cancel')">취소</button>
  </div>
</template>
