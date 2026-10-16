// 편집 화면 뼈대(OE-UI-04 · OE-UI-17 · OE-UI-18) — 헤더 · 도구 레일 · 캔버스 · 우측 위아래 두 카드 · 상태줄과
// 기준 · 검증 드로어의 상태. 화면 뼈대는 docs/prd/design-system.md 4장이고, 이 모듈은 그 자리끼리 나누는 값만 둔다.
import { computed, nextTick, ref } from 'vue'
import { isConduit } from '../lib/model'
import { model } from './core'
import { conduitId } from './flow-rules'
import { legend } from './kinds'
import { viewStorey } from './multi-view'

/** 기준 · 검증 드로어(OE-UI-18). 비모달이라 3D · 우측 패널은 그대로 다룬다. 3D 아래에 이어지던 리포트 · 검사 · 표가 이 안에 든다. */
export const drawerOpen = ref(false)

/**
 * 그 자리(`#warnings` · `#changes` 등)로 간다. 드로어 안이면 드로어를 열고, 작업 화면 아래(표 · 편집 칸)면 페이지를 내린다.
 * 자리를 안 주면 드로어만 연다.
 */
export function openDrawer(anchor?: string) {
  const el = anchor ? document.getElementById(anchor) : null
  if (!anchor || el?.closest('.shell-drawer')) drawerOpen.value = true
  if (!el) return
  void nextTick(() => el.scrollIntoView({ block: 'start' }))
}

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

/** 지금 보는 층(한 층일 때만). 모든 층이면 층 현황은 파일 전체를 센다. */
export const shellStorey = computed(() => {
  const m = model.value
  const id = viewStorey.value
  return m && id ? (m.storeys.find((s) => s.id === id) ?? null) : null
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
