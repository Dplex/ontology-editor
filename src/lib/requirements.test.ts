import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { mergeModels } from './merge'
import type { Model } from './model'
import { requirementsReport, type RequirementRow } from './requirements'

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
