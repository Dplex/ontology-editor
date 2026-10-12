// 치수 표시(OE-UI-08). 고른 벽의 길이·두께·높이와, 같은 층에서 가장 가까운 다른 벽까지의 거리. 단위는 m(OE-INT-04).
// 모델에서 그때 재므로 벽을 옮기거나 길이·두께를 바꾸면(방향키·칸) 값이 함께 바뀐다.

import { wallAxis, wallLength } from './edit'
import type { Storey, Vec2, Wall } from './model'

export type WallDimensions = {
  /** 중심선 두 끝(치수선 자리). */
  axis: { a: Vec2; b: Vec2 }
  length: number
  thickness: number | null
  height: number | null
  /** 가장 가까운 다른 벽과 그 사이 거리(면과 면). 두 점은 거리를 잰 자리다. 다른 벽이 없으면 null. */
  nearest: { id: string; name: string; distance: number; from: Vec2; to: Vec2 } | null
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]

/** 점에서 선분까지 가장 가까운 점. */
function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a)
  const len2 = d[0] ** 2 + d[1] ** 2
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2))
  return [a[0] + d[0] * t, a[1] + d[1] * t]
}

/** 두 다각형(링 여럿) 사이 가장 가까운 두 점. 겹치면 거리 0 으로 본다(꼭짓점이 상대 변 위). */
export function ringsGap(a: readonly (readonly Vec2[])[], b: readonly (readonly Vec2[])[]): { distance: number; from: Vec2; to: Vec2 } | null {
  let best: { distance: number; from: Vec2; to: Vec2 } | null = null
  const edges = (rings: readonly (readonly Vec2[])[]) => rings.flatMap((r) => r.map((p, i): [Vec2, Vec2] => [p, r[(i + 1) % r.length]]))
  const consider = (p: Vec2, q: Vec2, flip: boolean) => {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (!best || d < best.distance) best = flip ? { distance: d, from: q, to: p } : { distance: d, from: p, to: q }
  }
  for (const p of a.flat()) for (const [s, t] of edges(b)) consider(p, closestOnSegment(p, s, t), false)
  for (const p of b.flat()) for (const [s, t] of edges(a)) consider(p, closestOnSegment(p, s, t), true)
  return best
}

export function wallDimensions(storey: Pick<Storey, 'walls'>, wall: Wall): WallDimensions | null {
  const rings = wall.footprint ?? []
  const axis = wallAxis(rings)
  if (!axis) return null
  const length = wallLength(wall) ?? Math.hypot(axis.b[0] - axis.a[0], axis.b[1] - axis.a[1])
  let nearest: WallDimensions['nearest'] = null
  for (const other of storey.walls) {
    if (other.id === wall.id || !other.footprint?.length) continue
    const gap = ringsGap(rings, other.footprint)
    // 맞닿은 벽(모서리에서 만나는 벽)은 거리 0 이라 치수로 뜻이 없다. 떨어진 벽만 센다.
    if (gap && gap.distance > 0.001 && (!nearest || gap.distance < nearest.distance)) nearest = { id: other.id, name: other.name, ...gap }
  }
  return { axis: { a: axis.a, b: axis.b }, length, thickness: wall.thickness ?? axis.half * 2, height: wall.height ?? null, nearest }
}

/** 칩·평면도 글. */
export function dimensionText(d: WallDimensions): string {
  const parts = [`길이 ${d.length.toFixed(2)}m`]
  if (d.thickness !== null) parts.push(`두께 ${d.thickness.toFixed(2)}m`)
  if (d.height !== null) parts.push(`높이 ${d.height.toFixed(2)}m`)
  if (d.nearest) parts.push(`가까운 벽(${d.nearest.name || d.nearest.id})까지 ${d.nearest.distance.toFixed(2)}m`)
  return parts.join(' · ')
}
