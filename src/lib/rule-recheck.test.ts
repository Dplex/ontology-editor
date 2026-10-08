import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { addConnection, baselineOf, restore, setEquipmentSystem, setSystemKind, setTypeKind, snapshotOf, typeKeyOf, type Snapshot } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { cancelRelease, releaseConnection, snapshotRules } from './connection-release'
import { confirmSystemFlow, inferFlowByRules } from './flow-rules'
import { modelToTTL } from './export/ttl'
import type { Connection, Model } from './model'

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
const equip = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const idOf = (m: Model, name: string) => equip(m, name).id
/** mep.ifc 의 DUCT-01–AT-101-02. 포트가 방향을 말하지 않아 규칙이 DUCT-01 → AT-101-02 로 정한다(원천은 AHU-1). */
const free = (m: Model): Connection => m.connections.find((c) => !c.directed)!
const feeds = (m: Model, from: string, to: string) => {
  const ex = (name: string) => `ex:${idOf(m, name).replace(/\$/g, '\\$')}`
  const lines = modelToTTL(m).split('\n')
  const start = lines.findIndex((l) => l.startsWith(`${ex(from)} `))
  const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('.'))
  return lines.slice(start, end + 1).some((l) => l.includes('brick:feeds') && l.includes(ex(to)))
}
/** 규칙 방향을 확정한 mep.ifc. DUCT-01 → AT-101-02 가 TTL 에 나간다. */
const confirmedModel = () => {
  const m = read()
  confirmSystemFlow(m, free(m).inferred!.systemId)
  inferFlowByRules(m)
  return m
}

describe('확정한 규칙 방향의 재검토 (OE-PIP-07)', () => {
  it('근거가 그대로면 확정이 남고, 원천이 사라지면 재검토로 두어 TTL 에서 빼며, 근거가 돌아오면 저절로 풀린다', () => {
    const m = confirmedModel()
    const c = free(m)
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(true)
    expect(inferFlowByRules(m).recheck).toBe(0)
    expect(c.inferred!.recheck).toBeUndefined()

    // 공조기 종류를 "모름" 으로 — 원천이 없어져 규칙이 방향을 정할 수 없다.
    const rules = setTypeKind(m, typeKeyOf(equip(m, 'AHU-1')), null)!.rules
    expect(rules.recheck).toBe(1)
    expect(c.inferred).toMatchObject({ from: idOf(m, 'DUCT-01'), confirmed: true, recheck: null })
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(false)

    setTypeKind(m, typeKeyOf(equip(m, 'AHU-1')), 'ahu')
    expect(c.inferred!.recheck).toBeUndefined()
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(true)
  })

  it('원천 쪽 BIM 연결을 해제 보정하면 재검토, 취소하면 확정으로 돌아온다', () => {
    const m = confirmedModel()
    const port = m.connections.find((c) => c.directed && c.from === idOf(m, 'AHU-1'))!
    expect((releaseConnection(m, port, '철거') as { recheck: number }).recheck).toBe(1)
    expect(free(m).inferred!.recheck).toBeNull()
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(false)
    cancelRelease(m, port, '취소')
    expect(free(m).inferred!.recheck).toBeUndefined()
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(true)
  })

  it('새 추정이 확정과 반대면 재검토에 새 방향을 들고, 다시 확정하면 새 방향으로 내보낸다. 되돌리기는 예전 확정으로', () => {
    const m = confirmedModel()
    const c = free(m)
    const systemId = c.inferred!.systemId
    setSystemKind(m, systemId, 'return_air')
    expect(c.inferred).toMatchObject({ from: idOf(m, 'DUCT-01'), confirmed: true, recheck: { from: idOf(m, 'AT-101-02'), to: idOf(m, 'DUCT-01') } })
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(false)
    expect(feeds(m, 'AT-101-02', 'DUCT-01')).toBe(false)

    const before = snapshotRules(m, systemId)
    expect(confirmSystemFlow(m, systemId)).toBe(1)
    inferFlowByRules(m)
    expect(c.inferred).toEqual({ from: idOf(m, 'AT-101-02'), to: idOf(m, 'DUCT-01'), systemId, confirmed: true })
    expect(feeds(m, 'AT-101-02', 'DUCT-01')).toBe(true)

    const redo = snapshotOf(m, before as Snapshot)!
    restore(m, before as Snapshot)
    expect(c.inferred).toMatchObject({ from: idOf(m, 'DUCT-01'), recheck: { from: idOf(m, 'AT-101-02') } })
    restore(m, redo)
    expect(c.inferred).toMatchObject({ from: idOf(m, 'AT-101-02'), confirmed: true })
    expect(c.inferred!.recheck).toBeUndefined()
  })

  it('새로 정할 수 없게 된 확정을 다시 확정하면 확정을 거둔다', () => {
    const m = confirmedModel()
    const systemId = free(m).inferred!.systemId
    setTypeKind(m, typeKeyOf(equip(m, 'AHU-1')), null)
    expect(confirmSystemFlow(m, systemId)).toBe(1)
    expect(free(m).inferred).toBeUndefined()
  })

  it('확정한 계통에 새로 이은 연결은 미확정 규칙 방향이고, 다시 확정하기 전에는 TTL 에 없다', () => {
    const m = confirmedModel()
    const systemId = free(m).inferred!.systemId
    setEquipmentSystem(m, idOf(m, 'LIGHT-101-01'), systemId)
    const added = addConnection(m, idOf(m, 'DUCT-01'), idOf(m, 'LIGHT-101-01'))!.connection
    expect(added.inferred).toMatchObject({ from: idOf(m, 'DUCT-01'), systemId, confirmed: false })
    expect(free(m).inferred!.confirmed).toBe(true)
    expect(feeds(m, 'DUCT-01', 'LIGHT-101-01')).toBe(false)
    confirmSystemFlow(m, systemId)
    expect(feeds(m, 'DUCT-01', 'LIGHT-101-01')).toBe(true)
  })

  it('일치율은 포트 방향과 규칙 방향을 둘 다 가진 연결만 세고, 나머지는 추정 불가로 센다', () => {
    const m = read()
    const r = inferFlowByRules(m)
    // 포트가 방향을 말한 연결 둘(AHU-1 → DUCT-01, DUCT-01 → AT-101-01). 규칙도 같은 쪽이다.
    expect([r.agree, r.disagree, r.unestimated]).toEqual([2, 0, 0])
    const off = setTypeKind(m, typeKeyOf(equip(m, 'AHU-1')), null)!.rules
    expect([off.agree, off.disagree, off.unestimated]).toEqual([0, 0, 2])
    // 사람이 정한 방향은 규칙 추정을 대신하지 않는다 — 포트가 말하지 않은 연결이라 일치율에 들지 않는다.
    expect(off.agree + off.disagree).toBe(0)
  })

  it('저장·불러오기 뒤 확정 방향과 재검토 상태, TTL 이 저장할 때와 같다', () => {
    const m = confirmedModel()
    const base = baselineOf(read())
    setSystemKind(m, free(m).inferred!.systemId, 'return_air')
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc', new Date('2026-10-08T04:00:00Z')))) as ReturnType<typeof exportEdits>
    const b = read()
    applyEdits(b, file)
    expect(free(b).inferred).toEqual(free(m).inferred)
    expect(modelToTTL(b)).toBe(modelToTTL(m))
  })
})
