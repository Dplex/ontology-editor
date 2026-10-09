// 오프셋 높이 바꾸기(OE-ML-14 의 편집). 층 사이에서 옆으로 옮기는 수평 구간(오프셋)과 그 양 끝 꺾임점(이음쇠)을 같이 올리거나 내리고, 꺾임점에
// 이어진 다른 구간(라이저의 수직 구간·분기)은 그 끝만 늘이거나 줄인다(끝점 추종과 같은 `applyFollow`). 형상만 바뀌고 연결 대상·방향은 그대로다.
//
// 막는 것: 수평이 아닌 구간, 끝이 설비에 바로 붙은 구간(옮기면 설비와 떨어진다), 꺾임점에 이음쇠가 바로 물린 것(어디까지 끌려갈지 사람이 봐야 한다),
// 늘이는 구간이 길이 0 이 되거나 뒤집히는 높이, 층 바닥을 넘는 높이(꺾임점의 층이 바뀐다 — ADR-0035), 늘인 구간이 층 바닥을 비스듬히 지나게 되는 높이.

import { applyFollow, type Change, type SegmentAxis } from './edit'
import { MIN_SEGMENT_LENGTH, segmentPath, type Equipment, type Model, type Vec3 } from './model'
import { storeyAtZ, toCommon, type StoreyPoint } from './storey-z'

export type OffsetPlan = {
  segment: Equipment
  /** 같이 오르내리는 양 끝 꺾임점. */
  fittings: Equipment[]
  /** 끝만 늘이거나 줄이는 구간. */
  stretch: { id: string; end: 0 | 1 }[]
  /** 그 가운데 분기점(이음 셋 이상)인 꺾임점. */
  branches: Equipment[]
  delta: Vec3
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])

/** 수평 구간의 높이를 `to`(층 + 바닥에서 m)로 바꾸면 무엇이 움직이나. 바꿀 수 없으면 이유. */
export function planOffsetHeight(model: Model, segmentId: string, to: Omit<StoreyPoint, 'at'>): OffsetPlan | { refused: string } {
  const all = model.storeys.flatMap((s) => s.equipment)
  const byId = new Map(all.map((e) => [e.id, e]))
  const seg = byId.get(segmentId)
  if (!seg || seg.role !== 'segment') return { refused: '오프셋은 덕트·배관 구간입니다. 구간을 고르세요.' }
  const path = segmentPath(seg)
  if (!path || !('path' in path)) return { refused: '형상(중심선)이 없는 구간은 높이를 바꾸지 않습니다.' }
  const [p, q] = path.path
  if (Math.abs(p[2] - q[2]) > 0.01) return { refused: '수평 구간(오프셋)만 높이를 바꿉니다. 기운 구간은 꺾임점을 옮겨 고칩니다.' }
  const target = toCommon(model, { at: [p[0], p[1]], ...to })
  if ('refused' in target) return target
  const dz = target[2] - p[2]
  if (Math.abs(dz) < 0.001) return { refused: '높이가 그대로입니다.' }
  const delta: Vec3 = [0, 0, dz]

  const around = (id: string) => model.connections.filter((c) => c.from === id || c.to === id).map((c) => byId.get(c.from === id ? c.to : c.from)).filter((x): x is Equipment => !!x)
  const fittings: Equipment[] = []
  for (const tip of [p, q]) {
    const near = around(seg.id)
      .filter((e) => e.position)
      .sort((a, b) => len(sub(a.position!, tip)) - len(sub(b.position!, tip)))[0]
    if (!near || len(sub(near.position!, tip)) > 0.05) return { refused: `${seg.name}의 한 끝이 열려 있습니다. 양 끝이 꺾임점인 오프셋만 높이를 바꿉니다.` }
    if (near.role !== 'fitting') return { refused: `${seg.name}의 끝이 ${near.name}에 바로 붙어 있어 높이를 바꾸면 설비와 떨어집니다. 설비를 옮기거나 꺾임점을 넣어 고칩니다.` }
    fittings.push(near)
  }
  const stretch: OffsetPlan['stretch'] = []
  const branches: Equipment[] = []
  for (const f of fittings) {
    const others = around(f.id).filter((e) => e.id !== seg.id)
    if (others.length >= 2) branches.push(f)
    for (const o of others) {
      if (o.role !== 'segment') return { refused: `${f.name}에 ${o.name}이(가) 바로 붙어 있어 아직 높이를 바꾸지 않습니다. 붙은 것을 먼저 고칩니다.` }
      const op = segmentPath(o)
      if (!op || !('path' in op)) return { refused: `${o.name}은(는) 형상이 없어 따라 늘일 수 없습니다.` }
      const end: 0 | 1 = len(sub(op.path[0], f.position!)) <= len(sub(op.path[1], f.position!)) ? 0 : 1
      const fixed = op.path[end === 0 ? 1 : 0]
      const before = sub(op.path[end], fixed)
      const after = add(before, delta)
      if (len(after) < MIN_SEGMENT_LENGTH || before[0] * after[0] + before[1] * after[1] + before[2] * after[2] <= 0)
        return { refused: `${o.name}이(가) 길이 0 이 되거나 뒤집힙니다. 높이를 ${o.name}의 다른 끝(${fixed[2].toFixed(2)}m) 너머로 옮기지 않습니다.` }
      // 늘인 구간이 층 바닥을 비스듬히 지나게 되면 막는다(층을 지나는 구간은 수직, ADR-0035).
      const moved = add(op.path[end], delta)
      const [lo, hi] = moved[2] < fixed[2] ? [moved[2], fixed[2]] : [fixed[2], moved[2]]
      const crosses = model.storeys.some((s) => Number.isFinite(s.elevation) && s.elevation > lo + 0.001 && s.elevation < hi - 0.001)
      if (crosses && Math.hypot(moved[0] - fixed[0], moved[1] - fixed[1]) > 0.01) return { refused: `${o.name}이(가) 층 바닥을 비스듬히 지나게 됩니다. 수직이 아닌 구간은 층 안에 둡니다.` }
      stretch.push({ id: o.id, end })
    }
  }
  for (const f of fittings) {
    const was = storeyAtZ(model, f.position![2])
    const now = storeyAtZ(model, f.position![2] + dz)
    if (was?.id !== now?.id) return { refused: `꺾임점 ${f.name}이(가) ${was?.name ?? '?'}에서 ${now?.name ?? '?'}로 넘어갑니다. 오프셋 높이는 그 층 안에서 바꿉니다.` }
  }
  return { segment: seg, fittings, stretch, branches, delta }
}

/** 오프셋 높이를 바꾼다. 형상만 바뀌고 연결은 그대로다. */
export function setOffsetHeight(
  model: Model,
  segmentId: string,
  to: Omit<StoreyPoint, 'at'>,
  axisOf: (id: string) => SegmentAxis | null,
): { plan: OffsetPlan; changes: Change[] } | { refused: string } {
  const plan = planOffsetHeight(model, segmentId, to)
  if ('refused' in plan) return plan
  if (plan.stretch.some((s) => !axisOf(s.id))) return { refused: '늘일 구간의 형상을 모릅니다.' }
  const changes = applyFollow(model, { rigid: [...plan.fittings.map((f) => f.id), segmentId], stretch: plan.stretch, held: [], blocked: [] }, plan.delta, axisOf)
  return { plan, changes }
}
