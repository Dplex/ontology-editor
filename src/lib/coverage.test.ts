import { describe, expect, it } from 'vitest'
import { featureCoverage } from './coverage'
import type { Connection, Equipment, Model, Space } from './model'

const eq = (id: string, extra: Partial<Equipment> = {}): Equipment => ({
  id,
  name: id,
  ifcClass: 'X',
  kind: null,
  role: 'terminal',
  position: [1, 1, 1],
  capacity: null,
  capacityProperty: null,
  systemId: null,
  spaceId: null,
  spaceSource: null,
  ...extra,
})
const room = (id: string, longName: string, footprint = true): Space => ({
  id,
  name: id,
  longName,
  footprint: footprint ? [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]] : [],
  areaM2: 16,
  boundedBy: [],
})

describe('featureCoverage — 피처마다 누가 채웠나', () => {
  it('BIM · 계산 · 사전 · 비어 있음을 가르고, BIM 밖 피처는 따로 표시한다', () => {
    const port = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })
    const model: Model = {
      schema: 'IFC2X3',
      siteName: '',
      buildingId: 'b',
      buildingName: '',
      storeys: [
        {
          id: 's',
          name: '1F',
          elevation: 0,
          // 이름 있는 방, 기본 이름("공간") 방, 외곽선 없는 방.
          spaces: [room('r1', '사무실'), room('r2', '공간'), room('r3', '창고', false)],
          walls: [],
          openings: [],
          equipment: [
            eq('ahu', { kind: 'ahu', kindSource: 'bim', role: 'conversion', spaceId: 'r1', spaceSource: 'bim', systemId: 'sa' }),
            eq('fcu', { kind: 'fcu', kindSource: 'dict', role: 'conversion', spaceId: 'r1', spaceSource: 'computed', positionSource: 'geometry' }),
            eq('box', { position: null }),
          ],
        },
      ],
      systems: [{ id: 'sa', name: '급기 1', memberIds: ['ahu'], source: 'ifc', kind: 'supply_air', kindSource: 'dict' }],
      connections: [port('ahu', 'fcu')],
      warnings: [],
    }
    const by = Object.fromEntries(featureCoverage(model).map((c) => [c.key, c]))
    expect(by.F2).toMatchObject({ of: 3, bim: 2, missing: 1 })
    expect(by.F3).toMatchObject({ of: 3, bim: 2, missing: 1 })
    expect(by.F8).toMatchObject({ of: 3, bim: 1, dict: 1, missing: 1 })
    expect(by.F9).toMatchObject({ of: 3, bim: 1, calc: 1, missing: 1 })
    expect(by.F10).toMatchObject({ of: 3, bim: 1, missing: 2 })
    expect(by['F10+']).toMatchObject({ of: 1, dict: 1 })
    expect(by.F11).toMatchObject({ of: 3, bim: 1, calc: 1, missing: 1 })
    expect(by.F16).toMatchObject({ bim: 2, missing: 0 })
    expect(by.F12.outside).toBe('IDF')
    expect(by.F13.outside).toBe('BAS')
  })

  it('분전반 자리에 놓은 부품(OE-BIM-07)은 BIM 좌표가 아니라 계산이다', () => {
    const model: Model = {
      schema: 'IFC4',
      siteName: '',
      buildingId: 'b',
      buildingName: '',
      storeys: [{ id: 's', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [eq('mb01'), eq('f1', { positionSource: 'panel' })] }],
      systems: [],
      connections: [],
      warnings: [],
    }
    const f9 = featureCoverage(model).find((c) => c.key === 'F9')!
    expect(f9).toMatchObject({ of: 2, bim: 1, calc: 1, missing: 0 })
  })
})
