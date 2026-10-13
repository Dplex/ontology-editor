// 덕트·배관 조각을 지울 때의 영향(OE-PIP-10). 공조기 — 덕트1 — 티 — 덕트2 — 디퓨저1, 티 — 덕트3 — 디퓨저2.
import { describe, expect, it } from 'vitest'
import { removalImpact } from './removal-impact'
import { deleteEquipment } from './edit'
import type { Equipment, Model } from './model'

const eq = (id: string, role: Equipment['role']): Equipment => ({ id, name: id, ifcClass: 'X', role, position: [0, 0, 0], capacity: null, systemId: null, spaceId: null, spaceSource: null }) as unknown as Equipment
const link = (from: string, to: string) => ({ from, to, source: 'port', directed: true, tolerance: null })
function tee(): Model {
  return {
    storeys: [{ id: 'S', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [eq('AHU', 'conversion'), eq('D1', 'segment'), eq('TEE', 'fitting'), eq('D2', 'segment'), eq('DIF1', 'terminal'), eq('D3', 'segment'), eq('DIF2', 'terminal')] }],
    systems: [],
    connections: [link('AHU', 'D1'), link('D1', 'TEE'), link('TEE', 'D2'), link('D2', 'DIF1'), link('TEE', 'D3'), link('D3', 'DIF2')],
  } as unknown as Model
}

describe('조각을 지울 때의 영향 (OE-PIP-10)', () => {
  it('공조기 쪽 덕트를 지우면 공조기와 디퓨저 둘이 두 갈래로 나뉜다', () => {
    expect(removalImpact(tee(), 'D1')).toEqual({ pieces: [{ devices: ['DIF1', 'DIF2'], conduits: 3 }, { devices: ['AHU'], conduits: 0 }] })
  })

  it('한 가지의 덕트를 지우면 그 가지의 디퓨저만 떨어지고, 다른 가지는 공조기와 이어진 채다 [OE-PIP-10#6]', () => {
    const m = tee()
    expect(removalImpact(m, 'D3')).toEqual({ pieces: [{ devices: ['AHU', 'DIF1'], conduits: 3 }, { devices: ['DIF2'], conduits: 0 }] })
    deleteEquipment(m, 'D3')
    // 다른 가지의 연결은 그대로다.
    expect(m.connections.map((c) => `${c.from}-${c.to}`)).toEqual(['AHU-D1', 'D1-TEE', 'TEE-D2', 'D2-DIF1'])
  })

  it('고리처럼 다른 길로 이어져 있으면 갈래가 하나다', () => {
    const m = tee()
    m.connections.push(link('DIF2', 'D1') as never)
    expect(removalImpact(m, 'D3')!.pieces).toHaveLength(1)
  })

  it('끝에 매달린 조각은 갈래가 하나고, 이웃이 없으면 갈래가 없다', () => {
    const m = tee()
    m.connections = m.connections.filter((c) => c.to !== 'DIF2')
    expect(removalImpact(m, 'D3')!.pieces).toEqual([{ devices: ['AHU', 'DIF1'], conduits: 3 }])
    expect(removalImpact(m, 'DIF2')).toEqual({ pieces: [] })
    expect(removalImpact(m, 'nope')).toBeNull()
  })
})
