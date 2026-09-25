import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { CAPACITY_PROPERTIES } from './capacity'
import { EQUIPMENT_KINDS, SYSTEM_IFC } from './kinds'

// docs/requirements.ids 는 정본(docs/bim-to-dt-ontology.md 4장)과 이름 사전(kinds.ts)·용량 표(capacity.ts)를 고객사가
// 검사할 수 있게 옮긴 사본이다. 사본이 어긋나는 두 가지를 여기서 막는다.
//
// 1. 등급. 두 곳에 나눠 두었다가 같은 항목이 한쪽은 필수, 다른 쪽은 권장이 된 적이 있다.
// 2. 어휘. IDS 가 허용한 이름을 우리가 못 읽으면, IDS 를 지킨 파일에서 종류·방향·용량이 빈다.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const ids = read('../../docs/requirements.ids')

function levelsInDoc(): Map<string, string> {
  const doc = read('../../docs/bim-to-dt-ontology.md')
  const section = (from: string, to: string) => doc.slice(doc.indexOf(from), doc.indexOf(to))
  const out = new Map<string, string>()
  for (const [level, text] of [
    ['필수', section('### 4.1 필수', '### 4.2 권장')],
    ['권장', section('### 4.2 권장', '### 4.3')],
  ]) {
    for (const m of text.matchAll(/^\| (R\d+) \|/gm)) out.set(m[1], level)
  }
  return out
}

/** 명세 하나: 이름, 적용 대상(applicability)과 요구(requirements)의 XML. */
function specs(prefix: string): { name: string; applicability: string; requirements: string }[] {
  return [...ids.matchAll(/<specification name="([^"]+)"[^>]*>([\s\S]*?)<\/specification>/g)]
    .filter((m) => m[1].includes(prefix))
    .map((m) => ({
      name: m[1],
      applicability: /<applicability[\s\S]*?<\/applicability>/.exec(m[2])?.[0] ?? '',
      requirements: /<requirements>[\s\S]*?<\/requirements>/.exec(m[2])?.[0] ?? '',
    }))
}

const enumerations = (xml: string) => [...xml.matchAll(/<xs:enumeration value="([^"]+)"\/>/g)].map((m) => m[1])
const simpleValues = (xml: string) => [...xml.matchAll(/<simpleValue>([^<]+)<\/simpleValue>/g)].map((m) => m[1])

/** IFC4·IFC4X3 의 표준 열거값. USERDEFINED·NOTDEFINED 는 뺀다. */
function standardValues(cls: string): Set<string> {
  const out = new Set<string>()
  for (const schema of [(WebIFC as any).IFC4, (WebIFC as any).IFC4X3]) {
    for (const v of Object.keys(schema?.[`Ifc${cls}TypeEnum`] ?? {})) out.add(v)
  }
  out.delete('USERDEFINED')
  out.delete('NOTDEFINED')
  return out
}

describe('requirements.ids', () => {
  it('정본 4장의 R 번호를 같은 등급으로 옮긴다', () => {
    const doc = levelsInDoc()
    const inIds = [...ids.matchAll(/<specification name="\[(필수|권장)\] (R\d+) /g)].map((m) => [m[2], m[1]])
    expect(doc.size).toBeGreaterThan(20)
    expect(inIds.length).toBeGreaterThan(20)
    for (const [r, level] of inIds) expect([r, doc.get(r)]).toEqual([r, level])
  })

  it('R25 의 설비 종류는 kinds.ts 의 ifc 표와 같은 어휘다', () => {
    // kinds.ts 에서 `클래스.값` 꼴로 종류가 정해지는 클래스. 클래스만으로 정해지는 것(Boiler …)은 요구하지 않는다.
    const byClass = new Map<string, Set<string>>()
    for (const k of EQUIPMENT_KINDS) {
      for (const t of k.ifc ?? []) {
        const dot = t.indexOf('.')
        if (dot < 0) continue
        const cls = t.slice(0, dot)
        byClass.set(cls, (byClass.get(cls) ?? new Set()).add(t.slice(dot + 1)))
      }
    }

    const r25 = specs('R25 설비 종류')
    const idsClasses = r25.map((s) => simpleValues(s.applicability)[0])
    expect(new Set(idsClasses)).toEqual(new Set([...byClass.keys()].map((c) => `IFC${c.toUpperCase()}`)))

    for (const [cls, ours] of byClass) {
      const spec = r25.find((s) => simpleValues(s.applicability)[0] === `IFC${cls.toUpperCase()}`)!
      const allowed = new Set(enumerations(spec.requirements))
      const standard = standardValues(cls)
      expect(standard.size).toBeGreaterThan(0)
      // 우리가 읽는 이름은 IDS 가 허용해야 한다.
      for (const v of ours) expect([cls, v, allowed.has(v)]).toEqual([cls, v, true])
      // IDS 가 허용한 것 중 표준이 아닌 것(우리가 정한 USERDEFINED 이름)은 우리가 읽어야 한다.
      for (const v of allowed) if (!standard.has(v)) expect([cls, v, ours.has(v)]).toEqual([cls, v, true])
    }
  })

  it('R17 의 계통 약어는 kinds.ts 의 SYSTEM_IFC 와 같다', () => {
    const [kind, air, water] = ['R17 계통 종류', 'R17 공기 계통', 'R17 물 계통'].map((p) => specs(p)[0])
    expect(kind && air && water).toBeTruthy()
    expect(new Set(enumerations(air.requirements))).toEqual(new Set(Object.keys(SYSTEM_IFC.air.codes)))
    expect(new Set(enumerations(water.requirements))).toEqual(new Set(Object.keys(SYSTEM_IFC.water.codes)))
    for (const p of enumerations(air.applicability)) expect(SYSTEM_IFC.air.predefined).toContain(p)
    for (const p of enumerations(water.applicability)) expect(SYSTEM_IFC.water.predefined).toContain(p)
    // 약어 없이 PredefinedType 만으로 정해지는 것은 계통 종류 명세가 허용해야 한다.
    const allowed = new Set(enumerations(kind.requirements))
    for (const p of Object.keys(SYSTEM_IFC.alone)) expect(allowed.has(p)).toBe(true)
  })

  it('R22 의 용량 속성은 capacity.ts 가 읽는 이름이다', () => {
    const ours = new Set(CAPACITY_PROPERTIES.map((p) => p.name))
    const names = specs('R22').flatMap((s) => {
      const base = /<baseName>([\s\S]*?)<\/baseName>/.exec(s.requirements)?.[1] ?? ''
      return [...simpleValues(base), ...enumerations(base)]
    })
    expect(names.length).toBeGreaterThan(5)
    for (const n of names) expect([n, ours.has(n)]).toEqual([n, true])
  })
})
