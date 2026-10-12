import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { airflowBasis, capacityChecks, flowToCmh, setRatedAirflow, setSpaceAirflow, setZoneAirflow, zoneAirflow } from './airflow'
import { baselineOf, createSpace, restore, snapshotAirflow, snapshotHvacZones } from './edit'
import { applyEdits, countEdits, exportEdits, parseEditFile } from './edit-file'
import { createZoneFromSpaces, zoneChecks } from './hvac-zone'
import { mergeModels } from './merge'
import { joinParts, partSig, splitByStorey } from './storey-drafts'
import type { HvacZone, Model } from './model'
import { requirementsReport } from './requirements'

// 용량 검증 Z-03(OE-ZON-05)과 그 입력값(OE-ZON-06), R26(OE-REQ-07).
// - space-airflow.ifc: two-rooms.ifc 에 방의 설계 풍량을 더했다. 101 회의실은 표준 Pset(L/s 로 선언), 102 복도는 Revit 속성(ft³/s),
//   201 창고는 Revit 속성이 0 이다.
// - mep.ifc: 1F 사무실(0..10 × 0..8)에 공조기 AHU-1(DT_Capacity.NominalAirFlowRate 1.6667 m³/s = 6,000 CMH)과 디퓨저 둘. 옆에 창고를 만든다.

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (name: string): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))

const spaceByNumber = (m: Model, n: string) => m.storeys.flatMap((s) => s.spaces).find((s) => s.name === n)!

describe('입력값을 읽는다 (OE-ZON-06)', () => {
  it('BIM 의 풍량은 선언한 단위를 CMH 로 바꿔 읽는다. 유도 단위 L/s, 선언 없는 m³/s, Revit 의 단위 없는 값(ft³/s) [OE-ZON-06#3]', () => {
    const m = read('space-airflow.ifc')
    expect(spaceByNumber(m, '101').designAirflow).toEqual({
      cooling: expect.closeTo(360, 6),
      heating: expect.closeTo(540, 6),
      supply: null,
      source: 'bim',
      property: 'Pset_SpaceThermalDesign.CoolingDesignAirflow·HeatingDesignAirflow',
    })
    // Duplex MEP-2 의 실제 값. 3.2955 ft³/s × 0.0283168 × 3600 = 335.9 CMH. `Actual Supply Airflow`(디퓨저 합)는 읽지 않는다.
    expect(spaceByNumber(m, '102').designAirflow).toMatchObject({ cooling: null, heating: null, supply: expect.closeTo(335.94, 1), source: 'bim' })
    expect(spaceByNumber(m, '102').designAirflow!.property).toBe('PSet_Revit_Mechanical - Airflow.Specified Supply Airflow')

    const mep = read('mep.ifc')
    const ahu = mep.storeys.flatMap((s) => s.equipment).find((e) => e.name === 'AHU-1')!
    expect(ahu.ratedAirflow).toEqual({ cmh: expect.closeTo(6000.12, 6), source: 'bim', property: 'DT_Capacity.NominalAirFlowRate' })
    // TTL 이 쓰는 원래 용량은 그대로다.
    expect(ahu.capacity).toBe(1.6667)
  })

  it('값이 없으면 비워 둔다. 0 은 Revit 이 넣지 않은 값이고, 에디터가 채운 기본값이 없다 [OE-ZON-06#1]', () => {
    const m = read('space-airflow.ifc')
    expect(spaceByNumber(m, '201').designAirflow).toBeUndefined()
    const mep = read('mep.ifc')
    for (const s of mep.storeys.flatMap((x) => x.spaces)) expect(s.designAirflow).toBeUndefined()
    // 용량이 없는 설비는 정격 풍량도 없다. 용량이 풍량이 아닌 설비도 없다.
    for (const e of mep.storeys.flatMap((x) => x.equipment)) {
      if (e.capacity === null) expect(e.ratedAirflow, e.name).toBeUndefined()
    }
  })

  it('단위를 모르는 값은 바꾸지 않는다', () => {
    expect(flowToCmh(1, 'IFCVOLUMETRICFLOWRATEMEASURE', 'Pset_FanTypeCommon', 1)).toBe(3600)
    expect(flowToCmh(100, 'IFCVOLUMETRICFLOWRATEMEASURE', 'Pset_SpaceThermalDesign', 0.001)).toBeCloseTo(360)
    expect(flowToCmh(1, 'IFCREAL', 'PSet_Revit_Mechanical', 1)).toBeCloseTo(101.94, 2)
    // Revit 세트가 아닌 단위 없는 값, 풍량이 아닌 타입은 모른다.
    expect(flowToCmh(1, 'IFCREAL', 'DT_Capacity', 1)).toBeNull()
    expect(flowToCmh(1, 'IFCPOWERMEASURE', 'PSet_Revit_Mechanical', 1)).toBeNull()
  })

  it('냉방·난방이 둘 다 있으면 큰 값이고 어느 쪽인지 같이 낸다. 하나만 있으면 그 값이다 [OE-ZON-06#4]', () => {
    expect(airflowBasis({ cooling: 500, heating: 700 })).toEqual({ cmh: 700, basis: 'heating' })
    expect(airflowBasis({ cooling: 800, heating: 700 })).toEqual({ cmh: 800, basis: 'cooling' })
    expect(airflowBasis({ cooling: null, heating: 300 })).toEqual({ cmh: 300, basis: 'heating' })
    expect(airflowBasis({ cooling: 300, heating: null, supply: 900 })).toEqual({ cmh: 300, basis: 'cooling' })
    expect(airflowBasis({ cooling: null, heating: null, supply: 900 })).toEqual({ cmh: 900, basis: 'supply' })
    expect(airflowBasis({ cooling: 0, heating: null })).toBeNull()
  })
})

describe('용량 검증 Z-03 (OE-ZON-05)', () => {
  let m: Model
  let store: string
  beforeEach(() => {
    m = read('mep.ifc')
    store = createSpace(m, m.storeys[0].id, { name: '102', longName: '창고', footprint: [[10.2, 0], [14, 0], [14, 8], [10.2, 8]] })!.created[0]
  })
  const office = () => m.storeys[0].spaces[0]
  const equip = (name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
  const names = {
    space: (id: string) => m.storeys.flatMap((s) => s.spaces).find((s) => s.id === id)?.longName ?? id,
    equipment: (id: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.id === id)?.name ?? id,
  }
  const z03 = () => {
    const checks = zoneChecks(m, names).checks.filter((c) => c.rule === 'Z-03')
    return { warn: checks.find((c) => !c.undetermined)!.items.map((x) => x.label), undetermined: checks.find((c) => c.undetermined)!.items.map((x) => x.label) }
  }
  const zone = (spaceIds: string[], servedBy: string[], name?: string) => createZoneFromSpaces(m, { spaceIds, servedBy, ...(name ? { name } : {}) }) as HvacZone

  it('정격 풍량이 담당 공조존의 설계 풍량 합보다 작으면 경고, 같거나 크면 없다 [OE-ZON-05#2]', () => {
    zone([office().id, store], [equip('AHU-1').id])
    setSpaceAirflow(m, office().id, { cooling: 4000 })
    setSpaceAirflow(m, store, { cooling: 2500 })
    expect(z03()).toEqual({ warn: ['AHU-1 정격 6,000 CMH < 공조존 1 설계 6,500 CMH(냉방 기준)'], undetermined: [] })
    setSpaceAirflow(m, store, { cooling: 2000.12 })
    expect(z03()).toEqual({ warn: [], undetermined: [] })
    setSpaceAirflow(m, store, { cooling: 1000 })
    expect(z03().warn).toEqual([])
  })

  it('기준은 냉방·난방 중 큰 값이고 경고에 어느 값인지 보인다. 냉방끼리·난방끼리 더한 뒤 고른다 [OE-ZON-05#3]', () => {
    zone([office().id, store], [equip('AHU-1').id])
    // 방마다 큰 값을 더하면 4000 + 2500 = 6500 으로 경고지만, 냉방 합 5000 · 난방 합 5800 이 실제 정점이라 경고가 아니다.
    setSpaceAirflow(m, office().id, { cooling: 4000, heating: 3300 })
    setSpaceAirflow(m, store, { cooling: 1000, heating: 2500 })
    expect(z03().warn).toEqual([])
    setSpaceAirflow(m, store, { cooling: 1000, heating: 3000 })
    expect(z03().warn).toEqual(['AHU-1 정격 6,000 CMH < 공조존 1 설계 6,300 CMH(난방 기준)'])
  })

  it('여러 공조존에 급기하는 공조기는 용량이 작아도 판정하지 않는다. 한 존만 담당하면 판정한다 [OE-ZON-05#4]', () => {
    const a = zone([office().id], [equip('AHU-1').id], '가')
    zone([store], [equip('AHU-1').id], '나')
    setSpaceAirflow(m, office().id, { cooling: 9000 })
    setSpaceAirflow(m, store, { cooling: 9000 })
    expect(z03()).toEqual({ warn: [], undetermined: [] })
    // 같은 설비라도 FCU 면 직접 담당 설비라 두 존 합과 견준다.
    equip('AHU-1').kind = 'fcu'
    expect(z03().warn).toEqual(['AHU-1 정격 6,000 CMH < 가·나 설계 18,000 CMH(냉방 기준)'])
    equip('AHU-1').kind = 'ahu'
    a.servedBy = []
    expect(z03().warn).toEqual(['AHU-1 정격 6,000 CMH < 나 설계 9,000 CMH(냉방 기준)'])
  })

  it('설계 풍량이나 정격 풍량이 없으면 경고가 아니라 판정 불가이고, 없는 값의 이름이 보인다 [OE-ZON-05#5]', () => {
    zone([office().id, store], [equip('AHU-1').id])
    expect(z03()).toEqual({ warn: [], undetermined: ['AHU-1 — 공조존 1 설계 풍량 없음: 사무실, 창고'] })
    setSpaceAirflow(m, office().id, { cooling: 9000 })
    expect(z03().undetermined).toEqual(['AHU-1 — 공조존 1 설계 풍량 없음: 창고'])
    delete equip('AHU-1').ratedAirflow
    expect(z03().undetermined).toEqual(['AHU-1 — 정격 풍량 없음 · 공조존 1 설계 풍량 없음: 창고'])
    // 판정 불가는 경고로 칠하지 않는다.
    expect(zoneChecks(m, names).checks.find((c) => c.rule === 'Z-03' && c.undetermined)).toMatchObject({ undetermined: true })
  })

  it('다른 공조존과 함께 담당하는 물리존이 있으면 방 값을 나누지 않고 판정 불가다. 공조존 값을 넣으면 그 값으로 판정한다 [OE-ZON-05#6]', () => {
    zone([office().id], [], '가')
    const b = zone([office().id, store], [equip('AHU-1').id], '나')
    setSpaceAirflow(m, office().id, { cooling: 3000 })
    setSpaceAirflow(m, store, { cooling: 1000 })
    expect(z03().undetermined).toEqual(['AHU-1 — 나 설계 풍량 없음(사무실을 다른 공조존과 함께 담당해 방 값을 나눌 수 없음)'])
    expect(setZoneAirflow(m, b.id, { cooling: 7000 })).toBe(true)
    expect(zoneAirflow(m, b)).toMatchObject({ from: 'zone', cmh: 7000, basis: 'cooling' })
    expect(z03()).toEqual({ warn: ['AHU-1 정격 6,000 CMH < 나 설계 7,000 CMH(냉방 기준)'], undetermined: [] })
  })

  it('사람이 값을 넣으면 출처가 사람이 되고 Z-03 을 다시 판정한다. BIM 값이 있는 곳은 받지 않는다 [OE-ZON-06#5]', () => {
    const z = zone([office().id], [equip('AHU-1').id])
    expect(z03().undetermined).toHaveLength(1)
    expect(setSpaceAirflow(m, office().id, { cooling: 7000 })).toBe(true)
    expect(office().designAirflow).toEqual({ cooling: 7000, heating: null, source: 'edit' })
    expect(z03().warn).toHaveLength(1)
    // 사람이 넣은 방 값만으로 더한 공조존 값의 출처는 `spaces` 다(BIM 아님).
    expect(zoneAirflow(m, z).from).toBe('spaces')
    // BIM 값은 고치지 않는다.
    expect(setRatedAirflow(m, equip('AHU-1').id, 9000)).toEqual({ refused: 'BIM 에 정격 풍량이 있는 설비입니다. BIM 값을 씁니다.' })
    office().designAirflow = { cooling: 5000, heating: null, source: 'bim', property: 'Pset_SpaceThermalDesign.CoolingDesignAirflow' }
    expect(setSpaceAirflow(m, office().id, { cooling: 1 })).toEqual({ refused: 'BIM 에 설계 풍량이 있는 방입니다. BIM 값을 씁니다.' })
    expect(zoneAirflow(m, z).from).toBe('bim')
    expect(setZoneAirflow(m, z.id, { cooling: 1 })).toMatchObject({ refused: expect.stringContaining('BIM') })
    // 지우면 칸이 없어진다(기본값을 남기지 않는다).
    office().designAirflow = { cooling: 7000, heating: null, source: 'edit' }
    expect(setSpaceAirflow(m, office().id, null)).toBe(true)
    expect(office().designAirflow).toBeUndefined()
  })

  it('넣은 값은 되돌리기·편집 파일로 돌아온다', () => {
    // 창고는 연 뒤에 만든 방이다. 연 때 상태는 새로 연 파일에서 뜬다.
    const baseline = baselineOf(read('mep.ifc'))
    const z = zone([office().id, store], [equip('AHU-1').id])
    const before = snapshotAirflow(m, 'space', office().id)!
    setSpaceAirflow(m, office().id, { cooling: 4000, heating: 4500 })
    const zones = snapshotHvacZones(m, m.storeys[0].id)!
    setZoneAirflow(m, z.id, { heating: 8000 })
    restore(m, zones)
    expect(m.storeys[0].hvacZones![0].designAirflow).toBeUndefined()
    restore(m, before)
    expect(office().designAirflow).toBeUndefined()

    setSpaceAirflow(m, office().id, { cooling: 4000, heating: 4500 })
    setSpaceAirflow(m, store, { cooling: 1000 })
    setZoneAirflow(m, m.storeys[0].hvacZones![0].id, { heating: 8000 })
    const diffuser = m.storeys.flatMap((s) => s.equipment).find((e) => e.ratedAirflow === undefined && e.kind !== null)!
    expect(setRatedAirflow(m, diffuser.id, 450)).toBe(true)
    const file = parseEditFile(JSON.stringify(exportEdits(m, baseline, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    expect(file.spaceAirflows).toEqual([
      { id: office().id, cooling: 4000, heating: 4500 },
      { id: store, cooling: 1000, heating: null },
    ])
    expect(file.ratedAirflows).toEqual([{ id: diffuser.id, cmh: 450 }])
    // 층별 임시 저장 조각으로 갈랐다 이어도 남는다(storey-drafts.ts). 사무실은 1F 조각, 연 뒤 만든 창고는 건물 조각이다.
    const home = new Map(m.storeys.flatMap((st) => st.spaces.filter((sp) => sp.id !== store).map((sp) => [sp.id, st.id] as const)))
    const parts = splitByStorey(file, (id) => home.get(id) ?? null)
    expect(parts.get(m.storeys[0].id)!.spaceAirflows).toEqual([{ id: office().id, cooling: 4000, heating: 4500 }])
    expect(partSig(parts.get(m.storeys[0].id))).not.toBeNull()
    expect(joinParts(parts.values(), file).spaceAirflows).toHaveLength(2)
    expect(countEdits(file)).toBeGreaterThanOrEqual(4)

    const again = read('mep.ifc')
    applyEdits(again, file)
    const sp = (id: string) => again.storeys.flatMap((s) => s.spaces).find((s) => s.id === id)!
    expect(sp(office().id).designAirflow).toEqual({ cooling: 4000, heating: 4500, source: 'edit' })
    expect(sp(store).designAirflow).toEqual({ cooling: 1000, heating: null, source: 'edit' })
    expect(again.storeys[0].hvacZones![0].designAirflow).toEqual({ cooling: null, heating: 8000 })
    expect(again.storeys.flatMap((s) => s.equipment).find((e) => e.id === diffuser.id)!.ratedAirflow).toEqual({ cmh: 450, source: 'edit' })
  })

  it('capacityChecks 는 공조존이 없으면 아무것도 세지 않는다', () => {
    expect(capacityChecks(m, names)).toEqual({ warn: [], undetermined: [] })
  })
})

describe('R26 방의 설계 급기 풍량 (OE-REQ-07)', () => {
  it('설계 풍량이 없으면 없음·일부, Revit 속성에 있으면 다른 위치다 [OE-REQ-07#2]', () => {
    const row = (m: Model) => requirementsReport(m).find((r) => r.id === 'R26')!
    expect(row(read('two-rooms.ifc'))).toMatchObject({ state: 'missing', counts: { standard: 0, elsewhere: 0, of: 3 } })
    const m = read('space-airflow.ifc')
    expect(row(m)).toMatchObject({ state: 'partial', counts: { standard: 1, elsewhere: 1, of: 3 } })
    expect(row(m).note).toContain('Specified Supply Airflow')
    expect(row(m).ask).toContain('Pset_SpaceThermalDesign')
    // 101 만 남기고 102 를 Revit 자리로만 두면 다른 위치다.
    spaceByNumber(m, '201').designAirflow = { cooling: null, heating: null, supply: 100, source: 'bim', property: 'PSet_Revit_Mechanical - Airflow.Specified Supply Airflow' }
    expect(row(m).state).toBe('elsewhere')
    // 사람이 넣은 값은 BIM 에 없는 것이라 세지 않는다.
    spaceByNumber(m, '201').designAirflow = { cooling: 100, heating: null, source: 'edit' }
    expect(row(m).state).toBe('partial')
  })

  it('비공조 공간(계단실·승강로)은 해당 없음이고, 종류를 모르는 방은 빼지 않는다 [OE-REQ-07#3]', () => {
    const m = read('space-airflow.ifc')
    const store = spaceByNumber(m, '201')
    store.kind = 'staircase'
    const r = requirementsReport(m).find((x) => x.id === 'R26')!
    expect(r).toMatchObject({ state: 'elsewhere', counts: { standard: 1, elsewhere: 1, of: 2 } })
    expect(r.note).toContain('계단실·승강로 1개는 해당 없음')
    store.kind = null
    expect(requirementsReport(m).find((x) => x.id === 'R26')!.counts).toMatchObject({ of: 3 })
  })

  it('Revit 은 설계 풍량을 설비 파일의 공간에 적는다. 합칠 때 빠지는 설비 쪽 방의 값을 남는 방으로 옮긴다', () => {
    const merged = mergeModels(read('two-rooms.ifc'), read('space-airflow.ifc')).model
    const meeting = merged.storeys.flatMap((s) => s.spaces).filter((s) => s.name === '101')
    expect(meeting).toHaveLength(1)
    expect(meeting[0].designAirflow).toMatchObject({ cooling: expect.closeTo(360, 6), source: 'bim' })
  })
})
