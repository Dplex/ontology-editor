// 편집 저장·불러오기.
//
// 편집은 탭 안에만 있어서 새로 고치면 사라지고, 한 시간 고친 것을 다음 날 이어 하거나 남에게 넘길 수 없었다.
// 편집 파일은 **연 때와 달라진 값**만 IfcGlobalId 로 적는다. 불러올 때는 그 값을 편집 함수(edit.ts)에 다시
// 넣는다 — 값을 모델에 바로 덮으면 소속 재판정·규칙 방향 다시 돌리기를 건너뛰어, 좌표는 옮겨졌는데 소속은
// 예전 것인 상태가 남는다(intent.md "재판정을 호출부에 맡기지 말 것").
//
// id 가 GUID 라서 같은 BIM 을 저작 도구가 다시 내보낸 파일에도 얹힌다(PRD #6). 다만 GUID 는 판본 사이에 자주
// 바뀐다(versions.ts — Duplex MEP 재내보내기에서 같은 Revit 요소의 63%). 그래서 적은 id 마다 대체 열쇠(지문)를
// 같이 적고, 불러올 때 GUID 로 못 찾으면 Revit 요소 ID·이름·위치로 찾는다. 그래도 못 찾은 id 는 조용히 버리지
// 않고 센다 — 재임포트에서 무엇이 빠졌는지가 그 숫자다.

import { confirmSystemFlow, inferFlowByRules } from './flow-rules'
import { applyReleases, exportReleases, type ReleaseRow } from './connection-release'
import type { ConnectionLogEntry } from './model'
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
  setWallExternal,
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
  setSpaceNumber,
  setSpacesKind,
  renameSystem,
  replaceSpaceFootprint,
  setFlowDirection,
  setTypeKind,
  setEquipmentSystem,
  setSystemKind,
  createSystem,
  deleteSystem,
  inKindGroup,
  type Baseline,
  type BoundaryChange,
  type Change,
} from './edit'
import type { RuleReport } from './flow-rules'
import type { Fluid } from './kinds'
import type { Connection, CustomObjectItem, Model, SpaceObject, Vec2, Vec3, Wall } from './model'
import { polygonArea } from './model'
import { copySpaceObjects } from './space-object'
import { fingerprints, matchFingerprints, type Fingerprint, type MatchKey } from './versions'
import { assignEquipment, spaceSetState } from './mapping'
import { markStoreyDone, storeyProgress } from './storey-progress'
import { setCeiling, setEquipmentSurface } from './ceiling'
import type { Surface } from './mount'

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
  /** `wall` 은 설비를 붙인 벽(OE-OBJ-04). `null` 은 벽에서 뗀 것이다. */
  equipment: { id: string; storeyId?: string; position?: Vec3; released?: true; name?: string; system?: string | null; ends?: [Vec3, Vec3]; wall?: string | null; surface?: Surface }[]
  /** 종류·유체를 고친 계통(E8). 설비의 계통은 위 `equipment` 의 `system` 에 적는다(`null` 은 계통에서 뺀 것). */
  systems?: { id: string; kind: string | null; fluid: Fluid | null }[]
  /** 사람이 만든 계통(끝 이름·종류)과 지운 계통. 구성원은 설비 쪽 `system` 으로 적는다. */
  systemsAdded?: { id: string; name: string; kind: string | null; fluid: Fluid | null }[]
  systemsRemoved?: string[]
  /**
   * 사람이 지정한 설비 소속(OE-MAP-01 "사람의 소속 지정", K17). 불러올 때 소속 판정을 다시 거친다 — 그 사이 기계가 확신하게 된 설비
   * (BIM 판본이 바뀌어 명시 소속이 생겼거나 외곽선 안에 든 것)는 지정을 쓰지 않고 "사람 지정 해제" 로 알린다.
   */
  assignedSpaces?: { id: string; spaceId: string }[]
  /** 이름을 고친 계통(OE-PIP-09). 연 때 있던 계통만 — 사람이 만든 계통은 `systemsAdded` 에 끝 이름이 있다. */
  systemNames?: { id: string; name: string }[]
  /** 고친 물리존. `number` 는 방번호(IfcSpace Name, OE-OBJ-02), `longName` 은 공간명이다. */
  /** `kind` 는 사람이 정한 방 종류(OE-SPC-17, `null` 은 "모름" 으로 정한 것). 이름 사전이 읽는 종류면 적지 않는다. */
  spaces: { id: string; number?: string; longName?: string; footprint?: Vec2[]; kind?: string | null }[]
  /** 사람이 더한 설비(E7). id 는 에디터가 지은 것(`U_…`)이라 다시 열어도 같은 id 로 만든다. */
  equipmentAdded?: {
    id: string
    storeyId: string
    name: string
    kind: string | null
    position?: Vec3
    system?: string
    wall?: string
    surface?: Surface
    /** 사람이 그린 배관의 구간·이음쇠(OE-PIP-11). 중심선은 배치점에서 잰 상대 좌표이고, `ends` 는 그 뒤 끝을 옮긴 양이다. */
    conduit?: { role: 'segment' | 'fitting'; ifcClass: string; flowType: string; axis?: [Vec3, Vec3]; ends?: [Vec3, Vec3] }
  }[]
  equipmentRemoved?: string[]
  /** 사람이 만든 물리존(E3 생성·분할). 나눈 방의 남는 조각은 `spaces` 의 외곽선으로 적힌다. */
  spacesAdded?: { id: string; storeyId: string; name: string; longName: string; footprint: Vec2[]; kind?: string | null }[]
  /** 없어진 물리존. `into` 가 있으면 그 방에 합친 것이고(문이 그 방을 가리키게 된다), 없으면 지운 것이다. */
  spacesRemoved?: { id: string; into?: string }[]
  /**
   * 벽(E4). 옮긴 벽은 끝 외곽선을, 내력 여부를 고친 벽은 그 값을 적는다(`null` 은 모름). 두께·높이를 고친 벽은 끝 값을,
   * 외벽 여부를 사람이 정한 벽은 `external` 을 적는다(OE-OBJ-04. `null` 은 "모름" 으로 정한 것).
   */
  walls?: { id: string; footprint?: Vec2[][]; loadBearing?: boolean | null; thickness?: number | null; height?: number | null; external?: boolean | null }[]
  wallsAdded?: {
    id: string
    storeyId: string
    name: string
    thickness: number | null
    loadBearing: boolean | null
    footprint: Vec2[][]
    height?: number | null
    external?: boolean | null
  }[]
  /** 지운 벽. 그 벽의 문·창은 따로 적지 않는다(벽과 같이 빠진다). */
  wallsRemoved?: string[]
  /** 옮긴 문·창의 끝 자리, 크기를 바꾼 문·창의 끝 크기(OE-OBJ-07). 바뀐 쪽만 적는다. */
  openings?: { id: string; position?: Vec3; width?: number | null; height?: number | null }[]
  openingsAdded?: {
    id: string
    storeyId: string
    kind: 'door' | 'window'
    name: string
    position: Vec3
    wallId: string | null
    through: Vec2
    depth: number
    width?: number | null
    height?: number | null
  }[]
  openingsRemoved?: string[]
  /**
   * 커스텀존(OE-OBJ-01). 바뀐 층마다 그 층의 **끝 목록 전체**를 적는다 — 존은 전부 사람이 만든 것이라 BIM 과 짝지을 것이
   * 없고, 나누기·합치기를 순서대로 다시 하지 않고 끝 모양을 얹는다(물리존 합치기의 `into` 와 같은 까닭).
   */
  customZones?: { storeyId: string; zones: { id: string; name: string; aliases?: string[]; footprint: Vec2[] }[] }[]
  /**
   * 사람이 만든 공조존(OE-ZON-01·02). 고친 층의 목록을 통째로 적는다(커스텀존과 같다). 담당 물리존·담당 설비는 BIM id 라 GUID 가 바뀐 판본에서도
   * 지문으로 찾는다. 담당 물리존은 만들 때 정한 것을 그대로 적는다 — 불러올 때 다시 재면 그 사이 고친 물리존 때문에 세션과 달라진다.
   */
  hvacZones?: {
    storeyId: string
    zones: { id: string; name: string; footprint: Vec2[][]; spaceIds: string[]; spaceShares?: Record<string, number>; servedBy?: string[]; drawn?: true }[]
  }[]
  /** 사람이 그린 룸(OE-OBJ-03). BIM 에는 없어서 룸이 있는 층의 끝 목록을 그대로 적는다. */
  rooms?: { storeyId: string; rooms: { id: string; name: string; spaceId: string; footprint: Vec2[] }[] }[]
  /** 사람이 놓은 추가 공간 오브젝트(OE-OBJ-09). BIM 에는 없어서 오브젝트가 있는 층의 끝 목록을 그대로 적는다. */
  spaceObjects?: { storeyId: string; objects: SpaceObject[] }[]
  /** 사람이 넣은 3D 모델 라이브러리 항목(OE-P3-08). glb 를 그대로 든다. 층에 속하지 않아 건물 조각으로 간다. */
  objectLibrary?: CustomObjectItem[]
  kinds: { typeKey: string; kind: string | null }[]
  /** 사람이 정한 방향. `at`·`reason` 은 [적용] 한 시각과 보정 사유다(OE-PIP-04). 그 칸이 없던 때의 파일도 받는다. */
  flows: { from: string; to: string; at?: string; reason?: string }[]
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
   * 해제 보정한 BIM 포트 연결(OE-PIP-06). 끊은 연결(`connections.remove`)과 다르다 — 원본은 BIM 에 그대로 있고, 불러올 때 같은 연결을
   * 찾아 다시 해제한다. 방향이 바뀌었거나 못 찾으면 재검토로 둔다(connection-release.ts).
   */
  connectionsReleased?: ReleaseRow[]
  /** 해제 보정·취소·재검토 확인의 이력. 취소해서 지금은 해제가 아닌 연결의 기록도 여기 남는다. */
  connectionLog?: ConnectionLogEntry[]
  /**
   * 위에 적은 id 마다 연 때의 지문(versions.ts). GUID 가 바뀐 판본에서 같은 것을 찾는 데 쓴다. 이 칸이 없던 때의
   * 파일도 받는다 — 그때는 GUID 로만 찾는다.
   */
  keys?: Record<string, Fingerprint>
  /**
   * 완료로 표시한 층(OE-MAN-06). `changed` 는 저장할 때 이미 "완료 뒤 고침" 이었다는 뜻이다 — 불러와도 그 상태다. 완료한 때의
   * 지문은 적지 않는다(재내보내기에서 GUID 가 바뀌면 지문도 바뀐다). 불러올 때 편집을 다 얹은 뒤 지문을 새로 잰다.
   */
  storeysDone?: { id: string; at: string; changed?: true }[]
  /** 사람이 정한 층의 반자 높이 h_c(미터, OE-EQP-03). BIM 값과 같으면 적지 않는다. */
  ceilings?: { storeyId: string; height: number }[]
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
        spacesAdded.push({
          id: space.id,
          storeyId: storey.id,
          name: space.name,
          longName: space.longName,
          footprint: space.footprint.map((p) => [p[0], p[1]]),
          ...(space.kindSource === 'edit' ? { kind: space.kind ?? null } : {}),
        })
        continue
      }
      const row: EditFile['spaces'][number] = { id: space.id }
      if (baseline.names.has(space.id) && baseline.names.get(space.id) !== space.longName) row.longName = space.longName
      if (baseline.numbers?.has(space.id) && baseline.numbers.get(space.id) !== space.name) row.number = space.name
      const ring = baseline.footprints.get(space.id)
      if (ring && !sameRing(ring, space.footprint)) row.footprint = space.footprint.map((p) => [p[0], p[1]])
      // 사람이 정한 방 종류(OE-SPC-17). BIM 에는 없어서 있으면 적는다. 이름을 고친 줄보다 뒤에 얹어야 이름이 종류를 덮지 않는다(applyEdits).
      if (space.kindSource === 'edit') row.kind = space.kind ?? null
      if (row.longName !== undefined || row.number !== undefined || row.footprint || row.kind !== undefined) spaces.push(row)
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
          ...(e.wallId ? { wall: e.wallId } : {}),
          ...(e.surfaceSet ? { surface: e.surfaceSet } : {}),
          ...((e.role === 'segment' || e.role === 'fitting') && e.flowType
            ? {
                conduit: {
                  role: e.role,
                  ifcClass: e.ifcClass,
                  flowType: e.flowType,
                  ...(e.axis ? { axis: [[...e.axis[0]], [...e.axis[1]]] as [Vec3, Vec3] } : {}),
                  ...(e.endShift && e.endShift.some((v) => v.some((x) => x !== 0)) ? { ends: [[...e.endShift[0]], [...e.endShift[1]]] as [Vec3, Vec3] } : {}),
                },
              }
            : {}),
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
      // 설비를 따라 늘인 구간. 좌표만 적으면 어느 끝이 움직였는지 몰라 형상을 되살릴 수 없다.
      if (e.endShift && e.endShift.some((v) => v.some((x) => x !== 0))) row.ends = [[...e.endShift[0]], [...e.endShift[1]]]
      if (was.systemId !== undefined && was.systemId !== e.systemId) row.system = e.systemId
      if (was.wallId !== undefined && (was.wallId ?? null) !== (e.wallId ?? null)) row.wall = e.wallId ?? null
      // 사람이 정한 설치면(OE-EQP-05). BIM 에는 없어서 있으면 적는다.
      if (e.surfaceSet) row.surface = e.surfaceSet
      if (row.storeyId || row.position || row.released || row.name !== undefined || row.system !== undefined || row.ends || row.wall !== undefined || row.surface) equipment.push(row)
    }
  }
  const assignedSpaces = model.storeys.flatMap((st) => st.equipment.flatMap((e) => (e.spaceSet !== undefined ? [{ id: e.id, spaceId: e.spaceSet }] : [])))
  const confirmed = new Set<string>()
  for (const c of model.connections) if (c.inferred?.confirmed) confirmed.add(c.inferred.systemId)
  const flows = model.connections.filter((c) => !c.directed && c.edited).map((c) => ({ ...c.edited! }))
  const confirmedFlows = model.connections
    .filter((c) => !c.directed && c.inferred?.confirmed)
    .map((c) => ({ from: c.inferred!.from, to: c.inferred!.to, systemId: c.inferred!.systemId }))
  const since = diffBaseline(model, baseline)
  const connections = { add: since.connected, remove: since.disconnected }
  const releases = exportReleases(model)
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
      ...(c.resized ? { thickness: w.thickness, height: w.height ?? null } : {}),
      ...(c.external ? { external: w.external ?? null } : {}),
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
      ...(wall.height != null ? { height: wall.height } : {}),
      ...(wall.externalEdited ? { external: wall.external ?? null } : {}),
    }
  })
  const openings = since.openingsMoved.flatMap((m) => {
    const o = openingById.get(m.id)!.opening
    const p = m.moved ? o.position : null
    const row = {
      id: m.id,
      ...(p ? { position: [p[0], p[1], p[2]] as Vec3 } : {}),
      ...(m.resized ? { width: o.width, height: o.height } : {}),
    }
    return p || m.resized ? [row] : []
  })
  const openingsAdded = since.openingsAdded.flatMap((a) => {
    const { storey, opening: o } = openingById.get(a.id)!
    if (!o.position || !o.through) return []
    return [{ id: o.id, storeyId: storey.id, kind: o.kind, name: o.name, position: [o.position[0], o.position[1], o.position[2]] as Vec3, wallId: o.wallId, through: [o.through[0], o.through[1]] as Vec2, depth: o.depth ?? 0.2, ...(o.width != null || o.height != null ? { width: o.width, height: o.height } : {}) }]
  })
  const systems = since.systemKinds.map((k) => ({ id: k.id, kind: k.to.kind, fluid: k.to.fluid }))
  const systemById = new Map(model.systems.map((s) => [s.id, s]))
  const systemsAdded = since.systemsAdded.map((a) => {
    const s = systemById.get(a.id)!
    return { id: s.id, name: s.name, kind: s.kind ?? null, fluid: s.fluid ?? null }
  })
  const systemsRemoved = since.systemsRemoved.map((r) => r.id)
  const systemNames = since.systemNames.map((r) => ({ id: r.id, name: r.to }))
  const wallsRemoved = since.wallsRemoved.map((r) => r.id)
  const openingsRemoved = since.openingsRemoved.map((r) => r.id)
  // 커스텀존: 존이 하나라도 바뀐 층은 그 층 목록 전체를 적는다.
  const zoneStorey = new Map<string, string>()
  for (const [storeyId, zones] of baseline.customZones ?? []) for (const z of zones) zoneStorey.set(z.id, storeyId)
  for (const storey of model.storeys) for (const z of storey.customZones ?? []) zoneStorey.set(z.id, storey.id)
  const touched = new Set(since.customZones.map((c) => zoneStorey.get(c.id)).filter((x): x is string => !!x))
  const hvacTouched = new Set(since.hvacZones.map((z) => z.storeyId).filter((x): x is string => !!x))
  const hvacZones = model.storeys
    .filter((s) => hvacTouched.has(s.id))
    .map((s) => ({
      storeyId: s.id,
      zones: (s.hvacZones ?? []).map((z) => ({
        id: z.id,
        name: z.name,
        footprint: z.footprint.map((r) => r.map((p) => [p[0], p[1]] as Vec2)),
        spaceIds: [...z.spaceIds],
        ...(z.spaceShares ? { spaceShares: { ...z.spaceShares } } : {}),
        ...(z.servedBy?.length ? { servedBy: [...z.servedBy] } : {}),
        ...(z.drawn ? { drawn: true as const } : {}),
      })),
    }))
  const customZones = model.storeys
    .filter((s) => touched.has(s.id))
    .map((s) => ({
      storeyId: s.id,
      zones: (s.customZones ?? []).map((z) => ({ id: z.id, name: z.name, ...(z.aliases?.length ? { aliases: [...z.aliases] } : {}), footprint: z.footprint.map((p) => [p[0], p[1]] as Vec2) })),
    }))

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
  for (const row of [...equipment, ...equipmentAdded]) if (row.wall) keep(row.wall)
  for (const row of systems) keep(row.id)
  for (const row of systemNames) keep(row.id)
  for (const id of systemsRemoved) keep(id)
  for (const id of equipmentRemoved) keep(id)
  for (const row of assignedSpaces) {
    keep(row.id)
    keep(row.spaceId)
  }
  for (const row of spacesRemoved) keep(row.id)
  for (const row of [...wallsAdded, ...openingsAdded]) keep(row.storeyId)
  for (const row of [...walls, ...openings]) keep(row.id)
  for (const id of [...wallsRemoved, ...openingsRemoved]) keep(id)
  for (const row of openingsAdded) if (row.wallId) keep(row.wallId)
  for (const row of customZones) keep(row.storeyId)
  for (const row of hvacZones) {
    keep(row.storeyId)
    for (const z of row.zones) for (const id of [...z.spaceIds, ...(z.servedBy ?? [])]) keep(id)
  }
  const rooms = model.storeys
    .filter((st) => st.rooms?.length)
    .map((st) => ({ storeyId: st.id, rooms: st.rooms!.map((r) => ({ id: r.id, name: r.name, spaceId: r.spaceId, footprint: r.footprint.map((p) => [p[0], p[1]] as Vec2) })) }))
  for (const row of rooms) {
    keep(row.storeyId)
    for (const r of row.rooms) keep(r.spaceId)
  }
  const spaceObjects = model.storeys.filter((st) => st.spaceObjects?.length).map((st) => ({ storeyId: st.id, objects: copySpaceObjects(st.spaceObjects!) }))
  for (const row of spaceObjects) keep(row.storeyId)
  // 놓인 오브젝트가 쓰는 항목만 남긴다. 넣고 안 쓴 모델까지 임시 저장본마다 실으면 편집 파일만 커진다.
  const used = new Set(spaceObjects.flatMap((row) => row.objects.map((o) => o.item)))
  const objectLibrary = (model.objectLibrary ?? []).filter((i) => used.has(i.key)).map((i) => ({ ...i, size: [i.size[0], i.size[1], i.size[2]] as Vec3 }))
  const storeysDone = storeyProgress(model)
    .filter((p) => p.state !== 'todo')
    .map((p) => ({ id: p.id, at: p.at!, ...(p.state === 'changed' ? { changed: true as const } : {}) }))
  for (const row of storeysDone) keep(row.id)
  const ceilings = model.storeys.filter((st) => st.ceilingSet != null).map((st) => ({ storeyId: st.id, height: st.ceilingSet! }))
  for (const row of ceilings) keep(row.storeyId)
  for (const k of kindEdits(model)) if (k.typeKey.startsWith('#')) keep(k.typeKey.slice(1))
  for (const f of flows) {
    keep(f.from)
    keep(f.to)
  }
  for (const id of confirmed) keep(id)
  for (const f of confirmedFlows) {
    keep(f.from)
    keep(f.to)
  }
  for (const c of [...connections.add, ...connections.remove, ...releases.rows, ...releases.log]) {
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
    ...(systemsAdded.length ? { systemsAdded } : {}),
    ...(systemsRemoved.length ? { systemsRemoved } : {}),
    ...(systemNames.length ? { systemNames } : {}),
    ...(assignedSpaces.length ? { assignedSpaces } : {}),
    ...(connections.add.length || connections.remove.length ? { connections } : {}),
    ...(releases.rows.length ? { connectionsReleased: releases.rows } : {}),
    ...(releases.log.length ? { connectionLog: releases.log } : {}),
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
    ...(customZones.length ? { customZones } : {}),
    ...(hvacZones.length ? { hvacZones } : {}),
    ...(rooms.length ? { rooms } : {}),
    ...(spaceObjects.length ? { spaceObjects } : {}),
    ...(objectLibrary.length ? { objectLibrary } : {}),
    ...(storeysDone.length ? { storeysDone } : {}),
    ...(ceilings.length ? { ceilings } : {}),
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

/** 편집 파일에 든 편집 수. 화면(바뀐 것·임시 저장 목록)과 서버(저장본 목록)가 같이 센다. */
export function countEdits(f: EditFile): number {
  return (
    (f.assignedSpaces?.length ?? 0) +
    f.equipment.length + f.spaces.length + f.kinds.length + f.flows.length + f.confirmedSystems.length +
    (f.connections?.add.length ?? 0) + (f.connections?.remove.length ?? 0) + (f.connectionsReleased?.length ?? 0) +
    (f.equipmentAdded?.length ?? 0) + (f.equipmentRemoved?.length ?? 0) + (f.spacesAdded?.length ?? 0) + (f.spacesRemoved?.length ?? 0) +
    (f.walls?.length ?? 0) + (f.wallsAdded?.length ?? 0) + (f.wallsRemoved?.length ?? 0) +
    (f.openings?.length ?? 0) + (f.openingsAdded?.length ?? 0) + (f.openingsRemoved?.length ?? 0) +
    (f.storeysDone?.length ?? 0) + (f.ceilings?.length ?? 0) + (f.rooms?.reduce((n, r) => n + r.rooms.length, 0) ?? 0) +
    (f.spaceObjects?.reduce((n, r) => n + r.objects.length, 0) ?? 0) +
    (f.hvacZones?.reduce((n, r) => n + r.zones.length, 0) ?? 0)
  )
}

export type ApplyResult = {
  changes: Change[]
  areaChanges: BoundaryChange[]
  confirmations: { systemId: string; count: number }[]
  storeyMoved: string[]
  applied: number
  /** 이 모델에서 못 찾은 것. 재내보내기에서 지워졌거나 다른 파일이다. */
  missing: { equipment: number; spaces: number; kinds: number; flows: number; systems: number; connections: number; elements: number; storeys: number }
  /** 다시 해제한 BIM 연결 수와 재검토로 둔 수(OE-PIP-06). 해제 보정이 없는 파일에서는 없다. */
  releases?: { released: number; review: number }
  /** GUID 로는 못 찾고 다른 열쇠로 찾은 id 수. GUID 가 바뀐 재내보내기에서 뜬다. */
  rematched: Record<Exclude<MatchKey, 'guid'>, number>
  rules: RuleReport | null
  /** 편집 파일의 방번호가 이 모델의 같은 층 번호와 겹쳐 BIM 번호로 되돌린 물리존(OE-OBJ-02). 새 판본에 같은 번호가 생겼을 때 뜬다. */
  numberConflicts: { storey: string; number: string; spaceIds: string[] }[]
  /** 사람 지정 소속 중 다시 연 모델에서 기계가 확신하게 되어 쓰지 않은 것(K17). 화면이 "사람 지정 해제" 로 알린다. */
  assignReleased?: { id: string; name: string; from: string; to: string | null; reason: 'bim' | 'inside' | 'gone' }[]
}

/**
 * 편집 파일을 모델에 얹는다. 순서가 있다 — 종류가 규칙 방향을 정하므로 종류를 먼저 바꾸고(규칙을 다시 돌린다),
 * 그 뒤에 계통 확정, 사람이 정한 방향을 얹는다. 경계는 설비 소속을 바꾸므로 설비보다 먼저, 설비는 층을 옮긴
 * 다음 좌표를 덮는다(층을 옮기면 높이가 층 차만큼 바뀐다).
 */
/**
 * 편집 파일의 방번호를 다 넣고(지운·합친 물리존까지 빠진 뒤) 층마다 겹침을 본다. 겹치면 편집 파일이 바꾼 쪽을 BIM 번호로 되돌린다.
 * 되돌린 번호가 다시 겹칠 수 있어 바뀌는 것이 없을 때까지 돈다 — 한 번 되돌린 물리존은 빠지므로 끝난다.
 */
function revertNumberConflicts(model: Model, renumbered: Map<string, string>, result: ApplyResult) {
  for (let changed = true; changed; ) {
    changed = false
    for (const storey of model.storeys) {
      const byNumber = new Map<string, string[]>()
      for (const sp of storey.spaces) {
        const n = sp.name.trim()
        if (n) byNumber.set(n, [...(byNumber.get(n) ?? []), sp.id])
      }
      for (const [number, ids] of byNumber) {
        const edited = ids.filter((id) => renumbered.has(id))
        if (ids.length < 2 || !edited.length) continue
        for (const id of edited) {
          setSpaceNumber(model, id, renumbered.get(id)!, false)
          renumbered.delete(id)
          result.applied--
        }
        result.numberConflicts.push({ storey: storey.name, number, spaceIds: edited })
        changed = true
      }
    }
  }
}

export function applyEdits(model: Model, file: EditFile): ApplyResult {
  const result: ApplyResult = {
    changes: [],
    areaChanges: [],
    confirmations: [],
    storeyMoved: [],
    applied: 0,
    missing: { equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0, elements: 0, storeys: 0 },
    rematched: { revitId: 0, name: 0, position: 0 },
    rules: null,
    numberConflicts: [],
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
  for (const row of file.systemNames ?? []) ref(row.id)
  for (const id of file.systemsRemoved ?? []) ref(id)
  for (const row of file.assignedSpaces ?? []) {
    ref(row.id)
    ref(row.spaceId)
  }
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
  for (const c of [...(file.connections?.add ?? []), ...(file.connections?.remove ?? []), ...(file.connectionsReleased ?? []), ...(file.connectionLog ?? [])]) {
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
  for (const row of file.customZones ?? []) ref(row.storeyId)
  for (const row of file.hvacZones ?? []) {
    ref(row.storeyId)
    for (const z of row.zones) for (const id of [...z.spaceIds, ...(z.servedBy ?? [])]) ref(id)
  }
  for (const row of file.rooms ?? []) {
    ref(row.storeyId)
    for (const r of row.rooms) ref(r.spaceId)
  }
  for (const row of file.spaceObjects ?? []) ref(row.storeyId)
  for (const row of file.storeysDone ?? []) ref(row.id)
  for (const row of file.ceilings ?? []) ref(row.storeyId)
  for (const k of file.kinds) if (k.typeKey.startsWith('#')) ref(k.typeKey.slice(1))
  for (const row of [...(file.walls ?? []), ...(file.openings ?? [])]) ref(row.id)
  for (const id of [...(file.wallsRemoved ?? []), ...(file.openingsRemoved ?? [])]) ref(id)
  for (const row of file.openingsAdded ?? []) if (row.wallId) ref(row.wallId)
  const matching = matchFingerprints(referenced, fingerprints(model))
  for (const { by } of matching.pairs.values()) if (by !== 'guid') result.rematched[by]++
  const resolve = (id: string) => matching.pairs.get(id)?.id ?? id

  // 사람이 더한 설비·물리존·계통이 먼저다. 뒤의 편집(종류·연결·합치기·계통 옮기기)이 그것을 가리킬 수 있다. id 는
  // 에디터가 지은 것이라 판본이 바뀌어도 그대로 쓴다.
  for (const row of file.systemsAdded ?? []) {
    if (createSystem(model, { id: row.id, name: row.name, kind: row.kind, fluid: row.fluid })) result.applied++
    else result.missing.systems++
  }
  for (const row of file.equipmentAdded ?? []) {
    const conduit = row.conduit ? { role: row.conduit.role, ifcClass: row.conduit.ifcClass, flowType: row.conduit.flowType, axis: row.conduit.axis, endShift: row.conduit.ends } : undefined
    const done = addEquipment(model, resolve(row.storeyId), { id: row.id, name: row.name, kind: row.kind, position: row.position ?? null, conduit })
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
      if (row.kind !== undefined) setSpacesKind(model, [row.id], row.kind)
      result.changes.push(...done.equipment)
    } else result.missing.spaces++
  }

  for (const k of file.kinds) {
    // 한 대 줄(`#id`)은 GUID 가 바뀐 판본에서도 같은 설비를 찾는다.
    const typeKey = k.typeKey.startsWith('#') ? `#${resolve(k.typeKey.slice(1))}` : k.typeKey
    const done = setTypeKind(model, typeKey, k.kind)
    if (done) {
      result.applied++
      result.rules = done.rules
    } else if (!model.storeys.some((s) => s.equipment.some((e) => inKindGroup(e, typeKey)))) {
      result.missing.kinds++
    }
  }

  // 계통 종류·유체(E8). 규칙 방향의 재료라 종류와 같이 앞에 둔다. 확정·방향은 뒤에서 얹는다.
  for (const row of file.systemNames ?? []) {
    const id = resolve(row.id)
    if (renameSystem(model, id, row.name)) result.applied++
    else if (!model.systems.some((x) => x.id === id)) result.missing.systems++
  }
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

  const renumbered = new Map<string, string>()
  for (const row of file.spaces) {
    const id = resolve(row.id)
    if (!spaceIds.has(id)) {
      result.missing.spaces++
      continue
    }
    const sp = { ...row, id }
    if (sp.longName !== undefined && renameSpace(model, sp.id, sp.longName)) result.applied++
    if (sp.kind !== undefined && setSpacesKind(model, [sp.id], sp.kind)) result.applied++
    if (sp.number !== undefined) {
      // 겹침 검사는 아래에서 다 넣은 뒤 한 번 한다. 한 줄씩 검사하면 맞바꾼 번호가 서로를 막는다.
      const was = model.storeys.flatMap((s) => s.spaces).find((x) => x.id === sp.id)?.name ?? ''
      if (setSpaceNumber(model, sp.id, sp.number, false) === true) {
        renumbered.set(sp.id, was)
        result.applied++
      }
    }
    if (sp.footprint) {
      // BIM 소속은 여기서 풀지 않는다 — 세션에서 풀린 설비만 설비 줄의 released 가 푼다(replaceSpaceFootprint 주석).
      const change = replaceSpaceFootprint(model, sp.id, sp.footprint.map((p) => [p[0], p[1]] as Vec2), { release: false })
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
  revertNumberConflicts(model, renumbered, result)

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
    // 좌표를 옮긴 뒤에 덮는다. moveEquipment 는 늘인 구간의 끝을 같이 밀기 때문이다.
    if (e.ends) {
      const target = model.storeys.flatMap((st) => st.equipment).find((x) => x.id === e.id)
      if (target) target.endShift = [[...e.ends[0]], [...e.ends[1]]]
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

  // 지운 계통. 설비의 계통 자리를 위에서 옮긴 뒤라 남은 구성원만 자리를 잃는다.
  for (const raw of file.systemsRemoved ?? []) {
    const rules = deleteSystem(model, resolve(raw))
    if (rules) {
      result.applied++
      result.rules = rules
    } else result.missing.systems++
  }

  // 벽·문·창(E4). 설비처럼 GUID → Revit 요소 ID → 이름 → 위치로 찾는다. 더한 것 → 벽 모양·내력 → 지운 벽(뚫린 문·창도
  // 같이) → 문·창 자리 → 지운 문·창 순이다. 방 경계는 위에서 이미 얹었으므로 문이 잇는 방은 끝 상태로 짚는다.
  for (const row of file.wallsAdded ?? []) {
    const wall: Wall = { id: row.id, name: row.name, thickness: row.thickness, loadBearing: row.loadBearing ?? null, footprint: row.footprint.map((r) => r.map((p) => [p[0], p[1]] as Vec2)), added: true }
    if (row.height != null) wall.height = row.height
    if (row.external !== undefined) Object.assign(wall, { external: row.external, externalEdited: true })
    if (insertWall(model, resolve(row.storeyId), wall)) result.applied++
    else result.missing.elements++
  }
  for (const row of file.openingsAdded ?? []) {
    const done = insertOpening(model, resolve(row.storeyId), {
      id: row.id,
      kind: row.kind,
      name: row.name,
      width: row.width ?? null,
      height: row.height ?? null,
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
    // 두께·높이는 끝 값을 그대로 얹는다. 외곽선은 위에서 끝 모양을 얹었으니 setWallThickness 로 다시 펴지 않는다(잠금도 보지 않는다).
    const target = model.storeys.flatMap((s) => s.walls).find((w) => w.id === row.id)
    if (target && row.thickness !== undefined) target.thickness = row.thickness
    if (target && row.height !== undefined) target.height = row.height
    if (row.external !== undefined) hit = setWallExternal(model, row.id, row.external) || hit
    if (hit || target) result.applied++
    else result.missing.elements++
  }
  for (const id of file.wallsRemoved ?? []) {
    if (deleteWall(model, resolve(id), { ignoreLock: true })) result.applied++
    else result.missing.elements++
  }
  for (const raw of file.openings ?? []) {
    const id = resolve(raw.id)
    let hit = false
    if (raw.position) hit = moveOpening(model, id, [raw.position[0], raw.position[1]], { ignoreLock: true }) === true || hit
    if (raw.width !== undefined || raw.height !== undefined) {
      // 크기는 끝 값을 그대로 얹는다. null(모름)로 되돌린 것도 있어 setOpeningSize 를 거치지 않는다.
      const o = model.storeys.flatMap((s) => s.openings).find((x) => x.id === id)
      if (o) {
        if (raw.width !== undefined) o.width = raw.width
        if (raw.height !== undefined) o.height = raw.height
        hit = true
      }
    }
    if (hit) result.applied++
    else if (!model.storeys.some((s) => s.openings.some((o) => o.id === id))) result.missing.elements++
  }
  for (const id of file.openingsRemoved ?? []) {
    if (deleteOpening(model, resolve(id), { ignoreLock: true })) result.applied++
    else result.missing.elements++
  }
  // 벽 면에 붙인 설비(OE-OBJ-04). 좌표는 위에서 끝 값을 얹었고(moveEquipment 는 벽에서 떼므로) 벽이 다 선 뒤에 붙인다.
  for (const row of [...file.equipment, ...(file.equipmentAdded ?? [])]) {
    if (row.wall === undefined) continue
    const target = model.storeys.flatMap((s) => s.equipment).find((x) => x.id === resolve(row.id))
    if (!target) continue
    const wallId = row.wall && resolve(row.wall)
    if (wallId && model.storeys.some((s) => s.walls.some((w) => w.id === wallId))) target.wallId = wallId
    else if (wallId) result.missing.elements++
    else delete target.wallId
  }

  // 사람이 정한 설치면(OE-EQP-05). 종류를 다 얹은 뒤라 허용 설치면으로 거른다.
  for (const row of [...file.equipment, ...(file.equipmentAdded ?? [])]) {
    if (!row.surface) continue
    const done = setEquipmentSurface(model, resolve(row.id), row.surface)
    if (done === true) result.applied++
    else if (done !== false) result.missing.equipment++
  }

  // 룸(OE-OBJ-03). 층의 끝 목록을 그대로 얹는다. 부모 물리존은 지문으로 찾는다.
  for (const row of file.rooms ?? []) {
    const storey = model.storeys.find((s) => s.id === resolve(row.storeyId))
    if (!storey) {
      result.missing.spaces++
      continue
    }
    storey.rooms = row.rooms.map((r) => ({ id: r.id, name: r.name, spaceId: resolve(r.spaceId), footprint: r.footprint.map((p) => [p[0], p[1]] as Vec2) }))
    result.applied++
  }

  // 추가 공간 오브젝트(OE-OBJ-09)와 넣은 모델(OE-P3-08). 층의 끝 목록을 그대로 얹는다. 항목은 열쇠가 같으면 이미 있는 것을 둔다.
  if (file.objectLibrary?.length) {
    const have = new Set((model.objectLibrary ?? []).map((i) => i.key))
    model.objectLibrary = [...(model.objectLibrary ?? []), ...file.objectLibrary.filter((i) => !have.has(i.key)).map((i) => ({ ...i, size: [i.size[0], i.size[1], i.size[2]] as Vec3 }))]
  }
  for (const row of file.spaceObjects ?? []) {
    const storey = model.storeys.find((s) => s.id === resolve(row.storeyId))
    if (!storey) {
      result.missing.storeys++
      continue
    }
    storey.spaceObjects = copySpaceObjects(row.objects)
    result.applied++
  }

  // 커스텀존(OE-OBJ-01). 층의 끝 목록을 그대로 얹는다. 소속은 쓸 때 계산하니 따로 다시 잴 것이 없다.
  for (const row of file.customZones ?? []) {
    const storey = model.storeys.find((s) => s.id === resolve(row.storeyId))
    if (!storey) {
      result.missing.spaces++
      continue
    }
    storey.customZones = row.zones.map((z) => ({
      id: z.id,
      name: z.name,
      ...(z.aliases?.length ? { aliases: [...z.aliases] } : {}),
      footprint: z.footprint.map((p) => [p[0], p[1]] as Vec2),
    }))
    result.applied++
  }

  // 사람이 만든 공조존(OE-ZON-01·02). 물리존·설비를 다 얹은 뒤라 담당 id 를 찾을 수 있다.
  for (const row of file.hvacZones ?? []) {
    const storey = model.storeys.find((s) => s.id === resolve(row.storeyId))
    if (!storey) {
      result.missing.spaces++
      continue
    }
    storey.hvacZones = row.zones.map((z) => {
      const footprint = z.footprint.map((r) => r.map((p) => [p[0], p[1]] as Vec2))
      const shares = z.spaceShares ? Object.fromEntries(Object.entries(z.spaceShares).map(([id, v]) => [resolve(id), v])) : undefined
      return {
        id: z.id,
        name: z.name,
        storeyId: storey.id,
        footprint,
        areaM2: footprint.reduce((a, r) => a + polygonArea(r), 0),
        declaredAreaM2: null,
        spaceIds: z.spaceIds.map(resolve),
        ...(shares ? { spaceShares: shares } : {}),
        ...(z.servedBy?.length ? { servedBy: z.servedBy.map(resolve) } : {}),
        source: 'edit' as const,
        ...(z.drawn ? { drawn: true as const } : {}),
      }
    })
    if (!storey.hvacZones.length) delete storey.hvacZones
    result.applied++
  }

  // 사람이 지정한 소속(K17). 경계·물리존·좌표를 다 얹은 뒤에 같은 판정을 거친다. 기계가 확신하게 된 설비는 지정을 남기되 쓰지 않는다.
  for (const row of file.assignedSpaces ?? []) {
    const id = resolve(row.id)
    const spaceId = resolve(row.spaceId)
    const storey = model.storeys.find((s) => s.equipment.some((e) => e.id === id))
    const target = storey?.equipment.find((e) => e.id === id)
    if (!storey || !target) {
      result.missing.equipment++
      continue
    }
    target.spaceSet = spaceId
    assignEquipment(target, storey.spaces)
    const state = spaceSetState(target, storey.spaces)
    if (state?.state === 'released') {
      ;(result.assignReleased ??= []).push({ id, name: target.name, from: spaceId, to: target.spaceId, reason: state.reason })
    } else result.applied++
  }

  // 지운 설비. 붙은 연결도 같이 빠지므로 연결 편집보다 먼저다.
  for (const raw of file.equipmentRemoved ?? []) {
    const done = deleteEquipment(model, resolve(raw))
    if (done) {
      result.applied++
      result.rules = done.rules
    } else result.missing.equipment++
  }

  // 같은 두 설비 사이에 연결이 둘일 수 있다(병원 HVAC 2쌍 — 포트가 둘씩 맞물린 곳). 그때는 이 편집이 닿을 수 있는 쪽을 고른다 —
  // 끊기는 포트가 아닌 연결, 확정·방향은 방향 없는 연결. 첫 것만 보면 포트(방향 있음) 쪽에 걸려 "못 찾음" 이 된다(합성 고층 BIM 이 찾았다).
  const between = (a: string, b: string, ok: (c: Connection) => boolean) =>
    model.connections.find((c) => ((c.from === a && c.to === b) || (c.from === b && c.to === a)) && ok(c)) ?? null

  // 연결은 확정·방향보다 먼저 — 사람이 정한 방향이 사람이 이은 연결에 붙어 있을 수 있다.
  for (const row of file.connections?.remove ?? []) {
    const c = between(resolve(row.from), resolve(row.to), (x) => x.source !== 'port')
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
  if (file.connectionsReleased?.length || file.connectionLog?.length) {
    const done = applyReleases(model, file.connectionsReleased ?? [], file.connectionLog ?? [], resolve)
    result.applied += done.released + done.review
    if (done.rules) result.rules = done.rules
    if (file.connectionsReleased?.length) result.releases = { released: done.released, review: done.review }
  }

  if (file.confirmedFlows) {
    // 확정한 방향을 그대로 얹고, 확정 안 한 계통만 규칙을 다시 돌린다. 확정한 계통은 규칙이 건드리지 않으므로
    // 편집할 때와 같은 상태가 된다.
    const counts = new Map<string, number>()
    for (const row of file.confirmedFlows) {
      const from = resolve(row.from)
      const to = resolve(row.to)
      const systemId = resolve(row.systemId)
      const c = between(from, to, (x) => !x.directed)
      if (!c) {
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
    if (c && setFlowDirection(c, f.from)) {
      result.applied++
      if (row.at) c.edited!.at = row.at
      if (row.reason) c.edited!.reason = row.reason
    } else result.missing.flows++
  }

  // 층의 반자 높이(OE-EQP-03). 설비 편집보다 앞뒤가 상관없다 — 판정은 그때그때 잰다.
  for (const row of file.ceilings ?? []) {
    const storey = model.storeys.find((s) => s.id === resolve(row.storeyId))
    if (!storey) {
      result.missing.storeys++
      continue
    }
    if (setCeiling(model, storey.id, row.height)) result.applied++
  }

  // 완료한 층(OE-MAN-06). 편집을 다 얹은 뒤라야 지문이 저장할 때 상태와 같다. 저장할 때 이미 고친 층은 지문을 비워 "완료 뒤
  // 고침" 으로 둔다.
  for (const row of file.storeysDone ?? []) {
    const storey = model.storeys.find((s) => s.id === resolve(row.id))
    if (!storey) {
      result.missing.storeys++
      continue
    }
    markStoreyDone(model, storey.id, new Date(row.at))
    if (row.changed) storey.done!.sig = ''
    result.applied++
  }
  return result
}
