// 스냅(OE-UI-06). 합성 층: 물리존 S(0~10 × 0~8)와 그 안의 벽 W(x 4~4.2, y 0~8).
import { describe, expect, it } from 'vitest'
import type { Model, Space, Wall } from './model'
import { DEFAULT_SNAP, snapPoint, snapTargets } from './snap'

const space = { id: 'S', name: '101', longName: '사무실', footprint: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]] } as unknown as Space
const wall: Wall = { id: 'W', name: '벽 W', thickness: 0.2, loadBearing: false, footprint: [[[4, 0], [4.2, 0], [4.2, 8], [4, 8]]] }
const model = (): Model =>
  ({ storeys: [{ id: '1F', name: '1F', elevation: 0, spaces: [space], walls: [wall], openings: [], equipment: [] }] }) as unknown as Model

const on = { ...DEFAULT_SNAP, on: true, radius: 0.3 }
const gridOff = { on: false, spacing: 0.5 }
const gridOn = { on: true, spacing: 0.5 }

describe('스냅 (OE-UI-06)', () => {
  const targets = snapTargets(model(), '1F')

  it('켜면 변 가까이 찍은 점이 변 위로 붙고, 끄면 찍은 자리 그대로다 [OE-UI-06#1]', () => {
    expect(snapPoint([6.13, 0.2], targets, on, gridOff)).toMatchObject({ kind: 'edge', at: [6.13, 0], target: { id: 'S' } })
    // 벽의 바깥 면(x=4.2)에 가까우면 그 면에 붙는다.
    expect(snapPoint([4.35, 3.31], targets, on, gridOff)).toMatchObject({ kind: 'edge', at: [4.2, 3.31], target: { id: 'W' } })
    expect(snapPoint([6.13, 0.2], targets, { ...on, on: false }, gridOff)).toBeNull()
    // 반경 밖이면 붙지 않는다.
    expect(snapPoint([6.13, 0.5], targets, on, gridOff)).toBeNull()
  })

  it('꼭짓점이 반경 안이면 변보다 꼭짓점에 붙는다. 붙은 대상과 자리를 짚을 수 있게 돌려준다 [OE-UI-06#2]', () => {
    const hit = snapPoint([9.85, 7.9], targets, on, gridOff)
    expect(hit).toMatchObject({ kind: 'vertex', at: [10, 8], target: { id: 'S', label: '사무실' } })
    const edge = snapPoint([2, 7.8], targets, on, gridOff)
    expect(edge?.kind === 'edge' && edge.edge).toEqual([[10, 8], [0, 8]])
  })

  it('그리드와 같이 켜져 있으면 반경 안의 오브젝트가 앞서고, 없을 때만 그리드 교점으로 간다 [OE-UI-06#3] [OE-UI-07#1~]', () => {
    // (6.13, 0.2): 그리드 교점 (6, 0) 도 반경 0.3 안이지만 변 위 (6.13, 0) 이 앞선다.
    expect(snapPoint([6.13, 0.2], targets, on, gridOn)).toMatchObject({ kind: 'edge', at: [6.13, 0] })
    expect(snapPoint([6.13, 2.2], targets, on, gridOn)).toEqual({ kind: 'grid', at: [6, 2] })
    expect(snapPoint([6.13, 2.2], targets, { ...on, on: false }, gridOn)).toEqual({ kind: 'grid', at: [6, 2] })
  })

  it('고치고 있는 오브젝트는 빼고 찾는다', () => {
    const others = snapTargets(model(), '1F', new Set(['S']))
    expect(snapPoint([6.13, 0.2], others, on, gridOff)).toBeNull()
    expect(snapPoint([4.1, 0.1], others, on, gridOff)).toMatchObject({ target: { id: 'W' } })
  })
})
