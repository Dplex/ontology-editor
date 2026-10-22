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

  it("'으로/로' 는 받침이 없거나 ㄹ 받침이면 '로' 다", () => {
    expect(josa('편집자', '으로/로')).toBe('로')
    expect(josa('보기 전용', '으로/로')).toBe('으로')
    expect(josa('서울', '으로/로')).toBe('로')
    expect(josa('Hall', '으로/로')).toBe('로')
    expect(josa('Room', '으로/로')).toBe('으로')
    expect(josa('AHU', '으로/로')).toBe('로')
    expect(josa('L', '으로/로')).toBe('로')
    expect(josa('7', '으로/로')).toBe('로')
    expect(josa('3', '으로/로')).toBe('으로')
    expect(josa('#', '으로/로')).toBe('으로(로)')
  })
})
