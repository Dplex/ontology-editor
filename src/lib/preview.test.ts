// 미리보기 변경 요약(OE-WF-08). mep.ifc 1F 사무실(10×8)을 x=5 에서 나누면 "분할 1" 과 소속이 바뀐 설비 수가 보인다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { mergeSpaces, splitSpace, summarize, type Change } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { baselineOf } from './edit'
import { previewSummary, summaryText } from './preview'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = () => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))

describe('미리보기 변경 요약 (OE-WF-08)', () => {
  it('물리존 하나를 나누면 분할 1 과 소속이 바뀐 설비 수가 보이고 넓이 합은 그대로다 [OE-WF-08#1]', () => {
    const before = read()
    const m = structuredClone(before)
    const office = m.storeys[0].spaces[0]
    const done = splitSpace(m, office.id, [5, -1], [5, 9])
    if (!done || 'refused' in done) throw new Error('나누지 못함')
    const moves = summarize(done.equipment as Change[])
    const s = previewSummary(before, m, moves, 0)
    expect([s.created, s.split, s.removed, s.merged, s.moved]).toEqual([0, 1, 0, 0, moves.filter((x) => x.fromSpaceId !== x.toSpaceId).length])
    expect(s.moved).toBeGreaterThan(0)
    expect(s.area.after).toBeCloseTo(s.area.before, 6)
    expect(summaryText(s)).toContain('분할 1')
    expect(summaryText(s)).toContain(`소속 변경 설비 ${s.moved}`)
  })

  it('나눈 조각 표시는 편집 파일을 거쳐도 남는다(새로 연 모델에서도 분할로 센다)', () => {
    const before = read()
    const m = structuredClone(before)
    const done = splitSpace(m, m.storeys[0].spaces[0].id, [5, -1], [5, 9])
    if (!done || 'refused' in done) throw new Error('나누지 못함')
    const file = parseEditFile(JSON.stringify(exportEdits(m, baselineOf(before), 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = read()
    applyEdits(again, file)
    expect(previewSummary(read(), again, [], 0).split).toBe(1)
  })

  it('나눈 둘을 다시 합치면 합친 것은 병합으로 센다', () => {
    const before = read()
    const m = structuredClone(before)
    const office = m.storeys[0].spaces[0]
    const done = splitSpace(m, office.id, [5, -1], [5, 9])
    if (!done || 'refused' in done) throw new Error('나누지 못함')
    // 원래 방(BIM)을 조각에 합치면 원래 방이 없어진다 — 병합 1, 분할 1(조각은 남음).
    const merged = mergeSpaces(m, done.created[0], office.id)
    expect(merged && !('refused' in merged)).toBe(true)
    const s = previewSummary(before, m, [], 0)
    expect([s.split, s.merged, s.removed]).toEqual([1, 1, 0])
  })
})
