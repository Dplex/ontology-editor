import { describe, expect, it } from 'vitest'
import { labelBadges, placeLabels } from './equipment-labels'

describe('3D 설비 라벨', () => {
  it('소속·종류 배지는 출처를 화면의 출처 칩과 같은 낱말로 보이고, 없으면 경고다', () => {
    expect(labelBadges({ spaceId: 's', spaceSource: 'bim', kind: 'fcu', kindSource: 'bim' })).toMatchObject({ space: { text: '소속 BIM', tone: 'ok' }, kind: { text: '종류 BIM' } })
    expect(labelBadges({ spaceId: 's', spaceSource: 'computed', kind: 'fcu', kindSource: 'dict' })).toMatchObject({ space: { text: '소속 계산' }, kind: { text: '종류 사전', tone: 'muted' } })
    expect(labelBadges({ spaceId: null, spaceSource: null, kind: null })).toMatchObject({ space: { text: '소속 없음', tone: 'warn' }, kind: { text: '종류 모름', tone: 'warn' } })
    // 소속이 없어도 TTL 에는 층이 hasLocation 으로 나간다(export.test.ts "방을 못 찾은 설비는 … 층을"). 안 나간다고 적었었다.
    expect(labelBadges({ spaceId: null, spaceSource: null, kind: null }).space.title).toContain('방 대신 층이 나갑니다')
    expect(labelBadges({ spaceId: 's', spaceSource: 'edit', kind: 'fan', kindSource: 'dict', kindEdited: { from: null } })).toMatchObject({ space: { text: '소속 사람' }, kind: { text: '종류 사람' } })
  })

  it('겹치면 뒤의 것을 빼고, 고른 것이 먼저이며, 가운데에 가까운 순이고, max 개까지다', () => {
    const c = { x: 100, y: 100 }
    const at = (id: string, x: number, y: number, first = false) => ({ id, x, y, w: 80, h: 20, first })
    // a·b 는 겹친다. 가운데에 가까운 a 가 남는다.
    expect(placeLabels([at('b', 130, 110), at('a', 100, 100), at('far', 400, 400)], c, 10).map((l) => l.id)).toEqual(['a', 'far'])
    // 고른 것은 멀어도 먼저다 — 겹치는 가까운 것이 빠진다.
    expect(placeLabels([at('a', 100, 100), at('sel', 130, 110, true)], c, 10).map((l) => l.id)).toEqual(['sel'])
    expect(placeLabels([at('a', 0, 0), at('b', 200, 0), at('c', 400, 0)], c, 2)).toHaveLength(2)
  })
})
