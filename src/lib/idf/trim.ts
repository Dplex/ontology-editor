// IDF 공조존 바닥을 BIM 방에 맞춰 다듬는다(ADR-0072).
//
// **IDF 바닥과 BIM 방은 세 가지로 어긋난다.** 성수(Factorial.idf + 건축 IFC)에서 존 경계를 25cm 간격으로 짚으면 45% 가 벽 두께 안을
// 지난다 — DesignBuilder 는 바닥을 벽 중심선까지 그린다(존 넓이가 순 넓이의 1.0~1.19 배). 40% 남짓은 벽 없는 열린 바닥을 지나는 창가 띠와
// 안쪽의 경계다(깊이 4.1~4.5m, 시뮬레이션 관례). 나머지는 BIM 이 방을 안 그린 자리(성수 1F·2F 매장)다.
//
// 그래서 셋을 따로 다룬다.
//   1. 방과 겹친 몫은 방 경계로 자른다. 방마다 (방 ∩ 존) 조각으로 나누고, 벽 두께보다 얇은 조각과 방 안의 얇은 틈은 그 방에서 가장 큰
//      조각의 존에 붙인다. 정점을 옮기는 스냅이 아니라 조각에 존을 정하는 것이라(Ledoux & Arroyo Ohori 2017 의 pprepair 를 방 단위로 줄인
//      것) 결과가 늘 유효한 다각형이고 임계값 하나에 결과가 휘둘리지 않는다.
//   2. 방 밖으로 나간 몫 중 얇은 띠(벽 중심선 몫)는 버리고, 두꺼운 덩어리는 벽만 빼고 IDF 그대로 둔다. BIM 이 방을 안 그린 자리의 존을
//      지우면 존이 틀린 게 아닌데 존이 사라진다(성수 1F 매장 존 셋이 통째로 없어졌다). 남긴 넓이는 `noRoomM2` 로 따로 알린다.
//   3. 창가·안쪽 경계는 건드리지 않는다. 방 하나를 존 여럿이 나누는 것은 오류가 아니다(ADR-0069).
//
// 다각형 연산은 polygon-clipping 이다. 좌표를 1mm 로 맞춰 넣는다 — 성수 10F 에서 반올림 없이는 교차 계산이 조용히 실패했다.

import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { Vec2 } from '../model'

/** 이보다 폭이 좁은 조각은 벽 두께 띠다(m). 성수 벽 두께가 0.14~0.8m 다. 폭은 2 × 넓이 / 둘레로 잰다. */
export const SLIVER_WIDTH = 0.6
/** 이보다 작은 조각도 띠로 본다(㎡). */
export const SLIVER_AREA = 1
/** 방 밖으로 나간 몫을 남길 최소 폭(m)·넓이(㎡). 벽 중심선 띠(폭 = 벽 두께의 절반)가 걸리지 않을 만큼. */
export const KEEP_WIDTH = 1
export const KEEP_AREA = 2

export type TrimmedZone = {
  /** 다듬은 바닥(닫힌 바깥 고리들). 구멍은 채운다 — 성수에서 구멍 6개 21㎡ 가 모두 어느 존도 차지하지 않은 자리였다. */
  footprint: Vec2[][]
  /** 방이 없는 자리에 IDF 외곽선 그대로 남긴 넓이(㎡). */
  noRoomM2: number
}

const q = (v: number) => Math.round(v * 1000) / 1000
const toRing = (ring: readonly Vec2[]): Ring => {
  const pts: Ring = ring.map((p) => [q(p[0]), q(p[1])])
  const [a, z] = [pts[0], pts.at(-1)]
  return a && z && (a[0] !== z[0] || a[1] !== z[1]) ? [...pts, [a[0], a[1]]] : pts
}
const toMulti = (rings: readonly (readonly Vec2[])[]): MultiPolygon => {
  const polys = rings.filter((r) => r.length >= 3).map((r) => [toRing(r)] as Polygon)
  return polys.length ? union(...polys.map((p) => [p])) : []
}

function union(...geoms: MultiPolygon[]): MultiPolygon {
  const xs = geoms.filter((g) => g.length)
  if (xs.length <= 1) return xs[0] ?? []
  return polygonClipping.union(xs[0], ...xs.slice(1))
}
const intersect = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => (a.length && b.length ? polygonClipping.intersection(a, b) : [])
const subtract = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => (!a.length || !b.length ? a : polygonClipping.difference(a, b))

const ringArea = (r: Ring) => {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return Math.abs(s) / 2
}
const ringLength = (r: Ring) => {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1])
  return s
}
const polyArea = (p: Polygon) => ringArea(p[0]) - p.slice(1).reduce((n, h) => n + ringArea(h), 0)
const polyWidth = (p: Polygon) => (2 * polyArea(p)) / p.reduce((n, r) => n + ringLength(r), 0)
const area = (m: MultiPolygon) => m.reduce((n, p) => n + polyArea(p), 0)
const isSliver = (p: Polygon) => polyArea(p) < SLIVER_AREA || polyWidth(p) < SLIVER_WIDTH

/**
 * 한 층의 IDF 공조존 바닥을 그 층 방에 맞춘다. 방이 없는 층은 부르지 않는다(맞출 것이 없다). 벽 외곽선이 없으면(형상을 읽지 않은
 * 임포트) 벽을 빼지 않고, 띠는 폭으로만 거른다.
 */
export function trimZonesToRooms(
  zones: readonly { id: string; footprint: readonly Vec2[][] }[],
  rooms: readonly (readonly Vec2[])[],
  walls: readonly (readonly Vec2[])[],
): Map<string, TrimmedZone> {
  const roomGeoms = rooms.map((r) => toMulti([r])).filter((g) => area(g) > 1e-4)
  const allRooms = union(...roomGeoms)
  const wallGeom = toMulti(walls)
  const zoneGeoms = zones.map((z) => ({ id: z.id, geom: toMulti(z.footprint) }))
  const parts = new Map<string, MultiPolygon[]>(zones.map((z) => [z.id, []]))

  // 1. 방마다 조각으로 나누고, 얇은 조각과 방 안의 얇은 틈은 그 방에서 가장 큰 조각의 존으로.
  for (const room of roomGeoms) {
    const pieces = zoneGeoms.map((z) => ({ id: z.id, geom: intersect(room, z.geom) })).filter((p) => p.geom.length)
    if (!pieces.length) continue
    const split = pieces.map((p) => ({ id: p.id, solid: p.geom.filter((x) => !isSliver(x)), thin: p.geom.filter(isSliver) }))
    const host = split.filter((p) => p.solid.length).sort((a, b) => area(b.solid) - area(a.solid))[0]?.id
    // 띠만 닿은 방은 어느 존의 것도 아니다.
    if (!host) continue
    for (const p of split) {
      if (p.solid.length) parts.get(p.id)!.push(p.solid)
      if (p.thin.length) parts.get(host)!.push(p.thin)
    }
    const gaps = subtract(room, union(...pieces.map((p) => p.geom))).filter(isSliver)
    if (gaps.length) parts.get(host)!.push(gaps)
  }

  // 2. 방 밖으로 나간 몫 중 두꺼운 덩어리(방을 안 그린 자리)는 벽만 빼고 남긴다.
  const noRoom = new Map<string, MultiPolygon>()
  for (const z of zoneGeoms) {
    const kept = subtract(subtract(z.geom, allRooms), wallGeom).filter((p) => polyArea(p) >= KEEP_AREA && polyWidth(p) >= KEEP_WIDTH)
    noRoom.set(z.id, kept)
    if (kept.length) parts.get(z.id)!.push(kept)
  }

  // 3. 구멍은 채운다. 존 바닥은 바깥 고리만 담는다(HvacZone.footprint) — IDF 외곽선도 구멍이 없었다.
  const out = new Map<string, TrimmedZone>()
  for (const [id, ms] of parts) {
    const filled = union(...union(...ms).map((p) => [[p[0]]] as MultiPolygon))
    out.set(id, {
      footprint: filled.map((p) => p[0].map(([x, y]) => [x, y] as Vec2)),
      noRoomM2: Math.round(area(noRoom.get(id) ?? []) * 100) / 100,
    })
  }
  return out
}
