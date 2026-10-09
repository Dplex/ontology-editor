import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { setSystemKind } from './edit'
import { inferFlowByRules } from './flow-rules'
import { modelToTTL } from './export/ttl'
import { systemKindOf, systemKindOfIfc } from './kinds'
import type { Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

const read = (): Model => {
  const path = fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url))
  const model = importIfc(api, new Uint8Array(readFileSync(path)))
  inferFlowByRules(model)
  return model
}

describe('계통 종류 — 소화·냉매·증기·응축수·지열수 (OE-PIP-03)', () => {
  it('이름·ObjectType 으로 새 종류를 읽고, 예전 종류는 그대로다', () => {
    const kind = (name: string) => systemKindOf(name)?.kind ?? null
    expect(kind('지열수 공급 1')).toBe('geothermal_supply')
    // 순환수의 "supply water" 보다 지열수가 먼저다.
    expect(kind('Geothermal Supply Water')).toBe('geothermal_supply')
    expect(kind('지열수 환수 2')).toBe('geothermal_return')
    expect(kind('응축수 환수')).toBe('condensate_return')
    expect(kind('증기 공급 1')).toBe('steam')
    expect(kind('스프링클러 3')).toBe('fire_protection')
    expect(kind('FP-1')).toBe('fire_protection')
    expect(kind('냉매 1')).toBe('refrigerant')
    expect(kind('REF-01')).toBe('refrigerant')
    expect(kind('순환수 공급 1')).toBe('hydronic_supply')
    expect(kind('Supply Water')).toBe('hydronic_supply')
    expect(kind('기계 급기 287')).toBe('supply_air')
  })

  it('IFC PredefinedType 의 FIREPROTECTION·REFRIGERATION 은 약어 없이 정해진다', () => {
    expect(systemKindOfIfc('FIREPROTECTION')?.kind).toBe('fire_protection')
    expect(systemKindOfIfc('REFRIGERATION')?.kind).toBe('refrigerant')
  })

  it('종류마다 Brick 1.4 의 계통 클래스와 ex:systemKind 로 나간다', () => {
    const m = read()
    const system = m.systems[0]
    const block = () => modelToTTL(m).split('\n\n').find((b) => b.includes(`rdfs:label "${system.name}"`))!
    const cases: [string, string][] = [
      ['fire_protection', 'brick:Fire_Safety_System'],
      ['refrigerant', 'brick:Refrigeration_System'],
      ['steam', 'brick:Steam_System'],
      ['condensate_return', 'brick:Steam_System'],
      ['geothermal_supply', 'brick:Water_System'],
      ['geothermal_return', 'brick:Water_System'],
    ]
    for (const [kind, cls] of cases) {
      setSystemKind(m, system.id, kind)
      expect(block()).toContain(`a ${cls} ;`)
      expect(block()).toContain(`ex:systemKind "${kind}"`)
    }
  })

  it('냉매 계통은 규칙 방향을 정하지 않고 건너뛴다(규칙이 공기·물만 다룬다)', () => {
    const m = read()
    const free = m.connections.find((c) => !c.directed)!
    expect(free.inferred).toBeDefined()
    const rules = setSystemKind(m, m.systems[0].id, 'refrigerant')!
    expect(rules.systems).toBe(0)
    expect(free.inferred).toBeUndefined()
  })
})
