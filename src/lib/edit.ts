// 온톨로지 편집. 고치는 대상은 3D 모델이 아니라 관계다.
//
// 설비를 옮기는 편집(E5)과 미배치 설비를 놓는 편집(E6)이 여기 있다. 화면에서는 점 하나가
// 움직이지만 온톨로지에서는 `brick:hasLocation` 이 바뀌고, 그 한 줄이 이상 알림의 발생
// 위치다. 그래서 편집 함수는 좌표만 바꾸고 끝내지 않고 **무엇이 바뀌었는지를 돌려준다.**
//
// 반영 전에 차이를 보여 주는 것이 PRD #16(미리보기)이고, 반영 뒤에 남기는 것이 #21(결과
// 리포트)이다. 둘 다 같은 값을 쓰므로 계산을 한 곳에 둔다.

import { assignEquipment, centroid, distanceToRing, isSelfIntersecting, locate, nearRing } from './mapping'
import { judgeExternal } from './exterior'
import { inferFlowByRules, type RuleReport } from './flow-rules'
import { releasedBetween, restoreRelease, restoreRules, snapshotRelease, snapshotRulesAgain, type ReleaseSnapshot, type RuleSnapshot } from './connection-release'
import { equipmentKind, FLUID_KINDS, resolveRoomKind, roomKind, systemKind, type Fluid } from './kinds'
import { polygonArea } from './model'
import type { Connection, CustomZone, Equipment, HvacZone, Model, Opening, Room, Space, SpaceObject, Storey, System, Vec2, Vec3, Wall } from './model'
import { copyHvacZones, remapZonesForSpaces } from './hvac-zone'
import { spacesBesideOpening } from './ifc/element-geometry'
import { overlapArea, splitRing, unionRings } from './polygon'
import { fingerprints, type Fingerprint } from './versions'
import { josa } from './josa'
import { spaceAssignable } from './mapping'
import { allowedSurfaces, canMountOn, SURFACE_LABEL } from './mount'

/** 편집 한 번이 만든 관계 변화. 좌표가 아니라 관계를 적는다. */
export type Change = {
  equipmentId: string
  equipmentName: string
  /** 이전 소속 물리존 id. 미배치였으면 null 이다. */
  fromSpaceId: string | null
  toSpaceId: string | null
  /** 사람이 읽을 문장. 검토 화면이 그대로 보여 준다. */
  summary: string
}

function spaceLabel(model: Model, spaceId: string | null): string {
  if (spaceId === null) return '(소속 없음)'
  for (const storey of model.storeys) {
    const space = storey.spaces.find((s) => s.id === spaceId)
    if (space) return space.longName || space.name || spaceId
  }
  return spaceId
}

/**
 * 편집은 바뀐 것만 다시 판정한다. 설비 하나의 소속은 그 좌표와 자기 층의 물리존으로만 정해지므로
 * (mapping.ts 의 assignEquipment), 설비를 옮기면 그 설비만, 경계를 고치면 그 층만 보면 전체를
 * 다시 도는 것과 결과가 같다.
 */
function reassignStoreyOf(model: Model, equipment: Equipment) {
  const storey = model.storeys.find((s) => s.equipment.includes(equipment))
  if (storey) assignEquipment(equipment, storey.spaces)
}

/**
 * 방 하나의 경계가 바뀐 뒤. 그 층에서 답이 바뀔 수 있는 설비만 다시 판정한다 — 지금 그 방 소속인 것(빠져나갈 수 있다)과
 * 새 경계 근처인 것(들어올 수 있다). 나머지 설비는 그 방이 답이었던 적도 없고 답이 될 수도 없어서, 층 전부를 다시 도는 것과
 * 결과가 같다. 병원 건축+MEP 처럼 한 층에 설비·배관이 수천 개면 꼭짓점 하나 옮길 때마다 전부 다시 재는 데 시간이 다 갔다.
 */
function reassignStoreyWith(model: Model, spaceId: string, release = false) {
  const storey = model.storeys.find((s) => s.spaces.some((sp) => sp.id === spaceId))
  if (!storey) return
  const ring = storey.spaces.find((sp) => sp.id === spaceId)!.footprint
  // 사람이 경계를 고친 물리존은 BIM 이 거기 담아 둔 설비도 좌표로 다시 판정한다(OE-MAP-01 3단계, Q13). 설계자가 담은 방이
  // 이제 설계 때의 방이 아니라서다.
  if (release) releaseDeclared(storey, spaceId)
  for (const e of storey.equipment) {
    if (e.spaceId === spaceId || (e.position && nearRing([e.position[0], e.position[1]], ring))) assignEquipment(e, storey.spaces)
  }
  // 방 경계가 바뀌면 좌표로 짚은 문이 잇는 방도 바뀐다.
  relinkDoors(storey)
}

/** 이 물리존에 BIM 이 담아 둔 설비의 소속을 좌표 판정에 넘긴다(Q13). 다음 assignEquipment 가 좌표로 정한다. */
function releaseDeclared(storey: Storey, spaceId: string) {
  for (const e of storey.equipment) if (e.spaceSource === 'bim' && e.spaceId === spaceId) e.spaceSource = null
}

/**
 * 경계가 실제로 바뀌었나. 변 위에 꼭짓점을 하나 넣는 것(Insert)은 모양이 같아서 바뀐 것이 아니다 — 넣기만 해도 BIM 소속이
 * 풀리면 안 된다. 넓이가 같고 새 꼭짓점이 전부 옛 외곽선 위에 있으면 같은 모양이다.
 */
function shapeChanged(from: readonly Vec2[], to: readonly Vec2[]): boolean {
  if (Math.abs(polygonArea(from) - polygonArea(to)) > 1e-9) return true
  return to.some((p) => distanceToRing(p, from) > 1e-9)
}

function findEquipment(model: Model, equipmentId: string): Equipment | null {
  for (const storey of model.storeys) {
    const found = storey.equipment.find((e) => e.id === equipmentId)
    if (found) return found
  }
  return null
}

/**
 * 설비를 옮긴다(E5). 미배치 설비에 좌표를 주는 것도 같은 함수다(E6).
 *
 * 소속 판정을 이 안에서 다시 돌린다. 호출부가 잊어버릴 수 있는 일을 호출부에 맡기면,
 * 좌표는 옮겨졌는데 소속은 예전 것인 상태가 조용히 남는다.
 */
export function moveEquipment(model: Model, equipmentId: string, to: Vec3): Change | null {
  const equipment = findEquipment(model, equipmentId)
  if (!equipment) return null

  const fromSpaceId = equipment.spaceId
  // 늘인 구간을 통째로 옮기면 두 끝이 같이 간다. 안 그러면 형상(끝 기준)과 좌표가 어긋난다.
  if (equipment.endShift && equipment.position) {
    const d = sub(to, equipment.position)
    equipment.endShift = [add(equipment.endShift[0], d), add(equipment.endShift[1], d)]
  }
  equipment.position = to
  equipment.positionSource = 'edited'
  // 벽 면에 붙인 설비(OE-OBJ-04)를 따로 옮기면 벽에서 떨어진다. 벽을 따라 갈 때는 이 함수를 거치지 않는다(followWall).
  delete equipment.wallId
  // BIM 이 말한 소속은 BIM 이 말한 자리에 대한 것이다. 사람이 옮긴 뒤에도 남겨 두면 방 밖으로 끌어낸
  // 설비가 예전 방에 그대로 속한다. 옮긴 설비는 좌표로 다시 판정한다.
  if (equipment.spaceSource === 'bim') equipment.spaceSource = null
  // 사람이 지정한 소속도 그 자리에 대한 것이다. 옮기면 지우고 처음부터 다시 판정한다(OE-MAP-01, OE-EQP-12).
  dropSpaceSet(equipment)
  reassignStoreyOf(model, equipment)
  const toSpaceId = equipment.spaceId

  return {
    equipmentId,
    equipmentName: equipment.name,
    fromSpaceId,
    toSpaceId,
    summary:
      fromSpaceId === toSpaceId
        ? `${equipment.name}: 위치만 바뀌었고 소속은 ${spaceLabel(model, toSpaceId)} 그대로입니다.`
        : `${equipment.name}: 소속이 ${spaceLabel(model, fromSpaceId)} 에서 ${spaceLabel(model, toSpaceId)} 로 바뀝니다.`,
  }
}

// --- 배관이 설비를 따라온다 (PRD #13 "이동(연결 배관 함께)") ---------------------------------
//
// 설비만 옮기면 붙은 덕트·배관이 제자리에 남아 3D 와 GeoJSON 에서 끊겨 보인다. 연결 관계는 그대로라 TTL 은 같다.
// 그래서 바로 붙은 이음쇠(엘보·티)는 설비와 같이 옮기고, 그 너머의 곧은 구간은 **먼 끝은 두고 가까운 끝만** 늘인다.
// 배관망 전체를 따라 끌면 다른 설비에 붙은 끝까지 떨어지므로 첫 구간에서 멈춘다.

/** 덕트·배관 구간의 축 두 끝(세계 좌표). 연 때 형상에서 잰다. */
export type SegmentAxis = [Vec3, Vec3]

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: readonly number[], k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dist2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/** 축 위 비율(0 = 첫 끝, 1 = 둘째 끝). 축 밖의 점은 축에 내린 자리로 잰다. */
export function axisParam(axis: readonly [Vec3, Vec3], p: readonly number[]): number {
  const d = sub(axis[1], axis[0])
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
  if (len2 === 0) return 0.5
  const t = ((p[0] - axis[0][0]) * d[0] + (p[1] - axis[0][1]) * d[1] + (p[2] - axis[0][2]) * d[2]) / len2
  return Math.min(1, Math.max(0, t))
}

/** 두 끝이 옮겨진 만큼 축 위 비율 t 의 점이 옮겨지는 양. 형상의 꼭짓점과 `position` 이 같은 식을 쓴다. */
export function shiftAt(shift: readonly [Vec3, Vec3], t: number): Vec3 {
  return add(scale(shift[0], 1 - t), scale(shift[1], t))
}

/** 지금 끝 자리 = 연 때 축 + 옮겨진 양. */
function currentAxis(e: Equipment, axis: SegmentAxis): SegmentAxis {
  const s = e.endShift
  return s ? [add(axis[0], s[0]), add(axis[1], s[1])] : axis
}

export type FollowPlan = {
  /** 설비와 같이 통째로 옮길 이음쇠. */
  rigid: string[]
  /** 한 끝만 늘일 구간과 그 끝(0·1). */
  stretch: { id: string; end: 0 | 1 }[]
  /**
   * 옮기지 않고 둔 이음쇠(OE-PIP-12 "공유 분기점은 무조건 이동하지 않는다"). 다른 분기(이웃 셋 이상)나 옮기는 설비가 아닌 다른 설비에도
   * 붙은 것이다. 사람이 영향을 보고 배관 형상을 고친다(OE-PIP-10). 그 너머는 따라가지 않는다.
   */
  held: string[]
  /**
   * 따라와야 하는데 끝점을 옮길 수 없는 도관과 그 까닭(OE-PIP-12 "끝점 자동 추종 불가"). 임의 좌표를 만들지 않고 건너뛴다.
   * `geometry` 는 형상이 없어 구간의 축을 모르는 것, `position` 은 좌표가 없는 것이다.
   */
  blocked: { id: string; reason: 'geometry' | 'position' }[]
}

/** 이음쇠가 이음쇠에 물린 사슬을 이만큼만 탄다. 이음쇠끼리 길게 이어진 BIM 에서 배관망 전체가 끌려오지 않게 한다. */
const FITTING_DEPTH = 3

/**
 * 설비를 옮기기 **전에** 무엇이 따라올지 정한다. 옮긴 뒤에는 어느 끝이 가까웠는지 알 수 없어서 따로 둔다.
 * `axisOf` 는 구간의 연 때 축이다. 축을 모르는 구간(형상이 없다)은 늘일 수 없으니 따라오지 않는다.
 */
export function planFollow(model: Model, equipmentId: string, axisOf: (id: string) => SegmentAxis | null): FollowPlan {
  const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const root = byId.get(equipmentId)
  const plan: FollowPlan = { rigid: [], stretch: [], held: [], blocked: [] }
  if (!root?.position || isConduitRole(root.role)) return plan
  const neighbors = new Map<string, Set<string>>()
  for (const c of model.connections) {
    if (c.from === c.to) continue
    neighbors.set(c.from, (neighbors.get(c.from) ?? new Set()).add(c.to))
    neighbors.set(c.to, (neighbors.get(c.to) ?? new Set()).add(c.from))
  }
  // 분기 이음쇠: 셋 이상과 이어졌거나(티·크로스), 옮기는 설비가 아닌 다른 설비에 붙었다. 옮기면 그 분기의 배관이 끌려온다.
  const shared = (id: string) => {
    const around = neighbors.get(id) ?? new Set()
    return around.size >= 3 || [...around].some((x) => x !== equipmentId && !isConduitRole(byId.get(x)?.role ?? null))
  }
  const block = (id: string, reason: 'geometry' | 'position') => {
    if (!plan.blocked.some((b) => b.id === id)) plan.blocked.push({ id, reason })
  }
  const seen = new Set([equipmentId])
  let frontier: Equipment[] = [root]
  for (let depth = 0; depth <= FITTING_DEPTH && frontier.length; depth++) {
    const next: Equipment[] = []
    for (const mover of frontier) {
      for (const id of neighbors.get(mover.id) ?? []) {
        const e = byId.get(id)
        if (!e || seen.has(id)) continue
        if (!e.position) {
          if (isConduitRole(e.role)) block(id, 'position')
          continue
        }
        if (e.role === 'fitting' && depth < FITTING_DEPTH) {
          seen.add(id)
          if (shared(id)) {
            plan.held.push(id)
            continue
          }
          plan.rigid.push(id)
          next.push(e)
        } else if (e.role === 'segment') {
          const axis = axisOf(id)
          if (!axis) {
            block(id, 'geometry')
            continue
          }
          const now = currentAxis(e, axis)
          const end: 0 | 1 = dist2(now[0], mover.position!) <= dist2(now[1], mover.position!) ? 0 : 1
          // 양 끝이 다 옮겨지는 구간(두 이음쇠 사이)은 끝을 둘 다 적는다.
          const already = plan.stretch.find((s) => s.id === id)
          if (already) {
            if (already.end !== end) plan.stretch.push({ id, end })
            seen.add(id)
          } else plan.stretch.push({ id, end })
        }
      }
    }
    frontier = next
  }
  return plan
}

const isConduitRole = (role: Equipment['role']) => role === 'segment' || role === 'fitting'

/**
 * 설비가 `delta` 만큼 옮겨진 뒤 계획대로 배관을 따라오게 한다. 좌표는 `moveEquipment` 로 바꿔 소속도 다시 판정한다.
 * 늘인 구간의 `position` 은 축 위 같은 비율 자리로 간다 — 형상의 꼭짓점과 같은 식이라 3D 와 GeoJSON 이 어긋나지 않는다.
 */
export function applyFollow(model: Model, plan: FollowPlan, delta: Vec3, axisOf: (id: string) => SegmentAxis | null): Change[] {
  const changes: Change[] = []
  for (const id of plan.rigid) {
    const e = findEquipment(model, id)
    if (!e?.position) continue
    const change = moveEquipment(model, id, add(e.position, delta))
    if (change) changes.push(change)
  }
  const byId = new Map<string, (0 | 1)[]>()
  for (const s of plan.stretch) byId.set(s.id, [...(byId.get(s.id) ?? []), s.end])
  for (const [id, ends] of byId) {
    const e = findEquipment(model, id)
    const axis = axisOf(id)
    if (!e?.position || !axis) continue
    const t = axisParam(currentAxis(e, axis), e.position)
    const before = e.endShift ?? [[0, 0, 0], [0, 0, 0]]
    const after: [Vec3, Vec3] = [ends.includes(0) ? add(before[0], delta) : [...before[0]], ends.includes(1) ? add(before[1], delta) : [...before[1]]]
    const to = add(e.position, sub(shiftAt(after, t), shiftAt(before, t)))
    // moveEquipment 는 늘인 구간을 통째로 옮긴 것으로 보고 끝을 같이 민다. 끝은 여기서 정하므로 뒤에 덮는다.
    const change = moveEquipment(model, id, to)
    e.endShift = after
    if (change) changes.push(change)
  }
  return changes
}

/**
 * 좌표가 없는 설비에 표로 넣는 축의 초안. 셋이 다 차야 좌표가 된다.
 *
 * 한 축만 받고 나머지를 0 으로 채우면 "모르는 것" 이 "원점 쪽에 있는 것" 으로 바뀌어, 그 자리의 물리존에
 * 조용히 소속된다. 그래서 빈 축이 있으면 좌표를 만들지 않는다. 0 은 모름이 아니라 값이다.
 */
export function completePosition(draft: readonly (number | null)[]): Vec3 | null {
  const [x, y, z] = draft
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? [x, y, z] : null
}

/**
 * 포트가 방향을 말하지 않은 연결에 사람이 흐름 방향을 정한다. `from` 이 null 이면 정한 것을 지워서
 * 규칙 방향(있으면)이나 "방향 모름" 으로 돌아간다. BIM 포트가 방향을 말한 연결은 고치지 않는다 —
 * BIM 이 말한 것을 덮어쓰면 온톨로지를 읽는 쪽이 둘을 구별할 수 없다.
 *
 * 정한 방향은 연결에 남으므로 리포트는 `flowEdits` 로 모델에서 다시 센다. 같은 연결을 여러 번
 * 바꾸면 마지막 것만 남고, 지우면 목록에서 빠진다.
 */
export function setFlowDirection(connection: Connection, from: string | null): boolean {
  if (connection.directed) return false
  if (from === null) {
    delete connection.edited
    return true
  }
  if (from !== connection.from && from !== connection.to) return false
  connection.edited = { from, to: from === connection.from ? connection.to : connection.from }
  return true
}

/** 사람이 방향을 정한 연결. 규칙 방향이 있었으면 그것과 같은지 반대인지도 적는다. `reason` 은 규칙과 반대로 정할 때 받은 사유다. */
export type FlowEdit = {
  from: string
  to: string
  rule: 'same' | 'reversed' | null
  reason?: string
}

export function flowEdits(model: Model): FlowEdit[] {
  return model.connections
    .filter((c) => !c.directed && c.edited)
    .map((c) => ({
      from: c.edited!.from,
      to: c.edited!.to,
      rule: c.inferred ? (c.inferred.from === c.edited!.from ? 'same' : 'reversed') : null,
      ...(c.edited!.reason ? { reason: c.edited!.reason } : {}),
    }))
}

/**
 * 설비 하나를 다른 층으로 옮긴다.
 *
 * 층은 좌표로 판정하지 않는다. 층고를 모르는 모델이 있고, 천장 설비는 다음 층 바닥과 높이가
 * 겹쳐서 z 만으로는 어느 층인지 정해지지 않기 때문이다. 그래서 층은 사람이 고른다.
 *
 * 좌표가 있으면 높이도 두 층 바닥의 차만큼 옮긴다. 층만 바꾸고 z 를 두면 목록은 새 층인데 3D 와
 * GeoJSON 은 예전 층에 그대로 있다. 좌표가 없는 설비는 좌표를 만들지 않는다.
 */
export function moveEquipmentToStorey(model: Model, equipmentId: string, storeyId: string): Change | null {
  const equipment = findEquipment(model, equipmentId)
  if (!equipment) return null

  const target = model.storeys.find((s) => s.id === storeyId)
  if (!target) return null
  const source = model.storeys.find((s) => s.equipment.includes(equipment))

  if (equipment.position && source && source !== target) {
    const [x, y, z] = equipment.position
    equipment.position = [x, y, z + target.elevation - source.elevation]
    equipment.positionSource = 'edited'
  }
  // 예전 층의 방을 가리키는 BIM 소속은 새 층에서 뜻이 없다.
  if (source !== target && equipment.spaceSource === 'bim') equipment.spaceSource = null
  if (source !== target) dropSpaceSet(equipment)

  for (const storey of model.storeys) {
    const at = storey.equipment.findIndex((e) => e.id === equipmentId)
    if (at >= 0) storey.equipment.splice(at, 1)
  }
  target.equipment.push(equipment)

  const fromSpaceId = equipment.spaceId
  assignEquipment(equipment, target.spaces)

  return {
    equipmentId,
    equipmentName: equipment.name,
    fromSpaceId,
    toSpaceId: equipment.spaceId,
    summary: `${equipment.name}: ${target.name} 층으로 옮겨져 소속이 ${spaceLabel(model, equipment.spaceId)} 가 됩니다.`,
  }
}

/**
 * BIM 이 말한 소속을 버리고 좌표로 다시 잰다. 설비를 옮기거나 다른 층으로 보낼 때 일어나는 일이고, 편집 파일을
 * 불러올 때 이것을 다시 한다 — 옮겼다가 제자리로 돌려놓은 설비는 좌표가 연 때와 같아도 소속이 BIM 이 말한 방이
 * 아니다. 좌표만 견주면 그 편집이 파일에서 빠지고, 다시 열면 BIM 소속으로 돌아간다.
 */
export function releaseDeclaredSpace(model: Model, equipmentId: string): boolean {
  const equipment = findEquipment(model, equipmentId)
  if (!equipment || equipment.spaceSource !== 'bim') return false
  equipment.spaceSource = null
  reassignStoreyOf(model, equipment)
  return true
}

/** 사람 지정 소속을 지운다. 설비를 옮겼을 때다. */
function dropSpaceSet(equipment: Equipment) {
  delete equipment.spaceSet
}

/**
 * 사람이 설비의 소속 물리존을 정한다(OE-MAP-01 "사람의 소속 지정", K17). 기계가 확신하는 설비(미배치·BIM 명시 소속·외곽선 안)는
 * 정하지 않고 까닭을 돌려준다. `spaceId` 가 null 이면 지정을 지우고 기계 판정으로 돌린다. 같은 층의 물리존만 받는다.
 */
export function setEquipmentSpace(model: Model, equipmentId: string, spaceId: string | null): boolean | { refused: string } {
  const storey = model.storeys.find((s) => s.equipment.some((e) => e.id === equipmentId))
  const equipment = storey?.equipment.find((e) => e.id === equipmentId)
  if (!storey || !equipment) return false
  if (spaceId === null) {
    if (equipment.spaceSet === undefined) return false
    delete equipment.spaceSet
    assignEquipment(equipment, storey.spaces)
    return true
  }
  if (!storey.spaces.some((s) => s.id === spaceId)) return { refused: '같은 층의 물리존만 소속으로 정합니다.' }
  const can = spaceAssignable(equipment, storey.spaces)
  if (!can.ok) return { refused: can.reason }
  if (equipment.spaceSet === spaceId) return false
  equipment.spaceSet = spaceId
  assignEquipment(equipment, storey.spaces)
  return true
}

/** 물리존 이름을 고친다(E1). 라벨만 바뀌므로 다시 계산할 것이 없다. */
function setRoomKind(space: Space, found: ReturnType<typeof resolveRoomKind>) {
  space.kind = found?.info.kind ?? null
  if (found) space.kindSource = found.source
  else delete space.kindSource
}

/**
 * 같은 공간명의 물리존(OE-SPC-17 "같은 공간명의 방은 종류를 일괄 수정"). 건물의 모든 층에서 찾는다 — 성수의 `S.T`·`P.S` 처럼 층마다
 * 되풀이되는 이름이 일괄 수정을 바라는 경우다. 공간명이 비었으면 그 물리존 하나다. 앞뒤 빈칸은 견주지 않는다.
 */
export function sameNameSpaces(model: Model, spaceId: string): Space[] {
  const all = model.storeys.flatMap((s) => s.spaces)
  const space = all.find((s) => s.id === spaceId)
  if (!space) return []
  const name = space.longName.trim()
  return name ? all.filter((s) => s.longName.trim() === name) : [space]
}

/**
 * 방 종류를 사람이 정한다(OE-SPC-17). 출처는 `edit` 이고 이름을 고쳐도 남는다. `kind` 가 `undefined` 면 사람이 정한 것을 거두고 이름 사전 →
 * OmniClass 로 다시 읽는다. 사전이 읽는 값과 같은 종류를 고르면 거두는 것과 같다 — 편집 파일에 같은 값의 편집이 쌓이지 않게. `null` 은
 * "모름" 으로 정한 것이다(사전이 잘못 읽은 것을 지울 때). 바뀐 물리존 수를 돌려준다.
 */
export function setSpacesKind(model: Model, spaceIds: readonly string[], kind: string | null | undefined): number {
  if (kind && !roomKind(kind)) return 0
  const ids = new Set(spaceIds)
  let changed = 0
  for (const space of model.storeys.flatMap((s) => s.spaces)) {
    if (!ids.has(space.id)) continue
    const before = `${space.kind ?? ''}|${space.kindSource ?? ''}`
    const read = resolveRoomKind(space.name, space.longName, space.omniclass ?? null)
    if (kind === undefined || kind === (read?.info.kind ?? null)) setRoomKind(space, read)
    else {
      space.kind = kind
      space.kindSource = 'edit'
    }
    if (`${space.kind ?? ''}|${space.kindSource ?? ''}` !== before) changed++
  }
  return changed
}

/**
 * 같은 층에서 이 방번호를 쓰는 다른 물리존(OE-OBJ-02 "방번호는 한 층 안에서 고유"). 빈 번호는 아직 안 정한 것이라 겹쳐도 된다.
 * 공간명(longName)은 겹쳐도 된다.
 */
export function spaceNumberTaken(model: Model, storeyId: string, number: string, exceptId?: string): Space | null {
  const n = number.trim()
  if (!n) return null
  return model.storeys.find((s) => s.id === storeyId)?.spaces.find((sp) => sp.id !== exceptId && sp.name.trim() === n) ?? null
}

/**
 * 물리존의 방번호를 고친다. 같은 층에 같은 번호가 있으면 막고 이유를 돌려준다. 바뀌었으면 true.
 * `check: false` 는 편집 파일을 다시 얹을 때만 쓴다 — 번호를 맞바꾼 편집은 한 줄씩 넣는 도중에 잠깐 겹치므로, 다 넣은 뒤
 * 층마다 한 번 검사한다(edit-file.ts `applyEdits`).
 */
export function setSpaceNumber(model: Model, spaceId: string, number: string, check = true): boolean | { refused: string } {
  const storey = model.storeys.find((s) => s.spaces.some((sp) => sp.id === spaceId))
  const space = storey?.spaces.find((sp) => sp.id === spaceId)
  if (!storey || !space) return false
  const n = number.trim()
  if (space.name === n) return false
  const taken = check ? spaceNumberTaken(model, storey.id, n, spaceId) : null
  if (taken) return { refused: `${storey.name}에 방번호 ${n}${josa(n, '이/가')} 이미 있습니다(${taken.longName || taken.name}). 방번호는 한 층 안에서 겹치지 않아야 합니다.` }
  space.name = n
  // 방 종류는 이름 사전이 방번호(Name)도 읽어서 같이 다시 읽는다(renameSpace 와 같은 순서).
  setRoomKind(space, resolveRoomKind(space.name, space.longName, space.omniclass ?? null))
  return true
}

export function renameSpace(model: Model, spaceId: string, longName: string): boolean {
  for (const storey of model.storeys) {
    const space = storey.spaces.find((s) => s.id === spaceId)
    if (space) {
      space.longName = longName
      // 이름 사전으로 정한 방 종류는 이름을 따라간다. 계단을 "회의실" 로 고쳤는데 brick:Staircase 로 나갔다. 임포트와 같은 순서
      // (이름 사전 → OmniClass)로 다시 읽는다. 사람이 정한 종류(OE-SPC-17)는 이름을 고쳐도 그대로 둔다.
      if (space.kindSource !== 'edit') setRoomKind(space, resolveRoomKind(space.name, longName, space.omniclass ?? null))
      return true
    }
  }
  return false
}

/**
 * 편집 이력을 모아 결과 리포트로 만든다(PRD #21).
 *
 * 같은 설비를 여러 번 옮겼으면 마지막 것만 남긴다. 중간 과정은 읽는 사람에게 소용이 없고,
 * 처음과 끝이 같으면 아무것도 안 바뀐 것이라 목록에서 빠져야 한다.
 */
export function summarize(changes: readonly Change[]): Change[] {
  const last = new Map<string, Change>()
  const first = new Map<string, string | null>()

  for (const change of changes) {
    if (!first.has(change.equipmentId)) first.set(change.equipmentId, change.fromSpaceId)
    last.set(change.equipmentId, { ...change, fromSpaceId: first.get(change.equipmentId) ?? null })
  }

  return [...last.values()].filter((c) => c.fromSpaceId !== c.toSpaceId)
}

// --- 물리존 경계 편집 (E2) ----------------------------------------------------

/** 경계 편집이 만든 변화. 설비 소속 변화와 넓이 변화를 함께 담는다. */
export type BoundaryChange = {
  spaceId: string
  spaceName: string
  fromAreaM2: number
  toAreaM2: number
  /** 이 편집으로 소속이 바뀐 설비들. */
  equipment: Change[]
  /** 다각형이 자기 자신과 교차하게 되었나. 막지는 않고 알린다. */
  selfIntersecting: boolean
}

function findSpace(model: Model, spaceId: string) {
  for (const storey of model.storeys) {
    const space = storey.spaces.find((s) => s.id === spaceId)
    if (space) return space
  }
  return null
}

/** 설비의 현재 소속을 한 장 떠 둔다. 편집 전후를 견주려면 이게 필요하다. */
function snapshotSpaces(model: Model): Map<string, { name: string; spaceId: string | null }> {
  const out = new Map<string, { name: string; spaceId: string | null }>()
  for (const storey of model.storeys) {
    for (const e of storey.equipment) out.set(e.id, { name: e.name, spaceId: e.spaceId })
  }
  return out
}

/** 떠 둔 것과 지금을 견줘 바뀐 것만 고른다. */
function diffSpaces(
  model: Model,
  before: Map<string, { name: string; spaceId: string | null }>,
  labelOf: (id: string | null) => string,
): Change[] {
  const out: Change[] = []
  for (const storey of model.storeys) {
    for (const e of storey.equipment) {
      const was = before.get(e.id)
      if (!was || was.spaceId === e.spaceId) continue
      out.push({
        equipmentId: e.id,
        equipmentName: e.name,
        fromSpaceId: was.spaceId,
        toSpaceId: e.spaceId,
        summary: `${e.name}: 소속이 ${labelOf(was.spaceId)} 에서 ${labelOf(e.spaceId)} 로 바뀝니다.`,
      })
    }
  }
  return out
}

/** 꼭짓점 하나를 옮긴 고리. 닫힌 고리면 첫 점과 끝 점을 같이 옮긴다. */
function ringWithVertex(footprint: readonly Vec2[], vertexIndex: number, to: Vec2): Vec2[] {
  const ring = [...footprint]
  ring[vertexIndex] = to
  // 닫힌 고리의 첫 점과 끝 점은 같은 점이다. 하나만 옮기면 고리가 벌어진다.
  const last = ring.length - 1
  const closed = ring.length >= 2 && footprint[0][0] === footprint[last][0] && footprint[0][1] === footprint[last][1]
  if (closed) {
    if (vertexIndex === 0) ring[last] = to
    else if (vertexIndex === last) ring[0] = to
  }
  return ring
}

/**
 * 꼭짓점을 거기로 옮기면 경계가 자기 자신과 교차하는가. 3D 에서 끌어 놓기 전에 묻는다 — 놓고 나서
 * 알리면 이미 넓이와 소속이 뜻 없는 값으로 바뀐 뒤다.
 */
export function wouldSelfIntersect(model: Model, spaceId: string, vertexIndex: number, to: Vec2): boolean {
  const space = findSpace(model, spaceId)
  if (!space || vertexIndex < 0 || vertexIndex >= space.footprint.length) return false
  return isSelfIntersecting(ringWithVertex(space.footprint, vertexIndex, to))
}

/**
 * 물리존 경계의 꼭짓점 하나를 옮긴다(E2).
 *
 * 경계가 바뀌면 넓이가 바뀌고, 그 안에 있던 설비의 소속이 바뀐다. 편집기가 할 일은 그
 * 연쇄를 빠뜨리지 않는 것이므로, 좌표만 고치고 끝내지 않고 재판정까지 돌린 뒤 무엇이
 * 바뀌었는지 돌려준다.
 */
export function moveSpaceVertex(
  model: Model,
  spaceId: string,
  vertexIndex: number,
  to: Vec2,
): BoundaryChange | null {
  const space = findSpace(model, spaceId)
  if (!space || vertexIndex < 0 || vertexIndex >= space.footprint.length) return null

  const before = snapshotSpaces(model)
  const fromAreaM2 = space.areaM2
  const ring = ringWithVertex(space.footprint, vertexIndex, to)
  const release = shapeChanged(space.footprint, ring)

  space.footprint = ring
  space.areaM2 = polygonArea(ring)
  reassignStoreyWith(model, spaceId, release)

  return {
    spaceId,
    spaceName: space.longName || space.name,
    fromAreaM2,
    toAreaM2: space.areaM2,
    equipment: diffSpaces(model, before, (id) => spaceLabel(model, id)),
    selfIntersecting: isSelfIntersecting(ring),
  }
}

/**
 * 물리존 전체 경계를 갈아 끼운다. 분할·병합이 이 위에 올라간다.
 *
 * 꼭짓점 하나를 옮기는 것과 계산이 같아서 함수를 나누지 않았다. 다른 것은 입력뿐이다.
 *
 * `release: false` 는 편집 파일을 얹을 때다. 외곽선 줄은 끝 모양만 적어서 그 모양이 경계 수정에서 왔는지 합치기에서 왔는지
 * 모른다 — 합치기로 넓어진 남는 방은 BIM 소속을 그대로 두므로(OE-MAP-01 3단계) 여기서 풀면 세션과 달라진다. 세션에서 풀린
 * 설비는 설비 줄의 `released` 가 따로 푼다.
 */
export function replaceSpaceFootprint(model: Model, spaceId: string, ring: Vec2[], { release: mayRelease = true } = {}): BoundaryChange | null {
  const space = findSpace(model, spaceId)
  if (!space) return null

  const before = snapshotSpaces(model)
  const fromAreaM2 = space.areaM2
  const release = mayRelease && shapeChanged(space.footprint, ring)

  space.footprint = ring
  space.areaM2 = polygonArea(ring)
  reassignStoreyWith(model, spaceId, release)

  return {
    spaceId,
    spaceName: space.longName || space.name,
    fromAreaM2,
    toAreaM2: space.areaM2,
    equipment: diffSpaces(model, before, (id) => spaceLabel(model, id)),
    selfIntersecting: isSelfIntersecting(ring),
  }
}

// --- 되돌리기 -----------------------------------------------------------------

/**
 * 편집 한 번 전의 상태. 되돌리기는 이것을 그대로 되돌려 놓고 소속을 다시 판정한다.
 *
 * 반대로 옮기는 식(역연산)으로 되돌리지 않는다. `moveEquipment` 는 좌표 출처를 편집으로 바꾸고 BIM 소속을
 * 지우므로, 반대로 옮기면 자리는 같아도 출처가 BIM 에서 편집으로 바뀐 채 남는다.
 */
export type Snapshot =
  | {
      kind: 'equipment'
      id: string
      storeyId: string
      /** 층 목록 안의 자리. 층을 옮겼다 되돌리면 표의 순서도 돌아와야 한다. */
      index: number
      position: Vec3 | null
      positionSource: Equipment['positionSource']
      spaceId: string | null
      spaceSource: Equipment['spaceSource']
      /** 사람이 지정한 소속(K17). 옮기면 지워지므로 되돌릴 때 다시 둔다. */
      spaceSet?: string
      name: string
      nameEdited: Equipment['nameEdited']
      endShift: Equipment['endShift']
      wallId: string | undefined
      /** 사람이 정한 설치면(OE-EQP-05). */
      surfaceSet?: Equipment['surfaceSet']
    }
  | {
      kind: 'space'
      id: string
      footprint: Vec2[]
      areaM2: number
      name?: string
      longName: string
      roomKind: Space['kind']
      roomKindSource: Space['kindSource']
      /** BIM 이 이 물리존에 담아 둔 설비. 경계를 고치면 좌표 판정으로 풀리므로(Q13) 되돌릴 때 다시 담는다. */
      declared?: Equipment[]
    }
  | { kind: 'flow'; connection: Connection; edited: Connection['edited'] }
  | { kind: 'confirm'; connections: Connection[]; confirmed: boolean }
  | { kind: 'kinds'; entries: { id: string; kind: string | null | undefined; kindEdited: Equipment['kindEdited'] }[] }
  /** 연결이 모델에 있었는가. 잇기·끊기를 되돌린다. 연결 객체를 그대로 들고 있어 방향·확정도 같이 돌아온다. */
  | { kind: 'connection'; connection: Connection; present: boolean; index: number }
  /** BIM 포트 연결의 해제 보정·취소(OE-PIP-06, connection-release.ts). */
  | ReleaseSnapshot
  /** 계통 확정·재확정(OE-PIP-07). 규칙 방향을 통째로 든다. */
  | RuleSnapshot
  /**
   * 설비가 모델에 있었는가(E7 추가·삭제). 설비와 거기 붙은 연결·계통 자리를 객체째 들고 있어, 되돌리면 방향·확정까지
   * 그대로 돌아온다.
   */
  | {
      kind: 'equipment-set'
      equipment: Equipment
      storeyId: string
      index: number
      present: boolean
      connections: { connection: Connection; index: number }[]
      systems: { systemId: string; index: number }[]
    }
  /**
   * 한 층의 물리존 목록과 그 층 설비의 소속(E3 생성·삭제·분할·병합). 물리존 객체를 그대로 들고 있어 되돌려도 같은
   * 객체다 — 다른 스냅숏이 들고 있는 물리존이 엉뚱한 사본을 가리키지 않는다.
   */
  | {
      kind: 'storey-spaces'
      storeyId: string
      spaces: Space[]
      fields: {
        space: Space
        footprint: Vec2[]
        areaM2: number
        name: string
        longName: string
        roomKind: Space['kind']
        roomKindSource: Space['kindSource']
        merged: string[] | undefined
      }[]
      equipment: { equipment: Equipment; spaceId: string | null; spaceSource: Equipment['spaceSource'] }[]
      openings: { id: string; connects: string[] | undefined }[]
      /** 그 층의 사람이 만든 공조존. 물리존을 나누고 합치면 담당 물리존이 따라 바뀐다(OE-MAP-02). */
      hvacZones?: HvacZone[]
    }
  /** 계통의 구성원·종류·유체와 설비의 계통(E8). */
  | {
      kind: 'systems'
      /** 계통을 만들거나 지우면 목록 자체를 떠 둔다(없으면 목록은 그대로다). */
      list?: System[]
      systems: {
        system: System
        memberIds: string[]
        kind: System['kind']
        kindSource: System['kindSource']
        fluid: System['fluid']
        fluidSource: System['fluidSource']
        kindEdited: System['kindEdited']
        name: string
      }[]
      equipment: { equipment: Equipment; systemId: string | null; systemEdited: Equipment['systemEdited'] }[]
    }
  /** 한 번의 편집이 여러 대상을 바꿀 때(벽과 함께 방 경계 옮기기). 되돌릴 때는 거꾸로 되돌린다. */
  | { kind: 'many'; parts: Snapshot[] }
  /** 한 층의 커스텀존 목록(OE-OBJ-01). 소속을 담지 않으니(쓸 때 계산한다) 목록만 사본으로 떠 둔다. */
  | { kind: 'custom-zones'; storeyId: string; zones: CustomZone[] | undefined }
  | { kind: 'hvac-zones'; storeyId: string; zones: HvacZone[] | undefined }
  /** 층의 룸 전부(OE-OBJ-03). 만들기·지우기·옮기기·크기를 같은 방식으로 되돌린다. */
  | { kind: 'rooms'; storeyId: string; rooms: Room[] | undefined }
  /** 층의 추가 공간 오브젝트 전부(OE-OBJ-09). 놓기·지우기·옮기기·크기·이름을 같은 방식으로 되돌린다. */
  | { kind: 'space-objects'; storeyId: string; objects: SpaceObject[] | undefined }
  /** 한 층의 벽·문·창(E4). 객체를 그대로 들고 있어 되돌려도 같은 객체다. */
  | {
      kind: 'storey-elements'
      storeyId: string
      walls: Wall[]
      wallFields: {
        wall: Wall
        footprint: Vec2[][] | undefined
        loadBearing: boolean | null
        thickness: number | null
        height: number | null | undefined
        external: boolean | null | undefined
        externalEdited: true | undefined
      }[]
      /** 벽 면에 붙인 설비(OE-OBJ-04). 벽을 옮기면 같이 가고 벽을 지우면 떨어지니 자리와 붙은 벽을 같이 떠 둔다. */
      mounted: {
        equipment: Equipment
        position: Vec3 | null
        positionSource: Equipment['positionSource']
        wallId: string | undefined
        spaceId: string | null
        spaceSource: Equipment['spaceSource']
      }[]
      openings: Opening[]
      openingFields: {
        opening: Opening
        position: Vec3 | null | undefined
        connects: string[] | undefined
        connectsSource: Opening['connectsSource']
        width: number | null
        height: number | null
      }[]
      boundedBy: { space: Space; boundedBy: string[] }[]
    }

const copyZones = (zones: readonly CustomZone[]): CustomZone[] =>
  zones.map((z) => ({ id: z.id, name: z.name, ...(z.aliases?.length ? { aliases: [...z.aliases] } : {}), footprint: z.footprint.map((p) => [p[0], p[1]] as Vec2) }))

/** 한 층의 커스텀존 목록을 떠 둔다(OE-OBJ-01). 만들기·지우기·나누기·합치기·이름 고치기 전에 뜬다. */
export function snapshotRooms(model: Model, storeyId: string): Snapshot | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  return { kind: 'rooms', storeyId, rooms: storey.rooms ? copyRoomList(storey.rooms) : undefined }
}
const copyRoomList = (rooms: readonly Room[]): Room[] => rooms.map((r) => ({ ...r, footprint: r.footprint.map((p) => [p[0], p[1]] as Vec2) }))

/** 한 층의 추가 공간 오브젝트를 떠 둔다(OE-OBJ-09). */
export function snapshotSpaceObjects(model: Model, storeyId: string): Snapshot | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  return { kind: 'space-objects', storeyId, objects: storey.spaceObjects ? copyObjectList(storey.spaceObjects) : undefined }
}
const copyObjectList = (objects: readonly SpaceObject[]): SpaceObject[] =>
  objects.map((o) => ({ ...o, at: [o.at[0], o.at[1]] as Vec2, size: [o.size[0], o.size[1], o.size[2]] as Vec3 }))

export function snapshotCustomZones(model: Model, storeyId: string): Snapshot | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  return { kind: 'custom-zones', storeyId, zones: storey.customZones ? copyZones(storey.customZones) : undefined }
}

/** 층의 사람이 만든 공조존 목록(OE-ZON-01·02). 만들기·지우기·담당 설비 바꾸기를 되돌린다. */
export function snapshotHvacZones(model: Model, storeyId: string): Snapshot | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  return { kind: 'hvac-zones', storeyId, zones: storey.hvacZones ? copyHvacZones(storey.hvacZones) : undefined }
}

export function snapshotEquipment(model: Model, equipmentId: string): Snapshot | null {
  for (const storey of model.storeys) {
    const index = storey.equipment.findIndex((e) => e.id === equipmentId)
    if (index < 0) continue
    const e = storey.equipment[index]
    return {
      kind: 'equipment',
      id: e.id,
      storeyId: storey.id,
      index,
      position: e.position ? [e.position[0], e.position[1], e.position[2]] : null,
      positionSource: e.positionSource,
      spaceId: e.spaceId,
      spaceSource: e.spaceSource,
      ...(e.spaceSet !== undefined ? { spaceSet: e.spaceSet } : {}),
      name: e.name,
      nameEdited: e.nameEdited ? { ...e.nameEdited } : undefined,
      endShift: e.endShift ? copyShift(e.endShift) : undefined,
      wallId: e.wallId,
      surfaceSet: e.surfaceSet,
    }
  }
  return null
}

const copyShift = (s: readonly [Vec3, Vec3]): [Vec3, Vec3] => [[...s[0]], [...s[1]]]

/**
 * 경계와 이름. 좌표로 정한 소속은 담지 않는다 — 경계를 되돌리면 재판정이 같은 소속을 다시 낸다. BIM 이 담아 둔 소속은 경계를
 * 고칠 때 풀리고(Q13) 재판정으로는 돌아오지 않아서 따로 담는다.
 */
export function snapshotSpace(model: Model, spaceId: string): Snapshot | null {
  const space = findSpace(model, spaceId)
  if (!space) return null
  const declared = storeyOfSpace(model, spaceId)?.equipment.filter((e) => e.spaceSource === 'bim' && e.spaceId === spaceId) ?? []
  return {
    ...(declared.length ? { declared } : {}),
    kind: 'space',
    id: space.id,
    footprint: [...space.footprint],
    areaM2: space.areaM2,
    name: space.name,
    longName: space.longName,
    roomKind: space.kind,
    roomKindSource: space.kindSource,
  }
}

export function snapshotConnection(model: Model, connection: Connection): Snapshot {
  const index = model.connections.indexOf(connection)
  return { kind: 'connection', connection, present: index >= 0, index: index >= 0 ? index : model.connections.length }
}

export function snapshotFlow(connection: Connection): Snapshot {
  return { kind: 'flow', connection, edited: connection.edited ? { ...connection.edited } : undefined }
}

/** 계통 확정이 이번에 바꿀 연결. 이미 확정한 것은 되돌릴 때 건드리지 않는다. */
export function snapshotConfirm(model: Model, systemId: string | readonly string[]): Snapshot {
  // 계통 여럿을 한꺼번에 확정할 때도 되돌리기는 한 번이다.
  const ids = new Set(typeof systemId === 'string' ? [systemId] : systemId)
  return {
    kind: 'confirm',
    connections: model.connections.filter((c) => c.inferred && ids.has(c.inferred.systemId) && !c.inferred.confirmed),
    confirmed: false,
  }
}

/** 한 타입의 종류 전부. 종류를 바꾸기 전에 뜬다. */
export function snapshotType(model: Model, typeKey: string): Snapshot {
  return {
    kind: 'kinds',
    entries: model.storeys
      .flatMap((s) => s.equipment)
      .filter((e) => inKindGroup(e, typeKey))
      .map((e) => ({ id: e.id, kind: e.kind, kindEdited: e.kindEdited ? { ...e.kindEdited } : undefined })),
  }
}

/**
 * 스냅숏과 같은 대상의 지금 상태. 되돌리기 직전에 떠 두면 다시 하기(Ctrl+Shift+Z)가 이것을 restore 한다 —
 * 편집을 다시 부르지 않고 상태를 되돌려 놓으므로, 끌어 놓은 자리·확정한 연결이 되돌리기 전과 똑같다.
 */
export function snapshotOf(model: Model, snapshot: Snapshot): Snapshot | null {
  switch (snapshot.kind) {
    case 'equipment':
      return snapshotEquipment(model, snapshot.id)
    case 'space':
      return snapshotSpace(model, snapshot.id)
    case 'flow':
      return snapshotFlow(snapshot.connection)
    case 'confirm':
      return { kind: 'confirm', connections: snapshot.connections, confirmed: !!snapshot.connections[0]?.inferred?.confirmed }
    case 'connection':
      return snapshotConnection(model, snapshot.connection)
    case 'release':
      return snapshotRelease(model, snapshot.connection)
    case 'rule-state':
      return snapshotRulesAgain(snapshot)
    case 'equipment-set':
      return snapshotEquipmentSet(model, snapshot.equipment, snapshot.storeyId)
    case 'storey-spaces':
      return snapshotStoreySpaces(model, snapshot.storeyId)
    case 'storey-elements':
      return snapshotStoreyElements(model, snapshot.storeyId)
    case 'custom-zones':
      return snapshotCustomZones(model, snapshot.storeyId)
    case 'hvac-zones':
      return snapshotHvacZones(model, snapshot.storeyId)
    case 'rooms':
      return snapshotRooms(model, snapshot.storeyId)
    case 'space-objects':
      return snapshotSpaceObjects(model, snapshot.storeyId)
    case 'many': {
      const parts = snapshot.parts.map((p) => snapshotOf(model, p))
      return parts.every((p): p is Snapshot => !!p) ? { kind: 'many', parts } : null
    }
    case 'systems':
      return snapshotSystems(
        model,
        snapshot.systems.map((x) => x.system.id),
        snapshot.equipment.map((x) => x.equipment.id),
        !!snapshot.list,
      )
    case 'kinds': {
      const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
      return {
        kind: 'kinds',
        entries: snapshot.entries.flatMap((x) => {
          const e = byId.get(x.id)
          return e ? [{ id: e.id, kind: e.kind, kindEdited: e.kindEdited ? { ...e.kindEdited } : undefined }] : []
        }),
      }
    }
  }
}

/**
 * 스냅숏을 되돌려 놓고 소속을 다시 판정한다. 좌표·경계를 되돌렸는데 소속이 그대로면 리포트가 거짓이 된다.
 * 연결 방향과 확정은 소속과 상관이 없어 값만 되돌린다.
 */
export function restore(model: Model, snapshot: Snapshot): RuleReport | null {
  switch (snapshot.kind) {
    case 'equipment': {
      const equipment = findEquipment(model, snapshot.id)
      const home = model.storeys.find((s) => s.id === snapshot.storeyId)
      if (!equipment || !home) return null
      for (const storey of model.storeys) {
        const at = storey.equipment.indexOf(equipment)
        if (at >= 0) storey.equipment.splice(at, 1)
      }
      home.equipment.splice(Math.min(snapshot.index, home.equipment.length), 0, equipment)
      equipment.position = snapshot.position ? [snapshot.position[0], snapshot.position[1], snapshot.position[2]] : null
      if (snapshot.positionSource) equipment.positionSource = snapshot.positionSource
      else delete equipment.positionSource
      equipment.name = snapshot.name
      if (snapshot.nameEdited) equipment.nameEdited = { ...snapshot.nameEdited }
      else delete equipment.nameEdited
      if (snapshot.endShift) equipment.endShift = copyShift(snapshot.endShift)
      else delete equipment.endShift
      if (snapshot.wallId) equipment.wallId = snapshot.wallId
      else delete equipment.wallId
      if (snapshot.surfaceSet) equipment.surfaceSet = snapshot.surfaceSet
      else delete equipment.surfaceSet
      // BIM 이 말한 소속은 재판정이 건너뛰므로 값째 되돌린다. 나머지는 좌표로 다시 나온다.
      equipment.spaceSource = snapshot.spaceSource
      equipment.spaceId = snapshot.spaceId
      if (snapshot.spaceSet !== undefined) equipment.spaceSet = snapshot.spaceSet
      else delete equipment.spaceSet
      assignEquipment(equipment, home.spaces)
      return null
    }
    case 'space': {
      const space = findSpace(model, snapshot.id)
      if (!space) return null
      space.footprint = [...snapshot.footprint]
      space.areaM2 = snapshot.areaM2
      if (snapshot.name !== undefined) space.name = snapshot.name
      space.longName = snapshot.longName
      space.kind = snapshot.roomKind
      if (snapshot.roomKindSource) space.kindSource = snapshot.roomKindSource
      else delete space.kindSource
      // 스냅숏이 담은 설비가 그때 이 방의 BIM 소속 전부다. 지금 BIM 소속인데 거기 없는 것은 그때 풀려 있었다 — 다시 하기가
      // 경계를 고친 상태로 돌아갈 때 이것을 풀지 않으면, 되돌리기가 다시 담은 BIM 소속이 그대로 남는다.
      const declared = new Set(snapshot.declared ?? [])
      for (const e of storeyOfSpace(model, space.id)?.equipment ?? []) {
        if (e.spaceSource === 'bim' && e.spaceId === space.id && !declared.has(e)) e.spaceSource = null
      }
      for (const e of declared) {
        e.spaceId = space.id
        e.spaceSource = 'bim'
      }
      reassignStoreyWith(model, space.id)
      return null
    }
    case 'flow':
      if (snapshot.edited) snapshot.connection.edited = { ...snapshot.edited }
      else delete snapshot.connection.edited
      return null
    case 'confirm':
      for (const c of snapshot.connections) if (c.inferred) c.inferred.confirmed = snapshot.confirmed
      return null
    case 'release':
      return restoreRelease(model, snapshot)
    case 'rule-state':
      return restoreRules(model, snapshot)
    case 'connection': {
      const at = model.connections.indexOf(snapshot.connection)
      if (snapshot.present && at < 0) model.connections.splice(Math.min(snapshot.index, model.connections.length), 0, snapshot.connection)
      if (!snapshot.present && at >= 0) model.connections.splice(at, 1)
      return inferFlowByRules(model)
    }
    case 'equipment-set': {
      const home = model.storeys.find((st) => st.id === snapshot.storeyId)
      if (!home) return null
      for (const storey of model.storeys) {
        const at = storey.equipment.indexOf(snapshot.equipment)
        if (at >= 0) storey.equipment.splice(at, 1)
      }
      const id = snapshot.equipment.id
      for (let i = model.connections.length - 1; i >= 0; i--) {
        const c = model.connections[i]
        if (c.from === id || c.to === id) model.connections.splice(i, 1)
      }
      for (const system of model.systems) system.memberIds = system.memberIds.filter((m) => m !== id)
      if (snapshot.present) {
        home.equipment.splice(Math.min(snapshot.index, home.equipment.length), 0, snapshot.equipment)
        for (const { connection, index } of [...snapshot.connections].sort((a, b) => a.index - b.index)) {
          model.connections.splice(Math.min(index, model.connections.length), 0, connection)
        }
        for (const { systemId, index } of snapshot.systems) {
          const system = model.systems.find((x) => x.id === systemId)
          if (system) system.memberIds.splice(Math.min(index, system.memberIds.length), 0, id)
        }
      }
      return inferFlowByRules(model)
    }
    case 'storey-spaces': {
      const storey = model.storeys.find((st) => st.id === snapshot.storeyId)
      if (!storey) return null
      storey.spaces = [...snapshot.spaces]
      for (const f of snapshot.fields) {
        f.space.footprint = [...f.footprint]
        f.space.areaM2 = f.areaM2
        f.space.name = f.name
        f.space.longName = f.longName
        f.space.kind = f.roomKind
        if (f.roomKindSource) f.space.kindSource = f.roomKindSource
        else delete f.space.kindSource
        if (f.merged) f.space.merged = [...f.merged]
        else delete f.space.merged
      }
      for (const x of snapshot.equipment) {
        x.equipment.spaceId = x.spaceId
        x.equipment.spaceSource = x.spaceSource
      }
      for (const o of storey.openings) {
        const was = snapshot.openings.find((x) => x.id === o.id)
        if (!was) continue
        if (was.connects) o.connects = [...was.connects]
        else delete o.connects
      }
      for (const e of storey.equipment) assignEquipment(e, storey.spaces)
      relinkDoors(storey)
      if (snapshot.hvacZones) storey.hvacZones = copyHvacZones(snapshot.hvacZones)
      else delete storey.hvacZones
      return null
    }
    case 'storey-elements': {
      const storey = model.storeys.find((st) => st.id === snapshot.storeyId)
      if (!storey) return null
      storey.walls = [...snapshot.walls]
      for (const f of snapshot.wallFields) {
        if (f.footprint) f.wall.footprint = f.footprint.map((r) => r.map((p) => [p[0], p[1]] as Vec2))
        else delete f.wall.footprint
        f.wall.loadBearing = f.loadBearing
        f.wall.thickness = f.thickness
        if (f.height === undefined) delete f.wall.height
        else f.wall.height = f.height
        if (f.external === undefined) delete f.wall.external
        else f.wall.external = f.external
        if (f.externalEdited) f.wall.externalEdited = true
        else delete f.wall.externalEdited
      }
      for (const m of snapshot.mounted) {
        m.equipment.position = m.position ? [m.position[0], m.position[1], m.position[2]] : null
        if (m.positionSource) m.equipment.positionSource = m.positionSource
        else delete m.equipment.positionSource
        if (m.wallId) m.equipment.wallId = m.wallId
        else delete m.equipment.wallId
        m.equipment.spaceId = m.spaceId
        m.equipment.spaceSource = m.spaceSource
        assignEquipment(m.equipment, storey.spaces)
      }
      storey.openings = [...snapshot.openings]
      for (const f of snapshot.openingFields) {
        if (f.position === undefined) delete f.opening.position
        else f.opening.position = f.position ? [f.position[0], f.position[1], f.position[2]] : null
        if (f.connects) f.opening.connects = [...f.connects]
        else delete f.opening.connects
        if (f.connectsSource) f.opening.connectsSource = f.connectsSource
        else delete f.opening.connectsSource
        f.opening.width = f.width
        f.opening.height = f.height
      }
      for (const b of snapshot.boundedBy) b.space.boundedBy = [...b.boundedBy]
      return null
    }
    case 'custom-zones': {
      const storey = model.storeys.find((st) => st.id === snapshot.storeyId)
      if (!storey) return null
      if (snapshot.zones) storey.customZones = copyZones(snapshot.zones)
      else delete storey.customZones
      return null
    }
    case 'hvac-zones': {
      const storey = model.storeys.find((st) => st.id === snapshot.storeyId)
      if (!storey) return null
      if (snapshot.zones) storey.hvacZones = copyHvacZones(snapshot.zones)
      else delete storey.hvacZones
      return null
    }
    case 'rooms': {
      const storey = model.storeys.find((st) => st.id === snapshot.storeyId)
      if (!storey) return null
      if (snapshot.rooms) storey.rooms = copyRoomList(snapshot.rooms)
      else delete storey.rooms
      return null
    }
    case 'space-objects': {
      const storey = model.storeys.find((st) => st.id === snapshot.storeyId)
      if (!storey) return null
      if (snapshot.objects) storey.spaceObjects = copyObjectList(snapshot.objects)
      else delete storey.spaceObjects
      return null
    }
    case 'many': {
      let rules: RuleReport | null = null
      for (const part of [...snapshot.parts].reverse()) rules = restore(model, part) ?? rules
      return rules
    }
    case 'systems': {
      const set = <T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined) => {
        if (v === undefined) delete o[k]
        else o[k] = v
      }
      if (snapshot.list) model.systems = [...snapshot.list]
      for (const x of snapshot.systems) {
        x.system.memberIds = [...x.memberIds]
        set(x.system, 'kind', x.kind)
        set(x.system, 'kindSource', x.kindSource)
        set(x.system, 'fluid', x.fluid)
        set(x.system, 'fluidSource', x.fluidSource)
        set(x.system, 'kindEdited', x.kindEdited ? { ...x.kindEdited } : undefined)
        x.system.name = x.name
      }
      for (const x of snapshot.equipment) {
        x.equipment.systemId = x.systemId
        set(x.equipment, 'systemEdited', x.systemEdited ? { ...x.systemEdited } : undefined)
      }
      return inferFlowByRules(model)
    }
    case 'kinds': {
      const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
      for (const entry of snapshot.entries) {
        const e = byId.get(entry.id)
        if (!e) continue
        e.kind = entry.kind
        if (entry.kindEdited) e.kindEdited = { ...entry.kindEdited }
        else delete e.kindEdited
      }
      // 종류가 규칙 방향의 원천·말단을 정하므로 규칙도 다시 돌린다. 되돌리기는 거꾸로 쌓이므로 같은 결과가 나온다.
      return inferFlowByRules(model)
    }
  }
}

// --- 종류 지정 -------------------------------------------------------------------

/**
 * 설비의 타입 이름. 같은 타입은 같은 물건이라, 사전이 모르는 종류를 사람이 타입 하나에 한 번 정하면 그 타입 전부가
 * 채워진다(병원 HVAC 는 종류 모르는 기기 327대가 타입 6개였다).
 *
 * **ObjectType 만 믿으면 안 된다.** Revit 2011 은 ObjectType 에 유형 이름만 적는다(`150 mm`) — 다른 패밀리의
 * 같은 유형 이름과 한 묶음이 되어, VAV 로 고른 것이 150 mm 배관 부속에까지 붙는다. Revit 은 Name 에
 * "패밀리:유형:요소ID" 를 적으므로 요소 ID 를 뗀 것을 먼저 쓰고, 그 모양이 아니면 ObjectType 을 쓴다.
 * 둘 다 없으면 null 이다(그 설비 하나만 바뀐다).
 */
export function typeNameOf(e: Equipment): string | null {
  const revit = /^(.+:.+):\d+$/.exec(bimName(e))
  return revit ? revit[1] : e.objectType || null
}

/**
 * BIM 이 준 이름. 사람이 태그를 고쳐도 타입·패밀리 묶음은 BIM 이름으로 잡는다 — 고친 이름으로 묶으면 이름 하나 고친
 * 설비가 다른 묶음으로 옮겨 가서, 편집 파일을 불러올 때 종류가 엉뚱한 설비에 붙었다(실제 BIM 퍼징이 잡았다).
 */
export function bimName(e: Equipment): string {
  return e.nameEdited?.from ?? e.name
}

/** 타입의 열쇠. IFC 클래스까지 같아야 같은 타입이다 — 이름이 같아도 클래스가 다르면 다른 물건이다. */
export function typeKeyOf(e: Equipment): string {
  const name = typeNameOf(e)
  return name ? `${e.ifcClass}|${name}` : `#${e.id}`
}

/**
 * 패밀리 이름. Revit 의 "패밀리:유형" 에서 앞쪽이다. 같은 패밀리는 크기만 다른 같은 물건이 흔하다 — 병원 MEP 의
 * VAV 128대가 `M_VAV Unit - Single Duct` 한 패밀리에 유형(150·200·250·300·350 mm) 다섯이었다. 타입 단위로만
 * 고르게 하면 같은 VAV 를 다섯 번 고른다. Revit 모양이 아닌 이름(ObjectType 만 있는 것)은 타입이 곧 패밀리다.
 */
export function familyNameOf(e: Equipment): string | null {
  const type = typeNameOf(e)
  if (!type) return null
  return /^(.+:.+):\d+$/.test(bimName(e)) ? type.split(':')[0] : type
}

/** 패밀리의 열쇠. 타입 열쇠와 가르려고 `family:` 를 붙인다. 이름이 없으면 설비 하나다(타입 열쇠와 같다). */
export function familyKeyOf(e: Equipment): string {
  const name = familyNameOf(e)
  return name ? `family:${e.ifcClass}|${name}` : `#${e.id}`
}

/** 종류를 붙이는 묶음에 드는가. 열쇠가 `family:` 로 시작하면 패밀리, 아니면 타입이다. */
export function inKindGroup(e: Equipment, key: string): boolean {
  // `#id` 는 설비 한 대다(OE-EQP-14 "한 대만 따로"). 타입 이름이 없는 설비의 타입 열쇠도 같은 모양이라 같은 뜻이 된다.
  if (key.startsWith('#')) return e.id === key.slice(1)
  return key.startsWith('family:') ? familyKeyOf(e) === key : typeKeyOf(e) === key
}

/** 사람이 종류를 정한 타입. 리포트(PRD #21)에 한 줄씩 나간다. 사전 값으로 되돌린 타입은 빠진다. */
export type KindEdit = { typeKey: string; count: number; from: string | null; to: string | null }

/**
 * 한 타입(또는 `family:` 열쇠면 한 패밀리) 전부의 종류를 정한다. `kind` 가 `null` 이면 "모름" 이다 — 사전이 잘못 읽은 것(분전반을 조명으로)을
 * 지울 때 쓴다.
 *
 * **규칙 방향을 여기서 다시 돌린다.** 종류가 흐름의 원천·말단을 정해서(공조기는 공기의 원천, 디퓨저는 말단),
 * 종류만 바꾸고 규칙을 그대로 두면 화면의 상류·하류가 바뀐 종류와 어긋난다. 사람이 확정한 계통과 사람이 정한
 * 방향은 규칙을 다시 돌려도 남는다(inferFlowByRules).
 */
export function setTypeKind(
  model: Model,
  typeKey: string,
  kind: string | null,
): { count: number; rules: RuleReport } | null {
  if (kind !== null && !equipmentKind(kind)) return null
  const members = model.storeys.flatMap((s) => s.equipment).filter((e) => inKindGroup(e, typeKey))
  if (members.length === 0 || members.every((e) => (e.kind ?? null) === kind)) return null
  for (const e of members) {
    if (!e.kindEdited) e.kindEdited = { from: e.kind ?? null }
    e.kind = kind
    if (e.kindEdited.from === kind) delete e.kindEdited
  }
  return { count: members.length, rules: inferFlowByRules(model) }
}

export function kindEdits(model: Model): KindEdit[] {
  const byType = new Map<string, Equipment[]>()
  for (const e of model.storeys.flatMap((s) => s.equipment)) {
    const key = typeKeyOf(e)
    const list = byType.get(key)
    if (list) list.push(e)
    else byType.set(key, [e])
  }
  const types: KindEdit[] = []
  const singles: KindEdit[] = []
  for (const [key, members] of byType) {
    const edited = members.filter((e) => e.kindEdited)
    if (!edited.length) continue
    const kind = edited[0].kind ?? null
    // 타입의 설비가 다 그 종류면 타입 한 줄. 아니면(한 대만 따로 정한 것, OE-EQP-14) 고친 설비마다 `#id` 한 줄 — 타입으로 적으면
    // 다시 열 때 그 종류가 타입 전체에 번진다. 한 대 줄은 타입 줄 뒤에 둔다(얹는 순서가 곧 덮는 순서다).
    if (members.every((e) => (e.kind ?? null) === kind)) types.push({ typeKey: key, count: edited.length, from: edited[0].kindEdited!.from, to: kind })
    else for (const e of edited) singles.push({ typeKey: `#${e.id}`, count: 1, from: e.kindEdited!.from, to: e.kind ?? null })
  }
  return [...types, ...singles]
}

// --- 연 때와 견주기 ----------------------------------------------------------------
//
// 편집 기록(Change)은 소속 관계가 바뀐 것만 적는다. 그런데 내보내는 파일은 그것 말고도 바뀐다 — 이름을 고치면
// TTL 의 rdfs:label 이, 방 안에서 옮기면 GeoJSON 의 좌표가, 층을 옮기면 brick:hasPart 가 바뀐다. 리포트가 이걸
// 빼면 "바뀐 것 0건" 인 채로 다른 파일이 나간다. 편집 기록을 쌓는 대신 **연 때의 값과 지금 값을 견준다** —
// 되돌리기·다시 하기·제자리로 돌린 것이 저절로 맞는다.

export type Baseline = {
  names: Map<string, string>
  /** 물리존 방번호(IfcSpace Name, OE-OBJ-02). 옛 편집 파일에서 온 baseline 에는 없을 수 있다. */
  numbers?: Map<string, string>
  /** 물리존 외곽선. 편집 저장(edit-file.ts)이 바뀐 경계만 골라 담는다. */
  footprints: Map<string, Vec2[]>
  equipment: Map<string, { position: Vec3 | null; storeyId: string; spaceId: string | null; spaceSource?: Equipment['spaceSource']; name?: string; systemId?: string | null; wallId?: string | null }>
  /** 계통의 종류·유체(E8). 옛 편집 파일에서 온 baseline 에는 없을 수 있다. */
  systems?: Map<string, { name: string; kind: string | null; fluid: Fluid | null }>
  /** 연 때 있던 연결(순서 없는 짝). 이은 것·끊은 것을 이것과 견준다. 옛 편집 파일에서 온 baseline 에는 없을 수 있다. */
  connections?: Set<string>
  /**
   * 연 때의 지문(versions.ts). 지운 물리존·설비는 지금 모델에 없어서 지문을 다시 잴 수 없다 — 편집 파일이 그것들을
   * GUID 가 바뀐 판본에서도 찾으려면 연 때 떠 둔 것이 있어야 한다.
   */
  keys?: Map<string, Fingerprint>
  /** 벽·문·창(E4). 옮기고·지우고·더한 것을 이것과 견준다. */
  walls?: Map<
    string,
    {
      storeyId: string
      name: string
      footprint: Vec2[][] | undefined
      loadBearing: boolean | null
      /** 외벽 여부와 크기(OE-OBJ-04). 이 칸이 생기기 전의 baseline 에는 없다. */
      thickness?: number | null
      height?: number | null
      external?: boolean | null
      externalEdited?: boolean
    }
  >
  openings?: Map<string, { storeyId: string; name: string; kind: Opening['kind']; position: Vec3 | null | undefined; wallId: string | null; width?: number | null; height?: number | null }>
  /** 층마다 커스텀존(OE-OBJ-01) 목록의 사본. 이 칸이 생기기 전의 baseline 에는 없다(그때는 빈 것으로 본다). */
  customZones?: Map<string, CustomZone[]>
  /** 층마다 사람이 만든 공조존(OE-ZON-01·02) 목록의 사본. 이 칸이 생기기 전의 baseline 에는 없다(빈 것으로 본다). */
  hvacZones?: Map<string, HvacZone[]>
}

/** 파일을 열거나 합친 직후에 뜬다. */
export function baselineOf(model: Model): Baseline {
  const names = new Map<string, string>()
  const numbers = new Map<string, string>()
  const footprints = new Map<string, Vec2[]>()
  const equipment: Baseline['equipment'] = new Map()
  const walls: NonNullable<Baseline['walls']> = new Map()
  const openings: NonNullable<Baseline['openings']> = new Map()
  for (const storey of model.storeys) {
    for (const space of storey.spaces) {
      names.set(space.id, space.longName)
      numbers.set(space.id, space.name)
      footprints.set(space.id, space.footprint.map((p) => [p[0], p[1]] as Vec2))
    }
    for (const w of storey.walls) {
      walls.set(w.id, {
        storeyId: storey.id,
        name: w.name,
        footprint: w.footprint?.map((r) => r.map((p) => [p[0], p[1]] as Vec2)),
        loadBearing: w.loadBearing,
        thickness: w.thickness,
        height: w.height ?? null,
        external: w.external ?? null,
        externalEdited: !!w.externalEdited,
      })
    }
    for (const o of storey.openings) {
      openings.set(o.id, {
        storeyId: storey.id,
        name: o.name,
        kind: o.kind,
        position: o.position ? [o.position[0], o.position[1], o.position[2]] : o.position,
        wallId: o.wallId,
        width: o.width,
        height: o.height,
      })
    }
    for (const e of storey.equipment) {
      equipment.set(e.id, {
        position: e.position ? [e.position[0], e.position[1], e.position[2]] : null,
        storeyId: storey.id,
        spaceId: e.spaceId,
        spaceSource: e.spaceSource,
        name: e.name,
        systemId: e.systemId,
        wallId: e.wallId ?? null,
      })
    }
  }
  return {
    systems: new Map(model.systems.map((s) => [s.id, { name: s.name, kind: s.kind ?? null, fluid: s.fluid ?? null }])),
    names,
    numbers,
    footprints,
    equipment,
    connections: new Set(model.connections.map((c) => pairKey(c.from, c.to))),
    keys: fingerprints(model),
    customZones: new Map(model.storeys.map((s) => [s.id, copyZones(s.customZones ?? [])])),
    hvacZones: new Map(model.storeys.map((s) => [s.id, copyHvacZones(s.hvacZones ?? [])])),
    walls,
    openings,
  }
}

export type BaselineDiff = {
  renamed: { spaceId: string; from: string; to: string }[]
  /** 방번호(IfcSpace Name)가 바뀐 물리존(OE-OBJ-02). 옛 baseline(번호 없음)이면 비어 있다. */
  renumbered?: { spaceId: string; from: string; to: string }[]
  /** 좌표는 바뀌었는데 소속 물리존은 그대로인 설비. 소속이 바뀐 것은 Change 가 이미 적는다. */
  moved: { id: string; name: string }[]
  restoreyed: { id: string; name: string; from: string; to: string }[]
  /** 연 때 없던 연결(사람이 이은 것). */
  connected: { from: string; to: string }[]
  /** 연 때 있었는데 지금 없는 연결(사람이 끊은 것). 지운 설비에 붙어 같이 빠진 연결은 세지 않는다. */
  disconnected: { from: string; to: string }[]
  /** 사람이 만든 물리존·설비(E3·E7). */
  spacesAdded: { id: string; name: string }[]
  spacesRemoved: { id: string; name: string }[]
  equipmentAdded: { id: string; name: string }[]
  equipmentRemoved: { id: string; name: string }[]
  /** 이름(태그)을 고친 설비. */
  equipmentRenamed: { id: string; from: string; to: string }[]
  /** 벽 면에 붙이거나(`wall` 은 벽 이름) 벽에서 뗀(`null`) 설비(OE-OBJ-04). 연 때 있던 설비만 — 더한 설비는 equipmentAdded 에 든다. */
  equipmentMounted: { id: string; name: string; wall: string | null }[]
  /** 벽·문·창(E4). 지운 벽에 뚫려 같이 빠진 문·창은 openingsRemoved 에 세지 않는다. */
  wallsAdded: { id: string; name: string }[]
  wallsRemoved: { id: string; name: string }[]
  /**
   * 고친 벽. `resized` 는 두께·높이(OE-OBJ-04 크기 y·z), `external` 은 사람이 정한 외벽 여부(전·후. 연 때는 BIM 값 또는 null)다.
   * 길이·두께는 외곽선도 바꾸므로 `moved` 가 같이 선다.
   */
  wallsChanged: {
    id: string
    name: string
    moved: boolean
    loadBearing: { from: boolean | null; to: boolean | null } | null
    resized: boolean
    external: { from: boolean | null; to: boolean | null } | null
  }[]
  openingsAdded: { id: string; name: string; kind: Opening['kind'] }[]
  openingsRemoved: { id: string; name: string; kind: Opening['kind'] }[]
  /** 옮기거나(`moved`) 크기를 바꾼(`resized`, OE-OBJ-07) 문·창. */
  openingsMoved: { id: string; name: string; kind: Opening['kind']; moved: boolean; resized: boolean }[]
  /** 커스텀존(OE-OBJ-01). 만든 것·지운 것·고친 것(이름이나 다각형). 나누면 새 조각이 만든 것, 합치면 없어진 쪽이 지운 것이다. */
  customZones: { id: string; name: string; change: 'added' | 'removed' | 'changed' }[]
  /** 사람이 만든 공조존(OE-ZON-01·02). 만든 것·지운 것·고친 것(이름·담당 물리존·담당 설비·바닥). */
  hvacZones: { id: string; name: string; storeyId: string | null; change: 'added' | 'removed' | 'changed' }[]
  /** 계통을 바꾼 설비(E8). 계통 id 다. */
  systemMoved: { id: string; name: string; from: string | null; to: string | null }[]
  /** 사람이 만든 계통과 없어진 계통(E8). */
  systemsAdded: { id: string; name: string }[]
  systemsRemoved: { id: string; name: string }[]
  /** 종류·유체를 고친 계통(E8). */
  systemKinds: { id: string; name: string; from: { kind: string | null; fluid: Fluid | null }; to: { kind: string | null; fluid: Fluid | null } }[]
  /** 이름을 고친 계통(OE-PIP-09). 연 때 있던 계통만 — 사람이 만든 계통의 이름은 `systemsAdded` 가 끝 이름을 든다. */
  systemNames: { id: string; from: string; to: string }[]
}

/** 좌표를 같다고 보는 차. 표와 3D 가 센티미터로 자르므로 그보다 작은 차는 같은 자리다. */
const SAME_PLACE = 0.005

export function diffBaseline(model: Model, baseline: Baseline): BaselineDiff {
  const renamed: BaselineDiff['renamed'] = []
  const renumbered: NonNullable<BaselineDiff['renumbered']> = []
  const moved: BaselineDiff['moved'] = []
  const restoreyed: BaselineDiff['restoreyed'] = []
  const spacesAdded: BaselineDiff['spacesAdded'] = []
  const equipmentAdded: BaselineDiff['equipmentAdded'] = []
  const equipmentRenamed: BaselineDiff['equipmentRenamed'] = []
  const equipmentMounted: BaselineDiff['equipmentMounted'] = []
  const wallName = new Map(model.storeys.flatMap((s) => s.walls.map((w) => [w.id, w.name || '벽'] as const)))
  const systemMoved: BaselineDiff['systemMoved'] = []
  const storeyName = new Map(model.storeys.map((s) => [s.id, s.name]))
  const spacesNow = new Set<string>()
  const equipmentNow = new Set<string>()
  for (const storey of model.storeys) {
    for (const space of storey.spaces) {
      spacesNow.add(space.id)
      const from = baseline.names.get(space.id)
      if (from === undefined) spacesAdded.push({ id: space.id, name: space.longName || space.name })
      else if (from !== space.longName) renamed.push({ spaceId: space.id, from, to: space.longName })
      const number = baseline.numbers?.get(space.id)
      if (number !== undefined && number !== space.name) renumbered.push({ spaceId: space.id, from: number, to: space.name })
    }
    for (const e of storey.equipment) {
      equipmentNow.add(e.id)
      const was = baseline.equipment.get(e.id)
      if (!was) {
        equipmentAdded.push({ id: e.id, name: e.name || e.ifcClass })
        continue
      }
      if (was.name !== undefined && was.name !== e.name) equipmentRenamed.push({ id: e.id, from: was.name, to: e.name })
      if (was.wallId !== undefined && (was.wallId ?? null) !== (e.wallId ?? null)) {
        equipmentMounted.push({ id: e.id, name: e.name || e.ifcClass, wall: e.wallId ? (wallName.get(e.wallId) ?? e.wallId) : null })
      }
      const name = e.name || e.ifcClass
      if (was.systemId !== undefined && was.systemId !== e.systemId) systemMoved.push({ id: e.id, name, from: was.systemId, to: e.systemId })
      if (was.storeyId !== storey.id) {
        // 층을 옮기면 높이도 옮긴다. 층 줄 하나로 적고 좌표 줄에 다시 세지 않는다.
        restoreyed.push({ id: e.id, name, from: storeyName.get(was.storeyId) ?? was.storeyId, to: storey.name })
        continue
      }
      const shifted =
        (was.position === null) !== (e.position === null) ||
        (!!was.position && !!e.position && was.position.some((v, i) => Math.abs(v - e.position![i]) > SAME_PLACE))
      if (shifted && was.spaceId === e.spaceId) moved.push({ id: e.id, name })
    }
  }
  const connected: BaselineDiff['connected'] = []
  const disconnected: BaselineDiff['disconnected'] = []
  if (baseline.connections) {
    const now = new Set<string>()
    for (const c of model.connections) {
      const key = pairKey(c.from, c.to)
      now.add(key)
      if (!baseline.connections.has(key)) connected.push({ from: c.from, to: c.to })
    }
    for (const key of baseline.connections) {
      if (now.has(key)) continue
      const [from, to] = key.split('\u0000')
      // 지운 설비에 붙어 있던 연결은 설비와 같이 빠진 것이다. 끊은 연결로 따로 세지 않는다.
      // 해제 보정한 포트 연결도 끊은 것이 아니다 — 원본을 지우지 않고 해제했고, 편집 파일에 따로 적는다(connection-release.ts).
      if (releasedBetween(model, from, to)) continue
      if (baseline.equipment.has(from) && !equipmentNow.has(from)) continue
      if (baseline.equipment.has(to) && !equipmentNow.has(to)) continue
      disconnected.push({ from, to })
    }
  }
  const spacesRemoved = [...baseline.names].filter(([id]) => !spacesNow.has(id)).map(([id, name]) => ({ id, name: name || id }))
  const e4 = diffElements(model, baseline)
  const equipmentRemoved = [...baseline.equipment]
    .filter(([id]) => !equipmentNow.has(id))
    .map(([id, was]) => ({ id, name: was.name || id }))
  const systemKinds: BaselineDiff['systemKinds'] = []
  for (const system of model.systems) {
    const was = baseline.systems?.get(system.id)
    const to = { kind: system.kind ?? null, fluid: system.fluid ?? null }
    // 사람이 고친 것만 센다. 원천 기기로 짐작한 유체(flow-rules.ts 의 inferFluids)는 종류·연결을 고치면 따라 바뀌는 값이다.
    if (was && system.kindEdited && (was.kind !== to.kind || was.fluid !== to.fluid)) systemKinds.push({ id: system.id, name: system.name, from: { kind: was.kind, fluid: was.fluid }, to })
  }
  const systemNames: BaselineDiff['systemNames'] = []
  for (const system of model.systems) {
    const was = baseline.systems?.get(system.id)
    if (was && was.name !== system.name) systemNames.push({ id: system.id, from: was.name, to: system.name })
  }
  const systemsAdded = baseline.systems ? model.systems.filter((s) => !baseline.systems!.has(s.id)).map((s) => ({ id: s.id, name: s.name })) : []
  const systemIds = new Set(model.systems.map((s) => s.id))
  const systemsRemoved = baseline.systems ? [...baseline.systems].filter(([id]) => !systemIds.has(id)).map(([id, was]) => ({ id, name: was.name })) : []
  return {
    renamed,
    renumbered,
    moved,
    restoreyed,
    connected,
    disconnected,
    spacesAdded,
    spacesRemoved,
    equipmentAdded,
    equipmentRemoved,
    equipmentRenamed,
    equipmentMounted,
    ...e4,
    customZones: diffCustomZones(model, baseline),
    hvacZones: diffHvacZones(model, baseline),
    systemMoved,
    systemKinds,
    systemNames,
    systemsAdded,
    systemsRemoved,
  }
}

const sameRings = (a: readonly (readonly Vec2[])[] | undefined, b: readonly (readonly Vec2[])[] | undefined) =>
  (a?.length ?? 0) === (b?.length ?? 0) &&
  (a ?? []).every((r, i) => r.length === b![i].length && r.every((p, j) => Math.abs(p[0] - b![i][j][0]) < 1e-9 && Math.abs(p[1] - b![i][j][1]) < 1e-9))

function diffCustomZones(model: Model, baseline: Baseline): BaselineDiff['customZones'] {
  const was = new Map<string, CustomZone>()
  for (const zones of baseline.customZones?.values() ?? []) for (const z of zones) was.set(z.id, z)
  const out: BaselineDiff['customZones'] = []
  const now = new Set<string>()
  for (const storey of model.storeys) {
    for (const z of storey.customZones ?? []) {
      now.add(z.id)
      const before = was.get(z.id)
      if (!before) out.push({ id: z.id, name: z.name, change: 'added' })
      else if (before.name !== z.name || (before.aliases ?? []).join(' ') !== (z.aliases ?? []).join(' ') || !sameRings([before.footprint], [z.footprint]))
        out.push({ id: z.id, name: z.name, change: 'changed' })
    }
  }
  for (const [id, z] of was) if (!now.has(id)) out.push({ id, name: z.name, change: 'removed' })
  return out
}

function diffHvacZones(model: Model, baseline: Baseline): BaselineDiff['hvacZones'] {
  const was = new Map<string, HvacZone>()
  for (const zones of baseline.hvacZones?.values() ?? []) for (const z of zones) was.set(z.id, z)
  const out: BaselineDiff['hvacZones'] = []
  const now = new Set<string>()
  const same = (a: HvacZone, b: HvacZone) =>
    a.name === b.name && a.spaceIds.join(' ') === b.spaceIds.join(' ') && (a.servedBy ?? []).join(' ') === (b.servedBy ?? []).join(' ') && sameRings(a.footprint, b.footprint)
  for (const storey of model.storeys) {
    for (const z of storey.hvacZones ?? []) {
      now.add(z.id)
      const before = was.get(z.id)
      if (!before) out.push({ id: z.id, name: z.name, storeyId: z.storeyId, change: 'added' })
      else if (!same(before, z)) out.push({ id: z.id, name: z.name, storeyId: z.storeyId, change: 'changed' })
    }
  }
  for (const [id, z] of was) if (!now.has(id)) out.push({ id, name: z.name, storeyId: z.storeyId, change: 'removed' })
  return out
}

function diffElements(model: Model, baseline: Baseline) {
  const out: Pick<BaselineDiff, 'wallsAdded' | 'wallsRemoved' | 'wallsChanged' | 'openingsAdded' | 'openingsRemoved' | 'openingsMoved'> = {
    wallsAdded: [],
    wallsRemoved: [],
    wallsChanged: [],
    openingsAdded: [],
    openingsRemoved: [],
    openingsMoved: [],
  }
  if (!baseline.walls || !baseline.openings) return out
  const wallsNow = new Set<string>()
  const openingsNow = new Set<string>()
  for (const storey of model.storeys) {
    for (const w of storey.walls) {
      wallsNow.add(w.id)
      const was = baseline.walls.get(w.id)
      if (!was) {
        out.wallsAdded.push({ id: w.id, name: w.name })
        continue
      }
      const moved = !sameRings(was.footprint, w.footprint)
      const lb = was.loadBearing !== w.loadBearing ? { from: was.loadBearing, to: w.loadBearing } : null
      const near = (x: number | null | undefined, y: number | null | undefined) => (x ?? null) === (y ?? null) || (x != null && y != null && Math.abs(x - y) < 1e-9)
      const resized = (was.thickness !== undefined && !near(was.thickness, w.thickness)) || (was.height !== undefined && !near(was.height, w.height))
      const ext =
        was.external !== undefined && (!!was.externalEdited !== !!w.externalEdited || (was.external ?? null) !== (w.external ?? null))
          ? { from: was.external ?? null, to: w.external ?? null }
          : null
      if (moved || lb || resized || ext) out.wallsChanged.push({ id: w.id, name: w.name, moved, loadBearing: lb, resized, external: ext })
    }
    for (const o of storey.openings) {
      openingsNow.add(o.id)
      const was = baseline.openings.get(o.id)
      if (!was) {
        out.openingsAdded.push({ id: o.id, name: o.name, kind: o.kind })
        continue
      }
      const a = was.position
      const b = o.position
      const moved = (a == null) !== (b == null) || (!!a && !!b && (Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9))
      const differs = (x: number | null | undefined, y: number | null | undefined) => (x ?? null) !== (y ?? null) && !(x != null && y != null && Math.abs(x - y) < 1e-9)
      const resized = differs(was.width, o.width) || differs(was.height, o.height)
      if (moved || resized) out.openingsMoved.push({ id: o.id, name: o.name, kind: o.kind, moved, resized })
    }
  }
  for (const [id, was] of baseline.walls) if (!wallsNow.has(id)) out.wallsRemoved.push({ id, name: was.name })
  const wallGone = new Set(out.wallsRemoved.map((w) => w.id))
  for (const [id, was] of baseline.openings) {
    if (openingsNow.has(id) || (was.wallId && wallGone.has(was.wallId))) continue
    out.openingsRemoved.push({ id, name: was.name, kind: was.kind })
  }
  return out
}

// --- 연결 잇기·끊기 --------------------------------------------------------------
//
// 형상 추정이 빠뜨린 연결을 잇고, 잘못 이은 연결을 끊는다. 연결이 곧 `brick:feeds` 의 재료라 온톨로지 편집의
// 본체다. **포트(BIM)가 말한 연결은 끊지 않는다** — 방향과 같은 이유로, BIM 이 말한 것을 덮어쓰면 읽는 쪽이 둘을
// 구별할 수 없다. 이은 연결은 방향 없이 시작한다(추정한 것에 방향을 찍지 않는 것과 같다). 잇거나 끊으면 연결망이
// 바뀌므로 규칙 방향을 다시 돌린다 — 종류를 바꿀 때와 같다.

/** 순서 없는 연결의 열쇠. GUID 에 들어가지 않는 글자로 잇는다. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`
}

export function connectionBetween(model: Model, a: string, b: string): Connection | null {
  const key = pairKey(a, b)
  return model.connections.find((c) => pairKey(c.from, c.to) === key) ?? null
}

/** 두 설비를 잇는다. 이미 이어져 있거나 같은 설비면 null. 해제 보정한 BIM 연결이 있는 두 설비도 null — 그 연결의 해제를 취소한다. */
export function addConnection(model: Model, a: string, b: string): { connection: Connection; rules: RuleReport } | null {
  if (a === b || !findEquipment(model, a) || !findEquipment(model, b) || connectionBetween(model, a, b) || releasedBetween(model, a, b)) return null
  const connection: Connection = { from: a, to: b, source: 'manual', directed: false, tolerance: null }
  model.connections.push(connection)
  return { connection, rules: inferFlowByRules(model) }
}

/** 연결을 끊는다. 포트가 말한 연결이면 null. */
export function removeConnection(model: Model, connection: Connection): RuleReport | null {
  if (connection.source === 'port') return null
  const at = model.connections.indexOf(connection)
  if (at < 0) return null
  model.connections.splice(at, 1)
  return inferFlowByRules(model)
}

// --- 꼭짓점 넣기·지우기 -----------------------------------------------------------
//
// 꼭짓점을 옮기기만 해서는 ㄱ자 방을 사각형으로 바꾸거나 모서리를 하나 더 낼 수 없었다. 닫는 점(첫 점과 같은 끝 점)은
// 꼭짓점으로 세지 않고, 고친 뒤에도 원래 닫혀 있었으면 닫는다. 결과는 경계를 통째로 바꾼 것과 같아서
// replaceSpaceFootprint 로 넘긴다(넓이·소속 재판정이 거기 있다).

function isClosedRing(ring: readonly Vec2[]): boolean {
  const last = ring.at(-1)
  return ring.length > 1 && !!last && ring[0][0] === last[0] && ring[0][1] === last[1]
}

/** 닫는 점을 뺀 꼭짓점들. */
export function openRing(ring: readonly Vec2[]): Vec2[] {
  return (isClosedRing(ring) ? ring.slice(0, -1) : ring).map((p) => [p[0], p[1]] as Vec2)
}

const withClosing = (points: Vec2[], closed: boolean): Vec2[] => (closed && points.length ? [...points, [points[0][0], points[0][1]]] : points)

/** index 꼭짓점과 다음 꼭짓점의 가운데에 꼭짓점을 넣는다. 넣은 꼭짓점의 번호는 index + 1 이다. */
export function insertSpaceVertex(model: Model, spaceId: string, index: number): BoundaryChange | null {
  const space = findSpace(model, spaceId)
  if (!space) return null
  const points = openRing(space.footprint)
  if (index < 0 || index >= points.length || points.length < 2) return null
  const a = points[index]
  const b = points[(index + 1) % points.length]
  points.splice(index + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
  return replaceSpaceFootprint(model, spaceId, withClosing(points, isClosedRing(space.footprint)))
}

/** 꼭짓점을 지운다. 셋보다 적어지면 다각형이 아니라서 지우지 않는다. */
export function deleteSpaceVertex(model: Model, spaceId: string, index: number): BoundaryChange | null {
  const space = findSpace(model, spaceId)
  if (!space) return null
  const points = openRing(space.footprint)
  if (index < 0 || index >= points.length || points.length <= 3) return null
  points.splice(index, 1)
  return replaceSpaceFootprint(model, spaceId, withClosing(points, isClosedRing(space.footprint)))
}

/** 외곽선이 없던 물리존에 새 외곽선을 준다(3D 에서 찍은 점들). 닫아서 넣는다. */
export function drawSpaceFootprint(model: Model, spaceId: string, points: readonly Vec2[]): BoundaryChange | null {
  if (points.length < 3) return null
  return replaceSpaceFootprint(model, spaceId, withClosing(points.map((p) => [p[0], p[1]] as Vec2), true))
}

// --- 설비 추가·삭제·이름 (E7) ------------------------------------------------------
//
// 현장에서 설비가 새로 달리거나 떼어지거나 이름(태그)이 바뀐다. 추가한 설비는 BIM 에 없던 것이라 `added` 로 표시하고
// 화면의 출처를 "편집"으로 둔다. 지운 설비는 거기 붙은 연결과 계통 자리도 같이 빠진다 — 남기면 온톨로지에 없는
// 설비를 가리키는 `brick:feeds`·`brick:hasPart` 가 나간다. 연결이 바뀌므로 규칙 방향을 다시 돌린다.

const ID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'

/**
 * 사람이 만든 것의 id. IfcGlobalId 처럼 22자이고, `$` 를 뺀 글자만 쓴다 — `$` 는 Turtle 에서 이스케이프해야 하고
 * 받는 쪽(ttl.go)이 키에 `\$` 를 남긴다(intent.md). 첫 두 글자 `U_` 로 BIM 에서 온 것과 가른다.
 */
export function newId(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return `U_${Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('')}`
}

export type NewEquipment = { name: string; kind: string | null; position: Vec3 | null; id?: string }

/** 설비를 더한다. 좌표가 있으면 소속을 판정한다. 좌표 없이 더하면 미배치 목록에 들어간다(E6 으로 놓는다). */
export function addEquipment(model: Model, storeyId: string, spec: NewEquipment): Equipment | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  if (spec.kind !== null && !equipmentKind(spec.kind)) return null
  const id = spec.id ?? newId()
  if (findEquipment(model, id)) return null
  const info = equipmentKind(spec.kind)
  const equipment: Equipment = {
    id,
    name: spec.name,
    // IFC 클래스는 모른다. 설비 전체의 윗 클래스로 둔다 — 종류를 고르면 Brick 클래스는 종류에서 나온다.
    ifcClass: 'DistributionElement',
    objectType: '',
    declaredType: null,
    kind: spec.kind,
    role: info?.role ?? null,
    position: spec.position ? [spec.position[0], spec.position[1], spec.position[2]] : null,
    ...(spec.position ? { positionSource: 'edited' as const } : {}),
    capacity: null,
    capacityProperty: null,
    systemId: null,
    spaceId: null,
    spaceSource: null,
    added: true,
  }
  storey.equipment.push(equipment)
  assignEquipment(equipment, storey.spaces)
  return equipment
}

/** 설비를 지운다. 붙은 연결과 계통 자리도 뺀다. 지운 연결 수와 다시 돌린 규칙 방향을 돌려준다. */
export function deleteEquipment(model: Model, equipmentId: string): { connections: number; rules: RuleReport } | null {
  const storey = model.storeys.find((s) => s.equipment.some((e) => e.id === equipmentId))
  if (!storey) return null
  storey.equipment = storey.equipment.filter((e) => e.id !== equipmentId)
  let removed = 0
  for (let i = model.connections.length - 1; i >= 0; i--) {
    const c = model.connections[i]
    if (c.from === equipmentId || c.to === equipmentId) {
      model.connections.splice(i, 1)
      removed++
    }
  }
  for (const system of model.systems) system.memberIds = system.memberIds.filter((m) => m !== equipmentId)
  return { connections: removed, rules: inferFlowByRules(model) }
}

/** 설비 이름(태그)을 고친다. TTL 의 rdfs:label 이 바뀐다. */
export function renameEquipment(model: Model, equipmentId: string, name: string): boolean {
  const equipment = findEquipment(model, equipmentId)
  if (!equipment || equipment.name === name) return false
  if (!equipment.nameEdited) equipment.nameEdited = { from: equipment.name }
  equipment.name = name
  if (equipment.nameEdited.from === name) delete equipment.nameEdited
  return true
}

/** 설비 추가·삭제 전의 상태. 지우기 전에 뜨면 되돌릴 때 연결·계통 자리까지 제자리로 돌아온다. */
export function snapshotEquipmentSet(model: Model, equipment: Equipment | string, storeyId?: string): Snapshot | null {
  const target = typeof equipment === 'string' ? findEquipment(model, equipment) : equipment
  if (!target) return null
  const home = model.storeys.find((s) => s.equipment.includes(target))
  const id = target.id
  if (!home) {
    if (!storeyId) return null
    return { kind: 'equipment-set', equipment: target, storeyId, index: 0, present: false, connections: [], systems: [] }
  }
  return {
    kind: 'equipment-set',
    equipment: target,
    storeyId: home.id,
    index: home.equipment.indexOf(target),
    present: true,
    connections: model.connections.flatMap((connection, index) => (connection.from === id || connection.to === id ? [{ connection, index }] : [])),
    systems: model.systems.flatMap((s) => (s.memberIds.includes(id) ? [{ systemId: s.id, index: s.memberIds.indexOf(id) }] : [])),
  }
}

// --- 물리존 생성·삭제·분할·병합 (E3) -------------------------------------------------
//
// 경계 편집(E2)과 같이 설비 소속을 그 층에서 다시 판정한다. 다른 것은 물리존이 생기고 없어진다는 것이다.
//
// **없어진 물리존을 가리키던 BIM 소속은 버리고 좌표로 다시 잰다.** BIM 이 말한 "이 방" 이 온톨로지에 없으면 없는 방을
// 가리키는 `brick:hasLocation` 이 나간다. 합칠 때도 같다 — 합친 방은 BIM 이 말한 방이 아니다. 나눌 때는 원래 방의
// id 가 남는 조각에 있는 설비만 BIM 소속을 지키고, 새 조각으로 간 설비는 좌표로 다시 잰다.
// 문이 잇는 방(`connects`)도 같이 고친다.

/** 한 층의 물리존과 설비 소속을 떠 둔다. 생성·삭제·분할·병합 전에 뜨면 되돌릴 수 있다. */
export function snapshotStoreySpaces(model: Model, storeyId: string): Snapshot | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  return {
    kind: 'storey-spaces',
    storeyId,
    spaces: [...storey.spaces],
    fields: storey.spaces.map((space) => ({
      space,
      footprint: [...space.footprint],
      areaM2: space.areaM2,
      name: space.name,
      longName: space.longName,
      roomKind: space.kind,
      roomKindSource: space.kindSource,
      merged: space.merged ? [...space.merged] : undefined,
    })),
    equipment: storey.equipment.map((equipment) => ({ equipment, spaceId: equipment.spaceId, spaceSource: equipment.spaceSource })),
    openings: storey.openings.map((o) => ({ id: o.id, connects: o.connects ? [...o.connects] : undefined })),
    ...(storey.hvacZones ? { hvacZones: copyHvacZones(storey.hvacZones) } : {}),
  }
}

export type SpaceSetChange = {
  storeyId: string
  /** 새로 생긴 물리존 id(생성·분할). */
  created: string[]
  /** 없어진 물리존 id(삭제·병합). */
  removed: string[]
  /** 소속이 바뀐 설비. */
  equipment: Change[]
}

function storeyOfSpace(model: Model, spaceId: string): Storey | null {
  return model.storeys.find((s) => s.spaces.some((x) => x.id === spaceId)) ?? null
}

/** 없어진 물리존을 가리키던 것을 정리하고 층을 다시 판정한다. `rename` 은 합친 방처럼 다른 방으로 이어지는 것이다. */
function settleStorey(
  model: Model,
  storey: Storey,
  gone: Set<string>,
  before: ReturnType<typeof snapshotSpaces>,
  rename = new Map<string, string>(),
): Change[] {
  for (const e of storey.equipment) {
    if (e.spaceSource === 'bim' && e.spaceId && gone.has(e.spaceId)) e.spaceSource = null
  }
  for (const o of storey.openings) {
    if (!o.connects) continue
    o.connects = [...new Set(o.connects.flatMap((id) => (rename.has(id) ? [rename.get(id)!] : gone.has(id) ? [] : [id])))]
  }
  for (const e of storey.equipment) assignEquipment(e, storey.spaces)
  relinkDoors(storey)
  return diffSpaces(model, before, (id) => spaceLabel(model, id))
}

export type NewSpace = { name: string; longName: string; footprint: readonly Vec2[]; id?: string }

/** 물리존을 만든다. 외곽선은 닫아서 넣는다. */
export function createSpace(model: Model, storeyId: string, spec: NewSpace): SpaceSetChange | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  const points = openRing(spec.footprint)
  if (!storey || points.length < 3) return null
  const id = spec.id ?? newId()
  if (findSpace(model, id)) return null
  const ring = withClosing(points, true)
  const before = snapshotSpaces(model)
  storey.spaces.push({ id, name: spec.name, longName: spec.longName, footprint: ring, areaM2: polygonArea(ring), boundedBy: [], added: true })
  // 사람이 만든 방도 이름으로 종류를 읽는다. 이름을 고친 방과 같은 규칙이라야 편집 파일로 되살린 방과 같아진다.
  const made = storey.spaces[storey.spaces.length - 1]
  setRoomKind(made, resolveRoomKind(made.name, made.longName, null))
  return { storeyId: storey.id, created: [id], removed: [], equipment: settleStorey(model, storey, new Set(), before) }
}

/**
 * 물리존을 지운다. **층에 하나 남은 물리존은 지우지 않는다** — 층이 비면 그 층 설비가 전부 층에만 걸린다.
 * 지운 방의 설비는 좌표로 다시 판정되어 옆 방이나 층으로 간다.
 */
export function deleteSpace(model: Model, spaceId: string): SpaceSetChange | { refused: string } | null {
  const storey = storeyOfSpace(model, spaceId)
  if (!storey) return null
  if (storey.spaces.length <= 1) return { refused: '층에 하나 남은 물리존은 지울 수 없습니다.' }
  const before = snapshotSpaces(model)
  storey.spaces = storey.spaces.filter((s) => s.id !== spaceId)
  remapZonesForSpaces(storey, { removed: spaceId })
  return { storeyId: storey.id, created: [], removed: [spaceId], equipment: settleStorey(model, storey, new Set([spaceId]), before) }
}

function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * 물리존을 두 점을 지나는 선으로 둘로 나눈다. 넓은 조각이 원래 id·이름을 갖고, 다른 조각은 새 id 에 공간명 `이름-2` 다.
 * 새 조각의 방번호는 비워 둔다 — 사람이 넣는다(OE-SPC-02). 번호를 지어 붙이면 BIM 에 없는 번호가 그대로 TTL·GeoJSON 에 들어간다.
 * 나눌 수 없는 선이면(방을 안 지나거나 셋 이상으로 자르면) 이유를 돌려준다.
 */
export function splitSpace(
  model: Model,
  spaceId: string,
  a: Vec2,
  b: Vec2,
  newSpaceId?: string,
): SpaceSetChange | { refused: string } | null {
  const storey = storeyOfSpace(model, spaceId)
  const space = storey?.spaces.find((s) => s.id === spaceId)
  if (!storey || !space) return null
  const cut = splitRing(space.footprint, a, b)
  if (!cut.ok) return { refused: cut.reason }
  const [big, small] = [...cut.rings].sort((x, y) => polygonArea(y) - polygonArea(x))
  const id = newSpaceId ?? newId()
  if (findSpace(model, id)) return null
  const before = snapshotSpaces(model)
  space.footprint = big
  space.areaM2 = polygonArea(big)
  // 새 조각은 목록 끝에 둔다. 원래 방 바로 뒤에 끼우면 편집 파일에서 되살린 층과 순서(hasPart)가 달라진다.
  storey.spaces.push({
    id,
    name: '',
    longName: space.longName ? `${space.longName}-2` : '',
    footprint: small,
    areaM2: polygonArea(small),
    boundedBy: [],
    added: true,
  })
  const piece = storey.spaces[storey.spaces.length - 1]
  setRoomKind(piece, resolveRoomKind(piece.name, piece.longName, null))
  // 사람이 나눈 물리존은 BIM 이 거기 담아 둔 설비도 좌표로 다시 판정한다(OE-MAP-01 3단계, Q13). 좁은 조각에 든 설비는 좁은
  // 조각으로, 넓은 조각(원래 id)에 든 설비는 그대로, 둘 다 밖인 설비는 좌표대로 다른 방이나 층으로 간다.
  releaseDeclared(storey, spaceId)
  // 나눈 물리존을 담당하던 공조존은 두 조각 모두 담당한다(OE-MAP-02).
  remapZonesForSpaces(storey, { split: [spaceId, id] })
  return { storeyId: storey.id, created: [id], removed: [], equipment: settleStorey(model, storey, new Set(), before) }
}

/**
 * 두 물리존을 합친다. `keepId` 가 남고 외곽선이 둘을 합친 것이 된다. 벽 두께만큼 떨어진 방은 벽 자리까지 합친다
 * (polygon.ts 의 unionRings). 같은 층이 아니거나 합칠 수 없는 모양이면 이유를 돌려준다. 문이 잇던 방은 남는 방으로
 * 바뀌고, 두 방 사이의 문은 이제 한 방에만 걸린다.
 */
export function mergeSpaces(
  model: Model,
  keepId: string,
  otherId: string,
): (SpaceSetChange & { bridged: boolean }) | { refused: string } | null {
  if (keepId === otherId) return null
  const storey = storeyOfSpace(model, keepId)
  const keep = storey?.spaces.find((s) => s.id === keepId)
  if (!storey || !keep) return null
  const other = storey.spaces.find((s) => s.id === otherId)
  if (!other) return { refused: '같은 층의 물리존끼리만 합칩니다.' }
  const union = unionRings(keep.footprint, other.footprint)
  if (!union.ok) return { refused: union.reason }
  const before = snapshotSpaces(model)
  keep.footprint = union.ring
  keep.areaM2 = polygonArea(union.ring)
  return { ...absorb(model, storey, keep, other, before), bridged: union.bridged }
}

function absorb(model: Model, storey: Storey, keep: Space, other: Space, before: ReturnType<typeof snapshotSpaces>): SpaceSetChange {
  keep.merged = [...(keep.merged ?? []), other.id, ...(other.merged ?? [])]
  storey.spaces = storey.spaces.filter((s) => s !== other)
  remapZonesForSpaces(storey, { merged: [keep.id, other.id] })
  const equipment = settleStorey(model, storey, new Set([other.id]), before, new Map([[other.id, keep.id]]))
  return { storeyId: storey.id, created: [], removed: [other.id], equipment }
}

/**
 * 합친 방을 편집 파일에서 되살린다. 모양은 건드리지 않는다 — 남는 방의 외곽선은 편집 파일이 끝 모양으로 따로 적고,
 * 합친 뒤에 그 외곽선을 또 고쳤을 수 있다. 합치기를 다시 계산하면 그 뒤의 편집이 덮인다(퍼징이 잡았다).
 */
export function absorbSpace(model: Model, keepId: string, otherId: string): SpaceSetChange | null {
  if (keepId === otherId) return null
  const storey = storeyOfSpace(model, keepId)
  const keep = storey?.spaces.find((s) => s.id === keepId)
  const other = storey?.spaces.find((s) => s.id === otherId)
  if (!storey || !keep || !other) return null
  return absorb(model, storey, keep, other, snapshotSpaces(model))
}


// --- 벽·문·창 편집 (E4) --------------------------------------------------------------
//
// 벽·문·창은 GeoJSON 에만 있다(TTL 주어가 아니다). 바뀌는 것은 3D Map 과 로봇 경로다 — 벽 외곽선, 문·창 자리, 문이 잇는
// 방(F15). **물리존 경계는 벽에서 다시 만들지 않는다.** IfcSpace 의 외곽선은 벽과 따로 그려진 것이라, 벽을 옮겨도 방
// 경계는 사람이 E2 로 고친다. 편집이 방을 지어내지 않는다.
//
// 문이 잇는 방은 좌표로 짚은 것(`calc`)이면 문이나 방 경계가 바뀔 때마다 다시 짚는다(relinkDoors). BIM 이 공간 경계로
// 말한 문은 그대로 두다가, 사람이 그 문을 옮기면 좌표로 다시 짚는다 — 옮긴 문에 BIM 이 말한 방을 남기면 거짓이 된다.

/** 좌표로 짚은 문이 잇는 방을 다시 짚는다. 문 자리·방 경계가 바뀐 뒤에 부른다. 같은 입력이면 같은 답이다(임포트와 같은 함수). */
export function relinkDoors(storey: Storey): void {
  for (const o of storey.openings) {
    if (o.kind !== 'door' || o.connectsSource !== 'calc' || !o.position || !o.through) continue
    o.connects = spacesBesideOpening({ position: o.position, through: o.through, depth: o.depth ?? 0.2 }, storey.spaces)
  }
}

function findWall(model: Model, wallId: string): { storey: Storey; wall: Wall } | null {
  for (const storey of model.storeys) {
    const wall = storey.walls.find((w) => w.id === wallId)
    if (wall) return { storey, wall }
  }
  return null
}

function findOpening(model: Model, openingId: string): { storey: Storey; opening: Opening } | null {
  for (const storey of model.storeys) {
    const opening = storey.openings.find((o) => o.id === openingId)
    if (opening) return { storey, opening }
  }
  return null
}

/**
 * 내력벽은 고치지 않는다(OE-OBJ-06) — 옮기기·지우기, 그 벽에 문·창을 새로 뚫거나 옮기거나 메우기. 잠그는 것은 `true` 뿐이다.
 * `null`(모름)은 내벽 규칙을 따른다 — 잠그면 내력 속성이 없는 파일(AC20 13장 전부)의 벽을 아무것도 못 고친다.
 * 푸는 길은 내력 여부를 고치는 것이다(BIM 값이 틀렸을 때 사람이 바로잡는 자리). 편집 파일을 되살릴 때는 잠금을 보지 않는다
 * (`ignoreLock`) — 그 편집은 사람이 풀어 둔 때에 한 것이고, 지운 벽의 내력 여부는 편집 파일에 남지 않는다.
 */
export function wallLocked(wall: Wall | null | undefined): boolean {
  return wall?.loadBearing === true
}
export const WALL_LOCKED = '내력벽은 고칠 수 없습니다. 내력 여부를 바꾸면 풀립니다.'
export const EXTERIOR_LOCKED = '외벽은 층 편집 화면에서 옮기거나 지우거나 크기를 바꾸지 않습니다. 외벽 형상은 외벽 에디터에서 고칩니다. 외벽 여부를 바꾸면 풀립니다.'
/**
 * 벽 형상(옮기기·지우기·길이·두께·높이)을 고칠 수 없는 이유. 내력벽(OE-OBJ-05)과 외벽(OE-EXT-02)이다. 외벽 형상은 전체 층을 한 번에
 * 다루는 외벽 에디터의 일이다(OE-EXT-03). 외벽에 문·창을 뚫고 외벽 전용 설비를 붙이는 것은 된다(OE-OBJ-04) — 그래서 문·창 잠금
 * (openingLocked)은 내력벽만 본다. 고칠 수 있으면 null.
 */
export function wallShapeLock(wall: Wall | null | undefined): string | null {
  if (wallLocked(wall)) return WALL_LOCKED
  if (wall?.external === true) return EXTERIOR_LOCKED
  return null
}
export type LockOptions = { ignoreLock?: boolean }

function openingLocked(storey: Storey, opening: Opening): boolean {
  return wallLocked(storey.walls.find((w) => w.id === opening.wallId))
}

/** 벽의 내력 여부. `null` 은 "모름" 이다 — false 와 섞지 않는다. */
export function setWallLoadBearing(model: Model, wallId: string, value: boolean | null): boolean {
  const found = findWall(model, wallId)
  if (!found || found.wall.loadBearing === value) return false
  found.wall.loadBearing = value
  return true
}

// --- 벽 관통 (OE-OBJ-05) ---------------------------------------------------------------
//
// 벽은 다른 벽을 가로지를 수 없다 — 로봇 지도에서 벽 둘이 X 로 겹치면 어느 쪽이 막힌 것인지 읽을 수 없다. 끝이 다른 벽에
// 닿는 것(L·T 자 맞닿음)은 정상이라 막지 않는다. 그래서 외곽선이 겹치는지가 아니라 **중심선이 서로의 몸통 안에서 만나는지**
// 를 본다. 맞닿은 끝은 상대 벽 두께의 절반 + WALL_JOIN 안에 들어온다.
// BIM 이 이미 가로지르게 그린 벽은 막지 않는다. 편집이 새로 만드는 관통만 막는다(이미 겹친 벽을 고치려고 옮기는 것은 된다).

/** 맞닿은 끝으로 봐 주는 여유(미터). 벽 끝이 상대 벽의 반 두께 + 이만큼 안이면 관통이 아니라 맞닿음이다. */
export const WALL_JOIN = 0.05

/** 벽의 중심선과 반 두께. 외곽선 전부를 가장 긴 변 방향과 그 수직으로 펴서 잰다. 외곽선이 없으면 null. */
export function wallAxis(rings: readonly (readonly Vec2[])[]): { a: Vec2; b: Vec2; half: number } | null {
  let u: Vec2 | null = null
  let best = 0
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const dx = ring[i + 1][0] - ring[i][0]
      const dy = ring[i + 1][1] - ring[i][1]
      const l = Math.hypot(dx, dy)
      if (l > best) [best, u] = [l, [dx / l, dy / l]]
    }
  }
  if (!u) return null
  const n: Vec2 = [-u[1], u[0]]
  let [u0, u1, n0, n1] = [Infinity, -Infinity, Infinity, -Infinity]
  for (const ring of rings) {
    for (const p of ring) {
      const pu = p[0] * u[0] + p[1] * u[1]
      const pn = p[0] * n[0] + p[1] * n[1]
      ;[u0, u1, n0, n1] = [Math.min(u0, pu), Math.max(u1, pu), Math.min(n0, pn), Math.max(n1, pn)]
    }
  }
  const mid = (n0 + n1) / 2
  return { a: [u[0] * u0 + n[0] * mid, u[1] * u0 + n[1] * mid], b: [u[0] * u1 + n[0] * mid, u[1] * u1 + n[1] * mid], half: (n1 - n0) / 2 }
}

type Axis = NonNullable<ReturnType<typeof wallAxis>>

/** 두 벽 중심선이 서로의 몸통 안에서 만나나. 끝이 상대 벽 안에 들어온 것(맞닿음)과 나란한 것은 아니다. */
function axesCross(p: Axis, q: Axis): boolean {
  const d1: Vec2 = [p.b[0] - p.a[0], p.b[1] - p.a[1]]
  const d2: Vec2 = [q.b[0] - q.a[0], q.b[1] - q.a[1]]
  const den = d1[0] * d2[1] - d1[1] * d2[0]
  const l1 = Math.hypot(...d1)
  const l2 = Math.hypot(...d2)
  if (Math.abs(den) < 1e-9 * l1 * l2) return false
  const w: Vec2 = [q.a[0] - p.a[0], q.a[1] - p.a[1]]
  const s = (w[0] * d2[1] - w[1] * d2[0]) / den
  const t = (w[0] * d1[1] - w[1] * d1[0]) / den
  const inP = Math.min(s, 1 - s) * l1 > q.half + WALL_JOIN
  const inQ = Math.min(t, 1 - t) * l2 > p.half + WALL_JOIN
  return inP && inQ
}

/**
 * 두 벽이 서로 관통하나. 조각(고리)마다 따로 본다 — 문·창으로 끊긴 벽을 한 중심선으로 펴면 꺾인 조각에서 선이 틀어져,
 * 성수에서 외곽선이 전혀 안 겹치는 벽 49쌍을 관통으로 셌다. 중심선이 몸통 안에서 만나도 **외곽선이 실제로 겹친 넓이가
 * 두 두께 곱의 절반을 넘어야** 관통이다(비스듬히 가로지르면 겹친 넓이는 두께 곱보다 크다).
 */
function piecesCross(a: readonly (readonly Vec2[])[], b: readonly (readonly Vec2[])[]): boolean {
  for (const ra of a) {
    const pa = wallAxis([ra])
    if (!pa) continue
    for (const rb of b) {
      const pb = wallAxis([rb])
      if (!pb || !axesCross(pa, pb)) continue
      if ((overlapArea(ra, rb) ?? 0) > 0.5 * (2 * pa.half) * (2 * pb.half)) return true
    }
  }
  return false
}

/** 이 외곽선의 벽이 층의 다른 벽 중 무엇을 가로지르나. `selfId` 는 빼고 센다. */
export function wallsCrossed(storey: Storey, rings: readonly (readonly Vec2[])[], selfId?: string): Wall[] {
  if (!rings.length) return []
  return storey.walls.filter((w) => w.id !== selfId && !!w.footprint?.length && piecesCross(rings, w.footprint))
}

/** 벽을 이 외곽선으로 바꾸면 새로 가로지르게 되는 벽. 없으면 null. 원래 가로지르던 벽은 세지 않는다. */
export function newCrossing(model: Model, wallId: string, rings: readonly (readonly Vec2[])[]): Wall | null {
  const found = findWall(model, wallId)
  if (!found) return null
  const before = new Set(wallsCrossed(found.storey, found.wall.footprint ?? [], wallId).map((w) => w.id))
  return wallsCrossed(found.storey, rings, wallId).find((w) => !before.has(w.id)) ?? null
}

/** 벽이 다른 벽을 가로지르게 된다는 알림. */
export function crossingMessage(other: Wall): string {
  const name = other.name || '다른 벽'
  return `${name}${josa(name, '을/를')} 가로지릅니다. 벽은 다른 벽을 관통할 수 없습니다(끝을 맞대는 것은 됩니다).`
}

const shiftRings = (rings: readonly (readonly Vec2[])[], d: Vec2) => rings.map((ring) => ring.map((p) => [p[0] + d[0], p[1] + d[1]] as Vec2))

/** 벽을 평면에서 옮긴다. 그 벽에 뚫린 문·창도 같이 간다. 다른 벽을 새로 가로지르게 되면 옮기지 않는다. */
export function moveWall(model: Model, wallId: string, delta: Vec2, opts: LockOptions = {}): boolean {
  const found = findWall(model, wallId)
  if (!found || !found.wall.footprint?.length || (delta[0] === 0 && delta[1] === 0)) return false
  if (!opts.ignoreLock && wallShapeLock(found.wall)) return false
  const next = shiftRings(found.wall.footprint, delta)
  if (newCrossing(model, wallId, next)) return false
  found.wall.footprint = next
  for (const o of found.storey.openings) {
    if (o.wallId !== wallId || !o.position) continue
    o.position = [o.position[0] + delta[0], o.position[1] + delta[1], o.position[2]]
    if (o.kind === 'door' && o.connectsSource === 'bim' && o.through) o.connectsSource = 'calc'
  }
  followWall(found.storey, wallId, delta)
  relinkDoors(found.storey)
  return true
}

/** 벽 외곽선을 통째로 둔다. 편집 파일을 불러올 때 끝 모양을 얹는다(문·창은 따로 적혀 있어 옮기지 않는다). */
export function setWallFootprint(model: Model, wallId: string, rings: readonly (readonly Vec2[])[]): boolean {
  const found = findWall(model, wallId)
  if (!found) return false
  found.wall.footprint = rings.map((r) => r.map((p) => [p[0], p[1]] as Vec2))
  return true
}

function forgetBoundary(storey: Storey, ids: Set<string>) {
  for (const space of storey.spaces) {
    if (space.boundedBy.some((id) => ids.has(id))) space.boundedBy = space.boundedBy.filter((id) => !ids.has(id))
  }
}

/** 벽을 지운다. 그 벽에 뚫린 문·창도 같이 지우고, 물리존의 공간 경계 목록에서도 뺀다. */
export function deleteWall(model: Model, wallId: string, opts: LockOptions = {}): { openings: number } | null {
  const found = findWall(model, wallId)
  if (!found || (!opts.ignoreLock && wallShapeLock(found.wall))) return null
  const { storey } = found
  const gone = new Set([wallId, ...storey.openings.filter((o) => o.wallId === wallId).map((o) => o.id)])
  storey.walls = storey.walls.filter((w) => w.id !== wallId)
  storey.openings = storey.openings.filter((o) => !gone.has(o.id))
  // 벽 면에 붙인 설비는 자리에 남고 벽에서만 떨어진다.
  for (const e of storey.equipment) if (e.wallId === wallId) delete e.wallId
  forgetBoundary(storey, gone)
  return { openings: gone.size - 1 }
}

/** 기본 벽 두께(미터). 사람이 두께를 정하지 않고 그은 벽이다. */
export const NEW_WALL_THICKNESS = 0.2

/**
 * 사이트 기본 내벽 두께(미터, OE-SPC-12 "내벽 150 / 외벽 300mm"). 사이트 설정의 처음 값이고, 사람이 바꾸거나 비울 수 있다.
 * 층 편집에서 새로 긋는 벽은 내벽이라 이 값만 쓴다. 외벽 300mm 는 쓰는 곳(OE-IDF-10, R2)이 생길 때 같이 둔다.
 */
export const SITE_INTERIOR_WALL = 0.15

/**
 * 새로 긋는 벽의 두께와 그 근거(OE-SPC-12). 1) 같은 층 BIM 내벽 두께의 최빈값 → 2) 사이트 기본값 → 3) 0.2m 순이다.
 *
 * - BIM 내벽은 에디터가 더하지 않았고(`added` 없음) 외벽이 아니며(`external` 이 true 가 아님) 두께를 아는 벽이다. 외벽은 단열층까지
 *   들어 내벽보다 두꺼워서 섞으면 칸막이가 외벽 두께로 그어진다.
 * - 8cm 보다 얇은 벽은 세지 않는다. 다른 벽에 덧댄 마감벽(Revit "Furring 38mm Stud", 0.05m)과 화장실 칸막이(0.03m)다. 병원 1층은
 *   마감벽 292개가 칸막이 288개(0.12m)보다 많아서, 세면 새 칸막이가 0.05m 로 그어졌다.
 * - 최빈값은 cm 로 반올림해 센다(BIM 두께에 0.2399 같은 끝수가 흔하다). 같은 수면 두꺼운 쪽이다.
 */
export const LINING_MAX = 0.08
export function newWallThickness(storey: Storey, siteDefault?: number | null): { thickness: number; from: 'bim' | 'site' | 'default' } {
  const counts = new Map<number, number>()
  for (const w of storey.walls) {
    if (w.added || w.external === true || !(w.thickness && w.thickness >= LINING_MAX)) continue
    const t = Math.round(w.thickness * 100) / 100
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  let best: [number, number] | null = null
  for (const [t, n] of counts) if (!best || n > best[1] || (n === best[1] && t > best[0])) best = [t, n]
  if (best) return { thickness: best[0], from: 'bim' }
  if (siteDefault && siteDefault > 0) return { thickness: siteDefault, from: 'site' }
  return { thickness: NEW_WALL_THICKNESS, from: 'default' }
}

/**
 * 두 점을 잇는 벽을 긋는다. 외곽선은 그 선을 가운데로 두께만큼 편 직사각형이다. 내력 여부는 모른다. 다른 벽을 가로지르면
 * 긋지 않고 이유를 돌려준다(OE-OBJ-05).
 */
export function addWall(
  model: Model,
  storeyId: string,
  a: Vec2,
  b: Vec2,
  thickness = NEW_WALL_THICKNESS,
  id?: string,
): Wall | { refused: string } | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!storey || len < 0.05 || !(thickness > 0)) return null
  const wallId = id ?? newId()
  if (findWall(model, wallId)) return null
  const nx = (-(b[1] - a[1]) / len) * (thickness / 2)
  const ny = ((b[0] - a[0]) / len) * (thickness / 2)
  const ring: Vec2[] = [
    [a[0] + nx, a[1] + ny],
    [a[0] - nx, a[1] - ny],
    [b[0] - nx, b[1] - ny],
    [b[0] + nx, b[1] + ny],
    [a[0] + nx, a[1] + ny],
  ]
  const crossed = wallsCrossed(storey, [ring])[0]
  if (crossed) return { refused: crossingMessage(crossed) }
  const wall: Wall = { id: wallId, name: '새 벽', thickness, loadBearing: null, footprint: [ring], added: true }
  storey.walls.push(wall)
  return wall
}

/**
 * 벽 길이를 바꿀 수 있나. 외곽선이 꼭짓점 넷인 고리 하나이고, 긴 두 변이 중심선과 나란히 양쪽 면에 있는 벽만이다 — 직사각형과
 * 모서리를 비스듬히 맞댄 사다리꼴(AC20 외벽 8장 전부, OE-OBJ-04)이다. 문·창으로 조각난 벽, 꺾인 벽은 아니다.
 */
export function wallLength(wall: Wall): number | null {
  const ring = wall.footprint?.length === 1 ? openRing(wall.footprint[0]) : null
  if (!ring || ring.length !== 4) return null
  const axis = wallAxis([ring])
  if (!axis || axis.half <= 0) return null
  const len = Math.hypot(axis.b[0] - axis.a[0], axis.b[1] - axis.a[1])
  const u: Vec2 = [(axis.b[0] - axis.a[0]) / len, (axis.b[1] - axis.a[1]) / len]
  // 네 꼭짓점이 전부 한쪽 면(중심선 ± 반 두께) 위에 있고, 면마다 둘씩이다. 그러면 두 면이 나란하고 끝 변 둘이 면을 잇는다.
  const side = ring.map((p) => ((p[0] - axis.a[0]) * -u[1] + (p[1] - axis.a[1]) * u[0]) / axis.half)
  if (!side.every((k) => Math.abs(Math.abs(k) - 1) < 1e-3)) return null
  if (side.filter((k) => k > 0).length !== 2) return null
  // 같은 면의 두 점은 서로 이웃해야 한다(나비 모양이 아니다).
  for (let i = 0; i < 4; i++) if (Math.sign(side[i]) === Math.sign(side[(i + 2) % 4])) return null
  return len
}

/**
 * 벽 길이를 바꾼다(OE-OBJ-05 의 크기 조절). 가운데를 두고 양 끝을 같이 늘이거나 줄인다. 꼭짓점 넷인 벽만 되고(wallLength), 내력벽은
 * 잠겨 있다. 뚫린 문·창이 벽 밖으로 나가거나 다른 벽을 새로 가로지르게 되면 이유를 돌려준다.
 */
export function setWallLength(model: Model, wallId: string, length: number): boolean | { refused: string } {
  const found = findWall(model, wallId)
  if (!found || !(length >= 0.05)) return false
  const { wall, storey } = found
  const locked = wallShapeLock(wall)
  if (locked) return { refused: locked }
  const now = wallLength(wall)
  if (now === null) return { refused: '꼭짓점 넷인 벽만 길이를 바꿉니다(문·창으로 조각났거나 꺾인 벽은 옮기기만 됩니다).' }
  if (Math.abs(now - length) < 1e-9) return false
  const axis = wallAxis(wall.footprint!)!
  const u: Vec2 = [(axis.b[0] - axis.a[0]) / now, (axis.b[1] - axis.a[1]) / now]
  const grow = (length - now) / 2
  const ring = openRing(wall.footprint![0]).map((p) => {
    const t = (p[0] - axis.a[0]) * u[0] + (p[1] - axis.a[1]) * u[1]
    const k = t < now / 2 ? -grow : grow
    return [p[0] + u[0] * k, p[1] + u[1] * k] as Vec2
  })
  const next = [withClosing(ring, true)]
  const cut = storey.openings.find((o) => {
    if (o.wallId !== wallId || !o.position) return false
    const t = (o.position[0] - axis.a[0]) * u[0] + (o.position[1] - axis.a[1]) * u[1]
    return t < -grow || t > now + grow
  })
  if (cut) return { refused: `${cut.name || (cut.kind === 'door' ? '문' : '창')}${josa(cut.name || '창', '이/가')} 벽 밖으로 나갑니다. 먼저 옮기거나 지우세요.` }
  const crossed = newCrossing(model, wallId, next)
  if (crossed) return { refused: crossingMessage(crossed) }
  wall.footprint = next
  followWall(storey, wallId)
  return true
}

// --- 외벽(OE-OBJ-04) ----------------------------------------------------------------------
//
// 외벽 여부·두께·높이를 고치고, 설비를 벽 면에 붙인다. 외벽 판정은 exterior.ts 가 쓸 때마다 하므로 여기서는 값만 고친다.

/**
 * 외벽 여부를 사람이 정한다. 계산이 틀린 벽(병원 커튼월 안쪽 칸막이 등)을 바로잡는 자리다. `null` 은 "모름" 으로 정한 것이다.
 * 정한 값은 출처가 "편집" 이 되고 계산이 덮지 않는다.
 */
export function setWallExternal(model: Model, wallId: string, value: boolean | null): boolean {
  const found = findWall(model, wallId)
  if (!found) return false
  const { wall } = found
  if (wall.externalEdited && (wall.external ?? null) === value) return false
  wall.external = value
  wall.externalEdited = true
  return true
}

/**
 * 벽 두께를 바꾼다(크기 y). 중심선을 두고 양쪽으로 같이 편다. 꼭짓점 넷인 벽만 되고(길이와 같다) 내력벽은 잠겨 있다. 뚫린 문·창의
 * 깊이도 따라가고, 벽 면에 붙인 설비는 새 면으로 다시 붙는다. 다른 벽을 새로 가로지르게 되면 이유를 돌려준다.
 */
export function setWallThickness(model: Model, wallId: string, thickness: number): boolean | { refused: string } {
  const found = findWall(model, wallId)
  if (!found || !(thickness >= 0.01)) return false
  const { wall, storey } = found
  const locked = wallShapeLock(wall)
  if (locked) return { refused: locked }
  const len = wallLength(wall)
  if (len === null) return { refused: '꼭짓점 넷인 벽만 두께를 바꿉니다(문·창으로 조각났거나 꺾인 벽은 옮기기만 됩니다).' }
  const axis = wallAxis(wall.footprint!)!
  if (Math.abs(axis.half * 2 - thickness) < 1e-9 && wall.thickness === thickness) return false
  // 중심선에서 수직 거리를 비율로 늘인다. 비스듬히 맞댄 끝도 꼭짓점의 길이 방향 자리를 두어 모양이 남는다.
  const u: Vec2 = [(axis.b[0] - axis.a[0]) / len, (axis.b[1] - axis.a[1]) / len]
  const n: Vec2 = [-u[1], u[0]]
  const k = thickness / (axis.half * 2)
  const ring = withClosing(
    openRing(wall.footprint![0]).map((p) => {
      const d = (p[0] - axis.a[0]) * n[0] + (p[1] - axis.a[1]) * n[1]
      return [p[0] + n[0] * d * (k - 1), p[1] + n[1] * d * (k - 1)] as Vec2
    }),
    true,
  )
  const crossed = newCrossing(model, wallId, [ring])
  if (crossed) return { refused: crossingMessage(crossed) }
  wall.footprint = [ring]
  wall.thickness = thickness
  for (const o of storey.openings) if (o.wallId === wallId) o.depth = thickness
  followWall(storey, wallId)
  relinkDoors(storey)
  return true
}

/** 벽 높이(크기 z, 미터). `null` 은 모름이다. 평면이 안 바뀌므로 소속·문은 그대로다. 내력벽은 잠겨 있다. */
export function setWallHeight(model: Model, wallId: string, height: number | null): boolean | { refused: string } {
  const found = findWall(model, wallId)
  if (!found || (height !== null && !(height > 0))) return false
  const locked = wallShapeLock(found.wall)
  if (locked) return { refused: locked }
  if ((found.wall.height ?? null) === height) return false
  found.wall.height = height
  return true
}

/** 벽 면에 붙일 수 있는 거리(미터). 문·창과 같다 — 벽 외곽선에서 이만큼 안을 눌러야 그 벽에 붙는다. */
export const MOUNT_SNAP = 0.6

/** 벽 외곽선 테두리에서 at 에 가장 가까운 점. 벽 면 위의 자리다. */
function nearestOnWall(wall: Wall, at: Vec2): { point: Vec2; distance: number } | null {
  let best: { point: Vec2; distance: number } | null = null
  for (const ring of wall.footprint ?? []) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i]
      const b = ring[i + 1]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const l2 = dx * dx + dy * dy
      if (l2 < 1e-12) continue
      const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / l2))
      const point: Vec2 = [a[0] + t * dx, a[1] + t * dy]
      const distance = Math.hypot(at[0] - point[0], at[1] - point[1])
      if (!best || distance < best.distance) best = { point, distance }
    }
  }
  return best
}

/**
 * 설비를 벽 면에 붙인다(OE-OBJ-04 외벽 전용 설비). 누른 자리에서 가장 가까운 벽(MOUNT_SNAP 안)의 **누른 쪽 면** 위에 놓는다 —
 * 바깥 면을 누르면 건물 밖이라 방 소속이 없고(층으로 나간다), 안쪽 면을 누르면 그 방에 속한다. 보통 설비는 외벽·내벽을 가리지
 * 않는다. **외벽 전용 설비(외기 센서, kinds.ts 의 `mount`)는 외벽의 바깥 면에만** 붙인다(2026-10-03 사용자 결정). 높이는 설비의
 * 지금 높이를 두고, 좌표가 없던 설비는 층 바닥이다.
 * 소속은 이 안에서 다시 판정한다.
 */
export function mountOnWall(model: Model, equipmentId: string, at: Vec2): { wall: Wall; change: Change } | { refused: string } | null {
  const equipment = findEquipment(model, equipmentId)
  if (!equipment) return null
  const storey = model.storeys.find((s) => s.equipment.includes(equipment))!
  // 허용 설치면에 벽이 없는 종류는 붙이지 않는다(OE-OBJ-10, 설치면 표는 mount.ts). 표에 없는 종류는 막지 않는다.
  if (!canMountOn(equipment, 'wall')) return { refused: notOnWall(equipment) }
  // 외벽 전용 설비(외기 센서)는 외벽에만, 그 바깥 면에만 붙인다(2026-10-03 사용자 결정).
  const exterior = exteriorOnly(equipment)
  const external = exterior ? judgeExternal(storey) : null
  let best: { wall: Wall; point: Vec2; distance: number } | null = null
  for (const wall of storey.walls) {
    if (external && external.get(wall.id)?.external !== true) continue
    const near = nearestOnWall(wall, at)
    if (near && (!best || near.distance < best.distance)) best = { wall, ...near }
  }
  if (!best || best.distance > MOUNT_SNAP) {
    if (exterior) return { refused: `${EXTERIOR_ONLY} 외벽에서 ${MOUNT_SNAP}m 안의 바깥쪽을 누르세요.` }
    return { refused: storey.walls.some((w) => w.footprint?.length) ? `벽에서 ${MOUNT_SNAP}m 안을 누르세요.` : '이 층에 외곽선이 있는 벽이 없습니다.' }
  }
  if (exterior && locate(best.point, storey.spaces) !== null) return { refused: `${EXTERIOR_ONLY} 외벽의 바깥쪽(방이 없는 쪽)을 누르세요.` }
  const z = equipment.position ? equipment.position[2] : storey.elevation
  const change = moveEquipment(model, equipmentId, [best.point[0], best.point[1], z])
  if (!change) return null
  equipment.wallId = best.wall.id
  return { wall: best.wall, change }
}

/** 벽에 붙일 수 없는 설비를 붙이려 할 때의 이유. 허용 설치면을 같이 보인다. */
export function notOnWall(equipment: Pick<Equipment, 'kind'>): string {
  const allowed = allowedSurfaces(equipment.kind) ?? []
  return `벽에 설치할 수 없는 설비입니다(설치면 ${allowed.map((x) => SURFACE_LABEL[x]).join('·')}).`
}

/** 외벽 바깥 면에만 놓는 종류인가(kinds.ts 의 `mount`). 외기 온도·습도 센서. */
export function exteriorOnly(equipment: Pick<Equipment, 'kind'>): boolean {
  return equipmentKind(equipment.kind)?.mount === 'exterior'
}
export const EXTERIOR_ONLY = '외기 센서는 외벽 바깥 면에만 놓습니다.'

/**
 * 이 자리가 외벽 바깥 면인가 — 어느 방에도 들지 않고, 외벽(판정: exterior.ts)에서 벽 붙이기 거리(MOUNT_SNAP) 안이다. 외벽 전용 설비를
 * 옮길 때 가는 자리가 이것이어야 한다. BIM 이 놓은 센서는 벽에 붙였다는 표시(`wallId`)가 없어서 표시가 아니라 자리로 잰다.
 */
export function onExteriorFace(storey: Storey, at: Vec2): boolean {
  if (locate(at, storey.spaces) !== null) return false
  const external = judgeExternal(storey)
  return storey.walls.some((w) => external.get(w.id)?.external === true && (nearestOnWall(w, at)?.distance ?? Infinity) <= MOUNT_SNAP)
}

/**
 * 벽이 바뀐 뒤 그 벽 면에 붙은 설비를 따라 보낸다. `delta` 가 있으면(벽 옮기기) 그만큼 같이 옮기고, 없으면(길이·두께) 새 면의
 * 가장 가까운 자리로 다시 붙인다. 소속은 다시 판정한다 — 재판정을 호출부에 맡기지 않는다.
 */
function followWall(storey: Storey, wallId: string, delta?: Vec2) {
  const wall = storey.walls.find((w) => w.id === wallId)
  for (const e of storey.equipment) {
    if (e.wallId !== wallId || !e.position) continue
    let to: Vec2 = delta ? [e.position[0] + delta[0], e.position[1] + delta[1]] : [e.position[0], e.position[1]]
    if (!delta && wall) to = nearestOnWall(wall, to)?.point ?? to
    e.position = [to[0], to[1], e.position[2]]
    e.positionSource = 'edited'
    if (e.spaceSource === 'bim') e.spaceSource = null
    dropSpaceSet(e)
    assignEquipment(e, storey.spaces)
  }
}

/** 문·창이 벽을 따라 옮길 수 없는 쪽으로 가려 할 때의 이유. */
export const OPENING_ALONG_WALL = '문·창은 뚫린 벽을 따라서만 옮깁니다. 다른 벽에 두려면 지우고 그 벽에 새로 놓으세요.'

/**
 * 문·창을 옮긴다(평면). 높이는 그대로다. 문이면 잇는 방을 좌표로 다시 짚는다.
 *
 * 문·창은 벽에만 있다(OE-OBJ-07). 그래서 **뚫린 벽을 따라서만** 옮긴다 — 직사각형 벽이면 가려는 자리를 벽 중심선에 내려 그 길이
 * 방향만 따르고(벽과의 옆 간격은 그대로), 가로가 벽 끝을 넘지 않게 멈춘다. 꺾인 벽처럼 중심선이 없는 벽은 그 벽 외곽선 안(5cm 여유)일
 * 때만 옮긴다. 뚫린 벽을 모르는 문·창(BIM 이 관계를 안 적은 것)은 어느 벽에서든 OPENING_SNAP 안이어야 한다. 예전에는 아무 데나
 * 옮겨져 문이 벽 밖에 떠 있었다(2026-10-07 검토). 편집 파일을 되살릴 때(ignoreLock)는 적힌 자리 그대로 둔다.
 */
export function moveOpening(model: Model, openingId: string, to: Vec2, opts: LockOptions & { snap?: number } = {}): boolean | { refused: string } {
  const found = findOpening(model, openingId)
  const o = found?.opening
  if (!found || !o || !o.position) return false
  if (!opts.ignoreLock && openingLocked(found.storey, o)) return false
  if (!opts.ignoreLock) {
    const placed = alongWall(found.storey, o, to, opts.snap ?? OPENING_SNAP)
    if ('refused' in placed) return placed
    to = placed.at
  }
  if (Math.abs(o.position[0] - to[0]) < 1e-9 && Math.abs(o.position[1] - to[1]) < 1e-9) return false
  o.position = [to[0], to[1], o.position[2]]
  if (o.kind === 'door' && o.through) o.connectsSource = 'calc'
  relinkDoors(found.storey)
  return true
}

/** 문·창이 갈 수 있는 자리. moveOpening 의 규칙(뚫린 벽을 따라서만)을 적용한 끝 자리나, 갈 수 없는 이유. */
function alongWall(storey: Storey, o: Opening, to: Vec2, snap = OPENING_SNAP): { at: Vec2 } | { refused: string } {
  const from: Vec2 = [o.position![0], o.position![1]]
  const wall = storey.walls.find((w) => w.id === o.wallId && w.footprint?.length)
  if (!wall) {
    const near = nearestWall(storey, to)
    return near && near.distance <= snap ? { at: to } : { refused: nearWallMessage(snap) }
  }
  const len = wallLength(wall)
  if (len === null) {
    const inside = wall.footprint!.some((r) => pointInRing(to, r)) || (nearestOnWall(wall, to)?.distance ?? Infinity) <= 0.05
    return inside ? { at: to } : { refused: OPENING_ALONG_WALL }
  }
  const axis = wallAxis(wall.footprint!)!
  const u: Vec2 = [(axis.b[0] - axis.a[0]) / len, (axis.b[1] - axis.a[1]) / len]
  const along = (p: Vec2) => (p[0] - axis.a[0]) * u[0] + (p[1] - axis.a[1]) * u[1]
  const half = Math.min((o.width ?? 0) / 2, len / 2)
  const want = along(to)
  const t = Math.max(half, Math.min(len - half, want))
  const shift = t - along(from)
  if (Math.abs(shift) < 1e-9) {
    return { refused: Math.abs(want - t) > 1e-9 ? `벽 끝입니다. 문·창은 벽(${len.toFixed(2)}m) 밖으로 나가지 않습니다.` : OPENING_ALONG_WALL }
  }
  return { at: [Math.round((from[0] + u[0] * shift) * 1e6) / 1e6, Math.round((from[1] + u[1] * shift) * 1e6) / 1e6] }
}

/** 문·창을 지운다. 물리존의 공간 경계 목록에서도 뺀다. */
export function deleteOpening(model: Model, openingId: string, opts: LockOptions = {}): boolean {
  const found = findOpening(model, openingId)
  if (!found || (!opts.ignoreLock && openingLocked(found.storey, found.opening))) return false
  found.storey.openings = found.storey.openings.filter((o) => o.id !== openingId)
  forgetBoundary(found.storey, new Set([openingId]))
  return true
}

/** 문·창 크기로 받는 범위(미터). 이 밖은 오타로 본다. */
export const OPENING_SIZE = { min: 0.1, max: 10 } as const

/**
 * 문·창 가로·세로를 바꾼다(OE-OBJ-07). 자리(가운데)는 그대로다. 값이 없는 쪽은 건드리지 않는다. 직사각형 벽에 뚫린 것이면 넓힌
 * 가로가 벽 끝을 넘지 않아야 한다. 내력벽에 뚫린 것은 잠겨 있다(OE-OBJ-06).
 */
export function setOpeningSize(
  model: Model,
  openingId: string,
  size: { width?: number; height?: number },
  opts: LockOptions = {},
): boolean | { refused: string } {
  const found = findOpening(model, openingId)
  if (!found) return false
  const { storey, opening: o } = found
  if (!opts.ignoreLock && openingLocked(storey, o)) return { refused: WALL_LOCKED }
  const bad = [size.width, size.height].some((v) => v !== undefined && !(v >= OPENING_SIZE.min && v <= OPENING_SIZE.max))
  if (bad) return { refused: `문·창 크기는 ${OPENING_SIZE.min}m ~ ${OPENING_SIZE.max}m 로 넣습니다.` }
  const width = size.width ?? o.width
  const height = size.height ?? o.height
  if (width === o.width && height === o.height) return false
  const wall = storey.walls.find((w) => w.id === o.wallId)
  const len = wall && wallLength(wall)
  if (!opts.ignoreLock && wall && len != null && width != null && o.position) {
    const axis = wallAxis(wall.footprint!)!
    const u: Vec2 = [(axis.b[0] - axis.a[0]) / len, (axis.b[1] - axis.a[1]) / len]
    const t = (o.position[0] - axis.a[0]) * u[0] + (o.position[1] - axis.a[1]) * u[1]
    if (t - width / 2 < -1e-6 || t + width / 2 > len + 1e-6) return { refused: `가로 ${width.toFixed(2)}m 는 벽 끝을 넘습니다(벽 ${len.toFixed(2)}m).` }
  }
  o.width = width
  o.height = height
  return true
}

/** 문·창을 벽에 붙일 수 있는 거리(미터). 벽 외곽선에서 이만큼 안이어야 그 벽의 문·창이다. */
export const OPENING_SNAP = 0.6
/** 문·창 스냅 거리로 받는 범위(미터). 0 이면 벽 안을 눌러야만 붙고, 너무 크면 엉뚱한 벽에 붙는다. */
export const OPENING_SNAP_RANGE = { min: 0.1, max: 3 } as const
const nearWallMessage = (snap: number) => `벽 가까이 놓아 주세요(벽에서 ${snap}m 안에만 놓습니다).`

/**
 * 가장 가까운 벽과, 그 벽의 가장 가까운 변에 수직인 방향. 문이 벽을 뚫는 방향이다.
 */
export function nearestWall(storey: Storey, at: Vec2): { wall: Wall; distance: number; through: Vec2 } | null {
  // 벽 안에 찍은 점은 거리가 0 이지만, 뚫는 방향은 그래도 가장 가까운 변에서 잰다(짧은 마구리 변이 먼저 잡히면 방향이 90° 돈다).
  let best: { wall: Wall; distance: number; through: Vec2; edge: number } | null = null
  for (const wall of storey.walls) {
    for (const ring of wall.footprint ?? []) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]
        const b = ring[i + 1]
        const dx = b[0] - a[0]
        const dy = b[1] - a[1]
        const l2 = dx * dx + dy * dy
        if (l2 < 1e-12) continue
        const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / l2))
        const d = Math.hypot(at[0] - (a[0] + t * dx), at[1] - (a[1] + t * dy))
        const distance = pointInRing(at, ring) ? 0 : d
        if (!best || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) <= 1e-9 && d < best.edge)) {
          const len = Math.sqrt(l2)
          best = { wall, distance, through: [-dy / len, dx / len], edge: d }
        }
      }
    }
  }
  return best && { wall: best.wall, distance: best.distance, through: best.through }
}

/**
 * 문·창을 벽에 놓는다. 가장 가까운 벽(OPENING_SNAP 안)에 붙이고, 뚫는 방향은 그 벽의 변에 수직, 두께는 벽 두께다.
 * 벽 없이 떠 있는 문은 만들지 않는다 — 어느 방을 잇는지 짚을 방향이 없다.
 */
export function addOpening(
  model: Model,
  storeyId: string,
  kind: 'door' | 'window',
  at: Vec2,
  id?: string,
  /** 벽에서 이만큼 안을 눌러야 붙는다(OE-SPC-13, 사람이 고칠 수 있다). */
  snap = OPENING_SNAP,
): Opening | { refused: string } | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  const near = nearestWall(storey, at)
  if (!near || near.distance > snap) {
    return { refused: storey.walls.some((w) => w.footprint?.length) ? nearWallMessage(snap) : '이 층에 외곽선이 있는 벽이 없습니다. 벽을 읽거나 먼저 벽을 그으세요.' }
  }
  if (wallLocked(near.wall)) return { refused: `${near.wall.name || '벽'}${josa(near.wall.name || '벽', '은/는')} 내력벽이라 문·창을 뚫지 않습니다. 내력 여부를 바꾸면 풀립니다.` }
  const openingId = id ?? newId()
  if (findOpening(model, openingId)) return null
  const opening: Opening = {
    id: openingId,
    kind,
    name: kind === 'door' ? '새 문' : '새 창',
    width: null,
    height: null,
    wallId: near.wall.id,
    passable: kind === 'door',
    position: [at[0], at[1], storey.elevation],
    through: near.through,
    depth: near.wall.thickness ?? NEW_WALL_THICKNESS,
    ...(kind === 'door' ? { connects: [], connectsSource: 'calc' as const } : {}),
    added: true,
  }
  storey.openings.push(opening)
  relinkDoors(storey)
  return opening
}

/** 한 층의 벽·문·창과 공간 경계 목록을 떠 둔다. E4 편집 전에 뜨면 되돌릴 수 있다. */
export function snapshotStoreyElements(model: Model, storeyId: string): Snapshot | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  return {
    kind: 'storey-elements',
    storeyId,
    walls: [...storey.walls],
    wallFields: storey.walls.map((wall) => ({
      wall,
      footprint: wall.footprint?.map((r) => r.map((p) => [p[0], p[1]] as Vec2)),
      loadBearing: wall.loadBearing,
      thickness: wall.thickness,
      height: wall.height,
      external: wall.external,
      externalEdited: wall.externalEdited,
    })),
    mounted: storey.equipment
      .filter((e) => e.wallId)
      .map((e) => ({
        equipment: e,
        position: e.position ? ([e.position[0], e.position[1], e.position[2]] as Vec3) : null,
        positionSource: e.positionSource,
        wallId: e.wallId,
        spaceId: e.spaceId,
        spaceSource: e.spaceSource,
      })),
    openings: [...storey.openings],
    openingFields: storey.openings.map((opening) => ({
      opening,
      position: opening.position ? [opening.position[0], opening.position[1], opening.position[2]] : opening.position,
      connects: opening.connects ? [...opening.connects] : undefined,
      connectsSource: opening.connectsSource,
      // 크기(OE-OBJ-07)는 제자리에서 고친다. 떠 두지 않으면 되돌려도 고친 크기가 남는다(성수 퍼징이 잡았다).
      width: opening.width,
      height: opening.height,
    })),
    boundedBy: storey.spaces.map((space) => ({ space, boundedBy: [...space.boundedBy] })),
  }
}

/** 벽을 그대로 넣는다. 편집 파일을 불러올 때 쓴다(모양은 편집 파일이 적은 끝 모양이다). */
export function insertWall(model: Model, storeyId: string, wall: Wall): boolean {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey || findWall(model, wall.id)) return false
  storey.walls.push(wall)
  return true
}

/** 문·창을 그대로 넣고 잇는 방을 짚는다. 편집 파일을 불러올 때 쓴다. */
export function insertOpening(model: Model, storeyId: string, opening: Opening): boolean {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey || findOpening(model, opening.id)) return false
  storey.openings.push(opening)
  relinkDoors(storey)
  return true
}

// --- 계통 편집 (E8) ------------------------------------------------------------------
//
// 연결 잇기·끊기에 더해 설비가 어느 계통에 드는지와 계통이 무엇인지(종류·유체)를 고친다. 둘 다 규칙 방향의 재료라
// (계통 종류가 매체와 방향을, 구성원이 그 계통이 정할 연결을 정한다) 고치면 규칙을 다시 돌린다 — 종류를 바꿀 때와 같다.
// TTL 에서는 계통의 `brick:hasPart` 와 계통 클래스가 바뀐다. 사람이 확정한 계통은 규칙이 얼려 두므로 이미 확정한 방향은
// 그대로다.

function findSystem(model: Model, systemId: string): System | null {
  return model.systems.find((s) => s.id === systemId) ?? null
}

/**
 * 설비를 다른 계통으로 옮긴다. `null` 이면 계통에서 뺀다. 설비의 계통(`systemId`)에서 빼고 새 계통에 넣는다 — 한 설비가
 * 여러 계통에 든 경우(공조기가 공기·물 둘 다) 나머지 계통 자리는 두고 이 한 자리만 바꾼다.
 */
export function setEquipmentSystem(model: Model, equipmentId: string, systemId: string | null): RuleReport | null {
  const equipment = findEquipment(model, equipmentId)
  if (!equipment) return null
  const to = systemId === null ? null : findSystem(model, systemId)
  if (systemId !== null && !to) return null
  const from = equipment.systemId
  if (from === systemId) return null
  const was = from === null ? null : findSystem(model, from)
  if (was) was.memberIds = was.memberIds.filter((m) => m !== equipmentId)
  if (to && !to.memberIds.includes(equipmentId)) to.memberIds.push(equipmentId)
  if (!equipment.systemEdited) equipment.systemEdited = { from }
  equipment.systemId = systemId
  if (equipment.systemEdited.from === systemId) delete equipment.systemEdited
  return inferFlowByRules(model)
}

/**
 * 계통의 종류와 유체를 정한다. `kind` 가 null 이면 "모름" 이다. 유체는 순환수에만 있다 — 다른 종류면 버린다.
 * 사전·BIM 이 읽은 값으로 되돌리면 편집 표시를 지운다.
 */
export function setSystemKind(model: Model, systemId: string, kind: string | null, fluid: Fluid | null = null): RuleReport | null {
  const system = findSystem(model, systemId)
  if (!system) return null
  if (kind !== null && !systemKind(kind)) return null
  const nextFluid = kind !== null && FLUID_KINDS.includes(kind) ? fluid : null
  if ((system.kind ?? null) === kind && (system.fluid ?? null) === nextFluid) return null
  if (!system.kindEdited) system.kindEdited = { kind: system.kind ?? null, fluid: system.fluid ?? null }
  system.kind = kind
  system.fluid = nextFluid
  if (system.kindEdited.kind === kind && system.kindEdited.fluid === nextFluid) delete system.kindEdited
  return inferFlowByRules(model)
}

/**
 * 계통 편집 전의 상태. 옮기는 설비와 두 계통(예전·새)을 뜬다. 구성원 순서까지 되돌아온다. `withList` 면 계통 목록도 떠서
 * 만들고 지운 계통이 제자리(색도 목록 순서로 정한다)로 돌아온다.
 */
export function snapshotSystems(
  model: Model,
  systemIds: readonly (string | null)[],
  equipmentIds: readonly string[] = [],
  withList = false,
): Snapshot {
  const systems = [...new Set(systemIds)].flatMap((id) => {
    const system = id === null ? null : findSystem(model, id)
    return system
      ? [
          {
            system,
            memberIds: [...system.memberIds],
            kind: system.kind,
            kindSource: system.kindSource,
            fluid: system.fluid,
            fluidSource: system.fluidSource,
            kindEdited: system.kindEdited ? { ...system.kindEdited } : undefined,
            name: system.name,
          },
        ]
      : []
  })
  const equipment = equipmentIds.flatMap((id) => {
    const e = findEquipment(model, id)
    return e ? [{ equipment: e, systemId: e.systemId, systemEdited: e.systemEdited ? { ...e.systemEdited } : undefined }] : []
  })
  return { kind: 'systems', ...(withList ? { list: [...model.systems] } : {}), systems, equipment }
}

export type NewSystem = { name: string; kind: string | null; fluid?: Fluid | null; id?: string }

/** 계통을 만든다. 구성원은 없다 — 설비를 넣는 것은 setEquipmentSystem 이다. 같은 id 가 있거나 종류를 모르면 null. */
export function createSystem(model: Model, spec: NewSystem): System | null {
  if (spec.kind !== null && !systemKind(spec.kind)) return null
  const id = spec.id ?? newId()
  if (findSystem(model, id)) return null
  const hydronic = spec.kind !== null && FLUID_KINDS.includes(spec.kind)
  const system: System = {
    id,
    name: spec.name,
    memberIds: [],
    source: 'edit',
    added: true,
    kind: spec.kind,
    ...(hydronic ? { fluid: spec.fluid ?? null } : {}),
    // 사람이 만든 계통의 종류·유체는 사람이 정한 것이다. 원천 기기 짐작(inferFluids)이 덮지 않게 편집으로 둔다 — 안 그러면
    // 편집 파일에서 되살릴 때 사람이 고른 유체가 짐작으로 바뀌었다(퍼징이 잡았다).
    ...(spec.kind !== null ? { kindEdited: { kind: null, fluid: null } } : {}),
  }
  model.systems.push(system)
  return system
}

/**
 * 계통 이름을 바꾼다(OE-PIP-09 "이름 자유"). **BIM 이 준 계통도 바꾼다**(2026-10-03 사용자 결정). 앞뒤 공백은 떼고, 비었거나 같은
 * 이름이면 바꾸지 않는다. 이름이 같은 다른 계통이 있어도 막지 않는다 — id 가 달라 온톨로지에서는 다른 계통이다. 다만 다음 판본과
 * 합칠 때(merge.ts 는 이름이 같은 계통을 하나로 본다) 바꾼 이름으로 맞춰지니, 이름을 바꾼 편집은 합친 뒤에 다시 얹힌다(append).
 */
export function renameSystem(model: Model, systemId: string, name: string): boolean {
  const system = findSystem(model, systemId)
  const next = name.trim()
  if (!system || !next || next === system.name) return false
  system.name = next
  return true
}

/**
 * 계통을 지운다. 구성원은 이 계통 자리만 잃는다 — 주 계통이 이것이던 설비는 자기가 든 다른 계통이 있으면 그리로, 없으면
 * 계통 없음이 된다. 사람이 확정한 방향은 계통이 없어져도 사람이 본 방향이라 남는다. 규칙 방향은 다시 돌린다.
 */
export function deleteSystem(model: Model, systemId: string): RuleReport | null {
  const system = findSystem(model, systemId)
  if (!system) return null
  model.systems = model.systems.filter((s) => s !== system)
  for (const e of model.storeys.flatMap((s) => s.equipment)) {
    if (e.systemId !== systemId) continue
    const next = model.systems.find((s) => s.memberIds.includes(e.id))?.id ?? null
    if (!e.systemEdited) e.systemEdited = { from: systemId }
    e.systemId = next
    if (e.systemEdited.from === next) delete e.systemEdited
  }
  return inferFlowByRules(model)
}

// --- 벽과 함께 방 경계 옮기기 (E4) ---------------------------------------------------------
//
// 벽을 옮겨도 방 외곽선은 따라오지 않는다(일부러 — 방은 IfcSpace 가 따로 그린 것이다). 사람이 "방 경계도 같이" 를 켜고
// 벽을 옮길 때만 벽 가까이 있던 방 변을 **벽이 옮겨진 만큼** 같이 옮긴다.
//
// **벽 면에 붙이지 않는다.** 처음에는 방 변을 벽 면으로 끌어 붙였는데, Revit 방 경계는 벽 면에 딱 붙어 있지 않아서(벽 중심선이나
// 마감 두께만큼 떨어진 것) 벽을 옮기지 않고 붙이기만 해도 Duplex 방 37개·병원 방 368개가 바뀌었다. 방마다 벽과의 간격을 그대로
// 두고 벽이 움직인 만큼만 옮긴다. 벽 면에 수직인 성분만 쓴다 — 벽을 제 길이 방향으로 밀었다고 방이 미끄러지지 않는다.

/** 벽 면에서 이만큼 안의 방 변만 같이 옮긴다(미터). 벽 두께의 절반(중심선에 그린 방)과 마감 두께를 넉넉히 덮는다. */
export const WALL_CARRY_REACH = 0.6
/** 방 변이 벽 면과 이 각도 안이어야 같이 옮긴다. 벽에 비스듬히 닿은 변을 끌어오지 않는다. */
const WALL_CARRY_ANGLE = Math.sin((10 * Math.PI) / 180)

type Face = { a: Vec2; u: Vec2; n: Vec2; len: number }

/** 벽 외곽선의 변마다 바깥 방향. 고리의 돌림 방향으로 바깥을 정해서 오목한 벽(ㄱ자)에도 맞는다. 짧은 마구리는 뺀다. */
function wallFaces(footprint: readonly (readonly Vec2[])[]): Face[] {
  const faces: Face[] = []
  for (const ring of footprint) {
    const pts = openRing(ring)
    let area = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]
      const q = pts[(i + 1) % pts.length]
      area += p[0] * q[1] - q[0] * p[1]
    }
    const sign = area >= 0 ? 1 : -1
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (len < 0.3) continue
      const u: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
      faces.push({ a, u, n: [sign * u[1], -sign * u[0]], len })
    }
  }
  return faces
}

/**
 * 한 면에 딸린 방 꼭짓점: 면 바깥쪽 방의, 면과 나란하고 면 가까이 있는 변의 두 끝. 없으면 빈 집합.
 *
 * **벽 끝을 넘어 이어지는 변은 옮기지 않는다.** 벽이 방 변의 가운데에서 끝나면(외벽 한 칸, 복도 쪽 칸막이) 변의 절반만
 * 끌려가 방이 비스듬해졌다(병원 건축 벽 300개 중 15개). 그런 변에 걸린 꼭짓점은 빼서, 방 변은 통째로 따라오거나 그대로다.
 */
function carriedVertices(footprint: readonly Vec2[], face: Face, reach: number): Set<number> {
  const pts = openRing(footprint)
  const keep = new Set<number>()
  const c = centroid(footprint)
  const side = (p: Vec2) => (p[0] - face.a[0]) * face.n[0] + (p[1] - face.a[1]) * face.n[1]
  const along = (p: Vec2) => (p[0] - face.a[0]) * face.u[0] + (p[1] - face.a[1]) * face.u[1]
  // 방이 이 면의 바깥쪽에 있어야 한다. 벽 건너편 방은 반대쪽 면이 맡는다.
  if (pts.length < 3 || !c || side(c) <= 0) return keep
  const close = pts.map((p) => Math.abs(side(p)) <= reach)
  const within = pts.map((p) => along(p) >= -reach && along(p) <= face.len + reach)
  const beyond = new Set<number>()
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    if (!close[i] || !close[j]) continue
    const dx = pts[j][0] - pts[i][0]
    const dy = pts[j][1] - pts[i][1]
    const l = Math.hypot(dx, dy)
    if (l < 1e-6 || Math.abs((dx * face.n[0] + dy * face.n[1]) / l) > WALL_CARRY_ANGLE) continue
    if (within[i] && within[j]) {
      keep.add(i)
      keep.add(j)
    } else {
      beyond.add(i)
      beyond.add(j)
    }
  }
  for (const i of beyond) keep.delete(i)
  return keep.size >= 2 ? keep : new Set()
}

/**
 * 벽을 옮길 때 같이 옮길 방 꼭짓점. 방마다 가장 많이 딸린 면 하나를 고르고, 그 면의 바깥 방향을 적는다.
 *
 * **한 번 정해 같은 벽을 계속 옮기는 동안 다시 쓴다.** 방향키로 10cm 씩 옮길 때마다 새로 고르면, 벽이 움직이며 가까워진 다른
 * 방 변이 새로 끌려오거나 고른 면이 바뀌어서, 옮겼다 되돌려도 방이 제자리로 오지 않았다(병원 벽 300개 중 7개).
 */
export type WallCarryPlan = {
  wallId: string
  /** 계획을 세운 때 방마다 꼭짓점 수. 달라졌으면(그 사이 경계를 고쳤으면) 계획을 버린다. */
  items: { spaceId: string; points: number; indices: number[]; n: Vec2 }[]
}

export function planWallCarry(model: Model, wallId: string, reach = WALL_CARRY_REACH): WallCarryPlan | null {
  const found = findWall(model, wallId)
  if (!found || !found.wall.footprint?.length) return null
  const faces = wallFaces(found.wall.footprint)
  const items: WallCarryPlan['items'] = []
  for (const space of found.storey.spaces) {
    let best: { face: Face; keep: Set<number> } | null = null
    for (const face of faces) {
      const keep = carriedVertices(space.footprint, face, reach)
      if (keep.size && (!best || keep.size > best.keep.size)) best = { face, keep }
    }
    if (best) items.push({ spaceId: space.id, points: openRing(space.footprint).length, indices: [...best.keep].sort((x, y) => x - y), n: best.face.n })
  }
  return { wallId, items }
}

/**
 * 벽을 옮기고, 벽 양쪽 방의 벽 가까운 변을 같이 옮긴다(벽 면에 수직인 성분만). `plan` 을 주면 그대로 쓰고, 안 주거나 다른 벽의
 * 것이면 지금 자리에서 세운다. 쓴 계획을 돌려준다 — 다음 걸음에 다시 넘긴다.
 *
 * 옮긴 모양이 자기 교차해도 옮기고 `crossed` 로 알린다(꼭짓점 끌기와 같다). 처음에는 그 방을 건너뛰었는데, 몇 걸음 옮긴 뒤에
 * 건너뛰면 그 방만 중간 자리에 남아 되돌아와도 제자리가 아니었다.
 */
export function moveWallWithSpaces(
  model: Model,
  wallId: string,
  delta: Vec2,
  plan?: WallCarryPlan | null,
): { changes: BoundaryChange[]; crossed: string[]; plan: WallCarryPlan } | null {
  const spaceById = new Map(model.storeys.flatMap((st) => st.spaces).map((sp) => [sp.id, sp]))
  // 계획을 세운 뒤 그 방 경계를 따로 고쳤으면(꼭짓점 넣기·지우기) 꼭짓점 번호가 어긋난다. 그때는 새로 세운다.
  const fresh = (p: WallCarryPlan) =>
    p.wallId === wallId && p.items.every((x) => spaceById.has(x.spaceId) && openRing(spaceById.get(x.spaceId)!.footprint).length === x.points)
  const use = plan && fresh(plan) ? plan : planWallCarry(model, wallId)
  if (!use) return null
  const next: WallCarryPlan = { wallId, items: [] }
  const rings: { space: Space; ring: Vec2[] }[] = []
  for (const item of use.items) {
    const space = spaceById.get(item.spaceId)
    const pts = space ? openRing(space.footprint) : []
    if (!space || pts.length !== item.points) continue
    const k = delta[0] * item.n[0] + delta[1] * item.n[1]
    const moved = new Set(item.indices)
    rings.push({ space, ring: withClosing(pts.map((p, i) => (moved.has(i) ? ([p[0] + k * item.n[0], p[1] + k * item.n[1]] as Vec2) : p)), true) })
    next.items.push(item)
  }
  if (!moveWall(model, wallId, delta)) return null
  const changes: BoundaryChange[] = []
  const crossed: string[] = []
  for (const { space, ring } of rings) {
    const change = replaceSpaceFootprint(model, space.id, ring)
    if (!change) continue
    changes.push(change)
    if (change.selfIntersecting) crossed.push(space.longName || space.name || space.id)
  }
  return { changes, crossed, plan: next }
}
