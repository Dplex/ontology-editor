// 등급 판정·수용 기준선(OE-REQ-04 · OE-BIM-21 · OE-GEN-02, D1·D12 제안안). mep.ifc 는 기기 5대 중 소속 4대(80%)라 게이트(등급 2 ≥ 85%) 미달이다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { DEFAULT_LINES, gradeReport, percent } from './grade'
import { profileOf } from './profile'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (name: string) => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))

describe('등급 판정 (D1·D12 제안안)', () => {
  it('등급 0~4 의 지표·통과선, 게이트(등급 2) 미달이면 재제출 항목이 그 등급이다 [OE-REQ-04#1~] [OE-BIM-21#1~]', () => {
    const m = read('mep.ifc')
    const r = gradeReport(m)
    expect(r.rows.map((x) => [x.grade, x.have, x.of, x.line, x.pass])).toEqual([
      [0, 1, 1, 0.85, true],
      [1, 4, 5, 0.9, false],
      [2, 4, 5, 0.85, false],
      [3, expect.any(Number), 5, 0.7, expect.any(Boolean)],
      [4, expect.any(Number), expect.any(Number), 0.5, expect.any(Boolean)],
    ])
    expect(r.gate).toBe(false)
    expect(r.failing.map((x) => [x.grade, x.resubmit])).toEqual([
      [1, 'R9·R11 — 설비 형상과 배치점'],
      [2, 'R12·R1 — 설비가 든 방(IfcSpace 안 배치·포함 관계)'],
    ])
    // 칩(profile.ts)과 같은 수를 센다(OE-BIM-16 "같은 임포터로 계산해 수치가 같다").
    const tiers = new Map(profileOf(m).tiers.map((t) => [t.key, t]))
    expect([r.rows[1].have, r.rows[1].of, r.rows[2].have, r.rows[2].of]).toEqual([tiers.get('equipment')!.have, tiers.get('equipment')!.of, tiers.get('location')!.have, tiers.get('location')!.of])
  })

  it('기준값을 바꾸면 판정만 바뀐다 — 결정이 다르게 나면 숫자만 바꾼다', () => {
    const m = read('mep.ifc')
    expect(gradeReport(m, { ...DEFAULT_LINES, 1: 0.8, 2: 0.8 }).gate).toBe(true)
  })

  it('목표선(3·4)은 BIM 과 사전 포함 두 수치를 같이 내고, 게이트(0~2)에는 사전 수치가 없다 [OE-BIM-16#2~]', () => {
    const r = gradeReport(read('mep.ifc'))
    expect(r.rows.filter((x) => x.withDictionary).map((x) => x.grade)).toEqual([3, 4])
    for (const x of r.rows.filter((x) => x.withDictionary)) expect(x.withDictionary!.have).toBeGreaterThanOrEqual(x.have)
  })

  it('기기가 없는 건축 파일은 등급 1·2 가 해당 없음이라 막지 않는다', () => {
    const r = gradeReport(read('two-rooms.ifc'))
    expect(r.rows.slice(1, 3).map((x) => [x.of, x.ratio, x.pass])).toEqual([
      [0, null, true],
      [0, null, true],
    ])
    expect(percent(null)).toBe('해당 없음')
    expect(percent(0.879)).toBe('87.9%')
  })
})
