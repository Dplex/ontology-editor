// 기기에서 기기로 건너가기(flow-ladder.ts). 병원 HVAC 의 공조기 하나를 줄인 합성 연결망이다.
//   냉동기 CH →(냉수 공급 관 HS1)→ 공조기 AHU →(냉수 환수 관 HR1)→ CH
//   AHU →(급기 덕트 SA1 → SA2)→ VAV1·VAV2, VAV1 →(급기 SA3)→ 디퓨저 D1, AHU →(SA1 → SA4)→ D9(덕트에 바로 달린 디퓨저)
//   그릴 G →(환기 덕트 RA1)→ AHU
//   FCU 는 냉수 공급 관 HS1 에 방향 없이(형상 추정) 붙어 있다.
import { describe, expect, it } from 'vitest'
import { flowIndex, ladder, supplyChain } from './flow-ladder'
import type { Connection } from './model'

const port = (from: string, to: string): Connection => ({ from, to, source: 'port', directed: true, tolerance: null })
const loose = (from: string, to: string): Connection => ({ from, to, source: 'geometry', directed: false, tolerance: null })
const SYSTEM: Record<string, string> = { HS1: 'HWS', HR1: 'HWR', SA1: 'SA', SA2: 'SA', SA3: 'SA', SA4: 'SA', RA1: 'RA' }
const isConduit = (id: string) => id in SYSTEM
const systemOf = (id: string) => SYSTEM[id] ?? null
const CONNECTIONS = [
  port('CH', 'HS1'), port('HS1', 'AHU'), port('AHU', 'HR1'), port('HR1', 'CH'),
  port('AHU', 'SA1'), port('SA1', 'SA2'), port('SA2', 'VAV1'), port('SA2', 'VAV2'), port('VAV1', 'SA3'), port('SA3', 'D1'),
  port('SA1', 'SA4'), port('SA4', 'D9'),
  port('G', 'RA1'), port('RA1', 'AHU'),
  loose('HS1', 'FCU'),
]
const index = () => flowIndex(CONNECTIONS, isConduit, systemOf)
const ids = (hops: { id: string }[]) => hops.map((h) => h.id).sort()

describe('기기에서 기기로 건너가기', () => {
  it('바로 다음 기기는 관을 지나 처음 닿는 기기이고, 계통마다 따로 센다', () => {
    const n = index().next('AHU')
    expect(ids(n.down)).toEqual(['CH', 'D9', 'VAV1', 'VAV2'])
    expect(n.down.find((h) => h.id === 'CH')!.systemId).toBe('HWR')
    expect(ids(n.up)).toEqual(['CH', 'G'])
    expect(n.up.find((h) => h.id === 'CH')!.systemId).toBe('HWS')
  })

  it('방향을 모르는 연결로만 닿는 기기는 상류·하류가 아니라 방향 모름이다', () => {
    const n = index().next('AHU')
    expect(n.unknown).toEqual([{ id: 'FCU', systemId: 'HWS' }])
    // FCU 에서 보면 공조기도 냉동기도 방향 모름이다. 관 너머로 방향을 정하지 않는다.
    const f = index().next('FCU')
    expect(f.up).toEqual([])
    expect(ids(f.unknown)).toEqual(['AHU', 'CH'])
  })

  it('계통 하나의 단계: 공조기 → VAV·디퓨저 → VAV 아래 디퓨저', () => {
    const steps = ladder(index(), 'AHU', 'down', (h) => h.systemId === 'SA')
    expect(steps.map((s) => s.ids.sort())).toEqual([['D9', 'VAV1', 'VAV2'], ['D1']])
  })

  it('공급 사슬은 공급 쪽 계통만 타서 냉동기 → 공조기 → VAV → 디퓨저가 되고, 환기 그릴과 환수는 들지 않는다', () => {
    const supply = (s: string | null) => s === 'HWS' || s === 'SA'
    const fromVav = supplyChain(index(), 'VAV1', supply)
    expect(fromVav.up.map((s) => s.ids)).toEqual([['AHU'], ['CH']])
    // 단계마다 건너온 계통: VAV ← 급기 ← 공조기 ← 냉수 공급 ← 냉동기
    expect(fromVav.up.map((s) => s.systems)).toEqual([['SA'], ['HWS']])
    expect(fromVav.down.map((s) => s.ids)).toEqual([['D1']])
    const fromAhu = supplyChain(index(), 'AHU', supply)
    expect(fromAhu.up.map((s) => s.ids)).toEqual([['CH']])
    expect(fromAhu.down.map((s) => s.ids.sort())).toEqual([['D9', 'VAV1', 'VAV2'], ['D1']])
  })

  it('고리가 있어도 끝나고, 한 번 닿은 기기는 다시 넣지 않는다', () => {
    // 냉동기 → 공조기 → 냉동기(둘 다 공급 쪽으로 잘못 적힌 계통)
    const both = (s: string | null) => s === 'HWS' || s === 'HWR'
    const c = supplyChain(index(), 'AHU', both)
    expect(c.up.map((s) => s.ids)).toEqual([['CH']])
    expect(c.down.map((s) => s.ids)).toEqual([['CH']])
    expect(ladder(index(), 'CH', 'down', (h) => both(h.systemId)).flatMap((s) => s.ids)).toEqual(['AHU'])
  })

  it('두 계통의 관이 맞닿은 연결은 건너지 않는다', () => {
    const leak = flowIndex([...CONNECTIONS, port('SA4', 'RA1')], isConduit, systemOf)
    expect(ids(leak.next('G').down)).toEqual(['AHU'])
  })
})

describe('방향 모름의 범위', () => {
  it('같은 덕트에서 갈라진 형제 VAV 는 방향 모름이 아니다 — 위로 올라갔다 내려와야 닿는다', () => {
    expect(index().next('VAV1').unknown).toEqual([])
    expect(ids(index().next('VAV1').up)).toEqual(['AHU'])
  })
})
