import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from '../ifc/import'
import { mergeModels } from '../merge'
import type { Model } from '../model'
import { escapeLocalName, modelToTTL } from './ttl'
import { ttlTriples as triples } from './read-export'
import { modelToGeoJSON } from './geojson'
import { storeyFiles } from './storey-export'
import { mergeReadings, readOntologyTTL } from './read-ttl'

// 층 하나만 낸 TTL(OE-GEN-11). 층 파일을 다 모으면 건물 전체 TTL 과 같은 트리플이어야 한다(ADR-0011).

const union = (sets: Set<string>[]) => new Set(sets.flatMap((s) => [...s]))
const ref = (id: string) => `ex:${escapeLocalName(id)}`
const subjects = (ttl: string) => new Set([...triples(ttl)].filter((t) => t.split(' ')[1] === 'a').map((t) => t.split(' ')[0]))

let merged: Model

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const load = (name: string) => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`../ifc/fixtures/${name}`, import.meta.url)))))
  merged = mergeModels(load('two-rooms.ifc'), load('mep.ifc')).model
}, 60_000)

describe('층 하나만 낸 TTL (OE-GEN-11)', () => {
  it('층 파일을 다 모으면 건물 전체 TTL 과 같은 트리플이다', () => {
    const whole = triples(modelToTTL(merged))
    const parts = merged.storeys.map((s) => triples(modelToTTL(merged, { storeyId: s.id })))
    expect([...union(parts)].sort()).toEqual([...whole].sort())
  })

  it('층·방·설비 블록은 제 층 파일에만 있고, 건물 블록은 그 층만 hasPart 로 가리킨다', () => {
    for (const storey of merged.storeys) {
      const ttl = modelToTTL(merged, { storeyId: storey.id })
      const mine = new Set([storey.id, ...storey.spaces.map((x) => x.id), ...storey.equipment.map((e) => e.id)].map(ref))
      const others = merged.storeys.filter((s) => s !== storey).flatMap((s) => [s.id, ...s.spaces.map((x) => x.id), ...s.equipment.map((e) => e.id)]).map(ref)
      expect(others.filter((id) => subjects(ttl).has(id))).toEqual([])
      expect([...mine].filter((id) => !subjects(ttl).has(id))).toEqual([])
      expect([...triples(ttl)].filter((t) => t.startsWith(`${ref(merged.buildingId)} brick:hasPart`))).toEqual([`${ref(merged.buildingId)} brick:hasPart ${ref(storey.id)}`])
    }
  })

  it('여러 층에 걸친 계통은 층마다 그 층 구성원만 hasPart 로 적고, 다른 층으로 가는 feeds 는 id 로 남긴다', () => {
    const m: Model = structuredClone(merged)
    // 계통 구성원 하나(흐름 방향을 아는 연결이 있는 것)를 다른 층으로 옮겨, 같은 계통이 두 층에 걸치고 흐름이 층을 넘게 만든다.
    const system = m.systems.find((s) => s.memberIds.length >= 2)!
    const all = m.storeys.flatMap((s) => s.equipment)
    const moved = all.find((e) => system.memberIds.includes(e.id) && m.connections.some((c) => c.directed && (c.from === e.id || c.to === e.id)))!
    const lower = m.storeys.find((s) => s.equipment.includes(moved))!
    const upper = m.storeys.find((s) => s !== lower)!
    lower.equipment = lower.equipment.filter((e) => e !== moved)
    upper.equipment.push({ ...moved, spaceId: null })
    const a = triples(modelToTTL(m, { storeyId: lower.id }))
    const b = triples(modelToTTL(m, { storeyId: upper.id }))
    const parts = (t: Set<string>) => [...t].filter((x) => x.startsWith(`${ref(system.id)} brick:hasPart`)).map((x) => x.split(' ')[2])
    expect(parts(b)).toEqual([ref(moved.id)])
    expect(parts(a)).not.toContain(ref(moved.id))
    expect(parts(a).length + parts(b).length).toBe(system.memberIds.length)
    expect(a.has(`${ref(system.id)} rdfs:label "${system.name}"`) && b.has(`${ref(system.id)} rdfs:label "${system.name}"`)).toBe(true)
    // 층을 넘는 흐름: 어느 쪽 블록이든 목적어는 다른 층 파일의 주어 id 다.
    const crossing = [...a, ...b].filter((t) => t.includes(' brick:feeds ') && (t.startsWith(ref(moved.id)) !== t.endsWith(ref(moved.id))))
    expect(crossing.length).toBeGreaterThan(0)
    expect([...union([a, b])].sort()).toEqual([...triples(modelToTTL(m))].sort())
  })

  it('어느 층에도 안 걸리는 것(구성원 없는 계통)은 맨 아래 층 파일에만 있다', () => {
    const m: Model = structuredClone(merged)
    m.systems.push({ ...m.systems[0], id: 'EMPTY_SYSTEM', name: '빈 계통', memberIds: [] })
    const where = m.storeys.filter((s) => subjects(modelToTTL(m, { storeyId: s.id })).has(ref('EMPTY_SYSTEM'))).map((s) => s.id)
    expect(where).toEqual([m.storeys[0].id])
  })

  it('공조존(IDF)은 제 층 파일에만 통째로 간다 — 층을 모르는 존은 맨 아래 층', () => {
    const m: Model = structuredClone(merged)
    const [f1, f2] = m.storeys
    const zone = (id: string, storeyId: string | null) => ({ id, name: id, storeyId, footprint: [], areaM2: 0, declaredAreaM2: null, spaceIds: [] })
    m.hvac = { source: 'x.idf', zones: [zone('ZONE_UP', f2.id), zone('ZONE_NOWHERE', null)], equipment: [] }
    const where = (id: string) => m.storeys.filter((s) => subjects(modelToTTL(m, { storeyId: s.id })).has(ref(id))).map((s) => s.id)
    expect(where('ZONE_UP')).toEqual([f2.id])
    expect(where('ZONE_NOWHERE')).toEqual([f1.id])
  })
})

describe('층 하나의 파일 한 쌍 (storeyFiles)', () => {
  it('GeoJSON 은 건물 전체로 낼 때의 그 층 파일과 같고, TTL 은 이름 줄기가 같다', () => {
    const all = modelToGeoJSON(merged)
    merged.storeys.forEach((s, i) => {
      const f = storeyFiles(merged, s.id)!
      expect(f.geojsonName).toBe(all[i].fileName)
      expect(f.geojson).toBe(JSON.stringify(all[i].collection, null, 2))
      expect(f.ttlName).toBe(all[i].fileName.replace('.geojson', '.ttl'))
      expect(f.ttl).toBe(modelToTTL(merged, { storeyId: s.id }))
    })
    expect(storeyFiles(merged, '없는 층')).toBeNull()
  })
})

describe('층 파일을 쌓아 읽기 (mergeReadings)', () => {
  it('같은 파일을 두 번 놓아도 관계가 겹치지 않는다', () => {
    const one = readOntologyTTL(modelToTTL(merged, { storeyId: merged.storeys[0].id }))
    const twice = mergeReadings([one, one])
    const rels = (r: typeof one) => r.entities.map((e) => [e.key, e.points, e.feeds, e.locations, e.parts]).sort()
    expect(rels(twice)).toEqual(rels(one))
  })

  it('층 파일을 다 합쳐 읽으면 건물 전체 TTL 을 읽은 것과 관계가 같다', () => {
    const sorted = (r: ReturnType<typeof readOntologyTTL>) =>
      r.entities
        .map((e) => ({ key: e.key, cls: e.cls, feeds: [...e.feeds].sort(), locations: [...e.locations].sort(), parts: [...e.parts].sort(), points: [...e.points].sort() }))
        .sort((a, b) => a.key.localeCompare(b.key))
    const whole = readOntologyTTL(modelToTTL(merged))
    const stacked = mergeReadings(merged.storeys.map((s) => readOntologyTTL(modelToTTL(merged, { storeyId: s.id }))))
    expect(sorted(stacked)).toEqual(sorted(whole))
    expect(stacked.unread.map((u) => u.key).sort()).toEqual(whole.unread.map((u) => u.key).sort())
  })
})
