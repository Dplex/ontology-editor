<script setup lang="ts">
import type { PropType } from 'vue'
import { NO_SYSTEM } from '../../lib/view-filter'
import { systemById } from '../../editor/checks'
import { nameOfId } from '../../editor/connections'
import { ctxCopy, ctxExplode, ctxFit, ctxFrame, ctxHide, ctxIsolate, ctxOnlyClass, ctxOnlySystem, ctxShowAll } from '../../editor/context-menu'
import { shortName } from '../../editor/equipment-shape'
import { exploded, filterOn } from '../../editor/view-filter'
import type { ctxMenu as ctxMenuRef } from '../../editor/context-menu'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  ctxMenu: { type: null as unknown as PropType<NonNullable<typeof ctxMenuRef.value>>, required: true },
})
</script>

<template>
  <div
    class="ctx-menu"
    role="menu"
    data-testid="ctx-menu"
    :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
    @contextmenu.prevent
  >
    <template v-if="ctxMenu.ids.length">
      <p class="ctx-head">{{ ctxMenu.ids.length === 1 ? shortName(nameOfId(ctxMenu.ids[0])) : `설비 ${ctxMenu.ids.length}대` }}</p>
      <button type="button" role="menuitem" @click="ctxHide">숨기기</button>
      <button type="button" role="menuitem" @click="ctxIsolate">이것만 보기</button>
      <button type="button" role="menuitem" @click="ctxFrame">시점 맞추기</button>
      <button v-if="ctxMenu.cls" type="button" role="menuitem" @click="ctxOnlyClass">같은 클래스만 <code>{{ ctxMenu.cls }}</code></button>
      <button type="button" role="menuitem" @click="ctxOnlySystem">같은 계통만 <span class="muted">{{ ctxMenu.systemId ? (systemById.get(ctxMenu.systemId)?.name || ctxMenu.systemId) : NO_SYSTEM }}</span></button>
      <button type="button" role="menuitem" @click="ctxCopy">GlobalId 복사</button>
    </template>
    <template v-else>
      <button type="button" role="menuitem" :disabled="!filterOn && !exploded" @click="ctxShowAll">모두 보이기</button>
      <button type="button" role="menuitem" @click="ctxFit(true)">전체 맞추기</button>
      <button type="button" role="menuitem" @click="ctxFit(false)">카메라 초기화</button>
      <button type="button" role="menuitem" @click="ctxExplode">{{ exploded ? '분해도 접기' : 'Brick 클래스별 분해도' }}</button>
    </template>
    <p class="ctx-foot muted">화면에서만 — 편집 파일·TTL·GeoJSON 에는 남지 않습니다</p>
  </div>
</template>
