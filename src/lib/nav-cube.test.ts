import { describe, expect, it } from 'vitest'
import { cubeDirection } from './nav-cube'

// 방향 큐브에서 누른 자리 → 시점 방향. 큐브 한 변 1, 가운데가 원점. 장면 좌표(y 가 위).
describe('방향 큐브 누른 자리', () => {
  it('면 한가운데는 그 축 하나, 모서리는 두 축, 꼭짓점은 세 축이다', () => {
    expect(cubeDirection([0, 0.5, 0])).toEqual([0, 1, 0])
    expect(cubeDirection([0.1, -0.5, 0.05])).toEqual([0, -1, 0])
    expect(cubeDirection([0.5, 0.45, 0])).toEqual([1, 1, 0])
    expect(cubeDirection([-0.5, 0.42, 0.44])).toEqual([-1, 1, 1])
  })
  it('면 안쪽이면 가장 바깥 축 하나다 — 경계 근처에서 흔들려도 면으로 친다', () => {
    expect(cubeDirection([0.29, 0.29, 0.5])).toEqual([0, 0, 1])
  })
})
