// 그리드 정렬(OE-UI-07).
import { describe, expect, it } from 'vitest'
import { gridLines, MAX_GRID_LINES, snapToGrid } from './grid'

describe('그리드 정렬 (OE-UI-07)', () => {
  it('찍은 점이 가장 가까운 교점으로 간다. 간격을 바꾸면 교점이 바뀐다 [OE-UI-07#1~]', () => {
    expect(snapToGrid([1.23, -0.74], 0.5)).toEqual([1, -0.5])
    expect(snapToGrid([1.26, 2.76], 0.5)).toEqual([1.5, 3])
    expect(snapToGrid([1.23, -0.74], 0.25)).toEqual([1.25, -0.75])
    expect(snapToGrid([1.23, 4.56], 0)).toEqual([1.23, 4.56])
  })

  it('범위 안의 선을 간격대로 내고, 너무 많으면 건너 그린다', () => {
    const g = gridLines({ minX: -0.2, minY: 0, maxX: 2, maxY: 1 }, 0.5)
    expect([g.x, g.y, g.step]).toEqual([[0, 0.5, 1, 1.5, 2], [0, 0.5, 1], 0.5])
    const big = gridLines({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 0.5)
    expect(big.x.length + big.y.length).toBeLessThanOrEqual(MAX_GRID_LINES + 2)
    expect(big.step).toBeGreaterThan(0.5)
  })
})
