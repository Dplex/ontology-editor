import { describe, expect, it } from 'vitest'
import { doubleTap, EYE, nextStoreyEye } from './fly-storey'

// 성수 지상 몇 층과 지하 하나. 층 높이가 고르지 않다(1F 5m, 그 위 4.3m).
const storeys = [
  { id: 'B1F', elevation: -6 },
  { id: '1F', elevation: 0 },
  { id: '2F', elevation: 5 },
  { id: '3F', elevation: 10 },
  { id: 'RF', elevation: 14.3 },
]

describe('비행 모드의 층 이동 (E E · Q Q)', () => {
  it('지금 층 눈높이에서 위·아래 층 눈높이로 간다', () => {
    expect(nextStoreyEye(storeys, 0 + EYE, 1)).toMatchObject({ storey: { id: '2F' }, z: 5 + EYE })
    expect(nextStoreyEye(storeys, 0 + EYE, -1)).toMatchObject({ storey: { id: 'B1F' }, z: -6 + EYE })
  })

  it('손으로 조금 오르내린 뒤에도 지금 층으로 되돌아가지 않고 다음 층으로 간다', () => {
    expect(nextStoreyEye(storeys, 5 + EYE + 0.2, -1)?.storey.id).toBe('1F')
    expect(nextStoreyEye(storeys, 5 + EYE - 0.2, 1)?.storey.id).toBe('3F')
  })

  it('층 사이에 떠 있으면 위로는 바로 위층, 아래로는 바로 아래층이다', () => {
    expect(nextStoreyEye(storeys, 8, 1)?.storey.id).toBe('3F')
    expect(nextStoreyEye(storeys, 8, -1)?.storey.id).toBe('2F')
  })

  it('건물 위에 떠 있으면 아래로는 맨 위층, 맨 위·맨 아래에서는 더 가지 않는다', () => {
    expect(nextStoreyEye(storeys, 80, -1)?.storey.id).toBe('RF')
    expect(nextStoreyEye(storeys, 14.3 + EYE, 1)).toBeNull()
    expect(nextStoreyEye(storeys, -6 + EYE, -1)).toBeNull()
  })

  it('같은 키를 간격 안에 두 번 누르면 두 번 누름이고, 세 번째는 새 첫 누름이다', () => {
    const tap = doubleTap(280)
    expect(tap('KeyE', 0)).toBe(false)
    expect(tap('KeyE', 200)).toBe(true)
    expect(tap('KeyE', 300)).toBe(false)
    // 간격을 넘기거나 다른 키를 끼우면 아니다.
    expect(tap('KeyE', 700)).toBe(false)
    expect(tap('KeyQ', 800)).toBe(false)
    expect(tap('KeyE', 900)).toBe(false)
  })
})
