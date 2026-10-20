// 편집 화면 뼈대(OE-UI-04 · OE-UI-17 · OE-UI-18) — 헤더 · 도구 레일 · 캔버스 · 우측 위아래 두 카드 · 상태줄과
// 기준 · 검증 드로어의 상태. 화면 뼈대는 docs/prd/design-system.md 4장이고, 이 모듈은 그 자리끼리 나누는 값만 둔다.
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { isConduit } from '../lib/model'
import { editPart } from './ceiling'
import { openCheckKey } from './checks'
import { editing, model } from './core'
import { conduitId, selectedId } from './flow-rules'
import { legend, selectedSystemId } from './kinds'
import { group } from './multi-select'
import { viewStorey } from './multi-view'
import { warningsCollapsed } from './panels'
import { selectedSpaceId } from './rooms'
import { selectedCustomZoneId } from './space-edit'
import { drawing } from './space-objects'

/** 기준 · 검증 드로어(OE-UI-18). 비모달이라 3D · 우측 패널은 그대로 다룬다. 3D 아래에 이어지던 리포트 · 검사 · 표가 이 안에 든다. */
export const drawerOpen = ref(false)

/**
 * 드로어를 열고 그 자리(`#warnings` · `#changes` 등)로 간다. 자리를 안 주면 드로어만 연다.
 * 스크롤은 드로어 안에서만 한다 — scrollIntoView 는 페이지까지 옆으로 밀어(스크롤 없는 화면이라 되돌릴 길이 없다) 헤더 왼쪽이 잘렸다.
 */
export function openDrawer(anchor?: string) {
  drawerOpen.value = true
  if (anchor === 'warnings') warningsCollapsed.value = false
  if (!anchor) return
  void nextTick(() => {
    const el = document.getElementById(anchor)
    if (el) scrollInDrawer(el)
  })
}

/** 드로어 안의 그 요소를 드로어 맨 위로. 드로어 밖 요소면 아무것도 하지 않는다(false). */
export function scrollInDrawer(el: Element): boolean {
  const body = el.closest('.shell-drawer-body')
  if (!(body instanceof HTMLElement)) return false
  body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 8
  return true
}

/** 레일 펼침 칸(RailPanel). 공간 편집의 공조존 · 평면도 배경 · 벽·문·창 설정. 기준 · 검증 패널에서 고치는 칸을 빼며 여기로 옮겼다. */
export const railPanel = ref<'hvac' | 'background' | 'elements' | null>(null)

/** 층 현황(우측 아래)의 종류 칸. 다섯 칸이 design-system.md 4장 그대로다. */
export type FloorKind = 'space' | 'custom' | 'hvac' | 'equipment' | 'objects'
export const floorKind = ref<FloorKind>('space')
/** 층 현황 접기. 접으면 위 카드(선택 오브젝트)가 열 전체를 쓴다 — 설비 인스펙터가 길다. 이 브라우저에만 남는다. */
export const floorCollapsed = ref(
  (() => {
    try {
      return localStorage.getItem('oe-floor-collapsed') === '1'
    } catch {
      return false
    }
  })(),
)
export function toggleFloorCollapsed() {
  floorCollapsed.value = !floorCollapsed.value
  try {
    localStorage.setItem('oe-floor-collapsed', floorCollapsed.value ? '1' : '0')
  } catch {
    // 저장을 못 해도 이번 세션 동안은 그대로 쓴다.
  }
}
export const floorSearch = ref('')
/** 설비 칸의 종류 칩. 다시 누르면 풀린다. */
export const floorEquipKind = ref<string | null>(null)

/**
 * 지금 보는 층(한 층일 때만). 모든 층이면 층 현황은 파일 전체를 센다. 층이 하나뿐인 파일은 층 고르기 칸이 없어(RightCol) 늘 "모든 층" 이라,
 * 그 층으로 본다 — 아니면 층 이름 · 천장고를 고치는 칸(StoreyEdit)이 뜨지 않았다.
 */
export const shellStorey = computed(() => {
  const m = model.value
  if (!m) return null
  const id = viewStorey.value ?? (m.storeys.length === 1 ? m.storeys[0].id : null)
  return id ? (m.storeys.find((s) => s.id === id) ?? null) : null
})

/** 설비 칸 목록. 층 하나면 그 층, 모든 층이면 파일 전체의 기기(덕트 · 배관 빼고). 많으면 앞의 것만 그린다. */
export const floorEquipment = computed(() => {
  const m = model.value
  if (!m) return []
  const sts = shellStorey.value ? [shellStorey.value] : m.storeys
  return sts.flatMap((s) => s.equipment.filter((e) => !isConduit(e.role)).map((e) => ({ e, storey: s })))
})
export const FLOOR_ROWS_SHOWN = 300

/**
 * 설비 칸의 계통 칩. 지금 층 설비(덕트 · 배관 포함)가 하나라도 든 계통만, 그 층 기기 수가 많은 차례로. 모든 층이면 파일 전체다.
 * 범례(legend)를 그대로 쓰면 층을 바꿔도 파일 전체 계통이 남았다(성수 B5F 에서도 1039).
 */
export const floorSystems = computed(() => {
  const m = model.value
  if (!m) return []
  const st = shellStorey.value
  const here = st ? new Set(st.equipment.map((e) => e.id)) : null
  const byId = new Map(legend.value.map((l) => [l.id, l]))
  return m.systems
    .map((s) => {
      const l = byId.get(s.id)
      if (!l) return null
      const members = here ? s.memberIds.filter((id) => here.has(id)) : s.memberIds
      if (!members.length) return null
      const devices = members.filter((id) => !conduitId(id)).length
      return { ...l, devices }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.devices - a.devices || b.count - a.count)
})

/** 화면이 붙을 때 한 번 — App.vue 가 setupEditor 로 부른다. */
export function setupShell() {
  // 드로어에서 무언가를 고르면(설비 · 물리존 · 계통 · 검사 줄 · 외곽선 그리기 · 층) 드로어를 닫는다. 결과는 3D 에 뜨는데 드로어가 캔버스를
  // 덮고 있어서, 누르고도 아무 일이 없는 것처럼 보였다(2026-10-16). 드로어 안에서 누른 직후에 바뀐 것만 본다 — 3D 에서 고른 것은 닫지 않는다.
  let pressedInDrawer = -Infinity
  const onDown = (e: Event) => {
    if ((e.target as Element | null)?.closest?.('.shell-drawer-body')) pressedInDrawer = performance.now()
  }
  document.addEventListener('pointerdown', onDown, true)
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onDown, true))
  watch([selectedId, selectedSpaceId, selectedCustomZoneId, selectedSystemId, () => group.value.length, openCheckKey, () => !!drawing.value, viewStorey], () => {
    if (drawerOpen.value && performance.now() - pressedInDrawer < 1500) drawerOpen.value = false
  })
  // 펼침 칸은 공간 편집의 도구다. 편집을 나가거나 설비 편집으로 바꾸면 닫는다.
  watch([editing, editPart], () => {
    if (!editing.value || editPart.value !== 'space') railPanel.value = null
  })
}
