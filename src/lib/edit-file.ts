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
  addEquipment,
  createSpace,
  deleteOpening,
  deleteWall,
  insertOpening,
  insertWall,
  moveOpening,
  setWallFootprint,
  setWallLoadBearing,
  deleteEquipment,
  deleteSpace,
  absorbSpace,
  renameEquipment,
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
  setEquipmentSystem,
  setSystemKind,
  inKindGroup,
  type Baseline,
  type BoundaryChange,
  type Change,
} from './edit'
import type { RuleReport } from './flow-rules'
import type { Fluid } from './kinds'
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
  equipment: { id: string; storeyId?: string; position?: Vec3; released?: true; name?: string; system?: string | null }[]
  /** 종류·유체를 고친 계통(E8). 설비의 계통은 위 `equipment` 의 `system` 에 적는다(`null` 은 계통에서 뺀 것). */
  systems?: { id: string; kind: string | null; fluid: Fluid | null }[]
  spaces: { id: string; longName?: string; footprint?: Vec2[] }[]
  /** 사람이 더한 설비(E7). id 는 에디터가 지은 것(`U_…`)이라 다시 열어도 같은 id 로 만든다. */
  equipmentAdded?: { id: string; storeyId: string; name: string; kind: string | null; position?: Vec3; system?: string }[]
  equipmentRemoved?: string[]
  /** 사람이 만든 물리존(E3 생성·분할). 나눈 방의 남는 조각은 `spaces` 의 외곽선으로 적힌다. */
  spacesAdded?: { id: string; storeyId: string; name: string; longName: string; footprint: Vec2[] }[]
  /** 없어진 물리존. `into` 가 있으면 그 방에 합친 것이고(문이 그 방을 가리키게 된다), 없으면 지운 것이다. */
  spacesRemoved?: { id: string; into?: string }[]
  /** 벽(E4). 옮긴 벽은 끝 외곽선을, 내력 여부를 고친 벽은 그 값을 적는다(`null` 은 모름). */
  walls?: { id: string; footprint?: Vec2[][]; loadBearing?: boolean | null }[]
  wallsAdded?: { id: string; storeyId: string; name: string; thickness: number | null; loadBearing: boolean | null; footprint: Vec2[][] }[]
  /** 지운 벽. 그 벽의 문·창은 따로 적지 않는다(벽과 같이 빠진다). */
  wallsRemoved?: string[]
  /** 옮긴 문·창의 끝 자리. */
  openings?: { id: string; position: Vec3 }[]
  openingsAdded?: {
    id: string
    storeyId: string
    kind: 'door' | 'window'
    name: string
    position: Vec3
    wallId: string | null
    through: Vec2
    depth: number
  }[]
  openingsRemoved?: string[]
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

/**
 * 에디터가 지은 id(`U_…`, edit.ts 의 newId). 판본이 바뀌어도 그대로라 지문으로 찾지 않는다 — 더한 벽은 불러올 때 아직
 * 모델에 없어서, 지문으로 찾으면 같은 자리의 BIM 벽에 짝지어져 그 벽에 문이 붙는다.
 */
const isEditorId = (id: string) => id.startsWith('U_')

const samePoint = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
const sameRing = (a: readonly Vec2[], b: readonly Vec2[]) => a.length === b.length && a.every((p, i) => samePoint(p, b[i]))

/** 지금 모델에서 연 때(baseline)와 달라진 편집만 뽑는다. */
export function exportEdits(model: Model, baseline: Baseline, source: string, now = new Date()): EditFile {
  const equipment: EditFile['equipment'] = []
  const spaces: EditFile['spaces'] = []
  const equipmentAdded: NonNullable<EditFile['equipmentAdded']> = []
  const spacesAdded: NonNullable<EditFile['spacesAdded']> = []
  const mergedInto = new Map<string, string>()
  for (const storey of model.storeys) {
    for (const space of storey.spaces) {
      for (const gone of space.merged ?? []) mergedInto.set(gone, space.id)
      if (!baseline.names.has(space.id)) {
        spacesAdded.push({ id: space.id, storeyId: storey.id, name: space.name, longName: space.longName, footprint: space.footprint.map((p) => [p[0], p[1]]) })
        continue
      }
      const row: EditFile['spaces'][number] = { id: space.id }
      if (baseline.names.has(space.id) && baseline.names.get(space.id) !== space.longName) row.longName = space.longName
      const ring = baseline.footprints.get(space.id)
      if (ring && !sameRing(ring, space.footprint)) row.footprint = space.footprint.map((p) => [p[0], p[1]])
      if (row.longName !== undefined || row.footprint) spaces.push(row)
    }
    for (const e of storey.equipment) {
      const was = baseline.equipment.get(e.id)
      if (!was) {
        equipmentAdded.push({
          id: e.id,
          storeyId: storey.id,
          name: e.name,
          kind: e.kind ?? null,
          ...(e.position ? { position: [e.position[0], e.position[1], e.position[2]] as Vec3 } : {}),
          ...(e.systemId ? { system: e.systemId } : {}),
        })
        continue
      }
      const row: EditFile['equipment'][number] = { id: e.id }
      if (was.name !== undefined && was.name !== e.name) row.name = e.name
      if (was.storeyId !== storey.id) row.storeyId = storey.id
      // 좌표는 층을 옮겨 높이가 바뀐 경우에도 끝 값을 적는다. 불러올 때 층을 먼저 옮기고 좌표를 덮는다.
      // 사람이 옮긴 좌표는 연 때와 같아 보여도 적는다 — 다른 층에 갔다 오면 높이에 부동소수 찌꺼기가 남고
      // (0.9 → 0.9000000000000004), 제자리로 돌려놓은 설비도 소속은 다시 잰 것이다.
      if (e.position && (e.positionSource === 'edited' || !was.position || !samePoint(was.position, e.position))) {
        row.position = [e.position[0], e.position[1], e.position[2]]
      }
      if (was.spaceSource === 'bim' && e.spaceSource !== 'bim') row.released = true
      if (was.systemId !== undefined && was.systemId !== e.systemId) row.system = e.systemId
      if (row.storeyId || row.position || row.released || row.name !== undefined || row.system !== undefined) equipment.push(row)
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
  const equipmentRemoved = since.equipmentRemoved.map((r) => r.id)
  const spacesRemoved = since.spacesRemoved.map((r) => (mergedInto.has(r.id) ? { id: r.id, into: mergedInto.get(r.id)! } : { id: r.id }))

  // 벽·문·창(E4). 적을 것은 연 때와 견준 결과(diffBaseline)에서 고른다.
  const wallById = new Map(model.storeys.flatMap((s) => s.walls.map((w) => [w.id, { storey: s, wall: w }] as const)))
  const openingById = new Map(model.storeys.flatMap((s) => s.openings.map((o) => [o.id, { storey: s, opening: o }] as const)))
  const walls = since.wallsChanged.map((c) => {
    const w = wallById.get(c.id)!.wall
    return {
      id: c.id,
      ...(c.moved ? { footprint: (w.footprint ?? []).map((r) => r.map((p) => [p[0], p[1]] as Vec2)) } : {}),
      ...(c.loadBearing ? { loadBearing: w.loadBearing } : {}),
    }
  })
  const wallsAdded = since.wallsAdded.map((a) => {
    const { storey, wall } = wallById.get(a.id)!
    return {
      id: wall.id,
      storeyId: storey.id,
      name: wall.name,
      thickness: wall.thickness,
      loadBearing: wall.loadBearing,
      footprint: (wall.footprint ?? []).map((r) => r.map((p) => [p[0], p[1]] as Vec2)),
    }
  })
  const openings = since.openingsMoved.flatMap((m) => {
    const p = openingById.get(m.id)!.opening.position
    return p ? [{ id: m.id, position: [p[0], p[1], p[2]] as Vec3 }] : []
  })
  const openingsAdded = since.openingsAdded.flatMap((a) => {
    const { storey, opening: o } = openingById.get(a.id)!
    if (!o.position || !o.through) return []
    return [{ id: o.id, storeyId: storey.id, kind: o.kind, name: o.name, position: [o.position[0], o.position[1], o.position[2]] as Vec3, wallId: o.wallId, through: [o.through[0], o.through[1]] as Vec2, depth: o.depth ?? 0.2 }]
  })
  const systems = since.systemKinds.map((k) => ({ id: k.id, kind: k.to.kind, fluid: k.to.fluid }))
  const wallsRemoved = since.wallsRemoved.map((r) => r.id)
  const openingsRemoved = since.openingsRemoved.map((r) => r.id)

  // 적은 id 의 지문. 층을 옮긴 설비는 예전 층도 적는다(새 판본에서 층 GUID 가 바뀌어도 이름으로 찾는다).
  // 지운 것은 지금 모델에 없으니 연 때 떠 둔 지문을 쓴다.
  const all = fingerprints(model, baseline)
  const keys: Record<string, Fingerprint> = {}
  const keep = (id: string) => {
    if (isEditorId(id)) return
    const fp = all.get(id) ?? baseline.keys?.get(id)
    if (fp) keys[id] = fp
  }
  for (const row of spaces) keep(row.id)
  for (const row of equipment) {
    keep(row.id)
    if (row.storeyId) keep(row.storeyId)
    if (row.system) keep(row.system)
  }
  for (const row of [...equipmentAdded, ...spacesAdded]) keep(row.storeyId)
  for (const row of equipmentAdded) if (row.system) keep(row.system)
  for (const row of systems) keep(row.id)
  for (const id of equipmentRemoved) keep(id)
  for (const row of spacesRemoved) keep(row.id)
  for (const row of [...wallsAdded, ...openingsAdded]) keep(row.storeyId)
  for (const row of [...walls, ...openings]) keep(row.id)
  for (const id of [...wallsRemoved, ...openingsRemoved]) keep(id)
  for (const row of openingsAdded) if (row.wallId) keep(row.wallId)
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
    ...(systems.length ? { systems } : {}),
    ...(connections.add.length || connections.remove.length ? { connections } : {}),
    ...(equipmentAdded.length ? { equipmentAdded } : {}),
    ...(equipmentRemoved.length ? { equipmentRemoved } : {}),
    ...(spacesAdded.length ? { spacesAdded } : {}),
    ...(spacesRemoved.length ? { spacesRemoved } : {}),
    ...(walls.length ? { walls } : {}),
    ...(wallsAdded.length ? { wallsAdded } : {}),
    ...(wallsRemoved.length ? { wallsRemoved } : {}),
    ...(openings.length ? { openings } : {}),
    ...(openingsAdded.length ? { openingsAdded } : {}),
    ...(openingsRemoved.length ? { openingsRemoved } : {}),
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
  missing: { equipment: number; spaces: number; kinds: number; flows: number; systems: number; connections: number; elements: number }
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
    missing: { equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0, elements: 0 },
    rematched: { revitId: 0, name: 0, position: 0 },
    rules: null,
  }
  const spaceIds = new Set(model.storeys.flatMap((s) => s.spaces.map((sp) => sp.id)))
  const equipmentIds = new Set(model.storeys.flatMap((s) => s.equipment.map((e) => e.id)))
  const storeyIds = new Set(model.storeys.map((s) => s.id))

  // 파일의 id 를 이 모델의 id 로. GUID 가 먼저이고, 없으면 지문으로 찾는다.
  const referenced = new Map<string, Partial<Fingerprint>>()
  const ref = (id: string) => referenced.set(id, isEditorId(id) ? {} : (file.keys?.[id] ?? {}))
  for (const sp of file.spaces) ref(sp.id)
  for (const e of file.equipment) {
    ref(e.id)
    if (e.storeyId) ref(e.storeyId)
    if (e.system) ref(e.system)
  }
  for (const row of file.systems ?? []) ref(row.id)
  for (const row of file.equipmentAdded ?? []) if (row.system) ref(row.system)
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
  for (const row of [...(file.equipmentAdded ?? []), ...(file.spacesAdded ?? [])]) ref(row.storeyId)
  for (const id of file.equipmentRemoved ?? []) ref(id)
  for (const row of file.spacesRemoved ?? []) {
    ref(row.id)
    if (row.into) ref(row.into)
  }
  for (const row of [...(file.wallsAdded ?? []), ...(file.openingsAdded ?? [])]) ref(row.storeyId)
  for (const row of [...(file.walls ?? []), ...(file.openings ?? [])]) ref(row.id)
  for (const id of [...(file.wallsRemoved ?? []), ...(file.openingsRemoved ?? [])]) ref(id)
  for (const row of file.openingsAdded ?? []) if (row.wallId) ref(row.wallId)
  const matching = matchFingerprints(referenced, fingerprints(model))
  for (const { by } of matching.pairs.values()) if (by !== 'guid') result.rematched[by]++
  const resolve = (id: string) => matching.pairs.get(id)?.id ?? id

  // 사람이 더한 설비·물리존이 먼저다. 뒤의 편집(종류·연결·합치기)이 그것을 가리킬 수 있다. id 는 에디터가 지은
  // 것이라 판본이 바뀌어도 그대로 쓴다.
  for (const row of file.equipmentAdded ?? []) {
    const done = addEquipment(model, resolve(row.storeyId), { id: row.id, name: row.name, kind: row.kind, position: row.position ?? null })
    if (done) {
      result.applied++
      equipmentIds.add(done.id)
    } else result.missing.equipment++
  }
  for (const row of file.spacesAdded ?? []) {
    const done = createSpace(model, resolve(row.storeyId), { id: row.id, name: row.name, longName: row.longName, footprint: row.footprint })
    if (done) {
      result.applied++
      spaceIds.add(row.id)
      result.changes.push(...done.equipment)
    } else result.missing.spaces++
  }

  for (const k of file.kinds) {
    const done = setTypeKind(model, k.typeKey, k.kind)
    if (done) {
      result.applied++
      result.rules = done.rules
    } else if (!model.storeys.some((s) => s.equipment.some((e) => inKindGroup(e, k.typeKey)))) {
      result.missing.kinds++
    }
  }

  // 계통 종류·유체(E8). 규칙 방향의 재료라 종류와 같이 앞에 둔다. 확정·방향은 뒤에서 얹는다.
  for (const row of file.systems ?? []) {
    const id = resolve(row.id)
    const rules = setSystemKind(model, id, row.kind, row.fluid)
    if (rules) {
      result.applied++
      result.rules = rules
    } else if (!model.systems.some((x) => x.id === id)) result.missing.systems++
  }
  for (const row of file.equipmentAdded ?? []) {
    if (!row.system || !equipmentIds.has(row.id)) continue
    const rules = setEquipmentSystem(model, row.id, resolve(row.system))
    if (rules) result.rules = rules
    else result.missing.systems++
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

  // 합친 방은 모양을 다시 합치지 않는다. 남는 방의 끝 모양은 위에서 얹었다(absorbSpace 주석). 문이 남는 방을 가리키게만 한다.
  for (const row of file.spacesRemoved ?? []) {
    const id = resolve(row.id)
    const done = row.into ? absorbSpace(model, resolve(row.into), id) : deleteSpace(model, id)
    if (done && !('refused' in done)) {
      result.applied++
      result.changes.push(...done.equipment)
    } else result.missing.spaces++
  }

  for (const row of file.equipment) {
    const e = { ...row, id: resolve(row.id), storeyId: row.storeyId && resolve(row.storeyId) }
    if (!equipmentIds.has(e.id)) {
      result.missing.equipment++
      continue
    }
    if (e.name !== undefined && renameEquipment(model, e.id, e.name)) result.applied++
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
    if (e.system !== undefined) {
      const rules = setEquipmentSystem(model, e.id, e.system === null ? null : resolve(e.system))
      if (rules) {
        result.applied++
        result.rules = rules
      } else if (e.system !== null && !model.systems.some((x) => x.id === resolve(e.system!))) result.missing.systems++
    }
  }

  // 벽·문·창(E4). 설비처럼 GUID → Revit 요소 ID → 이름 → 위치로 찾는다. 더한 것 → 벽 모양·내력 → 지운 벽(뚫린 문·창도
  // 같이) → 문·창 자리 → 지운 문·창 순이다. 방 경계는 위에서 이미 얹었으므로 문이 잇는 방은 끝 상태로 짚는다.
  for (const row of file.wallsAdded ?? []) {
    if (insertWall(model, resolve(row.storeyId), { id: row.id, name: row.name, thickness: row.thickness, loadBearing: row.loadBearing ?? null, footprint: row.footprint.map((r) => r.map((p) => [p[0], p[1]] as Vec2)), added: true })) result.applied++
    else result.missing.elements++
  }
  for (const row of file.openingsAdded ?? []) {
    const done = insertOpening(model, resolve(row.storeyId), {
      id: row.id,
      kind: row.kind,
      name: row.name,
      width: null,
      height: null,
      wallId: row.wallId && resolve(row.wallId),
      passable: row.kind === 'door',
      position: [row.position[0], row.position[1], row.position[2]],
      through: [row.through[0], row.through[1]],
      depth: row.depth,
      ...(row.kind === 'door' ? { connects: [], connectsSource: 'calc' as const } : {}),
      added: true,
    })
    if (done) result.applied++
    else result.missing.elements++
  }
  for (const raw of file.walls ?? []) {
    const row = { ...raw, id: resolve(raw.id) }
    let hit = false
    if (row.footprint) hit = setWallFootprint(model, row.id, row.footprint) || hit
    if (row.loadBearing !== undefined) hit = setWallLoadBearing(model, row.id, row.loadBearing) || hit
    if (hit || model.storeys.some((s) => s.walls.some((w) => w.id === row.id))) result.applied++
    else result.missing.elements++
  }
  for (const id of file.wallsRemoved ?? []) {
    if (deleteWall(model, resolve(id))) result.applied++
    else result.missing.elements++
  }
  for (const raw of file.openings ?? []) {
    const id = resolve(raw.id)
    if (moveOpening(model, id, [raw.position[0], raw.position[1]])) result.applied++
    else if (!model.storeys.some((s) => s.openings.some((o) => o.id === id))) result.missing.elements++
  }
  for (const id of file.openingsRemoved ?? []) {
    if (deleteOpening(model, resolve(id))) result.applied++
    else result.missing.elements++
  }

  // 지운 설비. 붙은 연결도 같이 빠지므로 연결 편집보다 먼저다.
  for (const raw of file.equipmentRemoved ?? []) {
    const done = deleteEquipment(model, resolve(raw))
    if (done) {
      result.applied++
      result.rules = done.rules
    } else result.missing.equipment++
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
