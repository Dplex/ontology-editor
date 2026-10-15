import { computed, onBeforeUnmount, ref, shallowRef, toRaw, watch } from 'vue'
import { dimensionText, wallDimensions } from '../lib/dimensions'
import { WALL_LOCKED, wallLocked, wallShapeLock } from '../lib/edit'
import type { CompareReading } from '../lib/export/compare'
import type { CompareReply, CompareRequest } from '../lib/export/compare.worker'
import { judgeExternal } from '../lib/exterior'
import type { Vec2, Wall } from '../lib/model'
import { replayOpen } from '../lib/replay-player'
import { baseline } from './changes'
import { activeTab } from './context-menu'
import { editing, model } from './core'
import { archMode, selectedElementId } from './equipment-edit'
import { equipmentById, selectedId } from './flow-rules'
import { selectedZoneId, showWalls, showZones } from './idf-zones'
import { selectedSystemId } from './kinds'
import { group, setGroup } from './multi-select'
import { redraw, sceneVersion } from './redraw'
import { pickSpace, selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedCustomZoneId } from './space-edit'
import { selectedObjectId } from './space-objects'
import { select } from './systems'
import { selectedVerticalId } from './vertical'

// --- 내보낸 결과와 나란히 보기(ADR-0061) ---
// [결과 비교] 를 켜면 3D 오른쪽에 지금 모델을 내보낸 TTL·층 GeoJSON 을 받는 쪽처럼 다시 읽은 판(ExportCompare.vue)이 뜬다. 고르기는 id 하나로
// 양쪽이 같고, 판의 평면은 3D 시점을 따라간다. 쓰고 읽기는 워커에서 하고(성수), 편집이 멈추고 잠시 뒤에 한 번 다시 한다.
export const compareOpen = ref(false)
export const compareReading = shallowRef<CompareReading | null>(null)
export const comparePending = ref(false)
export const compareError = ref('')
export const compareView = shallowRef<{ target: Vec2; halfWidth: number } | null>(null)
let compareWorker: Worker | null = null
let compareSeq = 0
let compareTimer: number | undefined
function requestCompare() {
  const m = model.value
  if (!m || !compareOpen.value) return
  comparePending.value = true
  compareWorker ??= new Worker(new URL('../lib/export/compare.worker.ts', import.meta.url), { type: 'module' })
  compareWorker.onmessage = (e: MessageEvent<CompareReply>) => {
    if (e.data.seq !== compareSeq) return
    comparePending.value = false
    if ('error' in e.data) compareError.value = `내보내지 못했습니다: ${e.data.error}`
    else {
      compareError.value = ''
      compareReading.value = e.data.reading
    }
  }
  try {
    compareWorker.postMessage({ seq: ++compareSeq, model: toRaw(m) } satisfies CompareRequest)
  } catch (err) {
    comparePending.value = false
    compareError.value = err instanceof Error ? err.message : String(err)
  }
}
// 리플레이(극장)·평면도에서는 판을 접는다. 켜 둔 것은 그대로라 3D 로 돌아오면 다시 뜬다.
export const compareShown = computed(() => compareOpen.value && activeTab.value === '3d' && !replayOpen.value && !!model.value)
/** 판이 칠할 id. 3D 에서 고른 것 하나(설비·물리존·룸·벽·문·창·존·오브젝트·수직 관통 조각). */
export const compareSelected = computed(
  () => selectedId.value ?? selectedVerticalId.value ?? selectedRoomId.value ?? selectedSpaceId.value ?? selectedElementId.value ?? selectedCustomZoneId.value ?? selectedObjectId.value ?? null,
)
/** 판에서 고른 것을 3D 에서도 고른다. 종류를 모르면(관계 목록의 이름) 모델에서 찾는다. */
export function selectFromCompare(id: string, kind: string) {
  const m = model.value
  if (!m) return
  const k = kind || (equipmentById.value.has(id) ? 'equipment' : '')
  if (k === 'equipment') return select(id)
  if (k === 'wall' || k === 'door' || k === 'window' || (!k && m.storeys.some((s) => s.walls.some((w) => w.id === id) || s.openings.some((o) => o.id === id)))) {
    archMode.value = true
    selectedId.value = null
    selectedSpaceId.value = null
    selectedElementId.value = id
    return
  }
  if (k === 'customZone') {
    selectedCustomZoneId.value = id
    return
  }
  if (k === 'spaceObject') {
    selectedObjectId.value = id
    return
  }
  // 물리존·룸·수직 관통 조각은 바닥 누르기와 같은 길이다(pickSpace 가 가른다). 3D 가 그 방을 비춘다.
  pickSpace(id)
  viewer?.frameSpace(id)
}
export let archEdited = false
export function setArchEdited(v: typeof archEdited) {
  archEdited = v
}
export const selectedElement = computed(() => {
  const m = model.value
  const id = selectedElementId.value
  if (!m || !id) return null
  for (const storey of m.storeys) {
    // 내력벽과 거기 뚫린 문·창은 잠긴다(OE-OBJ-06). 고르고 볼 수는 있고, 옮기기·지우기만 막는다.
    const wall = storey.walls.find((w) => w.id === id)
    // 잠긴 이유. 벽은 내력벽(OE-OBJ-05)·외벽(OE-EXT-02), 문·창은 내력벽에 뚫린 것만 — 외벽의 문·창은 고친다(OE-OBJ-04).
    if (wall) return { kind: 'wall' as const, storey, wall, opening: null, locked: wallShapeLock(wall) }
    const opening = storey.openings.find((o) => o.id === id)
    if (opening) return { kind: opening.kind, storey, wall: null, opening, locked: wallLocked(storey.walls.find((w) => w.id === opening.wallId)) ? WALL_LOCKED : null }
  }
  return null
})
// 치수 표시(OE-UI-08). 고른 벽의 길이·두께·높이와 가장 가까운 벽까지 거리. 모델에서 그때 재므로 옮기거나 길이를 바꾸면 함께 바뀐다.
export const wallDims = computed(() => {
  void sceneVersion.value
  const picked = selectedElement.value
  if (!picked?.wall) return null
  const d = wallDimensions(picked.storey, picked.wall)
  return d ? { ...d, text: dimensionText(d), storeyId: picked.storey.id } : null
})
/**
 * 고른 벽·문·창이 있는 층의 외벽 판정(OE-EXT-01). BIM 이 말한 것은 그대로, 안 말한 벽은 건물 바깥에 닿는지로 계산한다.
 * 벽을 옮기면 다시 센다(sceneVersion) — 모델에 저장하지 않는 값이다.
 */
const selectedExternal = computed(() => {
  void sceneVersion.value
  const storey = selectedElement.value?.storey
  return storey ? judgeExternal(storey) : null
})
/** 내력 여부의 출처(OE-OBJ-06). 더한 벽이거나 연 때와 값이 다르면 사람이 정한 것이다. */
export const bearingSrc = (wall: Wall): 'edit' | 'bim' => {
  const was = baseline.value?.walls?.get(wall.id)
  return wall.added || (was !== undefined && was.loadBearing !== wall.loadBearing) ? 'edit' : 'bim'
}
export const externalOf = (wallId: string | null | undefined) => (wallId ? selectedExternal.value?.get(wallId) ?? null : null)

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupExportCompare() {
  watch(model, () => {
    if (!compareOpen.value) return
    // 끌기·방향키는 편집이 이어진다. 멈춘 뒤 한 번만 다시 쓴다.
    comparePending.value = true
    window.clearTimeout(compareTimer)
    compareTimer = window.setTimeout(requestCompare, 500)
  })
  watch(baseline, () => (compareReading.value = null))
  watch(compareOpen, (open) => {
    if (open) {
      requestCompare()
      viewer?.onView((v) => (compareView.value = v))
    } else {
      viewer?.onView(null)
      compareView.value = null
      compareWorker?.terminate()
      compareWorker = null
      window.clearTimeout(compareTimer)
      comparePending.value = false
    }
  })
  onBeforeUnmount(() => compareWorker?.terminate())
  // 여러 개 고르기(OE-UI-09): 다른 것을 고르거나 편집을 끝내면 묶음을 푼다. 지운 설비는 묶음에서 빠진다. 고른 것들이 다 선언된 뒤라 여기 둔다.
  // 다른 것을 고르면 룸은 풀린다(패널은 하나만).
  watch([selectedId, selectedSpaceId, selectedElementId, selectedCustomZoneId, selectedSystemId], (now) => {
    if (now.some((x) => x)) selectedRoomId.value = null
    if (now.some((x) => x)) selectedObjectId.value = null
  })
  watch([selectedId, selectedSpaceId, selectedSystemId, selectedElementId, selectedCustomZoneId], (now) => {
    if (now.some(Boolean) && group.value.length) group.value = []
  })
  watch(editing, (on) => {
    if (!on) group.value = []
  })
  watch(model, () => {
    if (group.value.length && group.value.some((id) => !equipmentById.value.has(id))) setGroup(group.value.filter((id) => equipmentById.value.has(id)))
  })
  // 커스텀존을 고르면 다른 고른 것을 풀고, 다른 것을 고르면 커스텀존을 푼다(패널은 하나만 뜬다).
  watch([selectedId, selectedSpaceId, selectedElementId], ([a, b, c]) => {
    if (a || b || c) selectedCustomZoneId.value = null
  })
  watch(selectedCustomZoneId, (id) => {
    if (!id) return
    selectedId.value = null
    selectedSpaceId.value = null
    selectedElementId.value = null
  })
  watch([showZones, model, sceneVersion, selectedZoneId], () => viewer?.setHvacZones(showZones.value ? model.value : null, selectedZoneId.value))
  // 다른 것을 고르면 공조존 고르기를 푼다.
  watch([selectedId, selectedSpaceId, selectedSystemId], (now) => {
    if (now.some(Boolean)) selectedZoneId.value = null
  })
  watch(archMode, (on) => {
    if (on) {
      viewer?.setWallsVisible(false)
      return
    }
    selectedElementId.value = null
    viewer?.setWallsVisible(showWalls.value)
    if (archEdited) {
      archEdited = false
      redraw()
    }
  })
  watch([selectedId, selectedSpaceId], ([a, b]) => {
    if (a || b) selectedElementId.value = null
  })
  watch(selectedElementId, (id) => {
    if (!id) return
    selectedId.value = null
    selectedSpaceId.value = null
  })
}
