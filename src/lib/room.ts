// 룸(OE-OBJ-03 · OE-SPC-11). 물리존 안에서 사람이 그려 만드는 하위 편집 단위다(D15). 임포트는 룸을 만들지 않는다.
//
// - 4면 벽으로 둘러싸인 사각 영역이다. 두 꼭짓점(대각선)으로 그리고, 축에 나란한 사각형으로 둔다 — 비스듬한 건물에서는
//   축이 맞지 않는다(작게 시작한다. 회전한 룸이 필요하면 넓힌다).
// - **물리존 경계 밖으로 나갈 수 없다.** 사각형 넓이의 거의 전부(99.9%)가 한 물리존 안이어야 하고, 그 물리존이 룸의 부모다.
// - **다른 룸과 겹칠 수 없다**(OE-SPC-15). 막을 때 겹친 상대를 돌려준다 — 화면이 붉게 짚는다.
// - 만들기·지우기·옮기기·꼭짓점으로 크기 바꾸기. 지우면 그 영역은 물리존으로 돌아간다(물리존 모양은 룸과 상관없이 그대로다).
// - 층마다 둔다(`Storey.rooms`). 편집 파일에 층 단위로 남는다.

import { isSelfIntersecting } from './mapping'
import { polygonArea, type Model, type Room, type Space, type Storey, type Vec2 } from './model'
import { overlapArea } from './polygon'
import { newId } from './edit'

export type { Room }

/** 룸 한 변의 최소 길이(미터). 이보다 작으면 문 하나도 못 둔다. */
export const ROOM_MIN = 0.3
/** 겹침으로 보는 넓이(㎡). 변이 맞닿은 것은 겹친 것이 아니다. */
const TOUCH = 1e-4

/** 두 꼭짓점으로 축에 나란한 사각 고리(닫힌, 반시계). */
export function rectRing(a: Vec2, b: Vec2): Vec2[] {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
}

export function findRoom(model: Model, id: string): { storey: Storey; room: Room; index: number } | null {
  for (const storey of model.storeys) {
    const index = (storey.rooms ?? []).findIndex((r) => r.id === id)
    if (index >= 0) return { storey, room: storey.rooms![index], index }
  }
  return null
}

export type RoomRefusal = { refused: string; blocked?: string }

/** 이 사각형이 이 층의 룸이 될 수 있나. 되면 부모 물리존, 안 되면 이유(겹친 룸 id 와 함께). */
function placeOf(storey: Storey, ring: Vec2[], exceptId?: string): Space | RoomRefusal {
  const [x0, y0] = ring[0]
  const [x1, y1] = ring[2]
  if (x1 - x0 < ROOM_MIN || y1 - y0 < ROOM_MIN) return { refused: `룸은 한 변이 ${ROOM_MIN}m 이상이어야 합니다.` }
  if (isSelfIntersecting(ring)) return { refused: '변이 서로 엇갈립니다.' }
  const area = polygonArea(ring)
  let parent: Space | null = null
  for (const space of storey.spaces) {
    if (space.footprint.length < 4) continue
    const covered = overlapArea(ring, space.footprint) ?? 0
    if (covered >= area * 0.999) {
      parent = space
      break
    }
  }
  if (!parent) return { refused: '룸은 물리존 경계 밖으로 나갈 수 없습니다. 한 물리존 안에 그리세요.' }
  for (const other of storey.rooms ?? []) {
    if (other.id === exceptId) continue
    if ((overlapArea(ring, other.footprint) ?? 0) > TOUCH) return { refused: '이미 오브젝트가 있는 위치입니다. 룸은 다른 룸과 겹칠 수 없습니다.', blocked: other.id }
  }
  return parent
}

/** 룸을 만든다. 이름이 비면 "룸 n". */
export function createRoom(model: Model, storeyId: string, a: Vec2, b: Vec2, spec: { name?: string; id?: string } = {}): Room | RoomRefusal | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return null
  const ring = rectRing(a, b)
  const place = placeOf(storey, ring)
  if ('refused' in place) return place
  const n = model.storeys.reduce((k, s) => k + (s.rooms?.length ?? 0), 0) + 1
  const room: Room = { id: spec.id ?? newId(), name: spec.name?.trim() || `룸 ${n}`, spaceId: place.id, footprint: ring }
  storey.rooms = [...(storey.rooms ?? []), room]
  return room
}

/** 룸을 지운다. 그 자리는 물리존으로 돌아간다(물리존은 그대로다). */
export function deleteRoom(model: Model, id: string): boolean {
  const found = findRoom(model, id)
  if (!found) return false
  found.storey.rooms = found.storey.rooms!.filter((r) => r.id !== id)
  if (!found.storey.rooms.length) delete found.storey.rooms
  return true
}

export function renameRoom(model: Model, id: string, name: string): boolean {
  const found = findRoom(model, id)
  const next = name.trim()
  if (!found || !next || found.room.name === next) return false
  found.room.name = next
  return true
}

/** 새 모양으로 바꾼다. 물리존 밖·다른 룸과 겹침이면 막고 그대로 둔다. */
function reshape(model: Model, id: string, ring: Vec2[]): boolean | RoomRefusal {
  const found = findRoom(model, id)
  if (!found) return false
  const place = placeOf(found.storey, ring, id)
  if ('refused' in place) return place
  found.room.footprint = ring
  found.room.spaceId = place.id
  return true
}

/** 룸을 평면으로 옮긴다. */
export function moveRoom(model: Model, id: string, delta: Vec2): boolean | RoomRefusal {
  const found = findRoom(model, id)
  if (!found || (!delta[0] && !delta[1])) return false
  const [a, , b] = found.room.footprint
  return reshape(model, id, rectRing([a[0] + delta[0], a[1] + delta[1]], [b[0] + delta[0], b[1] + delta[1]]))
}

/**
 * 꼭짓점 하나를 끌어 크기를 바꾼다(OE-SPC-11). 맞은편 꼭짓점은 그대로다. 꼭짓점 번호는 닫는 점을 뺀 0~3(왼아래부터 반시계).
 */
export function resizeRoom(model: Model, id: string, corner: number, to: Vec2): boolean | RoomRefusal {
  const found = findRoom(model, id)
  if (!found || corner < 0 || corner > 3) return false
  const opposite = found.room.footprint[(corner + 2) % 4]
  return reshape(model, id, rectRing(to, opposite))
}

/** 룸을 연 때부터 다시 얹을 때(편집 파일) 쓴다. 층의 끝 목록을 그대로 둔다. */
export function copyRooms(rooms: readonly Room[]): Room[] {
  return rooms.map((r) => ({ id: r.id, name: r.name, spaceId: r.spaceId, footprint: r.footprint.map((p) => [p[0], p[1]] as Vec2) }))
}
