// 등급 판정·수용 기준선(OE-REQ-04 · OE-BIM-21 · OE-GEN-02, D1·D12 제안안). mep.ifc 는 기기 5대 중 소속 4대(80%)라 게이트(누적 등급 0~3, 등급 2 ≥ 85%) 미달이다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from './ifc/import'
import { DEFAULT_LINES, gradeCounts, gradeReport, percent } from './grade'
import { isConduit } from './model'
import { profileOf } from './profile'

let api: WebIFC.IfcAPI
beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
}, 60_000)
const read = (name: string) => importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url)))))

describe('등급 판정 (D1·D12 제안안)', () => {
  it('등급 0~4 의 지표·통과선, 게이트(등급 0~3) 미달이면 재제출 항목이 그 등급이다 [OE-BIM-21#1~]', () => {
    const m = read('mep.ifc')
    const r = gradeReport(m)
    expect(r.rows.map((x) => [x.grade, x.have, x.of, x.line, x.pass])).toEqual([
      [0, 1, 1, 0.85, true],
      [1, 4, 5, 0.9, false],
      [2, 4, 5, 0.85, false],
      [3, expect.any(Number), 5, 0.6, expect.any(Boolean)],
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

  it('비율은 넘었는데 이름 없는 층이 있으면 등급 0 이 미달이고, 이유는 비율이 아니라 층 이름이다', () => {
    const m = read('mep.ifc')
    expect(gradeReport(m).failing.map((x) => x.why)).toEqual(['80.0% < 90%', '80.0% < 85%'])
    m.storeys[0].name = ' '
    const zero = gradeReport(m).rows[0]
    expect([zero.pass, zero.why]).toEqual([false, '층 이름 0/1(이름 없는 층 1개)'])
  })

  it('기준값을 바꾸면 판정만 바뀐다 — 결정이 다르게 나면 숫자만 바꾼다', () => {
    const m = read('mep.ifc')
    expect(gradeReport(m, { ...DEFAULT_LINES, 1: 0.8, 2: 0.8 }).gate).toBe(true)
  })

  it('등급 0~3 의 본 숫자는 연 때의 BIM+계산 값이고, 사용자 보정은 보조 숫자로만 붙는다. [구축하기] 게이트는 보정 후 값으로 열린다 [OE-BIM-16#2]', () => {
    const m = read('mep.ifc')
    const opened = gradeCounts(m)
    // 보정 전에는 0~3 에 보조 숫자가 없다 — 이름 사전 후보도 본 숫자·보조 숫자에 섞이지 않는다.
    expect(gradeReport(m, DEFAULT_LINES, opened).rows.slice(0, 4).map((x) => x.aux)).toEqual([undefined, undefined, undefined, undefined])
    // 좌표 없는 센서를 사람이 방 안에 놓는다(설비 4/5 → 5/5, 소속 4/5 → 5/5).
    const lost = m.storeys[0].equipment.find((e) => e.position === null && !isConduit(e.role))!
    lost.position = [0, 0, 0]
    lost.spaceId = m.storeys[0].spaces[0].id
    const r = gradeReport(m, DEFAULT_LINES, opened)
    expect(r.rows.slice(1, 3).map((x) => [x.have, x.of, x.pass, x.aux && [x.aux.have, x.aux.of, x.aux.source, x.aux.pass]])).toEqual([
      [4, 5, false, [5, 5, 'edit', true]],
      [4, 5, false, [5, 5, 'edit', true]],
    ])
    expect([r.bimGate, r.gate]).toEqual([false, true])
    expect(r.bimFailing.map((x) => x.grade)).toEqual([1, 2])
    expect(r.failing).toEqual([])
    // 칩도 같은 수다. 본 숫자는 연 때의 값이고 보정 후 값은 따로 든다.
    const tiers = profileOf(m, opened).tiers
    expect(tiers.slice(1, 3).map((t) => [t.figure, t.aux?.figure, t.aux?.source])).toEqual([
      ['4/5 (80.0%)', '5/5 (100.0%)', 'edit'],
      ['4/5 (80.0%)', '5/5 (100.0%)', 'edit'],
    ])
  })

  it('등급 4 의 본 숫자는 BIM 포트와 사람이 확정한 방향만 세고, 미확정 규칙은 보조 숫자다. 확정하면 그만큼 본 숫자로 옮겨 간다 [OE-BIM-16#3]', () => {
    const m = read('mep.ifc')
    const four = () => gradeReport(m).rows[4]
    // 기기 3대가 연결망에 들고, BIM 포트로 방향을 아는 것은 2대다. 규칙 방향(확정 전)까지 넣으면 3대.
    expect([four().have, four().of, four().aux?.have, four().aux?.source]).toEqual([2, 3, 3, 'rule'])
    expect(profileOf(m).tiers[4]).toMatchObject({ figure: '2/3 (66.7%)', aux: { figure: '3/3 (100.0%)', source: 'rule' } })
    expect(profileOf(m).tiers[4].note).toContain('미확정 규칙 방향까지 넣으면 3대(판정 제외)')
    for (const c of m.connections) if (c.inferred) c.inferred.confirmed = true
    expect([four().have, four().of, four().aux]).toEqual([3, 3, undefined])
  })

  it('보조 숫자는 본 숫자와 다를 때만 있고, 칩 숫자에 화살표를 쓰지 않는다 [OE-BIM-16#4]', () => {
    const m = read('mep.ifc')
    const opened = gradeCounts(m)
    const tiers = profileOf(m, opened).tiers
    expect(tiers.filter((t) => t.aux).map((t) => t.key)).toEqual(['direction'])
    for (const t of tiers) expect(`${t.figure} ${t.aux?.figure ?? ''}`).not.toMatch(/→|->|↑/)
    expect(gradeReport(m, DEFAULT_LINES, opened).rows.filter((x) => x.aux).map((x) => x.grade)).toEqual([4])
  })

  it('계통 종류(사전) 비율은 등급 3 의 보조 숫자가 아니라 칩 상세의 별도 지표다 [OE-BIM-16#5]', () => {
    const m = read('mep.ifc')
    // 이 파일의 계통 하나는 PredefinedType 으로 종류를 안다(BIM). 이름 사전으로 맞힌 것으로 바꿔 본다.
    m.systems[0].kindSource = 'dict'
    const three = gradeReport(m).rows[3]
    expect(three.aux).toBeUndefined()
    expect(three.dictKinds).toEqual({ have: 1, of: 1, ratio: 1 })
    const network = profileOf(m).tiers[3]
    expect([network.figure, network.aux]).toEqual(['3/5 (60.0%)', undefined])
    expect(network.note).toContain('계통 종류(사전) 1/1')
  })

  it('기기가 없는 건축 파일은 등급 1~3 이 평가 불가로 보이고 생성을 막지 않는다', () => {
    const r = gradeReport(read('two-rooms.ifc'))
    expect(r.rows.slice(1, 3).map((x) => [x.of, x.ratio, x.pass])).toEqual([
      [0, null, true],
      [0, null, true],
    ])
    expect(r.rows[3].ratio).toBeNull()
    // 평가 불가 등급은 막지 않는다. 이 fixture 는 외곽선이 2/3 이라 등급 0 만 막는다.
    expect(r.failing.map((x) => x.grade)).toEqual([0])
    expect(percent(null)).toBe('평가 불가')
    expect(percent(0.879)).toBe('87.9%')
  })
})
