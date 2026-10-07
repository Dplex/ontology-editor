// 층고(OE-BIM-02). 이 층 바닥에서 윗층 바닥까지다(docs/prd/glossary.md "층고").
//
// 두 자리에서 온다. BIM 이 적은 값(`Storey.declaredHeight.gross` — ArchiCAD 기준 물량 GrossHeight, COBie Storey Height)과
// Elevation 의 차(계산). glossary 의 방향대로 **BIM 에 있으면 그 값을 따르고**, 없으면 계산한 값을 쓴다. 둘 다 없으면(맨 위층인데
// BIM 이 안 적었으면) 모름이다 — 지어내지 않는다. 둘이 다르면 알린다(1cm 넘게).
//
// 계산한 값은 모델에 두지 않는다. 층 바닥 높이에서 그때 잰다(합치기로 층이 늘어도 맞다).

import type { Storey } from './model'

/** BIM 값과 계산한 값이 이만큼 넘게 다르면 어긋남으로 본다(미터). */
export const HEIGHT_MISMATCH = 0.01

export type StoreyHeight = {
  /** 쓰는 층고. BIM 값이 있으면 그것, 없으면 계산한 값. */
  value: number
  source: 'bim' | 'calc'
  /** BIM 값을 읽은 자리(`BaseQuantities.GrossHeight`). 계산이면 없다. */
  property?: string
  /** Elevation 의 차. 윗층이 없으면 null. */
  calc: number | null
  /** BIM 이 적은 순 높이(윗층 바닥판 아래까지). 없으면 null. */
  net: number | null
  /** BIM 값과 계산한 값이 둘 다 있고 HEIGHT_MISMATCH 넘게 다르다. */
  mismatch: boolean
}

/**
 * 층마다 층고. 모르면 null. 윗층은 바닥 높이가 **이 층보다 높은** 가장 낮은 층이다 — 같은 높이에 층이 둘이면(기초와 1층을
 * 같은 0m 에 둔 BIM) 차가 0 이 되지 않게 건너뛴다.
 */
export function storeyHeights(storeys: readonly Pick<Storey, 'id' | 'elevation' | 'declaredHeight'>[]): Map<string, StoreyHeight | null> {
  const levels = [...new Set(storeys.map((s) => s.elevation))].sort((a, b) => a - b)
  const out = new Map<string, StoreyHeight | null>()
  for (const s of storeys) {
    const above = levels.find((e) => e > s.elevation + 1e-6)
    const calc = above === undefined ? null : round(above - s.elevation)
    const bim = s.declaredHeight?.gross ?? null
    const net = s.declaredHeight?.net ?? null
    if (bim !== null) {
      out.set(s.id, { value: round(bim), source: 'bim', property: s.declaredHeight!.property, calc, net, mismatch: calc !== null && Math.abs(bim - calc) > HEIGHT_MISMATCH })
    } else if (calc !== null) {
      out.set(s.id, { value: calc, source: 'calc', calc, net, mismatch: false })
    } else out.set(s.id, null)
  }
  return out
}

/** 0.1mm 로 자른다. 피트·밀리미터를 미터로 바꾼 값의 끝자리(3.0999999)가 화면·비교에 새지 않게. */
const round = (v: number) => Math.round(v * 10000) / 10000
