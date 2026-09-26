import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import {
  addConnection,
  baselineOf,
  connectionBetween,
  removeConnection,
  restore,
  snapshotConnection,
  moveEquipment,
  moveEquipmentToStorey,
  moveSpaceVertex,
  releaseDeclaredSpace,
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
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0 })
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
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0 })
    expect(result.rematched.name + result.rematched.position).toBeGreaterThan(0)
    // id 만 다르고 내보내는 내용은 같다.
    const strip = (m: Model) => {
      const out = exports(m)
      return { ttl: out.ttl.split('Qv2').join(''), geo: out.geo.split('Qv2').join('') }
    }
    expect(strip(b)).toEqual(exports(a))
  })

  it('이은 연결과 그 방향이 저장·불러오기와 되돌리기를 거쳐도 같다', () => {
    const a = read('mep.ifc')
    const base = baselineOf(a)
    const ahu = equip(a, 'AHU-1').id
    const light = equip(a, 'LIGHT-101-01').id
    // 포트(BIM)가 말한 연결은 끊지 않는다.
    const port = a.connections.find((c) => c.source === 'port')!
    expect(removeConnection(a, port)).toBeNull()
    // 잇는다. 방향 없이 시작하고, 이미 이어진 짝은 다시 잇지 않는다.
    const done = addConnection(a, ahu, light)!
    expect(done.connection).toMatchObject({ source: 'manual', directed: false })
    expect(addConnection(a, light, ahu)).toBeNull()
    setFlowDirection(done.connection, ahu)

    // 되돌리기: 이은 직후의 스냅숏(없음)으로 돌리면 연결이 빠지고, 그때의 스냅숏으로 다시 넣으면 방향까지 돌아온다.
    const after = snapshotConnection(a, done.connection)
    restore(a, { kind: 'connection', connection: done.connection, present: false, index: a.connections.length })
    expect(connectionBetween(a, ahu, light)).toBeNull()
    restore(a, after)
    expect(connectionBetween(a, ahu, light)?.edited).toEqual({ from: ahu, to: light })

    const parsed = parseEditFile(JSON.stringify(exportEdits(a, base, 'mep.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.connections).toEqual({ add: [{ from: ahu, to: light }], remove: [] })
    const b = read('mep.ifc')
    const result = applyEdits(b, parsed)
    expect(result.missing.connections).toBe(0)
    expect(connectionBetween(b, ahu, light)?.edited).toEqual({ from: ahu, to: light })
    expect(exports(b)).toEqual(exports(a))
  })

  // 확정한 계통은 규칙을 다시 돌려도 얼려 둔다. 예전 편집 파일은 계통 id 만 적어서, 불러올 때 종류를 먼저 바꾸고
  // 확정을 나중에 하면 새 종류로 방향이 다시 정해졌다 — 덕트→토출구로 확정한 것이 토출구→덕트로 나갔다.
  it('계통을 확정한 뒤 종류를 바꿔도, 불러오면 확정한 방향 그대로다', () => {
    const a = read('mep.ifc')
    const base = baselineOf(a)
    const c = a.connections.find((x) => x.inferred)!
    const confirmed = { from: c.inferred!.from, to: c.inferred!.to }
    confirmSystemFlow(a, c.inferred!.systemId)
    // 토출구를 공기의 원천으로 바꾸면 새로 돌린 규칙은 반대로 정한다. 확정한 것은 그대로다.
    setTypeKind(a, typeKeyOf(equip(a, 'AT-101-02')), 'ahu')
    expect({ from: c.inferred!.from, to: c.inferred!.to }).toEqual(confirmed)

    const parsed = parseEditFile(JSON.stringify(exportEdits(a, base, 'mep.ifc')))
    if (typeof parsed === 'string') throw new Error(parsed)
    const b = read('mep.ifc')
    applyEdits(b, parsed)
    const again = b.connections.find((x) => x.inferred?.confirmed)!
    expect({ from: again.inferred!.from, to: again.inferred!.to }).toEqual(confirmed)
    expect(exports(b)).toEqual(exports(a))
  })

  it('확정한 방향이 없던 때의 편집 파일도 계통 id 로 확정해 불러온다', () => {
    const a = read('mep.ifc')
    const base = baselineOf(a)
    const systemId = a.connections.find((x) => x.inferred)!.inferred!.systemId
    confirmSystemFlow(a, systemId)
    const file = exportEdits(a, base, 'mep.ifc')
    delete file.confirmedFlows
    const b = read('mep.ifc')
    const result = applyEdits(b, file)
    expect(result.confirmations).toEqual([{ systemId, count: 1 }])
    expect(exports(b)).toEqual(exports(a))
  })

  // BIM 소속은 옮기는 순간 버리고 좌표로 다시 잰다. 제자리로 돌려놓으면 좌표는 연 때와 같아서 편집 파일에서 빠졌고,
  // 다시 열면 BIM 소속으로 돌아갔다(화면은 소속 없음, 불러온 뒤는 사무실).
  it('BIM 이 소속을 말한 설비를 옮겼다 제자리로 돌려놓아도, 불러오면 화면과 같다', () => {
    const a = read('mep.ifc')
    const base = baselineOf(a)
    const light = equip(a, 'LIGHT-101-01')
    expect(light.spaceSource).toBe('bim')
    const p = light.position!
    moveEquipment(a, light.id, [p[0] + 0.1, p[1], p[2]])
    moveEquipment(a, light.id, [p[0], p[1], p[2]])
    expect(light.spaceSource).not.toBe('bim')

    const file = exportEdits(a, base, 'mep.ifc')
    expect(file.equipment).toEqual([{ id: light.id, position: [p[0], p[1], p[2]], released: true }])
    const b = read('mep.ifc')
    applyEdits(b, file)
    expect(equip(b, 'LIGHT-101-01').spaceId).toBe(light.spaceId)
    expect(exports(b)).toEqual(exports(a))
  })

  it('좌표 없는 설비가 다른 층에 갔다 와서 BIM 소속을 잃은 것도 편집 파일에 남는다', () => {
    const a = read('mep.ifc')
    addUpperStorey(a)
    const base = baselineOf(a)
    const light = equip(a, 'LIGHT-101-01')
    light.position = null
    base.equipment.get(light.id)!.position = null
    moveEquipmentToStorey(a, light.id, 'up')
    moveEquipmentToStorey(a, light.id, a.storeys[0].id)
    expect(light.spaceId).toBe(null)

    const b = read('mep.ifc')
    addUpperStorey(b)
    equip(b, 'LIGHT-101-01').position = null
    applyEdits(b, exportEdits(a, base, 'mep.ifc'))
    expect(equip(b, 'LIGHT-101-01').spaceId).toBe(null)
    expect(releaseDeclaredSpace(b, light.id)).toBe(false)
  })

  it('편집 파일이 아닌 것은 이유를 말하고 받지 않는다', () => {
    expect(parseEditFile('not json')).toBe('JSON 이 아닙니다.')
    expect(parseEditFile('{"format":"x"}')).toBe('ontology-editor 편집 파일이 아닙니다.')
    expect(parseEditFile('{"format":"ontology-editor/edits","version":9}')).toContain('version 9')
  })
})
