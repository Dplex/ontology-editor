// 편집을 무작위로 섞어 해 보고, 편집 파일과 되돌리기가 화면과 같은 결과를 내는지 본다. 테스트만 쓴다.
//
// 편집 하나하나는 단위 테스트가 보지만, 틀린 것은 늘 **편집 둘이 만나는 곳**에서 나왔다. 계통을 확정한 뒤 종류를
// 바꾸면 불러온 파일에서 확정한 방향이 뒤집혔고, BIM 소속 설비를 옮겼다 돌려놓으면 편집 파일에서 빠졌다. 어느
// 순서가 문제인지 미리 알 수 없어서 순서를 무작위로 만든다. 씨앗(seed)이 같으면 같은 편집을 한다.

import * as E from './edit'
import * as CZ from './custom-zone'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToGeoJSON } from './export/geojson'
import { modelToTTL } from './export/ttl'
import { confirmSystemFlow } from './flow-rules'
import { EQUIPMENT_KINDS, FLUIDS, SYSTEM_KINDS } from './kinds'
import { isConduit, type Model, type Vec2 } from './model'

export const FUZZ_OPS = [
  'move',
  'moveBack',
  'storey',
  'rename',
  'vertex',
  'insert',
  'delete',
  'kind',
  'confirm',
  'flow',
  'add',
  'remove',
  'addEquipment',
  'deleteEquipment',
  'renameEquipment',
  'createSpace',
  'deleteSpace',
  'splitSpace',
  'mergeSpaces',
  'addWall',
  'moveWall',
  'deleteWall',
  'wallBearing',
  'addOpening',
  'moveOpening',
  'deleteOpening',
  'resizeOpening',
  'equipmentSystem',
  'systemKind',
  'createSystem',
  'deleteSystem',
  'moveWallWithSpaces',
  'moveFollow',
  'wallSize',
  'wallExternal',
  'mountOnWall',
  'customZone',
] as const
export type FuzzOp = (typeof FUZZ_OPS)[number]

/**
 * 내보내는 두 파일. 설비가 층 목록 안에서 선 **순서**만 빼고 견준다 — 다른 층에 갔다 온 설비는 목록 끝으로 가서
 * 파일 안의 순서가 바뀌지만 담긴 것은 같다. 계통 구성원의 순서도 같다 — 다른 계통에 갔다 온 설비는 구성원 끝에 선다.
 */
export function exportedContent(m: Model): string {
  const sorted = { ...m, systems: m.systems.map((s) => ({ ...s, memberIds: [...s.memberIds].sort() })) }
  // 빈 줄 여럿도 한 칸으로 본다. 순서가 바뀐 블록 옆의 빈 줄 하나가 자리를 바꿔 다르게 보였다(담긴 것은 같다).
  const ttl = modelToTTL(sorted).split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).sort().join('\n\n')
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
  /** 불러온 것이 다를 때 갈린 줄과 편집 파일 앞부분. */
  detail?: string
  /** 불러온 것이 다를 때 두 내보내기 전체(견줄 때 쓴다). */
  texts?: { session: string; reloaded: string }
}

/** `pristine` 은 건드리지 않는다. 사본에 편집하고, 편집 파일은 또 다른 사본에 얹는다. */
export function fuzzEdits(pristine: Model, seed: number, steps = 30, skip: ReadonlySet<FuzzOp> = new Set()): FuzzResult {
  let state = seed
  const r = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
  const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(r() * xs.length)]
  const ops = FUZZ_OPS.filter((o) => !skip.has(o))

  const m = structuredClone(pristine)
  const base = E.baselineOf(m)
  const openedAt = new Map(pristine.storeys.flatMap((st) => st.equipment).map((e) => [e.id, e.position]))
  const axisOf = (id: string): E.SegmentAxis | null => {
    const p = openedAt.get(id)
    return p ? [[p[0] - 1, p[1], p[2]], [p[0] + 1, p[1], p[2]]] : null
  }
  const undo: E.Snapshot[] = []
  let detail = ''
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
    } else if (op === 'moveFollow') {
      // 붙은 배관을 데리고 옮긴다. 형상이 없는 입력이라 구간 축은 연 때 좌표 양옆 1m 로 둔다(같은 씨앗이면 같은 축).
      const e = pick(devices.filter((x) => x.position))
      if (!e) continue
      const p = e.position!
      const plan = E.planFollow(m, e.id, axisOf)
      const ids = [e.id, ...plan.rigid, ...new Set(plan.stretch.map((x) => x.id))]
      undo.push({ kind: 'many', parts: ids.map((id) => E.snapshotEquipment(m, id)!) })
      E.moveEquipment(m, e.id, [p[0] + 0.4, p[1] + 0.2, p[2]])
      E.applyFollow(m, plan, [0.4, 0.2, 0], axisOf)
      log.push(`moveFollow ${e.name} (+${ids.length - 1})`)
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
    } else if (op === 'addEquipment') {
      const storey = pick(m.storeys)!
      const near = pick(storey.spaces.filter((x) => x.footprint.length >= 4))
      const at = near ? near.footprint[0] : ([0, 0] as Vec2)
      const kind = r() < 0.3 ? null : pick(EQUIPMENT_KINDS)!.kind
      // id 를 씨앗에서 짓는다. 같은 씨앗은 같은 편집을 해야 틀린 것을 다시 볼 수 있다.
      const done = E.addEquipment(m, storey.id, {
        id: `U_fuzz${seed}_${step}`,
        name: `새 설비 ${step}`,
        kind,
        position: r() < 0.2 ? null : [at[0] + 0.5, at[1] + 0.5, storey.elevation + 2.5],
      })
      if (!done) continue
      undo.push(E.snapshotEquipmentSet(m, done.id)!)
      ;(undo.at(-1) as Extract<E.Snapshot, { kind: 'equipment-set' }>).present = false
      log.push(`addEquipment ${done.name} (${kind})`)
    } else if (op === 'deleteEquipment') {
      const e = pick(m.storeys.flatMap((s) => s.equipment))
      if (!e) continue
      const snapshot = E.snapshotEquipmentSet(m, e.id)!
      if (!E.deleteEquipment(m, e.id)) continue
      undo.push(snapshot)
      log.push(`deleteEquipment ${e.name}`)
    } else if (op === 'renameEquipment') {
      const e = pick(devices)
      if (!e) continue
      const snapshot = E.snapshotEquipment(m, e.id)!
      if (!E.renameEquipment(m, e.id, `${e.name}*`)) continue
      undo.push(snapshot)
      log.push(`renameEquipment ${e.name}`)
    } else if (op === 'createSpace') {
      // 있는 방 오른쪽에 변을 맞대어 만든다. 그래야 합치기가 붙을 자리가 생긴다.
      const storey = pick(m.storeys)!
      const next = pick(storey.spaces.filter((x) => x.footprint.length >= 4))
      const xs = next ? next.footprint.map((p) => p[0]) : [0]
      const ys = next ? next.footprint.map((p) => p[1]) : [0]
      const x0 = Math.max(...xs) + (r() < 0.5 ? 0 : 0.2)
      const y0 = Math.min(...ys)
      const w = 1 + Math.floor(r() * 4)
      const snapshot = E.snapshotStoreySpaces(m, storey.id)!
      const done = E.createSpace(m, storey.id, { id: `U_fuzz${seed}_${step}`, name: `N${step}`, longName: `새 방 ${step}`, footprint: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + 3], [x0, y0 + 3]] })
      if (!done) continue
      undo.push(snapshot)
      log.push(`createSpace ${step} @${x0}`)
    } else if (op === 'deleteSpace' && room) {
      const home = m.storeys.find((s) => s.spaces.includes(room))!
      const snapshot = E.snapshotStoreySpaces(m, home.id)!
      const done = E.deleteSpace(m, room.id)
      if (!done || 'refused' in done) continue
      undo.push(snapshot)
      log.push(`deleteSpace ${room.name}`)
    } else if (op === 'splitSpace' && room) {
      const home = m.storeys.find((s) => s.spaces.includes(room))!
      const xs = room.footprint.map((p) => p[0])
      const cut = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * (0.2 + 0.6 * r())
      const snapshot = E.snapshotStoreySpaces(m, home.id)!
      const done = E.splitSpace(m, room.id, [cut, -1000], [cut + (r() < 0.5 ? 0 : 1), 1000], `U_fuzz${seed}_${step}`)
      if (!done || 'refused' in done) continue
      undo.push(snapshot)
      log.push(`splitSpace ${room.name} @${cut.toFixed(2)}`)
    } else if (op === 'mergeSpaces' && room) {
      const home = m.storeys.find((s) => s.spaces.includes(room))!
      const other = pick(home.spaces.filter((x) => x !== room && x.footprint.length >= 4))
      if (!other) continue
      const snapshot = E.snapshotStoreySpaces(m, home.id)!
      const done = E.mergeSpaces(m, room.id, other.id)
      if (!done || 'refused' in done) continue
      undo.push(snapshot)
      log.push(`mergeSpaces ${room.name} + ${other.name}`)
    } else if (op === 'addWall') {
      // 방의 변 하나를 따라 바깥쪽에 벽을 긋는다. 문을 붙일 자리가 생긴다.
      const storey = pick(m.storeys)!
      const next = pick(storey.spaces.filter((x) => x.footprint.length >= 4))
      if (!next) continue
      const i = Math.floor(r() * (next.footprint.length - 1))
      const a = next.footprint[i]
      const b = next.footprint[i + 1]
      const snapshot = E.snapshotStoreyElements(m, storey.id)!
      const wall = E.addWall(m, storey.id, a, b, 0.2, `U_fuzz${seed}_${step}`)
      if (!wall || 'refused' in wall) continue
      undo.push(snapshot)
      log.push(`addWall ${next.name}#${i}`)
    } else if (op === 'moveWall' || op === 'deleteWall' || op === 'wallBearing') {
      const storey = pick(m.storeys.filter((s) => s.walls.length))
      const wall = storey && pick(storey.walls)
      if (!storey || !wall) continue
      const snapshot = E.snapshotStoreyElements(m, storey.id)!
      const done =
        op === 'moveWall'
          ? E.moveWall(m, wall.id, [r() < 0.5 ? 0.3 : 0, r() < 0.5 ? -0.2 : 0.1])
          : op === 'deleteWall'
            ? !!E.deleteWall(m, wall.id)
            : E.setWallLoadBearing(m, wall.id, r() < 0.3 ? null : r() < 0.5)
      if (!done) continue
      undo.push(snapshot)
      log.push(`${op} ${wall.name}`)
    } else if (op === 'addOpening') {
      const storey = pick(m.storeys.filter((s) => s.walls.some((w) => w.footprint?.length)))
      const wall = storey && pick(storey.walls.filter((w) => w.footprint?.length))
      if (!storey || !wall) continue
      const ring = wall.footprint![0]
      const at: Vec2 = [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2]
      const snapshot = E.snapshotStoreyElements(m, storey.id)!
      const done = E.addOpening(m, storey.id, r() < 0.7 ? 'door' : 'window', at, `U_fuzz${seed}_${step}`)
      if (!done || 'refused' in done) continue
      undo.push(snapshot)
      log.push(`addOpening ${done.kind} on ${wall.name}`)
    } else if (op === 'resizeOpening') {
      const storey = pick(m.storeys.filter((s) => s.openings.length))
      const o = storey && pick(storey.openings)
      if (!storey || !o) continue
      const snapshot = E.snapshotStoreyElements(m, storey.id)!
      const done = E.setOpeningSize(m, o.id, r() < 0.5 ? { width: 0.6 + Math.round(r() * 10) / 10 } : { height: 1 + Math.round(r() * 10) / 10 })
      if (done !== true) continue
      undo.push(snapshot)
      log.push(`resizeOpening ${o.name}`)
    } else if (op === 'moveOpening' || op === 'deleteOpening') {
      const storey = pick(m.storeys.filter((s) => s.openings.length))
      const o = storey && pick(op === 'moveOpening' ? storey.openings.filter((x) => x.position) : storey.openings)
      if (!storey || !o) continue
      const snapshot = E.snapshotStoreyElements(m, storey.id)!
      const done = op === 'moveOpening' ? E.moveOpening(m, o.id, [o.position![0] + 0.3, o.position![1] - 0.2]) : E.deleteOpening(m, o.id)
      if (!done) continue
      undo.push(snapshot)
      log.push(`${op} ${o.name}`)
    } else if (op === 'equipmentSystem') {
      const e = pick(m.storeys.flatMap((s) => s.equipment))
      if (!e) continue
      const to = r() < 0.2 ? null : (pick(m.systems)?.id ?? null)
      const snapshot = E.snapshotSystems(m, [e.systemId, to], [e.id])
      if (!E.setEquipmentSystem(m, e.id, to)) continue
      undo.push(snapshot)
      log.push(`equipmentSystem ${e.name} → ${to}`)
    } else if (op === 'systemKind') {
      const system = pick(m.systems)
      if (!system) continue
      const kind = r() < 0.2 ? null : pick(SYSTEM_KINDS)!.kind
      const fluid = r() < 0.3 ? null : pick(FLUIDS)!.fluid
      const snapshot = E.snapshotSystems(m, [system.id])
      if (!E.setSystemKind(m, system.id, kind, fluid)) continue
      undo.push(snapshot)
      log.push(`systemKind ${system.name} → ${kind}/${fluid}`)
    } else if (op === 'createSystem') {
      // 만들고 설비 하나를 바로 넣는다(화면의 [만들어 넣기] 와 같다).
      const e = pick(devices)
      if (!e) continue
      const kind = r() < 0.3 ? null : pick(SYSTEM_KINDS)!.kind
      const snapshot = E.snapshotSystems(m, [e.systemId], [e.id], true)
      const system = E.createSystem(m, { id: `U_fuzz${seed}_${step}`, name: `새 계통 ${step}`, kind })
      if (!system) continue
      E.setEquipmentSystem(m, e.id, system.id)
      undo.push(snapshot)
      log.push(`createSystem ${system.name} ← ${e.name}`)
    } else if (op === 'wallSize' || op === 'wallExternal') {
      // 외벽 여부·두께·높이(OE-OBJ-04). 두께는 꼭짓점 넷인 벽만 바뀐다.
      const storey = pick(m.storeys.filter((s) => s.walls.length))
      const wall = storey && pick(storey.walls)
      if (!storey || !wall) continue
      const snapshot = E.snapshotStoreyElements(m, storey.id)!
      const done =
        op === 'wallExternal'
          ? E.setWallExternal(m, wall.id, r() < 0.3 ? null : r() < 0.5)
          : r() < 0.5
            ? E.setWallThickness(m, wall.id, 0.1 + Math.round(r() * 3) / 10)
            : E.setWallHeight(m, wall.id, r() < 0.2 ? null : 2 + Math.round(r() * 20) / 10)
      if (done !== true) continue
      undo.push(snapshot)
      log.push(`${op} ${wall.name}`)
    } else if (op === 'mountOnWall') {
      // 설비를 벽 면에 붙인다. 뒤에 벽을 옮기거나 지우면 따라가거나 떨어진다.
      const storey = pick(m.storeys.filter((s) => s.equipment.length && s.walls.some((w) => w.footprint?.length)))
      const wall = storey && pick(storey.walls.filter((w) => w.footprint?.length))
      const e = storey && pick(storey.equipment.filter((x) => !x.added || x.position))
      if (!storey || !wall || !e) continue
      const ring = wall.footprint![0]
      const at: Vec2 = [ring[0][0] + (r() - 0.5) * 0.4, ring[0][1] + (r() - 0.5) * 0.4]
      const snapshot = E.snapshotEquipment(m, e.id)!
      const done = E.mountOnWall(m, e.id, at)
      if (!done || 'refused' in done) continue
      undo.push(snapshot)
      log.push(`mountOnWall ${e.name} → ${wall.name}`)
    } else if (op === 'customZone') {
      // 커스텀존(OE-OBJ-01) 만들기·이름·지우기·나누기·합치기. 방 하나의 범위 안팎에 사각형을 그린다 — 겹쳐도 된다.
      const storey = pick(m.storeys.filter((s) => s.spaces.some((x) => x.footprint.length >= 4)))
      if (!storey) continue
      const zones = storey.customZones ?? []
      const snapshot = E.snapshotCustomZones(m, storey.id)!
      const what = zones.length === 0 ? 0 : Math.floor(r() * 5)
      let done = false
      if (what === 0) {
        const room = pick(storey.spaces.filter((x) => x.footprint.length >= 4))!
        const xs = room.footprint.map((p) => p[0])
        const ys = room.footprint.map((p) => p[1])
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
        const t = (a: number, b: number) => a + (b - a) * (0.1 + 0.8 * r())
        const [ax, bx] = [t(x0 - 1, x1), t(x0, x1 + 1)].sort((a, b) => a - b)
        const [ay, by] = [t(y0 - 1, y1), t(y0, y1 + 1)].sort((a, b) => a - b)
        const made = CZ.createCustomZone(m, storey.id, { id: `U_fuzz${seed}_${step}`, footprint: [[ax, ay], [bx, ay], [bx, by], [ax, by]] })
        done = !!made && !('refused' in made)
      } else {
        const zone = pick(zones)!
        if (what === 1) done = CZ.renameCustomZone(m, zone.id, `존 ${seed}-${step}`)
        else if (what === 2) done = CZ.deleteCustomZone(m, zone.id)
        else if (what === 3) {
          const xs = zone.footprint.map((p) => p[0])
          const ys = zone.footprint.map((p) => p[1])
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2
          const piece = CZ.splitCustomZone(m, zone.id, [cx, cy - 100], [cx, cy + 100], `U_fuzz${seed}_${step}`)
          done = !!piece && !('refused' in piece)
        } else {
          const other = pick(zones.filter((z) => z.id !== zone.id))
          const merged = other ? CZ.mergeCustomZones(m, zone.id, other.id) : null
          done = !!merged && !('refused' in merged)
        }
      }
      if (!done) continue
      undo.push(snapshot)
      log.push(`customZone#${what}`)
    } else if (op === 'moveWallWithSpaces') {
      // 방향키로 벽을 몇 걸음 옮기는 것과 같다. 걸음마다 되돌리기 한 칸이고, 계획은 이어 쓴다.
      const storey = pick(m.storeys.filter((s) => s.walls.some((w) => w.footprint?.length)))
      const wall = storey && pick(storey.walls.filter((w) => w.footprint?.length))
      if (!storey || !wall) continue
      let plan: E.WallCarryPlan | null = null
      const steps = 1 + Math.floor(r() * 3)
      const d: Vec2 = r() < 0.5 ? [0.1, 0] : [0, -0.1]
      for (let k = 0; k < steps; k++) {
        const parts = [E.snapshotStoreyElements(m, storey.id)!, E.snapshotStoreySpaces(m, storey.id)!]
        const done = E.moveWallWithSpaces(m, wall.id, d, plan)
        if (!done) break
        plan = done.plan
        undo.push({ kind: 'many', parts })
      }
      log.push(`moveWallWithSpaces ${wall.name} ×${steps}`)
    } else if (op === 'deleteSystem') {
      const system = pick(m.systems)
      if (!system) continue
      const members = m.storeys.flatMap((s) => s.equipment).filter((e) => e.systemId === system.id).map((e) => e.id)
      const snapshot = E.snapshotSystems(m, [system.id], members, true)
      if (!E.deleteSystem(m, system.id)) continue
      undo.push(snapshot)
      log.push(`deleteSystem ${system.name}`)
    }
  }

  const session = exportedContent(m)
  const text = JSON.stringify(exportEdits(m, base, 'fuzz'))
  const parsed = parseEditFile(text)
  if (typeof parsed === 'string') throw new Error(parsed)
  const fresh = structuredClone(pristine)
  const applied = applyEdits(fresh, parsed)
  const reloaded = exportedContent(fresh)
  const reloadSame = reloaded === session
  if (!reloadSame) {
    // 어디서 갈렸는지 첫 몇 줄만. 씨앗 하나를 다시 돌려 볼 때 이것부터 본다.
    const a = session.split(/\n|(?<=\},)/)
    const b = new Set(reloaded.split(/\n|(?<=\},)/))
    const as = new Set(a)
    detail = [
      ...a.filter((x) => !b.has(x)).slice(0, 4).map((x) => `- ${x.slice(0, 300)}`),
      ...[...b].filter((x) => !as.has(x)).slice(0, 4).map((x) => `+ ${x.slice(0, 300)}`),
      `file ${text.slice(0, 1500)}`,
    ].join('\n')
  }

  const opened = modelToTTL(pristine) + JSON.stringify(modelToGeoJSON(pristine))
  for (const s of undo.reverse()) E.restore(m, s)
  const undoSame = modelToTTL(m) + JSON.stringify(modelToGeoJSON(m)) === opened

  return {
    log,
    reloadSame,
    missing: Object.values(applied.missing).reduce((a, b) => a + b, 0),
    undoSame,
    ...(detail ? { detail, texts: { session, reloaded } } : {}),
  }
}
