import { describe, expect, it } from 'vitest'
import { addEquipment } from '../edit'
import type { Model, Vec2 } from '../model'
import { buildCompare } from './compare'

// 결과 비교 판(ADR-0061)이 보일 것: 지금 모델을 내보낸 TTL·층 GeoJSON 을 받는 쪽 규칙으로 다시 읽은 것. 층은 id 로 짝짓는다.
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]

describe('결과 비교 판의 읽기', () => {
  it('층마다 받는 쪽이 읽은 GeoJSON 을 층 id 와 짝짓고, TTL 주어와 feature 가 같은 id 이며, 이름이 같은 층도 갈린다', () => {
    const model: Model = {
      schema: 'IFC4',
      siteName: '',
      buildingId: 'b',
      buildingName: '',
      storeys: [
        { id: 's1', name: '1F', elevation: 0, spaces: [{ id: 'room1', name: '101', longName: '회의실', footprint: rect(0, 0, 5, 4), areaM2: 20, boundedBy: [] }], walls: [], openings: [], equipment: [] },
        { id: 's2', name: '1F', elevation: 3, spaces: [], walls: [], openings: [], equipment: [] },
      ],
      systems: [],
      connections: [],
      warnings: [],
    }
    addEquipment(model, 's1', { name: 'FCU-1', kind: 'fcu', position: [2, 2, 2.7], id: 'fcu1' })
    const r = buildCompare(model)
    expect(r.floors.map((f) => [f.storeyId, f.floor.fileName])).toEqual([
      ['s1', 'floor-1F.geojson'],
      ['s2', 'floor-1F-2.geojson'],
    ])
    const fcu = r.ttl.entities.find((e) => e.key === 'fcu1')!
    expect(fcu.label).toBe('FCU-1')
    expect(fcu.locations).toEqual(['room1'])
    expect(fcu.source).toContain('ex:fcu1 a brick:')
    const feature = r.floors[0].floor.features.find((f) => f.id === 'fcu1')!
    expect(feature.properties.kind).toBe('equipment')
    expect(feature.properties.spaceSource).toBe('calc')
    expect(r.floors[0].floor.problems).toEqual([])
  })
})
