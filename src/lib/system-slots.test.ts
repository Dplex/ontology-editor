import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { restore, setEquipmentSystem, snapshotSystems } from './edit'
import { inferFlowByRules } from './flow-rules'
import { modelToTTL } from './export/ttl'
import type { Model } from './model'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)

const read = (): Model => {
  const path = fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url))
  const model = importIfc(api, new Uint8Array(readFileSync(path)))
  inferFlowByRules(model)
  return model
}

describe('계통 자리 (OE-PIP-02)', () => {
  it('공기·물 계통에 다 든 공조기의 공기 계통을 다른 공기 계통으로 바꿔도 물 계통 자리는 그대로이고, 되돌리면 공기 계통도 돌아온다', () => {
    const m = read()
    const ahu = m.storeys.flatMap((s) => s.equipment).find((e) => e.name === 'AHU-1')!
    const air = m.systems[0]
    expect(ahu.systemId).toBe(air.id)
    // 공조기는 냉수 코일로 물 계통에도 든다(주 계통은 급기). 옮겨 갈 공기 계통을 하나 더 둔다.
    m.systems.push({ id: 'W1', name: '냉수 공급', memberIds: [ahu.id], source: 'ifc', kind: 'hydronic_supply', fluid: null })
    m.systems.push({ id: 'A2', name: '급기 2', memberIds: [], source: 'ifc', kind: 'supply_air' })
    const opened = modelToTTL(m)
    const snap = snapshotSystems(m, [air.id, 'A2'], [ahu.id])

    setEquipmentSystem(m, ahu.id, 'A2')
    const water = m.systems.find((s) => s.id === 'W1')!
    expect(ahu.systemId).toBe('A2')
    expect(water.memberIds).toEqual([ahu.id])
    expect(air.memberIds).not.toContain(ahu.id)
    const ttl = modelToTTL(m)
    expect(ttl).toMatch(/W1 a brick:Water_System ;[^.]*brick:hasPart ex:0MEP\\\$Equip\\\$AHU1/)
    expect(ttl).toMatch(/A2 a brick:Air_System ;[^.]*brick:hasPart ex:0MEP\\\$Equip\\\$AHU1/)

    restore(m, snap)
    expect(ahu.systemId).toBe(air.id)
    expect(water.memberIds).toEqual([ahu.id])
    expect(modelToTTL(m)).toBe(opened)
  })
})
