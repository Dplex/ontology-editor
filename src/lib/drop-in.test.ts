import { describe, expect, it } from 'vitest'
import { dropPose, poseVertices, shakeOffset, sinkPose } from './drop-in'

describe('놓을 때 떨어져 앉기', () => {
  it('작게 나타나 떠올랐다가 끝에서는 제 크기·제자리다', () => {
    const start = dropPose(0, 1)
    expect(start.scale).toBeCloseTo(0.45)
    expect(start.lift).toBe(0)
    expect(dropPose(1, 1)).toEqual({ scale: 1, lift: 0, sy: 1, sxz: 1 })
    expect(dropPose(1.4, 1)).toEqual({ scale: 1, lift: 0, sy: 1, sxz: 1 })
    // 가장 높이 뜬 때(나타나기 끝)는 큰 변의 절반, 바닥에 닿은 뒤로는 뜨지 않는다.
    expect(dropPose(0.22, 1).lift).toBeCloseTo(0.5)
    for (const t of [0.56, 0.7, 0.9]) expect(dropPose(t, 1).lift).toBe(0)
  })

  it('떠오르는 높이는 0.2~0.6m 다', () => {
    expect(dropPose(0.22, 0.1).lift).toBeCloseTo(0.2)
    expect(dropPose(0.22, 30).lift).toBeCloseTo(0.6)
  })

  it('닿은 뒤 한 번 눌렸다(높이 줄고 폭 늘고) 돌아온다', () => {
    const squash = [0.6, 0.65, 0.7, 0.75].map((t) => dropPose(t, 1))
    expect(Math.min(...squash.map((p) => p.sy))).toBeLessThan(0.95)
    expect(Math.max(...squash.map((p) => p.sxz))).toBeGreaterThan(1.03)
    expect(dropPose(0.999, 1).sy).toBeCloseTo(1, 1)
  })

  it('꼭짓점은 바닥 가운데를 기준으로 줄고 뜬다 — 바닥 가운데는 떠오른 만큼만 움직인다', () => {
    // 바닥 가운데(0, 0, 0)와 윗면 모서리(1, 2, 1)
    const base = new Float32Array([0, 0, 0, 1, 2, 1])
    const out = new Float32Array(6)
    const pose = { scale: 0.5, lift: 0.3, sy: 1, sxz: 1 }
    poseVertices(base, out, [0, 0, 0], pose)
    ;[0, 0.3, 0, 0.5, 1.3, 0.5].forEach((v, i) => expect(out[i]).toBeCloseTo(v))
    poseVertices(base, out, [0, 0, 0], dropPose(1, 1))
    expect([...out]).toEqual([...base])
  })
})

describe('지울 때 가라앉기 · 막혔을 때 흔들기', () => {
  it('가라앉기는 제 모양에서 시작해 줄며 내려가고 끝에서 다 흐려진다', () => {
    expect(sinkPose(0, 1)).toEqual({ scale: 1, lift: -0, opacity: 1 })
    const mid = sinkPose(0.5, 1)
    expect(mid.scale).toBeCloseTo(0.7)
    expect(mid.lift).toBeLessThan(0)
    expect(mid.opacity).toBeGreaterThan(0)
    const end = sinkPose(1, 1)
    expect(end.opacity).toBe(0)
    expect(end.lift).toBeCloseTo(-0.5)
    expect(sinkPose(1, 10).lift).toBeCloseTo(-0.6)
  })

  it('흔들기는 제자리에서 시작해 제자리로 끝나고, 폭은 4~12cm 다', () => {
    expect(shakeOffset(0, 1)).toBeCloseTo(0)
    expect(shakeOffset(1, 1)).toBe(0)
    const samples = Array.from({ length: 50 }, (_, i) => shakeOffset(i / 50, 0.1))
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.04)
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => Math.abs(shakeOffset(i / 50, 30))))).toBeLessThanOrEqual(0.12)
    // 좌우로 오간다
    expect(samples.some((v) => v > 0.01) && samples.some((v) => v < -0.01)).toBe(true)
  })
})
