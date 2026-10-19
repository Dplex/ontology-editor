import { computed, ref, watch } from 'vue'
import { DEFAULT_GRID, gridLines, type GridSettings, snapToGrid } from '../lib/grid'
import type { Vec2, Vec3 } from '../lib/model'
import { DEFAULT_SNAP, type SnapHit, snapPoint, type SnapRing, type SnapSettings, snapTargets } from '../lib/snap'
import { findSpaceObject } from '../lib/space-object'
import { COMMON_AXIS } from '../lib/vertical-edit'
import { editing, model } from './core'
import { equipmentById } from './flow-rules'
import { viewStorey } from './multi-view'
import { updatePlaceGhost } from './place-ghost'
import { zoneEdited } from './offset'
import { sceneVersion } from './redraw'
import { selectedRoom, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { drawing, selectedSpace } from './space-objects'
import { linkMarks, multiView, rotatePreview, selectedVertical, selectedVerticalId, verticalHighlight } from './vertical'
import { createHoverPreview, createOpeningPreview, draftLandingPreview, onPlaceVerticalHover, placingVertical, verticalPreview } from './vertical-create'

// --- 그리드 (OE-UI-07, lib/grid.ts) ---
// 켜면 편집 모드의 3D(그리는 높이, 아니면 보는 층 바닥)와 평면도에 선을 보이고, 그리기에서 찍은 점을 교점으로 옮긴다. 간격은 이 브라우저 설정.
export const grid = ref<GridSettings>(
  (() => {
    try {
      return { ...DEFAULT_GRID, ...(JSON.parse(localStorage.getItem('oe.grid') ?? 'null') ?? {}) }
    } catch {
      return { ...DEFAULT_GRID }
    }
  })(),
)
/** 그리드를 그릴 층과 범위. 그리는 중이면 그 층·높이, 아니면 보는 층. 범위는 그 층 물리존 외곽선에 2m 를 더한다. */
export const gridView = computed(() => {
  void sceneVersion.value
  const m = model.value
  if (!m || !editing.value || !grid.value.on) return null
  const st = m.storeys.find((x) => x.id === (drawing.value?.storeyId ?? viewStorey.value)) ?? (m.storeys.length === 1 ? m.storeys[0] : null)
  if (!st) return null
  const pts = st.spaces.flatMap((sp) => sp.footprint)
  if (!pts.length) return null
  const extent = {
    minX: Math.min(...pts.map((p) => p[0])) - 2,
    minY: Math.min(...pts.map((p) => p[1])) - 2,
    maxX: Math.max(...pts.map((p) => p[0])) + 2,
    maxY: Math.max(...pts.map((p) => p[1])) + 2,
  }
  return { storeyId: st.id, elevation: drawing.value?.elevation ?? st.elevation, extent, ...gridLines(extent, grid.value.spacing) }
})

// --- 스냅 (OE-UI-06, lib/snap.ts) ---
// 켜면 그리기에서 찍는 점과 끄는 꼭짓점이 반경 안의 물리존·벽·룸·커스텀존 꼭짓점·변에 붙는다. 그리드와 같이 켜져 있으면 오브젝트가
// 앞선다. 반경은 이 브라우저 설정이다(그리드 간격과 같다).
export const snap = ref<SnapSettings>(
  (() => {
    try {
      return { ...DEFAULT_SNAP, ...(JSON.parse(localStorage.getItem('oe.snap') ?? 'null') ?? {}) }
    } catch {
      return { ...DEFAULT_SNAP }
    }
  })(),
)
// 대상 고리는 끄는 동안 마우스가 움직일 때마다 찾으므로, 층·뺄 것이 같고 그 사이 편집이 없으면 지난 것을 그대로 쓴다.
// 편집은 모델을 그 자리에서 고치고 triggerRef 로 알리므로 그때 버린다.
let snapCache: { key: string; rings: SnapRing[] } | null = null
function snapRingsOf(storeyId: string, skip?: string): SnapRing[] {
  const m = model.value
  if (!m) return []
  const key = `${storeyId}:${skip ?? ''}`
  if (snapCache?.key !== key) snapCache = { key, rings: snapTargets(m, storeyId, new Set(skip ? [skip] : [])) }
  return snapCache.rings
}
/** 점 하나를 스냅·그리드로 보정한다(OE-UI-06·07). `skip` 은 고치는 중인 오브젝트(제 변에 붙지 않게). 붙을 데가 없으면 null. */
export function alignAt(at: Vec2, storeyId: string | null, skip?: string): SnapHit | null {
  if (!storeyId || (!snap.value.on && !grid.value.on)) return null
  return snapPoint(at, snap.value.on ? snapRingsOf(storeyId, skip) : [], snap.value, grid.value)
}
/** 그리는 층. 그리는 중이면 그 층, 아니면 보는 층(층이 하나면 그 층). */
const alignStorey = computed(() => drawing.value?.storeyId ?? viewStorey.value ?? (model.value?.storeys.length === 1 ? model.value.storeys[0].id : null))
// 그리는 동안 마우스가 가리키는 자리가 어디에 붙을지 3D 에 미리 보인다(OE-UI-06 "달라붙었음을 인지할 수 있는 시각적 피드백").
export function onPlaceHover(at: Vec2 | null, alt = false) {
  const d = drawing.value
  if (!viewer) return
  if (placingVertical.value) onPlaceVerticalHover(at, alt)
  // 설비·오브젝트를 놓는 중이면 커서를 따라 놓을 모양을 세운다(place-ghost.ts).
  updatePlaceGhost(at)
  const hit = d && at && !multiView.value ? alignAt(at, d.storeyId) : null
  const st = d && model.value?.storeys.find((x) => x.id === d.storeyId)
  viewer.setSnapMarker(hit && st ? { at: hit.at, kind: hit.kind, edge: hit.kind === 'edge' ? hit.edge : undefined, elevation: d.elevation ?? st.elevation } : null)
}
/**
 * 끄는 동안의 보정(OE-UI-07 AC3 "다시 이동시킬 때부터 가장 가까운 그리드 교점으로"). 켜기만 해서는 아무것도 옮기지 않는다 —
 * 그리드에 어긋난 채 놓인 것은 그대로 두고, 끌기 시작한 것만 교점(설비·오브젝트는 그 배치점)에 맞춘다. 꼭짓점은 스냅도 받는다.
 * 다중층 뷰는 층이 여럿이라 보정하지 않는다.
 */
export const dragAlign = {
  delta(kind: 'equipment' | 'object', id: string, delta: Vec2): Vec2 {
    const m = model.value
    if (!m || !grid.value.on || multiView.value) return delta
    const origin = kind === 'equipment' ? equipmentById.value.get(id)?.position : findSpaceObject(m, id)?.object.at
    if (!origin) return delta
    const to = snapToGrid([origin[0] + delta[0], origin[1] + delta[1]], grid.value.spacing)
    return [to[0] - origin[0], to[1] - origin[1]]
  },
  point(spaceId: string, _index: number, at: Vec2): Vec2 {
    if (multiView.value) return at
    return alignAt(at, alignStorey.value, spaceId)?.at ?? at
  },
}
/** 그리는 중인 층간 배관의 경로(시작 설비 → 찍은 꺾임점). 점선 미리보기다. */
export const riserPreview = computed(() => {
  const d = drawing.value
  const from = d?.levels && d.spaceId ? equipmentById.value.get(d.spaceId) : null
  if (!d?.levels || !from?.position) return []
  const z = (l: { storeyId: string; height: number }) => (model.value?.storeys.find((st) => st.id === l.storeyId)?.elevation ?? Number.NaN) + l.height
  const path: Vec3[] = [...(d.branchOf ? [] : [from.position]), ...d.points.map((p, i): Vec3 => [p[0], p[1], z(d.levels![i])])]
  return path.length > 1 && path.every((p) => Number.isFinite(p[2])) ? [{ storeyId: d.storeyId, elevation: from.position[2], path }] : []
})
/** 꼭짓점을 고치는 공조존 id 와 [ ] 로 짚은 꼭짓점. 아래 "수동 공조존" 의 startZoneVertices 참조. */
export const zoneVertexEdit = ref<string | null>(null)
export const zoneActiveVertex = ref<number | null>(null)
/** 키보드([ ])로 짚은 꼭짓점. 물리존을 바꾸면 풀린다. */
export const activeVertex = ref<number | null>(null)
/** 손잡이를 다는 꼭짓점 수(닫는 점 빼고). */
export const vertexCount = computed(() => {
  const ring = selectedSpace.value?.space.footprint ?? []
  const last = ring.at(-1)
  return ring.length > 1 && last && ring[0][0] === last[0] && ring[0][1] === last[1] ? ring.length - 1 : ring.length
})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupGridSnap() {
  watch(
    grid,
    (v) => {
      try {
        localStorage.setItem('oe.grid', JSON.stringify(v))
      } catch {
        // 못 남겨도 이번 창에서는 그대로다
      }
    },
    { deep: true },
  )
  watch(gridView, (g) => viewer?.setGrid(g && !multiView.value ? { x: g.x, y: g.y, elevation: g.elevation, extent: g.extent } : null))
  watch(
    snap,
    (v) => {
      try {
        localStorage.setItem('oe.snap', JSON.stringify(v))
      } catch {
        // 못 남겨도 이번 창에서는 그대로다
      }
    },
    { deep: true },
  )
  watch(model, () => (snapCache = null), { flush: 'sync' })
  watch(drawing, (d) => {
    if (!d) viewer?.setSnapMarker(null)
  })
  watch([model, sceneVersion, verticalHighlight, verticalPreview, riserPreview, rotatePreview, createHoverPreview, linkMarks, draftLandingPreview, createOpeningPreview], () =>
    viewer?.setVerticalParts(model.value, verticalHighlight.value, [...verticalPreview.value, ...riserPreview.value, ...rotatePreview.value, ...createHoverPreview.value, ...linkMarks.value, ...draftLandingPreview.value, ...createOpeningPreview.value]),
  )
  watch([selectedSpace, selectedRoom, editing, sceneVersion, drawing, selectedVertical, multiView, zoneVertexEdit], () => {
    const picked = selectedSpace.value
    if (!viewer) return
    // 다중층 뷰(OE-ML-07): 고른 계단 조각의 그 층 형상에만 손잡이를 단다. 물리존·룸은 층 편집에서 고친다.
    if (multiView.value && !drawing.value) {
      const v = selectedVertical.value
      const ring = v?.part.footprint ?? []
      viewer.setSpaceHandles(editing.value && v && ring.length >= 3 && !COMMON_AXIS.has(v.part.kind) ? { id: selectedVerticalId.value!, ring, elevation: v.storey.elevation + 0.1, active: null } : null)
      return
    }
    if (drawing.value) {
      const d = drawing.value
      // 층간 배관은 꺾임점마다 높이가 달라 바닥 손잡이 대신 3D 점선 미리보기(riserPreview)로 보인다.
      if (d.levels) return viewer.setSpaceHandles(null)
      viewer.setSpaceHandles({ id: d.spaceId ?? 'new', ring: d.points, elevation: d.elevation, active: d.points.length ? d.points.length - 1 : null })
      return
    }
    const zone = zoneEdited.value
    if (zone) {
      viewer.setSpaceHandles({ id: zone.zone.id, ring: zone.corners, elevation: zone.storey.elevation, active: zoneActiveVertex.value })
      return
    }
    // 고른 룸의 꼭짓점 넷(OE-SPC-11). 편집 모드에서만 끈다.
    const room = selectedRoom.value
    if (room) {
      viewer.setSpaceHandles(editing.value ? { id: room.room.id, ring: room.room.footprint.slice(0, 4), elevation: room.storey.elevation, active: null } : null)
      return
    }
    if (!picked) {
      viewer.setSpaceHandles(null)
      return
    }
    // 닫는 점(첫 점과 같은 끝 점)은 손잡이를 따로 두지 않는다. 첫 점을 옮기면 edit.ts 가 끝 점을 같이 옮긴다.
    const ring = picked.space.footprint
    const last = ring.at(-1)
    const closed = ring.length > 1 && !!last && ring[0][0] === last[0] && ring[0][1] === last[1]
    viewer.setSpaceHandles({
      id: picked.space.id,
      ring: closed ? ring.slice(0, -1) : ring,
      elevation: picked.storey.elevation,
      active: activeVertex.value,
    })
  })
  watch([selectedSpaceId, editing], () => (activeVertex.value = null))
  watch(activeVertex, () => sceneVersion.value++)
}
