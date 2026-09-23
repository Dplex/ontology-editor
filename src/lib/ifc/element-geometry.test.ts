import { describe, expect, it } from 'vitest'
import { footprintRings, openingPlacement, spacesBesideOpening } from './element-geometry'
import type { ElementMesh } from './import'
import type { Space, Vec2 } from '../model'

/**
 * IFC 평면의 직사각형(중심, 가로, 세로, 회전)을 높이 h 만큼 세운 상자. three.js 좌표(x, 높이, -y)로 만든다.
 * 여러 개를 주면 한 메시로 합친다(바닥까지 뚫린 문 자리로 끊긴 벽처럼).
 */
function boxes(...specs: { cx: number; cy: number; w: number; d: number; angle?: number; h?: number }[]): ElementMesh {
  const positions: number[] = []
  const indices: number[] = []
  for (const { cx, cy, w, d, angle = 0, h = 3 } of specs) {
    const base = positions.length / 3
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    const corners: Vec2[] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ]
    for (const z of [0, h]) {
      for (const [x, y] of corners) {
        const X = cx + x * c - y * s
        const Y = cy + x * s + y * c
        positions.push(X, z, -Y)
      }
    }
    const faces = [
      [0, 2, 1], [0, 3, 2], // 바닥
      [4, 5, 6], [4, 6, 7], // 천장
      [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
    ]
    for (const f of faces) indices.push(...f.map((v) => v + base))
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(positions.length), indices: new Uint32Array(indices) }
}

const square = (id: string, x0: number, y0: number, x1: number, y1: number): Space => ({
  id,
  name: id,
  longName: id,
  footprint: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
  areaM2: (x1 - x0) * (y1 - y0),
  boundedBy: [],
})

describe('벽의 평면 외곽선', () => {
  it('맨 아래 면의 테두리를 닫힌 고리로 만든다', () => {
    const rings = footprintRings(boxes({ cx: 5, cy: 0, w: 10, d: 0.2 }))
    expect(rings).toHaveLength(1)
    const ring = rings[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([0, 10])
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.2, 3)
  })

  it('바닥까지 뚫린 문 자리로 끊긴 벽은 고리가 둘이다', () => {
    expect(footprintRings(boxes({ cx: 2, cy: 0, w: 4, d: 0.2 }, { cx: 7, cy: 0, w: 4, d: 0.2 }))).toHaveLength(2)
  })
})

describe('문·창의 자리', () => {
  it('45° 로 놓인 문도 벽을 뚫는 방향과 두께를 맞게 잡는다', () => {
    const p = openingPlacement(boxes({ cx: 3, cy: 4, w: 0.9, d: 0.1, angle: Math.PI / 4, h: 2.1 }))!
    expect(p.position[0]).toBeCloseTo(3, 3)
    expect(p.position[1]).toBeCloseTo(4, 3)
    expect(p.position[2]).toBeCloseTo(0, 3)
    expect(p.depth).toBeCloseTo(0.1, 3)
    // 벽을 따라가는 축(45°)에 수직이다.
    expect(Math.abs(p.through[0] * Math.cos(Math.PI / 4) + p.through[1] * Math.sin(Math.PI / 4))).toBeLessThan(1e-6)
  })

  it('문 양쪽을 짚어 두 방을 찾고, 바깥으로 난 문은 하나만 찾는다', () => {
    const spaces = [square('A', 0, 0, 5, 5), square('B', 0, 5.2, 5, 10)]
    // y = 5.1 에 선 벽(두께 0.2)에 난 문. 한쪽은 A, 다른 쪽은 B 다.
    const inner = openingPlacement(boxes({ cx: 2, cy: 5.1, w: 0.9, d: 0.2, h: 2.1 }))!
    expect(spacesBesideOpening(inner, spaces).sort()).toEqual(['A', 'B'])
    const outer = openingPlacement(boxes({ cx: 2, cy: -0.1, w: 0.9, d: 0.2, h: 2.1 }))!
    expect(spacesBesideOpening(outer, spaces)).toEqual(['A'])
  })
})
