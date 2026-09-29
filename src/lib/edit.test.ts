import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import {
  assignKind,
  kindGroups,
  moveEquipment,
  moveEquipmentToStorey,
  moveSpaceVertex,
  renameSpace,
  replaceSpaceFootprint,
  summarize,
  type Change,
} from './edit'
import type { Equipment, Model } from './model'

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

describe('층 이동', () => {
  it('층은 좌표가 아니라 사람이 고른다', () => {
    // mep.ifc 는 층이 하나뿐이라 같은 층으로 옮겨도 동작만 확인한다.
    const change = moveEquipmentToStorey(model, equip('AHU-1').id, model.storeys[0].id)!
    expect(change.summary).toContain('1F 층으로')
    expect(model.storeys[0].equipment.filter((e) => e.name === 'AHU-1')).toHaveLength(1)
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

describe('종류 지정', () => {
  const eqOf = (id: string, name: string, role: Equipment['role'] = 'terminal', kind: string | null = null): Equipment => ({
    id,
    name,
    ifcClass: 'BuildingElementProxy',
    kind,
    role,
    position: null,
    capacity: null,
    capacityProperty: null,
    systemId: null,
    spaceId: null,
    spaceSource: null,
  })
  const m = (): Model => ({
    schema: 'IFC2X3',
    siteName: '',
    buildingId: 'b',
    buildingName: '',
    storeys: [
      {
        id: 's',
        name: '1F',
        elevation: 0,
        spaces: [],
        walls: [],
        openings: [],
        equipment: [
          eqOf('a', 'VAV:Type1:101'),
          eqOf('b', 'VAV:Type1:102'),
          eqOf('c', 'Mystery:X:103'),
          eqOf('d', 'FCU3:FCU3:104', 'conversion', 'fcu'), // 사전이 안다
          eqOf('e', 'Duct:D:105', 'segment'), // 덕트는 묻지 않는다
        ],
      },
    ],
    systems: [],
    connections: [],
    warnings: [],
  })

  it('사전이 모르는 기기만 패밀리:타입으로 묶고, 요소 ID 끝자리는 뗀다', () => {
    const groups = kindGroups(m())
    expect(groups.map((g) => [g.family, g.ids])).toEqual([
      ['VAV:Type1', ['a', 'b']],
      ['Mystery:X', ['c']],
    ])
  })

  it('정하면 기기에 편집으로 붙고, 지우면 사전 값으로 돌아간다. 정한 기기도 묶음에 남아 바꿀 수 있다', () => {
    const model = m()
    expect(assignKind(model, 'a', 'vav', null)).toEqual({ before: null, after: 'vav' })
    const a = model.storeys[0].equipment[0]
    expect(a).toMatchObject({ kind: 'vav', kindSource: 'edit' })
    // 묶음 안에서 하나만 정했으면 묶음 전체의 값은 없다.
    expect(kindGroups(model)[0]).toMatchObject({ family: 'VAV:Type1', assigned: null })
    assignKind(model, 'b', 'vav', null)
    expect(kindGroups(model)[0].assigned).toBe('vav')
    assignKind(model, 'a', null, null)
    expect(a.kind).toBe(null)
    expect(a.kindSource).toBeUndefined()
  })
})
