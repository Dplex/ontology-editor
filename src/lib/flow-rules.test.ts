import { describe, expect, it } from 'vitest'
import { confirmSystemFlow, inferFlowByRules, withInferred } from './flow-rules'
import { applyEdits, exportEdits } from './edit-file'
import { baselineOf, restore, setSystemKind, setTypeKind, snapshotType } from './edit'
import { flowEdits, setFlowDirection } from './edit'
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

describe('사람이 정한 방향', () => {
  it('확정 없이 brick:feeds 로 나가고, 규칙 방향보다 앞선다', () => {
    const m = line('supply_air')
    inferFlowByRules(m)
    // 규칙은 d2 → t 인데 사람이 t → d2 로 뒤집었다.
    expect(setFlowDirection(m.connections[2], 't')).toBe(true)
    expect(m.connections[2].edited).toEqual({ from: 't', to: 'd2' })
    expect(m.connections[2].directed).toBe(false) // BIM 이 말한 방향 칸은 그대로다
    expect(flowEdits(m)).toEqual([{ from: 't', to: 'd2', rule: 'reversed' }])
    expect(trace(withInferred(m.connections, true), 'd2').upstream).toEqual(new Set(['t']))
    expect(modelToTTL(m)).toMatch(/ex:t a [^.]*brick:feeds [^;]*ex:d2\b/)
  })

  it('지우면 규칙 방향으로 돌아가고 리포트에서 빠진다', () => {
    const m = line('supply_air')
    inferFlowByRules(m)
    setFlowDirection(m.connections[2], 't')
    setFlowDirection(m.connections[2], 'd2') // 여러 번 바꾸면 마지막 것만 남는다
    expect(flowEdits(m)).toEqual([{ from: 'd2', to: 't', rule: 'same' }])
    setFlowDirection(m.connections[2], null)
    expect(flowEdits(m)).toEqual([])
    expect(withInferred(m.connections)[2]).toMatchObject({ from: 'd2', to: 't', directed: true })
  })

  it('규칙이 닿지 못한 연결도 채울 수 있다', () => {
    const m = line('supply_air')
    expect(setFlowDirection(m.connections[0], 'src')).toBe(true)
    expect(flowEdits(m)).toEqual([{ from: 'src', to: 'd1', rule: null }])
  })

  it('BIM 포트가 방향을 말한 연결은 고치지 않는다', () => {
    const m = line('supply_air')
    m.connections[0] = link('src', 'd1', true)
    expect(setFlowDirection(m.connections[0], 'd1')).toBe(false)
    expect(m.connections[0].edited).toBeUndefined()
  })
})

/**
 * 수냉식 냉동기 설비실. 계통 이름에 유체가 없는 Revit 모양이다(`Hydronic Supply 1`).
 *
 *   냉수:   CH ─ s1 ─ P ─ s2 ─ FCU ─ r1 ─ CH
 *   냉각수: CH ─ c1 ─ c2 ─ CT
 *   온수:   B ─ h1 ─ h2 ─ FCU ─ hr1 ─ B        (4관식 FCU: 냉수·온수 코일이 한 기기에 있다)
 */
function plant(): Model {
  const pipe = (id: string) => eq(id, null, 'segment')
  return {
    schema: 'IFC2X3',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      {
        id: 's',
        name: 'B1',
        elevation: 0,
        spaces: [],
        walls: [],
        openings: [],
        equipment: [
          eq('CH', 'chiller', 'conversion'),
          eq('CT', 'cooling_tower', 'conversion'),
          eq('B', 'boiler', 'conversion'),
          eq('FCU', 'fcu', 'conversion'),
          eq('P', 'pump', 'moving'),
          ...['s1', 's2', 'r1', 'c1', 'c2', 'h1', 'h2', 'hr1'].map(pipe),
        ],
      },
    ],
    systems: [
      { id: 'CHS', name: 'Hydronic Supply 1', memberIds: ['s1', 'P', 's2'], source: 'property', kind: 'hydronic_supply', fluid: null },
      { id: 'CHR', name: 'Hydronic Return 1', memberIds: ['r1', 'CH'], source: 'property', kind: 'hydronic_return', fluid: null },
      // 냉각수 계통. Revit 은 냉동기와 냉각탑을 둘 다 넣는다.
      { id: 'CW', name: 'Hydronic Supply 2', memberIds: ['c1', 'c2', 'CH', 'CT'], source: 'property', kind: 'hydronic_supply', fluid: null },
      { id: 'HWS', name: 'Hydronic Supply 3', memberIds: ['h1', 'h2'], source: 'property', kind: 'hydronic_supply', fluid: null },
      { id: 'HWR', name: 'Hydronic Return 3', memberIds: ['hr1'], source: 'property', kind: 'hydronic_return', fluid: null },
    ],
    connections: [
      ...[['CH', 's1'], ['s1', 'P'], ['P', 's2'], ['s2', 'FCU'], ['FCU', 'r1'], ['r1', 'CH']],
      ...[['CH', 'c1'], ['c1', 'c2'], ['c2', 'CT']],
      ...[['B', 'h1'], ['h1', 'h2'], ['h2', 'FCU'], ['FCU', 'hr1'], ['hr1', 'B']],
    ].map(([a, b]) => ({ ...link(a, b), source: 'geometry' as const })),
    warnings: [],
  }
}
const fluids = (m: Model) => Object.fromEntries(m.systems.map((s) => [s.id, s.fluid ?? null]))

describe('순환수의 유체를 원천 기기로 짐작하기', () => {
  it('4관식 FCU 를 사이에 둔 냉수·온수가 서로 새지 않고, 냉동기가 걸친 냉각수 계통은 냉수로 찍지 않는다', () => {
    const m = plant()
    inferFlowByRules(m)
    // FCU 를 넘어가면 냉수·온수가 한 계통에 겹쳐 둘 다 모름이 된다. 냉각수 계통은 냉동기(냉수)와 냉각탑(냉각수)이 겹쳐 모름이다.
    expect(fluids(m)).toEqual({ CHS: 'chilled', CHR: 'chilled', CW: null, HWS: 'hot', HWR: 'hot' })
    expect(modelToTTL(m)).toMatch(/ex:CHS a brick:Chilled_Water_System ;/)
    expect(modelToTTL(m)).toMatch(/ex:CW a brick:Water_System ;/)
  })

  it('배관이 원천에 닿지 않아도(형상 추정이 끊김) 원천이 계통 구성원이면 그 유체다', () => {
    const m = plant()
    // Duplex MEP 보일러처럼 원천이 배관에 안 닿는다.
    m.connections = m.connections.filter((c) => c.from !== 'B' && c.to !== 'B')
    m.systems.find((s) => s.id === 'HWS')!.memberIds.push('B')
    inferFlowByRules(m)
    expect(fluids(m).HWS).toBe('hot')
    // 원천도 배관도 없는 환수는 모른다(4관식 FCU 너머의 냉수를 끌어오지 않는다).
    expect(fluids(m).HWR).toBe(null)
  })

  it('이름이 유체를 말하면 배관이 다른 원천에 닿아도 이름을 따른다 — 짐작이 작성자를 덮지 않는다', () => {
    const m = plant()
    Object.assign(m.systems.find((s) => s.id === 'HWS')!, { name: '냉수 공급 3', fluid: 'chilled', fluidSource: 'dict' })
    inferFlowByRules(m)
    expect(fluids(m).HWS).toBe('chilled')
  })

  it('사람이 원천 기기의 종류를 고치면 유체가 따라가고, 되돌리거나 편집 파일로 다시 열어도 같다', () => {
    const m = plant()
    inferFlowByRules(m)
    const base = baselineOf(m)
    // 이름 사전이 보일러를 냉동기로 잘못 읽었다고 하자. 사람이 보일러로 고치면 냉수 계통이 온수가 된다.
    const snap = snapshotType(m, '#CH')
    setTypeKind(m, '#CH', 'boiler')
    expect(fluids(m)).toMatchObject({ CHS: 'hot', CHR: 'hot' })
    // 짐작이 바뀐 것은 사람이 계통을 고친 것이 아니다. 편집 파일에 계통 줄로 남으면 다시 열 때 얼어붙는다.
    const file = exportEdits(m, base, 'x')
    expect(file.systems).toBeUndefined()
    const fresh = plant()
    inferFlowByRules(fresh)
    applyEdits(fresh, JSON.parse(JSON.stringify(file)))
    expect(fluids(fresh)).toEqual(fluids(m))
    restore(m, snap)
    expect(fluids(m)).toMatchObject({ CHS: 'chilled', CHR: 'chilled' })
  })

  it('사람이 정한 유체는 원천 종류가 바뀌어도 그대로다', () => {
    const m = plant()
    inferFlowByRules(m)
    setSystemKind(m, 'CW', 'hydronic_supply', 'condenser')
    setTypeKind(m, '#CT', null)
    // 냉각탑이 모름이 되면 짐작으로는 냉수(냉동기만 남는다)지만, 사람이 냉각수라고 했다.
    expect(fluids(m).CW).toBe('condenser')
  })

  it('히트펌프처럼 냉·온을 다 내는 원천은 유체를 정하지 않는다', () => {
    const m = plant()
    m.storeys[0].equipment.find((e) => e.id === 'B')!.kind = 'heat_pump'
    inferFlowByRules(m)
    expect(fluids(m)).toMatchObject({ HWS: null, HWR: null })
  })
})
