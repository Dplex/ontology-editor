import { describe, expect, it } from 'vitest'
import { checklistContext, spaceChecklist, storeyChecklists, type SpaceChecklist } from './space-checklist'
import { modelToTTL } from './export/ttl'
import type { Connection, Equipment, EquipmentRole, Model, Space } from './model'

const eq = (id: string, kind: string | null, role: EquipmentRole | null, spaceId: string | null, at: [number, number] | null = null, systemId: string | null = 'sys'): Equipment => ({
  id,
  name: id,
  ifcClass: 'X',
  kind,
  role,
  position: at ? [at[0], at[1], 0] : null,
  capacity: null,
  capacityProperty: null,
  systemId,
  spaceId,
  spaceSource: null,
})
const box = (x: number, y: number) => [[x, y], [x + 4, y], [x + 4, y + 4], [x, y + 4], [x, y]] as Space['footprint']
const sp = (id: string, name: string, longName: string, x: number, kind: string | null = null): Space => ({ id, name, longName, footprint: box(x, 0), areaM2: 16, boundedBy: [], kind, kindSource: kind ? 'dict' : undefined })
const port = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })
/** 포트가 방향을 말하지 않아 규칙으로만 정한 연결. */
const ruled = (from: string, to: string, confirmed: boolean): Connection => ({ from, to, source: 'port', directed: false, tolerance: null, inferred: { from, to, systemId: 'sys', confirmed } })

// 1F: 회의실(포트 방향으로 급기) · 사무실(규칙 방향으로만 급기) · 화장실(환기만) · 계단실 · 같은 방번호 둘.
function building(confirmed = false): Model {
  return {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      {
        id: 's',
        name: '1F',
        elevation: 0,
        spaces: [sp('meet', '101', '회의실', 0, 'conference'), sp('office', '102', '사무실', 5), sp('wc', '103', '화장실', 10, 'restroom'), sp('stair', '104', '', 15, 'staircase'), sp('dup', '102', '창고', 20)],
        walls: [],
        openings: [],
        equipment: [
          eq('ahu', 'ahu', 'conversion', null, [30, 30]),
          eq('sa', null, 'segment', null),
          eq('d1', 'air_diffuser', 'terminal', 'meet', [1, 1]),
          eq('d2', 'air_diffuser', 'terminal', 'office', [6, 1]),
          eq('g1', 'air_grille', 'terminal', 'wc', [11, 1]),
          eq('vav', 'vav', 'control', 'meet', [2, 2], null),
          // 회의실 경계 0.3m 밖, 소속 없음.
          eq('lost', 'fcu', 'conversion', null, [4.3, 2]),
        ],
      },
    ],
    systems: [],
    connections: [port('ahu', 'sa'), port('sa', 'd1'), ruled('sa', 'd2', confirmed), port('g1', 'ahu')],
    warnings: [],
  }
}
const byKey = (c: SpaceChecklist) => Object.fromEntries(c.items.map((x) => [x.key, x.state]))

describe('방별 체크리스트', () => {
  const m = building()
  const lists = storeyChecklists(m.storeys[0], checklistContext(m))

  it('회의실: 포트 방향 급기는 TTL 에 나가 채움, 계통 없는 VAV 와 경계 밖 미소속 FCU 는 빔', () => {
    const c = lists.get('meet')!
    expect(byKey(c)).toEqual({ outline: 'ok', label: 'ok', number: 'ok', kind: 'ok', unplaced: 'empty', terminalSource: 'ok', supplyTtl: 'ok', system: 'empty', zone: 'na' })
    expect(c.items.find((x) => x.key === 'unplaced')!.ids).toEqual(['lost'])
    expect(c.items.find((x) => x.key === 'system')!.ids).toEqual(['vav'])
    expect([c.have, c.of]).toEqual([6, 8])
  })

  it('사무실: 규칙 방향으로만 닿는 급기는 빔이고 화면에서 닿는 원천을 준다 — 확정하면 채움이다 [B 1안]', () => {
    const c = lists.get('office')!
    const supply = c.items.find((x) => x.key === 'supplyTtl')!
    expect(supply.state).toBe('empty')
    expect(supply.ids).toEqual(['ahu'])
    expect(byKey(c).kind).toBe('empty')
    const after = building(true)
    expect(byKey(storeyChecklists(after.storeys[0], checklistContext(after)).get('office')!).supplyTtl).toBe('ok')
    // TTL 과 같은 기준이다 — 확정하면 원천이 그 방을 feeds 한다.
    expect(modelToTTL(after)).toMatch(/brick:feeds[^.]*ex:office/)
    expect(modelToTTL(m)).not.toMatch(/brick:feeds[^.]*ex:office/)
  })

  it('환기 그릴만 있는 화장실은 급기가 해당 없음, 계단실은 공조존이 해당 없음, 같은 방번호는 빔', () => {
    expect(byKey(lists.get('wc')!).supplyTtl).toBe('na')
    expect(byKey(lists.get('wc')!).terminalSource).toBe('ok')
    expect(byKey(lists.get('dup')!).number).toBe('empty')
    expect(byKey(lists.get('office')!).number).toBe('empty')
    expect(byKey(lists.get('stair')!).label).toBe('empty')
    const zoned: Model = { ...m, storeys: [{ ...m.storeys[0], hvacZones: [{ id: 'z', name: 'Z1', spaceIds: ['meet'], source: 'edit' } as never] }] }
    const z = storeyChecklists(zoned.storeys[0], checklistContext(zoned))
    expect(byKey(z.get('meet')!).zone).toBe('ok')
    expect(byKey(z.get('office')!).zone).toBe('empty')
    expect(byKey(z.get('stair')!).zone).toBe('na')
  })

  it('외곽선이 없으면 빔이고 경계 근처 판정은 해당 없음이다', () => {
    const st = m.storeys[0]
    const c = spaceChecklist(st, { ...st.spaces[0], footprint: [] }, checklistContext(m))
    expect(byKey(c).outline).toBe('empty')
    expect(byKey(c).unplaced).toBe('na')
  })
})
