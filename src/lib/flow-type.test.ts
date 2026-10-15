// Flow Type 색(OE-OBJ-12). 색 값은 glossary "Flow Type" 표의 "색 (UX v0.9)" 칸이 정본이다 — PM 이 미정인 색을 더하면 여기서 걸려 코드도 맞춘다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FLOW_TYPES, flowTypeColor } from './flow-type'
import { equipmentColor, systemColors } from './viewer'
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

describe('Flow Type 색 (OE-OBJ-12)', () => {
  it('19종의 색은 glossary 표와 같다. 미정인 9종은 색을 주지 않는다', () => {
    const glossary = glossaryColors()
    expect([...glossary.keys()].sort()).toEqual(FLOW_TYPES.map((f) => f.code).sort())
    for (const f of FLOW_TYPES) expect([f.code, f.color]).toEqual([f.code, glossary.get(f.code)])
    expect(FLOW_TYPES.filter((f) => f.color === null).map((f) => f.code)).toEqual(['REF', 'DHWS', 'DHWR', 'DCW', 'FP', 'STM', 'CR', 'GWS', 'GWR'])
    expect(flowTypeColor('CHWS')).toBe(0x2994ff)
    expect(flowTypeColor('FP')).toBe(null)
    expect(flowTypeColor('XX')).toBe(null)
  })

  it('계통은 종류·유체로 정한 Flow Type 의 색을 쓰고, 모르거나 색이 미정이면 계통 색을 순환한다', () => {
    const sys = (id: string, kind: string | null, fluid: string | null = null) => ({ id, name: id, memberIds: [], source: 'ifc' as const, kind, fluid })
    const m = {
      systems: [sys('sa', 'supply_air'), sys('chw', 'hydronic_supply', 'chilled'), sys('hyd', 'hydronic_supply'), sys('fp', 'fire_protection'), sys('none', null)],
    } as unknown as Model
    const c = systemColors(m)
    expect(c.get('sa')).toBe(0x99ff00)
    expect(c.get('chw')).toBe(0x2994ff)
    // 유체를 모르는 순환수·색 미정(FP)·종류 모름은 Flow Type 색이 아니다.
    const flowColors = new Set(FLOW_TYPES.flatMap((f) => (f.color ? [parseInt(f.color.slice(1), 16)] : [])))
    for (const id of ['hyd', 'fp', 'none']) expect(flowColors.has(c.get(id)!)).toBe(false)
  })

  it('덕트·배관은 구간의 Flow Type 색이고, 사람이 그리거나 고른 값이 계통보다 앞선다. 기기는 계통 색이다', () => {
    const systems = [{ id: 'mix', name: 'mix', memberIds: [], source: 'ifc' as const, kind: 'supply_air', kindSource: 'bim' as const }]
    const systemOf = (id: string) => systems.find((s) => s.id === id) as Model['systems'][number] | undefined
    const colorOf = new Map([['mix', 0x99ff00]])
    // 급기 계통의 BIM 덕트 → 계산한 SA 색, 사람이 RA 로 고른 덕트 → RA 색.
    expect(equipmentColor(eq('d1', 'segment', 'mix'), systemOf, colorOf)).toBe(0x99ff00)
    expect(equipmentColor(eq('d2', 'segment', 'mix', { flowTypeSet: 'RA' }), systemOf, colorOf)).toBe(0xffcd57)
    // 사람이 그린 냉수 환수 배관(계통 없음) → CHWR 색.
    expect(equipmentColor(eq('p1', 'fitting', null, { flowType: 'CHWR' }), systemOf, colorOf)).toBe(0x58dbff)
    // 색이 미정인 냉매 배관은 계통 색(여기서는 계통 없음 회색)이다.
    expect(equipmentColor(eq('p2', 'segment', null, { flowType: 'REF' }), systemOf, colorOf)).toBe(0x98a1ab)
    // 기기는 Flow Type 이 아니라 계통 색이다.
    expect(equipmentColor(eq('ahu', 'conversion', 'mix', { flowTypeSet: 'RA' }), systemOf, colorOf)).toBe(0x99ff00)
  })
})
