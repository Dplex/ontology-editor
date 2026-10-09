// 등급 판정과 수용 기준선(OE-REQ-04 · OE-BIM-21 · OE-GEN-02, PRD 1.8, ADR-0040). D1·D12 는 열린 결정이라 **제안안**으로 둔다(2026-10-09 사용자 결정):
// - D1 C안: 게이트 = 등급 2(미달이면 생성을 막는다), 목표선 = 등급 3(경고만). 통과선은 1.8 의 정량 기준(안) — 등급 0 ≥ 85% · 층 이름 100%,
//   1 ≥ 90%, 2 ≥ 85%, 3 ≥ 70%, 4 ≥ 50%.
// - D12 안: 게이트(0~2)는 BIM + 계산만(사전 채움을 넣지 않는다), 목표선(3·4)은 BIM 과 사전 포함 두 수치를 같이 보인다. 판정은 BIM 수치로 한다.
// 기준값은 이 파일의 DEFAULT_LINES 하나이고, 화면 설정이 덮을 수 있다(결정이 다르게 나면 숫자만 바꾼다).

import { exteriorDevices } from './exterior'
import { deviceFlows } from './topology'
import { withInferred } from './flow-rules'
import { isConduit, type Model } from './model'

export type GradeLines = { 0: number; 1: number; 2: number; 3: number; 4: number }
/** 1.8 정량 기준(안). 비율(0~1). */
export const DEFAULT_LINES: GradeLines = { 0: 0.85, 1: 0.9, 2: 0.85, 3: 0.7, 4: 0.5 }
/** 게이트 등급(D1 C안). 이 등급까지 모두 통과해야 생성한다. */
export const GATE = 2
/** 목표선 등급(D1 C안). 경고만. */
export const TARGET = 3

export type GradeRow = {
  grade: 0 | 1 | 2 | 3 | 4
  label: string
  /** 무엇을 셌나. */
  measure: string
  have: number
  of: number
  /** 분모가 0 이면 null(이 파일에 해당 없음 — 통과로 본다). */
  ratio: number | null
  line: number
  pass: boolean
  /** 사전 포함 수치(D12, 목표선 3·4 만). */
  withDictionary?: { have: number; of: number; ratio: number | null }
  /** 미달이면 BIM 에 무엇을 넣어 다시 내야 하나(재제출 항목, 1.8 의 "BIM에 필요한 것"). */
  resubmit: string
}

export type GradeReport = {
  rows: GradeRow[]
  /** 게이트(0~2) 통과. */
  gate: boolean
  /** 목표선(3) 도달. */
  target: boolean
  /** 게이트 미달 등급(재제출 항목). */
  failing: GradeRow[]
}

const ratio = (have: number, of: number) => (of === 0 ? null : have / of)

export function gradeReport(model: Model, lines: GradeLines = DEFAULT_LINES): GradeReport {
  const all = model.storeys.flatMap((s) => s.equipment)
  const devices = all.filter((e) => !isConduit(e.role))
  const spaces = model.storeys.flatMap((s) => s.spaces)
  const drawn = spaces.filter((sp) => sp.footprint.length >= 3).length
  const named = model.storeys.filter((s) => s.name.trim()).length
  const placed = devices.filter((e) => e.position !== null).length
  const exterior = exteriorDevices(model)
  const indoor = devices.filter((e) => !exterior.has(e.id))
  const located = indoor.filter((e) => e.spaceId !== null).length
  // 등급 3: 계통에 든 기기. 사전 포함은 규칙 방향이 고른 계통(확정 전)이 닿는 기기까지.
  const inSystem = new Set(devices.filter((e) => e.systemId).map((e) => e.id))
  const byRule = new Set(inSystem)
  for (const c of model.connections) if (c.inferred) for (const id of [c.from, c.to]) if (devices.some((d) => d.id === id)) byRule.add(id)
  // 등급 4: 방향으로 이어진 기기 / 연결망에 든 기기(profile.ts 의 방향 칩과 같은 셈).
  const conduitIds = new Set(all.filter((e) => isConduit(e.role)).map((e) => e.id))
  const ids = devices.map((e) => e.id)
  const flows = deviceFlows(withInferred(model.connections, true), (id) => conduitIds.has(id), ids)
  const candidate = deviceFlows(withInferred(model.connections), (id) => conduitIds.has(id), ids)

  const row = (r: Omit<GradeRow, 'ratio' | 'pass'>, extraPass = true): GradeRow => {
    const x = ratio(r.have, r.of)
    return { ...r, ratio: x, pass: (x === null || x >= r.line) && extraPass }
  }
  const rows: GradeRow[] = [
    row(
      {
        grade: 0,
        label: '공간 골격',
        measure: `외곽선 있는 물리존 / IfcSpace · 층 이름 ${named}/${model.storeys.length}`,
        have: drawn,
        of: spaces.length,
        line: lines[0],
        resubmit: 'R0~R4·R6·R7 — 물리존(IfcSpace) 외곽선과 층 이름',
      },
      named === model.storeys.length,
    ),
    row({ grade: 1, label: '설비 목록', measure: '형상 위 배치점 있는 기기 / 기기', have: placed, of: devices.length, line: lines[1], resubmit: 'R9·R11 — 설비 형상과 배치점' }),
    row({ grade: 2, label: '설비 소속', measure: '소속 물리존 찾은 기기 / 기기(외벽 부착 제외)', have: located, of: indoor.length, line: lines[2], resubmit: 'R12·R1 — 설비가 든 방(IfcSpace 안 배치·포함 관계)' }),
    {
      ...row({ grade: 3, label: '계통·연결망', measure: '계통 소속 기기 / 기기', have: inSystem.size, of: devices.length, line: lines[3], resubmit: 'R16·R15 — IfcSystem 과 포트 연결' }),
      withDictionary: { have: byRule.size, of: devices.length, ratio: ratio(byRule.size, devices.length) },
    },
    {
      ...row({ grade: 4, label: '흐름 방향', measure: '방향 아는 기기 / 연결망 기기', have: flows.fed.size, of: flows.linked.size, line: lines[4], resubmit: 'R17 — 포트의 흐름 방향(또는 규칙 방향 확정)' }),
      withDictionary: { have: candidate.fed.size, of: flows.linked.size, ratio: ratio(candidate.fed.size, flows.linked.size) },
    },
  ]
  const failing = rows.filter((r) => r.grade <= GATE && !r.pass)
  return { rows, gate: failing.length === 0, target: rows.filter((r) => r.grade <= TARGET).every((r) => r.pass), failing }
}

/** 비율을 화면 글로. */
export const percent = (x: number | null) => (x === null ? '해당 없음' : `${(x * 100).toFixed(1)}%`)
