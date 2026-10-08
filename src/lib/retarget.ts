// 덕트·배관 구간 끝의 연결 대상 바꾸기(OE-PIP-10 "끝점을 이동할 때는 … 새 연결 대상을 명시적으로 선택한다", OE-PIP-01·06).
//
// 구간의 한 끝이 이어진 대상(설비·배관)을 다른 대상으로 바꾼다. 형상과 연결을 함께 고친다.
// - 연결: 기존 연결이 BIM 포트 연결이면 지우지 않고 해제 보정한다(원본·방향 보존, 사유는 "끝 대상 바꾸기"). 사람이 이었거나 형상으로
//   이은 연결은 지운다. 새 대상과는 `manual` 연결이고 방향은 정하지 않는다.
// - 형상: 그 끝을 새 대상의 배치점으로 늘인다(끝점 추종과 같은 `applyFollow`). 형상이 없는 구간은 연결만 바꾼다.
// 이음쇠는 대상이 아니다 — 이음쇠에 붙은 구간을 골라 그 끝을 바꾼다.

import { applyFollow, connectionBetween, type SegmentAxis } from './edit'
import { inferFlowByRules, type RuleReport } from './flow-rules'
import { releaseConnection, releasedBetween } from './connection-release'
import { segmentPath, type Connection, type Model, type Vec3 } from './model'

export type Retarget = { removed: Connection; released: boolean; added: Connection; stretched: boolean; rules: RuleReport }

export function retargetEnd(
  model: Model,
  segmentId: string,
  fromId: string,
  toId: string,
  axisOf: (id: string) => SegmentAxis | null,
): Retarget | { refused: string } {
  const where = (id: string) => {
    for (const storey of model.storeys) {
      const e = storey.equipment.find((x) => x.id === id)
      if (e) return { storey, e }
    }
    return null
  }
  const seg = where(segmentId)
  const from = where(fromId)
  const to = where(toId)
  if (!seg || !from || !to) return { refused: '구간이나 대상을 찾지 못했습니다.' }
  if (seg.e.role !== 'segment') return { refused: '끝 대상은 구간에서 바꿉니다. 이음쇠에 붙은 구간을 고르세요.' }
  const old = connectionBetween(model, segmentId, fromId)
  if (!old) return { refused: `${from.e.name}에 이어진 끝이 아닙니다.` }
  if (toId === segmentId || toId === fromId) return { refused: '지금 대상과 다른 것을 고르세요.' }
  if (connectionBetween(model, segmentId, toId)) return { refused: `${to.e.name}에는 이미 이어져 있습니다.` }
  if (releasedBetween(model, segmentId, toId)) return { refused: `${to.e.name}과의 BIM 연결은 해제 보정한 것입니다. 해제 보정 취소로 되살립니다.` }
  if (!to.e.position) return { refused: '좌표가 없는 대상에는 잇지 않습니다. 먼저 위치를 넣으세요.' }
  if (to.storey.id !== seg.storey.id) return { refused: '다른 층의 대상과 잇는 것은 다중층 뷰에서 합니다(OE-PIP-15).' }

  // 형상: 바꾸는 끝(옛 대상에 가까운 끝)을 새 대상 자리로 늘인다.
  let stretched = false
  const path = segmentPath(seg.e)
  const axis = axisOf(segmentId)
  if (path && 'path' in path && axis && from.e.position) {
    const p = from.e.position
    const d = (q: Vec3) => (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2
    const end: 0 | 1 = d(path.path[0]) <= d(path.path[1]) ? 0 : 1
    const t = to.e.position
    const delta: Vec3 = [t[0] - path.path[end][0], t[1] - path.path[end][1], t[2] - path.path[end][2]]
    applyFollow(model, { rigid: [], stretch: [{ id: segmentId, end }], held: [], blocked: [] }, delta, axisOf)
    stretched = true
  }

  // 연결: 옛 연결을 해제 보정하거나 지우고, 새 대상과 잇는다.
  let released = false
  if (old.source === 'port') {
    const done = releaseConnection(model, old, `끝 대상 바꾸기: ${from.e.name} → ${to.e.name}`)
    if ('refused' in done) return done
    released = true
  } else model.connections.splice(model.connections.indexOf(old), 1)
  const added: Connection = { from: segmentId, to: toId, source: 'manual', directed: false, tolerance: null }
  model.connections.push(added)
  return { removed: old, released, added, stretched, rules: inferFlowByRules(model) }
}
