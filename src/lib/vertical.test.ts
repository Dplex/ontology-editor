import { describe, expect, it } from 'vitest'
import { modelToGeoJSON } from './export/geojson'
import type { Model, Space, Storey, Vec2 } from './model'
import { verticalLinks } from './vertical'

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const space = (id: string, kind: string | null, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: 0, boundedBy: [], kind })
const storey = (id: string, elevation: number, spaces: Space[]): Storey => ({ id, name: id, elevation, spaces, walls: [], openings: [], equipment: [] })
const model = (storeys: Storey[]): Model => ({ schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys, systems: [], connections: [], warnings: [] })

describe('층 사이 연결', () => {
  it('바로 위층에서 절반 넘게 겹치는 같은 종류의 방과 잇는다', () => {
    const m = model([
      // 층 순서가 뒤섞여 들어와도 높이로 줄 세운다.
      storey('2F', 3, [space('stair2', 'staircase', rect(0.2, 0, 3.2, 5)), space('ev2', 'elevator_shaft', rect(10, 0, 12, 2))]),
      storey('1F', 0, [
        space('stair1', 'staircase', rect(0, 0, 3, 5)),
        space('ev1', 'elevator_shaft', rect(10, 0, 12, 2)),
        // 자리는 겹치지만 종류를 모르는 방은 잇지 않는다.
        space('lobby', null, rect(0, 0, 3, 5)),
      ]),
      storey('3F', 6, [
        // 반만 걸친 계단실(겹친 넓이가 작은 쪽의 절반 이하)은 다른 통로다.
        space('stair3', 'staircase', rect(1.7, 0, 4.7, 5)),
      ]),
    ])
    const links = verticalLinks(m)
    expect(Object.fromEntries(links)).toEqual({ stair1: ['stair2'], stair2: ['stair1'], ev1: ['ev2'], ev2: ['ev1'] })
  })

  it('GeoJSON 의 계단실·승강로 feature 에 이어진 방을 적는다', () => {
    const m = model([
      storey('1F', 0, [space('stair1', 'staircase', rect(0, 0, 3, 5)), space('office', 'office', rect(5, 0, 9, 5))]),
      storey('2F', 3, [space('stair2', 'staircase', rect(0, 0, 3, 5))]),
    ])
    const first = modelToGeoJSON(m)[0].collection.features
    expect(first.find((f) => f.id === 'stair1')!.properties.verticalConnects).toEqual(['stair2'])
    expect(first.find((f) => f.id === 'office')!.properties).not.toHaveProperty('verticalConnects')
  })
})
