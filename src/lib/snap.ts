// 스냅(OE-UI-06). 찍거나 끄는 점이 가까운 오브젝트의 꼭짓점·변에 붙는다. 그리드 정렬(OE-UI-07, grid.ts)과 같이 켜져 있으면
// 반경 안에 오브젝트가 있을 때 오브젝트가 앞선다 — 그리드 교점은 형상과 맞물리지 않아서다. 오브젝트 안에서는 꼭짓점이 변보다
// 앞선다(모서리에 대려던 점이 변 위 다른 자리에 붙지 않게). 반경 안에 아무것도 없으면 그리드, 그것도 꺼져 있으면 찍은 자리다.
//
// 겹침 판정(OE-OBJ-16)은 스냅과 상관없이 형상 기준이다. 스냅은 찍는 자리만 바꾼다.

import type { Model, Vec2 } from './model'
import { snapToGrid } from './grid'

export type SnapSettings = { on: boolean; radius: number }
/** 반경 0.3m: 벽 두께(0.1~0.3m)보다 조금 크게. 벽 안쪽 면과 바깥 면 둘 중 가까운 것에 붙는다. */
export const DEFAULT_SNAP: SnapSettings = { on: false, radius: 0.3 }
export const SNAP_RADIUS_RANGE = { min: 0.05, max: 2 } as const

/** 스냅 대상 고리 하나. `id` 는 짚을 때 보여 줄 오브젝트(물리존·벽·룸·커스텀존). */
export type SnapRing = { id: string; label: string; points: Vec2[]; box: [number, number, number, number] }

export type SnapHit =
  | { kind: 'vertex'; at: Vec2; target: SnapRing }
  | { kind: 'edge'; at: Vec2; target: SnapRing; edge: [Vec2, Vec2] }
  | { kind: 'grid'; at: Vec2 }

const ring = (id: string, label: string, pts: readonly Vec2[]): SnapRing | null => {
  const last = pts.at(-1)
  const points = (pts.length > 1 && last && pts[0][0] === last[0] && pts[0][1] === last[1] ? pts.slice(0, -1) : pts).map((p) => [p[0], p[1]] as Vec2)
  if (points.length < 2) return null
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return { id, label, points, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }
}

/**
 * 한 층의 스냅 대상. 물리존·벽(평면 외곽선)·룸·커스텀존의 고리다. `skip` 의 id 는 뺀다 — 고치고 있는 물리존의 꼭짓점을 끌 때
 * 제 변에 붙지 않게.
 */
export function snapTargets(m: Model, storeyId: string, skip: ReadonlySet<string> = new Set()): SnapRing[] {
  const st = m.storeys.find((s) => s.id === storeyId)
  if (!st) return []
  const out: (SnapRing | null)[] = []
  for (const sp of st.spaces) if (!skip.has(sp.id) && sp.footprint.length) out.push(ring(sp.id, sp.longName || sp.name || '물리존', sp.footprint))
  for (const w of st.walls) if (!skip.has(w.id)) for (const r of w.footprint ?? []) out.push(ring(w.id, w.name || '벽', r))
  for (const r of st.rooms ?? []) if (!skip.has(r.id)) out.push(ring(r.id, r.name || '룸', r.footprint))
  for (const z of st.customZones ?? []) if (!skip.has(z.id)) out.push(ring(z.id, z.name || '커스텀존', z.footprint))
  return out.filter((r): r is SnapRing => !!r)
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
  return [a[0] + t * dx, a[1] + t * dy]
}

const round = (v: number) => Math.round(v * 1000) / 1000 || 0

/**
 * 점 하나를 보정한다. 스냅이 켜져 있고 반경 안에 꼭짓점이 있으면 가장 가까운 꼭짓점, 없고 변이 있으면 가장 가까운 변 위의 점,
 * 둘 다 없고 그리드가 켜져 있으면 가장 가까운 교점. 아무것도 아니면 null(찍은 자리 그대로).
 */
export function snapPoint(p: Vec2, targets: readonly SnapRing[], snap: SnapSettings, grid: { on: boolean; spacing: number }): SnapHit | null {
  if (snap.on && snap.radius > 0) {
    const r = snap.radius
    let vertex: { d: number; at: Vec2; target: SnapRing } | null = null
    let edge: { d: number; at: Vec2; target: SnapRing; edge: [Vec2, Vec2] } | null = null
    for (const t of targets) {
      const [x0, y0, x1, y1] = t.box
      if (p[0] < x0 - r || p[0] > x1 + r || p[1] < y0 - r || p[1] > y1 + r) continue
      const n = t.points.length
      for (let i = 0; i < n; i++) {
        const a = t.points[i]
        const dv = Math.hypot(p[0] - a[0], p[1] - a[1])
        if (dv <= r && (!vertex || dv < vertex.d)) vertex = { d: dv, at: a, target: t }
        // 고리가 두 점(선)이면 변은 하나다.
        if (n === 2 && i === 1) break
        const b = t.points[(i + 1) % n]
        const q = closestOnSegment(p, a, b)
        const de = Math.hypot(p[0] - q[0], p[1] - q[1])
        if (de <= r && (!edge || de < edge.d)) edge = { d: de, at: q, target: t, edge: [a, b] }
      }
    }
    if (vertex) return { kind: 'vertex', at: [round(vertex.at[0]), round(vertex.at[1])], target: vertex.target }
    if (edge) return { kind: 'edge', at: [round(edge.at[0]), round(edge.at[1])], target: edge.target, edge: edge.edge }
  }
  if (grid.on && grid.spacing > 0) return { kind: 'grid', at: snapToGrid(p, grid.spacing) }
  return null
}
