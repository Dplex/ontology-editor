// BIM 필수 요구를 어긴 요소 목록 — 설계사가 원본 BIM 에서 그 요소를 찾아 고치게 한다(ADR-0051).
// 고객사 결과 리포트(build-report.ts, OE-GEN-08)는 R 번호마다 개수까지만 말한다. 여기는 요소 하나하나를 GlobalId · Revit 요소 ID ·
// 층 · R 번호 · 누락 분류(X/A/B/C)로 적는다. CSV(엑셀로 열림)와 BCF(export/bcf.ts — BIM 이슈 표준, 받는 도구에서 그 요소로 바로 감)로 낸다.
//
// 요소를 고르는 조건은 requirements.ts 의 R 마다 센 조건과 같다. 개수가 요구사항 보고서의 "대상 − 표준 자리" 와 다르면
// issue-list.test.ts 가 실패한다(조건을 한쪽만 고치면 리포트의 수와 목록의 수가 어긋난다).
// 완전성 검사(checks.ts)의 어긴 요소도 같이 싣는다. R 은 issue-code.ts 의 표를 쓴다.
// 사람이 더한 요소(added)는 BIM 에 없으니 싣지 않는다.

import { missingClass, MISSING_LABEL, type MissingClass } from './build-report'
import { CAPACITY_KINDS, isStandardCapacity } from './capacity'
import type { CheckResult } from './checks'
import { checkCode } from './issue-code'
import { equipmentKind, equipmentKindOfIfc } from './kinds'
import { isPlaceholder } from './merge'
import { isConduit, type Equipment, type Model, type Opening, type Space, type Storey, type Vec3, type Wall } from './model'
import { labelPoint } from './polygon'
import { isStandardPredefined, type RequirementRow } from './requirements'
import { revitElementId } from './versions'

export type IssueItem = {
  /** R 번호(R4) 또는 완전성 검사 열쇠에서 온 R. */
  r: string
  cls: MissingClass
  /** 규칙 — 요구사항 제목이나 완전성 검사 문장. */
  rule: string
  /** 이 요소에 무엇이 없는지. */
  problem: string
  /** 'missing' 은 BIM 에 없음, 'elsewhere' 는 다른 자리에 있음(내보내기 설정으로 고침). */
  kind: 'missing' | 'elsewhere'
  /** 모델 id. BIM 에서 온 것은 IfcGlobalId 다. */
  id: string
  revitId: string | null
  name: string
  ifcClass: string
  storey: string
  /** 세계 좌표(m). 모르면 null. */
  at: Vec3 | null
  /** 고객사에 할 요청(요구사항 줄의 ask). */
  ask: string
}

type Hit = { el: Element; problem: string; kind?: IssueItem['kind'] }
type Element =
  | { type: 'space'; v: Space; storey: Storey }
  | { type: 'opening'; v: Opening; storey: Storey }
  | { type: 'wall'; v: Wall; storey: Storey }
  | { type: 'equipment'; v: Equipment; storey: Storey }

const OPENING_CLASS = { door: 'Door', window: 'Window' } as const

function describeEl(el: Element): Pick<IssueItem, 'id' | 'revitId' | 'name' | 'ifcClass' | 'storey' | 'at'> {
  const { v, storey } = el
  const base = { id: v.id, storey: storey.name }
  if (el.type === 'space') {
    const p = el.v.footprint.length >= 3 ? labelPoint(el.v.footprint) : null
    const name = [el.v.name, el.v.longName].filter((x) => x.trim()).join(' ')
    return { ...base, name, revitId: revitElementId(el.v.longName) ?? revitElementId(el.v.name), ifcClass: 'Space', at: p ? [p[0], p[1], storey.elevation] : null }
  }
  if (el.type === 'opening') return { ...base, name: el.v.name, revitId: revitElementId(el.v.name), ifcClass: OPENING_CLASS[el.v.kind as keyof typeof OPENING_CLASS] ?? 'Opening', at: el.v.position ?? null }
  if (el.type === 'wall') {
    const ring = el.v.footprint?.[0]
    const p = ring && ring.length >= 3 ? labelPoint(ring) : null
    return { ...base, name: el.v.name, revitId: revitElementId(el.v.name), ifcClass: 'Wall', at: p ? [p[0], p[1], storey.elevation] : null }
  }
  return { ...base, name: el.v.name, revitId: revitElementId(el.v.name), ifcClass: el.v.ifcClass, at: el.v.position }
}

/**
 * R 마다 표준 자리에 없는 요소. requirements.ts 의 같은 R 이 센 조건을 그대로 쓴다. 잴 수 없거나(벽을 읽지 않음 등) 요소로 가를 수
 * 없는 R(단위·좌표계·IFC 버전·GUID 유지 등)은 여기 없다 — 그것은 파일 하나에 대한 말이라 리포트(HTML)에 있다.
 */
export function requirementHits(model: Model): Map<string, Hit[]> {
  const out = new Map<string, Hit[]>()
  const add = (r: string, el: Element, problem: string, kind: IssueItem['kind'] = 'missing') => {
    if ('added' in el.v && el.v.added) return
    const list = out.get(r) ?? []
    list.push({ el, problem, kind })
    out.set(r, list)
  }
  const skipped = new Set(model.skipped ?? [])
  const systemById = new Map(model.systems.map((s) => [s.id, s]))
  for (const storey of model.storeys) {
    for (const v of storey.spaces) {
      const el = { type: 'space', v, storey } as const
      if (v.footprint.length < 3) add('R2', el, '바닥 외곽선(FootPrint·SweptSolid)이 없다')
      if (!(v.name.trim() && v.longName.trim())) add('R3', el, !v.name.trim() && !v.longName.trim() ? '방 번호(Name)·이름(LongName)이 없다' : !v.name.trim() ? '방 번호(Name)가 없다' : '방 이름(LongName)이 없다')
      else if (isPlaceholder(v)) add('R3', el, `방 이름이 기본값("${v.longName}")이다`)
      if (v.boundedBy.length === 0) add('R5', el, '공간 경계(IfcRelSpaceBoundary)가 없다')
      if (!(v.omniclass && v.omniclassSource === 'classification')) {
        if (v.omniclass && v.omniclassSource === 'property') add('R14', el, 'OmniClass 가 Revit 속성(Category Code)에만 있다', 'elsewhere')
        else add('R14', el, 'OmniClass Table 13 코드가 없다')
      }
    }
    if (!(skipped.has('walls') || (skipped.has('doors') && skipped.has('windows')))) {
      for (const v of storey.openings) if (v.wallId === null) add('R4', { type: 'opening', v, storey }, '어느 벽에 있는지(IfcRelFillsElement)가 없다')
    }
    if (!skipped.has('walls')) {
      for (const v of storey.walls) if (v.loadBearing === null) add('R22', { type: 'wall', v, storey }, '내력 여부(Pset_WallCommon.LoadBearing)가 없다')
    }
    for (const v of storey.equipment) {
      const el = { type: 'equipment', v, storey } as const
      // R16 은 덕트·배관까지 센다(requirements.ts 의 all)
      const sys = v.systemId ? systemById.get(v.systemId) : undefined
      if (sys?.source !== 'ifc') {
        if (sys?.source === 'property') add('R16', el, '계통이 IfcSystem 이 아니라 속성(System Name)에만 있다', 'elsewhere')
        else add('R16', el, '계통(IfcSystem)에 들지 않았다')
      }
      if (isConduit(v.role)) continue
      if (v.position === null) add('R11', el, '위치가 없다(미배치)')
      else if (v.positionSource === 'geometry') add('R11', el, '배치점이 형상과 떨어져 있어 형상 중심을 썼다')
      else if (v.positionSource === 'panel') add('R11', el, '위치가 없어 분전반 자리로 짐작했다')
      if (!(equipmentKindOfIfc(v.declaredType) || isStandardPredefined(v.declaredType))) {
        if (v.kind) add('R24', el, 'IFC 에 종류가 없어 패밀리 이름으로 정했다', 'elsewhere')
        else add('R24', el, 'IFC 에도 이름에도 종류가 없다')
      }
      if (v.ifcClass === 'BuildingElementProxy') add('R23', el, 'IfcBuildingElementProxy 로 내보냈다', 'elsewhere')
      if (CAPACITY_KINDS.has(equipmentKind(v.kind)?.kind ?? '') && !(v.capacity !== null && isStandardCapacity(v.capacityProperty))) {
        if (v.capacity !== null) add('R21', el, `용량이 표준 속성이 아닌 곳(${v.capacityProperty ?? '?'})에 있다`, 'elsewhere')
        else add('R21', el, '용량 값이 없다')
      }
    }
  }
  return out
}

/** 어긴 요소 목록. rows 는 같은 모델의 requirementsReport, checks 는 completenessChecks. */
export function issueList(model: Model, rows: readonly RequirementRow[], checks: readonly CheckResult[] = []): IssueItem[] {
  const byId = new Map<string, Element>()
  for (const storey of model.storeys) {
    for (const v of storey.spaces) byId.set(v.id, { type: 'space', v, storey })
    for (const v of storey.equipment) byId.set(v.id, { type: 'equipment', v, storey })
  }
  const rowOf = new Map(rows.map((r) => [r.id, r]))
  const items: IssueItem[] = []
  for (const [r, hits] of requirementHits(model)) {
    const row = rowOf.get(r)
    // 요구사항 보고서가 표준·잴 수 없음이라 한 R 은 싣지 않는다(한쪽만 말하지 않게)
    if (!row || row.state === 'standard' || row.state === 'unmeasured' || row.state === 'none') continue
    for (const h of hits) {
      const cls = missingClass({ id: r, state: h.kind === 'elsewhere' ? 'elsewhere' : 'partial' }) ?? 'B'
      items.push({ r, cls, rule: row.title, problem: h.problem, kind: h.kind ?? 'missing', ...describeEl(h.el), ask: row.ask })
    }
  }
  for (const c of checks) {
    if (c.skipped || !c.failed.length) continue
    const code = checkCode(c.key)
    if (!code) continue
    for (const id of c.failed) {
      const el = byId.get(id)
      if (!el || ('added' in el.v && el.v.added)) continue
      // 완전성 검사는 요구사항 줄과 고칠 곳이 달라(예: R2 의 "외곽선" 이 아니라 그 방을 그리는 것) 요청은 비우고 DT 영향을 적는다
      items.push({ r: code.r, cls: code.cls, rule: c.rule, problem: `이 규칙을 어김 — ${c.why}`, kind: 'missing', ...describeEl(el), ask: '' })
    }
  }
  return items
}

const CSV_HEAD = ['R', '분류', '규칙', '무엇이 없나', 'GlobalId', 'Revit 요소 ID', '이름', 'IFC 클래스', '층', 'X', 'Y', 'Z', '요청']

/** 엑셀에서 바로 열리는 CSV(UTF-8 BOM). */
export function issuesCSV(items: readonly IssueItem[]): string {
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const round = (n: number | undefined) => (n == null ? '' : String(Math.round(n * 1000) / 1000))
  const lines = [CSV_HEAD.join(',')]
  for (const i of items) {
    lines.push([i.r, MISSING_LABEL[i.cls], i.rule, i.problem, i.id, i.revitId, i.name, i.ifcClass, i.storey, round(i.at?.[0]), round(i.at?.[1]), round(i.at?.[2]), i.ask].map(cell).join(','))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

/** R 마다 몇 개인지(화면 요약). */
export function issueSummary(items: readonly IssueItem[]): { r: string; cls: MissingClass; rule: string; count: number }[] {
  const by = new Map<string, { r: string; cls: MissingClass; rule: string; count: number }>()
  for (const i of items) {
    const k = `${i.r}|${i.cls}|${i.rule}`
    const e = by.get(k) ?? { r: i.r, cls: i.cls, rule: i.rule, count: 0 }
    e.count++
    by.set(k, e)
  }
  return [...by.values()].sort((a, b) => a.r.localeCompare(b.r, undefined, { numeric: true }) || b.count - a.count)
}
