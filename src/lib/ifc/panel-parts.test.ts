import { describe, expect, it } from 'vitest'
import { placeInPanels } from './import'
import type { Equipment, Storey } from '../model'

// OE-BIM-07 좌표 없는 분전반 부품(2026-10-03 사용자 결정): 같은 층에 **좌표 있는** 분전반이 하나뿐일 때만 그 자리에 놓는다.
// ifc4Mep 는 분전반이 다 좌표가 있어 "좌표 없는 분전반" 경우를 손으로 만든다.
const device = (id: string, ifcClass: string, position: Equipment['position'], kind: string | null = null): Equipment =>
  ({ id, name: id, ifcClass, kind, role: null, position, spaceId: null, systemId: null }) as Equipment
const storey = (equipment: Equipment[]): Storey => ({ id: 's', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment })

describe('분전반 자리에 놓기 (OE-BIM-07)', () => {
  it('좌표 없는 분전반은 세지 않는다 — 좌표 있는 분전반이 하나면 그 자리', () => {
    const st = storey([device('MB01', 'ElectricDistributionBoard', [1, 2, 0]), device('MB02', 'ElectricDistributionBoard', null), device('F1', 'ProtectiveDevice', null)])
    expect(placeInPanels([st])).toBe(1)
    expect(st.equipment[2]).toMatchObject({ position: [1, 2, 0], positionSource: 'panel' })
  })

  it('좌표 있는 분전반이 없으면 놓지 않는다', () => {
    const st = storey([device('MB02', 'ElectricDistributionBoard', null), device('F1', 'ProtectiveDevice', null)])
    expect(placeInPanels([st])).toBe(0)
    expect(st.equipment[1].position).toBeNull()
  })

  it('이름으로 분전반인 것(kind)도 분전반이다. 분전반이 둘이면 놓지 않는다', () => {
    const one = storey([device('P1', 'BuildingElementProxy', [5, 5, 0], 'panel'), device('F1', 'ProtectiveDeviceTrippingUnit', null)])
    expect(placeInPanels([one])).toBe(1)
    const two = storey([device('P1', 'BuildingElementProxy', [5, 5, 0], 'panel'), device('MB01', 'ElectricDistributionBoard', [0, 0, 0]), device('F1', 'ProtectiveDevice', null)])
    expect(placeInPanels([two])).toBe(0)
  })
})
