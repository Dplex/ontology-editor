import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { sha256 } from './secure-shim'

const hex = (b: ArrayBuffer) => Buffer.from(b).toString('hex')

describe('secure-shim sha256 (사내망 IP 로 연 공유 사이트용)', () => {
  it('node crypto 와 같은 값을 낸다 — 빈 값 · 블록 경계 · 한글 · 큰 값', () => {
    const cases = [new Uint8Array(0), new Uint8Array(55), new Uint8Array(56), new Uint8Array(64), new TextEncoder().encode('온톨로지 구축 리포트'), Uint8Array.from({ length: 200_003 }, (_, i) => (i * 31) & 255)]
    for (const c of cases) expect(hex(sha256(c))).toBe(createHash('sha256').update(c).digest('hex'))
  })
})
