import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import {
  baselineOf,
  moveEquipment,
  moveEquipmentToStorey,
  moveSpaceVertex,
  renameSpace,
  setFlowDirection,
  setTypeKind,
  typeKeyOf,
} from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { confirmSystemFlow, inferFlowByRules } from './flow-rules'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import type { Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

const read = (name: string): Model => {
  const path = fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url))
  const model = importIfc(api, new Uint8Array(readFileSync(path)))
  inferFlowByRules(model)
  return model
}
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const addUpperStorey = (m: Model) => m.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
const exports = (m: Model) => ({ ttl: modelToTTL(m), geo: JSON.stringify(modelToGeoJSON(m)) })

describe('편집 저장·불러오기', () => {
  it('편집한 모델에서 저장한 것을 새로 연 모델에 얹으면 내보내는 파일이 똑같다', () => {
    const a = read('mep.ifc')
    addUpperStorey(a)
    const base = baselineOf(a)
    const office = a.storeys[0].spaces[0]

    setTypeKind(a, typeKeyOf(equip(a, 'TEMP-101-01')), 'heat_detector')
    renameSpace(a, office.id, '대회의실')
    moveSpaceVertex(a, office.id, 1, [9, 1])
    moveEquipment(a, equip(a, 'AHU-1').id, [2, 3, 3.2])
    moveEquipmentToStorey(a, equip(a, 'AT-101-01').id, 'up')
    const ruled = a.connections.find((c) => c.inferred)!
    confirmSystemFlow(a, ruled.inferred!.systemId)
    const free = a.connections.find((c) => !c.directed)!
    setFlowDirection(free, free.to)

    const file = exportEdits(a, base, 'mep.ifc', new Date('2026-09-24T00:00:00Z'))
    // 바뀐 것만 담는다. 손대지 않은 설비·물리존은 없다.
    expect(file.equipment.map((e) => e.id).sort()).toEqual([equip(a, 'AHU-1').id, equip(a, 'AT-101-01').id].sort())
    expect(file.spaces).toHaveLength(1)
    expect(file.spaces[0].longName).toBe('대회의실')

    // 파일로 나갔다 들어온 것처럼 문자열을 거친다.
    const parsed = parseEditFile(JSON.stringify(file))
    if (typeof parsed === 'string') throw new Error(parsed)

    const b = read('mep.ifc')
    addUpperStorey(b)
    const result = applyEdits(b, parsed)
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0 })
    expect(result.storeyMoved).toEqual([equip(b, 'AT-101-01').id])
    expect(exports(b)).toEqual(exports(a))
    // 사람이 고친 출처도 같다(좌표 출처가 편집, 종류는 사람이 정한 것).
    expect(equip(b, 'AHU-1').positionSource).toBe('edited')
    expect(equip(b, 'TEMP-101-01').kindEdited).toEqual({ from: null })
  })

  it('다른 모델에 얹으면 못 찾은 것을 센다', () => {
    const a = read('mep.ifc')
    const base = baselineOf(a)
    moveEquipment(a, equip(a, 'AHU-1').id, [2, 3, 3.2])
    renameSpace(a, a.storeys[0].spaces[0].id, '대회의실')
    const free = a.connections.find((c) => !c.directed)!
    setFlowDirection(free, free.to)
    const file = exportEdits(a, base, 'mep.ifc')

    const other = read('two-rooms.ifc')
    const result = applyEdits(other, file)
    expect(result.applied).toBe(0)
    expect(result.missing).toMatchObject({ equipment: 1, spaces: 1, flows: 1 })
  })

  it('GUID 가 전부 바뀐 재내보내기에도 이름·위치로 찾아 얹는다', () => {
    const a = read('mep.ifc')
    addUpperStorey(a)
    const base = baselineOf(a)
    const office = a.storeys[0].spaces[0]
    renameSpace(a, office.id, '대회의실')
    moveSpaceVertex(a, office.id, 1, [9, 1])
    moveEquipment(a, equip(a, 'AHU-1').id, [2, 3, 3.2])
    moveEquipmentToStorey(a, equip(a, 'AT-101-01').id, 'up')
    confirmSystemFlow(a, a.connections.find((c) => c.inferred)!.inferred!.systemId)
    const free = a.connections.find((c) => !c.directed)!
    setFlowDirection(free, free.to)
    const parsed = parseEditFile(JSON.stringify(exportEdits(a, base, 'mep.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)

    // 같은 BIM 을 다시 내보냈는데 GUID 가 전부 새로 나온 판본(Duplex MEP-2 에서 방 GUID 가 전부 이랬다).
    const ids = (m: Model) => [
      ...m.storeys.flatMap((s) => [s.id, ...s.spaces.map((sp) => sp.id), ...s.equipment.map((e) => e.id)]),
      ...m.systems.map((s) => s.id),
    ]
    // 꼬리는 TTL 지역 이름에서 이스케이프되지 않는 글자만 쓴다(`-` 는 `\-` 가 되어 되돌릴 때 어긋난다).
    const reexport = (m: Model): Model => {
      let json = JSON.stringify(m)
      for (const id of ids(m)) json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
      return JSON.parse(json)
    }
    const b = reexport(read('mep.ifc'))
    addUpperStorey(b)
    const result = applyEdits(b, parsed)
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0 })
    expect(result.rematched.name + result.rematched.position).toBeGreaterThan(0)
    // id 만 다르고 내보내는 내용은 같다.
    const strip = (m: Model) => {
      const out = exports(m)
      return { ttl: out.ttl.split('Qv2').join(''), geo: out.geo.split('Qv2').join('') }
    }
    expect(strip(b)).toEqual(exports(a))
  })

  it('편집 파일이 아닌 것은 이유를 말하고 받지 않는다', () => {
    expect(parseEditFile('not json')).toBe('JSON 이 아닙니다.')
    expect(parseEditFile('{"format":"x"}')).toBe('ontology-editor 편집 파일이 아닙니다.')
    expect(parseEditFile('{"format":"ontology-editor/edits","version":9}')).toContain('version 9')
  })
})
