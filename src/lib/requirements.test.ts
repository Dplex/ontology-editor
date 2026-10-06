import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { mergeModels } from './merge'
import type { Model } from './model'
import { ASK_SETTING, EXPORT_SETTING, requirementsReport, type RequirementRow } from './requirements'
import { compareVersions } from './versions'

let mep: Model
let rooms: Model

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const read = (name: string) => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))
  mep = read('mep.ifc')
  rooms = read('two-rooms.ifc')
})

const row = (rows: RequirementRow[], id: string) => rows.find((r) => r.id === id)!
const brief = (r: RequirementRow) => ({ state: r.state, counts: r.counts })

describe('요구사항 보고서', () => {
  it('설비 픽스처: 일부러 빠뜨린 것이 그 자리에서 드러난다', () => {
    const rows = requirementsReport(mep)
    expect(brief(row(rows, 'R0'))).toEqual({ state: 'standard', counts: null })
    expect(row(rows, 'R6').state).toBe('standard')
    // 좌표 없는 센서
    expect(brief(row(rows, 'R11'))).toEqual({ state: 'partial', counts: { standard: 4, elsewhere: 0, of: 5 } })
    // 용량 없는 토출구. 공조기는 DT_Capacity, 다른 토출구는 타입의 표준 Pset 이다.
    expect(brief(row(rows, 'R21'))).toEqual({ state: 'partial', counts: { standard: 2, elsewhere: 0, of: 3 } })
    // 공조기(AIRHANDLER)·토출구(DIFFUSER)·조명(LightFixture)은 IFC 가 종류를 말한다. 온도 센서(TEMPERATURESENSOR)는
    // 우리 표에 없지만 IFC 표준 값이라 표준 자리다.
    expect(brief(row(rows, 'R24'))).toEqual({ state: 'standard', counts: { standard: 5, elsewhere: 0, of: 5 } })
    // 포트 셋 중 둘이 방향을 말한다. 하나는 SOURCEANDSINK 다.
    expect(brief(row(rows, 'R17'))).toEqual({ state: 'partial', counts: { standard: 2, elsewhere: 0, of: 3 } })
    expect(row(rows, 'R18').state).toBe('standard')
    // 지도 변환은 없다.
    expect(row(rows, 'R7').state).toBe('missing')
    // 벽·문이 없는 설비 파일
    expect(row(rows, 'R4').state).toBe('none')
    expect(row(rows, 'R22').state).toBe('none')
  })

  it('건축 픽스처: 방 분류는 둘만 있고, 내력 여부는 반만 안다', () => {
    const rows = requirementsReport(rooms)
    expect(brief(row(rows, 'R14'))).toEqual({ state: 'partial', counts: { standard: 2, elsewhere: 0, of: 3 } })
    expect(brief(row(rows, 'R22'))).toEqual({ state: 'partial', counts: { standard: 2, elsewhere: 0, of: 4 } })
    expect(row(rows, 'R9').state).toBe('missing')
  })

  it('호스트 벽을 모르는 문·창은 R4 를 "일부" 로 만든다 — 빼지 않고 모수에 넣는다(OE-BIM-05)', () => {
    const m = structuredClone(rooms)
    const openings = m.storeys.flatMap((s) => s.openings)
    const hosted = openings.filter((o) => o.wallId !== null)
    // 손 픽스처에는 벽에 매달리지 않은 개구부가 일부러 하나 있다.
    expect(openings.length - hosted.length).toBe(1)
    expect(brief(row(requirementsReport(m), 'R4'))).toEqual({ state: 'partial', counts: { standard: hosted.length, elsewhere: 0, of: openings.length } })
    // 개구부 관계(IfcRelVoidsElement·IfcRelFillsElement)가 하나 더 끊기면 하나 더 빠지고 모수는 그대로다.
    hosted[0].wallId = null
    expect(brief(row(requirementsReport(m), 'R4'))).toEqual({ state: 'partial', counts: { standard: hosted.length - 1, elsewhere: 0, of: openings.length } })
    // 전부 매달리면 표준.
    for (const o of openings) o.wallId = m.storeys[0].walls[0]?.id ?? 'w'
    expect(row(requirementsReport(m), 'R4').state).toBe('standard')
    // 읽지 않기로 한 것은 "없음" 이 아니라 잴 수 없음이다.
    m.skipped = ['walls']
    expect(row(requirementsReport(m), 'R4').state).not.toBe('partial')
  })

  it('Revit 이 다른 자리에 적은 것은 "다른 자리"로 센다', () => {
    const m = structuredClone(rooms)
    for (const s of m.storeys.flatMap((x) => x.spaces)) Object.assign(s, { omniclass: '13-15 11 34 11', omniclassSource: 'property' })
    expect(row(requirementsReport(m), 'R14')).toMatchObject({ state: 'elsewhere', counts: { standard: 0, elsewhere: 3, of: 3 } })

    const n = structuredClone(mep)
    for (const e of n.storeys.flatMap((x) => x.equipment)) if (e.capacity !== null) e.capacityProperty = 'Flow'
    expect(row(requirementsReport(n), 'R21')).toMatchObject({ state: 'partial', counts: { standard: 0, elsewhere: 2, of: 3 } })
    expect(row(requirementsReport(n), 'R21').note).toContain('Flow')
  })

  // OE-BIM-17 "다른 위치는 '설정을 바꿔 달라' 문구". 다른 자리가 나올 수 있는 R 을 하나씩 다른 자리로 만들어, 요청이 설정을
  // 바꿔 달라는 말과 무엇을 바꿀지로 나오는지 본다. 한쪽만 다른 자리(일부)여도 그 몫은 설정 요청이다.
  it('다른 자리면 요청이 늘 "내보내기 설정을 바꿔 달라" 와 무엇을 바꿀지다', () => {
    const elsewhere: [string, Model][] = []
    const a = structuredClone(rooms)
    for (const s of a.storeys.flatMap((x) => x.spaces)) Object.assign(s, { omniclass: '13-15 11 34 11', omniclassSource: 'property' })
    elsewhere.push(['R14', a])
    const b = structuredClone(mep)
    b.schema = 'IFC2X3'
    elsewhere.push(['R10', b])
    const c = structuredClone(mep)
    for (const s of c.systems) s.source = 'property'
    elsewhere.push(['R16', c])
    const d = structuredClone(mep)
    for (const e of d.storeys.flatMap((x) => x.equipment)) if (e.capacity !== null) e.capacityProperty = 'Flow'
    elsewhere.push(['R21', d])
    const e = structuredClone(mep)
    const device = e.storeys.flatMap((x) => x.equipment).find((x) => x.kind && x.role !== 'segment' && x.role !== 'fitting')!
    device.ifcClass = 'BuildingElementProxy'
    device.declaredType = null
    elsewhere.push(['R23', e], ['R24', e])
    // R13 은 판본 비교를 했을 때만 잰다. GUID 가 바뀌어 다른 열쇠로 찾은 것이 다른 자리다.
    const versions = { name: 'mep.ifc', kept: 4, rematched: 2 }
    elsewhere.push(['R13', mep])
    for (const [id, m] of elsewhere) {
      const r = row(requirementsReport(m, null, id === 'R13' ? versions : null), id)
      expect([id, r.state === 'elsewhere' || (r.counts?.elsewhere ?? 0) > 0]).toEqual([id, true])
      expect(r.ask, id).toContain(`${ASK_SETTING} — ${EXPORT_SETTING[id]}`)
      expect(r.ask.startsWith(ASK_SETTING), id).toBe(true)
    }
    // 정할 설정이 있는 R 은 위에서 다 다른 자리로 만들어 봤다.
    expect(new Set(elsewhere.map(([id]) => id))).toEqual(new Set(Object.keys(EXPORT_SETTING)))
  })

  it('다른 자리가 아닌 상태는 설정 요청을 하지 않는다 — 표준은 요청 없음, 없음·일부는 값을 넣어 달라', () => {
    const rows = requirementsReport(mep)
    for (const r of rows) {
      if (r.state === 'standard' || r.state === 'none' || r.state === 'unmeasured') expect([r.id, r.ask]).toEqual([r.id, ''])
      if ((r.state === 'missing' || r.state === 'partial') && !(r.counts?.elsewhere ?? 0)) expect(r.ask, r.id).not.toContain(ASK_SETTING)
    }
    // 좌표 없는 센서: 배치를 넣어 달라. 설정으로는 안 고쳐진다(형상 중심으로 옮긴 것도 일부다 — 삽입점을 고쳐야 한다).
    expect(row(rows, 'R11').ask).toContain('배치')
  })

  it('R24: 이름으로만 안 것은 다른 자리, USERDEFINED 에 유형 이름만 있으면 없음이다', () => {
    const m = structuredClone(mep)
    const eq = m.storeys.flatMap((x) => x.equipment)
    // Revit IFC2x3 이 흔히 내는 모양: 개체는 추상 클래스, 타입은 USERDEFINED 에 크기만 적었다.
    Object.assign(eq.find((e) => e.name === 'AHU-1')!, { declaredType: 'UnitaryEquipment.63300000 J' })
    Object.assign(eq.find((e) => e.name === 'TEMP-101-01')!, { declaredType: 'Sensor.150 mm' })
    expect(brief(row(requirementsReport(m), 'R24'))).toEqual({ state: 'partial', counts: { standard: 3, elsewhere: 1, of: 5 } })
  })

  it('벽이 전부 같은 값이면 기본값일 수 있다고 알린다', () => {
    const m = structuredClone(rooms)
    const wall = m.storeys[0].walls[0]
    m.storeys[0].walls = Array.from({ length: 30 }, (_, i) => ({ ...wall, id: `w${i}`, loadBearing: false }))
    expect(row(requirementsReport(m), 'R22').note).toContain('기본값')
  })

  it('합치면 좌표계(R12)와 층 이름(R1)을 잰다', () => {
    const { model, report } = mergeModels(rooms, mep)
    const rows = requirementsReport(model, report)
    expect(row(rows, 'R12').state).not.toBe('unmeasured')
    expect(row(rows, 'R1').counts).not.toBeNull()
    expect(model.facts).toEqual({ lengthUnit: true, mapConversion: false, siteLatLong: false })
    // 합치기 전에는 잴 수 없다.
    expect(row(requirementsReport(rooms), 'R12').state).toBe('unmeasured')
  })

  it('파일에서 읽지 않은 모델은 단위·지도 변환을 잴 수 없다고 한다', () => {
    const m = structuredClone(rooms)
    delete m.facts
    expect(row(requirementsReport(m), 'R6').state).toBe('unmeasured')
  })
})

// OE-BIM-11 "같은 건물 판본 간 층 높이로 교차 확인". 단위 환산은 파일이 선언한 단위를 믿으니, 선언이 틀리면 오류 없이 그 배수로
// 틀린다. millimetre.ifc 의 `.MILLI.` 를 `$` 로 바꾸면 밀리미터 값을 미터로 선언한 판본이 된다(2F 가 3000m 로 들어온다).
describe('단위 선언 교차 확인 (OE-BIM-11)', () => {
  let api: WebIFC.IfcAPI
  const bytes = (name: string) => readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))
  beforeAll(async () => {
    api = new WebIFC.IfcAPI()
    await api.Init()
  })
  const wrong = () => {
    const text = bytes('millimetre.ifc').toString('latin1')
    expect(text).toContain('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)')
    return importIfc(api, new Uint8Array(Buffer.from(text.replace('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)', 'IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)'), 'latin1')))
  }
  const read = (name: string) => importIfc(api, new Uint8Array(bytes(name)))

  it('선언만 틀린 판본은 혼자서는 R6 이 표준이다 — 파일 하나로는 알 수 없다', () => {
    const w = wrong()
    expect(w.storeys.map((s) => s.elevation)).toEqual([0, 3000])
    expect(row(requirementsReport(w), 'R6').state).toBe('standard')
  })

  it('합치면 이름이 같은 층의 높이 비(1000배)로 잡아 경고하고 R6 을 일부로 내린다', () => {
    const { model, report } = mergeModels(rooms, wrong(), { base: 'two-rooms.ifc', overlay: 'wrong.ifc' })
    // 층간 높이가 3000m 인 덧붙인 파일이 틀린 쪽이다.
    expect(report.unitScale).toMatchObject({ ratio: 1000, what: '밀리미터 ↔ 미터', storeys: [['2F', 3, 3000]], suspect: 'second' })
    const unit = model.warnings.filter((w) => w.includes('길이 단위 선언') || w.includes('높이가 다른'))
    // 같은 층을 "높이 기준점이 다를 수 있다" 로 한 번 더 말하지 않는다 — 단위 경고 하나뿐이다.
    expect(unit).toEqual([
      '이름이 같은 층의 높이가 wrong.ifc에서 two-rooms.ifc의 1000배입니다(2F 3m → 3000m). 층간 높이로 보면 wrong.ifc의 길이 단위 선언이 실제 값과 다른 것 같습니다(밀리미터 ↔ 미터). 치수·좌표가 모두 그 배수로 틀립니다(요구사항 R6).',
    ])
    const r6 = row(requirementsReport(model, report), 'R6')
    expect(r6.state).toBe('partial')
    expect(r6.note).toContain('층간 높이로 보면 덧붙인 파일의 선언이 실제 값과 다릅니다')
    // 기준과 덧붙인 쪽을 바꿔도 합친 모델에는 틀린 파일이 들어 있으니 일부다. 틀린 쪽은 기준 파일이다.
    const swapped = mergeModels(wrong(), rooms)
    expect(swapped.report.unitScale!.suspect).toBe('first')
    expect(row(requirementsReport(swapped.model, swapped.report), 'R6')).toMatchObject({ state: 'partial', note: expect.stringContaining('기준 파일의 선언') })
    expect(r6.ask).toContain('길이 단위 선언을 좌표·높이에 실제로 쓴 단위에 맞춰 달라')
  })

  it('제대로 선언한 밀리미터·피트 파일은 합쳐도 조용하다', () => {
    for (const name of ['millimetre.ifc', 'foot.ifc']) {
      const { model, report } = mergeModels(rooms, read(name))
      expect(report.unitScale, name).toBeNull()
      expect(model.warnings.some((w) => w.includes('길이 단위 선언')), name).toBe(false)
      expect(row(requirementsReport(model, report), 'R6').state, name).toBe('standard')
    }
  })

  it('판본 비교도 같은 쌍을 잡아 R6 으로 넘긴다', () => {
    const w = wrong()
    const d = compareVersions(rooms, w)
    expect(d.storeyScale).toMatchObject({ ratio: 1000, storeys: [['2F', 3, 3000]] })
    expect(compareVersions(rooms, read('millimetre.ifc')).storeyScale).toBeNull()
    expect(compareVersions(rooms, read('foot.ifc')).storeyScale).toBeNull()
    const r6 = row(requirementsReport(w, null, { name: 'two-rooms.ifc', kept: 0, rematched: 0, storeyScale: d.storeyScale }), 'R6')
    expect(r6.state).toBe('partial')
    expect(r6.note).toContain('이전 판본(two-rooms.ifc)')
    expect(r6.note).toContain('1000배')
    expect(r6.note).toContain('층간 높이로 보면 이 파일의 선언이 실제 값과 다릅니다')
  })

  it('지금 파일이 맞고 이전 판본이 틀렸으면 R6 은 표준으로 두고 이전 판본을 짚는다', () => {
    const d = compareVersions(wrong(), rooms)
    expect(d.storeyScale).toMatchObject({ ratio: 1 / 1000, suspect: 'first' })
    const r6 = row(requirementsReport(rooms, null, { name: 'wrong.ifc', kept: 0, rematched: 0, storeyScale: d.storeyScale }), 'R6')
    expect(r6.state).toBe('standard')
    expect(r6.note).toBe('길이 단위가 선언되어 있습니다. 이전 판본(wrong.ifc)은 같은 이름 층의 높이가 이 파일의 1000배로, 층간 높이로 보면 그 판본의 선언이 실제 값과 다릅니다(밀리미터 ↔ 미터).')
  })
})
