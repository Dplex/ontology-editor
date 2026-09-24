import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import {
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
  type Change,
} from './edit'
import type { Model } from './model'
import { confirmSystemFlow, inferFlowByRules, withInferred } from './flow-rules'
import { assignEquipmentToSpaces } from './mapping'
import { modelToTTL } from './export/ttl'

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
    expect(diffBaseline(model, base)).toEqual({ renamed: [], moved: [], restoreyed: [] })
  })

  it('소속이 바뀐 이동은 좌표 줄에 넣지 않는다(Change 가 적는다)', () => {
    const base = baselineOf(model)
    moveEquipment(model, equip('AHU-1').id, [50, 50, 1])
    expect(diffBaseline(model, base).moved).toEqual([])
  })
})
