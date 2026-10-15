import { describe, expect, it } from 'vitest'
import type { Connection, Equipment, Model, Space, Storey, Vec2, Vec3, Wall } from './model'
import { partSpaces, stairParts, verticalObjects, explicitSpaceLinks } from './vertical-object'
import { COMMON_AXIS_LOCKED, createVertical, escalatorTravel, faceLanding, landingFace, setElevatorLanding, planElevator, planFlight, rotateVertical, storeyAbove, VERTICAL_DEFAULTS, setVerticalHeading, snapHeading, verticalHeading, verticalPivot, wallHeadings, setElevatorStop, setEscalatorDirection, deleteVertical, movePart, moveVertical, planCreate, planRange, planSteps, setPartPoint, setPartVertex, setVerticalRange, verticalCollisions, verticalImpact, verticalRef } from './vertical-edit'
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

  it('이동량이 0 이거나 숫자가 아니면 적용하지 않는다 [OE-ML-07#5~]', () => {
    const m = building()
    const before = structuredClone(partsOf(m, 'st'))
    expect(moveVertical(m, 'st', [0, 0])).toBe(false)
    expect(moveVertical(m, 'st', [Number.NaN, 1])).toBe(false)
    expect(moveVertical(m, 'nope', [1, 0])).toBe(false)
    expect(partsOf(m, 'st')).toEqual(before)
  })

  it('V-03: 연 때보다 벽과 더 겹치거나 물리존 경계를 넘은 층을 적고, 연 때 자리에서는 적지 않는다 [OE-ML-07#5~]', () => {
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
    expect(verticalImpact(m, 'st')).toEqual({ storeys: ['1F', '2F'], parts: 2, link: { from: 'stair1', to: 'stair2' }, pipes: 0 })
    expect(deleteVertical(m, 'st')).toBe(true)
    expect(verticalObjects(m).map((o) => o.id)).toEqual(['st2'])
    expect(m.storeys.map((s) => s.spaces.length)).toEqual([2, 2])
    expect(deleteVertical(m, 'st')).toBe(false)
  })

  it('샤프트를 지워도 그 안을 지나는 배관과 연결은 그대로 남는다 — 배관은 샤프트에 소속을 적지 않아 풀 것이 없다 [OE-ML-09#4~]', () => {
    const m = tower()
    expect(createVertical(m, { id: 'U_ps', kind: 'shaft', name: 'PS-1', from: '1F', to: '3F' }, new Map([['1F', { footprint: rect(3, 0, 4, 1) }]]))).toEqual({ id: 'U_ps' })
    // 샤프트 축(3~4, 0~1) 안을 지나는 수직 배관과, 그 배관이 잇는 1층·2층 설비.
    const device = (id: string, z: number) => ({ id, name: id, ifcClass: 'IfcFlowTerminal', role: 'terminal', position: [3.5, 0.5, z], capacity: null, systemId: null, spaceId: null, spaceSource: null }) as unknown as Equipment
    m.storeys[0].equipment.push(device('low', 0.5), { ...device('riser', 0.5), ifcClass: 'IfcPipeSegment', role: 'segment', axis: [[0, 0, 0], [0, 0, 5]] })
    m.storeys[1].equipment.push(device('high', 5))
    const link = (from: string, to: string) => ({ from, to, source: 'manual', directed: false, tolerance: null }) as unknown as Connection
    m.connections.push(link('low', 'riser'), link('riser', 'high'))
    const before = JSON.stringify([m.storeys.map((s) => s.equipment), m.connections])
    expect(deleteVertical(m, 'U_ps')).toBe(true)
    expect(verticalObjects(m).some((o) => o.id === 'U_ps')).toBe(false)
    expect(JSON.stringify([m.storeys.map((s) => s.equipment), m.connections])).toBe(before)
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
  it('여러 층의 옮기기·지우기를 스냅샷 하나로 되돌린다 [OE-ML-01#9~] [OE-ML-07#7~] [OE-ML-09#5~]', () => {
    const m = building()
    const before = structuredClone(m.storeys.map((s) => s.verticalParts))
    const snap = snapshotVerticals(m)
    moveVertical(m, 'st', [1, 1])
    deleteVertical(m, 'st2')
    restore(m, snap)
    expect(m.storeys.map((s) => s.verticalParts)).toEqual(before)
  })

  it('연 때와 견준 이동량·지움을 편집 파일에 적고, 새로 연 같은 BIM 에 얹으면 같은 모습이며 지운 계단은 되살아나지 않는다 [OE-ML-09#5~] [OE-ML-07#7~]', () => {
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

describe('에스컬레이터와 엘리베이터 (OE-ML-02 · OE-ML-07)', () => {
  const ring: Vec2[] = [[-0.5, 0], [0.5, 0], [0.5, 3], [-0.5, 3]]
  const axis: Vec2[] = [[3, 0], [4, 0], [4, 1], [3, 1]]
  /** 1F 진입 (0, 0.2) · 2F 종료 (0, 2.8) 인 에스컬레이터와 1F~3F 엘리베이터를 만든 모델과 그 편집 파일. */
  function made() {
    const m = tower()
    const base = baselineOf(m)
    expect(createVertical(m, { id: 'U_es', kind: 'escalator', name: 'ES-1', from: '1F', to: '2F' }, new Map([['1F', { footprint: ring, entry: [0, 0.2] as Vec2 }], ['2F', { exit: [0, 2.8] as Vec2 }]]))).toEqual({ id: 'U_es' })
    expect(createVertical(m, { id: 'U_el', kind: 'elevator', name: 'EL-1', from: '1F', to: '3F' }, new Map([['1F', { footprint: axis }]]))).toEqual({ id: 'U_el' })
    return { m, base }
  }

  it('1층 진입과 2층 종료가 다른 자리인 에스컬레이터를 만들고, 편집 파일로 새로 연 BIM 에 얹으면 같다 [OE-ML-02#2] [OE-OBJ-14#1~]', () => {
    const { m, base } = made()
    const [low, high] = partsOf(m, 'U_es')
    expect([low.entry, low.exit, high.entry, high.exit]).toEqual([[0, 0.2, 0], null, null, [0, 2.8, 4.5]])
    expect(explicitSpaceLinks(verticalObjects(m)).find((l) => l.parentId === 'U_es')).toMatchObject({ a: 'stair1', b: 'stair2' })
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'b.ifc'))) as EditFile
    const again = tower()
    expect(applyEdits(again, file).missing).toMatchObject({ elements: 0, storeys: 0 })
    expect(again.storeys.map((s) => s.verticalParts)).toEqual(m.storeys.map((s) => s.verticalParts))
  })

  it('에스컬레이터는 층 조각마다 형상·크기·진입/종료 지점을 고치고, 엘리베이터는 한 층만 고치지 못하며 통째로 옮겨도 모든 층 축이 같다 [OE-ML-07#3] [OE-OBJ-14#1~,3~]', () => {
    const { m } = made()
    expect(movePart(m, 'U_es@1F', [0.5, 0])).toBe(true)
    expect(setPartVertex(m, 'U_es@1F', 2, [1.5, 3.5])).toBe(true)
    expect(setPartPoint(m, 'U_es@2F', 'exit', [0.2, 2.5])).toBe(true)
    const [low, high] = partsOf(m, 'U_es')
    expect(low.footprint).toEqual([[0, 0], [1, 0], [1.5, 3.5], [0, 3]])
    expect([low.entry, high.exit]).toEqual([[0.5, 0.2, 0], [0.2, 2.5, 4.5]])
    expect([low.edited, high.edited]).toEqual([true, true])
    // 엘리베이터 승강로는 공통 축이다.
    expect(setPartVertex(m, 'U_el@2F', 0, [2.5, 0])).toEqual({ refused: COMMON_AXIS_LOCKED })
    expect(movePart(m, 'U_el@3F', [1, 0])).toBe(false)
    moveVertical(m, 'U_el', [0, 1])
    expect(partsOf(m, 'U_el').map((p) => p.footprint)).toEqual([0, 1, 2].map(() => axis.map(([x, y]) => [x, y + 1])))
  })
})

describe('전체 회전 (OE-ML-07 · OE-OBJ-15)', () => {
  const ring: Vec2[] = [[-0.5, 0], [0.5, 0], [0.5, 3], [-0.5, 3]]
  const axis: Vec2[] = [[3, 0], [4, 0], [4, 1], [3, 1]]
  function made() {
    const m = tower()
    const base = baselineOf(m)
    createVertical(m, { id: 'U_es', kind: 'escalator', name: 'ES-1', from: '1F', to: '2F' }, new Map([['1F', { footprint: ring, entry: [0, 0.2] as Vec2 }], ['2F', { exit: [0, 2.8] as Vec2 }]]))
    createVertical(m, { id: 'U_el', kind: 'elevator', name: 'EL-1', from: '1F', to: '3F' }, new Map([['1F', { footprint: axis }]]))
    return { m, base }
  }

  it('계단·ES 는 시작점, EL 은 승강로 가운데를 중심으로 모든 층 조각을 같은 각도만큼 돌리고, 방위는 형상에서 잰다 [OE-ML-07#2~] [OE-OBJ-15#6~]', () => {
    const { m } = made()
    expect(verticalPivot(m, 'U_es')).toEqual([0, 0.2])
    expect(verticalHeading(m, 'U_es')).toBe(90)
    expect(rotateVertical(m, 'U_es', -90)).toBe(true)
    const [low, high] = partsOf(m, 'U_es')
    // 시작점은 제자리, 끝점은 시작점 둘레로 돈다 — 두 층 사이 상대 위치가 그대로다.
    expect([low.entry, high.exit]).toEqual([[0, 0.2, 0], [2.6, 0.2, 4.5]])
    expect(low.footprint).toEqual([[-0.2, 0.7], [-0.2, -0.3], [2.8, -0.3], [2.8, 0.7]])
    expect(verticalHeading(m, 'U_es')).toBe(0)
    // 사람이 만든 것은 원본이 없어 보정 표시가 없고, BIM 계단을 돌리면 보정이다.
    expect([low.edited, high.edited]).toEqual([undefined, undefined])
    expect(rotateVertical(m, 'st', 10)).toBe(true)
    expect(partsOf(m, 'st').every((p) => p.edited)).toBe(true)

    expect(verticalPivot(m, 'U_el')).toEqual([3.5, 0.5])
    expect(verticalHeading(m, 'U_el')).toBe(0)
    expect(setVerticalHeading(m, 'U_el', 30)).toBe(true)
    expect(verticalHeading(m, 'U_el')).toBeCloseTo(30, 1)
    // 공통 축: 세 층 조각이 같은 형상이다.
    const shapes = partsOf(m, 'U_el').map((p) => JSON.stringify(p.footprint))
    expect(new Set(shapes).size).toBe(1)
    expect(rotateVertical(m, 'U_el', 0)).toBe(false)
    expect(rotateVertical(m, 'U_el', 360)).toBe(false)
    expect(rotateVertical(m, 'U_el', Number.NaN)).toBe(false)
  })

  it('GeoJSON 의 층 조각마다 오브젝트의 평면 회전각(heading, 출처 calc)을 내고, 돌리면 같이 바뀐다 (OE-ML-02 평면 회전각)', () => {
    const { m } = made()
    const headingOf = (id: string) =>
      modelToGeoJSON(m)
        .flatMap((f) => f.collection.features)
        .filter((f) => f.properties?.parentId === id)
        .map((f) => [f.properties?.heading, f.properties?.headingSource])
    expect(headingOf('U_es')).toEqual([[90, 'calc'], [90, 'calc']])
    rotateVertical(m, 'U_es', -30)
    expect(headingOf('U_es')).toEqual([[60, 'calc'], [60, 'calc']])
    expect(headingOf('U_el').every(([h]) => h === 0)).toBe(true)
  })

  it('건물 축과 가까운 벽 방향에 ±3° 안이면 붙고, Alt 면 붙지 않으며, 먼 벽에는 붙지 않는다 [OE-ML-07#2~] [OE-OBJ-15#6~]', () => {
    expect(snapHeading(2.5)).toEqual({ angle: 0, by: '건물 축' })
    expect(snapHeading(268)).toEqual({ angle: 270, by: '건물 축' })
    expect(snapHeading(3.5)).toEqual({ angle: 3.5, by: null })
    expect(snapHeading(2.5, [], true)).toEqual({ angle: 2.5, by: null })
    // 31° 로 비스듬한 벽. 그 방향, 직각, 반대쪽(211°)에 붙는다.
    const r = (Math.PI * 31) / 180
    const slanted: Vec2[] = [[0, 0], [10 * Math.cos(r), 10 * Math.sin(r)], [10 * Math.cos(r) - 0.2 * Math.sin(r), 10 * Math.sin(r) + 0.2 * Math.cos(r)], [-0.2 * Math.sin(r), 0.2 * Math.cos(r)]]
    const storey = { walls: [wall('slant', slanted)] }
    const walls = wallHeadings(storey, [1, 1])
    expect(walls.map((a) => Math.round(a))).toEqual([31, 121])
    expect(snapHeading(33, walls)).toEqual({ angle: 31, by: '벽 방향' })
    expect(snapHeading(209, walls)).toEqual({ angle: 211, by: '벽 방향' })
    expect(snapHeading(119, walls)).toEqual({ angle: 121, by: '벽 방향' })
    expect(snapHeading(33, walls, true)).toEqual({ angle: 33, by: null })
    expect(wallHeadings(storey, [40, 40])).toEqual([])
  })

  it('돌린 것은 되돌리기 한 번에 돌아오고, 편집 파일로 새로 연 모델에 얹어도 같은 방위다 [OE-ML-07#7~]', () => {
    const { m, base } = made()
    const snapshot = snapshotVerticals(m)
    const before = JSON.stringify(m.storeys.map((s) => s.verticalParts))
    rotateVertical(m, 'U_es', 45)
    restore(m, snapshot)
    expect(JSON.stringify(m.storeys.map((s) => s.verticalParts))).toBe(before)

    rotateVertical(m, 'U_es', 45)
    setVerticalHeading(m, 'U_el', 120)
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'b.ifc'))) as EditFile
    const again = tower()
    applyEdits(again, file)
    expect(verticalHeading(again, 'U_es')).toBeCloseTo(135, 1)
    expect(verticalHeading(again, 'U_el')).toBeCloseTo(120, 1)
    expect(again.storeys.map((s) => s.verticalParts)).toEqual(m.storeys.map((s) => s.verticalParts))
  })
})

describe('층별 형상·진입/종료 지점 고치기 (OE-ML-07 후반)', () => {
  it('한 층 조각만 옮기면 그 층 형상·지점만 가고 다른 층은 그대로다 [OE-ML-07#3~]', () => {
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

  it('꼭짓점을 옮겨 형상(크기)을 바꾸고, 변이 교차하는 자리는 이유와 함께 되돌린다 [OE-ML-07#3~,5~]', () => {
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

  it('진입·종료 지점을 x·y 로 옮기고 높이는 그대로 둔다. 지점이 없는 조각이면 하지 않는다 [OE-ML-07#3~]', () => {
    const m = building()
    const z = partsOf(m, 'st')[1].exit![2]
    expect(setPartPoint(m, 'st@2F', 'exit', [0.2, 3.1])).toBe(true)
    expect(partsOf(m, 'st')[1].exit).toEqual([0.2, 3.1, z])
    expect(setPartPoint(m, 'st@2F', 'entry', [0, 0])).toBe(false)
    // 종료 지점이 2층 복도로 가면 이 계단이 잇는 짝도 바뀐다.
    setPartPoint(m, 'st@2F', 'exit', [4, 3])
    expect(explicitSpaceLinks(verticalObjects(m)).find((l) => l.parentId === 'st')).toMatchObject({ a: 'stair1', b: 'hall2' })
  })

  it('층별로 고친 것은 편집 파일에 조각을 통째로 적고(이동량 대신), 새로 연 BIM 에 얹으면 같으며 고친 조각과 원본이 구분된다 [OE-ML-07#7~] [OE-ML-02#5]', () => {
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
    // 다시 연 모델에서 원본과 사람 보정이 구분된다: 고친 조각은 edited 이고 출처는 BIM 그대로다. 같은 조각이 두 번 생기지 않는다.
    const parts = (m: Model) => m.storeys.flatMap((s) => (s.verticalParts ?? []).map((p) => `${s.id}:${p.parentId}:${p.source}:${p.edited ? 'edited' : 'bim'}`))
    expect(parts(b).filter((x) => x.includes(':st:'))).toEqual(['1F:st:bim:edited', '2F:st:bim:edited'])
    expect(parts(b).filter((x) => x.includes(':st2:'))).toEqual(['1F:st2:bim:bim', '2F:st2:bim:edited'])
    expect(new Set(parts(b)).size).toBe(parts(b).length)
    // 원본 형상은 연 때의 기준(baseline)에 남아, 다시 연 모델에서도 무엇을 고쳤는지 잰다.
    expect(diffBaseline(b, baselineOf(building())).verticals?.map((v) => [v.id, v.reshaped])).toEqual([['st', ['1F', '2F']], ['st2', ['2F']]])
  })
})

/** building() 에 3층(계단실·복도)을 더한 것. 계단 st 는 1층 → 2층이다. */
function tower(): Model {
  const m = building()
  m.storeys.push({ id: '3F', name: '3F', elevation: 9, spaces: [space('stair3', rect(-1, -1, 2, 5)), space('hall3', rect(2.2, -1, 6, 5))], walls: [], openings: [], equipment: [] })
  return m
}
const shape = (m: Model, id: string) => verticalObjects(m).find((o) => o.id === id)!.parts.map((p) => [p.storey.id, p.part.footprint.length, !!p.part.entry, !!p.part.exit])

describe('기본 형상으로 만들기 (OE-ML-06 · 2026-10-14)', () => {
  it('계단·ES 는 시작점과 방위만으로 바로 위층까지의 형상·끝점을 계산하고, 시작/끝 지점이 서로 다른 층·자리에 기록된다 [OE-ML-06#2]', () => {
    const m = tower()
    expect(storeyAbove(m, '1F')?.id).toBe('2F')
    const plan = planFlight(m, 'stair', '1F', [-0.5, 2], 0)
    if ('refused' in plan) throw new Error(plan.refused)
    // 층고 4.5m ÷ tan 34° = 6.672m. 폭 1.5m 의 직사각형이 시작점에서 +x 로 뻗는다.
    expect(plan.to.id).toBe('2F')
    expect(plan.length).toBeCloseTo(4.5 / Math.tan((34 * Math.PI) / 180), 2)
    expect(plan.footprint).toEqual([[-0.5, 1.25], [6.172, 1.25], [6.172, 2.75], [-0.5, 2.75]])
    expect([plan.entry, plan.exit]).toEqual([[-0.5, 2], [6.172, 2]])
    expect(plan.outside).toBe(false)
    expect(createVertical(m, { id: 'U_st', kind: 'stair', name: '계단', from: '1F', to: plan.to.id }, new Map([['1F', { footprint: plan.footprint, entry: plan.entry }], ['2F', { exit: plan.exit }]]))).toEqual({ id: 'U_st' })
    const [low, high] = partsOf(m, 'U_st')
    expect([low.entry, high.exit]).toEqual([[-0.5, 2, 0], [6.172, 2, 4.5]])
    // ES 는 30° 라 같은 층고에 더 길다.
    const es = planFlight(m, 'escalator', '1F', [-0.5, 2], 0)
    expect('refused' in es ? 0 : es.length).toBeCloseTo(4.5 / Math.tan((VERTICAL_DEFAULTS.escalator.slope * Math.PI) / 180), 2)
  })

  it('형상이 물리존 밖으로 나가는 방위면 outside 이고, 최상층에서 시작하거나 위층과 높이 차가 없으면 이유와 함께 거절한다 [OE-ML-06#3~,6~]', () => {
    const m = tower()
    const up = planFlight(m, 'escalator', '1F', [0, 0], 90)
    expect('refused' in up ? null : up.outside).toBe(true)
    expect(planFlight(m, 'stair', '3F', [0, 0], 0)).toEqual({ refused: expect.stringContaining('최상층') })
    m.storeys[1].elevation = 0
    expect(planFlight(m, 'stair', '1F', [0, 0], 0)).toEqual({ refused: expect.stringContaining('높이 차가 없어') })
  })

  it('EL 은 위치 하나에 기본 크기 승강로를 두고 방위만큼 돌리며, 물리존 밖이면 outside 다 [OE-ML-06#1~]', () => {
    const m = tower()
    const el = planElevator(m, '1F', [4, 2], 0)
    expect(el.footprint).toEqual([[2.8, 0.8], [5.2, 0.8], [5.2, 3.2], [2.8, 3.2]])
    expect(el.outside).toBe(false)
    expect(planElevator(m, '1F', [4, 2], 45).footprint[0].map((v) => +v.toFixed(2))).toEqual([4, 0.3])
    expect(planElevator(m, '1F', [20, 20], 0).outside).toBe(true)
  })
})

describe('엘리베이터 층별 진입 지점 (OE-ML-10 · 2026-10-14)', () => {
  const axis: Vec2[] = [[3, 0], [4, 0], [4, 1], [3, 1]]
  function made() {
    const m = tower()
    const base = baselineOf(m)
    createVertical(m, { id: 'U_el', kind: 'elevator', name: 'EL-1', from: '1F', to: '2F' }, new Map([['1F', { footprint: axis }]]))
    return { m, base }
  }

  it('만들면 층마다 승강로 첫 면 바깥 0.3m 에 진입 지점이 생기고, 그 점이 든 물리존(홀)을 짚는다 [OE-ML-10#1~]', () => {
    const { m } = made()
    expect(faceLanding(axis, 0)).toEqual([3.5, -0.3])
    // 시계 방향 고리여도 바깥으로 뺀다. 뒤집은 고리의 아래 면은 2번 변이다.
    expect(faceLanding([...axis].reverse(), 2)).toEqual([3.5, -0.3])
    expect(partsOf(m, 'U_el').map((p) => p.landing)).toEqual([[3.5, -0.3], [3.5, -0.3]])
    const parts = verticalObjects(m).find((o) => o.id === 'U_el')!.parts
    expect(parts.map((p) => partSpaces(p.storey, p.part))).toEqual([['hall1'], ['hall2']])
    // 층마다 다른 면을 고른다.
    expect(setElevatorLanding(m, 'U_el', '2F', 1)).toBe(true)
    expect(setElevatorLanding(m, 'U_el', '2F', 1)).toBe(false)
    expect(partsOf(m, 'U_el')[1].landing).toEqual([4.3, 0.5])
    expect(landingFace(axis, partsOf(m, 'U_el')[1].landing)).toBe(1)
    // 엘리베이터 진입 지점은 시작·끝 층 물리존을 잇는 명시 연결이 아니다.
    expect(explicitSpaceLinks(verticalObjects(m)).some((l) => l.parentId === 'U_el')).toBe(false)
  })

  it('진입 지점은 옮기기·돌리기를 따라가고, 구간을 늘린 새 층은 아래층과 같은 면이다 [OE-ML-10#4~]', () => {
    const { m } = made()
    setElevatorLanding(m, 'U_el', '2F', 1)
    moveVertical(m, 'U_el', [1, 0])
    expect(partsOf(m, 'U_el').map((p) => p.landing)).toEqual([[4.5, -0.3], [5.3, 0.5]])
    rotateVertical(m, 'U_el', 90)
    const [a, b] = partsOf(m, 'U_el')
    expect(landingFace(a.footprint, a.landing)).toBe(0)
    expect(landingFace(b.footprint, b.landing)).toBe(1)
    expect(setVerticalRange(m, 'U_el', '1F', '3F')).toBe(true)
    const top = partsOf(m, 'U_el')[2]
    expect(landingFace(top.footprint, top.landing)).toBe(0)
  })

  it('GeoJSON 에 층마다 진입 지점(그 층 높이)을 내고, 편집 파일로 새로 연 모델에 얹어도 같다 [OE-ML-10#4~]', () => {
    const { m, base } = made()
    setElevatorLanding(m, 'U_el', '2F', 2)
    const props = (id: string) => modelToGeoJSON(m).flatMap((f) => f.collection.features).find((f) => f.id === id)!.properties!
    expect(props('U_el@1F')).toMatchObject({ landing: [3.5, -0.3, 0], spaceIds: ['hall1'] })
    expect(props('U_el@2F').landing).toEqual([3.5, 1.3, 4.5])
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'b.ifc'))) as EditFile
    const again = tower()
    applyEdits(again, file)
    expect(partsOf(again, 'U_el').map((p) => p.landing)).toEqual(partsOf(m, 'U_el').map((p) => p.landing))
  })
})

describe('구간 바꾸기 (OE-ML-08)', () => {
  it('같은 층을 양 끝으로 두거나 시작 층이 끝 층보다 위면 바꾸지 않는다', () => {
    const m = tower()
    expect(planRange(m, 'st', '2F', '2F')).toEqual({ refused: expect.stringContaining('같은 층') })
    expect(setVerticalRange(m, 'st', '3F', '1F')).toEqual({ refused: expect.stringContaining('시작 층이 끝 층보다 위') })
    expect(shape(m, 'st')).toEqual([['1F', 4, true, false], ['2F', 0, false, true]])
  })

  it('끝 층을 3층으로 늘리면 2층 형상과 3층 종료 지점을 채워야 하고, 아래층 형상을 베껴 채우지 않는다. 채우면 적용된다 [OE-ML-08#2~]', () => {
    const m = tower()
    const plan = planRange(m, 'st', '1F', '3F')
    if ('refused' in plan) throw new Error(plan.refused)
    expect(plan.added.map((s) => s.id)).toEqual(['3F'])
    expect(plan.removed).toEqual([])
    expect(plan.needs.map((n) => [n.storey.id, n.what])).toEqual([['2F', ['footprint']], ['3F', ['exit']]])
    expect(setVerticalRange(m, 'st', '1F', '3F')).toEqual({ refused: expect.stringContaining('2F 형상') })
    expect(shape(m, 'st')).toEqual([['1F', 4, true, false], ['2F', 0, false, true]])
    // 엇갈린 형상은 채운 것으로 치지 않는다.
    const bow: Vec2[] = [[0, 0], [1, 1], [1, 0], [0, 1]]
    const bad = planRange(m, 'st', '1F', '3F', new Map([['2F', { footprint: bow }], ['3F', { exit: [0.5, 3] as Vec2 }]]))
    expect('needs' in bad && bad.needs.map((n) => n.storey.id)).toEqual(['2F'])
    const given = new Map([['2F', { footprint: [[0, 0], [1, 0], [1, 4], [0, 4]] as Vec2[] }], ['3F', { exit: [0.5, 3] as Vec2 }]])
    const ok = planRange(m, 'st', '1F', '3F', given)
    expect('link' in ok && ok.link).toEqual({ from: 'stair1', to: 'stair3' })
    expect(setVerticalRange(m, 'st', '1F', '3F', given)).toBe(true)
    // 2층은 사이 층이 되어 형상만, 3층은 종료 지점(3층 바닥 높이)만이다.
    expect(shape(m, 'st')).toEqual([['1F', 4, true, false], ['2F', 4, false, false], ['3F', 0, false, true]])
    expect(partsOf(m, 'st')[2].exit).toEqual([0.5, 3, 9])
    expect(partsOf(m, 'st').map((p) => !!p.edited)).toEqual([false, true, true])
    expect(explicitSpaceLinks(verticalObjects(m)).find((l) => l.parentId === 'st')).toMatchObject({ a: 'stair1', b: 'stair3' })
  })

  it('구간을 줄이면 빠진 층 조각을 걷고, 새 끝 층은 종료 지점을 다시 받는다 — 그 층의 형상은 지운다 [OE-ML-08#1~]', () => {
    const m = tower()
    setVerticalRange(m, 'st', '1F', '3F', new Map([['2F', { footprint: [[0, 0], [1, 0], [1, 4], [0, 4]] as Vec2[] }], ['3F', { exit: [0.5, 3] as Vec2 }]]))
    const plan = planRange(m, 'st', '1F', '2F')
    if ('refused' in plan) throw new Error(plan.refused)
    expect(plan.removed.map((s) => s.id)).toEqual(['3F'])
    expect(plan.needs.map((n) => [n.storey.id, n.what])).toEqual([['2F', ['exit']]])
    expect(setVerticalRange(m, 'st', '1F', '2F', new Map([['2F', { exit: [0.4, 3.8] as Vec2 }]]))).toBe(true)
    expect(shape(m, 'st')).toEqual([['1F', 4, true, false], ['2F', 0, false, true]])
    expect(m.storeys[2].verticalParts).toBeUndefined()
    // 다른 계단은 그대로다.
    expect(shape(m, 'st2')).toEqual([['1F', 4, true, false], ['2F', 0, false, true]])
  })

  it('에스컬레이터 구간을 줄이면 새 끝 층의 종료 지점을 받기 전에는 적용하지 않고, 받으면 운행 구간이 새 범위 안이다 [OE-ML-08#4~]', () => {
    const m = tower()
    const es: Vec2[] = [[3, 0], [4, 0], [4, 4], [3, 4]]
    expect(createVertical(m, { id: 'U_es', kind: 'escalator', name: 'ES-1', from: '1F', to: '3F' }, new Map([['1F', { footprint: es, entry: [3.5, 0.2] as Vec2 }], ['2F', { footprint: es }], ['3F', { exit: [3.5, 3.8] as Vec2 }]]))).toEqual({ id: 'U_es' })
    setEscalatorDirection(m, 'U_es', 'up')
    expect(escalatorTravel(m, 'U_es')?.to[2]).toBe(9)
    // 3F 에서 끝나던 운행이 새 범위(1F~2F) 밖이다. 2F 종료 지점을 받기 전에는 바꾸지 않는다.
    const plan = planRange(m, 'U_es', '1F', '2F')
    if ('refused' in plan) throw new Error(plan.refused)
    expect(plan.needs.map((n) => [n.storey.id, n.what])).toEqual([['2F', ['exit']]])
    expect(setVerticalRange(m, 'U_es', '1F', '2F')).toEqual({ refused: expect.stringContaining('2F') })
    expect(escalatorTravel(m, 'U_es')?.to[2]).toBe(9)
    expect(setVerticalRange(m, 'U_es', '1F', '2F', new Map([['2F', { exit: [3.5, 3.8] as Vec2 }]]))).toBe(true)
    expect(escalatorTravel(m, 'U_es')).toEqual({ from: [3.5, 0.2, 0], to: [3.5, 3.8, 4.5] })
  })

  it('시작 층을 올리면 새 시작 층은 형상과 진입 지점을 받아야 한다', () => {
    const m = tower()
    setVerticalRange(m, 'st', '1F', '3F', new Map([['2F', { footprint: [[0, 0], [1, 0], [1, 4], [0, 4]] as Vec2[] }], ['3F', { exit: [0.5, 3] as Vec2 }]]))
    const plan = planRange(m, 'st', '2F', '3F')
    if ('refused' in plan) throw new Error(plan.refused)
    expect(plan.needs.map((n) => [n.storey.id, n.what])).toEqual([['2F', ['entry']]])
    expect(setVerticalRange(m, 'st', '2F', '3F', new Map([['2F', { entry: [0.5, 0.2] as Vec2 }]]))).toBe(true)
    expect(shape(m, 'st')).toEqual([['2F', 4, true, false], ['3F', 0, false, true]])
  })

  it('바꾼 구간은 되돌리기 한 번에 돌아오고, 편집 파일로 새로 연 BIM 에 얹으면 없던 층 조각이 생기고 빠진 층 조각이 걷힌다 [OE-ML-08#5~]', () => {
    const a = tower()
    const base = baselineOf(a)
    const before = structuredClone(a.storeys.map((s) => s.verticalParts))
    const snap = snapshotVerticals(a)
    setVerticalRange(a, 'st', '1F', '3F', new Map([['2F', { footprint: [[0, 0], [1, 0], [1, 4], [0, 4]] as Vec2[] }], ['3F', { exit: [0.5, 3] as Vec2 }]]))
    const after = structuredClone(a.storeys.map((s) => s.verticalParts))
    restore(a, snap)
    expect(a.storeys.map((s) => s.verticalParts)).toEqual(before)
    a.storeys.forEach((s, i) => (s.verticalParts = after[i]))
    expect(diffBaseline(a, base).verticals).toEqual([{ id: 'st', name: '계단 st', reshaped: ['2F', '3F'] }])
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'b.ifc'))) as EditFile
    const b = tower()
    expect(applyEdits(b, file).missing).toMatchObject({ elements: 0, storeys: 0 })
    expect(b.storeys.map((s) => s.verticalParts)).toEqual(a.storeys.map((s) => s.verticalParts))
    // 다시 줄인 것도 얹힌다(3층 조각이 걷힌다).
    setVerticalRange(a, 'st', '1F', '2F', new Map([['2F', { exit: [0.4, 3.8] as Vec2 }]]))
    const c = tower()
    applyEdits(c, parseEditFile(JSON.stringify(exportEdits(a, base, 'b.ifc'))) as EditFile)
    expect(c.storeys.map((s) => s.verticalParts)).toEqual(a.storeys.map((s) => s.verticalParts))
  })
})

describe('만들기 (OE-ML-06)', () => {
  const ring: Vec2[] = [[-0.5, 0], [0.5, 0], [0.5, 3], [-0.5, 3]]

  it('계단은 층별로 채워야 만든다 — 시작 층 형상·진입, 끝 층 종료. 이름이 비거나 채울 것이 남으면 이유와 함께 만들지 않는다 [OE-ML-06#2~,6~]', () => {
    const m = tower()
    const before = structuredClone(m.storeys.map((s) => s.verticalParts))
    const plan = planCreate(m, 'stair', '1F', '2F')
    expect('needs' in plan && plan.needs.map((n) => [n.storey.id, n.what])).toEqual([['1F', ['footprint', 'entry']], ['2F', ['exit']]])
    expect(createVertical(m, { id: 'U_new', kind: 'stair', name: '새 계단', from: '1F', to: '2F' }, new Map())).toEqual({ refused: expect.stringContaining('1F 형상·진입 지점') })
    const given = new Map([['1F', { footprint: ring, entry: [0, 0.2] as Vec2 }], ['2F', { exit: [0, 2.8] as Vec2 }]])
    expect(createVertical(m, { id: 'U_new', kind: 'stair', name: ' ', from: '1F', to: '2F' }, given)).toEqual({ refused: expect.stringContaining('이름') })
    // 계획·거절은 모델을 바꾸지 않는다(취소하면 남는 것이 없다).
    expect(m.storeys.map((s) => s.verticalParts)).toEqual(before)
    expect(createVertical(m, { id: 'U_new', kind: 'stair', name: '새 계단', from: '1F', to: '2F' }, given)).toEqual({ id: 'U_new' })
    expect(shape(m, 'U_new')).toEqual([['1F', 4, true, false], ['2F', 0, false, true]])
    expect(partsOf(m, 'U_new').every((p) => p.source === 'edit' && !p.edited)).toBe(true)
    // 진입·종료 지점이 든 물리존을 잇는다. 같은 id 로 또 만들 수는 없다.
    expect(explicitSpaceLinks(verticalObjects(m)).find((l) => l.parentId === 'U_new')).toMatchObject({ a: 'stair1', b: 'stair2', source: 'edit' })
    expect(createVertical(m, { id: 'U_new', kind: 'stair', name: '또', from: '1F', to: '2F' }, given)).toEqual({ refused: expect.stringContaining('같은 id') })
  })

  it('채울 것 전부를 채울 순서대로 늘어놓고 채운 것에 표시한다 — 계단은 끝 층을 뺀 층 형상·시작 층 진입·끝 층 종료, 샤프트는 축 하나 [OE-ML-06#1~]', () => {
    const m = tower()
    const steps = (kind: 'stair' | 'shaft', given: Map<string, { footprint?: Vec2[]; entry?: Vec2; exit?: Vec2 }>) => {
      const plan = planCreate(m, kind, '1F', '3F', given)
      if (!('needs' in plan)) throw new Error(plan.refused)
      return planSteps(kind, plan).map((s) => `${s.storey.id}:${s.what}${s.done ? '✓' : ''}`)
    }
    expect(steps('stair', new Map())).toEqual(['1F:footprint', '1F:entry', '2F:footprint', '3F:exit'])
    expect(steps('stair', new Map([['1F', { footprint: ring, entry: [0, 0.2] as Vec2 }]]))).toEqual(['1F:footprint✓', '1F:entry✓', '2F:footprint', '3F:exit'])
    // 엇갈린 형상은 채운 것으로 치지 않는다.
    expect(steps('stair', new Map([['1F', { footprint: [[0, 0], [1, 1], [1, 0], [0, 1]] as Vec2[] }]]))[0]).toBe('1F:footprint')
    expect(steps('shaft', new Map())).toEqual(['1F:footprint'])
    expect(steps('shaft', new Map([['2F', { footprint: ring }]]))).toEqual(['1F:footprint✓'])
  })

  it('층 높이를 모르거나 구간이 잘못되면 만들지 않는다 [OE-ML-06#6~]', () => {
    const m = tower()
    expect(planCreate(m, 'stair', '2F', '1F')).toEqual({ refused: expect.stringContaining('시작 층이 끝 층보다 위') })
    expect(planCreate(m, 'shaft', '1F', '1F')).toEqual({ refused: expect.stringContaining('같은 층') })
    m.storeys[2].elevation = Number.NaN
    expect(planCreate(m, 'shaft', '1F', '3F')).toEqual({ refused: expect.stringContaining('3F 의 층 높이를 모릅니다') })
  })

  it('샤프트는 형상 하나가 모든 층의 공통 축이고 지점이 없다. 한 층만 고치지 못하고 통째로 옮기면 축이 같이 간다 [OE-ML-06#1~] [OE-ML-07#3~] [OE-OBJ-14#1~,3~]', () => {
    const m = tower()
    const plan = planCreate(m, 'shaft', '1F', '3F')
    expect('needs' in plan && plan.needs.map((n) => [n.storey.id, n.what])).toEqual([['1F', ['footprint']]])
    expect(createVertical(m, { id: 'U_shaft', kind: 'shaft', name: 'PS-1', from: '1F', to: '3F' }, new Map([['1F', { footprint: ring }]]))).toEqual({ id: 'U_shaft' })
    const parts = partsOf(m, 'U_shaft')
    expect(parts.map((p) => [p.footprint, p.entry, p.exit])).toEqual([0, 1, 2].map(() => [ring, null, null]))
    expect(setPartVertex(m, 'U_shaft@2F', 0, [-1, 0])).toEqual({ refused: COMMON_AXIS_LOCKED })
    expect(movePart(m, 'U_shaft@2F', [1, 0])).toBe(false)
    moveVertical(m, 'U_shaft', [1, 0])
    expect(new Set(partsOf(m, 'U_shaft').map((p) => JSON.stringify(p.footprint))).size).toBe(1)
    // 샤프트는 물리존을 잇지 않는다(진입·종료 지점이 없다). GeoJSON 에는 층마다 나가고 로봇은 지나가지 못한다.
    expect(explicitSpaceLinks(verticalObjects(m)).some((l) => l.parentId === 'U_shaft')).toBe(false)
    const shafts = modelToGeoJSON(m).flatMap((f) => f.collection.features).filter((f) => f.properties?.parentId === 'U_shaft')
    expect(shafts.map((f) => [f.properties?.verticalKind, f.properties?.source, f.properties?.passable])).toEqual([0, 1, 2].map(() => ['shaft', 'edit', false]))
  })

  it('손으로 만든 계단·에스컬레이터·엘리베이터·샤프트가 층마다 조각으로 나가고, 층간 연결이 가리키는 조각·물리존이 모두 출력에 있다 [OE-ML-19#1]', () => {
    const m = tower()
    const stairGiven = new Map([['1F', { footprint: ring, entry: [0, 0.2] as Vec2 }], ['2F', { exit: [0, 2.8] as Vec2 }]])
    for (const [id, kind] of [['U_stair', 'stair'], ['U_es', 'escalator']] as const) {
      expect(createVertical(m, { id, kind, name: id, from: '1F', to: '2F' }, stairGiven)).toEqual({ id })
    }
    for (const [id, kind] of [['U_el', 'elevator'], ['U_ps', 'shaft']] as const) {
      const axis = new Map([['1F', { footprint: [[3, 0], [4, 0], [4, 1], [3, 1]] as Vec2[] }]])
      expect(createVertical(m, { id, kind, name: id, from: '1F', to: '3F' }, axis)).toEqual({ id })
    }
    const features = modelToGeoJSON(m).flatMap((f) => f.collection.features)
    const ids = new Set(features.map((f) => f.id))
    const made = features.filter((f) => String(f.properties?.parentId ?? '').startsWith('U_'))
    // 층마다 하나: 계단·ES 는 1F·2F, 엘리베이터·샤프트는 1F~3F 이고 출처는 편집이다.
    expect(made.map((f) => f.id).sort()).toEqual(['U_el@1F', 'U_el@2F', 'U_el@3F', 'U_es@1F', 'U_es@2F', 'U_ps@1F', 'U_ps@2F', 'U_ps@3F', 'U_stair@1F', 'U_stair@2F'])
    expect(made.every((f) => f.properties?.source === 'edit')).toBe(true)
    for (const f of made) {
      const p = f.properties!
      // 위·아래 층 조각을 잇고, 가리키는 것은 모두 출력에 있다.
      expect((p.verticalConnects as string[]).length).toBeGreaterThan(0)
      for (const to of [...(p.verticalConnects as string[]), ...((p.spaceIds as string[]) ?? [])]) expect(ids.has(to)).toBe(true)
    }
    // 계단·ES 는 진입·종료 지점이 든 물리존(1F·2F 계단실)을 잇는다. 엘리베이터·샤프트는 지점이 없어 물리존을 잇지 않는다.
    const links = explicitSpaceLinks(verticalObjects(m))
    expect(links.filter((l) => l.parentId.startsWith('U_')).map((l) => [l.parentId, l.a, l.b, l.source])).toEqual([
      ['U_stair', 'stair1', 'stair2', 'edit'],
      ['U_es', 'stair1', 'stair2', 'edit'],
    ])
    expect(features.find((f) => f.id === 'stair1')!.properties?.verticalConnects).toContain('stair2')
  })

  it('만든 것은 되돌리기 한 번에 사라지고, 편집 파일로 새로 연 BIM 에 얹으면 같은 오브젝트가 생긴다 [OE-ML-06#7~]', () => {
    const a = tower()
    const base = baselineOf(a)
    const snap = snapshotVerticals(a)
    const given = new Map([['1F', { footprint: ring, entry: [0, 0.2] as Vec2 }], ['3F', { exit: [0, 2.8] as Vec2 }], ['2F', { footprint: ring }]])
    createVertical(a, { id: 'U_new', kind: 'stair', name: '새 계단', from: '1F', to: '3F' }, given)
    expect(diffBaseline(a, base).verticals).toEqual([{ id: 'U_new', name: '새 계단', created: 'stair' }])
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'b.ifc'))) as EditFile
    expect(file.verticals?.[0]).toMatchObject({ id: 'U_new', created: { kind: 'stair', name: '새 계단' } })
    expect(countEdits(file)).toBe(1)
    const b = tower()
    expect(applyEdits(b, file).missing).toMatchObject({ elements: 0, storeys: 0 })
    expect(b.storeys.map((s) => s.verticalParts)).toEqual(a.storeys.map((s) => s.verticalParts))
    restore(a, snap)
    expect(verticalObjects(a).map((o) => o.id)).toEqual(['st', 'st2'])
  })
})

describe('엘리베이터 정차 층(OE-ML-10)과 로봇 통과(OE-ML-04)', () => {
  const axis: Vec2[] = rect(3, 0, 4, 1)
  const withElevator = () => {
    const m = tower()
    const done = createVertical(m, { id: 'U_el', kind: 'elevator', name: 'EL-1', from: '1F', to: '2F' }, new Map([['1F', { footprint: axis }]]))
    if ('refused' in done) throw new Error(done.refused)
    return m
  }
  const stops = (m: Model) => verticalObjects(m).find((o) => o.id === 'U_el')!.parts.map((p) => [p.storey.id, p.part.stop ?? 'unknown'])
  const passOf = (m: Model) =>
    modelToGeoJSON(m)
      .flatMap((f) => f.collection.features)
      .filter((f) => f.properties?.kind === 'vertical' && f.properties.parentId === 'U_el')
      .map((f) => [f.properties!.storeyId, f.properties!.passable, f.properties!.passableReason])

  it('수동으로 만들면 관통 구간 전 층이 정차로 시작하고, 층마다 무정차·미확인으로 바꾼다. 무정차·미확인은 확정 정차 목록에 없다 [OE-ML-10#1~,3]', () => {
    const m = withElevator()
    expect(stops(m)).toEqual([['1F', 'stop'], ['2F', 'stop']])
    expect(setElevatorStop(m, 'U_el', '2F', 'skip')).toBe(true)
    expect(setElevatorStop(m, 'U_el', '2F', 'skip')).toBe(false)
    expect(stops(m)).toEqual([['1F', 'stop'], ['2F', 'skip']])
    // 계단에는 정차가 없다.
    expect(setElevatorStop(m, 'st', '1F', 'stop')).toBe(false)
  })

  it('구간을 넓혀 새로 생긴 층은 미확인이고 통과 가능으로 나가지 않는다. 줄이면 빠진 층이 정차 목록에서 빠진다 [OE-ML-10#2~,4~] [OE-ML-04#2] [OE-ML-08#4~]', () => {
    const m = withElevator()
    expect(setVerticalRange(m, 'U_el', '1F', '3F')).toBe(true)
    expect(stops(m)).toEqual([['1F', 'stop'], ['2F', 'stop'], ['3F', 'unknown']])
    expect(passOf(m)).toEqual([['1F', true, 'elevator_stop'], ['2F', true, 'elevator_stop'], ['3F', false, 'elevator_stop_unconfirmed']])
    expect(setVerticalRange(m, 'U_el', '1F', '2F')).toBe(true)
    expect(stops(m)).toEqual([['1F', 'stop'], ['2F', 'stop']])
  })

  it('정차 층은 통과 가능, 무정차 층은 불가로 층마다 다르게 나간다. 계단·샤프트는 이어져 있어도 불가다 [OE-ML-04#1,3]', () => {
    const m = withElevator()
    setElevatorStop(m, 'U_el', '2F', 'skip')
    expect(passOf(m)).toEqual([['1F', true, 'elevator_stop'], ['2F', false, 'elevator_no_stop']])
    const stairs = modelToGeoJSON(m).flatMap((f) => f.collection.features).filter((f) => f.properties?.kind === 'vertical' && f.properties.verticalKind === 'stair')
    expect(stairs.length).toBeGreaterThan(0)
    expect(stairs.every((f) => f.properties!.passable === false && f.properties!.passableReason === 'staircase')).toBe(true)
  })

  it('정차를 바꾼 것은 되돌리기 한 번에 돌아오고, 편집 파일로 새로 연 모델에 얹어도 정차 목록과 층별 통과가 같다 [OE-ML-10#4] [OE-ML-04#4]', () => {
    const base = baselineOf(tower())
    const a = withElevator()
    const snap = snapshotVerticals(a)
    setElevatorStop(a, 'U_el', '2F', 'skip')
    const after = structuredClone(a.storeys.map((s) => s.verticalParts))
    restore(a, snap)
    expect(stops(a)).toEqual([['1F', 'stop'], ['2F', 'stop']])
    a.storeys.forEach((s, i) => (s.verticalParts = after[i]))
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'b.ifc'))) as EditFile
    expect(file.verticals?.find((v) => v.id === 'U_el')?.parts?.map((p) => p.stop)).toEqual(['stop', 'skip'])
    const b = tower()
    expect(applyEdits(b, file).missing).toMatchObject({ elements: 0, storeys: 0 })
    expect(stops(b)).toEqual(stops(a))
    expect(passOf(b)).toEqual(passOf(a))
    // 만든 뒤 정차만 바꾼 것도 연 때와 견준 차이에 남는다(층별로 고친 것).
    const c = withElevator()
    const cb = baselineOf(c)
    setElevatorStop(c, 'U_el', '1F', 'unknown')
    expect(diffBaseline(c, cb).verticals).toEqual([{ id: 'U_el', name: 'EL-1', reshaped: ['1F'] }])
  })
})

describe('에스컬레이터 운행 방향 (OE-ML-11)', () => {
  const ring: Vec2[] = rect(5, 0, 6, 3)
  const withEscalator = () => {
    const m = tower()
    const done = createVertical(m, { id: 'U_es', kind: 'escalator', name: 'ES-1', from: '1F', to: '2F' }, new Map([['1F', { footprint: ring, entry: [5.5, 0.2] as Vec2 }], ['2F', { exit: [5.5, 2.8] as Vec2 }]]))
    if ('refused' in done) throw new Error(done.refused)
    return m
  }
  const esFeatures = (m: Model) =>
    modelToGeoJSON(m)
      .flatMap((f) => f.collection.features)
      .filter((f) => f.properties?.kind === 'vertical' && f.properties.parentId === 'U_es')
      .map((f) => f.properties!)

  it('만든 직후 방향은 미확인이고 지어내지 않으며 로봇 통과는 불가다. 상행·하행을 정하면 운행 시작·종료 지점과 함께 GeoJSON 에 나간다 [OE-ML-11#1,5~]', () => {
    const m = withEscalator()
    expect(esFeatures(m).map((p) => [p.storeyId, p.direction, p.travel, p.passable])).toEqual([
      ['1F', null, undefined, false],
      ['2F', null, undefined, false],
    ])
    expect(setEscalatorDirection(m, 'U_es', 'up')).toBe(true)
    // 상행: 시작 층(1F, 0m) 진입 지점 → 끝 층(2F, 4.5m) 종료 지점. 진입·종료는 서로 다른 층·자리다.
    expect(esFeatures(m).map((p) => [p.direction, p.directionSource, p.travel])).toEqual([
      ['up', 'edit', { from: [5.5, 0.2, 0], to: [5.5, 2.8, 4.5] }],
      ['up', 'edit', { from: [5.5, 0.2, 0], to: [5.5, 2.8, 4.5] }],
    ])
    expect(setEscalatorDirection(m, 'U_es', 'down')).toBe(true)
    expect(esFeatures(m)[0].travel).toEqual({ from: [5.5, 2.8, 4.5], to: [5.5, 0.2, 0] })
    // 방향을 정해도 로봇 통과는 불가다.
    expect(esFeatures(m).every((p) => p.passable === false && p.passableReason === 'escalator')).toBe(true)
    // 엘리베이터·계단에는 방향이 없다.
    expect(setEscalatorDirection(m, 'st', 'up')).toBe(false)
  })

  it('같은 층을 양 끝으로 두거나, 구간을 줄여 운행 구간이 벗어나면 끝 지점을 다시 정하기 전에는 적용하지 않는다 [OE-ML-11#3,4]', () => {
    const m = tower()
    expect(createVertical(m, { id: 'U_es', kind: 'escalator', name: 'ES-1', from: '1F', to: '1F' }, new Map())).toEqual({ refused: expect.stringContaining('같은 층') })
    const es = withEscalator()
    // 3층까지 넓혔다가 2층으로 줄이면 2층이 다시 끝 층이 되어 종료 지점을 받아야 한다.
    expect(setVerticalRange(es, 'U_es', '1F', '3F', new Map([['2F', { footprint: ring }], ['3F', { exit: [5.5, 2.8] as Vec2 }]]))).toBe(true)
    setEscalatorDirection(es, 'U_es', 'up')
    expect(setVerticalRange(es, 'U_es', '1F', '2F')).toEqual({ refused: expect.stringContaining('2F 종료 지점') })
    expect(setVerticalRange(es, 'U_es', '1F', '2F', new Map([['2F', { exit: [5.5, 2.5] as Vec2 }]]))).toBe(true)
    // 방향은 구간을 바꿔도 그대로다.
    expect(esFeatures(es).map((p) => p.direction)).toEqual(['up', 'up'])
  })

  it('방향·구간·지점은 되돌리기 한 번에 돌아오고, 편집 파일로 새로 연 모델에 얹어도 같다 [OE-ML-11#7]', () => {
    const base = baselineOf(tower())
    const a = withEscalator()
    const snap = snapshotVerticals(a)
    setEscalatorDirection(a, 'U_es', 'up')
    const after = structuredClone(a.storeys.map((s) => s.verticalParts))
    restore(a, snap)
    expect(esFeatures(a).map((p) => p.direction)).toEqual([null, null])
    a.storeys.forEach((s, i) => (s.verticalParts = after[i]))
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'b.ifc'))) as EditFile
    const b = tower()
    expect(applyEdits(b, file).missing).toMatchObject({ elements: 0, storeys: 0 })
    expect(esFeatures(b)).toEqual(esFeatures(a))
    // 만든 뒤 방향만 바꾼 것도 연 때와 견준 차이에 남는다.
    const c = withEscalator()
    const cb = baselineOf(c)
    setEscalatorDirection(c, 'U_es', 'down')
    expect(diffBaseline(c, cb).verticals).toEqual([{ id: 'U_es', name: 'ES-1', reshaped: ['1F', '2F'] }])
  })
})
