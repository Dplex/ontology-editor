import { describe, expect, it } from 'vitest'
import { confirmSystemFlow, inferFlowByRules, withInferred } from './flow-rules'
import type { Connection, Equipment, EquipmentRole, Model } from './model'
import { modelToTTL } from './export/ttl'
import { trace } from './topology'

const eq = (id: string, kind: string | null, role: EquipmentRole | null): Equipment => ({
  id,
  name: id,
  ifcClass: 'X',
  kind,
  role,
  position: null,
  capacity: null,
  capacityProperty: null,
  systemId: null,
  spaceId: null,
  spaceSource: null,
})

const link = (from: string, to: string, directed = false): Connection => ({ from, to, source: 'port', directed, tolerance: null })

/** 원천 - 덕트 - 덕트 - 말단 한 줄. 연결은 전부 방향 없음(SOURCEANDSINK). */
function line(systemKind: string, source = eq('src', 'fcu', 'conversion')): Model {
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
        spaces: [],
        walls: [],
        openings: [],
        equipment: [source, eq('d1', null, 'segment'), eq('d2', null, 'segment'), eq('t', 'air_diffuser', 'terminal')],
      },
    ],
    // Revit 은 공조기를 급기 계통에 안 넣고 덕트·말단만 넣기도 한다. 그래서 원천을 구성원에서 뺐다.
    systems: [{ id: 'sys', name: 'S 1', memberIds: ['d1', 'd2', 't'], source: 'ifc', kind: systemKind }],
    connections: [link(source.id, 'd1'), link('d2', 'd1'), link('d2', 't')],
    warnings: [],
  }
}

const arrows = (m: Model) => m.connections.map((c) => (c.inferred ? `${c.inferred.from}>${c.inferred.to}` : '-'))

describe('규칙 방향', () => {
  it('급기는 원천에서 말단으로 흐른다', () => {
    const m = line('supply_air')
    const r = inferFlowByRules(m)
    expect(arrows(m)).toEqual(['src>d1', 'd1>d2', 'd2>t'])
    expect(r).toMatchObject({ systems: 1, oriented: 3, noSource: 0 })
  })

  it('환기·배기는 말단에서 원천으로 들어온다', () => {
    const m = line('return_air')
    inferFlowByRules(m)
    expect(arrows(m)).toEqual(['d1>src', 'd2>d1', 't>d2'])
  })

  it('계통 구성원이 아니어도 구성원에 붙은 원천을 찾는다', () => {
    // 위 line() 의 원천은 계통 구성원이 아니다. 그래도 방향이 정해진 것이 이 경우다.
    const m = line('supply_air')
    expect(m.systems[0].memberIds).not.toContain('src')
    inferFlowByRules(m)
    expect(m.connections[0].inferred?.from).toBe('src')
  })

  it('원천이 없는 계통은 건너뛴다', () => {
    const m = line('supply_air', eq('src', null, 'segment'))
    const r = inferFlowByRules(m)
    expect(arrows(m)).toEqual(['-', '-', '-'])
    expect(r.noSource).toBe(1)
  })

  it('물 계통에서 FCU 는 원천이 아니다', () => {
    // FCU 는 공기의 원천이지만 순환수에서는 받는 쪽이다. 매체를 안 보면 순환수 방향이 뒤집힌다.
    const m = line('hydronic_supply')
    const r = inferFlowByRules(m)
    expect(r.noSource).toBe(1)
  })

  it('열원이 있으면 펌프를 원천으로 쓰지 않는다', () => {
    // 보일러 - 배관 - 펌프 - 배관 - 말단. 펌프까지 원천으로 두면 보일러와 펌프 사이 배관이
    // 가까운 쪽(펌프)에서 나가는 것으로 뒤집힌다.
    const m = line('hydronic_supply', eq('boiler', 'boiler', 'conversion'))
    m.storeys[0].equipment.push(eq('pump', 'pump', 'moving'), eq('d3', null, 'segment'))
    m.systems[0].memberIds.push('pump', 'd3')
    m.connections = [link('boiler', 'd1'), link('d1', 'pump'), link('pump', 'd3'), link('d3', 't')]
    inferFlowByRules(m)
    expect(arrows(m)).toEqual(['boiler>d1', 'd1>pump', 'pump>d3', 'd3>t'])
  })

  it('배기는 실내 그릴에서 팬으로 들어오고, 팬에서 바깥 루버로 나간다', () => {
    // 원천(팬)을 사이에 두고 두 가지의 방향이 반대다. 계통 종류(배기 = 들어온다) 하나로 두 가지를
    // 같은 쪽으로 돌리면 바깥 쪽 가지가 뒤집힌다.
    const m = line('exhaust_air', eq('fan', 'exhaust_fan', 'moving'))
    m.storeys[0].equipment.push(eq('d9', null, 'segment'), { ...eq('louver', 'outdoor_louver', 'terminal'), name: 'M_루버_EA' })
    m.systems[0].memberIds.push('d9', 'louver')
    m.connections.push(link('fan', 'd9'), link('d9', 'louver'))
    inferFlowByRules(m)
    // 실내 쪽: 그릴(t) → d2 → d1 → 팬 / 바깥 쪽: 팬 → d9 → 루버
    expect(arrows(m)).toEqual(['d1>fan', 'd2>d1', 't>d2', 'fan>d9', 'd9>louver'])
  })

  it('외기(OA) 루버 쪽 가지는 원천으로 들어온다. 환기 계통이어도 뒤집지 않는다', () => {
    // FCU 는 환기(실내 그릴)와 외기(OA 루버)를 함께 빨아들인다. 두 가지 모두 FCU 로 들어온다.
    const m = line('return_air')
    m.storeys[0].equipment.push(eq('d9', null, 'segment'), { ...eq('oa', 'outdoor_louver', 'terminal'), name: 'Vent-Cap_OA' })
    m.systems[0].memberIds.push('d9', 'oa')
    m.connections.push(link('src', 'd9'), link('d9', 'oa'))
    inferFlowByRules(m)
    expect(arrows(m)).toEqual(['d1>src', 'd2>d1', 't>d2', 'd9>src', 'oa>d9'])
  })

  it('덕트 유형 이름과 계통이 방향을 다르게 말하면 정하지 않고 충돌로 센다', () => {
    // 성수: `RA(핑크)_탭_순환공기` 덕트가 급기 계통에 들어가 있었다. 어느 쪽이 맞는지 모른다.
    const m = line('supply_air')
    m.storeys[0].equipment[1] = { ...eq('d1', null, 'segment'), name: '직사각형 덕트:RA(핑크)_탭_순환공기' }
    const r = inferFlowByRules(m)
    expect(m.connections[0].inferred).toBeUndefined() // src–d1
    expect(m.connections[1].inferred).toBeUndefined() // d2–d1
    expect(m.connections[2].inferred).toMatchObject({ from: 'd2', to: 't' })
    expect(r.conflicts).toBe(2)
  })

  it('원천이 다른 계통의 덕트 몇 단계 너머에 있어도 찾는다', () => {
    // Revit 은 급기 계통을 가지마다 따로 만든다. 가지 계통에는 원천이 없고 본관 계통을 지나야 나온다.
    const m = line('supply_air')
    m.systems = [
      { id: 'main', name: '급기 1', memberIds: ['d1'], source: 'ifc', kind: 'supply_air' },
      { id: 'branch', name: '급기 2', memberIds: ['d2', 't'], source: 'ifc', kind: 'supply_air' },
    ]
    const r = inferFlowByRules(m)
    expect(r.noSource).toBe(0)
    expect(m.connections[2].inferred).toMatchObject({ from: 'd2', to: 't', systemId: 'branch' })
  })

  it('포트가 방향을 말한 연결은 건드리지 않고 채점에 쓴다', () => {
    const m = line('supply_air')
    m.connections[0] = link('src', 'd1', true) // BIM 과 규칙이 같다
    m.connections[2] = link('t', 'd2', true) // BIM 과 규칙이 다르다
    const r = inferFlowByRules(m)
    expect(r).toMatchObject({ agree: 1, disagree: 1, oriented: 1 })
    expect(m.connections[0].inferred).toBeUndefined()
    expect(m.connections[2]).toMatchObject({ from: 't', to: 'd2', directed: true })
  })

  it('확정 전에는 brick:feeds 로 내보내지 않고, 확정하면 덕트를 건너뛴 기기끼리 잇는다', () => {
    const m = line('supply_air')
    inferFlowByRules(m)
    expect(modelToTTL(m)).not.toContain('brick:feeds')

    expect(confirmSystemFlow(m, 'sys')).toBe(3)
    expect(modelToTTL(m)).toContain('ex:src a brick:Fan_Coil_Unit ;')
    // 바로 붙은 덕트(d1)와, 덕트를 건너뛴 말단(t)이 같이 나간다.
    expect(modelToTTL(m)).toMatch(/ex:src a brick:Fan_Coil_Unit ;[^.]*brick:feeds [^;]*ex:t\b/)
  })

  it('다시 돌려도 확정한 방향은 지키고, 확정 안 한 것은 새로 정한다', () => {
    const m = line('supply_air')
    inferFlowByRules(m)
    confirmSystemFlow(m, 'sys')
    m.systems[0].kind = 'return_air' // 규칙이 바뀌어도
    inferFlowByRules(m)
    expect(arrows(m)).toEqual(['src>d1', 'd1>d2', 'd2>t'])
  })

  it('화면의 추적은 확정 전 규칙 방향도 따라간다', () => {
    const m = line('supply_air')
    inferFlowByRules(m)
    expect(trace(m.connections, 't').upstream.size).toBe(0)
    expect([...trace(withInferred(m.connections), 't').upstream].sort()).toEqual(['d1', 'd2', 'src'])
    expect(trace(withInferred(m.connections, true), 't').upstream.size).toBe(0)
  })
})
