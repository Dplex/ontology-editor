// 외벽 에디터(OE-EXT-03). 합성 3층: 동쪽 외벽이 1F(두께 0.3)·2F(두께 0.2, 바깥 면이 같다)에 쌓이고 3F 는 0.5m 물러나 있다.
// 북쪽 외벽은 두 층 다 내력벽, x=5 는 내벽, 1F 동쪽 밖 x 11~13 에 담장(X1). 1F 방은 동쪽 외벽 안 면까지, 동쪽 벽 바로 밖(10.3)에 설비가 하나 있다.
import { describe, expect, it } from 'vitest'
import { moveWall } from './edit'
import type { ExternalJudgement } from './exterior'
import { facadeOf, moveFacade } from './facade'
import { polygonArea, type Model, type Vec2, type Wall } from './model'

const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const wall = (id: string, ring: Vec2[], external: boolean, loadBearing = false): Wall =>
  ({ id, name: id, thickness: null, loadBearing, external, footprint: [ring] }) as unknown as Wall
const room = (id: string, footprint: Vec2[]) => ({ id, name: id, longName: id, footprint, areaM2: polygonArea(footprint), boundedBy: [] })
const model = (): Model =>
  ({
    schema: 'IFC4', siteName: '', buildingId: 'B', buildingName: '', systems: [], connections: [], warnings: [],
    storeys: [
      {
        id: 'S1', name: '1F', elevation: 0, openings: [],
        walls: [wall('E1', sq(9.85, 0, 10.15, 8), true), wall('N1', sq(0, 7.85, 10, 8.15), true, true), wall('I1', sq(4.9, 0, 5.1, 7.85), false), wall('X1', sq(11, 5.9, 13, 6.1), false)],
        spaces: [room('R1', sq(0, 0, 9.85, 7.85))],
        equipment: [{ id: 'FCU', name: 'FCU', position: [10.3, 4, 2], positionSource: 'bim', spaceId: null, spaceSource: 'calc' }],
      },
      {
        id: 'S2', name: '2F', elevation: 3, openings: [], equipment: [],
        walls: [wall('E2', sq(9.95, 0, 10.15, 8), true), wall('N2', sq(0, 7.85, 10, 8.15), true, true)],
        spaces: [room('R2', sq(0, 0, 9.95, 7.85))],
      },
      {
        id: 'S3', name: '3F', elevation: 6, openings: [], equipment: [], spaces: [],
        walls: [wall('E3', sq(9.35, 0, 9.65, 8), true)],
      },
    ],
  }) as unknown as Model
const judge = (m: Model) => new Map<string, ExternalJudgement>(m.storeys.flatMap((st) => st.walls.map((w) => [w.id, { external: !!w.external, source: 'bim' }] as const)))
const xs = (m: Model, wallId: string) => {
  const w = m.storeys.flatMap((st) => st.walls).find((x) => x.id === wallId)!
  return [...new Set(w.footprint![0].map((p) => +p[0].toFixed(6)))].sort((a, b) => a - b)
}

describe('외벽 에디터 (OE-EXT-03)', () => {
  it('외벽을 고르면 다른 층에서 같은 면에 쌓인 외벽을 묶는다 — 두께가 달라도 면이 맞으면 같고, 물러난 층·내벽은 뺀다', () => {
    const m = model()
    expect(facadeOf(m, judge(m), 'E2')).toEqual([{ id: 'E1', storeyId: 'S1' }, { id: 'E2', storeyId: 'S2' }])
    expect(facadeOf(m, judge(m), 'E3')).toEqual([{ id: 'E3', storeyId: 'S3' }])
    expect(facadeOf(m, judge(m), 'I1')).toBeNull()
  })

  it('외벽 에디터에서 옮기면 묶인 층의 외벽이 모두 새 자리에 있고, 방 변이 따라가 설비 소속이 다시 잡힌다 [OE-EXT-03#1~]', () => {
    const m = model()
    // 층 편집 화면에서는 외벽이 잠겨 있다(OE-EXT-02).
    expect(moveWall(m, 'E1', [0.5, 0])).toBe(false)
    const group = facadeOf(m, judge(m), 'E1')!.map((x) => x.id)
    const done = moveFacade(m, group, [0.5, 0], true)
    expect('refused' in done).toBe(false)
    if ('refused' in done) return
    expect([done.moved, done.kept]).toEqual([2, []])
    expect(xs(m, 'E1')).toEqual([10.35, 10.65])
    expect(xs(m, 'E2')).toEqual([10.45, 10.65])
    expect(xs(m, 'E3')).toEqual([9.35, 9.65])
    // 1F·2F 방 동쪽 변이 따라갔고, 1F 벽 밖에 있던 설비가 방 안에 들었다(재매핑, OE-MAP-01).
    expect(done.changes.map((c) => [c.spaceId, +(c.toAreaM2 - c.fromAreaM2).toFixed(3)])).toEqual([['R1', 3.925], ['R2', 3.925]])
    expect(m.storeys[0].equipment[0].spaceId).toBe('R1')
    expect(done.changes.flatMap((c) => c.equipment).map((e) => e.equipmentId)).toEqual(['FCU'])
  })

  it('내력벽은 제자리에 두고 나머지만 옮기며, 다 내력이거나 하나라도 다른 벽을 가로지르면 아무것도 옮기지 않는다', () => {
    const m = model()
    const north = facadeOf(m, judge(m), 'N1')!.map((x) => x.id)
    expect(north).toEqual(['N1', 'N2'])
    expect(moveFacade(m, north, [0, 0.5], true)).toEqual({ refused: '이 면의 외벽이 모두 내력벽이라 옮기지 않습니다(내력벽은 값이 있으면 고치지 않습니다)' })
    // 2F 북쪽 벽만 내력을 풀면 2F 만 옮기고 1F 는 남았다고 알린다.
    m.storeys[1].walls[1].loadBearing = false
    const half = moveFacade(m, north, [0, 0.1], false)
    expect(half).toMatchObject({ moved: 1, kept: ['1F'] })
    // 동쪽 면을 동쪽으로 1.5m 밀면 1F 에서 담장(X1)을 가로지른다 — 2F 는 혼자 옮길 수 있어도 옮기지 않는다.
    const before = xs(m, 'E2')
    const crossing = moveFacade(m, ['E1', 'E2'], [1.5, 0], false)
    expect(crossing).toEqual({ refused: '1F 에서 X1을 가로지르게 되어 옮기지 않습니다' })
    expect(xs(m, 'E2')).toEqual(before)
  })
})
