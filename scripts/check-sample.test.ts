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
const MEP = 'data/ifc4Mep_IFC4.ifc'

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
      // 건축 전용 모델이라 MEP 가 하나도 없다. 이 값이 0 이 아니게 되면 설비 판정 기준이
      // 넓어진 것이다 — 한때 IfcAnnotation 14개를 설비로 셌다.
      equipment: 0,
      unplacedEquipment: 0,
      equipmentWithoutCapacity: 0,
      unlocatedEquipment: 0,
      systems: 0,
    })

    // F4·F5·F6. 파일에 들어 있는데 한때 안 읽던 것들이다.
    const walls = model.storeys.flatMap((s) => s.walls)
    expect(walls.filter((w) => w.thickness !== null)).toHaveLength(13)
    // 내벽 0.24m 와 외벽 0.3m 두 종류다.
    expect(new Set(walls.map((w) => Number(w.thickness?.toFixed(3))))).toEqual(new Set([0.24, 0.3]))

    const openings = model.storeys.flatMap((s) => s.openings)
    expect(openings).toHaveLength(16)
    expect(openings.filter((o) => o.width !== null)).toHaveLength(16)
    // 어느 벽에 뚫렸는지까지 전부 이어진다. 관계를 두 단계 타야 나오는 값이다.
    expect(openings.filter((o) => o.wallId !== null)).toHaveLength(16)
    expect(openings.filter((o) => o.passable)).toHaveLength(5) // 문만 통과 가능

    const spaces = model.storeys.flatMap((s) => s.spaces)
    expect(spaces.every((s) => s.boundedBy.length > 0)).toBe(true)
    expect(spaces.reduce((n, s) => n + s.boundedBy.length, 0)).toBe(66)

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

// 설비가 실제로 든 IFC4 모델. DDS-CAD 이 내보낸 것이고 건축은 들어 있지 않다.
//
//   출처: github.com/opensourceBIM/TestFiles  TestData/data/ifc4Mep export 17-12-2013_IFC4.ifc
//
// 손으로 쓴 픽스처가 통과해도 여기서 깨진 적이 있다. 계통을 정확히 일치하는 타입으로만
// 고르다가 IfcDistributionCircuit 22개를 놓쳤다.
describe.skipIf(!existsSync(MEP))('실제 MEP BIM (ifc4Mep, IFC4)', () => {
  it('설비와 계통을 기준값대로 읽는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(MEP)))
    const counts = countOf(model)

    expect(model.schema).toBe('IFC4')
    expect(counts.equipment).toBe(2202)
    // IfcDistributionSystem 15 + IfcDistributionCircuit 22. 상속으로 골라야 37 이 된다.
    expect(counts.systems).toBe(37)
    expect(counts.unplacedEquipment).toBe(28)

    const equipment = model.storeys.flatMap((s) => s.equipment)
    expect(equipment.filter((e) => e.systemId !== null)).toHaveLength(1714)

    // 설비 전용 모델이라 물리존이 없다. 소속을 하나도 못 찾는 것이 정상이고,
    // 이것이 건축 모델과 합쳐야 하는 이유다.
    expect(counts.spaces).toBe(0)
    expect(counts.unlocatedEquipment).toBe(2202)

    // 용량은 하나도 안 읽힌다. DDS-CAD 이 우리가 찾는 이름을 쓰지 않는다.
    expect(counts.equipmentWithoutCapacity).toBe(2202)
  }, 300_000)
})

// Duplex Apartment(NIBS Common BIM Files). 압축이라 풀어야 한다.
//
//   npm run fetch:sample && unzip -o data/NBU_Duplex_ifc.zip -d data/
//
// 이 둘이 각각 다른 것을 지킨다. COBie 판본은 설비를 층이 아니라 공간에 매다는 경우를,
// HVAC 판본은 길이 단위가 밀리미터인 경우를 지킨다. 둘 다 한때 조용히 틀렸던 자리다.
const DUPLEX_COBIE = 'data/NBU_Duplex/NBU_Duplex-Apt-COBie_Arch-Design.ifc'
const DUPLEX_HVAC = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'

describe.skipIf(!existsSync(DUPLEX_COBIE))('Duplex COBie 판본 (설비가 공간에 매달림)', () => {
  it('설비와 계통을 읽고, 소속을 BIM 이 말한 대로 쓴다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(DUPLEX_COBIE)))
    const counts = countOf(model)

    // 층만 보던 시절에는 이 값이 0 이었다. 설비가 전부 IfcSpace 에 매달려 있다.
    expect(counts.equipment).toBe(133)
    expect(counts.spaces).toBe(22)
    // 계통은 COBie 판본에만 들어 있다. 같은 건물의 일반 IFC 판본은 0 이다.
    expect(counts.systems).toBe(10)

    const equipment = model.storeys.flatMap((s) => s.equipment)
    expect(equipment.filter((e) => e.spaceSource === 'bim')).toHaveLength(133)
    expect(counts.unlocatedEquipment).toBe(0)
  }, 300_000)
})

describe.skipIf(!existsSync(DUPLEX_HVAC))('Duplex HVAC 판본 (밀리미터)', () => {
  it('밀리미터를 미터로 환산해서 읽는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(DUPLEX_HVAC)))

    // 파일에는 0, 3100, 6000 으로 적혀 있다. 환산을 안 하면 층이 3km 높이에 뜬다.
    const elevations = model.storeys.map((s) => s.elevation)
    expect(elevations[0]).toBeCloseTo(0, 6)
    expect(elevations[1]).toBeCloseTo(3.1, 6)
    expect(elevations[2]).toBeCloseTo(6.0, 6)

    // 같은 건물의 피트 판본(MEP-1)도 같은 층 높이를 준다. 단위가 맞았다는 교차 확인이다.
    const equipment = model.storeys.flatMap((s) => s.equipment).filter((e) => e.position)
    const xs = equipment.map((e) => e.position![0])
    expect(Math.max(...xs)).toBeLessThan(50) // 주택 한 채다. 미터라면 수십 m 를 넘지 않는다

    // 용량은 Revit 이 붙인 비표준 이름으로 들어온다. 표준 Pset 이름은 한 건도 없다.
    const withCapacity = model.storeys.flatMap((s) => s.equipment).filter((e) => e.capacity !== null)
    expect(withCapacity).toHaveLength(155)
    expect(new Set(withCapacity.map((e) => e.capacityProperty))).toEqual(new Set(['Flow']))
  }, 300_000)
})
