// 층별 분기(OE-ML-13, ADR-0036). 기존 배관 구간의 한 자리에 분기점(이음쇠)을 넣어 구간을 둘로 나누고, 그 분기점에서 같은 배관 그리기
// (manual-pipe.ts)로 그 층의 설비·배관까지 잇는다.
//
// - 분기 자리는 사람이 고른다. 구간 선에서 0.3m 안이면 선 위로 내린다(찍은 자리가 조금 빗나가도 된다). 클릭·형상 교차만으로는 잇지 않는다.
// - 구간 끝 5cm 안이면 새 분기점을 만들지 않는다. 그 끝에 이어진 이음쇠가 Flow Type·계통이 맞으면 그 이음쇠를 분기점으로 다시 쓰고, 맞지
//   않거나 이음쇠가 아니거나 해제 보정한 연결이면 거절한다 — 좌표만 같은 다른 계통의 분기점을 저절로 쓰지 않는다.
// - 매체(덕트 공기 ↔ 물 배관)·Flow Type·계통이 주 배관과 맞지 않으면 거절한다(OE-PIP-11 의 검토).
// - 나누기: 앞쪽 구간은 그 끝을 분기점까지 줄이고(끝점 추종과 같은 `applyFollow`), 뒤쪽은 새 구간이다. 뒤 끝 대상과의 옛 연결이 BIM 포트
//   연결이면 지우지 않고 해제 보정한다(OE-PIP-06, 사유 "분기점 넣기"). 새 조각끼리와 뒤 끝 대상은 `manual` 연결이고 방향은 정하지 않는다.

import { addEquipment, applyFollow, type SegmentAxis } from './edit'
import { inferFlowByRules } from './flow-rules'
import { josa } from './josa'
import { flowType } from './flow-type'
import { mediaOf } from './connect-candidates'
import { releaseConnection } from './connection-release'
import { drawPipe, type PipeResult, type PipeSpec } from './manual-pipe'
import { segmentPath, segmentRest, type Connection, type Equipment, type Model, type Storey, type Vec3 } from './model'
import { storeyAtZ, toCommon, type PathPoint } from './storey-z'

export type BranchSpec = Omit<PipeSpec, 'from'> & {
  /** 분기를 낼 구간. */
  segmentId: string
  /** 분기 자리. 구간 선 위로 내린다. */
  at: PathPoint
}

export type BranchResult = PipeResult & {
  /** 분기점. 새로 넣었거나(`reused: false`) 구간 끝의 이음쇠를 다시 쓴 것. */
  tee: Equipment
  reused: boolean
  /** 나눠 생긴 뒤쪽 구간. 다시 썼으면 null. */
  tail: Equipment | null
  /** 뒤 끝 대상과의 옛 연결. 해제 보정했으면 `released`. 뒤 끝이 열려 있었거나 다시 썼으면 null. */
  replaced: { connection: Connection; released: boolean } | null
}

/** 찍은 분기 자리가 구간 선에서 벗어나도 되는 거리(m). */
export const BRANCH_SNAP = 0.3
/** 구간 끝에서 이만큼(m) 안이면 새 분기점을 넣지 않고 끝의 이음쇠를 다시 쓴다. */
export const BRANCH_REUSE = 0.05

/** 구간의 연 때 축(늘이기 전 두 끝, 세계 좌표). 중심선(`axis`)이 있는 구간만. */
export const restAxis =
  (model: Model) =>
  (id: string): SegmentAxis | null => {
    for (const s of model.storeys) {
      const e = s.equipment.find((x) => x.id === id)
      if (e) return segmentRest(e)?.ends ?? null
    }
    return null
  }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mm = (p: Vec3): Vec3 => p.map((v) => Math.round(v * 1000) / 1000) as unknown as Vec3

export function branchPipe(model: Model, spec: BranchSpec, axisOf: (id: string) => SegmentAxis | null = restAxis(model)): BranchResult | { refused: string } {
  const where = (id: string): { storey: Storey; e: Equipment } | null => {
    for (const storey of model.storeys) {
      const e = storey.equipment.find((x) => x.id === id)
      if (e) return { storey, e }
    }
    return null
  }
  const main = where(spec.segmentId)
  if (!main) return { refused: '분기를 낼 구간을 찾지 못했습니다.' }
  const seg = main.e
  if (seg.role !== 'segment') return { refused: '분기는 덕트·배관 구간의 중간에서 냅니다. 구간을 고르세요.' }
  const path = segmentPath(seg)
  if (!path || !('path' in path) || !axisOf(seg.id)) return { refused: '형상(중심선)이 없는 구간에는 분기를 내지 않습니다.' }
  const flow = flowType(spec.flowType)
  if (!flow) return { refused: `범례에 없는 Flow Type(${spec.flowType})으로는 배관을 그리지 않습니다.` }

  // 주 배관과 맞는지(OE-PIP-11 의 매체·Flow Type·계통).
  const media = mediaOf(model, seg)
  if ((flow.medium === 'air' && media.includes('water') && !media.includes('air')) || (flow.medium !== 'air' && media.includes('air') && !media.includes('water')))
    return { refused: `매체가 다릅니다: ${seg.name}은(는) ${media.includes('air') ? '공기 덕트' : '물 배관'}인데 ${flow.code} 는 ${flow.medium === 'air' ? '공기' : '공기가 아닌 매체'}입니다. 같은 매체로 분기합니다.` }
  if (seg.flowType && seg.flowType !== flow.code) return { refused: `주 배관의 Flow Type(${seg.flowType})과 다릅니다. 분기는 주 배관과 같은 Flow Type 으로 그립니다.` }
  if (spec.systemId && seg.systemId && spec.systemId !== seg.systemId) {
    const name = model.systems.find((s) => s.id === seg.systemId)?.name ?? seg.systemId
    return { refused: `주 배관의 계통(${name})과 다른 계통입니다. 다른 계통끼리 분기로 합치지 않습니다.` }
  }

  // 분기 자리를 구간 선 위로 내린다.
  const at = toCommon(model, spec.at)
  if ('refused' in at) return at
  const [p, q] = path.path
  const d = sub(q, p)
  const len2 = dot(d, d)
  const t = Math.max(0, Math.min(1, dot(sub(at, p), d) / len2))
  const foot: Vec3 = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]
  const off = Math.hypot(...sub(at, foot))
  if (off > BRANCH_SNAP) return { refused: `분기 자리가 ${seg.name} 위에 있지 않습니다(${off.toFixed(2)}m 떨어짐). 구간 위를 찍습니다.` }
  const len = Math.sqrt(len2)

  // 구간 끝에 이어진 것(끝 0·끝 1). 해제 보정한 연결은 이어진 것이 아니다.
  const linked = model.connections.filter((c) => c.from === seg.id || c.to === seg.id)
  const neighborAt = (end: 0 | 1) => {
    const tip = path.path[end]
    const near = linked
      .map((c) => ({ c, other: where(c.from === seg.id ? c.to : c.from) }))
      .filter((x) => x.other?.e.position)
      .map((x) => ({ ...x, d: Math.hypot(...sub(x.other!.e.position!, tip)), far: Math.hypot(...sub(x.other!.e.position!, path.path[end === 0 ? 1 : 0])) }))
      .filter((x) => x.d <= x.far)
      .sort((a, b) => a.d - b.d)
    return near[0] ?? null
  }

  // 끝 가까이면 그 끝의 이음쇠를 다시 쓴다.
  const nearEnd: 0 | 1 | null = t * len < BRANCH_REUSE ? 0 : (1 - t) * len < BRANCH_REUSE ? 1 : null
  if (nearEnd !== null) {
    const n = neighborAt(nearEnd)
    const fit = n?.other?.e
    if (!fit || fit.role !== 'fitting')
      return { refused: `그 자리는 ${seg.name}의 끝입니다. 끝에 분기점으로 쓸 이음쇠가 없습니다 — 끝에서 ${BRANCH_REUSE * 100}cm 넘게 떨어진 자리를 고르세요.` }
    if ((fit.flowType && fit.flowType !== flow.code) || (fit.systemId ?? null) !== (seg.systemId ?? null))
      return { refused: `끝의 ${fit.name}은(는) Flow Type·계통이 달라 분기점으로 쓰지 않습니다. 끝에서 떨어진 자리를 고르세요.` }
    const drawn = drawPipe(model, { ...spec, from: fit.id })
    if ('refused' in drawn) return drawn
    drawn.storeyOf.set(fit.id, n!.other!.storey.id)
    return { ...drawn, tee: fit, reused: true, tail: null, replaced: null }
  }

  // 새 분기점. 먼저 분기를 그려 보고(거절되면 분기점만 걷는다) 그 뒤 구간을 나눈다.
  const T = mm(foot)
  const home = storeyAtZ(model, T[2]) ?? main.storey
  if (spec.range && !spec.range.includes(home.id)) return { refused: `분기 자리의 층(${home.name})이 보기 범위 밖입니다. 보기 범위를 넓힌 뒤 완료합니다.` }
  const air = flow.medium === 'air'
  const system = seg.systemId ? model.systems.find((s) => s.id === seg.systemId) : undefined
  const named = model.storeys.flatMap((s) => s.equipment).filter((e) => e.flowType === flow.code).length
  const tee = addEquipment(model, home.id, {
    name: `${flow.code} 분기 ${named + 1}`,
    kind: null,
    position: T,
    conduit: { role: 'fitting', ifcClass: air ? 'DuctFitting' : 'PipeFitting', flowType: flow.code },
  })!
  tee.systemId = seg.systemId ?? null
  if (system) system.memberIds.push(tee.id)
  const drawn = drawPipe(model, { ...spec, from: tee.id })
  if ('refused' in drawn) {
    home.equipment.splice(home.equipment.indexOf(tee), 1)
    if (system) system.memberIds.splice(system.memberIds.indexOf(tee.id), 1)
    return drawn
  }

  // 나누기: 끝 1 쪽을 떼어 새 구간으로.
  const back = neighborAt(1)
  const tip = path.path[1]
  applyFollow(model, { rigid: [], stretch: [{ id: seg.id, end: 1 }], held: [], blocked: [] }, sub(T, tip), axisOf)
  const mid: Vec3 = [(T[0] + tip[0]) / 2, (T[1] + tip[1]) / 2, (T[2] + tip[2]) / 2]
  const tailHome = storeyAtZ(model, Math.min(T[2], tip[2])) ?? main.storey
  const tail = addEquipment(model, tailHome.id, {
    name: `${flow.code} ${air ? '덕트' : '배관'} ${model.storeys.flatMap((s) => s.equipment).filter((e) => e.flowType === flow.code).length + 1}`,
    kind: null,
    position: mid,
    conduit: { role: 'segment', ifcClass: air ? 'DuctSegment' : 'PipeSegment', axis: [sub(T, mid), sub(tip, mid)], flowType: flow.code },
  })!
  tail.systemId = seg.systemId ?? null
  if (system) system.memberIds.push(tail.id)
  let replaced: BranchResult['replaced'] = null
  if (back) {
    if (back.c.source === 'port') {
      const done = releaseConnection(model, back.c, `분기점 넣기: ${seg.name}${josa(seg.name, '을/를')} ${tee.name}에서 나눔`)
      if ('refused' in done) return done
      replaced = { connection: back.c, released: true }
    } else {
      model.connections.splice(model.connections.indexOf(back.c), 1)
      replaced = { connection: back.c, released: false }
    }
  }
  const link = (from: string, to: string): Connection => {
    const c: Connection = { from, to, source: 'manual', directed: false, tolerance: null }
    model.connections.push(c)
    return c
  }
  const connections = [link(seg.id, tee.id), link(tee.id, tail.id), ...(back ? [link(tail.id, back.other!.e.id)] : []), ...drawn.connections]
  drawn.storeyOf.set(tee.id, home.id)
  drawn.storeyOf.set(tail.id, tailHome.id)
  return { ...drawn, connections, rules: inferFlowByRules(model), tee, reused: false, tail, replaced }
}
