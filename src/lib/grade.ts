// 등급 판정과 수용 기준선(OE-REQ-04 · OE-BIM-21 · OE-GEN-02, PRD 1.8, ADR-0040). D1·D12 는 열린 결정이라 **제안안**으로 둔다(2026-10-09 사용자 결정).
// 제안안은 PRD 1.8 의 지금 판(2026-10-10, D 안)이다:
// - D1 D안: 게이트 = 누적 등급 0~3(미달이면 생성을 막는다), 목표선 = 등급 4(경고만). 통과선 — 등급 0 ≥ 85% · 층 이름 100%,
//   1 ≥ 90%, 2 ≥ 85%, 3 ≥ 60%, 4 ≥ 50%.
// - D12 안(OE-BIM-16): 칩마다 판정에 쓰는 본 숫자는 하나다. 게이트(0~3)는 연 때의 모델(BIM + 계산)로, 목표선(4)은 BIM 포트와 사람이 확정한
//   방향으로 센다. 사용자 보정 후 값(0~3)과 미확정 규칙까지 넣은 값(4)은 "목표에 안 셈" 보조 숫자로만 보이고 판정에 섞지 않는다.
//   계통 종류를 이름 사전으로 맞힌 비율은 등급 3 의 두 번째 숫자가 아니라 따로 센다(`dictKinds`).
// - 원본 BIM 등급과 보정 후 생성 가능 여부는 따로다(PRD 1.8). 등급 칸의 통과·미달은 본 숫자로, [구축하기] 를 막는 게이트(`gate`)는
//   보정 후 값으로 정한다 — 사람이 층 이름을 넣거나 설비를 방 안으로 옮기면 생성은 되고, 원본 등급과 재제출 항목은 그대로 남는다.
// - 분모가 0 인 등급(설비 없는 건축 파일의 1~3)은 "평가 불가" 로 보이고 통과로 적지 않는다(1.8). 생성은 막지 않는다(2026-10-12 사용자 결정 —
//   건축 파일만으로도 구축한다).
// 기준값은 이 파일의 DEFAULT_LINES 하나이고, 화면 설정이 덮을 수 있다(결정이 다르게 나면 숫자만 바꾼다).

import { exteriorDevices } from './exterior'
import { deviceFlows } from './topology'
import { withInferred } from './flow-rules'
import { isConduit, type Model } from './model'

export type GradeLines = { 0: number; 1: number; 2: number; 3: number; 4: number }
/** 1.8 정량 기준(안). 비율(0~1). */
export const DEFAULT_LINES: GradeLines = { 0: 0.85, 1: 0.9, 2: 0.85, 3: 0.6, 4: 0.5 }
/** 게이트 등급(D1 D안). 이 등급까지 모두 통과해야 생성한다. */
export const GATE = 3
/** 목표선 등급(D1 D안). 경고만. */
export const TARGET = 4

export type GradeRow = {
  grade: 0 | 1 | 2 | 3 | 4
  label: string
  /** 무엇을 셌나. */
  measure: string
  have: number
  of: number
  /** 분모가 0 이면 null — 평가 불가. 통과로 적지 않지만 생성을 막지도 않는다(`pass` 는 true). */
  ratio: number | null
  line: number
  pass: boolean
  /** 미달이면 왜인지("80.0% < 85%" · "층 이름 20/21"). 통과면 없다. */
  why?: string
  /**
   * 판정에 안 쓰는 보조 숫자(D12). 본 숫자와 다를 때만 있다. 0~3 은 사용자 보정 후 값(`edit`), 4 는 확정 전 규칙 방향까지 넣은 값(`rule`).
   * `pass` 는 그 값이 통과선을 넘는가다 — `edit` 이면 [구축하기] 게이트가 이것을 본다.
   */
  aux?: { have: number; of: number; ratio: number | null; source: 'edit' | 'rule'; pass: boolean }
  /** 등급 3 의 칩 상세 지표 "계통 종류(사전)" — 이름 사전으로 종류를 맞힌 계통 / 계통. 판정에 쓰지 않는다. */
  dictKinds?: { have: number; of: number; ratio: number | null }
  /** 미달이면 BIM 에 무엇을 넣어 다시 내야 하나(재제출 항목, 1.8 의 "BIM에 필요한 것"). */
  resubmit: string
}

export type GradeReport = {
  rows: GradeRow[]
  /** [구축하기] 게이트(0~3) — 보정 후 값으로 정한다. 평가 불가 등급은 막지 않는다. */
  gate: boolean
  /** 원본 BIM 게이트(0~3) — 본 숫자로 정한다. 보정해서 `gate` 가 열려도 이것은 그대로다. */
  bimGate: boolean
  /** 목표선(4) 도달. */
  target: boolean
  /** 보정 후에도 게이트 미달인 등급([구축하기] 를 막는 이유). */
  failing: GradeRow[]
  /** 원본 BIM 에서 게이트 미달인 등급(재제출 항목). */
  bimFailing: GradeRow[]
}

/**
 * 등급 칩(profile.ts)과 등급 판정이 같이 쓰는 셈. 같은 모델이면 파일 목록·검토 화면 칩·등급 판정·리포트의 숫자가 같다(OE-BIM-16).
 * 설비 쪽 분모는 기기만 센다(덕트·배관 제외). 소속은 외벽 부착 설비를 분모에서 뺀다(OE-EQP-15).
 */
export type GradeCounts = {
  storeys: number
  /** 이름 있는 층. */
  named: number
  spaces: number
  /** 바닥 외곽선 있는 물리존. */
  drawn: number
  devices: number
  /** 좌표 있는 기기. */
  placed: number
  /** 외벽 부착이 아닌 기기(소속 분모). */
  indoor: number
  /** 그중 소속 물리존을 찾은 기기. */
  located: number
  /** 외벽 부착 기기(소속 분모에서 뺀 수). */
  exterior: number
  /** 계통에 든 기기. */
  inSystem: number
  /** 방향으로 이어진 기기 — BIM 포트 방향 + 사람이 확정한 규칙 방향. */
  fed: number
  /** 덕트·배관으로 다른 기기와 이어진 기기. */
  linked: number
  /** 확정 전 규칙 방향까지 넣은 `fed`. 판정에 쓰지 않는다. */
  ruleFed: number
  systems: number
  /** 이름 사전으로 종류를 맞힌 계통. */
  dictKinds: number
}

export function gradeCounts(model: Model): GradeCounts {
  const all = model.storeys.flatMap((s) => s.equipment)
  const devices = all.filter((e) => !isConduit(e.role))
  const spaces = model.storeys.flatMap((s) => s.spaces)
  const exterior = exteriorDevices(model)
  const indoor = devices.filter((e) => !exterior.has(e.id))
  // 방향은 연결이 아니라 기기 쌍으로 센다. DT 가 받는 것은 덕트·배관을 건너뛴 기기 → 기기 흐름이다(deviceFlows).
  const conduitIds = new Set(all.filter((e) => isConduit(e.role)).map((e) => e.id))
  const ids = devices.map((e) => e.id)
  const flows = deviceFlows(withInferred(model.connections, true), (id) => conduitIds.has(id), ids)
  const unconfirmed = model.connections.some((x) => x.inferred && !x.inferred.confirmed)
  return {
    storeys: model.storeys.length,
    named: model.storeys.filter((s) => s.name.trim()).length,
    spaces: spaces.length,
    drawn: spaces.filter((sp) => sp.footprint.length >= 3).length,
    devices: devices.length,
    placed: devices.filter((e) => e.position !== null).length,
    indoor: indoor.length,
    located: indoor.filter((e) => e.spaceId !== null).length,
    exterior: exterior.size,
    inSystem: devices.filter((e) => e.systemId).length,
    fed: flows.fed.size,
    linked: flows.linked.size,
    ruleFed: unconfirmed ? deviceFlows(withInferred(model.connections), (id) => conduitIds.has(id), ids).fed.size : flows.fed.size,
    systems: model.systems.length,
    dictKinds: model.systems.filter((s) => s.kind && s.kindSource === 'dict').length,
  }
}

const ratio = (have: number, of: number) => (of === 0 ? null : have / of)

/**
 * 등급 판정. `original` 은 연 때의 모델(BIM + 계산)을 `gradeCounts` 로 센 것이다 — 게이트 등급(0~3)의 본 숫자가 여기서 나오고,
 * 지금 모델이 다르면 보조 숫자(보정 후)가 붙는다. 없으면 지금 모델이 곧 원본이다(파일 목록처럼 편집이 없을 때).
 */
export function gradeReport(model: Model, lines: GradeLines = DEFAULT_LINES, original?: GradeCounts): GradeReport {
  const now = gradeCounts(model)
  const bim = original ?? now

  // 비율 말고도 걸리는 조건(등급 0 의 층 이름)은 `extra` 로 받는다. 이유를 따로 두지 않으면 막는 글이 "97.1% < 50%" 처럼 비율을 댔다(합성 성수).
  const judge = (have: number, of: number, line: number, extra = { ok: true, why: '' }) => {
    const x = ratio(have, of)
    const lineOk = x === null || x >= line
    const why = !lineOk ? `${percent(x)} < ${Math.round(line * 100)}%` : !extra.ok ? extra.why : undefined
    return { have, of, ratio: x, pass: lineOk && extra.ok, ...(why ? { why } : {}) }
  }
  type Measure = (c: GradeCounts) => { have: number; of: number; extra?: { ok: boolean; why: string } }
  const row = (r: Pick<GradeRow, 'grade' | 'label' | 'measure' | 'line' | 'resubmit'>, pick: Measure): GradeRow => {
    const main = pick(bim)
    const after = pick(now)
    const out: GradeRow = { ...r, ...judge(main.have, main.of, r.line, main.extra) }
    if (after.have !== main.have || after.of !== main.of || (after.extra?.ok ?? true) !== (main.extra?.ok ?? true)) {
      const j = judge(after.have, after.of, r.line, after.extra)
      out.aux = { have: j.have, of: j.of, ratio: j.ratio, source: 'edit', pass: j.pass }
    }
    return out
  }
  const storeyNames = (c: GradeCounts) => ({ ok: c.named === c.storeys, why: `층 이름 ${c.named}/${c.storeys}(이름 없는 층 ${c.storeys - c.named}개)` })
  const rows: GradeRow[] = [
    row(
      { grade: 0, label: '공간 골격', measure: `외곽선 있는 물리존 / IfcSpace · 층 이름 ${bim.named}/${bim.storeys}`, line: lines[0], resubmit: 'R0~R4·R6·R7 — 물리존(IfcSpace) 외곽선과 층 이름' },
      (c) => ({ have: c.drawn, of: c.spaces, extra: storeyNames(c) }),
    ),
    row({ grade: 1, label: '설비 목록', measure: '형상 위 배치점 있는 기기 / 기기', line: lines[1], resubmit: 'R9·R11 — 설비 형상과 배치점' }, (c) => ({ have: c.placed, of: c.devices })),
    row(
      { grade: 2, label: '설비 소속', measure: `소속 물리존 찾은 기기 / 기기(외벽 부착${bim.exterior ? ` ${bim.exterior}대` : ''} 제외)`, line: lines[2], resubmit: 'R12·R1 — 설비가 든 방(IfcSpace 안 배치·포함 관계)' },
      (c) => ({ have: c.located, of: c.indoor }),
    ),
    {
      ...row({ grade: 3, label: '계통·연결망', measure: '계통 소속 기기 / 기기', line: lines[3], resubmit: 'R16·R15 — IfcSystem 과 포트 연결' }, (c) => ({ have: c.inSystem, of: c.devices })),
      dictKinds: { have: now.dictKinds, of: now.systems, ratio: ratio(now.dictKinds, now.systems) },
    },
    // 목표선의 본 숫자는 지금 모델이다 — 사람이 확정한 방향이 본 숫자에 든다. 보조 숫자는 확정 전 규칙 방향까지다.
    (() => {
      const r: GradeRow = {
        grade: 4,
        label: '흐름 방향',
        measure: '방향 아는 기기(BIM 포트 + 사람이 확정) / 연결망 기기',
        line: lines[4],
        resubmit: 'R17 — 포트의 흐름 방향(또는 규칙 방향 확정)',
        ...judge(now.fed, now.linked, lines[4]),
      }
      if (now.ruleFed !== now.fed) {
        const j = judge(now.ruleFed, now.linked, lines[4])
        r.aux = { have: j.have, of: j.of, ratio: j.ratio, source: 'rule', pass: j.pass }
      }
      return r
    })(),
  ]
  const gateRows = rows.filter((r) => r.grade <= GATE)
  const bimFailing = gateRows.filter((r) => !r.pass)
  const failing = gateRows.filter((r) => !(r.aux?.source === 'edit' ? r.aux.pass : r.pass))
  return {
    rows,
    gate: failing.length === 0,
    bimGate: bimFailing.length === 0,
    target: rows.filter((r) => r.grade <= TARGET).every((r) => r.pass),
    failing,
    bimFailing,
  }
}

/** 비율을 화면 글로. */
export const percent = (x: number | null) => (x === null ? '평가 불가' : `${(x * 100).toFixed(1)}%`)
