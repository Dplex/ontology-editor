// IDF 를 BIM 위에 놓는다 — 층을 맞추고, 평면 좌표계(원점·회전)를 맞춘다(ADR-0069).
//
// **층은 높이가 맞는 층을 닻으로 삼고 나머지는 순서로 맞춘다.** 시뮬레이션 모델은 층고를 고르게 다듬는 일이 흔하다. 성수
// IDF 는 3F 위로 층고 3m 인데 BIM 은 4.3m 라 높이만 보면 4F 부터 79개 중 49개 존이 층을 못 찾았다. 아래층 넷(B1F·1F·2F·3F)은
// 높이가 그대로 맞으니 그것을 닻으로 두고, 닻 사이·위·아래의 남은 바닥은 BIM 층을 낮은 순으로 하나씩 짝짓는다. 닻 사이의
// 개수가 다르면 짝짓지 않는다(층 하나를 빼고 그린 IDF 를 한 칸씩 밀어 붙이지 않는다). 존 이름의 `4F_` 는 규칙이 아니라
// 맞춘 결과를 대 보는 데만 쓴다.
//
// **평면은 겹친 넓이가 가장 큰 이동·회전을 찾는다.** IDF 에는 BIM 과 공유하는 기준점이 없다. 성수 IDF 는 건물 모서리를
// 원점에 두고 그려(x 0.8~52.9) BIM(x 17.6~69.6)과 16.76m·18.08m 어긋났다. 기준층 하나에서 존 바닥과 방 바닥이 가장 많이
// 겹치는 자리를 찾는다 — 90° 단위 회전마다 범위 중심을 맞춘 뒤 격자를 좁혀 간다. 이미 맞는 IDF 를 건드리지 않도록
// 제자리가 어긋났고 찾은 자리가 뚜렷이 맞을 때만 옮긴다(PLACED_SHARE). 찾은 값은 사람이 보고 고칠 수 있다(attach 의 `placement` 옵션).

import { overlapArea } from '../polygon'
import { polygonArea, type Storey, type Vec2 } from '../model'

/** IDF 평면을 BIM 평면에 놓는 법. 원점 둘레로 `rotation`(반시계, 도) 돌린 뒤 `dx`·`dy`(m) 옮긴다. */
export type IdfPlacement = { dx: number; dy: number; rotation: number }

export const IDENTITY: IdfPlacement = { dx: 0, dy: 0, rotation: 0 }

export function placePoint([x, y]: Vec2, p: IdfPlacement): Vec2 {
  if (!p.rotation) return [x + p.dx, y + p.dy]
  const a = (p.rotation * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [x * c - y * s + p.dx, x * s + y * c + p.dy]
}

export function placeRing(ring: readonly Vec2[], p: IdfPlacement): Vec2[] {
  return ring.map((v) => placePoint(v, p))
}

// --- 층 ------------------------------------------------------------------------------------------

export type LevelMatch = {
  /** IDF 바닥 높이 → BIM 층 id. 못 맞춘 높이는 없다. */
  storeyOf: Map<number, string>
  /** 높이로 맞춘 바닥 수 / 순서로 맞춘 바닥 수. */
  byHeight: number
  byOrder: number
}

/**
 * IDF 바닥 높이들을 BIM 층에 맞춘다. 높이가 `tolerance` 안인 것이 닻이고, 닻끼리는 순서가 엇갈리지 않는다. 닻이 없으면
 * 아무것도 맞추지 않는다 — 어디서부터 세야 할지 모른다.
 */
export function matchLevels(levels: readonly number[], storeys: readonly Pick<Storey, 'id' | 'elevation'>[], tolerance: number): LevelMatch {
  const lv = [...new Set(levels)].sort((a, b) => a - b)
  const st = [...storeys].sort((a, b) => a.elevation - b.elevation)
  const storeyOf = new Map<number, string>()
  // 닻: 낮은 바닥부터 가장 가까운 층. 앞 닻보다 위의 층만 고른다.
  const anchors: [number, number][] = []
  for (let i = 0; i < lv.length; i++) {
    const after = anchors.length ? anchors[anchors.length - 1][1] + 1 : 0
    let best = -1
    for (let j = after; j < st.length; j++) {
      const d = Math.abs(st[j].elevation - lv[i])
      if (d <= tolerance && (best < 0 || d < Math.abs(st[best].elevation - lv[i]))) best = j
    }
    if (best >= 0) anchors.push([i, best])
  }
  // 우연히 높이가 맞은 닻을 버린다. 닻마다 "BIM 층 순번 − IDF 바닥 순번" 이 같아야 한 줄로 맞는 것이다. 가장 많은 값보다 적은
  // 값의 닻은 우연이다 — 성수에서 31m(IDF 10F)와 31.5m(BIM 8F)가 거의 맞아 10F 가 8F 에 붙을 뻔했다. 많은 값이 둘 이상 같으면 다 둔다.
  const shifts = new Map<number, number>()
  for (const [i, j] of anchors) shifts.set(j - i, (shifts.get(j - i) ?? 0) + 1)
  const most = Math.max(0, ...shifts.values())
  const keep = new Set([...shifts].filter(([, n]) => n === most).map(([k]) => k))
  if (keep.size === 1) anchors.splice(0, anchors.length, ...anchors.filter(([i, j]) => keep.has(j - i)))
  for (const [i, j] of anchors) storeyOf.set(lv[i], st[j].id)
  let byOrder = 0
  const pair = (i: number, j: number) => {
    storeyOf.set(lv[i], st[j].id)
    byOrder++
  }
  if (anchors.length) {
    // 닻 사이: 남은 바닥 수와 층 수가 같을 때만.
    for (let k = 0; k + 1 < anchors.length; k++) {
      const [i0, j0] = anchors[k]
      const [i1, j1] = anchors[k + 1]
      if (i1 - i0 === j1 - j0) for (let n = 1; n < i1 - i0; n++) pair(i0 + n, j0 + n)
    }
    // 맨 위 닻 위, 맨 아래 닻 아래: 층이 모자라지 않으면 붙여 센다.
    const [iTop, jTop] = anchors[anchors.length - 1]
    if (lv.length - 1 - iTop <= st.length - 1 - jTop) for (let n = 1; iTop + n < lv.length; n++) pair(iTop + n, jTop + n)
    const [iLow, jLow] = anchors[0]
    if (iLow <= jLow) for (let n = 1; n <= iLow; n++) pair(iLow - n, jLow - n)
  }
  return { storeyOf, byHeight: anchors.length, byOrder }
}

/** 존 이름에 적힌 층(`4F_office`, `B1F_kitchen`, `1F:OFFICE`). 없으면 null. 대 보는 데만 쓴다. */
export function storeyHint(zoneName: string): string | null {
  const m = /(?:^|[^A-Za-z0-9])(B?\d{1,3}F)(?=[^A-Za-z0-9]|$)/i.exec(zoneName) ?? /^(B?\d{1,3}F)(?=[_:\- ])/i.exec(zoneName)
  return m ? m[1].toUpperCase() : null
}

// --- 평면 ----------------------------------------------------------------------------------------

/** 한 층의 짝: IDF 존 바닥 조각과 BIM 방 바닥. */
export type LevelPair = { zones: Vec2[][]; spaces: Vec2[][] }

export type PlacementEstimate = IdfPlacement & {
  /** 기준층에서 존 넓이 중 방과 겹친 몫(0~1). */
  overlap: number
  /** 제자리일 때의 같은 값. */
  before: number
}

/**
 * 기준층 존 넓이 중 이만큼 넘게 방과 겹치면 맞은 자리로 본다. 제자리가 이미 넘으면 찾지 않고, 찾은 자리는 이 값을 넘고 제자리의 두 배는
 * 되어야 옮긴다. 방을 듬성듬성 그린 층에서 존을 방이 많은 쪽으로 미끄러뜨리지 않으려는 것이다(오목한 존 시험이 그렇게 밀렸다).
 * 성수 4F 는 제자리 0% → 찾은 자리 96% 다.
 */
export const PLACED_SHARE = 0.5

/**
 * 겹친 넓이가 가장 큰 놓는 법을 찾는다. 기준층은 존 넓이와 방 넓이가 둘 다 크고 비슷한 층이다 — 방을 반만 그린 층(성수 2F,
 * 방 140㎡ · 존 1,249㎡)은 범위 중심이 어긋나서 고르지 않는다. 짝이 없으면 null. `fixed` 를 주면 찾지 않고 그 값의 겹침만 잰다.
 */
export function estimatePlacement(pairs: readonly LevelPair[], fixed?: IdfPlacement): PlacementEstimate | null {
  const sized = pairs
    .map((p) => {
      const za = p.zones.reduce((n, r) => n + polygonArea(r), 0)
      const sa = p.spaces.reduce((n, r) => n + polygonArea(r), 0)
      return { p, za, score: za > 0 && sa > 0 ? (Math.min(za, sa) ** 2) / Math.max(za, sa) : 0 }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  const ref = sized[0]
  if (!ref) return null
  const spaces = ref.p.spaces.filter((r) => r.length >= 4).map((r) => ({ r, box: bbox(r) }))
  const total = (rings: readonly Vec2[][]) => {
    let sum = 0
    for (const r of rings) {
      const box = bbox(r)
      for (const s of spaces) if (meets(box, s.box)) sum += overlapArea(s.r, r) ?? 0
    }
    return sum
  }
  const before = total(ref.p.zones) / ref.za
  if (fixed) return { ...fixed, overlap: total(ref.p.zones.map((r) => placeRing(r, fixed))) / ref.za, before }
  const stay = { ...IDENTITY, overlap: before, before }
  if (before > PLACED_SHARE) return stay
  const target = center(ref.p.spaces.flat())
  let best: PlacementEstimate = stay
  for (const rotation of [0, 90, 180, 270]) {
    const turned = ref.p.zones.map((r) => placeRing(r, { dx: 0, dy: 0, rotation }))
    const c = center(turned.flat())
    let at = { dx: target[0] - c[0], dy: target[1] - c[1], v: -1 }
    const score = (dx: number, dy: number) => total(turned.map((r) => r.map(([x, y]) => [x + dx, y + dy] as Vec2)))
    at.v = score(at.dx, at.dy)
    for (const step of [1, 0.25, 0.05]) {
      const from = { ...at }
      for (let i = -4; i <= 4; i++)
        for (let j = -4; j <= 4; j++) {
          if (!i && !j) continue
          const dx = from.dx + i * step
          const dy = from.dy + j * step
          const v = score(dx, dy)
          if (v > at.v) at = { dx, dy, v }
        }
    }
    const overlap = at.v / ref.za
    if (overlap > best.overlap) best = { dx: round(at.dx), dy: round(at.dy), rotation, overlap, before }
  }
  return best.overlap > PLACED_SHARE && best.overlap >= before * 2 ? best : stay
}

const round = (v: number) => Math.round(v * 100) / 100

type Box = [number, number, number, number]
function bbox(ring: readonly Vec2[]): Box {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of ring) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}
const meets = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
function center(points: readonly Vec2[]): Vec2 {
  const [x0, y0, x1, y1] = bbox(points)
  return [(x0 + x1) / 2, (y0 + y1) / 2]
}
