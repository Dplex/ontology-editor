import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { moveEquipment, moveEquipmentToStorey, renameSpace, summarize, type Change } from './edit'
import type { Model } from './model'

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
