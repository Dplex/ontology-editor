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
  addOpening,
  addWall,
  deleteOpening,
  deleteWall,
  setWallLoadBearing,
  setWallExternal,
  setOpeningSize,
  setEquipmentSystem,
  setSystemKind,
  renameSystem,
  snapshotSystems,
  typeKeyOf,
} from './edit'
import { applyEdits, exportEdits, parseEditFile, type EditFile } from './edit-file'
import { exportedContent } from './edit-fuzz'
import { confirmSystemFlow, inferFlowByRules } from './flow-rules'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import type { Model, Opening, Wall } from './model'

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
    // 바뀐 것만 담는다. 손대지 않은 설비·물리존은 없다. 조명은 사무실 경계를 고쳐 BIM 소속이 좌표 판정으로 풀렸다(Q13).
    expect(file.equipment.map((e) => e.id).sort()).toEqual([equip(a, 'AHU-1').id, equip(a, 'AT-101-01').id, equip(a, 'LIGHT-101-01').id].sort())
    expect(file.spaces).toHaveLength(1)
    expect(file.spaces[0].longName).toBe('대회의실')

    // 파일로 나갔다 들어온 것처럼 문자열을 거친다.
    const parsed = parseEditFile(JSON.stringify(file))
    if (typeof parsed === 'string') throw new Error(parsed)

    const b = read('mep.ifc')
    addUpperStorey(b)
    const result = applyEdits(b, parsed)
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0, elements: 0, storeys: 0 })
    expect(result.storeyMoved).toEqual([equip(b, 'AT-101-01').id])
    expect(exports(b)).toEqual(exports(a))
    // 사람이 고친 출처도 같다(좌표 출처가 편집, 종류는 사람이 정한 것).
    expect(equip(b, 'AHU-1').positionSource).toBe('edited')
    expect(equip(b, 'TEMP-101-01').kindEdited).toEqual({ from: null })
  })

  it('설비의 계통과 계통 종류·유체를 고친 것도 불러오면 같다(E8)', () => {
    const withWater = (m: Model) => {
      m.systems.push({ id: 'W1', name: 'Hydronic Supply 1', memberIds: [], source: 'property', kind: 'hydronic_supply', kindSource: 'dict', fluid: null })
      return m
    }
    const a = withWater(read('mep.ifc'))
    const base = baselineOf(a)
    setEquipmentSystem(a, equip(a, 'AHU-1').id, 'W1')
    setEquipmentSystem(a, equip(a, 'AT-101-01').id, null)
    setSystemKind(a, 'W1', 'hydronic_supply', 'hot')
    setSystemKind(a, a.systems[0].id, 'return_air')

    const file = exportEdits(a, base, 'mep.ifc')
    expect(file.systems).toEqual([
      { id: a.systems[0].id, kind: 'return_air', fluid: null },
      { id: 'W1', kind: 'hydronic_supply', fluid: 'hot' },
    ])
    expect(file.equipment.map((e) => e.system)).toEqual(['W1', null])

    const b = withWater(read('mep.ifc'))
    const result = applyEdits(b, parseEditFile(JSON.stringify(file)) as EditFile)
    expect(result.missing.systems).toBe(0)
    expect(exportedContent(b)).toBe(exportedContent(a))
    expect(modelToTTL(b)).toContain('ex:W1 a brick:Hot_Water_System ;')
    expect(equip(b, 'AHU-1').systemEdited).toEqual({ from: a.systems[0].id })
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
    // 계통 편집(E8). 계통 GUID 도 바뀌므로 이름으로 찾아야 한다 — 못 찾으면 설비가 계통 없이 남거나 종류가 안 얹힌다.
    setEquipmentSystem(a, equip(a, 'DUCT-01').id, null)
    setSystemKind(a, a.systems[0].id, 'return_air')
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
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0, elements: 0, storeys: 0 })
    expect(result.rematched.name + result.rematched.position).toBeGreaterThan(0)
    expect(equip(b, 'DUCT-01').systemId).toBe(null)
    expect(b.systems[0].kind).toBe('return_air')
    // id 만 다르고 내보내는 내용은 같다.
    const strip = (m: Model) => {
      const out = exports(m)
      return { ttl: out.ttl.split('Qv2').join(''), geo: out.geo.split('Qv2').join('') }
    }
    expect(strip(b)).toEqual(exports(a))
  })

  // OE-OBJ-07. 크기를 바꾼 BIM 창과, 더하고 크기를 정한 문이 편집 파일을 거쳐 그대로 돌아온다.
  it('문·창 크기 편집이 편집 파일로 돌아온다', () => {
    const a = read('two-rooms.ifc')
    const base = baselineOf(a)
    const win = a.storeys.flatMap((st) => st.openings).find((o) => o.name === 'WD-2F-01')!
    win.width = 2.0
    const first = a.storeys[0]
    const wall = addWall(a, first.id, [0, -3], [4, -3], 0.2, 'U_wallSize') as Wall
    const door = addOpening(a, first.id, 'door', [2, -3], 'U_doorSize') as Opening
    expect(door.wallId).toBe(wall.id)
    expect(setOpeningSize(a, door.id, { width: 0.9, height: 2.1 })).toBe(true)
    const file = exportEdits(a, base, 'two-rooms.ifc')
    expect(file.openings).toEqual([{ id: win.id, width: 2.0, height: win.height }])
    const b = read('two-rooms.ifc')
    const result = applyEdits(b, parseEditFile(JSON.stringify(file)) as EditFile)
    expect(result.missing.elements).toBe(0)
    const opened = b.storeys.flatMap((st) => st.openings)
    expect(opened.find((o) => o.id === win.id)!.width).toBe(2.0)
    expect(opened.find((o) => o.id === door.id)).toMatchObject({ width: 0.9, height: 2.1 })
  })

  // OE-OBJ-06. 지운 벽의 내력 여부는 편집 파일에 남지 않는다. 되살릴 때 잠금을 보면 BIM 이 내력이라 한 벽을 풀고 지운 편집이 빠진다.
  it('내력벽을 풀고 지운 편집을 되살리면, BIM 이 내력이라 해도 지워진다', () => {
    const a = read('two-rooms.ifc')
    const base = baselineOf(a)
    const bearing = a.storeys.flatMap((st) => st.walls).find((w) => w.name === 'W-1F-01')!
    expect(bearing.loadBearing).toBe(true)
    expect(deleteWall(a, bearing.id)).toBeNull()
    setWallLoadBearing(a, bearing.id, false)
    // 외벽도 층 편집에서 지우지 않는다(OE-EXT-02). 외벽 여부를 풀고 지운다.
    setWallExternal(a, bearing.id, false)
    expect(deleteWall(a, bearing.id)).not.toBeNull()
    const b = read('two-rooms.ifc')
    const result = applyEdits(b, parseEditFile(JSON.stringify(exportEdits(a, base, 'two-rooms.ifc'))) as EditFile)
    expect(result.missing.elements).toBe(0)
    expect(b.storeys.flatMap((st) => st.walls).some((w) => w.id === bearing.id)).toBe(false)
  })

  it('GUID 가 바뀐 판본에서도 고친 벽·문·창을 이름으로 찾는다. 에디터가 더한 벽은 지문으로 찾지 않는다', () => {
    const a = read('two-rooms.ifc')
    const base = baselineOf(a)
    const byName = (m: Model, name: string) => m.storeys.flatMap((st) => [...st.walls, ...st.openings]).find((x) => x.name === name)!
    const first = a.storeys[0]
    setWallLoadBearing(a, byName(a, 'W-1F-03').id, true)
    deleteWall(a, byName(a, 'W-1F-02').id)
    deleteOpening(a, byName(a, 'WD-2F-01').id)
    const wall = addWall(a, first.id, [0, 0], [4, 0], 0.2, 'U_wallTest') as Wall
    const door = addOpening(a, first.id, 'door', [2, 0], 'U_doorTest') as Opening
    expect(door.wallId).toBe(wall.id)
    const file = exportEdits(a, base, 'two-rooms.ifc')
    // 에디터가 지은 id 는 지문을 적지 않는다.
    expect(Object.keys(file.keys ?? {}).filter((k) => k.startsWith('U_'))).toEqual([])

    const ids = (m: Model) => m.storeys.flatMap((st) => [st.id, ...st.spaces.map((sp) => sp.id), ...st.walls.map((w) => w.id), ...st.openings.map((o) => o.id)])
    const reexport = (m: Model): Model => {
      let json = JSON.stringify(m)
      for (const id of ids(m)) json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
      return JSON.parse(json)
    }
    const b = reexport(read('two-rooms.ifc'))
    const result = applyEdits(b, parseEditFile(JSON.stringify(file)) as EditFile)
    expect(result.missing.elements).toBe(0)
    expect(result.rematched.name).toBeGreaterThanOrEqual(3)
    expect(byName(b, 'W-1F-03')).toMatchObject({ loadBearing: true })
    expect(byName(b, 'W-1F-02')).toBeUndefined()
    expect(byName(b, 'WD-2F-01')).toBeUndefined()
    expect(b.storeys[0].openings.find((o) => o.id === 'U_doorTest')?.wallId).toBe('U_wallTest')
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

// OE-PIP-09 계통 이름 고치기(2026-10-03 사용자 결정 — BIM 계통도 바꾼다). e2e 는 화면에서 한 번 바꾸는 것만 잰다.
describe('계통 이름 (OE-PIP-09)', () => {
  it('앞뒤 공백은 떼고, 빈 이름·같은 이름은 바꾸지 않으며, 되돌리면 BIM 이름이다', () => {
    const a = read('mep.ifc')
    const system = a.systems[0]
    const bim = system.name
    const snap = snapshotSystems(a, [system.id])
    expect(renameSystem(a, system.id, '   ')).toBe(false)
    expect(renameSystem(a, system.id, ` ${bim} `)).toBe(false)
    expect(renameSystem(a, system.id, '  1층 급기  ')).toBe(true)
    expect(system.name).toBe('1층 급기')
    restore(a, snap!)
    expect(system.name).toBe(bim)
  })

  it('이름만 고친 계통도 GUID 가 전부 바뀐 재내보내기에 다시 얹힌다 — 계통을 이름·구성원으로 찾는다', () => {
    const a = read('mep.ifc')
    const base = baselineOf(a)
    // 계통에 다른 편집은 없다. 이름 편집이 스스로 지문을 남겨야 다시 찾는다.
    renameSystem(a, a.systems[0].id, '1층 급기')
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    expect(file.systemNames).toEqual([{ id: a.systems[0].id, name: '1층 급기' }])
    const b = read('mep.ifc')
    let json = JSON.stringify(b)
    for (const id of [...b.systems.map((x) => x.id), ...b.storeys.flatMap((st) => st.equipment.map((e) => e.id))])
      json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
    const fresh: Model = JSON.parse(json)
    const result = applyEdits(fresh, file)
    expect(result.missing.systems).toBe(0)
    expect(fresh.systems[0].name).toBe('1층 급기')
  })
})

// 같은 두 설비 사이에 연결이 둘(포트가 둘씩 맞물린 곳 — 병원 HVAC 2쌍)이어도 편집 파일의 확정한 방향이 다시 얹힌다.
// 첫 연결만 보면 포트(방향 있음) 쪽에 걸려 "못 찾음" 이 되고 확정이 빠졌다(합성 고층 BIM 의 성수 불변식이 찾았다).
describe('같은 두 설비 사이의 연결 둘', () => {
  it('방향 있는 포트 연결 옆의 방향 없는 연결에 확정한 방향이 다시 얹힌다', () => {
    const withTwin = () => {
      const m = read('mep.ifc')
      const port = m.connections.find((c) => c.source === 'port' && c.directed)!
      m.connections.push({ from: port.to, to: port.from, source: 'port', directed: false, tolerance: null })
      return m
    }
    const a = withTwin()
    const base = baselineOf(a)
    const twin = a.connections[a.connections.length - 1]
    twin.inferred = { from: twin.from, to: twin.to, systemId: a.systems[0].id, confirmed: true }
    const file = parseEditFile(JSON.stringify(exportEdits(a, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    expect(file.confirmedFlows).toHaveLength(1)
    const b = withTwin()
    const result = applyEdits(b, file)
    expect(result.missing.flows).toBe(0)
    expect(b.connections[b.connections.length - 1].inferred).toMatchObject({ from: twin.from, to: twin.to, confirmed: true })
  })
})


describe('한 대만 정한 종류 (OE-EQP-14)', () => {
  it('같은 타입 중 한 대만 바꾼 종류는 다시 열어 얹어도 그 설비에만 붙는다', () => {
    const prep = (m: Model) => {
      equip(m, 'AT-101-01').objectType = 'M_Return Register:600'
      equip(m, 'AT-101-02').objectType = 'M_Return Register:600'
      return m
    }
    const m = prep(read('mep.ifc'))
    const base = baselineOf(m)
    setTypeKind(m, `#${equip(m, 'AT-101-01').id}`, 'air_grille')
    const file = exportEdits(m, base, 'mep.ifc')
    expect(file.kinds).toEqual([{ typeKey: `#${equip(m, 'AT-101-01').id}`, kind: 'air_grille' }])
    const fresh = prep(read('mep.ifc'))
    applyEdits(fresh, file)
    expect([equip(fresh, 'AT-101-01').kind, equip(fresh, 'AT-101-02').kind]).toEqual(['air_grille', 'air_diffuser'])
  })
})
