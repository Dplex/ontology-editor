import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// docs/ontology.md 는 "우리 온톨로지가 무엇인가" 의 정의다(ADR-0049). 그 표가 내보내기 코드와 어긋나면 정의가 거짓이 된다 —
// 코드에서 술어·feature 종류·네임스페이스를 더하거나 빼면 여기서 걸리고, 같은 PR 에서 문서 표를 고친다.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')
const doc = read('../../docs/ontology.md')
const ttl = read('./export/ttl.ts')
const capacity = read('./capacity.ts')
const geojson = read('./export/geojson.ts')
const section = (title: string) => (doc.split(`\n### ${title}\n`)[1] ?? '').split(/\n#{2,3} /)[0]

describe('docs/ontology.md 가 내보내기 코드와 같다', () => {
  it('TTL 접두사와 네임스페이스', () => {
    const prefixes = [...ttl.matchAll(/'@prefix (\w+): <([^>]+)> \.'/g)].map((m) => [m[1], m[2]])
    expect(prefixes.map(([p]) => p)).toEqual(['brick', 'fso', 'ex', 'rdfs'])
    for (const [, iri] of prefixes.filter(([p]) => p === 'ex')) expect(doc, `ex: 네임스페이스 ${iri}`).toContain(iri)
  })

  it('코드가 내는 ex: 술어가 술어 표에 다 있고, 표에는 코드에 없는 ex: 술어가 없다', () => {
    const code = new Set([...`${ttl}\n${capacity}`.matchAll(/\bex:([a-z][A-Za-z0-9]*)\b/g)].map((m) => `ex:${m[1]}`))
    const table = section('TTL 술어')
    const listed = new Set([...table.matchAll(/`(ex:[a-z][A-Za-z0-9]*)`/g)].map((m) => m[1]))
    expect(code.size).toBeGreaterThan(10)
    expect([...code].filter((p) => !listed.has(p)), '문서 표에 없는 술어').toEqual([])
    expect([...listed].filter((p) => !code.has(p)), '코드가 내지 않는 술어').toEqual([])
  })

  it('GeoJSON feature 종류가 표에 다 있다 — 문·창은 opening.kind 로 나온다', () => {
    const kinds = new Set([...geojson.matchAll(/kind: '([a-zA-Z]+)'/g)].map((m) => m[1]))
    expect(geojson).toContain('kind: opening.kind')
    for (const k of ['door', 'window']) kinds.add(k)
    const table = section('GeoJSON feature')
    const rows = [...table.matchAll(/^\| (.+?) \|/gm)].slice(1) // 첫 줄은 머리(`kind` | 형상 | …)
    const listed = new Set(rows.flatMap((m) => [...m[1].matchAll(/`([a-zA-Z]+)`/g)].map((x) => x[1])))
    expect([...kinds].filter((k) => !listed.has(k)), '문서 표에 없는 kind').toEqual([])
    expect([...listed].filter((k) => !kinds.has(k)), '코드가 내지 않는 kind').toEqual([])
  })

  it('hasPoint 는 내지 않는다 — 문서가 그렇게 말한다', () => {
    expect(ttl).not.toMatch(/push\([^)]*brick:hasPoint/)
    expect(section('TTL 술어')).toMatch(/`brick:hasPoint` \|[^\n]*우리는 내지 않는다/)
  })
})
