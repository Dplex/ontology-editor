import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc, importIfcWithMeshes } from './ifc/import'
import { readIdf } from './idf/read'
import { attachIdf } from './idf/attach'
import { addEquipment, baselineOf, moveEquipment, renameSpace } from './edit'
import { createCustomZone } from './custom-zone'
import { applyEdits, exportEdits, parseEditFile } from './edit-file'
import { modelToTTL } from './export/ttl'
import { modelToGeoJSON } from './export/geojson'
import { readOntologyTTL } from './export/read-ttl'
import { crossCheck, readGeoJSON, type ReadFeature } from './export/read-export'
import { check3D, read3D } from './export/read-3d'
import { modelToScene, sceneToGLB, sceneToOBJ } from './export/mesh3d'
import { overlapArea } from './polygon'
import type { Model, Vec2 } from './model'

// PRD 부록 C "저장·연동 기획 요구조건 S1~S8"(OE-INT-09). 저장 방식(파일·서버 API·공유 DB, D-INT)과 무관하게 지켜야 할 조건이다.
// 지금은 파일 내보내기(TTL + GeoJSON + GLB/OBJ)뿐이라, 조건마다 **내보낸 파일을 받는 쪽처럼 다시 읽어서**(read-ttl·read-export·
// read-3d) 잰다. 화면 안의 모델이 아니라 파일이 말하는 것을 본다 — 소비 시스템이 보는 것이 그것이다.
//
// 시나리오 하나로 잰다: mep.ifc 에 IDF 공조존(two-zones.idf)을 얹고, 사람이 방 이름을 고치고, 공조기를 옮기고, 감지기를 더하고,
// 커스텀존을 그린 뒤 내보낸다. 같은 건물을 다시 내보낸 mep-v2.ifc(사무실·공조기 GUID 가 바뀜)에 편집을 다시 얹는다.

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./ifc/fixtures/${name}`, import.meta.url))))
const IDF = readFileSync(fileURLToPath(new URL('./idf/fixtures/two-zones.idf', import.meta.url)), 'utf8')

let api: WebIFC.IfcAPI
let pristine: Model
let edited: Model
let added: string
let zoneId: string
const OFFICE = '0MEP$Space$Office$0000'
const AHU = '0MEP$Equip$AHU1$0000'

type Export = { ttlText: string; ttl: ReturnType<typeof readOntologyTTL>; floors: ReturnType<typeof readGeoJSON>[]; features: ReadFeature[] }
const exportOf = (m: Model): Export => {
  const ttlText = modelToTTL(m)
  const floors = modelToGeoJSON(m).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
  return { ttlText, ttl: readOntologyTTL(ttlText), floors, features: floors.flatMap((f) => f.features) }
}
const feature = (x: Export, id: string) => x.features.find((f) => f.id === id)!
const entity = (x: Export, key: string) => x.ttl.entities.find((e) => e.key === key)!

/** IDF 를 얹은 모델. 편집 파일은 이 상태를 기준으로 적힌다(앱도 IDF 를 얹은 뒤의 모델을 기준선으로 둔다). */
const withIdf = (m: Model) => attachIdf(m, readIdf(IDF), 'two-zones.idf').model

beforeAll(async () => {
  api = new WebIFC.IfcAPI()
  await api.Init()
  pristine = withIdf(importIfc(api, fixture('mep.ifc')))
  edited = structuredClone(pristine)
  renameSpace(edited, OFFICE, '대회의실')
  moveEquipment(edited, AHU, [2, 3, 3.2])
  added = addEquipment(edited, edited.storeys[0].id, { name: 'SD-101', kind: 'smoke_detector', position: [5, 4, 2.7] })!.id
  const zone = createCustomZone(edited, edited.storeys[0].id, { name: '창가', footprint: [[0, 0], [4, 0], [4, 8], [0, 8]] })
  if (!zone || 'refused' in zone) throw new Error('커스텀존을 만들지 못했다')
  zoneId = zone.id
}, 60_000)

describe('S1 — 재임포트 후 에디터 편집분 유지 (GUID 유지 전제, 바뀐 경우 식별 정보 재매칭)', () => {
  it('GUID 가 바뀐 재내보내기(mep-v2)에 편집 파일을 얹으면 이름·자리·더한 것이 같은 id 로 다시 나간다', () => {
    const file = parseEditFile(JSON.stringify(exportEdits(edited, baselineOf(pristine), 'mep.ifc')))
    if (typeof file === 'string') throw new Error(file)
    const v2 = withIdf(importIfc(api, fixture('mep-v2.ifc')))
    // mep-v2 는 사무실과 공조기의 GUID 가 바뀌었다. GUID 로는 못 찾는다.
    expect(v2.storeys[0].spaces.map((s) => s.id)).not.toContain(OFFICE)
    const result = applyEdits(v2, file)
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0, elements: 0, storeys: 0 })
    expect(result.rematched).toEqual({ revitId: 0, name: 2, position: 0 })

    const x = exportOf(v2)
    const office = v2.storeys[0].spaces[0]
    // 사무실은 v2 의 GUID 로 나가고(그 판본의 id), 고친 이름이 실린다.
    expect(entity(x, office.id).label).toBe('대회의실')
    const ahu = v2.storeys[0].equipment.find((e) => e.name === 'AHU-1')!
    expect(feature(x, ahu.id).geometry!.coordinates).toEqual([2, 3, 3.2])
    // 사람이 만든 것은 판본이 바뀌어도 같은 U_ id 다 — DT 쪽 참조가 끊기지 않는다.
    expect(entity(x, added).cls).toBe('Smoke_Detector')
    expect(entity(x, zoneId).label).toBe('창가')
    expect(feature(x, zoneId).properties.kind).toBe('customZone')
  })
})

describe('S2 — 물리존·설비·공조존이 에디터·DT·Agent 에서 같은 ID 로 조회', () => {
  it('모델의 id 가 TTL 주어(DT·Agent 가 읽는 키)와 GeoJSON feature id 에 그대로 나간다', () => {
    const x = exportOf(edited)
    const ttlKeys = new Set([...x.ttl.entities.map((e) => e.key), ...x.ttl.unread.map((u) => u.key)])
    const geoIds = new Set(x.features.map((f) => f.id))
    const spaces = edited.storeys.flatMap((s) => s.spaces.map((sp) => sp.id))
    const equipment = edited.storeys.flatMap((s) => s.equipment.map((e) => e.id))
    const zones = edited.hvac!.zones.map((z) => z.id)
    for (const [what, ids] of [['물리존', spaces], ['설비', equipment], ['공조존', zones], ['커스텀존', [zoneId]]] as const) {
      expect(ids.length, what).toBeGreaterThan(0)
      for (const id of ids) {
        expect(ttlKeys.has(id), `${what} ${id} TTL`).toBe(true)
        expect(geoIds.has(id), `${what} ${id} GeoJSON`).toBe(true)
      }
    }
    // `$` 든 GUID 도 받는 쪽 키가 GeoJSON id 와 같은 문자열이다(이스케이프를 푼 값).
    expect(ttlKeys.has(OFFICE)).toBe(true)
  })

  it('id 규칙: BIM 은 IfcGlobalId, 사람이 만든 것은 U_ 22자($ 없음), IDF 출신은 Z_·I_', () => {
    expect(added).toMatch(/^U_[0-9A-Za-z_]{20}$/)
    expect(zoneId).toMatch(/^U_[0-9A-Za-z_]{20}$/)
    expect(edited.hvac!.zones.map((z) => z.id)).toEqual(['Z_1F_OFFICE', 'Z_1F_STORE'])
    const idfOnly = edited.hvac!.equipment.filter((e) => !e.bimId)
    expect(idfOnly.length).toBeGreaterThan(0)
    for (const e of idfOnly) expect(e.id).toMatch(/^I_/)
    // BIM 과 이름이 맞은 IDF 설비는 따로 주어를 만들지 않고 BIM 설비의 id 로 나간다(같은 공조기가 두 id 가 되지 않는다).
    const ahu = edited.hvac!.equipment.find((e) => e.name === 'AHU 1')!
    expect(ahu.bimId).toBe(AHU)
    expect(exportOf(edited).ttl.entities.some((e) => e.key === ahu.id)).toBe(false)
  })
})

describe('S3 — 물리존 ∩ 공조존 교집합 질의 (기하를 문자열로만 저장하면 불가)', () => {
  it('GeoJSON 만 읽어 물리존과 공조존의 겹친 넓이를 구할 수 있고, 그 답이 TTL 의 hasPart 와 맞는다', () => {
    const x = exportOf(pristine)
    const ring = (f: ReadFeature) => (f.geometry!.coordinates as number[][][])[0].map((p) => [p[0], p[1]] as Vec2)
    const office = ring(feature(x, OFFICE))
    const share = (zone: string) => overlapArea(office, ring(feature(x, zone)))! / overlapArea(office, office)!
    // 사무실(10×8)은 OFFICE 존이 전부 덮고, STORE 존과는 겹치지 않는다.
    expect(share('Z_1F_OFFICE')).toBeCloseTo(1, 6)
    expect(share('Z_1F_STORE')).toBeCloseTo(0, 6)
    expect(entity(x, 'Z_1F_OFFICE').parts).toEqual([OFFICE])
    expect(entity(x, 'Z_1F_STORE').parts).toEqual([])
    // 기하는 GeoJSON 의 좌표 배열이고 TTL 에는 없다 — WKT 문자열이면 위 연산을 할 수 없다.
    expect(feature(x, 'Z_1F_OFFICE').geometry!.type).toBe('Polygon')
    expect(x.ttlText).not.toMatch(/POLYGON|wkt|asWKT|coordinates/i)
  })
})

describe('S4 — 계산·추정 관계의 출처(BIM/계산/사전/사람/외부)를 소비 시스템이 구별', () => {
  it('설비 소속은 GeoJSON spaceSource 가 BIM·계산을 가른다 — TTL hasLocation 은 같은 방이라 가를 수 없다', () => {
    const x = exportOf(edited)
    // 조명은 BIM 이 사무실에 담았다(IfcRelContainedInSpatialStructure). 토출구는 좌표로 판정했다.
    expect(feature(x, '0MEP$Equip$LGT01$000').properties.spaceSource).toBe('bim')
    expect(feature(x, '0MEP$Equip$AT01$0000').properties.spaceSource).toBe('calc')
    // 사람이 옮긴 공조기·더한 감지기도 좌표로 다시 판정한 계산이다. 좌표 없는 센서는 방이 없어 null.
    expect(feature(x, AHU).properties.spaceSource).toBe('calc')
    expect(feature(x, added).properties.spaceSource).toBe('calc')
    expect(feature(x, '0MEP$Equip$SEN01$000').properties.spaceSource).toBeNull()
    // TTL 은 BIM 소속(조명)과 계산한 소속(커스텀존 밖의 토출구 AT02)이 같은 hasLocation 이다. 출처를 가르는 자리는 GeoJSON 뿐이다.
    expect(entity(x, '0MEP$Equip$LGT01$000').locations).toEqual([OFFICE])
    expect(entity(x, '0MEP$Equip$AT02$0000').locations).toEqual([OFFICE])
    for (const f of x.features.filter((f) => f.properties.kind === 'equipment' && f.properties.spaceId))
      expect(['bim', 'calc'], f.id).toContain(f.properties.spaceSource)
  })

  it('사람이 만든 것(U_)·IDF 에서 온 것(Z_·I_, source IDF)은 id 와 속성으로 갈린다', () => {
    const x = exportOf(edited)
    expect(feature(x, 'Z_1F_OFFICE').properties.source).toBe('IDF')
    expect(x.ttl.entities.filter((e) => e.key.startsWith('I_')).length).toBeGreaterThan(0)
    expect(x.ttl.entities.filter((e) => e.key.startsWith('U_')).map((e) => e.key).sort()).toEqual([added, zoneId].sort())
  })

  it('문이 잇는 방·외벽 여부도 BIM·계산을 가른다 (two-rooms)', () => {
    const x = exportOf(importIfc(api, fixture('two-rooms.ifc')))
    const doors = x.features.filter((f) => f.properties.kind === 'door')
    const walls = x.features.filter((f) => f.properties.kind === 'wall')
    expect(doors.length).toBeGreaterThan(0)
    expect(walls.length).toBeGreaterThan(0)
    for (const d of doors) expect(d.properties).toHaveProperty('connectsSource')
    for (const w of walls) expect([null, 'bim', 'calc']).toContain(w.properties.externalSource)
    expect(walls.some((w) => w.properties.externalSource !== null)).toBe(true)
  })
})

describe('S5 — 기존 SR 온톨로지(설비·관제점, 기하 없음)와 BIM 기하를 합칠 때 ID 기준 규칙', () => {
  // 어느 쪽 ID 를 기준으로 삼을지(매핑 규칙)는 D5 로 열려 있다. 여기서는 그 전제 — 두 ID 체계가 섞여도 서로를 덮지 않는다 — 를 잰다.
  it('우리 id 는 하이픈이 없는 글자만 써서 SR 이름(ex:1-AHU-101)과 겹칠 수 없고, 두 TTL 을 이어 읽어도 주어가 합쳐지지 않는다', () => {
    const x = exportOf(edited)
    for (const e of [...x.ttl.entities, ...x.ttl.unread]) expect(e.key, e.key).toMatch(/^[0-9A-Za-z_$]+$/)
    const sr = [
      'ex:1-AHU-101 a brick:Air_Handling_Unit ;',
      '    rdfs:label "1-AHU-101" ;',
      '    brick:feeds ex:1-VAV-101 ;',
      '    brick:hasPoint ex:1-AHU-101-SAT .',
      '',
      'ex:1-VAV-101 a brick:Variable_Air_Volume_Box ;',
      '    rdfs:label "1-VAV-101" .',
      '',
    ].join('\n')
    const both = readOntologyTTL(`${x.ttlText}\n\n${sr}`)
    expect(both.entities.length).toBe(x.ttl.entities.length + 2)
    expect(new Set(both.entities.map((e) => e.key)).size).toBe(both.entities.length)
    // 같은 공조기가 두 주어로 남는다(우리 AHU-1 과 SR 의 1-AHU-101). 하나로 합치는 규칙이 D5 다.
    expect(both.entities.filter((e) => e.cls === 'Air_Handling_Unit').map((e) => e.key).sort()).toEqual([AHU, '1-AHU-101'].sort())
  })
})

describe('S6 — 층 단위 잠금·임시 저장·버전 히스토리가 저장 위치와 무관하게 동작', () => {
  // 앱의 임시 저장(브라우저 저장소)과 [편집 저장] 파일은 같은 편집 파일(JSON 문자열)이다. 문자열 하나라 어디에 두든(파일·서버·DB)
  // 같은 결과로 돌아온다. 잠금과 버전 히스토리는 서버가 있어야 해서 없다(D-INT) — 이슈 md 의 "남은 것".
  it('임시 저장(편집 파일 문자열)을 새로 연 원본에 얹으면 내보내는 TTL·GeoJSON 이 편집한 모델과 글자까지 같다', () => {
    const draft = JSON.stringify(exportEdits(edited, baselineOf(pristine), 'mep.ifc'))
    const file = parseEditFile(draft)
    if (typeof file === 'string') throw new Error(file)
    const reopened = withIdf(importIfc(api, fixture('mep.ifc')))
    expect(applyEdits(reopened, file).missing).toMatchObject({ equipment: 0, spaces: 0 })
    const a = exportOf(edited)
    const b = exportOf(reopened)
    expect(b.ttlText).toBe(a.ttlText)
    expect(JSON.stringify(b.features)).toBe(JSON.stringify(a.features))
  })
})

describe('S7·S8 — DT 가 그릴 형상 출력, 형상 파일과 TTL 이 같은 ID 로 조회', () => {
  beforeAll(() => {
    // GLTFExporter 는 Blob 을 FileReader 로 읽는다. node 에는 없어 채운다(read-export.test.ts 와 같다).
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
  })

  // 픽스처의 벽·문·창은 외곽선·좌표가 없어(형상 없이 손으로 쓴 IFC) 3D 에 나가지 않는다. 그 셋은 check:sample 이 Duplex 건축으로 잰다.
  it('S7: GLB·OBJ 에 물리존 판·설비가 들어가고, 각 객체 이름이 GeoJSON·TTL 의 id 다', async () => {
    for (const [name, wants] of [['mep.ifc', ['space', 'equipment']]] as const) {
      const { model, meshes } = importIfcWithMeshes(api, fixture(name))
      const scene = modelToScene(model, meshes)
      const x = exportOf(model)
      for (const r of [await read3D('a.glb', await sceneToGLB(scene)), await read3D('a.obj', new TextEncoder().encode((await sceneToOBJ(scene)).join('')).buffer as ArrayBuffer)]) {
        const ids = new Set(r.parts.map((p) => p.name))
        for (const kind of wants) {
          const of = x.features.filter((f) => f.properties.kind === kind && f.geometry)
          expect(of.length, `${name} ${kind}`).toBeGreaterThan(0)
          for (const f of of) expect(ids.has(f.id), `${name} ${kind} ${f.id}`).toBe(true)
        }
        expect(check3D(r.parts, x.floors, x.ttl), name).toEqual({ unknown: [], missing: [], misplaced: [] })
      }
    }
  })

  it('S8: 편집한 모델(옮긴 설비·더한 설비·커스텀존·공조존)도 GeoJSON 과 TTL 이 id 로 어긋남 없이 이어진다', () => {
    const x = exportOf(edited)
    expect(crossCheck(x.ttl, x.floors)).toEqual({ notInTtl: [], dangling: [], toUnread: expect.any(Number), locationMismatch: [], doorLinks: [] })
    // 지도에서 누른 설비의 방이 온톨로지의 위치와 같다 — 옮긴 공조기도.
    expect(entity(x, AHU).locations).toContain(feature(x, AHU).properties.spaceId)
  })
})
