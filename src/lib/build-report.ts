// 생성 리포트(B-2, OE-GEN-07)·고객사 결과 리포트(B-1, OE-GEN-08)·누락 분류 코드(OE-BIM-20).
//
// 누락 분류(PRD 1.8): X-외부(IFC 에 자리 없음 — 공조존·관제점) · A-설정(내보내기 설정으로 고침 → 재제출) · B-부재(부재 자체가 없음 → 재제출) ·
// C-보정(관계만 없음 → 계산·사전으로 채우고 사람이 확인). 요구사항 줄의 상태와 R 번호로 가른다.
// 두 리포트는 같은 재료(모델·등급 판정·요구사항·완전성 검사·산출물)에서 만든다. B-2 는 화면과 반영 버전(report.json)에, B-1 은 고객사에 보낼 HTML 이다.

import type { CheckResult } from './checks'
import { CONNECTION_CLASS_LABEL, connectionClass } from './connection-class'
import type { GradeReport } from './grade'
import { percent } from './grade'
import { countOf, isConduit, type Model } from './model'
import type { RequirementRow } from './requirements'

export type MissingClass = 'X' | 'A' | 'B' | 'C'
export const MISSING_LABEL: Record<MissingClass, string> = { X: 'X-외부', A: 'A-설정', B: 'B-부재', C: 'C-보정' }

/** IFC 에 자리가 없는 것(공조존은 IDF, 센서 측정 대상은 BAS). */
const EXTERNAL = new Set(['R19', 'R20'])
/** 내보내기 설정으로 고치는 것(단위 선언·원점·좌표계·GUID 유지·IFC4·Proxy). 다른 자리(elsewhere)도 늘 설정이다. */
const SETTING = new Set(['R6', 'R7', 'R10', 'R12', 'R13', 'R23'])
/** 관계만 없는 것 — 계산·사전으로 채우고 사람이 확인한다. */
const RELATION = new Set(['R5', 'R11', 'R14', 'R15', 'R16', 'R17', 'R18', 'R21', 'R22', 'R24'])

/** 요구사항 줄의 누락 분류. 표준·해당 없음·잴 수 없음이면 null. */
export function missingClass(row: Pick<RequirementRow, 'id' | 'state'>): MissingClass | null {
  if (row.state === 'standard' || row.state === 'none' || row.state === 'unmeasured') return null
  if (EXTERNAL.has(row.id)) return 'X'
  if (row.state === 'elsewhere' || SETTING.has(row.id)) return 'A'
  if (RELATION.has(row.id)) return 'C'
  return 'B'
}

export type ReportInput = {
  fileName: string
  model: Model
  grades: GradeReport
  requirements: readonly RequirementRow[]
  checks: readonly CheckResult[]
  /** 산출물(⑪). 없으면 그 항에 "아직 만들지 않음". */
  outputs?: { ttlBytes: number; triples: number; entities: number; unread: number; hash: string; geojsonFiles: number; geojsonFeatures: number } | null
  /** 만든 시각(ISO). */
  at: string
}

export type ReportSectionB = { no: number; title: string; lines: string[] }

const STATE: Record<string, string> = { standard: '표준 자리', elsewhere: '다른 자리', partial: '일부', missing: '없음', none: '해당 없음', unmeasured: '잴 수 없음' }
/** 위반 줄 한 줄: 상태와 개수, 요청. R 의 설명(note)은 무엇을 셌는지라 문제처럼 읽히지 않아 쓰지 않는다. */
const problem = (r: RequirementRow, fallback: string) =>
  `${r.id} ${r.title}: ${STATE[r.state] ?? r.state}${r.counts && r.counts.of ? ` ${r.counts.standard + r.counts.elsewhere}/${r.counts.of}` : ''} — ${r.ask || fallback}`

const count = <T,>(xs: readonly T[], key: (x: T) => string | null | undefined) => {
  const m = new Map<string, number>()
  for (const x of xs) {
    const k = key(x) ?? '없음'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'
}

/** 생성 리포트(B-2) 11항. 빈 항은 "해당 없음" 줄을 둔다 — 11항이 늘 채워져 있다. */
export function generationReport(input: ReportInput): ReportSectionB[] {
  const { model, grades, requirements, checks, outputs } = input
  const c = countOf(model)
  const all = model.storeys.flatMap((s) => s.equipment)
  const devices = all.filter((e) => !isConduit(e.role))
  const spaces = model.storeys.flatMap((s) => s.spaces)
  const classed = requirements.map((r) => ({ r, cls: missingClass(r) }))
  const req = (ids: string[]) => requirements.filter((r) => ids.includes(r.id)).map((r) => `${r.id} ${r.title}: ${r.state === 'standard' ? '표준' : r.note || r.state}`)
  const or = (lines: string[], none: string) => (lines.length ? lines : [none])
  const sections: ReportSectionB[] = [
    {
      no: 1,
      title: '파일 요약',
      lines: [
        `${input.fileName} · ${model.schema} · ${model.buildingName || '(건물 이름 없음)'}`,
        `층 ${c.storeys} · 물리존 ${c.spaces} · 기기 ${devices.length} · 덕트·배관 ${c.conduits} · 계통 ${c.systems} · 연결 ${c.connections}`,
        `만든 때 ${input.at}`,
      ],
    },
    {
      no: 2,
      title: '판정 등급',
      lines: [
        `게이트(등급 2) ${grades.gate ? '통과' : '미달'} · 목표선(등급 3) ${grades.target ? '도달' : '미도달'} (D1·D12 제안안)`,
        ...grades.rows.map((r) => `등급 ${r.grade} ${r.label}: ${percent(r.ratio)}${r.withDictionary ? ` (사전 포함 ${percent(r.withDictionary.ratio)})` : ''} / 통과선 ${Math.round(r.line * 100)}% ${r.pass ? '통과' : '미달'}`),
      ],
    },
    {
      no: 3,
      title: '자동 생성 범위(출처별)',
      lines: [
        `물리존 외곽선: BIM ${spaces.filter((sp) => sp.footprint.length >= 3 && !sp.added).length} · 편집 ${spaces.filter((sp) => sp.added).length} · 없음 ${spaces.filter((sp) => sp.footprint.length < 3).length}`,
        `설비 소속: ${count(devices, (e) => (e.spaceSource === 'bim' ? 'BIM' : e.spaceSource === 'computed' ? '계산' : e.spaceSource === 'edit' ? '편집' : null))}`,
        `설비 종류: ${count(devices, (e) => (e.kindSource === 'bim' ? 'BIM' : e.kindSource === 'dict' ? '사전' : e.kindEdited ? '편집' : e.kind ? 'BIM' : null))}`,
        `연결: ${count(model.connections, (x) => CONNECTION_CLASS_LABEL[connectionClass(x)])}`,
      ],
    },
    {
      no: 4,
      title: '요구사항 판정',
      lines: or(
        classed.filter((x) => x.cls).map(({ r, cls }) => `${MISSING_LABEL[cls!]} · ${r.id} ${r.title}(${r.level}) — ${r.ask || r.note}`),
        '모든 요구사항이 표준 자리에 있거나 해당이 없습니다',
      ),
    },
    {
      no: 5,
      title: '보정 항목(C)',
      lines: or(classed.filter((x) => x.cls === 'C').map(({ r }) => problem(r, '계산·사전으로 채우고 사람이 확인합니다')), '보정할 관계가 없습니다'),
    },
    {
      no: 6,
      title: '자동 보정 내역',
      lines: [
        `배치점을 형상 중심으로 옮긴 설비 ${devices.filter((e) => e.positionSource === 'geometry').length}`,
        `좌표로 소속을 계산한 설비 ${devices.filter((e) => e.spaceSource === 'computed').length}`,
        `이름 사전으로 종류를 정한 설비 ${devices.filter((e) => e.kindSource === 'dict').length}`,
        `형상이 맞닿아 추정한 연결 ${model.connections.filter((x) => x.source === 'geometry').length}`,
      ],
    },
    { no: 7, title: '좌표 정합', lines: or(req(['R6', 'R7', 'R12']), '해당 없음') },
    {
      no: 8,
      title: 'BIM 밖 항목(X)',
      lines: [
        ...classed.filter((x) => x.cls === 'X').map(({ r }) => problem(r, 'IFC 밖(IDF·BAS)에서 받습니다')),
        `공조존: ${model.storeys.some((s) => s.hvacZones?.length) ? '있음' : '없음'}(IDF 또는 공조존 도구로 수동) · 관제점(BAS): 에디터 밖`,
      ],
    },
    {
      no: 9,
      title: '사람 확정 현황',
      lines: [
        `사람이 정한 소속 ${devices.filter((e) => e.spaceSet).length} · 고친 종류 ${devices.filter((e) => e.kindEdited).length}`,
        `사람이 이은 연결 ${model.connections.filter((x) => x.source === 'manual').length} · 직접 정한 방향 ${model.connections.filter((x) => x.edited).length} · 확정한 규칙 방향 ${model.connections.filter((x) => x.inferred?.confirmed).length}`,
        `해제 보정한 BIM 연결 ${model.releasedConnections?.length ?? 0}`,
      ],
    },
    {
      no: 10,
      title: '검증 결과',
      lines: or(
        checks.map((x) => (x.skipped ? `${x.rule}: 잴 수 없음(${x.skipped})` : `${x.rule}: ${x.total - x.failed.length}/${x.total}${x.failed.length ? ` — 어김 ${x.failed.length}` : ''}`)),
        '검사 없음',
      ),
    },
    {
      no: 11,
      title: '산출물',
      lines: outputs
        ? [
            `TTL ${(outputs.ttlBytes / 1024).toFixed(0)}KB · 트리플 ${outputs.triples} · 엔티티 ${outputs.entities} · sha256 ${outputs.hash.slice(0, 16)}…`,
            `GeoJSON ${outputs.geojsonFiles}파일 · 피처 ${outputs.geojsonFeatures}`,
            `파서 확인: 이 repo 의 TTL 리더로 다시 읽음(읽지 않는 블록 ${outputs.unread})`,
          ]
        : ['아직 만들지 않음'],
    },
  ]
  return sections
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 고객사 결과 리포트(B-1) HTML. 한 파일이고 바깥 자원을 쓰지 않는다(메일로 보내도 열리게). 재제출 항목(A·B)은 R 번호와 수정 방법이 붙는다(OE-REQ-06 문구).
 */
export function customerReportHTML(input: ReportInput): string {
  const b2 = generationReport(input)
  const sec = (no: number) => b2.find((x) => x.no === no)!.lines
  const rows = input.requirements.map((r) => ({ r, cls: missingClass(r) }))
  const resubmit = rows.filter((x) => x.cls === 'A' || x.cls === 'B')
  const fix = rows.filter((x) => x.cls === 'C')
  const list = (lines: string[]) => `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
  const next = input.grades.gate
    ? '수용 기준선을 넘었습니다. 온톨로지를 만들 수 있습니다. 아래 재제출·보정 항목을 다음 판본에 반영해 주시면 자동으로 채우는 범위가 넓어집니다.'
    : '수용 기준선(게이트 등급 2)에 미치지 못해 온톨로지를 만들지 않았습니다. 아래 재제출 항목(A·B)을 고쳐 다시 보내 주세요.'
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BIM 결과 리포트 — ${esc(input.fileName)}</title>
<style>
body{font-family:system-ui,'Malgun Gothic',sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1f2430;line-height:1.55}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:1.6rem;border-bottom:1px solid #d5d9e0;padding-bottom:.2rem}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{border-bottom:1px solid #e3e6eb;padding:.3rem .4rem;text-align:left;vertical-align:top}
.cls{font-weight:600}.A,.B{color:#b45309}.C{color:#1d4ed8}.X{color:#6b7280}.pass{color:#15803d}.fail{color:#b45309}
</style></head><body>
<h1>BIM 결과 리포트</h1>
<p>${esc(input.fileName)} · ${esc(input.at)}</p>
<h2>1. 파일 요약</h2>${list(sec(1).slice(0, 2))}
<h2>2. 등급</h2><p class="${input.grades.gate ? 'pass' : 'fail'}">${esc(sec(2)[0])}</p>${list(sec(2).slice(1))}
<h2>3. 자동 생성 범위</h2>${list(sec(3))}
<h2>4. 요구사항 판정과 수정 방법</h2>
<table><thead><tr><th>R</th><th>요구</th><th>구분</th><th>상태</th><th>분류</th><th>요청</th></tr></thead><tbody>
${rows.map(({ r, cls }) => `<tr><td>${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.level)}</td><td>${esc(STATE[r.state] ?? r.state)}</td><td class="cls ${cls ?? ''}">${cls ? esc(MISSING_LABEL[cls]) : '—'}</td><td>${esc(r.ask || '—')}</td></tr>`).join('\n')}
</tbody></table>
<h2>5. 재제출 항목(A·B)</h2>${resubmit.length ? list(resubmit.map(({ r, cls }) => `${MISSING_LABEL[cls!]} · ${problem(r, '값을 넣어 달라')}`)) : '<p>없음</p>'}
<h2>6. 보정 항목(C)</h2>${fix.length ? list(fix.map(({ r }) => problem(r, '계산·사전으로 채우고 사람이 확인합니다'))) : '<p>없음</p>'}
<h2>7. 자동 보정</h2>${list(sec(6))}
<h2>8. 좌표 정합</h2>${list(sec(7))}
<h2>9. BIM 밖 항목</h2>${list(sec(8))}
<h2>10. 다음 단계</h2><p>${esc(next)}</p>
</body></html>`
}

/** sha256(16진). 산출물 해시(⑪). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
