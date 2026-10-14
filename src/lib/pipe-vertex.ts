// 배관 꼭짓점 넣기·지우기(OE-PIP-10). 배관의 꼭짓점은 구간 사이의 꺾임 이음쇠(엘보)다(옮기기는 끝점 추종 follow, ADR-0049 와 같다).
//
// - 넣기: 구간 하나를 고른 자리에서 둘로 나누고 그 자리에 엘보를 둔다. 분기 그리기(branch-pipe.ts)의 나누기와 같다 — 앞 구간은 그 끝을 엘보까지
//   줄이고(applyFollow), 뒤쪽은 새 구간이다. 뒤 끝 대상과의 옛 연결이 BIM 포트 연결이면 지우지 않고 해제 보정한다(OE-PIP-06).
// - 지우기: 구간 둘 사이의 엘보를 지우고 두 구간을 하나로 합친다. 앞 구간의 엘보 쪽 끝을 뒤 구간의 먼 끝까지 늘이고, 뒤 구간을 지운 뒤 앞 구간을
//   뒤 구간이 이어져 있던 대상과 잇는다. 갈래가 셋 이상인 분기점, 한쪽이 설비이거나 비어 있는 끝 이음쇠는 지우지 않는다.
// - **중간점 편집만으로 확정 방향이 바뀌지 않는다(AC2).** 나누거나 합쳐 새로 생기는 연결은 사람이 이은 것(manual)이지만, 옛 연결이 확정
//   방향(BIM 포트·사람이 정한 방향·확정한 규칙)이었으면 같은 쪽으로 방향을 이어받는다(`edited`, 편집 파일의 flows 로 남는다).
// - 새 엘보·구간은 원래 구간의 Flow Type 을 그린 배관 값(`flowType`)으로 갖는다. 그래야 편집 파일이 새 조각으로 다시 만든다. Flow Type 을 정하지
//   못한 BIM 구간(계통 종류·유체 모름, flow-type.ts)은 넣지 않고 Flow Type 을 먼저 고르게 한다.
// - 되돌리기는 결과의 `undo` 하나로 한 번에 돌아온다(화면이 그대로 쌓는다).

import { addEquipment, applyFollow, deleteEquipment, snapshotEquipment, snapshotEquipmentSet, type SegmentAxis, type Snapshot } from './edit'
import { inferFlowByRules, withInferred, type RuleReport } from './flow-rules'
import { conduitFlowType } from './flow-type'
import { releaseConnection, snapshotRelease } from './connection-release'
import { josa } from './josa'
import { segmentPath, type Connection, type Equipment, type Model, type Storey, type Vec3 } from './model'
import { storeyAtZ } from './storey-z'
import { BRANCH_REUSE, BRANCH_SNAP, restAxis } from './branch-pipe'

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mm = (p: Vec3): Vec3 => p.map((v) => Math.round(v * 1000) / 1000) as unknown as Vec3
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...sub(a, b))

function where(model: Model, id: string): { storey: Storey; e: Equipment } | null {
  for (const storey of model.storeys) {
    const e = storey.equipment.find((x) => x.id === id)
    if (e) return { storey, e }
  }
  return null
}

/** 확정 방향(포트·사람·확정 규칙)으로 본 연결의 위(from)·아래(to). 방향을 모르면 null. */
function settled(c: Connection): { from: string; to: string } | null {
  const [d] = withInferred([c], true)
  return d.directed ? { from: d.from, to: d.to } : null
}

/** 사람이 이은 연결. `flow` 가 있으면 그 쪽으로 방향을 이어받는다(사람이 정한 방향처럼 남는다). */
function link(model: Model, a: string, b: string, flow: { from: string; to: string } | null, why: string): Connection {
  const c: Connection = { from: a, to: b, source: 'manual', directed: false, tolerance: null }
  if (flow) c.edited = { from: flow.from, to: flow.to, reason: why }
  model.connections.push(c)
  return c
}

/** 사슬 a → b(구간을 따라 같은 쪽)로 옛 방향을 옮긴다. 옛 연결이 `upstream` 에서 나가는 쪽이었으면 a 가 위다. */
function along(old: { from: string; to: string } | null, upstreamSide: string, a: string, b: string): { from: string; to: string } | null {
  if (!old) return null
  return old.from === upstreamSide ? { from: a, to: b } : { from: b, to: a }
}

export type VertexInsert = { elbow: Equipment; tail: Equipment; replaced: { connection: Connection; released: boolean } | null; rules: RuleReport; undo: Snapshot }

/**
 * 구간 `segmentId` 의 `at`(세계 좌표) 자리에 꼭짓점(엘보)을 넣어 구간을 둘로 나눈다. 구간 선에서 0.3m 안이면 선 위로 내리고, 끝에서 5cm 안이면
 * 거기는 이미 꼭짓점이라 막는다.
 */
export function insertPipeVertex(model: Model, segmentId: string, at: Vec3, axisOf: (id: string) => SegmentAxis | null = restAxis(model)): VertexInsert | { refused: string } {
  const main = where(model, segmentId)
  if (!main || main.e.role !== 'segment') return { refused: '꼭짓점은 덕트·배관 구간에 넣습니다. 구간을 고르세요.' }
  const seg = main.e
  const path = segmentPath(seg)
  if (!path || !('path' in path) || !axisOf(seg.id)) return { refused: '형상(중심선)이 없는 구간에는 꼭짓점을 넣지 않습니다.' }
  const flow = conduitFlowType(seg, (id) => model.systems.find((s) => s.id === id))
  if (!flow) return { refused: `${seg.name}은(는) Flow Type 을 정하지 못한 구간이라 꼭짓점을 넣지 않습니다. 패널에서 Flow Type 을 먼저 고르세요.` }

  const [p, q] = path.path
  const d = sub(q, p)
  const len2 = dot(d, d)
  const t = Math.max(0, Math.min(1, dot(sub(at, p), d) / len2))
  const foot: Vec3 = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t]
  const off = dist(at, foot)
  if (off > BRANCH_SNAP) return { refused: `그 자리가 ${seg.name} 위에 있지 않습니다(${off.toFixed(2)}m 떨어짐). 구간 위를 찍습니다.` }
  const len = Math.sqrt(len2)
  if (t * len < BRANCH_REUSE || (1 - t) * len < BRANCH_REUSE) return { refused: `그 자리는 ${seg.name}의 끝이라 이미 꼭짓점입니다. 끝에서 ${BRANCH_REUSE * 100}cm 넘게 떨어진 자리를 고르세요.` }

  // 뒤 끝(끝 1)에 이어진 것. 해제 보정한 연결은 이어진 것이 아니다.
  const tip = path.path[1]
  const back =
    model.connections
      .filter((c) => c.from === seg.id || c.to === seg.id)
      .map((c) => ({ c, other: where(model, c.from === seg.id ? c.to : c.from) }))
      .filter((x) => x.other?.e.position)
      .map((x) => ({ ...x, near: dist(x.other!.e.position!, tip), far: dist(x.other!.e.position!, p) }))
      .filter((x) => x.near <= x.far)
      .sort((a, b) => a.near - b.near)[0] ?? null

  const before: Snapshot[] = [snapshotEquipment(model, seg.id)!, ...model.connections.filter((c) => c.from === seg.id || c.to === seg.id).map((c) => snapshotRelease(model, c))]
  const air = /^Duct/.test(seg.ifcClass)
  const T = mm(foot)
  const home = storeyAtZ(model, T[2]) ?? main.storey
  const system = seg.systemId ? model.systems.find((s) => s.id === seg.systemId) : undefined
  const count = () => model.storeys.flatMap((s) => s.equipment).filter((e) => e.flowType === flow.code).length + 1
  const elbow = addEquipment(model, home.id, { name: `${flow.code} 이음 ${count()}`, kind: null, position: T, conduit: { role: 'fitting', ifcClass: air ? 'DuctFitting' : 'PipeFitting', flowType: flow.code } })!
  applyFollow(model, { rigid: [], stretch: [{ id: seg.id, end: 1 }], held: [], blocked: [] }, sub(T, tip), axisOf)
  const mid: Vec3 = [(T[0] + tip[0]) / 2, (T[1] + tip[1]) / 2, (T[2] + tip[2]) / 2]
  const tailHome = storeyAtZ(model, Math.min(T[2], tip[2])) ?? main.storey
  const tail = addEquipment(model, tailHome.id, {
    name: `${flow.code} ${air ? '덕트' : '배관'} ${count()}`,
    kind: null,
    position: mid,
    conduit: { role: 'segment', ifcClass: air ? 'DuctSegment' : 'PipeSegment', axis: [sub(T, mid), sub(tip, mid)], flowType: flow.code },
  })!
  for (const e of [elbow, tail]) {
    e.systemId = seg.systemId ?? null
    if (system) system.memberIds.push(e.id)
  }

  // 옛 뒤 연결(구간 → 대상)의 확정 방향을 사슬 구간 → 엘보 → 새 구간 → 대상 으로 잇는다.
  const why = `꼭짓점 넣기: ${seg.name}${josa(seg.name, '을/를')} ${elbow.name}에서 나눔`
  const old = back ? settled(back.c) : null
  let replaced: VertexInsert['replaced'] = null
  if (back) {
    if (back.c.source === 'port') {
      const done = releaseConnection(model, back.c, why)
      if ('refused' in done) return done
      replaced = { connection: back.c, released: true }
    } else {
      model.connections.splice(model.connections.indexOf(back.c), 1)
      replaced = { connection: back.c, released: false }
    }
  }
  link(model, seg.id, elbow.id, along(old, seg.id, seg.id, elbow.id), why)
  link(model, elbow.id, tail.id, along(old, seg.id, elbow.id, tail.id), why)
  if (back) link(model, tail.id, back.other!.e.id, along(old, seg.id, tail.id, back.other!.e.id), why)
  const made = (e: Equipment, storeyId: string): Snapshot => ({ kind: 'equipment-set', equipment: e, storeyId, index: 0, present: false, connections: [], systems: [] })
  return { elbow, tail, replaced, rules: inferFlowByRules(model), undo: { kind: 'many', parts: [made(elbow, home.id), made(tail, tailHome.id), ...before] } }
}

export type VertexRemove = { kept: Equipment; removed: [Equipment, Equipment]; linked: Connection | null; rules: RuleReport; undo: Snapshot }

/** 구간 둘 사이의 꼭짓점(엘보) `fittingId` 를 지우고 두 구간을 하나로 합친다. */
export function removePipeVertex(model: Model, fittingId: string, axisOf: (id: string) => SegmentAxis | null = restAxis(model)): VertexRemove | { refused: string } {
  const at = where(model, fittingId)
  if (!at || at.e.role !== 'fitting' || !at.e.position) return { refused: '꼭짓점은 덕트·배관 구간 사이의 이음쇠입니다. 이음쇠를 고르세요.' }
  const elbow = at.e
  const links = model.connections.filter((c) => c.from === elbow.id || c.to === elbow.id)
  if (links.length > 2) return { refused: `${elbow.name}은(는) 갈래가 ${links.length}개인 분기점이라 꼭짓점으로 지우지 않습니다.` }
  const sides = links.map((c) => where(model, c.from === elbow.id ? c.to : c.from)?.e ?? null)
  if (links.length < 2 || sides.some((s) => !s || s.role !== 'segment'))
    return { refused: `${elbow.name}은(는) 양쪽이 모두 덕트·배관 구간인 꺾임점이 아닙니다(설비에 붙었거나 끝이 비어 있음). 끝점은 지우지 않습니다.` }
  const [a, b] = sides as [Equipment, Equipment]
  const systemOf = (id: string) => model.systems.find((s) => s.id === id)
  if (conduitFlowType(a, systemOf)?.code !== conduitFlowType(b, systemOf)?.code || (a.systemId ?? null) !== (b.systemId ?? null))
    return { refused: `${a.name}과(와) ${b.name}의 Flow Type·계통이 달라 하나로 합치지 않습니다.` }
  const pa = segmentPath(a)
  const pb = segmentPath(b)
  if (!pa || !('path' in pa) || !pb || !('path' in pb) || !axisOf(a.id)) return { refused: '형상(중심선)이 없는 구간은 합치지 않습니다.' }

  // 앞 구간 a 의 엘보 쪽 끝을, 뒤 구간 b 의 엘보에서 먼 끝까지 늘인다.
  const knee = elbow.position!
  const nearA: 0 | 1 = dist(pa.path[0], knee) <= dist(pa.path[1], knee) ? 0 : 1
  const farB = dist(pb.path[0], knee) >= dist(pb.path[1], knee) ? pb.path[0] : pb.path[1]
  // b 가 엘보 말고 이어진 대상(먼 끝). 방향은 엘보–b 사이의 확정 방향을 따른다.
  const outer = model.connections.find((c) => (c.from === b.id || c.to === b.id) && c.from !== elbow.id && c.to !== elbow.id) ?? null
  const x = outer ? (outer.from === b.id ? outer.to : outer.from) : null
  // 사슬 a — 엘보 — b — x 의 확정 방향. 세 연결 중 방향을 아는 것 하나로 "a 쪽에서 x 쪽으로 흐르는가" 를 정한다.
  const towardX = (() => {
    const viaA = settled(links[sides.indexOf(a)])
    if (viaA) return viaA.from === a.id
    const viaB = settled(links[sides.indexOf(b)])
    if (viaB) return viaB.from === elbow.id
    const viaX = outer ? settled(outer) : null
    if (viaX) return viaX.from === b.id
    return null
  })()

  const before: Snapshot[] = [snapshotEquipment(model, a.id)!, snapshotEquipmentSet(model, elbow.id)!, snapshotEquipmentSet(model, b.id)!]
  applyFollow(model, { rigid: [], stretch: [{ id: a.id, end: nearA }], held: [], blocked: [] }, sub(farB, pa.path[nearA]), axisOf)
  deleteEquipment(model, elbow.id)
  deleteEquipment(model, b.id)
  const why = `꼭짓점 지우기: ${elbow.name}${josa(elbow.name, '을/를')} 지워 ${a.name}·${b.name}${josa(b.name, '을/를')} 합침`
  const linked = x ? link(model, a.id, x, towardX === null ? null : towardX ? { from: a.id, to: x } : { from: x, to: a.id }, why) : null
  const undo: Snapshot = {
    kind: 'many',
    parts: [...before, ...(linked ? [{ kind: 'connection' as const, connection: linked, present: false, index: model.connections.length - 1 }] : [])],
  }
  return { kept: a, removed: [elbow, b], linked, rules: inferFlowByRules(model), undo }
}
