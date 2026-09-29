import { describe, expect, it } from 'vitest'
import { josa } from './josa'

describe('josa — 이름 뒤 조사', () => {
  it('한글은 받침으로, 숫자·영문은 읽는 소리로 고른다', () => {
    expect(josa('사무실', '을/를')).toBe('을')
    expect(josa('급기', '을/를')).toBe('를')
    expect(josa('OFFICE', '을/를')).toBe('를')
    expect(josa('FCU3 #958283', '을/를')).toBe('을')
    expect(josa('FCU-9', '을/를')).toBe('를')
    expect(josa('새 물리존 1', '을/를')).toBe('을')
    expect(josa('Machine Room', '을/를')).toBe('을')
    expect(josa('Stair', '을/를')).toBe('를')
    expect(josa('Parking', '이/가')).toBe('이')
    expect(josa('EPS', '은/는')).toBe('는')
    expect(josa('Hall', '과/와')).toBe('과')
    expect(josa('(A)', '을/를')).toBe('를')
    expect(josa('#', '을/를')).toBe('을(를)')
  })
})
