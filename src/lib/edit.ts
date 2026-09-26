// 온톨로지 편집. 고치는 대상은 3D 모델이 아니라 관계다.
//
// 설비를 옮기는 편집(E5)과 미배치 설비를 놓는 편집(E6)이 여기 있다. 화면에서는 점 하나가
// 움직이지만 온톨로지에서는 `brick:hasLocation` 이 바뀌고, 그 한 줄이 이상 알림의 발생
// 위치다. 그래서 편집 함수는 좌표만 바꾸고 끝내지 않고 **무엇이 바뀌었는지를 돌려준다.**
//
// 반영 전에 차이를 보여 주는 것이 PRD #16(미리보기)이고, 반영 뒤에 남기는 것이 #21(결과
// 리포트)이다. 둘 다 같은 값을 쓰므로 계산을 한 곳에 둔다.

import { assignEquipment, isSelfIntersecting } from './mapping'
import { inferFlowByRules, type RuleReport } from './flow-rules'
import { equipmentKind } from './kinds'
import { polygonArea } from './model'
import type { Connection, Equipment, Model, Vec2, Vec3 } from './model'

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

function reassignStoreyWith(model: Model, spaceId: string) {
  const storey = model.storeys.find((s) => s.spaces.some((sp) => sp.id === spaceId))
  if (storey) for (const e of storey.equipment) assignEquipment(e, storey.spaces)
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
  equipment.position = to
  equipment.positionSource = 'edited'
  // BIM 이 말한 소속은 BIM 이 말한 자리에 대한 것이다. 사람이 옮긴 뒤에도 남겨 두면 방 밖으로 끌어낸
  // 설비가 예전 방에 그대로 속한다. 옮긴 설비는 좌표로 다시 판정한다.
  if (equipment.spaceSource === 'bim') equipment.spaceSource = null
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

/** 사람이 방향을 정한 연결. 규칙 방향이 있었으면 그것과 같은지 반대인지도 적는다. */
export type FlowEdit = {
  from: string
  to: string
  rule: 'same' | 'reversed' | null
}

export function flowEdits(model: Model): FlowEdit[] {
  return model.connections
    .filter((c) => !c.directed && c.edited)
    .map((c) => ({
      from: c.edited!.from,
      to: c.edited!.to,
      rule: c.inferred ? (c.inferred.from === c.edited!.from ? 'same' : 'reversed') : null,
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

/** 물리존 이름을 고친다(E1). 라벨만 바뀌므로 다시 계산할 것이 없다. */
export function renameSpace(model: Model, spaceId: string, longName: string): boolean {
  for (const storey of model.storeys) {
    const space = storey.spaces.find((s) => s.id === spaceId)
    if (space) {
      space.longName = longName
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

  space.footprint = ring
  space.areaM2 = polygonArea(ring)
  reassignStoreyWith(model, spaceId)

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
 */
export function replaceSpaceFootprint(model: Model, spaceId: string, ring: Vec2[]): BoundaryChange | null {
  const space = findSpace(model, spaceId)
  if (!space) return null

  const before = snapshotSpaces(model)
  const fromAreaM2 = space.areaM2

  space.footprint = ring
  space.areaM2 = polygonArea(ring)
  reassignStoreyWith(model, spaceId)

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
    }
  | { kind: 'space'; id: string; footprint: Vec2[]; areaM2: number; longName: string }
  | { kind: 'flow'; connection: Connection; edited: Connection['edited'] }
  | { kind: 'confirm'; connections: Connection[]; confirmed: boolean }
  | { kind: 'kinds'; entries: { id: string; kind: string | null | undefined; kindEdited: Equipment['kindEdited'] }[] }
  /** 연결이 모델에 있었는가. 잇기·끊기를 되돌린다. 연결 객체를 그대로 들고 있어 방향·확정도 같이 돌아온다. */
  | { kind: 'connection'; connection: Connection; present: boolean; index: number }

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
    }
  }
  return null
}

/** 경계와 이름. 소속은 담지 않는다 — 경계를 되돌리면 재판정이 같은 소속을 다시 낸다. */
export function snapshotSpace(model: Model, spaceId: string): Snapshot | null {
  const space = findSpace(model, spaceId)
  if (!space) return null
  return { kind: 'space', id: space.id, footprint: [...space.footprint], areaM2: space.areaM2, longName: space.longName }
}

export function snapshotConnection(model: Model, connection: Connection): Snapshot {
  const index = model.connections.indexOf(connection)
  return { kind: 'connection', connection, present: index >= 0, index: index >= 0 ? index : model.connections.length }
}

export function snapshotFlow(connection: Connection): Snapshot {
  return { kind: 'flow', connection, edited: connection.edited ? { ...connection.edited } : undefined }
}

/** 계통 확정이 이번에 바꿀 연결. 이미 확정한 것은 되돌릴 때 건드리지 않는다. */
export function snapshotConfirm(model: Model, systemId: string): Snapshot {
  return {
    kind: 'confirm',
    connections: model.connections.filter((c) => c.inferred?.systemId === systemId && !c.inferred.confirmed),
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
      // BIM 이 말한 소속은 재판정이 건너뛰므로 값째 되돌린다. 나머지는 좌표로 다시 나온다.
      equipment.spaceSource = snapshot.spaceSource
      equipment.spaceId = snapshot.spaceId
      assignEquipment(equipment, home.spaces)
      return null
    }
    case 'space': {
      const space = findSpace(model, snapshot.id)
      if (!space) return null
      space.footprint = [...snapshot.footprint]
      space.areaM2 = snapshot.areaM2
      space.longName = snapshot.longName
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
    case 'connection': {
      const at = model.connections.indexOf(snapshot.connection)
      if (snapshot.present && at < 0) model.connections.splice(Math.min(snapshot.index, model.connections.length), 0, snapshot.connection)
      if (!snapshot.present && at >= 0) model.connections.splice(at, 1)
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
  const revit = /^(.+:.+):\d+$/.exec(e.name)
  return revit ? revit[1] : e.objectType || null
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
  return /^(.+:.+):\d+$/.test(e.name) ? type.split(':')[0] : type
}

/** 패밀리의 열쇠. 타입 열쇠와 가르려고 `family:` 를 붙인다. 이름이 없으면 설비 하나다(타입 열쇠와 같다). */
export function familyKeyOf(e: Equipment): string {
  const name = familyNameOf(e)
  return name ? `family:${e.ifcClass}|${name}` : `#${e.id}`
}

/** 종류를 붙이는 묶음에 드는가. 열쇠가 `family:` 로 시작하면 패밀리, 아니면 타입이다. */
export function inKindGroup(e: Equipment, key: string): boolean {
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
  const byType = new Map<string, KindEdit>()
  for (const e of model.storeys.flatMap((s) => s.equipment)) {
    if (!e.kindEdited) continue
    const key = typeKeyOf(e)
    const row = byType.get(key)
    if (row) row.count++
    else byType.set(key, { typeKey: key, count: 1, from: e.kindEdited.from, to: e.kind ?? null })
  }
  return [...byType.values()]
}

// --- 연 때와 견주기 ----------------------------------------------------------------
//
// 편집 기록(Change)은 소속 관계가 바뀐 것만 적는다. 그런데 내보내는 파일은 그것 말고도 바뀐다 — 이름을 고치면
// TTL 의 rdfs:label 이, 방 안에서 옮기면 GeoJSON 의 좌표가, 층을 옮기면 brick:hasPart 가 바뀐다. 리포트가 이걸
// 빼면 "바뀐 것 0건" 인 채로 다른 파일이 나간다. 편집 기록을 쌓는 대신 **연 때의 값과 지금 값을 견준다** —
// 되돌리기·다시 하기·제자리로 돌린 것이 저절로 맞는다.

export type Baseline = {
  names: Map<string, string>
  /** 물리존 외곽선. 편집 저장(edit-file.ts)이 바뀐 경계만 골라 담는다. */
  footprints: Map<string, Vec2[]>
  equipment: Map<string, { position: Vec3 | null; storeyId: string; spaceId: string | null }>
  /** 연 때 있던 연결(순서 없는 짝). 이은 것·끊은 것을 이것과 견준다. 옛 편집 파일에서 온 baseline 에는 없을 수 있다. */
  connections?: Set<string>
}

/** 파일을 열거나 합친 직후에 뜬다. */
export function baselineOf(model: Model): Baseline {
  const names = new Map<string, string>()
  const footprints = new Map<string, Vec2[]>()
  const equipment: Baseline['equipment'] = new Map()
  for (const storey of model.storeys) {
    for (const space of storey.spaces) {
      names.set(space.id, space.longName)
      footprints.set(space.id, space.footprint.map((p) => [p[0], p[1]] as Vec2))
    }
    for (const e of storey.equipment) {
      equipment.set(e.id, {
        position: e.position ? [e.position[0], e.position[1], e.position[2]] : null,
        storeyId: storey.id,
        spaceId: e.spaceId,
      })
    }
  }
  return { names, footprints, equipment, connections: new Set(model.connections.map((c) => pairKey(c.from, c.to))) }
}

export type BaselineDiff = {
  renamed: { spaceId: string; from: string; to: string }[]
  /** 좌표는 바뀌었는데 소속 물리존은 그대로인 설비. 소속이 바뀐 것은 Change 가 이미 적는다. */
  moved: { id: string; name: string }[]
  restoreyed: { id: string; name: string; from: string; to: string }[]
  /** 연 때 없던 연결(사람이 이은 것). */
  connected: { from: string; to: string }[]
  /** 연 때 있었는데 지금 없는 연결(사람이 끊은 것). */
  disconnected: { from: string; to: string }[]
}

/** 좌표를 같다고 보는 차. 표와 3D 가 센티미터로 자르므로 그보다 작은 차는 같은 자리다. */
const SAME_PLACE = 0.005

export function diffBaseline(model: Model, baseline: Baseline): BaselineDiff {
  const renamed: BaselineDiff['renamed'] = []
  const moved: BaselineDiff['moved'] = []
  const restoreyed: BaselineDiff['restoreyed'] = []
  const storeyName = new Map(model.storeys.map((s) => [s.id, s.name]))
  for (const storey of model.storeys) {
    for (const space of storey.spaces) {
      const from = baseline.names.get(space.id)
      if (from !== undefined && from !== space.longName) renamed.push({ spaceId: space.id, from, to: space.longName })
    }
    for (const e of storey.equipment) {
      const was = baseline.equipment.get(e.id)
      if (!was) continue
      const name = e.name || e.ifcClass
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
      disconnected.push({ from, to })
    }
  }
  return { renamed, moved, restoreyed, connected, disconnected }
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

/** 두 설비를 잇는다. 이미 이어져 있거나 같은 설비면 null. */
export function addConnection(model: Model, a: string, b: string): { connection: Connection; rules: RuleReport } | null {
  if (a === b || !findEquipment(model, a) || !findEquipment(model, b) || connectionBetween(model, a, b)) return null
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
