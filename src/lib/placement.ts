// 미배치 설비를 놓을 높이(OE-EQP-02). 같은 패밀리의 놓인 설비들이 층 바닥에서 떠 있는 높이의 가운데 값이다. 같은 패밀리가 없으면 null —
// 화면이 바닥에 놓고 그렇게 알린다. 높이를 지어내지 않는다.

import { familyKeyOf } from './edit'
import type { Equipment, Model } from './model'

export function familyHeight(model: Model, target: Equipment): number | null {
  const key = familyKeyOf(target)
  const heights = model.storeys
    .flatMap((st) => st.equipment.filter((e) => e.id !== target.id && e.position && familyKeyOf(e) === key).map((e) => e.position![2] - st.elevation))
    .sort((a, b) => a - b)
  return heights.length ? heights[Math.floor(heights.length / 2)] : null
}
