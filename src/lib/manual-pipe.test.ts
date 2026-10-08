// 사람이 그리는 배관(OE-PIP-11). mep.ifc 1F: AHU-1(1,1,3.2) · AT-101-01(3,4,2.7) · TEMP-101-01(좌표 없음), 둘 다 AHU-1 급기 계통.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { drawPipe } from './manual-pipe'
import { baselineOf, restore, type Snapshot } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { completenessChecks } from './checks'
import { segmentPath, type Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const feedsOf = (ttl: string, id: string) => {
  const at = ttl.indexOf(`ex:${id} a `)
  const block = at < 0 ? '' : ttl.slice(at, ttl.indexOf('\n\n', at))
  return block.split('\n').filter((l) => l.includes('feeds')).join('\n')
}

describe('수동 배관 그리기 (OE-PIP-11)', () => {
  it('꼭짓점마다 이음쇠, 변마다 구간이 생기고 manual 연결로 이어지며, 양 끝이 같은 계통이면 그 계통에 든다', () => {
    const m = read()
    const ahu = equip(m, 'AHU-1')
    const at = equip(m, 'AT-101-01')
    const done = drawPipe(m, { from: ahu.id, to: at.id, via: [[1, 4, 3.2]], flowType: 'SA' })
    if ('refused' in done) throw new Error(done.refused)
    expect(done.segments.map((e) => [e.name, e.ifcClass, e.role, e.flowType])).toEqual([
      ['SA 덕트 1', 'DuctSegment', 'segment', 'SA'],
      ['SA 덕트 3', 'DuctSegment', 'segment', 'SA'],
    ])
    expect(done.fittings.map((e) => [e.name, e.ifcClass, e.role, e.position])).toEqual([['SA 이음 2', 'DuctFitting', 'fitting', [1, 4, 3.2]]])
    const [s1, s2] = done.segments
    expect(done.connections.map((c) => [c.from, c.to, c.source, c.directed])).toEqual([
      [ahu.id, s1.id, 'manual', false],
      [s1.id, done.fittings[0].id, 'manual', false],
      [done.fittings[0].id, s2.id, 'manual', false],
      [s2.id, at.id, 'manual', false],
    ])
    expect(done.length).toBeCloseTo(3 + Math.hypot(2, 0, 0.5), 9)
    // 경로는 찍은 꼭짓점 그대로다(GeoJSON LineString).
    expect(segmentPath(s1)).toEqual({ path: [[1, 1, 3.2], [1, 4, 3.2]] })
    expect(segmentPath(s2)).toEqual({ path: [[1, 4, 3.2], [3, 4, 2.7]] })
    const f = modelToGeoJSON(m).flatMap((x) => x.collection.features).find((x) => x.id === s1.id)!
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[1, 1, 3.2], [1, 4, 3.2]] })
    expect(f.properties.flowType).toBe('SA')
    expect([s1.systemId, s2.systemId, done.fittings[0].systemId]).toEqual([ahu.systemId, ahu.systemId, ahu.systemId])
    // 경로 검사에 걸리는 것은 픽스처의 형상 없는 DUCT-01 하나뿐이다.
    expect(completenessChecks(m, []).find((c) => c.key === 'conduit-path')!.failed).toEqual([equip(m, 'DUCT-01').id])
  })

  it('방향은 정하지 않아, 그린 배관만으로는 TTL 의 feeds 가 늘지 않는다', () => {
    const m = read()
    const ahu = equip(m, 'AHU-1')
    const before = feedsOf(modelToTTL(m), ahu.id)
    const done = drawPipe(m, { from: ahu.id, to: equip(m, 'AT-101-01').id, flowType: 'SA' })
    if ('refused' in done) throw new Error(done.refused)
    expect(feedsOf(modelToTTL(m), ahu.id)).toBe(before)
  })

  it('범례에 없는 Flow Type · 같은 대상 · 좌표 없는 설비 · 길이 0 · 없는 계통은 막고 아무것도 남기지 않는다', () => {
    const m = read()
    const before = JSON.stringify(m)
    const [ahu, at, temp] = ['AHU-1', 'AT-101-01', 'TEMP-101-01'].map((n) => equip(m, n))
    expect(drawPipe(m, { from: ahu.id, to: at.id, flowType: 'XX' })).toEqual({ refused: '범례에 없는 Flow Type(XX)으로는 배관을 그리지 않습니다.' })
    expect(drawPipe(m, { from: ahu.id, to: ahu.id, flowType: 'SA' })).toEqual({ refused: '시작과 끝이 같습니다. 다른 설비나 배관을 끝으로 고르세요.' })
    expect(drawPipe(m, { from: ahu.id, to: temp.id, flowType: 'SA' })).toEqual({ refused: '좌표가 없는 설비와는 배관을 잇지 않습니다. 먼저 위치를 넣으세요.' })
    expect(drawPipe(m, { from: ahu.id, to: at.id, via: [[1, 1, 3.2]], flowType: 'SA' })).toEqual({ refused: '1번째 구간의 길이가 0 입니다. 같은 자리를 두 번 찍지 마세요.' })
    expect(drawPipe(m, { from: ahu.id, to: at.id, flowType: 'SA', systemId: 'nope' })).toEqual({ refused: '고른 계통이 없습니다.' })
    expect(JSON.stringify(m)).toBe(before)
  })

  it('계통 없음(null)을 고르면 계통에 넣지 않고, 양 끝 계통은 그대로다', () => {
    const m = read()
    const ahu = equip(m, 'AHU-1')
    const members = JSON.stringify(m.systems)
    const done = drawPipe(m, { from: ahu.id, to: equip(m, 'AT-101-01').id, flowType: 'CHWS', systemId: null })
    if ('refused' in done) throw new Error(done.refused)
    expect(done.segments[0]).toMatchObject({ systemId: null, ifcClass: 'PipeSegment', name: 'CHWS 배관 1' })
    expect(JSON.stringify(m.systems)).toBe(members)
  })

  it('편집 파일을 거쳐도 같은 배관이고, 한 번 되돌리면 그리기 전과 같다', () => {
    const m = read()
    const base = baselineOf(m)
    const before = JSON.stringify(m)
    const done = drawPipe(m, { from: equip(m, 'AHU-1').id, to: equip(m, 'AT-101-01').id, via: [[1, 4, 3.2]], flowType: 'SA' })
    if ('refused' in done) throw new Error(done.refused)
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = read()
    applyEdits(again, file)
    const [x, y] = [modelToTTL(again).split('\n'), modelToTTL(m).split('\n')]
    expect(x.filter((l) => !y.includes(l))).toEqual([])
    expect(y.filter((l) => !x.includes(l))).toEqual([])
    expect(modelToTTL(again)).toBe(modelToTTL(m))
    expect(JSON.stringify(modelToGeoJSON(again))).toBe(JSON.stringify(modelToGeoJSON(m)))
    // 화면이 쓰는 되돌리기: 새로 생긴 것마다 "없던 상태" 를 묶는다.
    const storeyId = m.storeys[0].id
    const snap: Snapshot = {
      kind: 'many',
      parts: [...done.segments, ...done.fittings].map((equipment) => ({ kind: 'equipment-set', equipment, storeyId, index: 0, present: false, connections: [], systems: [] })),
    }
    restore(m, snap)
    expect(JSON.stringify(m)).toBe(before)
  })
})
