// 사람이 고친 것 전부를 담는 편집 세트. 브라우저에 자동 저장하고, JSON 파일로 내보내고 불러오고,
// 고쳐서 다시 온 BIM 에 다시 붙인다.
//
// **조작의 기록이 아니라 결과를 대상(GUID)마다 적는다.** "꼭짓점 3을 x=5 로" 를 순서대로 다시
// 돌리면, BIM 이 바뀌어 꼭짓점 수가 달라진 순간 엉뚱한 점이 움직인다. 대상마다 "편집 전 BIM 값(base)"
// 과 "사람이 정한 값(value)" 을 들고 있다가, 다시 붙일 때 지금 BIM 값이 base 와 같을 때만 value 를
// 쓴다. 다르면 BIM 이 그사이 스스로 바뀐 것이라 조용히 덮지 않고 검토 목록으로 보낸다.
//
// 검토 사유는 둘이다.
//   - missing           대상이 사라졌다(GUID 가 없거나, 두 끝을 잇는 연결이 없다).
//   - superseded-by-bim BIM 이 이제 스스로 말한다(값이 편집 때와 달라졌거나, 포트가 방향을 말한다).
// 둘 다 말없이 버리지 않는다. 사람이 목록에서 되살리거나 버린다.
//
// id 는 IfcGlobalId 그대로다. 층은 파일마다 GUID 가 달라서 층을 대상으로 하는 편집은 두지 않는다.

import { confirmSystemFlow, inferFlowByRules } from './flow-rules'
import { moveEquipment, renameSpace, replaceSpaceFootprint, setFlowDirection, type BoundaryChange, type Change } from './edit'
import type { Connection, Model, Vec2, Vec3 } from './model'

/** 편집이 어느 IFC 에 대한 것인지. 합친 모델이면 파일 여럿이다. */
export type SourceFile = { name: string; size: number; sha256: string }

export type EditSet = {
  /** 물리존 이름(E1). */
  names: Record<string, { value: string; base: string }>
  /** 물리존 경계(E2). 꼭짓점 하나를 옮겨도 고리 전체를 적는다. */
  footprints: Record<string, { value: Vec2[]; base: Vec2[] }>
  /** 설비 좌표(E5·E6). 미배치였으면 base 가 null 이다. */
  positions: Record<string, { value: Vec3; base: Vec3 | null }>
  /** 사람이 정한 흐름 방향. 두 끝의 GUID 로 연결을 찾는다. */
  flows: Record<string, { a: string; b: string; from: string }>
  /** 규칙 방향을 확정한 계통. */
  confirmedSystems: Record<string, { name: string }>
  /** 사람이 고른 설비 종류. 기기(GUID)별이다. */
  kinds: Record<string, { value: string; base: string | null }>
}

export const emptyEditSet = (): EditSet => ({
  names: {},
  footprints: {},
  positions: {},
  flows: {},
  confirmedSystems: {},
  kinds: {},
})

export type EditKind = keyof EditSet

export type ReviewReason = 'missing' | 'superseded-by-bim'

export type ReviewItem = {
  kind: EditKind
  /** 편집 세트 안의 열쇠. 되살리거나 버릴 때 이걸로 찾는다. */
  key: string
  /** 사람이 읽을 대상 이름. 대상이 사라졌으면 GUID 다. */
  label: string
  reason: ReviewReason
  /** 무엇이 달라졌는지 한 줄. */
  detail: string
}

/** 편집 세트에 든 편집 수. */
export function countEdits(set: EditSet): number {
  return Object.values(set).reduce((n, group) => n + Object.keys(group).length, 0)
}

export const flowKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

// --- 편집을 적는다 ---------------------------------------------------------------
//
// 화면이 편집할 때마다 부른다. 같은 대상을 여러 번 고치면 base 는 처음 것을 지키고 value 만 바꾼다.
// 제자리로 돌아오면 지운다 — 되돌린 것을 편집으로 남기면 다시 붙일 때 거짓 편집이 된다.

const EPS = 1e-3
const sameVec = (a: readonly number[] | null, b: readonly number[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < EPS))
const sameRing = (a: readonly Vec2[], b: readonly Vec2[]) => a.length === b.length && a.every((p, i) => sameVec(p, b[i]))

export function recordName(set: EditSet, spaceId: string, before: string, after: string): void {
  const base = set.names[spaceId]?.base ?? before
  if (base === after) delete set.names[spaceId]
  else set.names[spaceId] = { value: after, base }
}

export function recordFootprint(set: EditSet, spaceId: string, before: readonly Vec2[], after: readonly Vec2[]): void {
  const base = set.footprints[spaceId]?.base ?? before.map((p) => [p[0], p[1]] as Vec2)
  if (sameRing(base, after)) delete set.footprints[spaceId]
  else set.footprints[spaceId] = { value: after.map((p) => [p[0], p[1]] as Vec2), base }
}

export function recordPosition(set: EditSet, equipmentId: string, before: Vec3 | null, after: Vec3): void {
  const base = equipmentId in set.positions ? set.positions[equipmentId].base : before
  if (sameVec(base, after)) delete set.positions[equipmentId]
  else set.positions[equipmentId] = { value: [after[0], after[1], after[2]], base: base ? [base[0], base[1], base[2]] : null }
}

export function recordFlow(set: EditSet, connection: Connection): void {
  const key = flowKey(connection.from, connection.to)
  if (connection.edited) set.flows[key] = { a: connection.from, b: connection.to, from: connection.edited.from }
  else delete set.flows[key]
}

export function recordConfirm(set: EditSet, systemId: string, name: string): void {
  set.confirmedSystems[systemId] = { name }
}

export function recordKind(set: EditSet, equipmentId: string, before: string | null, after: string | null): void {
  const base = equipmentId in set.kinds ? set.kinds[equipmentId].base : before
  if (after === null || after === base) delete set.kinds[equipmentId]
  else set.kinds[equipmentId] = { value: after, base }
}

// --- 다시 붙인다 ------------------------------------------------------------------

export type ApplyResult = {
  /** 그대로 붙은 편집 수. */
  applied: number
  review: ReviewItem[]
  /** 붙이면서 생긴 소속 변화. 화면의 편집 리포트에 그대로 들어간다. */
  changes: Change[]
  areaChanges: BoundaryChange[]
  confirmations: { systemName: string; count: number }[]
}

function indexModel(model: Model) {
  const spaces = new Map(model.storeys.flatMap((s) => s.spaces).map((sp) => [sp.id, sp]))
  const equipment = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const systems = new Map(model.systems.map((s) => [s.id, s]))
  const connections = new Map<string, Connection>()
  for (const c of model.connections) connections.set(flowKey(c.from, c.to), c)
  return { spaces, equipment, systems, connections }
}

/**
 * 편집 세트를 모델에 붙인다. 모델을 그 자리에서 고친다.
 *
 * 순서가 있다. 경계를 먼저 붙여야 뒤따르는 설비 이동의 소속 판정이 새 경계를 본다. 각 편집 함수가
 * 소속 재판정까지 하므로(lib/edit.ts) 여기서 따로 판정하지 않는다.
 */
export function applyEditSet(model: Model, set: EditSet, only?: { kind: EditKind; key: string }): ApplyResult {
  const idx = indexModel(model)
  const out: ApplyResult = { applied: 0, review: [], changes: [], areaChanges: [], confirmations: [] }
  const want = (kind: EditKind, key: string) => !only || (only.kind === kind && only.key === key)
  const force = !!only
  let kindsApplied = 0
  const review = (kind: EditKind, key: string, label: string, reason: ReviewReason, detail: string) =>
    out.review.push({ kind, key, label, reason, detail })

  for (const [id, e] of Object.entries(set.names)) {
    if (!want('names', id)) continue
    const space = idx.spaces.get(id)
    if (!space) review('names', id, e.value, 'missing', '이 물리존이 새 BIM 에 없습니다')
    else if (!force && space.longName !== e.base && space.longName !== e.value)
      review('names', id, e.value, 'superseded-by-bim', `BIM 이름이 "${e.base}" 에서 "${space.longName}" 로 바뀌었습니다`)
    else {
      renameSpace(model, id, e.value)
      out.applied++
    }
  }

  for (const [id, e] of Object.entries(set.footprints)) {
    if (!want('footprints', id)) continue
    const space = idx.spaces.get(id)
    const label = space ? space.longName || space.name : id
    if (!space) review('footprints', id, label, 'missing', '이 물리존이 새 BIM 에 없습니다')
    else if (sameRing(space.footprint, e.value)) out.applied++
    else if (!force && !sameRing(space.footprint, e.base))
      review('footprints', id, label, 'superseded-by-bim', 'BIM 의 경계가 편집 때와 달라졌습니다')
    else {
      const change = replaceSpaceFootprint(model, id, e.value.map((p) => [p[0], p[1]] as Vec2))
      if (change) {
        out.areaChanges.push(change)
        out.changes.push(...change.equipment)
      }
      out.applied++
    }
  }

  for (const [id, e] of Object.entries(set.positions)) {
    if (!want('positions', id)) continue
    const eq = idx.equipment.get(id)
    const label = eq ? eq.name || eq.ifcClass : id
    if (!eq) review('positions', id, label, 'missing', '이 설비가 새 BIM 에 없습니다')
    else if (sameVec(eq.position, e.value)) out.applied++
    else if (!force && !sameVec(eq.position, e.base))
      review('positions', id, label, 'superseded-by-bim', 'BIM 의 좌표가 편집 때와 달라졌습니다')
    else {
      const change = moveEquipment(model, id, e.value)
      if (change) out.changes.push(change)
      out.applied++
    }
  }

  for (const [id, e] of Object.entries(set.kinds)) {
    if (!want('kinds', id)) continue
    const eq = idx.equipment.get(id)
    const label = eq ? eq.name || eq.ifcClass : id
    if (!eq) review('kinds', id, label, 'missing', '이 설비가 새 BIM 에 없습니다')
    else if (!force && (eq.kind ?? null) !== e.base && eq.kind !== e.value)
      review('kinds', id, label, 'superseded-by-bim', '사전이나 BIM 이 이제 다른 종류를 말합니다')
    else {
      eq.kind = e.value
      eq.kindSource = 'edit'
      kindsApplied++
      out.applied++
    }
  }

  // 종류는 흐름 규칙의 원천·말단을 바꾼다. 확정을 붙이기 전에 규칙 방향을 새 종류로 다시 정한다
  // (확정해 둔 계통은 inferFlowByRules 가 지킨다).
  if (kindsApplied > 0) inferFlowByRules(model)

  for (const [key, e] of Object.entries(set.flows)) {
    if (!want('flows', key)) continue
    const c = idx.connections.get(key)
    const name = (id: string) => idx.equipment.get(id)?.name || id
    const label = `${name(e.from)} → ${name(e.from === e.a ? e.b : e.a)}`
    if (!c) review('flows', key, label, 'missing', '두 설비를 잇는 연결이 새 BIM 에 없습니다')
    // 포트가 말한 방향은 사람이 고치지 않는다. 되살릴 수도 없다.
    else if (c.directed) review('flows', key, label, 'superseded-by-bim', '이제 포트가 흐름 방향을 말합니다')
    else if (setFlowDirection(c, e.from)) out.applied++
  }

  for (const [id, e] of Object.entries(set.confirmedSystems)) {
    if (!want('confirmedSystems', id)) continue
    const system = idx.systems.get(id)
    if (!system) {
      review('confirmedSystems', id, e.name, 'missing', '이 계통이 새 BIM 에 없습니다')
      continue
    }
    const pending = model.connections.some((c) => c.inferred?.systemId === id)
    if (!pending) {
      review('confirmedSystems', id, e.name, 'superseded-by-bim', '이제 규칙으로 정할 연결이 없습니다(포트가 방향을 말합니다)')
      continue
    }
    const n = confirmSystemFlow(model, id)
    if (n > 0) out.confirmations.push({ systemName: system.name || e.name, count: n })
    out.applied++
  }

  return out
}

// --- 파일 -------------------------------------------------------------------------

export const EDIT_FILE_FORMAT = 'ontology-editor/edits'
export const EDIT_FILE_VERSION = 1

export type EditFile = {
  format: typeof EDIT_FILE_FORMAT
  version: number
  savedAt: string
  sources: SourceFile[]
  edits: EditSet
  /** 아직 사람이 정하지 않은 검토 항목. 파일을 넘겨받은 사람도 같은 목록을 본다. */
  review: ReviewItem[]
}

export function toEditFile(set: EditSet, sources: SourceFile[], review: ReviewItem[]): EditFile {
  return { format: EDIT_FILE_FORMAT, version: EDIT_FILE_VERSION, savedAt: new Date().toISOString(), sources, edits: set, review }
}

export type ParseResult = { ok: true; file: EditFile } | { ok: false; reason: string }

/**
 * 편집 파일을 읽는다. 모양이 틀리면 이유와 함께 거절하고, 호출부는 지금 편집을 건드리지 않는다.
 * 다른 IFC 에 대한 파일이어도 거절하지 않는다 — 고쳐서 다시 온 BIM 에 붙이는 것이 이 파일의 쓰임이다.
 */
export function parseEditFile(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'JSON 이 아닙니다' }
  }
  const f = raw as Partial<EditFile> | null
  if (!f || typeof f !== 'object' || f.format !== EDIT_FILE_FORMAT) return { ok: false, reason: '편집 파일이 아닙니다(format 이 다릅니다)' }
  if (f.version !== EDIT_FILE_VERSION) return { ok: false, reason: `모르는 판입니다(version ${String(f.version)})` }
  if (!f.edits || typeof f.edits !== 'object') return { ok: false, reason: '편집 내용(edits)이 없습니다' }
  const edits = { ...emptyEditSet(), ...f.edits } as EditSet
  for (const k of Object.keys(emptyEditSet()) as EditKind[]) {
    if (!edits[k] || typeof edits[k] !== 'object' || Array.isArray(edits[k])) return { ok: false, reason: `edits.${k} 모양이 틀렸습니다` }
  }
  return {
    ok: true,
    file: {
      format: EDIT_FILE_FORMAT,
      version: EDIT_FILE_VERSION,
      savedAt: typeof f.savedAt === 'string' ? f.savedAt : '',
      sources: Array.isArray(f.sources) ? f.sources : [],
      edits,
      review: Array.isArray(f.review) ? f.review : [],
    },
  }
}

/** 두 원본 목록이 같은 파일들인가. 내용 지문으로 본다(이름이 같아도 내용이 다르면 다른 파일이다). */
export function sameSources(a: readonly SourceFile[], b: readonly SourceFile[]): boolean {
  const key = (s: readonly SourceFile[]) => s.map((x) => x.sha256).sort().join(',')
  return a.length > 0 && key(a) === key(b)
}

/** 자동 저장 열쇠. 원본 파일들의 지문으로 가른다 — 파일마다 편집이 따로 남는다. */
export const autosaveKey = (sources: readonly SourceFile[]) =>
  `oe-edits:${sources.map((s) => s.sha256.slice(0, 16)).sort().join('+')}`

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
