import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { addConnection, baselineOf, diffBaseline, removeConnection, restore, setFlowDirection, setTypeKind, snapshotType, typeKeyOf } from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { completenessChecks } from './checks'
import { flowReviews, repartitionFlowless } from './flow-review'
import { modelToTTL } from './export/ttl'
import { readOntologyTTL } from './export/read-ttl'
import { airServices } from './served'
import type { Connection, Model } from './model'

// 유체 흐름이 아닌 연결(OE-PIP-18). mep.ifc 는 AHU-1 → DUCT-01 → 디퓨저 둘이 포트로 이어져 있고, 조명 LIGHT-101-01 과 온도 센서는 떨어져 있다.

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (): Model => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))

let m: Model
beforeEach(() => {
  m = read()
})
const id = (name: string, model = m) => model.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!.id
const equip = (name: string, model = m) => model.storeys.flatMap((s) => s.equipment).find((e) => e.name === name)!
const geometry = (a: string, b: string): Connection => ({ from: id(a), to: id(b), source: 'geometry', directed: false, tolerance: 0.005 })
const nameOf = (x: string) => m.storeys.flatMap((s) => s.equipment).find((e) => e.id === x)?.name ?? x
const linked = (a: string, b: string, model = m) =>
  model.connections.some((c) => (c.from === id(a, model) && c.to === id(b, model)) || (c.from === id(b, model) && c.to === id(a, model)))
/** 받는 쪽 파서로 읽은 TTL 에서 a 가 b 를 feeds 하는가. */
const feeds = (a: string, b: string, model = m) => {
  const ttl = readOntologyTTL(modelToTTL(model))
  return ttl.entities.find((e) => e.key === id(a, model))?.feeds.includes(id(b, model)) ?? false
}

describe('형상 접촉으로 잇지 않는다 (OE-PIP-18)', () => {
  it('흐름 없는 기기에 닿은 형상 연결은 연결이 아니라 따로 둔다. 연결 검사·feeds 에 들지 않는다 [OE-PIP-18#1]', () => {
    m.connections.push(geometry('DUCT-01', 'LIGHT-101-01'), geometry('TEMP-101-01', 'LIGHT-101-01'))
    expect(repartitionFlowless(m)).toEqual({ removed: 2, restored: 0 })
    expect(linked('DUCT-01', 'LIGHT-101-01')).toBe(false)
    expect(m.flowlessGeometry).toHaveLength(2)
    expect(feeds('DUCT-01', 'LIGHT-101-01')).toBe(false)
  })

  it('종류를 모르는 기기와 냉매 설비(실외기)는 흐름 없다고 단정하지 않아 형상 연결이 남는다 [OE-PIP-18#2]', () => {
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), null)
    m.connections.push(geometry('DUCT-01', 'LIGHT-101-01'))
    expect(repartitionFlowless(m)).toEqual({ removed: 0, restored: 0 })
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), 'outdoor_unit')
    expect(linked('DUCT-01', 'LIGHT-101-01')).toBe(true)
    expect(m.flowlessGeometry).toBeUndefined()
  })
})

describe('BIM·사람 연결은 지우지 않고 검토 대상으로 둔다 (OE-PIP-18)', () => {
  it('흐름 없는 기기에 이은 연결은 남고, 검토 대상으로 보이며 방향을 정해도 feeds 로 나가지 않는다 [OE-PIP-18#3]', () => {
    const c = addConnection(m, id('DUCT-01'), id('LIGHT-101-01'))!.connection
    setFlowDirection(c, id('DUCT-01'))
    expect(linked('DUCT-01', 'LIGHT-101-01')).toBe(true)
    expect(flowReviews(m, nameOf)).toEqual([
      { connection: c, reason: 'LIGHT-101-01: 흐름 없는 기기', ids: [id('LIGHT-101-01')] },
    ])
    // 받는 쪽은 덕트를 건너뛴 기기끼리의 feeds 를 읽는다. 조명은 공조기가 공급하는 기기로 나가지 않고, 같은 덕트의 디퓨저(포트)는 나간다.
    expect(feeds('AHU-1', 'LIGHT-101-01')).toBe(false)
    expect(feeds('AHU-1', 'AT-101-01')).toBe(true)
    // 검사 목록에 걸린 기기로 오른다.
    const check = completenessChecks(m, airServices(m, m.connections)).find((x) => x.key === 'connection-fluid')!
    expect(check.failed).toEqual([id('LIGHT-101-01')])
    // 종류를 고쳐도 지우지 않는다 — 흐름 없는 기기가 아니게 되면 검토에서 빠지고 feeds 로 나간다.
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), null)
    expect(linked('DUCT-01', 'LIGHT-101-01')).toBe(true)
    expect(flowReviews(m)).toEqual([])
    expect(feeds('AHU-1', 'LIGHT-101-01')).toBe(true)
  })

  it('포트 연결도 지우지 않는다. 매체가 겹치지 않는 두 끝(공기 덕트 ↔ 물 배관)은 검토 대상이다 [OE-PIP-18#3]', () => {
    const port = m.connections.find((c) => c.source === 'port' && (c.from === id('AT-101-01') || c.to === id('AT-101-01')))!
    const pipe = equip('AT-101-01')
    pipe.ifcClass = 'PipeSegment'
    pipe.role = 'segment'
    pipe.kind = null
    pipe.systemId = null
    const r = flowReviews(m, nameOf)
    expect(r.map((x) => x.reason)).toEqual(['매체가 다름(DUCT-01 공기 ↔ AT-101-01 물)'])
    expect(r[0].connection).toBe(port)
    expect(m.connections).toContain(port)
  })
})

describe('진짜 유체 연결을 검토로 올리지 않는다 (OE-PIP-18)', () => {
  it('흐름 없는 종류라도 공기·물 계통에 들면 경로에 끼인 기기로 본다(덕트 센서) [OE-PIP-18#3]', () => {
    // ifc4Mep 의 센서 1.1.0 — 사전으로는 열감지기지만 급기 계통의 두 덕트 사이에 포트로 끼워져 있다.
    const c = addConnection(m, id('DUCT-01'), id('LIGHT-101-01'))!.connection
    expect(flowReviews(m).map((r) => r.connection)).toEqual([c])
    equip('LIGHT-101-01').systemId = equip('DUCT-01').systemId
    expect(flowReviews(m)).toEqual([])
  })

  it('기기와 덕트·배관 사이는 매체로 거르지 않는다 — 사전이 아는 기기 매체는 일부다(물 코일 디퓨저, 순환수 실내기) [OE-PIP-18#3]', () => {
    // 디퓨저(공기)를 물 배관에 이어도 검토가 아니다. 덕트끼리·배관끼리만 매체를 본다.
    const duct = equip('DUCT-01')
    duct.ifcClass = 'PipeSegment'
    duct.systemId = null
    expect(flowReviews(m)).toEqual([])
  })
})

describe('종류를 바꾸면 다시 잰다 (OE-PIP-18)', () => {
  it('흐름 없는 종류가 되면 그 기기의 형상 연결이 빠지고, 되돌리면 돌아온다. 되돌리기(Ctrl+Z)도 같다 [OE-PIP-18#4]', () => {
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), null)
    m.connections.push(geometry('DUCT-01', 'LIGHT-101-01'))
    const before = snapshotType(m, typeKeyOf(equip('LIGHT-101-01')))
    expect(setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), 'lighting')!.flowless).toEqual({ removed: 1, restored: 0 })
    expect(linked('DUCT-01', 'LIGHT-101-01')).toBe(false)
    // 완전성 검사도 다시 잰다 — 조명은 이제 연결망 검사 대상이 아니다.
    const check = () => completenessChecks(m, airServices(m, m.connections)).find((x) => x.key === 'device-connected')!
    expect(check().failed).not.toContain(id('LIGHT-101-01'))
    restore(m, before)
    expect(linked('DUCT-01', 'LIGHT-101-01')).toBe(true)
    expect(setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), 'lighting')!.flowless).toEqual({ removed: 1, restored: 0 })
    expect(setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), null)!.flowless).toEqual({ removed: 0, restored: 1 })
  })

  it('사람이 끊은 형상 연결은 종류를 바꿔도 돌아오지 않고, 오가는 것은 끊고 이은 것으로 세지 않는다. 편집 파일로 다시 열어도 같다 [OE-PIP-18#4]', () => {
    // 임포트처럼 조명에 닿은 형상 연결 둘이 처음부터 따로 둔 목록에 있다.
    const opened = (model: Model) => {
      model.connections.push({ ...geometry('DUCT-01', 'LIGHT-101-01') }, { ...geometry('AHU-1', 'LIGHT-101-01') })
      repartitionFlowless(model)
      return model
    }
    opened(m)
    expect(m.flowlessGeometry).toHaveLength(2)
    const baseline = baselineOf(m)
    // 종류를 "모름" 으로 고치면 돌아온다. 그중 하나를 끊고 조명으로 되돌린다.
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), null)
    removeConnection(m, m.connections.find((c) => c.source === 'geometry' && c.from === id('DUCT-01'))!)
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), 'lighting')
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), null)
    expect(linked('DUCT-01', 'LIGHT-101-01')).toBe(false)
    expect(linked('AHU-1', 'LIGHT-101-01')).toBe(true)
    setTypeKind(m, typeKeyOf(equip('LIGHT-101-01')), 'lighting')
    const diff = diffBaseline(m, baseline)
    expect(diff.disconnected).toEqual([{ from: id('DUCT-01'), to: id('LIGHT-101-01') }])
    expect(diff.connected).toEqual([])

    const file = parseEditFile(JSON.stringify(exportEdits(m, baseline, 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = opened(read())
    applyEdits(again, file)
    expect(again.flowlessGeometry?.map((c) => c.from)).toEqual([id('AHU-1')])
    setTypeKind(again, typeKeyOf(equip('LIGHT-101-01', again)), null)
    expect(linked('DUCT-01', 'LIGHT-101-01', again)).toBe(false)
    expect(linked('AHU-1', 'LIGHT-101-01', again)).toBe(true)
  })
})
