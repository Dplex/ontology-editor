// 반영 한 번에 올리는 파일(OE-WF-10·13, OE-SYNC-03, ADR-0037). 서버(layouts.ts)가 받는 이름과 같아야 하고, 공간 계층은 사이트 > 건물 > 층(높이 순) > 물리존이다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf } from './edit'
import { exportEdits } from './edit-file'
import { layoutFiles, layoutSummary, spaceTree } from './layout-files'
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
})
