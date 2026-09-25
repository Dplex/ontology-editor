import { describe, expect, it } from 'vitest'
import { completenessChecks } from './checks'
import { airServices } from './served'
import type { Connection, Equipment, EquipmentRole, Model, Space } from './model'

const eq = (id: string, kind: string | null, role: EquipmentRole | null, spaceId: string | null = 'room'): Equipment => ({
  id,
  name: id,
  ifcClass: 'X',
  kind,
  role,
  position: null,
  capacity: null,
  capacityProperty: null,
  systemId: null,
  spaceId,
  spaceSource: null,
})
const d = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })
const room: Space = { id: 'room', name: '101', longName: '사무실', footprint: [], areaM2: 0, boundedBy: [] }

function model(equipment: Equipment[], connections: Connection[], spaces = [room]): Model {
  return {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [{ id: 's', name: '1F', elevation: 0, spaces, walls: [], openings: [], equipment }],
    systems: [],
    connections,
    warnings: [],
  }
}

const failed = (m: Model) =>
  Object.fromEntries(completenessChecks(m, airServices(m, m.connections)).map((c) => [c.key, c.skipped ?? c.failed]))

describe('완전성 검사', () => {
  it('원천에 닿지 않는 말단, 말단에 닿지 않는 원천, 두 원천에서 받는 말단을 가려낸다', () => {
    const m = model(
      [
        eq('ahu', 'ahu', 'conversion'),
        eq('fcu', 'fcu', 'conversion'),
        eq('lonely', 'fcu', 'conversion'),
        eq('shared', 'air_diffuser', 'terminal'),
        eq('orphan', 'air_diffuser', 'terminal'),
        eq('lamp', 'lighting', 'terminal'), // 흐름이 없는 기기는 연결 검사에서 뺀다
        eq('duct', null, 'segment', null), // 덕트·배관은 기기가 아니다
      ],
      [d('ahu', 'duct'), d('duct', 'shared'), d('fcu', 'shared')],
    )
    expect(failed(m)).toMatchObject({
      'terminal-source': ['orphan'],
      'source-terminal': ['lonely'],
      'terminal-single-source': ['shared'],
      'device-space': [],
      'device-connected': ['lonely', 'orphan'],
    })
  })

  it('방이 없는 파일에서는 소속 검사를 건너뛰고 이유를 말한다', () => {
    const m = model([eq('fcu', 'fcu', 'conversion', null)], [], [])
    expect(failed(m)['device-space']).toBe('방이 없는 파일입니다. 건축 파일을 덧붙이면 검사할 수 있습니다.')
  })
})
