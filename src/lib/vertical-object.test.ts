import { describe, expect, it } from 'vitest'
import type { Model, Space, Storey, Vec2, Vec3 } from './model'
import { explicitSpaceLinks, findPart, partLinks, partSpaces, stairParts, verticalObjects } from './vertical-object'
import { mergeModels } from './merge'

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
const space = (id: string, kind: string | null, footprint: Vec2[]): Space => ({ id, name: id, longName: id, footprint, areaM2: 1, boundedBy: [], kind })
const storey = (id: string, elevation: number, spaces: Space[] = []): Storey => ({ id, name: id, elevation, spaces, walls: [], openings: [], equipment: [] })
const model = (storeys: Storey[]): Model => ({ schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys, systems: [], connections: [], warnings: [] })

/** x 0~1 폭, y 0 에서 4 까지 오르는 곧은 계단. 아래 끝 높이 z0, 위 끝 z1. 단마다 점 네 개. */
function flight(z0: number, z1: number, steps = 10): Vec3[] {
  const out: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const y = (4 * i) / steps
    const z = z0 + ((z1 - z0) * i) / steps
    out.push([0, y, z], [1, y, z], [0, y, z - 0.15], [1, y, z - 0.15])
  }
  return out
}

describe('계단 오브젝트 (OE-ML-02)', () => {
  it('시작 층에 형상·진입 지점, 끝 층에 종료 지점을 둔다 — 1층 진입과 2층 종료가 다른 자리다', () => {
    const f1 = storey('1F', 0)
    const f2 = storey('2F', 4.5)
    // 난간을 뺀 위 끝은 위층 바닥보다 조금 낮다(병원 4.52 / 4.57).
    const made = stairParts({ id: 'st', name: '계단', points: flight(0, 4.45) }, f1, [f2, f1])!
    expect(made.map((m) => m.storey.id)).toEqual(['1F', '2F'])
    const [low, high] = made.map((m) => m.part)
    expect(low).toMatchObject({ parentId: 'st', kind: 'stair', source: 'bim', exit: null })
    expect(low.footprint).toHaveLength(4)
    expect(low.entry![1]).toBeCloseTo(0, 1)
    expect(high).toMatchObject({ footprint: [], entry: null })
    expect(high.exit![1]).toBeCloseTo(4, 1)
    expect(high.exit![2]).toBeGreaterThan(4.2)
  })

  it('다른 층에 닿지 않는 계단(한 층 안의 몇 계단)은 만들지 않는다', () => {
    const f1 = storey('1F', 0)
    expect(stairParts({ id: 'st', name: '계단', points: flight(0, 0.9) }, f1, [f1, storey('2F', 4.5)])).toBeNull()
  })

  it('끝 층은 위 끝 + 0.3m 안의 가장 높은 층이다 — 난간이 섞여 위 끝이 높아도 그 위층을 넘겨짚지 않는다', () => {
    const f1 = storey('1F', 0)
    const f2 = storey('2F', 3)
    const f3 = storey('3F', 6)
    // 3.9m 까지 올라간 점(난간)이 있어도 끝 층은 2F 다.
    const made = stairParts({ id: 'st', name: '계단', points: [...flight(0, 3), [0.5, 4, 3.9]] }, f1, [f1, f2, f3])!
    expect(made.map((m) => m.storey.id)).toEqual(['1F', '2F'])
    // 종료 지점은 위층 바닥 언저리의 점이다(난간 위 끝이 아니다).
    expect(made[1].part.exit![2]).toBeLessThan(3.1)
  })

  it('사이 층을 지나는 계단은 사이 층에 형상만 있는 조각을 둔다', () => {
    const b5 = storey('B5F', -23.1)
    const mezz = storey("B5'F", -19.8)
    const b4 = storey('B4F', -17.1)
    const made = stairParts({ id: 'st', name: '계단', points: flight(-23.1, -17.1, 20) }, b5, [b5, mezz, b4])!
    expect(made.map((m) => m.storey.id)).toEqual(['B5F', "B5'F", 'B4F'])
    expect(made[1].part).toMatchObject({ entry: null, exit: null })
    expect(made[1].part.footprint.length).toBeGreaterThanOrEqual(3)
  })

  it('진입·종료 지점이 드는 물리존을 그때 짚고, 오브젝트는 두 물리존을 잇는다', () => {
    const f1 = storey('1F', 0, [space('stair1', 'staircase', rect(-1, -1, 2, 2)), space('hall1', null, rect(-1, 2, 2, 6))])
    const f2 = storey('2F', 4.5, [space('stair2', 'staircase', rect(-1, 2, 2, 6))])
    for (const { storey: at, part } of stairParts({ id: 'st', name: '계단', points: flight(0, 4.45) }, f1, [f1, f2])!) at.verticalParts = [part]
    const m = model([f1, f2])
    expect(partSpaces(f1, f1.verticalParts![0])).toEqual(['stair1'])
    expect(partSpaces(f2, f2.verticalParts![0])).toEqual(['stair2'])
    const objects = verticalObjects(m)
    expect(objects.map((o) => [o.id, o.parts.map((p) => p.storey.id)])).toEqual([['st', ['1F', '2F']]])
    expect(explicitSpaceLinks(objects)).toEqual([{ a: 'stair1', b: 'stair2', parentId: 'st', source: 'bim' }])
    expect(Object.fromEntries(partLinks(objects))).toEqual({ 'st@1F': ['st@2F'], 'st@2F': ['st@1F'] })
    // 물리존을 지우면 낡은 id 를 가리키지 않는다(저장하지 않고 짚는다).
    f2.spaces = []
    expect(partSpaces(f2, f2.verticalParts![0])).toEqual([])
    expect(explicitSpaceLinks(verticalObjects(m))).toEqual([])
  })

  it('합치면 덧붙인 판본에만 있는 조각을 받고, 바탕에 있는 오브젝트는 두 번 넣지 않는다', () => {
    const part = (parentId: string) => ({ parentId, kind: 'stair' as const, name: parentId, source: 'bim' as const, footprint: [], entry: null, exit: null })
    const a = model([{ ...storey('1F', 0), verticalParts: [part('st')] }])
    const b = model([{ ...storey('1F', 0), verticalParts: [part('st'), part('other')] }, { ...storey('2F', 4), verticalParts: [part('st')] }])
    const merged = mergeModels(a, b).model
    expect(merged.storeys.map((s) => (s.verticalParts ?? []).map((p) => p.parentId))).toEqual([['st', 'other'], []])
  })

  it('조각 id 로 오브젝트와 그 층의 자리(시작·사이·끝)를 찾는다 — 층 편집 화면이 고른 조각을 읽는다 (OE-ML-05)', () => {
    const b5 = storey('B5F', -23.1)
    const mezz = storey("B5'F", -19.8)
    const b4 = storey('B4F', -17.1)
    for (const { storey: at, part } of stairParts({ id: 'st', name: '계단', points: flight(-23.1, -17.1, 20) }, b5, [b5, mezz, b4])!) at.verticalParts = [part]
    // 층 순서가 높이 순이 아니어도 높이로 센다.
    const m = model([b4, b5, mezz])
    expect(findPart(m, 'st@B5F')).toMatchObject({ index: 0, role: 'start' })
    expect(findPart(m, "st@B5'F")).toMatchObject({ index: 1, role: 'through' })
    const top = findPart(m, 'st@B4F')!
    expect(top).toMatchObject({ index: 2, role: 'end' })
    expect(top.object.parts.map((p) => p.storey.id)).toEqual(['B5F', "B5'F", 'B4F'])
    expect(findPart(m, 'st@1F')).toBeNull()
    expect(findPart(m, 'st')).toBeNull()
  })
})
