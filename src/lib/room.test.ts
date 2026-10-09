import { describe, expect, it } from 'vitest'
import { createRoom, deleteRoom, findRoom, moveRoom, rectRing, renameRoom, resizeRoom } from './room'
import { restore, snapshotRooms } from './edit'
import { applyEdits, exportEdits } from './edit-file'
import { baselineOf } from './edit'
import { splitByStorey } from './storey-drafts'
import type { Model, Space } from './model'

// 룸(OE-OBJ-03 · OE-SPC-11). 물리존 안의 사각 편집 단위. 물리존 밖으로 나가지 않고 다른 룸과 겹치지 않는다.
// 1F 에 사무실(0..10 × 0..8)과 복도(10..14 × 0..8)가 맞닿아 있다.

const space = (id: string, x0: number, x1: number): Space => ({ id, name: id, longName: id, footprint: rectRing([x0, 0], [x1, 8]), areaM2: (x1 - x0) * 8, boundedBy: [] })
const model = (): Model => ({
  schema: 'IFC4',
  siteName: '',
  buildingId: 'b',
  buildingName: '',
  storeys: [{ id: 's', name: '1F', elevation: 0, spaces: [space('office', 0, 10), space('hall', 10, 14)], walls: [], openings: [], equipment: [] }],
  systems: [],
  connections: [],
  warnings: [],
})
const made = (r: ReturnType<typeof createRoom>) => {
  if (!r || 'refused' in r) throw new Error(r ? r.refused : 'null')
  return r
}

describe('룸', () => {
  it('물리존 안에 두 꼭짓점으로 만들고, 든 물리존이 부모다', () => {
    const m = model()
    const r = made(createRoom(m, 's', [1, 1], [4, 3]))
    expect(r.spaceId).toBe('office')
    expect(r.footprint).toEqual([[1, 1], [4, 1], [4, 3], [1, 3], [1, 1]])
    expect(r.name).toBe('룸 1')
  })

  it('물리존 경계 밖으로 나가게 만들거나 늘리거나 옮길 수 없다', () => {
    const m = model()
    expect(createRoom(m, 's', [8, 1], [12, 3])).toMatchObject({ refused: expect.stringContaining('물리존 경계 밖') })
    const r = made(createRoom(m, 's', [1, 1], [4, 3]))
    expect(resizeRoom(m, r.id, 2, [11, 3])).toMatchObject({ refused: expect.stringContaining('물리존 경계 밖') })
    expect(moveRoom(m, r.id, [-2, 0])).toMatchObject({ refused: expect.stringContaining('물리존 경계 밖') })
    expect(findRoom(m, r.id)!.room.footprint).toEqual(rectRing([1, 1], [4, 3]))
  })

  it('다른 룸과 겹치게 만들거나 옮기면 막고 겹친 룸을 돌려주며, 변이 맞닿는 것은 된다 [OE-OBJ-03#1]', () => {
    const m = model()
    const a = made(createRoom(m, 's', [1, 1], [4, 3]))
    expect(createRoom(m, 's', [3, 2], [6, 5])).toEqual({ refused: expect.stringContaining('이미 오브젝트가 있는 위치'), blocked: a.id })
    const b = made(createRoom(m, 's', [4, 1], [7, 3]))
    expect(moveRoom(m, b.id, [-1, 0])).toMatchObject({ blocked: a.id })
    expect(findRoom(m, b.id)!.room.footprint).toEqual(rectRing([4, 1], [7, 3]))
  })

  it('꼭짓점을 끌면 맞은편 꼭짓점을 두고 크기가 바뀌고, 옮기면 부모가 따라 바뀐다', () => {
    const m = model()
    const r = made(createRoom(m, 's', [1, 1], [4, 3]))
    expect(resizeRoom(m, r.id, 2, [6, 5])).toBe(true)
    expect(findRoom(m, r.id)!.room.footprint).toEqual(rectRing([1, 1], [6, 5]))
    expect(createRoom(m, 's', [10.5, 1], [11.5, 2])).toMatchObject({ spaceId: 'hall' })
    expect(resizeRoom(m, r.id, 0, [1, 4.9])).toMatchObject({ refused: expect.stringContaining('0.3m 이상') })
  })

  it('지우고 이름을 고치며, 되돌리기로 층의 룸이 돌아온다', () => {
    const m = model()
    const r = made(createRoom(m, 's', [1, 1], [4, 3]))
    expect(renameRoom(m, r.id, '회의실 A')).toBe(true)
    const snap = snapshotRooms(m, 's')!
    expect(deleteRoom(m, r.id)).toBe(true)
    expect(m.storeys[0].rooms).toBeUndefined()
    restore(m, snap)
    expect(m.storeys[0].rooms).toEqual([{ id: r.id, name: '회의실 A', spaceId: 'office', footprint: rectRing([1, 1], [4, 3]) }])
  })

  it('편집 파일을 거쳐 새로 연 모델에 얹히고, 그 층 조각에 든다', () => {
    const m = model()
    const base = baselineOf(m)
    const r = made(createRoom(m, 's', [1, 1], [4, 3], { name: '회의실 A' }))
    const file = exportEdits(m, base, 'x.ifc')
    expect(file.rooms).toEqual([{ storeyId: 's', rooms: [{ id: r.id, name: '회의실 A', spaceId: 'office', footprint: rectRing([1, 1], [4, 3]) }] }])
    expect(splitByStorey(file, () => null).get('s')?.rooms).toEqual(file.rooms)
    const fresh = model()
    applyEdits(fresh, file)
    expect(fresh.storeys[0].rooms).toEqual(m.storeys[0].rooms)
  })
})
