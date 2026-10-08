import { describe, expect, it } from 'vitest'
import { diagnoseFailure, type Box } from './checks'
import { connectCandidates, isFlowless, mediaOf } from './connect-candidates'
import { releaseConnection } from './connection-release'
import { airServices } from './served'
import type { Connection, Equipment, EquipmentRole, Model } from './model'

const eq = (id: string, kind: string | null, role: EquipmentRole | null, extra: Partial<Equipment> = {}): Equipment => ({
  id,
  name: id,
  ifcClass: 'X',
  kind,
  role,
  position: null,
  capacity: null,
  capacityProperty: null,
  spaceId: null,
  spaceSource: null,
  systemId: null,
  ...extra,
})
const port = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })

function model(equipment: Equipment[], connections: Connection[]): Model {
  return {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [{ id: 's', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment }],
    systems: [
      { id: 'sa', name: '급기 1', memberIds: [], source: 'ifc', kind: 'supply_air' },
      { id: 'ea', name: '배기 1', memberIds: [], source: 'ifc', kind: 'exhaust_air' },
    ],
    connections,
    warnings: [],
  } as Model
}
/** x 축으로 `gap` 미터 떨어진 1m 상자. 고칠 대상은 [0,1] 에 있다. */
const at = (gap: number): Box => [1 + gap, 0, 0, 2 + gap, 1, 1]

/**
 * 공조기에 덕트로 붙어 있다가 해제 보정한 디퓨저 하나(orphan). 그 둘레 1m 안에 후보가 될 수 없는 것들과 될 수 있는 덕트 하나가 있다.
 */
function scene() {
  const m = model(
    [
      eq('orphan', 'air_diffuser', 'terminal', { systemId: 'sa' }),
      eq('bim', null, 'segment', { ifcClass: 'DuctSegment', systemId: 'sa' }),
      eq('pipe', null, 'segment', { ifcClass: 'PipeSegment' }),
      eq('lamp', 'lighting', 'terminal'),
      eq('grille', 'air_diffuser', 'terminal'),
      eq('exhaust', null, 'segment', { ifcClass: 'DuctSegment', systemId: 'ea' }),
      eq('duct', null, 'segment', { ifcClass: 'DuctSegment', systemId: 'sa' }),
    ],
    [port('bim', 'orphan')],
  )
  releaseConnection(m, m.connections[0], '현장에서 철거')
  const boxes = new Map<string, Box>([
    ['orphan', [0, 0, 0, 1, 1, 1]],
    ['bim', at(0.001)],
    ['pipe', at(0.005)],
    ['lamp', at(0.002)],
    ['grille', at(0.003)],
    ['exhaust', at(0.004)],
    ['duct', at(0.012)],
  ])
  return { m, boxes }
}

describe('연결 후보 (OE-PIP-08)', () => {
  it('가까워도 다른 매체·흐름 없는 기기·말단끼리·다른 계통·해제한 연결은 빼고, 남은 것을 거리·계통·매체와 함께 준다', () => {
    const { m, boxes } = scene()
    const found = connectCandidates(m, 'orphan', boxes)
    expect(found.media).toEqual(['air'])
    expect(found.candidates).toEqual([{ id: 'duct', distance: expect.closeTo(0.012, 6), system: '급기 1', media: ['air'] }])
    expect(found.excluded).toEqual({ medium: 1, flowless: 1, terminal: 1, system: 1, released: 1 })
  })

  it('위반 이유에 의도한 해제와 뺀 후보를 말하고, 남은 후보로 고치기를 권한다', () => {
    const { m, boxes } = scene()
    const ctx = { model: m, connections: m.connections, services: airServices(m, m.connections), boxes, label: (id: string) => id }
    expect(diagnoseFailure('device-connected', 'orphan', ctx)).toEqual({
      text:
        '해제 보정한 BIM 연결 1개가 있습니다(의도한 해제라 되살리지 않습니다). 가장 가까운 것: duct, 12mm 떨어져 있습니다. 5mm 안이어야 연결로 봅니다. ' +
        '가까워도 후보에서 뺀 것: 다른 매체 1 · 흐름 없는 기기 1 · 말단끼리 1 · 다른 계통 1 · 해제 보정한 연결 1.',
      fix: { kind: 'connect', other: 'duct' },
    })
  })

  it('맞는 후보가 없으면 고치기를 권하지 않고 수동 검토 길을 말한다', () => {
    const { m, boxes } = scene()
    boxes.delete('duct')
    const ctx = { model: m, connections: m.connections, services: airServices(m, m.connections), boxes, label: (id: string) => id }
    const out = diagnoseFailure('device-connected', 'orphan', ctx)
    expect(out.fix).toBeUndefined()
    expect(out.text).toContain('1m 안에 이어질 덕트·배관·설비가 없습니다')
    expect(out.text).toContain('직접 확인한 뒤 설비 패널의 [연결하기]로 잇습니다')
  })

  it('흐름 없는 기기는 종류를 아는 것만이다. 종류를 모르는 설비와 냉매 설비(실외기)는 흐름 없다고 단정하지 않는다', () => {
    expect(isFlowless(eq('a', 'lighting', 'terminal'))).toBe(true)
    expect(isFlowless(eq('b', 'smoke_detector', 'sensing'))).toBe(true)
    expect(isFlowless(eq('c', null, null))).toBe(false)
    expect(isFlowless(eq('d', 'outdoor_unit', 'conversion'))).toBe(false)
  })

  it('매체는 종류의 흐름·계통 종류·유형 이름·IFC 클래스에서 모으고, 모르면 매체로 거르지 않는다', () => {
    const m = model([], [])
    expect(mediaOf(m, eq('ahu', 'ahu', 'conversion')).sort()).toEqual(['air', 'water'])
    expect(mediaOf(m, eq('p', null, 'segment', { ifcClass: 'PipeFitting' }))).toEqual(['water'])
    expect(mediaOf(m, eq('n', null, 'segment', { name: '직사각형 덕트:SA_급기' }))).toEqual(['air'])
    expect(mediaOf(m, eq('x', null, 'segment'))).toEqual([])
    const unknown = model([eq('o', null, 'segment'), eq('pipe', null, 'segment', { ifcClass: 'PipeSegment' })], [])
    expect(connectCandidates(unknown, 'o', new Map<string, Box>([['o', [0, 0, 0, 1, 1, 1]], ['pipe', at(0.01)]])).candidates.map((c) => c.id)).toEqual(['pipe'])
  })
})
