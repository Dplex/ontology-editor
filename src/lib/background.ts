// 평면도 배경 이미지(OE-MAN-02). 준공 도면을 이미지로 깔고 그 위에 물리존을 그린다. 온톨로지에 나가지 않고 브라우저에만 있다.
//
// 이미지의 왼쪽 위 픽셀이 세계 좌표 `origin` 에 오고, 픽셀 하나가 `scale` m 다. 이미지의 아래쪽은 세계 y 가 줄어드는 쪽이다(도면의 위가
// 북쪽 = +y). 사람이 두 점을 찍어 실제 거리를 넣으면 스케일이 맞고(첫 점을 두고 늘이거나 줄인다), 한 점을 찍어 그 점의 실제 좌표를
// 넣으면 원점이 맞는다.

import type { Vec2 } from './model'

export type Background = {
  /** 이미지 주소(브라우저의 object URL). */
  url: string
  name: string
  /** 이미지 크기(픽셀). */
  width: number
  height: number
  /** 픽셀 하나의 길이(m). */
  scale: number
  /** 이미지 왼쪽 위 픽셀의 세계 좌표(m). */
  origin: Vec2
  /** 0..1. */
  opacity: number
  /** PDF 도면이면 그린 쪽(1부터)·전체 쪽 수·PDF 1pt 가 몇 픽셀인지(pdf-page.ts). 쪽을 바꿔도 종이 위 축척을 이어 쓰는 데 쓴다. */
  pdf?: { page: number; pages: number; pxPerPt: number }
  /** DWG 도면이면 서버가 알려 준 도면 단위(scripts/dwg2png.py). 단위를 알아 축척을 맞췄는지, 도면 좌표에 놓았는지를 화면이 말한다. */
  dwg?: { unit: string | null; placed: 'drawing' | 'building' | 'origin' }
}

/** DWG 를 그린 PNG 와 함께 서버가 주는 값(`X-Dwg2png`). 그림이 덮는 도면 좌표 범위와 도면 단위다. */
export type DwgStats = {
  width: number
  height: number
  extents: [number, number, number, number]
  unit: string | null
  metersPerUnit: number | null
  /** 전체 DXF 를 읽지 못해 개체만 그렸다. 블록으로 넣은 기호(문·가구)가 빠졌을 수 있다(scripts/dwg2png.py). */
  minimal?: boolean
}

/** 이미지 네 귀퉁이의 세계 좌표(왼쪽 위부터 시계 방향). */
export function backgroundCorners(bg: Background): [Vec2, Vec2, Vec2, Vec2] {
  const [x, y] = bg.origin
  const w = bg.width * bg.scale
  const h = bg.height * bg.scale
  return [
    [x, y],
    [x + w, y],
    [x + w, y - h],
    [x, y - h],
  ]
}

/** 처음 깔 때: 이미지 너비를 건물 너비에 맞추고, 왼쪽 위를 건물 범위의 왼쪽 위에 둔다. 건물 범위를 모르면 1px = 1cm, 원점 (0,0). */
export function initialBackground(spec: { url: string; name: string; width: number; height: number }, box: { x0: number; x1: number; y0: number; y1: number } | null): Background {
  const scale = box && box.x1 > box.x0 ? (box.x1 - box.x0) / spec.width : 0.01
  return { ...spec, scale, origin: box ? [box.x0, box.y1] : [0, 0], opacity: 0.5 }
}

/**
 * DWG 도면을 처음 깔 때. 도면 단위를 알면(mm·m …) 축척을 단위로 맞춘다 — 사람이 두 점으로 맞추지 않아도 실제 크기다. 단위를 모르면 PNG·JPG 와
 * 같이 건물 너비에 맞춘다(`initialBackground`).
 * 자리는 도면 좌표가 건물 범위와 겹치면 도면 좌표 그대로 둔다 — 같은 Revit 프로젝트에서 낸 DWG 는 BIM 과 좌표가 같아 바로 맞는다. 겹치지 않으면
 * 왼쪽 위를 건물 범위의 왼쪽 위에, 건물 범위를 모르면 원점에 둔다.
 */
export function dwgBackground(spec: { url: string; name: string }, stats: DwgStats, box: { x0: number; x1: number; y0: number; y1: number } | null): Background {
  const k = stats.metersPerUnit
  if (!k) return { ...initialBackground({ ...spec, width: stats.width, height: stats.height }, box), dwg: { unit: null, placed: box ? 'building' : 'origin' } }
  const [x0, y0, x1, y1] = stats.extents.map((v) => v * k)
  const scale = (x1 - x0) / stats.width
  const overlaps = !!box && x0 < box.x1 && x1 > box.x0 && y0 < box.y1 && y1 > box.y0
  const origin: Vec2 = overlaps ? [x0, y1] : box ? [box.x0, box.y1] : [0, 0]
  return { ...spec, width: stats.width, height: stats.height, scale, origin, opacity: 0.5, dwg: { unit: stats.unit, placed: overlaps ? 'drawing' : box ? 'building' : 'origin' } }
}

/**
 * 스케일 맞추기. 이미지 위에서 찍은 두 점(세계 좌표)이 실제로는 `meters` 떨어져 있다. 첫 점을 그 자리에 두고 이미지를 늘이거나 줄인다.
 * 두 점이 같거나 거리가 0 이하면 null.
 */
export function calibrateScale(bg: Background, a: Vec2, b: Vec2, meters: number): Background | null {
  const measured = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (!(measured > 1e-6) || !(meters > 0) || !Number.isFinite(meters)) return null
  const k = meters / measured
  return { ...bg, scale: bg.scale * k, origin: [a[0] + (bg.origin[0] - a[0]) * k, a[1] + (bg.origin[1] - a[1]) * k] }
}

/**
 * PDF 의 다른 쪽으로 바꾼다. 왼쪽 위와 **종이 위 축척**(PDF 1pt 가 몇 m 인가)을 그대로 둔다 — 한 도면 묶음은 쪽마다 축척이 같아서,
 * 한 쪽에서 맞춘 스케일을 다른 쪽에 이어 쓴다. 쪽마다 종이 크기가 달라 픽셀 크기(`pxPerPt`)가 달라도 같다.
 */
export function switchPdfPage(bg: Background, next: { url: string; width: number; height: number; page: number; pages: number; pxPerPt: number }): Background {
  const metersPerPt = bg.pdf ? bg.scale * bg.pdf.pxPerPt : bg.scale
  return { ...bg, url: next.url, width: next.width, height: next.height, scale: metersPerPt / next.pxPerPt, pdf: { page: next.page, pages: next.pages, pxPerPt: next.pxPerPt } }
}

/** 원점 맞추기. 이미지 위에서 찍은 점 `at` 이 실제로는 세계 좌표 `to` 다. 이미지를 그만큼 옮긴다. */
export function anchorBackground(bg: Background, at: Vec2, to: Vec2): Background {
  return { ...bg, origin: [bg.origin[0] + to[0] - at[0], bg.origin[1] + to[1] - at[1]] }
}
