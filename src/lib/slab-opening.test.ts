import { describe, expect, it } from 'vitest'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import type { Model, Slab, Storey, Vec2, VerticalPart } from './model'
import { netAreaM2, slabOpenings, spaceSlabCuts } from './slab-opening'
import { verticalObjects } from './vertical-object'
import { createVertical, deleteVertical, draftVertical, planCreate, planFlight, rotateVertical, setPartVertex, setVerticalRange, verticalEffect } from './vertical-edit'

// 슬래브 개구부 판정(OE-ML-03). 층 셋(0m · 3m · 6m)과 2m×2m 샤프트. 슬래브 윗면은 삼각형 둘로 된 사각형이다.
const square = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
/** 사각형 슬래브(구멍이 있으면 그 자리를 뺀 네 조각). */
function slab(id: string, top: number, outer: [number, number, number, number], hole?: { id: string; at: [number, number, number, number] }): Slab {
  const rects: [number, number, number, number][] = hole
    ? [
        [outer[0], outer[1], hole.at[0], outer[3]],
        [hole.at[2], outer[1], outer[2], outer[3]],
        [hole.at[0], outer[1], hole.at[2], hole.at[1]],
        [hole.at[0], hole.at[3], hole.at[2], outer[3]],
      ]
    : [outer]
  const tris = rects.flatMap(([x0, y0, x1, y1]) => [x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1])
  return { id, name: id, kind: 'floor', top, tris, openings: hole ? [{ id: hole.id, footprint: square(...hole.at) }] : [] }
}
const part = (footprint: Vec2[], source: VerticalPart['source'] = 'edit', edited?: true): VerticalPart => ({
  parentId: 'SH',
  kind: 'shaft',
  name: '샤프트',
  source,
  footprint,
  entry: null,
  exit: null,
  ...(edited ? { edited } : {}),
})
const storey = (id: string, elevation: number, parts: VerticalPart[], slabs?: Slab[]) =>
  ({ id, name: id, elevation, spaces: [], walls: [], openings: [], equipment: [], verticalParts: parts, ...(slabs ? { slabs } : {}) }) as unknown as Storey
const SHAFT = square(4, 4, 6, 6)

describe('슬래브 개구부 (OE-ML-03)', () => {
  it('실제로 덮는 슬래브에만 개구부를 내고, 시작 층 바닥과 끝 층 위는 뚫지 않으며, BIM 개구부는 다시 쓴다 [OE-ML-03#1] [OE-ML-03#3~]', () => {
    const model = {
      storeys: [
        storey('1F', 0, [part(SHAFT)], [slab('S1', 0, [0, 0, 10, 10])]),
        storey('2F', 3, [part(SHAFT)], [slab('S2', 3, [0, 0, 10, 10])]),
        storey('3F', 6, [part(SHAFT)], [slab('S3', 6, [0, 0, 10, 10], { id: 'OP3', at: [4, 4, 6, 6] })]),
      ],
    }
    const got = slabOpenings(model, verticalObjects(model)[0])
    // 1F(시작 층) 바닥은 없다. 3F 위 지붕도 없다.
    expect(got.map((o) => [o.storeyId, o.state])).toEqual([
      ['2F', 'cut'],
      ['3F', 'bim'],
    ])
    expect(got[0]).toMatchObject({ slabId: 'S2', areaM2: 4, coverM2: 4 })
    expect(got[0].reason).toBe('S2가 이 자리를 덮고 있어(덮은 넓이 4.00㎡ / 형상 4.00㎡) 개구부를 냅니다.')
    expect(got[1]).toMatchObject({ bimOpeningId: 'OP3', slabId: 'S3', coverM2: 0 })
  })

  it('그 층 바닥에 슬래브가 없으면 사유를 단 초안이고, 형상이 없으면 임의 형상 없이 산정 못 함이다 [OE-ML-03#2~]', () => {
    const model = {
      storeys: [storey('1F', 0, [part(SHAFT)]), storey('2F', 3, [part(SHAFT)]), storey('3F', 6, [part([])]), storey('4F', 9, [part([])], [slab('S4', 9, [0, 0, 10, 10])])],
    }
    // 2F 위 3F 조각은 형상이 없어 2F 조각 형상이 올라온 자리다. 4F 는 3F·4F 모두 형상이 없다.
    const got = slabOpenings(model, verticalObjects(model)[0])
    expect(got.map((o) => [o.storeyId, o.state, o.footprint?.length ?? null])).toEqual([
      ['2F', 'draft', 4],
      ['3F', 'draft', 4],
      ['4F', 'unmeasured', null],
    ])
    expect(got[0].reason).toBe('2F 바닥 높이(±0.6m)에 슬래브가 없습니다(BIM 에 바닥 슬래브가 없거나 읽지 않음). 조각 형상으로 초안을 두고, 확인 전에는 면적에 반영하지 않습니다.')
    expect(got[2].reason).toBe('4F와 아래 층 조각 모두 평면 형상이 없어 개구부 형상을 정할 근거가 없습니다. 형상을 채운 뒤 다시 잽니다.')
  })

  it('슬래브 외곽선이 비워 둔 자리는 새로 만들지 않고, 손대지 않은 BIM 오브젝트는 슬래브가 덮어도 뚫지 않지만 옮긴 것은 뚫는다 [OE-ML-03#5~]', () => {
    // 2F 슬래브가 샤프트 자리를 비워 두었다(구멍 요소 없이 외곽선으로). 3F 슬래브는 샤프트 자리를 덮는다.
    const holed = slab('S2', 3, [0, 0, 10, 10], { id: 'unused', at: [4, 4, 6, 6] })
    holed.openings = []
    const build = (source: VerticalPart['source'], edited?: true) => ({
      storeys: [
        storey('1F', 0, [part(SHAFT, source, edited)]),
        storey('2F', 3, [part(SHAFT, source, edited)], [holed]),
        storey('3F', 6, [part(SHAFT, source, edited)], [slab('S3', 6, [0, 0, 10, 10])]),
      ],
    })
    const states = (m: ReturnType<typeof build>) => slabOpenings(m, verticalObjects(m)[0]).map((o) => o.state)
    expect(states(build('edit'))).toEqual(['open', 'cut'])
    expect(states(build('bim'))).toEqual(['open', 'open'])
    expect(slabOpenings(build('bim'), verticalObjects(build('bim'))[0])[1].reason).toBe(
      '원본 BIM 오브젝트라 슬래브 형상을 그대로 씁니다(덮은 넓이 4.00㎡ / 형상 4.00㎡ — 계단이 슬래브 밑을 지나는 자리). 새로 만들지 않습니다.',
    )
    expect(states(build('bim', true))).toEqual(['open', 'cut'])
  })

  it('옮기면 다시 잰다 — 덮인 자리로 옮기면 개구부가 생기고, BIM 개구부가 있던 자리를 떠나면 그 개구부는 쓰지 않는다(원본은 슬래브에 그대로) [OE-ML-03#5~]', () => {
    const s3 = slab('S3', 3, [0, 0, 10, 10], { id: 'OP', at: [4, 4, 6, 6] })
    const model = { storeys: [storey('1F', 0, [part(SHAFT)]), storey('2F', 3, [part(SHAFT)], [s3])] }
    expect(slabOpenings(model, verticalObjects(model)[0]).map((o) => o.state)).toEqual(['bim'])
    const moved = square(1, 1, 3, 3)
    for (const st of model.storeys) st.verticalParts = [part(moved)]
    const got = slabOpenings(model, verticalObjects(model)[0])
    expect(got.map((o) => [o.state, o.coverM2])).toEqual([['cut', 4]])
    expect(s3.openings.map((o) => o.id)).toEqual(['OP'])
  })
})

describe('돌리기·크기 수정 뒤 개구부 (OE-ML-07 AC4)', () => {
  it('돌리거나 층 조각 크기를 바꾸면 그 형상으로 다시 재고, 앞 판정을 이어받지 않는다 [OE-ML-07#4~]', () => {
    // 2F 슬래브가 (4..6, 4..6) 을 비워 두었다(외곽선으로, 구멍 요소 없이). 그 자리의 사람이 만든 계단.
    const holed = slab('S2', 3, [0, 0, 10, 10], { id: 'unused', at: [4, 4, 6, 6] })
    holed.openings = []
    const stair = (footprint: Vec2[]): VerticalPart => ({ ...part(footprint), kind: 'stair', name: '계단' })
    const model = { storeys: [storey('1F', 0, [stair(SHAFT)]), storey('2F', 3, [stair(SHAFT)], [holed])] }
    const judge = () => slabOpenings(model, verticalObjects(model)[0]).map((o) => [o.state, o.coverM2])
    expect(judge()).toEqual([['open', 0]])

    // 가운데를 축으로 45° 돌리면 모서리 넷이 슬래브에 걸치지만(정확히는 0.69㎡, 격자로 재 0.78㎡ / 4㎡) 문턱(25%) 밑이라 여전히 비어 있음이다.
    expect(rotateVertical(model, 'SH', 45, [5, 5])).toBe(true)
    const [state, cover] = judge()[0]
    expect(state).toBe('open')
    expect(cover as number).toBeGreaterThan(0.5)
    expect(cover as number).toBeLessThan(1)
    expect(rotateVertical(model, 'SH', -45, [5, 5])).toBe(true)

    // 2F 조각을 슬래브가 덮는 쪽(x 9 까지)으로 늘리면 덮은 넓이로 다시 재어 확정 개구부가 된다. 늘린 몫만큼(6..9 × 4..6 = 6㎡, 격자로 재 5.94㎡) 뚫는다.
    expect(setPartVertex(model, 'SH@2F', 1, [9, 4])).toBe(true)
    expect(setPartVertex(model, 'SH@2F', 2, [9, 6])).toBe(true)
    const [after, cut] = judge()[0]
    expect(after).toBe('cut')
    expect(cut as number).toBeCloseTo(6, 0)
  })
})

describe('구간을 줄인 뒤 개구부 (OE-ML-08 AC3)', () => {
  it('구간을 줄이면 빠진 층의 편집 개구부만 사라지고, 그 층 슬래브의 BIM 개구부는 원본 그대로 남는다 [OE-ML-08#3~]', () => {
    const s3 = slab('S3', 6, [0, 0, 10, 10], { id: 'OP3', at: [4, 4, 6, 6] })
    const model = {
      storeys: [
        storey('1F', 0, [part(SHAFT)], [slab('S1', 0, [0, 0, 10, 10])]),
        storey('2F', 3, [part(SHAFT)], [slab('S2', 3, [0, 0, 10, 10])]),
        storey('3F', 6, [part(SHAFT)], [s3]),
        storey('4F', 9, [part(SHAFT)], [slab('S4', 9, [0, 0, 10, 10])]),
      ],
    }
    const judge = () => slabOpenings(model, verticalObjects(model)[0]).map((o) => [o.storeyId, o.state])
    expect(judge()).toEqual([['2F', 'cut'], ['3F', 'bim'], ['4F', 'cut']])
    // 1F~4F → 1F~2F. 4F 의 편집 개구부는 계산에서 빠지고, 3F 의 BIM 개구부는 슬래브에 그대로다(이 오브젝트가 더는 쓰지 않을 뿐).
    expect(setVerticalRange(model, 'SH', '1F', '2F')).toBe(true)
    expect(judge()).toEqual([['2F', 'cut']])
    expect(s3.openings.map((o) => o.id)).toEqual(['OP3'])
  })
})

describe('만드는 동안의 개구부 미리보기 (OE-ML-06 AC5)', () => {
  // 1F(0m) → 2F(3m) 계단. 2F 바닥 슬래브는 x 0~10 을 덮고 x 10~20 은 계단 자리처럼 비워 두었다.
  const floors = (withSlab: boolean) => ({
    storeys: [
      storey('1F', 0, [], [slab('S1', 0, [0, 0, 20, 10])]),
      storey('2F', 3, [], withSlab ? [slab('S2', 3, [0, 0, 10, 10])] : undefined),
    ],
  })
  const draftAt = (model: ReturnType<typeof floors>, start: Vec2) => {
    const f = planFlight(model, 'stair', '1F', start, 0)
    if ('refused' in f) throw new Error(f.refused)
    const given = new Map([['1F', { footprint: f.footprint, entry: f.entry }], ['2F', { exit: f.exit }]])
    const plan = planCreate(model, 'stair', '1F', '2F', given)
    if ('refused' in plan) throw new Error(plan.refused)
    return { given, plan, openings: slabOpenings(model, draftVertical('stair', plan, given)) }
  }

  it('초안 형상이 슬래브 아래면 위층 바닥이 확정, 비워 둔 자리면 이미 비어 있음, 바닥 슬래브가 없으면 초안이고, 모델은 그대로다 [OE-ML-06#5]', () => {
    const model = floors(true)
    const covered = draftAt(model, [2, 5]).openings
    expect(covered.map((o) => [o.storeyId, o.state])).toEqual([['2F', 'cut']])
    expect(covered[0].coverM2).toBeCloseTo(covered[0].areaM2!, 1)
    // 계단 자리를 비워 둔 쪽으로 옮겨 찍으면(커서를 따라 다시 잰다) 새로 뚫지 않는다.
    expect(draftAt(model, [12, 5]).openings.map((o) => o.state)).toEqual(['open'])
    // 바닥 슬래브가 없는 BIM — 초안이고, 확인 전에는 면적에 반영하지 않는다고 까닭을 단다.
    const draft = draftAt(floors(false), [2, 5]).openings
    expect(draft.map((o) => o.state)).toEqual(['draft'])
    expect(draft[0].reason).toContain('확인 전에는 면적에 반영하지 않습니다')
    // 미리보기는 모델에 조각을 넣지 않는다.
    expect(model.storeys.every((s) => !s.verticalParts?.length)).toBe(true)
  })

  it('미리보기 판정은 [만들기] 뒤 패널의 판정과 같다 [OE-ML-06#5]', () => {
    for (const [withSlab, start] of [[true, [2, 5]], [true, [12, 5]], [false, [2, 5]]] as const) {
      const model = floors(withSlab)
      const { given, openings } = draftAt(model, [...start] as Vec2)
      const made = createVertical(model, { id: 'NEW', kind: 'stair', name: '새 계단', from: '1F', to: '2F' }, given)
      expect('id' in made).toBe(true)
      const after = slabOpenings(model, verticalObjects(model).find((o) => o.id === 'NEW')!)
      expect(after.map((o) => [o.storeyId, o.state])).toEqual(openings.map((o) => [o.storeyId, o.state]))
    }
  })

  it('두 개구부가 겹치면 합집합과 물리존의 교차 면적만 한 번 빼고, 원본·초안 개구부는 빼지 않으며, 하나를 지우면 그 편집 개구부 몫만 돌아온다. TTL·GeoJSON 의 넓이가 그 값이다 [OE-ML-03#2~,3~,4] [OE-ML-09#3~]', () => {
    const sh1 = (fp: Vec2[]): VerticalPart => ({ ...part(fp), parentId: 'SH1', name: '샤프트 1' })
    const sh2 = (fp: Vec2[]): VerticalPart => ({ ...part(fp), parentId: 'SH2', name: '샤프트 2' })
    const bimStair = (fp: Vec2[]): VerticalPart => ({ ...part(fp, 'bim'), parentId: 'ST_BIM', kind: 'stair', name: '원본 계단' })
    const parts = () => [sh1(square(4, 4, 6, 6)), sh2(square(5, 4, 7, 6)), bimStair(square(1, 1, 3, 3))]
    const room = (id: string, x0: number) => ({ id, name: id, longName: '', footprint: square(x0, 0, x0 + 10, 10), areaM2: 100 })
    // SH1(4..6, 4..6 = 4㎡)과 SH2(5..7, 4..6 = 4㎡)가 (5..6, 4..6 = 2㎡)에서 겹친다 → 합집합 6㎡.
    // ST_BIM 은 BIM 개구부(OP_BIM, 1..3, 1..3 = 4㎡) 자리라 원본 외곽선이 이미 비워 둔 것으로 보고 빼지 않는다.
    const s2 = slab('S2', 3, [0, 0, 10, 10], { id: 'OP_BIM', at: [1, 1, 3, 3] })
    const model = {
      schema: 'IFC4',
      siteName: '',
      buildingId: 'B',
      buildingName: '',
      warnings: [],
      connections: [],
      systems: [],
      storeys: [
        storey('1F', 0, parts(), [slab('S1', 0, [0, 0, 10, 10])]),
        // R2B 는 샤프트와 겹치지 않는 옆 방이다.
        { ...storey('2F', 3, parts(), [s2]), spaces: [room('R2', 0), room('R2B', 10)] },
        // 3F 는 바닥 슬래브가 없어 초안(draft)이라 빼지 않는다.
        { ...storey('3F', 6, parts()), spaces: [room('R3', 0)] },
      ],
    } as unknown as Model
    expect([...spaceSlabCuts(model)]).toEqual([['R2', 6]])
    expect(netAreaM2(model.storeys[1].spaces[0], spaceSlabCuts(model))).toBe(94)
    // 내보내는 넓이가 뺀 값이다. 외곽선 넓이(Space.areaM2)는 그대로다.
    expect(modelToTTL(model)).toMatch(/ex:R2 a brick:Room ;[^.]*ex:areaM2 94 \./)
    expect(modelToTTL(model)).toMatch(/ex:R2B a brick:Room ;[^.]*ex:areaM2 100 \./)
    const r2 = modelToGeoJSON(model)[1].collection.features.find((f) => f.id === 'R2')!
    expect(r2.properties).toMatchObject({ areaM2: 94, slabOpeningM2: 6 })
    expect(modelToGeoJSON(model)[2].collection.features.find((f) => f.id === 'R3')!.properties).not.toHaveProperty('slabOpeningM2')
    expect(model.storeys[1].spaces[0].areaM2).toBe(100)

    // SH2 만 지우면 SH2 의 편집 개구부 몫만 돌아오고, SH1(4㎡)과 원본 BIM 개구부(OP_BIM)는 그대로다(OE-ML-09 AC3).
    expect(deleteVertical(model, 'SH2')).toBe(true)
    expect([...spaceSlabCuts(model)]).toEqual([['R2', 4]])
    expect(s2.openings.map((o) => o.id)).toEqual(['OP_BIM'])
  })
})

describe('지우기·구간 줄이기 전 영향 (OE-ML-08 AC1 · OE-ML-09 AC1·3)', () => {
  const room = (id: string) => ({ id, name: id, longName: '', footprint: square(0, 0, 10, 10), areaM2: 100 })
  // 1F~4F 샤프트(2×2=4㎡). 2F·4F 바닥은 덮고 있어 편집 개구부가 확정이고, 3F 바닥은 BIM 개구부(OP3)가 이미 뚫려 있다.
  const build = () => {
    const s3 = slab('S3', 6, [0, 0, 10, 10], { id: 'OP3', at: [4, 4, 6, 6] })
    const model = {
      storeys: [
        storey('1F', 0, [part(SHAFT)], [slab('S1', 0, [0, 0, 10, 10])]),
        { ...storey('2F', 3, [part(SHAFT)], [slab('S2', 3, [0, 0, 10, 10])]), spaces: [room('R2')] },
        storey('3F', 6, [part(SHAFT)], [s3]),
        { ...storey('4F', 9, [part(SHAFT)], [slab('S4', 9, [0, 0, 10, 10])]), spaces: [room('R4')] },
      ],
    } as unknown as Pick<Model, 'storeys'>
    return { model, s3 }
  }
  const total = (m: Map<string, number>) => [...m.values()].reduce((n, v) => n + v, 0)

  it('지우기 전에 층 바닥마다의 개구부와 물리존에서 지금 빼고 있는 넓이를 보이고, 모델은 그대로다 [OE-ML-09#1]', () => {
    const { model } = build()
    const before = JSON.stringify(model)
    const fx = verticalEffect(model, 'SH')!
    expect(fx.openings.map((o) => [o.storey, o.state, o.gone])).toEqual([['2F', 'cut', false], ['3F', 'bim', false], ['4F', 'cut', false]])
    expect(fx.spaces).toEqual([{ storey: '2F', space: 'R2', m2: 4 }, { storey: '4F', space: 'R4', m2: 4 }])
    expect(fx.stops).toBeNull()
    expect(verticalEffect(model, '없는 것')).toBeNull()
    expect(JSON.stringify(model)).toBe(before)
  })

  it('보인 넓이가 지운 뒤 돌아오는 넓이와 같고, 원본 BIM 개구부는 슬래브에 그대로이며, 되돌리면 같은 영향이 다시 나온다 [OE-ML-09#3]', () => {
    const { model, s3 } = build()
    const fx = verticalEffect(model, 'SH')!
    const cuts = spaceSlabCuts(model)
    expect(total(cuts)).toBe(fx.spaces.reduce((n, s) => n + s.m2, 0))
    const parts = model.storeys.map((s) => s.verticalParts)
    expect(deleteVertical(model, 'SH')).toBe(true)
    expect(spaceSlabCuts(model).size).toBe(0)
    expect(s3.openings.map((o) => o.id)).toEqual(['OP3'])
    model.storeys.forEach((s, i) => (s.verticalParts = parts[i]))
    expect(verticalEffect(model, 'SH')).toEqual(fx)
  })

  it('구간을 줄이기 전에 빠지는 층의 개구부·돌아오는 넓이만 보이고, 남는 층 몫은 보이지 않으며 적용 뒤 실제와 같고, 샤프트 안 배관과 BIM 개구부는 그대로다 [OE-ML-08#1~] [OE-ML-08#3]', () => {
    const { model, s3 } = build()
    // 샤프트에 든 배관 구간(3F). 구간을 줄여도 설비는 건드리지 않는다.
    model.storeys[2].equipment = [{ id: 'P1', name: '배관', role: 'segment', shaftId: 'SH' }] as unknown as Storey['equipment']
    const pipes = JSON.stringify(model.storeys.map((s) => s.equipment))
    const fx = verticalEffect(model, 'SH', new Set(['3F', '4F']))!
    expect(fx.openings.map((o) => [o.storey, o.gone])).toEqual([['2F', false], ['3F', true], ['4F', true]])
    // 돌아오는 것은 4F 의 R4 뿐이다 — 2F 개구부는 남는다. 3F 의 BIM 개구부는 슬래브 원본이라 넓이에 들지 않는다.
    expect(fx.spaces).toEqual([{ storey: '4F', space: 'R4', m2: 4 }])
    const before = total(spaceSlabCuts(model))
    expect(setVerticalRange(model, 'SH', '1F', '2F')).toBe(true)
    expect(before - total(spaceSlabCuts(model))).toBe(fx.spaces.reduce((n, s) => n + s.m2, 0))
    expect(verticalEffect(model, 'SH')!.openings.map((o) => o.storey)).toEqual(['2F'])
    expect(s3.openings.map((o) => o.id)).toEqual(['OP3'])
    expect(JSON.stringify(model.storeys.map((s) => s.equipment))).toBe(pipes)
  })

  it('엘리베이터는 층별 정차를 보이고, 구간을 줄이면 빠지는 층이 정차 목록에서 빠진다고 알린다 [OE-ML-08#1~]', () => {
    const { model } = build()
    const stops = ['stop', 'skip', 'unknown', 'stop'] as const
    model.storeys.forEach((s, i) => (s.verticalParts = [{ ...part(SHAFT), kind: 'elevator', stop: stops[i] }]))
    const fx = verticalEffect(model, 'SH', new Set(['4F']))!
    expect(fx.stops).toEqual([
      { storeyId: '1F', storey: '1F', stop: 'stop', gone: false },
      { storeyId: '2F', storey: '2F', stop: 'skip', gone: false },
      { storeyId: '3F', storey: '3F', stop: 'unknown', gone: false },
      { storeyId: '4F', storey: '4F', stop: 'stop', gone: true },
    ])
    expect(setVerticalRange(model, 'SH', '1F', '3F')).toBe(true)
    expect(verticalEffect(model, 'SH')!.stops!.map((s) => s.storeyId)).toEqual(['1F', '2F', '3F'])
  })
})
