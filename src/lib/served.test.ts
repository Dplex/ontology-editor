import { describe, expect, it } from 'vitest'
import { airServices, servedSpaces } from './served'
import type { Connection, Equipment, EquipmentRole, Model } from './model'

const eq = (id: string, kind: string | null, role: EquipmentRole | null, spaceId: string | null = null): Equipment => ({
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
const u = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: false, tolerance: null })

function model(equipment: Equipment[], connections: Connection[]): Model {
  return {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [{ id: 's', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment }],
    systems: [],
    connections,
    warnings: [],
  }
}

describe('담당 공간', () => {
  // 공조기 → 덕트 → 댐퍼 → 덕트 → 디퓨저(회의실), 덕트 → FCU → 디퓨저(사무실).
  // 회의실 그릴 → 환기 덕트 → 공조기. 외부 루버는 방이 아니다.
  const m = model(
    [
      eq('ahu', 'ahu', 'conversion'),
      eq('sa1', null, 'segment'),
      eq('damper', 'damper', 'control'),
      eq('sa2', null, 'segment'),
      eq('diffA', 'air_diffuser', 'terminal', 'meeting'),
      eq('fcu', 'fcu', 'conversion'),
      eq('diffB', 'air_diffuser', 'terminal', 'office'),
      eq('grille', 'air_grille', 'terminal', 'meeting'),
      eq('ra', null, 'segment'),
      eq('louver', 'outdoor_louver', 'terminal'),
      eq('orphan', 'air_diffuser', 'terminal'),
    ],
    [
      d('ahu', 'sa1'),
      d('sa1', 'damper'),
      d('damper', 'sa2'),
      d('sa2', 'diffA'),
      d('sa1', 'fcu'),
      d('fcu', 'diffB'),
      d('grille', 'ra'),
      d('ra', 'ahu'),
      d('louver', 'ahu'),
      u('sa2', 'orphan'), // 방향을 모르는 연결은 따라가지 않는다
    ],
  )
  const services = new Map(airServices(m, m.connections).map((s) => [s.sourceId, s]))

  it('급기는 하류로, 환기는 상류로 말단까지 가고, 다른 원천 너머는 세지 않는다', () => {
    expect(services.get('ahu')).toEqual({ sourceId: 'ahu', supply: ['diffA'], extract: ['grille'] })
    expect(services.get('fcu')).toEqual({ sourceId: 'fcu', supply: ['diffB'], extract: [] })
  })

  it('말단의 방으로 묶고, 방이 없는 말단은 따로 센다', () => {
    expect(servedSpaces(m, services.get('ahu')!)).toEqual([{ spaceId: 'meeting', supply: 1, extract: 1 }])
    const noRoom = model([eq('fcu', 'fcu', 'conversion'), eq('t', 'air_diffuser', 'terminal')], [d('fcu', 't')])
    const [s] = airServices(noRoom, noRoom.connections)
    expect(servedSpaces(noRoom, s)).toEqual([{ spaceId: null, supply: 1, extract: 0 }])
  })
})
