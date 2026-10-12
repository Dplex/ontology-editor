import { describe, expect, it } from 'vitest'
import { modelToGeoJSON } from './export/geojson'
import type { Model, Space, Storey, Vec2, VerticalPart } from './model'
import { verticalConnections, verticalLinks } from './vertical'
import { renameSpace, replaceSpaceFootprint } from './edit'

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const space = (id: string, kind: string | null, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: 0, boundedBy: [], kind })
const storey = (id: string, elevation: number, spaces: Space[]): Storey => ({ id, name: id, elevation, spaces, walls: [], openings: [], equipment: [] })
const model = (storeys: Storey[]): Model => ({ schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys, systems: [], connections: [], warnings: [] })

describe('층 사이 연결', () => {
  it('바로 위층에서 절반 넘게 겹치는 같은 종류의 방과 잇는다', () => {
    const m = model([
      // 층 순서가 뒤섞여 들어와도 높이로 줄 세운다.
      storey('2F', 3, [space('stair2', 'staircase', rect(0.2, 0, 3.2, 5)), space('ev2', 'elevator_shaft', rect(10, 0, 12, 2))]),
      storey('1F', 0, [
        space('stair1', 'staircase', rect(0, 0, 3, 5)),
        space('ev1', 'elevator_shaft', rect(10, 0, 12, 2)),
        // 자리는 겹치지만 종류를 모르는 방은 잇지 않는다.
        space('lobby', null, rect(0, 0, 3, 5)),
      ]),
      storey('3F', 6, [
        // 반만 걸친 계단실(겹친 넓이가 작은 쪽의 절반 이하)은 다른 통로다.
        space('stair3', 'staircase', rect(1.7, 0, 4.7, 5)),
      ]),
    ])
    const links = verticalLinks(m)
    expect(Object.fromEntries(links)).toEqual({ stair1: ['stair2'], stair2: ['stair1'], ev1: ['ev2'], ev2: ['ev1'] })
  })

  it('GeoJSON 의 계단실·승강로 feature 에 이어진 방을 적는다', () => {
    const m = model([
      storey('1F', 0, [space('stair1', 'staircase', rect(0, 0, 3, 5)), space('office', 'office', rect(5, 0, 9, 5))]),
      storey('2F', 3, [space('stair2', 'staircase', rect(0, 0, 3, 5))]),
    ])
    const first = modelToGeoJSON(m)[0].collection.features
    expect(first.find((f) => f.id === 'stair1')!.properties).toMatchObject({ verticalConnects: ['stair2'], verticalConnectsSource: 'calc' })
    expect(first.find((f) => f.id === 'office')!.properties).not.toHaveProperty('verticalConnects')
    expect(first.find((f) => f.id === 'office')!.properties).not.toHaveProperty('verticalConnectsSource')
  })

  it('모델에 저장하지 않고 내보낼 때 잰다 — 방 이름·경계를 고치면 다음 내보내기에 그대로 (OE-ML-19)', () => {
    const m = model([
      storey('1F', 0, [space('stair1', 'staircase', rect(0, 0, 3, 5))]),
      storey('2F', 3, [space('room2', null, rect(0, 0, 3, 5))]),
    ])
    const stair1 = () => modelToGeoJSON(m)[0].collection.features.find((f) => f.id === 'stair1')!.properties
    // 위층 방의 종류를 모르면 잇지 않는다.
    expect(stair1()).not.toHaveProperty('verticalConnects')
    // 이름을 "계단실" 로 고치면 사전이 종류를 계단실로 정하고, 다음 내보내기에 이어진다.
    renameSpace(m, 'room2', '계단실')
    expect(m.storeys[1].spaces[0].kind).toBe('staircase')
    expect(stair1().verticalConnects).toEqual(['room2'])
    // 경계를 옮겨 작은 쪽 넓이의 절반 아래로만 겹치면 끊긴다.
    replaceSpaceFootprint(m, 'room2', rect(1.6, 0, 4.6, 5))
    expect(stair1()).not.toHaveProperty('verticalConnects')
    // 모델에는 아무것도 남지 않는다 — 편집 파일·되돌리기가 신경 쓸 값이 없다.
    expect(JSON.stringify(m)).not.toContain('verticalConnects')
  })

  it('바로 위층만 본다 — 사이 층에 같은 통로가 없으면 두 층 위와 잇지 않는다', () => {
    const m = model([
      storey('1F', 0, [space('stair1', 'staircase', rect(0, 0, 3, 5))]),
      storey('2F', 3, [space('hall2', 'corridor', rect(0, 0, 3, 5))]),
      storey('3F', 6, [space('stair3', 'staircase', rect(0, 0, 3, 5))]),
    ])
    expect(verticalLinks(m).size).toBe(0)
  })

  // OE-ML-19 겹침 후보 규칙(2026-10-08 요구사항). 실제 BIM 의 기준선은 check:sample "병원 건축 층간 연결 기준선".
  describe('겹침 후보 (OE-ML-19)', () => {
    it('겹친 넓이가 작은 쪽의 정확히 절반이면 잇지 않고, 조금이라도 넘으면 잇는다', () => {
      // 아래 4㎡, 위 4㎡. x 1~3 이 겹쳐 2㎡ = 50%.
      const half = model([storey('1F', 0, [space('s1', 'staircase', rect(0, 0, 2, 2))]), storey('2F', 3, [space('s2', 'staircase', rect(1, 0, 3, 2))])])
      expect(verticalConnections(half)).toMatchObject({ pairs: [], ambiguous: [] })
      const more = model([storey('1F', 0, [space('s1', 'staircase', rect(0, 0, 2, 2))]), storey('2F', 3, [space('s2', 'staircase', rect(0.99, 0, 2.99, 2))])])
      expect(verticalConnections(more).pairs).toEqual([{ low: 's1', high: 's2', share: expect.closeTo(0.505, 6) }])
    })

    it('분모는 두 방 중 작은 쪽의 넓이다 — 큰 계단실 안의 작은 계단실은 다 겹친다', () => {
      // 아래 10㎡ 안에 위 2㎡ 가 다 들어간다. 큰 쪽으로 나누면 20% 라 끊긴다.
      const m = model([storey('1F', 0, [space('big', 'staircase', rect(0, 0, 5, 2))]), storey('2F', 3, [space('small', 'staircase', rect(1, 0, 2, 2))])])
      expect(verticalConnections(m).pairs).toEqual([{ low: 'big', high: 'small', share: expect.closeTo(1, 6) }])
    })

    it('양쪽이 서로를 최고 후보로 고르면 잇는다 — 위층에 후보가 둘이어도 짝이 하나로 정해진다', () => {
      // a1 은 a2(100%)·b2(67%) 둘 다 걸리지만, b2 는 b1 을 더 많이 겹친다(100%). 서로 고른 짝은 a1-a2, b1-b2.
      const m = model([
        storey('1F', 0, [space('a1', 'staircase', rect(0, 0, 4, 4)), space('b1', 'staircase', rect(4, 0, 4.5, 4))]),
        storey('2F', 3, [space('a2', 'staircase', rect(0, 0, 4, 4)), space('b2', 'staircase', rect(3, 0, 4.5, 4))]),
      ])
      const v = verticalConnections(m)
      expect(Object.fromEntries(v.links)).toEqual({ a1: ['a2'], a2: ['a1'], b1: ['b2'], b2: ['b1'] })
      // 고르지 않은 a1-b2 는 모호 후보로 남는다(내보내지 않는다).
      expect(v.ambiguous.map((p) => [p.low, p.high, p.reason])).toEqual([['a1', 'b2', 'not-mutual']])
    })

    it('동률이면 어느 쪽도 잇지 않고 모호 후보로 둔다', () => {
      // 위층 큰 계단실 하나에 아래층 계단실 둘이 똑같이(100%) 들어간다.
      const m = model([
        storey('1F', 0, [space('l1', 'staircase', rect(0, 0, 2, 2)), space('l2', 'staircase', rect(2, 0, 4, 2))]),
        storey('2F', 3, [space('h', 'staircase', rect(0, 0, 4, 2))]),
      ])
      const v = verticalConnections(m)
      expect(v.links.size).toBe(0)
      expect(v.ambiguous.map((p) => [p.low, p.high, p.reason])).toEqual([
        ['l1', 'h', 'tie'],
        ['l2', 'h', 'tie'],
      ])
      const features = modelToGeoJSON(m).flatMap((f) => f.collection.features)
      expect(features.filter((f) => 'verticalConnects' in f.properties)).toEqual([])
    })

    it('다대일 — 위층 방 하나를 두 방이 고르면 더 많이 겹친 쪽만 잇고, 나머지는 모호 후보다', () => {
      // h 는 l1 과 100%, l2 와 75% 겹친다. l2 의 유일한 후보는 h 지만 h 가 l1 을 골랐다.
      const m = model([
        storey('1F', 0, [space('l1', 'staircase', rect(0, 0, 2, 2)), space('l2', 'staircase', rect(2, 0, 4, 2))]),
        storey('2F', 3, [space('h', 'staircase', rect(0, 0, 3.5, 2))]),
      ])
      const v = verticalConnections(m)
      expect(Object.fromEntries(v.links)).toEqual({ l1: ['h'], h: ['l1'] })
      expect(v.ambiguous.map((p) => [p.low, p.high, p.reason])).toEqual([['l2', 'h', 'not-mutual']])
    })

    it('넓이를 잴 수 없는 외곽선, 높이가 없거나 같은 층은 후보에서 뺀다', () => {
      const line: Vec2[] = [[0, 0], [2, 0], [4, 0]]
      const m = model([
        storey('1F', 0, [space('flat', 'staircase', line), space('s1', 'staircase', rect(10, 0, 12, 2))]),
        storey('2F', 3, [space('s2', 'staircase', rect(0, 0, 2, 2))]),
        // 같은 높이의 층(같은 층이 두 번 들어온 것)은 위아래가 아니다.
        storey('2F-copy', 3, [space('s2c', 'staircase', rect(0, 0, 2, 2))]),
        storey('nan', Number.NaN, [space('sn', 'staircase', rect(10, 0, 12, 2))]),
      ])
      expect(verticalConnections(m)).toMatchObject({ pairs: [], ambiguous: [] })
    })
  })

  // 계단 오브젝트가 말한 연결이 겹침 추정보다 앞선다(OE-ML-19, ADR-0033).
  describe('수직 관통 오브젝트가 명시한 연결 (OE-ML-19)', () => {
    const stairPart = (over: Partial<VerticalPart>): VerticalPart => ({ parentId: 'st', kind: 'stair', name: '계단', source: 'bim', footprint: [], entry: null, exit: null, ...over })

    it('계단이 이은 물리존은 그 연결(출처 bim)을 쓰고 겹침 후보에서 빠진다 — 겹침이 다른 짝을 골라도 덮어쓰지 않는다', () => {
      // 겹침만 보면 s1 은 s2b(100%)와 잇는다. 계단은 s1 에서 올라 s2a 에 닿는다.
      const m = model([
        storey('1F', 0, [space('s1', 'staircase', rect(0, 0, 2, 2))]),
        storey('2F', 3, [space('s2a', 'staircase', rect(2, 0, 4, 2)), space('s2b', 'staircase', rect(0, 0, 2, 2))]),
      ])
      m.storeys[0].verticalParts = [stairPart({ footprint: rect(0, 0, 2, 2).slice(0, 4), entry: [1, 0.5, 0] })]
      m.storeys[1].verticalParts = [stairPart({ exit: [3, 1, 3] })]
      const v = verticalConnections(m)
      expect(Object.fromEntries(v.links)).toEqual({ s1: ['s2a'], s2a: ['s1'] })
      expect(Object.fromEntries(v.sources)).toEqual({ s1: 'bim', s2a: 'bim' })
      // s1 은 명시 정보가 있어 s2b 와의 겹침 후보를 만들지 않는다.
      expect(v.pairs).toEqual([])
      expect(v.ambiguous).toEqual([])
    })

    it('계단실 종류가 아닌 물리존도 계단이 이으면 잇는다 — 거실의 나선 계단(FZK)', () => {
      const m = model([storey('EG', 0, [space('living', null, rect(0, 0, 6, 6))]), storey('DG', 2.7, [space('gallery', null, rect(0, 0, 6, 3))])])
      m.storeys[0].verticalParts = [stairPart({ entry: [1, 1, 0] })]
      m.storeys[1].verticalParts = [stairPart({ exit: [1, 2, 2.7] })]
      expect(Object.fromEntries(verticalLinks(m))).toEqual({ living: ['gallery'], gallery: ['living'] })
    })

    it('GeoJSON 에 층마다 조각 feature 를 내고, 조각끼리·물리존끼리 잇는다', () => {
      const m = model([storey('1F', 0, [space('s1', 'staircase', rect(0, 0, 2, 2))]), storey('2F', 3, [space('s2', 'staircase', rect(0, 0, 2, 2))])])
      m.storeys[0].verticalParts = [stairPart({ footprint: rect(0, 0, 1, 2).slice(0, 4), entry: [0.5, 0.2, 0] })]
      m.storeys[1].verticalParts = [stairPart({ exit: [0.5, 1.8, 3] })]
      const [first, second] = modelToGeoJSON(m).map((f) => f.collection.features)
      const low = first.find((f) => f.id === 'st@1F')!
      const high = second.find((f) => f.id === 'st@2F')!
      expect(low.geometry?.type).toBe('Polygon')
      expect(low.properties).toMatchObject({
        kind: 'vertical', verticalKind: 'stair', parentId: 'st', storeyId: '1F', source: 'bim',
        entry: [0.5, 0.2, 0], exit: null, spaceIds: ['s1'], passable: false,
        verticalConnects: ['st@2F'], verticalConnectsSource: 'bim',
      })
      // 끝 층 조각은 형상이 없어 종료 지점을 점으로 낸다.
      expect(high.geometry).toEqual({ type: 'Point', coordinates: [0.5, 1.8, 3] })
      expect(high.properties).toMatchObject({ spaceIds: ['s2'], verticalConnects: ['st@1F'] })
      // 물리존의 층간 연결도 오브젝트가 말한 것이다.
      expect(first.find((f) => f.id === 's1')!.properties).toMatchObject({ verticalConnects: ['s2'], verticalConnectsSource: 'bim' })
    })
  })
})
