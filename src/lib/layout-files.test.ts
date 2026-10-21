// 반영 한 번에 올리는 파일(OE-WF-10·13, OE-SYNC-03, src/server/layouts.ts). 서버(layouts.ts)가 받는 이름과 같아야 하고, 공간 계층은 사이트 > 건물 > 층(높이 순) > 물리존이다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf, createSpace, renameEquipment, renameSpace } from './edit'
import { exportEdits } from './edit-file'
import { createZoneFromSpaces, zoneChecks } from './hvac-zone'
import { groupReport, layoutFiles, layoutSummary, newSince, REPORT_SECTIONS, spaceTree } from './layout-files'
import { REQUIRED, validFile } from '../server/layouts'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = () => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/two-rooms.ifc', import.meta.url)))))

describe('반영 파일', () => {
  it('서버가 받는 이름이고 꼭 있어야 하는 파일이 다 있다 [OE-SYNC-02#1]', () => {
    const m = read()
    const files = layoutFiles(m, exportEdits(m, baselineOf(m), 'two-rooms.ifc'))
    expect(files.every((f) => validFile(f.name))).toBe(true)
    for (const name of REQUIRED) expect(files.some((f) => f.name === name)).toBe(true)
    expect(files.filter((f) => f.name.startsWith('geojson/'))).toHaveLength(m.storeys.length)
  })

  it('공간 계층은 사이트 > 건물 > 층(높이 순) > 물리존이고, 편집 뒤 TTL·GeoJSON·공간 계층이 편집 결과와 같다 [OE-SYNC-01#1] [OE-SYNC-03#1] [OE-XPRD-03#1]', () => {
    const m = read()
    const base = baselineOf(m)
    const tree = spaceTree(m)
    expect(tree.building).toEqual({ id: m.buildingId, name: m.buildingName })
    expect(tree.storeys.map((s) => s.elevation)).toEqual([...m.storeys.map((s) => s.elevation)].sort((a, b) => a - b))
    expect(tree.storeys.flatMap((s) => s.spaces).length).toBe(m.storeys.reduce((n, s) => n + s.spaces.length, 0))
    expect(layoutSummary(m, exportEdits(m, base, 'x')).edits).toBe(0)

    renameSpace(m, m.storeys[0].spaces[0].id, '대회의실')
    createSpace(m, m.storeys[0].id, { name: '103', longName: '창고', footprint: [[12, 0], [16, 0], [16, 4], [12, 4]] })
    const files = layoutFiles(m, exportEdits(m, base, 'two-rooms.ifc'))
    const ttl = files.find((f) => f.name === 'ontology.ttl')!.text
    const geo = files.find((f) => f.name.startsWith('geojson/'))!.text
    const editedTree = JSON.parse(files.find((f) => f.name === 'tree.json')!.text)
    expect(ttl).toContain('rdfs:label "대회의실"')
    expect(ttl).toContain('rdfs:label "창고"')
    expect(geo).toContain('"longName":"대회의실"')
    expect(geo).toContain('"longName":"창고"')
    expect(editedTree.storeys[0].spaces.map((s: { longName: string }) => s.longName)).toContain('대회의실')
    expect(editedTree.storeys[0].spaces.map((s: { longName: string }) => s.longName)).toContain('창고')
  })

  it('반영 결과 리포트는 여섯 항목이 늘 있고 모르는 종류는 그 밖으로, 공조존 검증(Z-01~06·판정 불가)도 담기며 직전 버전에 없던 줄만 새로다 [OE-SYNC-04#1] [OE-SYNC-04#2] [OE-SYNC-04#3]', () => {
    const m = read()
    // 물리존 하나만 공조존에 넣고 새 물리존(창고)은 담당 공조존 없이 두어 Z-01·Z-03(판정 불가)·Z-04·Z-05 경고를 낸다.
    createSpace(m, m.storeys[0].id, { name: '103', longName: '창고', footprint: [[12, 0], [16, 0], [16, 4], [12, 4]] })
    createZoneFromSpaces(m, { spaceIds: [m.storeys[0].spaces[0].id], name: '공조존 1' })
    const checks = zoneChecks(m, { space: (id) => m.storeys.flatMap((s) => s.spaces).find((s) => s.id === id)?.longName ?? id, equipment: (id) => id }).checks.filter((c) => c.items.length)
    expect(checks.map((c) => c.rule)).toContain('Z-01')

    const now = groupReport([
      { kind: 'move', text: 'LIGHT: 사무실 → 복도' },
      { kind: 'release', text: '사람 지정 해제: AT 사무실 → 복도(설비 이동)' },
      { kind: 'pipe', text: 'AHU — DUCT: 연결했습니다' },
      { kind: 'other', text: '소속은 같고 좌표만 바뀐 설비 1대 (GeoJSON 위치): AHU-1' },
      ...checks.map((c) => ({ kind: 'zone', text: `${c.rule} ${c.text}: ${c.items.length}개 — ${c.items.map((x) => x.label).join(', ')}` })),
    ])
    expect(now.map((x) => [x.kind, x.lines.length])).toEqual(
      REPORT_SECTIONS.map((x) => [x.kind, { move: 1, zone: checks.length, release: 1, pipe: 1, other: 1 }[x.kind as string] ?? 0]),
    )
    expect(now.find((x) => x.kind === 'other')!.lines).toEqual(['소속은 같고 좌표만 바뀐 설비 1대 (GeoJSON 위치): AHU-1'])
    expect(now.find((x) => x.kind === 'zone')!.lines.some((l) => l.startsWith('Z-01 어느 공조존도 담당하지 않는 물리존:') && l.includes('창고'))).toBe(true)
    const before = groupReport([{ kind: 'move', text: 'LIGHT: 사무실 → 복도' }])
    expect(newSince(now, before).has('사람 지정 해제: AT 사무실 → 복도(설비 이동)')).toBe(true)
    expect(newSince(now, null).size).toBe(4 + checks.length)
    const report = JSON.parse(layoutFiles(m, exportEdits(m, baselineOf(m), 'x'), now).find((f) => f.name === 'report.json')!.text)
    expect(report.sections).toEqual(now)
    expect(typeof renameEquipment).toBe('function')
  })
})
