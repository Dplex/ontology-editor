// 오른쪽 패널의 현재 층 현황(OE-UI-04 ③).
import { describe, expect, it } from 'vitest'
import type { Model } from './model'
import { floorSummary } from './floor-summary'

const eq = (id: string, kind: string | null, position: [number, number, number] | null = [0, 0, 0], role = 'terminal') => ({ id, name: id, kind, position, role })
const model = {
  storeys: [
    {
      id: '1F',
      spaces: [{ id: 'S1', name: '101', longName: '사무실' }],
      walls: [{ id: 'W1' }, { id: 'W2' }],
      openings: [{ kind: 'door' }, { kind: 'window' }, { kind: 'window' }],
      equipment: [eq('A', '디퓨저'), eq('B', '디퓨저'), eq('C', null, null), eq('D', null, [0, 0, 0], 'segment')],
      rooms: [{ id: 'R1', name: '룸 1' }],
      customZones: [{ id: 'C1', name: '임원석' }],
      hvacZones: [{ id: 'H1', name: 'AHU-1 존' }],
      spaceObjects: [{ name: '책상' }, { name: '책상' }, { name: '의자' }],
    },
    { id: '2F', spaces: [{ id: 'S2', name: '201', longName: '' }], walls: [], openings: [], equipment: [eq('E', '공조기')] },
  ],
} as unknown as Model

describe('현재 층 현황 (OE-UI-04)', () => {
  it('고른 층의 공간 구성·설비 종류별 수·미배치·공간 오브젝트를 센다 [OE-UI-04#9~]', () => {
    const s = floorSummary(model, ['1F'], (e) => e.kind ?? null)
    expect(s.spaces).toEqual([{ id: 'S1', name: '101 사무실' }])
    expect([s.rooms.length, s.customZones.length, s.hvacZones.length]).toEqual([1, 1, 1])
    // 덕트·배관(D)은 설비로 세지 않는다.
    expect(s.equipment).toEqual([{ label: '디퓨저', count: 2 }, { label: '종류 모름', count: 1 }])
    expect([s.equipmentTotal, s.unplaced]).toEqual([3, 1])
    expect(s.objects).toEqual([{ label: '벽', count: 2 }, { label: '문', count: 1 }, { label: '창', count: 2 }, { label: '책상', count: 2 }, { label: '의자', count: 1 }])
  })

  it('모든 층이면 전부 더한다', () => {
    const s = floorSummary(model, null, (e) => e.kind ?? null)
    expect(s.spaces.map((x) => x.id)).toEqual(['S1', 'S2'])
    expect(s.equipmentTotal).toBe(4)
  })
})
