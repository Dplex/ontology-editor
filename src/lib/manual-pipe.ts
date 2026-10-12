// 사람이 그리는 배관(OE-PIP-11, ADR-0031). 시작 설비에서 끝 대상(설비·다른 배관)까지 꼭짓점을 차례로 찍으면, 변마다 구간 하나와
// 꺾인 자리마다 이음쇠 하나를 더하고 사이를 `manual` 연결로 잇는다. BIM 배관과 같은 모양(구간·이음쇠 사슬, ADR-0029)이라 꼭짓점
// 옮기기·끝점 추종·경로(LineString)가 그대로 된다.
//
// - Flow Type 은 범례(flow-type.ts)에 있는 값만 받는다(OE-OBJ-12).
// - 방향은 정하지 않는다(`directed: false`). 규칙 방향은 확정 전까지 화면에만 보이고 TTL `feeds` 에 나가지 않는다(OE-PIP-04·05).
// - 계통은 고른 것에 넣는다. 고르지 않았으면 양 끝이 같은 계통일 때만 그 계통이고, 서로 다른 계통을 합치지 않는다.
// - 한 층 안에서만 그린다. 다른 층과 잇는 배관은 다중층 뷰(OE-PIP-15)의 일이다.

import { addEquipment } from './edit'
import { inferFlowByRules, type RuleReport } from './flow-rules'
import { flowType } from './flow-type'
import { MIN_SEGMENT_LENGTH, type Connection, type Equipment, type Model, type Vec3 } from './model'

export type PipeSpec = {
  /** 시작 설비(또는 배관) id. */
  from: string
  /** 끝 설비(또는 배관) id. */
  to: string
  /** 사이에 찍은 꼭짓점(세계 좌표). 없으면 두 설비를 곧게 잇는다. */
  via?: readonly Vec3[]
  flowType: string
  /** 넣을 계통. undefined 면 양 끝이 같은 계통일 때만 그 계통, null 이면 계통 없음. */
  systemId?: string | null
}

export type PipeResult = { segments: Equipment[]; fittings: Equipment[]; connections: Connection[]; length: number; rules: RuleReport }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export function drawPipe(model: Model, spec: PipeSpec): PipeResult | { refused: string } {
  const flow = flowType(spec.flowType)
  if (!flow) return { refused: `범례에 없는 Flow Type(${spec.flowType})으로는 배관을 그리지 않습니다.` }
  const where = (id: string) => {
    for (const storey of model.storeys) {
      const e = storey.equipment.find((x) => x.id === id)
      if (e) return { storey, e }
    }
    return null
  }
  const a = where(spec.from)
  const b = where(spec.to)
  if (!a || !b) return { refused: '시작이나 끝 대상을 찾지 못했습니다.' }
  if (a.e.id === b.e.id) return { refused: '시작과 끝이 같습니다. 다른 설비나 배관을 끝으로 고르세요.' }
  if (!a.e.position || !b.e.position) return { refused: '좌표가 없는 설비와는 배관을 잇지 않습니다. 먼저 위치를 넣으세요.' }
  if (a.storey.id !== b.storey.id) return { refused: '다른 층의 설비와 잇는 배관은 다중층 뷰에서 그립니다(OE-PIP-15).' }
  const points: Vec3[] = [a.e.position, ...(spec.via ?? []), b.e.position].map((p) => [p[0], p[1], p[2]])
  if (!points.every((p) => p.every(Number.isFinite))) return { refused: '좌표 수치가 유효하지 않습니다.' }
  for (let i = 0; i + 1 < points.length; i++)
    if (dist(points[i], points[i + 1]) < MIN_SEGMENT_LENGTH) return { refused: `${i + 1}번째 구간의 길이가 0 입니다. 같은 자리를 두 번 찍지 마세요.` }

  let systemId: string | null = null
  if (spec.systemId) {
    if (!model.systems.some((s) => s.id === spec.systemId)) return { refused: '고른 계통이 없습니다.' }
    systemId = spec.systemId
  } else if (spec.systemId === undefined && a.e.systemId && a.e.systemId === b.e.systemId) systemId = a.e.systemId

  // 이름: Flow Type 과 그 Flow Type 으로 그린 순번. 구간·이음쇠를 함께 센다.
  const drawn = model.storeys.flatMap((s) => s.equipment).filter((e) => e.flowType === flow.code).length
  const air = flow.medium === 'air'
  const segments: Equipment[] = []
  const fittings: Equipment[] = []
  const chain: string[] = [a.e.id]
  let n = drawn
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]]
    const mid: Vec3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
    const seg = addEquipment(model, a.storey.id, {
      name: `${flow.code} ${air ? '덕트' : '배관'} ${++n}`,
      kind: null,
      position: mid,
      conduit: { role: 'segment', ifcClass: air ? 'DuctSegment' : 'PipeSegment', axis: [sub(p, mid), sub(q, mid)], flowType: flow.code },
    })!
    segments.push(seg)
    chain.push(seg.id)
    if (i + 2 < points.length) {
      const fit = addEquipment(model, a.storey.id, {
        name: `${flow.code} 이음 ${++n}`,
        kind: null,
        position: q,
        conduit: { role: 'fitting', ifcClass: air ? 'DuctFitting' : 'PipeFitting', flowType: flow.code },
      })!
      fittings.push(fit)
      chain.push(fit.id)
    }
  }
  chain.push(b.e.id)
  const connections: Connection[] = []
  for (let i = 0; i + 1 < chain.length; i++) {
    const c: Connection = { from: chain[i], to: chain[i + 1], source: 'manual', directed: false, tolerance: null }
    model.connections.push(c)
    connections.push(c)
  }
  if (systemId) {
    const system = model.systems.find((s) => s.id === systemId)!
    // 사슬 순서(구간·이음쇠·구간…)로 넣는다. 편집 파일을 불러올 때 층의 설비 순서로 다시 넣으므로 순서가 같아야 TTL 이 같다.
    const byId = new Map([...segments, ...fittings].map((e) => [e.id, e]))
    for (const id of chain.slice(1, -1)) {
      byId.get(id)!.systemId = systemId
      system.memberIds.push(id)
    }
  }
  let length = 0
  for (let i = 0; i + 1 < points.length; i++) length += dist(points[i], points[i + 1])
  return { segments, fittings, connections, length, rules: inferFlowByRules(model) }
}
