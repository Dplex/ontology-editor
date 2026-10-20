// 설비 소속 판정을 src/lib/mapping.ts 에서 그대로 옮긴 순수 로직이다. 그림의 표시값과 TTL 줄이 모두 여기서 나온다.
// mapping.ts 의 locateHow·assignEquipment 를 고치면 이 파일도 같이 고친다. build.mjs 가 이 파일을 페이지에 그대로 넣는다.

export const SNAP = 0.05
export const SNAP_RANGE = { min: 0, max: 1 }

export function pointInPolygon(point, ring) {
  if (ring.length < 3) return false
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

export function distanceToRing(point, ring) {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[(i + 1) % ring.length]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / len2))
    best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)))
  }
  return best
}

export function boundsOf(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of ring) {
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  return [minX, minY, maxX, maxY]
}

// 4단계: 외곽선 안이면 그 방, 겹치면 면적이 가장 작은 방(inside). 5단계: 아니면 허용 거리 안의 가장 가까운 방(near). 6단계: 없으면 null.
export function locateHow(point, spaces, snap = SNAP) {
  const [x, y] = point
  let inside = null
  for (const space of spaces) {
    const [minX, minY, maxX, maxY] = boundsOf(space.footprint)
    if (x < minX || x > maxX || y < minY || y > maxY) continue
    if (pointInPolygon(point, space.footprint) && (!inside || space.areaM2 < inside.areaM2)) inside = space
  }
  if (inside) return { id: inside.id, how: 'inside' }

  let best = null
  let bestDistance = snap
  const reach = snap + 1e-9
  for (const space of spaces) {
    if (space.footprint.length < 3) continue
    const [minX, minY, maxX, maxY] = boundsOf(space.footprint)
    if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) continue
    const d = distanceToRing(point, space.footprint)
    if (d <= bestDistance) {
      bestDistance = d
      best = space.id
    }
  }
  return best === null ? null : { id: best, how: 'near' }
}

// assignEquipment 의 1·2·3·7단계. spaces 는 부르는 쪽이 자기 층의 방만 넘긴다(3단계).
export function assign(equipment, spaces, snap = SNAP) {
  if (equipment.exterior) return { spaceId: null, source: null, how: 'exterior' }
  if (equipment.spaceSource === 'bim') return { spaceId: equipment.spaceId, source: 'bim', how: 'bim' }
  if (!equipment.position) return { spaceId: null, source: null, how: null }
  const raw = locateHow([equipment.position[0], equipment.position[1]], spaces, snap)
  const shaft = raw?.how === 'inside' && spaces.find((s) => s.id === raw.id)?.kind === 'elevator_shaft'
  const found = shaft ? null : raw
  return found ? { spaceId: found.id, source: 'computed', how: found.how } : { spaceId: null, source: null, how: shaft ? 'shaft' : null }
}

// 판정에 쓴 수치까지 함께 돌려준다. 표시값은 이 결과만 읽는다.
export function judge(position, spaces, snap = SNAP) {
  const point = [position[0], position[1]]
  const result = assign({ position }, spaces, snap)
  const containing = spaces.filter((s) => pointInPolygon(point, s.footprint))
  const distances = Object.fromEntries(spaces.map((s) => [s.id, distanceToRing(point, s.footprint)]))
  return { ...result, containing: containing.map((s) => s.id), distances, snap }
}

// export/ttl.ts 의 한 줄. 방을 못 찾으면 방 대신 층을 적는다(ttl.ts 의 `equipment.spaceId ?? storey.id`).
export function ttlLine(equipmentId, spaceId, storeyId) {
  return `ex:${equipmentId} brick:hasLocation ex:${spaceId ?? storeyId} .`
}
