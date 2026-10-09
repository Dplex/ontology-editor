// 반영 한 번에 올리는 파일(OE-WF-10·13, OE-SYNC-03, ADR-0037). 서버(layouts.ts)가 받는 이름과 같아야 하고, 공간 계층은 사이트 > 건물 > 층(높이 순) > 물리존이다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf } from './edit'
import { exportEdits } from './edit-file'
import { groupReport, layoutFiles, layoutSummary, newSince, REPORT_SECTIONS, spaceTree } from './layout-files'
import { REQUIRED, validFile } from '../server/layouts'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = () => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/two-rooms.ifc', import.meta.url)))))

describe('반영 파일', () => {
  it('서버가 받는 이름이고 꼭 있어야 하는 파일이 다 있다 [OE-SYNC-02#1~]', () => {
    const m = read()
    const files = layoutFiles(m, exportEdits(m, baselineOf(m), 'two-rooms.ifc'))
    expect(files.every((f) => validFile(f.name))).toBe(true)
    for (const name of REQUIRED) expect(files.some((f) => f.name === name)).toBe(true)
    expect(files.filter((f) => f.name.startsWith('geojson/'))).toHaveLength(m.storeys.length)
  })

  it('공간 계층은 사이트 > 건물 > 층(높이 순) > 물리존이다 [OE-SYNC-03#1~]', () => {
    const m = read()
    const tree = spaceTree(m)
    expect(tree.building).toEqual({ id: m.buildingId, name: m.buildingName })
    expect(tree.storeys.map((s) => s.elevation)).toEqual([...m.storeys.map((s) => s.elevation)].sort((a, b) => a - b))
    expect(tree.storeys.flatMap((s) => s.spaces).length).toBe(m.storeys.reduce((n, s) => n + s.spaces.length, 0))
    expect(layoutSummary(m, exportEdits(m, baselineOf(m), 'x')).edits).toBe(0)
  })

  it('반영 결과 리포트는 여섯 항목이 늘 있고 모르는 종류는 그 밖으로, 직전 버전에 없던 줄만 새로다 [OE-SYNC-04#1~]', () => {
    const now = groupReport([
      { kind: 'move', text: 'LIGHT: 사무실 → 복도' },
      { kind: 'release', text: '사람 지정 해제: AT 사무실 → 복도(설비 이동)' },
      { kind: 'pipe', text: 'AHU — DUCT: 연결했습니다' },
      { kind: 'weird', text: '종류 바뀜' },
    ])
    expect(now.map((x) => [x.kind, x.lines.length])).toEqual(REPORT_SECTIONS.map((x) => [x.kind, { move: 1, release: 1, pipe: 1, other: 1 }[x.kind as string] ?? 0]))
    const before = groupReport([{ kind: 'move', text: 'LIGHT: 사무실 → 복도' }])
    expect([...newSince(now, before)]).toEqual(['사람 지정 해제: AT 사무실 → 복도(설비 이동)', 'AHU — DUCT: 연결했습니다', '종류 바뀜'])
    expect(newSince(now, null).size).toBe(4)
    const m = read()
    const report = JSON.parse(layoutFiles(m, exportEdits(m, baselineOf(m), 'x'), now).find((f) => f.name === 'report.json')!.text)
    expect(report.sections).toEqual(now)
  })
})
