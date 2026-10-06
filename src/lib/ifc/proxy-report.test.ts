import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { importIfc } from './import'

// OE-BIM-13 Proxy 리포트의 "읽지 않은 이름 예". 가진 BIM 은 읽지 않은 패밀리가 둘 이하라 상한에 닿지 않는다(check:sample).
// fixtures/proxy.ifc 에 건축 부재 Proxy 를 패밀리 여섯·인스턴스 일곱 더 넣어 본다.
describe('Proxy 리포트 — 읽지 않은 이름 예', () => {
  it('패밀리(끝의 요소 ID 를 뗀 것)로 겹치지 않게 다섯까지만 든다', async () => {
    const path = fileURLToPath(new URL('./fixtures/proxy.ifc', import.meta.url))
    const text = readFileSync(path, 'utf8')
    const extra = ['Bollard:A:7001', 'Bollard:A:7002', 'Canopy:B:7003', 'Planter:C:7004', 'Bench:D:7005', 'Railing:E:7006', 'Kerb:F:7007']
      .map((name, i) => `#${900 + i}= IFCBUILDINGELEMENTPROXY('0PRX$Extra$${String(i).padStart(9, '0')}',$,'${name}',$,$,$,$,'${7001 + i}',$);`)
      .join('\n')
    const at = text.lastIndexOf('ENDSEC;')
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new TextEncoder().encode(`${text.slice(0, at)}${extra}\n${text.slice(at)}`))
    expect(model.facts?.proxies).toEqual({
      total: 10,
      ported: 1,
      named: 1,
      skipped: ['RThisWheelStops850:850', 'Bollard:A', 'Canopy:B', 'Planter:C', 'Bench:D'],
    })
    expect(model.warnings.find((w) => w.startsWith('Proxy('))).toContain('나머지 8개는')
  })
})
