import { beforeEach, describe, expect, it } from 'vitest'
import {
  createCustomZone,
  customZonesOfEquipment,
  deleteCustomZone,
  mergeCustomZones,
  nextZoneName,
  renameCustomZone,
  setCustomZoneAliases,
  splitCustomZone,
  zoneUsing,
} from './custom-zone'
import { addEquipment } from './edit'
import { modelToTTL } from './export/ttl'
import type { CustomZone, Model, Space, Vec2 } from './model'

// 커스텀존 이름·별명의 고유성(OE-SPC-06), 겹침(OE-SPC-07), 나누기·합치기의 이름(OE-SPC-08), 매핑 갱신(OE-SPC-09).
// 3F 에 사무실(0..20 × 0..10), 4F 에 같은 자리 사무실이 있다. 이름·별명은 층을 넘어 건물 안에서 고유하다.

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const room = (id: string, r: Vec2[]): Space => ({ id, name: id, longName: id, footprint: r, areaM2: 200, boundedBy: [] })

let model: Model
beforeEach(() => {
  model = {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      { id: 's3', name: '3F', elevation: 0, spaces: [room('office3', rect(0, 0, 20, 10))], walls: [], openings: [], equipment: [] },
      { id: 's4', name: '4F', elevation: 4, spaces: [room('office4', rect(0, 0, 20, 10))], walls: [], openings: [], equipment: [] },
    ],
    systems: [],
    connections: [],
    warnings: [],
  }
})
const make = (storeyId: string, name: string, r: Vec2[], id?: string) => createCustomZone(model, storeyId, { name, footprint: r, id }) as CustomZone

describe('이름·별명은 건물 안에서 고유하다 (OE-SPC-06)', () => {
  it('다른 존의 이름·별명과 같은 이름, 어느 존의 이름·별명과 같은 별명(자기 이름 포함), 한 존 안 같은 별명 두 번은 막고 쓰는 존을 알린다', () => {
    make('s3', '임원석', rect(0, 6, 5, 10), 'U_exec')
    setCustomZoneAliases(model, 'U_exec', ['경영진석'])
    const team = make('s4', '개발팀', rect(0, 0, 10, 10), 'U_team')
    // 다른 층이어도 같은 이름은 안 된다.
    expect(createCustomZone(model, 's4', { name: '임원석', footprint: rect(12, 0, 14, 2) })).toEqual({ refused: expect.stringContaining('커스텀존 임원석의 이름') })
    expect(renameCustomZone(model, team.id, '임원석')).toEqual({ refused: expect.stringContaining('커스텀존 임원석의 이름') })
    expect(renameCustomZone(model, team.id, '경영진석')).toEqual({ refused: expect.stringContaining('커스텀존 임원석의 별명') })
    expect(setCustomZoneAliases(model, team.id, ['경영진석'])).toEqual({ refused: expect.stringContaining('커스텀존 임원석의 별명') })
    expect(setCustomZoneAliases(model, team.id, ['임원석'])).toEqual({ refused: expect.stringContaining('커스텀존 임원석의 이름') })
    expect(setCustomZoneAliases(model, team.id, ['개발팀'])).toEqual({ refused: expect.stringContaining('커스텀존 개발팀의 이름') })
    expect(setCustomZoneAliases(model, team.id, ['R&D', 'R&D'])).toEqual({ refused: expect.stringContaining('두 번') })
    expect(team).toMatchObject({ name: '개발팀' })
    expect(team.aliases).toBeUndefined()
    // 막을 때 쓸 수 있는 값을 권한다.
    expect(renameCustomZone(model, team.id, '임원석')).toEqual({ refused: expect.stringContaining('예: 임원석-02') })
  })

  it('별명은 없어도 여럿이어도 되고, 이름이나 어느 별명으로도 그 존을 찾는다', () => {
    const exec = make('s3', '임원석', rect(0, 6, 5, 10))
    expect(setCustomZoneAliases(model, exec.id, ['경영진석', '임원 구역'])).toBe(true)
    for (const word of ['임원석', '경영진석', '임원 구역']) expect(zoneUsing(model, word)?.id).toBe(exec.id)
    expect(zoneUsing(model, '없는 말')).toBeNull()
  })

  it('지운 존이 쓰던 이름·별명은 다른 존에 붙일 수 있다', () => {
    const exec = make('s3', '임원석', rect(0, 6, 5, 10))
    setCustomZoneAliases(model, exec.id, ['경영진석'])
    deleteCustomZone(model, exec.id)
    const next = make('s4', '임원석', rect(0, 6, 5, 10))
    expect(next.name).toBe('임원석')
    expect(setCustomZoneAliases(model, next.id, ['경영진석'])).toBe(true)
  })

  it('이름 없이 그린 존은 비어 있는 "커스텀존 n" 이 된다', () => {
    make('s3', '커스텀존 2', rect(0, 0, 2, 2))
    expect(createCustomZone(model, 's3', { footprint: rect(4, 0, 6, 2) })).toMatchObject({ name: '커스텀존 3' })
  })
})

describe('나누기·합치기의 이름 (OE-SPC-08)', () => {
  it('"임원석" 을 나누면 넓은 존은 임원석(별명 그대로), 다른 존은 임원석-02(별명 없음). -02 가 쓰이고 있으면 -03 이다', () => {
    const exec = make('s3', '임원석', rect(0, 0, 10, 10), 'U_exec')
    setCustomZoneAliases(model, 'U_exec', ['경영진석'])
    const piece = splitCustomZone(model, 'U_exec', [7, -1], [7, 11]) as CustomZone
    expect(exec).toMatchObject({ name: '임원석', aliases: ['경영진석'] })
    expect(piece.name).toBe('임원석-02')
    expect(piece.aliases).toBeUndefined()
    const other = make('s4', '회의석', rect(0, 0, 10, 10))
    setCustomZoneAliases(model, other.id, ['임원석-03'])
    // -02 는 이름, -03 은 별명으로 쓰이니 다음은 -04.
    expect((splitCustomZone(model, 'U_exec', [3, -1], [3, 11]) as CustomZone).name).toBe('임원석-04')
  })

  it('번호로 끝나는 이름을 나누면 그 번호를 늘린다', () => {
    make('s3', '임원석', rect(12, 0, 14, 2))
    make('s3', '임원석-02', rect(0, 0, 10, 10), 'U_two')
    expect(nextZoneName(model, '임원석-02')).toBe('임원석-03')
    expect((splitCustomZone(model, 'U_two', [7, -1], [7, 11]) as CustomZone).name).toBe('임원석-03')
  })

  it('합치면 넓은 쪽이 남고(같으면 먼저 고른 쪽), 없어진 존의 이름·별명으로 물어도 남은 존이 나온다', () => {
    make('s3', 'A석', rect(0, 0, 4, 10), 'U_a')
    make('s3', 'B석', rect(4, 0, 20, 10), 'U_b')
    setCustomZoneAliases(model, 'U_a', ['창가'])
    const kept = mergeCustomZones(model, 'U_a', 'U_b') as CustomZone
    expect(kept.id).toBe('U_b')
    expect(kept).toMatchObject({ name: 'B석', aliases: ['A석', '창가'] })
    expect(model.storeys[0].customZones!.map((z) => z.id)).toEqual(['U_b'])
    for (const word of ['A석', '창가', 'B석']) expect(zoneUsing(model, word)?.id).toBe('U_b')
  })
})

describe('겹침과 매핑 (OE-SPC-07 · OE-SPC-09)', () => {
  it('겹치게 그려도 막지 않고, 겹친 자리의 설비는 두 존 모두에서 나온다', () => {
    addEquipment(model, 's3', { name: 'FCU', kind: 'fcu', position: [5, 5, 2.7], id: 'fcu' })
    make('s3', '사무석', rect(0, 0, 10, 10), 'U_desk')
    expect(createCustomZone(model, 's3', { name: '창가석', footprint: rect(4, 0, 12, 10), id: 'U_window' })).toMatchObject({ id: 'U_window' })
    expect(customZonesOfEquipment(model).get('fcu')).toEqual(['U_desk', 'U_window'])
  })

  it('나눠 경계가 바뀌면 TTL 의 커스텀존↔물리존 매핑이 새 경계에 맞게 바뀐다', () => {
    make('s3', '사무석', rect(0, 0, 20, 10), 'U_desk')
    const hasPart = (id: string) => modelToTTL(model).split('\n\n').find((b) => b.startsWith(`ex:${id} `))?.includes('brick:hasPart ex:office3') ?? false
    expect(hasPart('U_desk')).toBe(true)
    // x=6 에서 나누면 사무석(넓은 쪽 6..20, 사무실 바닥의 70%)이 사무실을 품고, 좁은 조각(0..6, 30%)은 품지 않는다.
    const piece = splitCustomZone(model, 'U_desk', [6, -1], [6, 11]) as CustomZone
    expect(hasPart('U_desk')).toBe(true)
    expect(hasPart(piece.id)).toBe(false)
  })
})
