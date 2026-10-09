import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { addConnection, baselineOf, diffBaseline, restore, snapshotOf, type Snapshot } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { cancelRelease, dropRelease, keepRelease, releaseConnection, releasesOf, snapshotRelease } from './connection-release'
import { inferFlowByRules } from './flow-rules'
import { modelToTTL } from './export/ttl'
import { joinParts, splitByStorey } from './storey-drafts'
import { neighbors } from './topology'
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
/** mep.ifc 의 포트 연결 AHU-1 → DUCT-01(방향 있음). */
const ahuDuct = (m: Model): Connection =>
  m.connections.find((c) => c.source === 'port' && c.from === idOf(m, 'AHU-1') && c.to === idOf(m, 'DUCT-01'))!
/** TTL 에서 from 설비가 to 를 feeds 하는가. 주어 블록 안에 목적어로 적히고, id 의 `$` 는 `\$` 로 적힌다. */
const feeds = (m: Model, from: string, to: string) => {
  const ex = (name: string) => `ex:${idOf(m, name).replace(/\$/g, '\\$')}`
  const lines = modelToTTL(m).split('\n')
  const start = lines.findIndex((l) => l.startsWith(`${ex(from)} `))
  const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('.'))
  return lines.slice(start, end + 1).some((l) => l.includes('brick:feeds') && l.includes(ex(to)))
}
const feedsDuct = (m: Model) => feeds(m, 'AHU-1', 'DUCT-01')
const AT = new Date('2026-10-08T01:00:00Z')

describe('연결 해제 보정 (OE-PIP-06)', () => {
  it('BIM 포트 연결을 해제하면 원본·방향은 그대로 남고, 유효 연결·TTL feeds·규칙 방향에서 빠진다', () => {
    const m = read()
    const c = ahuDuct(m)
    const at = m.connections.indexOf(c)
    const ruled = m.connections.find((x) => !x.directed && x.inferred)!
    expect(ruled.inferred).toBeDefined()
    expect(feedsDuct(m)).toBe(true)

    const done = releaseConnection(m, c, '  현장에서 덕트 철거  ', AT)
    expect('refused' in done).toBe(false)
    expect(m.connections).not.toContain(c)
    expect(m.releasedConnections).toEqual([{ connection: c, index: at, at: AT.toISOString(), reason: '현장에서 덕트 철거' }])
    // 원본 연결 객체를 고치지 않는다.
    expect(c).toMatchObject({ source: 'port', directed: true, from: idOf(m, 'AHU-1'), to: idOf(m, 'DUCT-01') })
    expect(feedsDuct(m)).toBe(false)
    // 덕트 너머 토출구까지 따라가던 공급 관계도 끊긴다.
    expect(feeds(m, 'AHU-1', 'AT-101-01')).toBe(false)
    expect(neighbors(m.connections, idOf(m, 'AHU-1'))).toHaveLength(0)
    // 원천(AHU-1)에서 끊겨 규칙 방향을 다시 계산하면 DUCT-01–AT-101-02 의 규칙 방향이 사라진다.
    expect(ruled.inferred).toBeUndefined()
    expect(m.connectionLog).toEqual([{ action: 'release', from: c.from, to: c.to, at: AT.toISOString(), reason: '현장에서 덕트 철거' }])
    expect(releasesOf(m, idOf(m, 'DUCT-01'))).toHaveLength(1)
  })

  it('사유가 없거나, 포트 연결이 아니거나, 이미 해제한 연결은 거절한다', () => {
    const m = read()
    const c = ahuDuct(m)
    expect(releaseConnection(m, c, '   ')).toEqual({ refused: '사유를 적어 주세요. 보정 이력에 남습니다' })
    const manual = addConnection(m, idOf(m, 'AHU-1'), idOf(m, 'LIGHT-101-01'))!.connection
    expect(releaseConnection(m, manual, '사유')).toMatchObject({ refused: expect.stringContaining('[연결 끊기]') })
    releaseConnection(m, c, '철거')
    expect(releaseConnection(m, c, '철거')).toEqual({ refused: '이미 해제한 연결입니다' })
    expect(m.connectionLog).toHaveLength(1)
  })

  it('해제를 취소하면 같은 연결이 해제 전 자리·방향으로 돌아오고, 규칙 방향과 TTL 이 해제 전과 같다', () => {
    const m = read()
    const before = { ttl: modelToTTL(m), order: [...m.connections] }
    const c = ahuDuct(m)
    releaseConnection(m, c, '철거', AT)
    expect(cancelRelease(m, c, '')).toEqual({ refused: '사유를 적어 주세요. 보정 이력에 남습니다' })
    const done = cancelRelease(m, c, '철거 계획 철회', new Date('2026-10-08T02:00:00Z'))
    expect('refused' in done).toBe(false)
    expect(m.connections).toEqual(before.order)
    expect(m.releasedConnections).toBeUndefined()
    expect(modelToTTL(m)).toBe(before.ttl)
    expect(m.connectionLog!.map((e) => [e.action, e.reason])).toEqual([
      ['release', '철거'],
      ['restore', '철거 계획 철회'],
    ])
  })

  it('되돌리기·다시 하기로 해제와 취소를 무른다. 무른 것은 이력에 남지 않는다', () => {
    const m = read()
    const c = ahuDuct(m)
    const ttl = modelToTTL(m)
    const s1 = snapshotRelease(m, c)
    releaseConnection(m, c, '철거')
    const redo = snapshotOf(m, s1 as Snapshot)!
    restore(m, s1 as Snapshot)
    expect(m.connections).toContain(c)
    expect(m.releasedConnections).toBeUndefined()
    expect(m.connectionLog).toBeUndefined()
    expect(modelToTTL(m)).toBe(ttl)
    restore(m, redo)
    expect(m.connections).not.toContain(c)
    expect(m.releasedConnections).toHaveLength(1)
    expect(m.connectionLog).toHaveLength(1)
  })

  it('해제한 연결은 끊은 연결로 세지 않고, 같은 두 설비를 손으로 다시 잇지 않는다', () => {
    const m = read()
    const base = baselineOf(m)
    const c = ahuDuct(m)
    releaseConnection(m, c, '철거')
    expect(diffBaseline(m, base).disconnected).toEqual([])
    expect(addConnection(m, c.from, c.to)).toBeNull()
    const file = exportEdits(m, base, 'mep.ifc', AT)
    expect(file.connections).toBeUndefined()
    expect(file.connectionsReleased).toEqual([{ from: c.from, to: c.to, directed: true, at: expect.any(String), reason: '철거' }])
  })
})

describe('해제 보정 저장·불러오기·재임포트', () => {
  const released = () => {
    const m = read()
    const base = baselineOf(m)
    const c = ahuDuct(m)
    releaseConnection(m, c, '철거', AT)
    cancelRelease(m, c, '잘못 해제', new Date('2026-10-08T01:10:00Z'))
    releaseConnection(m, c, '현장 확인 후 철거', new Date('2026-10-08T01:20:00Z'))
    return { m, file: parseEditFile(JSON.stringify(exportEdits(m, base, 'mep.ifc', AT))) as ReturnType<typeof exportEdits> }
  }

  it('저장한 파일을 새로 연 모델에 얹으면 해제 상태·이력·TTL 이 같다. 층별 조각을 거쳐도 같다', () => {
    const { m, file } = released()
    expect(file.connectionLog).toHaveLength(3)
    const b = read()
    const result = applyEdits(b, file)
    expect(result.releases).toEqual({ released: 1, review: 0 })
    expect(b.releasedConnections!.map((r) => [r.connection.from, r.connection.to, r.reason, r.review])).toEqual([
      [idOf(b, 'AHU-1'), idOf(b, 'DUCT-01'), '현장 확인 후 철거', undefined],
    ])
    expect(b.connectionLog).toEqual(m.connectionLog)
    expect(modelToTTL(b)).toBe(modelToTTL(m))

    const parts = splitByStorey(file, () => null)
    const c = read()
    applyEdits(c, joinParts(parts.values(), file))
    expect(c.connectionLog).toEqual(m.connectionLog)
    expect(modelToTTL(c)).toBe(modelToTTL(m))
  })

  it('GUID 가 바뀐 재내보내기 판본에서도 같은 연결을 찾아 다시 해제한다', () => {
    const { m, file } = released()
    const b = read()
    const ids = [...b.storeys.flatMap((s) => [s.id, ...s.spaces.map((sp) => sp.id), ...s.equipment.map((e) => e.id)]), ...b.systems.map((s) => s.id)]
    let json = JSON.stringify(b)
    for (const id of ids) json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
    const v2: Model = JSON.parse(json)
    const result = applyEdits(v2, file)
    expect(result.releases).toEqual({ released: 1, review: 0 })
    expect(v2.releasedConnections![0].connection.from).toBe(`${idOf(m, 'AHU-1')}Qv2`)
    expect(modelToTTL(v2).split('Qv2').join('')).toBe(modelToTTL(m))
  })

  it('다시 연 판본에서 방향이 바뀌었으면 해제한 채 재검토로 두고, 해제 유지·취소를 고른다', () => {
    const { file } = released()
    const b = read()
    const c = ahuDuct(b)
    ;[c.from, c.to] = [c.to, c.from]
    const result = applyEdits(b, file)
    expect(result.releases).toEqual({ released: 0, review: 1 })
    const entry = b.releasedConnections![0]
    expect(entry).toMatchObject({ connection: c, review: 'direction' })
    // 사람이 보기 전에는 TTL 에 나가지 않는다.
    expect(b.connections).not.toContain(c)
    expect(feeds(b, 'DUCT-01', 'AHU-1')).toBe(false)
    expect(feeds(b, 'AHU-1', 'DUCT-01')).toBe(false)
    // 재검토가 남은 채 저장하면 다시 불러와도 재검토다.
    const again = read()
    const flipped = ahuDuct(again)
    ;[flipped.from, flipped.to] = [flipped.to, flipped.from]
    applyEdits(again, exportEdits(b, baselineOf(read()), 'mep.ifc', AT))
    expect(again.releasedConnections![0].review).toBe('direction')

    expect(keepRelease(b, c, AT)).toBe(true)
    expect(entry.review).toBeUndefined()
    expect(b.connectionLog!.at(-1)).toMatchObject({ action: 'keep' })
    expect('refused' in cancelRelease(b, c, '방향 바뀐 판본 확인')).toBe(false)
    expect(b.connections).toContain(c)
  })

  it('다시 연 판본에 원본 연결이 없으면 재검토로 두고, 되살리지 못하며 보정을 지워도 이력은 남는다', () => {
    const { file } = released()
    const b = read()
    b.connections.splice(b.connections.indexOf(ahuDuct(b)), 1)
    const count = b.connections.length
    const result = applyEdits(b, file)
    expect(result.releases).toEqual({ released: 0, review: 1 })
    const entry = b.releasedConnections![0]
    expect(entry.review).toBe('missing')
    expect(b.connections).toHaveLength(count)
    expect(cancelRelease(b, entry.connection, '복원')).toMatchObject({ refused: expect.stringContaining('[보정 지우기]') })
    expect(dropRelease(b, entry.connection, AT)).toBe(true)
    expect(b.releasedConnections).toBeUndefined()
    expect(b.connectionLog!.map((e) => e.action)).toEqual(['release', 'restore', 'release', 'drop'])
  })
})
