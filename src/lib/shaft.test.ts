import { describe, expect, it } from 'vitest'
import type { Connection, Equipment, Model, Space, Storey, Vec2 } from './model'
import { createVertical, deleteVertical, moveVertical, verticalImpact } from './vertical-edit'
import { setSegmentShaft, shaftCandidates, shaftDeviations, shaftMembers, shaftOf } from './shaft'
import { baselineOf, diffBaseline, restore, snapshotVerticals } from './edit'
import { applyEdits, exportEdits, parseEditFile, type EditFile } from './edit-file'
import { modelToGeoJSON } from './export/geojson'

// 덕트·배관 구간의 샤프트 소속(OE-ML-09·14, ADR-0047). 세 층(0 · 4 · 8m) 건물에 샤프트 PS-1(축 3~4 × 0~1, 1F~3F)과
// 그 안을 지나는 수직관 RISER(3.5, 0.5, 0.5 → 5.5), 축 밖에 있는 수직관 NEAR(4.5, 0.5)를 둔다. RISER 는 1층 기기 LOW 와 2층 기기 HIGH 를 잇는다.

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const space = (id: string, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: 1, boundedBy: [] })
const device = (id: string, at: [number, number, number], extra: Partial<Equipment> = {}): Equipment =>
  ({ id, name: id, ifcClass: 'FlowTerminal', role: 'terminal', position: at, capacity: null, capacityProperty: null, systemId: null, spaceId: null, spaceSource: null, ...extra }) as Equipment
const pipe = (id: string, x: number) => device(id, [x, 0.5, 0.5], { ifcClass: 'PipeSegment', role: 'segment', axis: [[0, 0, 0], [0, 0, 5]] })

function building(): Model {
  const floor = (id: string, elevation: number): Storey => ({ id, name: id, elevation, spaces: [space(`room-${id}`, rect(0, 0, 10, 10))], walls: [], openings: [], equipment: [] })
  const storeys = [floor('1F', 0), floor('2F', 4), floor('3F', 8)]
  storeys[0].equipment.push(device('LOW', [3.5, 0.5, 0.2]), pipe('RISER', 3.5), pipe('NEAR', 4.5))
  storeys[1].equipment.push(device('HIGH', [3.5, 0.5, 5.6]))
  const link = (from: string, to: string) => ({ from, to, source: 'manual', directed: false, tolerance: null }) as Connection
  const m: Model = { schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys, systems: [], connections: [link('LOW', 'RISER'), link('RISER', 'HIGH')], warnings: [] }
  expect(createVertical(m, { id: 'U_ps', kind: 'shaft', name: 'PS-1', from: '1F', to: '3F' }, new Map([['1F', { footprint: rect(3, 0, 4, 1) }]]))).toEqual({ id: 'U_ps' })
  return m
}
const seg = (m: Model, id: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.id === id)!
const feature = (m: Model, id: string) => modelToGeoJSON(m).flatMap((f) => f.collection.features).find((f) => f.id === id)!

describe('샤프트 소속 (OE-ML-09·14)', () => {
  it('축 안에 있어도 저절로 넣지 않고, 두 끝이 축 안인 구간만 사람이 넣는다. 축 밖 구간은 거절한다 [OE-ML-14#6] [OE-ML-17#1~]', () => {
    const m = building()
    expect(shaftOf(m, seg(m, 'RISER'))).toBeNull()
    expect(shaftCandidates(m, 'RISER').map((o) => o.id)).toEqual(['U_ps'])
    expect(shaftCandidates(m, 'NEAR')).toEqual([])
    expect(setSegmentShaft(m, 'NEAR', 'U_ps')).toEqual({ refused: expect.stringContaining('축 안에 있지 않습니다') })
    expect(setSegmentShaft(m, 'LOW', 'U_ps')).toEqual({ refused: expect.stringContaining('구간만') })
    expect(setSegmentShaft(m, 'RISER', 'U_ps')).toBe(true)
    expect(shaftMembers(m, 'U_ps').map((e) => e.id)).toEqual(['RISER'])
    expect(feature(m, 'RISER').properties.shaftId).toBe('U_ps')
    expect(feature(m, 'NEAR').properties.shaftId).toBeUndefined()
  })

  it('넣은 소속은 연 때와 견준 차이에 남고, 편집 파일로 새로 연 모델에 얹으면 같다 — 샤프트를 편집으로 만든 경우도 샤프트가 선 뒤에 얹힌다', () => {
    const m = building()
    const base = baselineOf(m)
    setSegmentShaft(m, 'RISER', 'U_ps')
    expect(diffBaseline(m, base).equipmentShaft).toEqual([{ id: 'RISER', name: 'RISER', shaft: 'PS-1' }])
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'b.ifc'))) as EditFile
    expect(file.equipment.find((r) => r.id === 'RISER')).toMatchObject({ shaft: 'U_ps' })
    const again = building()
    applyEdits(again, file)
    expect(shaftOf(again, seg(again, 'RISER'))?.id).toBe('U_ps')

    // 샤프트가 없던 모델에서 샤프트를 만들고 넣은 편집 파일.
    const bare = () => {
      const x = building()
      x.storeys.forEach((s) => delete s.verticalParts)
      return x
    }
    const a = bare()
    const aBase = baselineOf(a)
    createVertical(a, { id: 'U_ps', kind: 'shaft', name: 'PS-1', from: '1F', to: '3F' }, new Map([['1F', { footprint: rect(3, 0, 4, 1) }]]))
    setSegmentShaft(a, 'RISER', 'U_ps')
    const fresh = bare()
    expect(applyEdits(fresh, parseEditFile(JSON.stringify(exportEdits(a, aBase, 'b.ifc'))) as EditFile).missing).toMatchObject({ elements: 0 })
    expect(shaftOf(fresh, seg(fresh, 'RISER'))?.id).toBe('U_ps')
    expect(JSON.stringify(modelToGeoJSON(fresh))).toBe(JSON.stringify(modelToGeoJSON(a)))
  })

  it('샤프트를 옮겨 구간이 축 밖이 되면 소속은 두고 이탈로 알리며, 되돌려 옮기면 풀린다 [OE-ML-14#5~]', () => {
    const m = building()
    setSegmentShaft(m, 'RISER', 'U_ps')
    expect(shaftDeviations(m)).toEqual([])
    moveVertical(m, 'U_ps', [2, 0])
    expect(shaftDeviations(m).map((d) => [d.segment.id, d.shaft.name])).toEqual([['RISER', 'PS-1']])
    expect(shaftOf(m, seg(m, 'RISER'))?.id).toBe('U_ps')
    moveVertical(m, 'U_ps', [-2, 0])
    expect(shaftDeviations(m)).toEqual([])
  })

  it('샤프트를 지우면 안의 배관과 연결은 그대로이고 소속만 풀린다. 되돌리면 소속도 돌아온다 [OE-ML-09#4]', () => {
    const m = building()
    setSegmentShaft(m, 'RISER', 'U_ps')
    expect(verticalImpact(m, 'U_ps')).toMatchObject({ pipes: 1 })
    const snap = snapshotVerticals(m)
    const before = JSON.stringify([m.storeys.map((s) => s.equipment.map((e) => [e.id, e.position])), m.connections])
    expect(deleteVertical(m, 'U_ps')).toBe(true)
    expect(JSON.stringify([m.storeys.map((s) => s.equipment.map((e) => [e.id, e.position])), m.connections])).toBe(before)
    expect(shaftOf(m, seg(m, 'RISER'))).toBeNull()
    expect(shaftMembers(m, 'U_ps')).toEqual([])
    expect(feature(m, 'RISER').properties.shaftId).toBeUndefined()
    restore(m, snap)
    expect(shaftOf(m, seg(m, 'RISER'))?.id).toBe('U_ps')
  })
})
