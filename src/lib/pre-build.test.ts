// 생성 전 검증(OE-GEN-03)·feeds 에서 뺀 방향(OE-GEN-04). mep.ifc: 1F 사무실 하나, 좌표 없는 설비 TEMP-101-01.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { requirementsReport } from './requirements'
import { completenessChecks } from './checks'
import { gradeReport } from './grade'
import { generationReport } from './build-report'
import { modelToTTL } from './export/ttl'
import { readOntologyTTL } from './export/read-ttl'
import { isConduit, type Model } from './model'
import { blockingOf, feedsExcluded, preBuildChecks } from './pre-build'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const open = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
const report = (m: Model) => generationReport({ fileName: 'mep.ifc', model: m, grades: gradeReport(m), requirements: requirementsReport(m), checks: completenessChecks(m, []), at: '2026-10-14T00:00:00Z' })

describe('생성 전 검증 (OE-GEN-03)', () => {
  it('검증 항목 전부가 생성 리포트 ⑩ 에 수준과 함께 보인다 [OE-GEN-03#1]', () => {
    const m = open()
    const items = preBuildChecks(m, completenessChecks(m, []))
    expect(items.map((x) => x.key)).toEqual(['storey-spaces', 'room-number', 'no-coords', 'membership', 'hvac-zones', 'completeness', 'unconfirmed-flow'])
    const lines = report(m).find((s) => s.no === 10)!.lines
    for (const x of items) expect(lines.some((l) => l.includes(x.label))).toBe(true)
    expect(lines.find((l) => l.includes('좌표 없는 설비'))).toMatch(/^\[경고\].*TEMP-101-01/)
    expect(blockingOf(items)).toEqual([])
  })

  it('한 층 안에서 방번호가 겹치면 차단이고 까닭에 그 방번호가 보인다. 경고는 막지 않는다 [OE-GEN-03#2,3]', () => {
    const m = open()
    const st = m.storeys[0]
    st.spaces.push({ ...structuredClone(st.spaces[0]), id: 'DUP', longName: '복사한 방' })
    const blocks = blockingOf(preBuildChecks(m, completenessChecks(m, [])))
    expect(blocks.map((x) => x.key)).toEqual(['room-number'])
    expect(blocks[0].detail).toContain(`${st.name} ${st.spaces[0].name} ×2`)
    expect(report(m).find((s) => s.no === 10)!.lines[1]).toMatch(/^\[차단\] 한 층 안에서 방번호가 겹치지 않는다/)
    // 다른 층의 같은 방번호는 겹침이 아니다.
    const other = open()
    other.storeys.push({ ...structuredClone(other.storeys[0]), id: 'L2', name: '2F', equipment: [] })
    expect(blockingOf(preBuildChecks(other, []))).toEqual([])
  })

  it('물리존이 없는 층은 경고이고 막지 않는다(기초·지붕 레벨)', () => {
    const m = open()
    m.storeys.push({ ...structuredClone(m.storeys[0]), id: 'L2', name: '2F', spaces: [], equipment: [] })
    const items = preBuildChecks(m, [])
    expect(blockingOf(items)).toEqual([])
    expect(items.find((x) => x.key === 'storey-spaces')).toMatchObject({ level: 'warn', detail: '물리존이 없는 층 1개: 2F — TTL 에 층만 나갑니다' })
  })
})

describe('feeds 에서 뺀 방향 (OE-GEN-04)', () => {
  it('확정하지 않은·재검토 중인 규칙 방향은 feeds 에 없고, 뺀 수가 리포트와 같다. 확정하면 나가고 사람이 정한 방향이 규칙보다 앞선다 [OE-GEN-04#1]', () => {
    const m = open()
    const base = feedsExcluded(m)
    // 디퓨저 AT-101-01 과 공조기 AHU-1 을 방향 모르는 연결로 잇고, BIM 포트에는 없는 방향(디퓨저 → 공조기)의 규칙 방향을 단다.
    // mep.ifc 에는 설비끼리 바로 이은 연결이 없고, 공조기 → 디퓨저는 덕트를 건너 이미 feeds 로 나간다.
    const eq = m.storeys.flatMap((s) => s.equipment)
    const [a, b] = ['AT-101-01', 'AHU-1'].map((n) => eq.find((e) => e.name === n && !isConduit(e.role))!.id)
    const c = { ...structuredClone(m.connections[0]), from: a, to: b, directed: false }
    m.connections.push(c)
    c.inferred = { from: a, to: b, systemId: 'S', confirmed: false }
    const feedsOf = (mm: Model) => readOntologyTTL(modelToTTL(mm)).entities.find((e) => e.key === a)?.feeds ?? []
    const hasEdge = (mm: Model) => feedsOf(mm).some((t) => t.endsWith(b))
    expect(hasEdge(m)).toBe(false)
    expect(feedsExcluded(m)).toEqual({ ...base, unconfirmed: base.unconfirmed + 1 })
    expect(report(m).find((s) => s.no === 10)!.lines.find((l) => l.includes('feeds 에서 뺀 방향'))).toContain(`확정하지 않은 규칙 방향 ${base.unconfirmed + 1} · 재검토 중 ${base.recheck} · 해제 보정한 연결 ${base.released}`)
    // 재검토 중인 확정도 나가지 않는다.
    c.inferred = { from: a, to: b, systemId: 'S', confirmed: true, recheck: null }
    expect(hasEdge(m)).toBe(false)
    expect(feedsExcluded(m)).toEqual({ ...base, recheck: base.recheck + 1 })
    // 확정하면 나간다.
    c.inferred = { from: a, to: b, systemId: 'S', confirmed: true }
    expect(hasEdge(m)).toBe(true)
    expect(feedsExcluded(m)).toEqual(base)
    // 사람이 반대로 정하면 규칙보다 앞선다.
    c.edited = { from: b, to: a }
    expect(hasEdge(m)).toBe(false)
  })
})
