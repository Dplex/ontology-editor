import { describe, expect, it } from 'vitest'
import { evaluateSuggestions, suggestKinds } from './kind-suggest'
import type { Connection, Equipment, Model } from './model'

// Revit 이름("패밀리:유형:요소ID")이라야 패밀리로 묶인다.
const eq = (id: string, family: string, kind: string | null, z: number, systemId = 'sa'): Equipment => ({
  id,
  name: `${family}:기본:${id.replace(/\D/g, '') || '1'}`,
  ifcClass: 'FlowTerminal',
  kind,
  role: 'terminal',
  position: [0, 0, z],
  capacity: null,
  capacityProperty: null,
  systemId,
  spaceId: null,
  spaceSource: null,
})
const duct = (id: string): Equipment => ({ ...eq(id, 'Duct', null, 2.9), ifcClass: 'FlowSegment', role: 'segment' })
const c = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })

function model(equipment: Equipment[], connections: Connection[]): Model {
  return {
    schema: 'IFC2X3',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [{ id: 's', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment }],
    systems: [{ id: 'sa', name: '급기', memberIds: [], source: 'ifc', kind: 'supply_air' }, { id: 'none', name: '위생', memberIds: [], source: 'ifc', kind: null }],
    connections,
    warnings: [],
  }
}

describe('종류 후보', () => {
  it('이름이 암호 같아도 같은 건물에서 계통·이웃·높이가 닮은 패밀리의 종류를 권한다', () => {
    const m = model(
      [
        // 종류를 아는 디퓨저: 급기 계통, 덕트 하나에 붙어 천장에.
        eq('d1', '라인디퓨저', 'air_diffuser', 2.8), duct('k1'),
        // 종류를 아는 조명: 계통 없이 천장에, 아무 데도 안 붙었다.
        { ...eq('l1', 'Troffer', 'lighting', 2.8), systemId: null },
        // 모르는 패밀리: 급기 계통, 덕트 하나에 붙어 천장에 — 디퓨저와 닮았다.
        eq('x1', 'SD-1200', null, 2.8), duct('k2'),
      ],
      [c('k1', 'd1'), c('k2', 'x1')],
    )
    const [first] = suggestKinds(m).get('family:FlowTerminal|SD-1200')!
    expect(first).toMatchObject({ kind: 'air_diffuser', why: { like: '라인디퓨저' } })
  })

  it('이름 사전이 읽지 않는 종류도 이름의 낱말로 후보에 올린다', () => {
    const m = model([eq('s1', 'M_Sprinkler - Pendent', null, 2.7, 'none'), eq('d1', '라인디퓨저', 'air_diffuser', 2.8)], [])
    expect(suggestKinds(m).get('family:FlowTerminal|M_Sprinkler - Pendent')![0]).toMatchObject({ kind: 'sprinkler', why: { name: 'sprinkler' } })
  })

  it('종류를 아는 패밀리를 하나씩 가리고 맞혀 본다', () => {
    const m = model(
      [eq('d1', 'DiffA', 'air_diffuser', 2.8), duct('k1'), eq('d2', 'DiffB', 'air_diffuser', 2.8), duct('k2'), { ...eq('l1', 'Troffer', 'lighting', 2.8), systemId: null }, { ...eq('l2', 'Downlight', 'lighting', 2.8), systemId: null }],
      [c('k1', 'd1'), c('k2', 'd2')],
    )
    expect(evaluateSuggestions(m)).toEqual({ families: 4, top1: 4, top3: 4 })
  })
})
