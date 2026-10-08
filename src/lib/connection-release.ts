// BIM 포트 연결의 '연결 해제 보정'과 '해제 보정 취소'(OE-PIP-01·06, K13).
//
// 포트가 말한 연결은 지우지 않는다 — BIM 원본이고, 지우면 현장이 바뀐 것인지 BIM 이 틀린 것인지 기록 없이 사라진다. 대신
// 운영 중 철거한 배관이나 BIM 오류를 온톨로지에서 빼야 할 때 **해제 보정**한다. 연결 객체를 `model.connections` 에서
// `model.releasedConnections` 로 옮기므로 연결을 읽는 곳(규칙 방향·일치율·계통 추적·TTL `brick:feeds`·검사)이 따로 거르지 않고
// 해제한 연결을 보지 않는다. 객체를 고치지 않고 옮기기만 하니 취소하면 원본 방향 그대로 돌아온다.
//
// 해제·취소에는 시각과 사유를 남긴다(`connectionLog`). 수행자는 아직 남기지 않는다 — 로그인(OE-COM-01)이 없어 누구인지 알 수 없다.
//
// 편집 파일에는 해제한 연결을 두 끝 id 와 방향으로 적는다. 다시 연 판본(BIM 재임포트)에서 같은 연결을 찾으면 다시 해제하고,
// 방향이 바뀌었거나 못 찾으면 재검토로 둔다. 재검토 중인 연결은 사람이 보기 전에는 유효 연결로 돌리지 않는다.

import { inferFlowByRules, type RuleReport } from './flow-rules'
import type { Connection, ConnectionLogEntry, Model, ReleasedConnection } from './model'

/** 되돌리기 스냅숏(edit.ts 의 Snapshot). 연결 하나가 유효·해제·없음 중 어디에 있었는지와 그때의 이력. */
export type ReleaseSnapshot = {
  kind: 'release'
  connection: Connection
  state: { where: 'active'; index: number } | { where: 'released'; entry: ReleasedConnection; slot: number } | { where: 'absent' }
  log: ConnectionLogEntry[]
}

/** 편집 파일의 해제 한 줄. 방향은 해제한 연결(또는 재검토로 받은 새 판본 연결)의 것이다. */
export type ReleaseRow = {
  from: string
  to: string
  directed: boolean
  at: string
  reason: string
  review?: ReleasedConnection['review']
}

const touches = (c: Connection, a: string, b: string) => (c.from === a && c.to === b) || (c.from === b && c.to === a)

export function releasedEntry(model: Model, connection: Connection): ReleasedConnection | undefined {
  return model.releasedConnections?.find((r) => r.connection === connection)
}

/** 두 설비 사이에 원본이 있는 해제 보정이 있는가. 있으면 같은 두 설비를 손으로 다시 잇지 않고 [해제 취소] 로 되살린다. */
export function releasedBetween(model: Model, a: string, b: string): ReleasedConnection | undefined {
  return model.releasedConnections?.find((r) => r.review !== 'missing' && touches(r.connection, a, b))
}

/** 한 설비에 붙은 해제 보정. 패널이 직접 연결 아래에 비활성으로 보인다. */
export function releasesOf(model: Model, id: string): ReleasedConnection[] {
  return (model.releasedConnections ?? []).filter((r) => r.connection.from === id || r.connection.to === id)
}

function log(model: Model, action: ConnectionLogEntry['action'], c: Connection, reason: string, now: Date) {
  model.connectionLog = [...(model.connectionLog ?? []), { action, from: c.from, to: c.to, at: now.toISOString(), reason }]
}

function dropEntry(model: Model, entry: ReleasedConnection) {
  const rest = (model.releasedConnections ?? []).filter((r) => r !== entry)
  if (rest.length) model.releasedConnections = rest
  else delete model.releasedConnections
}

/** BIM 포트 연결을 해제 보정한다. 사유가 없거나 포트 연결이 아니면 거절 이유. */
export function releaseConnection(model: Model, connection: Connection, reason: string, now = new Date()): RuleReport | { refused: string } {
  const why = reason.trim()
  if (connection.source !== 'port') return { refused: '해제 보정은 BIM 포트 연결에만 합니다. 사람이 이은 연결은 [연결 끊기]로 지웁니다' }
  const index = model.connections.indexOf(connection)
  if (index < 0) return { refused: '이미 해제한 연결입니다' }
  if (!why) return { refused: '사유를 적어 주세요. 보정 이력에 남습니다' }
  model.connections.splice(index, 1)
  model.releasedConnections = [...(model.releasedConnections ?? []), { connection, index, at: now.toISOString(), reason: why }]
  log(model, 'release', connection, why, now)
  return inferFlowByRules(model)
}

/** 해제 보정을 취소해 원본 연결을 해제 전 자리로 돌린다. 새 판본에서 원본을 못 찾은 보정은 되살릴 연결이 없어 거절한다. */
export function cancelRelease(model: Model, connection: Connection, reason: string, now = new Date()): RuleReport | { refused: string } {
  const entry = releasedEntry(model, connection)
  const why = reason.trim()
  if (!entry) return { refused: '해제한 연결이 아닙니다' }
  if (entry.review === 'missing') return { refused: '이 판본에는 원본 연결이 없어 되살릴 수 없습니다. [보정 지우기]로 정리합니다' }
  if (!why) return { refused: '사유를 적어 주세요. 보정 이력에 남습니다' }
  dropEntry(model, entry)
  model.connections.splice(Math.min(entry.index, model.connections.length), 0, connection)
  log(model, 'restore', connection, why, now)
  return inferFlowByRules(model)
}

/** 방향이 바뀐 재검토를 보고 해제를 유지한다. 재검토 표시만 지운다(연결은 그대로 빠져 있다). */
export function keepRelease(model: Model, connection: Connection, now = new Date()): boolean {
  const entry = releasedEntry(model, connection)
  if (entry?.review !== 'direction') return false
  delete entry.review
  log(model, 'keep', connection, '', now)
  return true
}

/** 원본을 못 찾은 보정을 지운다. 이력은 남는다. */
export function dropRelease(model: Model, connection: Connection, now = new Date()): boolean {
  const entry = releasedEntry(model, connection)
  if (entry?.review !== 'missing') return false
  dropEntry(model, entry)
  log(model, 'drop', connection, '', now)
  return true
}

export function snapshotRelease(model: Model, connection: Connection): ReleaseSnapshot {
  const log = [...(model.connectionLog ?? [])]
  const index = model.connections.indexOf(connection)
  if (index >= 0) return { kind: 'release', connection, state: { where: 'active', index }, log }
  const entry = releasedEntry(model, connection)
  if (entry) return { kind: 'release', connection, state: { where: 'released', entry: { ...entry }, slot: model.releasedConnections!.indexOf(entry) }, log }
  return { kind: 'release', connection, state: { where: 'absent' }, log }
}

export function restoreRelease(model: Model, s: ReleaseSnapshot): RuleReport {
  const at = model.connections.indexOf(s.connection)
  if (at >= 0) model.connections.splice(at, 1)
  const entry = releasedEntry(model, s.connection)
  if (entry) dropEntry(model, entry)
  if (s.state.where === 'active') model.connections.splice(Math.min(s.state.index, model.connections.length), 0, s.connection)
  if (s.state.where === 'released') {
    const list = [...(model.releasedConnections ?? [])]
    list.splice(Math.min(s.state.slot, list.length), 0, { ...s.state.entry })
    model.releasedConnections = list
  }
  if (s.log.length) model.connectionLog = [...s.log]
  else delete model.connectionLog
  return inferFlowByRules(model)
}

/**
 * 편집 파일에 적을 해제 보정과 이력. 지운 설비에 붙어 있던 보정은 적지 않는다 — 설비와 같이 빠진 연결이라 불러오면 찾을 수 없다.
 * 원본을 못 찾은 보정(`missing`)은 사람이 지우기 전까지 그대로 적는다.
 */
export function exportReleases(model: Model): { rows: ReleaseRow[]; log: ConnectionLogEntry[] } {
  const ids = new Set(model.storeys.flatMap((s) => s.equipment.map((e) => e.id)))
  const rows = (model.releasedConnections ?? [])
    .filter((r) => r.review === 'missing' || (ids.has(r.connection.from) && ids.has(r.connection.to)))
    .map((r) => ({
      from: r.connection.from,
      to: r.connection.to,
      directed: r.connection.directed,
      at: r.at,
      reason: r.reason,
      ...(r.review ? { review: r.review } : {}),
    }))
  return { rows, log: [...(model.connectionLog ?? [])] }
}

/**
 * 편집 파일의 해제 보정을 모델에 얹는다. 같은 두 설비 사이 포트 연결을 찾아 해제하고, 방향이 다르면 그 연결을 해제한 채
 * 재검토(`direction`)로, 못 찾으면 파일에 적힌 연결로 재검토(`missing`)를 만든다. 어느 쪽이든 유효 연결로 돌리지 않는다 —
 * 사람이 확인하기 전에 TTL `brick:feeds` 로 나가면 해제한 사람의 판단을 판본이 말없이 뒤집는다.
 */
export function applyReleases(
  model: Model,
  rows: readonly ReleaseRow[],
  entries: readonly ConnectionLogEntry[],
  resolve: (id: string) => string,
): { released: number; review: number; rules: RuleReport | null } {
  let released = 0
  let review = 0
  for (const row of rows) {
    const from = resolve(row.from)
    const to = resolve(row.to)
    const ports = model.connections.filter((c) => c.source === 'port' && touches(c, from, to))
    const same = ports.find((c) => c.directed === row.directed && (!c.directed || (c.from === from && c.to === to)))
    const found = same ?? ports[0]
    const reviewOf: ReleasedConnection['review'] = !found ? 'missing' : same ? (row.review === 'direction' ? 'direction' : undefined) : 'direction'
    if (reviewOf) review++
    else released++
    const connection: Connection = found ?? { from, to, source: 'port', directed: row.directed, tolerance: null }
    const index = found ? model.connections.indexOf(found) : model.connections.length
    if (found) model.connections.splice(index, 1)
    model.releasedConnections = [
      ...(model.releasedConnections ?? []),
      { connection, index, at: row.at, reason: row.reason, ...(reviewOf ? { review: reviewOf } : {}) },
    ]
  }
  if (entries.length) {
    model.connectionLog = [...(model.connectionLog ?? []), ...entries.map((e) => ({ ...e, from: resolve(e.from), to: resolve(e.to) }))]
  }
  return { released, review, rules: rows.length ? inferFlowByRules(model) : null }
}
