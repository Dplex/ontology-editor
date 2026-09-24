// 온톨로지 편집. 고치는 대상은 3D 모델이 아니라 관계다.
//
// 설비를 옮기는 편집(E5)과 미배치 설비를 놓는 편집(E6)이 여기 있다. 화면에서는 점 하나가
// 움직이지만 온톨로지에서는 `brick:hasLocation` 이 바뀌고, 그 한 줄이 이상 알림의 발생
// 위치다. 그래서 편집 함수는 좌표만 바꾸고 끝내지 않고 **무엇이 바뀌었는지를 돌려준다.**
//
// 반영 전에 차이를 보여 주는 것이 PRD #16(미리보기)이고, 반영 뒤에 남기는 것이 #21(결과
// 리포트)이다. 둘 다 같은 값을 쓰므로 계산을 한 곳에 둔다.

import { assignEquipment, isSelfIntersecting } from './mapping'
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
  | { kind: 'confirm'; connections: Connection[] }

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

export function snapshotFlow(connection: Connection): Snapshot {
  return { kind: 'flow', connection, edited: connection.edited ? { ...connection.edited } : undefined }
}

/** 계통 확정이 이번에 바꿀 연결. 이미 확정한 것은 되돌릴 때 건드리지 않는다. */
export function snapshotConfirm(model: Model, systemId: string): Snapshot {
  return {
    kind: 'confirm',
    connections: model.connections.filter((c) => c.inferred?.systemId === systemId && !c.inferred.confirmed),
  }
}

/**
 * 스냅숏을 되돌려 놓고 소속을 다시 판정한다. 좌표·경계를 되돌렸는데 소속이 그대로면 리포트가 거짓이 된다.
 * 연결 방향과 확정은 소속과 상관이 없어 값만 되돌린다.
 */
export function restore(model: Model, snapshot: Snapshot): void {
  switch (snapshot.kind) {
    case 'equipment': {
      const equipment = findEquipment(model, snapshot.id)
      const home = model.storeys.find((s) => s.id === snapshot.storeyId)
      if (!equipment || !home) return
      for (const storey of model.storeys) {
        const at = storey.equipment.indexOf(equipment)
        if (at >= 0) storey.equipment.splice(at, 1)
      }
      home.equipment.splice(Math.min(snapshot.index, home.equipment.length), 0, equipment)
      equipment.position = snapshot.position
      if (snapshot.positionSource) equipment.positionSource = snapshot.positionSource
      else delete equipment.positionSource
      // BIM 이 말한 소속은 재판정이 건너뛰므로 값째 되돌린다. 나머지는 좌표로 다시 나온다.
      equipment.spaceSource = snapshot.spaceSource
      equipment.spaceId = snapshot.spaceId
      assignEquipment(equipment, home.spaces)
      return
    }
    case 'space': {
      const space = findSpace(model, snapshot.id)
      if (!space) return
      space.footprint = [...snapshot.footprint]
      space.areaM2 = snapshot.areaM2
      space.longName = snapshot.longName
      reassignStoreyWith(model, space.id)
      return
    }
    case 'flow':
      if (snapshot.edited) snapshot.connection.edited = { ...snapshot.edited }
      else delete snapshot.connection.edited
      return
    case 'confirm':
      for (const c of snapshot.connections) if (c.inferred) c.inferred.confirmed = false
      return
  }
}
