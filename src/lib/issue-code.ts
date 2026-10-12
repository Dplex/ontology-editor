// 검토 화면의 경고·완전성 위반마다 누락 분류 코드(X/A/B/C, PRD 1.8)와 요구사항 R 번호(OE-BIM-20). "A-설정 · R6" 처럼 붙인다.
// 분류는 R 번호로 정한다(build-report.ts 의 missingClass 와 같은 규칙) — 같은 R 이 경고와 요구사항 보고서에서 다른 분류가 되지 않게.
// 경고는 임포터(ifc/import.ts)·합치기(merge.ts)·IDF(idf/read.ts)·화면(App.vue 의 미소속 줄)이 문장으로 낸다. 문장마다 R 을 표로 댄다.
// 표에 없는 경고가 생기면 issue-code.test.ts 가 가진 모든 픽스처·합치기에서 잡는다.

import { MISSING_LABEL, missingClass, type MissingClass } from './build-report'

export type IssueCode = { cls: MissingClass; r: string }

const codeOf = (r: string): IssueCode => ({ cls: missingClass({ id: r, state: 'partial' })!, r })

/** 경고 문장 → R. 위에서부터 처음 맞는 것. 더 구체적인 문장을 위에 둔다. */
const WARNING_R: readonly (readonly [RegExp, string])[] = [
  [/층의 높이가 .*길이 단위 선언/, 'R6'],
  [/길이 단위 선언/, 'R6'],
  [/좌표계\(원점·북방향\)/, 'R12'],
  [/이름은 같은데 높이가 다른 층/, 'R12'],
  [/새 층으로 넣었습니다/, 'R1'],
  [/같은 자리에 같은 방이 두 번/, 'R3'],
  [/설비 소속 .*물리존을 찾지 못해/, 'R3'],
  [/같은 GlobalId/, 'R13'],
  [/바닥 외곽선\(FootPrint/, 'R2'],
  [/소속 물리존을 찾지 못했습니다/, 'R2'],
  [/재료 구성이 없어 두께/, 'R4'],
  [/어느 벽에 있는지 알 수 없습니다/, 'R4'],
  [/공간 경계\(IfcRelSpaceBoundary\)/, 'R5'],
  [/내력\(LoadBearing\)/, 'R22'],
  [/배치점이 형상에서/, 'R11'],
  [/분전반 안 부품/, 'R11'],
  [/좌표가 없습니다/, 'R11'],
  [/용량 파라미터/, 'R21'],
  [/계통\(IfcSystem\)이 없습니다/, 'R16'],
  [/포트\(IfcDistributionPort\)가 없어/, 'R15'],
  [/허용 거리를 최대/, 'R15'],
  [/이어질 부재가 없어/, 'R15'],
  [/Proxy\(IfcBuildingElementProxy\)/, 'R23'],
  [/포트에 방향이 없는 연결/, 'R17'],
  [/계단 .*다른 층에 닿지 않아/, 'R8'],
  // IDF(공조존). IFC 밖의 자료라 X 다.
  [/바닥면/, 'R19'],
  [/이상 부하 장치/, 'R19'],
]

/** 완전성 검사 규칙(checks.ts 의 key) → R. */
const CHECK_R: Readonly<Record<string, string>> = {
  'terminal-source': 'R18',
  'source-terminal': 'R18',
  'terminal-single-source': 'R18',
  'device-space': 'R2',
  'device-connected': 'R15',
  'conduit-ends': 'R15',
  'conduit-path': 'R15',
  'heat-source-user': 'R15',
  'hydronic-user-source': 'R15',
  'sprinkler-fp': 'R16',
}

export function warningCode(text: string): IssueCode | null {
  const hit = WARNING_R.find(([re]) => re.test(text))
  return hit ? codeOf(hit[1]) : null
}

export function checkCode(key: string): IssueCode | null {
  const r = CHECK_R[key]
  return r ? codeOf(r) : null
}

/** 화면 칩의 글. "A-설정 · R6" */
export const issueText = (c: IssueCode) => `${MISSING_LABEL[c.cls]} · ${c.r}`
