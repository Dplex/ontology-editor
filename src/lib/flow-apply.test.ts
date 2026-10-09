import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { baselineOf, flowEdits, restore, snapshotOf, type Snapshot } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { applyFlow, cancelRelease, clearFlow, releaseConnection, snapshotRelease } from './connection-release'
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
const idOf = (m: Model, name: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!.id
/** mep.ifc 의 DUCT-01–AT-101-02. 포트가 방향을 말하지 않아(SOURCEANDSINK) 규칙이 DUCT-01 → AT-101-02 로 짐작한다. */
const free = (m: Model): Connection => m.connections.find((c) => !c.directed)!
/** TTL 에서 from 이 to 를 feeds 하는가. id 의 `$` 는 `\$` 로 적힌다. */
const feeds = (m: Model, from: string, to: string) => {
  const ex = (name: string) => `ex:${idOf(m, name).replace(/\$/g, '\\$')}`
  const lines = modelToTTL(m).split('\n')
  const start = lines.findIndex((l) => l.startsWith(`${ex(from)} `))
  const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('.'))
  return lines.slice(start, end + 1).some((l) => l.includes('brick:feeds') && l.includes(ex(to)))
}
const AT = new Date('2026-10-08T03:00:00Z')

describe('연결별 방향 적용 (OE-PIP-04)', () => {
  it('규칙과 같은 방향은 사유 없이 적용되고, 계통 확정 없이 TTL feeds 로 나가며 규칙을 다시 돌려도 남는다', () => {
    const m = read()
    const c = free(m)
    expect(c.inferred).toMatchObject({ from: idOf(m, 'DUCT-01'), confirmed: false })
    // 확정하지 않은 규칙 방향은 TTL 에 나가지 않는다.
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(false)

    expect(applyFlow(m, c, idOf(m, 'DUCT-01'), '', AT)).toBe(true)
    expect(c.edited).toEqual({ from: idOf(m, 'DUCT-01'), to: idOf(m, 'AT-101-02'), at: AT.toISOString() })
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(true)
    inferFlowByRules(m)
    expect(c.edited?.from).toBe(idOf(m, 'DUCT-01'))
    expect(m.connectionLog).toEqual([{ action: 'flow', from: idOf(m, 'DUCT-01'), to: idOf(m, 'AT-101-02'), at: AT.toISOString(), reason: '' }])
  })

  it('규칙과 반대 방향은 보정 사유가 있어야 적용되고, 사유가 리포트·연결에 남는다', () => {
    const m = read()
    const c = free(m)
    expect(applyFlow(m, c, idOf(m, 'AT-101-02'), '  ')).toEqual({ refused: '규칙 방향과 반대입니다. 보정 사유를 적어 주세요' })
    expect(c.edited).toBeUndefined()
    expect(applyFlow(m, c, idOf(m, 'AT-101-02'), '현장 확인 결과 반대로 흐름', AT)).toBe(true)
    expect(c.edited).toMatchObject({ from: idOf(m, 'AT-101-02'), reason: '현장 확인 결과 반대로 흐름' })
    expect(flowEdits(m)).toEqual([{ from: idOf(m, 'AT-101-02'), to: idOf(m, 'DUCT-01'), rule: 'reversed', reason: '현장 확인 결과 반대로 흐름' }])
    expect(feeds(m, 'AT-101-02', 'DUCT-01')).toBe(true)
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(false)
  })

  it('수동 지정 해제는 확정한 규칙 방향이 있으면 그것으로 내보내고, 미확정이면 내보내지 않는다', () => {
    const m = read()
    const c = free(m)
    applyFlow(m, c, idOf(m, 'AT-101-02'), '반대', AT)
    expect(clearFlow(m, c, AT)).toBe(true)
    expect(c.edited).toBeUndefined()
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(false)
    expect(m.connectionLog!.at(-1)).toMatchObject({ action: 'unflow', from: idOf(m, 'AT-101-02'), to: idOf(m, 'DUCT-01') })
    expect(clearFlow(m, c)).toBe(false)

    applyFlow(m, c, idOf(m, 'AT-101-02'), '반대', AT)
    confirmSystemFlow(m, c.inferred!.systemId)
    clearFlow(m, c, AT)
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(true)
  })

  it('포트가 말한 방향과 해제 보정한 연결에는 적용하지 않는다', () => {
    const m = read()
    const port = m.connections.find((c) => c.directed)!
    expect(applyFlow(m, port, port.to, '반대')).toEqual({ refused: '포트(BIM)에 적힌 방향은 고칠 수 없습니다.' })
    const c = free(m)
    releaseConnection(m, c, '철거')
    expect(applyFlow(m, c, idOf(m, 'DUCT-01'), '')).toMatchObject({ refused: expect.stringContaining('해제 보정한 연결') })
    expect(feeds(m, 'DUCT-01', 'AT-101-02')).toBe(false)
  })

  it('되돌리기는 적용 전 방향과 이력으로, 다시 하기는 적용한 방향으로 돌아간다', () => {
    const m = read()
    const c = free(m)
    applyFlow(m, c, idOf(m, 'DUCT-01'), '', AT)
    const before = snapshotRelease(m, c)
    applyFlow(m, c, idOf(m, 'AT-101-02'), '반대', AT)
    const redo = snapshotOf(m, before as Snapshot)!
    restore(m, before as Snapshot)
    expect(c.edited?.from).toBe(idOf(m, 'DUCT-01'))
    expect(m.connectionLog).toHaveLength(1)
    restore(m, redo)
    expect(c.edited).toMatchObject({ from: idOf(m, 'AT-101-02'), reason: '반대' })
    expect(m.connectionLog).toHaveLength(2)
  })

  it('저장·불러오기 뒤 방향·시각·사유·이력이 같고, 해제한 연결에 정해 둔 방향도 취소하면 돌아온다', () => {
    const m = read()
    const base = baselineOf(m)
    const c = free(m)
    applyFlow(m, c, idOf(m, 'AT-101-02'), '현장 확인', AT)
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc', AT))) as ReturnType<typeof exportEdits>
    expect(file.flows).toEqual([{ from: idOf(m, 'AT-101-02'), to: idOf(m, 'DUCT-01'), at: AT.toISOString(), reason: '현장 확인' }])
    const b = read()
    applyEdits(b, file)
    expect(free(b).edited).toEqual(c.edited)
    expect(b.connectionLog).toEqual(m.connectionLog)
    expect(modelToTTL(b)).toBe(modelToTTL(m))

    releaseConnection(m, c, '철거', AT)
    const saved = parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc', AT))) as ReturnType<typeof exportEdits>
    const d = read()
    applyEdits(d, saved)
    const back = d.releasedConnections![0].connection
    expect(cancelRelease(d, back, '철거 취소')).not.toHaveProperty('refused')
    expect(back.edited).toMatchObject({ from: idOf(d, 'AT-101-02'), reason: '현장 확인' })
  })
})
