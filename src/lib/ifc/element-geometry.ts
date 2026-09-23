// 벽·문·창의 평면 위치를 형상(메시)에서 읽는다.
//
// 3D Map 과 로봇 경로가 기다리는 칸이다(정본 §3.6 "벽·문·창 위치"). 배치점(ObjectPlacement)은 믿지 않는다 —
// Revit IFC2x3 은 부재의 배치점을 층 원점에 두고 형상만 제자리에 두는 일이 있다(설비에서 겪었다). 형상은
// 3D 가 이미 읽고 있으니 거기서 잰다.
//
// 메시는 three.js 좌표(x, 높이, -y)다. 여기서 IFC 평면(x, y)과 높이 z 로 되돌린다.

import type { Space, Vec2, Vec3 } from '../model'
import { pointInPolygon } from '../mapping'
import type { ElementMesh } from './import'

/** 바닥면으로 볼 높이 여유(미터). 바닥이 조금 기운 형상도 받는다. */
const BOTTOM_TOLERANCE = 0.01

/**
 * 벽의 평면 외곽선. **맨 아래 면들의 테두리**를 이어 고리로 만든다.
 *
 * 볼록 껍질로 잡으면 ㄱ자·곡선 벽이 틀린다. 아래 면을 이루는 삼각형 중 한 번만 쓰인 변이 테두리이고,
 * 그걸 이으면 모양 그대로의 외곽선이 된다. 바닥까지 뚫린 문 자리는 벽이 끊기므로 고리가 여럿이 되는데,
 * 로봇 경로에는 그게 맞다(문 자리가 지나갈 수 있는 틈이다). 아래 면이 없으면(기울어진 벽 등) 빈 배열이다.
 */
export function footprintRings(mesh: ElementMesh): Vec2[][] {
  const p = mesh.positions
  let minH = Infinity
  for (let i = 1; i < p.length; i += 3) if (p[i] < minH) minH = p[i]
  if (!Number.isFinite(minH)) return []

  const key = (v: number) => `${Math.round(p[v * 3] * 1000)},${Math.round(-p[v * 3 + 2] * 1000)}`
  const point = new Map<string, Vec2>()
  const edges = new Map<string, { from: string; to: string; count: number }>()
  const idx = mesh.indices
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]]
    if (tri.some((v) => p[v * 3 + 1] > minH + BOTTOM_TOLERANCE)) continue
    const keys = tri.map(key)
    if (new Set(keys).size < 3) continue
    tri.forEach((v, i) => point.set(keys[i], [p[v * 3], -p[v * 3 + 2]]))
    for (let i = 0; i < 3; i++) {
      const a = keys[i]
      const b = keys[(i + 1) % 3]
      const undirected = a < b ? `${a}|${b}` : `${b}|${a}`
      const e = edges.get(undirected)
      if (e) e.count++
      else edges.set(undirected, { from: a, to: b, count: 1 })
    }
  }

  // 한 번만 쓰인 변이 테두리다. 끝점을 따라 이어 고리를 만든다.
  const next = new Map<string, string[]>()
  for (const e of edges.values()) {
    if (e.count !== 1) continue
    next.set(e.from, [...(next.get(e.from) ?? []), e.to])
  }
  const rings: Vec2[][] = []
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: Vec2[] = [point.get(start)!]
      let at = next.get(start)!.pop()!
      let guard = 0
      while (at !== start && guard++ < 100_000) {
        ring.push(point.get(at)!)
        const outs = next.get(at)
        if (!outs || outs.length === 0) break
        at = outs.pop()!
      }
      if (at === start && ring.length >= 3) rings.push([...ring, ring[0]])
    }
  }
  return rings.filter((r) => Math.abs(signedArea(r)) > 1e-4)
}

function signedArea(ring: readonly Vec2[]): number {
  let a = 0
  for (let i = 0; i + 1 < ring.length; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return a / 2
}

export type OpeningPlacement = {
  /** 평면 중심과 바닥 높이. */
  position: Vec3
  /** 벽을 뚫고 지나가는 방향(단위 벡터). 문 양쪽의 방을 찾을 때 쓴다. */
  through: Vec2
  /** 그 방향으로 잰 두께(미터). */
  depth: number
}

/**
 * 문·창의 자리. 평면 점들의 주축이 벽을 따라가는 방향이고, 그에 수직인 쪽이 벽을 뚫는 방향이다.
 * 경계 상자의 축으로 잡으면 45° 로 놓인 문에서 양쪽 방을 잘못 짚는다.
 */
export function openingPlacement(mesh: ElementMesh): OpeningPlacement | null {
  const p = mesh.positions
  const n = p.length / 3
  if (n === 0) return null
  let mx = 0, my = 0, minZ = Infinity
  for (let v = 0; v < n; v++) {
    mx += p[v * 3]
    my += -p[v * 3 + 2]
    if (p[v * 3 + 1] < minZ) minZ = p[v * 3 + 1]
  }
  mx /= n
  my /= n
  let sxx = 0, syy = 0, sxy = 0
  for (let v = 0; v < n; v++) {
    const dx = p[v * 3] - mx
    const dy = -p[v * 3 + 2] - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const through: Vec2 = [-Math.sin(angle), Math.cos(angle)]
  let lo = Infinity, hi = -Infinity, alo = Infinity, ahi = -Infinity
  for (let v = 0; v < n; v++) {
    const x = p[v * 3], y = -p[v * 3 + 2]
    const t = x * through[0] + y * through[1]
    const s = x * Math.cos(angle) + y * Math.sin(angle)
    if (t < lo) lo = t
    if (t > hi) hi = t
    if (s < alo) alo = s
    if (s > ahi) ahi = s
  }
  // 평면 중심은 두 축의 범위 가운데로 잡는다. 꼭짓점 평균은 손잡이·문틀 쪽으로 쏠린다.
  const t0 = (lo + hi) / 2
  const s0 = (alo + ahi) / 2
  const cx = s0 * Math.cos(angle) + t0 * through[0]
  const cy = s0 * Math.sin(angle) + t0 * through[1]
  return { position: [cx, cy, minZ], through, depth: hi - lo }
}

/** 문 양쪽을 짚을 때 문 두께 바깥으로 더 나가는 거리(미터). 벽 두께 안에 머물지 않게 한다. */
export const DOOR_REACH = 0.3

/**
 * 좌표로 문 양쪽의 방을 찾는다. BIM 이 공간 경계(`IfcRelSpaceBoundary`)로 말해 주지 않을 때의 대비책이다.
 * 성수 건축 파일은 공간 경계가 0 이었다. 바깥으로 난 문은 방 하나만 나온다.
 */
export function spacesBesideOpening(placement: OpeningPlacement, spaces: readonly Space[]): string[] {
  const [cx, cy] = placement.position
  const d = placement.depth / 2 + DOOR_REACH
  const found: string[] = []
  for (const sign of [1, -1]) {
    const pt: Vec2 = [cx + sign * d * placement.through[0], cy + sign * d * placement.through[1]]
    const space = spaces.find((s) => s.footprint.length >= 4 && pointInPolygon(pt, s.footprint))
    if (space && !found.includes(space.id)) found.push(space.id)
  }
  return found
}
