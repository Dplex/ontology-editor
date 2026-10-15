import { computed, ref, triggerRef, watch } from 'vue'
import { newWallThickness, OPENING_SNAP, OPENING_SNAP_RANGE, SITE_INTERIOR_WALL } from '../lib/edit'
import { assignEquipmentToSpaces, assignSnapNow, setAssignSnap, SNAP } from '../lib/mapping'
import { model } from './core'
import { cm } from './equipment-shape'
import { note } from './keyboard'
import { sceneVersion } from './redraw'
import { targetStorey } from './space-edit'

// 문·창 형상도 읽을까. 온톨로지에는 필요 없고 로봇 경로(문 자리·문이 잇는 방)용이라 기본은 끈다.
// 파일을 열 때 정하므로, 바꾸면 다음에 여는 파일부터 적용된다. 이 브라우저에만 기억한다.
export const readOpenings = ref(
  (() => {
    try {
      return localStorage.getItem('oe-read-openings') === '1'
    } catch {
      return false
    }
  })(),
)

// 벽·문·창을 읽을까(피처 단위). 셋 다 GeoJSON 에만 나가고 온톨로지(TTL)에는 필요 없어서, 큰 파일을 빨리 열거나
// 설비만 볼 때 끈다. 기본은 예전처럼 다 읽는다. 끈 것은 모델에 "읽지 않음" 으로 적혀 요구사항 보고서가 "없음" 과 가른다.
type ReadFeatures = { walls: boolean; doors: boolean; windows: boolean }
export const readFeatures = ref<ReadFeatures>(
  (() => {
    const all = { walls: true, doors: true, windows: true }
    try {
      const saved = JSON.parse(localStorage.getItem('oe-read-features') ?? 'null') as Partial<ReadFeatures> | null
      return saved ? { ...all, ...saved } : all
    } catch {
      return all
    }
  })(),
)
// 소속 허용 거리(OE-MAP-01 5단계). 사이트 설정 — 외곽선에서 이만큼 안의 설비를 가장 가까운 물리존에 붙인다. 바꾸면 모든 설비를 다시
// 판정한다(BIM 이 적은 소속·사람이 정한 소속은 그대로). 임포트는 워커에서 기본값으로 판정하므로 연 직후에 이 값으로 다시 잰다.
try {
  const saved = Number(localStorage.getItem('oe.assignSnap'))
  if (localStorage.getItem('oe.assignSnap') !== null) setAssignSnap(saved)
} catch {
  // 못 읽으면 기본값이다
}
export const assignSnap = ref(assignSnapNow())
export function changeAssignSnap(raw: string) {
  setAssignSnap(raw.trim() === '' ? SNAP : Number(raw))
  assignSnap.value = assignSnapNow()
  try {
    localStorage.setItem('oe.assignSnap', String(assignSnap.value))
  } catch {
    // 못 남겨도 이번 창에서는 그대로다
  }
  const m = model.value
  if (!m) return
  const before = new Map(m.storeys.flatMap((st) => st.equipment.map((e) => [e.id, e.spaceId])))
  assignEquipmentToSpaces(m)
  const moved = m.storeys.flatMap((st) => st.equipment).filter((e) => before.get(e.id) !== e.spaceId).length
  triggerRef(model)
  sceneVersion.value++
  note(`소속 허용 거리를 ${assignSnap.value}m 로 정했습니다. 설비 ${moved}대의 소속이 바뀌었습니다(BIM·사람이 정한 소속은 그대로)`)
}
// 벽·문·창 설정(OE-SPC-12 · OE-SPC-13). 사이트(이 브라우저) 하나에 하나다. 새 벽 두께는 같은 층 BIM 내벽 최빈값이 먼저이고 이 값은
// 그 다음이다(edit.ts 의 newWallThickness). 스냅 거리는 문·창을 놓거나 옮길 때 벽에서 이만큼 안이어야 붙는 거리다.
// 내벽 기본 두께는 처음부터 0.15m 다(SITE_INTERIOR_WALL). 사람이 비우면 null 이고, 그때는 0.2m 로 긋는다.
type ElementSettings = { interiorWall: number | null; openingSnap: number }
export const elementSettings = ref<ElementSettings>(
  (() => {
    const base: ElementSettings = { interiorWall: SITE_INTERIOR_WALL, openingSnap: OPENING_SNAP }
    try {
      const saved = JSON.parse(localStorage.getItem('oe-element-settings') ?? 'null') as (Partial<ElementSettings> & { wallThickness?: number | null }) | null
      if (!saved) return base
      // 예전 칸(`wallThickness`)은 처음 값이 없어서 null 이 "비움" 이 아니라 "안 정함" 이었다. 숫자만 옮기고 null 은 처음 값으로 읽는다.
      const interiorWall = saved.interiorWall !== undefined ? saved.interiorWall : typeof saved.wallThickness === 'number' ? saved.wallThickness : SITE_INTERIOR_WALL
      return { openingSnap: saved.openingSnap ?? OPENING_SNAP, interiorWall }
    } catch {
      return base
    }
  })(),
)
export function setSiteWallThickness(raw: string) {
  const v = Number(raw)
  elementSettings.value = { ...elementSettings.value, interiorWall: raw.trim() && v > 0 && v <= 2 ? cm(v) : null }
}
export function setOpeningSnap(raw: string) {
  const v = Number(raw)
  if (!Number.isFinite(v)) return
  elementSettings.value = { ...elementSettings.value, openingSnap: cm(Math.min(OPENING_SNAP_RANGE.max, Math.max(OPENING_SNAP_RANGE.min, v))) }
}
/** 지금 층에 새 벽을 그으면 어떤 두께가 되나(설정 칸 옆 안내). */
export const wallThicknessHere = computed(() => {
  const storey = targetStorey()
  return storey ? { storey: storey.name, ...newWallThickness(storey, elementSettings.value.interiorWall) } : null
})
export const WALL_FROM = { bim: '같은 층 BIM 내벽 두께의 최빈값', site: '사이트 기본값', default: '기본값' } as const
export const readOpeningShapes = computed(() => readOpenings.value && (readFeatures.value.doors || readFeatures.value.windows))

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupReadSettings() {
  watch(readOpenings, (on) => {
    try {
      localStorage.setItem('oe-read-openings', on ? '1' : '0')
    } catch {
      // 못 써도 이번 창에서는 그대로 돈다.
    }
  })
  watch(
    readFeatures,
    (v) => {
      try {
        localStorage.setItem('oe-read-features', JSON.stringify(v))
      } catch {
        // 못 써도 이번 창에서는 그대로 돈다.
      }
    },
    { deep: true },
  )
  watch(
    elementSettings,
    (v) => {
      try {
        localStorage.setItem('oe-element-settings', JSON.stringify(v))
      } catch {
        // 못 써도 이번 창에서는 그대로 돈다.
      }
    },
    { deep: true },
  )
}
