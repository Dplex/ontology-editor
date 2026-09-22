// 설비가 어느 물리존에 있는지 좌표로 판정한다. PRD #12 의 "설비 → 물리존" 이다.
//
// 이게 온톨로지를 쓸 만하게 만드는 고리다. BIM 은 설비의 좌표를 주고 물리존의 외곽선을
// 주지만, "이 공조기가 회의실에 있다" 는 말은 하지 않는다. 그 관계는 우리가 만들어야 한다.
//
// 편집할 때마다 다시 돌아야 하는 계산이라 임포트와 떼어 놓았다. 벽을 옮겨 물리존 경계가
// 바뀌면 설비 소속이 바뀌고, 그게 이상 알림의 '발생 위치' 와 탐색기 트리에 그대로 나간다.

import type { Model, Vec2, Vec3 } from './model'

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
 * 모든 설비에 소속 물리존을 채워 넣는다. 모델을 그 자리에서 고친다.
 *
 * 설비는 자기 층의 물리존 안에서만 찾는다. 층을 안 가리면 위아래 층의 같은 자리에 있는
 * 방에 붙을 수 있는데, 천장 설비는 다음 층 바닥과 높이가 겹쳐서 실제로 그렇게 된다.
 */
export function assignEquipmentToSpaces(model: Model): void {
  for (const storey of model.storeys) {
    for (const equipment of storey.equipment) {
      // BIM 이 직접 말한 소속은 다시 계산하지 않는다. 설계자가 정한 값이라 좌표 판정보다
      // 정확하고, 벽에 걸친 설비처럼 판정이 애매한 경우에도 답이 하나로 정해진다.
      if (equipment.spaceSource === 'bim') continue

      equipment.spaceId = null
      equipment.spaceSource = null
      if (!equipment.position) continue

      const flat: Vec2 = [equipment.position[0], equipment.position[1]]
      for (const space of storey.spaces) {
        if (pointInPolygon(flat, space.footprint)) {
          equipment.spaceId = space.id
          equipment.spaceSource = 'computed'
          break
        }
      }
    }
  }
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
