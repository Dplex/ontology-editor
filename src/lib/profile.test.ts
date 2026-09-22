import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { mergeModels } from './merge'
import { profileOf, type Profile } from './profile'

let api: WebIFC.IfcAPI
const read = (name: string) =>
  importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))

beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

/** 칸을 [키, 칠, 칩 숫자] 로. 칸이 어떻게 보이는지만 본다. */
const shown = (p: Profile) => p.tiers.map((t) => [t.key, t.level, t.figure])

describe('profileOf — 파일이 온톨로지를 어디까지 채우나', () => {
  it('건축 파일은 공간만 차고, 설비 칸은 해당 없음(—)이다', () => {
    const p = profileOf(read('two-rooms.ifc'))
    // 창고는 외곽선이 없어 3개 중 2개다. 다 차지 않은 칸은 분수로 보인다.
    expect(shown(p)).toEqual([
      ['space', 'partial', '2/3'],
      ['equipment', 'none', '—'],
      ['location', 'none', '—'],
      ['network', 'none', '—'],
      ['direction', 'none', '—'],
    ])
    expect(p.needsEquipment).toBe(true)
    expect(p.needsArchitecture).toBe(false)
  })

  it('설비 파일은 칸마다 빠진 만큼 분수로 보인다', () => {
    const p = profileOf(read('mep.ifc'))
    // 좌표 없는 센서 하나가 설비·소속 칸을 4/5 로 만든다. 방향은 연결이 아니라 **기기**로 센다 —
    // 덕트로 다른 기기와 이어진 기기 셋(공조기, 토출구 둘) 중 흐름 방향으로 이어진 것은 공조기와
    // 첫 토출구 둘이다. 둘째 토출구는 SOURCEANDSINK 포트라 방향을 모른다.
    expect(shown(p)).toEqual([
      ['space', 'full', '1'],
      ['equipment', 'partial', '4/5'],
      ['location', 'partial', '4/5'],
      ['network', 'full', '3'],
      ['direction', 'partial', '2/3'],
    ])
    // 도관은 분모에 넣지 않는다. 기기 5대(덕트 1개는 따로)다.
    expect(p.tiers[1].of).toBe(5)
    expect(p.tiers[1].note).toContain('덕트·배관 1개는 따로')
  })

  it('방 없이 설비만 있는 파일은 건축 파일과 합칠 짝이라고 말한다', () => {
    const m = read('mep.ifc')
    for (const s of m.storeys) s.spaces = []
    for (const e of m.storeys.flatMap((s) => s.equipment)) {
      e.spaceId = null
      e.spaceSource = null
    }
    const p = profileOf(m)
    expect(p.needsArchitecture).toBe(true)
    expect(p.tiers[2]).toMatchObject({ level: 'none', figure: '0/5' })
    expect(p.tiers[2].note).toContain('건축 파일과 합쳐야')
  })

  it('합친 모델에도 같은 계산이 돈다', () => {
    const { model } = mergeModels(read('two-rooms.ifc'), read('mep.ifc'))
    // 회의실·복도(two-rooms) + 사무실(mep). 창고는 여전히 외곽선이 없다.
    expect(profileOf(model).tiers[0]).toMatchObject({ have: 3, of: 4, figure: '3/4' })
  })
})
