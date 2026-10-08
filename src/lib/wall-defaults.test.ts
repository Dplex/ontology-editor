import { describe, expect, it } from 'vitest'
import { addOpening, addWall, moveOpening, newWallThickness, OPENING_SNAP } from './edit'
import type { Model, Opening, Vec2, Wall } from './model'

// 새 벽 두께(OE-SPC-12)와 문·창 스냅 거리(OE-SPC-13).
// 새 벽 두께는 1) 같은 층 BIM 내벽 두께의 최빈값 → 2) 사이트 기본값 → 3) 0.2m 다. 스냅 거리는 사람이 고칠 수 있다.

const rect = (a: Vec2, b: Vec2, t: number): Vec2[] => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const nx = (-(b[1] - a[1]) / len) * (t / 2)
  const ny = ((b[0] - a[0]) / len) * (t / 2)
  return [[a[0] + nx, a[1] + ny], [a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]
}
const wall = (id: string, thickness: number, extra: Partial<Wall> = {}, y = 0): Wall => ({
  id,
  name: id,
  thickness,
  loadBearing: false,
  height: 3,
  footprint: [rect([0, y], [6, y], thickness)],
  ...extra,
})
const model = (walls: Wall[]): Model => ({
  schema: 'IFC4',
  siteName: '',
  buildingId: 'b',
  buildingName: '',
  storeys: [{ id: 's', name: '1F', elevation: 0, spaces: [], walls, openings: [], equipment: [] }],
  systems: [],
  connections: [],
  warnings: [],
})

describe('새 벽 두께 (OE-SPC-12)', () => {
  it('BIM 내벽 최빈 두께가 0.24m 인 층에서 새 벽을 그으면 0.24m 다. 외벽·더한 벽·두께 모르는 벽은 세지 않는다', () => {
    const m = model([
      wall('a', 0.2399, {}, 0),
      wall('b', 0.24, {}, 2),
      wall('c', 0.12, {}, 4),
      wall('ext1', 0.4, { external: true }, 6),
      wall('ext2', 0.4, { external: true }, 8),
      wall('ext3', 0.4, { external: true }, 10),
      wall('mine', 0.12, { added: true }, 12),
      wall('mine2', 0.12, { added: true }, 14),
      wall('unknown', 0, { thickness: null }, 16),
    ])
    expect(newWallThickness(m.storeys[0], 0.15)).toEqual({ thickness: 0.24, from: 'bim' })
    const made = addWall(m, 's', [0, 20], [4, 20], newWallThickness(m.storeys[0]).thickness) as Wall
    expect(made.thickness).toBe(0.24)
  })

  it('BIM 벽이 없고 사이트 기본값이 0.15m 이면 0.15m, 둘 다 없으면 0.2m 다', () => {
    const empty = model([wall('ext', 0.4, { external: true })])
    expect(newWallThickness(empty.storeys[0], 0.15)).toEqual({ thickness: 0.15, from: 'site' })
    expect(newWallThickness(empty.storeys[0], null)).toEqual({ thickness: 0.2, from: 'default' })
    expect(newWallThickness(model([]).storeys[0])).toEqual({ thickness: 0.2, from: 'default' })
  })

  it('같은 수면 두꺼운 쪽이고, 8cm 보다 얇은 마감벽·칸막이는 세지 않는다', () => {
    expect(newWallThickness(model([wall('a', 0.1, {}, 0), wall('b', 0.3, {}, 2)]).storeys[0]).thickness).toBe(0.3)
    // 병원 1층처럼 마감벽(0.05m)이 칸막이(0.12m)보다 많아도 칸막이 두께다.
    const furring = [0, 2, 4].map((y) => wall(`f${y}`, 0.05, {}, y))
    expect(newWallThickness(model([...furring, wall('p1', 0.12, {}, 6), wall('p2', 0.12, {}, 8)]).storeys[0])).toEqual({ thickness: 0.12, from: 'bim' })
    expect(newWallThickness(model(furring).storeys[0], null)).toEqual({ thickness: 0.2, from: 'default' })
  })
})

describe('문·창 스냅 거리 (OE-SPC-13)', () => {
  it('기본 0.6m 밖을 누르면 "벽 가까이 놓아 주세요" 로 거절하고, 스냅 거리를 늘리면 같은 자리에 붙는다', () => {
    const m = model([wall('w', 0.2)])
    expect(OPENING_SNAP).toBe(0.6)
    expect(addOpening(m, 's', 'door', [3, 1])).toEqual({ refused: '벽 가까이 놓아 주세요(벽에서 0.6m 안에만 놓습니다).' })
    const door = addOpening(m, 's', 'door', [3, 1], undefined, 1.2) as Opening
    expect(door.wallId).toBe('w')
  })

  it('스냅 거리를 줄이면 기본 거리 안이어도 거절한다. 벽을 모르는 문을 옮길 때도 같은 거리를 쓴다', () => {
    const m = model([wall('w', 0.2)])
    expect(addOpening(m, 's', 'window', [3, 0.4], undefined, 0.2)).toMatchObject({ refused: expect.stringContaining('0.2m') })
    const door = addOpening(m, 's', 'door', [3, 0.05]) as Opening
    door.wallId = null
    expect(moveOpening(m, door.id, [4, 0.5], { snap: 0.3 })).toMatchObject({ refused: expect.stringContaining('벽 가까이') })
    expect(moveOpening(m, door.id, [4, 0.5])).toBe(true)
  })
})
