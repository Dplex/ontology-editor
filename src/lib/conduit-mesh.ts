// 설비를 따라 늘인 덕트·배관 구간의 3D 형상(edit.ts 의 applyFollow). 모델에는 끝이 옮겨진 양(`endShift`)만 있고,
// 꼭짓점은 여기서 그 값으로 다시 만든다. 형상 좌표는 화면 좌표(viewer.ts 의 toScene: y 가 높이)다.

import { axisParam, shiftAt, type SegmentAxis } from './edit'
import type { Vec3 } from './model'

const fromScene = (x: number, y: number, z: number): Vec3 => [x, -z, y]
const toScene = (p: readonly number[]): Vec3 => [p[0], p[2], -p[1]]

/**
 * 구간 형상의 축 두 끝(세계 좌표). 가운데에서 가장 먼 꼭짓점과, 그 점에서 가장 먼 꼭짓점이 축 방향을 정하고,
 * 꼭짓점을 그 방향에 내려 양 끝을 잡는다. 경사진 배관도 축에 맞게 잡힌다(상자의 긴 변으로 잡으면 대각선 배관이 틀린다).
 */
export function segmentAxisOf(positions: Float32Array): SegmentAxis | null {
  const n = positions.length / 3
  if (n < 2) return null
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i]
    cy += positions[i + 1]
    cz += positions[i + 2]
  }
  cx /= n
  cy /= n
  cz /= n
  const farthest = (ox: number, oy: number, oz: number) => {
    let best = 0
    let at = 0
    for (let i = 0; i < positions.length; i += 3) {
      const d = (positions[i] - ox) ** 2 + (positions[i + 1] - oy) ** 2 + (positions[i + 2] - oz) ** 2
      if (d > best) {
        best = d
        at = i
      }
    }
    return at
  }
  const a = farthest(cx, cy, cz)
  const b = farthest(positions[a], positions[a + 1], positions[a + 2])
  let dx = positions[b] - positions[a]
  let dy = positions[b + 1] - positions[a + 1]
  let dz = positions[b + 2] - positions[a + 2]
  const len = Math.hypot(dx, dy, dz)
  if (len === 0) return null
  dx /= len
  dy /= len
  dz /= len
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const t = (positions[i] - cx) * dx + (positions[i + 1] - cy) * dy + (positions[i + 2] - cz) * dz
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  return [fromScene(cx + dx * lo, cy + dy * lo, cz + dz * lo), fromScene(cx + dx * hi, cy + dy * hi, cz + dz * hi)]
}

/**
 * 형상을 끝이 옮겨진 만큼 늘인다. 꼭짓점마다 축 위 비율 t 를 재고 두 끝의 이동을 t 로 섞어 더한다 — 좌표(`position`)가
 * 움직이는 식과 같다. `rigid` 는 그 위에 통째로 더할 이동이다(구간을 직접 옮긴 것).
 */
export function stretchPositions(base: Float32Array, axis: SegmentAxis, shift: readonly [Vec3, Vec3], rigid: Vec3): Float32Array {
  const out = new Float32Array(base.length)
  const sa = toScene(shift[0])
  const sb = toScene(shift[1])
  const r = toScene(rigid)
  const a = toScene(axis[0])
  const b = toScene(axis[1])
  const scene: SegmentAxis = [a, b]
  for (let i = 0; i < base.length; i += 3) {
    const t = axisParam(scene, [base[i], base[i + 1], base[i + 2]])
    out[i] = base[i] + sa[0] * (1 - t) + sb[0] * t + r[0]
    out[i + 1] = base[i + 1] + sa[1] * (1 - t) + sb[1] * t + r[1]
    out[i + 2] = base[i + 2] + sa[2] * (1 - t) + sb[2] * t + r[2]
  }
  return out
}

/**
 * 늘인 형상에 더할 통째 이동. 형상을 떠 둔 때의 좌표 `at` 에서 지금 좌표까지 간 것 중 늘이기가 설명하지 못하는 몫이다.
 * 떠 둔 때 끝 이동이 0 이었다고 본다(처음 늘일 때나 불러오기 직전에 뜬다).
 */
export function rigidPart(axis: SegmentAxis, at: Vec3, now: Vec3, shift: readonly [Vec3, Vec3]): Vec3 {
  const s = shiftAt(shift, axisParam(axis, at))
  return [now[0] - at[0] - s[0], now[1] - at[1] - s[1], now[2] - at[2] - s[2]]
}

/**
 * 사람이 그린 배관의 형상(OE-PIP-11). BIM 형상이 없으니 두 끝 사이에 단면이 `size` 인 네모 관을 만든다. 끝점 추종이 이 형상의 축을
 * BIM 구간과 같은 식(`segmentAxisOf`)으로 다시 잡으므로, 축은 두 끝 그대로 나온다. 좌표는 화면 좌표다.
 */
export function boxAlong(a: Vec3, b: Vec3, size: number): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const [p, q] = [toScene(a), toScene(b)]
  const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
  const len = Math.hypot(d[0], d[1], d[2]) || 1
  const u = d.map((v) => v / len)
  // 축에 수직인 두 방향. 축이 거의 수직(화면 y)이면 x 를 기준으로 잡는다.
  const ref = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const cross = (x: number[], y: number[]) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]
  const norm = (x: number[]) => {
    const l = Math.hypot(x[0], x[1], x[2]) || 1
    return x.map((v) => v / l)
  }
  const v = norm(cross(u, ref))
  const w = norm(cross(u, v))
  const h = size / 2
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const positions: number[] = []
  const normals: number[] = []
  for (const end of [p, q])
    for (const [cv, cw] of corners) {
      positions.push(end[0] + (v[0] * cv + w[0] * cw) * h, end[1] + (v[1] * cv + w[1] * cw) * h, end[2] + (v[2] * cv + w[2] * cw) * h)
      const n = norm([v[0] * cv + w[0] * cw, v[1] * cv + w[1] * cw, v[2] * cv + w[2] * cw])
      normals.push(n[0], n[1], n[2])
    }
  // 옆면 넷 + 두 끝 마개.
  const indices = [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) }
}

/** 그린 배관의 이음쇠 형상. 꼭짓점에 놓인 정육면체다. */
export function boxAt(at: Vec3, size: number): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  return boxAlong([at[0] - size / 2, at[1], at[2]], [at[0] + size / 2, at[1], at[2]], size)
}
