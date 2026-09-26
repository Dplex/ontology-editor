// 설비가 어느 물리존에 있는지 좌표로 판정한다. PRD #12 의 "설비 → 물리존" 이다.
//
// 이게 온톨로지를 쓸 만하게 만드는 고리다. BIM 은 설비의 좌표를 주고 물리존의 외곽선을
// 주지만, "이 공조기가 회의실에 있다" 는 말은 하지 않는다. 그 관계는 우리가 만들어야 한다.
//
// 편집할 때마다 다시 돌아야 하는 계산이라 임포트와 떼어 놓았다. 벽을 옮겨 물리존 경계가
// 바뀌면 설비 소속이 바뀌고, 그게 이상 알림의 '발생 위치' 와 탐색기 트리에 그대로 나간다.

import type { Equipment, Model, Space, Vec2, Vec3 } from './model'

/**
 * 점이 다각형 안에 있는지 본다. 광선 교차 방식이다.
 *
 * 경계에 정확히 걸친 점은 어느 쪽으로 갈지 정해 두지 않는다. 설비가 벽 한가운데 좌표를
 * 갖는 일이 드물고, 정해 봐야 부동소수점 오차 앞에서 지켜지지 않는다.
 */
export function pointInPolygon(point: Vec2, ring: readonly Vec2[]): boolean {
  if (ring.length < 3) return false

  const [x, y] = point
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    // 변이 점의 수평선을 가로지르는가. 위·아래 판정을 엇갈리게 둬서 꼭짓점을 두 번 세지 않는다.
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/**
 * 다각형의 넓이 중심. 오목한 방이면 방 밖에 떨어질 수 있으므로 쓰는 쪽이 안팎을 확인한다.
 * 넓이가 0 이면(퇴화한 고리) 꼭짓점 평균으로 대신한다.
 */
export function centroid(ring: readonly Vec2[]): Vec2 | null {
  if (ring.length < 3) return null
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % ring.length]
    const f = x0 * y1 - x1 * y0
    a += f
    cx += (x0 + x1) * f
    cy += (y0 + y1) * f
  }
  if (Math.abs(a) < 1e-12) {
    const n = ring.length
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n]
  }
  return [cx / (3 * a), cy / (3 * a)]
}

/**
 * 다각형 안에 반드시 드는 점 하나.
 *
 * 넓이 중심이 안에 들면 그것을 쓴다. ㄱ 자·ㄷ 자 방은 중심이 방 밖(옆 방)에 떨어질 수 있어서,
 * 그때는 중심 높이의 수평선이 다각형을 가로지르는 구간 중 가장 넓은 것의 가운데를 쓴다.
 * "이 방이 저 방과 같은 자리인가" 를 물을 때 중심을 그대로 쓰면, 계단실이 옆 현관과 같은
 * 방으로 판정된다(Duplex 의 A105 Stair 가 실제로 그랬다).
 */
export function interiorPoint(ring: readonly Vec2[]): Vec2 | null {
  const c = centroid(ring)
  if (!c) return null
  if (pointInPolygon(c, ring)) return c

  const y = c[1]
  const xs: number[] = []
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi))
  }
  xs.sort((p, q) => p - q)
  let best: Vec2 | null = null
  let width = 0
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > width) {
      width = xs[k + 1] - xs[k]
      best = [(xs[k] + xs[k + 1]) / 2, y]
    }
  }
  return best
}

/** 점에서 고리의 가장 가까운 변까지의 거리. */
export function distanceToRing(point: Vec2, ring: readonly Vec2[]): number {
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

/**
 * 외곽선 밖이어도 이 거리 안이면 가장 가까운 물리존에 붙인다(미터).
 *
 * **벽에 붙은 설비는 좌표가 정확히 벽면에 있다.** 콘센트·스위치·벽부 조명의 삽입점이 방 외곽선
 * 위에 떨어져서, 점이 다각형 안에 드는지만 보면 절반쯤이 "어느 방에도 없음" 이 된다. Duplex
 * MEP 판본에서 BIM 이 소속을 직접 말한 설비 167대를 정답지로 채점했을 때 49대(29%)가 그랬고,
 * 그중 44대가 외곽선에서 15cm 안이었다(중앙값 0mm).
 *
 * 같은 167대로 값을 쓸어 봤다. 0 에서 73.1%, 2cm 에서 94.0%, **5cm 에서 95.8% 로 포화**하고
 * 30cm 까지 넓혀도 그대로다(다른 방으로 잘못 가는 것도 2대 그대로). 포화하는 가장 작은 값을
 * 쓴다 — 그 위로는 정답지가 없는 덕트·배관만 더 붙는데(미소속 270 → 31), 벽 속 배관이 어느
 * 쪽 방인지는 맞았는지 잴 방법이 없다. 틀린 관계가 들어가는 쪽이 빠지는 쪽보다 나쁘다.
 * 채점표는 `npm run check:sample` 에 박혀 있다.
 */
export const SNAP = 0.05

/**
 * 한 층의 물리존 중 이 점이 속한 것. 안에 드는 것이 먼저고, 없으면 SNAP 안의 가장 가까운 것.
 * 어디에도 없으면 null 이다.
 */
export function locate(point: Vec2, spaces: readonly Space[], snap = SNAP): string | null {
  // 방이 겹친 자리면 가장 작은 방이다. 실제 BIM 도 같은 층 방끼리 겹친다(병원 건축 52쌍 — 큰 대기실이 접수대를 품는다).
  // 목록의 첫 방을 고르던 때와 견주면, BIM 이 말한 소속에 맞는 수가 가진 파일 전부에서 늘었다(병원 건축+HVAC 156 →
  // 169/180, 건축+MEP 563 → 584/637, Duplex 111 → 114/118, 건축+MEP 11 → 13/13). 좁은 방이 더 구체적인 자리다.
  let inside: Space | null = null
  for (const space of spaces) {
    if (pointInPolygon(point, space.footprint) && (!inside || space.areaM2 < inside.areaM2)) inside = space
  }
  if (inside) return inside.id

  let best: string | null = null
  let bestDistance = snap
  for (const space of spaces) {
    if (space.footprint.length < 3) continue
    const d = distanceToRing(point, space.footprint)
    if (d <= bestDistance) {
      bestDistance = d
      best = space.id
    }
  }
  return best
}

/**
 * 모든 설비에 소속 물리존을 채워 넣는다. 모델을 그 자리에서 고친다.
 *
 * 설비는 자기 층의 물리존 안에서만 찾는다. 층을 안 가리면 위아래 층의 같은 자리에 있는
 * 방에 붙을 수 있는데, 천장 설비는 다음 층 바닥과 높이가 겹쳐서 실제로 그렇게 된다.
 */
export function assignEquipmentToSpaces(model: Model, snap = SNAP): void {
  for (const storey of model.storeys) {
    for (const equipment of storey.equipment) assignEquipment(equipment, storey.spaces, snap)
  }
}

/**
 * 설비 하나의 소속을 다시 판정한다. 결과는 그 설비의 좌표와 **자기 층의 물리존**으로만 정해진다 —
 * 그래서 편집은 모델 전체가 아니라 바뀐 것만 다시 판정해도 전체를 다시 도는 것과 같다. 성수처럼
 * 설비가 1만 개를 넘으면 전체를 도는 데 편집 한 번에 0.6초가 걸렸다.
 */
export function assignEquipment(equipment: Equipment, spaces: readonly Space[], snap = SNAP): void {
  // BIM 이 직접 말한 소속은 다시 계산하지 않는다. 설계자가 정한 값이라 좌표 판정보다
  // 정확하고, 벽에 걸친 설비처럼 판정이 애매한 경우에도 답이 하나로 정해진다.
  if (equipment.spaceSource === 'bim') return

  equipment.spaceId = null
  equipment.spaceSource = null
  if (!equipment.position) return

  const found = locate([equipment.position[0], equipment.position[1]], spaces, snap)
  if (found !== null) {
    equipment.spaceId = found
    equipment.spaceSource = 'computed'
  }
}

/**
 * 좌표 판정을 BIM 이 직접 말한 소속에 대 본다. **F11 의 정확도를 재는 유일한 정답지다.**
 *
 * BIM 이 소속을 말한 설비(`spaceSource === 'bim'`)마다, 그 말을 무시하고 좌표로 판정했으면
 * 어디가 나왔을지를 센다. 같은 방이 두 번 들어 있는 파일(Revit 의 MEP Space 와 건축 Room
 * 사본)이 있어서, "같은 방" 은 id 가 아니라 **같은 자리**로 본다 — 판정된 방 안에 BIM 이 말한
 * 방의 안쪽 점이 드는가.
 */
export function scoreAgainstDeclared(
  model: Model,
  snap = SNAP,
): { total: number; agreed: number; outside: number; otherRoom: number } {
  const out = { total: 0, agreed: 0, outside: 0, otherRoom: 0 }
  for (const storey of model.storeys) {
    for (const e of storey.equipment) {
      if (e.spaceSource !== 'bim' || !e.position) continue
      const declared = storey.spaces.find((s) => s.id === e.spaceId)
      if (!declared || declared.footprint.length < 3) continue
      out.total++

      const flat: Vec2 = [e.position[0], e.position[1]]
      // 겹친 사본 중 어느 것이 먼저 잡혀도 같은 자리면 맞힌 것이다. 그래서 첫 것 하나가
      // 아니라 판정에 걸린 방을 전부 본다.
      const inside = storey.spaces.filter((s) => pointInPolygon(flat, s.footprint))
      const hits = inside.length > 0 ? inside : storey.spaces.filter((s) => s.id === locate(flat, storey.spaces, snap))
      if (hits.length === 0) {
        out.outside++
        continue
      }
      const anchor = interiorPoint(declared.footprint)
      if (hits.some((h) => h.id === declared.id || (anchor && pointInPolygon(anchor, h.footprint)))) out.agreed++
      else out.otherRoom++
    }
  }
  return out
}

/** 소속 물리존을 못 찾은 설비. 검토 화면이 이걸 세어 보여 준다. */
export function unlocatedEquipment(model: Model): { id: string; name: string; reason: string }[] {
  return model.storeys.flatMap((storey) =>
    storey.equipment
      .filter((e) => e.spaceId === null)
      .map((e) => ({
        id: e.id,
        name: e.name,
        reason: e.position === null ? '좌표 없음' : '어느 물리존 외곽선에도 들어가지 않음',
      })),
  )
}

/**
 * 다각형이 자기 자신과 교차하는지 본다.
 *
 * 교차한 다각형에서는 넓이도 안팎 판정도 뜻을 잃는다. 신발끈 공식이 겹친 부분을 음수로
 * 빼고, 광선 교차는 한 점을 안이라고도 밖이라고도 할 수 있다. **막지 않고 경고만 한다** —
 * 사람이 꼭짓점을 끌다 보면 잠깐 교차했다가 풀리는 일이 흔해서, 그때마다 조작을 되돌리면
 * 편집이 안 된다. 대신 그 상태로 반영하지 못하게 검토 화면이 잡는다.
 */
export function isSelfIntersecting(ring: readonly Vec2[]): boolean {
  // 닫는 점은 첫 점과 같으므로 변의 개수만 센다.
  const points = ring.length >= 2 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring
  const n = points.length
  if (n < 4) return false

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // 이웃한 변은 꼭짓점을 공유하므로 건너뛴다. 첫 변과 마지막 변도 이웃이다.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true
    }
  }
  return false
}

function cross(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segmentsCross(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)
  // 부호가 엇갈리면 서로를 가로지른다. 접하기만 하는 경우는 교차로 보지 않는다.
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** 설비 좌표를 그대로 쓰는 자리가 여기뿐이라 타입만 다시 내보낸다. */
export type { Vec3 }
