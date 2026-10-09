// [임시 — 리플레이 데모] 정식 기능이 아니다. 리플레이를 보여 주려고 지금만 넣었고 나중에 뺀다. 뺄 때 지울 곳:
//   - 이 파일, lib/replay-demo-check.ts, lib/replay-demo.test.ts
//   - components/ReplayDemoMenu.vue
//   - App.vue 에서 "[임시 — 리플레이 데모]" 로 찾는 세 곳: import 두 줄, "여기부터 … 여기까지" 블록, 상단 바의 <ReplayDemoMenu>
//   - e2e/replay-demo.spec.ts
//   - scripts/replay-demo.sample.test.ts 와 vitest.sample.config.ts 의 include 한 줄
// App.vue 의 placeNewEquipment(새 설비 더하기를 3D 클릭과 같이 쓰게 묶은 것)는 데모가 아니라 남긴다. id 인자만 데모가 쓴다.
//
// 편집 리플레이 데모. 미리 정한 편집 스무 개 남짓을 지금 연 BIM 에 심어 되돌리기 이력을 채운다. 손으로 고치지 않아도 P 로
// 리플레이를 바로 틀 수 있다. 편집 모드의 갈래(공간 · 벽·문·창 · 바닥·벽 설비 · 연결·흐름 · 종류 · 계통 · 천장)를 한 번에 다 거치고,
// 두 층을 오가서 층 전환(단면 자르기·장면 전환)까지 보인다.
//
// **편집은 화면이 한다.** 여기는 무엇을 어디에 할지만 정하고(DemoAction), App.vue 가 사람이 누른 것과 같은 길(relocate·
// changeSpaces·changeElements …)로 한다. 그래서 이력의 한 줄·리포트·3D 가 손으로 한 편집과 같다. 앞 편집이 거절되면(겹침,
// 벽과 엇갈림) 다음 후보로 넘어간다 — 계획은 그 결과를 받으며 한 단계씩 나온다(제너레이터의 next(ok)).
//
// 대상은 BIM 마다 다르니 id 를 박지 않고 모양으로 고른다: 넓은 방부터, 방 안에서 벽과 가장 먼 점(labelPoint)에 놓는다.

import {
  addConnection,
  connectionBetween,
  addEquipment,
  addOpening,
  addWall,
  exteriorOnly,
  moveEquipment,
  moveOpening,
  moveSpaceVertex,
  moveWall,
  newId,
  newWallThickness,
  renameSpace,
  setEquipmentSystem,
  setTypeKind,
  snapshotSystems,
  snapshotType,
  typeKeyOf,
  setWallLoadBearing,
  snapshotCustomZones,
  snapshotEquipment,
  snapshotEquipmentSet,
  snapshotRooms,
  snapshotSpace,
  snapshotStoreyElements,
  snapshotStoreySpaces,
  splitSpace,
  wallAxis,
  wallShapeLock,
  wouldSelfIntersect,
  type BoundaryChange,
  type Snapshot,
  type SpaceSetChange,
} from './edit'
import { createCustomZone } from './custom-zone'
import { applyFlow, snapshotRelease } from './connection-release'

/** 데모가 정한 흐름 방향의 보정 사유. 규칙 방향과 반대여도 막히지 않게 늘 적는다. */
export const DEMO_FLOW_REASON = '리플레이 데모'
import { distanceToRing } from './mapping'
import { isConduit, type Equipment, type Model, type Space, type Storey, type Vec2, type Vec3, type Wall } from './model'
import { labelPoint, openPoints } from './polygon'
import { createRoom } from './room'

/**
 * 화면이 아는 것. 천장 설비는 화면의 판정(ceilingMarks)을 그대로 쓴다 — 바닥·벽 쪽과 천장 쪽이 고칠 수 있는 설비가 갈린다.
 * storeyId 는 지금 보고 있는 층(있으면 그 층이 주 무대다).
 */
export type DemoContext = { storeyId: string | null; ceilingIds: ReadonlySet<string>; ceilingHeight: (storeyId: string) => number | null }

/** 할 편집 하나. App 이 `t` 에 맞는 편집 함수로 한다. 같은 이름의 화면 편집과 이력 이름·되돌리기 단위가 같다. */
export type DemoAction =
  /** ceiling: 천장 설비라 천장 편집 쪽에서 옮긴다(App 이 그동안 천장 모드로 둔다). */
  | { t: 'move'; equipmentId: string; to: Vec3; ceiling?: boolean }
  | { t: 'add'; storeyId: string; id: string; name: string; position: Vec3 }
  | { t: 'connect'; from: string; to: string }
  /** 연결의 흐름 방향을 정한다(from 에서 나간다). 리플레이에서 빛 알갱이가 그 방향으로 흐른다. */
  | { t: 'flow'; a: string; b: string; from: string }
  /** 설비 종류(같은 타입 전부). */
  | { t: 'kind'; equipmentId: string; kind: string }
  /** 설비의 계통. */
  | { t: 'system'; equipmentId: string; systemId: string }
  | { t: 'rename'; spaceId: string; name: string }
  | { t: 'footprint'; spaceId: string; label: string; apply: (m: Model) => BoundaryChange | null }
  | { t: 'spaces'; storeyId: string; label: string; apply: (m: Model) => SpaceSetChange | { refused: string } | null }
  | { t: 'rooms'; storeyId: string; label: string; apply: (m: Model) => unknown }
  | { t: 'zones'; storeyId: string; label: string; apply: (m: Model) => unknown }
  | { t: 'elements'; storeyId: string; label: string; apply: (m: Model) => unknown }

/** 한 단계씩 내고, 그 편집이 됐는지(ok)를 받는다. */
export type DemoScript = Generator<DemoAction, void, boolean>

const cm = (v: number) => Math.round(v * 100) / 100
const xy = (p: readonly number[]): Vec2 => [cm(p[0]), cm(p[1])]

/** 방 안에서 벽과 가장 먼 점과 그 거리. 너무 가는 방은 null. */
function heart(ring: readonly Vec2[]): { p: Vec2; d: number } | null {
  const p = labelPoint(ring)
  if (!p) return null
  const d = distanceToRing(p, ring)
  return d > 0.3 ? { p, d } : null
}

/** 넓은 방부터. 꼭짓점이 셋 이상이고 안쪽 점이 있는 것만. */
function roomsBySize(storey: Storey): { space: Space; p: Vec2; d: number }[] {
  return storey.spaces
    .filter((s) => openPoints(s.footprint).length >= 3)
    .flatMap((space) => {
      const h = heart(space.footprint)
      return h ? [{ space, ...h }] : []
    })
    .sort((a, b) => b.space.areaM2 - a.space.areaM2)
}

/** 외곽선 범위가 긴 쪽이 x 인가. 자르는 선·새 벽은 짧은 쪽으로 낸다. */
function wideInX(ring: readonly Vec2[]): boolean {
  const pts = openPoints(ring)
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  return Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
}

const spaceName = (s: Space) => s.longName || s.name || '물리존'

/** 앞뒤좌우로 조금씩. 겹쳐 거절되면 다른 쪽으로 해 본다. */
const NUDGES: Vec2[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [0.7, 0.7],
]

/** 서로 떨어진 설비를 고른다 — 장면마다 카메라가 다른 자리로 가야 무엇이 바뀌었는지 보인다. */
function spread(list: Equipment[], n: number): Equipment[] {
  const out: Equipment[] = []
  for (const e of list) {
    if (out.length >= n) break
    if (out.every((o) => Math.hypot(o.position![0] - e.position![0], o.position![1] - e.position![1]) > 2)) out.push(e)
  }
  for (const e of list) if (out.length < n && !out.includes(e)) out.push(e)
  return out
}

function* moveSome(devices: Equipment[], n: number, step: number, ceiling = false): DemoScript {
  let done = 0
  for (const e of devices) {
    if (done >= n) return
    const p = e.position!
    for (const [dx, dy] of NUDGES) {
      if (yield { t: 'move', equipmentId: e.id, to: [cm(p[0] + dx * step), cm(p[1] + dy * step), p[2]], ceiling }) {
        done++
        break
      }
    }
  }
}

/** 방 안쪽 점(벽과 먼 점)에 새 설비를 더한다. 겹치면 다음 방. 더한 설비 id. */
function* addInRooms(storey: Storey, z: number, name: string): Generator<DemoAction, string | null, boolean> {
  for (const r of roomsBySize(storey).slice(0, 8)) {
    const id = newId()
    // 가운데는 이미 다른 설비가 있기 쉬워 조금 비켜 놓는다.
    const off = Math.min(0.6, r.d * 0.4)
    if (yield { t: 'add', storeyId: storey.id, id, name, position: [cm(r.p[0] + off), cm(r.p[1] - off), cm(z)] }) return id
  }
  return null
}

/** 아직 안 건드린 방부터. 방이 하나뿐인 층에서도 갈래의 편집이 다 나오게 건드린 방도 뒤에 둔다. */
const unusedFirst = <T extends { space: Space }>(rooms: T[], used: ReadonlySet<string>) => [
  ...rooms.filter((r) => !used.has(r.space.id)),
  ...rooms.filter((r) => used.has(r.space.id)),
]

function* spaceScript(model: Model, storey: Storey): DemoScript {
  // 편집마다 외곽선이 바뀌니 방 목록은 단계마다 다시 잰다.
  const rooms = () => roomsBySize(storey)
  const used = new Set<string>()
  // 1. 가장 넓은 방의 이름.
  const first = rooms()[0]
  if (!first) return
  if (yield { t: 'rename', spaceId: first.space.id, name: '데모 회의실' }) used.add(first.space.id)
  // 2. 다른 방의 꼭짓점 하나를 안쪽으로.
  for (const r of unusedFirst(rooms(), used)) {
    const pts = openPoints(r.space.footprint)
    const i = Math.min(1, pts.length - 1)
    const v = pts[i]
    const len = Math.hypot(r.p[0] - v[0], r.p[1] - v[1])
    const k = Math.min(0.8, len * 0.25) / len
    const to: Vec2 = [cm(v[0] + (r.p[0] - v[0]) * k), cm(v[1] + (r.p[1] - v[1]) * k)]
    if (wouldSelfIntersect(model, r.space.id, i, to)) continue
    if (yield { t: 'footprint', spaceId: r.space.id, label: `${spaceName(r.space)} 꼭짓점`, apply: (m) => moveSpaceVertex(m, r.space.id, i, to) }) {
      used.add(r.space.id)
      break
    }
  }
  // 3. 또 다른 방을 짧은 쪽으로 반 자르기.
  for (const r of unusedFirst(rooms(), used)) {
    const pts = openPoints(r.space.footprint)
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const [a, b]: Vec2[] = wideInX(r.space.footprint)
      ? [
          [cm(r.p[0]), Math.min(...ys) - 1],
          [cm(r.p[0]), Math.max(...ys) + 1],
        ]
      : [
          [Math.min(...xs) - 1, cm(r.p[1])],
          [Math.max(...xs) + 1, cm(r.p[1])],
        ]
    if (yield { t: 'spaces', storeyId: storey.id, label: `${spaceName(r.space)} 나누기`, apply: (m) => splitSpace(m, r.space.id, a, b) }) {
      used.add(r.space.id)
      break
    }
  }
  // 4. 넓은 방 안에 룸 하나(정사각형).
  for (const r of rooms()) {
    const h = cm(Math.min(1.2, r.d * 0.6))
    if (h < 0.3) continue
    const [x, y] = r.p
    const a: Vec2 = [cm(x - h), cm(y - h)]
    const b: Vec2 = [cm(x + h), cm(y + h)]
    if (yield { t: 'rooms', storeyId: storey.id, label: '룸 만들기', apply: (m) => createRoom(m, storey.id, a, b) }) {
      used.add(r.space.id)
      break
    }
  }
  // 5. 아직 안 건드린 방 위에 커스텀존(운영 단위). 물리존과 겹쳐도 된다.
  for (const r of unusedFirst(rooms(), used)) {
    const h = Math.min(2.5, r.d * 0.9)
    const [x, y] = r.p
    const ring: Vec2[] = [
      [cm(x - h), cm(y - h)],
      [cm(x + h), cm(y - h)],
      [cm(x + h), cm(y + h)],
      [cm(x - h), cm(y + h)],
    ]
    if (yield { t: 'zones', storeyId: storey.id, label: '커스텀존 만들기', apply: (m) => createCustomZone(m, storey.id, { footprint: ring }) }) break
  }
}

/** 바닥·벽 쪽에서 고칠 수 있는 설비: 좌표가 있고, 배관이 아니고, 천장 설비가 아니고, 외벽 전용이 아닌 것. */
function floorDevices(storey: Storey, ctx: DemoContext): Equipment[] {
  return storey.equipment.filter((e) => e.position && !isConduit(e.role) && !ctx.ceilingIds.has(e.id) && !exteriorOnly(e))
}

/** 장면의 주인공으로 삼을 설비부터: 공조기·펌프·탱크·기구가 앞이고, 밸브·댐퍼처럼 관에 끼인 것은 뒤다. */
const MAIN_ROLES: ReadonlySet<string | null> = new Set(['conversion', 'moving', 'storage', 'treatment', 'terminal'])
const mainFirst = (list: Equipment[]) => [...list.filter((e) => MAIN_ROLES.has(e.role)), ...list.filter((e) => !MAIN_ROLES.has(e.role))]

/** 데모가 새 설비에 붙이는 종류. 사전에 있는 종류여야 한다(kinds.ts). */
const DEMO_KIND = 'fcu'

function* floorScript(model: Model, storey: Storey, ctx: DemoContext): DemoScript {
  const devices = spread(mainFirst(floorDevices(storey, ctx)), 6)
  yield* moveSome(devices, 2, 1)
  const added = yield* addInRooms(storey, storey.elevation, '데모 설비')
  if (!added) return
  // 더한 설비를 가장 가까운 설비와 잇는다. 이미 이어진 것은 App 이 거절하고 다음으로 간다.
  const at = model.storeys.find((s) => s.id === storey.id)?.equipment.find((e) => e.id === added)?.position
  if (!at) return
  const near = mainFirst(
    floorDevices(storey, ctx)
      .filter((e) => e.id !== added)
      .sort((a, b) => Math.hypot(a.position![0] - at[0], a.position![1] - at[1]) - Math.hypot(b.position![0] - at[0], b.position![1] - at[1])),
  )
  let feeder: Equipment | null = null
  for (const e of near.slice(0, 3)) {
    if (!(yield { t: 'connect', from: added, to: e.id })) continue
    // 이은 연결의 방향: 있던 설비에서 새 설비로 공급한다(TTL 에 brick:feeds 로 나간다).
    yield { t: 'flow', a: added, b: e.id, from: e.id }
    feeder = e
    break
  }
  // 새 설비의 종류(Brick 클래스가 정해진다)와 계통(이은 설비의 계통, 없으면 계통이 가장 큰 것).
  yield { t: 'kind', equipmentId: added, kind: DEMO_KIND }
  const systemId =
    feeder?.systemId ??
    [...model.systems].sort((a, b) => b.memberIds.length - a.memberIds.length).find((sys) => sys.memberIds.length)?.id ??
    model.systems[0]?.id
  if (systemId) yield { t: 'system', equipmentId: added, systemId }
  // 처음 옮긴 것과 다른 설비 하나를 더 옮겨 마무리.
  yield* moveSome(devices.slice(2), 1, 0.6)
}

function* ceilingScript(storey: Storey, ctx: DemoContext): DemoScript {
  const devices = spread(mainFirst(storey.equipment.filter((e) => e.position && ctx.ceilingIds.has(e.id))), 6)
  // 천장 설비는 x·y 만 옮긴다(z 는 구역 검사를 탄다).
  yield* moveSome(devices, 2, 0.8, true)
  const h = ctx.ceilingHeight(storey.id)
  if (h !== null) yield* addInRooms(storey, storey.elevation + h, '데모 천장 설비')
}

/** 모양을 고칠 수 있는 BIM 벽(내력벽·외벽은 잠겨 있다). */
const free = (w: Wall) => !!w.footprint?.length && !wallShapeLock(w)

/** 벽 긋기 → 문 놓기 → 문 옮기기 → 창 놓기. 그은 벽 id 를 돌려준다(마지막에 내력벽으로 바꾼다). */
function* archBuild(storey: Storey): Generator<DemoAction, string | null, boolean> {
  const sid = storey.id
  // 1. 넓은 방 가운데에 칸막이 벽. 방 안에서 끝나게 벽과 먼 점에서 그 거리 안쪽으로만 긋는다(기존 벽과 엇갈리지 않게).
  let wallId: string | null = null
  let mid: Vec2 | null = null
  let dir: Vec2 = [1, 0]
  let half = 0
  for (const r of roomsBySize(storey).slice(0, 6)) {
    half = Math.min(2, r.d * 0.8)
    if (half < 0.5) continue
    dir = wideInX(r.space.footprint) ? [0, 1] : [1, 0]
    const a: Vec2 = [cm(r.p[0] - dir[0] * half), cm(r.p[1] - dir[1] * half)]
    const b: Vec2 = [cm(r.p[0] + dir[0] * half), cm(r.p[1] + dir[1] * half)]
    const id = newId()
    const thickness = newWallThickness(storey).thickness
    if (yield { t: 'elements', storeyId: sid, label: '벽 긋기', apply: (m) => addWall(m, sid, a, b, thickness, id) }) {
      wallId = id
      mid = [cm(r.p[0]), cm(r.p[1])]
      break
    }
  }
  // 2. 새 벽 가운데에 문, 3. 그 문을 벽을 따라 옮기기.
  if (wallId && mid) {
    const doorId = newId()
    const at = mid
    if (yield { t: 'elements', storeyId: sid, label: '문 놓기', apply: (m) => addOpening(m, sid, 'door', at, doorId) }) {
      const to: Vec2 = [cm(at[0] + dir[0] * 0.5), cm(at[1] + dir[1] * 0.5)]
      yield { t: 'elements', storeyId: sid, label: '새 문 옮김', apply: (m) => moveOpening(m, doorId, to) }
    }
  }
  // 4. 외벽(없으면 다른 벽) 가운데에 창. 내력벽에는 뚫지 않는다.
  const walls = storey.walls.filter((w) => w.footprint?.length && w.loadBearing !== true && w.id !== wallId)
  const byLength = (w: Wall) => {
    const ax = wallAxis(w.footprint!)
    return ax ? Math.hypot(ax.b[0] - ax.a[0], ax.b[1] - ax.a[1]) : 0
  }
  const windowWalls = [...walls.filter((w) => w.external === true), ...walls.filter((w) => w.external !== true)].filter((w) => byLength(w) > 1.5)
  let placed = false
  for (const w of windowWalls.slice(0, 6)) {
    const ax = wallAxis(w.footprint!)!
    const at = xy([(ax.a[0] + ax.b[0]) / 2, (ax.a[1] + ax.b[1]) / 2])
    if ((placed = yield { t: 'elements', storeyId: sid, label: '창 놓기', apply: (m) => addOpening(m, sid, 'window', at) })) break
  }
  // 다른 벽이 없는 층(벽을 안 읽은 파일)은 새 벽의 문 반대쪽에.
  if (!placed && wallId && mid) {
    const at: Vec2 = [cm(mid[0] - dir[0] * Math.min(1, half * 0.6)), cm(mid[1] - dir[1] * Math.min(1, half * 0.6))]
    yield { t: 'elements', storeyId: sid, label: '창 놓기', apply: (m) => addOpening(m, sid, 'window', at) }
  }
  return wallId
}

const wallLength = (w: Wall) => {
  const ax = wallAxis(w.footprint!)
  return ax ? Math.hypot(ax.b[0] - ax.a[0], ax.b[1] - ax.a[1]) : 0
}

/** BIM 칸막이 벽 하나를 옮긴다. 옮길 BIM 벽이 없으면 새 벽(wallId)을 옮긴다. */
function* archMove(storey: Storey, wallId: string | null): DemoScript {
  const sid = storey.id
  const byLength = wallLength
  // 5. BIM 칸막이 벽 하나를 면 쪽으로 30cm. 다른 벽과 엇갈리면 반대쪽, 그래도 안 되면 다음 벽.
  // 옮길 BIM 벽이 없으면 새 벽을 옮긴다(문·창이 따라간다).
  const movable = [
    ...storey.walls.filter((w) => free(w) && !w.added).sort((a, b) => byLength(b) - byLength(a)),
    ...storey.walls.filter((w) => w.id === wallId),
  ]
  moving: for (const w of movable.slice(0, 9)) {
    const ax = wallAxis(w.footprint!)
    if (!ax) continue
    const len = Math.hypot(ax.b[0] - ax.a[0], ax.b[1] - ax.a[1])
    if (len < 1) continue
    const n: Vec2 = [-(ax.b[1] - ax.a[1]) / len, (ax.b[0] - ax.a[0]) / len]
    for (const s of [0.3, -0.3]) {
      const delta: Vec2 = [cm(n[0] * s), cm(n[1] * s)]
      if (yield { t: 'elements', storeyId: sid, label: `${w.name || '벽'} 옮김`, apply: (m) => moveWall(m, w.id, delta) }) break moving
    }
  }
}

/**
 * 데모를 심을 두 층. 주 무대는 보고 있는 층(없으면 방·벽·바닥 설비가 가장 많은 층), 둘째 무대는 그 밖에서 천장 설비가 가장 많은
 * 층(없으면 방이 많은 층). 층이 하나뿐이면 둘 다 그 층이다.
 */
export function demoStoreys(model: Model, ctx: DemoContext): { main: Storey; other: Storey } | null {
  const score = (s: Storey) => {
    const rooms = roomsBySize(s).length
    return rooms ? rooms + s.walls.filter((w) => w.footprint?.length).length * 3 + floorDevices(s, ctx).length * 2 : 0
  }
  const viewed = model.storeys.find((s) => s.id === ctx.storeyId && roomsBySize(s).length)
  const main = viewed ?? [...model.storeys].sort((a, b) => score(b) - score(a)).find((s) => score(s) > 0)
  if (!main) return null
  const ceilingScore = (s: Storey) => s.equipment.filter((e) => ctx.ceilingIds.has(e.id)).length * 10 + Math.min(roomsBySize(s).length, 9)
  const other = [...model.storeys].filter((s) => s !== main && roomsBySize(s).length).sort((a, b) => ceilingScore(b) - ceilingScore(a))[0] ?? main
  return { main, other }
}

/**
 * 큰 데모 하나. 주 무대 층에서 공간(이름·꼭짓점·나누기·룸·커스텀존) → 벽·문·창(벽 긋기·문 놓고 옮기기·창) → 설비(옮기기·더하기·
 * 잇기·흐름 방향·종류·계통), 둘째 층으로 넘어가 천장 설비와 벽 옮기기, 다시 주 무대로 돌아와 새 벽을 내력벽으로. 층을 오가니
 * 리플레이의 층 전환이 두 번 나온다.
 */
export function* demoScript(model: Model, ctx: DemoContext): DemoScript {
  const at = demoStoreys(model, ctx)
  if (!at) return
  const { main, other } = at
  yield* spaceScript(model, main)
  const wallId = yield* archBuild(main)
  yield* floorScript(model, main, ctx)
  yield* ceilingScript(other, ctx)
  yield* archMove(other, other === main ? wallId : null)
  // 마지막: 주 무대로 돌아와 새 벽을 내력벽으로 — TTL 에 내력 여부가 나간다. 내력벽은 잠기니 맨 끝에 둔다.
  if (wallId) yield { t: 'elements', storeyId: main.id, label: '새 벽 → 내력벽', apply: (m) => setWallLoadBearing(m, wallId, true) }
}

/**
 * 계획대로 모델에 바로 한다(테스트용). 화면의 겹침·천장 구역 검사는 없다 — App 이 하는 것과 같은 편집 함수를 부르고,
 * 거절(null·false·{refused})이면 다음 후보로 넘어간다. 한 편집의 이름 목록.
 */
export function runDemo(model: Model, ctx: DemoContext, apply: (m: Model, a: DemoAction) => boolean = applyDirect): string[] {
  const done: string[] = []
  const script = demoScript(model, ctx)
  let r = script.next(false)
  while (!r.done) {
    const ok = apply(model, r.value)
    if (ok) done.push(labelOf(r.value))
    r = script.next(ok)
  }
  return done
}

const accepted = (v: unknown) => !!v && !(typeof v === 'object' && 'refused' in (v as object))

export function applyDirect(m: Model, a: DemoAction): boolean {
  switch (a.t) {
    case 'move':
      return !!moveEquipment(m, a.equipmentId, a.to)
    case 'add':
      return !!addEquipment(m, a.storeyId, { id: a.id, name: a.name, kind: null, position: a.position })
    case 'connect':
      return !!addConnection(m, a.from, a.to)
    case 'flow': {
      const c = connectionBetween(m, a.a, a.b)
      return !!c && applyFlow(m, c, a.from, DEMO_FLOW_REASON) === true
    }
    case 'kind': {
      const e = m.storeys.flatMap((st) => st.equipment).find((x) => x.id === a.equipmentId)
      return !!e && !!setTypeKind(m, typeKeyOf(e), a.kind)
    }
    case 'system':
      return !!setEquipmentSystem(m, a.equipmentId, a.systemId)
    case 'rename':
      return renameSpace(m, a.spaceId, a.name)
    default:
      return accepted(a.apply(m))
  }
}

export function labelOf(a: DemoAction): string {
  if (a.t === 'move') return `옮김 ${a.equipmentId}`
  if (a.t === 'add') return `${a.name} 더하기`
  if (a.t === 'connect') return `연결 ${a.from}–${a.to}`
  if (a.t === 'flow') return `방향 ${a.from} → ${a.from === a.a ? a.b : a.a}`
  if (a.t === 'kind') return `종류 ${a.equipmentId} → ${a.kind}`
  if (a.t === 'system') return `계통 ${a.equipmentId} → ${a.systemId}`
  if (a.t === 'rename') return `이름 → ${a.name}`
  return a.label
}

/** 편집 전에 떠 둘 스냅숏. App 의 같은 편집이 이력에 쌓는 것과 같다(relocate·changeSpaces·changeElements …). */
export function snapshotFor(m: Model, a: DemoAction): Snapshot | null {
  switch (a.t) {
    case 'move':
      return snapshotEquipment(m, a.equipmentId)
    case 'add':
    case 'connect':
      return null
    case 'flow': {
      const c = connectionBetween(m, a.a, a.b)
      return c ? snapshotRelease(m, c) : null
    }
    case 'kind': {
      const e = m.storeys.flatMap((st) => st.equipment).find((x) => x.id === a.equipmentId)
      return e ? snapshotType(m, typeKeyOf(e)) : null
    }
    case 'system': {
      const e = m.storeys.flatMap((st) => st.equipment).find((x) => x.id === a.equipmentId)
      return e ? snapshotSystems(m, [e.systemId ?? null, a.systemId], [a.equipmentId]) : null
    }
    case 'rename':
    case 'footprint':
      return snapshotSpace(m, a.spaceId)
    case 'spaces':
      return snapshotStoreySpaces(m, a.storeyId)
    case 'rooms':
      return snapshotRooms(m, a.storeyId)
    case 'zones':
      return snapshotCustomZones(m, a.storeyId)
    case 'elements':
      return snapshotStoreyElements(m, a.storeyId)
  }
}

/**
 * 데모를 모델에 하고 되돌리기 이력(편집 전 스냅숏)을 같이 낸다. 테스트가 리플레이(buildReplay)까지 돌려 볼 때 쓴다.
 * 더하기·잇기는 한 뒤에 뜬다 — App 과 같이 "없던 것" 으로 적는다.
 */
export function recordDemo(model: Model, ctx: DemoContext): { labels: string[]; undo: Snapshot[] } {
  const undo: Snapshot[] = []
  const labels = runDemo(model, ctx, (m, a) => {
    const before = snapshotFor(m, a)
    if (!applyDirect(m, a)) return false
    if (a.t === 'add') {
      const s = snapshotEquipmentSet(m, a.id)
      if (s?.kind === 'equipment-set') undo.push({ ...s, present: false })
    } else if (a.t === 'connect') {
      const index = m.connections.length - 1
      undo.push({ kind: 'connection', connection: m.connections[index], present: false, index })
    } else if (before) undo.push(before)
    return true
  })
  return { labels, undo }
}
