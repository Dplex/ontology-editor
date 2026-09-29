import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { mergeModels } from './merge'
import { partnerOf, profileOf, type Profile } from './profile'

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
    expect(p.tiers[1].note).toContain('덕트·배관 1개는 제외')
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

describe('partnerOf — 건축·설비 짝 파일 권하기', () => {
  // 같은 건물이면 범위가 거의 같다(병원 건축·HVAC 겹침 0.95). 다른 건물은 extent 를 따로 준다.
  const here: [number, number, number, number] = [-52, -9.6, 0.2, 56.3]
  const arch = (devices = 0, extent = here): Profile => ({ ...fake, spaces: 934, devices, needsArchitecture: false, needsEquipment: devices === 0, extent })
  const mech = (spaces = 0, extent = here): Profile => ({ ...fake, spaces, devices: 3472, needsArchitecture: spaces === 0, needsEquipment: false, extent })
  const fake: Profile = { schema: 'IFC2X3', storeys: 19, spaces: 0, devices: 0, conduits: 0, systems: 0, connections: 0, tiers: [], needsArchitecture: false, needsEquipment: false }

  it('성수처럼 한 폴더에 건축·기계 한 쌍이면 서로를 권한다 — 건축 파일에 조명 몇 대가 섞여 있어도', () => {
    const files = [
      { path: '성수/Factorial_건축.ifc', profile: arch(41) },
      { path: '성수/Factorial_기계.ifc', profile: mech() },
      { path: 'AC20-FZK-Haus.ifc', profile: arch() },
    ]
    expect(partnerOf('성수/Factorial_기계.ifc', files)).toBe('성수/Factorial_건축.ifc')
    expect(partnerOf('성수/Factorial_건축.ifc', files)).toBe('성수/Factorial_기계.ifc')
    // 다른 폴더의 건축 파일은 짝이 아니다(좌표계가 달라 합치면 숫자만 틀린다).
    expect(partnerOf('AC20-FZK-Haus.ifc', files)).toBe(null)
  })

  it('한 폴더에 있어도 다른 건물이면 권하지 않는다 — 작은 주택이 큰 설비 모델 범위 안에 들어도', () => {
    // data/ 바로 아래의 AC20 주택(11×9m)과 ifc4Mep(41×22m, 다른 건물). 합치면 오류 없이 층 짝이 지어지고 숫자만 틀린다.
    const files = [
      { path: 'AC20-FZK-Haus.ifc', profile: arch(0, [0.3, 0.3, 11.7, 9.7]) },
      { path: 'ifc4Mep_IFC4.ifc', profile: mech(0, [0.2, 0.8, 40.8, 22.3]) },
    ]
    expect(partnerOf('AC20-FZK-Haus.ifc', files)).toBe(null)
    expect(partnerOf('ifc4Mep_IFC4.ifc', files)).toBe(null)
    // 범위를 모르는 옛 캐시(extent 없음)도 권하지 않는다.
    expect(partnerOf('b.ifc', [{ path: 'a.ifc', profile: { ...arch(), extent: undefined } }, { path: 'b.ifc', profile: mech() }])).toBe(null)
  })

  it('범위가 겹쳐도 층이 짝지어지지 않으면 권하지 않는다 — C20 연구소와 ifc4Mep', () => {
    // 실측 층. 합쳐 보면 ifc4Mep 층 다섯 중 넷이 C20 에 없는 새 층으로 들어갔다.
    const c20 = [['Keller', -3], ['Erdgeschoss', 0], ['1. Obergeschoss', 3], ['2. Obergeschoss', 6], ['Dachgeschoss', 9]] as const
    const mep = [['-01. Fundering', -0.8], ['00. Begane grond', 0], ['01. verdieping', 3.5], ['02. verdieping', 7], ['03. Dak', 10.5]] as const
    const lv = (x: readonly (readonly [string, number])[]) => x.map(([name, elevation]) => ({ name, elevation }))
    const files = [
      { path: 'C20.ifc', profile: { ...arch(), levels: lv(c20) } },
      { path: 'ifc4Mep.ifc', profile: { ...mech(), levels: lv(mep) } },
    ]
    expect(partnerOf('C20.ifc', files)).toBe(null)
    // 같은 건물이면 이름이 맞는다.
    files[1].profile.levels = lv(c20)
    expect(partnerOf('C20.ifc', files)).toBe('ifc4Mep.ifc')
  })

  it('판본이 여럿인 폴더에서는 권하지 않는다 — 어느 판본과 합칠지 모른다', () => {
    const files = [
      { path: 'Duplex/Arch.ifc', profile: arch() },
      { path: 'Duplex/Arch-Optimized.ifc', profile: arch() },
      { path: 'Duplex/MEP-1.ifc', profile: mech() },
    ]
    expect(partnerOf('Duplex/MEP-1.ifc', files)).toBe(null)
    // 건축 쪽에서 보면 방 없는 설비 파일은 하나뿐이라 권한다.
    expect(partnerOf('Duplex/Arch.ifc', files)).toBe('Duplex/MEP-1.ifc')
  })

  it('설비 판본에 방(MEP Space)이 있으면 혼자 쓸 수 있는 파일이라 권하지 않고, 열지 못한 파일은 짝이 되지 않는다', () => {
    const files = [
      { path: 'Clinic/Arch.ifc', profile: arch() },
      { path: 'Clinic/MEP.ifc', profile: mech(257) },
      { path: 'Clinic/CON.ifc', profile: null },
    ]
    expect(partnerOf('Clinic/Arch.ifc', files)).toBe(null)
    expect(partnerOf('Clinic/CON.ifc', files)).toBe(null)
  })
})
