import { describe, expect, it } from 'vitest'
import { airBasis, airServices, needsSystem, servedSpaces, systemlessAir } from './served'
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

describe('VAV·말단의 계통과 담당 근거 (OE-EQP-10)', () => {
  // ahu → duct1 → vav → duct2 → diff1·diff2(급기), grille → duct3 → ahu(환기). 외부 루버는 방이 아니라 바깥과 통한다.
  const parts = () => [
    { ...eq('ahu', 'ahu', 'conversion'), systemId: 'SA' },
    eq('duct1', null, 'segment'),
    eq('vav', 'vav', 'control'),
    eq('duct2', null, 'segment'),
    { ...eq('diff1', 'air_diffuser', 'terminal', 'r1'), systemId: 'SA' },
    eq('diff2', 'air_diffuser', 'terminal', 'r2'),
    eq('grille', 'air_grille', 'terminal', 'r1'),
    eq('duct3', null, 'segment'),
    eq('louver', 'outdoor_louver', 'terminal'),
    eq('pump', 'pump', 'conversion'),
  ]
  const flows = [d('ahu', 'duct1'), d('duct1', 'vav'), d('vav', 'duct2'), d('duct2', 'diff1'), d('duct2', 'diff2'), d('grille', 'duct3'), d('duct3', 'ahu')]

  it('VAV 와 실내 말단만 계통이 있어야 한다 — 외부 루버·펌프·덕트는 아니다', () => {
    const byKind = Object.fromEntries(parts().map((e) => [e.id, needsSystem(e)]))
    expect(byKind).toMatchObject({ vav: true, diff1: true, grille: true, louver: false, pump: false, duct1: false, ahu: false })
  })

  it('계통 없는 VAV·말단을 고른다 — 계통을 주면 빠진다', () => {
    const m = model(parts(), flows)
    expect(systemlessAir(m).map((x) => x.equipment.id)).toEqual(['vav', 'diff2', 'grille'])
    for (const e of m.storeys[0].equipment) e.systemId = 'SA'
    expect(systemlessAir(m)).toEqual([])
  })

  it('담당 근거: 말단은 거슬러 올라 VAV 를 지나 공조기에 닿고, VAV 는 아래로 나눠 주는 말단을 안다', () => {
    const m = model(parts(), flows)
    expect(airBasis(m, flows, 'diff2')).toEqual({ supplyFrom: ['ahu'], extractTo: [], terminals: [] })
    expect(airBasis(m, flows, 'grille')).toEqual({ supplyFrom: [], extractTo: ['ahu'], terminals: [] })
    expect(airBasis(m, flows, 'vav')).toEqual({ supplyFrom: ['ahu'], extractTo: [], terminals: ['diff1', 'diff2'] })
    // 방향을 모르는 연결로는 담당을 말하지 않는다(추정을 근거로 쓰지 않는다 — 규칙 방향은 호출부가 펼쳐 넘긴다).
    const undirected = flows.map((c) => ({ ...c, directed: false }))
    expect(airBasis(m, undirected, 'diff2')).toEqual({ supplyFrom: [], extractTo: [], terminals: [] })
  })
})

