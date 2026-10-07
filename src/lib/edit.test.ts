import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import {
  insertSpaceVertex,
  deleteSpaceVertex,
  drawSpaceFootprint,
  openRing,
  baselineOf,
  diffBaseline,
  moveEquipment,
  moveEquipmentToStorey,
  moveSpaceVertex,
  renameSpace,
  replaceSpaceFootprint,
  summarize,
  completePosition,
  restore,
  snapshotConfirm,
  snapshotEquipment,
  snapshotFlow,
  snapshotOf,
  snapshotSpace,
  setFlowDirection,
  setTypeKind,
  kindEdits,
  snapshotType,
  typeKeyOf,
  typeNameOf,
  familyKeyOf,
  familyNameOf,
  wouldSelfIntersect,
  addEquipment,
  deleteEquipment,
  renameEquipment,
  snapshotEquipmentSet,
  createSpace,
  deleteSpace,
  splitSpace,
  mergeSpaces,
  snapshotStoreySpaces,
  addWall,
  addOpening,
  moveWall,
  deleteWall,
  moveOpening,
  OPENING_ALONG_WALL,
  setWallLoadBearing,
  snapshotStoreyElements,
  setEquipmentSystem,
  setSystemKind,
  snapshotSystems,
  createSystem,
  deleteSystem,
  moveWallWithSpaces,
  wallLocked,
  wallsCrossed,
  newCrossing,
  wallLength,
  setWallLength,
  setOpeningSize,
  WALL_LOCKED,
  insertWall,
  deleteOpening,
  type WallCarryPlan,
  type Snapshot,
  type Change,
} from './edit'
import { countOf, polygonArea, unplacedOf, type Model, type Opening, type Vec2, type Wall } from './model'
import { modelToGeoJSON } from './export/geojson'
import { confirmSystemFlow, inferFlowByRules, newlyDisagreeing, withInferred } from './flow-rules'
import { assignEquipmentToSpaces } from './mapping'
import { escapeLocalName, modelToTTL } from './export/ttl'

let api: WebIFC.IfcAPI
let model: Model

// 편집은 모델을 그 자리에서 고치므로 테스트마다 새로 읽는다.
beforeEach(async () => {
  if (!api) {
    api = new WebIFC.IfcAPI()
    await api.Init()
  }
  const path = fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url))
  model = importIfc(api, new Uint8Array(readFileSync(path)))
}, 60_000)

const equip = (name: string) => model.storeys.flatMap((s) => s.equipment).find((e) => e.id !== '' && e.name === name)!

describe('설비 이동 (E5)', () => {
  it('물리존 밖으로 옮기면 소속이 사라진다', () => {
    // 사무실은 (0,0)-(10,8) 이다. 그 밖으로 옮긴다.
    const change = moveEquipment(model, equip('AHU-1').id, [50, 50, 3.2])!
    expect(change.fromSpaceId).toBe(model.storeys[0].spaces[0].id)
    expect(change.toSpaceId).toBe(null)
    expect(equip('AHU-1').spaceId).toBe(null)
    expect(change.summary).toContain('사무실')
    expect(change.summary).toContain('(소속 없음)')
  })

  it('안에서 움직이면 소속이 그대로다', () => {
    const change = moveEquipment(model, equip('AHU-1').id, [5, 5, 3.2])!
    expect(change.fromSpaceId).toBe(change.toSpaceId)
    expect(change.summary).toContain('위치만 바뀌었고')
  })

  it('BIM 이 소속을 말한 설비도 옮기면 좌표로 다시 판정한다', () => {
    // BIM 의 소속은 BIM 이 말한 자리에 대한 것이다. 방 밖으로 끌어낸 설비가 예전 방에 남으면 안 된다.
    const declared = model.storeys.flatMap((s) => s.equipment).find((e) => e.spaceSource === 'bim')!
    expect(declared.spaceId).not.toBe(null)

    const change = moveEquipment(model, declared.id, [50, 50, 1])!
    expect(change.toSpaceId).toBe(null)
    expect(declared.spaceSource).toBe(null)
  })

  it('좌표를 바꾸면 소속 판정이 함께 돈다', () => {
    // 호출부가 재판정을 잊을 수 있는 구조면 좌표와 소속이 어긋난 채로 남는다.
    moveEquipment(model, equip('AHU-1').id, [50, 50, 3.2])
    expect(equip('AHU-1').position).toEqual([50, 50, 3.2])
    expect(equip('AHU-1').spaceId).toBe(null)
  })

  it('없는 설비는 null 을 돌려준다', () => {
    expect(moveEquipment(model, '없는-id', [0, 0, 0])).toBe(null)
  })
})

describe('미배치 설비 배치 (E6)', () => {
  it('좌표를 주면 소속이 생긴다', () => {
    const sensor = equip('TEMP-101-01')
    expect(sensor.position).toBe(null)
    expect(sensor.spaceId).toBe(null)

    const change = moveEquipment(model, sensor.id, [5, 4, 2.5])!
    expect(change.fromSpaceId).toBe(null)
    expect(change.toSpaceId).toBe(model.storeys[0].spaces[0].id)
    expect(change.summary).toContain('(소속 없음) 에서 사무실 로 바뀝니다')
  })

  it('미배치 목록은 좌표 없는 설비와 그 층이고, 놓으면 빠지고 되돌리면 돌아온다', () => {
    // OE-BIM-07 수용 기준 "좌표 없는 설비는 미배치 목록". 층은 BIM 이 말한 것이라 어느 바닥에 놓을지 안다.
    const listed = () => unplacedOf(model).map((u) => `${u.equipment.name}@${u.storey.name}`)
    expect(listed()).toEqual(['TEMP-101-01@1F'])
    expect(unplacedOf(model)).toHaveLength(countOf(model).unplacedEquipment)

    const sensor = equip('TEMP-101-01')
    const snap = snapshotEquipment(model, sensor.id)
    moveEquipment(model, sensor.id, [5, 4, 2.5])
    expect(listed()).toEqual([])
    restore(model, snap!)
    expect(listed()).toEqual(['TEMP-101-01@1F'])

    // 좌표 없이 더한 설비도 같은 목록에 든다 — 사람이 3D 에서 놓아야 하는 것은 같다.
    addEquipment(model, model.storeys[0].id, { name: '새 센서', kind: null, position: null })
    expect(listed()).toEqual(['TEMP-101-01@1F', '새 센서@1F'])
  })

  it('미배치 설비는 TTL 에 층까지만, GeoJSON 에 형상 없이 나간다', () => {
    // 3D 에 없다고 온톨로지에서 빠지지 않는다. 위치는 아는 데(층)까지만 쓰고 지어내지 않는다.
    const sensor = equip('TEMP-101-01')
    const ttl = modelToTTL(model)
    const head = `ex:${escapeLocalName(sensor.id)} a `
    const block = ttl.slice(ttl.indexOf(head), ttl.indexOf(' .\n', ttl.indexOf(head)))
    expect(block).toContain(`brick:hasLocation ex:${escapeLocalName(model.storeys[0].id)} ;`)
    const feature = modelToGeoJSON(model).flatMap((f) => f.collection.features).find((f) => f.id === sensor.id)!
    expect(feature.geometry).toBe(null)
    expect(feature.properties).toMatchObject({ storeyId: model.storeys[0].id, spaceId: null })
  })
})

describe('좌표 초안', () => {
  it('빈 축이 있으면 좌표를 만들지 않는다', () => {
    // 한 축만 넣고 나머지를 0 으로 채우면 원점 쪽 물리존에 조용히 소속된다.
    expect(completePosition([5, null, null])).toBe(null)
    expect(completePosition([5, 4, null])).toBe(null)
    expect(completePosition([])).toBe(null)
  })

  it('셋이 다 차면 좌표가 되고, 0 은 모름이 아니라 값이다', () => {
    expect(completePosition([5, 4, 2.5])).toEqual([5, 4, 2.5])
    expect(completePosition([0, 0, 0])).toEqual([0, 0, 0])
  })
})

describe('층 이동', () => {
  it('층은 좌표가 아니라 사람이 고른다', () => {
    // mep.ifc 는 층이 하나뿐이라 같은 층으로 옮겨도 동작만 확인한다.
    const change = moveEquipmentToStorey(model, equip('AHU-1').id, model.storeys[0].id)!
    expect(change.summary).toContain('1F 층으로')
    expect(model.storeys[0].equipment.filter((e) => e.name === 'AHU-1')).toHaveLength(1)
  })

  it('다른 층으로 옮기면 높이도 두 층 바닥의 차만큼 옮긴다', () => {
    // mep.ifc 는 층이 하나라 위층을 붙인다. 층만 바꾸고 z 를 두면 3D 는 예전 층에 그대로 있다.
    model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
    const ahu = equip('AHU-1')
    const [x, y, z] = ahu.position!

    const change = moveEquipmentToStorey(model, ahu.id, 'up')!
    expect(ahu.position).toEqual([x, y, z + 3.5])
    expect(ahu.positionSource).toBe('edited')
    expect(model.storeys[1].equipment).toContain(ahu)
    // 새 층에는 방이 없으니 소속이 사라진다.
    expect(change.toSpaceId).toBe(null)
  })

  it('좌표가 없는 설비는 층을 옮겨도 좌표를 만들지 않는다', () => {
    model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
    const sensor = equip('TEMP-101-01')
    moveEquipmentToStorey(model, sensor.id, 'up')
    expect(sensor.position).toBe(null)
  })

  it('없는 층이면 아무것도 안 한다', () => {
    expect(moveEquipmentToStorey(model, equip('AHU-1').id, '없는-층')).toBe(null)
  })
})

describe('이름 수정 (E1)', () => {
  it('라벨만 바뀐다', () => {
    const space = model.storeys[0].spaces[0]
    expect(renameSpace(model, space.id, '대회의실')).toBe(true)
    expect(space.longName).toBe('대회의실')
    // 소속 관계는 건드리지 않는다.
    expect(equip('AHU-1').spaceId).toBe(space.id)
  })

  it('이름 사전으로 정한 방 종류는 이름을 따라가고, 되돌리면 같이 돌아온다', () => {
    // 계단을 "회의실" 로 고쳤는데 brick:Staircase 로 나갔다. 사람이 방 종류를 바로잡는 길이 이름 고치기뿐이다.
    const space = model.storeys[0].spaces[0]
    const before = { kind: space.kind, source: space.kindSource }
    const snap = snapshotSpace(model, space.id)!
    renameSpace(model, space.id, '계단실 A')
    expect([space.kind, space.kindSource]).toEqual(['staircase', 'dict'])
    expect(modelToTTL(model)).toContain('brick:Staircase')
    renameSpace(model, space.id, 'S.T')
    expect(space.kind).toBe(null)
    restore(model, snap)
    expect({ kind: space.kind, source: space.kindSource }).toEqual(before)
  })
})

describe('결과 리포트 (PRD #21)', () => {
  const change = (id: string, from: string | null, to: string | null): Change => ({
    equipmentId: id,
    equipmentName: id,
    fromSpaceId: from,
    toSpaceId: to,
    summary: '',
  })

  it('같은 설비는 마지막 상태만 남긴다', () => {
    const out = summarize([change('a', 'S1', 'S2'), change('a', 'S2', 'S3')])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ fromSpaceId: 'S1', toSpaceId: 'S3' })
  })

  it('제자리로 돌아온 설비는 목록에서 빠진다', () => {
    // 옮겼다가 되돌린 것을 변경으로 적으면 리포트가 거짓이 된다.
    expect(summarize([change('a', 'S1', 'S2'), change('a', 'S2', 'S1')])).toEqual([])
  })

  it('바뀐 것이 없으면 빈 목록이다', () => {
    expect(summarize([])).toEqual([])
  })
})

describe('물리존 경계 수정 (E2)', () => {
  const office = () => model.storeys[0].spaces[0]

  it('놓기 전에 자기 교차를 물을 수 있고, 묻기만 해서는 아무것도 바뀌지 않는다', () => {
    // (0,0)-(10,0)-(10,8)-(0,8). 첫 점을 (20,4) 로 끌면 두 변이 엇갈린다.
    expect(wouldSelfIntersect(model, office().id, 0, [20, 4])).toBe(true)
    expect(wouldSelfIntersect(model, office().id, 1, [12, 0])).toBe(false)
    expect(office().areaM2).toBeCloseTo(80, 6)
  })

  it('넓이가 다시 계산된다', () => {
    // 사무실은 (0,0)-(10,8) 이라 80㎡ 다. 한 꼭짓점을 당기면 줄어든다.
    expect(office().areaM2).toBeCloseTo(80, 6)

    // (10,0) 을 (5,0) 으로 당기면 사각형이 사다리꼴이 된다. 윗변 10, 아랫변 5, 높이 8 이라 60㎡.
    const change = moveSpaceVertex(model, office().id, 1, [5, 0])!
    expect(change.fromAreaM2).toBeCloseTo(80, 6)
    expect(change.toAreaM2).toBeCloseTo(60, 6)
    expect(office().areaM2).toBeCloseTo(60, 6)
  })

  it('경계 밖으로 밀려난 설비의 소속이 바뀐다', () => {
    // AT-101-02 는 (7,4) 에 있다. 경계를 x=5 까지 당기면 밖으로 나간다.
    const terminal = equip('AT-101-02')
    expect(terminal.spaceId).toBe(office().id)

    const change = replaceSpaceFootprint(model, office().id, [
      [0, 0],
      [5, 0],
      [5, 8],
      [0, 8],
      [0, 0],
    ])!

    expect(terminal.spaceId).toBe(null)
    expect(change.equipment.map((c) => c.equipmentName)).toContain('AT-101-02')
    expect(change.equipment.find((c) => c.equipmentName === 'AT-101-02')!.toSpaceId).toBe(null)
  })

  it('안에 남은 설비는 변화 목록에 없다', () => {
    // AHU-1 은 (1,1) 이라 줄인 뒤에도 안에 있다. 바뀌지 않은 것을 적으면 리포트가 부풀려진다.
    const change = replaceSpaceFootprint(model, office().id, [
      [0, 0],
      [5, 0],
      [5, 8],
      [0, 8],
      [0, 0],
    ])!
    expect(change.equipment.map((c) => c.equipmentName)).not.toContain('AHU-1')
  })

  it('BIM 이 소속을 말한 설비는 경계를 바꿔도 그대로다', () => {
    // LIGHT-101-01 은 좌표가 (50,50) 으로 밖인데 IFC 가 사무실에 담아 두었다.
    const light = equip('LIGHT-101-01')
    replaceSpaceFootprint(model, office().id, [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ])
    expect(light.spaceId).toBe(office().id)
    expect(light.spaceSource).toBe('bim')
  })

  it('닫힌 고리의 첫 점을 옮기면 끝 점도 따라온다', () => {
    // 하나만 옮기면 고리가 벌어져서 넓이가 엉뚱해진다.
    const change = moveSpaceVertex(model, office().id, 0, [-2, -2])!
    const ring = office().footprint
    expect(ring[0]).toEqual([-2, -2])
    expect(ring[ring.length - 1]).toEqual([-2, -2])
    expect(change.toAreaM2).toBeGreaterThan(80)
  })

  it('자기 자신과 교차하면 알린다', () => {
    const change = replaceSpaceFootprint(model, office().id, [
      [0, 0],
      [10, 8],
      [10, 0],
      [0, 8],
      [0, 0],
    ])!
    // 막지는 않는다. 끌다 보면 잠깐 교차했다 풀리는 일이 흔하다.
    expect(change.selfIntersecting).toBe(true)
  })

  it('없는 꼭짓점이면 아무것도 안 한다', () => {
    expect(moveSpaceVertex(model, office().id, 99, [0, 0])).toBe(null)
    expect(moveSpaceVertex(model, '없는-id', 0, [0, 0])).toBe(null)
  })
})

describe('되돌리기', () => {
  const office = () => model.storeys[0].spaces[0]

  it('BIM 소속이 있던 설비를 옮겼다 되돌리면 좌표·출처·소속이 옮기기 전과 같다', () => {
    // 반대로 옮기는 식이면 출처가 편집으로 남는다. 스냅숏은 출처까지 되돌린다.
    const e = model.storeys.flatMap((s) => s.equipment).find((x) => x.spaceSource === 'bim')!
    const before = { position: e.position, positionSource: e.positionSource, spaceId: e.spaceId, spaceSource: e.spaceSource }
    const snap = snapshotEquipment(model, e.id)!

    moveEquipment(model, e.id, [50, 50, 1])
    expect(e.spaceSource).toBe(null)

    restore(model, snap)
    expect({ position: e.position, positionSource: e.positionSource, spaceId: e.spaceId, spaceSource: e.spaceSource }).toEqual(before)
  })

  it('층을 옮겼다 되돌리면 원래 층 목록의 원래 자리와 높이로 돌아온다', () => {
    model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
    const ahu = equip('AHU-1')
    const index = model.storeys[0].equipment.indexOf(ahu)
    const z = ahu.position![2]
    const snap = snapshotEquipment(model, ahu.id)!

    moveEquipmentToStorey(model, ahu.id, 'up')
    restore(model, snap)
    expect(model.storeys[0].equipment.indexOf(ahu)).toBe(index)
    expect(model.storeys[1].equipment).toHaveLength(0)
    expect(ahu.position![2]).toBe(z)
    expect(ahu.spaceId).toBe(office().id)
  })

  it('경계를 되돌리면 넓이와 밀려났던 설비의 소속이 돌아온다', () => {
    const snap = snapshotSpace(model, office().id)!
    // (10,0) 을 (4,4) 로. (7,4) 의 AT-101-02 가 밖으로 나간다.
    moveSpaceVertex(model, office().id, 1, [4, 4])
    expect(equip('AT-101-02').spaceId).toBe(null)

    restore(model, snap)
    expect(office().areaM2).toBeCloseTo(80, 6)
    expect(equip('AT-101-02').spaceId).toBe(office().id)
  })

  it('이름을 되돌린다', () => {
    const snap = snapshotSpace(model, office().id)!
    renameSpace(model, office().id, '대회의실')
    restore(model, snap)
    expect(office().longName).toBe('사무실')
  })

  it('사람이 정한 방향을 되돌리면 정하기 전(규칙 방향만)으로 돌아간다', () => {
    inferFlowByRules(model)
    const c = model.connections.find((x) => !x.directed)!
    const snap = snapshotFlow(c)
    setFlowDirection(c, c.to)
    expect(c.edited).toBeDefined()

    restore(model, snap)
    expect(c.edited).toBeUndefined()
  })

  it('계통 확정을 되돌리면 그때 확정한 연결만 다시 미확정이 되고 feeds 로 안 나간다', () => {
    inferFlowByRules(model)
    const ruled = model.connections.find((x) => x.inferred)!
    const systemId = ruled.inferred!.systemId
    const snap = snapshotConfirm(model, systemId)
    expect(confirmSystemFlow(model, systemId)).toBeGreaterThan(0)

    restore(model, snap)
    expect(ruled.inferred!.confirmed).toBe(false)
    expect(withInferred([ruled], true)[0].directed).toBeFalsy()
  })
})

describe('다시 하기', () => {
  // 되돌리기 직전에 snapshotOf 로 지금 상태를 떠 두고, 다시 하기는 그것을 restore 한다.
  it('옮긴 설비를 되돌렸다 다시 하면 옮긴 자리·출처·소속으로 돌아간다', () => {
    const ahu = equip('AHU-1')
    const before = snapshotEquipment(model, ahu.id)!
    moveEquipment(model, ahu.id, [50, 50, 1])
    const moved = { position: [...ahu.position!], positionSource: ahu.positionSource, spaceId: ahu.spaceId }

    const after = snapshotOf(model, before)!
    restore(model, before)
    expect(ahu.spaceId).not.toBe(null)
    restore(model, after)
    expect({ position: [...ahu.position!], positionSource: ahu.positionSource, spaceId: ahu.spaceId }).toEqual(moved)
  })

  it('경계를 되돌렸다 다시 하면 넓이와 소속이 편집 뒤로 간다', () => {
    const office = model.storeys[0].spaces[0]
    const before = snapshotSpace(model, office.id)!
    moveSpaceVertex(model, office.id, 1, [4, 4])
    const area = office.areaM2
    const after = snapshotOf(model, before)!
    restore(model, before)
    restore(model, after)
    expect(office.areaM2).toBeCloseTo(area, 6)
    expect(equip('AT-101-02').spaceId).toBe(null)
  })

  it('계통 확정을 되돌렸다 다시 하면 그 연결이 다시 확정이다', () => {
    inferFlowByRules(model)
    const ruled = model.connections.find((x) => x.inferred)!
    const before = snapshotConfirm(model, ruled.inferred!.systemId)
    confirmSystemFlow(model, ruled.inferred!.systemId)
    const after = snapshotOf(model, before)!
    restore(model, before)
    expect(ruled.inferred!.confirmed).toBe(false)
    restore(model, after)
    expect(ruled.inferred!.confirmed).toBe(true)
  })

  it('종류와 사람이 정한 방향도 다시 한다', () => {
    inferFlowByRules(model)
    const key = typeKeyOf(equip('AHU-1'))
    const kinds = snapshotType(model, key)
    setTypeKind(model, key, 'fcu')
    const kindsAfter = snapshotOf(model, kinds)!
    restore(model, kinds)
    expect(equip('AHU-1').kind).toBe('ahu')
    restore(model, kindsAfter)
    expect(equip('AHU-1').kind).toBe('fcu')
    expect(equip('AHU-1').kindEdited).toEqual({ from: 'ahu' })

    const c = model.connections.find((x) => !x.directed)!
    const flow = snapshotFlow(c)
    setFlowDirection(c, c.to)
    const flowAfter = snapshotOf(model, flow)!
    restore(model, flow)
    restore(model, flowAfter)
    expect(c.edited).toEqual({ from: c.to, to: c.from })
  })
})

describe('바뀐 것만 다시 판정한다', () => {
  // 편집은 설비 하나나 층 하나만 다시 판정한다. 그 결과가 전체를 다시 돈 것과 같아야 한다 — 다르면
  // 편집이 판정을 빠뜨린 것이다.
  const all = () => model.storeys.flatMap((s) => s.equipment.map((e) => `${e.id}:${e.spaceId}:${e.spaceSource}`))
  const same = () => {
    const now = all()
    assignEquipmentToSpaces(model)
    expect(all()).toEqual(now)
  }

  it('설비를 옮기고, 층을 옮기고, 경계를 고치고, 되돌린 뒤에도 전체 판정과 같다', () => {
    model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
    const office = model.storeys[0].spaces[0]
    const snapAhu = snapshotEquipment(model, equip('AHU-1').id)!
    moveEquipment(model, equip('AHU-1').id, [50, 50, 3.2])
    same()
    moveEquipment(model, equip('AHU-1').id, [5, 5, 3.2])
    same()
    const snapOffice = snapshotSpace(model, office.id)!
    moveSpaceVertex(model, office.id, 1, [4, 4])
    same()
    moveEquipmentToStorey(model, equip('AT-101-01').id, 'up')
    same()
    restore(model, snapOffice)
    same()
    restore(model, snapAhu)
    same()
  })
})

describe('타입 단위 종류 지정', () => {
  it('같은 ObjectType 전부의 종류를 한 번에 정하고, 사람이 정한 것으로 남긴다', () => {
    // 픽스처의 두 토출구는 ObjectType 이 다르다(AT1, AT2). 같은 타입으로 만들어 본다.
    equip('AT-101-01').objectType = 'M_Return Register:600'
    equip('AT-101-02').objectType = 'M_Return Register:600'
    const done = setTypeKind(model, 'AirTerminal|M_Return Register:600', 'air_grille')!
    expect(done.count).toBe(2)
    for (const name of ['AT-101-01', 'AT-101-02']) {
      expect(equip(name).kind).toBe('air_grille')
      expect(equip(name).kindEdited).toEqual({ from: 'air_diffuser' })
    }
    expect(kindEdits(model)).toEqual([{ typeKey: 'AirTerminal|M_Return Register:600', count: 2, from: 'air_diffuser', to: 'air_grille' }])
  })

  it('Revit 이름의 패밀리:유형으로 묶고, 유형 이름만 같은 다른 패밀리는 묶지 않는다', () => {
    // Revit 2011 은 ObjectType 에 유형 이름만 적는다. ObjectType 으로만 묶으면 VAV 와 배관 부속이 한 묶음이 된다.
    const vav = { ...equip('AT-101-01'), name: 'M_VAV Unit - Single Duct:150 mm:150 mm:585441', objectType: '150 mm' }
    const vav2 = { ...vav, id: 'x', name: 'M_VAV Unit - Single Duct:150 mm:150 mm:603608' }
    const fitting = { ...vav, id: 'y', name: 'M_Elbow - Generic:150 mm:150 mm:777', objectType: '150 mm' }
    expect(typeNameOf(vav)).toBe('M_VAV Unit - Single Duct:150 mm:150 mm')
    expect(typeKeyOf(vav2)).toBe(typeKeyOf(vav))
    expect(typeKeyOf(fitting)).not.toBe(typeKeyOf(vav))
    // 클래스가 다르면 이름이 같아도 다른 타입이다.
    expect(typeKeyOf({ ...vav2, ifcClass: 'FlowFitting' })).not.toBe(typeKeyOf(vav))
    // 타입 정보가 없으면 그 설비 하나다.
    expect(typeKeyOf({ ...vav, name: 'AHU-1', objectType: '' })).toBe(`#${vav.id}`)
  })

  it('패밀리로 고르면 크기만 다른 유형까지 한 번에 붙고, 다른 패밀리는 그대로다', () => {
    // 병원 MEP 의 VAV 는 한 패밀리에 유형(150·200 mm …)이 다섯이었다.
    const [a, b, c] = ['AT-101-01', 'AT-101-02', 'AHU-1'].map(equip)
    a.name = 'M_VAV Unit - Single Duct:150 mm:150 mm:1'
    b.name = 'M_VAV Unit - Single Duct:200 mm:200 mm:2'
    b.ifcClass = a.ifcClass
    c.name = 'M_Elbow - Generic:150 mm:150 mm:3'
    c.ifcClass = a.ifcClass
    expect(familyNameOf(a)).toBe('M_VAV Unit - Single Duct')
    expect(typeKeyOf(a)).not.toBe(typeKeyOf(b))
    expect(familyKeyOf(a)).toBe(familyKeyOf(b))
    expect(familyKeyOf(c)).not.toBe(familyKeyOf(a))
    // ObjectType 만 있는 이름(Revit 모양이 아님)은 타입이 곧 패밀리다.
    expect(familyNameOf({ ...a, name: 'S1', objectType: 'Thermostat' })).toBe('Thermostat')

    const snap = snapshotType(model, familyKeyOf(a))
    expect(setTypeKind(model, familyKeyOf(a), 'vav')!.count).toBe(2)
    expect([a.kind, b.kind]).toEqual(['vav', 'vav'])
    expect(c.kind).toBe('ahu')
    // 리포트·편집 파일은 타입마다 적힌다(다른 파일에 얹을 때 타입이 더 좁은 열쇠다).
    expect(kindEdits(model).map((k) => k.typeKey).sort()).toEqual([typeKeyOf(a), typeKeyOf(b)].sort())
    restore(model, snap)
    expect([a.kind, b.kind]).toEqual(['air_diffuser', 'air_diffuser'])
  })

  it('한 대만 따로 정하면(`#id`) 그 설비만 바뀌고, 편집 파일에는 그 설비 한 줄로 적힌다 (OE-EQP-14)', () => {
    equip('AT-101-01').objectType = 'M_Return Register:600'
    equip('AT-101-02').objectType = 'M_Return Register:600'
    const [a, b] = ['AT-101-01', 'AT-101-02'].map(equip)
    expect(setTypeKind(model, `#${a.id}`, 'air_grille')!.count).toBe(1)
    expect([a.kind, b.kind]).toEqual(['air_grille', 'air_diffuser'])
    // 타입 줄로 적으면 다시 열 때 b 에도 번진다 — 그 설비 한 줄이다.
    expect(kindEdits(model)).toEqual([{ typeKey: `#${a.id}`, count: 1, from: 'air_diffuser', to: 'air_grille' }])
    // 나머지도 같은 종류로 정하면 타입이 다 같아져 다시 타입 한 줄이다.
    setTypeKind(model, `#${b.id}`, 'air_grille')
    expect(kindEdits(model)).toEqual([{ typeKey: typeKeyOf(a), count: 2, from: 'air_diffuser', to: 'air_grille' }])
  })

  it('사전 값으로 되돌리면 편집이 아니고 리포트에서 빠진다', () => {
    const key = typeKeyOf(equip('AHU-1'))
    setTypeKind(model, key, 'fcu')
    setTypeKind(model, key, 'ahu')
    expect(equip('AHU-1').kindEdited).toBeUndefined()
    expect(kindEdits(model)).toEqual([])
  })

  it('없는 종류이거나 바뀌는 것이 없으면 아무것도 안 한다', () => {
    expect(setTypeKind(model, typeKeyOf(equip('AHU-1')), '없는-종류')).toBe(null)
    expect(setTypeKind(model, typeKeyOf(equip('AHU-1')), 'ahu')).toBe(null)
    expect(setTypeKind(model, '없는-타입', 'ahu')).toBe(null)
  })

  it('종류가 바뀌면 규칙 방향을 다시 돌리고, 되돌리면 규칙 방향도 돌아온다', () => {
    // AHU-1 이 공기의 원천이라 DUCT-01 → AT-101-02 에 규칙 방향이 선다. 공조기를 "모름" 으로 하면 원천이 없다.
    inferFlowByRules(model)
    const terminal = model.connections.find((c) => !c.directed && [c.from, c.to].includes(equip('AT-101-02').id))!
    expect(terminal.inferred).toBeDefined()

    const key = typeKeyOf(equip('AHU-1'))
    const snap = snapshotType(model, key)
    const done = setTypeKind(model, key, null)!
    expect(done.rules.oriented).toBe(0)
    expect(terminal.inferred).toBeUndefined()

    const again = restore(model, snap)!
    expect(again.oriented).toBeGreaterThan(0)
    expect(terminal.inferred).toBeDefined()
    expect(equip('AHU-1').kind).toBe('ahu')
    expect(equip('AHU-1').kindEdited).toBeUndefined()
  })

  it('사람이 정한 종류가 Brick 클래스로 나간다', () => {
    const key = typeKeyOf(equip('AHU-1'))
    const snap = snapshotType(model, key)
    setTypeKind(model, key, 'fcu')
    expect(modelToTTL(model)).toContain('brick:Fan_Coil_Unit')
    restore(model, snap)
    expect(modelToTTL(model)).not.toContain('brick:Fan_Coil_Unit')
  })

  it('사람이 정한 방향과 확정한 계통은 종류를 바꿔도 남는다', () => {
    inferFlowByRules(model)
    const c = model.connections.find((x) => !x.directed)!
    setFlowDirection(c, c.to)
    setTypeKind(model, typeKeyOf(equip('AHU-1')), null)
    expect(c.edited).toEqual({ from: c.to, to: c.from })
  })
})

describe('연 때와 견주기', () => {
  it('이름·좌표·층이 바뀐 것을 연 때의 값과 견줘 찾고, 제자리로 돌리면 빠진다', () => {
    model.storeys.push({ id: 'up', name: '2F', elevation: 3.5, spaces: [], walls: [], openings: [], equipment: [] })
    const base = baselineOf(model)
    const office = model.storeys[0].spaces[0]
    const ahu = equip('AHU-1')
    const at = ahu.position!

    renameSpace(model, office.id, '대회의실')
    // 방 안에서 1m. 소속은 그대로라 Change 로는 안 남는다.
    moveEquipment(model, ahu.id, [at[0] + 1, at[1], at[2]])
    moveEquipmentToStorey(model, equip('AT-101-01').id, 'up')

    const diff = diffBaseline(model, base)
    expect(diff.renamed).toEqual([{ spaceId: office.id, from: '사무실', to: '대회의실' }])
    expect(diff.moved.map((m) => m.name)).toEqual(['AHU-1'])
    // 층을 옮긴 것은 높이가 바뀌어도 좌표 줄에 다시 세지 않는다.
    expect(diff.restoreyed).toEqual([{ id: equip('AT-101-01').id, name: 'AT-101-01', from: '1F', to: '2F' }])

    renameSpace(model, office.id, '사무실')
    moveEquipment(model, ahu.id, at)
    moveEquipmentToStorey(model, equip('AT-101-01').id, model.storeys[0].id)
    expect(diffBaseline(model, base)).toEqual({
      renamed: [],
      moved: [],
      restoreyed: [],
      connected: [],
      disconnected: [],
      spacesAdded: [],
      spacesRemoved: [],
      equipmentAdded: [],
      equipmentRemoved: [],
      equipmentRenamed: [],
      equipmentMounted: [],
      wallsAdded: [],
      wallsRemoved: [],
      wallsChanged: [],
      openingsAdded: [],
      openingsRemoved: [],
      openingsMoved: [],
      customZones: [],
      systemMoved: [],
      systemKinds: [],
      systemNames: [],
      systemsAdded: [],
      systemsRemoved: [],
    })
  })

  it('소속이 바뀐 이동은 좌표 줄에 넣지 않는다(Change 가 적는다)', () => {
    const base = baselineOf(model)
    moveEquipment(model, equip('AHU-1').id, [50, 50, 1])
    expect(diffBaseline(model, base).moved).toEqual([])
  })
})

describe('종류를 바꿔 규칙이 포트와 어긋나기 시작한 계통', () => {
  it('포트가 이어 준 디퓨저를 팬(원천)으로 바꾸면 그 계통이 새로 어긋나고, 되돌리면 사라진다', () => {
    const before = inferFlowByRules(model)
    expect(before.disagree).toBe(0)
    const key = typeKeyOf(equip('AT-101-01'))
    const snap = snapshotType(model, key)
    // 디퓨저가 원천이 되면 덕트 → 디퓨저 포트 방향을 규칙은 디퓨저 → 덕트로 본다.
    const after = setTypeKind(model, key, 'fan')!.rules
    const worse = newlyDisagreeing(before, after)
    expect(worse).toHaveLength(1)
    expect(worse[0].agree).toBeLessThan(worse[0].checked)

    const back = restore(model, snap)!
    expect(newlyDisagreeing(before, back)).toEqual([])
  })
})

describe('물리존 꼭짓점 넣기·지우기, 외곽선 그리기', () => {
  it('꼭짓점을 가운데에 넣고 지우며, 닫힌 고리는 닫힌 채로 둔다', () => {
    // 사무실은 (0,0)-(10,8) 네 꼭짓점이다.
    const office = model.storeys[0].spaces[0]
    const closed = office.footprint.length > 1 && office.footprint[0][0] === office.footprint.at(-1)![0] && office.footprint[0][1] === office.footprint.at(-1)![1]
    expect(openRing(office.footprint)).toHaveLength(4)
    const change = insertSpaceVertex(model, office.id, 0)!
    expect(openRing(office.footprint)).toHaveLength(5)
    expect(openRing(office.footprint)[1]).toEqual([5, 0])
    // 변 위에 넣었으니 넓이는 그대로다.
    expect(change.toAreaM2).toBeCloseTo(80)
    const stillClosed = office.footprint[0][0] === office.footprint.at(-1)![0] && office.footprint[0][1] === office.footprint.at(-1)![1]
    expect(stillClosed).toBe(closed)

    // 모서리 하나를 지우면 삼각형(넓이 절반)이고, 셋에서는 더 지우지 않는다.
    deleteSpaceVertex(model, office.id, 1)
    deleteSpaceVertex(model, office.id, 1)
    expect(openRing(office.footprint)).toHaveLength(3)
    expect(office.areaM2).toBeCloseTo(40)
    expect(deleteSpaceVertex(model, office.id, 0)).toBeNull()
  })

  it('외곽선이 없던 물리존에 찍은 점으로 외곽선을 주고 소속을 다시 잰다', () => {
    const office = model.storeys[0].spaces[0]
    office.footprint = []
    office.areaM2 = 0
    expect(drawSpaceFootprint(model, office.id, [[0, 0], [10, 0]])).toBeNull()
    const change = drawSpaceFootprint(model, office.id, [[0, 0], [10, 0], [10, 8], [0, 8]])!
    expect(change.toAreaM2).toBeCloseTo(80)
    expect(equip('AHU-1').spaceId).toBe(office.id)
  })
})


describe('설비 추가·삭제·이름 (E7)', () => {
  it('더한 설비는 좌표로 소속을 찾고, 편집 표시가 붙는다', () => {
    const e = addEquipment(model, model.storeys[0].id, { name: 'FCU-9', kind: 'fcu', position: [2, 2, 2.7] })!
    expect(e.id).toMatch(/^U_[0-9A-Za-z_]{20}$/)
    expect(e.added).toBe(true)
    expect(e.spaceId).toBe(model.storeys[0].spaces[0].id)
    expect(e.role).toBe('conversion')
    expect(modelToTTL(model)).toContain(`a brick:Fan_Coil_Unit ;\n    rdfs:label "FCU-9"`)
  })

  it('모르는 종류로는 더하지 않는다', () => {
    expect(addEquipment(model, model.storeys[0].id, { name: 'x', kind: 'nope', position: null })).toBeNull()
  })

  it('지우면 붙은 연결과 계통 자리도 빠진다 — 없는 설비를 가리키는 feeds·hasPart 가 나가지 않게', () => {
    const duct = equip('DUCT-01')
    expect(model.connections.some((c) => c.from === duct.id || c.to === duct.id)).toBe(true)
    const done = deleteEquipment(model, duct.id)!
    expect(done.connections).toBeGreaterThan(0)
    expect(model.connections.some((c) => c.from === duct.id || c.to === duct.id)).toBe(false)
    expect(model.systems.some((s) => s.memberIds.includes(duct.id))).toBe(false)
    expect(modelToTTL(model)).not.toContain(duct.id)
  })

  it('지운 것을 되돌리면 연결·계통 자리까지 제자리다', () => {
    const before = modelToTTL(model)
    const duct = equip('DUCT-01')
    const snapshot = snapshotEquipmentSet(model, duct.id)!
    deleteEquipment(model, duct.id)
    restore(model, snapshot)
    expect(modelToTTL(model)).toBe(before)
  })

  it('이름을 고치면 label 이 바뀌고, 연 때와 견주면 이름 줄에 뜬다', () => {
    const base = baselineOf(model)
    const ahu = equip('AHU-1')
    expect(renameEquipment(model, ahu.id, 'AHU-1A')).toBe(true)
    expect(modelToTTL(model)).toContain('rdfs:label "AHU-1A"')
    expect(diffBaseline(model, base).equipmentRenamed).toEqual([{ id: ahu.id, from: 'AHU-1', to: 'AHU-1A' }])
  })
})

describe('물리존 생성·삭제·분할·병합 (E3)', () => {
  const storeyId = () => model.storeys[0].id
  const office = () => model.storeys[0].spaces[0]

  it('만든 물리존에 설비가 소속을 찾는다 — 사무실 안에 만든 작은 방이 더 구체적인 자리다', () => {
    const done = createSpace(model, storeyId(), { name: '102', longName: '회의실', footprint: [[2, 3], [4, 3], [4, 5], [2, 5]] })!
    expect(done.created).toHaveLength(1)
    expect(equip('AT-101-01').spaceId).toBe(done.created[0])
    expect(done.equipment.map((c) => c.equipmentName)).toEqual(['AT-101-01'])
  })

  it('층에 하나 남은 물리존은 지우지 않는다', () => {
    expect(deleteSpace(model, office().id)).toEqual({ refused: expect.stringContaining('하나 남은') })
  })

  it('지운 방의 BIM 소속은 버리고 좌표로 다시 잰다', () => {
    const other = createSpace(model, storeyId(), { name: '102', longName: '창고', footprint: [[20, 0], [30, 0], [30, 8], [20, 8]] })!.created[0]
    const light = equip('LIGHT-101-01')
    expect(light.spaceSource).toBe('bim')
    deleteSpace(model, office().id)
    expect(model.storeys[0].spaces.map((s) => s.id)).toEqual([other])
    // (50,50) 은 창고 밖이다. 없는 방을 가리키지 않고 소속 없음이 된다.
    expect(light.spaceId).toBeNull()
    expect(light.spaceSource).toBeNull()
  })

  it('선으로 나누면 넓은 조각이 원래 id 를 갖고, 새 조각의 설비는 새 방으로 간다', () => {
    const id = office().id
    const done = splitSpace(model, id, [6, -1], [6, 9])
    expect(done && 'created' in done).toBe(true)
    if (!done || 'refused' in done) return
    const piece = model.storeys[0].spaces.find((s) => s.id === done.created[0])!
    expect(office().id).toBe(id)
    expect(office().areaM2).toBe(48)
    expect(piece.areaM2).toBe(32)
    expect(piece.longName).toBe('사무실-2')
    expect(equip('AT-101-01').spaceId).toBe(id)
    expect(equip('AT-101-02').spaceId).toBe(piece.id)
  })

  it('방을 안 지나는 선은 이유와 함께 거절한다', () => {
    expect(splitSpace(model, office().id, [20, 0], [20, 5])).toEqual({ refused: expect.any(String) })
  })

  it('나눈 것을 다시 합치면 원래 외곽선·넓이이고, 문은 남는 방을 가리킨다', () => {
    const id = office().id
    model.storeys[0].openings.push({ id: 'door', kind: 'door', name: '', width: null, height: null, wallId: null, passable: true, connects: [id] })
    const split = splitSpace(model, id, [6, -1], [6, 9])
    if (!split || 'refused' in split) throw new Error('split')
    model.storeys[0].openings[0].connects = [id, split.created[0]]
    const merged = mergeSpaces(model, id, split.created[0])
    if (!merged || 'refused' in merged) throw new Error('merge')
    expect(office().areaM2).toBe(80)
    expect(model.storeys[0].spaces).toHaveLength(1)
    expect(model.storeys[0].openings[0].connects).toEqual([id])
    expect(office().merged).toEqual([split.created[0]])
  })

  it('층 스냅숏으로 되돌리면 나누기 전과 같다', () => {
    const before = modelToTTL(model)
    const snapshot = snapshotStoreySpaces(model, storeyId())!
    splitSpace(model, office().id, [6, -1], [6, 9])
    restore(model, snapshot)
    expect(modelToTTL(model)).toBe(before)
  })
})

describe('벽·문·창 편집 (E4)', () => {
  const storey = () => model.storeys[0]
  const office = () => model.storeys[0].spaces[0]
  // 사무실(0..10 × 0..8) 오른쪽에 벽 하나(x=10, 두께 0.2)를 긋고, 그 너머에 창고를 둔다.
  const setup = () => {
    const wall = addWall(model, storey().id, [10.1, 0], [10.1, 8], 0.2) as Wall
    const store = createSpace(model, storey().id, { name: '102', longName: '창고', footprint: [[10.2, 0], [14, 0], [14, 8], [10.2, 8]] })!.created[0]
    return { wall, store }
  }

  it('두 점으로 벽을 그으면 두께만큼 편 외곽선이고, 내력 여부는 모른다', () => {
    const { wall } = setup()
    expect(polygonArea(wall.footprint![0])).toBeCloseTo(8 * 0.2)
    expect(wall.loadBearing).toBeNull()
    expect(wall.added).toBe(true)
  })

  it('문을 벽 가까이 놓으면 그 벽에 붙고, 양쪽 방을 좌표로 짚는다', () => {
    const { wall, store } = setup()
    const door = addOpening(model, storey().id, 'door', [10.1, 4]) as Opening
    expect(door.wallId).toBe(wall.id)
    expect(Math.abs(door.through![0])).toBeCloseTo(1)
    expect(new Set(door.connects)).toEqual(new Set([office().id, store]))
    expect(door.connectsSource).toBe('calc')
  })

  it('문·창은 뚫린 벽을 따라서만 옮기고, 벽 밖·벽 끝 너머로는 가지 않는다 (OE-OBJ-07)', () => {
    const { wall } = setup()
    const door = addOpening(model, storey().id, 'door', [10.12, 4]) as Opening
    door.width = 1
    // 벽(x=10.1, y 0..8) 쪽으로 비스듬히 밀면 길이 방향(y)만 따르고, 벽과의 옆 간격(x=10.12)은 그대로다.
    expect(moveOpening(model, door.id, [11.5, 5])).toBe(true)
    expect(door.position).toEqual([10.12, 5, 0])
    // 벽에 수직으로만 밀면 옮기지 않고 이유를 돌려준다.
    expect(moveOpening(model, door.id, [12, 5])).toEqual({ refused: OPENING_ALONG_WALL })
    // 벽 끝 너머로 밀면 가로(1m)의 절반이 벽 안에 남는 자리에서 멈추고, 이미 끝이면 이유를 돌려준다.
    expect(moveOpening(model, door.id, [10.1, 20])).toBe(true)
    expect(door.position![1]).toBeCloseTo(7.5)
    expect(moveOpening(model, door.id, [10.1, 9])).toEqual({ refused: expect.stringContaining('벽 끝') })
    expect(door.wallId).toBe(wall.id)
  })

  it('벽에서 먼 자리에는 놓지 않는다', () => {
    setup()
    expect(addOpening(model, storey().id, 'window', [5, 4])).toEqual({ refused: expect.stringContaining('벽에서') })
  })

  // OE-OBJ-07 수용 기준: 외벽 개구부 = 창, 내벽 개구부 = 문으로 나누지 않는다(#288). 실제 BIM 도 외벽에 현관문을 둔다.
  it.each([
    ['외벽', true],
    ['내벽', false],
    ['외벽 여부 모름', null],
  ] as const)('%s 에도 문과 창을 둘 다 놓는다', (_, external) => {
    const { wall } = setup()
    wall.external = external
    const door = addOpening(model, storey().id, 'door', [10.1, 2]) as Opening
    const window = addOpening(model, storey().id, 'window', [10.1, 6]) as Opening
    expect([door.kind, door.wallId]).toEqual(['door', wall.id])
    expect([window.kind, window.wallId]).toEqual(['window', wall.id])
  })

  it('벽을 옮기면 뚫린 문도 같이 가고, 잇는 방을 다시 짚는다', () => {
    const { wall } = setup()
    const door = addOpening(model, storey().id, 'door', [10.1, 4]) as Opening
    expect(moveWall(model, wall.id, [5, 0])).toBe(true)
    expect(door.position![0]).toBeCloseTo(15.1)
    // x=15.1 의 양쪽(14.x·15.x)에는 방이 없다.
    expect(door.connects).toEqual([])
  })

  it('방 경계를 고쳐도 좌표로 짚은 문이 잇는 방이 바뀐다', () => {
    const { store } = setup()
    const door = addOpening(model, storey().id, 'door', [10.1, 4]) as Opening
    // 창고를 문에서 멀리 민다.
    replaceSpaceFootprint(model, store, [[12, 0], [14, 0], [14, 8], [12, 8], [12, 0]])
    expect(door.connects).toEqual([office().id])
  })

  it('벽을 지우면 뚫린 문·창도 빠지고, 층 스냅숏으로 되돌리면 그대로다', () => {
    const { wall } = setup()
    addOpening(model, storey().id, 'door', [10.1, 4])
    addOpening(model, storey().id, 'window', [10.1, 1])
    const before = JSON.stringify(modelToGeoJSON(model))
    const snapshot = snapshotStoreyElements(model, storey().id)!
    expect(deleteWall(model, wall.id)).toEqual({ openings: 2 })
    expect(storey().openings).toHaveLength(0)
    restore(model, snapshot)
    expect(JSON.stringify(modelToGeoJSON(model))).toBe(before)
  })

  it('내력 여부를 고치고, 모름(null)으로도 되돌린다', () => {
    const { wall } = setup()
    expect(setWallLoadBearing(model, wall.id, true)).toBe(true)
    expect(setWallLoadBearing(model, wall.id, null)).toBe(true)
    expect(wall.loadBearing).toBeNull()
  })

  // OE-OBJ-06. 잠그는 것은 true 뿐이다 — 모름(null)까지 잠그면 내력 속성이 없는 파일의 벽을 하나도 못 고친다.
  it('내력벽은 옮기거나 지우지 못하고, 거기 뚫린 문·창도 그렇다. 모름은 잠그지 않는다', () => {
    const { wall } = setup()
    const door = addOpening(model, storey().id, 'door', [10.1, 4]) as Opening
    setWallLoadBearing(model, wall.id, true)
    const before = JSON.stringify(modelToGeoJSON(model))
    expect(wallLocked(wall)).toBe(true)
    expect(moveWall(model, wall.id, [1, 0])).toBe(false)
    expect(moveWallWithSpaces(model, wall.id, [1, 0])).toBeNull()
    expect(deleteWall(model, wall.id)).toBeNull()
    expect(moveOpening(model, door.id, [10.1, 5])).toBe(false)
    expect(deleteOpening(model, door.id)).toBe(false)
    expect(addOpening(model, storey().id, 'window', [10.1, 1])).toEqual({ refused: expect.stringContaining('내력벽') })
    expect(JSON.stringify(modelToGeoJSON(model))).toBe(before)
    // 내력 여부를 고치면 풀린다. 모름은 내벽 규칙이다.
    setWallLoadBearing(model, wall.id, null)
    expect(wallLocked(wall)).toBe(false)
    expect(moveOpening(model, door.id, [10.1, 5])).toBe(true)
    expect(moveWall(model, wall.id, [1, 0])).toBe(true)
  })

  // OE-OBJ-05. 끝을 맞대는 것(L·T)은 되고, 몸통을 가로지르는 것(X)은 안 된다.
  it('벽은 다른 벽을 가로질러 긋지 못하고, 끝을 맞대거나 안으로 조금 들이는 것은 된다', () => {
    const { wall } = setup()
    // T: 끝이 벽 면에 닿는다 / 벽 중심선까지 들어온다 / 반 두께 + 5cm 안에서 넘는다.
    expect(addWall(model, storey().id, [5, 4], [10, 4])).toMatchObject({ id: expect.any(String) })
    expect(addWall(model, storey().id, [5, 6], [10.1, 6])).toMatchObject({ id: expect.any(String) })
    expect(addWall(model, storey().id, [5, 7], [10.24, 7])).toMatchObject({ id: expect.any(String) })
    // X: 반대쪽으로 빠져나간다.
    expect(addWall(model, storey().id, [5, 2], [12, 2])).toEqual({ refused: expect.stringContaining('가로지릅니다') })
    // L: 모서리에서 만난다.
    expect(addWall(model, storey().id, [10.1, 8], [14, 8])).toMatchObject({ id: expect.any(String) })
    expect(wallsCrossed(storey(), wall.footprint!, wall.id)).toEqual([])
  })

  it('옮겨서 새로 가로지르게 되면 옮기지 않고, 원래 가로지르던 벽은 옮길 수 있다', () => {
    const { wall } = setup()
    const stem = addWall(model, storey().id, [5, 4], [10, 4]) as Wall
    // 줄기를 벽 쪽으로 30cm 밀면 벽을 뚫고 나간다.
    expect(moveWall(model, stem.id, [0.3, 0])).toBe(false)
    expect(newCrossing(model, stem.id, stem.footprint!.map((r) => r.map(([x, y]) => [x + 0.3, y] as Vec2)))?.id).toBe(wall.id)
    // BIM 이 이미 가로지르게 그린 벽(여기서는 편집 파일이 얹은 것처럼 바로 둔다)은 다른 방향으로 옮길 수 있다.
    insertWall(model, storey().id, { id: 'X', name: 'BIM 관통벽', thickness: 0.2, loadBearing: null, footprint: [[[9, 1.9], [12, 1.9], [12, 2.1], [9, 2.1], [9, 1.9]]] })
    expect(wallsCrossed(storey(), wall.footprint!, wall.id).map((w) => w.id)).toEqual(['X'])
    expect(moveWall(model, 'X', [0, 0.5])).toBe(true)
  })

  it('직사각형 벽은 가운데를 두고 길이를 바꾸고, 문이 밖으로 나가거나 다른 벽을 뚫게 되면 바꾸지 않는다', () => {
    const { wall } = setup()
    expect(wallLength(wall)).toBeCloseTo(8)
    expect(setWallLength(model, wall.id, 6)).toBe(true)
    expect(wallLength(wall)).toBeCloseTo(6)
    const ys = wall.footprint![0].map((p) => p[1])
    expect([Math.min(...ys), Math.max(...ys)].map((v) => +v.toFixed(6))).toEqual([1, 7])
    addOpening(model, storey().id, 'door', [10.1, 6.5])
    expect(setWallLength(model, wall.id, 4)).toEqual({ refused: expect.stringContaining('벽 밖으로') })
    // 가로로 지나는 벽까지 늘이면 뚫는다.
    addWall(model, storey().id, [8, 8.5], [12, 8.5])
    expect(setWallLength(model, wall.id, 9)).toBe(true)
    expect(setWallLength(model, wall.id, 12)).toEqual({ refused: expect.stringContaining('가로지릅니다') })
    setWallLoadBearing(model, wall.id, true)
    expect(setWallLength(model, wall.id, 8)).toEqual({ refused: WALL_LOCKED })
  })

  // OE-OBJ-07. 자리(가운데)는 두고 가로·세로만 바꾼다.
  it('문·창 가로·세로를 바꾸고, 벽 끝을 넘거나 범위 밖이거나 내력벽이면 바꾸지 않는다', () => {
    const { wall } = setup()
    const base = baselineOf(model)
    const win = addOpening(model, storey().id, 'window', [10.1, 2]) as Opening
    const snap = snapshotStoreyElements(model, storey().id)!
    expect(setOpeningSize(model, win.id, { width: 1.2, height: 1.5 })).toBe(true)
    restore(model, snap)
    expect([win.width, win.height]).toEqual([null, null])
    expect(setOpeningSize(model, win.id, { width: 1.2, height: 1.5 })).toBe(true)
    expect([win.width, win.height, win.position![1]]).toEqual([1.2, 1.5, 2])
    // 벽은 y 0..8, 창 가운데 y=2 → 가로 4 를 넘으면 벽 끝을 넘는다.
    expect(setOpeningSize(model, win.id, { width: 4.2 })).toEqual({ refused: expect.stringContaining('벽 끝') })
    expect(setOpeningSize(model, win.id, { height: 0 })).toEqual({ refused: expect.stringContaining('0.1m') })
    expect(setOpeningSize(model, win.id, { width: 1.2 })).toBe(false)
    setWallLoadBearing(model, wall.id, true)
    expect(setOpeningSize(model, win.id, { width: 1 })).toEqual({ refused: WALL_LOCKED })
    // 더한 창이라 "옮김·크기" 가 아니라 더한 것으로만 뜬다.
    expect(diffBaseline(model, base).openingsAdded.map((o) => o.id)).toEqual([win.id])
  })

  it('연 때와 견주면 더한 벽·옮긴 문이 뜨고, 지운 벽의 문은 따로 세지 않는다', () => {
    const { wall } = setup()
    const door = addOpening(model, storey().id, 'door', [10.1, 4]) as Opening
    const base = baselineOf(model)
    moveOpening(model, door.id, [10.1, 5])
    expect(diffBaseline(model, base).openingsMoved.map((o) => o.id)).toEqual([door.id])
    deleteWall(model, wall.id)
    const diff = diffBaseline(model, base)
    expect(diff.wallsRemoved.map((w) => w.id)).toEqual([wall.id])
    expect(diff.openingsRemoved).toEqual([])
  })
})

describe('계통 편집 (E8)', () => {
  const water = () => {
    model.systems.push({ id: 'W1', name: '순환수 공급', memberIds: [], source: 'ifc', kind: 'hydronic_supply', fluid: null })
    return model.systems.at(-1)!
  }

  it('설비를 다른 계통으로 옮기면 두 계통의 구성원과 TTL 이 바뀌고, 제자리로 돌리면 편집 표시가 지워진다', () => {
    const w = water()
    const ahu = equip('AHU-1')
    const from = ahu.systemId!
    expect(from).toBe(model.systems[0].id)
    const rules = setEquipmentSystem(model, ahu.id, 'W1')
    expect(rules).not.toBe(null)
    expect(ahu.systemId).toBe('W1')
    expect(ahu.systemEdited).toEqual({ from })
    expect(model.systems[0].memberIds).not.toContain(ahu.id)
    expect(w.memberIds).toEqual([ahu.id])
    expect(modelToTTL(model)).toContain(`W1 a brick:Water_System ;
    ex:systemKind "hydronic_supply" ;
    brick:hasPart ex:${ahu.id.replaceAll('$', '\\$')} ;`)

    expect(setEquipmentSystem(model, ahu.id, 'W1')).toBe(null) // 이미 거기다
    expect(setEquipmentSystem(model, ahu.id, 'no-such')).toBe(null)
    setEquipmentSystem(model, ahu.id, from)
    expect(ahu.systemEdited).toBeUndefined()
    expect(w.memberIds).toEqual([])
  })

  it('공기·물 계통에 다 든 공조기의 주 계통을 이미 든 물 계통으로 옮겨도 구성원이 두 번 적히지 않고, 되돌리면 두 자리가 다 돌아온다', () => {
    const w = water()
    const ahu = equip('AHU-1')
    const air = model.systems[0]
    // 공조기는 냉수 코일로 물 계통에도 들어 있다(주 계통은 급기).
    w.memberIds.push('0MEP$Equip$X', ahu.id)
    const opened = modelToTTL(model)
    const snap = snapshotSystems(model, [ahu.systemId, 'W1'], [ahu.id])
    setEquipmentSystem(model, ahu.id, 'W1')
    expect(w.memberIds.filter((m) => m === ahu.id)).toHaveLength(1)
    expect(air.memberIds).not.toContain(ahu.id)
    restore(model, snap)
    expect(modelToTTL(model)).toBe(opened)
    expect(w.memberIds).toEqual(['0MEP$Equip$X', ahu.id])
  })

  it('계통을 옮긴 설비를 지웠다가 되돌리면 옮긴 계통으로 돌아오고, 한 번 더 되돌리면 원래 계통의 원래 자리다', () => {
    water()
    const ahu = equip('AHU-1')
    const air = model.systems[0]
    const at = air.memberIds.indexOf(ahu.id)
    const opened = modelToTTL(model) + JSON.stringify(modelToGeoJSON(model))
    const s1 = snapshotSystems(model, [ahu.systemId, 'W1'], [ahu.id])
    setEquipmentSystem(model, ahu.id, 'W1')
    const s2 = snapshotEquipmentSet(model, ahu.id)!
    deleteEquipment(model, ahu.id)
    restore(model, s2)
    expect(equip('AHU-1').systemId).toBe('W1')
    expect(model.systems.at(-1)!.memberIds).toEqual([ahu.id])
    restore(model, s1)
    expect(air.memberIds.indexOf(ahu.id)).toBe(at)
    expect(modelToTTL(model) + JSON.stringify(modelToGeoJSON(model))).toBe(opened)
  })

  it('확정한 계통에서 덕트를 빼도 확정한 방향은 그대로 나가고, 그 덕트의 연결을 다른 계통이 가로채지 않는다', () => {
    water()
    inferFlowByRules(model)
    const system = model.systems[0].id
    const ruled = model.connections.filter((c) => c.inferred?.systemId === system)
    expect(ruled.length).toBeGreaterThan(0)
    confirmSystemFlow(model, system)
    const before = withInferred(model.connections, true).map((c) => `${c.from}>${c.to}`)
    const duct = ruled[0].from === equip('AHU-1').id ? ruled[0].to : ruled[0].from
    setEquipmentSystem(model, duct, 'W1')
    expect(withInferred(model.connections, true).map((c) => `${c.from}>${c.to}`)).toEqual(before)
    expect(ruled[0].inferred).toMatchObject({ systemId: system, confirmed: true })
  })

  it('계통 종류와 유체를 정하면 TTL 계통 클래스가 유체 클래스가 되고, 순환수가 아니면 유체를 버린다', () => {
    water()
    setSystemKind(model, 'W1', 'hydronic_supply', 'chilled')
    expect(model.systems.at(-1)!.fluid).toBe('chilled')
    expect(modelToTTL(model)).toContain('W1 a brick:Chilled_Water_System ;')
    expect(model.systems.at(-1)!.kindEdited).toEqual({ kind: 'hydronic_supply', fluid: null })

    setSystemKind(model, 'W1', 'supply_air', 'hot')
    expect(model.systems.at(-1)!.fluid).toBe(null)
    expect(modelToTTL(model)).toContain('W1 a brick:Air_System ;')

    expect(setSystemKind(model, 'W1', 'no_such_kind')).toBe(null)
    setSystemKind(model, 'W1', 'hydronic_supply', null)
    expect(model.systems.at(-1)!.kindEdited).toBeUndefined()
  })

  it('되돌리면 구성원 순서와 종류·유체까지 연 때와 같다', () => {
    water()
    const opened = modelToTTL(model) + JSON.stringify(modelToGeoJSON(model))
    const ahu = equip('AHU-1')
    const s1 = snapshotSystems(model, [ahu.systemId, 'W1'], [ahu.id])
    setEquipmentSystem(model, ahu.id, 'W1')
    const s2 = snapshotSystems(model, ['W1'])
    setSystemKind(model, 'W1', 'hydronic_return', 'hot')
    // 다시 하기용으로 뜬 것이 지금 상태를 담는다.
    const redo = snapshotOf(model, s2)!
    restore(model, s2)
    restore(model, redo)
    expect(model.systems.at(-1)!.fluid).toBe('hot')
    restore(model, s2)
    restore(model, s1)
    expect(modelToTTL(model) + JSON.stringify(modelToGeoJSON(model))).toBe(opened)
    expect(ahu.systemEdited).toBeUndefined()
  })
})

describe('벽과 함께 방 경계 옮기기', () => {
  const sq = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
  const room = (id: string, footprint: Vec2[]) => ({ id, name: id, longName: id, footprint, areaM2: polygonArea(footprint), boundedBy: [] })
  /** x=5 에 두께 0.2 벽(4.9..5.1, y 0..6). 왼쪽 방은 벽 면까지, 오른쪽 방은 벽 중심선까지 그렸다(Revit 에 둘 다 있다). */
  const plan = (): Model => ({
    schema: 'IFC4', siteName: '', buildingId: 'B', buildingName: '', systems: [], connections: [], warnings: [],
    storeys: [{
      id: 'S', name: '1F', elevation: 0, openings: [], equipment: [],
      walls: [{ id: 'W', name: 'W', thickness: 0.2, loadBearing: null, footprint: [sq(4.9, 0, 5.1, 6)] }],
      spaces: [room('face', sq(0, 0, 4.9, 6)), room('center', sq(5, 0, 10, 6)), room('far', sq(20, 0, 25, 6))],
    }],
  })
  const xs = (m: Model, id: string) => [...new Set(m.storeys[0].spaces.find((s) => s.id === id)!.footprint.map((p) => +p[0].toFixed(6)))].sort((a, b) => a - b)

  it('벽 면에 붙인 방도, 중심선까지 그린 방도 벽과의 간격을 그대로 두고 따라오고, 먼 방은 그대로다', () => {
    const m = plan()
    const done = moveWallWithSpaces(m, 'W', [0.3, 0])!
    expect(xs(m, 'face')).toEqual([0, 5.2]) // 면(5.2)에 붙은 채
    expect(xs(m, 'center')).toEqual([5.3, 10]) // 중심선(5.3)에 붙은 채 — 면에 끌어 붙이면 5.4 가 된다
    expect(xs(m, 'far')).toEqual([20, 25])
    expect(done.changes.map((c) => [c.spaceId, +(c.toAreaM2 - c.fromAreaM2).toFixed(6)])).toEqual([['face', 1.8], ['center', -1.8]])
  })

  it('벽 길이 방향으로 밀면 방은 미끄러지지 않는다', () => {
    const m = plan()
    moveWallWithSpaces(m, 'W', [0, 0.5])
    expect(m.storeys[0].spaces.map((s) => polygonArea(s.footprint))).toEqual(plan().storeys[0].spaces.map((s) => polygonArea(s.footprint)))
  })

  it('벽이 방 변의 가운데에서 끝나면 그 변은 반만 끌려가지 않고 그대로다', () => {
    const m = plan()
    // 벽을 y 0..3 으로 줄인다. 왼쪽 방의 오른쪽 변(y 0..6)은 벽 끝을 넘어 이어지고, Revit 외곽선처럼 변 중간(y 2)에 한 줄 위
    // 꼭짓점이 있다. 벽 옆 조각(y 0..2)만 끌려가면 변이 꺾인다(병원 외벽에서 이렇게 됐다).
    m.storeys[0].walls[0].footprint = [sq(4.9, 0, 5.1, 3)]
    const jogged: Vec2[] = [[0, 0], [4.9, 0], [4.9, 2], [4.9, 6], [0, 6], [0, 0]]
    m.storeys[0].spaces[0] = room('face', jogged)
    moveWallWithSpaces(m, 'W', [0.3, 0])
    expect(m.storeys[0].spaces[0].footprint).toEqual(jogged)
  })

  it('방향키로 다섯 걸음 나갔다 돌아오면 방이 제자리이고, 걸음 사이에 방 꼭짓점을 넣어도 엉뚱한 꼭짓점을 옮기지 않는다', () => {
    const m = plan()
    let p: WallCarryPlan | null = null
    for (let k = 0; k < 5; k++) p = moveWallWithSpaces(m, 'W', [0.1, 0], p)!.plan
    for (let k = 0; k < 5; k++) p = moveWallWithSpaces(m, 'W', [-0.1, 0], p)!.plan
    expect(m.storeys[0].spaces.map((s) => s.footprint.map((q) => q.map((v) => +v.toFixed(9))))).toEqual(plan().storeys[0].spaces.map((s) => s.footprint))

    // 계획을 세운 뒤 왼쪽 방 첫 변(바닥)에 꼭짓점을 넣으면 번호가 하나씩 밀린다. 옛 번호로 옮기면 바닥 한가운데가 끌려간다.
    p = moveWallWithSpaces(m, 'W', [0.1, 0], p)!.plan
    insertSpaceVertex(m, 'face', 0)
    moveWallWithSpaces(m, 'W', [0.1, 0], p)
    expect(xs(m, 'face')).toEqual([0, 2.5, 5.1]) // 넣은 꼭짓점(2.5)은 그대로, 오른쪽 변만 5.1
  })

  it('한 번에 되돌리면 벽과 방이 같이 돌아온다', () => {
    const m = plan()
    const snap: Snapshot = { kind: 'many', parts: [snapshotStoreyElements(m, 'S')!, snapshotStoreySpaces(m, 'S')!] }
    moveWallWithSpaces(m, 'W', [0.3, 0])
    restore(m, snap)
    expect(m).toEqual(plan())
  })
})

describe('계통 만들기·지우기 (E8)', () => {
  it('지운 계통이 주 계통이던 설비는 자기가 든 다른 계통으로 가고, 되돌리면 계통 목록 자리(색)까지 돌아온다', () => {
    model.systems.push({ id: 'W1', name: '순환수 공급', memberIds: [], source: 'ifc', kind: 'hydronic_supply', fluid: null })
    const ahu = equip('AHU-1')
    const air = model.systems[0]
    model.systems[1].memberIds.push(ahu.id) // 냉수 코일로 물 계통에도 든다
    const opened = modelToTTL(model) + JSON.stringify(modelToGeoJSON(model))
    const members = model.storeys.flatMap((s) => s.equipment).filter((e) => e.systemId === air.id).map((e) => e.id)
    const snap = snapshotSystems(model, [air.id], members, true)
    deleteSystem(model, air.id)
    expect(ahu.systemId).toBe('W1')
    expect(equip('AT-101-01').systemId).toBe(null)
    expect(modelToTTL(model)).not.toContain(air.id.replace(/\$/g, '\$') + ' a ')
    restore(model, snap)
    expect(model.systems.map((s) => s.id)).toEqual([air.id, 'W1'])
    expect(modelToTTL(model) + JSON.stringify(modelToGeoJSON(model))).toBe(opened)
  })

  it('사람이 만든 계통의 유체는 원천 짐작이 덮지 않는다', () => {
    const w = createSystem(model, { name: '냉수 3', kind: 'hydronic_supply', fluid: 'hot' })!
    inferFlowByRules(model)
    expect(w.fluid).toBe('hot')
    expect(createSystem(model, { name: 'x', kind: 'no_such' })).toBe(null)
  })
})

describe('경계를 고친 뒤의 소속 — 바뀔 수 있는 설비만 다시 재도 층 전부를 다시 잰 것과 같다', () => {
  // 방 하나를 고치면 그 방 소속이던 설비와 새 경계 근처의 설비만 다시 판정한다(reassignStoreyWith). 빠뜨리면 경계 밖으로 나간
  // 설비가 예전 방에 남거나, 새로 들어온 설비가 소속 없음으로 남는다. 편집마다 층 전부를 다시 잰 답과 대 본다.
  let seed = 11
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const rect = (x: number, y: number, w: number, h: number): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]

  it('꼭짓점 옮기기·경계 갈아 끼우기·되돌리기 150번', () => {
    const spaces = []
    for (let i = 0; i < 12; i++) {
      const fp = rect((i % 4) * 4.24, Math.floor(i / 4) * 4.24, 4, 4)
      spaces.push({ id: `r${i}`, name: `r${i}`, longName: '', footprint: fp, areaM2: polygonArea(fp), boundedBy: [] })
    }
    // 큰 방 하나가 여럿을 품는다(병원 대기실처럼 겹친다).
    const hall = rect(2, 2, 9, 6)
    spaces.push({ id: 'hall', name: 'hall', longName: '', footprint: hall, areaM2: polygonArea(hall), boundedBy: [] })
    const equipment = Array.from({ length: 600 }, (_, i) => {
      // 셋 중 하나는 벽면(외곽선 위·SNAP 근처)에 둔다. 판정이 갈리는 자리다.
      const onWall = i % 3 === 0
      const x = onWall ? Math.round(rand() * 4) * 4.24 + (rand() - 0.5) * 0.12 : rand() * 17
      const y = rand() * 13
      return { id: `e${i}`, name: `e${i}`, ifcClass: 'IfcFlowTerminal', role: null, position: [x, y, 0.5] as const, capacity: null, capacityProperty: null, systemId: null, spaceId: null, spaceSource: null }
    })
    const m = {
      schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: 'b', systems: [], connections: [], warnings: [],
      storeys: [{ id: 's', name: '1F', elevation: 0, spaces, walls: [], openings: [], equipment }],
    } as unknown as Model
    assignEquipmentToSpaces(m)
    const membership = (x: Model) => x.storeys[0].equipment.map((e) => `${e.id}:${e.spaceId}`)
    let moved = 0
    for (let step = 0; step < 150; step++) {
      const sp = m.storeys[0].spaces[Math.floor(rand() * m.storeys[0].spaces.length)]
      const op = step % 3
      const undo = snapshotSpace(m, sp.id)!
      if (op === 0) {
        const [x, y] = sp.footprint[1]
        moveSpaceVertex(m, sp.id, 1, [x + (rand() - 0.5) * 6, y + (rand() - 0.5) * 6])
      } else if (op === 1) {
        replaceSpaceFootprint(m, sp.id, rect(rand() * 14, rand() * 10, 1 + rand() * 6, 1 + rand() * 6))
      } else {
        moveSpaceVertex(m, sp.id, 2, [rand() * 17, rand() * 13])
        restore(m, undo)
      }
      const full = structuredClone(m)
      assignEquipmentToSpaces(full)
      expect(membership(m)).toEqual(membership(full))
      moved++
    }
    expect(moved).toBe(150)
  })
})
