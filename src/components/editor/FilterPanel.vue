<script setup lang="ts">
import type { PropType } from 'vue'
import { isFull } from '../../lib/space-checklist'
import { vKeepTyping } from '../../editor/edit-filter'
import { spaceView } from '../../editor/flow-map'
import { runShortcut } from '../../editor/keyboard'
import { viewStorey } from '../../editor/multi-view'
import { multiView } from '../../editor/vertical'
import { classFriendlyLabel, clearViewFilter, enterSpaceView, exitSpaceView, exploded, explorerQuery, facetOn, filterOn, filterOpen, filterStoreysUsable, filterText, isolateIssuesOnly, setFacetAll, setViewFilter, spacesEmptyOnly, spacesStoreyId, spaceViewName, toggleExplode, toggleFacet, viewFilter, viewSpaces } from '../../editor/view-filter'
import type { filteredExplorerFacets as filteredExplorerFacetsRef, viewFacets as viewFacetsRef } from '../../editor/view-filter'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  filteredExplorerFacets: { type: null as unknown as PropType<NonNullable<typeof filteredExplorerFacetsRef.value>>, required: true },
  viewFacets: { type: null as unknown as PropType<NonNullable<typeof viewFacetsRef.value>>, required: true },
})
</script>

<template>
  <aside class="filter-panel" data-testid="filter-panel" aria-label="보기 필터">
    <div class="filter-head">
      <div class="filter-brand">
        <span class="brand-badge" aria-hidden="true">EXPLORER</span>
        <b>보기 필터</b>
      </div>
      <button type="button" class="link" :disabled="!filterOn && !exploded" title="적용된 필터와 분해도를 모두 해제합니다" @click="clearViewFilter">모두 보이기</button>
      <button type="button" class="link" aria-label="보기 필터 닫기" title="보기 필터 닫기 (V · Esc)" @click="filterOpen = false">닫기</button>
    </div>
    <div class="filter-search-wrap">
      <input
        v-model="explorerQuery"
        v-keep-typing
        type="text"
        class="filter-search"
        placeholder="층 · 설비 종류(한국어/Brick) · 계통 검색…"
        aria-label="보기 필터 검색"
      />
    </div>
    <div class="filter-presets" role="group" aria-label="빠른 탐색 프리셋">
      <button
        type="button"
        class="preset-chip warn"
        title="소속 방 없음 · 종류 모름 · 계통 없음 · 완전성 검사 위반인 설비만 3D 에 남깁니다(화면에서만)"
        @click="isolateIssuesOnly"
      >
        손볼 설비만
      </button>
      <button
        type="button"
        class="preset-chip"
        title="덕트·배관 구간을 숨기고 기기만 남깁니다"
        @click="setFacetAll('classes', true, viewFacets.classes.filter((c) => !c.conduit).map((c) => c.id)); setFacetAll('classes', false, viewFacets.classes.filter((c) => c.conduit).map((c) => c.id))"
      >
        기기만
      </button>
      <button
        type="button"
        class="preset-chip"
        title="종류를 모르는 다음 패밀리의 설비를 고르고 시점을 옮깁니다 (U)"
        @click="runShortcut('nextUnknown')"
      >
        종류 모름 다음 <kbd>U</kbd>
      </button>
      <button
        type="button"
        class="preset-chip"
        title="완전성 검사에서 어긴 다음 설비를 고릅니다(펼친 규칙, 없으면 첫 규칙) (N)"
        @click="runShortcut('nextIssue')"
      >
        검사 위반 다음 <kbd>N</kbd>
      </button>
    </div>
    <p class="muted filter-note">화면에서만 거릅니다. 편집 파일·TTL·GeoJSON 은 그대로입니다. Ctrl+끌기 상자는 보이는 것만 고릅니다.</p>
    <p v-if="filterOn" class="filter-now" data-testid="filter-summary">{{ filterText }}</p>
    <p class="filter-actions">
      <button type="button" :class="['ghost', { on: exploded }]" :aria-pressed="exploded" data-testid="explode-toggle" title="보이는 기기를 Brick 클래스별로 건물 위에 한 켜씩 띄웁니다" @click="toggleExplode">
        {{ exploded ? '분해도 접기' : 'Brick 클래스별 분해도' }}
      </button>
      <button v-if="viewFilter.isolate" type="button" class="ghost" @click="setViewFilter({ isolate: null })">격리 풀기 ({{ viewFilter.isolate.length }})</button>
      <button v-if="viewFilter.hidden.length" type="button" class="ghost" @click="setViewFilter({ hidden: [] })">숨긴 {{ viewFilter.hidden.length }}대 보이기</button>
    </p>
    <details v-if="viewFacets.storeys.length > 1" open class="filter-group">
      <summary>
        <span class="group-tag" aria-hidden="true">LEVELS</span> 층 <span class="muted">{{ viewFilter.storeys ? `${viewFilter.storeys.length}/${viewFacets.storeys.length}` : '전부' }}</span>
        <button type="button" class="link" @click.prevent="viewStorey = null; setFacetAll('storeys', true)">All</button>
        <button type="button" class="link" @click.prevent="viewStorey = null; setFacetAll('storeys', false)">Clear</button>
      </summary>
      <p v-if="!filterStoreysUsable && multiView" class="muted filter-note">다중층 뷰에서는 상단 범위 선택기가 층을 정합니다.</p>
      <p v-else-if="viewStorey" class="muted filter-note">단일 층 보기 중입니다. 아래 체크박스를 누르면 다중 층 필터로 바로 전환됩니다.</p>
      <label v-for="s in filteredExplorerFacets.storeys" :key="s.id" :class="{ off: !!multiView }">
        <input type="checkbox" :checked="viewStorey ? viewStorey === s.id : facetOn('storeys', s.id)" :disabled="!!multiView" @change="toggleFacet('storeys', s.id, viewFacets.storeys.map((x) => x.id))" />
        <span class="facet-name">{{ s.name }}</span> <span class="muted">{{ s.count.toLocaleString() }}</span>
      </label>
    </details>
    <!-- 공간 보기. 층 하나를 볼 때 그 층의 방을 고르면 그 방으로 가서 그 방과 영향을 주는 설비만 남긴다. -->
    <details v-if="!multiView" open class="filter-group" data-testid="filter-spaces">
      <summary>
        <span class="group-tag" aria-hidden="true">SPACES</span> 공간
        <span class="muted">{{ spaceView ? spaceViewName : spacesStoreyId ? `${viewSpaces.length}개` : '층 하나를 고르면' }}</span>
        <button v-if="spaceView" type="button" class="link" @click.prevent="exitSpaceView">층 전체</button>
        <button v-if="spacesStoreyId" type="button" :class="['link', { on: spacesEmptyOnly }]" :aria-pressed="spacesEmptyOnly" data-testid="spaces-empty-only" title="체크리스트에 빈칸이 있는 방만 (Shift+, · Shift+. 로 옮겨 다닙니다)" @click.prevent="spacesEmptyOnly = !spacesEmptyOnly">빈칸 있는 방만</button>
      </summary>
      <p v-if="!spacesStoreyId" class="muted filter-note">층 하나를 고르면 그 층의 방을 골라 그 방만 볼 수 있습니다.</p>
      <p v-else-if="!viewSpaces.length" class="muted filter-note">{{ spacesEmptyOnly ? '빈칸 있는 방이 없습니다.' : explorerQuery ? '찾는 방이 없습니다.' : '이 층에는 물리존이 없습니다.' }}</p>
      <div v-if="viewSpaces.length" class="space-list">
      <button
        v-for="r in viewSpaces"
        :key="r.id"
        type="button"
        :class="['space-facet', { on: spaceView?.id === r.id }]"
        :aria-pressed="spaceView?.id === r.id"
        :title="`${r.name} ${r.longName} — 이 방으로 가서 방 안 설비와 바람을 대는 공기 원천만 봅니다`"
        @click="spaceView?.id === r.id ? exitSpaceView() : enterSpaceView(r.id)"
      >
        <span class="facet-name">{{ r.longName && r.longName !== r.name ? `${r.name} ${r.longName}` : r.name }}</span>
        <span class="muted">{{ r.devices.toLocaleString() }}<template v-if="r.conduits"> · 관 {{ r.conduits.toLocaleString() }}</template></span>
        <span v-if="r.check" :class="['space-score', { full: isFull(r.check) }]" :title="`온톨로지 체크리스트 ${r.check.have}/${r.check.of} 채움`">{{ r.check.have }}/{{ r.check.of }}</span>
      </button>
      </div>
    </details>
    <details open class="filter-group">
      <summary>
        <span class="group-tag" aria-hidden="true">CATEGORY</span> 설비 분류 <span class="muted">{{ viewFilter.classes ? `${viewFilter.classes.length}/${viewFacets.classes.length}` : '전부' }}</span>
        <button type="button" class="link" @click.prevent="setFacetAll('classes', true, viewFacets.classes.filter((c) => !c.conduit).map((c) => c.id))">기기 전부</button>
        <button type="button" class="link" @click.prevent="setFacetAll('classes', false, viewFacets.classes.filter((c) => c.conduit).map((c) => c.id))">덕트·배관 빼기</button>
        <button type="button" class="link" @click.prevent="setFacetAll('classes', true)">All</button>
      </summary>
      <label v-for="c in filteredExplorerFacets.classes" :key="c.id" :class="{ conduit: c.conduit }" :title="`${classFriendlyLabel(c.id)} (${c.id})`">
        <input type="checkbox" :checked="facetOn('classes', c.id)" @change="toggleFacet('classes', c.id, viewFacets.classes.map((x) => x.id))" />
        <span class="cls-wrap">
          <span class="cls-ko">{{ classFriendlyLabel(c.id) }}</span>
          <code>{{ c.id }}</code>
        </span>
        <span class="muted">{{ c.count.toLocaleString() }}</span>
      </label>
    </details>
    <details open class="filter-group">
      <summary>
        <span class="group-tag" aria-hidden="true">SYSTEMS</span> 계통 <span class="muted">{{ viewFilter.systems ? `${viewFilter.systems.length}/${viewFacets.systems.length}` : '전부' }}</span>
        <button type="button" class="link" @click.prevent="setFacetAll('systems', true)">All</button>
        <button type="button" class="link" @click.prevent="setFacetAll('systems', false)">Clear</button>
      </summary>
      <label v-for="s in filteredExplorerFacets.systems" :key="s.id">
        <input type="checkbox" :checked="facetOn('systems', s.id)" @change="toggleFacet('systems', s.id, viewFacets.systems.map((x) => x.id))" />
        <span class="facet-name">{{ s.name }}</span> <span class="muted">{{ s.count.toLocaleString() }}</span>
      </label>
    </details>
  </aside>
</template>
