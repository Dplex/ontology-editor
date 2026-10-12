// 온톨로지 질의(ADR-0050)의 그래프 읽기와 질문 시험대. 입력은 픽스처 BIM 을 지금 코드로 내보낸 TTL 이다 —
// writer(ttl.ts)가 바뀌어도 이 읽기가 따라가는지 본다. 받는 쪽 보기는 read-ttl.ts 와 한 줄도 다르면 안 된다(규칙을 옮겨 적었다).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from '../src/lib/ifc/import'
import { mergeModels } from '../src/lib/merge'
import { modelToTTL } from '../src/lib/export/ttl'
import { readOntologyTTL } from '../src/lib/export/read-ttl'
// @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
import { describe as describeId, find, loadOntology, overview, parseTurtle, query, readReceiver, walk } from './onto-graph.mjs'
// @ts-expect-error — 위와 같다
import { benchOntology, score } from './onto-bench.mjs'

const ROOT = resolve(__dirname, '..')
const FIX = (f: string) => resolve(ROOT, 'src/lib/ifc/fixtures', f)
const DUPLEX = [resolve(ROOT, 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'), resolve(ROOT, 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc')]
let api: WebIFC.IfcAPI
const ttlOf = (...files: string[]) => {
  const models = files.map((f) => importIfc(api, new Uint8Array(readFileSync(f))))
  return modelToTTL(models.length > 1 ? mergeModels(models[0], models[1]).model : models[0])
}
let mep = ''

beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
  mep = ttlOf(FIX('mep.ifc'))
}, 60_000)

describe('TTL 읽기', () => {
  it('술어·목적어 목록·리터럴·이스케이프한 GlobalId 를 읽는다', () => {
    const { triples } = parseTurtle(mep)
    const ahu = 'ex:0MEP$Equip$AHU1$0000'
    const of = (s: string, p: string) => triples.filter((t: { s: string; p: string }) => t.s === s && t.p === p).map((t: { o: unknown }) => t.o)
    expect(of(ahu, 'a')).toEqual(['brick:Air_Handling_Unit'])
    expect(of(ahu, 'rdfs:label')).toEqual(['AHU-1'])
    expect(of(ahu, 'brick:feeds')).toHaveLength(3)
    expect(of(ahu, 'ex:nominalAirFlowRate')).toEqual([1.6667])
    expect(of('ex:0MEP$Space$Office$0000', 'ex:roomNumber')).toEqual(['101'])
  })

  it('받는 쪽 보기는 read-ttl.ts 와 같다 — 주어·클래스·이름·관계 넷', () => {
    for (const ttl of [mep, ttlOf(FIX('two-rooms.ifc'))]) {
      const ours = readReceiver(ttl)
      const theirs = readOntologyTTL(ttl)
      expect(ours.entities).toEqual(theirs.entities.map(({ source, ...e }) => e))
      expect(ours.unread.map((u: { key: string }) => u.key)).toEqual(theirs.unread.map((u) => u.key))
    }
  })

  it.skipIf(!DUPLEX.every(existsSync))('Duplex 건축+MEP: 트리플 수가 docs/ontology.md 의 측정과 같다(우리 5,082 · 받는 쪽 1,402)', () => {
    const ttl = ttlOf(...DUPLEX)
    const o = loadOntology(ttl)
    expect(o.full.triples.length).toBe(5082)
    expect(o.receiver.triples.length).toBe(1402)
    const ours = readReceiver(ttl)
    const theirs = readOntologyTTL(ttl)
    expect(ours.entities).toEqual(theirs.entities.map(({ source, ...e }) => e))
  }, 120_000)
})

describe('묻기', () => {
  it('패턴 질의 — 사무실에 있는 것, 그리고 같은 질의가 받는 쪽에서는 방번호로 안 잡힌다', () => {
    const o = loadOntology(mep)
    const inOffice = query(o.full, { patterns: [['?d', 'brick:hasLocation', '?r'], ['?r', 'rdfs:label', '"사무실"']], select: ['d'] })
    expect(inOffice.total).toBe(5)
    expect(inOffice.names['ex:0MEP$Equip$AHU1$0000']).toBe('AHU-1 · brick:Air_Handling_Unit')
    const byNumber = { patterns: [['?r', 'ex:roomNumber', '"101"']] }
    expect(query(o.full, byNumber).total).toBe(1)
    expect(query(o.receiver, byNumber).total).toBe(0)
    expect(query(o.full, { patterns: [['?e', 'a', 'brick:Air_Diffuser']], count: true }).count).toBe(2)
    expect(query(o.full, { patterns: [['?e', 'rdfs:label', '?n']], filters: [{ var: 'n', contains: 'at-101' }], count: true }).count).toBe(2)
    expect(query(o.full, { patterns: [] }).error).toBeTruthy()
  })

  it('이름으로 찾고, 관계를 보고, feeds 를 따라간다', () => {
    const o = loadOntology(mep)
    expect(find(o.full, 'ahu').results[0]).toMatchObject({ label: 'AHU-1', in: { label: '사무실' } })
    const d = describeId(o.full, 'AHU-1')
    expect(d.out['brick:hasLocation'][0].label).toBe('사무실')
    expect(d.in['brick:hasPart'].count).toBe(1) // 계통
    const w = walk(o.full, 'AHU-1', 'feeds')
    expect(w.levels[0].nodes.map((n: { label: string }) => n.label).sort()).toEqual(['AT-101-01', 'DUCT-01', '사무실'])
    // 받는 쪽도 덕트로 가는 feeds 는 읽지만 덕트(fso:) 주어는 버린다 — 이름·클래스 없는 끝점이 된다
    const recv = walk(o.receiver, 'AHU-1', 'feeds').levels[0].nodes
    expect(recv.find((n: { id: string }) => n.id === 'ex:0MEP$Duct$D01$00000')).toEqual({ id: 'ex:0MEP$Duct$D01$00000' })
    expect(overview(o.full).floors).toEqual([{ id: 'ex:0MEP$Storey$1F$00000', label: '1F', class: 'brick:Floor', spaces: 1 }])
  })
})

describe('질문 시험대', () => {
  it('mep: 공간·설비·흐름은 받는 쪽도 답하고, 면적·방번호는 우리 TTL 에만 있다', () => {
    const rows = benchOntology(mep)
    const v = Object.fromEntries(rows.map((r: { id: string; verdict: string }) => [r.id, r.verdict]))
    expect(v).toMatchObject({ Q1: '받는 쪽도 답함', Q3: '받는 쪽도 답함', Q4: '받는 쪽도 답함', Q7: '받는 쪽도 답함', Q8: '받는 쪽도 답함', Q9: '우리 TTL 만', Q10: '우리 TTL 만' })
    const q3 = rows.find((r: { id: string }) => r.id === 'Q3')
    expect(q3.text).toBe('AHU-1 은(는) 어느 방에 있어?')
    expect(q3.expect).toEqual(['사무실'])
  })

  it('gemini 답 채점 — 기대한 이름·수, Revit 이름은 요소 ID 로도, TTL 밖은 "없다"', () => {
    expect(score({ kind: 'value', expect: ['사무실'], verdict: '받는 쪽도 답함' }, 'AHU-1 은 사무실에 있습니다')).toBe(true)
    expect(score({ kind: 'count', expect: ['1170'], verdict: '받는 쪽도 답함' }, '모두 1,170개입니다')).toBe(true)
    expect(score({ kind: 'count', expect: ['117'], verdict: '받는 쪽도 답함' }, '모두 1170개')).toBe(false)
    expect(score({ kind: 'value', expect: ['M_VAV Unit:150 mm:150 mm:635405'], verdict: '받는 쪽도 답함' }, 'VAV(요소 635405)')).toBe(true)
    expect(score({ kind: 'none', expect: [], verdict: 'TTL 밖' }, '문 연결은 온톨로지에 없습니다(GeoJSON 몫)')).toBe(true)
  })
})
