// 비행 모드의 층 이동(E E · Q Q). E 나 Q 를 짧게 두 번 누르면 위층·아래층 눈높이(층 바닥 + 1.6m)로 옮긴다. 누르고 있으면 지금처럼
// 천천히 오르내린다. 다음 층은 지금 눈높이로 고른다 — 층 소속을 따로 들고 있지 않아도, 손으로 오르내린 뒤에도, 건물 위에 떠 있어도
// 같은 규칙으로 정해진다.

/** 층 바닥에서 눈까지(미터). 사람이 서서 보는 높이다. */
export const EYE = 1.6
/** 두 번 누름으로 읽는 간격(ms). 그보다 길면 따로 누른 것이다. */
export const DOUBLE_TAP_MS = 280
/** 지금 눈높이와 이만큼(미터) 안쪽의 층은 "지금 층" 으로 보고 건너뛴다. 손으로 조금 오르내린 뒤 같은 층으로 돌아가지 않게 한다. */
const SAME = 0.3

/**
 * 지금 눈높이(`eye`, IFC z)에서 위(`dir` 1)·아래(-1)로 가장 가까운 층의 눈높이. 없으면(맨 위·맨 아래) null.
 */
export function nextStoreyEye<T extends { id: string; elevation: number }>(storeys: readonly T[], eye: number, dir: 1 | -1): { storey: T; z: number } | null {
  let best: { storey: T; z: number } | null = null
  for (const storey of storeys) {
    const z = storey.elevation + EYE
    if (dir === 1 ? z <= eye + SAME : z >= eye - SAME) continue
    if (!best || (dir === 1 ? z < best.z : z > best.z)) best = { storey, z }
  }
  return best
}

/** 키 누름을 받아 두 번 누름인지 판정한다. 같은 키를 간격 안에 다시 누르면 참이고, 판정에 쓴 누름은 잊는다(세 번째는 새 첫 누름). */
export function doubleTap(ms = DOUBLE_TAP_MS) {
  let last: { code: string; t: number } | null = null
  return (code: string, t: number): boolean => {
    if (last && last.code === code && t - last.t <= ms) {
      last = null
      return true
    }
    last = { code, t }
    return false
  }
}
