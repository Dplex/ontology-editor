import { describe, expect, it } from 'vitest'
import { completenessChecks, explainFailure, type Box } from './checks'
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

  it('어긴 것마다 왜 어겼는지 말한다', () => {
    const office: Space = { id: 'room', name: '101', longName: '사무실', footprint: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]], areaM2: 80, boundedBy: [] }
    const u = (from: string, to: string): Connection => ({ from, to, source: 'geometry', directed: false, tolerance: 0.005 })
    const m = model(
      [
        eq('ahu', 'ahu', 'conversion'),
        eq('fcu', 'fcu', 'conversion'),
        eq('shared', 'air_diffuser', 'terminal'),
        eq('cut', 'air_diffuser', 'terminal'),
        eq('orphan', 'air_diffuser', 'terminal'),
        { ...eq('outside', 'fcu', 'conversion', null), position: [10.3, 4, 2.7] },
        eq('nowhere', 'fcu', 'conversion', null),
        eq('duct', null, 'segment', null),
      ],
      [d('ahu', 'duct'), d('duct', 'shared'), d('fcu', 'shared'), u('duct', 'cut')],
      [office],
    )
    const boxes = new Map<string, Box>([
      ['orphan', [0, 0, 0, 1, 1, 1]],
      ['duct', [1.012, 0, 0, 2, 1, 1]],
    ])
    const ctx = { model: m, connections: m.connections, services: airServices(m, m.connections), boxes, label: (id: string) => id }
    expect(explainFailure('terminal-source', 'orphan', ctx)).toBe('연결이 하나도 없습니다.')
    expect(explainFailure('terminal-source', 'cut', ctx)).toContain('방향을 모르는 연결에서 끊깁니다')
    expect(explainFailure('terminal-single-source', 'shared', ctx)).toBe('원천 2대에서 받습니다: ahu, fcu')
    expect(explainFailure('device-space', 'outside', ctx)).toBe('어느 방에도 들어가지 않습니다. 가장 가까운 방은 사무실(0.30m)입니다.')
    expect(explainFailure('device-space', 'nowhere', ctx)).toContain('좌표가 없습니다')
    expect(explainFailure('device-connected', 'orphan', ctx)).toBe('가장 가까운 것: duct, 12mm 떨어져 있습니다. 5mm 안이어야 연결로 봅니다.')
  })
})
