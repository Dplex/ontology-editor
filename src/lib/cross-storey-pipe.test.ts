// 층간 배관(라이저·오프셋, OE-ML-12·14·18 · OE-PIP-15). mep.ifc(1F: AHU-1(1,1,3.2))에 층을 둘 더 얹는다: 2F 바닥 4m, 3F 바닥 8m.
// 2F 에는 BIM 설비처럼 AT-201(5,5,6.7)을 둔다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { drawPipe, type PipeSpec } from './manual-pipe'
import { baselineOf, restore, type Snapshot } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { segmentPath, type Model, type Storey, type Vec2 } from './model'
import { storeyAtZ, toCommon } from './storey-z'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const tower = (): Model => {
  const m = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
  const at = equip(m, 'AT-101-01')
  const floor = (id: string, elevation: number): Storey => ({ id, name: id, elevation, spaces: [], walls: [], openings: [], equipment: [] })
  const f2 = floor('2F', 4)
  f2.equipment.push({ ...structuredClone(at), id: 'AT-201', name: 'AT-201', position: [5, 5, 6.7], systemId: null })
  m.storeys.push(f2, floor('3F', 8))
  return m
}
const F1 = (m: Model) => m.storeys[0].id
const homeOf = (m: Model, id: string) => m.storeys.find((s) => s.equipment.some((e) => e.id === id))!.id
/** 2층 바닥에서 2.5m(공통 z 6.5m)로 올라 (5,1)로 옮기는 경로. */
const riserVia = (): PipeSpec['via'] => [
  { at: [1, 1], storeyId: '2F', height: 2.5 },
  { at: [5, 1], storeyId: '2F', height: 2.5 },
]
const riser = (m: Model, over: Partial<PipeSpec> = {}) => drawPipe(m, { from: equip(m, 'AHU-1').id, to: 'AT-201', via: riserVia(), flowType: 'SA', range: [F1(m), '2F'], ...over })

describe('층 상대 높이와 공통 z (OE-ML-18)', () => {
  it('층 상대 높이에는 그 층 바닥을 더하고, 공통 z 는 그대로 둔다 [OE-ML-18#1] [OE-ML-18#2]', () => {
    const m = tower()
    expect(toCommon(m, { at: [1, 2], storeyId: '2F', height: 2.5 })).toEqual([1, 2, 6.5])
    expect(toCommon(m, [1, 2, 6.5])).toEqual([1, 2, 6.5])
  })

  it('공통 z 가 든 층은 바닥 ≤ z < 위층 바닥이다. 바닥에 찍은 점은 그 층이다', () => {
    const m = tower()
    expect([3.2, 4, 3.9995, 7.99, 8, 30, -1].map((z) => storeyAtZ(m, z)?.id ?? null)).toEqual([F1(m), '2F', '2F', '2F', '3F', '3F', null])
  })
})

describe('층간 배관 — 라이저·오프셋 (OE-ML-12·14 · OE-PIP-15)', () => {
  it('1층 공조기에서 수직으로 올라 2층에서 옆으로 옮겨 2층 설비에 닿는다. 수직 구간은 자르지 않고 아래 끝의 층이다 [OE-ML-12#1] [OE-ML-12#4] [OE-ML-14#1] [OE-PIP-15#2~]', () => {
    const m = tower()
    const ahu = equip(m, 'AHU-1')
    const done = riser(m)
    if ('refused' in done) throw new Error(done.refused)
    const [up, offset, last] = done.segments
    expect(done.segments.map((e) => segmentPath(e))).toEqual([
      { path: [[1, 1, 3.2], [1, 1, 6.5]] },
      { path: [[1, 1, 6.5], [5, 1, 6.5]] },
      { path: [[5, 1, 6.5], [5, 5, 6.7]] },
    ])
    // 수직 구간은 2층 바닥(4m)을 지나도 구간 하나이고 아래 끝(3.2m)이 든 1층의 것이다. 이음쇠는 6.5m 라 2층이다.
    expect([up, offset, last, ...done.fittings].map((e) => [e.name, homeOf(m, e.id), done.storeyOf.get(e.id)])).toEqual([
      ['SA 덕트 1', F1(m), F1(m)],
      ['SA 덕트 3', '2F', '2F'],
      ['SA 덕트 5', '2F', '2F'],
      ['SA 이음 2', '2F', '2F'],
      ['SA 이음 4', '2F', '2F'],
    ])
    // 수동 연결이고 방향은 정하지 않는다.
    expect(done.connections.every((c) => c.source === 'manual' && !c.directed)).toBe(true)
    expect([done.connections[0].from, done.connections[0].to, done.connections.at(-1)!.to]).toEqual([ahu.id, up.id, 'AT-201'])
    expect(done.length).toBeCloseTo(3.3 + 4 + Math.hypot(4, 0.2), 9)
    // GeoJSON 경로의 높이도 같은 공통 z 다(층 높이를 다시 더하지 않는다).
    const f = modelToGeoJSON(m).flatMap((x) => x.collection.features).find((x) => x.id === up.id)!
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[1, 1, 3.2], [1, 1, 6.5]] })
  })

  it('공통 z 로 준 경로와 층 상대 높이로 준 경로가 같다 — 층 높이를 두 번 더하지 않는다 [OE-ML-18#2]', () => {
    const paths = (via: PipeSpec['via']) => {
      const m = tower()
      const done = riser(m, { via })
      if ('refused' in done) throw new Error(done.refused)
      return done.segments.map((e) => segmentPath(e))
    }
    expect(paths([[1, 1, 6.5], [5, 1, 6.5]])).toEqual(paths(riserVia()))
  })

  it('경로가 다른 설비 자리를 지나도 그 설비와 잇지 않는다 — 그린 조각끼리와 양 끝만 잇는다 [OE-ML-14#6~]', () => {
    const m = tower()
    const passed = equip(m, 'AT-101-01')
    const links = (id: string) => m.connections.filter((c) => c.from === id || c.to === id).length
    const [before, system] = [links(passed.id), passed.systemId]
    // 1층 디퓨저 AT-101-01(3,4,2.7) 자리를 꺾임점으로 지나 수직으로 올라간다.
    const done = riser(m, { via: [[3, 4, 2.7], [3, 4, 6.5]] })
    if ('refused' in done) throw new Error(done.refused)
    expect(links(passed.id)).toBe(before)
    expect(passed.systemId).toBe(system)
    const mine = new Set([...done.segments, ...done.fittings].map((e) => e.id).concat(equip(m, 'AHU-1').id, 'AT-201'))
    expect(done.connections.every((c) => mine.has(c.from) && mine.has(c.to))).toBe(true)
    expect(done.connections).toHaveLength(done.segments.length + done.fittings.length + 1)
  })

  it('끝 설비의 자리는 그대로이고, 다른 x·y 는 사람이 찍은 수평 구간으로만 잇는다 [OE-ML-12#2]', () => {
    const m = tower()
    const before = structuredClone(equip(m, 'AT-201').position)
    expect('refused' in riser(m)).toBe(false)
    expect(equip(m, 'AT-201').position).toEqual(before)
  })

  it('보기 범위 밖의 끝·점, 비스듬히 층을 지나는 구간, 길이 0 은 막고 모델을 바꾸지 않는다 [OE-ML-12#3] [OE-ML-14#3]', () => {
    const m = tower()
    const before = JSON.stringify(m)
    const up = { at: [1, 1] as Vec2, storeyId: '2F', height: 2.5 }
    // 범위가 1층뿐이면 2층 끝 대상이 밖이다.
    expect(riser(m, { via: [up], range: [F1(m)] })).toEqual({ refused: 'AT-201의 층(2F)이 보기 범위 밖입니다. 보기 범위를 넓힌 뒤 완료합니다.' })
    // 2층 바닥에서 5m = 9m 는 3층(8m 부터)이라 1~2층 범위 밖이다.
    expect(riser(m, { via: [{ ...up, height: 5 }] })).toEqual({ refused: '1번째 꺾임점의 높이(9.00m)가 보기 범위(1F ~ 2F) 밖입니다. 보기 범위를 넓힌 뒤 완료합니다.' })
    // 공조기(1,1)에서 (3,3) 2층 높이로 곧장 가면 2층 바닥을 비스듬히 지난다.
    expect(riser(m, { via: [{ ...up, at: [3, 3] }] })).toEqual({
      refused: '1번째 구간이 층 바닥을 비스듬히 지납니다. 층을 지나는 구간은 수직(x·y 같음)으로 찍고, 옆으로 옮기는 것은 수평 구간(오프셋)으로 찍습니다.',
    })
    expect(riser(m, { via: [up, up] })).toEqual({ refused: '2번째 구간의 길이가 0 입니다. 같은 자리를 두 번 찍지 마세요.' })
    // 층 편집 화면(범위 없음)에서는 다른 층과 잇지 않는다.
    expect(riser(m, { via: [up], range: undefined })).toEqual({ refused: '다른 층의 설비와 잇는 배관은 다중층 뷰에서 그립니다(OE-PIP-15).' })
    expect(JSON.stringify(m)).toBe(before)
  })

  it('층 바닥 높이를 모르거나 두 층의 바닥 높이가 같으면 층 이름으로 짐작하지 않고 이유를 보인다 [OE-ML-12#7] [OE-ML-18#3]', () => {
    const unknown = tower()
    unknown.storeys[1].elevation = Number.NaN
    expect(riser(unknown)).toEqual({ refused: '2F 의 바닥 높이를 모릅니다. 층 이름이나 순서로 높이를 짐작하지 않습니다 — BIM 에 층 높이를 넣은 뒤 그립니다.' })
    const twin = tower()
    twin.storeys[2].elevation = 4
    expect(riser(twin, { via: [[1, 1, 6.5]] })).toEqual({ refused: '2F 와 3F 의 바닥 높이(4.00m)가 같아 어느 층의 높이인지 가를 수 없습니다.' })
  })

  it('편집 파일로 다시 얹으면 같은 층에 같은 배관이고, 한 번 되돌리면 그리기 전과 같다 [OE-ML-12#5~] [OE-ML-14#4~]', () => {
    const m = tower()
    const base = baselineOf(m)
    const before = JSON.stringify(m)
    const done = riser(m)
    if ('refused' in done) throw new Error(done.refused)
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = tower()
    applyEdits(again, file)
    expect(modelToTTL(again)).toBe(modelToTTL(m))
    expect(JSON.stringify(modelToGeoJSON(again))).toBe(JSON.stringify(modelToGeoJSON(m)))
    for (const e of [...done.segments, ...done.fittings]) expect(homeOf(again, e.id)).toBe(done.storeyOf.get(e.id))
    // 화면이 쓰는 되돌리기: 새로 생긴 것마다 그 층에서 "없던 상태" 를 묶는다.
    const snap: Snapshot = {
      kind: 'many',
      parts: [...done.segments, ...done.fittings].map((equipment) => ({
        kind: 'equipment-set',
        equipment,
        storeyId: done.storeyOf.get(equipment.id)!,
        index: 0,
        present: false,
        connections: [],
        systems: [],
      })),
    }
    restore(m, snap)
    expect(JSON.stringify(m)).toBe(before)
  })
})
