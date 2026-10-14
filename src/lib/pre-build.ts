// 생성 전 검증(OE-GEN-03)과 feeds 에서 뺀 방향(OE-GEN-04). 결과는 생성 리포트(build-report.ts)의 ⑩ 검증 결과에 들어가고, 차단 항목이
// 하나라도 있으면 [구축하기]·[반영하기]를 막는다(App.vue 의 buildBlock).
//
// 수준은 넷이다. 원본 BIM 의 수용 등급(게이트, grade.ts)과는 따로다 — 그쪽은 받은 파일이 기준을 넘는지, 이쪽은 보정한 편집 모델로 지금
// 온톨로지를 만들 수 있는지다.
// - 차단(block): 만들면 받는 쪽에서 틀린 것이 된다. 한 층 안 방번호 중복(같은 방번호의 두 물리존을 가를 수 없다).
// - 경고(warn): 만들되 그 몫을 출력에서 빼거나 위반으로 남긴다. 물리존이 없는 층, 좌표 없는 설비·배관(GeoJSON 형상 없음), 소속 없는 설비,
//   완전성 검사 위반, 확정하지 않은 규칙 방향. 물리존이 없는 층은 막지 않는다 — 기초·지붕 레벨처럼 방이 없는 층이 가진 BIM 6개 중 5개에
//   있었다(2026-10-14, Duplex T/FDN · 병원 TOF Footing · Office_A Roof …). 막으면 그 BIM 은 구축할 수 없다.
// - 잴 수 없음(unmeasured): 검사할 재료나 규칙이 없다.
// - 통과(pass).

import type { CheckResult } from './checks'
import { isConduit, type Model } from './model'

export type PreBuildLevel = 'block' | 'warn' | 'unmeasured' | 'pass'
export type PreBuildItem = { key: string; label: string; level: PreBuildLevel; detail: string }

export const LEVEL_LABEL: Record<PreBuildLevel, string> = { block: '차단', warn: '경고', unmeasured: '측정 불가', pass: '통과' }

/** feeds 에서 뺀 방향(OE-GEN-04). 사람이 정한 방향·BIM 포트 방향·확정한 규칙 방향만 나가고, 이것들은 화면에만 보인다. */
export function feedsExcluded(m: Model): { unconfirmed: number; recheck: number; released: number } {
  let unconfirmed = 0
  let recheck = 0
  for (const c of m.connections) {
    if (c.directed || c.edited || !c.inferred) continue
    if (!c.inferred.confirmed) unconfirmed++
    else if (c.inferred.recheck !== undefined) recheck++
  }
  return { unconfirmed, recheck, released: m.releasedConnections?.length ?? 0 }
}

const list = (xs: string[], n = 5) => (xs.length > n ? `${xs.slice(0, n).join(', ')} 외 ${xs.length - n}` : xs.join(', '))

export function preBuildChecks(m: Model, checks: readonly CheckResult[]): PreBuildItem[] {
  const items: PreBuildItem[] = []
  const empty = m.storeys.filter((s) => !s.spaces.length).map((s) => s.name || s.id)
  items.push({
    key: 'storey-spaces',
    label: '층마다 물리존이 하나 이상 있다',
    level: empty.length ? 'warn' : 'pass',
    detail: empty.length ? `물리존이 없는 층 ${empty.length}개: ${list(empty)} — TTL 에 층만 나갑니다` : `${m.storeys.length}개 층`,
  })
  const dup: string[] = []
  for (const s of m.storeys) {
    const seen = new Map<string, number>()
    for (const sp of s.spaces) if (sp.name.trim()) seen.set(sp.name.trim(), (seen.get(sp.name.trim()) ?? 0) + 1)
    for (const [name, n] of seen) if (n > 1) dup.push(`${s.name} ${name} ×${n}`)
  }
  items.push({
    key: 'room-number',
    label: '한 층 안에서 방번호가 겹치지 않는다',
    level: dup.length ? 'block' : 'pass',
    detail: dup.length ? `방번호가 겹치는 물리존: ${list(dup)} — 방번호를 수정해야 생성할 수 있습니다` : '겹치는 방번호 없음',
  })
  const all = m.storeys.flatMap((s) => s.equipment)
  const noCoords = all.filter((e) => !e.position)
  items.push({
    key: 'no-coords',
    label: '좌표 없는 설비·배관',
    level: noCoords.length ? 'warn' : 'pass',
    detail: noCoords.length
      ? `설비 ${noCoords.filter((e) => !isConduit(e.role)).length} · 덕트·배관 ${noCoords.filter((e) => isConduit(e.role)).length} — GeoJSON 에 형상 없이 나가고 3D 지도에 그리지 않습니다: ${list(noCoords.map((e) => e.name || e.id))}`
      : '없음',
  })
  const devices = all.filter((e) => !isConduit(e.role) && e.position)
  const homeless = devices.filter((e) => !e.spaceId)
  items.push({
    key: 'membership',
    label: '좌표가 있는 설비가 물리존에 소속된다',
    level: homeless.length ? 'warn' : 'pass',
    detail: homeless.length ? `소속 없는 설비 ${homeless.length}/${devices.length} — TTL 에 층까지만 나갑니다` : `${devices.length}대 전부`,
  })
  items.push({
    key: 'hvac-zones',
    label: '공조존 공백·중복(Z-01~06)',
    level: 'unmeasured',
    detail: '공조존 검증 규칙(OE-ZON-05)이 아직 없어 재지 않았습니다',
  })
  const measured = checks.filter((c) => !c.skipped)
  const violated = measured.filter((c) => c.failed.length)
  items.push({
    key: 'completeness',
    label: `완전성 검사 ${checks.length}규칙`,
    level: violated.length ? 'warn' : measured.length ? 'pass' : 'unmeasured',
    detail: violated.length ? `위반 규칙 ${violated.length}개(위반 ${violated.reduce((n, c) => n + c.failed.length, 0)}건) · 측정 불가 ${checks.length - measured.length}` : `측정 불가 ${checks.length - measured.length}`,
  })
  const ex = feedsExcluded(m)
  const out = ex.unconfirmed + ex.recheck + ex.released
  items.push({
    key: 'unconfirmed-flow',
    label: 'feeds 에서 뺀 방향',
    level: out ? 'warn' : 'pass',
    detail: out ? `확정하지 않은 규칙 방향 ${ex.unconfirmed} · 재검토 중 ${ex.recheck} · 해제 보정한 연결 ${ex.released} — TTL brick:feeds 에 넣지 않았습니다` : '없음',
  })
  return items
}

/** 막는 까닭(차단 항목). 없으면 빈 배열. */
export const blockingOf = (items: readonly PreBuildItem[]) => items.filter((x) => x.level === 'block')
