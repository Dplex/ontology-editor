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
//
// 고른 것(설비·방·벽)은 부모가 들고 3D·오른쪽 패널과 같이 쓴다(OE-UI-11). 벽은 3D 처럼 편집 모드에서 [벽·문·창] 을
// 켰을 때만 눌러 고른다 — 아니면 벽 위를 눌러도 밑의 방이 골라진다. 문·창은 평면도에 그리지 않는다.
//
// 수직 관통 오브젝트(계단)의 이 층 조각은 방 위에 분홍으로 그리고, 진입 지점은 채운 원·종료 지점은 빈 원이다(OE-ML-05). 누르면 조각이
// 골라지고(pickSpace 로 조각 id), 고른 조각을 다시 누르면 그 자리의 방이 골라진다. 끌어 옮기지 않는다.
import { computed, ref, watch } from 'vue'
import { isConduit, type Storey, type Vec2 } from '../lib/model'
import { labelPoint } from '../lib/polygon'
import { locate } from '../lib/mapping'
import { partId } from '../lib/vertical-object'
import { isMultiSelect } from '../lib/shortcuts'

const props = defineProps<{
  storey: Storey
  selectedId: string | null
  /** 고른 물리존. 3D 에서 고른 것과 같은 값이라, 여기서 누르면 부모가 오른쪽 패널에 그 방을 띄운다. */
  selectedSpaceId: string | null
  /** 고른 수직 관통 오브젝트 조각(`부모 id@층 id`). */
  selectedVerticalId?: string | null
  /** 고른 벽. 3D 의 [벽·문·창] 에서 고른 것과 같은 값이다. */
  selectedElementId: string | null
  editing: boolean
  /** 벽을 눌러 고를 수 있나. 3D 와 같이 편집 모드에서 [벽·문·창] 을 켰을 때만이다. */
  pickWalls: boolean
  /** 여러 개 고른 설비(OE-UI-09). 고른 색으로 그린다. */
  group?: readonly string[]
}>()
const emit = defineEmits<{
  /** `additive` 는 Ctrl(⌘)을 누른 채 누른 것(여러 개 고르기, OE-UI-09). */
  select: [id: string, additive: boolean]
  /** 편집 모드에서 Ctrl+끌기로 그린 상자 안의 설비(OE-UI-09). */
  selectBox: [ids: string[]]
  pickSpace: [id: string | null]
  pickElement: [id: string]
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
// 건물(방·벽)에 맞추고, 설비는 건물 가까이 있는 것만 넣는다. 설비를 다 넣었더니 방 밖 40m 에 놓인 조명 하나 때문에
// 10m 방이 한 구석에 작게 그려졌다. 멀리 있는 설비도 그려지고, 끌어 옮기거나 줄이면 보인다. 방·벽이 없는 층(설비
// 파일만 연 것)은 설비로 맞춘다.
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
  const placed = props.storey.equipment.filter((e) => e.position && !isConduit(e.role))
  if (Number.isFinite(minX)) {
    const reach = Math.max(maxX - minX, maxY - minY) * 0.1 + 2
    const [x0, y0, x1, y1] = [minX - reach, minY - reach, maxX + reach, maxY + reach]
    for (const e of placed) {
      const [x, y] = e.position!
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) take(x, y)
    }
  } else {
    for (const e of placed) take(e.position![0], e.position![1])
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.03 + 0.5
  // 위에는 3D·평면도 단추 줄이, 아래에는 안내 줄이 떠 있다. 높이에 맞춰 그려지는 층은 위아래 끝이 그 밑에 깔려
  // 모서리 손잡이를 못 잡았다. 위아래만 높이의 10% 를 더 둔다.
  const padY = pad + (maxY - minY) * 0.1
  return { minX: minX - pad, minY: minY - padY, maxX: maxX + pad, maxY: maxY + padY }
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
/** Ctrl+끌기로 그리는 고르기 상자(OE-UI-09). IFC 평면 좌표. */
const box = ref<{ from: Vec2; to: Vec2 } | null>(null)

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  if (props.editing && isMultiSelect(event)) {
    const at = toModel(event)
    box.value = { from: at, to: at }
    moved = false
    return
  }
  const [x, y] = viewBox.value.split(' ').map(Number)
  pan = { x: event.clientX, y: event.clientY, vx: x, vy: y }
  moved = false
}
function onPointerMove(event: PointerEvent) {
  if (box.value) {
    box.value = { from: box.value.from, to: toModel(event) }
    if (Math.hypot(box.value.to[0] - box.value.from[0], box.value.to[1] - box.value.from[1]) > unit.value * 4) moved = true
    return
  }
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
  if (box.value) {
    const { from, to } = box.value
    box.value = null
    // 거의 안 끌었으면 Ctrl+클릭이다(점의 @click 이 받는다).
    if (!moved) return
    const [x0, x1, y0, y1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0]), Math.min(from[1], to[1]), Math.max(from[1], to[1])]
    emit('selectBox', devices.value.filter((e) => e.position![0] >= x0 && e.position![0] <= x1 && e.position![1] >= y0 && e.position![1] <= y1).map((e) => e.id))
    return
  }
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

/** 이 층의 수직 관통 오브젝트 조각. 형상이 없는 끝 층 조각은 종료 지점만 있다. */
const verticals = computed(() =>
  (props.storey.verticalParts ?? []).map((part) => ({ id: partId(part.parentId, props.storey.id), part, ring: part.footprint.length >= 3 ? part.footprint : null })),
)
/** 조각을 누른다. 이미 고른 조각이면 그 자리의 방을 고른다 — 계단실을 고칠 길이다. */
function pickVertical(event: MouseEvent, id: string) {
  if (moved) return
  if (props.selectedVerticalId !== id) return emit('pickSpace', id)
  const under = locate(toModel(event as PointerEvent), props.storey.spaces)
  emit('pickSpace', under)
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
          :class="{ bearing: w.loadBearing === true, chosen: w.id === selectedElementId, pickable: pickWalls }"
          :data-wall="w.id"
          @click.stop="pickWalls && !moved && emit('pickElement', w.id)"
        />
      </template>
    </g>
    <g class="verticals" :class="{ inert: pickWalls }">
      <template v-for="v in verticals" :key="v.id">
        <polygon
          v-if="v.ring"
          :points="points(v.ring)"
          :class="{ chosen: v.id === selectedVerticalId }"
          :stroke-width="unit * 1.5"
          :data-vertical="v.id"
          @click.stop="pickVertical($event, v.id)"
        >
          <title>{{ v.part.name }}</title>
        </polygon>
        <circle
          v-for="[mark, p] in ([['entry', v.part.entry], ['exit', v.part.exit]] as const).filter(([, q]) => q)"
          :key="mark"
          :class="[mark, { chosen: v.id === selectedVerticalId }]"
          :cx="sx(p![0])"
          :cy="sy(p![1])"
          :r="unit * 6"
          :stroke-width="unit * 2"
          :data-vertical="v.id"
          :data-mark="mark"
          @click.stop="pickVertical($event, v.id)"
        >
          <title>{{ v.part.name }} {{ mark === 'entry' ? '진입 지점' : '종료 지점' }}</title>
        </circle>
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
        :r="unit * (e.id === selectedId || group?.includes(e.id) ? 6 : 4)"
        :class="{ chosen: e.id === selectedId || group?.includes(e.id) }"
        :data-equipment="e.id"
        @click.stop="!moved && emit('select', e.id, isMultiSelect($event))"
      >
        <title>{{ e.name || e.ifcClass }}</title>
      </circle>
    </g>
    <!-- Ctrl+끌기 고르기 상자(OE-UI-09). -->
    <rect
      v-if="box"
      class="box-select"
      :x="sx(Math.min(box.from[0], box.to[0]))"
      :y="sy(Math.max(box.from[1], box.to[1]))"
      :width="Math.abs(box.to[0] - box.from[0])"
      :height="Math.abs(box.to[1] - box.from[1])"
      :stroke-width="unit * 1.2"
      :stroke-dasharray="`${unit * 4} ${unit * 3}`"
    />
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
