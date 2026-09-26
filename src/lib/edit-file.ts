// 편집 저장·불러오기.
//
// 편집은 탭 안에만 있어서 새로 고치면 사라지고, 한 시간 고친 것을 다음 날 이어 하거나 남에게 넘길 수 없었다.
// 편집 파일은 **연 때와 달라진 값**만 IfcGlobalId 로 적는다. 불러올 때는 그 값을 편집 함수(edit.ts)에 다시
// 넣는다 — 값을 모델에 바로 덮으면 소속 재판정·규칙 방향 다시 돌리기를 건너뛰어, 좌표는 옮겨졌는데 소속은
// 예전 것인 상태가 남는다(CLAUDE.md "재판정을 호출부에 맡기지 말 것").
//
// id 가 GUID 라서 같은 BIM 을 저작 도구가 다시 내보낸 파일에도 얹힌다(PRD #6). 다만 GUID 는 판본 사이에 자주
// 바뀐다(versions.ts — Duplex MEP 재내보내기에서 같은 Revit 요소의 63%). 그래서 적은 id 마다 대체 열쇠(지문)를
// 같이 적고, 불러올 때 GUID 로 못 찾으면 Revit 요소 ID·이름·위치로 찾는다. 그래도 못 찾은 id 는 조용히 버리지
// 않고 센다 — 재임포트에서 무엇이 빠졌는지가 그 숫자다.

import { confirmSystemFlow, inferFlowByRules } from './flow-rules'
import {
  addConnection,
  connectionBetween,
  diffBaseline,
  removeConnection,
  kindEdits,
  moveEquipment,
  moveEquipmentToStorey,
  releaseDeclaredSpace,
  renameSpace,
  replaceSpaceFootprint,
  setFlowDirection,
  setTypeKind,
  inKindGroup,
  type Baseline,
  type BoundaryChange,
  type Change,
} from './edit'
import type { RuleReport } from './flow-rules'
import type { Model, Vec2, Vec3 } from './model'
import { fingerprints, matchFingerprints, type Fingerprint, type MatchKey } from './versions'

export const EDIT_FORMAT = 'ontology-editor/edits'

export type EditFile = {
  format: typeof EDIT_FORMAT
  version: 1
  /** 편집한 파일 이름. 다른 파일에 불러오면 알린다(막지는 않는다 — 재내보내기는 이름이 바뀌기도 한다). */
  source: string
  savedAt: string
  /**
   * `released` 는 BIM 이 말한 소속을 버렸다는 뜻이다. 옮겼다가 제자리로 돌려놓았거나 다른 층에 갔다 온 설비는 좌표·층이
   * 연 때와 같아도 소속을 좌표로 다시 잰 상태다(edit.ts 의 releaseDeclaredSpace).
   */
  equipment: { id: string; storeyId?: string; position?: Vec3; released?: true }[]
  spaces: { id: string; longName?: string; footprint?: Vec2[] }[]
  kinds: { typeKey: string; kind: string | null }[]
  flows: { from: string; to: string }[]
  /** 확정한 계통. 아래 `confirmedFlows` 가 없던 때의 파일은 이것으로 불러온다. */
  confirmedSystems: string[]
  /**
   * 확정한 규칙 방향을 연결 하나씩. **계통 id 만 적으면 불러올 때 규칙을 새로 돌려 방향을 다시 정하게 된다** — 확정한 뒤
   * 종류를 바꾸거나 잇기·끊기를 했으면 그 방향이 확정할 때와 달라서, 사람이 확인한 방향이 뒤집혀 나갔다. 확정한 계통은
   * 규칙을 다시 돌려도 얼려 두므로(flow-rules.ts) 불러오기도 확정한 그 방향을 그대로 얹는다.
   */
  confirmedFlows?: { from: string; to: string; systemId: string }[]
  /** 사람이 이은 연결과 끊은 연결(순서 없는 짝). 이 칸이 없던 때의 파일도 받는다. */
  connections?: { add: { from: string; to: string }[]; remove: { from: string; to: string }[] }
  /**
   * 위에 적은 id 마다 연 때의 지문(versions.ts). GUID 가 바뀐 판본에서 같은 것을 찾는 데 쓴다. 이 칸이 없던 때의
   * 파일도 받는다 — 그때는 GUID 로만 찾는다.
   */
  keys?: Record<string, Fingerprint>
}

const samePoint = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
const sameRing = (a: readonly Vec2[], b: readonly Vec2[]) => a.length === b.length && a.every((p, i) => samePoint(p, b[i]))

/** 지금 모델에서 연 때(baseline)와 달라진 편집만 뽑는다. */
export function exportEdits(model: Model, baseline: Baseline, source: string, now = new Date()): EditFile {
  const equipment: EditFile['equipment'] = []
  const spaces: EditFile['spaces'] = []
  for (const storey of model.storeys) {
    for (const space of storey.spaces) {
      const row: EditFile['spaces'][number] = { id: space.id }
      if (baseline.names.has(space.id) && baseline.names.get(space.id) !== space.longName) row.longName = space.longName
      const ring = baseline.footprints.get(space.id)
      if (ring && !sameRing(ring, space.footprint)) row.footprint = space.footprint.map((p) => [p[0], p[1]])
      if (row.longName !== undefined || row.footprint) spaces.push(row)
    }
    for (const e of storey.equipment) {
      const was = baseline.equipment.get(e.id)
      if (!was) continue
      const row: EditFile['equipment'][number] = { id: e.id }
      if (was.storeyId !== storey.id) row.storeyId = storey.id
      // 좌표는 층을 옮겨 높이가 바뀐 경우에도 끝 값을 적는다. 불러올 때 층을 먼저 옮기고 좌표를 덮는다.
      // 사람이 옮긴 좌표는 연 때와 같아 보여도 적는다 — 다른 층에 갔다 오면 높이에 부동소수 찌꺼기가 남고
      // (0.9 → 0.9000000000000004), 제자리로 돌려놓은 설비도 소속은 다시 잰 것이다.
      if (e.position && (e.positionSource === 'edited' || !was.position || !samePoint(was.position, e.position))) {
        row.position = [e.position[0], e.position[1], e.position[2]]
      }
      if (was.spaceSource === 'bim' && e.spaceSource !== 'bim') row.released = true
      if (row.storeyId || row.position || row.released) equipment.push(row)
    }
  }
  const confirmed = new Set<string>()
  for (const c of model.connections) if (c.inferred?.confirmed) confirmed.add(c.inferred.systemId)
  const flows = model.connections.filter((c) => !c.directed && c.edited).map((c) => ({ from: c.edited!.from, to: c.edited!.to }))
  const confirmedFlows = model.connections
    .filter((c) => !c.directed && c.inferred?.confirmed)
    .map((c) => ({ from: c.inferred!.from, to: c.inferred!.to, systemId: c.inferred!.systemId }))
  const since = diffBaseline(model, baseline)
  const connections = { add: since.connected, remove: since.disconnected }

  // 적은 id 의 지문. 층을 옮긴 설비는 예전 층도 적는다(새 판본에서 층 GUID 가 바뀌어도 이름으로 찾는다).
  const all = fingerprints(model, baseline)
  const keys: Record<string, Fingerprint> = {}
  const keep = (id: string) => {
    const fp = all.get(id)
    if (fp) keys[id] = fp
  }
  for (const row of spaces) keep(row.id)
  for (const row of equipment) {
    keep(row.id)
    if (row.storeyId) keep(row.storeyId)
  }
  for (const f of flows) {
    keep(f.from)
    keep(f.to)
  }
  for (const id of confirmed) keep(id)
  for (const f of confirmedFlows) {
    keep(f.from)
    keep(f.to)
  }
  for (const c of [...connections.add, ...connections.remove]) {
    keep(c.from)
    keep(c.to)
  }

  return {
    format: EDIT_FORMAT,
    version: 1,
    source,
    savedAt: now.toISOString(),
    equipment,
    spaces,
    kinds: kindEdits(model).map((k) => ({ typeKey: k.typeKey, kind: k.to })),
    flows,
    confirmedSystems: [...confirmed],
    ...(confirmedFlows.length ? { confirmedFlows } : {}),
    ...(connections.add.length || connections.remove.length ? { connections } : {}),
    keys,
  }
}

/** 파일에서 읽은 JSON 이 편집 파일인가. 아니면 왜 아닌지 한 줄로. */
export function parseEditFile(text: string): EditFile | string {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return 'JSON 이 아닙니다.'
  }
  const d = data as Partial<EditFile>
  if (!d || d.format !== EDIT_FORMAT) return 'ontology-editor 편집 파일이 아닙니다.'
  if (d.version !== 1) return `이 화면이 모르는 판(version ${String(d.version)})입니다.`
  for (const key of ['equipment', 'spaces', 'kinds', 'flows', 'confirmedSystems'] as const) {
    if (!Array.isArray(d[key])) return `${key} 가 목록이 아닙니다.`
  }
  return d as EditFile
}

export type ApplyResult = {
  changes: Change[]
  areaChanges: BoundaryChange[]
  confirmations: { systemId: string; count: number }[]
  storeyMoved: string[]
  applied: number
  /** 이 모델에서 못 찾은 것. 재내보내기에서 지워졌거나 다른 파일이다. */
  missing: { equipment: number; spaces: number; kinds: number; flows: number; systems: number; connections: number }
  /** GUID 로는 못 찾고 다른 열쇠로 찾은 id 수. GUID 가 바뀐 재내보내기에서 뜬다. */
  rematched: Record<Exclude<MatchKey, 'guid'>, number>
  rules: RuleReport | null
}

/**
 * 편집 파일을 모델에 얹는다. 순서가 있다 — 종류가 규칙 방향을 정하므로 종류를 먼저 바꾸고(규칙을 다시 돌린다),
 * 그 뒤에 계통 확정, 사람이 정한 방향을 얹는다. 경계는 설비 소속을 바꾸므로 설비보다 먼저, 설비는 층을 옮긴
 * 다음 좌표를 덮는다(층을 옮기면 높이가 층 차만큼 바뀐다).
 */
export function applyEdits(model: Model, file: EditFile): ApplyResult {
  const result: ApplyResult = {
    changes: [],
    areaChanges: [],
    confirmations: [],
    storeyMoved: [],
    applied: 0,
    missing: { equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0 },
    rematched: { revitId: 0, name: 0, position: 0 },
    rules: null,
  }
  const spaceIds = new Set(model.storeys.flatMap((s) => s.spaces.map((sp) => sp.id)))
  const equipmentIds = new Set(model.storeys.flatMap((s) => s.equipment.map((e) => e.id)))
  const storeyIds = new Set(model.storeys.map((s) => s.id))

  // 파일의 id 를 이 모델의 id 로. GUID 가 먼저이고, 없으면 지문으로 찾는다.
  const referenced = new Map<string, Partial<Fingerprint>>()
  const ref = (id: string) => referenced.set(id, file.keys?.[id] ?? {})
  for (const sp of file.spaces) ref(sp.id)
  for (const e of file.equipment) {
    ref(e.id)
    if (e.storeyId) ref(e.storeyId)
  }
  for (const f of file.flows) {
    ref(f.from)
    ref(f.to)
  }
  for (const id of file.confirmedSystems) ref(id)
  for (const f of file.confirmedFlows ?? []) {
    ref(f.from)
    ref(f.to)
  }
  for (const c of [...(file.connections?.add ?? []), ...(file.connections?.remove ?? [])]) {
    ref(c.from)
    ref(c.to)
  }
  const matching = matchFingerprints(referenced, fingerprints(model))
  for (const { by } of matching.pairs.values()) if (by !== 'guid') result.rematched[by]++
  const resolve = (id: string) => matching.pairs.get(id)?.id ?? id

  for (const k of file.kinds) {
    const done = setTypeKind(model, k.typeKey, k.kind)
    if (done) {
      result.applied++
      result.rules = done.rules
    } else if (!model.storeys.some((s) => s.equipment.some((e) => inKindGroup(e, k.typeKey)))) {
      result.missing.kinds++
    }
  }

  for (const row of file.spaces) {
    const id = resolve(row.id)
    if (!spaceIds.has(id)) {
      result.missing.spaces++
      continue
    }
    const sp = { ...row, id }
    if (sp.longName !== undefined && renameSpace(model, sp.id, sp.longName)) result.applied++
    if (sp.footprint) {
      const change = replaceSpaceFootprint(model, sp.id, sp.footprint.map((p) => [p[0], p[1]] as Vec2))
      if (change) {
        result.applied++
        result.areaChanges.push(change)
        result.changes.push(...change.equipment)
      }
    }
  }

  for (const row of file.equipment) {
    const e = { ...row, id: resolve(row.id), storeyId: row.storeyId && resolve(row.storeyId) }
    if (!equipmentIds.has(e.id)) {
      result.missing.equipment++
      continue
    }
    if (e.storeyId) {
      if (!storeyIds.has(e.storeyId)) result.missing.equipment++
      else {
        const change = moveEquipmentToStorey(model, e.id, e.storeyId)
        if (change) {
          result.applied++
          result.changes.push(change)
          result.storeyMoved.push(e.id)
        }
      }
    }
    if (e.position) {
      const change = moveEquipment(model, e.id, [e.position[0], e.position[1], e.position[2]])
      if (change) {
        result.applied++
        result.changes.push(change)
      }
    }
    if (e.released && releaseDeclaredSpace(model, e.id)) result.applied++
  }

  // 연결은 확정·방향보다 먼저 — 사람이 정한 방향이 사람이 이은 연결에 붙어 있을 수 있다.
  for (const row of file.connections?.remove ?? []) {
    const c = connectionBetween(model, resolve(row.from), resolve(row.to))
    const rules = c ? removeConnection(model, c) : null
    if (rules) {
      result.applied++
      result.rules = rules
    } else result.missing.connections++
  }
  for (const row of file.connections?.add ?? []) {
    const done = addConnection(model, resolve(row.from), resolve(row.to))
    if (done) {
      result.applied++
      result.rules = done.rules
    } else if (!connectionBetween(model, resolve(row.from), resolve(row.to))) result.missing.connections++
  }

  if (file.confirmedFlows) {
    // 확정한 방향을 그대로 얹고, 확정 안 한 계통만 규칙을 다시 돌린다. 확정한 계통은 규칙이 건드리지 않으므로
    // 편집할 때와 같은 상태가 된다.
    const counts = new Map<string, number>()
    for (const row of file.confirmedFlows) {
      const from = resolve(row.from)
      const to = resolve(row.to)
      const systemId = resolve(row.systemId)
      const c = connectionBetween(model, from, to)
      if (!c || c.directed) {
        result.missing.flows++
        continue
      }
      c.inferred = { from, to, systemId, confirmed: true }
      counts.set(systemId, (counts.get(systemId) ?? 0) + 1)
    }
    for (const [systemId, count] of counts) {
      result.applied++
      result.confirmations.push({ systemId, count })
    }
    for (const savedId of file.confirmedSystems) if (!counts.has(resolve(savedId))) result.missing.systems++
    if (counts.size) result.rules = inferFlowByRules(model)
  } else {
    for (const savedId of file.confirmedSystems) {
      const systemId = resolve(savedId)
      const count = confirmSystemFlow(model, systemId)
      if (count > 0) {
        result.applied++
        result.confirmations.push({ systemId, count })
      } else if (!model.connections.some((c) => c.inferred?.systemId === systemId)) {
        result.missing.systems++
      }
    }
  }

  for (const row of file.flows) {
    const f = { from: resolve(row.from), to: resolve(row.to) }
    const c = model.connections.find(
      (x) => !x.directed && ((x.from === f.from && x.to === f.to) || (x.from === f.to && x.to === f.from)),
    )
    if (c && setFlowDirection(c, f.from)) result.applied++
    else result.missing.flows++
  }
  return result
}
