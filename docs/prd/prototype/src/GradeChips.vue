<script setup lang="ts">
// 수용 기준선 등급 칩(OE-BIM-16·21, OE-REQ-04). 등급 0~3 은 게이트, 4 는 목표선이다. 분자·분모를 보이고, 평가 불가는 통과로 적지 않는다.
// 본 숫자는 lib/grade.ts 가 BIM+계산만으로 센 값이다. 사용자 보정 값은 보조 숫자로 따로 보인다(D12).
import { computed } from 'vue'
import type { Model } from '../../../../src/lib/model'
import { gradeReport, percent } from '../../../../src/lib/grade'
const props = defineProps<{ model: Model; revision: number }>()
const report = computed(() => { void props.revision; return gradeReport(props.model) })
</script>
<template>
  <div class="grade-chips" data-testid="grade-chips">
    <h4>수용 기준선 등급 <small>{{ report.bimGate ? '원본 BIM 이 게이트(0~3)를 통과' : '원본 BIM 이 게이트 미달' }}{{ report.gate && !report.bimGate ? ' · 보정 후 통과' : '' }}</small></h4>
    <div v-for="r in report.rows" :key="r.grade" class="grade-row" :class="{ fail: !r.pass, na: r.ratio === null }" :data-testid="'grade-' + r.grade">
      <span class="gchip">등급 {{ r.grade }}{{ r.grade === 4 ? ' 목표' : '' }}</span><b>{{ r.label }}</b>
      <span class="gnum">{{ r.ratio === null ? '평가 불가' : r.have + '/' + r.of + ' · ' + percent(r.ratio) }}</span><small>기준 {{ Math.round(r.line * 100) }}%</small>
      <small v-if="r.aux" class="gaux">보정 후 {{ r.aux.have }}/{{ r.aux.of }} ({{ r.aux.source === 'edit' ? '사람 보정' : '규칙 방향 포함' }})</small>
      <small v-if="!r.pass && r.why" class="gwhy">{{ r.why }} · {{ r.resubmit }}</small>
    </div>
  </div>
</template>
