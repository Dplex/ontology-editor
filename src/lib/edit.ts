// 온톨로지 편집. 고치는 대상은 3D 모델이 아니라 관계다.
//
// 설비를 옮기는 편집(E5)과 미배치 설비를 놓는 편집(E6)이 여기 있다. 화면에서는 점 하나가
// 움직이지만 온톨로지에서는 `brick:hasLocation` 이 바뀌고, 그 한 줄이 이상 알림의 발생
// 위치다. 그래서 편집 함수는 좌표만 바꾸고 끝내지 않고 **무엇이 바뀌었는지를 돌려준다.**
//
// 반영 전에 차이를 보여 주는 것이 PRD #16(미리보기)이고, 반영 뒤에 남기는 것이 #21(결과
// 리포트)이다. 둘 다 같은 값을 쓰므로 계산을 한 곳에 둔다.

import { assignEquipmentToSpaces, isSelfIntersecting } from './mapping'
import { polygonArea } from './model'
import type { Equipment, Model, Vec2, Vec3 } from './model'

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
  assignEquipmentToSpaces(model)
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
 * 설비 하나를 다른 층으로 옮긴다.
 *
 * 층은 좌표로 판정하지 않는다. 층고를 모르는 모델이 있고, 천장 설비는 다음 층 바닥과 높이가
 * 겹쳐서 z 만으로는 어느 층인지 정해지지 않기 때문이다. 그래서 층은 사람이 고른다.
 */
export function moveEquipmentToStorey(model: Model, equipmentId: string, storeyId: string): Change | null {
  const equipment = findEquipment(model, equipmentId)
  if (!equipment) return null

  const target = model.storeys.find((s) => s.id === storeyId)
  if (!target) return null

  for (const storey of model.storeys) {
    const at = storey.equipment.findIndex((e) => e.id === equipmentId)
    if (at >= 0) storey.equipment.splice(at, 1)
  }
  target.equipment.push(equipment)

  const fromSpaceId = equipment.spaceId
  assignEquipmentToSpaces(model)

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
  const ring = [...space.footprint]
  ring[vertexIndex] = to

  // 닫힌 고리의 첫 점과 끝 점은 같은 점이다. 하나만 옮기면 고리가 벌어진다.
  const last = ring.length - 1
  const closed = ring.length >= 2 && space.footprint[0][0] === space.footprint[last][0] && space.footprint[0][1] === space.footprint[last][1]
  if (closed) {
    if (vertexIndex === 0) ring[last] = to
    else if (vertexIndex === last) ring[0] = to
  }

  space.footprint = ring
  space.areaM2 = polygonArea(ring)
  assignEquipmentToSpaces(model)

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
  assignEquipmentToSpaces(model)

  return {
    spaceId,
    spaceName: space.longName || space.name,
    fromAreaM2,
    toAreaM2: space.areaM2,
    equipment: diffSpaces(model, before, (id) => spaceLabel(model, id)),
    selfIntersecting: isSelfIntersecting(ring),
  }
}
