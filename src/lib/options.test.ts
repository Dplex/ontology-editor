import { describe, expect, it } from 'vitest'
import { narrowOptions } from './options'

// 성수는 계통이 1,037개다. 설비 패널의 계통 상자에서 찾기 칸으로 줄이고, 너무 많으면 앞의 것만 보인다.
const many = Array.from({ length: 1037 }, (_, i) => ({ id: `S${i}`, label: `기계 급기 ${i} · 급기` }))

describe('긴 목록 줄이기', () => {
  it('찾는 말에 안 맞아도 지금 고른 계통은 남긴다 — 빠지면 상자가 첫 줄을 고른 것처럼 보인다', () => {
    const r = narrowOptions(many, '급기 12', 'S900', 200)
    expect(r.options.some((o) => o.id === 'S900')).toBe(true)
    expect(r.options.every((o) => o.label.includes('급기 12') || o.id === 'S900')).toBe(true)
  })

  it('앞의 것만 보일 때도 지금 고른 계통이 뒤쪽이면 맨 앞에 붙인다', () => {
    const r = narrowOptions(many, '', 'S1000', 200)
    expect(r.options[0].id).toBe('S1000')
    expect(r.options).toHaveLength(201)
    expect(r.hidden).toBe(837)
  })

  it('대소문자와 앞뒤 빈칸은 가리지 않는다', () => {
    const r = narrowOptions([{ id: 'a', label: 'Hydronic Supply 1' }, { id: 'b', label: 'Mechanical Exhaust Air 3' }], '  HYDRONIC ', null, 200)
    expect(r.options.map((o) => o.id)).toEqual(['a'])
  })
})
