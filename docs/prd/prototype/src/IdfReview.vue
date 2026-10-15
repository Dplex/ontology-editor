<script setup lang="ts">
// IDF 검토 화면(OE-IDF-11) — 가져온 수, 미매칭 공조존, 용량 빈 설비, 층 매핑(OE-IDF-04), 존↔물리존 매칭 확인(OE-IDF-05·OE-ZON-07),
// 설비 연결(OE-IDF-08). 확인하기 전에는 임포트 결과가 온톨로지(내보내기)에 나가지 않는다. 취소하면 아무것도 바뀌지 않는다.
import { computed } from 'vue'
import type { Model } from '../../../../src/lib/model'
import type { IdfAttachReport } from '../../../../src/lib/idf/attach'
import type { IdfState } from './state'
const props = defineProps<{ model: Model; idf: IdfState; report?: IdfAttachReport; pending: boolean; existing: number }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const zones = computed(() => props.model.hvac?.zones ?? [])
const equipment = computed(() => props.model.hvac?.equipment ?? [])
const feeds = computed(() => equipment.value.reduce((n, e) => n + e.feeds.length, 0))
const storeyName = (id: string | null) => props.model.storeys.find(s => s.id === id)?.name ?? '미매핑'
const spaceName = (id: string) => { for (const s of props.model.storeys) { const sp = s.spaces.find(x => x.id === id); if (sp) return sp.longName || sp.name } return id }
const unmapped = computed(() => zones.value.filter(z => !z.storeyId))
const unmatched = computed(() => zones.value.filter(z => !z.spaceIds.length))
const noCapacity = computed(() => {
  const linked = new Set(equipment.value.map(e => e.bimId).filter(Boolean))
  return props.model.storeys.flatMap(s => s.equipment).filter(e => linked.has(e.id) && e.capacity === null)
})
const unlinked = computed(() => equipment.value.filter(e => !e.bimId))
const ok = (zoneId: string, spaceId: string) => props.idf.matchOk[zoneId]?.includes(spaceId) ?? false
function setOk(zoneId: string, spaceId: string, on: boolean) {
  const cur = props.idf.matchOk[zoneId] ?? []
  props.idf.matchOk[zoneId] = on ? [...new Set([...cur, spaceId])] : cur.filter(x => x !== spaceId)
}
function allOk() { for (const z of zones.value) props.idf.matchOk[z.id] = [...z.spaceIds] }
function setStorey(zoneId: string, storeyId: string) {
  const z = zones.value.find(x => x.id === zoneId); if (z) z.storeyId = storeyId || null
}
const pairs = computed(() => zones.value.reduce((n, z) => n + z.spaceIds.length, 0))
const confirmedPairs = computed(() => zones.value.reduce((n, z) => n + z.spaceIds.filter(id => ok(z.id, id)).length, 0))
</script>
<template>
  <div class="eyebrow">IDF REVIEW</div>
  <h2>IDF 검토 — {{ idf.name }}</h2>
  <p v-if="pending">아직 반영하지 않았습니다. 확인하면 이 프로젝트에 공조존이 더해지고, 취소하면 기존 데이터가 그대로 남습니다.</p>
  <p v-else>확인하기 전에는 IDF 결과가 온톨로지(내보내기)에 나가지 않습니다.</p>
  <div v-if="existing" class="notice" role="note">기존 IDF 공조존 {{ existing }}개가 있습니다. 반영하면 IDF 공조존은 새로 가져온 것으로 바뀌고, 사람이 만든 공조존은 그대로 둡니다.</div>
  <div class="idf-summary" data-testid="idf-summary">
    <span>공조존<b>{{ zones.length }}</b></span><span>설비<b>{{ equipment.length }}</b></span><span>담당 관계<b>{{ feeds }}</b></span>
    <span>BIM 설비 연결<b>{{ equipment.length - unlinked.length }}/{{ equipment.length }}</b></span>
  </div>
  <details open><summary>층 매핑 <small>{{ unmapped.length ? unmapped.length + '개 미매핑' : '전부 매핑됨' }}</small></summary>
    <table class="idf-table"><tbody><tr v-for="z in zones" :key="z.id"><td>{{ z.name }}</td>
      <td><select :aria-label="z.name + ' 층'" :value="z.storeyId ?? ''" @change="setStorey(z.id, ($event.target as HTMLSelectElement).value)"><option value="">미매핑</option><option v-for="s in model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option></select></td></tr></tbody></table>
    <p v-if="unmapped.length" class="footnote">미매핑 공조존: {{ unmapped.map(z => z.name).join(', ') }}</p>
  </details>
  <details open><summary>존↔물리존 매칭 초안 <small>{{ confirmedPairs }}/{{ pairs }} 확인</small></summary>
    <p class="footnote">매칭은 계산한 초안입니다. 확인한 것만 온톨로지에 나갑니다. IDF 에 적힌 담당 설비는 확인 없이 나갑니다.</p>
    <div v-for="z in zones.filter(x => x.spaceIds.length)" :key="z.id" class="match-row"><b>{{ z.name }}</b> <small>{{ storeyName(z.storeyId) }}</small>
      <label v-for="id in z.spaceIds" :key="id" class="check"><input type="checkbox" :checked="ok(z.id, id)" @change="setOk(z.id, id, ($event.target as HTMLInputElement).checked)"> {{ spaceName(id) }} <small>{{ Math.round((z.spaceShares?.[id] ?? 0) * 100) }}% 덮음</small></label></div>
    <button v-if="pairs" @click="allOk">전부 확인</button>
    <p v-if="!pairs" class="footnote">매칭된 물리존이 없습니다. BIM 물리존이 없거나 좌표가 어긋났을 수 있습니다{{ report?.alignment == null ? '' : ' (정렬 ' + Math.round(report.alignment * 100) + '%)' }}.</p>
  </details>
  <details><summary>미매칭 공조존 <small>{{ unmatched.length }}개</small></summary>
    <ul class="detail-list"><li v-for="z in unmatched" :key="z.id">{{ z.name }} <small>{{ z.storeyId ? '겹치는 물리존 없음' : '층을 못 찾음' }}</small></li><li v-if="!unmatched.length"><small>없음</small></li></ul></details>
  <details><summary>미연결 IDF 설비 <small>{{ unlinked.length }}개</small></summary>
    <p class="footnote">이름이 BIM 설비 하나에만 맞을 때 연결합니다. 둘 이상에 맞으면 연결하지 않습니다.</p>
    <ul class="detail-list"><li v-for="e in unlinked" :key="e.id">{{ e.name }} <small>{{ e.idfClass }} · 좌표 없음(미배치)</small></li><li v-if="!unlinked.length"><small>없음</small></li></ul></details>
  <details><summary>용량이 비어 있는 설비 <small>{{ noCapacity.length }}개</small></summary>
    <ul class="detail-list"><li v-for="e in noCapacity" :key="e.id">{{ e.name }}</li><li v-if="!noCapacity.length"><small>없음</small></li></ul></details>
  <div class="button-row"><button @click="emit('cancel')">{{ pending ? '취소' : '나중에' }}</button><button class="primary" @click="emit('confirm')">{{ pending ? '확인하고 반영' : '검토 완료 · 온톨로지에 반영' }}</button></div>
</template>
