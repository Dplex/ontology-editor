// 3D 화면의 벽에 문·창 자리를 뚫는다.
//
// 화면의 벽은 바닥 외곽선을 낮게(ARCH_WALL_HEIGHT) 세운 단면이다. BIM 벽의 바닥 외곽선에는 바닥까지 내려온 문 자리만 끊겨 있고
// 창 자리는 이어져 있어서, 창은 벽 위에 얹힌 막대로, 옮기거나 더한 문은 벽에 박힌 기둥으로 보였다. 여기서는 문·창의 평면 사각형만큼
// 벽을 높이 구간으로 잘라, 창턱 아래·문틀 위만 벽으로 남긴다. 다각형 라이브러리는 들이지 않는다(polygon.ts 머리말) — 빼는 쪽이
// 볼록 사각형 하나라 반평면 자르기로 푼다.

import type { Opening, Vec2 } from './model'

/** 벽 두께 쪽으로 뚫는 반 폭(미터). 문·창 형상의 두께는 문틀만이라 벽보다 얇을 수 있어 넉넉히 둔다. 자르는 것은 그 문·창의 벽뿐이다. */
const ACROSS_HALF = 1
const EPS_AREA = 1e-6

/** 벽 조각: 평면 고리와 화면 벽 바닥에서 잰 아래·위(미터). */
export type WallSlab = { ring: Vec2[]; bottom: number; top: number }

/** 벽에서 뺄 문·창 자리: 평면 사각형(반시계)과, 화면 벽 바닥에서 잰 개구부 아래(창턱)·위(문틀 위). */
export type OpeningCut = { rect: Vec2[]; sill: number; head: number }

/** 벽을 따르는 방향(단위). 벽을 뚫는 방향 `through` 를 왼쪽으로 돌린 것이다. */
export const alongOf = (through: Vec2): Vec2 => [-through[1], through[0]]

/**
 * 문·창이 벽을 뚫는 평면 사각형(반시계). 벽을 따라 가로만큼, 벽 두께 쪽으로는 넉넉히(ACROSS_HALF).
 * 자리·가로·뚫는 방향 중 하나라도 모르면 null — 어디를 뚫을지 모른다.
 */
export function openingRect(o: Pick<Opening, 'position' | 'width' | 'through'>): Vec2[] | null {
  if (!o.position || !o.width || !o.through) return null
  const [cx, cy] = o.position
  const d = alongOf(o.through)
  const t = o.through
  const w = o.width / 2
  const corner = (a: number, b: number): Vec2 => [cx + d[0] * a + t[0] * b, cy + d[1] * a + t[1] * b]
  // (along, through) 는 오른손 좌표라 이 순서가 반시계다.
  const rect = [corner(-w, -ACROSS_HALF), corner(w, -ACROSS_HALF), corner(w, ACROSS_HALF), corner(-w, ACROSS_HALF)]
  return signed(rect) >= 0 ? rect : rect.reverse()
}

function signed(points: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

const cross = (a: Vec2, b: Vec2, p: Vec2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])

/** 고리를 반평면 a→b 의 왼쪽(`keepLeft`) 또는 오른쪽으로 자른다(Sutherland–Hodgman 한 단계). */
function clipHalf(poly: readonly Vec2[], a: Vec2, b: Vec2, keepLeft: boolean): Vec2[] {
  const out: Vec2[] = []
  const side = (p: Vec2) => (keepLeft ? cross(a, b, p) : -cross(a, b, p))
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    const sp = side(p)
    const sq = side(q)
    if (sp >= 0) out.push(p)
    if ((sp >= 0) !== (sq >= 0)) {
      const k = sp / (sp - sq)
      out.push([p[0] + k * (q[0] - p[0]), p[1] + k * (q[1] - p[1])])
    }
  }
  return out
}

const open = (ring: readonly Vec2[]): Vec2[] => {
  const last = ring.at(-1)
  const closed = ring.length > 1 && !!last && ring[0][0] === last[0] && ring[0][1] === last[1]
  return closed ? ring.slice(0, -1) : [...ring]
}

const solid = (poly: Vec2[]) => poly.length >= 3 && Math.abs(signed(poly)) > EPS_AREA

/** 고리와 볼록 사각형(반시계)의 겹친 부분. 없으면 null. */
export function intersectConvex(ring: readonly Vec2[], rect: readonly Vec2[]): Vec2[] | null {
  let poly = open(ring)
  for (let i = 0; i < rect.length && poly.length >= 3; i++) poly = clipHalf(poly, rect[i], rect[(i + 1) % rect.length], true)
  return solid(poly) ? poly : null
}

/**
 * 고리에서 볼록 사각형(반시계)을 뺀 조각들. 변 i 의 바깥이면서 앞 변들의 안쪽인 조각을 모으면 서로 겹치지 않고 빈틈없이 덮는다.
 * 벽 고리가 오목하면 조각에 넓이 0 의 다리가 남을 수 있지만 넓이는 맞다(세우면 보이지 않는다).
 */
export function subtractConvex(ring: readonly Vec2[], rect: readonly Vec2[]): Vec2[][] {
  const out: Vec2[][] = []
  let inside = open(ring)
  for (let i = 0; i < rect.length && inside.length >= 3; i++) {
    const a = rect[i]
    const b = rect[(i + 1) % rect.length]
    const outside = clipHalf(inside, a, b, false)
    if (solid(outside)) out.push(outside)
    inside = clipHalf(inside, a, b, true)
  }
  return out
}

/**
 * 벽 고리들을 문·창 자리로 잘라 세울 조각으로 나눈다. 사각형 밖은 [0, top] 그대로, 안은 [0, top] 에서 [sill, head] 를 뺀 구간만
 * 남는다 — 창이면 창턱 아래(와 낮은 창이면 창 위), 문이면 대개 아무것도 안 남는다. 문·창이 여럿이어도 차례로 자르면 된다.
 */
export function cutWall(rings: readonly (readonly Vec2[])[], cuts: readonly OpeningCut[], top: number): WallSlab[] {
  let slabs: WallSlab[] = rings.map((r) => ({ ring: open(r), bottom: 0, top })).filter((s) => s.ring.length >= 3)
  for (const c of cuts) {
    if (c.head <= 0 || c.sill >= top) continue
    const next: WallSlab[] = []
    for (const s of slabs) {
      if (c.head <= s.bottom || c.sill >= s.top) {
        next.push(s)
        continue
      }
      const hit = intersectConvex(s.ring, c.rect)
      if (!hit) {
        next.push(s)
        continue
      }
      for (const ring of subtractConvex(s.ring, c.rect)) next.push({ ring, bottom: s.bottom, top: s.top })
      if (c.sill > s.bottom) next.push({ ring: hit, bottom: s.bottom, top: c.sill })
      if (c.head < s.top) next.push({ ring: hit, bottom: c.head, top: s.top })
    }
    slabs = next
  }
  return slabs
}
