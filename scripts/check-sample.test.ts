import { existsSync, readFileSync } from 'node:fs'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { importIfc, importIfcWithMeshes } from '../src/lib/ifc/import'
import { countOf } from '../src/lib/model'
import { modelToTTL } from '../src/lib/export/ttl'
import { modelToGeoJSON } from '../src/lib/export/geojson'
import { inferConnections } from '../src/lib/topology'

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
      devices: 0,
      conduits: 0,
      unplacedEquipment: 0,
      equipmentWithoutCapacity: 0,
      unlocatedEquipment: 0,
      systems: 0,
      // 설비가 없으니 연결도 없다.
      connections: 0,
      directedConnections: 0,
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
    // 설비의 86%가 덕트·배관이다. 합쳐서 "설비 2,202대" 로 내보내면 기기가 일곱 배로 부푼다.
    expect(counts.devices).toBe(307)
    expect(counts.conduits).toBe(1895)
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

// Duplex MEP 판본(Solibri 최적화본). **포트도 IfcSystem 도 0 이다.** 원본 MEP 판본도 같다.
// 그런데 요소마다 Revit 의 `System Name` 속성이 있고, 배관 끝과 피팅 끝의 꼭짓점이 맞닿아
// 있다. BIM 이 연결을 말해 주지 않을 때 어디까지 되찾을 수 있는지를 이 파일이 지킨다.
const DUPLEX_MEP = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP-Optimized.ifc'

describe.skipIf(!existsSync(DUPLEX_MEP))('Duplex MEP 판본 (포트 없음)', () => {
  it('계통을 속성으로 세우고, 연결을 형상으로 추정한다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const { model, meshes } = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP)))
    const counts = countOf(model)

    expect(counts.equipment).toBe(926)
    // 926대 전부 형상이 있다. 점으로만 찍던 시절에는 이 파일이 점 926개였다.
    expect(meshes.size).toBe(926)

    // **실제 기기는 141대뿐이다.** 나머지 785대가 덕트·배관 구간과 이음쇠다.
    // IFC2x3 이라 클래스가 전부 추상 이름(FlowSegment, FlowTerminal)인데도 역할은 나온다 —
    // 역할은 클래스 계층에서 오는 것이라 PredefinedType 이 비어도 채워진다.
    expect(counts.devices).toBe(141)
    expect(counts.conduits).toBe(785)
    const roles = new Map<string, number>()
    for (const e of model.storeys.flatMap((s) => s.equipment)) {
      roles.set(e.role ?? 'null', (roles.get(e.role ?? 'null') ?? 0) + 1)
    }
    expect(Object.fromEntries(roles)).toEqual({
      segment: 427,
      fitting: 358,
      terminal: 105,
      conversion: 16,
      control: 14,
      moving: 4,
      sensing: 2,
    })

    // IfcSystem 은 0 이다. 20개는 Revit 의 `System Name` 속성에서 세운 것이다.
    expect(counts.systems).toBe(20)
    expect(model.systems.every((s) => s.source === 'property')).toBe(true)
    expect(model.systems.map((s) => s.name)).toContain('Unit A Domestic Cold Water')

    // 포트가 없으니 방향은 하나도 없다. **이 값이 0 이 아니게 되면 추정을 단정으로 바꾼 것이다.**
    expect(counts.connections).toBe(690)
    expect(counts.directedConnections).toBe(0)
    expect(model.connections.every((c) => c.source === 'geometry')).toBe(true)

    // 추정이 계통을 넘나들지 않는다. 냉수관과 온수관은 나란히 붙어 달려서, 계통을 보지
    // 않으면 한 덩어리가 된다.
    const systemOf = new Map<string, string>()
    for (const s of model.systems) for (const id of s.memberIds) systemOf.set(id, s.name)
    const crossing = model.connections.filter((c) => {
      const a = systemOf.get(c.from)
      const b = systemOf.get(c.to)
      return a !== undefined && b !== undefined && a !== b
    })
    // 두 계통에 걸친 설비(온수기 같은 것)는 양쪽 이름을 다 갖고 있어서 여기 걸릴 수 있다.
    expect(crossing.length).toBeLessThan(counts.connections * 0.2)

    // 못 이은 것을 이유별로 가른다. **절반 이상이 되살릴 수 있는 쪽이다** — 이 비율이
    // 고객사에 "판정 기준을 조정하겠다" 와 "모델을 다시 그려 달라" 중 무엇을 말할지 정한다.
    const gap = model.warnings.find((w) => w.includes('연결이 하나도 없습니다'))
    expect(gap).toContain('설비 224대')
    expect(gap).toContain('121대는 50mm 안에 이을 상대가 있어')
    expect(gap).toContain('103대는 주변에 상대가 없습니다')
  }, 300_000)
})

describe.skipIf(!existsSync(MEP))('포트 연결 (ifc4Mep, IFC4)', () => {
  it('IfcRelNests 로 포트를 찾고 SOURCE→SINK 를 방향으로 읽는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(MEP)))
    const counts = countOf(model)

    // IFC4 는 포트를 IfcRelNests 로 요소에 매단다. IfcRelConnectsPortToElement 만 보면
    // 이 파일에서 연결이 92개밖에 안 나온다.
    expect(counts.connections).toBe(1995)
    // 이 파일은 포트 방향이 전부 SOURCE→SINK 라 연결마다 흐름을 안다.
    expect(counts.directedConnections).toBe(1995)
    expect(model.connections.every((c) => c.source === 'port')).toBe(true)
  }, 300_000)
})

// 형상 추정이 얼마나 맞는지는 지금까지 잰 적이 없었다. 잴 수가 없어서다 — 포트가 없는
// 파일에서 추정을 돌리니 맞춰 볼 정답지가 없다.
//
// **ifc4Mep 이 정답지다.** 포트가 4,232개이고 전부 SOURCE/SINK 라 연결 1,995개의 방향까지
// 확정이다. 이 파일에 일부러 포트를 무시하고 형상 추정을 돌리면, 우리 알고리즘이 BIM 이
// 말한 것을 얼마나 되살리는지 그대로 나온다.
//
// 틀리는 방향이 둘이라는 데 주의한다(Lilis 2025 의 혼동행렬).
//   기하는 닿았는데 BIM 은 연결이라 안 함 → 붙어만 있고 안 이어진 것이거나 BIM 오류
//   기하는 안 닿았는데 BIM 은 연결이라 함 → 접합부에 틈이 있는 모델링·내보내기 오류
// 전자를 FP, 후자를 FN 으로 센다. **FP 가 전부 우리 잘못은 아니다** — 아래 주석 참조.
describe.skipIf(!existsSync(MEP))('형상 추정의 정확도 (ifc4Mep 의 포트를 정답지로)', () => {
  it('허용오차를 키우면 재현율이 오르고 정밀도가 떨어진다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const { model, meshes } = importIfcWithMeshes(api, new Uint8Array(readFileSync(MEP)))

    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
    // 양쪽 다 메시가 있는 연결만 정답지로 둔다. 메시가 없으면 기하로는 애초에 못 찾으니
    // 그것까지 못 맞췄다고 세면 알고리즘이 아니라 입력을 탓하는 것이 된다.
    const truth = new Set(
      model.connections.filter((c) => meshes.has(c.from) && meshes.has(c.to)).map((c) => key(c.from, c.to)),
    )
    expect(model.connections.length).toBe(1995)
    expect(truth.size).toBe(1972)

    const systemsOf = new Map<string, string[]>()
    for (const s of model.systems) for (const id of s.memberIds) systemsOf.set(id, [...(systemsOf.get(id) ?? []), s.name])
    const points = [...meshes].map(([id, m]) => ({ id, points: m.positions, systems: systemsOf.get(id) ?? null }))

    const score = (tolerance: number) => {
      const got = new Set(inferConnections(points, tolerance).map((c) => key(c.from, c.to)))
      let tp = 0
      for (const g of got) if (truth.has(g)) tp++
      return { got: got.size, tp, fp: got.size - tp, fn: truth.size - tp, precision: tp / got.size, recall: tp / truth.size }
    }

    // 지금 기본값. 열 중 여덟을 맞히고 넷 중 셋을 찾는다.
    const mm5 = score(0.005)
    expect(mm5).toEqual({ got: 1878, tp: 1494, fp: 384, fn: 478, precision: 1494 / 1878, recall: 1494 / 1972 })

    // 좁히면 정밀해지고 놓친다. 넓히면 다 찾는데 엉뚱한 것이 딸려 온다.
    const mm1 = score(0.001)
    const mm50 = score(0.05)
    expect(mm1.precision).toBeGreaterThan(mm5.precision)
    expect(mm1.recall).toBeLessThan(mm5.recall)
    expect(mm50.recall).toBeGreaterThan(mm5.recall)
    expect(mm50.precision).toBeLessThan(mm5.precision)

    // 1mm 에서도 재현율이 절반이 안 된다. 접합부의 꼭짓점이 딱 맞물리게 그려진 모델이
    // 드물다는 뜻이고, 허용 오차를 0 에 가깝게 두는 선택지는 없다는 뜻이다.
    expect(mm1.recall).toBeLessThan(0.5)
    // 50mm 까지 넓혀도 113개는 끝내 못 찾는다. 그건 오차 문제가 아니라 접합 부재가 아예
    // 없는 것(1차 결손)이라, 알고리즘으로 메울 수 없다.
    expect(mm50.fn).toBe(113)
  }, 600_000)
})

describe.skipIf(!existsSync(DUPLEX_HVAC))('포트 연결 (Duplex HVAC, IFC2x3)', () => {
  it('IfcRelConnectsPortToElement 로 읽고, SOURCEANDSINK 는 방향 없는 연결로 둔다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(DUPLEX_HVAC)))
    const counts = countOf(model)

    expect(counts.connections).toBe(485)
    // 485개 중 190개만 방향이 있다. 나머지는 Revit 이 피팅·덕트 포트를 SOURCEANDSINK 로
    // 내보낸 것이라, 이어져 있다는 것만 알고 어느 쪽으로 흐르는지는 모른다.
    expect(counts.directedConnections).toBe(190)
  }, 300_000)
})
