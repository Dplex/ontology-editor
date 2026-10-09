// 외벽 전용 설비는 소속 판정에서 빠진다(OE-MAP-01 1단계 · OE-EQP-15). 방 (0..10 × 0..8).
import { describe, expect, it } from 'vitest'
import { assignEquipment, exteriorKind, spaceAssignable } from './mapping'
import type { Equipment, Space } from './model'

const room: Space = { id: 'room', name: '101', longName: '사무실', footprint: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]], areaM2: 80, boundedBy: [] } as unknown as Space
const eq = (kind: string, position: [number, number, number]): Equipment =>
  ({ id: kind, name: kind, ifcClass: 'X', kind, role: null, position, capacity: null, systemId: null, spaceId: null, spaceSource: null }) as unknown as Equipment

describe('외벽 전용 설비의 소속 (OE-MAP-01 1단계 · OE-EQP-15)', () => {
  it('외부 루버·외기 센서는 외곽선에서 허용 거리 안이어도, 외곽선 안이어도 방에 붙지 않고 소속 지정도 막힌다', () => {
    for (const kind of ['outdoor_louver', 'outdoor_temperature_sensor']) {
      expect(exteriorKind({ kind })).toBe(true)
      for (const at of [[3, -0.03, 1.5], [3, 2, 1.5]] as [number, number, number][]) {
        const e = eq(kind, at)
        assignEquipment(e, [room])
        expect([kind, at, e.spaceId]).toEqual([kind, at, null])
        expect(spaceAssignable(e, [room])).toEqual({ ok: false, reason: '외벽 전용 설비라 소속은 "외벽" 입니다' })
      }
    }
  })

  it('다른 종류는 지금처럼 허용 거리 안이면 그 방에 붙는다', () => {
    const e = eq('air_diffuser', [3, -0.03, 2.7])
    assignEquipment(e, [room])
    expect(e.spaceId).toBe('room')
    expect(exteriorKind(e)).toBe(false)
  })
})

describe('종류를 외벽 전용으로 바꾸면 소속이 따라간다', () => {
  it('외부 루버로 바꾸면 방에서 빠지고, 되돌리거나 다른 종류로 바꾸면 좌표로 다시 방을 찾는다', async () => {
    const { setTypeKind, snapshotType, restore } = await import('./edit')
    const e = eq('air_diffuser', [3, 2, 1.5])
    assignEquipment(e, [room])
    const model = { storeys: [{ id: 's', name: '1F', elevation: 0, spaces: [room], walls: [], openings: [], equipment: [e] }], systems: [], connections: [] } as never
    const snap = snapshotType(model, `#${e.id}`)
    expect(setTypeKind(model, `#${e.id}`, 'outdoor_louver')).not.toBeNull()
    expect(e.spaceId).toBeNull()
    restore(model, snap)
    expect([e.kind, e.spaceId]).toEqual(['air_diffuser', 'room'])
    setTypeKind(model, `#${e.id}`, 'outdoor_louver')
    setTypeKind(model, `#${e.id}`, 'fcu')
    expect(e.spaceId).toBe('room')
  })
})
