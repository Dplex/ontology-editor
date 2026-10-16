import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from '../ifc/import'
import { isConduit, type Model } from '../model'
import { clauses, entityExport, exportIndex, nameIn, type ExportIndex } from './entity-export'
import { modelToGeoJSON } from './geojson'
import { modelToTTL } from './ttl'

let rooms: Model
let mep: Model
const indexOf = (m: Model): ExportIndex => exportIndex(modelToTTL(m), modelToGeoJSON(m))

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const load = (name: string) => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`../ifc/fixtures/${name}`, import.meta.url)))))
  rooms = load('two-rooms.ifc')
  mep = load('mep.ifc')
}, 60_000)

describe('clauses', () => {
  it('문자열 안의 세미콜론에서 자르지 않고 끝의 마침표를 뗀다', () => {
    expect(clauses('ex:A a brick:Room ;\n    rdfs:label "회의실; 2" ;\n    ex:areaM2 12 .')).toEqual(['ex:A a brick:Room', 'rdfs:label "회의실; 2"', 'ex:areaM2 12'])
  })
  it('이스케이프한 따옴표는 문자열을 닫지 않는다', () => {
    expect(clauses('ex:A a brick:Pump ;\n    rdfs:label "DN50:3/4\\"; x" .')).toEqual(['ex:A a brick:Pump', 'rdfs:label "DN50:3/4\\"; x"'])
  })
})

describe('entityExport', () => {
  it('방은 받는 쪽이 읽는 블록이고, 층의 hasPart 가 가리키며, 방 번호·면적은 받는 쪽이 버린다', () => {
    const index = indexOf(rooms)
    const storey = rooms.storeys[0]
    const space = storey.spaces[0]
    const x = entityExport(index, space.id)
    expect(x.ttl).toBe('read')
    expect(x.cls).toMatch(/^brick:/)
    expect(x.incoming).toContainEqual({ predicate: 'hasPart', from: [storey.id] })
    expect(x.dropped.some((c) => c.startsWith('ex:roomNumber'))).toBe(true)
    expect(x.dropped.some((c) => c.startsWith('ex:areaM2'))).toBe(true)
    // 받는 쪽이 읽는 절(이름)은 버리는 목록에 들지 않는다.
    expect(x.dropped.some((c) => c.startsWith('rdfs:label'))).toBe(false)
    expect(x.feature?.feature.properties.kind).toBe('space')
    expect(x.feature?.fileName).toMatch(/^floor-.*\.geojson$/)
  })

  it('층은 건물의 부분이고 방들을 hasPart 로 가진다', () => {
    const index = indexOf(rooms)
    const storey = rooms.storeys[0]
    const x = entityExport(index, storey.id)
    expect(x.incoming).toContainEqual({ predicate: 'hasPart', from: [rooms.buildingId] })
    expect(x.out.find((r) => r.predicate === 'hasPart')?.to).toEqual(expect.arrayContaining(storey.spaces.map((s) => s.id)))
    expect(x.dropped).toContain(`ex:elevation ${storey.elevation}`)
    // 층은 GeoJSON feature 가 아니라 층 파일 그 자체다.
    expect(x.feature).toBeNull()
  })

  it('벽은 TTL 에 없고 GeoJSON 에만 있다', () => {
    const index = indexOf(rooms)
    const wall = rooms.storeys.flatMap((s) => s.walls)[0]
    const x = entityExport(index, wall.id)
    expect(x.ttl).toBe('absent')
    expect(x.source).toBeNull()
    expect(x.feature?.feature.properties.kind).toBe('wall')
  })

  it('기기는 hasLocation 으로 방이나 층을 가리키고, 계통이 hasPart 로 가리킨다', () => {
    const index = indexOf(mep)
    const all = mep.storeys.flatMap((s) => s.equipment)
    const device = all.find((e) => !isConduit(e.role) && e.systemId)!
    const x = entityExport(index, device.id)
    expect(x.ttl).toBe('read')
    expect(x.out.find((r) => r.predicate === 'hasLocation')?.to).toEqual([device.spaceId ?? mep.storeys.find((s) => s.equipment.includes(device))!.id])
    expect(x.incoming.find((r) => r.predicate === 'hasPart')?.from).toContain(device.systemId)
    expect(x.dropped.some((c) => c.startsWith('ex:ifcClass'))).toBe(true)
  })

  it('덕트·배관은 TTL 에 나가지만 받는 쪽이 읽지 않고, 그 블록의 관계는 다른 엔티티의 들어오는 관계로 세지 않는다', () => {
    const index = indexOf(mep)
    const conduit = mep.storeys.flatMap((s) => s.equipment).find((e) => isConduit(e.role))!
    const x = entityExport(index, conduit.id)
    expect(x.ttl).toBe('unread')
    expect(x.cls).toMatch(/^fso:/)
    expect(x.out).toEqual([])
    // 읽지 않는 블록은 관계까지 통째로 버려지므로, 그 줄을 다 "버림" 으로 보인다.
    expect(x.dropped.some((c) => c.startsWith('brick:hasLocation'))).toBe(true)
    for (const list of index.incoming.values()) expect(list.some((r) => r.from === conduit.id)).toBe(false)
  })

  it('이름은 rdfs:label 에서, 없으면 GeoJSON name 에서 가져온다', () => {
    const index = indexOf(rooms)
    const space = rooms.storeys[0].spaces[0]
    expect(nameIn(index, space.id)).toBe(space.longName || space.name)
    const wall = rooms.storeys.flatMap((s) => s.walls)[0]
    expect(nameIn(index, wall.id)).toBe(String(entityExport(index, wall.id).feature?.feature.properties.name ?? wall.id))
    expect(nameIn(index, 'no-such-id')).toBe('no-such-id')
  })
})
