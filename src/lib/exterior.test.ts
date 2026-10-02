import { describe, expect, it } from 'vitest'
import { computeExternal, judgeExternal } from './exterior'
import { addWall } from './edit'
import type { Model, Space, Storey, Vec2, Wall } from './model'

// 외벽 판정(OE-EXT-01). 실제 BIM 정답 대조는 check:sample 이 한다(Duplex·병원 건축의 IsExternal). 여기서는 틀리기 쉬운
// 모양을 손으로 그려 본다 — 광선 하나로는 틀리는 ㄷ자 안쪽, 문 자리로 뚫린 외벽, 방과 벽 사이의 틈.

const T = 0.2

/** a→b 선분을 두께 T 로 감싼 벽. gaps 는 선분 위 [시작, 끝](m) 구간을 비운다(문 자리 — 벽 바닥 외곽선이 그렇게 읽힌다). */
function wall(id: string, a: Vec2, b: Vec2, gaps: [number, number][] = []): Wall {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len
  const nx = -uy * (T / 2), ny = ux * (T / 2)
  const pieces: [number, number][] = []
  let at = -T / 2
  for (const [s, e] of [...gaps].sort((p, q) => p[0] - q[0])) {
    pieces.push([at, s])
    at = e
  }
  pieces.push([at, len + T / 2])
  const ring = ([s, e]: [number, number]): Vec2[] => {
    const p = (t: number, k: number): Vec2 => [a[0] + ux * t + nx * k, a[1] + uy * t + ny * k]
    return [p(s, -1), p(e, -1), p(e, 1), p(s, 1), p(s, -1)]
  }
  return { id, name: id, thickness: T, loadBearing: null, footprint: pieces.filter(([s, e]) => e > s).map(ring) }
}

/** 벽 중심선 사각형 안의 방. Revit 방처럼 벽 면에서 5cm 떨어뜨린다. */
function room(id: string, x0: number, y0: number, x1: number, y1: number): Space {
  const d = T / 2 + 0.05
  const footprint: Vec2[] = [[x0 + d, y0 + d], [x1 - d, y0 + d], [x1 - d, y1 - d], [x0 + d, y1 - d], [x0 + d, y0 + d]]
  return { id, name: id, longName: id, footprint, areaM2: 0, boundedBy: [] }
}

const storeyOf = (walls: Wall[], spaces: Space[]): Storey => ({ id: 's', name: '1F', elevation: 0, spaces, walls, openings: [], equipment: [] })

/**
 * ㄷ자 건물. 아래 몸통(0~12 × 0~4)에 양 날개(0~4, 8~12 × 4~10)가 붙고, 가운데 4~8 × 4~10 은 바깥이다.
 * 안쪽 벽 inL·inR 은 서로 마주 본다 — 바깥으로 쏜 광선이 맞은편 날개에 막힌다.
 * 몸통 아래 외벽 south 에는 5~6m 에 문 자리가 뚫려 있고, 바로 옆 6m 에 몸통을 나누는 내벽 mid 가 있다.
 */
function uBuilding() {
  const walls = [
    wall('south', [0, 0], [12, 0], [[5, 6]]),
    wall('east', [12, 0], [12, 10]),
    wall('topR', [12, 10], [8, 10]),
    wall('inR', [8, 10], [8, 4]),
    wall('inBase', [8, 4], [4, 4]),
    wall('inL', [4, 4], [4, 10]),
    wall('topL', [4, 10], [0, 10]),
    wall('west', [0, 10], [0, 0]),
    wall('armL', [0, 4], [4, 4]),
    wall('armR', [8, 4], [12, 4]),
    wall('mid', [6.2, 0], [6.2, 4]),
  ]
  const spaces = [room('baseL', 0, 0, 6.2, 4), room('baseR', 6.2, 0, 12, 4), room('wingL', 0, 4, 4, 10), room('wingR', 8, 4, 12, 10)]
  return storeyOf(walls, spaces)
}

const EXTERNAL = ['south', 'east', 'topR', 'inR', 'inBase', 'inL', 'topL', 'west']
const INTERNAL = ['armL', 'armR', 'mid']

describe('외벽 판정(OE-EXT-01)', () => {
  it('ㄷ자 안쪽처럼 맞은편 날개를 마주 보는 벽도 바깥에 닿으면 외벽이다', () => {
    const got = computeExternal(uBuilding())
    for (const id of EXTERNAL) expect(got.get(id), id).toBe(true)
    for (const id of INTERNAL) expect(got.get(id), id).toBe(false)
  })

  it('외벽의 문 자리로 바깥이 들어와도 그 옆 내벽은 끝만 닿아 내벽이다 — 방과 벽 사이 5cm 틈으로 새지 않는다', () => {
    // mid 는 문 자리(5~6m) 바로 옆에서 south 에 붙는다. 틈을 못 메우면 바깥이 방 가장자리를 타고 mid 옆면까지 온다.
    expect(computeExternal(uBuilding()).get('mid')).toBe(false)
  })

  it('방이 하나도 없어도 벽만으로 판정한다', () => {
    // 문 자리가 없는 상자. 방 바닥이 없으면 문 자리를 막을 것이 없지만, 벽 하나의 문 자리는 볼록 껍질이 메운다.
    const box = storeyOf(
      [wall('a', [0, 0], [6, 0], [[2, 3]]), wall('b', [6, 0], [6, 5]), wall('c', [6, 5], [0, 5]), wall('d', [0, 5], [0, 0]), wall('x', [3, 0], [3, 5])],
      [],
    )
    const got = computeExternal(box)
    expect([...got].filter(([, v]) => v).map(([k]) => k).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('BIM 이 말한 값이 계산보다 앞선다 — 바깥에 닿아도 IsExternal=false 면 내벽, 출처 BIM', () => {
    const storey = uBuilding()
    storey.walls.find((w) => w.id === 'east')!.external = false
    storey.walls.find((w) => w.id === 'mid')!.external = true
    const got = judgeExternal(storey)
    expect(got.get('east')).toEqual({ external: false, source: 'bim' })
    expect(got.get('mid')).toEqual({ external: true, source: 'bim' })
    expect(got.get('west')).toEqual({ external: true, source: 'calc' })
    expect(got.get('armL')).toEqual({ external: false, source: 'calc' })
  })

  it('바닥 외곽선이 없는 벽은 계산하지 못해 모름으로 남는다(값을 지어내지 않는다)', () => {
    const storey = uBuilding()
    storey.walls.push({ id: 'noShape', name: 'x', thickness: null, loadBearing: null })
    expect(judgeExternal(storey).has('noShape')).toBe(false)
  })

  it('편집으로 더한 벽도 다음 판정에 바로 들어간다 — 모델에 저장하지 않아 묵은 값이 남지 않는다', () => {
    const storey = uBuilding()
    const model: Model = { schema: 'IFC4', siteName: '', buildingId: 'b', buildingName: '', storeys: [storey], systems: [], connections: [], warnings: [] }
    // 건물 밖 마당에 홀로 선 담. 양쪽이 다 바깥이다.
    const fence = addWall(model, 's', [20, 0], [20, 6])
    expect(fence && 'id' in fence).toBe(true)
    const got = judgeExternal(storey).get((fence as Wall).id)
    expect(got).toEqual({ external: true, source: 'calc' })
  })

  it('벽 옆면이 바깥에 닿은 몫이 30% 를 넘어야 외벽이다 — 앞에 별채가 붙어 반만 드러난 벽은 외벽, 거의 가려진 벽은 내벽', () => {
    // 방(0~10 × 0~4) 남쪽 벽 앞에 별채 방이 붙는다. 별채 폭으로 남쪽 벽이 바깥에 드러나는 몫을 바꾼다.
    const judge = (annexTo: number) => {
      const walls = [wall('south', [0, 0], [10, 0]), wall('east', [10, 0], [10, 4]), wall('north', [10, 4], [0, 4]), wall('west', [0, 4], [0, 0])]
      const annex: Space = { id: 'annex', name: 'annex', longName: 'annex', footprint: [[-0.1, -4], [annexTo, -4], [annexTo, -0.15], [-0.1, -0.15], [-0.1, -4]], areaM2: 0, boundedBy: [] }
      return computeExternal(storeyOf(walls, [room('main', 0, 0, 10, 4), annex])).get('south')
    }
    expect(judge(-0.1)).toBe(true) // 다 드러남
    expect(judge(5)).toBe(true) // 반쯤
    expect(judge(8.5)).toBe(false) // 15% 쯤
  })
})
