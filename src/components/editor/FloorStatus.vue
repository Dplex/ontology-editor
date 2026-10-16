<script setup lang="ts">
// 우측 아래 층 현황(OE-UI-04 ③, design-system.md 4장 "아래 = 층 현황"). 종류 칸 다섯 · 검색 · 목록. 목록에서 고르면 위 카드(선택 오브젝트)가 바뀐다.
// 늘 고정이고 고른 것이 바뀌어도 내용이 그대로다. 공간 오브젝트 칸은 목록 대신 벽 · 문 · 창과 추가 오브젝트의 수를 보인다.
import { computed, ref } from 'vue'
import { whatIs } from '../../editor/checks'
import { model } from '../../editor/core'
import { selectedId } from '../../editor/flow-rules'
import { selectedZone, selectZone } from '../../editor/idf-zones'
import { selectedSystemId } from '../../editor/kinds'
import { breadcrumb, floorNow, floorNowStatus, pickFromSummary } from '../../editor/layout-storeys'
import { selectedSpaceId } from '../../editor/rooms'
import { FLOOR_ROWS_SHOWN, floorCollapsed, floorEquipKind, floorEquipment, floorKind, floorSearch, floorSystems, shellStorey, toggleFloorCollapsed, type FloorKind } from '../../editor/shell'
import { selectedCustomZoneId } from '../../editor/space-edit'
import { select, toggleSystem } from '../../editor/systems'
import { shortName } from '../../editor/equipment-shape'
// 이름 찾기(/)가 오는 칸. 예전에는 3D 아래 편집 표의 이름 칸이었다.
import { searchInput } from '../../editor/keyboard'
import StoreyEdit from './StoreyEdit.vue'

const KINDS: { key: FloorKind; label: string }[] = [
  { key: 'space', label: '물리존' },
  { key: 'custom', label: '커스텀존' },
  { key: 'hvac', label: '공조존' },
  { key: 'equipment', label: '설비' },
  { key: 'objects', label: '공간 오브젝트' },
]

const storeys = computed(() => {
  const m = model.value
  if (!m) return []
  return shellStorey.value ? [shellStorey.value] : m.storeys
})

const spaceRows = computed(() =>
  storeys.value.flatMap((s) => [
    ...s.spaces.map((sp) => ({ kind: 'space' as const, id: sp.id, name: [sp.name, sp.longName].filter(Boolean).join(' ') || '(이름 없음)', value: sp.areaM2 ? `${sp.areaM2.toFixed(1)}㎡` : '외곽선 없음', storey: s.name })),
    ...(s.rooms ?? []).map((r) => ({ kind: 'room' as const, id: r.id, name: r.name, value: '룸', storey: s.name })),
  ]),
)
const customRows = computed(() => storeys.value.flatMap((s) => (s.customZones ?? []).map((z) => ({ id: z.id, name: z.name, storey: s.name }))))
const hvacRows = computed(() => floorNow.value?.hvacZones ?? [])
const idfZoneIds = computed(() => new Set((model.value?.hvac?.zones ?? []).map((z) => z.id)))

const counts = computed(() => {
  const f = floorNow.value
  return {
    space: spaceRows.value.filter((r) => r.kind === 'space').length,
    custom: customRows.value.length,
    hvac: hvacRows.value.length,
    equipment: f?.equipmentTotal ?? 0,
    objects: f ? f.objects.reduce((n, o) => n + o.count, 0) : 0,
  }
})
const unplaced = computed(() => floorNow.value?.unplaced ?? 0)
const spacesWithoutOutline = computed(() => spaceRows.value.filter((r) => r.kind === 'space' && r.value === '외곽선 없음').length)

const q = computed(() => floorSearch.value.trim().toLowerCase())
const hit = (name: string) => !q.value || name.toLowerCase().includes(q.value)

const equipRows = computed(() =>
  floorEquipment.value
    .map(({ e, storey }) => ({ id: e.id, name: e.name ? shortName(e.name) : '(이름 없음)', full: e.name || '(이름 없음)', kind: whatIs(e)?.label ?? '종류 모름', placed: !!e.position, storey: storey.name }))
    .filter((r) => (!floorEquipKind.value || r.kind === floorEquipKind.value) && hit(`${r.name} ${r.kind}`)),
)

const placeholder = computed(() => {
  const k = KINDS.find((x) => x.key === floorKind.value)!
  return `${k.label} ${counts.value[floorKind.value].toLocaleString()}개 · 이름 검색`
})
// 칩은 처음 한 줄 남짓만 보이고 나머지는 [+N] 으로 편다. 칩이 여러 줄이면 아래 목록이 한 줄도 남지 않았다(성수 B5F, 2026-10-16).
const CHIPS_SHOWN = 6
// 계통 이름은 길다(BIM 의 "기계 순환 공기 18") — 처음 넷만.
const SYSTEMS_SHOWN = 4
const kindsAll = ref(false)
const systemsAll = ref(false)
const kindChips = computed(() => floorNow.value?.equipment ?? [])
const many = computed(() => !shellStorey.value && (model.value?.storeys.length ?? 0) > 1)
</script>

<template>
  <section :class="['shell-floor', { collapsed: floorCollapsed }]" aria-label="층 현황" data-testid="floor-status">
    <header class="shell-card-head">
      <h3>층 현황</h3>
      <span v-if="breadcrumb" class="muted">{{ breadcrumb.building }} · {{ breadcrumb.storey }}</span>
      <small v-if="floorNowStatus" class="muted shell-floor-state" :title="floorNowStatus">{{ floorNowStatus }}</small>
      <button type="button" class="link shell-floor-toggle" :aria-expanded="!floorCollapsed" :title="floorCollapsed ? '층 현황을 펼칩니다' : '층 현황을 접고 위 카드를 넓힙니다'" @click="toggleFloorCollapsed">{{ floorCollapsed ? '펼치기 ▴' : '접기 ▾' }}</button>
    </header>
    <template v-if="!floorCollapsed">
    <StoreyEdit />
    <div class="shell-kinds" role="group" aria-label="층 현황 종류">
      <button
        v-for="k in KINDS"
        :key="k.key"
        type="button"
        :class="{ on: floorKind === k.key }"
        :aria-pressed="floorKind === k.key"
        @click="floorKind = k.key; floorSearch = ''"
      >
        <b aria-hidden="true">{{ counts[k.key].toLocaleString() }}</b>
        <span>{{ k.label }}</span>
      </button>
    </div>
    <p v-if="floorKind === 'space' && spacesWithoutOutline" class="shell-floor-note warn">외곽선 없는 물리존 {{ spacesWithoutOutline }}개 — 3D 에 없고 소속 판정에 쓰이지 않습니다</p>
    <p v-if="floorKind === 'equipment' && unplaced" class="shell-floor-note warn">미배치 {{ unplaced.toLocaleString() }}대 — 레일의 설비 도구에서 놓습니다</p>

    <template v-if="floorKind !== 'objects'">
      <input ref="searchInput" v-model="floorSearch" type="search" class="shell-floor-search" :placeholder="placeholder" :aria-label="placeholder" />
      <div v-if="floorKind === 'equipment' && kindChips.length" :class="['shell-chips', { all: kindsAll }]" role="group" aria-label="설비 종류">
        <button
          v-for="k in kindsAll ? kindChips : kindChips.slice(0, CHIPS_SHOWN)"
          :key="k.label"
          type="button"
          :class="{ on: floorEquipKind === k.label }"
          :aria-pressed="floorEquipKind === k.label"
          @click="floorEquipKind = floorEquipKind === k.label ? null : k.label"
        >
          {{ k.label }} <small>{{ k.count.toLocaleString() }}</small>
        </button>
        <button v-if="kindChips.length > CHIPS_SHOWN" type="button" class="more" :aria-expanded="kindsAll" @click="kindsAll = !kindsAll">
          {{ kindsAll ? '접기' : `+${kindChips.length - CHIPS_SHOWN}` }}
        </button>
      </div>
      <!-- 계통(OE-UI-04 층 현황의 계통 칸). 설비 칸에서만, 누르면 그 계통만 보인다. 목록 위에 둔다 — 아래에 두면 목록이 길 때 카드 밖으로 밀려 보이지 않았다. -->
      <div v-if="floorKind === 'equipment' && floorSystems.length" :class="['shell-systems', { all: systemsAll }]" role="group" aria-label="계통">
        <span class="muted" :title="shellStorey ? `${shellStorey.name} 설비가 든 계통` : '파일 전체 계통'">계통 {{ floorSystems.length.toLocaleString() }}</span>
        <button
          v-for="s in systemsAll ? floorSystems : floorSystems.slice(0, SYSTEMS_SHOWN)"
          :key="s.id"
          type="button"
          :class="{ on: s.id === selectedSystemId }"
          :aria-pressed="s.id === selectedSystemId"
          :title="s.title"
          @click="toggleSystem(s.id)"
        >
          <i :style="{ background: s.color }" aria-hidden="true"></i>{{ s.name }} <small>{{ s.devices.toLocaleString() }}대</small>
        </button>
        <button v-if="floorSystems.length > SYSTEMS_SHOWN" type="button" class="more" :aria-expanded="systemsAll" @click="systemsAll = !systemsAll">
          {{ systemsAll ? '접기' : `+${(floorSystems.length - SYSTEMS_SHOWN).toLocaleString()}` }}
        </button>
      </div>
      <ul class="shell-rows">
        <template v-if="floorKind === 'space'">
          <li v-for="r in spaceRows.filter((x) => hit(x.name))" :key="r.id">
            <button type="button" :class="{ on: selectedSpaceId === r.id }" @click="pickFromSummary(r.kind, r.id)">
              <i class="dot space" aria-hidden="true"></i><span class="name" :title="r.name">{{ r.name }}</span><small v-if="many" class="muted">{{ r.storey }}</small><span class="val">{{ r.value }}</span>
            </button>
          </li>
        </template>
        <template v-else-if="floorKind === 'custom'">
          <li v-for="r in customRows.filter((x) => hit(x.name))" :key="r.id">
            <button type="button" :class="{ on: selectedCustomZoneId === r.id }" @click="pickFromSummary('customZone', r.id)">
              <i class="dot custom" aria-hidden="true"></i><span class="name" :title="r.name">{{ r.name }}</span><small v-if="many" class="muted">{{ r.storey }}</small>
            </button>
          </li>
          <li v-if="!customRows.length" class="muted shell-empty">커스텀존이 없습니다. 레일의 [커스텀존] 으로 그립니다.</li>
        </template>
        <template v-else-if="floorKind === 'hvac'">
          <li v-for="r in hvacRows.filter((x) => hit(x.name))" :key="r.id">
            <button type="button" :class="{ on: selectedZone?.zone.id === r.id }" :disabled="!idfZoneIds.has(r.id)" @click="selectZone(r.id)">
              <i class="dot hvac" aria-hidden="true"></i><span class="name" :title="r.name">{{ r.name }}</span><span class="val">{{ idfZoneIds.has(r.id) ? 'IDF' : '직접' }}</span>
            </button>
          </li>
          <li v-if="!hvacRows.length" class="muted shell-empty">공조존이 없습니다. IDF 를 덧붙이거나 직접 만듭니다.</li>
        </template>
        <template v-else>
          <li v-for="r in equipRows.slice(0, FLOOR_ROWS_SHOWN)" :key="r.id">
            <button type="button" :class="{ on: selectedId === r.id }" @click="select(r.id)">
              <i class="dot equip" :class="{ unplaced: !r.placed }" aria-hidden="true"></i><span class="name" :title="r.full">{{ r.name }}</span><span class="val">{{ r.placed ? r.kind : '미배치' }}</span>
            </button>
          </li>
          <li v-if="equipRows.length > FLOOR_ROWS_SHOWN" class="muted shell-empty">외 {{ (equipRows.length - FLOOR_ROWS_SHOWN).toLocaleString() }}대 — 검색으로 좁힙니다</li>
          <li v-if="!equipRows.length" class="muted shell-empty">설비가 없습니다.</li>
        </template>
      </ul>
    </template>
    <ul v-else class="shell-rows objects">
      <li v-for="o in floorNow?.objects ?? []" :key="o.label">
        <span class="row"><span class="name" :title="o.label">{{ o.label }}</span><span class="val">{{ o.count.toLocaleString() }}</span></span>
      </li>
    </ul>
    </template>
  </section>
</template>
