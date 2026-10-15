import { describe, expect, it } from 'vitest'
import type { Model, Space, Storey, Vec2 } from './model'
import { createVertical, moveVertical, planFlight, setEscalatorDirection } from './vertical-edit'
import { anchoredFlight, linkCandidates, linkFeatures, linkStatus, nearestCandidate, relinkShift, unlink, verticalLinks } from './vertical-link'
import { baselineOf, restore, snapshotVerticals } from './edit'
import { applyEdits, exportEdits, parseEditFile, type EditFile } from './edit-file'
import { modelToGeoJSON } from './export/geojson'

// 세 층(0 · 4.5 · 9m) 건물에 물리존 하나씩. 계단 길이는 층고 4.5m ÷ tan 34° = 6.672m.
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const space = (id: string): Space => ({ id, name: id, longName: id, footprint: rect(-20, -20, 20, 20), areaM2: 1600, boundedBy: [], kind: 'office' }) as Space
const storey = (id: string, elevation: number): Storey => ({ id, name: id, elevation, spaces: [space(`s${id}`)], walls: [], openings: [], equipment: [] })
const model = (): Model => ({ schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys: [storey('1F', 0), storey('2F', 4.5), storey('3F', 9)], systems: [], connections: [], warnings: [] })

/** 시작 층·시작점·방위로 계단(ES)을 만든다. `link` 면 그 조각에 연속 연결을 적는다. */
function flight(m: Model, id: string, kind: 'stair' | 'escalator', from: string, at: Vec2, heading: number, link?: { continuesFrom?: string; continuesTo?: string }) {
  const f = planFlight(m, kind, from, at, heading)
  if ('refused' in f) throw new Error(f.refused)
  expect(createVertical(m, { id, kind, name: id, from, to: f.to.id }, new Map([[from, { footprint: f.footprint, entry: f.entry }], [f.to.id, { exit: f.exit }]]))).toEqual({ id })
  if (kind === 'escalator') setEscalatorDirection(m, id, 'up')
  if (link?.continuesFrom) m.storeys.find((s) => s.id === from)!.verticalParts!.find((p) => p.parentId === id)!.continuesFrom = link.continuesFrom
  if (link?.continuesTo) m.storeys.find((s) => s.id === f.to.id)!.verticalParts!.find((p) => p.parentId === id)!.continuesTo = link.continuesTo
  return f
}

describe('이어 놓기 (OE-ML-06 AC4 · OE-ML-19 AC8)', () => {
  it('아래 구간이 끝나는 층에서 시작하면 그 끝점이 시작점 후보이고, 커서로 방향을 정하면 이어진 구간 방향 ±8° 와 건물 축 ±3° 에 붙는다 [OE-ML-06#4~]', () => {
    const m = model()
    flight(m, 'A', 'stair', '1F', [0, 0], 90)
    const cands = linkCandidates(m, 'stair', '2F', null)
    expect(cands).toEqual([expect.objectContaining({ kind: 'start', parentId: 'A', at: [0, 6.672] })])
    // 고정 거리 1m 안이면 고정한다.
    expect(nearestCandidate(cands, [0.5, 7])?.parentId).toBe('A')
    expect(nearestCandidate(cands, [2, 7])).toBeNull()
    // 커서를 95° 쪽에 두면 건물 축(±3°)에는 안 붙고 이어진 구간 방향 90°(±8°)에 붙는다. 시작점은 고정점 그대로다.
    const r = (95 * Math.PI) / 180
    const a = anchoredFlight(m, 'stair', '2F', cands[0], [Math.cos(r) * 5, 6.672 + Math.sin(r) * 5])!
    expect(a).toMatchObject({ at: [0, 6.672], heading: 90, by: '이어진 구간 방향' })
    // Alt 면 붙지 않는다.
    expect(anchoredFlight(m, 'stair', '2F', cands[0], [Math.cos(r) * 5, 6.672 + Math.sin(r) * 5], true)!.heading).toBeCloseTo(95, 0)
    // 반대 방향(꺾어 오르기)에도 붙는다.
    expect(anchoredFlight(m, 'stair', '2F', cands[0], [0.4, 1])!).toMatchObject({ heading: 270, by: '꺾어 오르기(반대 방향)' })
  })

  it('위 구간이 시작하는 층의 아래층에서 만들면 그 시작점이 끝점 후보이고, 시작점은 커서 쪽에 길이만큼 떨어져 놓인다 [OE-ML-06#4~]', () => {
    const m = model()
    flight(m, 'B', 'stair', '2F', [5, 5], 0)
    const cand = linkCandidates(m, 'stair', '1F', null).find((c) => c.kind === 'end')!
    expect(cand).toMatchObject({ parentId: 'B', at: [5, 5] })
    // 커서를 고정점의 -x 쪽에 두면 구간은 +x(0°)로 오르고, 시작점은 고정점에서 길이만큼 -x 다.
    const a = anchoredFlight(m, 'stair', '1F', cand, [-3, 5.1])!
    expect(a.heading).toBe(0)
    expect(a.at).toEqual([+(5 - a.length).toFixed(3), 5])
  })

  it('이어 놓은 연결은 같은 층·같은 자리면 유효하고, 옮기면 어긋남으로 재검토가 되며 다시 붙이면 돌아온다. 이미 이어진 지점은 후보에서 빠진다 [OE-ML-19#8] [OE-ML-07#6]', () => {
    const m = model()
    flight(m, 'A', 'stair', '1F', [0, 0], 90)
    flight(m, 'B', 'stair', '2F', [0, 6.672], 90, { continuesFrom: 'A' })
    const [link] = verticalLinks(m)
    expect(link).toEqual({ lower: 'A', upper: 'B', storeyId: '2F' })
    expect(linkStatus(m, link)).toEqual({ ok: true, at: [0, 6.672, 4.5] })
    expect(linkCandidates(m, 'stair', '2F', null)).toEqual([])

    moveVertical(m, 'B', [0.5, 0])
    expect(linkStatus(m, link)).toMatchObject({ ok: false, why: '지점이 0.50m 어긋났습니다' })
    expect(relinkShift(m, link, 'upper')).toEqual([-0.5, 0])
    moveVertical(m, 'B', relinkShift(m, link, 'upper')!)
    expect(linkStatus(m, link).ok).toBe(true)

    // 아래 구간을 지우면 이어진 구간이 없어 재검토다.
    expect(unlink(m, link)).toBe(true)
    expect(verticalLinks(m)).toEqual([])
  })

  it('ES 는 같은 운행 방향끼리만 후보가 되고, 이어진 ES 한쪽의 방향을 바꾸면 재검토가 된다 [OE-ML-11#6] [OE-ML-19#8]', () => {
    const m = model()
    flight(m, 'E1', 'escalator', '1F', [0, 0], 90)
    expect(linkCandidates(m, 'escalator', '2F', 'down')).toEqual([])
    expect(linkCandidates(m, 'escalator', '2F', 'up').map((c) => c.parentId)).toEqual(['E1'])
    const f = planFlight(m, 'escalator', '1F', [0, 0], 90)
    if ('refused' in f) throw new Error(f.refused)
    flight(m, 'E2', 'escalator', '2F', [f.exit[0], f.exit[1]], 90, { continuesFrom: 'E1' })
    const [link] = verticalLinks(m)
    expect(linkStatus(m, link).ok).toBe(true)
    setEscalatorDirection(m, 'E2', 'down')
    expect(linkStatus(m, link)).toMatchObject({ ok: false, why: '운행 방향이 다릅니다' })
  })

  it('GeoJSON 은 유효한 연결을 두 조각에 continuesWith 로, 어긋난 것은 continuesReview 로만 낸다 [OE-ML-19#8]', () => {
    const m = model()
    flight(m, 'A', 'stair', '1F', [0, 0], 90)
    flight(m, 'B', 'stair', '2F', [0, 6.672], 90, { continuesFrom: 'A' })
    const props = (id: string) => modelToGeoJSON(m).flatMap((f) => f.collection.features).find((f) => f.id === id)!.properties!
    expect(props('A@2F')).toMatchObject({ continuesWith: ['B@2F'], continuesWithSource: 'edit' })
    expect(props('B@2F')).toMatchObject({ continuesWith: ['A@2F'] })
    expect(props('A@1F').continuesWith).toBeUndefined()
    moveVertical(m, 'B', [1, 0])
    expect(props('A@2F').continuesWith).toBeUndefined()
    expect(props('A@2F').continuesReview).toEqual([{ id: 'B@2F', reason: '지점이 1.00m 어긋났습니다' }])
    expect(linkFeatures(m).size).toBe(2)
  })

  it('연결은 되돌리기 한 번에 돌아오고, 편집 파일로 새로 연 모델에 얹어도 같다 [OE-ML-19#6~]', () => {
    const m = model()
    const base = baselineOf(m)
    flight(m, 'A', 'stair', '1F', [0, 0], 90)
    const snap = snapshotVerticals(m)
    flight(m, 'B', 'stair', '2F', [0, 6.672], 90, { continuesFrom: 'A' })
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'b.ifc'))) as EditFile
    const again = model()
    applyEdits(again, file)
    expect(verticalLinks(again)).toEqual([{ lower: 'A', upper: 'B', storeyId: '2F' }])
    expect(linkStatus(again, verticalLinks(again)[0]).ok).toBe(true)
    restore(m, snap)
    expect(verticalLinks(m)).toEqual([])
  })
})
