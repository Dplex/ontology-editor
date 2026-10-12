import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { importIfc } from './import'
import { requirementsReport } from '../requirements'

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
      louvers: 0,
      skipped: ['RThisWheelStops850:850', 'Bollard:A', 'Canopy:B', 'Planter:C', 'Bench:D'],
    })
    expect(model.warnings.find((w) => w.startsWith('Proxy('))).toContain('나머지 8개는')
  })
})

// OE-EXT-05. 건축 파일의 루버(차양·외장 마감)는 Proxy 로 들어오고 포트가 없다. 이름이 루버여도 설비로 받지 않고 따로 센다.
describe('포트 없는 건축 루버 Proxy (OE-EXT-05)', () => {
  it('이름이 루버여도 포트가 없으면 설비로 받지 않고, 받지 않은 수를 경고와 요구사항 R23 에 적는다', async () => {
    const path = fileURLToPath(new URL('./fixtures/proxy.ifc', import.meta.url))
    const text = readFileSync(path, 'utf8')
    const extra = ['알루미늄 루버:AL-1:8001', 'Roof Louver:RL:8002']
      .map((name, i) => `#${950 + i}= IFCBUILDINGELEMENTPROXY('0PRX$Louv$${String(i).padStart(10, '0')}',$,'${name}',$,$,$,$,'${8001 + i}',$);`)
      .join('\n')
    const at = text.lastIndexOf('ENDSEC;')
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new TextEncoder().encode(`${text.slice(0, at)}${extra}\n${text.slice(at)}`))
    expect(model.facts?.proxies).toMatchObject({ total: 5, ported: 1, named: 1, louvers: 2 })
    expect(model.storeys.flatMap((s) => s.equipment).filter((e) => /루버|Louver/.test(e.name))).toEqual([])
    const warning = model.warnings.find((w) => w.startsWith('Proxy('))!
    expect(warning).toContain('이름이 루버이지만 포트가 없는 2개는 건축 루버(차양·외장 마감)로 보고 설비로 받지 않았습니다')
    // 휠스톱 하나는 그대로 "건축 부재" 쪽에 센다.
    expect(warning).toContain('나머지 1개는 포트도 없고 이름도 사전에 없어')
    expect(requirementsReport(model).find((r) => r.id === 'R23')!.note).toContain('포트가 없는 2개는 건축 루버')
  })
})
