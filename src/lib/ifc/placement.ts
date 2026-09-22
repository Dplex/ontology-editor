// IfcLocalPlacement 사슬을 평면 변환 하나로 접는다.
//
// IFC 는 모든 좌표를 부모 기준의 상대 좌표로 둔다. 방의 외곽선은 그 방의 원점 기준이고,
// 방은 층 기준, 층은 건물 기준으로 놓여 있다. 그래서 세계 좌표를 얻으려면 사슬을 타고
// 올라가며 변환을 곱해야 한다.
//
// **이걸 빼먹으면 오류 없이 조용히 틀린다.** 모든 방이 원점 근처에 겹쳐 쌓이는데,
// 파싱은 성공했고 넓이도 맞아서 화면을 보기 전에는 모른다. PRD #6 이 좌표 정합을
// 검토 화면 항목으로 따로 둔 이유가 이것이다.

import type { Vec2 } from '../model'

/**
 * 2D 상사 변환. 회전과 이동만 있고 크기 변경은 없다.
 *
 *   x' = cos·x − sin·y + tx
 *   y' = sin·x + cos·y + ty
 */
export type Transform2 = {
  cos: number
  sin: number
  tx: number
  ty: number
}

export const IDENTITY: Transform2 = { cos: 1, sin: 0, tx: 0, ty: 0 }

/**
 * IfcAxis2Placement3D 한 단계를 변환으로 바꾼다.
 *
 * RefDirection 이 국소 x 축이다. 없으면 IFC 기본값인 (1,0,0) 이라 회전이 없다.
 * Axis(국소 z)는 평면에서 쓰지 않는다. 층이 기울어 있는 모델은 다루지 않기 때문인데,
 * 건축 모델에서는 사실상 항상 수직이다.
 */
export function fromAxisPlacement(
  location: readonly number[] | null,
  refDirection: readonly number[] | null,
): Transform2 {
  const tx = location?.[0] ?? 0
  const ty = location?.[1] ?? 0

  const dx = refDirection?.[0] ?? 1
  const dy = refDirection?.[1] ?? 0
  const len = Math.hypot(dx, dy)
  // 길이 0 인 방향 벡터는 회전을 정할 수 없다. 이건 모델이 깨진 경우라서
  // 예외를 던지는 대신 회전 없음으로 두고 지나간다 — 위치는 여전히 맞다.
  if (len === 0) return { cos: 1, sin: 0, tx, ty }

  return { cos: dx / len, sin: dy / len, tx, ty }
}

/**
 * 두 변환을 잇는다. `outer(inner(p))` 와 같다.
 *
 * 순서가 중요하다. 사슬은 자식에서 부모로 올라가므로, 자식 변환을 안쪽에 두고
 * 부모 변환을 바깥에 둔다. 뒤집으면 방이 엉뚱한 곳에 회전해서 놓인다.
 */
export function compose(outer: Transform2, inner: Transform2): Transform2 {
  return {
    cos: outer.cos * inner.cos - outer.sin * inner.sin,
    sin: outer.sin * inner.cos + outer.cos * inner.sin,
    tx: outer.cos * inner.tx - outer.sin * inner.ty + outer.tx,
    ty: outer.sin * inner.tx + outer.cos * inner.ty + outer.ty,
  }
}

export function apply(t: Transform2, p: Vec2): Vec2 {
  return [t.cos * p[0] - t.sin * p[1] + t.tx, t.sin * p[0] + t.cos * p[1] + t.ty]
}

/** 사슬 전체를 접는다. 배열은 자식이 먼저, 뿌리가 마지막인 순서다. */
export function foldChain(chain: readonly Transform2[]): Transform2 {
  // 뿌리부터 자식 쪽으로 곱해 내려온다. 자식이 안쪽이어야 하므로 역순으로 돈다.
  let acc = IDENTITY
  for (let i = chain.length - 1; i >= 0; i--) {
    acc = compose(acc, chain[i])
  }
  return acc
}

/**
 * 사슬의 z 이동만 더한다.
 *
 * 설비는 천장·바닥·벽에 붙어서 높이가 의미를 갖는다(PRD #13 설치면). 평면 변환과 달리
 * z 는 회전을 안 섞고 더하기만 하면 되는데, 층이 수평이라는 전제 위에서만 맞다.
 * 기울어진 층을 다루게 되면 여기가 먼저 틀린다.
 */
export function foldElevation(elevations: readonly number[]): number {
  return elevations.reduce((a, b) => a + b, 0)
}
