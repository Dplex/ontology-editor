import { readFileSync } from 'node:fs'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { readOntologyTTL } from '../lib/export/read-ttl'
import { modelToTTL } from '../lib/export/ttl'
import { importIfc } from '../lib/ifc/import'
import { matchShortcut } from '../lib/shortcuts'
import { buildXrayGraph } from './xray'

describe('xray — 온톨로지 투시 그래프', () => {
  it('손짓(Space)은 편집 화면 단축키 표에서 아무 일도 하지 않는다(G5)', () => {
    expect(matchShortcut({ code: 'Space', key: ' ', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false })).toBeNull()
  })

  it('TTL 의 feeds · hasLocation · hasPart · fso: 미독 수와 그래프의 선·점 수가 일치한다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync('src/lib/ifc/fixtures/mep.ifc')))
    const reading = readOntologyTTL(modelToTTL(model))
    const wantFeeds = reading.entities.reduce((n, e) => n + e.feeds.length, 0)
    const wantLoc = reading.entities.reduce((n, e) => n + e.locations.length, 0)
    const wantPart = reading.entities.reduce((n, e) => n + e.parts.length, 0)
    const wantUnread = reading.unread.filter((u) => u.cls.startsWith('fso:')).length

    const built = buildXrayGraph(model, true)
    expect(built.stats.feeds).toBe(wantFeeds)
    expect(built.stats.hasLocation).toBe(wantLoc)
    expect(built.stats.hasPart).toBe(wantPart)
    expect(built.stats.unread).toBe(wantUnread)
    expect(built.stats.graph.feeds).toBe(wantFeeds)
    expect(built.stats.graph.hasLocation).toBe(wantLoc)
    expect(built.stats.graph.hasPart).toBe(wantPart)
    expect(built.stats.graph.points).toBeGreaterThan(0)
    built.dispose()
  })
})
