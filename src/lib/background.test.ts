// 평면도 배경 이미지의 스케일·원점 맞추기(OE-MAN-02).
import { describe, expect, it } from 'vitest'
import { anchorBackground, backgroundCorners, calibrateScale, initialBackground, switchPdfPage } from './background'

const img = { url: 'blob:x', name: 'plan.png', width: 1000, height: 500 }

describe('평면도 배경 이미지 (OE-MAN-02)', () => {
  it('처음에는 이미지 너비를 건물 너비에 맞춰 왼쪽 위를 건물 왼쪽 위에 둔다. 건물 범위를 모르면 1px = 1cm', () => {
    const bg = initialBackground(img, { x0: 0, x1: 20, y0: 0, y1: 8 })
    expect(bg.scale).toBe(0.02)
    expect(backgroundCorners(bg)).toEqual([[0, 8], [20, 8], [20, -2], [0, -2]])
    expect(initialBackground(img, null)).toMatchObject({ scale: 0.01, origin: [0, 0] })
  })

  it('두 점을 찍어 실제 거리를 넣으면 첫 점을 두고 스케일이 맞는다 [OE-MAN-02#1~]', () => {
    const bg = initialBackground(img, { x0: 0, x1: 20, y0: 0, y1: 8 })
    // 이미지에서 (2,4)~(6,4) 로 4m 인 선이 실제로는 10m 다.
    const fixed = calibrateScale(bg, [2, 4], [6, 4], 10)!
    expect(fixed.scale).toBeCloseTo(0.05, 12)
    // 첫 점은 그대로이고, 원점은 첫 점에서 2.5 배 멀어진다.
    expect(fixed.origin[0]).toBeCloseTo(2 + (0 - 2) * 2.5, 12)
    expect(fixed.origin[1]).toBeCloseTo(4 + (8 - 4) * 2.5, 12)
    expect(calibrateScale(bg, [2, 4], [2, 4], 10)).toBeNull()
    expect(calibrateScale(bg, [2, 4], [6, 4], 0)).toBeNull()
    expect(calibrateScale(bg, [2, 4], [6, 4], Number.NaN)).toBeNull()
  })

  it('한 점을 찍어 실제 좌표를 넣으면 그만큼 옮긴다. 스케일은 그대로다 [OE-MAN-02#1~]', () => {
    const bg = initialBackground(img, { x0: 0, x1: 20, y0: 0, y1: 8 })
    const moved = anchorBackground(bg, [3, 5], [0, 0])
    expect(moved.origin).toEqual([-3, 3])
    expect(moved.scale).toBe(bg.scale)
  })

  it('PDF 의 다른 쪽으로 바꾸면 왼쪽 위와 종이 위 축척(1pt 가 몇 m)을 그대로 두고, 종이 크기가 달라도 같은 축척이다 [OE-MAN-02#1~]', () => {
    // A3 가로(1191×842pt)를 4096px 로 그렸다: 1pt = 3.44px. 스케일을 맞춰 1px = 5mm.
    const a3 = { ...initialBackground({ ...img, width: 4096, height: 2896 }, null), scale: 0.005, origin: [2, 30] as [number, number], pdf: { page: 1, pages: 3, pxPerPt: 4096 / 1191 } }
    const metersPerPt = a3.scale * a3.pdf.pxPerPt
    // 2쪽은 A1 가로(2384×1684pt)라 같은 4096px 에 더 작게 그려진다: 1pt = 1.72px.
    const a1 = switchPdfPage(a3, { url: 'blob:y', width: 4096, height: 2893, page: 2, pages: 3, pxPerPt: 4096 / 2384 })
    expect(a1.origin).toEqual([2, 30])
    expect(a1.scale * a1.pdf!.pxPerPt).toBeCloseTo(metersPerPt, 12)
    expect(a1).toMatchObject({ url: 'blob:y', width: 4096, height: 2893, pdf: { page: 2, pages: 3 }, opacity: a3.opacity, name: a3.name })
  })
})
