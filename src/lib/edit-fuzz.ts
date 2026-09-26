// 편집을 무작위로 섞어 해 보고, 편집 파일과 되돌리기가 화면과 같은 결과를 내는지 본다. 테스트만 쓴다.
//
// 편집 하나하나는 단위 테스트가 보지만, 틀린 것은 늘 **편집 둘이 만나는 곳**에서 나왔다. 계통을 확정한 뒤 종류를
// 바꾸면 불러온 파일에서 확정한 방향이 뒤집혔고, BIM 소속 설비를 옮겼다 돌려놓으면 편집 파일에서 빠졌다. 어느
// 순서가 문제인지 미리 알 수 없어서 순서를 무작위로 만든다. 씨앗(seed)이 같으면 같은 편집을 한다.

import * as E from './edit'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import { confirmSystemFlow } from './flow-rules'
import { EQUIPMENT_KINDS } from './kinds'
import { isConduit, type Model, type Vec2 } from './model'

export const FUZZ_OPS = ['move', 'moveBack', 'storey', 'rename', 'vertex', 'insert', 'delete', 'kind', 'confirm', 'flow', 'add', 'remove'] as const
export type FuzzOp = (typeof FUZZ_OPS)[number]

/**
 * 내보내는 두 파일. 설비가 층 목록 안에서 선 **순서**만 빼고 견준다 — 다른 층에 갔다 온 설비는 목록 끝으로 가서
 * 파일 안의 순서가 바뀌지만 담긴 것은 같다.
 */
export function exportedContent(m: Model): string {
  const ttl = modelToTTL(m).split('\n\n').sort().join('\n\n')
  const geo = modelToGeoJSON(m).map((f) => ({
    fileName: f.fileName,
    features: [...f.collection.features].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }))
  return `${ttl}\n#GEO\n${JSON.stringify(geo)}`
}

export type FuzzResult = {
  /** 한 편집을 한 줄로. 틀렸을 때 무엇을 했는지 보인다. */
  log: string[]
  /** 편집 파일로 저장해 새로 연 모델에 얹은 결과가 편집한 모델과 같은가. */
  reloadSame: boolean
  /** 편집 파일에서 못 찾은 것의 수. 같은 모델에 얹으므로 0 이어야 한다. */
  missing: number
  /** 전부 되돌리면 연 때와 **순서까지** 같은가. */
  undoSame: boolean
}

/** `pristine` 은 건드리지 않는다. 사본에 편집하고, 편집 파일은 또 다른 사본에 얹는다. */
export function fuzzEdits(pristine: Model, seed: number, steps = 30, skip: ReadonlySet<FuzzOp> = new Set()): FuzzResult {
  let state = seed
  const r = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)]
  const ops = FUZZ_OPS.filter((o) => !skip.has(o))

  const m = structuredClone(pristine)
  const base = E.baselineOf(m)
  const undo: E.Snapshot[] = []
  const log: string[] = []
  for (let step = 0; step < steps; step++) {
    const op = pick(ops)!
    const devices = m.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
    const rooms = m.storeys.flatMap((s) => s.spaces).filter((x) => x.footprint.length >= 4)
    const room = pick(rooms)
    if (op === 'move' || op === 'moveBack') {
      const e = pick(devices.filter((x) => x.position))
      if (!e) continue
      const p = e.position!
      undo.push(E.snapshotEquipment(m, e.id)!)
      E.moveEquipment(m, e.id, [p[0] + 0.5, p[1] - 0.3, p[2]])
      if (op === 'moveBack') {
        undo.push(E.snapshotEquipment(m, e.id)!)
        E.moveEquipment(m, e.id, [p[0], p[1], p[2]])
      }
      log.push(`${op} ${e.name}`)
    } else if (op === 'storey') {
      const e = pick(devices)
      const home = m.storeys.find((s) => s.equipment.includes(e!))
      const to = pick(m.storeys.filter((s) => s !== home))
      if (!e || !to) continue
      undo.push(E.snapshotEquipment(m, e.id)!)
      E.moveEquipmentToStorey(m, e.id, to.id)
      log.push(`storey ${e.name} → ${to.name}`)
    } else if (op === 'rename' && room) {
      undo.push(E.snapshotSpace(m, room.id)!)
      E.renameSpace(m, room.id, `${room.longName}*`)
      log.push(`rename ${room.name}`)
    } else if ((op === 'vertex' || op === 'insert' || op === 'delete') && room) {
      const snapshot = E.snapshotSpace(m, room.id)!
      const i = Math.floor(r() * E.openRing(room.footprint).length)
      const done =
        op === 'vertex'
          ? E.moveSpaceVertex(m, room.id, i, [room.footprint[i][0] + 0.25, room.footprint[i][1] + 0.25] as Vec2)
          : op === 'insert'
            ? E.insertSpaceVertex(m, room.id, i)
            : E.deleteSpaceVertex(m, room.id, i)
      if (!done) continue
      undo.push(snapshot)
      log.push(`${op} ${room.name}#${i}`)
    } else if (op === 'kind') {
      const e = pick(devices)
      if (!e) continue
      const key = r() < 0.5 ? E.familyKeyOf(e) : E.typeKeyOf(e)
      const kind = r() < 0.2 ? null : pick(EQUIPMENT_KINDS)!.kind
      const snapshot = E.snapshotType(m, key)
      if (!E.setTypeKind(m, key, kind)) continue
      undo.push(snapshot)
      log.push(`kind ${key} → ${kind}`)
    } else if (op === 'confirm') {
      const c = pick(m.connections.filter((x) => x.inferred && !x.inferred.confirmed))
      if (!c) continue
      const systemId = c.inferred!.systemId
      undo.push(E.snapshotConfirm(m, systemId))
      confirmSystemFlow(m, systemId)
      log.push(`confirm ${systemId}`)
    } else if (op === 'flow') {
      const c = pick(m.connections.filter((x) => !x.directed))
      if (!c) continue
      undo.push(E.snapshotFlow(c))
      E.setFlowDirection(c, r() < 0.2 ? null : r() < 0.5 ? c.from : c.to)
      log.push('flow')
    } else if (op === 'add') {
      const a = pick(devices)
      const b = pick(devices)
      if (!a || !b) continue
      const done = E.addConnection(m, a.id, b.id)
      if (!done) continue
      undo.push({ kind: 'connection', connection: done.connection, present: false, index: m.connections.length - 1 })
      log.push(`add ${a.name} – ${b.name}`)
    } else if (op === 'remove') {
      const c = pick(m.connections.filter((x) => x.source !== 'port'))
      if (!c) continue
      const snapshot = E.snapshotConnection(m, c)
      if (!E.removeConnection(m, c)) continue
      undo.push(snapshot)
      log.push('remove')
    }
  }

  const session = exportedContent(m)
  const parsed = parseEditFile(JSON.stringify(exportEdits(m, base, 'fuzz')))
  if (typeof parsed === 'string') throw new Error(parsed)
  const fresh = structuredClone(pristine)
  const applied = applyEdits(fresh, parsed)
  const reloadSame = exportedContent(fresh) === session

  const opened = modelToTTL(pristine) + JSON.stringify(modelToGeoJSON(pristine))
  for (const s of undo.reverse()) E.restore(m, s)
  const undoSame = modelToTTL(m) + JSON.stringify(modelToGeoJSON(m)) === opened

  return { log, reloadSame, missing: Object.values(applied.missing).reduce((a, b) => a + b, 0), undoSame }
}
