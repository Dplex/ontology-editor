// 배관 꼭짓점 넣기·지우기(OE-PIP-10). mep.ifc 1F: AHU-1(1,1,3.2) → 꺾임 (1,4,3.2) → AT-101-01(3,4,2.7) 로 그린 SA 덕트를 쓴다.
// 그린 배관: AHU-1 — 덕트 1 — 이음(1,4,3.2) — 덕트 2 — AT-101-01.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { drawPipe } from './manual-pipe'
import { baselineOf, restore } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { insertPipeVertex, removePipeVertex } from './pipe-vertex'
import { segmentPath, type Equipment, type Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const drawn = () => {
  const m = read()
  const done = drawPipe(m, { from: equip(m, 'AHU-1').id, to: equip(m, 'AT-101-01').id, via: [[1, 4, 3.2]], flowType: 'SA' })
  if ('refused' in done) throw new Error(done.refused)
  return { m, first: done.segments[0], second: done.segments[1], knee: done.fittings[0] }
}
const pathOf = (e: Equipment) => {
  const p = segmentPath(e)
  return p && 'path' in p ? p.path.map((v) => v.map((x) => Math.round(x * 1000) / 1000)) : null
}
const linked = (m: Model, a: string, b: string) => m.connections.find((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a)) ?? null

describe('배관 꼭짓점 넣기·지우기 (OE-PIP-10)', () => {
  it('구간 가운데에 꼭짓점을 넣으면 두 구간과 엘보가 되고 경로·길이가 갱신되며, 연결 대상은 그대로이고 한 번에 되돌린다 [OE-PIP-10#2~]', () => {
    const { m, second } = drawn()
    const before = JSON.stringify(m)
    const at = equip(m, 'AT-101-01').id
    // 덕트 2 는 (1,4,3.2) → (3,4,2.7). 가운데(2,4,2.95)에서 0.1m 벗어나게 찍어도 선 위로 내린다.
    const done = insertPipeVertex(m, second.id, [2, 4.1, 2.95])
    if ('refused' in done) throw new Error(done.refused)
    expect(done.elbow.position).toEqual([2, 4, 2.95])
    expect([pathOf(second), pathOf(done.tail)]).toEqual([
      [[1, 4, 3.2], [2, 4, 2.95]],
      [[2, 4, 2.95], [3, 4, 2.7]],
    ])
    expect([done.elbow.flowType, done.tail.flowType, done.elbow.role, done.tail.role]).toEqual(['SA', 'SA', 'fitting', 'segment'])
    // 사슬: 덕트 2 — 엘보 — 새 구간 — AT-101-01. 덕트 2 와 AT-101-01 은 더 이상 바로 잇지 않는다.
    expect([!!linked(m, second.id, done.elbow.id), !!linked(m, done.elbow.id, done.tail.id), !!linked(m, done.tail.id, at), !!linked(m, second.id, at)]).toEqual([true, true, true, false])
    restore(m, done.undo)
    expect(JSON.stringify(m)).toBe(before)
  })

  it('넣은 꼭짓점은 편집 파일로 다시 연 모델에서도 같고, 지우면 다시 곧은 구간 하나다 [OE-PIP-10#7~]', () => {
    const { m, second } = drawn()
    const base = baselineOf(read())
    const done = insertPipeVertex(m, second.id, [2, 4, 2.95])
    if ('refused' in done) throw new Error(done.refused)
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = read()
    applyEdits(again, file)
    expect(modelToTTL(again)).toBe(modelToTTL(m))
    expect(JSON.stringify(modelToGeoJSON(again))).toBe(JSON.stringify(modelToGeoJSON(m)))

    // 넣은 엘보를 지우면 덕트 2 가 다시 (1,4,3.2) → (3,4,2.7) 이고 AT-101-01 과 잇는다.
    const back = removePipeVertex(m, done.elbow.id)
    if ('refused' in back) throw new Error(back.refused)
    expect(pathOf(back.kept)).toEqual([[1, 4, 3.2], [3, 4, 2.7]])
    expect(back.removed.map((e) => e.id)).toEqual([done.elbow.id, done.tail.id])
    expect(!!linked(m, second.id, equip(m, 'AT-101-01').id)).toBe(true)
  })

  it('꺾임 엘보를 지우면 두 구간이 하나로 합쳐져 곧게 이어지고, 한 번에 되돌린다 [OE-PIP-10#2~]', () => {
    const { m, first, second, knee } = drawn()
    const before = JSON.stringify(m)
    const done = removePipeVertex(m, knee.id)
    if ('refused' in done) throw new Error(done.refused)
    expect(done.kept.id).toBe(first.id)
    expect(pathOf(first)).toEqual([[1, 1, 3.2], [3, 4, 2.7]])
    expect(m.storeys.flatMap((s) => s.equipment).some((e) => e.id === second.id || e.id === knee.id)).toBe(false)
    expect(!!linked(m, first.id, equip(m, 'AT-101-01').id)).toBe(true)
    restore(m, done.undo)
    expect(JSON.stringify(m)).toBe(before)
  })

  it('확정 방향이 있던 사슬은 넣고 지워도 같은 쪽으로 이어받는다 — 중간점 편집만으로 방향이 바뀌지 않는다 [OE-PIP-10#2~]', () => {
    const { m, second } = drawn()
    const at = equip(m, 'AT-101-01').id
    // 덕트 2 → AT-101-01 쪽으로 사람이 방향을 정했다.
    linked(m, second.id, at)!.edited = { from: second.id, to: at }
    const done = insertPipeVertex(m, second.id, [2, 4, 2.95])
    if ('refused' in done) throw new Error(done.refused)
    const dir = (a: string, b: string) => linked(m, a, b)!.edited
    expect([dir(second.id, done.elbow.id), dir(done.elbow.id, done.tail.id), dir(done.tail.id, at)].map((d) => d && `${d.from}>${d.to}`)).toEqual([
      `${second.id}>${done.elbow.id}`,
      `${done.elbow.id}>${done.tail.id}`,
      `${done.tail.id}>${at}`,
    ])
    const back = removePipeVertex(m, done.elbow.id)
    if ('refused' in back) throw new Error(back.refused)
    expect(back.linked!.edited).toMatchObject({ from: second.id, to: at })
  })

  it('분기점·끝 이음쇠는 지우지 않고, 구간 밖·끝·Flow Type 을 모르는 구간에는 넣지 않으며 모델을 바꾸지 않는다', () => {
    const { m, second, knee } = drawn()
    const before = JSON.stringify(m)
    expect(insertPipeVertex(m, second.id, [2, 5, 2.95])).toEqual({ refused: expect.stringContaining('위에 있지 않습니다(1.00m 떨어짐)') })
    expect(insertPipeVertex(m, second.id, [1, 4, 3.2])).toEqual({ refused: expect.stringContaining('끝이라 이미 꼭짓점입니다') })
    expect(insertPipeVertex(m, knee.id, [1, 4, 3.2])).toEqual({ refused: '꼭짓점은 덕트·배관 구간에 넣습니다. 구간을 고르세요.' })
    // 엘보에 구간을 하나 더 이으면 분기점이다.
    m.connections.push({ from: knee.id, to: equip(m, 'AT-101-02').id, source: 'manual', directed: false, tolerance: null })
    expect(removePipeVertex(m, knee.id)).toEqual({ refused: expect.stringContaining('갈래가 3개인 분기점') })
    m.connections.pop()
    expect(removePipeVertex(m, second.id)).toEqual({ refused: expect.stringContaining('이음쇠를 고르세요') })
    expect(JSON.stringify(m)).toBe(before)
    // Flow Type 을 정하지 못한 BIM 구간: 그린 값을 지우고 계통도 없애면 막는다.
    delete second.flowType
    second.systemId = null
    expect(insertPipeVertex(m, second.id, [2, 4, 2.95])).toEqual({ refused: expect.stringContaining('Flow Type 을 정하지 못한 구간') })
  })
})
