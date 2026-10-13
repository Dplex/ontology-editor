// 소속 판정의 단계(OE-MAP-01). 합성 층: 방 A(0~4) · 방 B(4.08~8) 사이에 8cm 벽, 승강로 E(8.2~10).
import { afterEach, describe, expect, it } from 'vitest'
import { assignEquipment, assignSnapNow, setAssignSnap, SNAP, spaceAssignable } from './mapping'
import { polygonArea, type Equipment, type Space, type Vec2 } from './model'

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const room = (id: string, footprint: Vec2[], kind: string | null = null): Space =>
  ({ id, name: id, longName: id, footprint, areaM2: polygonArea(footprint), boundedBy: [], kind }) as unknown as Space
const spaces = [room('A', rect(0, 0, 4, 4)), room('B', rect(4.08, 0, 8, 4)), room('E', rect(8.2, 0, 10, 4), 'elevator_shaft')]
const device = (x: number, y = 2): Equipment => ({ id: `d${x}`, name: 'd', position: [x, y, 2.5], spaceId: null, spaceSource: null }) as unknown as Equipment

afterEach(() => setAssignSnap(SNAP))

describe('소속 판정 단계', () => {
  it('승강로 안의 설비는 이웃 방에도 승강로에도 붙지 않고 소속 없음이며, 사람이 정하면 그 소속이다 [OE-MAP-01#8]', () => {
    const d = device(9)
    assignEquipment(d, spaces)
    expect(d.spaceId).toBeNull()
    expect(spaceAssignable(d, spaces)).toEqual({ ok: true })
    d.spaceSet = 'B'
    assignEquipment(d, spaces)
    expect([d.spaceId, d.spaceSource]).toEqual(['B', 'edit'])
  })

  it('사이트 설정의 소속 허용 거리를 바꾸면 허용 거리로 붙는 설비가 바뀌고, 사람이 정한 소속은 그대로다 [OE-MAP-01#12,17]', () => {
    const far = device(-0.08) // A 의 서쪽 변에서 8cm 밖
    const set = Object.assign(device(-0.08, 3), { spaceSet: 'B' })
    assignEquipment(far, spaces)
    assignEquipment(set, spaces)
    expect(far.spaceId).toBeNull()
    expect(set.spaceId).toBe('B')
    expect(setAssignSnap(0.1)).toBe(true)
    expect(assignSnapNow()).toBe(0.1)
    assignEquipment(far, spaces)
    assignEquipment(set, spaces)
    expect([far.spaceId, far.spaceSource]).toEqual(['A', 'computed'])
    expect([set.spaceId, set.spaceSource]).toEqual(['B', 'edit'])
    // 범위 밖·숫자가 아닌 값은 기본으로 돌린다.
    setAssignSnap(Number.NaN)
    expect(assignSnapNow()).toBe(SNAP)
  })
})
