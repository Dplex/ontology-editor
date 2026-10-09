// 오프셋 높이 바꾸기(OE-ML-14 의 편집). mep.ifc(1F: AHU-1(1,1,3.2))에 2층(4m)·3층(8m)과 2층 AT-201(5,5,6.7)을 얹고 SA 라이저를 그린다:
// AHU-1 → SA 덕트 1(수직 3.2 → 6.5) → SA 이음 2 → SA 덕트 3(수평 오프셋 (1,1)→(5,1), 6.5m) → SA 이음 4 → SA 덕트 5(→ AT-201).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { drawPipe } from './manual-pipe'
import { restAxis } from './branch-pipe'
import { planOffsetHeight, setOffsetHeight } from './offset-edit'
import { baselineOf, restore, snapshotEquipment, type Snapshot } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { segmentPath, type Model, type Storey } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const tower = (): Model => {
  const m = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
  const floor = (id: string, elevation: number): Storey => ({ id, name: id, elevation, spaces: [], walls: [], openings: [], equipment: [] })
  const f2 = floor('2F', 4)
  f2.equipment.push({ ...structuredClone(equip(m, 'AT-101-01')), id: 'AT-201', name: 'AT-201', position: [5, 5, 6.7], systemId: null })
  m.storeys.push(f2, floor('3F', 8))
  return m
}
const withRiser = (m = tower()) => {
  const done = drawPipe(m, { from: equip(m, 'AHU-1').id, to: 'AT-201', via: [[1, 1, 6.5], [5, 1, 6.5]], flowType: 'SA', range: [m.storeys[0].id, '2F'] })
  if ('refused' in done) throw new Error(done.refused)
  return m
}
const at2F = (height: number) => ({ storeyId: '2F', height })

describe('오프셋 높이 바꾸기 (OE-ML-14)', () => {
  it('오프셋을 2층 바닥 + 3m 로 올리면 양 끝 꺾임점이 같이 오르고 라이저·마지막 구간이 늘어난다. 연결은 그대로다 [OE-ML-14#2~] [OE-ML-14#5~]', () => {
    const m = withRiser()
    const links = JSON.stringify(m.connections)
    const offset = equip(m, 'SA 덕트 3')
    // 바꾸기 전에 무엇이 움직이는지 보인다: 꺾임점 둘, 늘이는 구간 둘(라이저 · 마지막 구간).
    const plan = planOffsetHeight(m, offset.id, at2F(3))
    if ('refused' in plan) throw new Error(plan.refused)
    expect([plan.fittings.map((f) => f.name), plan.stretch.map((s) => equip(m, 'SA 덕트 1').id === s.id ? 'SA 덕트 1' : 'SA 덕트 5'), plan.branches, plan.delta]).toEqual([
      ['SA 이음 2', 'SA 이음 4'],
      ['SA 덕트 1', 'SA 덕트 5'],
      [],
      [0, 0, 0.5],
    ])
    const done = setOffsetHeight(m, offset.id, at2F(3), restAxis(m))
    if ('refused' in done) throw new Error(done.refused)
    expect(['SA 덕트 1', 'SA 덕트 3', 'SA 덕트 5'].map((n) => segmentPath(equip(m, n)))).toEqual([
      { path: [[1, 1, 3.2], [1, 1, 7]] },
      { path: [[1, 1, 7], [5, 1, 7]] },
      { path: [[5, 1, 7], [5, 5, 6.7]] },
    ])
    expect([equip(m, 'SA 이음 2').position, equip(m, 'SA 이음 4').position]).toEqual([[1, 1, 7], [5, 1, 7]])
    expect(JSON.stringify(m.connections)).toBe(links)
  })

  it('되돌리기 한 번이면 바꾸기 전과 같고, 편집 파일로 새로 연 모델에 얹으면 같은 높이다 [OE-ML-14#4]', () => {
    const m = withRiser()
    const base = baselineOf(tower())
    const before = JSON.stringify(m)
    const offset = equip(m, 'SA 덕트 3')
    const plan = planOffsetHeight(m, offset.id, at2F(3))
    if ('refused' in plan) throw new Error(plan.refused)
    const undo: Snapshot = { kind: 'many', parts: [offset.id, ...plan.fittings.map((f) => f.id), ...plan.stretch.map((s) => s.id)].map((id) => snapshotEquipment(m, id)!) }
    expect('refused' in setOffsetHeight(m, offset.id, at2F(3), restAxis(m))).toBe(false)
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = tower()
    applyEdits(again, file)
    expect(modelToTTL(again)).toBe(modelToTTL(m))
    expect(JSON.stringify(modelToGeoJSON(again))).toBe(JSON.stringify(modelToGeoJSON(m)))
    restore(m, undo)
    expect(JSON.stringify(m)).toBe(before)
  })

  it('수직 구간 · 설비에 바로 붙은 구간 · 늘일 구간이 뒤집히거나 층 바닥을 비스듬히 지나게 되는 높이는 막고 모델을 바꾸지 않는다 [OE-ML-14#3~]', () => {
    const m = withRiser()
    const before = JSON.stringify(m)
    const offset = equip(m, 'SA 덕트 3').id
    expect(planOffsetHeight(m, equip(m, 'SA 덕트 1').id, at2F(3))).toEqual({ refused: '수평 구간(오프셋)만 높이를 바꿉니다. 기운 구간은 꺾임점을 옮겨 고칩니다.' })
    // 1층 3.0m 는 라이저 아래 끝(3.2m)보다 낮아 라이저가 뒤집힌다.
    expect(planOffsetHeight(m, offset, { storeyId: m.storeys[0].id, height: 3 })).toEqual({
      refused: 'SA 덕트 1이(가) 길이 0 이 되거나 뒤집힙니다. 높이를 SA 덕트 1의 다른 끝(3.20m) 너머로 옮기지 않습니다.',
    })
    // 2층 + 4.5m = 8.5m 면 마지막 구간이 3층 바닥(8m)을 비스듬히 지난다.
    expect(setOffsetHeight(m, offset, at2F(4.5), restAxis(m))).toEqual({ refused: 'SA 덕트 5이(가) 층 바닥을 비스듬히 지나게 됩니다. 수직이 아닌 구간은 층 안에 둡니다.' })
    expect(planOffsetHeight(m, offset, at2F(2.5))).toEqual({ refused: '높이가 그대로입니다.' })
    // 같은 층의 배관: 공조기에 바로 붙은 수평 구간은 옮기면 공조기와 떨어진다.
    const flat = drawPipe(m, { from: equip(m, 'AHU-1').id, to: equip(m, 'AT-101-01').id, via: [[1, 4, 3.2]], flowType: 'SA' })
    if ('refused' in flat) throw new Error(flat.refused)
    const after = JSON.stringify(m)
    expect(planOffsetHeight(m, flat.segments[0].id, { storeyId: m.storeys[0].id, height: 3.5 })).toEqual({
      refused: `${flat.segments[0].name}의 끝이 AHU-1에 바로 붙어 있어 높이를 바꾸면 설비와 떨어집니다. 설비를 옮기거나 꺾임점을 넣어 고칩니다.`,
    })
    expect(JSON.stringify(m)).toBe(after)
    expect(after).not.toBe(before)
  })
})
