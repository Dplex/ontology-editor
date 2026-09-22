import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc, importIfcWithMeshes, UnreadableIfcError } from '../src/lib/ifc/import'
import { profileOf } from '../src/lib/profile'
import { countOf, isConduit } from '../src/lib/model'
import { assignEquipmentToSpaces, scoreAgainstDeclared, SNAP } from '../src/lib/mapping'
import { mergeModels } from '../src/lib/merge'
import { escapeLocalName, modelToTTL } from '../src/lib/export/ttl'
import { modelToGeoJSON } from '../src/lib/export/geojson'
import { inferConnections, REACH, TOLERANCE } from '../src/lib/topology'

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
const DUPLEX_ARCH = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'

// **저작 도구마다 공간 외곽선을 다른 표현에 넣는다.** ArchiCAD 는 FootPrint 를 따로 내보내고
// Revit 은 안 만든다 — Body/SweptSolid 뿐이다. FootPrint 만 읽던 시절 Duplex 세 판본의
// 공간 85개가 전부 외곽선 0 이었고, 그래서 3D 에 방이 한 칸도 안 그려지고 설비 소속 판정도
// 통째로 못 돌았다. 이 검사가 그 회귀를 지킨다.
describe.skipIf(!existsSync(DUPLEX_ARCH))('Revit 이 낸 공간 외곽선 (SweptSolid)', () => {
  it('FootPrint 가 없어도 SweptSolid 에서 바닥 단면을 꺼낸다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(DUPLEX_ARCH)))
    const spaces = model.storeys.flatMap((s) => s.spaces)

    expect(spaces).toHaveLength(21)
    // 19개가 SweptSolid 다. 나머지 둘은 SurfaceModel 이라 아직 못 읽고 경고로 남는다 —
    // 못 읽는 것을 읽은 척하지 않는다.
    expect(spaces.filter((s) => s.footprint.length >= 3)).toHaveLength(19)
    expect(model.warnings.some((w) => w.includes('바닥 외곽선을 얻지 못했습니다'))).toBe(true)

    // 방이 저마다 다른 자리에 있어야 한다. 배치를 안 타면 전부 원점에 겹치는데 넓이는
    // 그대로라 개수만 봐서는 안 보인다.
    const drawn = spaces.filter((s) => s.footprint.length >= 3)
    expect(new Set(drawn.map((s) => JSON.stringify(s.footprint[0]))).size).toBe(19)

    // 두 세대짜리 주택이다. 합이 수백 제곱미터 규모여야 한다.
    const total = drawn.reduce((n, s) => n + s.areaM2, 0)
    expect(total).toBeGreaterThan(300)
    expect(total).toBeLessThan(500)
  }, 300_000)
})

describe.skipIf(!existsSync(DUPLEX_MEP))('Duplex MEP 판본 (포트 없음)', () => {
  it('계통을 속성으로 세우고, 연결을 형상으로 추정한다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const { model, meshes } = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP)))
    const counts = countOf(model)

    expect(counts.equipment).toBe(926)
    // 926대 전부 형상이 있다. 점으로만 찍던 시절에는 이 파일이 점 926개였다.
    expect(meshes.size).toBe(926)

    // 공간 42개 전부 외곽선이 나온다(SweptSolid). 외곽선이 없던 시절에는 소속 판정을
    // 아예 못 돌려서 미소속이 759대였다. 외곽선으로 424대, 벽면 여유(SNAP 5cm)로 270대가
    // 됐다. 남은 270대는 **전부 덕트·배관**이다 — 기기 141대는 한 대도 안 남는다.
    expect(counts.spaces).toBe(42)
    expect(model.storeys.flatMap((s) => s.spaces).every((s) => s.footprint.length >= 3)).toBe(true)
    expect(counts.unlocatedEquipment).toBe(270)
    expect(model.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role) && e.spaceId === null)).toHaveLength(0)

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
    expect(counts.directedConnections).toBe(0)
    expect(model.connections.every((c) => c.source === 'geometry')).toBe(true)

    // 기본 판정 5mm 로 690개, 고립된 요소 주변만 넓혀 95개를 더 이었다.
    const base = model.connections.filter((c) => c.tolerance === TOLERANCE)
    const stretched = model.connections.filter((c) => (c.tolerance ?? 0) > TOLERANCE)
    expect(base).toHaveLength(690)
    expect(stretched).toHaveLength(95)
    expect(counts.connections).toBe(785)
    // 넓힌 것도 REACH 안이다. 이 경계를 넘으면 오차가 아니라 없는 부재를 지어낸 것이다.
    expect(Math.max(...stretched.map((c) => c.tolerance!))).toBeLessThanOrEqual(REACH)

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

    // 못 이은 것을 이유별로 가른다. **절반 이상이 되살릴 수 있는 쪽이었다** — 이 비율이
    // 고객사에 "판정 기준을 조정하겠다" 와 "모델을 다시 그려 달라" 중 무엇을 말할지 정한다.
    //
    // 대수(121)와 연결 개수(95)가 다른 것에 주의한다. 고립된 둘이 서로를 가장 가깝다고
    // 지목하면 연결 하나가 두 대를 살린다.
    const joined = model.warnings.find((w) => w.includes('연결망에 붙였습니다'))
    expect(joined).toContain('설비 224대 중 121대')
    expect(joined).toContain('연결 95개')
    const stranded = model.warnings.find((w) => w.includes('접합 부재 누락'))
    expect(stranded).toContain('설비 103대')
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

// **F11 이 얼마나 맞는지를 처음으로 잰다.** 정답지는 BIM 이 소속을 직접 말한 설비다.
// Duplex MEP 판본은 설비 167대를 IfcSpace 에 직접 매달아 두었다. 그 말을 가리고 좌표로만
// 판정해서 대 본다.
describe.skipIf(!existsSync(DUPLEX_MEP))('설비 소속 판정의 정확도 (BIM 이 말한 소속을 정답지로)', () => {
  it('벽면 여유를 두면 73% 에서 96% 로 오르고, 다른 방으로 잘못 가는 것은 늘지 않는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const { model } = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP)))

    // 점이 외곽선 안에 드는지만 보면 43대가 "어느 방에도 없음" 이다. 콘센트·스위치의
    // 삽입점이 정확히 벽면(= 외곽선 위)에 있어서다.
    assignEquipmentToSpaces(model, 0)
    expect(scoreAgainstDeclared(model, 0)).toEqual({ total: 167, agreed: 122, outside: 43, otherRoom: 2 })

    // 5cm 에서 포화한다. 30cm 까지 넓혀도 같고, 다른 방으로 가는 2대도 그대로다.
    assignEquipmentToSpaces(model, SNAP)
    expect(SNAP).toBe(0.05)
    expect(scoreAgainstDeclared(model)).toEqual({ total: 167, agreed: 160, outside: 5, otherRoom: 2 })
    assignEquipmentToSpaces(model, 0.3)
    expect(scoreAgainstDeclared(model, 0.3)).toEqual({ total: 167, agreed: 160, outside: 5, otherRoom: 2 })
  }, 300_000)
})

// Revit 이 IFC2x3 으로 낸 덕트 구간은 배치점(ObjectPlacement)이 층 원점이다. 형상은 제자리다.
// 이걸 모르고 소속을 판정하면 **원점이 든 방 하나에 덕트가 전부 몰린다.** Duplex 는 원점이
// 건물 모서리 밖이라 "미소속" 으로 끝났을 뿐이다.
describe.skipIf(!existsSync(DUPLEX_HVAC))('배치점이 층 원점에 찍힌 덕트 (Duplex HVAC)', () => {
  it('형상 중심으로 좌표를 바꾸고, 그 수를 경고로 남긴다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const bytes = new Uint8Array(readFileSync(DUPLEX_HVAC))

    // 형상을 안 읽는 경로에서는 231개가 전부 (0, 0) 이다.
    const plain = importIfc(api, bytes).storeys.flatMap((s) => s.equipment)
    const atOrigin = plain.filter((e) => e.position && Math.hypot(e.position[0], e.position[1]) < 1e-6)
    expect(atOrigin).toHaveLength(231)
    expect(new Set(atOrigin.map((e) => e.role))).toEqual(new Set(['segment']))

    const { model } = importIfcWithMeshes(api, bytes)
    expect(model.warnings.find((w) => w.includes('배치점'))).toContain('설비 231대')
    const still = model.storeys.flatMap((s) => s.equipment).filter((e) => e.position && Math.hypot(e.position[0], e.position[1]) < 1e-6)
    expect(still).toHaveLength(0)
  }, 300_000)
})

// **실제 프로젝트는 건축과 설비가 다른 파일이다.** 설비 파일에는 방이 없어서 혼자서는 F11 이
// 안 나온다. 같은 건물의 두 판본을 합쳐서 되는지를 지킨다.
describe.skipIf(!existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_HVAC) || !existsSync(DUPLEX_MEP))('건축 + 설비 합치기 (Duplex)', () => {
  it('층 GUID 가 달라도 이름으로 맞추고, HVAC 기기 40대 전부의 소속을 찾는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_ARCH))).model
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_HVAC))).model

    // 같은 건물인데 층 GUID 가 다르다. GUID 로 맞추면 한 층도 안 맞는다.
    expect(arch.storeys.find((s) => s.name === 'Level 1')!.id).not.toBe(hvac.storeys.find((s) => s.name === 'Level 1')!.id)

    // HVAC 판본 혼자서는 1·2층에 방이 없다. 기기 40대가 전부 갈 곳이 없다.
    const devices = (m: typeof arch) => m.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
    expect(devices(hvac)).toHaveLength(40)
    expect(devices(hvac).filter((e) => e.spaceId === null)).toHaveLength(40)

    const { model, report } = mergeModels(arch, hvac)
    expect(report.storeys.map((s) => s.by)).toEqual(['name', 'name', 'name'])
    // 좌표계가 같다. 설비 498대 전부가 건축 모델의 공간 범위 안이다.
    expect(report.alignment).toEqual({ placed: 498, inside: 498, ratio: 1 })
    expect(model.warnings.some((w) => w.includes('좌표계'))).toBe(false)

    expect(devices(model).filter((e) => e.spaceId === null)).toHaveLength(0)
    // 남는 259대는 전부 덕트·배관이다. 건축 판본의 2층 복도 둘에 외곽선이 없어서(SurfaceModel)
    // 그 위를 지나는 덕트가 갈 곳이 없는 것이 큰 몫이다.
    expect(report.unlocated).toEqual({ before: 493, after: 259 })
  }, 300_000)

  it('설비 판본의 겹친 방을 걷어 내고, BIM 이 말한 소속 167건을 지킨다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_ARCH))).model
    const mep = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP))).model

    // 설비 판본 혼자서는 방이 42개다 — "MEP Space" 21개와 건축 Room 사본 21개. 같은 방이 두 번
    // 온톨로지에 들어간다.
    expect(countOf(mep).spaces).toBe(42)

    const { model, report } = mergeModels(arch, mep)
    expect(countOf(model).spaces).toBe(21)
    // 건축 판본의 복도 둘은 외곽선이 없었다. 같은 방 번호(A201, B201)의 외곽선을 빌려 온다.
    expect(report.spaces).toEqual({ dropped: 42, kept: 0, borrowed: 2 })
    expect(model.storeys.flatMap((s) => s.spaces).every((s) => s.footprint.length >= 3)).toBe(true)

    // BIM 이 말한 소속은 좌표로 다시 판정하지 않고 같은 자리의 방으로 옮겨 적는다. 다시 판정하면
    // 벽면 설비가 외곽선 위에 떨어져 말단 105대 중 41대의 소속을 잃었다.
    expect(report.declaredRemapped).toEqual({ total: 167, remapped: 167 })
    expect(model.storeys.flatMap((s) => s.equipment).filter((e) => e.spaceSource === 'bim')).toHaveLength(167)
    // 방을 절반으로 줄여도 소속을 잃은 설비가 없다.
    expect(report.unlocated).toEqual({ before: 270, after: 270 })
  }, 300_000)
})

describe.skipIf(!existsSync(SAMPLE) || !existsSync(MEP))('다른 건물끼리 합치기 (AC20-FZK-Haus + ifc4Mep)', () => {
  it('좌표계가 어긋났다고 경고한다 — 오류 없이 합쳐지고 숫자만 틀리는 경우다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const house = importIfc(api, new Uint8Array(readFileSync(SAMPLE)))
    const mep = importIfcWithMeshes(api, new Uint8Array(readFileSync(MEP))).model

    const { model, report } = mergeModels(house, mep)
    // 2,174대 중 50대(2%)만 주택 범위에 든다. 우연히 겹친 것이다.
    expect(report.alignment!.ratio).toBeLessThan(0.05)
    expect(model.warnings.some((w) => w.includes('좌표계'))).toBe(true)
    // 층 높이 0 끼리는 짝이 지어진다(이름이 달라 높이로). 좌표계 경고가 없으면 이 짝을 믿게 된다 —
    // 층 짝짓기만으로는 다른 건물인지 모른다는 뜻이다.
    expect(report.storeys.filter((s) => s.by === 'elevation')).toHaveLength(1)
    expect(report.unlocated.after).toBe(2202)
  }, 300_000)
})

// **확장의 여지를 잰다.** 온톨로지를 더 넓히려면 IFC 에 그 정보를 담을 자리가 있어야 하고
// (스키마), 실제 파일이 그 자리를 채워야 한다(저작 도구). 둘을 따로 센다 — "IFC 에 없다" 와
// "IFC 에 자리는 있는데 비어 있다" 는 고객사에 할 말이 다르다. `docs/bim-to-dt-ontology.md` §2 끝의
// 확장 표와 §3 요구사항 표의 숫자가 여기서 나온다. 임포터가 아직 안 읽는 것들이라 web-ifc 로 직접 센다.
describe.skipIf(!existsSync(SAMPLE) || !existsSync(MEP) || !existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_COBIE))('확장 여지 (자리가 있는가, 채워져 있는가)', () => {
  type Opened = { api: WebIFC.IfcAPI; m: number }
  const ids = ({ api, m }: Opened, type: number, inherited = false) => {
    const v = api.GetLineIDsWithType(m, type, inherited)
    return Array.from({ length: v.size() }, (_, i) => v.get(i))
  }
  /** 공간마다 속성 이름 → 값. Pset 과 수량(Qto) 을 같이 본다. */
  const spaceProps = (o: Opened) => {
    const spaces = new Set(ids(o, WebIFC.IFCSPACE))
    const out = new Map<number, Map<string, unknown>>()
    for (const r of ids(o, WebIFC.IFCRELDEFINESBYPROPERTIES)) {
      const rel = o.api.GetLine(o.m, r)
      const def = o.api.GetLine(o.m, rel.RelatingPropertyDefinition.value)
      for (const obj of rel.RelatedObjects ?? []) {
        if (!spaces.has(obj.value)) continue
        const props = out.get(obj.value) ?? new Map<string, unknown>()
        for (const h of def?.HasProperties ?? def?.Quantities ?? []) {
          const p = o.api.GetLine(o.m, h.value)
          props.set(p?.Name?.value, p?.NominalValue?.value ?? p?.LengthValue?.value ?? p?.AreaValue?.value)
        }
        out.set(obj.value, props)
      }
    }
    return { spaces, out, count: (k: string) => [...spaces].filter((s) => (out.get(s)?.get(k) ?? '') !== '').length }
  }
  /** 문 하나가 공간 경계로 몇 개의 방에 걸리나 → {방 수: 문 수}. 두 방에 걸린 문이 방과 방을 잇는다. */
  const doorLinks = (o: Opened) => {
    const doors = new Set(ids(o, WebIFC.IFCDOOR, true))
    const by = new Map<number, Set<number>>()
    for (const r of ids(o, WebIFC.IFCRELSPACEBOUNDARY, true)) {
      const rel = o.api.GetLine(o.m, r)
      const el = rel.RelatedBuildingElement?.value
      if (typeof el !== 'number' || !doors.has(el)) continue
      by.set(el, (by.get(el) ?? new Set()).add(rel.RelatingSpace.value))
    }
    const hist: Record<number, number> = {}
    for (const s of by.values()) hist[s.size] = (hist[s.size] ?? 0) + 1
    return { doors: doors.size, hist }
  }

  it('방 종류: Revit 은 OmniClass 로 전부 채우고, ArchiCAD 샘플은 비어 있다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = { api, m: api.OpenModel(new Uint8Array(readFileSync(DUPLEX_ARCH))) }
    const house = { api, m: api.OpenModel(new Uint8Array(readFileSync(SAMPLE))) }

    // 표준 필드(IfcSpace.PredefinedType)는 둘 다 비었다. 분류는 속성으로만 온다.
    for (const o of [arch, house]) {
      expect(ids(o, WebIFC.IFCSPACE).filter((s) => api.GetLine(o.m, s).PredefinedType?.value)).toHaveLength(0)
    }
    const a = spaceProps(arch)
    expect(a.count('OmniClass Table 13 Category')).toBe(21)
    expect(a.spaces.size).toBe(21)
    expect([...a.out.values()].map((p) => p.get('Category Description'))).toContain('Bedroom')
    expect(spaceProps(house).count('OmniClass Table 13 Category')).toBe(0)

    // 방 높이는 ArchiCAD 가 수량으로 준다(7/7). 층 높이만으로는 복층 거실(4m)을 모른다.
    const h = spaceProps(house)
    expect(h.count('Height')).toBe(7)
    expect(new Set([...h.out.values()].map((p) => p.get('Height')))).toEqual(new Set([2.5, 4]))
  }, 300_000)

  it('공조존: 담을 자리는 있지만 실제 값은 없다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = { api, m: api.OpenModel(new Uint8Array(readFileSync(DUPLEX_ARCH))) }
    const cobie = { api, m: api.OpenModel(new Uint8Array(readFileSync(DUPLEX_COBIE))) }

    // Revit 은 방마다 VentilationZoneName 칸을 낸다(21/21). **값이 전부 "<세대> VentilationZoneName"**
    // — 칸 이름을 그대로 적은 템플릿 기본값이다. 공조존이라 부를 수 없다.
    const a = spaceProps(arch)
    expect(a.count('VentilationZoneName')).toBe(21)
    const values = new Set([...a.out.values()].map((p) => p.get('VentilationZoneName') as string))
    expect([...values].every((v) => v.endsWith('VentilationZoneName'))).toBe(true)

    // IfcZone 은 COBie 판본에만 있고, 공조존이 아니라 세대(점유 구역)다.
    const zones = ids(cobie, WebIFC.IFCZONE, true).map((z) => api.GetLine(cobie.m, z))
    expect(zones.map((z) => z.Name.value).sort()).toEqual(['Apartment A', 'Apartment B'])
    expect(zones.every((z) => z.ObjectType?.value === 'OccupancyZoneName')).toBe(true)
  }, 300_000)

  it('방과 방을 잇는 문: 공간 경계에서 나온다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    // 두 방에 걸린 문이 방-문-방 연결이다. 하나에만 걸린 것은 현관(바깥으로 난 문)이다.
    expect(doorLinks({ api, m: api.OpenModel(new Uint8Array(readFileSync(SAMPLE))) })).toEqual({ doors: 5, hist: { 1: 2, 2: 3 } })
    expect(doorLinks({ api, m: api.OpenModel(new Uint8Array(readFileSync(DUPLEX_ARCH))) })).toEqual({ doors: 14, hist: { 1: 4, 2: 9, 3: 1 } })
    // COBie 판본은 공간 경계가 없어 문이 있어도 잇지 못한다.
    expect(doorLinks({ api, m: api.OpenModel(new Uint8Array(readFileSync(DUPLEX_COBIE))) })).toEqual({ doors: 14, hist: {} })
  }, 300_000)

  it('관제점의 몸체(센서)는 BIM 에 있지만, 무엇을 재는지는 없다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const mep = { api, m: api.OpenModel(new Uint8Array(readFileSync(MEP))) }
    expect(ids(mep, WebIFC.IFCSENSOR)).toHaveLength(7)
    expect(ids(mep, WebIFC.IFCCONTROLLER)).toHaveLength(0)
    // 센서·제어기를 설비에 잇는 관계. 이게 있어야 brick:hasPoint 의 주인을 BIM 에서 안다.
    expect(ids(mep, WebIFC.IFCRELFLOWCONTROLELEMENTS)).toHaveLength(0)
    // 계통이 무엇을 담당하는지는 건물 단위로만 말한다. 공간 단위 담당은 없다.
    const serves = ids(mep, WebIFC.IFCRELSERVICESBUILDINGS).map((r) => api.GetLine(mep.m, r))
    expect(serves).toHaveLength(37)
    expect(new Set(serves.flatMap((s) => s.RelatedBuildings.map((h: any) => api.GetLineType(mep.m, h.value))))).toEqual(new Set([WebIFC.IFCBUILDING]))
  }, 300_000)

  it('담당 공간 근사(공조기 → 같은 계통 말단 → 말단의 방)는 조건을 갖춘 파일이 없다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    // 계통 하나에 에너지 변환·이송 기기와 말단이 같이 든 경우를 센다.
    const withBoth = (m: ReturnType<typeof importIfc>) => {
      const role = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.role]))
      return m.systems.filter((sys) => {
        const r = sys.memberIds.map((id) => role.get(id))
        return r.some((x) => x === 'conversion' || x === 'moving') && r.includes('terminal')
      }).length
    }
    // ifc4Mep 은 급기·배기 두 계통이 공조기와 토출구를 같이 묶었다. 그런데 방이 없다.
    const mep = importIfc(api, new Uint8Array(readFileSync(MEP)))
    expect([withBoth(mep), mep.systems.length]).toEqual([2, 37])
    expect(countOf(mep).spaces).toBe(0)
    // Duplex 는 방이 있는데(합치면) Revit System Name 계통이 기기와 말단을 따로 묶었다.
    const hvac = importIfc(api, new Uint8Array(readFileSync(DUPLEX_HVAC)))
    expect([withBoth(hvac), hvac.systems.length]).toEqual([0, 34])
  }, 300_000)

  it('좌표 기준점: 위경도는 있고, 지도 변환(IfcMapConversion)은 없다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    for (const path of [SAMPLE, MEP, DUPLEX_ARCH, DUPLEX_HVAC]) {
      const text = readFileSync(path, 'latin1')
      // IfcSite 의 RefLatitude 가 채워져 있다(LoGeoRef 20). 평면 좌표를 지도에 얹는 변환은 없다.
      expect(text).toMatch(/IFCSITE\([^;]*\.ELEMENT\.,\(\d+,\d+/)
      expect(text).not.toMatch(/IFCMAPCONVERSION\(/)
    }
  }, 300_000)
})

// 파일 목록이 보이는 요약(등급 칩)을 지킨다. dev 서버가 이 계산을 그대로 쓰므로, 여기 값이 곧
// 화면의 값이다. 임포터를 고쳐서 칸이 바뀌면 여기서 먼저 보인다.
describe.skipIf(!existsSync(SAMPLE) || !existsSync(MEP) || !existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_HVAC) || !existsSync(DUPLEX_MEP) || !existsSync(DUPLEX_COBIE))('파일 목록의 등급 칩', () => {
  it('파일마다 어느 칸이 얼마나 차는지', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const chips = (path: string) =>
      profileOf(importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model).tiers.map((t) => `${t.label} ${t.figure}`).join(' | ')

    // 순서: 공간 · 설비(좌표 있는 기기) · 소속(방을 찾은 기기) · 연결망(연결 수) ·
    // 방향(덕트·배관으로 다른 기기와 이어진 기기 중 흐름 방향으로 이어진 기기 — deviceFlows 참조)
    expect(chips(SAMPLE)).toBe('공간 7 | 설비 — | 소속 — | 연결망 — | 방향 —')
    expect(chips(DUPLEX_ARCH)).toBe('공간 19/21 | 설비 — | 소속 — | 연결망 — | 방향 —')
    // 설비 전용. 방이 없어 소속이 0 이다. 연결 1,995개는 **전부** 방향을 아는데 기기 단위로는
    // 37/103 이다 — 나머지 66대는 난방·오수처럼 원천 기기(보일러·펌프)가 모델에 없는 망에 형제로만
    // 매달려서 "누가 이 기기에 공급하나" 에 답이 없다. 연결 단위(100%)로 보이면 DT 가 받는 것을
    // 크게 부풀려 말하게 된다.
    expect(chips(MEP)).toBe('공간 — | 설비 285/307 | 소속 0/307 | 연결망 1995 | 방향 37/103')
    // 공간 1 은 지붕뿐이다. 기기 40대가 갈 방이 없다 — 건축 파일을 덧붙이면 소속 40 이 된다.
    // 연결 단위로는 39%(190/485)가 방향을 아는데, 기기에서 출발한 방향 사슬은 전부 중간의
    // SOURCEANDSINK 에서 끊긴다. 기기끼리 닿는 흐름은 0 이다.
    expect(chips(DUPLEX_HVAC)).toBe('공간 1 | 설비 40 | 소속 0/40 | 연결망 485 | 방향 0/26')
    expect(chips(DUPLEX_MEP)).toBe('공간 42 | 설비 141 | 소속 141 | 연결망 785 | 방향 0/31')
    // COBie 판본은 형상이 없다. 좌표도 외곽선도 0 인데 소속은 BIM 이 전부 말해 준다.
    expect(chips(DUPLEX_COBIE)).toBe('공간 0/22 | 설비 0/133 | 소속 133 | 연결망 0 | 방향 —')
  }, 300_000)

  it('구문이 깨진 COBie 판본 셋은 이유를 말하며 멈춘다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    // 피트·인치 표기(6'8")의 작은따옴표가 이스케이프되지 않았다. 5개 판본 중 3개가 이렇다.
    for (const stage of ['Handover', 'ProductInstall', 'ProductSelect']) {
      const path = `data/NBU_Duplex/NBU_Duplex-Apt-COBie_Arch-${stage}.ifc`
      if (!existsSync(path)) continue
      expect(readFileSync(path, 'latin1')).toContain(`IFCLABEL('Atherton 6'8" Smooth')`)
      expect(() => importIfc(api, new Uint8Array(readFileSync(path)))).toThrow(UnreadableIfcError)
    }
  }, 300_000)
})

// **이 과제의 산출물이 받는 쪽에서 실제로 읽히는지.** CLAUDE.md 는 "ieum-pipeline 의 ttl.go 가
// 읽을 수 있어야 한다" 를 계약으로 적었는데, 한동안 TTL 문자열의 모양만 테스트했다. 그러는 동안
// brick:feeds 를 독립 문장으로 써서 ttl.go 가 **흐름 연결을 전부 버리고** 있었다(ifc4Mep 1,995 → 0).
//
// 그래서 진짜 ttl.go 로 읽는다. 저장소에 복사본을 두지 않고 돌 때마다 옆 저장소에서 복사해
// 빌드한다 — 복사본은 언젠가 원본과 어긋난다. 옆 저장소나 Go 가 없으면 건너뛴다.
const TTL_GO = '../ieum-pipeline/internal/ontology/ttl.go'
const hasGo = (() => {
  try {
    execFileSync('go', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!existsSync(TTL_GO) || !hasGo)('ieum-pipeline 의 ttl.go 가 읽는가', () => {
  type Parsed = { Key: string; BrickClass: string; Feeds: string[] | null; Locations: string[] | null; Parts: string[] | null }
  let bin = ''
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ttlgo-'))
    mkdirSync(join(dir, 'ontology'))
    copyFileSync(TTL_GO, join(dir, 'ontology', 'ttl.go'))
    writeFileSync(join(dir, 'go.mod'), 'module ttlcheck\n\ngo 1.22\n')
    writeFileSync(
      join(dir, 'main.go'),
      [
        'package main',
        'import ("encoding/json"; "os"; "ttlcheck/ontology")',
        'func main() {',
        '  ents, err := ontology.Parse(os.Stdin)',
        '  if err != nil { panic(err) }',
        '  json.NewEncoder(os.Stdout).Encode(ents)',
        '}',
      ].join('\n'),
    )
    bin = join(dir, process.platform === 'win32' ? 'ttlcheck.exe' : 'ttlcheck')
    execFileSync('go', ['build', '-o', bin, '.'], { cwd: dir })
  }, 300_000)

  const parse = (ttl: string): Parsed[] => JSON.parse(execFileSync(bin, { input: ttl, maxBuffer: 1 << 28 }).toString())
  const count = (ents: Parsed[], f: (e: Parsed) => string[] | null) => ents.reduce((n, e) => n + (f(e)?.length ?? 0), 0)

  /**
   * 모델에서 "기기 → 기기" 흐름 쌍을 센다. 덕트·배관은 지나가기만 하고, 방향을 아는 변만 탄다.
   * 받는 쪽(ttl.go)은 덕트를 엔티티로 읽지 않으므로, 기기끼리 닿는지가 곧 계약이다.
   */
  const devicePairs = (model: ReturnType<typeof importIfc>) => {
    const role = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.role]))
    const out = new Map<string, string[]>()
    for (const c of model.connections) if (c.directed) out.set(c.from, [...(out.get(c.from) ?? []), c.to])
    const pairs = new Set<string>()
    for (const [id, r] of role) {
      if (isConduit(r)) continue
      const stack = [...(out.get(id) ?? [])]
      const seen = new Set(stack)
      while (stack.length) {
        const cur = stack.pop()!
        if (!isConduit(role.get(cur) ?? null)) {
          pairs.add(`${id}>${cur}`)
          continue
        }
        for (const n of out.get(cur) ?? []) if (!seen.has(n)) seen.add(n), stack.push(n)
      }
    }
    return pairs
  }
  /** ttl.go 가 읽은 엔티티에서 feeds 쌍. 키의 역슬래시는 풀어서 모델 id 와 견준다. */
  const parsedPairs = (ents: Parsed[]) =>
    new Set(ents.flatMap((e) => (e.Feeds ?? []).map((t) => `${unescapeKey(e.Key)}>${unescapeKey(t)}`)))
  /** ttl.go 가 남긴 Turtle 이스케이프(`\$`)를 푼다. 저쪽이 풀어 주기 전까지 우리 id 와 견주는 데만 쓴다. */
  const unescapeKey = (key: string) => key.replace(/\\(.)/g, '$1')

  it('기기에서 기기로 가는 흐름이 받는 쪽에 전부 닿는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const fixture = importIfc(api, new Uint8Array(readFileSync('src/lib/ifc/fixtures/mep.ifc')))
    const want = devicePairs(fixture)
    const got = parsedPairs(parse(modelToTTL(fixture)))
    // 공조기 → (덕트) → 토출구. 덕트는 받는 쪽에 없지만 공조기가 토출구에 닿아야 한다.
    expect(want.size).toBe(1)
    expect([...want].filter((p) => !got.has(p))).toEqual([])

    if (!existsSync(MEP)) return
    const mep = importIfc(api, new Uint8Array(readFileSync(MEP)))
    expect(mep.connections.filter((c) => c.directed)).toHaveLength(1995)
    const mepWant = devicePairs(mep)
    const mepGot = parsedPairs(parse(modelToTTL(mep)))
    // 한때 받는 쪽의 feeds 가 0 이었다.
    expect(mepWant.size).toBeGreaterThan(0)
    expect([...mepWant].filter((p) => !mepGot.has(p))).toEqual([])
  }, 300_000)

  it('기기의 소속은 다 읽고, 덕트·배관은 일부러 읽히지 않는다', async () => {
    if (!existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_HVAC)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_ARCH))).model
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_HVAC))).model
    const { model } = mergeModels(arch, hvac)
    const ents = parse(modelToTTL(model))
    const equipment = model.storeys.flatMap((s) => s.equipment)

    // 기기 40대의 소속이 전부 받는 쪽에 닿는다. 이상 알림의 발생 위치가 이것이다.
    expect(equipment.filter((e) => !isConduit(e.role) && e.spaceId)).toHaveLength(40)
    expect(count(ents.filter((e) => e.BrickClass !== 'Room'), (e) => e.Locations)).toBe(40)
    // 기기 → 기기 흐름도 전부 닿는다(덕트를 건너뛰어 적은 것 포함).
    const want = devicePairs(model)
    expect([...want].filter((p) => !parsedPairs(ents).has(p))).toEqual([])

    // 덕트·배관은 fso: 클래스라 ttl.go 가 엔티티로 읽지 않는다(brick:·ex: 만 읽는다). **일부러다.**
    // ex: 로 넣으면 ieum 쪽 설비 목록이 여섯 배로 부푼다. 그 대가로 계통의 hasPart 가 가리키는
    // 덕트·배관은 ieum 에서 "유령" 노드로 남는다.
    const keys = new Set(ents.map((e) => e.Key))
    expect(equipment.filter((e) => isConduit(e.role) && keys.has(escapeLocalName(e.id)))).toHaveLength(0)
  }, 300_000)

  it('우리가 짓는 id 는 GeoJSON 과 같은 문자열로 읽히고, GUID 의 $ 는 아직 어긋난다', async () => {
    if (!existsSync(DUPLEX_MEP)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const mep = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP))).model
    const ents = parse(modelToTTL(mep))
    const keys = new Set(ents.map((e) => e.Key))

    // Revit System Name 에서 세운 계통 id 는 이스케이프가 필요 없게 지었다. GeoJSON 의 systemId
    // 와 ttl.go 의 키가 같은 문자열이다.
    for (const s of mep.systems) expect(keys.has(s.id)).toBe(true)

    // **GUID 에 든 $ 는 Turtle 규칙상 \$ 로 써야 하는데, ttl.go 가 이스케이프를 풀지 않는다.**
    // 그래서 받는 쪽 키에 역슬래시가 남고 GeoJSON 의 id 와 이어지지 않는다. 우리 쪽에서는 못
    // 피한다($ 를 그대로 쓰면 Turtle 이 깨진다). ttl.go 가 키의 `\X` 를 `X` 로 풀면 이 값이 0 이
    // 되고, 그때 이 검사를 "전부 같다" 로 바꾼다.
    const ids = [...mep.storeys.flatMap((s) => [...s.spaces.map((x) => x.id), ...s.equipment.filter((e) => !isConduit(e.role)).map((e) => e.id)])]
    const withDollar = ids.filter((id) => id.includes('$'))
    const unmatched = ids.filter((id) => !keys.has(id))
    expect(unmatched).toEqual(withDollar)
    expect(withDollar.length).toBeGreaterThan(0)
  }, 300_000)
})
