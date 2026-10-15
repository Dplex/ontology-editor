import { describe, expect, it } from 'vitest'
import { airServices } from './served'
import { spaceInfluence, spaceViewHidden, storeySpaces } from './space-view'
import type { Connection, Equipment, EquipmentRole, Model, Space } from './model'

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
const sp = (id: string, name: string, longName: string) => ({ id, name, longName }) as Space
const d = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })

// 공조기 → 덕트 → 디퓨저(회의실), 덕트 → FCU → 디퓨저(사무실). 회의실 그릴 → 환기 덕트 → 공조기.
const m: Model = {
  schema: 'IFC4',
  siteName: '',
  buildingId: 'b',
  buildingName: '',
  storeys: [
    {
      id: 's',
      name: '1F',
      elevation: 0,
      spaces: [sp('office', '102', '사무실'), sp('meeting', '101', '회의실'), sp('store', '110', '창고')],
      walls: [],
      openings: [],
      equipment: [
        eq('sa1', null, 'segment', 'meeting'),
        eq('diffA', 'air_diffuser', 'terminal', 'meeting'),
        eq('fcu', 'fcu', 'conversion', 'office'),
        eq('diffB', 'air_diffuser', 'terminal', 'office'),
        eq('grille', 'air_grille', 'terminal', 'meeting'),
        eq('ra', null, 'segment'),
      ],
    },
    { id: 'r', name: 'RF', elevation: 9, spaces: [], walls: [], openings: [], equipment: [eq('ahu', 'ahu', 'conversion')] },
  ],
  systems: [],
  connections: [d('ahu', 'sa1'), d('sa1', 'diffA'), d('sa1', 'fcu'), d('fcu', 'diffB'), d('grille', 'ra'), d('ra', 'ahu')],
  warnings: [],
}
const services = airServices(m, m.connections)

describe('공간 보기', () => {
  it('안에 있는 설비와, 이 방 말단에 닿는 공기 원천(다른 층이어도)을 급기·환기로 센다', () => {
    expect(spaceInfluence(m, 'meeting', services)).toEqual({
      inside: ['sa1', 'diffA', 'grille'],
      sources: [{ id: 'ahu', supply: 1, extract: 1 }],
    })
  })

  it('다른 원천 너머의 방은 그 원천 몫이다 — 사무실은 FCU 만, FCU 는 안에도 있다', () => {
    expect(spaceInfluence(m, 'office', services)).toEqual({ inside: ['fcu', 'diffB'], sources: [{ id: 'fcu', supply: 1, extract: 0 }] })
  })

  it('말단이 없는 방은 원천이 없다', () => {
    expect(spaceInfluence(m, 'store', services)).toEqual({ inside: [], sources: [] })
  })

  it('남길 것 밖의 설비를 모든 층에서 숨긴다', () => {
    expect([...spaceViewHidden(m, new Set(['sa1', 'diffA', 'ahu']))].sort()).toEqual(['diffB', 'fcu', 'grille', 'ra'])
  })

  it('층의 방 목록은 방번호 순이고 기기·덕트배관을 따로 센다', () => {
    const rows = storeySpaces(m, 's', (e) => e.role === 'segment')
    expect(rows.map((r) => [r.name, r.devices, r.conduits])).toEqual([
      ['101', 2, 1],
      ['102', 2, 0],
      ['110', 0, 0],
    ])
    expect(storeySpaces(m, 'nope', () => false)).toEqual([])
  })
})
