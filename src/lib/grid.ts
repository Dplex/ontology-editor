// 그리드 정렬(OE-UI-07). 그리기(벽·물리존·룸·공조존·배관 꺾임점 등)에서 찍은 점을 그리드 교점으로 옮긴다. 겹침 판정은 그리드가 아니라
// 형상 기준이다(OE-OBJ-16) — 그리드는 찍는 자리만 바꾼다. 간격은 사이트 설정(이 브라우저)이다.

import type { Vec2 } from './model'

export type GridSettings = { on: boolean; spacing: number }
export const DEFAULT_GRID: GridSettings = { on: false, spacing: 0.5 }
/** 그리는 선의 상한. 간격이 촘촘하면 n 칸마다 하나만 그린다(정렬은 그대로 간격대로). */
export const MAX_GRID_LINES = 400

/** 가장 가까운 교점. 간격이 0 이하이거나 숫자가 아니면 그대로. */
export function snapToGrid(p: Vec2, spacing: number): Vec2 {
  if (!(spacing > 0)) return p
  const snap = (v: number) => Math.round(Math.round(v / spacing) * spacing * 1000) / 1000 || 0
  return [snap(p[0]), snap(p[1])]
}

/** 범위 안의 그리드 선(IFC 평면). 너무 많으면 몇 칸 건너 그린다. `step` 은 실제로 그린 간격이다. */
export function gridLines(extent: { minX: number; minY: number; maxX: number; maxY: number }, spacing: number): { x: number[]; y: number[]; step: number } {
  if (!(spacing > 0)) return { x: [], y: [], step: 0 }
  const span = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY)
  let step = spacing
  while (span / step > MAX_GRID_LINES / 2) step *= 2
  const ticks = (a: number, b: number) => {
    const out: number[] = []
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000 || 0)
    return out
  }
  return { x: ticks(extent.minX, extent.maxX), y: ticks(extent.minY, extent.maxY), step }
}
