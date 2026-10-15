import { ref, watch } from 'vue'
import { classOf } from '../lib/export/ttl'
import { replayOpen } from '../lib/replay-player'
import { NO_SYSTEM } from '../lib/view-filter'
import { ceilingMode } from './ceiling'
import { nameOfId } from './connections'
import { canvas, model } from './core'
import { shortName } from './equipment-shape'
import { equipmentById, selectedId } from './flow-rules'
import { hoverTip } from './hover-tip'
import { flying, note, setFlying } from './keyboard'
import { group } from './multi-select'
import { viewStorey } from './multi-view'
import { viewer } from './scene'
import { copyText } from './share-link'
import { select } from './systems'
import { clearViewFilter, filterOpen, setViewFilter, toggleExplode, viewFilter } from './view-filter'

// --- 3D 우클릭 메뉴 (E3) ---
export const ctxMenu = ref<{ x: number; y: number; ids: string[]; cls: string | null; systemId: string | null } | null>(null)
export function openContext(id: string | null, x: number, y: number) {
  const wrap = canvas.value?.parentElement?.getBoundingClientRect()
  if (!wrap) return
  hoverTip.value?.hide()
  const e = id ? (equipmentById.value.get(id) ?? null) : null
  // 여러 개 고른 묶음 안을 누르면 묶음 전체가 대상이다. 아니면 누른 것을 고른다(메뉴가 무엇에 대한 것인지 패널·강조로 보인다).
  const ids = e ? (group.value.includes(e.id) && group.value.length > 1 ? [...group.value] : [e.id]) : []
  if (e && ids.length === 1 && selectedId.value !== e.id) select(e.id)
  // 3D 오른쪽·아래 끝에서 누르면 메뉴가 잘린다. 대략의 메뉴 크기(넓이 20rem·높이 항목 수)만큼 안쪽으로 당긴다.
  const w = 320
  const h = (ids.length ? 7 : 5) * 30 + 30
  ctxMenu.value = {
    x: Math.max(4, Math.min(x - wrap.left, wrap.width - w)),
    y: Math.max(4, Math.min(y - wrap.top, wrap.height - h)),
    ids,
    cls: e ? classOf(e) : null,
    systemId: e?.systemId ?? null,
  }
}
export function closeContext() {
  ctxMenu.value = null
}
export function ctxHide() {
  const c = ctxMenu.value
  if (!c) return
  setViewFilter({ hidden: [...new Set([...viewFilter.value.hidden, ...c.ids])], isolate: viewFilter.value.isolate?.filter((x) => !c.ids.includes(x)) ?? null })
  note(`${c.ids.length === 1 ? shortName(nameOfId(c.ids[0])) : `설비 ${c.ids.length}대`}를 숨겼습니다 — 화면에서만. 빈 곳 우클릭 [모두 보이기] 로 돌아옵니다`)
  closeContext()
}
export function ctxIsolate() {
  const c = ctxMenu.value
  if (!c) return
  setViewFilter({ isolate: c.ids, hidden: viewFilter.value.hidden.filter((x) => !c.ids.includes(x)) })
  viewer?.frame(c.ids, 1)
  note(`${c.ids.length === 1 ? shortName(nameOfId(c.ids[0])) : `설비 ${c.ids.length}대`}만 보입니다 — 화면에서만`)
  closeContext()
}
export function ctxFrame() {
  const c = ctxMenu.value
  if (c) viewer?.frame(c.ids, 1)
  closeContext()
}
export function ctxOnlyClass() {
  const c = ctxMenu.value
  if (!c?.cls) return
  setViewFilter({ classes: [c.cls], isolate: null })
  filterOpen.value = true
  closeContext()
}
export function ctxOnlySystem() {
  const c = ctxMenu.value
  if (!c) return
  setViewFilter({ systems: [c.systemId ?? NO_SYSTEM], isolate: null })
  filterOpen.value = true
  closeContext()
}
export async function ctxCopy() {
  const c = ctxMenu.value
  if (!c) return
  closeContext()
  // 55 같은 http 주소에서는 Clipboard API 가 없어 늘 실패했다 — copyText 가 다른 길로 넣는다.
  if (await copyText(c.ids.join('\n'))) note(`GlobalId ${c.ids.length}개를 복사했습니다`)
  else note(`복사하지 못했습니다(브라우저가 막음): ${c.ids.slice(0, 3).join(', ')}`)
}
export function ctxShowAll() {
  clearViewFilter()
  closeContext()
}
export function ctxFit(keep: boolean) {
  viewer?.frameVisible(keep)
  closeContext()
}
export function ctxExplode() {
  toggleExplode()
  closeContext()
}

// --- 3D / 평면도 ---------------------------------------------------------------------
//
// 평면도는 3D 와 탭으로 갈아 끼운다(한 번에 하나만 그린다). 층 하나를 골랐을 때만 그리고, 고른 층·고른 설비는
// 3D 와 같은 상태(viewStorey, selectedId)를 쓴다. 꼭짓점 끌기는 3D 에서 놓는 것과 같은 길(dropVertex — 자기 교차
// 막기, cm 로 자르기, 되돌리기 이력)을 탄다.
export const activeTab = ref<'3d' | 'plan'>('3d')
/** 3D 오른쪽 위 방향 큐브의 캔버스. 뷰어가 있고 캔버스가 뜨면 붙인다. */
export const cubeCanvas = ref<HTMLCanvasElement | null>(null)

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupContextMenu() {
  window.addEventListener('pointerdown', (e) => {
    if (ctxMenu.value && !(e.target as HTMLElement | null)?.closest?.('.ctx-menu')) closeContext()
  })
  // 천장 모드에서 층을 바꾸면 위에서 내려다보는 시점을 지킨다(OE-OBJ-08). 비행 중에는 시점을 그대로 둔다 — 층 이동(E E · Q Q)이
  // 보일 층을 같이 넘기는데, 여기서 전체 보기로 다시 맞추면 옮긴 눈높이가 덮인다.
  watch(viewStorey, () => (flying.value ? undefined : ceilingMode.value ? viewer?.topView() : viewer?.frameAll()))
  // 비행 모드는 3D 에서만이다. 리플레이는 제 카메라를 쓴다.
  watch([replayOpen, activeTab], ([open, tab]) => {
    if (open || tab !== '3d') setFlying(false)
  })
  // 모델이 있느냐만 본다 — 편집마다 다시 붙이면 WebGL 문맥을 편집마다 새로 만든다. 뷰어는 위의 watch([model, canvas]) 가 먼저 만든다.
  watch([cubeCanvas, () => !!model.value], ([el], _, onCleanup) => {
    if (!el || !viewer) return
    onCleanup(viewer.attachNavCube(el))
  })
}
