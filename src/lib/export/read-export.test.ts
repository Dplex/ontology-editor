import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { ANCHOR_MARGIN, importIfc, importIfcWithMeshes, type MeshMap } from '../ifc/import'
import type { Mesh } from 'three'
import { isConduit, type Model, type Opening } from '../model'
import { addOpening, addWall, renameSpace } from '../edit'
import { createCustomZone } from '../custom-zone'
import { modelToGeoJSON } from './geojson'
import { modelToTTL } from './ttl'
import { readOntologyTTL, unescapeTurtle } from './read-ttl'
import { crossCheck, geojsonProblems, readGeoJSON } from './read-export'
import { check3D, EQUIPMENT_TOLERANCE, read3D } from './read-3d'
import { modelToScene, sceneToGLB, sceneToOBJ } from './mesh3d'

// 내보낸 파일을 다시 읽는 쪽(read-ttl.ts — 받는 쪽 DT 파서의 규칙을 옮긴 것, read-export.ts — 두 파일 잇기).
// 실제 BIM 으로 같은 것을 재는 묶음은 check:sample 의 "받는 쪽 규칙으로 다시 읽는가" 다.

let mep: Model
let rooms: Model
const load = (api: WebIFC.IfcAPI, name: string) =>
  importIfc(api, new Uint8Array(readFileSync(fileURLToPath(new URL(`../ifc/fixtures/${name}`, import.meta.url)))))

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  mep = load(api, 'mep.ifc')
  rooms = load(api, 'two-rooms.ifc')
}, 60_000)

const reread = (m: Model) => {
  const ttl = readOntologyTTL(modelToTTL(m))
  const floors = modelToGeoJSON(m).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
  return { ttl, floors, check: crossCheck(ttl, floors) }
}

/** 모델에서 "기기 → 기기" 흐름 쌍. 덕트·배관은 지나가기만 하고 방향을 아는 변만 탄다 — 받는 쪽은 덕트를 읽지 않는다. */
function devicePairs(model: Model): Set<string> {
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
        if (cur !== id) pairs.add(`${id}>${cur}`)
        continue
      }
      for (const n of out.get(cur) ?? []) if (!seen.has(n)) seen.add(n), stack.push(n)
    }
  }
  return pairs
}

describe('readOntologyTTL — 받는 쪽 규칙으로 읽기', () => {
  it('기기에서 기기로 가는 흐름이 덕트를 건너 전부 읽힌다', () => {
    const { ttl } = reread(mep)
    const want = devicePairs(mep)
    // 공조기 → (덕트) → 토출구.
    expect(want.size).toBe(1)
    const got = new Set(ttl.entities.flatMap((e) => e.feeds.map((t) => `${e.key}>${t}`)))
    expect([...want].filter((p) => !got.has(p))).toEqual([])
  })

  it('덕트·배관(fso:)은 주어로 읽지 않고 따로 센다', () => {
    const { ttl } = reread(mep)
    const conduits = mep.storeys.flatMap((s) => s.equipment).filter((e) => isConduit(e.role))
    expect(conduits.length).toBeGreaterThan(0)
    expect(ttl.entities.filter((e) => conduits.some((c) => c.id === e.key))).toEqual([])
    expect(ttl.unread.map((u) => u.key).sort()).toEqual(conduits.map((c) => c.id).sort())
    expect(new Set(ttl.unread.map((u) => u.cls))).toEqual(new Set(conduits.map((c) => (c.role === 'segment' ? 'fso:Segment' : 'fso:Fitting'))))
  })

  it('주어 블록 밖에 따로 적은 feeds 는 읽히지 않는다 — 예전에 흐름이 전부 사라진 모양', () => {
    const text = ['@prefix brick: <https://brickschema.org/schema/Brick#> .', '', 'ex:A a brick:Fan ;', '    rdfs:label "A" .', '', 'ex:A brick:feeds ex:B .'].join('\n')
    const { entities } = readOntologyTTL(text)
    expect(entities).toHaveLength(1)
    expect(entities[0].feeds).toEqual([])
  })

  it('$ 든 GUID 와 따옴표·역슬래시·줄바꿈 든 이름을 우리 값 그대로 돌려준다', () => {
    const m = structuredClone(rooms)
    const space = m.storeys[0].spaces[0]
    space.id = '2h405XijT83A$BX7w5ki4x'
    const name = '회의실 "A"\\B\r\n2층'
    renameSpace(m, space.id, name)
    const { ttl } = reread(m)
    const got = ttl.entities.find((e) => e.key === space.id)
    expect(got?.label).toBe(name)
    // 층의 hasPart 도 같은 키다.
    expect(ttl.entities.find((e) => e.cls === 'Floor' && e.parts.includes(space.id))).toBeTruthy()
    expect(unescapeTurtle('a\\$b\\"c\\n')).toBe('a$b"c\n')
  })

  it('커스텀존은 Zone 주어로 읽히고, 안의 기기는 방과 존을 위치로 갖는다', () => {
    const m = structuredClone(mep)
    const storey = m.storeys.find((s) => s.equipment.some((e) => !isConduit(e.role) && e.position && e.spaceId))!
    const device = storey.equipment.find((e) => !isConduit(e.role) && e.position && e.spaceId)!
    const [x, y] = device.position!
    const zone = createCustomZone(m, storey.id, { name: '존', id: 'U_zone', footprint: [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1]] })
    expect(zone && 'id' in zone).toBe(true)
    const { ttl, check } = reread(m)
    expect(ttl.entities.find((e) => e.key === 'U_zone')?.cls).toBe('Zone')
    expect(ttl.entities.find((e) => e.key === device.id)?.locations).toEqual([device.spaceId, 'U_zone'])
    expect(check.notInTtl).toEqual([])
  })
})

describe('crossCheck — 두 파일이 id 로 이어지는가', () => {
  it('우리가 낸 두 파일은 어긋남이 없다', () => {
    for (const m of [mep, rooms]) {
      const { floors, check } = reread(m)
      expect(floors.flatMap((f) => f.problems)).toEqual([])
      expect(check).toMatchObject({ notInTtl: [], dangling: [], locationMismatch: [], doorLinks: [] })
    }
    // 계통이 덕트·배관을 hasPart 로 묶는다. 받는 쪽은 그 덕트를 읽지 않으니 "읽지 않는 것을 가리킴" 으로 센다(일부러다).
    expect(reread(mep).check.toUnread).toBeGreaterThan(0)
  })

  it('한쪽에서 빠진 주어·다른 소속을 잡는다', () => {
    const ttlText = modelToTTL(mep)
    const device = mep.storeys.flatMap((s) => s.equipment).find((e) => !isConduit(e.role) && e.spaceId)!
    const floors = modelToGeoJSON(mep).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
    // TTL 에서 그 기기 블록을 지운다 → GeoJSON 에만 있다. 방 하나도 지우면 기기의 hasLocation 이 끊긴다.
    const blocks = ttlText.split('\n\n')
    const without = (key: string) => blocks.filter((b) => !b.startsWith(`ex:${key.replace(/\$/g, '\\$')} a `)).join('\n\n')
    const missing = crossCheck(readOntologyTTL(without(device.id)), floors)
    expect(missing.notInTtl.map((x) => x.id)).toEqual([device.id])
    const noRoom = crossCheck(readOntologyTTL(without(device.spaceId!)), floors)
    expect(noRoom.dangling.some((d) => d.predicate === 'hasLocation' && d.to === device.spaceId)).toBe(true)
    expect(noRoom.notInTtl.map((x) => x.id)).toEqual([device.spaceId])
    // GeoJSON 의 소속을 다른 방으로 바꾸면 지도와 온톨로지가 다른 말을 한다.
    const moved = floors.map((f) => ({ ...f, features: f.features.map((x) => (x.id === device.id ? { ...x, properties: { ...x.properties, spaceId: 'elsewhere' } } : x)) }))
    expect(crossCheck(readOntologyTTL(ttlText), moved).locationMismatch.map((x) => x.id)).toEqual([device.id])
  })

  it('문이 잇는 방이 TTL 에 없으면 잡는다', () => {
    // 손으로 그린 벽에 문을 뚫어 두 방(회의실·바깥)이 아니라 방 하나와 잇는다. 그 방 id 를 GeoJSON 에서 모르는 id 로 바꾼다.
    const m = structuredClone(rooms)
    const first = m.storeys[0]
    addWall(m, first.id, [6, 1], [6, 4], 0.2)
    addOpening(m, first.id, 'door', [6, 2.5])
    const { ttl, floors, check } = reread(m)
    expect(check.doorLinks).toEqual([])
    const door = floors.flatMap((f) => f.features).find((f) => f.properties.kind === 'door' && Array.isArray(f.properties.connects) && (f.properties.connects as string[]).length)!
    const broken = floors.map((f) => ({ ...f, features: f.features.map((x) => (x.id === door.id ? { ...x, properties: { ...x.properties, connects: ['nowhere'] } } : x)) }))
    expect(crossCheck(ttl, broken).doorLinks).toEqual([{ id: door.id, to: 'nowhere' }])
  })

  it('GeoJSON 모양 문제를 말한다 — 닫히지 않은 고리, 겹친 id, JSON 이 아닌 파일', () => {
    const open = { type: 'Feature', id: 'a', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } }
    expect(geojsonProblems({ type: 'FeatureCollection', features: [open, { ...open, geometry: null }] })).toEqual(['a: Polygon 좌표 모양', 'a: id 겹침'])
    expect(readGeoJSON('x.geojson', '{').problems[0]).toMatch(/^JSON 이 아니다/)
  })
})

describe('read3D·check3D — 3D 형상(GLB·OBJ)이 GeoJSON 과 같은 id·같은 자리인가', () => {
  let meshes: MeshMap
  let model: Model
  beforeAll(async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    ;({ model, meshes } = importIfcWithMeshes(api, new Uint8Array(readFileSync(fileURLToPath(new URL('../ifc/fixtures/mep.ifc', import.meta.url))))))
    // GLTFExporter 는 Blob 을 FileReader 로 읽는다. node 에는 없어 여기서만 채운다(mesh3d.test.ts 와 같다).
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
  }, 60_000)

  const both = async (scene: ReturnType<typeof modelToScene>) => [
    await read3D('a.glb', await sceneToGLB(scene)),
    await read3D('a.obj', new TextEncoder().encode((await sceneToOBJ(scene)).join('')).buffer as ArrayBuffer),
  ]
  const floorsOf = (m: Model) => modelToGeoJSON(m).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))

  it('우리가 낸 GLB·OBJ 는 GeoJSON·TTL 과 어긋남이 없고, 두 형식이 같은 객체·삼각형을 담는다', async () => {
    const [glb, obj] = await both(modelToScene(model, meshes))
    for (const r of [glb, obj]) expect(check3D(r.parts, floorsOf(model), readOntologyTTL(modelToTTL(model)))).toEqual({ unknown: [], missing: [], misplaced: [] })
    const shape = (r: Awaited<ReturnType<typeof read3D>>) => r.parts.map((p) => `${p.name}:${p.triangles}`).sort()
    expect(shape(obj)).toEqual(shape(glb))
    // GLB 만 extras(종류)를 싣는다. OBJ 는 이름 칸 하나뿐이다.
    expect(glb.parts.every((p) => p.kind)).toBe(true)
    expect(obj.parts.every((p) => p.kind === null)).toBe(true)
  })

  it('빠진 객체·옮겨진 객체·모르는 이름을 잡는다', async () => {
    const scene = modelToScene(model, meshes)
    const device = model.storeys.flatMap((s) => s.equipment).find((e) => !isConduit(e.role) && e.position)!
    const space = model.storeys.flatMap((s) => s.spaces).find((s) => s.footprint.length >= 3)!
    // 설비 하나를 빼고, 방 판 하나를 three 좌표 x 로 2m 옮긴다(IFC 평면에서도 x 로 2m).
    const gone = scene.getObjectByName(device.id)!
    gone.parent!.remove(gone)
    ;(scene.getObjectByName(space.id) as Mesh).geometry.translate(2, 0, 0)
    const [glb] = await both(scene)
    glb.parts.push({ ...glb.parts[0], id: 'nowhere', name: 'nowhere' })
    const c = check3D(glb.parts, floorsOf(model), readOntologyTTL(modelToTTL(model)))
    expect(c.missing.map((x) => x.id)).toEqual([device.id])
    expect(c.misplaced.map((x) => [x.id, Math.round(x.by)])).toEqual([[space.id, 2]])
    expect(c.unknown).toEqual(['nowhere'])
  })

  it('설비 허용치는 임포터의 배치점 보정 기준과 같다', () => {
    expect(EQUIPMENT_TOLERANCE).toBe(ANCHOR_MARGIN)
  })
})
