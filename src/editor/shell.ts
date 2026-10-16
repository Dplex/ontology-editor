// 편집 화면 뼈대(OE-UI-04 · OE-UI-17 · OE-UI-18) — 헤더 · 도구 레일 · 캔버스 · 우측 위아래 두 카드 · 상태줄과
// 기준 · 검증 드로어의 상태. 화면 뼈대는 docs/prd/design-system.md 4장이고, 이 모듈은 그 자리끼리 나누는 값만 둔다.
import { computed, nextTick, ref } from 'vue'
import { isConduit } from '../lib/model'
import { model } from './core'
import { viewStorey } from './multi-view'

/** 기준 · 검증 드로어(OE-UI-18). 비모달이라 3D · 우측 패널은 그대로 다룬다. 3D 아래에 이어지던 리포트 · 검사 · 표가 이 안에 든다. */
export const drawerOpen = ref(false)

/** 드로어를 열고 그 안의 자리(`#warnings` · `#changes` 등)로 간다. 이미 열려 있으면 자리만 옮긴다. */
export function openDrawer(anchor?: string) {
  drawerOpen.value = true
  if (!anchor) return
  void nextTick(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }))
}

/** 층 현황(우측 아래)의 종류 칸. 다섯 칸이 design-system.md 4장 그대로다. */
export type FloorKind = 'space' | 'custom' | 'hvac' | 'equipment' | 'objects'
export const floorKind = ref<FloorKind>('space')
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
