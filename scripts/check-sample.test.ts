import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { importIfc, importIfcWithMeshes, readMeshes, UnreadableIfcError, type ImportOptions } from '../src/lib/ifc/import'
import { createDataCatalog } from '../src/server/data-catalog'
import { openingPlacement, spacesBesideOpening } from '../src/lib/ifc/element-geometry'
import { profileOf, type Profile } from '../src/lib/profile'
import { CAPACITY_PREDICATE } from '../src/lib/capacity'
import { countOf, isConduit, polygonArea, segmentPath, unplacedOf, type Vec2 } from '../src/lib/model'
import { segmentAxisOf } from '../src/lib/conduit-mesh'
import { releaseConnection } from '../src/lib/connection-release'
import { assignEquipment, assignEquipmentToSpaces, interiorPoint, locate, pointInPolygon, scoreAgainstDeclared, SNAP } from '../src/lib/mapping'
import { mergeModels } from '../src/lib/merge'
import { outlinelessSpaces } from '../src/lib/outline-fill'
import { escapeLocalName, modelToTTL } from '../src/lib/export/ttl'
import { modelToGeoJSON } from '../src/lib/export/geojson'
import { mergeReadings, readOntologyTTL, type OntologyEntity } from '../src/lib/export/read-ttl'
import { crossCheck, geojsonProblems, NUMERIC_OK, numericPredicates, readGeoJSON, ttlTriples } from '../src/lib/export/read-export'
import { storeyFiles } from '../src/lib/export/storey-export'
import { check3D, read3D } from '../src/lib/export/read-3d'
import { modelToScene, sceneToGLB, sceneToOBJ } from '../src/lib/export/mesh3d'
import { deviceFlows, inferConnections, REACH, TOLERANCE } from '../src/lib/topology'
import { inferFlowByRules, newlyDisagreeing, withInferred } from '../src/lib/flow-rules'
import { airBasis, airServices, needsSystem, systemlessAir } from '../src/lib/served'
import { completenessChecks } from '../src/lib/checks'
import { evaluateSuggestions } from '../src/lib/kind-suggest'
import { verticalConnections, verticalLinks, VERTICAL_KINDS } from '../src/lib/vertical'
import { verticalObjects } from '../src/lib/vertical-object'
import { storeyHeights } from '../src/lib/storey-height'
import { markStoreyDone, storeyProgress } from '../src/lib/storey-progress'
import { equipmentKind, roomKind } from '../src/lib/kinds'
import { ASK_SETTING, EXPORT_SETTING, requirementsReport } from '../src/lib/requirements'
import { compareVersions, revitElementId } from '../src/lib/versions'
import { storeyScaleMismatch } from '../src/lib/unit-check'
import { lengthScale } from '../src/lib/ifc/units'
import { fuzzEdits } from '../src/lib/edit-fuzz'
import type { Model } from '../src/lib/model'
import { readIdf } from '../src/lib/idf/read'
import { attachIdf, modelFromIdf } from '../src/lib/idf/attach'
import { overlapArea } from '../src/lib/polygon'
import { computeExternal } from '../src/lib/exterior'
import { createCustomZone } from '../src/lib/custom-zone'
import { addEquipment, applyFollow, baselineOf, familyKeyOf, moveEquipment, planFollow, setTypeKind, deleteSpace, deleteWall, moveOpening, moveWall, moveWallWithSpaces, renameSpace, setWallLoadBearing, wallLocked, wallShapeLock, type WallCarryPlan } from '../src/lib/edit'
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
  // OE-EQP-10. BIM 에서 연 그대로 계통 없는 토출구가 있는 유일한 파일이다 — 그릴 5개. 검토 화면의 "계통 없는 VAV·토출구" 에 뜬다.
  it('계통 없는 VAV·토출구를 고른다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(MEP)))
    expect(systemlessAir(model).map((x) => x.equipment.kind)).toEqual(Array(5).fill('air_grille'))
  })

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
    // 좌표 없는 28대 중 00층 퓨즈 11대는 그 층에 하나뿐인 분전반(MB01) 자리에 놓는다(OE-BIM-07, 2026-10-03). 01층은 분전반이 둘이라 남는다.
    expect(counts.unplacedEquipment).toBe(17)

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

// 병원 건축의 층간 연결 기준선: 계단실·승강로 id → 이어질 방 id. 1층 승강로 E1 은 2층에 승강로 공간이 BIM 에 없어 잇지 않는다.
const HOSPITAL_VERTICAL: Record<string, string | null> = {
  '0ztdC3L1HAzhbhMHypqdeT': '0uLn6BSvvEB8kgChiujNG3', // First Floor/1AS1 ↔ Second Floor/2AS1 (98.2%)
  '0uLn6BSvvEB8kgChiujNG3': '0ztdC3L1HAzhbhMHypqdeT',
  '0ztdC3L1HAzhbhMHypqcTW': '0ClPCUC7jCQRnj1dhupMQV', // 1BS2 ↔ 2BS2 (100%)
  '0ClPCUC7jCQRnj1dhupMQV': '0ztdC3L1HAzhbhMHypqcTW',
  '0ztdC3L1HAzhbhMHypqc0q': '0ClPCUC7jCQRnj1dhupMQK', // 1CS3 ↔ 2CS3 (99.5%)
  '0ClPCUC7jCQRnj1dhupMQK': '0ztdC3L1HAzhbhMHypqc0q',
  '0ztdC3L1HAzhbhMHypqdiM': null, // First Floor/E1 (ELEVATOR)
}

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
    // 병원 건축은 성수와 같은 Revit IFC2x3 이고 정답지가 가장 크다(OE-EQP-16). 방이 겹친 자리에서 가장 작은 방을 고른다 — 첫 방이면
    // 210 이었다. 남은 22개 중 20개는 한쪽 방만 짚은 것이다. 짚는 거리를 0.3 → 0.5m 로 늘리면 220 이 되지만 엉뚱한 방이
    // 1 → 3 으로 는다(틀린 연결이 빠진 연결보다 나쁘다).
    if (existsSync(CLINIC_ARCH)) expect(agreement(CLINIC_ARCH)).toBe('214/236')
  })

  // OE-EQP-16 로봇 통과·연결 데이터. 로봇 팀이 받는 것은 GeoJSON 이라 내보낸 피처로 잰다. 수용 기준은 "병원 계단실·승강로 7개 중
  // 6개 연결" 이다. 남는 하나는 1층 승강로 E1 이다 — 2층에 승강로 공간이 BIM 에 없어서 이을 상대가 없다.
  it('로봇 데이터: 통과 속성 · 방-문-방 · 층 사이 연결이 GeoJSON 에 있다 (병원 건축)', async () => {
    if (!existsSync(CLINIC_ARCH)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const bytes = new Uint8Array(readFileSync(CLINIC_ARCH))
    const props = (m: Model) => modelToGeoJSON(m).flatMap((x) => x.collection.features.map((f) => f.properties as Record<string, unknown>))
    const tally = (xs: Record<string, unknown>[], key: string) =>
      xs.reduce((o: Record<string, number>, x) => ((o[String(x[key])] = (o[String(x[key])] ?? 0) + 1), o), {})

    // 문·창 형상을 읽지 않으면(화면 기본) 공간 경계가 없는 문 13개는 잇는 방이 비어 있다.
    const plain = props(importIfcWithMeshes(api, bytes).model)
    expect(tally(plain.filter((p) => p.kind === 'door'), 'connectsSource')).toEqual({ bim: 236, null: 13 })

    const model = importIfcWithMeshes(api, bytes, undefined, { openings: true }).model
    const all = props(model)
    const doors = all.filter((p) => p.kind === 'door')
    // 통과: 문은 지나가고 창·벽은 못 지나간다.
    expect(tally(doors, 'passable')).toEqual({ true: 249 })
    expect(tally(all.filter((p) => p.kind === 'window'), 'passable')).toEqual({ false: 58 })
    expect(tally(all.filter((p) => p.kind === 'wall'), 'passable')).toEqual({ false: 1080 })
    // 방-문-방: 공간 경계가 말한 236개는 bim, 나머지 13개는 문 자리로 짚는다(calc).
    expect(tally(doors, 'connectsSource')).toEqual({ bim: 236, calc: 13 })
    const calc = doors.filter((d) => d.connectsSource === 'calc').map((d) => ({ rooms: (d.connects as string[]).length }))
    // 13개 중 11개는 방 하나다 — 커튼월 문 3개는 바깥문이고, 화장실 칸막이 문 8개는 양쪽이 같은 화장실이다. 2개는 방을 못 짚는다.
    expect(tally(calc, 'rooms')).toEqual({ 0: 2, 1: 11 })

    // [OE-EQP-16#1] [OE-ML-19#7] [OE-ML-02#4] [OE-EQP-16#2~]
    // 층 사이 고정 기준선(OE-EQP-16 "7개 중 6개 이상", OE-ML-19). 대상 id·기대 연결·출처를 박아 둔다 — 개수만 재면 엉뚱한 짝이나
    // 모호 후보를 억지로 이어도 통과한다. 계단(IfcStair) 셋이 1층 계단실에서 올라 2층 계단실에 닿아 명시 연결(bim)이 된다.
    const vertical = model.storeys.flatMap((st) => st.spaces.filter((sp) => VERTICAL_KINDS.includes(sp.kind ?? '')).map((sp) => sp.id))
    expect(vertical.sort()).toEqual(Object.keys(HOSPITAL_VERTICAL).sort())
    const spaces = new Map(modelToGeoJSON(model).flatMap((x) => x.collection.features).filter((f) => f.properties.kind === 'space').map((f) => [String(f.id), f.properties]))
    for (const [id, expected] of Object.entries(HOSPITAL_VERTICAL)) {
      const p = spaces.get(id)!
      if (expected) expect({ id, connects: p.verticalConnects, source: p.verticalConnectsSource }).toEqual({ id, connects: [expected], source: 'bim' })
      else expect(p).not.toHaveProperty('verticalConnects')
    }
    expect(verticalConnections(model).ambiguous).toEqual([])
    // 계단 오브젝트를 빼고 겹침만으로 재도 같은 짝이다(겹침 98~100%, 서로를 최고 후보로 고른다). 두 근거가 맞는지 보는 대조다.
    const bare = structuredClone(model)
    for (const st of bare.storeys) delete st.verticalParts
    const byOverlap = verticalConnections(bare)
    expect(Object.fromEntries([...byOverlap.links].map(([id, to]) => [id, to[0]]))).toEqual(Object.fromEntries(Object.entries(HOSPITAL_VERTICAL).filter(([, to]) => to)))
    expect(new Set(byOverlap.sources.values())).toEqual(new Set(['calc']))
    // 계단 오브젝트(OE-ML-02): 1층에 형상·진입 지점, 2층에 종료 지점. 조각 feature 는 1층 3 · 2층 3 이다.
    const objects = verticalObjects(model)
    expect(objects.map((o) => o.parts.map((p) => `${p.storey.name}:${p.part.entry ? 'in' : ''}${p.part.exit ? 'out' : ''}`))).toEqual(
      Array(3).fill(['First Floor:in', 'Second Floor:out']),
    )
    expect(all.filter((p) => p.kind === 'vertical' && p.passable === false)).toHaveLength(6)
    // 층간 연결·연관 물리존이 가리키는 id 는 전부 실제로 내보낸 feature 다(OE-ML-02). 조각 id 가 물리존 id 와 겹치지 않는다.
    const features = modelToGeoJSON(model).flatMap((x) => x.collection.features)
    const ids = new Set(features.map((f) => String(f.id)))
    expect(ids.size).toBe(features.length)
    const refs = features.flatMap((f) => [...((f.properties.verticalConnects as string[]) ?? []), ...((f.properties.spaceIds as string[]) ?? [])])
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.filter((id) => !ids.has(id))).toEqual([])
  }, 300_000)

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
    expect(model.warnings.some((w) => w.includes('물리존 20개를 걸렀습니다'))).toBe(true)
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

    // 기본 판정 5mm 로 690개, 고립된 요소 주변만 넓혀 93개를 더 이었다. 조명이 위생기구에 붙던 2개는 흐름 없는 기기라 잇지 않는다(OE-PIP-18).
    const base = model.connections.filter((c) => c.tolerance === TOLERANCE)
    const stretched = model.connections.filter((c) => (c.tolerance ?? 0) > TOLERANCE)
    expect(base).toHaveLength(690)
    expect(stretched).toHaveLength(93)
    expect(counts.connections).toBe(783)
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
    // 대수(119)와 연결 개수(93)가 다른 것에 주의한다. 고립된 둘이 서로를 가장 가깝다고
    // 지목하면 연결 하나가 두 대를 살린다.
    const joined = model.warnings.find((w) => w.includes('연결망에 붙였습니다'))
    expect(joined).toContain('설비 141대 중 119대')
    expect(joined).toContain('연결 93개')
    // 못 이은 22대가 전부 "모델을 고쳐야 한다" 쪽이다. 흐름이 없는 종류 83대(콘센트 47 · 조명 30 · 연기감지기 6)는 처음부터 형상으로 잇지 않아 여기 없다(OE-PIP-18).
    // 그 전에는 224대 중 121대를 이었고, 못 이은 103대 중 81대가 흐름 없는 기기였다.
    const stranded = model.warnings.find((w) => w.includes('접합 부재 누락'))
    expect(stranded).toContain('설비 22대')
  }, 300_000)
})

// OE-REQ-06 요구사항 상태 집계. 필수 11 을 표준·다른 자리·없음·일부로 세고, 표준이 아닌 줄마다 고객사에 할 요청을 낸다. 요청은 셋 중 하나로
// 갈린다 — 다른 자리면 "내보내기 설정을 바꿔 달라 — 무엇을"(ASK_SETTING, OE-BIM-17), 값이 없으면 "값을 넣어 달라", 고칠 것이 정해져 있으면
// 그 말(R7 IfcMapConversion · R11 배치점). 가진 파일의 필수에는 다른 자리가 없다 — 다른 자리는 권장(R10·R14·R16·R21·R23·R24)에서 나온다.
describe('요구사항 상태 집계 — 필수 11 (OE-REQ-06)', () => {
  it('가진 BIM 넷의 필수 11 을 화면과 같이 세고, 표준이 아닌 줄은 빠짐없이 가를 수 있는 요청을 낸다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    // 합친 것은 화면처럼 합치기 결과를 같이 넘긴다 — 그래야 R1(두 파일의 층 이름)·R12(건축·설비 좌표계)를 잰다.
    const merged = (a: string, b: string) => { const m = mergeModels(open(a), open(b)); return requirementsReport(m.model, m.report) }
    const cases: [string, string[], () => ReturnType<typeof requirementsReport>, Record<string, string[]>][] = [
      ['AC20', [SAMPLE], () => requirementsReport(open(SAMPLE)), { standard: ['R0', 'R1', 'R2', 'R3', 'R4', 'R6'], missing: ['R7', 'R9'], none: ['R11'], unmeasured: ['R12', 'R13'] }],
      ['ifc4Mep', [MEP], () => requirementsReport(open(MEP)), { partial: ['R11'], missing: ['R7'], none: ['R2', 'R3', 'R4'], unmeasured: ['R12', 'R13'] }],
      ['Duplex 건축+MEP', [DUPLEX_ARCH, DUPLEX_MEP], () => merged(DUPLEX_ARCH, DUPLEX_MEP), { partial: ['R3'], missing: ['R7'], unmeasured: ['R13'] }],
      // 화면의 "필수 11개: 표준 5 · 없음·일부 5" 와 같다.
      ['병원 건축+HVAC', [CLINIC_ARCH, CLINIC_HVAC], () => merged(CLINIC_ARCH, CLINIC_HVAC), { standard: ['R0', 'R3', 'R6', 'R9', 'R12'], partial: ['R1', 'R2', 'R4', 'R11'], missing: ['R7'], unmeasured: ['R13'] }],
    ]
    let ran = 0
    for (const [name, files, make, want] of cases) {
      if (!files.every(existsSync)) continue
      ran++
      const must = make().filter((r) => r.level === '필수')
      expect(must, name).toHaveLength(11)
      const ids = (state: string) => must.filter((r) => r.state === state).map((r) => r.id)
      for (const [state, list] of Object.entries(want)) expect(ids(state), `${name} ${state}`).toEqual(list)
      // 파일 하나로 잴 수 없는 것(R12 건축·설비 좌표계 · R13 GUID 유지)은 잴 수 없음이다 — 분모에 넣지 않는다. R12 는 합치면 잰다.
      for (const r of must) {
        const kind = r.ask.startsWith(ASK_SETTING) ? 'setting' : r.ask.startsWith('값을 넣어 달라') ? 'value' : r.ask ? 'fix' : 'none'
        if (r.state === 'standard' || r.state === 'none' || r.state === 'unmeasured') expect(kind, `${name} ${r.id}`).toBe('none')
        else if (r.state === 'elsewhere') expect(kind, `${name} ${r.id}`).toBe('setting')
        // 없음·일부는 값을 넣거나 정해진 것을 고쳐 달라는 요청이다. 설정 요청이 나오면 고객사가 엉뚱한 곳을 본다.
        else expect(['value', 'fix'], `${name} ${r.id} ${r.ask}`).toContain(kind)
      }
    }
    expect(ran).toBeGreaterThanOrEqual(2)
  }, 900_000)
})

// OE-BIM-25 임포트 피처 선택. 벽·문·창은 GeoJSON 에만 나가고 TTL 에는 없어서, 설비만 볼 때 끄고 연다. 끈 것은 0 이 아니라 "읽지 않음"
// 이어야 한다 — 0 이면 "BIM 에 없다" 는 말이 되고 요구사항 보고서가 고객사에 엉뚱한 요청을 한다. 큰 건축 파일로 잰다.
describe('임포트 피처 선택 — 끈 것은 읽지 않음 (OE-BIM-25)', () => {
  it('병원 건축에서 벽·문·창을 끄면 0 이 아니라 읽지 않음이고, 합쳐도 남고, TTL 은 그대로다', async () => {
    if (!existsSync(CLINIC_ARCH) || !existsSync(CLINIC_HVAC)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const bytes = new Uint8Array(readFileSync(CLINIC_ARCH))
    // 처음 여는 것은 wasm·JIT 를 데우느라 느리다. 한 번 열어 데우고 잰다.
    importIfcWithMeshes(api, bytes)
    let t = performance.now()
    const full = importIfcWithMeshes(api, bytes).model
    const fullMs = performance.now() - t
    t = performance.now()
    const off = importIfcWithMeshes(api, bytes, undefined, { walls: false, doors: false, windows: false }).model
    const offMs = performance.now() - t

    const c = (m: Model) => { const n = countOf(m); return { walls: n.walls, openings: m.storeys.flatMap((s) => s.openings).length, spaces: n.spaces, devices: n.devices } }
    expect(c(full)).toMatchObject({ walls: 1080, openings: 307 })
    expect(off.skipped).toEqual(['walls', 'doors', 'windows'])
    // 물리존·설비는 늘 읽는다 — 끄는 것은 벽·문·창뿐이다.
    expect(c(off)).toEqual({ ...c(full), walls: 0, openings: 0 })
    // 요구사항 보고서: 벽에 기대는 R4(문·창의 개구부)·R22 는 "없음" 이 아니라 잴 수 없음이다.
    const state = (m: Model, id: string) => requirementsReport(m).find((r) => r.id === id)!.state
    expect([state(full, 'R4'), state(full, 'R22')]).not.toContain('unmeasured')
    expect([state(off, 'R4'), state(off, 'R22')]).toEqual(['unmeasured', 'unmeasured'])
    // 설비 파일을 덧붙여도 "읽지 않음" 이 남는다(한쪽이라도 안 읽었으면 안 읽은 것이다).
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_HVAC))).model
    expect(mergeModels(off, hvac).model.skipped).toEqual(['walls', 'doors', 'windows'])
    // 온톨로지(TTL)는 그대로다 — 벽·문·창은 TTL 에 없다.
    expect(modelToTTL(off)).toBe(modelToTTL(full))
    // GeoJSON 층 파일 머리에 "읽지 않음" 을 적는다 — 받는 쪽이 벽 0 을 "없음" 과 가른다(2026-10-03 사용자 결정). 합쳐도, 층 하나만
    // 구축해도(OE-GEN-11) 적힌다. 다 읽은 파일에는 칸이 없다.
    const merged = mergeModels(off, hvac).model
    for (const f of modelToGeoJSON(merged)) {
      const read = readGeoJSON(f.fileName, JSON.stringify(f.collection))
      expect({ skipped: read.skipped, problems: read.problems }, f.fileName).toEqual({ skipped: ['walls', 'doors', 'windows'], problems: [] })
    }
    expect(readGeoJSON('x', storeyFiles(merged, merged.storeys[1].id)!.geojson).skipped).toEqual(['walls', 'doors', 'windows'])
    expect(modelToGeoJSON(full).filter((f) => 'skipped' in f.collection)).toEqual([])
    // 형상을 읽지 않는 만큼 빨라진다(2026-10-03 이 PC 에서 데운 뒤 770ms → 560~630ms, 두 번 잼).
    expect(offMs).toBeLessThan(fullMs)
    console.log(`병원 건축 열기 ${Math.round(fullMs)}ms → 벽·문·창 끄면 ${Math.round(offMs)}ms`)
  }, 300_000)
})

// OE-PIP-18 흐름 없는 기기(조명·감지기·비치품·분전반 — kinds.ts 의 flow: {})는 형상이 맞닿아도 잇지 않는다. 포트가 없는 파일에서만
// 형상으로 잇는다(import.ts). 병원 전기 파일은 포트가 없고, 나란히 붙은 조명기구 16쌍이 서로 "연결" 로 잡혔었다.
// 포트가 있는 파일(병원 HVAC·Duplex HVAC·ifc4Mep)을 정답지로 형상 추정을 재 보면 흐름 없는 기기를 빼도 재현율·정밀도가 그대로다
// (87.8%·99.9% / 70.9%·95.3% / 75.0%·79.5%, 2026-10-03) — 포트가 흐름 없는 기기를 잇는 일이 없어서다.
describe('흐름 없는 기기는 형상으로 잇지 않는다 (OE-PIP-18)', () => {
  it('병원 전기 — 조명끼리 잡히던 연결이 없다', async () => {
    const ELE = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-ELE.ifc'
    if (!existsSync(ELE)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfcWithMeshes(api, new Uint8Array(readFileSync(ELE))).model
    const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
    const flowless = (id: string) => {
      const info = equipmentKind(byId.get(id)?.kind)
      return !!info && Object.keys(info.flow).length === 0
    }
    expect(model.storeys.flatMap((s) => s.equipment).filter((e) => e.kind === 'lighting').length).toBeGreaterThan(30)
    expect(model.connections.filter((c) => flowless(c.from) || flowless(c.to))).toEqual([])
  }, 300_000)
})

// OE-PIP-09 계통 이름 규칙. BIM 계통 이름은 분야별 파일을 합칠 때 맞추는 열쇠다 — Revit `System Name` 이 곧 id 라 같은 이름이면 한 계통의
// 두 조각이다(merge.ts). 에디터에는 계통 이름을 고치는 길이 없고(edit-fuzz 의 계통 이름 시험), 사람이 만든 계통만 만들 때 이름을 준다.
describe('계통 이름으로 맞춰 합친다 (OE-PIP-09)', () => {
  it('Duplex HVAC + MEP — 같은 이름 15개가 한 계통이 되고 이름이 겹치는 계통이 없다', async () => {
    if (!existsSync(DUPLEX_HVAC) || !existsSync(DUPLEX_MEP)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const hvac = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_HVAC))).model
    const mep = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP))).model
    const shared = hvac.systems.filter((s) => mep.systems.some((x) => x.name === s.name))
    const merged = mergeModels(hvac, mep).model
    expect({ hvac: hvac.systems.length, mep: mep.systems.length, shared: shared.length, merged: merged.systems.length }).toEqual({ hvac: 34, mep: 20, shared: 15, merged: 39 })
    expect(new Set(merged.systems.map((s) => s.name)).size).toBe(merged.systems.length)
    // 합친 계통은 두 파일의 구성원을 다 갖는다(같은 요소가 두 파일에 다 있으면 한 번).
    const big = merged.systems.find((s) => s.name === 'Unit A Hydronic Supply In')!
    expect(big.memberIds).toHaveLength(182)
    // 이름은 BIM 그대로다.
    expect(merged.systems.every((s) => hvac.systems.some((x) => x.name === s.name) || mep.systems.some((x) => x.name === s.name))).toBe(true)
  }, 300_000)
})

// OE-BIM-08 토출구·배관 초안. Air Terminal 은 토출구(디퓨저·그릴)로, Duct·Pipe 는 형상이 있는 배관 초안(구간·이음쇠)으로 읽고,
// 배관은 fso: 로 내보내 받는 쪽이 설비로 세지 않는다. IFC4(ifc4Mep)는 구체 클래스, Revit IFC2x3(병원)은 IfcFlowTerminal +
// IfcAirTerminalType 으로 들어온다 — 둘 다 같은 자리에 닿아야 한다.
describe('토출구·배관 초안 (OE-BIM-08)', () => {
  const read = async (path: string) => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const bytes = new Uint8Array(readFileSync(path))
    const id = api.OpenModel(bytes)
    const n = (t: number) => (api.GetLineIDsWithType(id, t, true) as unknown as { size(): number }).size()
    const ifc = { segments: n(WebIFC.IFCFLOWSEGMENT), fittings: n(WebIFC.IFCFLOWFITTING) }
    api.CloseModel(id)
    const { model, meshes } = importIfcWithMeshes(api, bytes)
    const all = model.storeys.flatMap((s) => s.equipment)
    const airTerminals = all.filter((e) => e.ifcClass === 'AirTerminal' || (e.declaredType ?? '').startsWith('AirTerminal'))
    const tally = (xs: typeof all, f: (e: (typeof all)[number]) => string) => xs.reduce((o: Record<string, number>, e) => ((o[f(e)] = (o[f(e)] ?? 0) + 1), o), {})
    const conduits = all.filter((e) => isConduit(e.role))
    const reading = readOntologyTTL(modelToTTL(model))
    const conduitIds = new Set(conduits.map((e) => e.id))
    return {
      ifc,
      terminals: tally(airTerminals, (e) => `${e.kind}/${e.role}`),
      conduits: tally(conduits, (e) => e.role!),
      shaped: conduits.filter((e) => (meshes.get(e.id)?.positions.length ?? 0) > 0).length,
      fso: tally(reading.unread.map((u) => ({ role: u.cls }) as unknown as (typeof all)[number]), (e) => e.role!),
      readAsEntity: reading.entities.filter((e) => conduitIds.has(e.key)).length,
    }
  }

  it('IFC4 — 구체 클래스(IfcAirTerminal·IfcDuctSegment …)', async () => {
    if (!existsSync(MEP)) return
    const r = await read(MEP)
    expect(r.terminals).toEqual({ 'air_diffuser/terminal': 30, 'air_grille/terminal': 13 })
    // IFC 의 구간·이음쇠가 하나도 빠지지 않고 배관 초안이 된다.
    expect(r.conduits).toEqual({ segment: r.ifc.segments, fitting: r.ifc.fittings })
    expect(r.ifc).toEqual({ segments: 1075, fittings: 820 })
    // 형상이 없는 27개: 10개는 IFC 에 형상이 없고(Representation $), 17개는 IfcSweptDiskSolidPolygonal(IFC4 Add2 의 관)이라
    // web-ifc 0.0.78 이 메시를 못 만든다("unexpected mesh type"). 좌표가 있는 것은 3D 에 점으로 남는다.
    expect(r.shaped).toBe(1895 - 27)
    expect(r.fso).toEqual({ 'fso:Segment': 1075, 'fso:Fitting': 820 })
    expect(r.readAsEntity).toBe(0)
  }, 300_000)

  it('Revit IFC2x3 — IfcFlowTerminal + IfcAirTerminalType (병원 HVAC)', async () => {
    if (!existsSync(CLINIC_HVAC)) return
    const r = await read(CLINIC_HVAC)
    // AirTerminal 타입 555개. VAV 115 는 Revit 이 AirTerminal 타입으로 냈지만 이름 사전이 VAV(조절)로 가른다 — 토출구가 아니다.
    expect(r.terminals).toEqual({ 'air_diffuser/terminal': 234, 'air_grille/terminal': 206, 'vav/control': 115 })
    expect(r.conduits).toEqual({ segment: r.ifc.segments, fitting: r.ifc.fittings })
    expect(r.shaped).toBe(3138)
    expect(r.fso).toEqual({ 'fso:Segment': 1548, 'fso:Fitting': 1590 })
    expect(r.readAsEntity).toBe(0)
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
    // 종류 후보(kind-suggest.ts): 종류를 아는 Revit 패밀리 16개 중 10개가 닮은 패밀리 세 후보 안에 든다. 11 이었는데, 분전반
    // (`Lighting and Appliance Panelboard`)이 이름의 "Lighting" 때문에 조명으로 잡히던 것을 고쳐(2026-10-03) 정답이 분전반이 됐다.
    // 분전반 패밀리는 하나뿐이라 닮은 것으로 맞힐 수 없다 — 후보가 나빠진 것이 아니라 정답이 바로잡힌 것이다.
    expect(evaluateSuggestions(model).top3).toBeGreaterThanOrEqual(10)
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
    expect(chips(MEP)).toBe('공간 — | 설비 297/308 | 소속 0/308 | 연결망 1995 | 방향 37/103')
    // 공간 1 은 지붕뿐이다. 기기 40대가 갈 방이 없다 — 건축 파일을 덧붙이면 소속 40 이 된다.
    // 연결 단위로는 39%(190/485)가 방향을 아는데, 기기에서 출발한 방향 사슬은 전부 중간의
    // SOURCEANDSINK 에서 끊긴다. 기기끼리 닿는 흐름은 0 이다.
    expect(chips(DUPLEX_HVAC)).toBe('공간 1 | 설비 40 | 소속 0/40 | 연결망 485 | 방향 0/26')
    // 목표선(방향) 칩은 두 수치다(OE-BIM-16): BIM 포트로 0/27, 규칙(사전)으로 짐작한 방향까지 23/27.
    expect(chips(DUPLEX_MEP)).toBe('공간 22 | 설비 141 | 소속 141 | 연결망 783 | 방향 0/27(BIM) → 23/27(사전)')
    // COBie 판본은 형상이 없다. 좌표도 외곽선도 0 인데 소속은 BIM 이 전부 말해 준다.
    expect(chips(DUPLEX_COBIE)).toBe('공간 0/22 | 설비 0/133 | 소속 133 | 연결망 0 | 방향 —')
  }, 300_000)

  // OE-BIM-16 "목록 숫자 = 열람 숫자". 목록은 서버(data-catalog.ts)가 기본 옵션으로 재고, 열람은 워커가 화면의
  // [읽을 것](벽·문·창·문 형상) 옵션으로 읽은 모델을 postMessage 로 받아(구조화 복제) 규칙 방향을 한 번 더 돌린 뒤 잰다
  // (App.vue load). 길이 둘이라 옵션이나 열 때의 손질이 칩에 닿으면 어긋난다. 서버 핸들러를 그대로 불러 그 응답과 견준다.
  it('목록의 칩과 파일을 연 뒤의 칩이 같다 — 읽을 것 옵션을 바꿔도', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const catalog = createDataCatalog('data')
    const listed = (path: string) =>
      new Promise<Profile['tiers']>((done, fail) => {
        const res = {
          statusCode: 200,
          setHeader() {},
          end(body?: string) {
            if (this.statusCode !== 200 || !body) return fail(new Error(`${path}: ${this.statusCode}`))
            const r = JSON.parse(body)
            if (!r.profile) return fail(new Error(`${path}: ${r.error}`))
            done(r.profile.tiers)
          },
        }
        catalog({ method: 'GET', url: `/${encodeURI(path.replace(/^data\//, ''))}?profile` } as IncomingMessage, res as unknown as ServerResponse)
      })
    const opened = (path: string, options: ImportOptions) => {
      const model = structuredClone(importIfcWithMeshes(api, new Uint8Array(readFileSync(path)), undefined, options).model)
      inferFlowByRules(model)
      return profileOf(model).tiers
    }
    // 화면 기본(벽·문·창 읽기, 문 형상 끔), 문 형상 켬, 셋 다 끔.
    const options: ImportOptions[] = [
      { openings: false, walls: true, doors: true, windows: true },
      { openings: true, walls: true, doors: true, windows: true },
      { openings: false, walls: false, doors: false, windows: false },
    ]
    const files = [SAMPLE, MEP, DUPLEX_ARCH, DUPLEX_HVAC, DUPLEX_MEP, DUPLEX_COBIE, DUPLEX_MEP_1, CLINIC_HVAC].filter((f) => existsSync(f))
    expect(files.length).toBeGreaterThanOrEqual(6)
    for (const path of files) {
      const list = await listed(path)
      expect(list.map((t) => t.key)).toEqual(['space', 'equipment', 'location', 'network', 'direction'])
      // 칩 숫자뿐 아니라 마우스를 올리면 보이는 설명(note)까지 같아야 한다.
      for (const o of options) expect(opened(path, o), `${path} ${JSON.stringify(o)}`).toEqual(list)
    }
  }, 900_000)

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

// **이 과제의 산출물이 받는 쪽에서 실제로 읽히는지.** intent.md 는 "ieum-pipeline 의 ttl.go 가 읽을 수 있어야 한다" 를
// 계약으로 적었는데, 한동안 TTL 문자열의 모양만 테스트했다. 그러는 동안 brick:feeds 를 독립 문장으로 써서 받는 쪽이
// **흐름 연결을 전부 버리고** 있었다(ifc4Mep 1,995 → 0).
//
// 그래서 받는 쪽 규칙으로 다시 읽는다(src/lib/export/read-ttl.ts — ttl.go 의 규칙을 옮겨 적은 것). 예전에는 옆 저장소의
// ttl.go 를 복사해 go 로 빌드했는데, 다른 저장소의 체크아웃 상태에 결과가 매였다(로컬이 한 커밋 뒤라 `\$` 를 못 풀어 90개가
// 떨어졌다). 이제 이 repo 안에서 끝난다. 두 파일(GeoJSON·TTL)이 id 로 이어지는지도 같이 본다(read-export.ts).
describe('받는 쪽 규칙으로 다시 읽는가 (read-ttl)', () => {
  const parse = (ttl: string) => readOntologyTTL(ttl).entities
  const count = (ents: OntologyEntity[], f: (e: OntologyEntity) => string[]) => ents.reduce((n, e) => n + f(e).length, 0)

  /**
   * 모델에서 "기기 → 기기" 흐름 쌍을 센다. 덕트·배관은 지나가기만 하고, 방향을 아는 변만 탄다.
   * 받는 쪽은 덕트를 엔티티로 읽지 않으므로, 기기끼리 닿는지가 곧 계약이다.
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
  const parsedPairs = (ents: OntologyEntity[]) => new Set(ents.flatMap((e) => e.feeds.map((t) => `${e.key}>${t}`)))

  // 커스텀존(OE-OBJ-01, ADR-0004). 존 블록(brick:Zone)을 더해도 다른 엔티티를 잃지 않고, 존 안 기기의 hasLocation 에 방과 존이 같이 읽힌다.
  it.skipIf(!existsSync(MEP))('커스텀존을 그려도 기기의 위치에 존을 같이 읽는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(MEP)))
    const before = parse(modelToTTL(model))
    // ifc4Mep 에는 방이 없어 기기의 첫 위치는 층이다(방을 못 찾은 설비의 규칙).
    const storey = model.storeys.find((st) => st.equipment.some((e) => !isConduit(e.role ?? null) && e.position))!
    const e = storey.equipment.find((x) => !isConduit(x.role ?? null) && x.position)!
    const [x, y] = e.position!
    const zone = createCustomZone(model, storey.id, { name: '시험 존', footprint: [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1]], id: 'U_ttlgo_zone' })
    expect(zone && 'id' in zone).toBe(true)
    const after = parse(modelToTTL(model))
    // 받는 쪽은 공간(방·층·Zone)도 관계 목적어로 쓰려고 타입 없는 논리 설비로 저장한다(ttl.go 의 equipClass 주석). 존 하나만큼 는다.
    expect(after.length).toBe(before.length + 1)
    expect(after.find((p) => p.key === 'U_ttlgo_zone')).toMatchObject({ cls: 'Zone' })
    expect(after.find((p) => p.key === e.id)!.locations).toEqual([e.spaceId ?? storey.id, 'U_ttlgo_zone'])
  })

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
    const reading = readOntologyTTL(modelToTTL(model))
    const ents = reading.entities
    const equipment = model.storeys.flatMap((s) => s.equipment)

    // 기기 40대의 소속이 전부 받는 쪽에 닿는다. 이상 알림의 발생 위치가 이것이다.
    expect(equipment.filter((e) => !isConduit(e.role) && e.spaceId)).toHaveLength(40)
    expect(count(ents.filter((e) => e.cls !== 'Room'), (e) => e.locations)).toBe(40)
    // 기기 → 기기 흐름도 전부 닿는다(덕트를 건너뛰어 적은 것 포함).
    const want = devicePairs(model)
    expect([...want].filter((p) => !parsedPairs(ents).has(p))).toEqual([])

    // 덕트·배관은 fso: 클래스라 받는 쪽이 엔티티로 읽지 않는다(brick:·ex: 만 읽는다). **일부러다.**
    // ex: 로 넣으면 ieum 쪽 설비 목록이 여섯 배로 부푼다. 그 대가로 계통의 hasPart 가 가리키는
    // 덕트·배관은 ieum 에서 "유령" 노드로 남는다.
    const keys = new Set(ents.map((e) => e.key))
    expect(equipment.filter((e) => isConduit(e.role) && keys.has(e.id))).toHaveLength(0)
    expect(reading.unread).toHaveLength(equipment.filter((e) => isConduit(e.role)).length)
  }, 300_000)

  // OE-INT-08 따옴표 이스케이프. 병원 건축의 샤워 의자 3대는 Revit 패밀리 이름에 인치 표시(")가 든다 —
  // `M_ADA shower Seat:17" Depth x 18 1/2" Width:…`. 손 픽스처가 아닌 실제 이름이 받는 쪽 규칙으로 그대로 돌아와야 한다.
  it('이름에 따옴표가 든 실제 설비가 받는 쪽에 같은 이름으로 읽힌다 (병원 건축)', async () => {
    if (!existsSync(CLINIC_ARCH)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfcWithMeshes(api, new Uint8Array(readFileSync(CLINIC_ARCH))).model
    const quoted = model.storeys.flatMap((s) => s.equipment).filter((e) => e.name.includes('"'))
    expect(quoted).toHaveLength(3)
    const labels = new Map(readOntologyTTL(modelToTTL(model)).entities.map((e) => [e.key, e.label]))
    expect(quoted.map((e) => labels.get(e.id))).toEqual(quoted.map((e) => e.name))
  }, 300_000)

  it('우리가 짓는 id 와 GUID($ 가 든 것까지)가 GeoJSON 과 같은 문자열로 읽힌다', async () => {
    if (!existsSync(DUPLEX_MEP)) return
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const mep = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP))).model
    const keys = new Set(parse(modelToTTL(mep)).map((e) => e.key))

    // Revit System Name 에서 세운 계통 id 는 이스케이프가 필요 없게 지었다. GeoJSON 의 systemId 와 받는 쪽 키가 같은 문자열이다.
    for (const s of mep.systems) expect(keys.has(s.id)).toBe(true)

    // **GUID 에 든 $ 는 Turtle 규칙상 \$ 로 쓴다.** 받는 쪽이 이스케이프를 풀지 않던 때는 키에 역슬래시가 남아 GeoJSON id 와
    // 이어지지 않았다(2026-09-29 ttl.go 에서 풀게 고쳤다). $ 가 든 id 가 있어야 이 검사가 뜻이 있다.
    const ids = [...mep.storeys.flatMap((s) => [...s.spaces.map((x) => x.id), ...s.equipment.filter((e) => !isConduit(e.role)).map((e) => e.id)])]
    expect(ids.filter((id) => id.includes('$')).length).toBeGreaterThan(0)
    expect(ids.filter((id) => !keys.has(id))).toEqual([])
  }, 300_000)

  // 내보낸 두 파일을 뷰어(viewer.html)와 같은 코드로 다시 읽어 잇는다. 한쪽에만 있는 id, 끊긴 참조, 지도와 온톨로지가 다른
  // 소속, 문이 가리키는 없는 방이 하나도 없어야 한다.
  it('가진 BIM 의 GeoJSON 과 TTL 이 id 로 빠짐없이 이어진다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    const cases: [string, () => Model][] = []
    if (existsSync(SAMPLE)) cases.push(['fzk', () => open(SAMPLE)])
    if (existsSync(MEP)) cases.push(['ifc4mep', () => open(MEP)])
    if (existsSync(DUPLEX_ARCH) && existsSync(DUPLEX_HVAC)) cases.push(['duplex 건축+hvac', () => mergeModels(open(DUPLEX_ARCH), open(DUPLEX_HVAC)).model])
    if (existsSync(DUPLEX_MEP)) cases.push(['duplex mep', () => open(DUPLEX_MEP)])
    if (existsSync(CLINIC_ARCH) && existsSync(CLINIC_HVAC)) cases.push(['병원 건축+hvac', () => mergeModels(open(CLINIC_ARCH), open(CLINIC_HVAC)).model])
    if (existsSync(SAMSUNG_IDF)) cases.push(['idf', () => modelFromIdf(readIdf(readFileSync(SAMSUNG_IDF, 'utf8')), 'samsung').model])
    expect(cases.length).toBeGreaterThanOrEqual(2)
    for (const [name, make] of cases) {
      const model = make()
      const floors = modelToGeoJSON(model).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
      expect(floors.flatMap((f) => f.problems), name).toEqual([])
      const ttl = modelToTTL(model)
      const check = crossCheck(readOntologyTTL(ttl), floors)
      expect({ ...check, toUnread: 0 }, name).toEqual({ notInTtl: [], dangling: [], toUnread: 0, locationMismatch: [], doorLinks: [] })
      // OE-INT-02 TTL 에 좌표가 없다. 숫자가 붙는 술어는 넓이·층 바닥 높이·용량뿐이다(read-export.ts 의 NUMERIC_OK).
      expect([...numericPredicates(ttl)].filter((p) => !NUMERIC_OK.has(p)), name).toEqual([])
    }
  }, 900_000)

  // 셋째 파일(3D, GLB·OBJ)도 뷰어와 같은 코드로 다시 읽어 GeoJSON 과 잇는다. 객체 이름이 GlobalId 라 같은 id 여야 하고, 방 판은
  // 외곽선과 1cm 안, 설비는 GeoJSON 점이 형상 범위에서 0.5m 안이다(배치점 보정 기준, read-3d.ts). ifc4Mep 의 플랜지·센서 39대는
  // 배치점이 형상에서 0.3m 떨어져 있어 허용치 안이다 — BIM 그대로다.
  it('가진 BIM 의 GLB·OBJ 가 GeoJSON 과 같은 id·같은 자리다', async () => {
    if (!('FileReader' in globalThis)) {
      ;(globalThis as Record<string, unknown>).FileReader = class {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) {
          void blob.arrayBuffer().then((b) => {
            this.result = b
            this.onloadend?.()
          })
        }
      }
    }
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path)))
    const pair = (a: string, b: string) => {
      const x = open(a)
      const y = open(b)
      return { model: mergeModels(x.model, y.model).model, meshes: new Map([...x.meshes, ...y.meshes]) }
    }
    const cases: [string, () => ReturnType<typeof open>][] = []
    if (existsSync(SAMPLE)) cases.push(['fzk', () => open(SAMPLE)])
    if (existsSync(MEP)) cases.push(['ifc4mep', () => open(MEP)])
    if (existsSync(DUPLEX_ARCH) && existsSync(DUPLEX_HVAC)) cases.push(['duplex 건축+hvac', () => pair(DUPLEX_ARCH, DUPLEX_HVAC)])
    if (existsSync(CLINIC_ARCH) && existsSync(CLINIC_HVAC)) cases.push(['병원 건축+hvac', () => pair(CLINIC_ARCH, CLINIC_HVAC)])
    expect(cases.length).toBeGreaterThanOrEqual(2)
    for (const [name, make] of cases) {
      const { model, meshes } = make()
      const floors = modelToGeoJSON(model).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
      const ttl = readOntologyTTL(modelToTTL(model))
      const scene = modelToScene(model, meshes)
      const glb = await read3D('a.glb', await sceneToGLB(scene))
      const obj = await read3D('a.obj', new TextEncoder().encode((await sceneToOBJ(scene)).join('')).buffer as ArrayBuffer)
      for (const r of [glb, obj]) expect(check3D(r.parts, floors, ttl), `${name} ${r.format}`).toEqual({ unknown: [], missing: [], misplaced: [] })
      expect(obj.parts.length, name).toBe(glb.parts.length)
    }
  }, 1_800_000)
})

// OE-GEN-01 "rdflib·GeoJSON 검사 통과". 받는 쪽 파서(ttl.go)는 자기가 쓰는 줄만 골라 읽어서 문법이 틀린 줄도 조용히 건너뛴다.
// 그래서 표준 Turtle 파서(rdflib)로도 읽는다 — 한 줄이라도 틀리면 파일째 떨어진다. 2026-09-25 에 손으로 한 번 돌려 본 것을
// 시험으로 둔다. rdflib 가 없으면 건너뛴다(`pip install rdflib`, shapely 는 있으면 다각형 꼬임까지 본다).
const PYTHON = process.platform === 'win32' ? 'python' : 'python3'
const hasRdflib = (() => {
  try {
    execFileSync(PYTHON, ['-c', 'import rdflib'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const RDF_CHECK = String.raw`
import json, sys
from collections import Counter
from rdflib import Graph, Literal, URIRef, RDF, RDFS
try:
    from shapely.geometry import shape
    from shapely.validation import explain_validity
except ImportError:
    shape = None
out = {}
for path in sys.argv[1:]:
    if path.endswith('.ttl'):
        g = Graph()
        g.parse(path, format='turtle')
        typed = set(g.subjects(RDF.type, None))
        rel = Counter(); lit = Counter(); dangling = set()
        for s, p, o in g:
            if p == RDF.type: continue
            if isinstance(o, Literal): lit[str(p)] += 1
            else:
                rel[str(p)] += 1
                if o not in typed: dangling.add(str(o))
        out[path] = {'triples': len(g), 'typed': len(typed), 'relations': rel, 'literals': lit, 'dangling': sorted(dangling)[:5],
                     'labels': [str(o) for o in g.objects(None, RDFS.label)]}
    else:
        bad = []
        if shape:
            for f in json.load(open(path, encoding='utf-8'))['features']:
                gm = f.get('geometry')
                if gm and gm['type'] in ('Polygon', 'MultiPolygon') and not shape(gm).is_valid:
                    bad.append([f['id'], f['properties'].get('kind'), explain_validity(shape(gm))])
        out[path] = {'invalid': bad, 'checked': shape is not None}
json.dump(out, sys.stdout, ensure_ascii=False)
`

describe.skipIf(!hasRdflib)('rdflib·GeoJSON 검사 (OE-GEN-01)', () => {
  // 관계(목적어가 개체인 것)는 술어 4종만 쓴다. 나머지는 값(문자열·숫자)이고 ex: 로 둔다 — 용량은 양마다 술어가 다르다(4.6).
  const BRICK = 'https://brickschema.org/schema/Brick#'
  const EX = 'http://example.org/building#'
  const RELATIONS = ['hasPart', 'hasLocation', 'feeds', 'hasPoint'].map((p) => BRICK + p)
  const VALUES = [
    'http://www.w3.org/2000/01/rdf-schema#label',
    ...['elevation', 'roomNumber', 'areaM2', 'ifcClass', 'idfClass', 'systemKind', 'zoneKind'].map((p) => EX + p),
    ...Object.values(CAPACITY_PREDICATE).map((p) => EX + p.replace(/^ex:/, '')),
  ]
  type Ttl = { triples: number; typed: number; relations: Record<string, number>; literals: Record<string, number>; dangling: string[]; labels: string[] }
  type Geo = { invalid: [string, string, string][]; checked: boolean }

  it('가진 BIM(합친 것·편집한 것·IDF 포함)의 TTL 을 rdflib 가 읽고, GeoJSON 이 RFC 7946 모양이다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    const cases: [string, () => Model][] = []
    if (existsSync(SAMPLE)) cases.push(['fzk', () => open(SAMPLE)])
    if (existsSync(MEP))
      cases.push([
        'ifc4mep+존',
        () => {
          const m = open(MEP)
          const storey = m.storeys.find((st) => st.equipment.some((e) => !isConduit(e.role) && e.position))!
          const [x, y] = storey.equipment.find((e) => !isConduit(e.role) && e.position)!.position!
          const zone = createCustomZone(m, storey.id, { name: '시험 존', footprint: [[x - 2, y - 2], [x + 2, y - 2], [x + 2, y + 2], [x - 2, y + 2]] })
          expect(zone && 'id' in zone).toBe(true)
          return m
        },
      ])
    if (existsSync(DUPLEX_ARCH) && existsSync(DUPLEX_HVAC))
      cases.push([
        'duplex 건축+hvac 편집',
        () => {
          const m = mergeModels(open(DUPLEX_ARCH), open(DUPLEX_HVAC)).model
          // 사람이 고친 이름에 Turtle 이 꺼리는 글자(따옴표·역슬래시·줄바꿈)가 들어와도 파일이 깨지지 않고, 그대로 읽힌다.
          renameSpace(m, m.storeys.find((s) => s.spaces.length)!.spaces[0].id, '회의실 "A"\\B\r\n2층')
          return m
        },
      ])
    if (existsSync(DUPLEX_MEP)) cases.push(['duplex mep($ 든 GUID)', () => open(DUPLEX_MEP)])
    if (existsSync(CLINIC_ARCH) && existsSync(CLINIC_HVAC)) cases.push(['병원 건축+hvac', () => mergeModels(open(CLINIC_ARCH), open(CLINIC_HVAC)).model])
    if (existsSync(SAMSUNG_IDF)) cases.push(['idf 공조존', () => modelFromIdf(readIdf(readFileSync(SAMSUNG_IDF, 'utf8')), 'samsung').model])
    expect(cases.length).toBeGreaterThanOrEqual(4)

    const dir = mkdtempSync(join(tmpdir(), 'rdfcheck-'))
    const files: { name: string; ttl: string; geo: string[]; model: Model }[] = []
    cases.forEach(([name, make], i) => {
      const model = make()
      const ttl = join(dir, `${i}.ttl`)
      writeFileSync(ttl, modelToTTL(model))
      const geo = modelToGeoJSON(model).map(({ collection }, j) => {
        expect(geojsonProblems(collection), `${name} 층 ${j}`).toEqual([])
        const path = join(dir, `${i}-${j}.geojson`)
        writeFileSync(path, JSON.stringify(collection))
        return path
      })
      files.push({ name, ttl, geo, model })
    })
    writeFileSync(join(dir, 'check.py'), RDF_CHECK)
    const result: Record<string, Ttl | Geo> = JSON.parse(
      execFileSync(PYTHON, [join(dir, 'check.py'), ...files.flatMap((f) => [f.ttl, ...f.geo])], { maxBuffer: 1 << 28 }).toString(),
    )

    for (const f of files) {
      const r = result[f.ttl] as Ttl
      // 관계 술어는 4종 안이고, 값 술어는 정해 둔 것뿐이다. 좌표·WKT 같은 기하 술어가 새면 여기서 걸린다.
      expect(Object.keys(r.relations).filter((p) => !RELATIONS.includes(p)), f.name).toEqual([])
      expect(Object.keys(r.literals).filter((p) => !VALUES.includes(p)), f.name).toEqual([])
      // 관계가 가리키는 개체는 전부 같은 파일에 `a 클래스` 로 있다. 비면 받는 쪽에서 이름 없는 노드가 된다.
      expect(r.dangling, f.name).toEqual([])
      // 주어 수 = 건물 + 층 + 방 + 커스텀존 + 설비 + 계통 + 공조존 + IDF 설비.
      const m = f.model
      const subjects =
        1 +
        m.storeys.reduce((n, s) => n + 1 + s.spaces.length + (s.customZones?.length ?? 0) + s.equipment.length, 0) +
        m.systems.length +
        (m.hvac?.zones.length ?? 0) +
        (m.hvac?.equipment.filter((e) => !e.bimId).length ?? 0)
      expect(r.typed, f.name).toBe(subjects)
      if (f.name.includes('편집')) expect(r.labels).toContain('회의실 "A"\\B\r\n2층')

      // 다각형 꼬임(OGC 단순 도형 규칙, shapely). IFC 에서 온 물리존·벽·커스텀존은 하나도 없다. IDF 공조존은 DesignBuilder 가
      // 잘라 낸 바닥 조각을 다 합치지 못한 것이 남아, MultiPolygon 의 조각끼리 변을 맞댄다(T자로 닿아 꼭짓점이 어긋남 — 겹친
      // 넓이는 존마다 0.0013㎡ 이하). 링 하나하나는 멀쩡하다. 2026-10-03 에 8개 — 늘면 합치기가 나빠진 것이다.
      if (!f.geo.every((g) => (result[g] as Geo).checked)) continue
      const invalid = f.geo.flatMap((g) => (result[g] as Geo).invalid)
      expect(invalid.filter(([, kind]) => kind !== 'hvacZone'), f.name).toEqual([])
      expect(invalid.length, f.name).toBeLessThanOrEqual(f.name.startsWith('idf') ? 8 : 0)
    }
  }, 900_000)
})

// OE-REQ-02 IDS 검사 파일. 고객사가 하듯 ifctester 로 docs/requirements.ids 를 가진 BIM 에 돌린다(scripts/ids-check.py).
// 값은 정본 4장 "가진 파일로 확인한 결과" 표와 같다 — 명세나 표를 고치면 둘을 같이 고친다. ifctester 가 없으면 건너뛴다.
const hasIfctester = (() => {
  try {
    execFileSync(PYTHON, ['-c', 'import ifctester'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!hasIfctester)('IDS 를 ifctester 로 (OE-REQ-02)', () => {
  type Row = { name: string; inSchema: boolean; applicable: number; pass: number; checks: number; status: boolean }
  // 스키마에 맞는 명세 중 대상이 있거나, 대상이 없어서 떨어진 것(있어야 하는 것이 없다 — R7·R9). `n개` 는 대상만 세는 명세
  // (R9 설비 포함 · 금지 명세 R3 기본 이름·R23 Proxy)의 대상 수다.
  const cells = (rows: Row[]) =>
    rows
      .filter((r) => r.inSchema && (r.applicable > 0 || !r.status))
      .map((r) => `${r.name.replace(/^\[(필수|권장)\] /, '')} ${r.applicable === 0 ? '없음' : r.checks ? `${r.pass}/${r.checks}` : `${r.applicable}개`}`)

  it('IDS 1.0 스키마에 맞고, 가진 BIM 에서 정본 표의 값이 나온다', () => {
    const CLINIC_ARCH_ = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
    const CLINIC_HVAC_ = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc'
    const want: Record<string, string[]> = {
      [SAMPLE]: [
        'R1 층 이름 2/2', 'R2 공간이 층에 속함 7/7', 'R3 공간 이름과 방 번호 14/14', 'R4 문·창이 벽 개구부에 끼워짐 16/16',
        'R6 길이 단위 선언 1/1', 'R7 지도 좌표 변환 없음', 'R9 설비 포함 없음', 'R14 방 분류 0/7', 'R19 공조존 0/7', 'R22 벽의 내력 여부 0/13',
      ],
      // 설비 전용이라 공간(R2·R3)이 없다. 디퓨저·방열기 용량은 표준 자리에 있고 공조기 둘은 없다.
      [MEP]: [
        'R1 층 이름 5/5', 'R2 공간이 층에 속함 없음', 'R3 공간 이름과 방 번호 없음', 'R6 길이 단위 선언 1/1', 'R7 지도 좌표 변환 없음',
        'R9 설비 포함 307개', 'R11 설비마다 배치 285/307', 'R16 설비·도관이 계통에 묶임 1714/2202', 'R16 계통 종류 9/15',
        'R16 공기 계통의 공급·환수 0/5', 'R16 물 계통의 공급·환수 0/2', 'R17 포트의 흐름 방향 4202/4232',
        'R21 용량 — IFCUNITARYEQUIPMENT 0/2', 'R21 용량 — IFCSPACEHEATER 30/30', 'R21 용량 — IFCAIRTERMINAL 43/43', 'R23 Proxy 를 쓰지 않음 49개',
        'R24 설비 종류 — IFCUNITARYEQUIPMENT 2/2', 'R24 설비 종류 — IFCAIRTERMINAL 43/43', 'R24 설비 종류 — IFCSPACEHEATER 30/30',
        'R24 설비 종류 — IFCELECTRICDISTRIBUTIONBOARD 3/3', 'R24 설비 종류 — IFCSENSOR 7/7', 'R24 설비 종류 — IFCOUTLET 48/48',
      ],
      // B105 `Room` 하나가 기본 이름 명세에 걸린다. IFC2x3 이라 R7(IFC4 부터)은 검사하지 않는다.
      [DUPLEX_ARCH]: [
        'R1 층 이름 4/4', 'R2 공간이 층에 속함 21/21', 'R3 공간 이름과 방 번호 42/42', 'R3 방 이름에 기본값을 두지 않음 1개',
        'R4 문·창이 벽 개구부에 끼워짐 38/38', 'R6 길이 단위 선언 1/1', 'R9 설비 포함 없음', 'R14 방 분류 0/21', 'R19 공조존 0/21', 'R22 벽의 내력 여부 57/57',
      ],
      [DUPLEX_HVAC]: [
        'R1 층 이름 3/3', 'R2 공간이 층에 속함 1/1', 'R3 공간 이름과 방 번호 2/2', 'R6 길이 단위 선언 1/1', 'R9 설비 포함 40개',
        'R11 설비마다 배치 40/40', 'R14 방 분류 0/1', 'R16 설비·도관이 계통에 묶임 0/498', 'R17 포트의 흐름 방향 970/970', 'R19 공조존 0/1',
        'R21 용량 — IFCPUMP 0/2',
      ],
      // 필수 중 유일하게 떨어지는 것이 이 파일의 문 10개(개구부에 끼워지지 않음)다.
      [CLINIC_ARCH_]: [
        'R1 층 이름 4/4', 'R2 공간이 층에 속함 269/269', 'R3 공간 이름과 방 번호 538/538', 'R4 문·창이 벽 개구부에 끼워짐 302/312',
        'R6 길이 단위 선언 1/1', 'R9 설비 포함 102개', 'R11 설비마다 배치 102/102', 'R14 방 분류 0/269', 'R16 설비·도관이 계통에 묶임 0/102',
        'R19 공조존 0/269', 'R22 벽의 내력 여부 1080/1080',
      ],
      [CLINIC_HVAC_]: [
        'R1 층 이름 4/4', 'R2 공간이 층에 속함 263/263', 'R3 공간 이름과 방 번호 526/526', 'R6 길이 단위 선언 1/1', 'R9 설비 포함 566개',
        'R11 설비마다 배치 566/566', 'R14 방 분류 0/263', 'R16 설비·도관이 계통에 묶임 0/3704', 'R17 포트의 흐름 방향 7390/7390', 'R19 공조존 0/263',
        'R21 용량 — IFCUNITARYEQUIPMENT 0/2', 'R21 용량 — IFCFAN 0/8', 'R21 용량 — IFCCHILLER 0/1', 'R21 용량 — IFCAIRTERMINALBOX 0/115',
        'R21 용량 — IFCAIRTERMINAL 0/440', 'R24 설비 종류 — IFCUNITARYEQUIPMENT 0/2', 'R24 설비 종류 — IFCAIRTERMINAL 437/440',
        'R24 설비 종류 — IFCAIRTERMINALBOX 115/115',
      ],
    }
    const files = Object.keys(want).filter((f) => existsSync(f))
    expect(files.length).toBeGreaterThanOrEqual(2)
    const out = JSON.parse(execFileSync(PYTHON, ['scripts/ids-check.py', 'docs/requirements.ids', ...files], { maxBuffer: 1 << 26 }).toString())
    expect(out.specifications).toBe(38)
    for (const f of files) expect(cells(out.files[f]), f).toEqual(want[f])
  }, 600_000)
})

// OE-BIM-13 Proxy 리포트. 파일의 Proxy 를 전부 세고, 설비로 읽은 것(포트·이름)과 읽지 않은 것을 가른다. 읽지 않은 것이 정말
// 건축 부재인지는 이름 예로 사람이 본다 — ifc4Mep 의 48개는 태양광 거치대 40개(`SolarMountingSystems`, 설명 "Mounting rack")와
// 이름·형상 없는 8개다. 병원 전기의 유압 엘리베이터 1대는 읽지 않다가 이름 사전에 "엘리베이터" 를 더해 설비로 읽는다(2026-10-03 사용자 결정).
describe('Proxy 리포트 (OE-BIM-13)', () => {
  it('가진 BIM 의 Proxy 를 전부 세고 읽지 않은 것을 이름과 함께 적는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const want: Record<string, unknown> = {
      [SAMPLE]: undefined,
      [MEP]: { total: 49, ported: 1, named: 0, louvers: 0, skipped: ['(이름 없음)', 'SolarMountingSystems'] },
      [DUPLEX_HVAC]: undefined,
      [CLINIC_ARCH]: undefined,
      [CLINIC_HVAC]: undefined,
      'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-ELE.ifc': { total: 29, ported: 0, named: 29, louvers: 0, skipped: [] },
    }
    let measured = 0
    for (const [path, proxies] of Object.entries(want)) {
      if (!existsSync(path)) continue
      measured++
      const model = importIfc(api, new Uint8Array(readFileSync(path)))
      expect(model.facts?.proxies, path).toEqual(proxies)
      const r23 = requirementsReport(model).find((r) => r.id === 'R23')!
      const p = model.facts?.proxies
      // [OE-EXT-05#2] 포트 없는 루버만 빠지고 다른 BIM 의 설비 수는 그대로다
      if (p && p.total > p.ported + p.named + (p.louvers ?? 0)) expect(r23.note, path).toContain(`파일의 Proxy ${p.total}개 중 ${p.total - p.ported - p.named - (p.louvers ?? 0)}개는`)
    }
    expect(measured).toBeGreaterThanOrEqual(2)
  }, 600_000)
})

// OE-MAN-03 외곽선 없는 물리존. 합치기로 다른 모델의 같은 방에서 외곽선을 빌려올 수 있는 방(K8)은 목록에 나오지 않는다 — 빌려오는 것이
// 먼저고, 빌려올 수 없는 것만 사람이 그린다. BIM 면적은 Revit 이 PSet_Revit_Dimensions.Area 로 적는다(성수 건축은 면적 속성이 없다).
describe.skipIf(!existsSync(DUPLEX_ARCH) || !existsSync(DUPLEX_MEP))('외곽선 없는 물리존 (OE-MAN-03)', () => {
  it('Duplex 건축의 외곽선 없는 방 둘은 MEP 와 합치면 외곽선을 빌려와 목록에서 빠진다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const arch = importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_ARCH))).model
    const alone = outlinelessSpaces(arch)
    expect(alone.map((x) => [x.space.longName, x.space.bimArea?.m2.toFixed(1)])).toEqual([['Hallway', '7.8'], ['Hallway', '7.8']])
    const merged = mergeModels(arch, importIfcWithMeshes(api, new Uint8Array(readFileSync(DUPLEX_MEP))).model)
    expect(merged.report.spaces.borrowed).toBe(2)
    expect(outlinelessSpaces(merged.model)).toEqual([])
  }, 300_000)
})

// OE-BIM-17 요구사항 보고서. 가진 BIM 에서 "다른 자리" 가 나온 줄은 전부 "내보내기 설정을 바꿔 달라" 와 무엇을 바꿀지를
// 요청으로 낸다. 다른 자리를 세는 R 이 EXPORT_SETTING 밖에서 생기면(설정으로 고칠 수 없는 것을 다른 자리로 세면) 여기서 걸린다.
describe('요구사항 보고서의 요청 (OE-BIM-17)', () => {
  it('가진 BIM 에서 다른 자리인 줄은 모두 설정 요청이다', () => {
    const api = new WebIFC.IfcAPI()
    return api.Init().then(() => {
      api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
      const files = [SAMPLE, MEP, DUPLEX_ARCH, DUPLEX_HVAC, DUPLEX_MEP, DUPLEX_MEP_1, CLINIC_ARCH, CLINIC_HVAC].filter((f) => existsSync(f))
      expect(files.length).toBeGreaterThanOrEqual(2)
      const seen = new Map<string, string[]>()
      for (const f of files) {
        for (const r of requirementsReport(importIfc(api, new Uint8Array(readFileSync(f))))) {
          if (r.state !== 'elsewhere' && !(r.counts?.elsewhere ?? 0)) continue
          expect([f, r.id, r.id in EXPORT_SETTING]).toEqual([f, r.id, true])
          expect(r.ask.startsWith(`${ASK_SETTING} — ${EXPORT_SETTING[r.id]}`), `${f} ${r.id}`).toBe(true)
          seen.set(r.id, [...(seen.get(r.id) ?? []), f.split('/').pop()!])
        }
      }
      // 파일 하나로 재는 설정 표의 여섯이 다 실제로 나온다(2026-10-03): Revit IFC2x3 이라 R10(6개 파일), Category Code 방 분류 R14(5),
      // System Name 계통 R16(4), 패밀리 이름으로 정한 종류 R24(3), PSet_Revit 용량 R21(3), ifc4Mep 의 Proxy 49대 R23(1).
      // R13 은 판본 비교를 할 때만 잰다(versions.test.ts·e2e/versions.spec.ts).
      expect([...seen.keys()].sort()).toEqual(Object.keys(EXPORT_SETTING).filter((id) => id !== 'R13').sort())
    })
  }, 600_000)
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
  for (const c of completenessChecks(model, airServices(model, withInferred(model.connections)), withInferred(model.connections))) {
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
      .toEqual({ storeys: 4, devices: 668, conduits: 3138, systems: 15, connections: 3695, directed: 3695 })

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
      // 한쪽 끝만 이어진 덕트·배관(Mavrokapnidis 2023 의 규칙). 포트가 있는 파일이라 끊긴 자리가 1% 남짓이다.
      'conduit-ends': '3103/3138',
      // 덕트·배관 구간 전부가 형상에서 읽은 경로(두 끝)를 갖는다(OE-PIP-13).
      'conduit-path': '1548/1548',
      'heat-source-user': '1/1',
      'hydronic-user-source': '2/2',
      // 스프링클러 헤드가 없는 파일이다(HVAC 모델).
      'sprinkler-fp': '0/0',
    })

    // 종류 후보(kind-suggest.ts). 종류를 아는 Revit 패밀리를 하나씩 가리고 닮은 패밀리로 맞혀 본다(2026-09-29 실측).
    const guess = evaluateSuggestions(model)
    // 엘리베이터(이름 사전, 2026-10-03)가 종류를 아는 패밀리로 더해져 14 → 15.
    expect(guess.families).toBe(15)
    expect(guess.top3).toBeGreaterThanOrEqual(10)
    // 층 사이 연결. 계단실·승강로 7개 중 6개가 위·아래층과 이어진다(vertical.ts).
    expect(verticalLinks(model).size).toBe(6)

    // OE-EQP-10 VAV·토출구. 계통 없는 것이 없고(BIM 이 System Name 으로 다 말한다), 담당 근거가 흐름을 따라 공조기에 닿는다 —
    // 말단 440 중 439, VAV 115 전부. VAV 는 전부 아래로 나눠 주는 말단을 안다.
    const need = model.storeys.flatMap((st) => st.equipment).filter(needsSystem)
    const vav = need.filter((e) => e.kind === 'vav')
    expect({ vav: vav.length, terminals: need.length - vav.length, systemless: systemlessAir(model).length }).toEqual({ vav: 115, terminals: 440, systemless: 0 })
    const basis = need.map((e) => ({ e, b: airBasis(model, model.connections, e.id) }))
    const reached = (xs: typeof basis) => xs.filter((x) => x.b.supplyFrom.length + x.b.extractTo.length > 0).length
    expect(reached(basis.filter((x) => x.e.kind !== 'vav'))).toBe(439)
    expect(reached(basis.filter((x) => x.e.kind === 'vav'))).toBe(115)
    expect(basis.filter((x) => x.e.kind === 'vav' && x.b.terminals.length > 0)).toHaveLength(115)
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
    expect(brief('R16')).toEqual({ state: 'partial', counts: { standard: 0, elsewhere: 3701, of: 3806 } })
    expect(brief('R21')).toEqual({ state: 'partial', counts: { standard: 0, elsewhere: 563, of: 566 } })
    // SPLITSYSTEM 2대는 표준 값이지만 받지 않는다(kinds.ts 의 IFC_REJECTED). 이름 사전이 종류를 알아서 다른 자리로 간다.
    // 건축의 유압 엘리베이터(IfcFlowTerminal)도 이름 사전으로 알게 되어(2026-10-03) 모르는 것이 0 — 다른 자리다.
    expect(brief('R24')).toEqual({ state: 'elsewhere', counts: { standard: 662, elsewhere: 6, of: 668 } })
    expect(rows.get('R22')!.note).toContain('기본값')
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
    // 종류를 모르던 1대는 건축의 유압 엘리베이터였다. 이름 사전에 더해 0 이다(2026-10-03).
    expect(devices.filter((e) => !e.kind)).toHaveLength(0)

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
      .toEqual({ devices: 3469, conduits: 12645, systems: 16, connections: 13608, directed: 0 })

    // F11(2026-09-24 실측 97.2%).
    const score = scoreAgainstDeclared(model)
    expect(score.total).toBe(7742)
    expect(score.agreed / score.total).toBeGreaterThanOrEqual(0.971)
    expect(overlapScore(model)).toEqual({ total: 637, smallest: 584, first: 563 })

    // **포트가 없으면 규칙이 퍼질 길이 끊겨 있다.** 연결 13,608개 중 규칙이 방향을 준 것이 1,345개이고(타입의 종류를
    // 읽기 전에는 12개), 공기 말단 454개 중 원천에 닿는 것이 21개뿐이다. 흐름이 있는 설비 52대가 어디에도 이어지지 않는다(임포트 경고
    // "접합 부재 누락"). R-요구사항의 근거다. 조명·콘센트처럼 흐름 없는 기기는 형상으로 잇지 않는다(OE-PIP-18) — 그 전에는 그것까지
    // 세어 1,806대였고, 연결은 13,890개였다.
    // 이 숫자가 오르면 좋은 일이지만, 다른 BIM 이 같이 떨어지지 않았는지 먼저 본다.
    const rules = inferFlowByRules(model)
    expect(rules.oriented).toBeGreaterThanOrEqual(1345)
    expect(checksOf(model)).toEqual({
      'terminal-source': '21/454',
      'source-terminal': '16/136',
      'terminal-single-source': '21/21',
      'device-space': '3337/3469',
      // 흐름 없는 기기(조명)와 형상으로 잇지 않으면서(OE-PIP-18) 850 에서 하나 줄었다 — 조명에만 붙어 있던 말단이다. 디퓨저 수백 개도
      // 유일한 상대가 옆 조명이었다. 덕트에 닿은 적이 없는데 "이어졌다" 로 보이던 것이다.
      'device-connected': '849/884',
      // 포트 없이 형상으로 이은 연결망은 끊긴 자리가 많다(14%). 열원 하나와 냉온수 기기 둘이 배관으로 닿지 않는다.
      'conduit-ends': '10923/12645',
      // 포트가 없어도 구간 형상은 있어 경로를 다 읽는다(OE-PIP-13).
      'conduit-path': '5952/5952',
      'heat-source-user': '0/1',
      'hydronic-user-source': '0/2',
      // 스프링클러 헤드 418대(`M_Sprinkler - Pendent`)는 IfcFlowTerminal 이라 종류를 사람이 고르기 전까지 대상이 아니다(kinds.ts 의 manual).
      'sprinkler-fp': '0/0',
    })
    const guess = evaluateSuggestions(model)
    // 33 = 엘리베이터 패밀리가 더해짐(2026-10-03). 맞힌 수 26 → 25 는 분전반이 조명에서 분전반으로 바로잡혀(위 Duplex 와 같은 까닭)
    // 하나뿐인 분전반 패밀리를 닮은 것으로 맞힐 수 없게 된 것이다. 엘리베이터도 하나뿐이라 맞히지 못한다.
    expect(guess.families).toBe(33)
    expect(guess.top3).toBeGreaterThanOrEqual(25)

    // 사람이 그 패밀리를 "스프링클러 헤드" 로 정하면 418대 전부가 소화(Fire Protection) 배관에 이어져 통과한다(OE-EQP-11).
    const head = model.storeys.flatMap((st) => st.equipment).find((e) => /Sprinkler - Pendent/.test(e.name))!
    expect(setTypeKind(model, familyKeyOf(head), 'sprinkler')?.count).toBe(418)
    expect(checksOf(model)['sprinkler-fp']).toBe('418/418')
  }, 600_000)
})

// 성수(고객사 실측). 받을 곳이 없고 성수를 가진 PC 와 55 의 data/성수/ 에만 있다(정본 부록).
// 기준값은 정본(docs/bim-to-dt-ontology.md)에 적힌 실측이다. **이 기준을 넣은 PC 에는 성수가 없어서 다시 재지
// 못했다.** 어긋난 것을 한 번에 다 보려고 expect.soft 로 둔다. 어긋나면 코드와 문서 중 어느 쪽이 맞는지 가려
// 둘 다 고친다. 규칙 일치율 83.8% 만은 soft 가 아니다 — intent.md 가 규칙을 재는 기준으로 쓰는 값이다.
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
    // 파일에는 934개다. 같은 자리·같은 이름으로 겹쳐 둔 방 하나(ef71acc)와, 이름 붙은 방마다 같은 외곽선으로 하나씩 더 둔
    // 기본 이름 "공간" 425개를 걸러 508개다(merge.ts 의 PLACEHOLDER_NAMES).
    expect.soft(c.spaces).toBe(508)
    const walls = model.storeys.flatMap((s) => s.walls)
    expect.soft({
      walls: walls.length,
      loadBearing: walls.filter((w) => w.loadBearing === true).length,
      not: walls.filter((w) => w.loadBearing === false).length,
      unknown: walls.filter((w) => w.loadBearing === null).length,
    }).toEqual({ walls: 1291, loadBearing: 351, not: 913, unknown: 27 })
    const doors = model.storeys.flatMap((s) => s.openings).filter((o) => o.kind === 'door')
    expect.soft(doors).toHaveLength(528)
    // 233 에서 270 으로 올랐다. 방이 겹친 자리에서 문이 가장 작은 방을 짚게 고친 d2b242e 의 결과다(성수는 공간 경계가 0 이라 문 전부가 좌표 판정).
    expect.soft(doors.filter((d) => (d.connects?.length ?? 0) >= 2)).toHaveLength(270)
    // [OE-SPC-17#1]
    // 방 이름 사전(정본 4장). 넓히면 오르지만 틀리게 읽는 것도 는다 — 떨어지면 실패로만 둔다. 159 → 169 는 영문 이름 넷(Air Handling Unit Room·
    // MECH.·CORR.·UPS Room)을 사전에 더한 것이다(OE-SPC-17, 2026-10-09). 약어(S.T·P.S 등)는 사람이 확인한 뒤 넣는다.
    expect.soft(model.storeys.flatMap((s) => s.spaces).filter((sp) => roomKind(sp.kind)).length).toBeGreaterThanOrEqual(169)
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
    // 파일의 Proxy 1,658개 중 기기로 받은 1,652대는 전부 포트가 있다. 포트도 사전 이름도 없어 읽지 않은 6개는 MCC·비상발전기·FT1·ET2 다.
    expect.soft(devices.filter((e) => e.ifcClass === 'BuildingElementProxy')).toHaveLength(1652)
    expect.soft(model.facts?.proxies).toMatchObject({ total: 1658, ported: 1652, named: 0 })

    // 규칙 방향(정본 3.7). 이 83.8% 가 intent.md 가 말하는 "규칙이 맞는지" 의 기준이다.
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
    // 도관 끝·물 계통 규칙(2026-09-29 추가)은 성수가 없는 PC 에서 더해 아직 재지 못했다. 처음 돌 때 값을 정본에 적는다.
    const { 'conduit-ends': _ends, 'heat-source-user': _heat, 'hydronic-user-source': _user, 'sprinkler-fp': _fp, ...measured } = checks
    expect.soft({ ...measured, 'terminal-single-source': undefined }).toEqual({
      // 분모가 22 늘었다: 타입 객체에서 종류를 읽게 되면서(603d144) 8AG 그릴 22개를 말단으로 알아본다.
      'terminal-source': '1386/2400',
      'source-terminal': '156/268',
      'terminal-single-source': undefined,
      // [OE-EQP-15#1]
      // 외벽 설비(기계 파일의 외부 루버 59대)는 방 밖이 맞는 자리라 세지 않는다(OE-EQP-15). 건축 파일의 루버 240개는 포트가 없어 아예 설비로
      // 받지 않는다(OE-EXT-05, 2026-10-09) — 그 전에는 외벽 설비가 299대였고 분모가 같았다(4911 - 299 = 4671 - 59).
      // 건축의 에스컬레이터 6대(`Escalator_(AUS)`)가 이름 사전으로 종류를 얻어 기기로 세진다(OE-EQP-07). 6대 다 방에 든다. 그 전에는 4041/4612.
      'device-space': '4047/4618',
      // 건축 루버 240개가 빠져 분모가 3632 → 3392. 그중 48개는 형상으로 덕트에 닿아 "이어졌다" 로 세던 것이다.
      'device-connected': '2943/3392',
      // 덕트·배관 구간 전부가 형상에서 읽은 경로(두 끝)를 갖는다(OE-PIP-13).
      'conduit-path': '7874/7874',
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
        if (!r.reloadSame || r.missing || !r.undoSame || !r.redoSame) {
          failed.push(`${name} seed ${seed} 불러오기 ${r.reloadSame ? '같음' : '다름'} · 못 찾음 ${r.missing} · 되돌리기 ${r.undoSame ? '같음' : '다름'} · 다시 하기 ${r.redoSame ? '같음' : '다름'} :: ${r.log.join(' | ')}`)
        }
        // [OE-MAP-06#1]
        // 소속은 편집 함수 안에서 다시 계산된다(OE-MAP-06): 저장된 소속이 그 자리에서 다시 판정한 소속과 같다.
        for (const [which, m] of [['편집', r.edited], ['불러옴', r.reloaded]] as const)
          for (const st of m.storeys)
            for (const e of st.equipment) {
              const again = structuredClone(e)
              assignEquipment(again, st.spaces)
              if (again.spaceId !== e.spaceId || again.spaceSource !== e.spaceSource)
                failed.push(`${name} seed ${seed} ${which} ${e.name}: 소속 ${e.spaceId}/${e.spaceSource} · 다시 판정 ${again.spaceId}/${again.spaceSource}`)
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
      // 내력벽과 거기 뚫린 문·창은 잠겨서(OE-OBJ-06) 고치는 대상에서 뺀다.
      // 외벽도 층 편집에서 옮기거나 지우지 않는다(OE-EXT-02). 문·창 잠금은 내력벽만이다.
      const walls = a.storeys.flatMap((s) => s.walls).filter((w) => w.footprint?.length && !wallShapeLock(w))
      const locked = new Set(a.storeys.flatMap((s) => s.walls).filter(wallLocked).map((w) => w.id))
      const openings = a.storeys.flatMap((s) => s.openings).filter((o) => o.position && !locked.has(o.wallId ?? ''))
      // 벽 다섯은 옮기고, 다섯은 내력 여부를 정하고, 다섯은 지운다. 문·창 다섯은 옮긴다(손댄 벽에 뚫린 것은 빼고).
      for (const w of walls.slice(0, 5)) moveWall(a, w.id, [0.3, 0])
      for (const w of walls.slice(5, 10)) setWallLoadBearing(a, w.id, true)
      const gone = walls.slice(10, 15)
      for (const w of gone) deleteWall(a, w.id)
      const touched = new Set(walls.slice(0, 15).map((w) => w.id))
      for (const o of openings.filter((x) => !touched.has(x.wallId ?? '')).slice(0, 5)) {
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
    let steps = 0
    let stuck = 0
    for (const path of [DUPLEX_ARCH, CLINIC_ARCH]) {
      const pristine = importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
      const shape = (m: Model) => m.storeys.flatMap((st) => st.spaces.map((sp) => sp.footprint))
      const same = (a: Vec2[][], b: Vec2[][], tol = 1e-9) => a.every((r, i) => r.length === b[i].length && r.every((p, k) => Math.abs(p[0] - b[i][k][0]) < tol && Math.abs(p[1] - b[i][k][1]) < tol))
      const opened = shape(pristine)
      // 내력벽(OE-OBJ-06)·외벽(OE-EXT-02)은 잠겨서 옮기지 않는다.
      for (const w of pristine.storeys.flatMap((st) => st.walls).filter((x) => x.footprint?.length && !wallShapeLock(x)).slice(0, 300)) {
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
        // 벽은 다른 벽을 새로 가로지르게 옮길 수 없다(OE-OBJ-05). 병원 벽 300개 중 71개는 옆구리에 T 로 맞닿은 벽 쪽으로
        // 0.2m 가면 그 벽 끝이 건너편으로 뚫고 나와 막힌다. 막히면 거기까지 간 걸음만큼 돌아온다. 첫 걸음부터 막히면 반대쪽으로 간다.
        let plan: WallCarryPlan | null = null
        let out = 0
        for (const s of [1, -1]) {
          for (let k = 0; k < 5; k++) {
            const before = JSON.stringify(m)
            const r = moveWallWithSpaces(m, w.id, [s * n[0] * 0.1, s * n[1] * 0.1], plan)
            if (!r) {
              if (JSON.stringify(m) !== before) failed.push(`${path} ${w.name} 막힌 걸음이 모델을 바꿈`)
              break
            }
            if (k === 0) carried += r.changes.length
            plan = r.plan
            out++
          }
          if (out) {
            n = [s * n[0], s * n[1]]
            break
          }
        }
        if (out) steps += out
        else stuck++
        for (let k = 0; k < out; k++) {
          const r = moveWallWithSpaces(m, w.id, [-n[0] * 0.1, -n[1] * 0.1], plan)
          if (!r) {
            failed.push(`${path} ${w.name} 돌아오는 걸음이 막힘`)
            break
          }
          plan = r.plan
        }
        if (!same(shape(m), opened)) failed.push(`${path} ${w.name} 되돌아오지 않음`)
        // 벽 길이 방향. 형상에서 읽은 벽 면은 완전히 나란하지 않아(1° 안팎) 방이 몇 mm 움직일 수 있다. 1cm 넘으면 틀린 것이다.
        moveWallWithSpaces(m, w.id, [u[0] * 0.5, u[1] * 0.5])
        if (!same(shape(m), opened, 0.01)) failed.push(`${path} ${w.name} 길이 방향에 방이 움직임`)
      }
    }
    // 벽 357개(Duplex 57 + 병원 300)가 첫 걸음에 방 600개 남짓을 끌고 간다. 0 이면 붙일 방을 못 찾는 것이다.
    expect(carried).toBeGreaterThan(500)
    // 막혀서 덜 가도 대부분은 간다 — 1750 걸음 중 1453 이었고, 외벽을 빼고(OE-EXT-02, 2026-10-08) 다른 벽이 들어와 1371 이다.
    // 양쪽 다 첫 걸음부터 막힌 벽은 없다.
    expect(steps).toBeGreaterThan(1300)
    expect(stuck).toBe(0)
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
    for (const wall of edited.storeys.flatMap((st) => st.walls).filter((w) => w.footprint?.length && !wallLocked(w))) {
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
    // R13 판정 근거(OE-BIM-19): GUID 가 바뀐 것을 하나하나 든다. 설비 217대는 이전 GUID 와 다르고, 이름 끝의 Revit 요소 ID 가 같다.
    expect(v2.equipment.rekeyed).toHaveLength(217)
    const prevName = new Map(mep.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.name]))
    for (const r of v2.equipment.rekeyed) {
      expect(r.prevId).not.toBe(r.id)
      expect(revitElementId(r.name), r.name).toBe(revitElementId(prevName.get(r.prevId)!))
    }
    expect(v2.spaces.rekeyed.map((r) => r.by).sort()).toEqual([...Array(14).fill('name'), 'position'])

    // Revit 2013 으로 올려 전기만 떼어 낸 판본(2012-12). 전기 설비 99대 중 16대의 GUID 가 바뀌었다.
    expect(compareVersions(mep, load(DUPLEX_MEP_1)).equipment.by).toEqual({ guid: 83, revitId: 16, name: 0, position: 0 })

    // 다른 도구로 반년 뒤 낸 COBie 판본은 방 GUID 를 전부 지켰다. 도구가 GUID 를 지키느냐의 문제이지, 불가능한 일이 아니다.
    const cobie = compareVersions(load(DUPLEX_ARCH), load(DUPLEX_COBIE))
    expect(cobie.spaces.by).toEqual({ guid: 21, revitId: 0, name: 0, position: 0 })
  }, 300_000)
})

// OE-BIM-11 "mm·ft 파일이 m 로 들어옴" 을 실제 파일로, 그리고 "같은 건물 판본 간 층 높이로 교차 확인". Duplex 는 같은 건물을
// 미터(건축)·밀리미터(HVAC)·피트(MEP-1) 로 낸 파일이 다 있다. 환산 뒤 층 높이가 같아야 하고, COBie(Design) 판본은 길이 단위를
// 밀리미터로 선언하고 미터 값을 적어서 1/1000 로 들어온다 — 교차 확인이 잡아야 할 실제 사례다(2026-10-03 실측).
describe.skipIf(![DUPLEX_ARCH, DUPLEX_HVAC, DUPLEX_MEP, DUPLEX_MEP_FULL, DUPLEX_MEP_1, DUPLEX_MEP_2, DUPLEX_COBIE].every((f) => existsSync(f)))('단위 교차 확인 (OE-BIM-11, Duplex)', () => {
  it('mm·ft 로 낸 판본도 m 로 들어와 건축과 층 높이가 같고, 단위를 잘못 선언한 COBie 판본만 1/1000 로 잡는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const scaleOf = (path: string) => {
      const m = api.OpenModel(new Uint8Array(readFileSync(path)))
      try {
        return +lengthScale(api, m).scale.toFixed(4)
      } finally {
        api.CloseModel(m)
      }
    }
    const load = (path: string) => importIfc(api, new Uint8Array(readFileSync(path)))
    const height = (m: Model) => Object.fromEntries(m.storeys.map((s) => [s.name, +s.elevation.toFixed(3)]))
    const arch = load(DUPLEX_ARCH)
    expect(scaleOf(DUPLEX_ARCH)).toBe(1)
    // 건축에만 기초(T/FDN)가 있다. 나머지 셋은 모든 판본에 있다.
    expect(height(arch)).toEqual({ 'T/FDN': -1.25, 'Level 1': 0, 'Level 2': 3.1, Roof: 6 })

    for (const [path, scale] of [[DUPLEX_HVAC, 0.001], [DUPLEX_MEP, 1], [DUPLEX_MEP_FULL, 1], [DUPLEX_MEP_1, 0.3048], [DUPLEX_MEP_2, 1]] as const) {
      const m = load(path)
      expect(scaleOf(path), path).toBe(scale)
      expect(height(m), path).toEqual({ 'Level 1': 0, 'Level 2': 3.1, Roof: 6 })
      expect(storeyScaleMismatch(arch.storeys, m.storeys), path).toBeNull()
      expect(compareVersions(arch, m).storeyScale, path).toBeNull()
    }

    const cobie = load(DUPLEX_COBIE)
    expect(scaleOf(DUPLEX_COBIE)).toBe(0.001)
    // 선언은 밀리미터인데 값은 미터다(Level 2 = 3.0999…). 파일 하나만 보면 3.1mm 짜리 층이 오류 없이 들어온다.
    expect(height(cobie)).toEqual({ 'T/FDN': -0.001, 'Level 1': 0, 'Level 2': 0.003, Roof: 0.006 })
    expect(requirementsReport(cobie).find((r) => r.id === 'R6')!.state).toBe('standard')
    const d = compareVersions(arch, cobie)
    expect(d.storeyScale).toMatchObject({ ratio: 1 / 1000, what: '밀리미터 ↔ 미터' })
    // 1층(0)만 빼고 기초까지 셋이 모두 1/1000 이다.
    expect(d.storeyScale!.storeys.map(([n]) => n)).toEqual(['T/FDN', 'Level 2', 'Roof'])

    const { model, report } = mergeModels(arch, cobie, { base: 'Arch.ifc', overlay: 'COBie-Design.ifc' })
    expect(report.unitScale!.ratio).toBe(1 / 1000)
    expect(model.warnings.filter((w) => w.includes('길이 단위 선언') || w.includes('높이가 다른'))).toEqual([
      '이름이 같은 층의 높이가 COBie-Design.ifc에서 Arch.ifc의 1/1000입니다(T/FDN -1.25m → -0.00125m, Level 2 3.1m → 0.0031m, Roof 6m → 0.006m). 층간 높이로 보면 COBie-Design.ifc의 길이 단위 선언이 실제 값과 다른 것 같습니다(밀리미터 ↔ 미터). 치수·좌표가 모두 그 배수로 틀립니다(요구사항 R6).',
    ])
    expect(requirementsReport(model, report).find((r) => r.id === 'R6')!.state).toBe('partial')
    // 판본 비교로 COBie 를 지금 파일로 열면(건축이 이전 판본) 지금 파일이 틀렸다 — 층간 높이 3.1mm.
    expect(d.storeyScale!.suspect).toBe('second')
    const r6 = requirementsReport(cobie, null, { name: 'Arch.ifc', kept: 0, rematched: 0, storeyScale: d.storeyScale }).find((r) => r.id === 'R6')!
    expect(r6.state).toBe('partial')
    // 거꾸로 건축을 열고 COBie 를 이전 판본으로 견주면 건축의 R6 은 표준이고, 이전 판본(COBie)을 짚는다.
    const back = compareVersions(cobie, arch).storeyScale!
    expect(back).toMatchObject({ ratio: 1000, suspect: 'first' })
    const archR6 = requirementsReport(arch, null, { name: 'COBie-Design.ifc', kept: 0, rematched: 0, storeyScale: back }).find((r) => r.id === 'R6')!
    expect(archR6.state).toBe('standard')
    expect(archR6.note).toContain('이전 판본(COBie-Design.ifc)은 같은 이름 층의 높이가 이 파일의 1/1000로')
  }, 300_000)
})

// PRD 부록 C 요구조건 S1~S8(OE-INT-09)을 실제 BIM 으로. 픽스처로 재는 묶음은 src/lib/requirements-s.test.ts 다. 여기서는
// 픽스처에 없는 것 — 실제로 GUID 가 바뀐 판본(S1), 22자 IfcGlobalId(S2), BIM 이 말한 소속(S4), 벽·문·창의 3D(S7) — 을 잰다.
describe.skipIf(![DUPLEX_MEP_FULL, DUPLEX_MEP_2, DUPLEX_ARCH, DUPLEX_MEP].every((f) => existsSync(f)))('요구조건 S (OE-INT-09, Duplex)', () => {
  it('S1: 같은 Revit 으로 다시 낸 MEP-2(GUID 가 바뀐 설비 217대)에 MEP 에서 한 편집이 다시 얹힌다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const load = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    const v1 = load(DUPLEX_MEP_FULL)
    const v2 = load(DUPLEX_MEP_2)
    const diff = compareVersions(v1, v2)
    const edited = structuredClone(v1)
    const base = baselineOf(edited)
    // GUID 가 바뀐 설비 다섯을 옮기고, GUID 가 바뀐 방 하나의 이름을 고치고, 설비 하나를 더한다.
    const prevEq = new Map(v1.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
    const movedEq = diff.equipment.rekeyed.filter((r) => prevEq.get(r.prevId)?.position).slice(0, 5)
    for (const r of movedEq) {
      const p = prevEq.get(r.prevId)!.position!
      moveEquipment(edited, r.prevId, [p[0] + 0.5, p[1], p[2]])
    }
    const room = diff.spaces.rekeyed[0]
    renameSpace(edited, room.prevId, 'S1 고친 이름')
    const storey = edited.storeys.find((s) => s.spaces.some((sp) => sp.id === room.prevId))!
    const sp = storey.spaces.find((x) => x.id === room.prevId)!
    const at = interiorPoint(sp.footprint)!
    const added = addEquipment(edited, storey.id, { name: 'S1 감지기', kind: 'smoke_detector', position: [at[0], at[1], storey.elevation + 2.5] })!
    const file = parseEditFile(JSON.stringify(exportEdits(edited, base, 'MEP.ifc')))
    if (typeof file === 'string') throw new Error(file)

    const target = structuredClone(v2)
    const result = applyEdits(target, file)
    // 설비 다섯은 이름 끝의 Revit 요소 ID 로, 방은 이름으로 찾는다. 못 찾은 것은 없다.
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0, elements: 0, storeys: 0 })
    expect(movedEq.map((r) => r.by)).toEqual(Array(5).fill('revitId'))
    expect(result.rematched).toEqual({ revitId: 5, name: 1, position: 0 })
    const x = modelToTTL(target)
    const ttl = readOntologyTTL(x)
    const floors = modelToGeoJSON(target).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
    const feats = new Map(floors.flatMap((f) => f.features).map((f) => [f.id, f]))
    // 덕트·배관 구간은 경로(LineString)로 나간다(OE-PIP-13). 편집한 쪽의 경로와 같은 자리로 옮겨졌는지 본다.
    const editedFeats = new Map(modelToGeoJSON(edited).flatMap((f) => f.collection.features).map((f) => [f.id, f]))
    for (const r of movedEq) {
      const p = prevEq.get(r.prevId)!.position!
      const g = feats.get(r.id)!.geometry!
      if (g.type === 'LineString') {
        const want = editedFeats.get(r.prevId)!.geometry!.coordinates as number[][]
        ;(g.coordinates as number[][]).forEach((q, i) => q.forEach((v, k) => expect(v, r.name).toBeCloseTo(want[i][k], 3)))
        expect(want[0][0] - (prevEq.get(r.prevId)!.axis![0][0] + p[0]), r.name).toBeCloseTo(0.5, 3)
      } else expect((g.coordinates as number[])[0], r.name).toBeCloseTo(p[0] + 0.5, 6)
    }
    expect(ttl.entities.find((e) => e.key === room.id)!.label).toBe('S1 고친 이름')
    expect(ttl.entities.find((e) => e.key === added.id)!.cls).toBe('Smoke_Detector')
  }, 600_000)

  it('S2·S4·S7: 건축+MEP 합친 모델 — id 는 22자 IfcGlobalId, BIM 이 말한 소속 167건이 GeoJSON 에 bim 으로, 벽·문·창이 3D 에', async () => {
    if (!('FileReader' in globalThis)) {
      ;(globalThis as Record<string, unknown>).FileReader = class {
        result: ArrayBuffer | null = null
        onloadend: (() => void) | null = null
        readAsArrayBuffer(blob: Blob) {
          void blob.arrayBuffer().then((b) => {
            this.result = b
            this.onloadend?.()
          })
        }
      }
    }
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path)), undefined, { openings: true })
    const a = open(DUPLEX_ARCH)
    const b = open(DUPLEX_MEP)
    const { model, report } = mergeModels(a.model, b.model)
    const meshes = new Map([...a.meshes, ...b.meshes])
    const floors = modelToGeoJSON(model).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
    const features = floors.flatMap((f) => f.features)
    const ttl = readOntologyTTL(modelToTTL(model))

    // S2: BIM 에서 온 것은 전부 22자 IfcGlobalId 이고, 물리존·설비는 TTL 주어 키와 GeoJSON id 가 같은 문자열이다.
    const keys = new Set([...ttl.entities.map((e) => e.key), ...ttl.unread.map((u) => u.key)])
    const kinds = new Map<string, number>()
    for (const f of features) {
      const kind = String(f.properties.kind)
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
      // 수직 관통 오브젝트의 층별 조각은 "부모 id@층 id" 다(OE-ML-02). 부모 id 가 BIM 계단의 GlobalId 다.
      if (kind === 'vertical') {
        expect(f.properties.parentId, kind).toMatch(/^[0-9A-Za-z_$]{22}$/)
        expect(f.id).toBe(`${f.properties.parentId}@${f.properties.storeyId}`)
      } else expect(f.id, kind).toMatch(/^[0-9A-Za-z_$]{22}$/)
      if (kind === 'space' || kind === 'equipment') expect(keys.has(f.id), f.id).toBe(true)
    }
    // 계단 2개가 1·2층에 조각 하나씩이다.
    expect(Object.fromEntries(kinds)).toEqual({ wall: 57, space: 21, equipment: 926, window: 24, door: 14, vertical: 4 })

    // S4: 소속의 출처. BIM 이 말한 소속(합칠 때 같은 자리의 방으로 옮겨 적은 것)은 bim, 나머지는 calc.
    const src = features.filter((f) => f.properties.kind === 'equipment' && f.properties.spaceId).map((f) => f.properties.spaceSource)
    expect(report.declaredRemapped).toEqual({ total: 167, remapped: 167 })
    expect({ bim: src.filter((s) => s === 'bim').length, calc: src.filter((s) => s === 'calc').length }).toEqual({ bim: 167, calc: src.length - 167 })
    expect(src.length).toBe(656)

    // S7: 3D 에 물리존 판·벽·문·창·설비가 같은 id 로 들어간다.
    const scene = modelToScene(model, meshes)
    const glb = await read3D('a.glb', await sceneToGLB(scene))
    const kindOf = new Map(features.map((f) => [f.id, String(f.properties.kind)]))
    const in3d = new Map<string, number>()
    for (const id of new Set(glb.parts.map((p) => p.id))) in3d.set(kindOf.get(id) ?? '?', (in3d.get(kindOf.get(id) ?? '?') ?? 0) + 1)
    // 문·창은 임포터가 형상을 버려 자리·크기로 세운 상자다(mesh3d.ts openingBox, ADR-0009). 전부 GeoJSON 과 같은 id 다.
    expect(Object.fromEntries(in3d)).toEqual({ wall: 57, space: 21, equipment: 926, window: 24, door: 14 })
    expect(check3D(glb.parts, floors, ttl)).toEqual({ unknown: [], missing: [], misplaced: [] })
  }, 900_000)
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

// 외벽 판정(OE-EXT-01). IsExternal 이 없는 벽은 건물 바깥에 닿는지로 계산한다. Revit 은 벽마다 IsExternal 을 적으니
// 그것을 가리고 계산만으로 맞혀 본다(computeExternal). ArchiCAD(AC20)는 값이 없어 이름(Wand-Ext·Wand-Int)이 정답이다.
// 2026-10-03 실측: AC20 13/13, Duplex 건축 50/57, 병원 건축 1,020/1,080. 틀린 것은 대부분 원본 쪽 사정이다 —
// Duplex 는 세대 경계벽(Party Wall)을 외벽으로 적었고 기초벽 셋을 외벽으로 적었다. 병원은 커튼월(IfcCurtainWall 31)을 우리가
// 벽으로 읽지 않아 그 안쪽 칸막이가 바깥에 드러나고, 지붕층·2층에 건물 밖으로 그려진 공간이 바깥을 막는다.
describe.skipIf(!existsSync(SAMPLE) || !existsSync(DUPLEX_ARCH) || !existsSync(CLINIC_ARCH))('외벽 판정을 BIM 의 IsExternal 에 대 본다', () => {
  it('계산만으로 맞힌 비율이 기준값 아래로 떨어지지 않는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const score = (path: string, truth: (w: Model['storeys'][number]['walls'][number]) => boolean | null | undefined) => {
      const { model } = importIfcWithMeshes(api, new Uint8Array(readFileSync(path)))
      let agreed = 0, total = 0
      for (const storey of model.storeys) {
        const calc = computeExternal(storey)
        for (const wall of storey.walls) {
          const t = truth(wall)
          const c = calc.get(wall.id)
          if (t == null || c == null) continue
          total++
          if (t === c) agreed++
        }
      }
      return { agreed, total }
    }
    expect(score(SAMPLE, (w) => (/Ext/.test(w.name) ? true : /Int/.test(w.name) ? false : null))).toEqual({ agreed: 13, total: 13 })
    expect(score(DUPLEX_ARCH, (w) => w.external)).toEqual({ agreed: 50, total: 57 })
    const clinic = score(CLINIC_ARCH, (w) => w.external)
    expect(clinic.total).toBe(1080)
    expect(clinic.agreed).toBeGreaterThanOrEqual(1020)
  })

  // OE-OBJ-04 크기 z. 벽 높이는 BIM 형상의 위아래 폭이다(출처 계산). 층고로 채우지 않는다 — 다락·기초 벽은 층고와 다르다.
  it('벽 높이를 형상에서 읽는다 — AC20 1층 2.5·2.7m, Duplex 기초 벽 1.25m', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const heights = (path: string, storey: string) =>
      importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model.storeys.find((s) => s.name === storey)!.walls.map((w) => w.height)
    expect([...new Set(heights(SAMPLE, 'Erdgeschoss'))].sort()).toEqual([2.5, 2.7])
    const footing = heights(DUPLEX_ARCH, 'T/FDN')
    expect(footing).toHaveLength(7)
    expect(footing).toContain(1.25)
    expect(footing.every((h) => h !== null && h !== undefined && h > 1 && h <= 1.25)).toBe(true)
  }, 300_000)
})

// 벽 생성(OE-BIM-04). IfcWall 이 위치(평면 외곽선)와 두께를 가진 GeoJSON 벽 feature 로 나간다. 외곽선은 형상의 맨 아래 면,
// 두께는 재료층 합이다(element-geometry.ts, import.ts). 슬래브는 읽지 않는다 — 3D Map 은 물리존 판 + 벽이다.
describe.skipIf(!existsSync(SAMPLE) || !existsSync(DUPLEX_ARCH) || !existsSync(CLINIC_ARCH))('벽이 위치·두께를 가진 GeoJSON 으로 나간다', () => {
  it('가진 건축 BIM 의 벽이 전부 외곽선과 두께를 갖는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const walls = (path: string) => {
      const { model } = importIfcWithMeshes(api, new Uint8Array(readFileSync(path)))
      const features = modelToGeoJSON(model).flatMap((f) => f.collection.features).filter((f) => f.properties.kind === 'wall')
      return {
        walls: countOf(model).walls,
        features: features.length,
        withShape: features.filter((f) => f.geometry && ['Polygon', 'MultiPolygon'].includes(f.geometry.type)).length,
        withThickness: features.filter((f) => typeof f.properties.thickness === 'number' && f.properties.thickness > 0).length,
      }
    }
    // 2026-10-03 실측. 하나라도 빠지면 형상·재료층을 못 읽게 된 것이다.
    expect(walls(SAMPLE)).toEqual({ walls: 13, features: 13, withShape: 13, withThickness: 13 })
    expect(walls(DUPLEX_ARCH)).toEqual({ walls: 57, features: 57, withShape: 57, withThickness: 57 })
    expect(walls(CLINIC_ARCH)).toEqual({ walls: 1080, features: 1080, withShape: 1080, withThickness: 1080 })
  }, 300_000)
})

// 문·창 생성(OE-BIM-05). 어느 벽에 뚫렸는지(IfcRelVoidsElement·IfcRelFillsElement)를 모르는 문·창은 R4 에서 빼지 않고 모수에 넣어
// "일부" 로 센다. 병원 건축은 307개 중 5개가 호스트 벽을 모른다(2026-10-03).
describe.skipIf(!existsSync(SAMPLE) || !existsSync(DUPLEX_ARCH) || !existsSync(CLINIC_ARCH))('호스트 벽을 모르는 문·창은 R4 일부로 센다', () => {
  it('가진 건축 BIM 의 R4', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const r4 = (path: string) => {
      const { model } = importIfcWithMeshes(api, new Uint8Array(readFileSync(path)))
      const row = requirementsReport(model).find((r) => r.id === 'R4')!
      return { state: row.state, counts: row.counts }
    }
    expect(r4(SAMPLE)).toEqual({ state: 'standard', counts: { standard: 16, elsewhere: 0, of: 16 } })
    expect(r4(DUPLEX_ARCH)).toEqual({ state: 'standard', counts: { standard: 38, elsewhere: 0, of: 38 } })
    expect(r4(CLINIC_ARCH)).toEqual({ state: 'partial', counts: { standard: 302, elsewhere: 0, of: 307 } })
  }, 300_000)
})

describe.skipIf(!existsSync(MEP))('좌표 없는 설비는 미배치 목록 (ifc4Mep)', () => {
  it('17대가 층과 함께 목록에 들고, TTL 에는 층까지만·GeoJSON 에는 형상 없이 나간다. 퓨즈 11대는 분전반 자리다', async () => {
    // OE-BIM-07. 방이 없는 설비 파일이라 완전성 검사 "기기마다 소속 방" 은 건너뛴다 — 미배치는 이 목록만 말한다.
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(api, new Uint8Array(readFileSync(MEP)))
    const list = unplacedOf(model)
    expect(list).toHaveLength(17)
    expect(list).toHaveLength(countOf(model).unplacedEquipment)
    // 분전반 안의 보호기(퓨즈 F1~F13, 두 층에 11개씩)와 이름 없는 배관 토막 6개. 보호기는 회로(IfcDistributionCircuit)에 들어
    // 있지만 배치점이 없다 — 반 안의 부품이라 따로 놓지 않은 것이다. IFC 는 어느 분전반에 드는지 말하지 않는다(포트 연결·묶음 없음).
    // 00층은 분전반이 MB01 하나라 그 자리에 놓고(출처 panel), 01층은 둘(Data board 1·SB 02)이라 짐작하지 않고 남긴다(2026-10-03 사용자 결정).
    const byClass = new Map<string, number>()
    for (const u of list) byClass.set(u.equipment.ifcClass, (byClass.get(u.equipment.ifcClass) ?? 0) + 1)
    expect(Object.fromEntries(byClass)).toEqual({ ProtectiveDevice: 11, FlowSegment: 6 })
    expect(new Set(list.filter((u) => u.equipment.ifcClass === 'ProtectiveDevice').map((u) => u.storey.name))).toEqual(new Set(['01. verdieping']))
    const ground = model.storeys.find((s) => s.name === '00. Begane grond')!
    const mb01 = ground.equipment.find((e) => e.name === 'MB01')!
    const inPanel = ground.equipment.filter((e) => e.positionSource === 'panel')
    expect(inPanel).toHaveLength(11)
    expect(inPanel.every((e) => e.ifcClass === 'ProtectiveDevice' && JSON.stringify(e.position) === JSON.stringify(mb01.position))).toBe(true)
    expect(model.warnings.some((w) => w.includes('분전반 안 부품(보호기) 11대'))).toBe(true)
    const r11 = requirementsReport(model).find((r) => r.id === 'R11')!
    expect(r11.note).toContain('분전반 부품 11대')
    // 분전반 자리는 짐작이라 표준에서 뺀다 — 형상 중심으로 옮긴 것(계산)과 같이.
    const devices = model.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
    const bimPlaced = devices.filter((e) => e.position && !e.positionSource).length
    expect(r11.counts).toEqual({ standard: bimPlaced, elsewhere: 0, of: devices.length })

    const ttl = modelToTTL(model)
    const features = new Map(modelToGeoJSON(model).flatMap((f) => f.collection.features).map((f) => [f.id, f]))
    for (const { equipment, storey } of list) {
      const head = `ex:${escapeLocalName(equipment.id)} a `
      const at = ttl.indexOf(head)
      expect(at).toBeGreaterThan(-1)
      expect(ttl.slice(at, ttl.indexOf(' .\n', at))).toContain(`brick:hasLocation ex:${escapeLocalName(storey.id)} ;`)
      expect(features.get(equipment.id)?.geometry).toBe(null)
    }
  }, 300_000)

  // OE-MAN-04 설비 수동 배치. 좌표가 있는 설비는 BIM 자리에 저절로 놓이고(손대지 않는다), 나머지는 사람이 놓는다. 17대(분전반 자리에 놓은 퓨즈 11대를 뺀 것)를 전부 놓으면
  // 목록이 비고, 그 편집이 편집 파일로 저장·불러와도 그대로 남고, GeoJSON 에 점으로 나간다. 놓는 길은 [3D에서 놓기]·목록의 [3D에서 놓기]와
  // 같은 moveEquipment 다(높이는 화면이 같은 패밀리에서 고른다 — 여기서는 층 바닥 + 1m).
  it('미배치 17대를 사람이 전부 놓으면 목록이 비고, 저장·불러와도 같고, GeoJSON 에 점으로 나간다 (OE-MAN-04)', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const pristine = importIfc(api, new Uint8Array(readFileSync(MEP)))
    const model = structuredClone(pristine)
    const base = baselineOf(model)
    const placedByBim = model.storeys.flatMap((s) => s.equipment).filter((e) => e.position).map((e) => [e.id, e.position] as const)
    const list = unplacedOf(model)
    expect(list).toHaveLength(17)
    list.forEach(({ equipment, storey }, i) => expect(moveEquipment(model, equipment.id, [i * 0.5, 1, storey.elevation + 1])).not.toBeNull())

    expect(unplacedOf(model)).toHaveLength(0)
    expect(list.every(({ equipment }) => equipment.positionSource === 'edited')).toBe(true)
    // BIM 이 좌표를 준 설비는 그대로다 — 자동으로 놓인 것을 사람이 놓은 것이 건드리지 않는다.
    const now = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.position]))
    expect(placedByBim.filter(([id, p]) => JSON.stringify(now.get(id)) !== JSON.stringify(p))).toEqual([])

    // 편집 파일로 저장해 새로 연 모델에 얹어도 17대가 같은 자리다.
    const file = parseEditFile(JSON.stringify(exportEdits(model, base, 'ifc4Mep')))
    if (typeof file === 'string') throw new Error(file)
    const reopened = structuredClone(pristine)
    applyEdits(reopened, file)
    expect(unplacedOf(reopened)).toHaveLength(0)
    const again = new Map(reopened.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e.position]))
    expect(list.filter(({ equipment }) => JSON.stringify(again.get(equipment.id)) !== JSON.stringify(equipment.position))).toEqual([])

    // 기기는 GeoJSON 에 점으로 나간다(놓기 전에는 geometry null). 덕트 구간 6개는 형상이 없어 경로(두 끝)를 모르니, 점 하나로 놓아도
    // 경로를 만들지 않고 까닭을 적는다(OE-PIP-13 "설비의 단일 배치점만으로 배관 경로를 만들지 않는다").
    const features = new Map(modelToGeoJSON(reopened).flatMap((f) => f.collection.features).map((f) => [f.id, f]))
    const [segments, devices] = [list.filter(({ equipment }) => equipment.role === 'segment'), list.filter(({ equipment }) => equipment.role !== 'segment')]
    expect([segments.length, devices.length]).toEqual([6, 11])
    expect(devices.filter(({ equipment }) => features.get(equipment.id)?.geometry?.type !== 'Point')).toEqual([])
    expect(segments.map(({ equipment }) => [features.get(equipment.id)?.geometry, features.get(equipment.id)?.properties.pathIssue])).toEqual(Array(6).fill([null, '형상 없음(경로를 모름)']))
  }, 300_000)
})

// 층고(OE-BIM-02). 이 층 바닥에서 윗층 바닥까지. BIM 이 적었으면(ArchiCAD 기준 물량 GrossHeight, COBie Storey Height) 그 값을,
// 아니면 Elevation 의 차를 쓴다. 맨 위층은 BIM 이 안 적었으면 모름이다 — 지어내지 않는다.
describe.skipIf(![SAMPLE, MEP, DUPLEX_ARCH, DUPLEX_COBIE, CLINIC_ARCH, CLINIC_HVAC].every(existsSync))('층고 (OE-BIM-02)', () => {
  it('가진 BIM 의 층고가 BIM 값·계산 값·모름으로 갈리고, 합쳐도 그대로다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const open = (p: string) => importIfc(api, new Uint8Array(readFileSync(p)))
    const table = (m: Model) => {
      const h = storeyHeights(m.storeys)
      return m.storeys.map((s) => {
        const x = h.get(s.id)
        return x ? `${s.name} ${x.value} ${x.source}${x.net !== null ? ` 순${x.net}` : ''}${x.mismatch ? ' 어긋남' : ''}` : `${s.name} 모름`
      })
    }
    // AC20 만 BIM 이 층 높이를 적었다. 1층은 계산(2.7)과 같고, 다락은 윗층이 없어 BIM 값으로만 안다.
    const ac20 = open(SAMPLE)
    expect(table(ac20)).toEqual(['Erdgeschoss 2.7 bim 순2.7', 'Dachgeschoss 2 bim 순2'])
    expect(storeyHeights(ac20.storeys).get(ac20.storeys[0].id)).toMatchObject({ property: 'BaseQuantities.GrossHeight', calc: 2.7 })
    expect(table(open(MEP))).toEqual(['-01. Fundering 0.8 calc', '00. Begane grond 3.5 calc', '01. verdieping 3.5 calc', '02. verdieping 3.5 calc', '03. Dak 모름'])
    expect(table(open(DUPLEX_ARCH))).toEqual(['T/FDN 1.25 calc', 'Level 1 3.1 calc', 'Level 2 2.9 calc', 'Roof 모름'])
    // COBie 의 Storey Height 는 네 층 모두 0.0 이라 비운 칸으로 읽는다. 층고 3.1mm 는 길이 단위를 mm 로 잘못 선언한 탓이다(ADR-0007).
    const cobie = open(DUPLEX_COBIE)
    expect(cobie.storeys.filter((s) => s.declaredHeight)).toEqual([])
    expect(table(cobie)).toEqual(['T/FDN 0.0013 calc', 'Level 1 0.0031 calc', 'Level 2 0.0029 calc', 'Roof 모름'])
    const clinic = ['TOF Footing 1 calc', 'First Floor 4.57 calc', 'Second Floor 4.68 calc', 'Roof - Main 모름']
    expect(table(open(CLINIC_ARCH))).toEqual(clinic)
    expect(table(mergeModels(open(CLINIC_ARCH), open(CLINIC_HVAC)).model)).toEqual(clinic)
    // 덧붙인 파일만 층 높이를 적었으면 합친 층이 그 값을 가져온다. 다른 건물끼리라 억지 짝이지만 둘 다 보인다 — AC20 1층(0m)은
    // ifc4Mep 의 0m 층에 붙어 BIM 2.7 을 가져오고, AC20 다락(2.7m)은 새 층이 되어 윗층(3.5m)과의 차 0.8 이 생겨 BIM 2.0 과 어긋난다.
    expect(table(mergeModels(open(MEP), ac20).model).filter((r) => r.includes('bim'))).toEqual(['00. Begane grond 2.7 bim 순2.7', 'Dachgeschoss 2 bim 순2 어긋남'])
  }, 300_000)
})

// 층 단위 생성(OE-GEN-11). 층 파일(TTL·GeoJSON 한 쌍)을 다 모으면 건물 전체 TTL 과 같은 트리플이고(ADR-0011), 층 파일 하나만 봐도
// GeoJSON 의 그 층 feature 가 TTL 주어로 다 있다. 끝이 빈 줄은 다른 층 주어를 가리키는 것뿐이다 — 다른 층 파일이 들어오면 이어진다.
describe('층 단위 생성 (OE-GEN-11)', () => {
  it('가진 BIM 의 층 파일을 모으면 건물 전체와 같고, 층마다 GeoJSON 과 TTL 이 id 로 이어진다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const open = (path: string) => importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
    const cases: [string, () => Model][] = []
    if (existsSync(SAMPLE)) cases.push(['fzk', () => open(SAMPLE)])
    if (existsSync(MEP)) cases.push(['ifc4mep', () => open(MEP)])
    if (existsSync(DUPLEX_ARCH) && existsSync(DUPLEX_HVAC)) cases.push(['duplex 건축+hvac', () => mergeModels(open(DUPLEX_ARCH), open(DUPLEX_HVAC)).model])
    if (existsSync(DUPLEX_MEP_FULL)) cases.push(['duplex mep', () => open(DUPLEX_MEP_FULL)])
    if (existsSync(CLINIC_ARCH) && existsSync(CLINIC_HVAC)) cases.push(['병원 건축+hvac', () => mergeModels(open(CLINIC_ARCH), open(CLINIC_HVAC)).model])
    if (existsSync(SAMSUNG_IDF)) cases.push(['idf', () => modelFromIdf(readIdf(readFileSync(SAMSUNG_IDF, 'utf8')), 'samsung').model])
    expect(cases.length).toBeGreaterThanOrEqual(2)
    const crossing: Record<string, number> = {}
    for (const [name, make] of cases) {
      const model = make()
      const whole = ttlTriples(modelToTTL(model))
      const merged = new Set<string>()
      const subjects = new Set<string>()
      const objects: string[] = []
      const readings: ReturnType<typeof readOntologyTTL>[] = []
      const floors: ReturnType<typeof readGeoJSON>[] = []
      for (const storey of model.storeys) {
        const files = storeyFiles(model, storey.id)!
        for (const t of ttlTriples(files.ttl)) merged.add(t)
        const reading = readOntologyTTL(files.ttl)
        const floor = readGeoJSON(files.geojsonName, files.geojson)
        readings.push(reading)
        floors.push(floor)
        expect(floor.problems, `${name} ${storey.name}`).toEqual([])
        const check = crossCheck(reading, [floor])
        expect({ notInTtl: check.notInTtl, locationMismatch: check.locationMismatch, doorLinks: check.doorLinks }, `${name} ${storey.name}`).toEqual({ notInTtl: [], locationMismatch: [], doorLinks: [] })
        for (const e of [...reading.entities, ...reading.unread]) subjects.add(e.key)
        objects.push(...check.dangling.map((d) => d.to))
      }
      expect([...merged].filter((t) => !whole.has(t)), name).toEqual([])
      expect([...whole].filter((t) => !merged.has(t)), name).toEqual([])
      // 층 파일 하나에서 끝이 빈 줄은 전부 다른 층 파일의 주어다.
      expect(objects.filter((id) => !subjects.has(id)), name).toEqual([])
      // 뷰어처럼 층 파일을 쌓아 읽으면(mergeReadings) 끊긴 참조가 없다 — 건물 전체 TTL 을 읽은 것과 같다.
      const stacked = crossCheck(mergeReadings(readings), floors)
      expect({ ...stacked, toUnread: 0 }, name).toEqual({ notInTtl: [], dangling: [], toUnread: 0, locationMismatch: [], doorLinks: [] })
      crossing[name] = objects.length
    }
    // 다른 층을 가리키는 줄 수. 층을 넘는 흐름(feeds)·계통 구성원·공조존의 방이다. 이 수가 0 이 아니어도 위에서 다 이어짐을 봤다.
    // 이 PC 에 있는 파일만 견준다(병원·IDF 는 없는 PC 가 있다).
    const expected: Record<string, number> = { fzk: 0, ifc4mep: 20, 'duplex 건축+hvac': 0, 'duplex mep': 0, '병원 건축+hvac': 311, idf: 225 }
    expect(crossing).toEqual(Object.fromEntries(Object.keys(crossing).map((k) => [k, expected[k]])))
  }, 900_000)
})

// 층 단위 진행(OE-MAN-06). 큰 파일에서 완료한 층을 고치면 그 층만 풀리고, 지문을 재는 값이 편집마다 돌아도 견딜 만한지, 층 GUID 가
// 바뀐 재내보내기에도 완료한 층을 찾는지 본다.
describe.skipIf(!existsSync(CLINIC_ARCH) || !existsSync(CLINIC_HVAC))('층 단위 진행 (OE-MAN-06)', () => {
  it('병원 건축+HVAC: 층을 다 완료하고 1층 설비 하나를 옮기면 1층만 풀리고, GUID 가 바뀐 판본에 불러와도 그대로다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
    const open = (path: string) => importIfc(api, new Uint8Array(readFileSync(path)))
    const pristine = mergeModels(open(CLINIC_ARCH), open(CLINIC_HVAC)).model
    const m = structuredClone(pristine)
    const base = baselineOf(m)
    for (const s of m.storeys) markStoreyDone(m, s.id, new Date('2026-10-03T10:00:00Z'))
    const t0 = performance.now()
    const rows = storeyProgress(m)
    const elapsed = performance.now() - t0
    expect(rows.map((r) => r.state)).toEqual(m.storeys.map(() => 'done'))
    // 편집마다 완료한 층 전부의 지문을 다시 잰다. 병원 설비 3800여 대에 화면이 멈칫하지 않을 만큼이어야 한다.
    expect(elapsed).toBeLessThan(300)
    const first = m.storeys.find((s) => s.name === 'First Floor')!
    const device = first.equipment.find((e) => e.position)!
    moveEquipment(m, device.id, [device.position![0] + 0.5, device.position![1], device.position![2]])
    expect(storeyProgress(m).map((r) => `${r.name} ${r.state}`)).toEqual(m.storeys.map((s) => `${s.name} ${s === first ? 'changed' : 'done'}`))

    // 층·설비 GUID 가 전부 바뀐 판본(재내보내기)에 편집 파일을 얹어도 완료한 층을 지문으로 찾는다.
    const file = parseEditFile(JSON.stringify(exportEdits(m, base, 'clinic')))
    if (typeof file === 'string') throw new Error(file)
    let json = JSON.stringify(pristine)
    for (const id of pristine.storeys.flatMap((s) => [s.id, ...s.equipment.map((e) => e.id)])) json = json.split(JSON.stringify(id)).join(JSON.stringify(`${id}Qv2`))
    const b: Model = JSON.parse(json)
    const result = applyEdits(b, file)
    expect(result.missing.storeys).toBe(0)
    expect(storeyProgress(b).map((r) => `${r.name} ${r.state}`)).toEqual(storeyProgress(m).map((r) => `${r.name} ${r.state}`))
  }, 300_000)
})

// BIM 배관 가져오기(OE-PIP-14). 같은 BIM 을 다시 열고 편집 파일을 얹어도 구간이 늘지 않고, 사람이 한 형상 보정(꺾임점 옮기기)과
// 연결 해제 보정이 그대로 남는다. 형상만으로 이은 연결은 방향 없이 들어와 원본(포트) 연결과 출처로 갈린다.
describe.skipIf(!existsSync(DUPLEX_HVAC) || !existsSync(DUPLEX_MEP_FULL) || !existsSync(DUPLEX_MEP_2))('BIM 배관 다시 열기 (OE-PIP-14)', () => {
  it('Duplex HVAC: 꺾임점을 옮기고 포트 연결을 해제 보정한 뒤 다시 열어 얹으면, 구간 수·경로·해제 보정이 같고 새 연결이 생기지 않는다 [OE-PIP-14#3,5] [OE-PIP-10#5~]', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const bytes = new Uint8Array(readFileSync(DUPLEX_HVAC))
    const { model: edited, meshes } = importIfcWithMeshes(api, bytes)
    const base = baselineOf(edited)
    const all = edited.storeys.flatMap((st) => st.equipment)
    const axisOf = (id: string) => {
      const mesh = meshes.get(id)
      return all.find((e) => e.id === id)?.role === 'segment' && mesh ? segmentAxisOf(mesh.positions) : null
    }
    // 엘보 #582938 을 0.3m 옮긴다(양쪽 구간이 늘어난다).
    const elbow = all.find((e) => e.name.endsWith(':582938'))!
    const plan = planFollow(edited, elbow.id, axisOf)
    const p = elbow.position!
    moveEquipment(edited, elbow.id, [p[0] + 0.3, p[1], p[2]])
    applyFollow(edited, plan, [0.3, 0, 0], axisOf)
    const stretched = [...new Set(plan.stretch.map((x) => x.id))]
    expect(stretched).toHaveLength(2)
    // 배수관 #582951 과 샤워 #582917 의 포트 연결을 해제 보정한다.
    const pipe = all.find((e) => e.name.endsWith(':582951'))!
    const shower = all.find((e) => e.name.endsWith(':582917'))!
    const port = edited.connections.find((c) => c.source === 'port' && [c.from, c.to].includes(pipe.id) && [c.from, c.to].includes(shower.id))!
    expect('refused' in releaseConnection(edited, port, '시험')).toBe(false)

    const file = parseEditFile(JSON.stringify(exportEdits(edited, base, 'HVAC.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const again = importIfcWithMeshes(api, bytes).model
    const opened = { equipment: countOf(again).equipment, connections: again.connections.length }
    applyEdits(again, file)
    // 다시 연 모델에 얹어도 구간·설비가 늘지 않는다. 연결은 해제 보정한 하나만 빠진다.
    expect(countOf(again).equipment).toBe(opened.equipment)
    expect(again.connections.length).toBe(opened.connections - 1)
    expect(again.releasedConnections?.map((r) => [r.connection.from, r.connection.to].sort())).toEqual([[pipe.id, shower.id].sort()])
    // 늘인 두 구간의 경로가 편집한 쪽과 같다.
    const pathOf = (m: Model, id: string) => segmentPath(m.storeys.flatMap((st) => st.equipment).find((e) => e.id === id)!)
    for (const id of stretched) expect(pathOf(again, id)).toEqual(pathOf(edited, id))
  }, 600_000)

  it('Duplex·병원 MEP: 포트 없이 형상으로 이은 연결은 출처가 geometry 이고 방향이 없다. 다른 판본(MEP-2)에서도 같다 [OE-PIP-14#4]', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    for (const path of [DUPLEX_MEP_FULL, DUPLEX_MEP_2]) {
      const m = importIfcWithMeshes(api, new Uint8Array(readFileSync(path))).model
      expect(m.connections.length, path).toBeGreaterThan(0)
      expect(m.connections.filter((c) => c.source !== 'geometry' || c.directed), path).toEqual([])
    }
  }, 600_000)
})
