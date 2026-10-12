import { describe, expect, it } from 'vitest'
import type { Model, Space, Storey, Vec2, Vec3, Wall } from './model'
import { stairParts, verticalObjects, explicitSpaceLinks } from './vertical-object'
import { deleteVertical, movePart, moveVertical, setPartPoint, setPartVertex, verticalCollisions, verticalImpact, verticalRef } from './vertical-edit'
import { baselineOf, diffBaseline, restore, snapshotVerticals } from './edit'
import { applyEdits, countEdits, exportEdits, parseEditFile, type EditFile } from './edit-file'
import { BUILDING, joinParts, splitByStorey } from './storey-drafts'
import { modelToGeoJSON } from './export/geojson'

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const space = (id: string, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: 1, boundedBy: [], kind: 'staircase' })
const wall = (id: string, ring: Vec2[]): Wall => ({ id, name: id, thickness: 0.2, loadBearing: true, footprint: [ring] }) as Wall

/** x 0~1 폭, y 0 에서 4 까지 오르는 곧은 계단(vertical-object.test.ts 와 같다). */
function flight(z0: number, z1: number, x = 0, steps = 10): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const y = (4 * i) / steps
    const z = z0 + ((z1 - z0) * i) / steps
    out.push([x, y, z], [x + 1, y, z], [x, y, z - 0.15], [x + 1, y, z - 0.15])
  }
  return out
}

/**
 * 두 층 건물. 1층 계단실(-1~2, -1~5)·옆 복도(2~6), 2층 계단실·복도. 계단 둘: `st`(x 0~1) 와 `st2`(x 3~4, 복도 안).
 * 1층 계단실 오른쪽 벽(x 2~2.2)이 계단실과 복도 사이에 있다.
 */
function building(): Model {
  const f1: Storey = {
    id: '1F', name: '1F', elevation: 0,
    spaces: [space('stair1', rect(-1, -1, 2, 5)), space('hall1', rect(2.2, -1, 6, 5))],
    walls: [wall('w1', rect(2, -1, 2.2, 5))], openings: [], equipment: [],
  }
  const f2: Storey = {
    id: '2F', name: '2F', elevation: 4.5,
    spaces: [space('stair2', rect(-1, -1, 2, 5)), space('hall2', rect(2.2, -1, 6, 5))],
    walls: [], openings: [], equipment: [],
  }
  for (const [id, x] of [['st', 0], ['st2', 3]] as const) {
    for (const { storey, part } of stairParts({ id, name: `계단 ${id}`, points: flight(0, 4.45, x) }, f1, [f1, f2])!) {
      storey.verticalParts = [...(storey.verticalParts ?? []), part]
    }
  }
  return { schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys: [f1, f2], systems: [], connections: [], warnings: [] }
}
const partsOf = (m: Model, id: string) => verticalObjects(m).find((o) => o.id === id)!.parts.map((p) => p.part)

describe('수직 관통 오브젝트 전체 이동 (OE-ML-07)', () => {
  it('모든 층 조각의 형상·진입·종료 지점에 같은 이동량을 더하고 높이는 그대로 둔다 — 층 사이 상대 위치가 같다 [OE-ML-07#1] [OE-OBJ-14#3~] [OE-ML-02#5~]', () => {
    const m = building()
    const [low0, high0] = partsOf(m, 'st').map((p) => structuredClone(p))
    expect(moveVertical(m, 'st', [0.5, -0.25])).toBe(true)
    const [low, high] = partsOf(m, 'st')
    expect(low.footprint).toEqual(low0.footprint.map(([x, y]) => [x + 0.5, y - 0.25]))
    expect(low.entry).toEqual([low0.entry![0] + 0.5, low0.entry![1] - 0.25, low0.entry![2]])
    expect(high.exit).toEqual([high0.exit![0] + 0.5, high0.exit![1] - 0.25, high0.exit![2]])
    // 상대 위치: 1층 진입 → 2층 종료의 차가 그대로다.
    expect(high.exit![1] - low.entry![1]).toBeCloseTo(high0.exit![1] - low0.entry![1], 9)
    expect([low.edited, high.edited]).toEqual([true, true])
    // 다른 계단은 그대로다.
    expect(partsOf(m, 'st2').every((p) => !p.edited)).toBe(true)
    // GeoJSON 은 출처(bim)를 두고 보정(edited)을 따로 적는다(OE-ML-02 "원본과 보정 구분").
    const features = modelToGeoJSON(m).flatMap((f) => f.collection.features)
    expect(features.find((f) => f.id === 'st@1F')?.properties).toMatchObject({ source: 'bim', edited: true })
    expect(features.find((f) => f.id === 'st2@1F')?.properties?.edited).toBeUndefined()
  })

  it('옮긴 자리의 물리존이 연관 물리존이 된다 — 저장하지 않고 짚으니 낡은 연결이 남지 않는다 [OE-ML-19#6~]', () => {
    const m = building()
    expect(explicitSpaceLinks(verticalObjects(m)).find((l) => l.parentId === 'st')).toMatchObject({ a: 'stair1', b: 'stair2' })
    moveVertical(m, 'st', [3, 0])
    expect(explicitSpaceLinks(verticalObjects(m)).find((l) => l.parentId === 'st')).toMatchObject({ a: 'hall1', b: 'hall2' })
  })

  it('이동량이 0 이거나 숫자가 아니면 적용하지 않는다 [OE-ML-07#4~]', () => {
    const m = building()
    const before = structuredClone(partsOf(m, 'st'))
    expect(moveVertical(m, 'st', [0, 0])).toBe(false)
    expect(moveVertical(m, 'st', [Number.NaN, 1])).toBe(false)
    expect(moveVertical(m, 'nope', [1, 0])).toBe(false)
    expect(partsOf(m, 'st')).toEqual(before)
  })

  it('V-03: 연 때보다 벽과 더 겹치거나 물리존 경계를 넘은 층을 적고, 연 때 자리에서는 적지 않는다 [OE-ML-07#4~]', () => {
    const m = building()
    const base = baselineOf(m)
    const original = base.verticals!.get('st')!.footprints
    expect(verticalCollisions(m, 'st', original)).toEqual([])
    // 오른쪽으로 1.5m: 계단(x 1.5~2.5)이 벽(x 2~2.2)을 덮고 계단실 경계를 넘는다. 2층은 형상이 없어 재지 않는다.
    moveVertical(m, 'st', [1.5, 0])
    const hits = verticalCollisions(m, 'st', original)
    expect(hits.map((h) => [h.storey, h.reasons])).toEqual([['1F', ['wall', 'boundary']]])
    expect(hits[0].wall).toBeGreaterThan(0.5)
    expect(hits[0].share).toBeLessThan(0.9)
    // 되돌아오면 사라진다(막지 않고 경고만 한다).
    moveVertical(m, 'st', [-1.5, 0])
    expect(verticalCollisions(m, 'st', original)).toEqual([])
  })
})

describe('수직 관통 오브젝트 삭제 (OE-ML-09)', () => {
  it('지우기 전 영향(층·조각·이은 물리존)을 보이고, 지우면 모든 층 조각이 빠지되 물리존은 그대로다 [OE-ML-09#1~,2]', () => {
    const m = building()
    expect(verticalImpact(m, 'st')).toEqual({ storeys: ['1F', '2F'], parts: 2, link: { from: 'stair1', to: 'stair2' } })
    expect(deleteVertical(m, 'st')).toBe(true)
    expect(verticalObjects(m).map((o) => o.id)).toEqual(['st2'])
    expect(m.storeys.map((s) => s.spaces.length)).toEqual([2, 2])
    expect(deleteVertical(m, 'st')).toBe(false)
  })

  it('지운 계단을 가리키는 GeoJSON 참조가 남지 않는다 — 계단실은 겹침 추정(calc)으로 다시 이어진다 [OE-ML-09#2] [OE-EQP-16#3~] [OE-ML-19#6~]', () => {
    const m = building()
    deleteVertical(m, 'st')
    const features = modelToGeoJSON(m).flatMap((f) => f.collection.features)
    const ids = new Set(features.map((f) => String(f.id)))
    expect([...ids].some((id) => id.startsWith('st@'))).toBe(false)
    for (const f of features) for (const to of (f.properties?.verticalConnects as string[] | undefined) ?? []) expect(ids.has(to)).toBe(true)
    expect(features.find((f) => f.id === 'stair1')?.properties).toMatchObject({ verticalConnects: ['stair2'], verticalConnectsSource: 'calc' })
  })
})

describe('되돌리기·편집 파일 (OE-ML-07·09)', () => {
  it('여러 층의 옮기기·지우기를 스냅샷 하나로 되돌린다 [OE-ML-01#9~] [OE-ML-07#5~] [OE-ML-09#5~]', () => {
    const m = building()
    const before = structuredClone(m.storeys.map((s) => s.verticalParts))
    const snap = snapshotVerticals(m)
    moveVertical(m, 'st', [1, 1])
    deleteVertical(m, 'st2')
    restore(m, snap)
    expect(m.storeys.map((s) => s.verticalParts)).toEqual(before)
  })

  it('연 때와 견준 이동량·지움을 편집 파일에 적고, 새로 연 같은 BIM 에 얹으면 같은 모습이며 지운 계단은 되살아나지 않는다 [OE-ML-09#5~] [OE-ML-07#5~]', () => {
    const a = building()
    const base = baselineOf(a)
    moveVertical(a, 'st', [0.4, 0])
    moveVertical(a, 'st', [0.1, -0.2])
    deleteVertical(a, 'st2')
    expect(diffBaseline(a, base).verticals).toEqual([
      { id: 'st', name: '계단 st', move: [0.5, -0.2] },
      { id: 'st2', name: '계단 st2', removed: true },
    ])
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'b.ifc'))) as EditFile
    expect(file.verticals).toEqual([{ id: 'st', move: [0.5, -0.2] }, { id: 'st2', removed: true }])
    expect(countEdits(file)).toBe(2)

    const b = building()
    const result = applyEdits(b, file)
    expect(result.missing.elements).toBe(0)
    expect(b.storeys.map((s) => s.verticalParts)).toEqual(a.storeys.map((s) => s.verticalParts))
    // 옮겼다 제자리로 돌리면 적을 것이 없다.
    moveVertical(a, 'st', [-0.5, 0.2])
    expect(diffBaseline(a, base).verticals?.filter((v) => v.id === 'st')).toEqual([])
  })

  it('층별 임시 저장본에서는 건물 조각에 들고, 이으면 그대로다', () => {
    const a = building()
    const base = baselineOf(a)
    moveVertical(a, 'st', [1, 0])
    const file = exportEdits(a, base, 'b.ifc')
    const parts = splitByStorey(file, () => '1F')
    expect(parts.get(BUILDING)?.verticals).toEqual([{ id: 'st', move: [1, 0] }])
    expect([...parts.keys()]).toEqual([BUILDING])
    expect(joinParts(parts.values(), file).verticals).toEqual(file.verticals)
  })

  it('BIM 에 그 계단이 없으면(다른 파일·재내보내기에서 빠짐) 못 찾은 것으로 센다', () => {
    const b = building()
    const result = applyEdits(b, { format: 'ontology-editor/edits', version: 1, source: 'x', savedAt: '', equipment: [], spaces: [], kinds: [], flows: [], confirmedSystems: [], verticals: [{ id: 'gone', move: [1, 0] }, { id: 'gone2', removed: true }] })
    expect(result.missing.elements).toBe(2)
    expect(verticalRef(b, 'st')).toEqual(partsOf(building(), 'st')[0].footprint[0])
  })
})

describe('층별 형상·진입/종료 지점 고치기 (OE-ML-07 후반)', () => {
  it('한 층 조각만 옮기면 그 층 형상·지점만 가고 다른 층은 그대로다 [OE-ML-07#2~]', () => {
    const m = building()
    const [low0, high0] = partsOf(m, 'st').map((p) => structuredClone(p))
    expect(movePart(m, 'st@1F', [0, 0.5])).toBe(true)
    const [low, high] = partsOf(m, 'st')
    expect(low.footprint).toEqual(low0.footprint.map(([x, y]) => [x, y + 0.5]))
    expect(low.entry![1]).toBeCloseTo(low0.entry![1] + 0.5, 6)
    expect(high).toEqual(high0)
    expect(low.edited).toBe(true)
    expect(movePart(m, 'st@3F', [1, 0])).toBe(false)
  })

  it('꼭짓점을 옮겨 형상(크기)을 바꾸고, 변이 교차하는 자리는 이유와 함께 되돌린다 [OE-ML-07#2~,4~]', () => {
    const m = building()
    const before = structuredClone(partsOf(m, 'st')[0].footprint)
    const far = before.reduce((a, p) => (p[1] > a[1] ? p : a))
    const i = before.indexOf(far)
    expect(setPartVertex(m, 'st@1F', i, [far[0], far[1] + 0.5])).toBe(true)
    expect(partsOf(m, 'st')[0].footprint[i]).toEqual([far[0], far[1] + 0.5])
    // 사각형의 꼭짓점 (1,4) 를 (1,-1) 로 끌면 그 변이 바닥 변(0,0)-(1,0)과 엇갈린다.
    const square = building()
    for (const st of square.storeys) for (const p of st.verticalParts ?? []) if (p.parentId === 'st' && p.footprint.length) p.footprint = [[0, 0], [1, 0], [1, 4], [0, 4]]
    const refused = setPartVertex(square, 'st@1F', 2, [1, -1])
    expect(refused).toEqual({ refused: expect.stringContaining('교차') })
    expect(partsOf(square, 'st')[0].footprint).toEqual([[0, 0], [1, 0], [1, 4], [0, 4]])
    expect(setPartVertex(m, 'st@1F', 99, [0, 0])).toBe(false)
  })

  it('진입·종료 지점을 x·y 로 옮기고 높이는 그대로 둔다. 지점이 없는 조각이면 하지 않는다 [OE-ML-07#2~]', () => {
    const m = building()
    const z = partsOf(m, 'st')[1].exit![2]
    expect(setPartPoint(m, 'st@2F', 'exit', [0.2, 3.1])).toBe(true)
    expect(partsOf(m, 'st')[1].exit).toEqual([0.2, 3.1, z])
    expect(setPartPoint(m, 'st@2F', 'entry', [0, 0])).toBe(false)
    // 종료 지점이 2층 복도로 가면 이 계단이 잇는 짝도 바뀐다.
    setPartPoint(m, 'st@2F', 'exit', [4, 3])
    expect(explicitSpaceLinks(verticalObjects(m)).find((l) => l.parentId === 'st')).toMatchObject({ a: 'stair1', b: 'hall2' })
  })

  it('층별로 고친 것은 편집 파일에 조각을 통째로 적고(이동량 대신), 새로 연 BIM 에 얹으면 같다 [OE-ML-07#5~] [OE-ML-02#5~]', () => {
    const a = building()
    const base = baselineOf(a)
    moveVertical(a, 'st', [0.3, 0])
    expect(diffBaseline(a, base).verticals).toEqual([{ id: 'st', name: '계단 st', move: [0.3, 0] }])
    // 전체 이동 뒤 한 층을 따로 고치면 전체 이동이 아니다. 연 때와 달라진 층(둘 다)을 적는다.
    setPartPoint(a, 'st@2F', 'exit', [0.6, 3.5])
    expect(diffBaseline(a, base).verticals).toEqual([{ id: 'st', name: '계단 st', reshaped: ['1F', '2F'] }])
    movePart(a, 'st@1F', [0, 0.2])
    expect(diffBaseline(a, base).verticals?.[0].reshaped).toEqual(['1F', '2F'])
    // 한 층만 고친 계단은 그 층만 적는다.
    setPartPoint(a, 'st2@2F', 'exit', [3.5, 3.5])
    expect(diffBaseline(a, base).verticals?.find((v) => v.id === 'st2')?.reshaped).toEqual(['2F'])
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'b.ifc'))) as EditFile
    expect(file.verticals?.find((v) => v.id === 'st')).toMatchObject({ id: 'st', parts: [{ storeyId: '1F' }, { storeyId: '2F' }] })
    expect(file.verticals?.[0].move).toBeUndefined()
    const b = building()
    const result = applyEdits(b, file)
    expect(result.missing).toMatchObject({ elements: 0, storeys: 0 })
    expect(b.storeys.map((s) => s.verticalParts)).toEqual(a.storeys.map((s) => s.verticalParts))
  })
})
