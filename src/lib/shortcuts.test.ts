import { describe, expect, it } from 'vitest'
import { matchShortcut, SHORTCUT_GROUPS, SHORTCUTS, snapAxis } from './shortcuts'

const key = (code: string, extra: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  code,
  key: extra.key ?? '',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
})

describe('단축키 맞추기', () => {
  it('글자 키는 자판 위치로 맞춘다 — 한글 입력 상태(ㄹ)에서도 F 다', () => {
    expect(matchShortcut(key('KeyF', { key: 'ㄹ' }))?.id).toBe('frame')
    expect(matchShortcut(key('KeyF', { key: 'F', shiftKey: true }))?.id).toBe('frameAll')
  })

  it('? 는 안내, Shift 없는 / 는 찾기다', () => {
    expect(matchShortcut(key('Slash', { key: '?', shiftKey: true }))?.id).toBe('help')
    expect(matchShortcut(key('Slash', { key: '/' }))?.id).toBe('search')
    // 다른 자판에서 ? 가 다른 자리에 있어도 글자로 받는다.
    expect(matchShortcut(key('Minus', { key: '?', shiftKey: true }))?.id).toBe('help')
  })

  it('Ctrl 과 ⌘ 는 같고, Shift 로 되돌리기와 다시 하기를 가른다', () => {
    expect(matchShortcut(key('KeyZ', { ctrlKey: true }))?.id).toBe('undo')
    expect(matchShortcut(key('KeyZ', { metaKey: true }))?.id).toBe('undo')
    expect(matchShortcut(key('KeyZ', { ctrlKey: true, shiftKey: true }))?.id).toBe('redo')
    expect(matchShortcut(key('KeyY', { ctrlKey: true }))?.id).toBe('redo')
    // Ctrl 없는 Z 는 아무것도 아니다. Ctrl+F(브라우저 찾기)를 뺏지 않는다.
    expect(matchShortcut(key('KeyZ'))).toBe(null)
    expect(matchShortcut(key('KeyF', { ctrlKey: true }))).toBe(null)
  })

  it('Alt 가 섞이면 받지 않는다', () => {
    expect(matchShortcut(key('KeyE', { altKey: true }))).toBe(null)
  })

  it('방향키는 Shift 를 눌러도 같은 단축키다(한 칸 크기만 다르다)', () => {
    expect(matchShortcut(key('ArrowUp'))?.id).toBe('nudge')
    expect(matchShortcut(key('ArrowUp', { shiftKey: true }))?.id).toBe('nudge')
  })

  it('한 조합이 두 단축키에 걸리지 않는다', () => {
    const seen = new Map<string, string>()
    for (const s of SHORTCUTS) {
      for (const c of s.combos) {
        const shifts = c.shift === 'any' ? [false, true] : [c.shift ?? false]
        for (const shift of shifts) {
          const id = `${c.code ?? `key:${c.key}`}|${c.ctrl ?? false}|${shift}`
          expect(seen.get(id), id).toBeUndefined()
          seen.set(id, s.id)
        }
      }
    }
  })

  it('모든 단축키가 안내의 어느 무리엔가 들어 있다', () => {
    for (const s of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(s.group)
  })
})

describe('화면 방향을 평면 축으로', () => {
  it('가까운 축 하나로 맞춘다', () => {
    expect(snapAxis(0.9, 0.3)).toEqual([1, 0])
    expect(snapAxis(-0.2, -0.7)).toEqual([0, -1])
    expect(snapAxis(0, 0)).toEqual([0, 0])
  })
})
