// 덕트·배관 구간의 샤프트 소속(OE-ML-09·14, ADR-0047).
//
// 소속은 사람이 정한다. 구간이 샤프트 축(모든 층에 같은 평면 형상) 안에 있어도 저절로 붙이지 않는다 — 위치만 겹친 배관을 샤프트에
// 넣으면(OE-ML-14#6) 샤프트를 옮기거나 지울 때 엉뚱한 배관이 영향 목록에 든다. 정할 수 있는 것은 두 끝이 축 안에 있는 구간뿐이다.
//
// 구간에는 샤프트 id(`Equipment.shaftId`)만 적는다. 그 샤프트가 없으면(지웠다) 소속은 효력이 없다 — 배관과 연결은 그대로 남고
// 소속만 풀린 것으로 본다(OE-ML-09#4). 샤프트 지우기를 되돌리면 소속도 돌아온다. 내보내기·편집 파일·화면은 `shaftOf` 로 읽는다.
// 샤프트를 옮기거나 구간을 옮겨 축을 벗어나면 소속은 두고 "이탈" 로 알린다(OE-ML-14#5). 사람이 고치거나 소속을 푼다.

import { distanceToRing, pointInPolygon } from './mapping'
import { segmentPath, type Equipment, type Model, type Vec2 } from './model'
import { verticalObjects, type VerticalObject } from './vertical-object'

/** 축 경계에서 이만큼(m) 밖까지는 안으로 본다. 배관을 축 벽에 붙여 그린 것. */
export const SHAFT_TOLERANCE = 0.05

const shafts = (model: Pick<Model, 'storeys'>) => verticalObjects(model).filter((o) => o.kind === 'shaft')
/** 샤프트 축(모든 층에 같다). */
const axisOf = (o: VerticalObject): Vec2[] => o.parts.find((p) => p.part.footprint.length >= 3)?.part.footprint ?? []
const inside = (ring: readonly Vec2[], p: Vec2) => ring.length >= 3 && (pointInPolygon(p, ring) || distanceToRing(p, ring) <= SHAFT_TOLERANCE)

function findSegment(model: Pick<Model, 'storeys'>, id: string): { e: Equipment; storeyId: string } | null {
  for (const s of model.storeys) {
    const e = s.equipment.find((x) => x.id === id)
    if (e) return { e, storeyId: s.id }
  }
  return null
}

/** 구간이 샤프트 축 안에 있나(두 끝 다). 경로가 없으면 false. */
function within(e: Equipment, o: VerticalObject): boolean {
  const p = segmentPath(e)
  if (!p || !('path' in p)) return false
  const ring = axisOf(o)
  return p.path.every((q) => inside(ring, [q[0], q[1]]))
}

/** 구간이 지금 속한 샤프트. 정하지 않았거나 그 샤프트가 없으면 null. */
export function shaftOf(model: Pick<Model, 'storeys'>, e: Pick<Equipment, 'shaftId'>): VerticalObject | null {
  return e.shaftId ? (shafts(model).find((o) => o.id === e.shaftId) ?? null) : null
}

/** 이 구간을 넣을 수 있는 샤프트: 두 끝이 축 안이고, 구간의 층이 샤프트 구간에 든다. */
export function shaftCandidates(model: Pick<Model, 'storeys'>, segmentId: string): VerticalObject[] {
  const found = findSegment(model, segmentId)
  if (!found || found.e.role !== 'segment') return []
  return shafts(model).filter((o) => o.parts.some((p) => p.storey.id === found.storeyId) && within(found.e, o))
}

/** 구간의 샤프트 소속을 정하거나(`shaftId`) 푼다(null). */
export function setSegmentShaft(model: Pick<Model, 'storeys'>, segmentId: string, shaftId: string | null): true | { refused: string } {
  const found = findSegment(model, segmentId)
  if (!found || found.e.role !== 'segment') return { refused: '덕트·배관 구간만 샤프트에 넣습니다.' }
  if (shaftId === null) {
    if (!found.e.shaftId) return { refused: '샤프트에 넣지 않은 구간입니다.' }
    delete found.e.shaftId
    return true
  }
  const o = shafts(model).find((x) => x.id === shaftId)
  if (!o) return { refused: '없는 샤프트입니다.' }
  if (!shaftCandidates(model, segmentId).some((x) => x.id === o.id)) return { refused: `${found.e.name}의 두 끝이 ${o.name} 축 안에 있지 않습니다. 위치만 가까운 배관은 샤프트에 넣지 않습니다.` }
  if (found.e.shaftId === shaftId) return { refused: '이미 그 샤프트에 들어 있습니다.' }
  found.e.shaftId = shaftId
  return true
}

/** 샤프트에 든 구간. */
export function shaftMembers(model: Pick<Model, 'storeys'>, shaftId: string): Equipment[] {
  return model.storeys.flatMap((s) => s.equipment).filter((e) => e.shaftId === shaftId && shaftOf(model, e))
}

/** 소속 샤프트의 축을 벗어난 구간(이탈). 소속은 그대로 두고 알린다. */
export function shaftDeviations(model: Pick<Model, 'storeys'>): { segment: Equipment; shaft: VerticalObject }[] {
  const out: { segment: Equipment; shaft: VerticalObject }[] = []
  for (const e of model.storeys.flatMap((s) => s.equipment)) {
    const o = shaftOf(model, e)
    if (o && !within(e, o)) out.push({ segment: e, shaft: o })
  }
  return out
}
