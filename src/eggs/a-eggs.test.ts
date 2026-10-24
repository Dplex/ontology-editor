import { BoxGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, ShaderMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import type { Model } from '../lib/model'
import { JITTER, SAMPLES } from './refine'
import { DROP_MS, LIFT_M, liftAt, riseDuration, riseLevels, STAGGER_MS } from './rise'
import { castsContact } from './shadow'
import { coverRadius } from './wipe'

// A 등급 넷(refine·shadow·rise·wipe)의 계산. 화면에서 도는 것은 e2e/eggs.spec.ts 가 잰다.
describe('A 등급 egg 의 계산', () => {
  it('refine — 8장의 흔들기는 서로 다르고 1픽셀 안이며, 첫 장은 흔들지 않는다', () => {
    expect(JITTER).toHaveLength(SAMPLES)
    expect(JITTER[0]).toEqual([0, 0])
    for (const [x, y] of JITTER) {
      expect(Math.abs(x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(y)).toBeLessThanOrEqual(0.5)
    }
    expect(new Set(JITTER.map((j) => j.join(','))).size).toBe(SAMPLES)
  })

  it('shadow — 불투명·반쯤 비치는 메시는 찍고, 아주 옅은 것·선·직접 쓴 셰이더·제 판은 찍지 않는다', () => {
    const geo = new BoxGeometry()
    const own = new Mesh(geo, new MeshBasicMaterial())
    expect(castsContact(new Mesh(geo, new MeshBasicMaterial()), own)).toBe(true)
    expect(castsContact(new Mesh(geo, new MeshBasicMaterial({ transparent: true, opacity: 0.35 })), own)).toBe(true)
    expect(castsContact(new Mesh(geo, new MeshBasicMaterial({ transparent: true, opacity: 0.08 })), own)).toBe(false)
    expect(castsContact(new Mesh(geo, new ShaderMaterial()), own)).toBe(false)
    expect(castsContact(new LineSegments(geo, new LineBasicMaterial()), own)).toBe(false)
    expect(castsContact(own, own)).toBe(false)
  })

  it('rise — 층 높이 순으로 단을 나누고(같은 높이는 한 단), 맨 아래 단부터 0.08초 간격으로 0.4m 에서 0 으로 내려앉는다', () => {
    const storey = (id: string, elevation: number) => ({ id, elevation }) as Model['storeys'][number]
    const model = { storeys: [storey('b', 3), storey('a', 0), storey('c', 3), storey('d', 6.5)] } as unknown as Model
    expect(riseLevels(model)).toEqual([0, 3, 6.5])
    expect(riseDuration(3)).toBe(2 * STAGGER_MS + DROP_MS)
    expect(liftAt(0, 0)).toBeCloseTo(LIFT_M)
    expect(liftAt(1, STAGGER_MS)).toBeCloseTo(LIFT_M)
    expect(liftAt(0, DROP_MS)).toBe(0)
    expect(liftAt(2, riseDuration(3))).toBe(0)
    // 내려앉는 동안 높이는 줄기만 한다.
    const path = Array.from({ length: 20 }, (_, i) => liftAt(1, STAGGER_MS + (i * DROP_MS) / 19))
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeLessThanOrEqual(path[i - 1])
  })

  it('wipe — 원은 단추 자리에서 화면 네 귀퉁이 중 가장 먼 곳까지 퍼진다', () => {
    expect(coverRadius(0, 0, 300, 400)).toBe(500)
    expect(coverRadius(1400, 20, 1440, 900)).toBeCloseTo(Math.hypot(1400, 880))
  })
})

describe('B 등급 egg 의 계산', () => {
  it('banner — 층 수만큼 줄을 쌓고 층·물리존·기기 수를 적으며 마지막 줄은 ~ 안내다', async () => {
    const { bannerLines } = await import('./banner')
    const storey = (n: number) => ({ id: `s${n}`, elevation: n * 3, spaces: [{}, {}], equipment: [{ role: 'terminal' }, { role: 'segment' }], walls: [], openings: [] })
    const model = { storeys: [storey(0), storey(1), storey(2)], systems: [], connections: [] } as unknown as Model
    const lines = bannerLines(model, 'a.ifc')
    expect(lines.filter((l) => l.includes('▪'))).toHaveLength(3)
    expect(lines.join('\n')).toContain('층 3 · 물리존 6 · 기기 3')
    expect(lines.at(-1)).toBe('~ 를 눌러 보세요')
  })
})
