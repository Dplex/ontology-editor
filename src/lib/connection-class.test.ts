// 연결의 근거 넷(OE-BIM-09): BIM 포트 · 방향 명시 / BIM 포트 · 양방향·미지정 / 형상 추정(미확정 후보) / 사람이 이음.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { connectionClass, countConnectionClasses } from './connection-class'
import { addConnection, baselineOf, connectionBetween, removeConnection } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToTTL } from './export/ttl'
import type { Connection, Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = () => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!

/** 임포터의 형상 추정이 맞닿은 두 설비를 이은 것과 같은 연결(포트가 없는 구간, 5mm). */
const touching = (m: Model): Connection => {
  const c: Connection = { from: equip(m, 'AHU-1').id, to: equip(m, 'LIGHT-101-01').id, source: 'geometry', directed: false, tolerance: 0.005 }
  m.connections.push(c)
  return c
}

describe('연결의 근거 (OE-BIM-09)', () => {
  it('포트에서 읽은 연결은 방향을 말했는지로, 형상 추정·사람이 이은 연결과 따로 센다 [OE-BIM-09#2]', () => {
    const m = read()
    const ports = m.connections.filter((c) => c.source === 'port')
    expect(ports.length).toBeGreaterThan(0)
    // mep.ifc 의 포트 연결은 SOURCE→SINK 와 SOURCEANDSINK 가 섞여 있다(둘째 토출구).
    const n = countConnectionClasses(m.connections)
    expect(n['port-directed']).toBe(ports.filter((c) => c.directed).length)
    expect(n['port-undirected']).toBe(ports.filter((c) => !c.directed).length)
    expect(n['port-directed'] * n['port-undirected']).toBeGreaterThan(0)
    touching(m)
    addConnection(m, equip(m, 'AT-101-02').id, equip(m, 'LIGHT-101-01').id)
    expect(countConnectionClasses(m.connections)).toMatchObject({ geometry: 1, manual: 1 })
    expect(connectionClass({ source: 'geometry', directed: false })).toBe('geometry')
  })

  it('형상 추정 연결은 미확정 후보라 TTL feeds 로 나가지 않고, 사람이 끊으면 다시 연 BIM 에서 형상이 또 맞닿아도 끊긴 채다 [OE-BIM-09#2]', () => {
    const a = read()
    const without = modelToTTL(a)
    const geo = touching(a)
    // 방향이 없는 후보라 TTL 이 한 줄도 바뀌지 않는다.
    expect(modelToTTL(a)).toBe(without)
    const base = baselineOf(a)
    const ahu = geo.from
    const light = geo.to
    expect(removeConnection(a, geo)).not.toBeNull()
    const parsed = parseEditFile(JSON.stringify(exportEdits(a, base, 'mep.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.connections?.remove).toEqual([{ from: ahu, to: light }])

    // 같은 BIM 을 다시 열면 임포터가 같은 형상 추정을 또 만든다. 편집 파일을 얹으면 사람이 끊은 것이 이긴다.
    const b = read()
    touching(b)
    applyEdits(b, parsed)
    expect(connectionBetween(b, ahu, light)).toBeNull()
    // 되살리는 길은 사람이 다시 잇는 것이다. 그때는 사람이 이은 연결(manual)이다.
    expect(addConnection(b, ahu, light)?.connection).toMatchObject({ source: 'manual', directed: false })
  })
})
