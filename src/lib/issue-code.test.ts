import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes } from './ifc/import'
import { mergeModels } from './merge'
import { completenessChecks } from './checks'
import { readIdf } from './idf/read'
import { checkCode, issueText, warningCode } from './issue-code'
import type { Model } from './model'

// 누락 분류 코드(OE-BIM-20). 픽스처를 모두 열고 서로 합쳐, 검토 화면에 뜨는 경고와 완전성 검사 규칙마다 코드와 R 번호가 붙는지 본다.
// 실제 BIM 의 경고는 scripts/check-sample.test.ts 가 같은 식으로 본다.

const dir = fileURLToPath(new URL('./ifc/fixtures/', import.meta.url))
let api: WebIFC.IfcAPI
const models = new Map<string, Model>()
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ifc'))) {
    try {
      models.set(f, importIfcWithMeshes(api, new Uint8Array(readFileSync(dir + f))).model)
    } catch {
      // 일부러 깨뜨린 픽스처(R0)는 열리지 않는다.
    }
  }
}, 120_000)

describe('누락 분류 코드 (OE-BIM-20)', () => {
  it('픽스처를 열고 합쳐서 나오는 모든 경고와 IDF 경고, 화면의 미소속 줄에 X/A/B/C 코드와 R 번호가 붙는다 [OE-BIM-20#1]', () => {
    const warnings = new Set<string>()
    for (const m of models.values()) for (const w of m.warnings) warnings.add(w)
    const list = [...models.values()]
    for (const a of list) for (const b of list) if (a !== b) for (const w of mergeModels(a, b, { base: 'A', overlay: 'B' }).model.warnings) warnings.add(w)
    const idfDir = fileURLToPath(new URL('./idf/fixtures/', import.meta.url))
    for (const f of readdirSync(idfDir).filter((x) => x.endsWith('.idf'))) for (const w of readIdf(readFileSync(idfDir + f, 'utf8')).warnings ?? []) warnings.add(w)
    // App.vue 의 미소속 줄(unlocatedLine).
    warnings.add('기기 3대, 덕트·배관 2대는 소속 물리존을 찾지 못했습니다. 위치는 층까지만 내보냅니다.')
    expect(warnings.size).toBeGreaterThan(15)
    expect([...warnings].filter((w) => !warningCode(w))).toEqual([])
  })

  it('완전성 검사 규칙마다 코드와 R 번호가 있다 [OE-BIM-20#1]', () => {
    const keys = new Set([...models.values()].flatMap((m) => completenessChecks(m, []).map((c) => c.key)))
    expect(keys.size).toBeGreaterThanOrEqual(10)
    expect([...keys].filter((k) => !checkCode(k))).toEqual([])
  })

  it('분류는 R 번호로 정해 요구사항 보고서와 같다 — 단위 선언은 A-설정, 외곽선은 B-부재, 연결은 C-보정, 공조존(IDF)은 X-외부', () => {
    expect(issueText(warningCode('길이 단위 선언이 없어 미터로 가정했습니다.')!)).toBe('A-설정 · R6')
    expect(issueText(warningCode('공간 2개에 바닥 외곽선(FootPrint, SweptSolid)이 없습니다(Hallway, Hallway).')!)).toBe('B-부재 · R2')
    expect(issueText(warningCode('설비 3대는 주변 50mm 안에 이어질 부재가 없어 연결하지 못했습니다(접합 부재 누락).')!)).toBe('C-보정 · R15')
    expect(issueText(warningCode('공조존 1개에 바닥면이 없습니다(Z1).')!)).toBe('X-외부 · R19')
    expect(issueText(warningCode('가구·주변 모델 61개는 형상이 없어 추가 공간 오브젝트로 받지 못했습니다.')!)).toBe('B-부재 · R8')
    // 합친 파일의 경고는 이름표가 앞에 붙는다.
    expect(warningCode('[NBU_Duplex-Apt_Arch.ifc] 벽 3장에 내력(LoadBearing) 속성이 없습니다.')?.r).toBe('R22')
    expect(issueText(checkCode('device-space')!)).toBe('B-부재 · R2')
  })
})
