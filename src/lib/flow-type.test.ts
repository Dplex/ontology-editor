// Flow Type 색(OE-OBJ-12). 색 값은 glossary "Flow Type" 표의 "색 (UX v0.9)" 칸이 정본이다 — PM 이 미정인 색을 더하면 여기서 걸려 코드도 맞춘다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { setSystemKind } from './edit'
import { conduitFlowType, FLOW_TYPES, flowTypeColor, setConduitFlowType, systemFlowType } from './flow-type'
import { equipmentColor, PICK_COLORS, systemColors } from './viewer'
import type { Equipment, Model } from './model'

/** glossary 표에서 코드 → 색(`#RRGGBB` 또는 null=미정). */
function glossaryColors(): Map<string, string | null> {
  const md = readFileSync(fileURLToPath(new URL('../../docs/prd/glossary.md', import.meta.url)), 'utf8')
  const section = md.slice(md.indexOf('### Flow Type'), md.indexOf('### 계통도'))
  const rows = new Map<string, string | null>()
  for (const line of section.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim())
    if (cells.length < 6 || !/^[A-Z]+$/.test(cells[2])) continue
    const hex = /`(#[0-9A-Fa-f]{6})`/.exec(cells[4])?.[1] ?? null
    rows.set(cells[2], hex ? hex.toUpperCase() : null)
  }
  return rows
}

const eq = (id: string, role: Equipment['role'], systemId: string | null, extra: Partial<Equipment> = {}): Equipment =>
  ({ id, name: id, ifcClass: 'X', role, position: null, capacity: null, systemId, spaceId: null, spaceSource: null, ...extra }) as Equipment

describe('Flow Type 색과 다중층·층 편집 공통 범례 (OE-OBJ-12 · OE-ML-15)', () => {
  it('19종의 색은 glossary 표와 같다. DCW·FP 등 급수·소화 값도 공통 범례에 들어 있고 미정인 9종은 임의의 색을 주지 않는다 [OE-ML-15#1,2,3]', () => {
    const glossary = glossaryColors()
    expect([...glossary.keys()].sort()).toEqual(FLOW_TYPES.map((f) => f.code).sort())
    for (const f of FLOW_TYPES) expect([f.code, f.color]).toEqual([f.code, glossary.get(f.code)])
    expect(FLOW_TYPES.filter((f) => f.color === null).map((f) => f.code)).toEqual(['REF', 'DHWS', 'DHWR', 'DCW', 'FP', 'STM', 'CR', 'GWS', 'GWR'])
    expect(systemFlowType('domestic_cold_water', null)).toBe('DCW')
    expect(systemFlowType('fire_protection', null)).toBe('FP')
    expect(flowTypeColor('CHWS')).toBe(0x2994ff)
    expect(flowTypeColor('FP')).toBe(null)
    expect(flowTypeColor('XX')).toBe(null)
  })

  it('계통은 종류·유체로 정한 Flow Type 의 색을 쓰고, 모르거나 색이 미정이면 계통 색을 순환하며 선택·연결 상태 색과 섞이지 않는다 [OE-ML-15#2,3]', () => {
    const sys = (id: string, kind: string | null, fluid: string | null = null) => ({ id, name: id, memberIds: [], source: 'ifc' as const, kind, fluid })
    const m = {
      systems: [sys('sa', 'supply_air'), sys('chw', 'hydronic_supply', 'chilled'), sys('hyd', 'hydronic_supply'), sys('fp', 'fire_protection'), sys('dcw', 'domestic_cold_water'), sys('none', null)],
    } as unknown as Model
    const c = systemColors(m)
    expect(c.get('sa')).toBe(0x99ff00)
    expect(c.get('chw')).toBe(0x2994ff)
    // 유체를 모르는 순환수·색 미정(FP·DCW)·종류 모름은 Flow Type 색이 아니다.
    const flowColors = new Set(FLOW_TYPES.flatMap((f) => (f.color ? [parseInt(f.color.slice(1), 16)] : [])))
    for (const id of ['hyd', 'fp', 'dcw', 'none']) expect(flowColors.has(c.get(id)!)).toBe(false)
    // 미분류 구간은 conduitFlowType 이 null 이며, 선택·상류·하류 강조 색은 배관 Flow Type 색과 별도다.
    expect(conduitFlowType(eq('u1', 'segment', 'none'), (id) => m.systems.find((s) => s.id === id))).toBeNull()
    expect(PICK_COLORS.selected).not.toBe(0x99ff00)
  })

  it('수평 배관과 층간 수직 라이저는 두 화면에서 같은 Flow Type 색으로 표시되고, 계통·배관 변경 후 함께 갱신된다 [OE-ML-15#1,4]', () => {
    const m: Model = {
      schema: 'IFC4',
      siteName: '',
      buildingId: 'B',
      buildingName: '',
      warnings: [],
      connections: [],
      systems: [{ id: 'mix', name: 'mix', memberIds: ['horiz', 'riser', 'ahu'], source: 'ifc', kind: 'supply_air', kindSource: 'bim' }],
      storeys: [
        {
          id: '1F',
          name: '1F',
          elevation: 0,
          spaces: [],
          walls: [],
          openings: [],
          equipment: [
            eq('horiz', 'segment', 'mix', { ifcClass: 'DuctSegment', position: [2, 0, 2.7], axis: [[-2, 0, 0], [2, 0, 0]] }),
            eq('riser', 'segment', 'mix', { ifcClass: 'DuctSegment', position: [4, 0, 4.7], axis: [[0, 0, -2], [0, 0, 2]] }),
            eq('ahu', 'conversion', 'mix'),
          ],
        },
      ],
    }
    const systemOf = (id: string) => m.systems.find((s) => s.id === id)
    const horiz = m.storeys[0].equipment[0]
    const riser = m.storeys[0].equipment[1]
    const ahu = m.storeys[0].equipment[2]
    let colorOf = systemColors(m)
    // 같은 Flow Type(SA)의 수평 배관과 수직 라이저가 같은 범례·색(#99FF00)을 쓴다.
    expect(equipmentColor(horiz, systemOf, colorOf)).toBe(0x99ff00)
    expect(equipmentColor(riser, systemOf, colorOf)).toBe(0x99ff00)
    expect(colorOf.get('mix')).toBe(0x99ff00)

    // 계통 종류를 배기(EA)로 바꾸면 두 화면이 쓰는 범례 색(systemColors)과 수평·수직 배관 색(equipmentColor)이 함께 갱신된다.
    setSystemKind(m, 'mix', 'exhaust_air')
    colorOf = systemColors(m)
    expect(colorOf.get('mix')).toBe(0xe8c3b4)
    expect(equipmentColor(horiz, systemOf, colorOf)).toBe(0xe8c3b4)
    expect(equipmentColor(riser, systemOf, colorOf)).toBe(0xe8c3b4)

    // 구간 하나의 Flow Type 을 RA 로 지정하면 그 구간 색만 RA(#FFCD57)로 갱신되고 기기는 계통 색 그대로다.
    expect(setConduitFlowType(m, 'riser', 'RA')).toBe(true)
    expect(equipmentColor(riser, systemOf, colorOf)).toBe(0xffcd57)
    expect(equipmentColor(ahu, systemOf, colorOf)).toBe(0xe8c3b4)
    // 사람이 그린 냉수 환수 배관(계통 없음) → CHWR 색, 색이 미정인 냉매 배관은 계통 없음 회색.
    expect(equipmentColor(eq('p1', 'fitting', null, { flowType: 'CHWR' }), systemOf, colorOf)).toBe(0x58dbff)
    expect(equipmentColor(eq('p2', 'segment', null, { flowType: 'REF' }), systemOf, colorOf)).toBe(0x98a1ab)
  })
})
