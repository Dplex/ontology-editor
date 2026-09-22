import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { lengthScale } from './units'
import { importIfc } from './import'
import { countOf } from '../model'

async function scaleOfFixture(name: string) {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  const model = api.OpenModel(new Uint8Array(readFileSync(path)))
  try {
    return lengthScale(api, model)
  } finally {
    api.CloseModel(model)
  }
}

describe('lengthScale', () => {
  it('미터로 선언된 모델은 배수가 1 이다', async () => {
    expect(await scaleOfFixture('two-rooms.ifc')).toEqual({ scale: 1, found: true })
  }, 60_000)

  it('밀리미터로 선언된 모델은 배수가 0.001 이다', async () => {
    // 실제 모델에서 나온다. NBU_Duplex-Apt_Eng-HVAC 이 밀리미터다.
    expect(await scaleOfFixture('millimetre.ifc')).toEqual({ scale: 0.001, found: true })
  }, 60_000)

  it('피트로 선언된 모델은 환산 계수를 따라간다', async () => {
    // NBU_Duplex-Apt_Eng-MEP-1 이 피트다. 0.3048 이 파일 안에 적혀 있다.
    const { scale, found } = await scaleOfFixture('foot.ifc')
    expect(found).toBe(true)
    expect(scale).toBeCloseTo(0.3048, 10)
  }, 60_000)
})

// --- 단위가 달라도 결과는 같아야 한다 -----------------------------------------
//
// millimetre.ifc 와 foot.ifc 는 two-rooms.ifc 와 **같은 건물**을 다른 단위로 적은 것이다.
// 그러니 임포트 결과가 셋 다 같아야 한다. 단위를 안 읽으면 밀리미터 판본의 방이 4,000m 짜리가
// 되는데, 파싱은 성공하고 개수도 맞아서 이 비교 없이는 알아채기 어렵다.
describe('단위가 달라도 같은 건물이다', () => {
  async function importFixture(name: string) {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
    return importIfc(api, new Uint8Array(readFileSync(path)))
  }

  it('밀리미터 판본이 미터 판본과 같은 값을 준다', async () => {
    const metre = await importFixture('two-rooms.ifc')
    const milli = await importFixture('millimetre.ifc')

    expect(countOf(milli)).toEqual(countOf(metre))
    expect(milli.storeys.map((s) => s.elevation)).toEqual([0, 3])

    const meeting = milli.storeys[0].spaces.find((s) => s.name === '101')!
    expect(meeting.areaM2).toBeCloseTo(12, 6)
    expect(meeting.footprint[0][0]).toBeCloseTo(2, 6)
    expect(meeting.footprint[0][1]).toBeCloseTo(1, 6)
  }, 60_000)

  it('피트 판본도 같은 값을 준다', async () => {
    const foot = await importFixture('foot.ifc')

    // 피트 판본은 픽스처를 만들 때 유효숫자 여섯 자리로 환산했다. 되돌리면 소수점 아래로
    // 오차가 남는 것이 정상이고, 밀리미터 판본처럼 딱 떨어지지는 않는다.
    expect(foot.storeys[0].elevation).toBeCloseTo(0, 6)
    expect(foot.storeys[1].elevation).toBeCloseTo(3, 6)

    const meeting = foot.storeys[0].spaces.find((s) => s.name === '101')!
    expect(meeting.areaM2).toBeCloseTo(12, 4)
    expect(meeting.footprint[0][0]).toBeCloseTo(2, 4)

    // 회전이 있는 방도 맞아야 한다. 환산을 변환 뒤에 하면 여기서 틀어진다.
    const corridor = foot.storeys[0].spaces.find((s) => s.name === '102')!
    expect(corridor.footprint[1][0]).toBeCloseTo(10, 4)
    expect(corridor.footprint[1][1]).toBeCloseTo(2, 4)
  }, 60_000)
})
