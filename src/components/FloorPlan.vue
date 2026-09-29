<script setup lang="ts">
// 층 하나의 평면도. 방 외곽선과 이름, 벽, 설비 점을 위에서 그린다.
//
// 3D 와 탭으로 갈아 끼운다(한 번에 하나만 그린다). WebGL 을 하나 더 띄우지 않고 SVG 로 그린다 — 방 수백 개,
// 기기 천여 대는 SVG 로 충분하고, 글자와 선이 확대해도 깨지지 않는다.
//
// 좌표는 IFC 평면(미터, y 가 위)이다. SVG 는 y 가 아래라서 그릴 때 y 를 뒤집는다.
//
// 편집 모드에서 방을 고르면 꼭짓점 손잡이가 뜨고, 끌어 놓으면 부모가 lib/edit.ts 로 경계를 고친다. 끄는
// 동안은 여기서 미리보기만 그리고, 놓을 때 한 번만 알린다 — 끄는 내내 소속을 재판정하면 성수에서 느리다.
import { computed, ref, watch } from 'vue'
import { isConduit, type Storey, type Vec2 } from '../lib/model'
import { labelPoint } from '../lib/polygon'

const props = defineProps<{
  storey: Storey
  selectedId: string | null
  /** 고른 물리존. 3D 에서 고른 것과 같은 값이라, 여기서 누르면 부모가 오른쪽 패널에 그 방을 띄운다. */
  selectedSpaceId: string | null
  editing: boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  pickSpace: [id: string | null]
  moveVertex: [spaceId: string, index: number, to: Vec2]
}>()

const svg = ref<SVGSVGElement | null>(null)
const spaceId = computed(() => props.selectedSpaceId)
watch(
  () => props.storey.id,
  () => {
    view.value = null
  },
)

// --- 범위와 좌표 변환 ---------------------------------------------------------------
const bounds = computed(() => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const take = (x: number, y: number) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (const s of props.storey.spaces) for (const [x, y] of s.footprint) take(x, y)
  for (const w of props.storey.walls) for (const r of w.footprint ?? []) for (const [x, y] of r) take(x, y)
  for (const e of props.storey.equipment) if (e.position && !isConduit(e.role)) take(e.position[0], e.position[1])
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.03 + 0.5
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
})
/** IFC 평면 → SVG. y 를 뒤집는다. */
const sx = (x: number) => x - bounds.value.minX
const sy = (y: number) => bounds.value.maxY - y
const toSvg = ([x, y]: Vec2) => `${sx(x).toFixed(3)},${sy(y).toFixed(3)}`
const points = (ring: readonly Vec2[]) => ring.map(toSvg).join(' ')

// 확대·이동. null 이면 층 전체를 보인다.
const view = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const viewBox = computed(() => {
  const v = view.value ?? { x: 0, y: 0, w: bounds.value.maxX - bounds.value.minX, h: bounds.value.maxY - bounds.value.minY }
  return `${v.x} ${v.y} ${v.w} ${v.h}`
})
/** 화면 한 픽셀이 미터로 얼마인가. 선 굵기·글자·손잡이 크기를 확대와 무관하게 맞춘다. */
const unit = ref(0.05)
function measureUnit() {
  const el = svg.value
  if (!el) return
  const [, , w] = viewBox.value.split(' ').map(Number)
  unit.value = w / Math.max(el.clientWidth, 1)
}
watch(viewBox, () => requestAnimationFrame(measureUnit), { immediate: true })

/** 마우스 위치를 IFC 평면 좌표로. */
function toModel(event: PointerEvent | WheelEvent): Vec2 {
  const el = svg.value!
  const pt = el.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  const p = pt.matrixTransform(el.getScreenCTM()!.inverse())
  return [p.x + bounds.value.minX, bounds.value.maxY - p.y]
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const el = svg.value!
  const pt = el.createSVGPoint()
  pt.x = event.clientX
  pt.y = event.clientY
  const p = pt.matrixTransform(el.getScreenCTM()!.inverse())
  const [x, y, w, h] = viewBox.value.split(' ').map(Number)
  const k = event.deltaY > 0 ? 1.15 : 1 / 1.15
  view.value = { x: p.x - (p.x - x) * k, y: p.y - (p.y - y) * k, w: w * k, h: h * k }
}

// 빈 곳을 끌면 이동한다. 손잡이를 끌면 꼭짓점을 옮긴다.
let pan: { x: number; y: number; vx: number; vy: number } | null = null
/** 끌어서 옮겼으면 뒤따르는 클릭을 고르기로 치지 않는다. */
let moved = false
const drag = ref<{ index: number; at: Vec2 } | null>(null)

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const [x, y] = viewBox.value.split(' ').map(Number)
  pan = { x: event.clientX, y: event.clientY, vx: x, vy: y }
  moved = false
}
function onPointerMove(event: PointerEvent) {
  if (drag.value) {
    drag.value = { index: drag.value.index, at: toModel(event) }
    return
  }
  if (!pan) return
  if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 3) moved = true
  if (!moved) return
  const [, , w, h] = viewBox.value.split(' ').map(Number)
  view.value = { x: pan.vx - (event.clientX - pan.x) * unit.value, y: pan.vy - (event.clientY - pan.y) * unit.value, w, h }
}
function onPointerUp() {
  if (drag.value && spaceId.value) {
    const [x, y] = drag.value.at
    // 1mm 로 자른다. 끌기가 만든 소수점 끝자리가 편집 파일을 어지럽히지 않게.
    emit('moveVertex', spaceId.value, drag.value.index, [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])
  }
  drag.value = null
  pan = null
}
function startVertex(event: PointerEvent, index: number) {
  if (!props.editing) return
  event.stopPropagation()
  ;(event.target as Element).setPointerCapture?.(event.pointerId)
  drag.value = { index, at: toModel(event) }
}

// --- 그릴 것 -------------------------------------------------------------------------
const spaces = computed(() => props.storey.spaces.filter((s) => s.footprint.length >= 4))
// 이름표 자리. 꼭짓점 평균은 ㄷ자 방이면 방 밖(옆 방)에 떨어져서 방 안에서 변까지 가장 먼 점을 쓴다(labelPoint).
// 외곽선이 바뀔 때만 다시 잰다.
const labels = computed(() =>
  spaces.value.map((s) => {
    const [x, y] = labelPoint(s.footprint) ?? s.footprint[0]
    const xs = s.footprint.map((p) => p[0])
    const ys = s.footprint.map((p) => p[1])
    const text = s.longName || s.name
    // 글자 폭(글자 크기 단위). 한글은 한 글자가 1, 라틴·숫자는 0.6 쯤이다.
    const em = [...text].reduce((n, c) => n + (/[\u3131-\uD79D]/.test(c) ? 1 : 0.6), 0)
    return { id: s.id, text, x: sx(x), y: sy(y), em, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  }),
)
/**
 * 지금 확대에서 방에 들어가는 이름표만 그린다. 전체를 보면 작은 방(S.T, P.S)의 이름이 서로 겹쳐 읽을 수 없었다
 * (성수 19개 층에 67쌍). 확대하면 들어가는 만큼 나타난다. 고른 방의 이름은 늘 보인다.
 */
const fontSize = computed(() => unit.value * 11)
const shownLabels = computed(() =>
  labels.value.filter((l) => l.id === spaceId.value || (l.em * fontSize.value <= l.w * 0.95 && fontSize.value * 1.2 <= l.h)),
)
const devices = computed(() => props.storey.equipment.filter((e) => e.position && !isConduit(e.role)))
const selectedSpace = computed(() => spaces.value.find((s) => s.id === spaceId.value) ?? null)
/** 끄는 중이면 미리보기 고리. 닫는 점(첫 점과 같은 끝 점)도 같이 옮긴다. */
const previewRing = computed(() => {
  const s = selectedSpace.value
  if (!s) return null
  if (!drag.value) return s.footprint
  const ring = [...s.footprint]
  const last = ring.length - 1
  ring[drag.value.index] = drag.value.at
  if (drag.value.index === 0) ring[last] = drag.value.at
  return ring
})

function pickSpace(id: string) {
  if (moved) return
  emit('pickSpace', spaceId.value === id ? null : id)
}
</script>

<template>
  <svg
    ref="svg"
    class="floor-plan"
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    :aria-label="`${storey.name} 평면도`"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="onPointerUp"
  >
    <g class="spaces">
      <polygon
        v-for="s in spaces"
        :key="s.id"
        :points="points(s.footprint)"
        :class="{ chosen: s.id === spaceId }"
        :stroke-width="unit * 1.2"
        :data-space="s.id"
        @click.stop="pickSpace(s.id)"
      />
    </g>
    <g class="walls">
      <template v-for="w in storey.walls" :key="w.id">
        <polygon
          v-for="(r, i) in w.footprint ?? []"
          :key="i"
          :points="points(r)"
          :class="{ bearing: w.loadBearing === true }"
        />
      </template>
    </g>
    <g class="labels" :font-size="fontSize">
      <text v-for="l in shownLabels" :key="l.id" :x="l.x" :y="l.y" text-anchor="middle" dominant-baseline="middle">
        {{ l.text }}
      </text>
    </g>
    <g class="devices">
      <circle
        v-for="e in devices"
        :key="e.id"
        :cx="sx(e.position![0])"
        :cy="sy(e.position![1])"
        :r="unit * (e.id === selectedId ? 6 : 4)"
        :class="{ chosen: e.id === selectedId }"
        :data-equipment="e.id"
        @click.stop="!moved && emit('select', e.id)"
      >
        <title>{{ e.name || e.ifcClass }}</title>
      </circle>
    </g>
    <!-- 고른 방의 경계. 편집 모드면 꼭짓점 손잡이를 끌어 옮긴다. -->
    <g v-if="selectedSpace && previewRing" class="edit-ring">
      <polygon :points="points(previewRing)" :stroke-width="unit * 2" />
      <template v-if="editing">
        <circle
          v-for="(p, i) in previewRing.slice(0, -1)"
          :key="i"
          class="handle"
          :cx="sx(p[0])"
          :cy="sy(p[1])"
          :r="unit * 6"
          :stroke-width="unit * 1.5"
          :data-vertex="i"
          @pointerdown="startVertex($event, i)"
        />
      </template>
    </g>
  </svg>
</template>
