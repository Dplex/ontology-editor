// 덕트·배관 경로(OE-PIP-13). 유효한 두 끝이 있는 구간만 GeoJSON 에 LineString 으로 나가고, 나머지는 geometry 를 비우고 까닭을 적는다.
// mep.ifc 의 DUCT-01 은 형상이 없다. 연결(AHU-1 → DUCT-01 → 디퓨저)은 있다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { completenessChecks, explainFailure } from './checks'
import { modelToGeoJSON } from './export/geojson'
import { readGeoJSON } from './export/read-export'
import { modelToTTL } from './export/ttl'
import { moveEquipment } from './edit'
import { segmentPath, type Equipment, type Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
const duct = (m: Model) => m.storeys[0].equipment.find((e) => e.name === 'DUCT-01')!
const feature = (m: Model, id: string) => modelToGeoJSON(m).flatMap((f) => f.collection.features).find((f) => f.id === id)!

describe('덕트·배관 경로 (OE-PIP-13)', () => {
  it('형상이 없는 구간은 배치점이 있어도 경로를 만들지 않고, geometry 를 비우고 까닭을 적는다. 연결은 TTL 에 그대로다', () => {
    const m = read()
    const d = duct(m)
    expect(d.position).not.toBeNull()
    expect(segmentPath(d)).toEqual({ issue: 'no-geometry' })
    const f = feature(m, d.id)
    expect(f.geometry).toBeNull()
    expect(f.properties.pathIssue).toBe('형상 없음(경로를 모름)')
    // 형상이 있든 없든 의미(연결·계통·방향)는 같다.
    const ttl = modelToTTL(m)
    d.axis = [[0, 0, 0], [6, 0, 0]]
    expect(modelToTTL(m)).toBe(ttl)
  })

  it('두 끝이 있으면 LineString 이고, 통째로 옮긴 양과 끝을 옮긴 양(endShift)이 더해진다. 원본의 (0,0,0) 은 유효한 좌표다', () => {
    const m = read()
    const d = duct(m)
    // 축은 배치점에서 잰 상대 좌표다. 경로가 (0,0,0)~(6,0,0) 이 되게 둔다.
    const at = d.position!
    d.axis = [[-at[0], -at[1], -at[2]], [6 - at[0], -at[1], -at[2]]]
    expect(feature(m, d.id).geometry).toEqual({ type: 'LineString', coordinates: [[0, 0, 0], [6, 0, 0]] })
    // 통째로 옮기면(배치점만 바뀐다) 경로가 같이 간다.
    moveEquipment(m, d.id, [at[0] + 0.5, at[1], at[2]])
    expect(feature(m, d.id).geometry).toEqual({ type: 'LineString', coordinates: [[0.5, 0, 0], [6.5, 0, 0]] })
    moveEquipment(m, d.id, at)
    // 끝을 늘이면(applyFollow) 배치점이 축 위 같은 비율 자리로 가고, 늘인 끝만 옮겨진다.
    const t = at[0] / 6
    d.endShift = [[0, 0, 0], [0, 2, 0]]
    d.position = [at[0], at[1] + 2 * t, at[2]]
    const line = feature(m, d.id).geometry as { coordinates: number[][] }
    expect(line.coordinates[0].map((v) => +v.toFixed(9))).toEqual([0, 0, 0])
    expect(line.coordinates[1].map((v) => +v.toFixed(9))).toEqual([6, 2, 0])
    expect(feature(m, d.id).properties.pathIssue).toBeUndefined()
    const out = modelToGeoJSON(m)[0]
    expect(readGeoJSON(out.fileName, JSON.stringify(out.collection)).problems).toEqual([])
  })

  it('좌표 없음 · 수치 오류 · 길이 0 은 경로가 아니다', () => {
    const seg = (x: Partial<Equipment>): Equipment => ({ id: 's', name: 's', ifcClass: 'DuctSegment', role: 'segment', position: [0, 0, 0], capacity: null, systemId: null, spaceId: null, spaceSource: null, ...x }) as Equipment
    expect(segmentPath(seg({ position: null, axis: [[0, 0, 0], [1, 0, 0]] }))).toEqual({ issue: 'no-position' })
    expect(segmentPath(seg({ axis: [[0, 0, 0], [Number.NaN, 0, 0]] }))).toEqual({ issue: 'invalid' })
    expect(segmentPath(seg({ axis: [[2, 2, 2], [2, 2, 2.0005]] }))).toEqual({ issue: 'zero-length' })
    expect(segmentPath(seg({ axis: [[2, 2, 2], [2, 2, 2.0005]], endShift: [[0, 0, 0], [0, 0, 1]] }))).toEqual({ path: [[2, 2, 2], [2, 2, 3.0005]] })
    expect(segmentPath({ ...seg({}), role: 'fitting' })).toBeNull()
  })

  it('경로를 쓸 수 없는 구간이 완전성 검사의 미반영 목록에 까닭과 원본 GlobalId 로 보인다', () => {
    const m = read()
    const check = completenessChecks(m, []).find((c) => c.key === 'conduit-path')!
    expect(check.total).toBe(1)
    expect(check.failed).toEqual([duct(m).id])
    expect(explainFailure('conduit-path', duct(m).id, { model: m, connections: m.connections, services: [], label: (id) => id })).toBe(
      `형상 없음(경로를 모름) · BIM GlobalId ${duct(m).id} · ${duct(m).ifcClass}`,
    )
    duct(m).axis = [[0, 0, 0], [6, 0, 0]]
    expect(completenessChecks(m, []).find((c) => c.key === 'conduit-path')!.failed).toEqual([])
  })
})
