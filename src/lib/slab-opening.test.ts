import { describe, expect, it } from 'vitest'
import type { Slab, Storey, Vec2, VerticalPart } from './model'
import { slabOpenings } from './slab-opening'
import { verticalObjects } from './vertical-object'
import { createVertical, draftVertical, planCreate, planFlight } from './vertical-edit'

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
})
