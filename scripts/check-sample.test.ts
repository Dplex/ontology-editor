import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc, importIfcWithMeshes, readMeshes, UnreadableIfcError } from '../src/lib/ifc/import'
import { openingPlacement, spacesBesideOpening } from '../src/lib/ifc/element-geometry'
import { profileOf } from '../src/lib/profile'
import { countOf, isConduit, polygonArea, type Vec2 } from '../src/lib/model'
import { assignEquipment, assignEquipmentToSpaces, locate, pointInPolygon, scoreAgainstDeclared, SNAP } from '../src/lib/mapping'
import { mergeModels } from '../src/lib/merge'
import { escapeLocalName, modelToTTL } from '../src/lib/export/ttl'
import { modelToGeoJSON } from '../src/lib/export/geojson'
import { deviceFlows, inferConnections, REACH, TOLERANCE } from '../src/lib/topology'
import { inferFlowByRules, newlyDisagreeing, withInferred } from '../src/lib/flow-rules'
import { airServices } from '../src/lib/served'
import { completenessChecks } from '../src/lib/checks'
import { roomKind } from '../src/lib/kinds'
import { requirementsReport } from '../src/lib/requirements'
import { compareVersions } from '../src/lib/versions'
import { fuzzEdits } from '../src/lib/edit-fuzz'
import type { Model } from '../src/lib/model'
import { readIdf } from '../src/lib/idf/read'
import { attachIdf, modelFromIdf } from '../src/lib/idf/attach'
import { overlapArea } from '../src/lib/polygon'
import { baselineOf, deleteSpace, deleteWall, moveOpening, moveWall, moveWallWithSpaces, renameSpace, setWallLoadBearing, type WallCarryPlan } from '../src/lib/edit'
import { applyEdits, exportEdits, parseEditFile } from '../src/lib/edit-file'

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
    // IfcDistributionElement 2,202개 + 포트가 달린 Proxy 1개(`Di2901`). Proxy 는 포트로 배관망에
    // 붙어 있으면 설비로 받는다(import.ts). 이름이 사전에 없어 종류는 모른다.
    expect(counts.equipment).toBe(2203)
    // 설비의 86%가 덕트·배관이다. 합쳐서 "설비 2,202대" 로 내보내면 기기가 일곱 배로 부푼다.
    expect(counts.devices).toBe(308)
    expect(counts.conduits).toBe(1895)
    // IfcDistributionSystem 15 + IfcDistributionCircuit 22. 상속으로 골라야 37 이 된다.
    expect(counts.systems).toBe(37)
    expect(counts.unplacedEquipment).toBe(28)

    const equipment = model.storeys.flatMap((s) => s.equipment)
    expect(equipment.filter((e) => e.systemId !== null)).toHaveLength(1714)

    // 순환수 6개의 유체. 온수 넷(Heat Flow·Return 두 벌) 중 HEATING 을 적은 것은 둘뿐이라 나머지는 이름(HHF·HHR)으로
    // 읽고, 냉수 둘(KVK·FRK)은 PredefinedType 이 NOTDEFINED 라 이름으로만 읽는다. CHILLEDWATER 를 적은 계통은 없다.
    const fluids = model.systems.filter((s) => s.fluid !== undefined).map((s) => `${s.name}|${s.fluid}|${s.fluidSource}`).sort()
    expect(fluids).toEqual([
      '1_HHF Heat Flow|hot|bim',
      '2_KVK Cooling Flow|chilled|dict',
      '3_FRK Cooling Return|chilled|dict',
      '5_HHR Heat Return|hot|bim',
      '6_HHF Heat Flow|hot|dict',
      '7_HHR Heat Return|hot|dict',
    ])
    expect(modelToTTL(model).match(/a brick:(Hot|Chilled)_Water_System ;/g)).toHaveLength(6)

    // 설비 전용 모델이라 물리존이 없다. 소속을 하나도 못 찾는 것이 정상이고,
    // 이것이 건축 모델과 합쳐야 하는 이유다.
    expect(counts.spaces).toBe(0)
    expect(counts.unlocatedEquipment).toBe(2203)

    // 용량은 타입 객체의 표준 Pset 에 있다. 디퓨저 43개는 Pset_AirTerminalTypeCommon.AirFlowrateRange(범위),
    // 방열기 30개는 Pset_SpaceHeaterTypeCommon.OutputCapacity. 개체의 Pset 만 읽던 때는 0 이었다.
    expect(counts.equipmentWithoutCapacity).toBe(2130)
    const withCapacity = equipment.filter((e) => e.capacity !== null)
    expect(new Set(withCapacity.map((e) => e.capacityProperty))).toEqual(new Set(['AirFlowrateRange', 'OutputCapacity']))
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

    // 용량은 대부분 Revit 이 붙인 비표준 이름이다. `Flow` 155건은 배관 구간의 물 유량인데, 한때 풍량
    // (ex:nominalAirFlowRate)으로 내보냈다. 무엇이 흐르는지 모르는 이름이라 지금은 ex:nominalFlowRate 로 낸다.
    // 타입 객체의 FlowRateRange(보일러 2 · 배관 부속 2)도 읽는다.
    const withCapacity = model.storeys.flatMap((s) => s.equipment).filter((e) => e.capacity !== null)
    expect(withCapacity).toHaveLength(159)
    expect(new Set(withCapacity.map((e) => e.capacityProperty))).toEqual(new Set(['Flow', 'FlowRateRange']))
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
    expect(model.warnings.some((w) => w.includes('바닥 외곽선(FootPrint, SweptSolid)이 없습니다'))).toBe(true)

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

// 문이 잇는 방을 좌표로 짚는 것(element-geometry.ts)이 BIM 의 공간 경계와 얼마나 맞나. 성수 건축은 공간
// 경계가 0 이라 좌표로만 잇는다. 정답지는 공간 경계가 있는 두 파일이다. 외곽선이 없는 방은 좌표로 짚을
// 수 없으니 정답에서 뺀다(Duplex Level 2 의 Hallway 가 외곽선 0 이다). 빼지 않으면 14개 중 6개만 맞는다.
describe.skipIf(!existsSync(SAMPLE) || !existsSync(DUPLEX_ARCH))('문이 잇는 방 (공간 경계를 정답지로)', () => {
  it('문 양쪽을 좌표로 짚은 방이 공간 경계와 맞는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const agreement = (path: string) => {
      const bytes = new Uint8Array(readFileSync(path))
      const model = importIfc(api, bytes)
      const id = api.OpenModel(bytes)
      const doors = new Set(api.GetLineIDsWithType(id, WebIFC.IFCDOOR, true) as unknown as Iterable<number>)
      const meshes = readMeshes(api, id, doors, (e) => (api.GetLine(id, e) as { GlobalId: { value: string } }).GlobalId.value)
      api.CloseModel(id)
      const spaces = model.storeys.flatMap((s) => s.spaces)
      let same = 0
      let total = 0
      for (const storey of model.storeys) {
        for (const o of storey.openings) {
          if (o.kind !== 'door') continue
          const declared = spaces.filter((s) => s.boundedBy.includes(o.id) && s.footprint.length >= 4).map((s) => s.id).sort()
          const mesh = meshes.get(o.id)
          if (!declared.length || !mesh) continue
          const placement = openingPlacement(mesh)!
          total++
          if (JSON.stringify(spacesBesideOpening(placement, storey.spaces).sort()) === JSON.stringify(declared)) same++
        }
      }
      return `${same}/${total}`
    }
    expect(agreement(SAMPLE)).toBe('5/5')
    // 하나 남는 것은 폭 1.25m 문이다. 좌표로는 한쪽 방도 못 짚었다.
    expect(agreement(DUPLEX_ARCH)).toBe('13/14')
  })

  it('벽의 평면 외곽선과 문·창의 자리를 형상에서 읽는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const bytes = new Uint8Array(readFileSync(DUPLEX_ARCH))
    const model = importIfcWithMeshes(api, bytes, undefined, { openings: true }).model
    const walls = model.storeys.flatMap((s) => s.walls)
    const openings = model.storeys.flatMap((s) => s.openings)
    expect(walls.filter((w) => w.footprint?.length)).toHaveLength(57)
    expect(openings.filter((o) => o.position)).toHaveLength(38)
    // 공간 경계가 있는 파일이라 문이 잇는 방은 전부 BIM 에서 온다.
    expect(openings.filter((o) => o.kind === 'door' && o.connectsSource === 'bim')).toHaveLength(14)

    // 문·창 형상은 로봇 경로용이라 기본은 읽지 않는다. 공간 경계가 말한 문-방은 형상이 없어도 나온다.
    const plain = importIfcWithMeshes(api, bytes).model.storeys.flatMap((s) => s.openings)
    expect(plain.filter((o) => o.position)).toHaveLength(0)
    expect(plain.filter((o) => o.kind === 'door' && o.connectsSource === 'bim')).toHaveLength(14)
  })
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

    // 공간 22개 전부 외곽선이 나온다(SweptSolid). 외곽선이 없던 시절에는 소속 판정을
    // 아예 못 돌려서 미소속이 759대였다. 외곽선으로 424대, 벽면 여유(SNAP 5cm)로 270대가
    // 됐다. 남은 270대는 **전부 덕트·배관**이다 — 기기 141대는 한 대도 안 남는다.
    // 파일에는 42개가 있다 — "MEP Space" 와 건축 Room 사본이 같은 자리·같은 방 번호로 20쌍(dropDuplicateSpaces).
    // 지붕 둘(R301 · R301-M)은 외곽선이 달라서(135㎡ · 146㎡) 남긴다.
    expect(counts.spaces).toBe(22)
    expect(model.warnings.some((w) => w.includes('물리존 20개가 두 번'))).toBe(true)
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
    expect(truth.size).toBe(1974)

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
    expect(mm5).toEqual({ got: 1882, tp: 1496, fp: 386, fn: 478, precision: 1496 / 1882, recall: 1496 / 1974 })

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

    // 설비 판본은 "MEP Space" 와 건축 Room 사본을 같이 담았다(42개). 열 때 같은 방 20쌍을 걷어 22개다.
    expect(countOf(mep).spaces).toBe(22)

    const { model, report } = mergeModels(arch, mep)
    expect(countOf(model).spaces).toBe(21)
    // 건축 판본의 복도 둘은 외곽선이 없었다. 같은 방 번호(A201, B201)의 외곽선을 빌려 온다.
    expect(report.spaces).toEqual({ dropped: 22, kept: 0, borrowed: 2 })
    // 건축 판본끼리도 방이 겹친다(현관과 계단실). 그 자리의 설비 13대가 전부 가장 작은 방에서 맞는다(첫 방이면 11).
    expect(overlapScore(model)).toEqual({ total: 13, smallest: 13, first: 11 })
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
    expect(report.unlocated.after).toBe(2203)
  }, 300_000)
})

// **확장의 여지를 잰다.** 온톨로지를 더 넓히려면 IFC 에 그 정보를 담을 자리가 있어야 하고
// (스키마), 실제 파일이 그 자리를 채워야 한다(저작 도구). 둘을 따로 센다 — "IFC 에 없다" 와
// "IFC 에 자리는 있는데 비어 있다" 는 고객사에 할 말이 다르다. `docs/bim-to-dt-ontology.md` §3.6 의
// 확장 표와 4장 요구사항 표의 숫자가 여기서 나온다. 임포터가 아직 안 읽는 것들이라 web-ifc 로 직접 센다.
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

    // 방 높이는 ArchiCAD 가 수량으로 준다(7/7). 층마다 거의 한 값이라(2.5m 6개, 다락 4m 1개) 요구하지 않는다(정본 4.3).
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
    expect(chips(MEP)).toBe('공간 — | 설비 286/308 | 소속 0/308 | 연결망 1995 | 방향 37/103')
    // 공간 1 은 지붕뿐이다. 기기 40대가 갈 방이 없다 — 건축 파일을 덧붙이면 소속 40 이 된다.
    // 연결 단위로는 39%(190/485)가 방향을 아는데, 기기에서 출발한 방향 사슬은 전부 중간의
    // SOURCEANDSINK 에서 끊긴다. 기기끼리 닿는 흐름은 0 이다.
    expect(chips(DUPLEX_HVAC)).toBe('공간 1 | 설비 40 | 소속 0/40 | 연결망 485 | 방향 0/26')
    expect(chips(DUPLEX_MEP)).toBe('공간 22 | 설비 141 | 소속 141 | 연결망 785 | 방향 0/31')
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

// --- 여러 BIM 에 같이 대 보기 ---------------------------------------------------------
//
// **한 파일에 맞춘 조정은 다른 파일에서 떨어진다.** 이름 사전·흐름 규칙·임포터의 숫자(벽면 여유 SNAP, 배치점
// 보정 0.5m, 형상 추정 거리)는 BIM 마다 저작 습관이 달라서, 한 파일을 올리려고 고치면 다른 파일이 내려가기
// 쉽다. 그래서 고칠 때마다 가진 BIM 전부에 같이 대 본다. 개수는 그대로 박고, 정확도는 **지금 값 아래로
// 떨어지면 실패**로 둔다(오르면 기준을 올린다). 하나가 오르고 다른 하나가 내려가는 변경은 과적합이다.

/**
 * 같은 층 방이 겹친 자리에 든 설비를 BIM 이 말한 소속에 대 본다. `smallest` 는 지금 규칙(가장 작은 방, mapping.ts 의
 * locate), `first` 는 예전 규칙(목록의 첫 방)으로 맞힌 수다. scoreAgainstDeclared 는 걸린 방 중 하나만 맞아도 맞힌 것으로
 * 세서 이 차이를 못 잰다. **smallest 가 first 아래로 내려가면 규칙을 되돌린 것이다.**
 */
function overlapScore(model: Model): { total: number; smallest: number; first: number } {
  const out = { total: 0, smallest: 0, first: 0 }
  for (const storey of model.storeys) {
    for (const e of storey.equipment) {
      if (e.spaceSource !== 'bim' || !e.position || !e.spaceId) continue
      const inside = storey.spaces.filter((x) => pointInPolygon([e.position![0], e.position![1]], x.footprint))
      if (inside.length < 2) continue
      out.total++
      if (locate([e.position[0], e.position[1]], storey.spaces) === e.spaceId) out.smallest++
      if (inside[0].id === e.spaceId) out.first++
    }
  }
  return out
}

/** 규칙 방향까지 넣은 완전성 검사. 화면(App.vue)과 같은 입력이다. */
function checksOf(model: Model) {
  const out: Record<string, string> = {}
  for (const c of completenessChecks(model, airServices(model, withInferred(model.connections)))) {
    out[c.key] = c.skipped ? 'skip' : `${c.total - c.failed.length}/${c.total}`
  }
  return out
}

// NIBS Medical Clinic. 성수처럼 Revit 이 IFC2x3 으로 내보낸 건물이고 건축과 설비가 따로 있다. HVAC 판본은
// 포트가 있고, MEP 판본(207MB)은 포트가 없어 연결을 형상으로 추정한다 — 크기가 성수 기계(203MB)와 비슷하다.
// 받는 법: npm run fetch:sample 뒤 안내대로 NBU_MedicalClinic 압축을 푼다.
const CLINIC_ARCH = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
const CLINIC_HVAC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc'
const CLINIC_MEP = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-MEP.ifc'

describe.skipIf(!existsSync(CLINIC_ARCH) || !existsSync(CLINIC_HVAC))('병원 건축 + HVAC (포트 있음)', () => {
  it('소속과 규칙 방향이 BIM 이 말한 것과 맞는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_ARCH))).model
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_HVAC))).model
    const { model } = mergeModels(arch, hvac)

    const c = countOf(model)
    expect({ storeys: c.storeys, devices: c.devices, conduits: c.conduits, systems: c.systems, connections: c.connections, directed: c.directedConnections })
      .toEqual({ storeys: 4, devices: 668, conduits: 3138, systems: 15, connections: 3697, directed: 3695 })

    // F11. BIM 이 소속을 말한 설비 2,216대를 정답지로(2026-09-24 실측 97.4%).
    const score = scoreAgainstDeclared(model)
    expect(score.total).toBe(2216)
    expect(score.agreed / score.total).toBeGreaterThanOrEqual(0.973)
    // 방이 겹친 자리(큰 대기실이 접수대를 품는다)의 설비는 가장 작은 방으로. 첫 방을 고르던 때는 156 이었다.
    expect(overlapScore(model)).toEqual({ total: 180, smallest: 169, first: 156 })

    // 규칙 방향을 포트가 말한 방향에 대 본다. 포트가 다 말해서 새로 준 방향은 없다. 타입 객체에 적힌 종류(VAV 115 ·
    // 그릴 206 · 팬 6)를 읽으면서 대 볼 연결이 3,673 에서 3,694 로 늘었다. 맞은 수(3,670)는 그대로이고 늘어난 어긋남
    // 21 은 전부 천장 배기팬이다(아래 테스트). 99.9% → 99.35% 는 규칙이 원래 틀리던 곳이 보이게 된 것이다.
    const rules = inferFlowByRules(model)
    expect({ agree: rules.agree, checked: rules.agree + rules.disagree }).toEqual({ agree: 3670, checked: 3694 })
    expect(rules.agree / (rules.agree + rules.disagree)).toBeGreaterThanOrEqual(0.9935)

    expect(checksOf(model)).toEqual({
      'terminal-source': '439/440',
      'source-terminal': '4/10',
      'terminal-single-source': '234/234',
      'device-space': '665/668',
      // 욕실 부속·소화기함 101대는 이름으로 흐름 없는 종류가 되어 빠진다(병원 건축이 SanitaryTerminal 로 냈다). 전에는 569/667.
      'device-connected': '565/566',
    })
  }, 300_000)

  // 요구사항 보고서(정본 4장). Revit IFC2x3 의 전형이다 — 필수는 거의 다 차 있고, 권장이 떨어지는 것은 값이 없어서가 아니라
  // 자리가 달라서다(방 분류는 Category Code, 계통은 System Name, 용량은 PSet_Revit_*). IDS 로는 셋 다 실패로만 보인다.
  it('요구사항 보고서: 권장은 대부분 "다른 자리"에 있다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_ARCH))).model
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_HVAC))).model
    const { model, report } = mergeModels(arch, hvac)
    const rows = new Map(requirementsReport(model, report).map((r) => [r.id, r]))
    const brief = (id: string) => ({ state: rows.get(id)!.state, counts: rows.get(id)!.counts })

    // 건축 Roof - Main 과 설비 Roof - Mech 가 이름이 달라 높이로 맞췄다.
    expect(brief('R1')).toEqual({ state: 'partial', counts: { standard: 3, elsewhere: 0, of: 4 } })
    expect(rows.get('R7')!.state).toBe('missing')
    expect(brief('R14')).toEqual({ state: 'partial', counts: { standard: 0, elsewhere: 269, of: 272 } })
    expect(rows.get('R10')!.state).toBe('elsewhere')
    expect(brief('R17')).toEqual({ state: 'partial', counts: { standard: 0, elsewhere: 3701, of: 3806 } })
    expect(brief('R22')).toEqual({ state: 'partial', counts: { standard: 0, elsewhere: 563, of: 566 } })
    // SPLITSYSTEM 2대는 표준 값이지만 받지 않는다(kinds.ts 의 IFC_REJECTED). 이름 사전이 종류를 알아서 다른 자리로 간다.
    expect(brief('R25')).toEqual({ state: 'partial', counts: { standard: 662, elsewhere: 5, of: 668 } })
    expect(rows.get('R23')!.note).toContain('기본값')
  }, 300_000)

  // 방 종류. Revit 은 방마다 OmniClass Table 13 코드를 `Category Code` 속성으로 적는다(269/269). 이름 사전이 먼저이고
  // (`JAN. CL.` 은 코드로는 창고지만 청소도구실이다), 이름이 모르는 방 55개(사무실 38 · 창고 7 · 회의실 4 · 전기실 3 ·
  // 기계실 2 · 승강로 1)를 코드가 말한다. 코드 표는 kinds.ts 의 ROOM_KINDS.omniclass 이고 requirements.ids 의 R14 어휘다.
  it('방 종류: 이름 사전이 놓친 방을 OmniClass 코드가 말한다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const spaces = importIfc(api, new Uint8Array(readFileSync(CLINIC_ARCH))).storeys.flatMap((s) => s.spaces)
    expect(spaces.filter((s) => s.omniclass)).toHaveLength(269)
    expect(spaces.filter((s) => s.kind)).toHaveLength(173)
    expect(spaces.filter((s) => s.kindSource === 'bim')).toHaveLength(55)
  }, 300_000)

  // IFC2x3 은 개체가 `IfcFlowTerminal` 처럼 추상적이지만 타입 객체(`IfcAirTerminalBoxType` …)가 종류를 말한다. 그걸 읽기
  // 전에는 사람이 패밀리 다섯을 골라야 했고, 지금은 BIM 이 말한 대로 붙는다(출처 BIM). 모르는 기기는 1대만 남는다.
  // **천장 배기팬(흡입구 일체형)이 팬이 되면 배기 계통 6개가 포트와 정반대(0/21)가 된다.** 배기 계통은 원천(팬) 쪽으로
  // 흐른다는 규칙이, 흡입구를 품고 덕트로 내보내는 팬에는 거꾸로다. 규칙을 고치면 성수가 움직이므로 성수를 잴 수 있을
  // 때 고친다. 그때 3,694 중 어긋남 24 가 줄어야 한다. 지금은 화면이 그 계통을 바로 알린다.
  it('타입에 적힌 종류를 읽으면 말단이 원천에 닿는 것이 늘고, 천장 배기팬은 배기 규칙과 거꾸로다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_ARCH))).model
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_HVAC))).model
    const { model } = mergeModels(arch, hvac)
    const devices = model.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
    // 병원 건축의 욕실 부속·소화기함 101대는 BIM 이 SanitaryTerminal 이라 했지만 이름이 먼저다(전에는 428).
    expect(devices.filter((e) => e.kindSource === 'bim')).toHaveLength(327)
    expect(devices.filter((e) => !e.kind)).toHaveLength(1)

    // 타입을 안 읽던 때와 같은 모델.
    const unread = structuredClone(model)
    for (const e of unread.storeys.flatMap((s) => s.equipment)) if (e.kindSource === 'bim') e.kind = null
    expect(checksOf(unread)['terminal-source']).toBe('234/234')
    expect(checksOf(model)['terminal-source']).toBe('439/440')

    const worse = newlyDisagreeing(inferFlowByRules(unread), inferFlowByRules(model)).map((w) => model.systems.find((x) => x.id === w.systemId)!)
    expect(worse.every((sy) => sy.kind === 'exhaust_air')).toBe(true)
    expect(worse).toHaveLength(6)
    const fans = devices.filter((e) => e.systemId && worse.some((sy) => sy.id === e.systemId) && e.kind === 'fan')
    expect(fans.every((e) => e.declaredType?.startsWith('Fan.'))).toBe(true)
    expect(fans.length).toBeGreaterThan(0)
  }, 300_000)
})

describe.skipIf(!existsSync(CLINIC_ARCH) || !existsSync(CLINIC_MEP))('병원 건축 + MEP (포트 없음, 207MB)', () => {
  it('소속은 맞지만, 포트가 없으면 규칙 방향이 거의 서지 않는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_ARCH))).model
    const mep = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_MEP))).model
    const { model } = mergeModels(arch, mep)

    const c = countOf(model)
    expect({ devices: c.devices, conduits: c.conduits, systems: c.systems, connections: c.connections, directed: c.directedConnections })
      .toEqual({ devices: 3469, conduits: 12645, systems: 16, connections: 13890, directed: 0 })

    // F11(2026-09-24 실측 97.2%).
    const score = scoreAgainstDeclared(model)
    expect(score.total).toBe(7742)
    expect(score.agreed / score.total).toBeGreaterThanOrEqual(0.971)
    expect(overlapScore(model)).toEqual({ total: 637, smallest: 584, first: 563 })

    // **포트가 없으면 규칙이 퍼질 길이 끊겨 있다.** 연결 13,890개 중 규칙이 방향을 준 것이 1,345개이고(타입의 종류를
    // 읽기 전에는 12개), 공기 말단 454개 중 원천에 닿는 것이 21개뿐이다. 설비 1,806대가 어디에도 이어지지 않는다(임포트 경고). R-요구사항의 근거다.
    // 이 숫자가 오르면 좋은 일이지만, 다른 BIM 이 같이 떨어지지 않았는지 먼저 본다.
    const rules = inferFlowByRules(model)
    expect(rules.oriented).toBeGreaterThanOrEqual(1345)
    expect(checksOf(model)).toEqual({
      'terminal-source': '21/454',
      'source-terminal': '16/136',
      'terminal-single-source': '21/21',
      'device-space': '3337/3469',
      'device-connected': '850/884',
    })
  }, 600_000)
})

// 성수(고객사 실측). 받을 곳이 없고 성수를 가진 PC 와 55 의 data/성수/ 에만 있다(정본 부록).
// 기준값은 정본(docs/bim-to-dt-ontology.md)에 적힌 실측이다. **이 기준을 넣은 PC 에는 성수가 없어서 다시 재지
// 못했다.** 어긋난 것을 한 번에 다 보려고 expect.soft 로 둔다. 어긋나면 코드와 문서 중 어느 쪽이 맞는지 가려
// 둘 다 고친다. 규칙 일치율 83.8% 만은 soft 가 아니다 — CLAUDE.md 가 규칙을 재는 기준으로 쓰는 값이다.
const SEONGSU_ARCH = 'data/성수/Factorial_건축.ifc'
const SEONGSU_MECH = 'data/성수/Factorial_기계.ifc'

describe.skipIf(!existsSync(SEONGSU_ARCH))('성수 건축', () => {
  it('층·물리존·벽과 문이 잇는 방이 정본의 실측과 같다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    // 문이 잇는 방은 문·창 형상을 읽을 때만 좌표로 짚는다(성수는 공간 경계가 0 이다).
    const model = importIfcWithMeshes(api, new Uint8Array(readFileSync(SEONGSU_ARCH)), undefined, { openings: true }).model
    const c = countOf(model)
    expect.soft(model.schema).toBe('IFC2X3')
    expect.soft(c.storeys).toBe(19)
    // 파일에는 934개인데 같은 자리에 겹쳐 둔 방 하나를 걸러 933개다(중복 방 제거, ef71acc).
    expect.soft(c.spaces).toBe(933)
    const walls = model.storeys.flatMap((s) => s.walls)
    expect.soft({
      walls: walls.length,
      loadBearing: walls.filter((w) => w.loadBearing === true).length,
      not: walls.filter((w) => w.loadBearing === false).length,
      unknown: walls.filter((w) => w.loadBearing === null).length,
    }).toEqual({ walls: 1291, loadBearing: 351, not: 913, unknown: 27 })
    const doors = model.storeys.flatMap((s) => s.openings).filter((o) => o.kind === 'door')
    expect.soft(doors).toHaveLength(528)
    expect.soft(doors.filter((d) => (d.connects?.length ?? 0) >= 2)).toHaveLength(233)
    // 방 이름 사전(정본 4장). 넓히면 오르지만 틀리게 읽는 것도 는다 — 떨어지면 실패로만 둔다.
    expect.soft(model.storeys.flatMap((s) => s.spaces).filter((sp) => roomKind(sp.kind)).length).toBeGreaterThanOrEqual(159)
  }, 600_000)
})

describe.skipIf(!existsSync(SEONGSU_MECH))('성수 기계', () => {
  it('설비·연결·규칙 방향이 정본의 실측과 같고, 규칙 일치율이 83.8% 아래로 떨어지지 않는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfcWithMeshes(api, new Uint8Array(readFileSync(SEONGSU_MECH))).model
    const c = countOf(model)
    expect.soft({ devices: c.devices, conduits: c.conduits, systems: c.systems, connections: c.connections, directed: c.directedConnections })
      .toEqual({ devices: 3472, conduits: 15864, systems: 1037, connections: 19515, directed: 8702 })
    const devices = model.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
    // Proxy 로 들어온 기기 1,652대(포트가 있어서 1,578 · 이름이 사전에 있어서 74). 사전을 바꾸면 이름 쪽이 움직인다.
    expect.soft(devices.filter((e) => e.ifcClass === 'BuildingElementProxy')).toHaveLength(1652)

    // 규칙 방향(정본 3.7). 이 83.8% 가 CLAUDE.md 가 말하는 "규칙이 맞는지" 의 기준이다.
    const rules = inferFlowByRules(model)
    expect.soft(rules.oriented).toBe(5457)
    expect.soft(rules.conflicts).toBe(227)
    expect.soft(rules.agree + rules.disagree).toBe(9219)
    expect(rules.agree / (rules.agree + rules.disagree)).toBeGreaterThanOrEqual(0.838)

    // 기기 단위 방향. 등급 칩은 포트 + 확정한 규칙이라 1,903/2,929, 확정 전 규칙까지 넣으면 2,759 다.
    const direction = profileOf(model).tiers.find((t) => t.key === 'direction')!
    expect.soft([direction.have, direction.of]).toEqual([1903, 2929])
    const conduitIds = new Set(model.storeys.flatMap((s) => s.equipment).filter((e) => isConduit(e.role)).map((e) => e.id))
    const withRules = deviceFlows(withInferred(model.connections), (id) => conduitIds.has(id), devices.map((e) => e.id))
    expect.soft(withRules.fed.size).toBeGreaterThanOrEqual(2759)
  }, 900_000)
})

describe.skipIf(!existsSync(SEONGSU_ARCH) || !existsSync(SEONGSU_MECH))('성수 건축 + 기계', () => {
  it('완전성 검사와 담당 공간이 정본의 실측과 같다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(SEONGSU_ARCH))).model
    const mech = importIfcWithMeshes(api, new Uint8Array(readFileSync(SEONGSU_MECH))).model
    const { model } = mergeModels(arch, mech)

    // 공기 원천 268대 중 말단에 닿는 것: 포트만 46, 규칙 방향까지 156(정본 7장).
    const reaching = (conns: typeof model.connections) =>
      airServices(model, conns).filter((s) => s.supply.length + s.extract.length > 0).length
    expect.soft(airServices(model, model.connections)).toHaveLength(268)
    expect.soft(reaching(model.connections)).toBe(46)
    expect.soft(reaching(withInferred(model.connections))).toBe(156)

    // 두 원천에서 받는 급기 말단이 0 이라는 것은 이 규칙이 전부 통과라는 뜻이다(분모는 정본에 없다).
    const checks = checksOf(model)
    const [pass, total] = checks['terminal-single-source'].split('/')
    expect.soft(pass).toBe(total)
    expect.soft({ ...checks, 'terminal-single-source': undefined }).toEqual({
      // 분모가 22 늘었다: 타입 객체에서 종류를 읽게 되면서(603d144) 8AG 그릴 22개를 말단으로 알아본다.
      'terminal-source': '1386/2400',
      'source-terminal': '156/268',
      'terminal-single-source': undefined,
      'device-space': '4137/4911',
      'device-connected': '2991/3632',
    })
  }, 900_000)
})

// 편집을 무작위로 섞어도 편집 파일·되돌리기가 화면과 같은 결과를 내는가(edit-fuzz.ts). 픽스처 판은 npm test 에 있고,
// 여기는 실제 BIM 이다 — 계통이 수십 개고, BIM 소속·포트·Revit 이름이 진짜라서 픽스처에 없는 조합이 나온다.
// 이것으로 찾은 것: 확정 뒤 종류·잇기를 하면 불러온 파일에서 확정 방향이 바뀌던 것, BIM 소속 설비를 옮겼다 돌려놓으면
// 편집 파일에서 빠지던 것.
describe.skipIf(!existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_HVAC) || !existsSync(DUPLEX_MEP) || !existsSync(CLINIC_ARCH) || !existsSync(CLINIC_HVAC))('편집을 무작위로 섞기 (실제 BIM)', () => {
  it('저장·불러오기가 화면과 같고, 전부 되돌리면 연 때와 같다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const load = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    const sets: [string, Model][] = [
      ['Duplex 건축+HVAC', mergeModels(load(DUPLEX_ARCH), load(DUPLEX_HVAC)).model],
      ['Duplex 건축+MEP', mergeModels(load(DUPLEX_ARCH), load(DUPLEX_MEP)).model],
      ['병원 건축+HVAC', mergeModels(load(CLINIC_ARCH), load(CLINIC_HVAC)).model],
    ]
    const failed: string[] = []
    for (const [name, model] of sets) {
      // 씨앗 10개. 고치기 전 코드는 씨앗 1~3 에서 이미 떨어졌다. 늘리면 check:sample 이 그만큼 느려진다(20개에 36초).
      for (let seed = 1; seed <= 10; seed++) {
        const r = fuzzEdits(model, seed, 30)
        if (!r.reloadSame || r.missing || !r.undoSame) {
          failed.push(`${name} seed ${seed} 불러오기 ${r.reloadSame ? '같음' : '다름'} · 못 찾음 ${r.missing} · 되돌리기 ${r.undoSame ? '같음' : '다름'} :: ${r.log.join(' | ')}`)
        }
      }
    }
    expect(failed.slice(0, 3)).toEqual([])
  }, 900_000)
})

// 판본 사이에 GUID 가 남는가(요구사항 R13). 같은 Duplex 를 다른 때 다시 낸 판본끼리 견준다. 짝은 GUID → Revit 요소 ID
// (이름 끝의 숫자) → 이름 → 위치 순으로 짓고, 한 열쇠에 둘 이상이 걸리면 짓지 않는다(lib/versions.ts).
const DUPLEX_MEP_FULL = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const DUPLEX_MEP_2 = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP-2.ifc'
const DUPLEX_MEP_1 = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP-1.ifc'

// 벽·문·창의 지문(E4 편집 파일). 가진 판본끼리는 벽·문·창 GUID 가 전부 그대로다(Duplex 건축 ↔ Optimized 57/57·38/38,
// 병원 1,080/1,080·307/307, Duplex 건축 → COBie 설계 문·창 38/38). 설비처럼 바뀐 실례가 없어서, 실제 BIM 의 GUID 를
// 전부 바꿔 새 판본을 흉내 낸다. 재는 것은 Revit 요소 ID·이름이 실제 파일에서 하나뿐인지다 — 겹치면 짝을 짓지 않는다.
describe.skipIf(!existsSync(DUPLEX_ARCH) || !existsSync(CLINIC_ARCH) || !existsSync(SAMPLE))('벽·문·창 지문 (GUID 를 바꾼 판본)', () => {
  it('옮기고 지운 벽·문·창을 Revit 은 요소 ID 로, ArchiCAD 는 이름으로 전부 찾는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    for (const [path, expected, by] of [[DUPLEX_ARCH, 15, 'revitId'], [CLINIC_ARCH, 15, 'revitId'], [SAMPLE, 8, 'name']] as const) {
      const pristine = importIfcWithMeshes(api, new Uint8Array(readFileSync(path)), undefined, { openings: true }).model
      const a = structuredClone(pristine)
      const base = baselineOf(a)
      const walls = a.storeys.flatMap((s) => s.walls).filter((w) => w.footprint?.length)
      const openings = a.storeys.flatMap((s) => s.openings).filter((o) => o.position)
      // 벽 다섯은 옮기고, 다섯은 내력 여부를 정하고, 다섯은 지운다. 문·창 다섯은 옮긴다(지운 벽에 뚫린 것은 빼고).
      for (const w of walls.slice(0, 5)) moveWall(a, w.id, [0.3, 0])
      for (const w of walls.slice(5, 10)) setWallLoadBearing(a, w.id, true)
      const gone = walls.slice(10, 15)
      for (const w of gone) deleteWall(a, w.id)
      const goneIds = new Set(gone.map((w) => w.id))
      for (const o of openings.filter((x) => !goneIds.has(x.wallId ?? '') && !walls.slice(0, 5).some((w) => w.id === x.wallId)).slice(0, 5)) {
        moveOpening(a, o.id, [o.position![0] + 0.2, o.position![1]])
      }
      const file = parseEditFile(JSON.stringify(exportEdits(a, base, path)))
      if (typeof file === 'string') throw new Error(file)

      const ids = (m: Model) => m.storeys.flatMap((st) => [st.id, ...st.spaces.map((sp) => sp.id), ...st.walls.map((w) => w.id), ...st.openings.map((o) => o.id)])
      let json = JSON.stringify(pristine)
      for (const id of ids(pristine)) json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
      const b: Model = JSON.parse(json)
      const result = applyEdits(b, file)
      expect(result.missing.elements).toBe(0)
      // 편집 파일에 적힌 벽·문·창은 전부 한 열쇠로 찾는다. 이미 내력이던 벽처럼 바뀌지 않은 것은 파일에 없다.
      // ArchiCAD(AC20)는 이름에 Revit 요소 ID 가 없어 이름(층|이름)으로 찾는다 — 벽 13·문창 16개 이름이 층마다 하나뿐이다.
      const written = (file.walls?.length ?? 0) + (file.wallsRemoved?.length ?? 0) + (file.openings?.length ?? 0)
      expect(written).toBeGreaterThanOrEqual(expected)
      expect(result.rematched).toEqual({ revitId: 0, name: 0, position: 0, [by]: written })
      const strip = (m: Model) => JSON.stringify(modelToGeoJSON(m)).split('Qv2').join('')
      expect(strip(b)).toBe(JSON.stringify(modelToGeoJSON(a)))
    }
  }, 600_000)
})

// 벽과 함께 방 경계 옮기기(edit.ts 의 moveWallWithSpaces). Revit 방 경계는 벽 면에 딱 붙지 않아(중심선·마감 두께) 벽 면에
// 끌어 붙이는 방식은 옮기지 않아도 Duplex 방 37개·병원 368개를 바꿨다. 지금은 벽이 움직인 만큼만 옮긴다. 방향키로 다섯 걸음
// 나갔다 돌아오면 방이 제자리여야 한다 — 걸음마다 끌려올 방을 새로 고르던 때는 병원 벽 300개 중 22개에서 어긋났다.
describe.skipIf(!existsSync(DUPLEX_ARCH) || !existsSync(CLINIC_ARCH))('벽과 함께 방 경계 옮기기 (실제 벽)', () => {
  it('벽마다 다섯 걸음 나갔다 돌아오면 방이 전부 제자리이고, 벽 길이 방향으로 밀면 방이 그대로다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const failed: string[] = []
    let carried = 0
    for (const path of [DUPLEX_ARCH, CLINIC_ARCH]) {
      const pristine = importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
      const shape = (m: Model) => m.storeys.flatMap((st) => st.spaces.map((sp) => sp.footprint))
      const same = (a: Vec2[][], b: Vec2[][], tol = 1e-9) => a.every((r, i) => r.length === b[i].length && r.every((p, k) => Math.abs(p[0] - b[i][k][0]) < tol && Math.abs(p[1] - b[i][k][1]) < tol))
      const opened = shape(pristine)
      for (const w of pristine.storeys.flatMap((st) => st.walls).filter((x) => x.footprint?.length).slice(0, 300)) {
        const m = structuredClone(pristine)
        // 벽 길이 방향은 외곽선 조각 전부에서 가장 긴 변이다. 창·문으로 끊긴 벽은 조각 하나가 두께보다 짧기도 해서(병원 외벽
        // 0.04×0.27m) 첫 조각만 보면 두께 방향을 길이로 잡는다.
        let n: Vec2 = [0, 0]
        let u: Vec2 = [0, 0]
        let best = 0
        for (const ring of w.footprint!) {
          for (let i = 0; i + 1 < ring.length; i++) {
            const dx = ring[i + 1][0] - ring[i][0]
            const dy = ring[i + 1][1] - ring[i][1]
            const l = Math.hypot(dx, dy)
            if (l > best) [best, n, u] = [l, [-dy / l, dx / l], [dx / l, dy / l]]
          }
        }
        let plan: WallCarryPlan | null = null
        for (let k = 0; k < 5; k++) {
          const r: NonNullable<ReturnType<typeof moveWallWithSpaces>> = moveWallWithSpaces(m, w.id, [n[0] * 0.1, n[1] * 0.1], plan)!
          if (k === 0) carried += r.changes.length
          plan = r.plan
        }
        for (let k = 0; k < 5; k++) plan = moveWallWithSpaces(m, w.id, [-n[0] * 0.1, -n[1] * 0.1], plan)!.plan
        if (!same(shape(m), opened)) failed.push(`${path} ${w.name} 되돌아오지 않음`)
        // 벽 길이 방향. 형상에서 읽은 벽 면은 완전히 나란하지 않아(1° 안팎) 방이 몇 mm 움직일 수 있다. 1cm 넘으면 틀린 것이다.
        moveWallWithSpaces(m, w.id, [u[0] * 0.5, u[1] * 0.5])
        if (!same(shape(m), opened, 0.01)) failed.push(`${path} ${w.name} 길이 방향에 방이 움직임`)
      }
    }
    // 벽 357개(Duplex 57 + 병원 300)가 첫 걸음에 방 600개 남짓을 끌고 간다. 0 이면 붙일 방을 못 찾는 것이다.
    expect(carried).toBeGreaterThan(500)
    expect(failed.slice(0, 5)).toEqual([])
  }, 900_000)
})

// 편집한 뒤 덧붙이기(App.vue 의 append). 연 때의 모델을 합치고 편집 파일을 다시 얹는다. 건축 파일에서 방 이름·경계·벽을 고친
// 뒤 설비 파일을 덧붙여도 편집이 하나도 빠지지 않고, 설비 소속은 고친 경계로 잰다.
describe.skipIf(!existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_HVAC))('편집한 뒤 덧붙이기 (Duplex 건축 → HVAC)', () => {
  it('건축에서 한 편집이 합친 모델에 전부 얹히고, 소속은 고친 경계를 따른다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_ARCH))).model
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_HVAC))).model
    const edited = structuredClone(arch)
    const base = baselineOf(edited)
    const spaces = edited.storeys.flatMap((st) => st.spaces).filter((sp) => sp.footprint.length >= 4)
    renameSpace(edited, spaces[0].id, '고친 이름')
    // 방을 끌고 가는 벽을 벽에 수직으로 옮긴다(벽 길이 방향이면 방이 따라오지 않는다).
    let carried = 0
    for (const wall of edited.storeys.flatMap((st) => st.walls).filter((w) => w.footprint?.length)) {
      const ring = wall.footprint![0]
      const [dx, dy] = [ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]]
      const l = Math.hypot(dx, dy)
      const probe = structuredClone(edited)
      if (!moveWallWithSpaces(probe, wall.id, [(-dy / l) * 0.3, (dx / l) * 0.3])?.changes.length) continue
      carried = moveWallWithSpaces(edited, wall.id, [(-dy / l) * 0.3, (dx / l) * 0.3])!.changes.length
      break
    }
    deleteSpace(edited, spaces[1].id)
    const file = parseEditFile(JSON.stringify(exportEdits(edited, base, 'arch.ifc')))
    if (typeof file === 'string') throw new Error(file)

    const merged = mergeModels(structuredClone(arch), structuredClone(hvac)).model
    const result = applyEdits(merged, file)
    expect(Object.values(result.missing).reduce((a, b) => a + b, 0)).toBe(0)
    const byId = new Map(merged.storeys.flatMap((st) => st.spaces).map((sp) => [sp.id, sp]))
    for (const sp of edited.storeys.flatMap((st) => st.spaces)) expect(byId.get(sp.id)?.footprint).toEqual(sp.footprint)
    expect(byId.get(spaces[0].id)!.longName).toBe('고친 이름')
    expect(byId.has(spaces[1].id)).toBe(false)
    expect(carried).toBeGreaterThan(0)
    // 소속은 합친 뒤 고친 경계로 다시 잰 값이다. 한 번 더 재도 같다.
    const assigned = merged.storeys.flatMap((st) => st.equipment.map((e) => [e.id, e.spaceId]))
    const again = structuredClone(merged)
    for (const st of again.storeys) for (const e of st.equipment) assignEquipment(e, st.spaces)
    expect(again.storeys.flatMap((st) => st.equipment.map((e) => [e.id, e.spaceId]))).toEqual(assigned)
  }, 600_000)
})

// 순환수의 유체를 원천 기기로 짐작하기(flow-rules.ts 의 inferFluids). Revit 은 계통 이름에 유체를 적지 않아(`Hydronic
// Supply 1`) 이름으로는 모두 모름이다. 병원은 공랭식 냉동기 하나가 원천이라 냉수, Duplex 는 온수 보일러가 원천이라 온수다.
// 형상으로 이은 판본(MEP)은 원천에 배관이 안 닿아서, 원천이 계통 구성원인 것으로 정한다.
describe.skipIf(!existsSync(CLINIC_HVAC) || !existsSync(CLINIC_MEP) || !existsSync(DUPLEX_MEP))('순환수 유체 짐작 (Revit)', () => {
  it('병원은 냉수, Duplex 는 온수이고, 원천이 없는 가지 계통은 모름으로 둔다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const fluids = (path: string) => {
      const m = importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
      return m.systems.filter((s) => s.fluid !== undefined).map((s) => `${s.name}|${s.fluid}|${s.fluidSource ?? '-'}`).sort()
    }
    expect(fluids(CLINIC_HVAC)).toEqual(['Hydronic Return 1|chilled|rule', 'Hydronic Supply 1|chilled|rule'])
    expect(fluids(CLINIC_MEP)).toEqual(['Hydronic Return 1|chilled|rule', 'Hydronic Supply 1|chilled|rule'])
    // `Supply Out` 은 종류를 모르는 말단 7대뿐이라 원천에 닿지 않는다 — 짐작하지 않고 모름이다.
    expect(fluids(DUPLEX_MEP)).toEqual([
      'Unit A Hydronic Return|hot|rule',
      'Unit A Hydronic Supply In|hot|rule',
      'Unit A Hydronic Supply Out|null|-',
      'Unit B Hydronic Return|hot|rule',
      'Unit B Hydronic Supply In|hot|rule',
      'Unit B Hydronic Supply Out|null|-',
    ])
  }, 600_000)
})

// 겹친 넓이(polygon.ts)는 방 외곽선을 삼각형으로 쪼갠다. Revit 곡선 벽은 거의 한 줄에 놓인 꼭짓점을 수십 개 내서(병원 방
// 하나가 94개) 귀 자르기가 걸리기 쉬운 모양이다. 가진 방 전부가 쪼개지고, 자기 자신과 겹친 넓이가 제 넓이와 같아야 한다.
describe.skipIf(!existsSync(SAMPLE) || !existsSync(DUPLEX_ARCH) || !existsSync(CLINIC_ARCH))('실제 방 외곽선의 겹친 넓이', () => {
  it('AC20·Duplex·병원 건축의 방 292개가 전부 삼각형으로 쪼개진다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const failed: string[] = []
    let n = 0
    for (const path of [SAMPLE, DUPLEX_ARCH, CLINIC_ARCH]) {
      for (const sp of importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model.storeys.flatMap((st) => st.spaces)) {
        if (sp.footprint.length < 4) continue
        n++
        const self = overlapArea(sp.footprint, sp.footprint)
        const area = polygonArea(sp.footprint)
        if (self === null || Math.abs(self - area) > 1e-6 * Math.max(1, area)) failed.push(`${path} ${sp.name} (${sp.footprint.length}점)`)
      }
    }
    expect(n).toBe(292)
    expect(failed).toEqual([])
  }, 600_000)
})

describe.skipIf(!existsSync(DUPLEX_MEP_FULL) || !existsSync(DUPLEX_MEP_2) || !existsSync(DUPLEX_MEP_1) || !existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_COBIE))('판본 사이의 GUID (Duplex)', () => {
  it('같은 Revit 요소도 다시 내보내면 GUID 가 자주 바뀐다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const load = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    const mep = load(DUPLEX_MEP_FULL)

    // 같은 Revit MEP 2011 로 한 달 반 뒤(2011-09-07 → 10-24) 다시 낸 판본. 두 판본에 다 있는 설비 344대 중 GUID 가
    // 그대로인 것은 127대뿐이고, 217대는 Revit 요소 ID 로만 찾는다(같은 자리에 요소 ID 가 다른 것이 9대 더 있지만 다른 요소다). 방은 이름으로 14개, 위치로 1개가
    // 짝지어지고 GUID 로 맞는 방은 0 이다. MEP-2 는 같은 번호·이름·자리의 방을 두 번씩 담아서 열 때 한 벌을 걷는다 —
    // 걷기 전에는 어느 쪽인지 정할 수 없어 2개만 짝지었다.
    const v2 = compareVersions(mep, load(DUPLEX_MEP_2))
    expect(v2.equipment.by).toEqual({ guid: 127, revitId: 217, name: 0, position: 0 })
    expect(v2.spaces.by).toEqual({ guid: 0, revitId: 0, name: 14, position: 1 })

    // Revit 2013 으로 올려 전기만 떼어 낸 판본(2012-12). 전기 설비 99대 중 16대의 GUID 가 바뀌었다.
    expect(compareVersions(mep, load(DUPLEX_MEP_1)).equipment.by).toEqual({ guid: 83, revitId: 16, name: 0, position: 0 })

    // 다른 도구로 반년 뒤 낸 COBie 판본은 방 GUID 를 전부 지켰다. 도구가 GUID 를 지키느냐의 문제이지, 불가능한 일이 아니다.
    const cobie = compareVersions(load(DUPLEX_ARCH), load(DUPLEX_COBIE))
    expect(cobie.spaces.by).toEqual({ guid: 21, revitId: 0, name: 0, position: 0 })
  }, 300_000)
})

// 공조존(F12)을 IDF 에서 읽는다. 삼성 IDF(DesignBuilder 출력, EnergyPlus 22.2)는 저장소 밖(rl-pipeline/data)에서 data/idf 로
// 복사해 둔다. 공개 파일이 아니라 받는 명령이 없고, 없으면 건너뛴다.
const SAMSUNG_IDF = 'data/idf/Samsung_Calibration_5_24fix_case.idf'

describe.skipIf(!existsSync(SAMSUNG_IDF))('IDF 공조존 (삼성, DesignBuilder)', () => {
  it('존·바닥·담당 사슬을 전부 읽는다', () => {
    const idf = readIdf(readFileSync(SAMSUNG_IDF, 'utf8'))
    expect(idf.warnings).toEqual([])
    const classes = new Map<string, number>()
    for (const e of idf.equipment) classes.set(e.idfClass, (classes.get(e.idfClass) ?? 0) + 1)
    // 공조기 16대가 VAV 128대를, VRF 실외기 41대가 실내기 119대를 공급한다. 노드 이름으로 이은 사슬이 전부 닿는다.
    expect(Object.fromEntries(classes)).toEqual({
      'ZoneHVAC:TerminalUnit:VariableRefrigerantFlow': 119,
      'AirTerminal:SingleDuct:VAV:Reheat': 128,
      AirLoopHVAC: 16,
      'AirConditioner:VariableRefrigerantFlow': 41,
    })
    const ahuFeeds = idf.equipment.filter((e) => e.idfClass === 'AirLoopHVAC').reduce((n, e) => n + e.feeds.length, 0)
    expect(ahuFeeds).toBe(128)

    const { model, report } = modelFromIdf(idf, 'samsung')
    // 존 162개가 바닥 높이 16개 층에 전부 올라간다(57.38·57.39 처럼 반올림 차는 한 층이다).
    expect(report).toMatchObject({ zones: 162, zonesOnStoreys: 162, createdStoreys: 16, equipment: 304 })
    const zones = model.hvac!.zones
    // DesignBuilder 는 존 바닥을 조각 321개로 잘라 낸다. 맞댄 조각을 합치면 180개(존 151개가 고리 하나)다.
    expect(zones.reduce((n, z) => n + z.footprint.length, 0)).toBe(180)
    expect(zones.filter((z) => z.footprint.length === 1)).toHaveLength(151)
    // 바닥면은 벽 중심선까지라 Zone 이 적은 순 넓이보다 늘 크다(1.0~1.19 배). 작아지면 합치기가 넓이를 잃은 것이다.
    const ratios = zones.filter((z) => z.declaredAreaM2).map((z) => z.areaM2 / z.declaredAreaM2!)
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...ratios)).toBeLessThan(1.2)

    // 겹친 넓이(polygon.ts)가 실제 존 바닥 모양을 잰다. 짝이 되는 IFC 가 없어서, 존 바닥 조각을 그대로 물리존으로 둔
    // 모델에 다시 얹는다. 조각 180개가 전부 삼각형으로 쪼개지고(오목한 것 포함), 조각마다 제 존이 전부를 덮으며,
    // 존끼리 겹치지 않으니 두 존에 걸친 방이 없어야 한다.
    const rooms: Model = structuredClone(model)
    delete rooms.hvac
    for (const z of zones) {
      const storey = rooms.storeys.find((st) => st.id === z.storeyId)!
      z.footprint.forEach((ring, i) => storey.spaces.push({ id: `${z.id}#${i}`, name: z.name, longName: '', footprint: ring, areaM2: polygonArea(ring), boundedBy: [] }))
    }
    const again = attachIdf(rooms, idf, 'samsung')
    expect(again.report).toMatchObject({ spaces: 180, spacesInZones: 180, straddling: 0, partial: 0, byPoint: 0 })
    const shares = again.model.hvac!.zones.flatMap((z) => Object.values(z.spaceShares ?? {}))
    expect(Math.min(...shares)).toBeGreaterThan(0.999)
  })
})
