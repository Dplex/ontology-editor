import { describe, expect, it } from 'vitest'
import { storeyHeights } from './storey-height'

const storey = (id: string, elevation: number, declaredHeight?: { gross: number | null; net: number | null; property: string }) => ({
  id,
  elevation,
  ...(declaredHeight ? { declaredHeight } : {}),
})

describe('층고 (OE-BIM-02)', () => {
  it('BIM 이 안 적으면 윗층 바닥과의 차를 계산하고, 맨 위층은 모른다', () => {
    const h = storeyHeights([storey('1F', 0), storey('2F', 3.1), storey('Roof', 6)])
    expect(h.get('1F')).toMatchObject({ value: 3.1, source: 'calc', calc: 3.1, mismatch: false })
    expect(h.get('2F')).toMatchObject({ value: 2.9, source: 'calc' })
    expect(h.get('Roof')).toBeNull()
  })

  it('BIM 이 적었으면 그 값을 쓰고 출처를 남긴다. 맨 위층도 BIM 이 적었으면 안다(AC20 다락 2.0m)', () => {
    const h = storeyHeights([
      storey('EG', 0, { gross: 2.7, net: 2.7, property: 'BaseQuantities.GrossHeight' }),
      storey('DG', 2.7, { gross: 2, net: 2, property: 'BaseQuantities.GrossHeight' }),
    ])
    expect(h.get('EG')).toEqual({ value: 2.7, source: 'bim', property: 'BaseQuantities.GrossHeight', calc: 2.7, net: 2.7, mismatch: false })
    expect(h.get('DG')).toMatchObject({ value: 2, source: 'bim', calc: null, mismatch: false })
  })

  it('BIM 값과 계산이 1cm 넘게 다르면 BIM 값을 쓰되 어긋남을 알린다', () => {
    const h = storeyHeights([storey('1F', 0, { gross: 4, net: null, property: 'x' }), storey('2F', 4.57)])
    expect(h.get('1F')).toMatchObject({ value: 4, source: 'bim', calc: 4.57, mismatch: true })
    // 5mm 는 반올림 차로 본다.
    expect(storeyHeights([storey('1F', 0, { gross: 4.565, net: null, property: 'x' }), storey('2F', 4.57)]).get('1F')!.mismatch).toBe(false)
  })

  it('순 높이만 적혀 있으면 층고는 계산하고 순 높이는 따로 둔다', () => {
    const h = storeyHeights([storey('1F', 0, { gross: null, net: 2.6, property: 'BaseQuantities.NetHeight' }), storey('2F', 3)])
    expect(h.get('1F')).toMatchObject({ value: 3, source: 'calc', net: 2.6 })
  })

  it('같은 높이에 층이 둘이면 그 위의 층까지 잰다(0 이 되지 않는다). 순서가 섞여 들어와도 같다', () => {
    const h = storeyHeights([storey('Roof', 6), storey('L1', 0), storey('FDN', 0), storey('L2', 3.1)])
    expect(h.get('FDN')).toMatchObject({ value: 3.1 })
    expect(h.get('L1')).toMatchObject({ value: 3.1 })
    expect(h.get('L2')).toMatchObject({ value: 2.9 })
  })

  it('피트를 미터로 바꾼 값의 끝자리가 새지 않는다', () => {
    const h = storeyHeights([storey('1F', 0), storey('2F', 10.17060367454068 * 0.3048)])
    expect(h.get('1F')!.value).toBe(3.1)
  })
})
