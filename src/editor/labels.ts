import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { type LabelBadge, labelBadges, placeLabels } from '../lib/equipment-labels'
import { isConduit } from '../lib/model'
import { replayOpen, useReplay } from '../lib/replay-player'
import { activeTab } from './context-menu'
import { canvas, dark, editing, fileName, model } from './core'
import { shortName } from './equipment-shape'
import { activeArrow, arrowConnections, arrowOf, equipmentById, selected, selectedId } from './flow-rules'
import { future, history, redo, undo } from './history'
import { flushNudge, note } from './keyboard'
import { storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { sceneVersion } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedSpace } from './space-objects'
import { multiView } from './vertical'

// --- 3D 위 설비 라벨 (V4, lib/equipment-labels.ts) ---
// 층 하나를 3D 로 볼 때만 띄운다(여러 층이면 겹쳐 읽을 수 없다). 덕트·배관 구간·이음쇠는 빼고 기기만이다. 시점이 바뀔 때마다
// (viewer.viewVersion) 자리를 다시 재서, 고른 것·화면 가운데에 가까운 것부터 겹치지 않는 만큼만(LABEL_MAX) 둔다.
export const showLabels = ref(false)
const LABEL_MAX = 40
export const labelStorey = computed(() => (activeTab.value === '3d' && !multiView.value && viewStorey.value ? (model.value?.storeys.find((s) => s.id === viewStorey.value) ?? null) : null))
export const equipmentLabels = shallowRef<{ id: string; x: number; y: number; name: string; badges: LabelBadge[] }[]>([])
let labelLoop = 0
let labelSeen = ''
function measureLabels() {
  const st = labelStorey.value
  const wrap = canvas.value?.parentElement
  if (!showLabels.value || !st || !viewer || !wrap || replayOpen.value) {
    if (equipmentLabels.value.length) equipmentLabels.value = []
    labelLoop = 0
    return
  }
  const seen = `${viewer.viewVersion()}|${st.id}|${selectedId.value}|${sceneVersion.value}`
  if (seen !== labelSeen) {
    labelSeen = seen
    const items = st.equipment.filter((e) => e.position && !isConduit(e.role))
    const at = viewer.screenOf(items.map((e) => e.id))
    const r = wrap.getBoundingClientRect()
    const names = items.map((e) => shortName(e.name))
    const candidates = items.flatMap((e, i) => {
      const p = at[i]
      // 라벨 폭은 글자 수로 어림한다(이름 + 배지 둘). 재서 놓으면 한 번 그려야 해서 화면이 한 박자 늦는다.
      const seenSize = labelSize.get(e.id)
      return p ? [{ id: e.id, x: p.x - r.left, y: p.y - r.top, w: seenSize?.w ?? Math.min(names[i].length, 22) * 8 + 140, h: seenSize?.h ?? 24, first: e.id === selectedId.value }] : []
    })
    const placed = placeLabels(candidates, { x: r.width / 2, y: r.height / 2 }, LABEL_MAX)
    const byId = new Map(items.map((e, i) => [e.id, { e, name: names[i] }]))
    equipmentLabels.value = placed.map((l) => {
      const { e, name } = byId.get(l.id)!
      const b = labelBadges(e)
      return { id: l.id, x: l.x, y: l.y, name, badges: [b.space, b.kind] }
    })
    // 처음 그린 라벨의 실제 크기를 재 둔다(어림한 폭으로 놓였다). 다르면 다음 프레임에 다시 놓는다. 이미 잰 라벨은 다시 재지 않는다 —
    // 끌어 돌리는 동안 프레임마다 재면 레이아웃을 강제해 성수 3F 에서 p95 프레임 간격이 16.7 → 33.3ms 가 됐다.
    if (equipmentLabels.value.some((l) => !labelSize.has(l.id)))
      nextTick(() => {
        let changed = false
        for (const el of wrap.querySelectorAll<HTMLElement>('.eq-label')) {
          const id = el.dataset.id!
          if (labelSize.has(id)) continue
          labelSize.set(id, { w: el.offsetWidth + 6, h: el.offsetHeight + 4 })
          changed = true
        }
        if (changed) labelSeen = ''
      })
  }
  labelLoop = requestAnimationFrame(measureLabels)
}
/** 라벨 id → 그려 잰 크기(px, 여백 포함). 이름·배지가 같으면 크기도 같아 한 번 재면 된다. */
const labelSize = new Map<string, { w: number; h: number }>()
// 편집 리플레이(PoC). 진행은 lib/replay-player.ts 가 하고, 여기서는 빌려줄 것만 넘긴다. 쓰는 것이 다 선언된 뒤라 여기서 부른다.
export let replay: ReturnType<typeof useReplay>
// 편집은 모델을 그 자리에서 고치고 triggerRef 로 알린다. 같은 층 객체를 넘기면 평면도가 다시 그릴 이유를 몰라서, 방향키로
// 옮긴 설비의 점과 끌어 놓은 방 외곽선이 예전 자리에 남았다. 알릴 때마다 얕은 사본을 넘긴다(층 하나라 싸다).
// 층이 하나면 층 목록이 없으니 그 층을 그린다 — "층을 고르세요" 만 뜨고 고를 곳이 없었다.
export const planStorey = computed(() => {
  const m = model.value
  const storey = m?.storeys.find((s) => s.id === viewStorey.value) ?? (m?.storeys.length === 1 ? m.storeys[0] : undefined)
  return storey ? { ...storey } : null
})
/** 평면도로 갈 때 층이 안 골라져 있으면 고른 방·설비의 층으로 연다. 고른 것이 없으면 층 목록에서 고르게 둔다. */
export function showPlan() {
  activeTab.value = 'plan'
  if (planStorey.value) return
  const st = selectedSpace.value?.storey ?? (selected.value ? storeyOf(selected.value.id) : null)
  if (st) viewStorey.value = st.id
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupLabels() {
  watch([showLabels, labelStorey, replayOpen], () => {
    labelSeen = ''
    if (!labelLoop) labelLoop = requestAnimationFrame(measureLabels)
  })
  onBeforeUnmount(() => cancelAnimationFrame(labelLoop))
  replay = useReplay({
    get viewer() {
      return viewer
    },
    model, fileName, history, future, undo, redo, viewStorey, selectedId, selectedSpaceId, activeTab, editing, dark,
    equipmentById, arrowConnections, arrowOf, activeArrow, shortName, flushNudge, note,
  })
  // 고른 설비·물리존이 다른 층이면 그 층으로. 다중층 뷰는 여러 층을 같이 보니 따라가지 않는다 — 따라가면 층 편집 화면의 "다른 층으로 가기 전에
  // 저장할까요" 를 물었다(층간 배관의 2층 구간을 고를 때, OE-ML-14).
  watch([selectedId, selectedSpaceId], ([eq, sp]) => {
    if (!viewStorey.value || !model.value || multiView.value) return
    const home = eq ? storeyOf(eq) : sp ? model.value.storeys.find((s) => s.spaces.some((x) => x.id === sp)) : null
    if (home && home.id !== viewStorey.value) viewStorey.value = home.id
  })
}
