import { describe, expect, it } from 'vitest'
import type { Model } from '../lib/model'
import { DROP_MS, LIFT_M, liftAt, riseDuration, riseLevels, riseLift, STAGGER_MS } from './rise'
import { coverRadius } from './wipe'

// A 등급 둘(rise·wipe)의 계산. 화면에서 도는 것은 e2e/eggs.spec.ts 가 잰다.
describe('A 등급 egg 의 계산', () => {
  it('rise — 층 높이 순으로 단을 나누고(같은 높이는 한 단), 맨 아래 단부터 0.08초 간격으로 한 층 높이에서 0 으로 내려앉는다', () => {
    const storey = (id: string, elevation: number) => ({ id, elevation }) as Model['storeys'][number]
    const model = { storeys: [storey('b', 3), storey('a', 0), storey('c', 3), storey('d', 6.5)] } as unknown as Model
    expect(riseLevels(model)).toEqual([0, 3, 6.5])
    expect(riseDuration(3)).toBe(2 * STAGGER_MS + DROP_MS)
    expect(liftAt(0, 0)).toBeCloseTo(LIFT_M)
    expect(liftAt(1, STAGGER_MS)).toBeCloseTo(LIFT_M)
    expect(liftAt(0, DROP_MS)).toBe(0)
    expect(liftAt(2, riseDuration(3))).toBe(0)
    // 드는 높이는 층 간격의 가운데 값이고 1.5~6m 로 묶는다. 층이 하나면 LIFT_M.
    expect(riseLift([0, 3, 6.5])).toBe(3.5)
    expect(riseLift([0, 4.3, 8.6, 12.9])).toBeCloseTo(4.3)
    expect(riseLift([0, 0.5, 1])).toBe(1.5)
    expect(riseLift([0, 20, 40])).toBe(6)
    expect(riseLift([0])).toBe(LIFT_M)
    expect(liftAt(0, 0, 4.3)).toBeCloseTo(4.3)
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

describe('heat — 풍량 밀도', () => {
  it('같은 수씩 나눈 구간 경계를 오름차순으로 내고, 값이 든 구간을 찾는다', async () => {
    const { quantileBreaks, binOf } = await import('./heat')
    const b = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)
    expect(b[0]).toBe(1)
    expect(b.at(-1)).toBe(10)
    for (let i = 1; i < b.length; i++) expect(b[i]).toBeGreaterThan(b[i - 1])
    expect(binOf(1, b)).toBe(0)
    expect(binOf(10, b)).toBe(b.length - 2)
    expect(quantileBreaks([], 5)).toEqual([])
    expect(quantileBreaks([4, 4, 4], 5)).toEqual([4, 4])
  })

  it('값 있는 방은 맡은 말단 풍량 합 ÷ 면적이고, 말단 하나라도 풍량이 없으면 0 이 아니라 값 없음이다', async () => {
    const { readHeat } = await import('./heat')
    const sq = [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]
    const eq = (id: string, kind: string, spaceId: string | null, cmh?: number) => ({ id, kind, role: 'terminal', spaceId, ratedAirflow: cmh === undefined ? undefined : { cmh, source: 'bim' } })
    const model = {
      storeys: [{ id: 's', elevation: 0, spaces: [{ id: 'a', footprint: sq, areaM2: 50 }, { id: 'b', footprint: sq, areaM2: 50 }, { id: 'c', footprint: sq, areaM2: 50 }], equipment: [
        eq('ahu', 'ahu', null), eq('d1', 'air_diffuser', 'a', 300), eq('d2', 'air_diffuser', 'a', 200), eq('d3', 'air_diffuser', 'b', 300), eq('d4', 'air_diffuser', 'b'),
      ], walls: [], openings: [] }],
      systems: [],
      connections: ['d1', 'd2', 'd3', 'd4'].map((to) => ({ from: 'ahu', to, directed: true, source: 'port' })),
    } as unknown as Model
    const r = readHeat(model)
    const a = r.rooms.find((x) => x.spaceId === 'a')!
    const b = r.rooms.find((x) => x.spaceId === 'b')!
    const c = r.rooms.find((x) => x.spaceId === 'c')!
    expect(a.value).toBe(10)
    expect(b).toMatchObject({ value: null, why: 'no-airflow' })
    expect(c).toMatchObject({ value: null, why: 'no-terminal' })
    expect(r.sources).toEqual({ bim: 2, edit: 0 })
  })
})

describe('title — 방 이름 자막', () => {
  it('방마다 센 설비 수가 TTL 의 hasLocation 수와 같고, 눈 자리의 층·방을 찾는다', async () => {
    const { readFileSync } = await import('node:fs')
    const WebIFC = await import('web-ifc')
    const { importIfc } = await import('../lib/ifc/import')
    const { modelToTTL } = await import('../lib/export/ttl')
    const { readOntologyTTL } = await import('../lib/export/read-ttl')
    const { devicesIn, roomAt } = await import('./title')
    const api = new WebIFC.IfcAPI()
    await api.Init()
    for (const f of ['src/lib/ifc/fixtures/mep.ifc', 'src/lib/ifc/fixtures/two-rooms.ifc']) {
      const model = importIfc(api, new Uint8Array(readFileSync(f)))
      const reading = readOntologyTTL(modelToTTL(model))
      for (const st of model.storeys) {
        for (const sp of st.spaces) {
          const ttl = reading.entities.filter((e) => e.locations.includes(sp.id)).length
          expect(devicesIn(st, sp.id), `${f} ${sp.id}`).toBe(ttl)
          if (sp.footprint.length < 3) continue
          const cx = sp.footprint.slice(0, -1).reduce((n, p) => n + p[0], 0) / (sp.footprint.length - 1)
          const cy = sp.footprint.slice(0, -1).reduce((n, p) => n + p[1], 0) / (sp.footprint.length - 1)
          const t = roomAt(model, [cx, cy, st.elevation + 1.6])
          // 볼록하지 않은 방은 무게중심이 밖일 수 있다 — 안이면 그 방이어야 한다.
          if (t) expect(t.storey).toBe(st.name)
        }
      }
    }
  })
})

describe('ticker — 읽는 중인 IFC 클래스', () => {
  it('많은 것부터 12줄, `클래스 수` 꼴이다', async () => {
    const { tickerLines, MAX_LINES } = await import('./ticker')
    const classes = Array.from({ length: 20 }, (_, i) => [`IfcThing${i}`, 2000 - i] as const)
    const lines = tickerLines(classes)
    expect(lines).toHaveLength(MAX_LINES)
    expect(lines[0]).toBe(`IfcThing0 ${(2000).toLocaleString()}`)
  })
})
