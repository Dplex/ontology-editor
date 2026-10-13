import { describe, expect, it } from 'vitest'
import { addEquipment } from './edit'
import { exportEdits } from './edit-file'
import { baselineOf } from './edit'
import { modelToTTL } from './export/ttl'
import type { Model } from './model'
import { EMPTY_FILTER, NO_SYSTEM, explodeGroups, facets, filterActive, filteredOut, passes } from './view-filter'

// 3D 보기 필터(ADR-0062). 화면 상태만 — 모델·편집 파일·TTL 은 그대로다.
function building(): Model {
  const m: Model = {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      { id: '2F', name: '2F', elevation: 3, spaces: [], walls: [], openings: [], equipment: [] },
      { id: '1F', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [] },
    ],
    systems: [{ id: 'sa', name: '급기', memberIds: ['fan1', 'fcu1'], source: 'ifc' } as Model['systems'][number]],
    connections: [],
    warnings: [],
  }
  addEquipment(m, '1F', { id: 'fan1', name: 'Fan-1', kind: 'fan', position: [1, 1, 0] })
  addEquipment(m, '1F', { id: 'fcu1', name: 'FCU-1', kind: 'fcu', position: [2, 1, 0] })
  addEquipment(m, '2F', { id: 'fcu2', name: 'FCU-2', kind: 'fcu', position: [2, 1, 3] })
  addEquipment(m, '2F', { id: 'pipe1', name: '배관', kind: null, position: [3, 1, 3], conduit: { role: 'segment', ifcClass: 'PipeSegment', flowType: 'HWS' } })
  for (const e of m.storeys.flatMap((s) => s.equipment)) {
    delete e.added
    e.systemId = e.id === 'fan1' || e.id === 'fcu1' ? 'sa' : null
  }
  return m
}

describe('보기 필터 (ADR-0062)', () => {
  it('항목과 개수 — 층은 높이 순, 클래스는 기기 먼저 많은 것부터(TTL 과 같은 클래스), 계통 없음은 맨 뒤', () => {
    const f = facets(building())
    expect(f.storeys.map((s) => [s.id, s.count])).toEqual([['1F', 2], ['2F', 2]])
    expect(f.classes.map((c) => [c.id, c.count, c.conduit])).toEqual([['brick:Fan_Coil_Unit', 2, false], ['brick:Fan', 1, false], ['fso:Segment', 1, true]])
    expect(f.systems.map((s) => [s.name, s.count])).toEqual([['급기', 2], [NO_SYSTEM, 2]])
  })

  it('클래스·계통·숨김·격리로 거른다. 빈 필터는 아무것도 숨기지 않는다', () => {
    const m = building()
    expect(filterActive(EMPTY_FILTER)).toBe(false)
    expect([...filteredOut(m, EMPTY_FILTER)]).toEqual([])
    expect([...filteredOut(m, { ...EMPTY_FILTER, classes: ['brick:Fan_Coil_Unit'] })].sort()).toEqual(['fan1', 'pipe1'])
    expect([...filteredOut(m, { ...EMPTY_FILTER, systems: [NO_SYSTEM] })].sort()).toEqual(['fan1', 'fcu1'])
    expect([...filteredOut(m, { ...EMPTY_FILTER, hidden: ['fcu2'] })]).toEqual(['fcu2'])
    expect([...filteredOut(m, { ...EMPTY_FILTER, isolate: ['fan1'] })].sort()).toEqual(['fcu1', 'fcu2', 'pipe1'])
    // 층만 거른 필터는 설비를 숨기지 않는다(층이 판째 숨긴다).
    expect([...filteredOut(m, { ...EMPTY_FILTER, storeys: ['1F'] })]).toEqual([])
    expect(passes(m.storeys[1].equipment[0], { ...EMPTY_FILTER, classes: ['brick:Fan'] })).toBe(true)
  })

  it('분해도는 보이는 기기만 클래스별로 묶고, 덕트·배관은 띄우지 않는다', () => {
    const m = building()
    expect(explodeGroups(m, () => true).map((g) => g.label)).toEqual(['brick:Fan_Coil_Unit · 2', 'brick:Fan · 1'])
    expect(explodeGroups(m, (e) => e.id !== 'fcu2').map((g) => [g.cls, g.ids])).toEqual([['brick:Fan', ['fan1']], ['brick:Fan_Coil_Unit', ['fcu1']]])
  })

  it('필터는 모델을 바꾸지 않는다 — TTL·편집 파일이 그대로다', () => {
    const m = building()
    const base = baselineOf(m)
    const ttl = modelToTTL(m)
    const edits = JSON.stringify({ ...exportEdits(m, base, 'x.ifc'), savedAt: '' })
    filteredOut(m, { ...EMPTY_FILTER, classes: ['brick:Fan'], hidden: ['fcu1'], isolate: ['fan1'] })
    explodeGroups(m, () => true)
    expect(modelToTTL(m)).toBe(ttl)
    expect(JSON.stringify({ ...exportEdits(m, base, 'x.ifc'), savedAt: '' })).toBe(edits)
  })
})
