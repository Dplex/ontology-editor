import { readFileSync } from 'node:fs'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { readOntologyTTL } from '../lib/export/read-ttl'
import { modelToTTL } from '../lib/export/ttl'
import { importIfc } from '../lib/ifc/import'
import { buildAliveScene } from './alive'

describe('alive — 살아 있는 건물', () => {
  it('TTL 의 brick:feeds 전부가 계통 종류별 메시로 흐르고 미확정 규칙 방향은 따로 센다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync('src/lib/ifc/fixtures/mep.ifc')))
    const reading = readOntologyTTL(modelToTTL(model))
    const wantFeeds = reading.entities.reduce((n, e) => n + e.feeds.length, 0)

    const built = buildAliveScene(model, false)
    expect(built.stats.feeds).toBe(wantFeeds)
    expect(built.stats.graphFeeds).toBe(wantFeeds)
    expect(built.stats.groups).toBeGreaterThan(0)

    // 미확정 규칙 방향을 하나 더하면 unconfirmed 에만 잡히고 흐르는 feeds 수는 그대로다.
    const eqs = model.storeys.flatMap((s) => s.equipment)
    model.connections.push({
      from: eqs[0].id,
      to: eqs[1].id,
      source: 'geometry',
      directed: false,
      tolerance: 0.005,
      inferred: { from: eqs[0].id, to: eqs[1].id, systemId: model.systems[0]?.id ?? 'sys', confirmed: false },
    })
    const builtWithRule = buildAliveScene(model, true)
    expect(builtWithRule.stats.feeds).toBe(wantFeeds)
    expect(builtWithRule.stats.unconfirmed).toBe(built.stats.unconfirmed + 1)

    built.dispose()
    builtWithRule.dispose()
  })
})
