import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { flowDistances, flowPulseMesh } from './flow-pulse'

describe('flowDistances', () => {
  it('원천에서 흐름을 따라 거리를 누적한다. 마디마다 0 에서 다시 세지 않는다', () => {
    const d = flowDistances([
      { from: 'ahu', to: 'duct', len: 3 },
      { from: 'duct', to: 'vav', len: 2 },
    ])
    expect(Object.fromEntries(d)).toEqual({ ahu: 0, duct: 3, vav: 5 })
  })

  it('두 길로 닿는 것은 가까운 길의 거리다', () => {
    const d = flowDistances([
      { from: 'src', to: 'a', len: 1 },
      { from: 'a', to: 'end', len: 10 },
      { from: 'src', to: 'end', len: 4 },
    ])
    expect(d.get('end')).toBe(4)
  })

  it('원천이 없는 고리(순환 배관)도 거리를 갖는다', () => {
    const d = flowDistances([
      { from: 'a', to: 'b', len: 1 },
      { from: 'b', to: 'c', len: 1 },
      { from: 'c', to: 'a', len: 1 },
    ])
    expect([...d.values()].sort()).toEqual([0, 1, 2])
  })
})

describe('flowPulseMesh', () => {
  it('길이가 없는 연결은 빼고, 남은 것이 없으면 그리지 않는다', () => {
    const p = new Vector3(1, 2, 3)
    expect(flowPulseMesh([{ from: 'a', to: 'b', strong: true, a: p, b: p.clone() }], 0xff0000, false)).toBeNull()
    const mesh = flowPulseMesh(
      [
        { from: 'a', to: 'b', strong: true, a: new Vector3(0, 0, 0), b: new Vector3(2, 0, 0) },
        { from: 'b', to: 'c', strong: false, a: new Vector3(2, 0, 0), b: new Vector3(2, 0, 3) },
      ],
      0xff0000,
      false,
    )!
    expect(mesh.userData.flowSegments).toBe(2)
    // 두 번째 연결의 꼭짓점 거리는 첫 연결 끝(2m)에서 이어진다.
    const along = mesh.geometry.getAttribute('aDist').array as Float32Array
    expect(Math.min(...along.slice(12))).toBe(2)
    expect(Math.max(...along)).toBe(5)
  })
})
