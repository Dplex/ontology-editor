// 로봇 통과 속성(OE-EQP-17 · OE-ROB-03). GeoJSON 의 `passable` 로 문과 벽·창을 가른다. two-rooms.ifc 에 문 1 · 창 2 · 벽 4 가 있다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes } from '../ifc/import'
import { modelToGeoJSON } from './geojson'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

describe('로봇 통과 속성', () => {
  it('문은 passable=true, 창·벽은 passable=false 로 나가 받은 데이터만으로 문과 벽을 가른다 [OE-EQP-17#1~] [OE-ROB-03#1] [OE-OBJ-05#2]', () => {
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../ifc/fixtures/two-rooms.ifc', import.meta.url))))
    const { model } = importIfcWithMeshes(api, bytes, undefined, { openings: true })
    const features = modelToGeoJSON(model).flatMap((f) => f.collection.features)
    const by = (kind: string) => features.filter((f) => f.properties?.kind === kind).map((f) => f.properties!.passable)
    expect(by('door')).toEqual([true])
    expect(by('window')).toEqual([false, false])
    expect(by('wall')).toEqual([false, false, false, false])
    // 방에는 통과 속성을 달지 않는다 — 방은 지나가는 곳이 아니라 머무는 곳이다.
    expect(features.filter((f) => f.properties?.kind === 'space').every((f) => !('passable' in f.properties!))).toBe(true)
  })
})
