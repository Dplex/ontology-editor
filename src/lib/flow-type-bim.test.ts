// BIM 배관의 Flow Type(OE-PIP-14). BIM 배관에는 Flow Type 칸이 없어 계통 종류·유체로 계산하고, 정하지 못한 구간은 사람이 고른다.
// mep.ifc: DUCT-01 은 "AHU-1 급기 계통"(AIRCONDITIONING + SUP) 의 덕트다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { conduitFlowType, setConduitFlowType, systemFlowType } from './flow-type'
import { baselineOf, restore, setSystemKind, snapshotEquipment } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToGeoJSON } from './export/geojson'
import type { Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const flowOf = (m: Model, name: string) => conduitFlowType(equip(m, name), (id) => m.systems.find((s) => s.id === id))
const featureOf = (m: Model, id: string) => modelToGeoJSON(m).flatMap((f) => f.collection.features).find((f) => f.id === id)!

describe('BIM 배관의 Flow Type (OE-PIP-14)', () => {
  it('계통 종류·유체로 정한다. 순환수는 유체를 알아야 하고, 모르면 비운다', () => {
    expect(systemFlowType('supply_air', null)).toBe('SA')
    expect(systemFlowType('exhaust_air', null)).toBe('EA')
    expect(systemFlowType('hydronic_supply', 'chilled')).toBe('CHWS')
    expect(systemFlowType('hydronic_return', 'hot')).toBe('HWR')
    expect(systemFlowType('hydronic_return', 'condenser')).toBe('CWR')
    expect(systemFlowType('hydronic_supply', null)).toBe(null)
    expect(systemFlowType('domestic_cold_water', null)).toBe('DCW')
    expect(systemFlowType(null, null)).toBe(null)
  })

  it('BIM 덕트는 계통으로 계산한 Flow Type 이 GeoJSON 에 출처와 함께 들어가고, 계통 종류를 바꾸면 따라 바뀐다 [OE-PIP-14#1~]', () => {
    const m = read()
    const duct = equip(m, 'DUCT-01')
    // 계통 종류를 BIM(PredefinedType + SUP)이 말했으니 계산(calc)이다.
    expect(flowOf(m, 'DUCT-01')).toEqual({ code: 'SA', source: 'calc' })
    expect(featureOf(m, duct.id).properties).toMatchObject({ flowType: 'SA', flowTypeSource: 'calc' })
    // 사람이 계통을 냉수 공급으로 고치면 그 계통의 배관이 같이 CHWS 가 된다. 유체를 모르는 순환수면 키가 빠진다.
    setSystemKind(m, duct.systemId!, 'hydronic_supply', 'chilled')
    expect(flowOf(m, 'DUCT-01')).toEqual({ code: 'CHWS', source: 'calc' })
    setSystemKind(m, duct.systemId!, 'hydronic_supply', null)
    expect(flowOf(m, 'DUCT-01')).toBe(null)
    expect(featureOf(m, duct.id).properties).not.toHaveProperty('flowType')
    // 기기는 Flow Type 이 없다.
    expect(flowOf(m, 'AHU-1')).toBe(null)
  })

  it('사람이 구간마다 고른 값이 계산보다 앞서고, 되돌리기·편집 파일로 다시 연 모델에서도 같다. 매체가 다르거나 범례에 없으면 막는다', () => {
    const m = read()
    const base = baselineOf(m)
    const duct = equip(m, 'DUCT-01')
    expect(setConduitFlowType(m, duct.id, 'CHWS')).toEqual({ refused: '덕트에는 CHWS(공기가 아닌 매체)를 정하지 않습니다.' })
    expect(setConduitFlowType(m, duct.id, 'XX')).toEqual({ refused: '범례에 없는 Flow Type(XX)입니다.' })
    expect(setConduitFlowType(m, equip(m, 'AHU-1').id, 'SA')).toBe(false)
    const snap = snapshotEquipment(m, duct.id)!
    expect(setConduitFlowType(m, duct.id, 'RA')).toBe(true)
    expect(flowOf(m, 'DUCT-01')).toEqual({ code: 'RA', source: 'edit' })
    expect(featureOf(m, duct.id).properties).toMatchObject({ flowType: 'RA', flowTypeSource: 'edit' })

    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    expect(file.equipment.find((r) => r.id === duct.id)).toMatchObject({ flowType: 'RA' })
    const again = read()
    applyEdits(again, file)
    expect(flowOf(again, 'DUCT-01')).toEqual({ code: 'RA', source: 'edit' })

    restore(m, snap)
    expect(flowOf(m, 'DUCT-01')).toEqual({ code: 'SA', source: 'calc' })
    // 같은 값을 다시 고르면 바뀐 것이 없고, null 이면 계산으로 돌아간다.
    setConduitFlowType(m, duct.id, 'RA')
    expect(setConduitFlowType(m, duct.id, 'RA')).toBe(false)
    expect(setConduitFlowType(m, duct.id, null)).toBe(true)
    expect(equip(m, 'DUCT-01').flowTypeSet).toBeUndefined()
  })
})
