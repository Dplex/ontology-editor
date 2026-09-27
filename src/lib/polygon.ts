// 물리존 나누기·합치기(E3)에 드는 다각형 계산.
//
// 다각형 연산 라이브러리를 들이지 않는다. 55 는 npm 레지스트리에 닿지 않아서(CLAUDE.md) lock 이 바뀌면 배포가 깨진다.
// 대신 물리존에서 실제로 생기는 경우만 푼다 — 선 하나로 둘로 나누기, 변을 맞댄(또는 벽 두께만큼 떨어진) 두 방 합치기.
// 그 밖(선이 방을 셋 이상으로 자르는 것, 일부만 겹친 두 방)은 **틀린 모양을 만들지 않고 거절한다.**

import type { Vec2 } from './model'
import { distanceToRing, isSelfIntersecting, pointInPolygon } from './mapping'
import { polygonArea } from './model'

const EPS = 1e-6

/** 닫는 점(첫 점과 같은 끝 점)을 뗀 꼭짓점들. */
export function openPoints(ring: readonly Vec2[]): Vec2[] {
  const last = ring.at(-1)
  const closed = ring.length > 1 && !!last && ring[0][0] === last[0] && ring[0][1] === last[1]
  return (closed ? ring.slice(0, -1) : ring).map((p) => [p[0], p[1]] as Vec2)
}

export const closeRing = (points: readonly Vec2[]): Vec2[] => (points.length ? [...points.map((p) => [p[0], p[1]] as Vec2), [points[0][0], points[0][1]]] : [])

function signedArea(points: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

/** 한 줄 위에 놓인 가운데 꼭짓점을 뺀다. 나누고 합친 뒤 변 하나가 꼭짓점 여럿으로 쪼개져 남지 않게. */
function dropCollinear(points: Vec2[]): Vec2[] {
  let out = points
  for (let changed = true; changed && out.length > 3; ) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length]
      const b = out[i]
      const c = out[(i + 1) % out.length]
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
      const same = Math.hypot(b[0] - a[0], b[1] - a[1]) < EPS
      if (same || Math.abs(cross) < 1e-9 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]))) {
        out = [...out.slice(0, i), ...out.slice(i + 1)]
        changed = true
        break
      }
    }
  }
  return out
}

export type SplitResult = { ok: true; rings: [Vec2[], Vec2[]] } | { ok: false; reason: string }

/**
 * 고리를 두 점 a·b 를 지나는 직선으로 둘로 나눈다. 두 조각은 닫힌 고리로 돌려주고, 넓이 합은 원래와 같다.
 *
 * 직선이 경계를 **정확히 두 번** 지날 때만 나눈다. ㄷ자 방을 두 팔에 걸쳐 자르면 네 번 지나는데, 그때 한 번에 두
 * 조각을 만들면 한 조각이 선을 따라 얇은 다리로 이어진 모양이 된다(넓이는 맞지만 다각형이 아니다).
 */
export function splitRing(ring: readonly Vec2[], a: Vec2, b: Vec2): SplitResult {
  const points = openPoints(ring)
  if (points.length < 3) return { ok: false, reason: '외곽선이 없는 방은 나눌 수 없습니다.' }
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len < 0.01) return { ok: false, reason: '나눌 선의 두 점이 너무 가깝습니다.' }
  const side = (p: Vec2) => (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len
  const s = points.map((p) => {
    const v = side(p)
    return Math.abs(v) < 1e-6 ? 0 : v
  })

  // 꼭짓점과 교차점을 한 줄로 늘어놓고, 선 위에 놓인 것에 표시를 한다.
  const seq: { p: Vec2; cut: boolean }[] = []
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    seq.push({ p: points[i], cut: s[i] === 0 })
    if (s[i] !== 0 && s[j] !== 0 && s[i] > 0 !== s[j] > 0) {
      const t = s[i] / (s[i] - s[j])
      seq.push({ p: [points[i][0] + t * (points[j][0] - points[i][0]), points[i][1] + t * (points[j][1] - points[i][1])], cut: true })
    }
  }
  // 선 위의 꼭짓점이라도 양쪽이 같은 편이면 스치기만 한 것이다(볼록한 모서리에 선이 닿은 것). 자르는 자리가 아니다.
  const cuts = seq
    .map((x, i) => ({ ...x, i }))
    .filter((x) => {
      if (!x.cut) return false
      const at = x.i
      const prev = seq[(at - 1 + seq.length) % seq.length].p
      const next = seq[(at + 1) % seq.length].p
      const sp = side(prev)
      const sn = side(next)
      return !(Math.abs(sp) > 1e-6 && Math.abs(sn) > 1e-6 && sp > 0 === sn > 0)
    })
  if (cuts.length !== 2) {
    return { ok: false, reason: cuts.length < 2 ? '선이 방을 가로지르지 않습니다.' : '선이 방을 셋 이상으로 자릅니다. 한 번에 둘로 나뉘는 자리에 선을 그으세요.' }
  }
  const [c0, c1] = cuts.map((c) => c.i)
  const first = seq.slice(c0, c1 + 1).map((x) => x.p)
  const second = [...seq.slice(c1), ...seq.slice(0, c0 + 1)].map((x) => x.p)
  const pieces = [dropCollinear(first), dropCollinear(second)]
  if (pieces.some((p) => p.length < 3 || Math.abs(signedArea(p)) < 0.01)) {
    return { ok: false, reason: '선이 방의 변을 따라갑니다. 나뉘는 조각이 없습니다.' }
  }
  const whole = polygonArea(points)
  const sum = pieces.reduce((n, p) => n + Math.abs(signedArea(p)), 0)
  if (Math.abs(sum - whole) > 1e-6 * Math.max(1, whole) || pieces.some((p) => isSelfIntersecting(closeRing(p)))) {
    return { ok: false, reason: '이 선으로는 방이 깨끗이 나뉘지 않습니다.' }
  }
  return { ok: true, rings: [closeRing(pieces[0]), closeRing(pieces[1])] }
}

/** 두 방 사이를 메워 합칠 수 있는 틈(미터). 벽 두께다 — 벽 너머 방을 합치면 그 벽 자리도 방이 된다. */
export const MERGE_GAP = 0.5

export type UnionResult = { ok: true; ring: Vec2[]; bridged: boolean } | { ok: false; reason: string }

function ccw(points: Vec2[]): Vec2[] {
  return signedArea(points) < 0 ? [...points].reverse() : points
}

function closestOnRing(p: Vec2, ring: readonly Vec2[]): Vec2 {
  let best: Vec2 = ring[0]
  let bestD = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    const q: Vec2 = [a[0] + t * dx, a[1] + t * dy]
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}

/** 한쪽 꼭짓점 중 다른 쪽에서 틈 안에 있는 것을 다른 쪽 변 위로 당긴다. 벽 두께만큼 떨어진 두 방이 변을 맞대게 된다. */
function pullOnto(points: Vec2[], other: Vec2[], gap: number): { points: Vec2[]; moved: boolean } {
  let moved = false
  const out = points.map((p) => {
    const d = distanceToRing(p, other)
    if (d < EPS || d > gap || pointInPolygon(p, other)) return p
    moved = true
    return closestOnRing(p, other)
  })
  return { points: out, moved }
}

const key = (p: Vec2) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`

/** 변을 다른 고리의 꼭짓점이 놓인 자리에서 끊는다. 맞댄 변이 같은 조각으로 떨어져야 서로 지울 수 있다. */
function splitEdges(points: Vec2[], cutters: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    out.push(a)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    if (l2 < EPS * EPS) continue
    const on = cutters
      .map((c) => ({ c, t: ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / l2 }))
      .filter(({ c, t }) => t > 1e-7 && t < 1 - 1e-7 && Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / Math.sqrt(l2) < 1e-5)
      .sort((x, y) => x.t - y.t)
    for (const { c } of on) out.push(c)
  }
  return out
}

/**
 * 두 방의 외곽선을 하나로 합친다.
 *
 * - 한쪽이 다른 쪽을 품으면 큰 쪽 외곽선이다.
 * - 변을 맞대면 맞댄 변을 지운다. 벽 두께(MERGE_GAP)만큼 떨어져 있으면 먼저 한쪽을 다른 쪽 변으로 당겨 맞댄다 —
 *   벽 너머 방을 합치는 것은 그 벽이 없어졌다는 뜻이라 벽 자리도 방이 된다(`bridged`).
 * - 일부만 겹치거나 떨어져 있거나 합친 모양이 고리 하나로 닫히지 않으면(가운데에 구멍) 거절한다.
 */
export function unionRings(ringA: readonly Vec2[], ringB: readonly Vec2[], gap = MERGE_GAP): UnionResult {
  let a = openPoints(ringA)
  let b = openPoints(ringB)
  if (a.length < 3 || b.length < 3) return { ok: false, reason: '외곽선이 없는 방은 합칠 수 없습니다.' }
  a = ccw(a)
  b = ccw(b)

  if (b.every((p) => pointInPolygon(p, a) || distanceToRing(p, a) < 1e-6)) return { ok: true, ring: closeRing(a), bridged: false }
  if (a.every((p) => pointInPolygon(p, b) || distanceToRing(p, b) < 1e-6)) return { ok: true, ring: closeRing(b), bridged: false }
  if (b.some((p) => pointInPolygon(p, a) && distanceToRing(p, a) > 1e-6) || a.some((p) => pointInPolygon(p, b) && distanceToRing(p, b) > 1e-6)) {
    return { ok: false, reason: '두 방이 일부만 겹칩니다. 겹친 방은 경계를 먼저 고치세요.' }
  }

  const pa = pullOnto(a, b, gap)
  a = pa.points
  const pb = pullOnto(b, a, gap)
  b = pb.points
  const bridged = pa.moved || pb.moved

  const edgesOf = (points: Vec2[]) => points.map((p, i) => [p, points[(i + 1) % points.length]] as [Vec2, Vec2]).filter(([p, q]) => key(p) !== key(q))
  const ea = edgesOf(splitEdges(a, b))
  const eb = edgesOf(splitEdges(b, a))
  const edgeKey = (p: Vec2, q: Vec2) => `${key(p)}>${key(q)}`
  const ka = new Set(ea.map(([p, q]) => edgeKey(p, q)))
  const kb = new Set(eb.map(([p, q]) => edgeKey(p, q)))
  // 둘 다 반시계라 맞댄 변은 서로 반대 방향이다. 그 짝을 지우면 바깥 테두리만 남는다.
  const keep = [...ea.filter(([p, q]) => !kb.has(edgeKey(q, p))), ...eb.filter(([p, q]) => !ka.has(edgeKey(q, p)))]
  if (keep.length === ea.length + eb.length) {
    const d = Math.min(...a.map((p) => distanceToRing(p, b)), ...b.map((p) => distanceToRing(p, a)))
    return { ok: false, reason: `두 방이 맞닿지 않습니다(사이 ${d.toFixed(2)}m). ${gap}m 안에 있는 방만 합칩니다.` }
  }

  const next = new Map<string, [Vec2, Vec2][]>()
  for (const e of keep) next.set(key(e[0]), [...(next.get(key(e[0])) ?? []), e])
  const rings: Vec2[][] = []
  const used = new Set<[Vec2, Vec2]>()
  for (const start of keep) {
    if (used.has(start)) continue
    const ring: Vec2[] = []
    let e: [Vec2, Vec2] | undefined = start
    for (let guard = 0; e && !used.has(e) && guard < 100_000; guard++) {
      used.add(e)
      ring.push(e[0])
      e = (next.get(key(e[1])) ?? []).find((x) => !used.has(x))
    }
    if (ring.length >= 3) rings.push(ring)
  }
  if (rings.length !== 1) return { ok: false, reason: '합친 모양이 고리 하나로 닫히지 않습니다(가운데가 빕니다).' }
  const ring = dropCollinear(rings[0])
  const expected = Math.abs(signedArea(a)) + Math.abs(signedArea(b))
  if (isSelfIntersecting(closeRing(ring)) || Math.abs(Math.abs(signedArea(ring)) - expected) > 1e-4 * Math.max(1, expected)) {
    return { ok: false, reason: '두 방을 한 외곽선으로 합칠 수 없습니다.' }
  }
  return { ok: true, ring: closeRing(ring), bridged }
}
