// 치수 표시(OE-UI-08). 합성 층: 벽 A(0~4, 두께 0.2)와 3m 떨어진 나란한 벽 B, A 끝에 맞닿은 벽 C.
import { describe, expect, it } from 'vitest'
import { moveWall, setWallLength } from './edit'
import { dimensionText, wallDimensions } from './dimensions'
import type { Model, Wall } from './model'

const wall = (id: string, ring: [number, number][], height = 3): Wall => ({ id, name: id, thickness: 0.2, loadBearing: false, height, footprint: [ring] })
const model = (): Model =>
  ({
    schema: 'IFC4',
    siteName: '',
    buildingId: 'B',
    buildingName: '',
    systems: [],
    connections: [],
    storeys: [
      {
        id: '1F',
        name: '1F',
        elevation: 0,
        spaces: [],
        openings: [],
        equipment: [],
        walls: [
          wall('A', [[0, 0], [4, 0], [4, 0.2], [0, 0.2]]),
          wall('B', [[0, 3], [4, 3], [4, 3.2], [0, 3.2]]),
          wall('C', [[4, 0], [4.2, 0], [4.2, 3], [4, 3]]),
        ],
      },
    ],
  }) as unknown as Model

describe('치수 표시 (OE-UI-08)', () => {
  it('벽을 고르면 길이·두께·높이와 떨어진 가장 가까운 벽까지 거리를 낸다(맞닿은 벽은 빼고) [OE-UI-08#1~]', () => {
    const m = model()
    const d = wallDimensions(m.storeys[0], m.storeys[0].walls[0])!
    expect([d.length, d.thickness, d.height]).toEqual([4, 0.2, 3])
    expect(d.nearest?.id).toBe('B')
    expect(d.nearest!.distance).toBeCloseTo(2.8, 6)
    expect(dimensionText(d)).toBe('길이 4.00m · 두께 0.20m · 높이 3.00m · 가까운 벽(B)까지 2.80m')
  })

  it('벽을 옮기거나 길이를 바꾸면 치수가 함께 바뀐다', () => {
    const m = model()
    expect(moveWall(m, 'A', [0, 1])).toBe(true)
    const st = m.storeys[0]
    expect(wallDimensions(st, st.walls[0])!.nearest!.distance).toBeCloseTo(1.8, 6)
    expect(setWallLength(m, 'A', 3)).toBe(true)
    expect(wallDimensions(st, st.walls[0])!.length).toBeCloseTo(3, 6)
  })
})
