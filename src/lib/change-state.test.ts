import { describe, expect, it } from 'vitest'
import { objectChanges } from './change-state'
import type { BaselineDiff } from './edit'

const empty: BaselineDiff = {
  renamed: [], moved: [], restoreyed: [], connected: [], disconnected: [], spacesAdded: [], spacesRemoved: [], equipmentAdded: [], equipmentRemoved: [],
  equipmentRenamed: [], equipmentMounted: [], wallsAdded: [], wallsRemoved: [], wallsChanged: [], openingsAdded: [], openingsRemoved: [], openingsMoved: [],
  customZones: [], hvacZones: [], systemMoved: [], systemsAdded: [], systemsRemoved: [], systemKinds: [], systemNames: [],
}

describe('objectChanges — 오브젝트별 신규·변경·삭제 (OE-UI-22)', () => {
  it('아무것도 안 바꿨으면 상태도 개수도 없다 [OE-UI-22#4]', () => {
    const r = objectChanges(empty)
    expect(r.states.size).toBe(0)
    expect(r.counts.space).toEqual({ added: 0, changed: 0, removed: 0 })
  })

  it('물리존 이름을 바꾸면 변경, 그려 만들면 신규, 지우면 삭제로 센다 [OE-UI-22#1,#2]', () => {
    const r = objectChanges({ ...empty, renamed: [{ spaceId: 'a', from: 'x', to: 'y' }], spacesAdded: [{ id: 'b', name: 'n' }], spacesRemoved: [{ id: 'c', name: 'o' }] })
    expect(r.states.get('a')).toBe('changed')
    expect(r.states.get('b')).toBe('added')
    expect(r.states.has('c')).toBe(false)
    expect(r.counts.space).toEqual({ added: 1, changed: 1, removed: 1 })
  })

  it('새로 만든 것을 고쳐도 신규 하나로만 센다', () => {
    const r = objectChanges({ ...empty, spacesAdded: [{ id: 'b', name: 'n' }], renamed: [{ spaceId: 'b', from: 'n', to: 'm' }], renumbered: [{ spaceId: 'b', from: '1', to: '2' }] })
    expect(r.states.get('b')).toBe('added')
    expect(r.counts.space).toEqual({ added: 1, changed: 0, removed: 0 })
  })

  it('한 설비를 여러 가지로 바꿔도 변경 하나로 센다', () => {
    const r = objectChanges({
      ...empty,
      moved: [{ id: 'e', name: 'E' }],
      equipmentRenamed: [{ id: 'e', from: 'a', to: 'b' }],
      systemMoved: [{ id: 'e', name: 'E', from: null, to: 's' }],
      equipmentAdded: [{ id: 'n', name: 'N' }],
      equipmentRemoved: [{ id: 'g', name: 'G' }],
    })
    expect(r.states.get('e')).toBe('changed')
    expect(r.counts.equipment).toEqual({ added: 1, changed: 1, removed: 1 })
  })

  it('커스텀존·공조존은 만든 것·고친 것·지운 것을 센다', () => {
    const r = objectChanges({
      ...empty,
      customZones: [{ id: 'c1', name: 'a', change: 'added' }, { id: 'c2', name: 'b', change: 'removed' }],
      hvacZones: [{ id: 'h1', name: 'a', storeyId: null, change: 'changed' }],
    })
    expect(r.counts.custom).toEqual({ added: 1, changed: 0, removed: 1 })
    expect(r.counts.hvac).toEqual({ added: 0, changed: 1, removed: 0 })
    expect(r.states.get('h1')).toBe('changed')
  })
})
