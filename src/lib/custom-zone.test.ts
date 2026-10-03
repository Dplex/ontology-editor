import { beforeEach, describe, expect, it } from 'vitest'
import { createCustomZone, deleteCustomZone, mergeCustomZones, renameCustomZone, setCustomZoneAliases, splitCustomZone, zoneNamesOfEquipment, zoneEquipment, zoneSpaces } from './custom-zone'
import { addEquipment, baselineOf, diffBaseline, moveEquipment, replaceSpaceFootprint, restore, snapshotCustomZones, snapshotOf } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import type { CustomZone, Model, Space, Vec2 } from './model'

// 커스텀존(OE-OBJ-01): 운영자가 물리존 위에 다각형으로 정하는 운영 단위. 넓은 사무실(0..20 × 0..10)과 회의실(20..26 × 0..10)이
// 있고, 사무실 왼쪽 위 구석을 "임원석" 으로 덮는 것이 대표 장면이다 — 방 일부만 덮어서 방 단위 소속으로는 찾을 수 없다.

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
const room = (id: string, name: string, r: Vec2[]): Space => ({ id, name, longName: name, footprint: r, areaM2: 0, boundedBy: [] })

let model: Model
beforeEach(() => {
  model = {
    schema: 'IFC4',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      {
        id: 's1',
        name: '3F',
        elevation: 0,
        spaces: [room('office', '사무실', rect(0, 0, 20, 10)), room('meeting', '회의실', rect(20, 0, 26, 10))],
        walls: [],
        openings: [],
        equipment: [],
      },
    ],
    systems: [],
    connections: [],
    warnings: [],
  }
  addEquipment(model, 's1', { name: 'FCU-임원', kind: 'fcu', position: [2, 8, 2.7], id: 'fcu1' })
  addEquipment(model, 's1', { name: 'FCU-사무', kind: 'fcu', position: [12, 4, 2.7], id: 'fcu2' })
  addEquipment(model, 's1', { name: 'FCU-회의', kind: 'fcu', position: [23, 5, 2.7], id: 'fcu3' })
})

const storey = () => model.storeys[0]
const make = (name: string, r: Vec2[], id?: string) => createCustomZone(model, 's1', { name, footprint: r, id }) as CustomZone

describe('커스텀존 만들기·이름·지우기(OE-OBJ-01)', () => {
  it('방 일부만 덮는 존도 그 안의 설비를 찾는다 — 방 소속은 그대로, TTL 에 위치가 하나 더 붙는다', () => {
    const exec = make('임원석', rect(0, 6, 5, 10), 'U_exec')
    expect(zoneEquipment(storey(), exec)).toEqual(['fcu1'])
    // 사무실 200㎡ 중 20㎡만 덮어서 사무실을 품지는 않는다.
    expect(zoneSpaces(storey(), exec)).toEqual([])
    const ttl = modelToTTL(model)
    expect(ttl).toContain('ex:U_exec a brick:Zone ;')
    expect(ttl).toContain('rdfs:label "임원석"')
    expect(ttl).toMatch(/ex:fcu1 a [^\n]+\n[^\n]+\n\s+brick:hasLocation ex:office, ex:U_exec ;/)
    // 다른 설비는 위치가 방 하나 그대로다.
    expect(ttl).toMatch(/ex:fcu2 a [^\n]+\n[^\n]+\n\s+brick:hasLocation ex:office ;/)
    // 층의 부분으로 든다.
    expect(ttl).toMatch(/ex:s1 a brick:Floor ;\n[^\n]+\n\s+brick:hasPart ex:office, ex:meeting, ex:U_exec ;/)
  })

  it('덕트·배관은 존 안에 있어도 든 설비로 세지 않는다(Agent 가 묻는 것은 기기다)', () => {
    const exec = make('임원석', rect(0, 6, 5, 10), 'U_exec')
    const duct = addEquipment(model, 's1', { name: '덕트', kind: null, position: [3, 8, 2.9], id: 'duct1' })!
    duct.role = 'segment'
    expect(zoneEquipment(storey(), exec)).toEqual(['fcu1'])
  })

  it('방 바닥의 절반 넘게 덮으면 그 방을 품는다(공조존과 같은 기준). 겹쳐 그려도 된다', () => {
    const team = make('개발팀', rect(10, 0, 26, 10), 'U_team')
    const exec = make('임원석', rect(0, 6, 12, 10), 'U_exec')
    expect(zoneSpaces(storey(), team)).toEqual(['meeting']) // 사무실은 100/200 = 절반이라 넘지 않는다
    expect(zoneEquipment(storey(), team).sort()).toEqual(['fcu2', 'fcu3'])
    expect(zoneEquipment(storey(), exec)).toEqual(['fcu1'])
    expect(modelToTTL(model)).toContain('ex:U_team a brick:Zone ;\n    brick:hasPart ex:meeting ;')
  })

  it('엇갈린 다각형·작은 다각형은 만들지 않고 이유를 돌려준다. 빈 이름은 받지 않는다', () => {
    expect(createCustomZone(model, 's1', { footprint: [[0, 0], [5, 5], [5, 0], [0, 5]] })).toEqual({ refused: expect.stringContaining('엇갈립니다') })
    expect(createCustomZone(model, 's1', { footprint: [[0, 0], [0.05, 0], [0.05, 0.05]] })).toEqual({ refused: expect.stringContaining('작습니다') })
    const z = make('', rect(0, 0, 2, 2))
    expect(z.name).toBe('커스텀존 1')
    expect(renameCustomZone(model, z.id, '  ')).toBe(false)
    expect(renameCustomZone(model, z.id, '식당')).toBe(true)
    expect(deleteCustomZone(model, z.id)).toBe(true)
    expect(storey().customZones).toEqual([])
  })
})

describe('나누기·합치기', () => {
  it('나누면 넓은 쪽이 id·이름을 이어받고 좁은 쪽이 새 존이 된다. 다시 합치면 한 존이다', () => {
    const zone = make('사무석', rect(0, 0, 20, 10), 'U_desk')
    const piece = splitCustomZone(model, 'U_desk', [15, -1], [15, 11], 'U_piece') as CustomZone
    expect(zone.footprint.map((p) => p[0]).sort((a, b) => a - b).at(-1)).toBeCloseTo(15)
    expect(piece).toMatchObject({ id: 'U_piece', name: '사무석 2' })
    expect(zoneEquipment(storey(), piece)).toEqual([])
    expect(zoneEquipment(storey(), zone).sort()).toEqual(['fcu1', 'fcu2'])
    const merged = mergeCustomZones(model, 'U_desk', 'U_piece') as CustomZone
    expect(merged.id).toBe('U_desk')
    expect(storey().customZones!.map((z) => z.id)).toEqual(['U_desk'])
  })

  it('일부만 겹친 두 존은 합치지 않고 이유를 돌려준다(합친 모양이 고리 하나로 안 닫히는 일이 있다)', () => {
    make('A', rect(0, 0, 6, 6), 'U_a')
    make('B', rect(4, 4, 10, 10), 'U_b')
    expect(mergeCustomZones(model, 'U_a', 'U_b')).toEqual({ refused: expect.stringContaining('변을 맞댔거나') })
  })

  it('다른 층의 존끼리는 겹쳐 보여도 합치지 않는다', () => {
    model.storeys.push({ id: 's2', name: '4F', elevation: 4, spaces: [], walls: [], openings: [], equipment: [] })
    make('A', rect(0, 0, 6, 6), 'U_a')
    createCustomZone(model, 's2', { name: 'B', footprint: rect(0, 0, 6, 6), id: 'U_b' })
    expect(mergeCustomZones(model, 'U_a', 'U_b')).toEqual({ refused: '같은 층의 커스텀존만 합칩니다.' })
    expect(model.storeys.map((st) => (st.customZones ?? []).map((z) => z.id))).toEqual([['U_a'], ['U_b']])
  })
})

describe('매핑은 쓸 때 계산한다 — 물리존·설비가 바뀌면 다음 내보내기에 따라온다(OE-SPC-09)', () => {
  it('설비를 존 밖으로 옮기면 위치에서 빠지고, 방 경계를 바꾸면 품는 방이 바뀐다', () => {
    make('회의 구역', rect(18, 0, 26, 10), 'U_meet')
    expect(modelToTTL(model)).toMatch(/ex:fcu3 a [^\n]+\n[^\n]+\n\s+brick:hasLocation ex:meeting, ex:U_meet ;/)
    moveEquipment(model, 'fcu3', [27, 5, 2.7])
    expect(modelToTTL(model)).toMatch(/ex:fcu3 a [^\n]+\n[^\n]+\n\s+brick:hasLocation ex:s1 ;/)
    // 회의실을 넓혀 존이 절반을 못 덮게 하면 품지 않는다.
    replaceSpaceFootprint(model, 'meeting', rect(20, 0, 40, 10))
    expect(zoneSpaces(storey(), storey().customZones![0])).toEqual([])
  })
})

describe('되돌리기·편집 파일·GeoJSON', () => {
  it('되돌리면 앞 목록으로, 다시 하면 뒤 목록으로 돌아온다', () => {
    make('A', rect(0, 0, 5, 5), 'U_a')
    const before = snapshotCustomZones(model, 's1')!
    splitCustomZone(model, 'U_a', [2, -1], [2, 6], 'U_b')
    const after = snapshotOf(model, before)!
    restore(model, before)
    expect(storey().customZones!.map((z) => z.id)).toEqual(['U_a'])
    restore(model, after)
    expect(storey().customZones!.map((z) => z.id)).toEqual(['U_a', 'U_b'])
  })

  it('리포트에 오르고, 저장·불러오면 TTL·GeoJSON 이 같다. GeoJSON 에 다각형·품는 방·든 설비, TTL 에는 좌표가 없다', () => {
    const pristine = structuredClone(model)
    const base = baselineOf(model)
    make('임원석', rect(0, 6, 5, 10), 'U_exec')
    make('개발팀', rect(10, 0, 26, 10), 'U_team')
    renameCustomZone(model, 'U_team', '개발 1팀')
    expect(diffBaseline(model, base).customZones).toEqual([
      { id: 'U_exec', name: '임원석', change: 'added' },
      { id: 'U_team', name: '개발 1팀', change: 'added' },
    ])
    const file = exportEdits(model, base, 'x.ifc')
    expect(file.customZones).toHaveLength(1)
    const parsed = parseEditFile(JSON.stringify(file))
    if (typeof parsed === 'string') throw new Error(parsed)
    const fresh = structuredClone(pristine)
    applyEdits(fresh, parsed)
    expect(modelToTTL(fresh)).toBe(modelToTTL(model))
    expect(JSON.stringify(modelToGeoJSON(fresh))).toBe(JSON.stringify(modelToGeoJSON(model)))
    // 그 층이 없는 모델에 얹으면 못 찾은 것으로 센다.
    const elsewhere = structuredClone(pristine)
    Object.assign(elsewhere.storeys[0], { id: 'other', name: '다른 층' })
    expect(applyEdits(elsewhere, parsed).missing.spaces).toBeGreaterThan(0)

    const f = modelToGeoJSON(model)[0].collection.features.find((x) => x.id === 'U_team')!
    expect(f.geometry).toEqual({ type: 'Polygon', coordinates: [rect(10, 0, 26, 10)] })
    expect(f.properties).toMatchObject({ kind: 'customZone', name: '개발 1팀', spaceIds: ['meeting'], equipmentIds: ['fcu2', 'fcu3'] })
    const block = modelToTTL(model).split('\n\n').find((b) => b.startsWith('ex:U_team '))!
    expect(block).not.toMatch(/\d+\.\d+,|POLYGON|coordinates/)

    // 지우면 지운 것으로 오른다.
    deleteCustomZone(model, 'U_exec')
    const base2 = baselineOf(fresh)
    expect(diffBaseline(model, base2).customZones).toEqual([{ id: 'U_exec', name: '임원석', change: 'removed' }])
  })
})

describe('별명 여러 개 (2026-10-03 사용자 결정, ADR-0012)', () => {
  it('더 붙인 별명은 공백을 떼고, 빈 것·이름과 같은 것·겹친 것을 뺀다', () => {
    make('임원석', rect(0, 6, 5, 10), 'U_exec')
    expect(setCustomZoneAliases(model, 'U_exec', [' 임원 구역 ', '', '임원석', '경영진석', '임원 구역'])).toBe(true)
    expect(storey().customZones![0].aliases).toEqual(['임원 구역', '경영진석'])
    expect(setCustomZoneAliases(model, 'U_exec', ['임원 구역', '경영진석'])).toBe(false)
    expect(setCustomZoneAliases(model, 'U_exec', [])).toBe(true)
    expect('aliases' in storey().customZones![0]).toBe(false)
  })

  it('TTL 은 첫 이름이 rdfs:label, 나머지는 ex:alias 다. GeoJSON 은 aliases. 별명이 없으면 둘 다 그 줄·칸이 없다', () => {
    make('임원석', rect(0, 6, 5, 10), 'U_exec')
    make('개발팀', rect(10, 0, 26, 10), 'U_team')
    setCustomZoneAliases(model, 'U_exec', ['임원 구역', '경영진 "A"석'])
    const blocks = modelToTTL(model).split('\n\n')
    const exec = blocks.find((b) => b.startsWith('ex:U_exec '))!
    expect(exec).toContain('rdfs:label "임원석" ;')
    expect(exec).toContain('ex:alias "임원 구역", "경영진 \\"A\\"석" ;')
    expect(blocks.find((b) => b.startsWith('ex:U_team '))!).not.toContain('ex:alias')
    const features = modelToGeoJSON(model)[0].collection.features
    expect(features.find((f) => f.id === 'U_exec')!.properties.aliases).toEqual(['임원 구역', '경영진 "A"석'])
    expect('aliases' in features.find((f) => f.id === 'U_team')!.properties).toBe(false)
  })

  it('합치면 없어지는 존의 이름·별명이 합친 존의 별명으로 남는다', () => {
    make('A석', rect(0, 0, 5, 5), 'U_a')
    make('B석', rect(5, 0, 10, 5), 'U_b')
    setCustomZoneAliases(model, 'U_b', ['창가'])
    mergeCustomZones(model, 'U_a', 'U_b')
    expect(storey().customZones!.map((z) => [z.name, z.aliases])).toEqual([['A석', ['B석', '창가']]])
  })

  it('별명만 고쳐도 리포트에 오르고, 저장·불러오면 같고, 되돌리면 돌아온다', () => {
    make('임원석', rect(0, 6, 5, 10), 'U_exec')
    const pristine = structuredClone(model)
    const base = baselineOf(model)
    const before = snapshotCustomZones(model, 's1')!
    setCustomZoneAliases(model, 'U_exec', ['임원 구역'])
    expect(diffBaseline(model, base).customZones).toEqual([{ id: 'U_exec', name: '임원석', change: 'changed' }])
    const parsed = parseEditFile(JSON.stringify(exportEdits(model, base, 'x.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)
    const fresh = structuredClone(pristine)
    applyEdits(fresh, parsed)
    expect(modelToTTL(fresh)).toBe(modelToTTL(model))
    restore(model, before)
    expect('aliases' in storey().customZones![0]).toBe(false)
  })

  it('별명이 있는 존을 고친 뒤 되돌려도 별명이 남는다 — 되돌리기 사본이 별명까지 뜬다', () => {
    make('임원석', rect(0, 6, 5, 10), 'U_exec')
    setCustomZoneAliases(model, 'U_exec', ['임원 구역', '경영진석'])
    const before = snapshotCustomZones(model, 's1')!
    renameCustomZone(model, 'U_exec', '임원실')
    splitCustomZone(model, 'U_exec', [2.5, 5], [2.5, 11])
    restore(model, before)
    expect(storey().customZones!.map((z) => [z.name, z.aliases])).toEqual([['임원석', ['임원 구역', '경영진석']]])
  })
})

describe('설비 검색 — 든 커스텀존의 이름·별명으로 (ADR-0012)', () => {
  it('설비마다 든 존의 이름·별명 전부. 존 밖 설비는 없다', () => {
    make('임원석', rect(10, 0, 26, 10), 'U_exec')
    setCustomZoneAliases(model, 'U_exec', ['경영진석'])
    const names = zoneNamesOfEquipment(model)
    expect(names.get('fcu2')).toEqual(['임원석', '경영진석'])
    expect(names.get('fcu3')).toEqual(['임원석', '경영진석'])
    expect(names.has('fcu1')).toBe(false)
  })
})
