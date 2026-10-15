import { computed, ref, triggerRef } from 'vue'
import { branchPipe } from '../lib/branch-pipe'
import { snapshotRelease } from '../lib/connection-release'
import { type Snapshot, snapshotEquipment } from '../lib/edit'
import { type Equipment, isConduit, segmentPath, type Vec2 } from '../lib/model'
import { insertPipeVertex, removePipeVertex } from '../lib/pipe-vertex'
import { type PathPoint, storeyAtZ, storeyElevationProblem } from '../lib/storey-z'
import { connectFrom } from './connections'
import { editing, model } from './core'
import { stopAdd } from './equipment-edit'
import { cm, placeStretched, segmentAxis, shortName } from './equipment-shape'
import { equipmentById, flowVersion, ruleReport, selected } from './flow-rules'
import { riserPreview } from './grid-snap'
import { mark, remember } from './history'
import { note } from './keyboard'
import { ensureDrawnMeshes, pipeDraft } from './manual-draw'
import { storeyOf } from './multi-select'
import { multiRange } from './multi-view'
import { stopPlace } from './place'
import { redraw, sceneVersion } from './redraw'
import { viewer } from './scene'
import { drawing } from './space-objects'
import { select } from './systems'
import { multiView } from './vertical'

// --- 층간 배관 (다중층 뷰, OE-ML-12·14·18 · OE-PIP-15) ---
// 같은 배관 그리기다. 다른 점은 끝 대상을 보기 범위의 다른 층에서 고르고, 꺾임점마다 작업 높이(층 + 그 층 바닥에서 m)를 정하는 것이다.
// 층을 지나는 구간은 수직으로만 찍는다([수직으로 찍기]). 보기 범위만 바꿔서는 그린 것이 바뀌지 않는다.

/** 층간 배관의 끝 층. 비었으면 보기 범위에서 시작 설비의 층이 아닌 첫 층이다. */
export const riserStorey = ref('')
export const riserEndStorey = computed(() => {
  const range = multiRange.value ?? []
  const home = selected.value ? storeyOf(selected.value.id) : null
  return range.find((st) => st.id === riserStorey.value) ?? range.find((st) => st.id !== home?.id) ?? null
})
/**
 * 층간 배관의 끝 후보: 끝 층의 좌표 있는 설비, 그다음 이음쇠, 각각 수평 거리가 가까운 순으로 60개. 라이저는 위아래로 가니 높이 차는
 * 재지 않는다. 끝은 보통 설비라 앞에 둔다(Duplex 1층은 이음쇠까지 섞으면 6m 떨어진 라디에이터가 40개 밖이었다). 구간의 중간에 잇는 것은
 * 분기(OE-ML-13)라 구간은 뺀다.
 */
export const riserTargets = computed(() => {
  void sceneVersion.value
  const e = selected.value
  const st = riserEndStorey.value
  if (!e?.position || !st) return []
  const p = e.position
  return st.equipment
    .filter((x) => x.id !== e.id && !!x.position && x.role !== 'segment')
    .map((x) => ({ id: x.id, name: shortName(x.name), d: Math.hypot(x.position![0] - p[0], x.position![1] - p[1]), fitting: isConduit(x.role) }))
    .sort((a, b) => Number(a.fitting) - Number(b.fitting) || a.d - b.d)
    .slice(0, 60)
})
export function startRiser() {
  const from = selected.value
  const home = from ? storeyOf(from.id) : null
  const m = model.value
  if (!m || !from?.position || !home || !multiView.value) return
  if (!pipeDraft.value.to) return note('끝 대상을 먼저 고르세요')
  const problem = storeyElevationProblem(m, home)
  if (problem) return note(problem)
  stopPlace()
  stopAdd()
  connectFrom.value = null
  const work = { storeyId: home.id, height: cm(from.position[2] - home.elevation) }
  drawing.value = { purpose: 'pipe', spaceId: from.id, storeyId: home.id, name: `${shortName(from.name)} 층간 배관`, elevation: from.position[2], points: [], levels: [], work }
  viewer?.setPlaceMode(from.position[2])
  note('작업 높이(층 + 바닥에서 m)를 정하고 바닥을 눌러 꺾임점을 찍습니다. [수직으로 찍기] 는 마지막 점의 바로 위·아래에 찍습니다. Enter 로 마치면 끝 대상까지 잇습니다 (Esc 취소)')
}
/** 작업 높이를 바꾼다. 다음에 찍는 점이 이 높이다. */
export function setRiserWork(storeyId: string, height: number) {
  const d = drawing.value
  const st = model.value?.storeys.find((x) => x.id === storeyId)
  if (!d?.work || !st) return
  const problem = storeyElevationProblem(model.value!, st)
  if (problem) return note(problem)
  if (!Number.isFinite(height)) return note('높이는 숫자로 넣으세요')
  drawing.value = { ...d, work: { storeyId, height }, elevation: st.elevation + height }
  viewer?.setPlaceMode(st.elevation + height)
}
export const riserWorkZ = computed(() => {
  const w = drawing.value?.work
  const st = w ? model.value?.storeys.find((x) => x.id === w.storeyId) : null
  return w && st ? st.elevation + w.height : null
})
/** 마지막 점(없으면 시작 설비)의 바로 위·아래, 작업 높이에 점을 찍는다 — 라이저의 수직 구간이다. */
export function addPlumbPoint() {
  const d = drawing.value
  const from = d?.spaceId ? equipmentById.value.get(d.spaceId) : null
  if (!d?.levels || !d.work || !from?.position || riserWorkZ.value === null) return
  if (d.branchOf && !d.points.length) return note('분기 자리를 먼저 찍습니다')
  const last = d.points.at(-1) ?? ([from.position[0], from.position[1]] as Vec2)
  const lastZ = d.points.length ? riserPreview.value[0]?.path.at(-1)?.[2] : from.position[2]
  if (lastZ !== undefined && Math.abs(lastZ - riserWorkZ.value) < 0.01) return note('작업 높이가 마지막 점과 같습니다. 층이나 높이를 바꾼 뒤 누릅니다')
  drawing.value = { ...d, points: [...d.points, [cm(last[0]), cm(last[1])]], levels: [...d.levels, { ...d.work }] }
}

// --- 층별 분기 (다중층 뷰, OE-ML-13, branch-pipe.ts) ---
// 고른 구간 위의 한 자리에 분기점을 넣어 구간을 나누고, 그 분기점에서 층간 배관과 같은 그리기로 잇는다. 첫 점이 분기 자리다.

export function startBranch() {
  const seg = selected.value
  const home = seg ? storeyOf(seg.id) : null
  const m = model.value
  if (!m || !seg || seg.role !== 'segment' || !home || !multiView.value) return
  if (!pipeDraft.value.to) return note('끝 대상을 먼저 고르세요')
  const path = segmentPath(seg)
  if (!path || !('path' in path)) return note('형상(중심선)이 없는 구간에는 분기를 내지 않습니다')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  // 작업 높이는 구간 가운데 높이에서 시작한다(수평 구간은 그대로 구간 위를 누르면 된다).
  const z = (path.path[0][2] + path.path[1][2]) / 2
  const st = storeyAtZ(m, z) ?? home
  const work = { storeyId: st.id, height: cm(z - st.elevation) }
  drawing.value = { purpose: 'pipe', spaceId: seg.id, storeyId: home.id, name: `${shortName(seg.name)} 분기`, elevation: st.elevation + work.height, points: [], levels: [], work, branchOf: seg.id }
  viewer?.setPlaceMode(st.elevation + work.height)
  note('첫 점은 분기 자리입니다. 구간 위를 누르거나, 작업 높이를 정하고 [이 높이에서 분기] 를 누릅니다. 그다음 꺾임점을 찍고 Enter 로 끝 대상까지 잇습니다 (Esc 취소)')
}
/** 작업 높이가 구간을 지나는 자리에 분기 자리를 찍는다(라이저처럼 높이가 변하는 구간). */
export function branchAtWork() {
  const d = drawing.value
  const seg = d?.branchOf ? equipmentById.value.get(d.branchOf) : null
  const path = seg ? segmentPath(seg) : null
  const z = riserWorkZ.value
  if (!d?.levels || !d.work || !path || !('path' in path) || z === null || d.points.length) return
  const [p, q] = path.path
  if (Math.abs(q[2] - p[2]) < 0.01 || z < Math.min(p[2], q[2]) || z > Math.max(p[2], q[2]))
    return note(`이 구간은 그 높이(${z.toFixed(2)}m)를 지나지 않습니다. 높이를 ${Math.min(p[2], q[2]).toFixed(2)} ~ ${Math.max(p[2], q[2]).toFixed(2)}m 로 두거나, 수평 구간이면 구간 위를 누릅니다`)
  const t = (z - p[2]) / (q[2] - p[2])
  drawing.value = { ...d, points: [[cm(p[0] + (q[0] - p[0]) * t), cm(p[1] + (q[1] - p[1]) * t)]], levels: [{ ...d.work }] }
}
/** 분기를 그린다. 그렸으면 true. 되돌리기 한 번에 분기점·나눈 구간·분기가 같이 빠지고 나눈 구간·옛 연결이 돌아온다. */
export function makeBranch(segId: string, points: PathPoint[], range: string[]): boolean {
  const m = model.value
  const d = pipeDraft.value
  const seg = equipmentById.value.get(segId)
  if (!m || !seg) return false
  if (!points.length) {
    note('분기 자리를 먼저 찍습니다')
    return false
  }
  const before: Snapshot[] = [snapshotEquipment(m, segId)!, ...m.connections.filter((c) => c.from === segId || c.to === segId).map((c) => snapshotRelease(m, c))]
  const at = mark()
  const done = branchPipe(
    m,
    { segmentId: segId, at: points[0], via: points.slice(1), to: d.to, flowType: d.flowType, systemId: d.systemId === 'auto' ? undefined : d.systemId === 'none' ? null : d.systemId, range },
    segmentAxis,
  )
  if ('refused' in done) {
    note(done.refused)
    return false
  }
  const made = [...(done.reused ? [] : [done.tee, done.tail!]), ...done.segments, ...done.fittings]
  remember(
    `${d.flowType} 분기 그리기 (${shortName(seg.name)})`,
    { kind: 'many', parts: [...made.map((equipment): Snapshot => ({ kind: 'equipment-set', equipment, storeyId: done.storeyOf.get(equipment.id)!, index: 0, present: false, connections: [], systems: [] })), ...before] },
    at,
  )
  ruleReport.value = done.rules
  ensureDrawnMeshes()
  if (!done.reused) placeStretched(segId)
  triggerRef(model)
  flowVersion.value++
  redraw()
  const how = done.reused
    ? `끝의 ${shortName(done.tee.name)}을 분기점으로 다시 썼습니다`
    : `분기점 ${done.tee.name}을 넣어 ${shortName(seg.name)}을 나눴습니다${done.replaced?.released ? '(옛 BIM 포트 연결은 해제 보정으로 남김)' : ''}`
  note(`${d.flowType} 분기를 그렸습니다: ${how} · 구간 ${done.segments.length}개 · ${done.length.toFixed(2)}m. 흐름 방향은 아직 정하지 않았습니다`)
  return true
}

// --- 배관 꼭짓점 넣기·지우기 (OE-PIP-10, pipe-vertex.ts) ---
// 구간을 고르면 가운데에 꼭짓점(엘보)을 넣어 둘로 나눈다 — 넣은 엘보를 골라 두므로 바로 끌거나 좌표 칸으로 옮겨 꺾는다. 구간 둘 사이의 엘보를
// 고르면 지워 두 구간을 하나로 합친다. 확정 방향은 이어받는다.

/** 고른 것에 할 수 있는 꼭짓점 편집. 형상이 있는 구간이면 넣기, 구간 둘 사이의 이음쇠면 지우기. */
export const vertexAction = computed((): 'insert' | 'remove' | null => {
  void sceneVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || !editing.value) return null
  if (e.role === 'segment') return segmentPath(e) && 'path' in segmentPath(e)! ? 'insert' : null
  if (e.role !== 'fitting') return null
  const sides = m.connections.filter((c) => c.from === e.id || c.to === e.id).map((c) => equipmentById.value.get(c.from === e.id ? c.to : c.from))
  return sides.length === 2 && sides.every((x) => x?.role === 'segment') ? 'remove' : null
})
export function insertVertexHere(seg: Equipment) {
  const m = model.value
  const path = segmentPath(seg)
  if (!m || !path || !('path' in path)) return
  const [p, q] = path.path
  const at = mark()
  const done = insertPipeVertex(m, seg.id, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], segmentAxis)
  if ('refused' in done) return void note(done.refused)
  remember(`${shortName(seg.name)} 꼭짓점 넣기`, done.undo, at)
  ruleReport.value = done.rules
  ensureDrawnMeshes()
  placeStretched(seg.id)
  triggerRef(model)
  flowVersion.value++
  redraw()
  select(done.elbow.id)
  note(`${shortName(seg.name)} 가운데에 꼭짓점 ${done.elbow.name}을 넣어 둘로 나눴습니다${done.replaced?.released ? '(옛 BIM 포트 연결은 해제 보정으로 남김)' : ''}. 꼭짓점을 끌거나 좌표 칸으로 옮겨 꺾습니다`)
}
export function removeVertexHere(fitting: Equipment) {
  const m = model.value
  if (!m) return
  const at = mark()
  const done = removePipeVertex(m, fitting.id, segmentAxis)
  if ('refused' in done) return void note(done.refused)
  remember(`${shortName(fitting.name)} 꼭짓점 지우기`, done.undo, at)
  ruleReport.value = done.rules
  placeStretched(done.kept.id)
  triggerRef(model)
  flowVersion.value++
  redraw()
  select(done.kept.id)
  note(`꼭짓점 ${shortName(fitting.name)}을 지워 ${shortName(done.kept.name)}·${shortName(done.removed[1].name)}을 하나로 합쳤습니다. Ctrl+Z 로 되돌립니다`)
}
