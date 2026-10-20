// 미리보기 변경 요약(OE-WF-08). mep.ifc 1F 사무실(10×8)을 x=5 에서 나누면 "분할 1" 과 소속이 바뀐 설비 수가 보인다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { createSpace, mergeSpaces, moveEquipment, splitSpace, summarize, type Change } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { baselineOf } from './edit'
import { previewSummary, publishBrief, summaryText } from './preview'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = () => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))

describe('미리보기 변경 요약 (OE-WF-08 · OE-WF-12)', () => {
  it('물리존 하나를 나누면 분할 1 과 소속이 바뀐 설비 수가 보이고 넓이 합은 그대로다 [OE-WF-08#1] [OE-WF-08#3] [OE-WF-12#2]', () => {
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
    // 물리존별로 나가는 설비 수와 들어오는 설비 수가 나뉘어 집계된다(OE-WF-08#3).
    const fromOffice = s.bySpace.find((x) => x.spaceId === office.id)!
    const toPiece = s.bySpace.find((x) => x.spaceId === done.created[0])!
    expect(fromOffice.outCount).toBe(moves.filter((x) => x.fromSpaceId === office.id && x.fromSpaceId !== x.toSpaceId).length)
    expect(toPiece.inCount).toBe(moves.filter((x) => x.toSpaceId === done.created[0] && x.fromSpaceId !== x.toSpaceId).length)
    expect(toPiece.inCount).toBeGreaterThan(0)
    // 반영 확인 팝업의 3가지 수치(영향 받는 층 수, 바뀌는 물리존 수 합, 전체 사이트 소속 변경 설비 수)가 미리보기 요약과 일치한다(OE-WF-12#2).
    expect(publishBrief(s)).toEqual({
      affectedStoreyCount: s.affectedStoreys.length,
      changedSpaces: s.created + s.removed + s.split + s.merged,
      movedEquipment: s.moved,
    })
  })

  it('여러 층을 고치면 영향 받는 층 목록이 보이고, 면적 변화와 소속 변경 설비 수가 층·건물·전체 사이트별로 일치한다 [OE-WF-08#2] [OE-WF-12#2]', () => {
    const before = read()
    // 2층을 더해 두 층 모델을 만든다.
    const f2 = structuredClone(before.storeys[0])
    f2.id = 'storey-2f'
    f2.name = '2F'
    f2.elevation = 4
    f2.spaces[0].id = 'space-2f'
    f2.spaces[0].name = '201'
    f2.spaces[0].longName = '2층 사무실'
    f2.equipment = f2.equipment.map((eq, i) => ({
      ...eq,
      id: `${eq.id}-2f-${i}`,
      name: `${eq.name}-2F`,
      spaceId: eq.spaceId ? 'space-2f' : null,
      position: eq.position ? [eq.position[0], eq.position[1], eq.position[2] + 4] : null,
    }))
    before.storeys.push(f2)

    const m = structuredClone(before)
    // 1F: 물리존 하나를 새로 그려 면적 +16㎡, AHU-1 을 방 밖으로 이동(소속 변경 1대).
    createSpace(m, m.storeys[0].id, { name: '102', longName: '창고', footprint: [[12, 0], [16, 0], [16, 4], [12, 4]] })
    const mv1 = moveEquipment(m, m.storeys[0].equipment.find((e) => e.name === 'AHU-1')!.id, [30, 30, 1])!
    // 2F: 방을 분할하고 LIGHT-101-01-2F 를 방 밖으로 이동.
    const split2 = splitSpace(m, 'space-2f', [5, -1], [5, 9])
    if (!split2 || 'refused' in split2) throw new Error('2F 나누지 못함')
    const mv2 = moveEquipment(m, m.storeys[1].equipment.find((e) => e.name === 'LIGHT-101-01-2F')!.id, [30, 30, 5])!

    const moves = summarize([mv1, ...(split2.equipment as Change[]), mv2])
    const s = previewSummary(before, m, moves, 1)
    expect(s.affectedStoreys.map((x) => x.storeyName)).toEqual(['1F', '2F'])
    expect(s.byStorey).toHaveLength(2)
    expect(s.byBuilding).toHaveLength(1)

    // 층 수의 합 == 건물 수 == 전체 사이트 수
    const sumStoreyMoved = s.byStorey.reduce((n, st) => n + st.moved, 0)
    const sumBuildingMoved = s.byBuilding.reduce((n, b) => n + b.moved, 0)
    expect(sumStoreyMoved).toBe(sumBuildingMoved)
    expect(sumBuildingMoved).toBe(s.moved)

    const sumStoreyDelta = s.byStorey.reduce((n, st) => n + st.area.delta, 0)
    const sumBuildingDelta = s.byBuilding.reduce((n, b) => n + b.area.delta, 0)
    expect(sumStoreyDelta).toBeCloseTo(sumBuildingDelta, 6)
    expect(sumBuildingDelta).toBeCloseTo(s.area.after - s.area.before, 6)
    expect(s.byStorey[0].area.delta).toBeCloseTo(16, 6)
    expect(s.byStorey[1].area.delta).toBeCloseTo(0, 6)
    expect(publishBrief(s)).toEqual({
      affectedStoreyCount: 2,
      changedSpaces: s.created + s.removed + s.split + s.merged,
      movedEquipment: s.moved,
    })
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
