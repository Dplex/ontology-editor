import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes, type MeshMap } from '../ifc/import'
import { BoxGeometry, type Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { toScene } from '../viewer'
import { addWall, moveOpening, moveWall, setWallLoadBearing } from '../edit'
import type { Model, Wall } from '../model'
import { modelToScene, sceneToGLB, sceneToOBJ } from './mesh3d'

let model: Model
let meshes: MeshMap

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../ifc/fixtures/mep.ifc', import.meta.url))))
  ;({ model, meshes } = importIfcWithMeshes(api, bytes))
  // GLTFExporter 는 Blob 을 FileReader 로 읽는다. node 에는 FileReader 가 없어 테스트에서만 채운다.
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

describe('3D 내보내기 — 편집', () => {
  let rooms: Model
  let roomMeshes: MeshMap
  beforeAll(async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../ifc/fixtures/two-rooms.ifc', import.meta.url))))
    rooms = importIfcWithMeshes(api, bytes).model
    // 픽스처의 벽·문에는 형상이 없다. 벽 하나와 문 하나에 외곽선·자리와 그 자리의 상자 형상을 준다.
    const storey = rooms.storeys[0]
    const wall = storey.walls[0]
    wall.footprint = [[[0, 0], [4, 0], [4, 0.2], [0, 0.2]]]
    const door = storey.openings.find((o) => o.kind === 'door')!
    door.position = [2, 0.1, storey.elevation]
    const box = (x: number, y: number, w: number, d: number) => {
      const g = new BoxGeometry(w, 2.4, d)
      g.translate(...toScene([x, y, storey.elevation + 1.2]))
      return {
        positions: new Float32Array(g.getAttribute('position').array),
        normals: new Float32Array(g.getAttribute('normal').array),
        indices: new Uint32Array(g.index!.array),
      }
    }
    roomMeshes = new Map([[wall.id, box(2, 0.1, 4, 0.2)], [door.id, box(2, 0.1, 0.9, 0.2)]])
  })

  const boxOf = (scene: ReturnType<typeof modelToScene>, id: string) => {
    const mesh = scene.getObjectByName(id) as Mesh | undefined
    if (!mesh) return null
    mesh.geometry.computeBoundingBox()
    return mesh.geometry.boundingBox!
  }

  it('옮긴 벽은 BIM 형상 대신 지금 외곽선으로 세우고, 옮긴 문·창은 옮긴 만큼 형상을 옮긴다', () => {
    const wall = rooms.storeys.flatMap((s) => s.walls).find((w) => w.footprint?.length && roomMeshes.has(w.id))
    const opening = rooms.storeys.flatMap((s) => s.openings).find((o) => o.position && roomMeshes.has(o.id))
    expect(wall).toBeTruthy()
    const pristine = structuredClone(rooms)
    const edited = structuredClone(rooms)
    // 픽스처에서 형상이 있는 벽은 내력벽뿐이다. 내력벽은 잠기므로(OE-OBJ-06) 내력 여부를 모름으로 풀고 옮긴다.
    setWallLoadBearing(edited, wall!.id, null)
    expect(moveWall(edited, wall!.id, [2, 0])).toBe(true)
    const before = boxOf(modelToScene(pristine, roomMeshes, { pristine }), wall!.id)!
    const after = boxOf(modelToScene(edited, roomMeshes, { pristine }), wall!.id)!
    expect(after.min.x - before.min.x).toBeCloseTo(2, 1)

    if (opening) {
      const moved = structuredClone(rooms)
      const to: [number, number] = [opening.position![0] + 1, opening.position![1]]
      if (opening.wallId) setWallLoadBearing(moved, opening.wallId, null)
      expect(moveOpening(moved, opening.id, to)).toBe(true)
      const shift = moved.storeys.flatMap((s) => s.openings).find((o) => o.id === opening.id)!.position![0] - opening.position![0]
      const a = boxOf(modelToScene(pristine, roomMeshes, { pristine }), opening.id)!
      const b = boxOf(modelToScene(moved, roomMeshes, { pristine }), opening.id)!
      expect(b.min.x - a.min.x).toBeCloseTo(shift, 3)
    }
  })

  it('더한 벽은 형상이 없어도 외곽선으로 나간다', () => {
    const edited = structuredClone(rooms)
    const storey = edited.storeys[0]
    const wall = addWall(edited, storey.id, [0, 0], [3, 0]) as Wall
    expect(wall).toBeTruthy()
    expect(modelToScene(edited, roomMeshes, { pristine: rooms }).getObjectByName(wall!.id)).toBeTruthy()
  })
})

describe('3D 내보내기', () => {
  it('요소 이름이 GlobalId 라 GeoJSON·TTL 과 같은 id 로 이어진다', () => {
    const names = new Set<string>()
    modelToScene(model, meshes).traverse((o) => names.add(o.name))
    for (const s of model.storeys) {
      for (const sp of s.spaces) if (sp.footprint.length >= 3) expect(names).toContain(sp.id)
      for (const e of s.equipment) if (e.position || meshes.has(e.id)) expect(names).toContain(e.id)
    }
  })

  // 요구조건 S7(OE-INT-09): DT 가 문·창도 그린다. 임포터는 문·창 형상을 버리므로 자리·크기·벽을 뚫는 방향으로 상자를 세운다.
  it('형상 없는 문·창은 자리·크기로 세운 상자로 나가고, 두께는 벽을 뚫는 방향이다', () => {
    const m = structuredClone(model)
    const s = m.storeys[0]
    // y 방향으로 놓인 벽(뚫는 방향 +x)의 문, x 방향 벽(뚫는 방향 +y)의 크기 모르는 창, 자리 모르는 문.
    s.openings = [
      { id: 'D1', kind: 'door', name: 'D1', width: 1, height: 2, wallId: null, passable: true, position: [5, 2, 0], through: [1, 0], depth: 0.2 },
      { id: 'W1', kind: 'window', name: 'W1', width: null, height: null, wallId: null, passable: false, position: [3, 8, 1], through: [0, 1], depth: 0.3 },
      { id: 'D2', kind: 'door', name: 'D2', width: 1, height: 2, wallId: null, passable: true, position: null },
    ]
    const found = new Map<string, Mesh>()
    modelToScene(m, meshes).traverse((o) => {
      if (['D1', 'W1', 'D2'].includes(o.name)) found.set(o.name, o as Mesh)
    })
    expect([...found.keys()].sort()).toEqual(['D1', 'W1'])
    // three 의 경계 상자를 IFC 평면으로 되돌린다: three (x, y, z) = IFC (x, z, -y).
    const ifcBox = (mesh: Mesh) => {
      mesh.geometry.computeBoundingBox()
      const { min, max } = mesh.geometry.boundingBox!
      return { x: [+min.x.toFixed(6), +max.x.toFixed(6)], y: [+(-max.z).toFixed(6), +(-min.z).toFixed(6)], z: [+min.y.toFixed(6), +max.y.toFixed(6)] }
    }
    expect(ifcBox(found.get('D1')!)).toEqual({ x: [4.9, 5.1], y: [1.5, 2.5], z: [0, 2] })
    // 크기를 모르면 창 1×1m 자리 표시이고 placeholder 를 단다. 두께는 BIM 형상에서 잰 0.3m.
    expect(ifcBox(found.get('W1')!)).toEqual({ x: [2.5, 3.5], y: [7.85, 8.15], z: [1, 2] })
    expect(found.get('W1')!.userData).toMatchObject({ kind: 'window', placeholder: true })
    expect(found.get('D1')!.userData.placeholder).toBeUndefined()
  })

  it('좌표가 없는 설비는 넣지 않는다', () => {
    // 원점에 상자를 두면 거기 있는 것처럼 읽힌다.
    const lost = model.storeys.flatMap((s) => s.equipment).filter((e) => !e.position && !meshes.has(e.id))
    expect(lost.length).toBeGreaterThan(0)
    const names = new Set<string>()
    modelToScene(model, meshes).traverse((o) => names.add(o.name))
    for (const e of lost) expect(names).not.toContain(e.id)
  })

  it('OBJ 와 GLB 가 나온다', async () => {
    const scene = modelToScene(model, meshes)
    const obj = (await sceneToOBJ(scene)).join('')
    expect(obj).toMatch(/^o /m)
    // 면이 가리키는 꼭짓점은 전부 있다(1부터, 파일 전체에서 이어 센다).
    const vertices = obj.match(/^v /gm)!.length
    const refs = [...obj.matchAll(/^f (\d+)\/\/\d+ (\d+)\/\/\d+ (\d+)\/\/\d+$/gm)].flatMap((m) => [+m[1], +m[2], +m[3]])
    expect(refs.length).toBe(obj.match(/^f /gm)!.length * 3)
    expect(Math.min(...refs)).toBe(1)
    expect(Math.max(...refs)).toBe(vertices)
    let sceneVertices = 0
    scene.traverse((o) => void (sceneVertices += (o as Mesh).geometry?.getAttribute('position').count ?? 0))
    expect(vertices).toBe(sceneVertices)
    const glb = await sceneToGLB(scene)
    expect(new TextDecoder().decode(new Uint8Array(glb, 0, 4))).toBe('glTF')
    // 되읽으면 같은 이름·같은 꼭짓점 수에 extras(userData)가 남는다.
    const back = await new GLTFLoader().parseAsync(glb, '')
    const meshesOf = (root: Object3D) => {
      const out = new Map<string, { count: number; kind: unknown }>()
      root.traverse((o) => {
        if ((o as Mesh).isMesh) out.set(o.name, { count: (o as Mesh).geometry.getAttribute('position').count, kind: o.userData.kind })
      })
      return out
    }
    expect(meshesOf(back.scene)).toEqual(meshesOf(scene))
  })
})
