// 생성 리포트(B-2)·고객사 결과 리포트(B-1)·누락 분류(OE-GEN-07·08, OE-BIM-20). mep.ifc 는 게이트 미달(설비 목록·소속 80%)이다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { requirementsReport } from './requirements'
import { completenessChecks } from './checks'
import { gradeReport } from './grade'
import { customerReportHTML, generationReport, missingClass, sha256Hex, type ReportInput } from './build-report'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const input = (): ReportInput => {
  const model = importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL('./ifc/fixtures/mep.ifc', import.meta.url)))))
  return { fileName: 'mep.ifc', model, grades: gradeReport(model), requirements: requirementsReport(model), checks: completenessChecks(model, []), at: '2026-10-10T03:00:00Z' }
}

describe('누락 분류 (OE-BIM-20)', () => {
  it('다른 자리는 A-설정, 관계만 없는 것은 C-보정, IFC 밖은 X, 부재는 B 이고 표준·해당 없음은 분류하지 않는다 [OE-BIM-20#1~]', () => {
    expect(missingClass({ id: 'R14', state: 'elsewhere' })).toBe('A')
    expect(missingClass({ id: 'R6', state: 'missing' })).toBe('A')
    expect(missingClass({ id: 'R16', state: 'missing' })).toBe('C')
    expect(missingClass({ id: 'R19', state: 'missing' })).toBe('X')
    expect(missingClass({ id: 'R2', state: 'partial' })).toBe('B')
    expect(missingClass({ id: 'R2', state: 'standard' })).toBeNull()
    expect(missingClass({ id: 'R9', state: 'none' })).toBeNull()
    // 모든 요구사항 줄이 분류된다(위반이면 코드가, 아니면 null).
    for (const r of input().requirements) expect(['X', 'A', 'B', 'C', null]).toContain(missingClass(r))
  })
})

describe('생성 리포트 (B-2)', () => {
  it('11항이 모두 있고 비지 않는다 [OE-GEN-07#1]', async () => {
    const i = input()
    const ttl = 'ex:a a brick:Room .'
    const b2 = generationReport({ ...i, outputs: { ttlBytes: ttl.length, triples: 1, entities: 1, unread: 0, hash: await sha256Hex(ttl), geojsonFiles: 1, geojsonFeatures: 3 } })
    expect(b2.map((x) => x.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(b2.map((x) => x.title)).toEqual(['파일 요약', '판정 등급', '자동 생성 범위(출처별)', '요구사항 판정', '보정 항목(C)', '자동 보정 내역', '좌표 정합', 'BIM 밖 항목(X)', '사람 확정 현황', '검증 결과', '산출물'])
    for (const x of b2) expect(x.lines.length).toBeGreaterThan(0)
    expect(b2[1].lines[0]).toContain('게이트(등급 0~3) 미달')
    expect(b2[10].lines[0]).toMatch(/sha256 [0-9a-f]{16}…/)
    // 산출물이 없으면 그 항은 "아직 만들지 않음".
    expect(generationReport(i)[10].lines).toEqual(['아직 만들지 않음'])
  })
})

describe('고객사 결과 리포트 (B-1)', () => {
  it('바깥 자원 없는 HTML 한 파일이고, 재제출 항목(A·B)마다 R 번호와 수정 방법이 붙는다 [OE-GEN-08#1] [OE-REQ-06#1~]', () => {
    const i = input()
    const html = customerReportHTML(i)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).not.toMatch(/<(script|link)\b/)
    const resubmit = i.requirements.filter((r) => ['A', 'B'].includes(missingClass(r) ?? ''))
    expect(resubmit.length).toBeGreaterThan(0)
    const section = html.slice(html.indexOf('5. 재제출 항목'), html.indexOf('6. 보정 항목'))
    for (const r of resubmit) {
      expect(section).toContain(`${r.id} ${r.title}`)
      expect(section).toContain((r.ask || '값을 넣어 달라').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))
    }
    // 게이트 미달이면 다음 단계가 재제출 요청이다.
    expect(html).toContain('재제출 항목(A·B)을 고쳐 다시 보내 주세요')
  })
})
