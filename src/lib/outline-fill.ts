// 외곽선 없는 물리존에 외곽선 채우기(OE-MAN-03). 그리기 자체는 edit.ts 의 drawSpaceFootprint 이고, 여기는 목록과 그린 뒤의 검사다.
//
// 외곽선 없는 물리존은 BIM 에서 id·이름·번호(와 있으면 면적)는 왔지만 바닥 다각형이 없는 IfcSpace 다. 3D 에 그려지지 않고 설비 소속
// 판정에도 쓰이지 않는다. 건축·설비 모델을 합칠 때 다른 모델의 같은 방에서 외곽선을 빌려오는 것(K8)이 먼저라, 빌려온 방은 이미
// 외곽선이 있어 목록에 나오지 않는다.

import { isSelfIntersecting } from './mapping'
import { openRing } from './edit'
import type { Model, Space, Storey } from './model'
import { overlapArea } from './polygon'

/** 외곽선이 없는 물리존. 층 순서대로, 층 안에서는 BIM 순서대로다. */
export function outlinelessSpaces(model: Model): { storey: Storey; space: Space }[] {
  return model.storeys.flatMap((storey) => storey.spaces.filter((s) => openRing(s.footprint).length < 3).map((space) => ({ storey, space })))
}

/**
 * 그린 넓이와 BIM 면적의 차이를 경고하는 비율(OE-MAN-03 "±20%, 기준값은 결정 필요"). BIM 이 그린 외곽선끼리 견줘도 Duplex 건축은
 * 19개 중 6개가 이 밖이라(Revit 면적은 벽 중심선 기준이 아닐 수 있다) 경고만 하고 막지 않는다.
 */
export const AREA_WARN_RATIO = 0.2
/** 이보다 작게 겹치면 맞닿은 것으로 본다(㎡). 벽 두께 안에서 그린 점이 조금 들어가는 것은 흔하다. */
export const OVERLAP_WARN_M2 = 0.05

/** 그린 외곽선의 경고(막지 않는다). BIM 면적과 다름, 다른 물리존과 겹침, 자기교차. 없으면 빈 배열. */
export function outlineWarnings(model: Model, spaceId: string): string[] {
  const storey = model.storeys.find((s) => s.spaces.some((x) => x.id === spaceId))
  const space = storey?.spaces.find((x) => x.id === spaceId)
  if (!storey || !space || openRing(space.footprint).length < 3) return []
  const out: string[] = []
  const bim = space.bimArea?.m2
  if (bim && Math.abs(space.areaM2 - bim) / bim > AREA_WARN_RATIO) {
    const pct = Math.round((Math.abs(space.areaM2 - bim) / bim) * 100)
    out.push(`그린 넓이 ${space.areaM2.toFixed(1)}㎡ 가 BIM 면적 ${bim.toFixed(1)}㎡ 와 ${pct}% 다릅니다.`)
  }
  const overlaps = storey.spaces
    .filter((o) => o.id !== space.id && openRing(o.footprint).length >= 3)
    .map((o) => ({ o, area: overlapArea(space.footprint, o.footprint) ?? 0 }))
    .filter((x) => x.area > OVERLAP_WARN_M2)
    .sort((a, b) => b.area - a.area)
  if (overlaps.length) {
    const names = overlaps.slice(0, 3).map((x) => `${x.o.longName || x.o.name || x.o.id} ${x.area.toFixed(1)}㎡`)
    out.push(`다른 물리존과 겹칩니다: ${names.join(', ')}${overlaps.length > 3 ? ` 외 ${overlaps.length - 3}개` : ''}.`)
  }
  if (isSelfIntersecting(space.footprint)) out.push('외곽선이 스스로 교차합니다.')
  return out
}
