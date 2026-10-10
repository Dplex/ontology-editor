// 두 판본의 좌표계 어긋남 추정(OE-BIM-22). 원점·북방향이 다른 두 BIM 을 합치면 오류 없이 통째로 어긋난다(merge.ts 의 정렬 경고).
// 경고와 함께 "얼마나" 를 보여 임포트 단계에서 맞출 수 있게 한다(OE-INT-04).
//
// 짝은 같은 층(이름·높이로 맞춘 층)의 같은 방 번호다. Revit 의 설비 판본은 건축 Room 을 MEP Space 로 베껴 방 번호가 같다. 짝이 둘 이상이고
// 서로 떨어져 있으면 두 점 무리를 겹치는 회전·이동(2D 최소제곱, Kabsch)을 구한다. 짝이 모자라면 두 파일이 차지한 범위의 중심 차만 낸다 —
// 회전은 모른다고 적는다. 내용이 다른 두 파일(건축의 방 · 설비의 기기)의 범위라 대략값이다.

import { isPlaceholder, matchStorey } from './merge'
import type { Model, Vec2 } from './model'

export type Offset = {
  /** 덧붙인 파일 좌표를 기준 파일에 맞추는 이동(m). 회전을 먼저 하고 이동한다. */
  dx: number
  dy: number
  /** 덧붙인 파일 좌표를 원점 둘레로 돌리는 각(도, 반시계가 +). 모르면 null. */
  rotationDeg: number | null
  /** 잰 근거. `spaces` 는 같은 방 번호 쌍, `extent` 는 범위 중심. */
  basis: 'spaces' | 'extent'
  /** 쌍의 수(`spaces`). */
  pairs: number
  /** 맞춘 뒤 쌍 사이에 남는 거리의 제곱평균제곱근(m). `extent` 면 null. */
  residual: number | null
}

/** 쌍이 이만큼(m)은 퍼져 있어야 회전을 잰다. 한 점에 모인 쌍으로는 회전을 가를 수 없다. */
const MIN_SPREAD = 1

function centroid(ring: readonly Vec2[]): Vec2 | null {
  const pts = ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring
  if (pts.length < 3) return null
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]
    const [x1, y1] = pts[(i + 1) % pts.length]
    const cross = x0 * y1 - x1 * y0
    a += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  return [cx / (3 * a), cy / (3 * a)]
}

/** 같은 층·같은 방 번호(층 안에서 하나뿐인 번호)의 중심점 쌍. [덧붙인 쪽, 기준 쪽]. */
function spacePairs(base: Model, overlay: Model): [Vec2, Vec2][] {
  const out: [Vec2, Vec2][] = []
  const unique = (spaces: Model['storeys'][number]['spaces']) => {
    const by = new Map<string, Vec2 | null>()
    for (const s of spaces) {
      if (!s.name || isPlaceholder(s)) continue
      const c = centroid(s.footprint)
      by.set(s.name, by.has(s.name) || !c ? null : c)
    }
    return by
  }
  for (const st of overlay.storeys) {
    const match = matchStorey(st, base.storeys)
    if (!match) continue
    const mine = unique(st.spaces)
    const theirs = unique(match.target.spaces)
    for (const [name, c] of mine) {
      const d = theirs.get(name)
      if (c && d) out.push([c, d])
    }
  }
  return out
}

/** 소수 자리로 반올림. -0 은 0 이다. */
const round = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(step < 0.1 ? 2 : 1)) || 0

/** 덧붙인 파일을 기준 파일에 맞추는 회전·이동. 잴 것이 없으면 null. */
export function estimateOffset(base: Model, overlay: Model): Offset | null {
  const pairs = spacePairs(base, overlay)
  const mean = (pts: Vec2[]): Vec2 => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  if (pairs.length >= 2) {
    const co = mean(pairs.map((p) => p[0]))
    const cb = mean(pairs.map((p) => p[1]))
    const spread = Math.max(...pairs.map(([o]) => Math.hypot(o[0] - co[0], o[1] - co[1])))
    if (spread >= MIN_SPREAD) {
      let sin = 0
      let cos = 0
      for (const [o, b] of pairs) {
        const [ox, oy] = [o[0] - co[0], o[1] - co[1]]
        const [bx, by] = [b[0] - cb[0], b[1] - cb[1]]
        sin += ox * by - oy * bx
        cos += ox * bx + oy * by
      }
      const theta = Math.atan2(sin, cos)
      const [c, s] = [Math.cos(theta), Math.sin(theta)]
      const t: Vec2 = [cb[0] - (c * co[0] - s * co[1]), cb[1] - (s * co[0] + c * co[1])]
      const residual = Math.sqrt(
        pairs.reduce((sum, [o, b]) => sum + (c * o[0] - s * o[1] + t[0] - b[0]) ** 2 + (s * o[0] + c * o[1] + t[1] - b[1]) ** 2, 0) / pairs.length,
      )
      return { dx: round(t[0], 0.01), dy: round(t[1], 0.01), rotationDeg: round((theta * 180) / Math.PI, 0.1), basis: 'spaces', pairs: pairs.length, residual: round(residual, 0.01) }
    }
  }
  // 짝이 모자라면 범위 중심 차. 기준은 물리존 외곽선, 덧붙인 쪽은 외곽선과 설비 좌표.
  const basePts = base.storeys.flatMap((s) => s.spaces.flatMap((sp) => sp.footprint))
  const overlayPts: Vec2[] = overlay.storeys.flatMap((s) => [
    ...s.spaces.flatMap((sp) => sp.footprint),
    ...s.equipment.flatMap((e) => (e.position ? [[e.position[0], e.position[1]] as Vec2] : [])),
  ])
  if (!basePts.length || !overlayPts.length) return null
  const center = (pts: Vec2[]): Vec2 => {
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
  }
  const [cb, co] = [center(basePts), center(overlayPts)]
  return { dx: round(cb[0] - co[0], 0.01), dy: round(cb[1] - co[1], 0.01), rotationDeg: null, basis: 'extent', pairs: pairs.length, residual: null }
}

const signed = (v: number, digits: number) => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`

/** 경고에 붙이는 한 문장. */
export function offsetText(o: Offset): string {
  const move = `x ${signed(o.dx, 2)}m · y ${signed(o.dy, 2)}m`
  return o.basis === 'spaces'
    ? `덧붙인 파일을 맞추려면 회전 ${signed(o.rotationDeg!, 1)}°(원점 둘레, 반시계 +) 뒤 ${move} 옮깁니다(같은 방 번호 ${o.pairs}쌍으로 잼, 남는 차 ${o.residual!.toFixed(2)}m).`
    : `덧붙인 파일을 맞추려면 대략 ${move} 옮깁니다(두 파일 범위의 중심 차 — 같은 방 번호가 모자라 회전은 모릅니다).`
}
