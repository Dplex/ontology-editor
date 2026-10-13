// 사람이 그리는 배관(OE-PIP-11, ADR-0031). 시작 설비에서 끝 대상(설비·다른 배관)까지 꼭짓점을 차례로 찍으면, 변마다 구간 하나와
// 꺾인 자리마다 이음쇠 하나를 더하고 사이를 `manual` 연결로 잇는다. BIM 배관과 같은 모양(구간·이음쇠 사슬, ADR-0029)이라 꼭짓점
// 옮기기·끝점 추종·경로(LineString)가 그대로 된다.
//
// - Flow Type 은 범례(flow-type.ts)에 있는 값만 받는다(OE-OBJ-12).
// - 방향은 정하지 않는다(`directed: false`). 규칙 방향은 확정 전까지 화면에만 보이고 TTL `feeds` 에 나가지 않는다(OE-PIP-04·05).
// - 계통은 고른 것에 넣는다. 고르지 않았으면 양 끝이 같은 계통일 때만 그 계통이고, 서로 다른 계통을 합치지 않는다.
// - 층 편집 화면에서는 한 층 안에서만 그린다. 다른 층과 잇는 배관(라이저·오프셋)은 다중층 뷰에서 보기 범위(`range`)를 주고 그린다
//   (OE-PIP-15·OE-ML-12·14, ADR-0035). 꺾임점의 높이는 층 상대 높이로 줄 수 있고 공통 z 로 바꿔 쓴다(OE-ML-18, storey-z.ts).

import { addEquipment } from './edit'
import { inferFlowByRules, type RuleReport } from './flow-rules'
import { flowType } from './flow-type'
import { MIN_SEGMENT_LENGTH, type Connection, type Equipment, type Model, type Storey, type Vec3 } from './model'
import { storeyAtZ, storeyElevationProblem, toCommon, type PathPoint } from './storey-z'

export type PipeSpec = {
  /** 시작 설비(또는 배관) id. */
  from: string
  /** 끝 설비(또는 배관) id. */
  to: string
  /** 사이에 찍은 꼭짓점. 공통 좌표(`Vec3`)이거나 층 상대 높이(`StoreyPoint`). 없으면 두 설비를 곧게 잇는다. */
  via?: readonly PathPoint[]
  flowType: string
  /** 넣을 계통. undefined 면 양 끝이 같은 계통일 때만 그 계통, null 이면 계통 없음. */
  systemId?: string | null
  /**
   * 다중층 뷰의 보기 범위(층 id). 주면 다른 층의 끝과 잇는 층간 배관을 그린다. 끝 대상과 경로가 모두 이 범위 안이어야 하고, 층 바닥을
   * 지나는 변은 수직이어야 한다(x·y 가 같다). 구간은 아래 끝이 든 층에 둔다.
   */
  range?: readonly string[]
}

export type PipeResult = {
  segments: Equipment[]
  fittings: Equipment[]
  connections: Connection[]
  length: number
  rules: RuleReport
  /** 만든 구간·이음쇠가 든 층(id → 층 id). 층간 배관은 층마다 다르다. */
  storeyOf: Map<string, string>
}

/** 층을 지나는 변이 수직인지 볼 때 x·y 의 허용 차이(m). 찍은 점은 cm 로 맞춰지므로 1cm. */
const PLUMB = 0.01

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
  if (!spec.range && a.storey.id !== b.storey.id) return { refused: '다른 층의 설비와 잇는 배관은 다중층 뷰에서 그립니다(OE-PIP-15).' }
  const via: Vec3[] = []
  for (const p of spec.via ?? []) {
    const c = toCommon(model, p)
    if ('refused' in c) return c
    via.push(c)
  }
  const points: Vec3[] = [a.e.position, ...via, b.e.position].map((p) => [p[0], p[1], p[2]])
  if (!points.every((p) => p.every(Number.isFinite))) return { refused: '좌표 수치가 유효하지 않습니다.' }
  for (let i = 0; i + 1 < points.length; i++)
    if (dist(points[i], points[i + 1]) < MIN_SEGMENT_LENGTH) return { refused: `${i + 1}번째 구간의 길이가 0 입니다. 같은 자리를 두 번 찍지 마세요.` }
  // 층간 배관은 보기 범위·층 높이를 확인하고 변마다 층을 정한다. 층 편집 화면의 배관은 전부 시작 설비의 층이다.
  const pieces = spec.range
    ? placeByStorey(model, spec.range, a, b, points)
    : points.slice(0, -1).map((p, i): Piece => ({ ends: [p, points[i + 1]], storey: a.storey, bend: i + 2 < points.length }))
  if ('refused' in pieces) return pieces

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
  const storeyOf = new Map<string, string>()
  const chain: string[] = [a.e.id]
  let n = drawn
  for (const piece of pieces) {
    const [p, q] = piece.ends
    const mid: Vec3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
    const seg = addEquipment(model, piece.storey.id, {
      name: `${flow.code} ${air ? '덕트' : '배관'} ${++n}`,
      kind: null,
      position: mid,
      conduit: { role: 'segment', ifcClass: air ? 'DuctSegment' : 'PipeSegment', axis: [sub(p, mid), sub(q, mid)], flowType: flow.code },
    })!
    segments.push(seg)
    storeyOf.set(seg.id, piece.storey.id)
    chain.push(seg.id)
    if (piece.bend) {
      // 꺾인 자리의 이음쇠는 그 높이가 든 층에 둔다.
      const home = spec.range ? (storeyAtZ(model, q[2]) ?? piece.storey) : piece.storey
      const fit = addEquipment(model, home.id, {
        name: `${flow.code} 이음 ${++n}`,
        kind: null,
        position: q,
        conduit: { role: 'fitting', ifcClass: air ? 'DuctFitting' : 'PipeFitting', flowType: flow.code },
      })!
      fittings.push(fit)
      storeyOf.set(fit.id, home.id)
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
  return { segments, fittings, connections, length, rules: inferFlowByRules(model), storeyOf }
}

type Piece = { ends: [Vec3, Vec3]; storey: Storey; bend: boolean }

/**
 * 층간 배관의 변마다 둘 층을 정한다(ADR-0035). BIM 처럼 층 바닥에서 자르지 않는다 — 수직 구간 하나가 여러 층을 지나도 구간 하나이고,
 * 아래 끝이 든 층의 구간이다. 꺾임점의 이음쇠는 그 높이가 든 층이다. 보기 범위 밖의 끝·점, 높이를 모르는 층, 층 바닥을 비스듬히 지나는
 * 변은 거절한다.
 */
function placeByStorey(
  model: Model,
  range: readonly string[],
  a: { storey: Storey; e: Equipment },
  b: { storey: Storey; e: Equipment },
  points: Vec3[],
): Piece[] | { refused: string } {
  const inRange = model.storeys.filter((s) => range.includes(s.id))
  if (!inRange.length) return { refused: '보기 범위가 비었습니다.' }
  for (const s of [...inRange, a.storey, b.storey]) {
    const problem = storeyElevationProblem(model, s)
    if (problem) return { refused: problem }
  }
  for (const end of [a, b])
    if (!range.includes(end.storey.id)) return { refused: `${end.e.name}의 층(${end.storey.name})이 보기 범위 밖입니다. 보기 범위를 넓힌 뒤 완료합니다.` }
  const sorted = model.storeys.filter((s) => Number.isFinite(s.elevation)).sort((x, y) => x.elevation - y.elevation)
  const lowest = inRange.reduce((m, s) => (s.elevation < m.elevation ? s : m))
  const highest = inRange.reduce((m, s) => (s.elevation > m.elevation ? s : m))
  const ceiling = sorted[sorted.indexOf(highest) + 1]?.elevation ?? Infinity
  for (const [i, p] of points.entries()) {
    if (p[2] < lowest.elevation - 0.001 || p[2] >= ceiling) {
      const what = i === 0 ? '시작 대상' : i === points.length - 1 ? '끝 대상' : `${i}번째 꺾임점`
      return { refused: `${what}의 높이(${p[2].toFixed(2)}m)가 보기 범위(${lowest.name} ~ ${highest.name}) 밖입니다. 보기 범위를 넓힌 뒤 완료합니다.` }
    }
  }
  const floors = inRange.map((s) => s.elevation)
  const pieces: Piece[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]]
    const [lo, hi] = p[2] < q[2] ? [p[2], q[2]] : [q[2], p[2]]
    const crosses = floors.some((f) => f > lo + 0.001 && f < hi - 0.001)
    if (crosses && Math.hypot(p[0] - q[0], p[1] - q[1]) > PLUMB)
      return { refused: `${i + 1}번째 구간이 층 바닥을 비스듬히 지납니다. 층을 지나는 구간은 수직(x·y 같음)으로 찍고, 옆으로 옮기는 것은 수평 구간(오프셋)으로 찍습니다.` }
    pieces.push({ ends: [p, q], storey: storeyAtZ(model, lo) ?? lowest, bend: i + 2 < points.length })
  }
  return pieces
}
