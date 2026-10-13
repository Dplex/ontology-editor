// 규칙 기반 경고(OE-P3-01~04). 편집 결과가 사이트 규칙을 어기면 미리보기(OE-WF-07)에서 경고한다. 막지 않는다. 좌표·개수만으로 가를 수 있는 규칙만이다.
// - W-01 물리존 최소 면적: N㎡ 미만. N 은 사이트 설정(기본 2㎡ — 가진 BIM 의 가장 작은 실(창고·PS)이 2㎡ 안팎이라 그보다 작은 것은 그리다 생긴 조각일 공산이 크다).
// - W-02 설비 0개 물리존: 소속 설비(덕트·배관 빼고)가 없다. 켜고 끈다.
// - W-03 공조존 미매핑 물리존: OE-MAP-04 의 Z-01 과 같은 판정(공조존이 있는 층에서 어느 공조존도 담당하지 않는 물리존). 켜고 끈다.

import { zoneChecks } from './hvac-zone'
import { isConduit, type Model } from './model'

export type SiteRules = { minAreaM2: number; emptySpace: boolean; unmappedSpace: boolean }
export const DEFAULT_SITE_RULES: SiteRules = { minAreaM2: 2, emptySpace: true, unmappedSpace: true }

export type RuleWarning = { rule: 'W-01' | 'W-02' | 'W-03'; text: string; items: { id: string; label: string }[] }

export function siteWarnings(model: Model, rules: SiteRules = DEFAULT_SITE_RULES): RuleWarning[] {
  const label = (storey: string, sp: { name: string; longName: string }) => `${storey} ${sp.longName || sp.name || '(이름 없음)'}`
  const spaces = model.storeys.flatMap((s) => s.spaces.map((sp) => ({ sp, storey: s.name })))
  const out: RuleWarning[] = []
  const small = spaces.filter(({ sp }) => sp.areaM2 < rules.minAreaM2)
  if (small.length) out.push({ rule: 'W-01', text: `물리존 면적이 ${rules.minAreaM2}㎡ 미만`, items: small.map(({ sp, storey }) => ({ id: sp.id, label: `${label(storey, sp)} ${sp.areaM2.toFixed(2)}㎡` })) })
  if (rules.emptySpace) {
    const used = new Set(model.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role) && e.spaceId).map((e) => e.spaceId))
    const empty = spaces.filter(({ sp }) => !used.has(sp.id))
    if (empty.length) out.push({ rule: 'W-02', text: '설비가 하나도 없는 물리존', items: empty.map(({ sp, storey }) => ({ id: sp.id, label: label(storey, sp) })) })
  }
  if (rules.unmappedSpace) {
    const names = new Map(spaces.map(({ sp }) => [sp.id, sp.longName || sp.name]))
    const z01 = zoneChecks(model, { space: (id) => names.get(id) ?? id, equipment: (id) => id }).checks.find((c) => c.rule === 'Z-01')
    if (z01?.items.length) out.push({ rule: 'W-03', text: '어느 공조존에도 속하지 않는 물리존(Z-01)', items: z01.items })
  }
  return out
}
