<script setup lang="ts">
// 공조존 도구(OE-ZON-01·02·04, OE-MAN-05, OE-OBJ-13, OE-MAP-02, OE-IDF-11 AC3). 고른 공조존의 상세정보를 보이고, 사람이 담당 물리존·담당 설비·이름을 고치거나 지운다.
// 검증은 lib/hvac-zone.ts 의 zoneChecks(Z-01~Z-06) 를 그대로 쓴다. 고치기 전에 before 로 되돌리기 지점을 만든다.
import { computed, ref, watch } from 'vue'
import type { Model, Storey, HvacZone } from '../../../../src/lib/model'
import { isConduit } from '../../../../src/lib/model'
import { deleteHvacZone, renameHvacZone, setZoneServedBy, setZoneSpaces, zoneChecks } from '../../../../src/lib/hvac-zone'

const props = defineProps<{ model: Model; floor: Storey; zone?: HvacZone; revision: number }>()
const emit = defineEmits<{ before: []; changed: [message: string]; refused: [message: string]; deleted: [] }>()
const name = ref('')
watch(() => props.zone?.id, () => { name.value = props.zone?.name ?? '' }, { immediate: true })

const spaceName = (id: string) => { const s = props.floor.spaces.find(x => x.id === id); return s ? (s.longName || s.name) : id }
const equipmentName = (id: string) => props.model.storeys.flatMap(s => s.equipment).find(e => e.id === id)?.name ?? id
const feeders = computed(() => {
  const z = props.zone
  if (!z) return []
  const idf = (props.model.hvac?.equipment ?? []).filter(e => e.feeds.includes(z.id)).map(e => ({ key: 'i' + e.id, name: e.name, detail: e.idfClass, source: 'IDF' }))
  const manual = (z.servedBy ?? []).map(id => ({ key: 'm' + id, name: equipmentName(id), detail: 'BIM 설비', source: '사람' }))
  return [...idf, ...manual]
})
const airflow = computed(() => { const f = props.zone?.designAirflow as { value?: number } | undefined; return typeof f?.value === 'number' ? f.value : null })
const editable = computed(() => props.zone?.source === 'edit')
const candidates = computed(() => props.floor.equipment.filter(e => !isConduit(e.role)))
const checks = computed(() => { void props.revision; return zoneChecks(props.model, { space: spaceName, equipment: equipmentName }) })
const warnings = computed(() => checks.value.checks.filter(c => c.items.length))

function rename() {
  if (!props.zone || !name.value.trim()) return
  emit('before'); renameHvacZone(props.model, props.zone.id, name.value); emit('changed', '공조존 이름을 바꿨습니다.')
}
function toggleSpace(id: string, on: boolean) {
  const z = props.zone; if (!z) return
  const next = on ? [...z.spaceIds, id] : z.spaceIds.filter(x => x !== id)
  emit('before')
  const r = setZoneSpaces(props.model, z.id, next)
  if (typeof r === 'object') emit('refused', r.refused); else emit('changed', '담당 물리존을 바꿨습니다. 물리존↔공조존 매핑을 다시 계산했습니다.')
}
function toggleServed(id: string, on: boolean) {
  const z = props.zone; if (!z) return
  const cur = z.servedBy ?? []
  emit('before'); setZoneServedBy(props.model, z.id, on ? [...cur, id] : cur.filter(x => x !== id)); emit('changed', '담당 설비를 바꿨습니다.')
}
function remove() {
  if (!props.zone) return
  emit('before'); deleteHvacZone(props.model, props.zone.id); emit('deleted'); emit('changed', '공조존을 지웠습니다. 담당 물리존이 비면 Z-01 경고가 뜹니다.')
}
</script>
<template>
  <div class="hvac-panel">
    <template v-if="zone">
      <div class="selected-title">{{ zone.name }}</div>
      <span class="source-chip">{{ editable ? '사람 · 편집' : 'IDF' }}</span>
      <div class="hvac-detail" data-testid="hvac-detail">
        <label v-if="editable">이름<input v-model="name" aria-label="공조존 이름" @change="rename"></label>
        <label>층<span class="field-value">{{ floor.name }}</span></label>
        <label>담당 설비 <small>{{ feeders.length }}대</small>
          <span v-if="!feeders.length" class="field-value">없음</span>
          <ul v-else class="detail-list"><li v-for="f in feeders" :key="f.key">{{ f.name }} <small>{{ f.detail }} · {{ f.source }}</small></li></ul>
        </label>
        <div v-if="editable" class="pick-list" aria-label="담당 설비 고르기"><b>담당 설비 고르기</b>
          <label v-for="e in candidates" :key="e.id" class="check"><input type="checkbox" :checked="zone.servedBy?.includes(e.id)" @change="toggleServed(e.id, ($event.target as HTMLInputElement).checked)"> {{ e.name }}</label>
          <small v-if="!candidates.length">이 층에 고를 설비가 없습니다.</small>
        </div>
        <label>담당 물리존 <small>{{ zone.spaceIds.length }}개</small>
          <span v-if="!zone.spaceIds.length" class="field-value">없음</span>
          <ul v-else-if="!editable" class="detail-list"><li v-for="id in zone.spaceIds" :key="id">{{ spaceName(id) }} <small v-if="zone.spaceShares?.[id] !== undefined">{{ Math.round(zone.spaceShares[id] * 100) }}% 덮음</small></li></ul>
        </label>
        <div v-if="editable" class="pick-list" aria-label="담당 물리존 고르기"><b>담당 물리존 고르기</b>
          <label v-for="s in floor.spaces" :key="s.id" class="check"><input type="checkbox" :checked="zone.spaceIds.includes(s.id)" @change="toggleSpace(s.id, ($event.target as HTMLInputElement).checked)"> {{ s.longName || s.name }} <small v-if="zone.spaceShares?.[s.id] !== undefined">{{ Math.round(zone.spaceShares[s.id] * 100) }}%</small></label>
        </div>
        <label>설계 급기 풍량<span class="field-value">{{ airflow !== null ? airflow + ' CMH' : '값 없음' }}</span></label>
        <p class="footnote">IDF 에너지존과 공조존은 같은 것입니다. 풍량은 IDF 에 값이 있을 때만 보입니다(U8).{{ editable ? '' : ' IDF 공조존은 읽기 전용이고 보정은 R2 입니다(OE-ZON-03).' }}</p>
        <button v-if="editable" class="wide danger" @click="remove">공조존 지우기</button>
      </div>
    </template>
    <template v-else><div class="selected-title">공조존 도구</div><p class="muted">목록에서 공조존을 고르거나 아래 [＋ 공조존 만들기] 로 새로 만드세요.</p></template>
    <details class="zone-checks" :open="!zone" data-testid="zone-checks"><summary>공조존 검증 Z-01~Z-06 <small>{{ warnings.length }}건 경고</small></summary>
      <p v-if="!warnings.length" class="footnote">경고가 없습니다.{{ checks.untouched.length ? ' 공조존이 아직 없는 층: ' + checks.untouched.join(', ') : '' }}</p>
      <ul v-else class="detail-list"><li v-for="c in warnings" :key="c.rule + c.text"><b>{{ c.rule }}</b> {{ c.text }}<small v-if="c.undetermined"> · 판정 불가</small>
        <ul class="detail-list"><li v-for="i in c.items.slice(0, 6)" :key="i.id">{{ i.label }}</li><li v-if="c.items.length > 6"><small>외 {{ c.items.length - 6 }}건</small></li></ul></li></ul>
    </details>
  </div>
</template>
