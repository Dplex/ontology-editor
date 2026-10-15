<script setup lang="ts">
import type { PropType } from 'vue'
import { EXTERIOR_LOCKED, wallLength } from '../../lib/edit'
import { replayMemo } from '../../lib/replay-player'
import { sinceOpen } from '../../editor/changes'
import { vKeepTyping } from '../../editor/edit-filter'
import { selectedElementId } from '../../editor/equipment-edit'
import { mmOf } from '../../editor/equipment-shape'
import { bearingSrc, externalOf } from '../../editor/export-compare'
import { applyOpeningPosition, applyOpeningSize, applyWallLength, applyWallSize, carryRooms, elementLabel, elementLock, facadeGroup, nameOfSpace, removeElement, setBearing, setExternal } from '../../editor/facade'
import Src from '../Src.vue'
import type { selectedElement as selectedElementRef } from '../../editor/export-compare'

// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)
defineProps({
  selectedElement: { type: null as unknown as PropType<NonNullable<typeof selectedElementRef.value>>, required: true },
})
</script>

<template>
  <section v-memo="replayMemo()" class="picked element-picked">
    <div class="picked-head">
      <div>
        <h3>{{ selectedElement.wall?.name || selectedElement.opening?.name || elementLabel(selectedElement.kind) }}</h3>
        <p class="stats">
          {{ selectedElement.wall?.loadBearing ? '내력벽' : elementLabel(selectedElement.kind) }}
          <Src :kind="selectedElement.wall ? bearingSrc(selectedElement.wall) : selectedElement.opening?.added ? 'edit' : 'bim'" /> ·
          {{ selectedElement.storey.name }}
          <template v-if="selectedElement.wall">
            · 두께 {{ selectedElement.wall.thickness !== null ? `${selectedElement.wall.thickness.toFixed(2)}m` : '모름' }}
            <!-- 외벽·내벽(OE-EXT-01). BIM(IsExternal)이 말하지 않으면 건물 바깥에 닿는지로 계산하고 출처를 가른다.
                 외곽선이 없어 계산도 못 하면 적지 않는다 — 내벽으로 보이면 아니오처럼 읽힌다. -->
            <template v-if="externalOf(selectedElement.wall.id)">
              · <span data-testid="wall-external">{{ externalOf(selectedElement.wall.id)!.external ? '외벽' : '내벽' }}</span>
              <Src :kind="externalOf(selectedElement.wall.id)!.source" />
            </template>
          </template>
          <template v-if="selectedElement.opening && externalOf(selectedElement.opening.wallId)">
            · {{ externalOf(selectedElement.opening.wallId)!.external ? '외벽' : '내벽' }}에 뚫림
            <Src :kind="externalOf(selectedElement.opening.wallId)!.source" />
          </template>
        </p>
      </div>
      <div class="picked-actions">
        <button type="button" class="ghost" @click="selectedElementId = null">선택 해제</button>
      </div>
    </div>
    <div v-if="facadeGroup" class="facade-note" data-testid="facade-group" :data-walls="facadeGroup.filter((x) => !x.bearing).map((x) => x.id).join(' ')">
      <p>
        <b>외벽 에디터</b> — 같은 면 외벽 {{ facadeGroup.length }}개({{ facadeGroup.map((x) => x.storeyName).join('·') }}). 방향키로 옮기면 함께 옮겨지고, 층마다
        벽 가까운 방 변이 따라가 설비 소속을 다시 잽니다.
      </p>
      <p v-if="facadeGroup.some((x) => x.bearing)" class="lock-note" data-testid="facade-bearing">
        {{ facadeGroup.filter((x) => x.bearing).map((x) => x.storeyName).join('·') }} 의 벽은 내력벽이라 제자리에 둡니다(내력벽은 값이 있으면 고치지 않습니다).
      </p>
      <p class="muted">크기 바꾸기·지우기는 아직 층 편집과 같이 막혀 있습니다.</p>
    </div>
    <p v-if="elementLock && !facadeGroup" class="lock-note" data-testid="wall-locked">
      <template v-if="elementLock === EXTERIOR_LOCKED">
        외벽이라 층 편집 화면에서는 옮기거나 지우거나 크기를 바꿀 수 없습니다. 외벽 형상은 외벽 에디터에서 고칩니다. 문·창과 외벽 전용
        설비는 이 화면에서 놓습니다. 아래 외벽 여부를 바꾸면 풀립니다.
      </template>
      <template v-else>
        {{ selectedElement.wall ? '내력벽이라' : '내력벽에 뚫린 것이라' }} 옮기거나 지울 수 없습니다.
        <template v-if="selectedElement.wall">아래 내력 여부를 바꾸면 풀립니다.</template>
      </template>
    </p>
    <!-- 크기(OE-OBJ-04 x·y·z). 길이·두께는 꼭짓점 넷인 벽만(문·창으로 조각난 벽은 옮기기만), 높이는 어느 벽이나. -->
    <p v-if="selectedElement.wall && !elementLock" class="position-edit wall-length wall-size">
      <label v-if="wallLength(selectedElement.wall) !== null">
        길이
        <input
          class="coord mono"
          type="number"
          step="0.1"
          min="0.1"
          data-testid="wall-length"
          v-keep-typing
          :value="wallLength(selectedElement.wall)!.toFixed(2)"
          @change="applyWallLength(selectedElement.wall!, ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label v-if="wallLength(selectedElement.wall) !== null">
        두께
        <input
          class="coord mono"
          type="number"
          step="0.05"
          min="0.05"
          data-testid="wall-thickness"
          v-keep-typing
          :value="selectedElement.wall.thickness?.toFixed(2) ?? ''"
          placeholder="모름"
          @change="applyWallSize(selectedElement.wall!, 'thickness', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        높이
        <input
          class="coord mono"
          type="number"
          step="0.1"
          min="0.1"
          data-testid="wall-height"
          v-keep-typing
          :value="selectedElement.wall.height?.toFixed(2) ?? ''"
          placeholder="모름"
          @change="applyWallSize(selectedElement.wall!, 'height', ($event.target as HTMLInputElement).value)"
        />
        m
        <!-- 높이는 형상의 위아래 폭으로 잰 값(계산)이다. 연 뒤에 고쳤으면 편집. 모르면 칩을 달지 않는다. -->
        <Src
          v-if="selectedElement.wall.height != null"
          :kind="selectedElement.wall.added || sinceOpen.wallsChanged.some((c) => c.id === selectedElement!.wall!.id && c.resized) ? 'edit' : 'calc'"
        />
      </label>
      <span class="muted">{{
              wallLength(selectedElement.wall) !== null
                ? '길이·두께는 가운데를 두고 같이 늘거나 줄어듭니다. 높이 빈칸은 모름입니다.'
                : '문·창으로 조각났거나 꺾인 벽은 길이·두께를 바꾸지 않고 옮기기만 됩니다. 높이 빈칸은 모름입니다.'
            }}</span>
    </p>
    <!-- 외벽 여부(OE-OBJ-04). 지금 판정(BIM·계산·편집)을 보이고, 고르면 사람이 정한 값이 된다. -->
    <p v-if="selectedElement.wall" class="storey-move">
      <label>
        외벽
        <select
          data-testid="wall-external-select"
          :value="String(externalOf(selectedElement.wall.id)?.external ?? null)"
          @change="setExternal(selectedElement.wall!, ($event.target as HTMLSelectElement).value)"
        >
          <option value="true">외벽</option>
          <option value="false">내벽</option>
          <option value="null">모름</option>
        </select>
      </label>
      <Src v-if="externalOf(selectedElement.wall.id)" :kind="externalOf(selectedElement.wall.id)!.source" />
      <span class="muted">{{ externalOf(selectedElement.wall.id)?.source === 'calc' ? '건물 바깥에 닿는지로 계산했습니다. 틀리면 고르세요.' : '' }}</span>
    </p>
    <p v-if="selectedElement.wall && !elementLock" class="storey-move carry-rooms">
      <label title="벽 면에서 0.6m 안의 방 변이 벽이 움직인 만큼 따라옵니다. 끄면 방 경계는 그대로입니다(방은 IfcSpace 가 따로 그린 것)">
        <input v-model="carryRooms" type="checkbox" /> 옮길 때 방 경계도 같이
      </label>
    </p>
    <p v-if="selectedElement.wall" class="storey-move">
      <label>
        내력
        <select
          data-testid="wall-bearing"
          :value="String(selectedElement.wall.loadBearing)"
          @change="setBearing(selectedElement.wall!, ($event.target as HTMLSelectElement).value)"
        >
          <option value="true">내력벽</option>
          <option value="false">비내력벽</option>
          <option value="null">모름</option>
        </select>
      </label>
      <Src :kind="bearingSrc(selectedElement.wall)" />
      <span class="muted">{{ selectedElement.wall.loadBearing === null ? "'모름'은 비내력벽과 구분되며 내벽처럼 편집할 수 있습니다." : "'모름'은 비내력벽과 구분됩니다." }}</span>
    </p>
    <!-- 문·창 크기(OE-OBJ-07). 자리(가운데)는 두고 가로·세로만 바꾼다. 모르는 값은 빈칸이다. -->
    <p v-if="selectedElement.opening" class="opening-size">
      크기
      <label v-for="key in ['width', 'height'] as const" :key="key">
        {{ key === 'width' ? '가로' : '세로' }}
        <input
          class="coord mono"
          type="number"
          step="0.1"
          min="0.1"
          v-keep-typing
          :disabled="!!elementLock"
          :value="selectedElement.opening[key] != null ? selectedElement.opening[key]!.toFixed(2) : ''"
          :placeholder="'모름'"
          @change="applyOpeningSize(selectedElement.opening!, key, ($event.target as HTMLInputElement).value)"
        />
      </label>
      m
    </p>
    <p v-if="selectedElement.opening?.position" class="position-edit">
      자리
      <label v-for="axis in [0, 1] as const" :key="axis">
        {{ 'xy'[axis] }}
        <input
          class="coord mono"
          type="number"
          step="0.1"
          v-keep-typing
          :disabled="!!elementLock"
          :value="mmOf(selectedElement.opening.position[axis])"
          @change="applyOpeningPosition(selectedElement.opening!, axis, ($event.target as HTMLInputElement).value, $event.target as HTMLInputElement)"
        />
      </label>
    </p>
    <p v-if="selectedElement.opening?.kind === 'door'" class="stats">
      연결 공간:
      {{ selectedElement.opening.connects?.length ? selectedElement.opening.connects.map(nameOfSpace).join(' · ') : '(없음)' }}
      <Src v-if="selectedElement.opening.connectsSource" :kind="selectedElement.opening.connectsSource === 'bim' ? 'bim' : 'calc'" />
    </p>
    <p v-if="!elementLock" class="danger-zone">
      <button type="button" class="ghost danger" @click="removeElement">
        {{ elementLabel(selectedElement.kind) }} 지우기
      </button>
      <span class="muted">
        {{ selectedElement.wall ? '뚫린 문·창도 같이 지워집니다. ' : '' }}방향키로 옮깁니다(Shift 1m).
        {{ selectedElement.wall && carryRooms ? '벽 가까운 방 변이 벽에 수직으로 따라옵니다.' : '방 경계는 따라 바뀌지 않습니다.' }}
      </span>
    </p>
  </section>
</template>
