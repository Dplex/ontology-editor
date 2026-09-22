import { existsSync, readFileSync } from 'node:fs'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { importIfc } from '../src/lib/ifc/import'
import { countOf } from '../src/lib/model'
import { modelToTTL } from '../src/lib/export/ttl'
import { modelToGeoJSON } from '../src/lib/export/geojson'

// 손으로 쓴 픽스처가 통과해도 진짜 BIM 에서 깨질 수 있다. 실제 저작 도구가 내보낸 파일은
// 표현 방식이 훨씬 다양하기 때문이다. 그래서 공개 샘플 하나를 기준값으로 박아 둔다.
//
//   AC20-FZK-Haus.ifc — KIT 가 만든 표준 테스트 주택, ArchiCAD 20 이 IFC4 로 내보낸 것
//   출처: github.com/ThatOpen/engine_web-ifc  tests/ifcfiles/public/
//
// 받는 법: npm run fetch:sample
const SAMPLE = 'data/AC20-FZK-Haus.ifc'

describe.skipIf(!existsSync(SAMPLE))('실제 BIM (AC20-FZK-Haus)', () => {
  it('개수와 넓이가 기준값과 맞는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(SAMPLE)))

    expect(model.schema).toBe('IFC4')
    expect(model.buildingName).toBe('FZK-Haus')
    expect(countOf(model)).toEqual({
      storeys: 2,
      spaces: 7,
      walls: 13,
      doors: 5,
      windows: 11,
      loadBearingWalls: 0,
      // 이 모델의 Pset_WallCommon 에는 ThermalTransmittance 만 있고 LoadBearing 이 없다.
      // PRD #6 이 말하는 "Structural 속성이 비어 있는 벽" 이 실제로 이렇게 생겼다.
      unknownLoadBearingWalls: 13,
    })

    const buero = model.storeys[0].spaces.find((s) => s.longName === 'Buero')!
    expect(buero.areaM2).toBeCloseTo(12.985, 3) // 3.71m x 3.5m
    expect(buero.footprint[0][0]).toBeCloseTo(0.3, 6)
    expect(buero.footprint[0][1]).toBeCloseTo(9.7, 6)

    // 방들이 저마다 다른 자리에 있어야 한다. 배치 사슬을 안 타면 전부 원점에 겹치는데,
    // 넓이는 그대로라서 개수 검사만으로는 잡히지 않는다.
    const origins = new Set(model.storeys.flatMap((s) => s.spaces).map((s) => JSON.stringify(s.footprint[0])))
    expect(origins.size).toBeGreaterThan(5)

    // 내보내기까지 실제로 돌려 본다.
    const ttl = modelToTTL(model)
    expect(ttl).toContain('a brick:Building ;')
    expect(ttl).not.toMatch(/POLYGON/i)
    expect(modelToGeoJSON(model)).toHaveLength(2)
  })
})

it.skipIf(existsSync(SAMPLE))('샘플이 없으면 건너뛴다', () => {
  console.log(`${SAMPLE} 이 없어 실제 BIM 검사를 건너뜁니다. npm run fetch:sample 로 받으세요.`)
  expect(existsSync(SAMPLE)).toBe(false)
})
