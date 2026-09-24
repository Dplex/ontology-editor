// 편집 저장·불러오기.
//
// 편집은 탭 안에만 있어서 새로 고치면 사라지고, 한 시간 고친 것을 다음 날 이어 하거나 남에게 넘길 수 없었다.
// 편집 파일은 **연 때와 달라진 값**만 IfcGlobalId 로 적는다. 불러올 때는 그 값을 편집 함수(edit.ts)에 다시
// 넣는다 — 값을 모델에 바로 덮으면 소속 재판정·규칙 방향 다시 돌리기를 건너뛰어, 좌표는 옮겨졌는데 소속은
// 예전 것인 상태가 남는다(CLAUDE.md "재판정을 호출부에 맡기지 말 것").
//
// id 가 GUID 라서 같은 BIM 을 저작 도구가 다시 내보낸 파일에도 얹힌다(PRD #6). 못 찾은 id 는 조용히 버리지 않고
// 센다 — 재임포트에서 무엇이 빠졌는지가 그 숫자다.

import { confirmSystemFlow } from './flow-rules'
import {
  kindEdits,
  moveEquipment,
  moveEquipmentToStorey,
  renameSpace,
  replaceSpaceFootprint,
  setFlowDirection,
  setTypeKind,
  typeKeyOf,
  type Baseline,
  type BoundaryChange,
  type Change,
} from './edit'
import type { RuleReport } from './flow-rules'
import type { Model, Vec2, Vec3 } from './model'

export const EDIT_FORMAT = 'ontology-editor/edits'

export type EditFile = {
  format: typeof EDIT_FORMAT
  version: 1
  /** 편집한 파일 이름. 다른 파일에 불러오면 알린다(막지는 않는다 — 재내보내기는 이름이 바뀌기도 한다). */
  source: string
  savedAt: string
  equipment: { id: string; storeyId?: string; position?: Vec3 }[]
  spaces: { id: string; longName?: string; footprint?: Vec2[] }[]
  kinds: { typeKey: string; kind: string | null }[]
  flows: { from: string; to: string }[]
  confirmedSystems: string[]
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
      if (e.position && (!was.position || !samePoint(was.position, e.position))) row.position = [e.position[0], e.position[1], e.position[2]]
      if (row.storeyId || row.position) equipment.push(row)
    }
  }
  const confirmed = new Set<string>()
  for (const c of model.connections) if (c.inferred?.confirmed) confirmed.add(c.inferred.systemId)
  return {
    format: EDIT_FORMAT,
    version: 1,
    source,
    savedAt: now.toISOString(),
    equipment,
    spaces,
    kinds: kindEdits(model).map((k) => ({ typeKey: k.typeKey, kind: k.to })),
    flows: model.connections.filter((c) => !c.directed && c.edited).map((c) => ({ from: c.edited!.from, to: c.edited!.to })),
    confirmedSystems: [...confirmed],
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
  missing: { equipment: number; spaces: number; kinds: number; flows: number; systems: number }
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
    missing: { equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0 },
    rules: null,
  }
  const spaceIds = new Set(model.storeys.flatMap((s) => s.spaces.map((sp) => sp.id)))
  const equipmentIds = new Set(model.storeys.flatMap((s) => s.equipment.map((e) => e.id)))
  const storeyIds = new Set(model.storeys.map((s) => s.id))

  for (const k of file.kinds) {
    const done = setTypeKind(model, k.typeKey, k.kind)
    if (done) {
      result.applied++
      result.rules = done.rules
    } else if (!model.storeys.some((s) => s.equipment.some((e) => typeKeyOf(e) === k.typeKey))) {
      result.missing.kinds++
    }
  }

  for (const sp of file.spaces) {
    if (!spaceIds.has(sp.id)) {
      result.missing.spaces++
      continue
    }
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

  for (const e of file.equipment) {
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
  }

  for (const systemId of file.confirmedSystems) {
    const count = confirmSystemFlow(model, systemId)
    if (count > 0) {
      result.applied++
      result.confirmations.push({ systemId, count })
    } else if (!model.connections.some((c) => c.inferred?.systemId === systemId)) {
      result.missing.systems++
    }
  }

  for (const f of file.flows) {
    const c = model.connections.find(
      (x) => !x.directed && ((x.from === f.from && x.to === f.to) || (x.from === f.to && x.to === f.from)),
    )
    if (c && setFlowDirection(c, f.from)) result.applied++
    else result.missing.flows++
  }
  return result
}
