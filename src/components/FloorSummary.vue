<script setup lang="ts">
// 오른쪽 패널의 현재 층 현황(OE-UI-04 ③, lib/floor-summary.ts). 고른 것이 있든 없든 늘 보인다. 고른 것의 속성은 이 위에 뜬다.
// 목록의 항목을 누르면 가운데 뷰에서 그것을 고른다.
import type { FloorSummary } from '../lib/floor-summary'

defineProps<{
  building: string
  storey: string
  /** 미편집 · 저장 안 된 편집 · 임시 저장. 모든 층이면 층마다 센 것. */
  status: string
  summary: FloorSummary
}>()
const emit = defineEmits<{ pick: [kind: 'space' | 'room' | 'customZone', id: string] }>()
</script>

<template>
  <section class="floor-summary" aria-label="현재 층 현황" data-testid="floor-summary">
    <h3>
      {{ building }} · {{ storey }} <small class="muted" data-testid="floor-status">{{ status }}</small>
    </h3>
    <details>
      <summary>
        공간 구성 — 물리존 {{ summary.spaces.length }} · 룸 {{ summary.rooms.length }} · 커스텀존 {{ summary.customZones.length }} · 공조존 {{ summary.hvacZones.length }}
      </summary>
      <ul class="plain">
        <li v-for="x in summary.spaces" :key="x.id"><button type="button" class="link" @click="emit('pick', 'space', x.id)">{{ x.name }}</button> <span class="muted">물리존</span></li>
        <li v-for="x in summary.rooms" :key="x.id"><button type="button" class="link" @click="emit('pick', 'room', x.id)">{{ x.name }}</button> <span class="muted">룸</span></li>
        <li v-for="x in summary.customZones" :key="x.id"><button type="button" class="link" @click="emit('pick', 'customZone', x.id)">{{ x.name }}</button> <span class="muted">커스텀존</span></li>
        <li v-for="x in summary.hvacZones" :key="x.id">{{ x.name }} <span class="muted">공조존</span></li>
      </ul>
    </details>
    <details>
      <summary>설비 {{ summary.equipmentTotal }}대 · 미배치 {{ summary.unplaced }}대</summary>
      <ul class="plain">
        <li v-for="k in summary.equipment" :key="k.label">{{ k.label }} <b>{{ k.count }}</b></li>
      </ul>
    </details>
    <p class="muted" data-testid="floor-objects">공간 오브젝트 — {{ summary.objects.map((o) => `${o.label} ${o.count}`).join(' · ') }}</p>
  </section>
</template>
