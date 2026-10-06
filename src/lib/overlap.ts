// 설비 겹침(OE-OBJ-10 · OE-OBJ-16). 배관 없는 설비(조명·감지기·CCTV·분전반 같은 것)는 서로 겹쳐 놓지 못한다.
//
// 설비 형상은 모델이 아니라 3D 메시에만 있어서(ifc/import.ts 의 MeshMap) 판정은 상자 하나로 한다 — 형상을 감싸는 축 정렬
// 상자다. 형상이 없는 설비(좌표만 있는 것, 에디터가 더한 것)는 3D 가 그리는 0.4m 상자(viewer.ts)를 쓴다. 화면에 보이는 것과
// 같은 크기여야 "겹쳐 보이는데 놓인다" 가 안 생긴다.
//
// **덕트·배관이 붙는 설비는 이 규칙 밖이다.** FCU·디퓨저·VAV 는 이음쇠·덕트와 형상이 맞물리는 것이 정상이라(연결 추정이
// 그것으로 잇는다) 막으면 BIM 그대로의 배치도 못 옮긴다. 규칙은 흐름이 없는 종류(kinds.ts 의 flow 가 빈 것)끼리만 본다.
// BIM 이 이미 겹치게 둔 것은 막지 않는다. 편집이 새로 만드는 겹침만 막는다(벽 관통과 같다).

import type { ElementMesh } from './ifc/import'
import { equipmentKind } from './kinds'
import { isConduit, type Equipment, type Model, type Vec3 } from './model'

/** IFC 좌표(z 가 위, 미터)의 축 정렬 상자. */
export type Box3 = { min: Vec3; max: Vec3 }

/** 형상이 없는 설비의 상자 한 변(미터). viewer.ts 가 좌표만 있는 설비를 그리는 상자와 같다. */
export const MARKER_SIZE = 0.4

/** 맞닿은 것으로 봐 주는 파고듦(미터). 이만큼 안으로 들어온 것은 겹침이 아니다(형상 오차, 벽에 붙인 두 기기). */
export const OVERLAP_TOLERANCE = 0.01

/** 메시를 감싸는 상자. 메시는 three.js 세계 좌표(x, 높이, -y)라 IFC 좌표로 돌린다. */
export function meshBox(mesh: ElementMesh): Box3 | null {
  const p = mesh.positions
  if (p.length < 3) return null
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < p.length; i += 3) {
    const q = [p[i], -p[i + 2], p[i + 1]]
    for (let k = 0; k < 3; k++) {
      if (q[k] < min[k]) min[k] = q[k]
      if (q[k] > max[k]) max[k] = q[k]
    }
  }
  return { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] }
}

/** 좌표만 있는 설비의 상자(가운데가 좌표). */
export function markerBox(at: Vec3): Box3 {
  const h = MARKER_SIZE / 2
  return { min: [at[0] - h, at[1] - h, at[2] - h], max: [at[0] + h, at[1] + h, at[2] + h] }
}

export function shiftBox(box: Box3, d: Vec3): Box3 {
  return { min: [box.min[0] + d[0], box.min[1] + d[1], box.min[2] + d[2]], max: [box.max[0] + d[0], box.max[1] + d[1], box.max[2] + d[2]] }
}

/** 두 상자가 세 축 모두에서 `tol` 넘게 파고드나. 맞닿기만 한 것은 겹침이 아니다. */
export function boxesOverlap(a: Box3, b: Box3, tol = OVERLAP_TOLERANCE): boolean {
  for (let k = 0; k < 3; k++) {
    if (Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) <= tol) return false
  }
  return true
}

/**
 * 종류를 모를 때 배관 없는 설비로 보는 IFC 클래스(`Equipment.ifcClass` 처럼 Ifc 를 뗀 이름). 이 클래스들은 공기·물이 흐르지 않는다(센서·조명·경보·콘센트·분전반·
 * 통신·승강기). 스프링클러(IfcFireSuppressionTerminal)·밸브 구동기(IfcActuator)는 배관에 붙어서 넣지 않는다.
 */
const STANDALONE_CLASSES = new Set([
  'Sensor',
  'LightFixture',
  'Lamp',
  'Alarm',
  'Outlet',
  'ElectricDistributionBoard',
  'CommunicationsAppliance',
  'AudioVisualAppliance',
  'TransportElement',
])

/**
 * 겹침 규칙을 따르는 설비: 덕트·배관이 아니고, 배관 없는 설비다 — 종류를 알면 그 종류에 공기·물 흐름이 없고, 모르면 IFC
 * 클래스가 흐름 없는 클래스다(손으로 쓴 mep.ifc 의 온도센서처럼 이름 사전에 없는 센서).
 *
 * 에디터가 더한 설비는 종류를 정하기 전까지 배관 없는 설비로 본다. 붙은 배관이 하나도 없고, 안 그러면 클래스가
 * `DistributionElement` 라 규칙 밖이 되어 "추가로 겹침이 생기는 시도"(OE-OBJ-16 수용 기준)를 못 막는다. 흐름이 있는 종류를
 * 정하면 그때부터 규칙 밖이다.
 */
export function standalone(e: Equipment): boolean {
  if (isConduit(e.role)) return false
  const flow = equipmentKind(e.kind)?.flow
  if (flow) return Object.keys(flow).length === 0
  if (e.added && !e.kind) return true
  return STANDALONE_CLASSES.has(e.ifcClass)
}

/**
 * 이 설비의 상자를 지금 자리에서 잰다. `boxOf` 는 형상 상자(지금 자리)를 준다. 형상이 없으면 좌표 상자, 좌표도 없으면 null.
 */
export function equipmentBox(e: Equipment, boxOf: (id: string) => Box3 | null): Box3 | null {
  return boxOf(e.id) ?? (e.position ? markerBox(e.position) : null)
}

/**
 * 설비를 `to` 로 옮기면(또는 그 자리에 놓으면) 새로 겹치게 되는 배관 없는 설비. 없으면 null.
 *
 * `to` 는 설비의 좌표(position)다. 상자는 지금 상자를 좌표 차만큼 민다. 좌표가 아직 없는 설비(미배치)는 좌표 상자다.
 * 원래 겹쳐 있던 설비는 세지 않는다 — BIM 이 겹치게 둔 것을 떼어 놓으려고 옮기는 것은 된다.
 *
 * **모든 층의 설비와 견준다.** 겹침은 자리(3차원 상자)로 정하고 층 소속은 상관없다. 처음에는 그 설비가 속한 층만 봐서,
 * 1층 콘센트와 2층 콘센트를 같은 x·y·z 로 옮겨도 막지 않았다(2026-10-06 검토, Duplex MEP).
 */
export function overlapAt(model: Model, equipmentId: string, to: Vec3, boxOf: (id: string) => Box3 | null): Equipment | null {
  const all = model.storeys.flatMap((s) => s.equipment)
  const me = all.find((e) => e.id === equipmentId)
  if (!me || !standalone(me)) return null
  const now = equipmentBox(me, boxOf)
  const next = me.position && now ? shiftBox(now, [to[0] - me.position[0], to[1] - me.position[1], to[2] - me.position[2]]) : markerBox(to)
  for (const other of all) {
    if (other.id === me.id || !standalone(other)) continue
    const box = equipmentBox(other, boxOf)
    if (!box || !boxesOverlap(next, box)) continue
    if (now && me.position && boxesOverlap(now, box)) continue
    return other
  }
  return null
}

/**
 * `at` 에 설비를 새로 더하면 겹치게 되는 배관 없는 설비. 없으면 null. 더할 설비는 아직 형상이 없어서 3D 가 그리는
 * 좌표 상자(`MARKER_SIZE`)로 잰다. 종류를 모르는 새 설비는 배관 없는 설비로 본다(`standalone`).
 */
export function overlapForNew(model: Model, at: Vec3, boxOf: (id: string) => Box3 | null): Equipment | null {
  const next = markerBox(at)
  for (const other of model.storeys.flatMap((s) => s.equipment)) {
    if (!standalone(other)) continue
    const box = equipmentBox(other, boxOf)
    if (box && boxesOverlap(next, box)) return other
  }
  return null
}

/** 한 층에서 이미 겹쳐 있는 배관 없는 설비 쌍. 검사·실측용이다. */
export function overlappingPairs(model: Model, boxOf: (id: string) => Box3 | null): [Equipment, Equipment][] {
  const out: [Equipment, Equipment][] = []
  for (const storey of model.storeys) {
    const items = storey.equipment.filter(standalone).flatMap((e) => {
      const box = equipmentBox(e, boxOf)
      return box ? [{ e, box }] : []
    })
    items.sort((a, b) => a.box.min[0] - b.box.min[0])
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length && items[j].box.min[0] < items[i].box.max[0]; j++) {
        if (boxesOverlap(items[i].box, items[j].box)) out.push([items[i].e, items[j].e])
      }
    }
  }
  return out
}
