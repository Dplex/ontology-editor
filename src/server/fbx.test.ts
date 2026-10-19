import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Box3, type Mesh, type Object3D } from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as WebIFC from 'web-ifc'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes } from '../lib/ifc/import'
import type { Vec2 } from '../lib/model'
import { modelToScene, sceneToGLB } from '../lib/export/mesh3d'
import { fbxConverter } from './fbx'

// FBX 내보내기(OE-INT-03, src/server/fbx.ts). 실제 Blender 로 GLB → FBX 를 돌려, 받는 쪽(Unity)이 볼 것 — 이름·삼각형·자리·사용자 속성 — 이
// GLB 와 같은지 잰다. Blender 가 없는 PC 에서는 까닭을 찍고 건너뛴다(BLENDER 환경변수 또는 PATH).
const BLENDER = process.env.BLENDER ?? 'blender'
const have = spawnSync(BLENDER, ['-b', '--factory-startup', '--version']).status === 0
if (!have) console.log(`!! ${BLENDER} 가 없어 FBX 변환 시험을 건너뜁니다 — Blender 4.5 LTS 를 깔거나 BLENDER 로 경로를 줍니다`)

function serve(handle: ReturnType<typeof fbxConverter>): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => handle(req, res))
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () => {
      const a = server.address()
      r({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/` })
    }),
  )
}

/** 메시마다 삼각형 수와 세계 좌표 범위. */
function meshesOf(root: Object3D) {
  root.updateMatrixWorld(true)
  const out = new Map<string, { triangles: number; box: Box3 }>()
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    out.set(m.name, { triangles: (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3, box: new Box3().setFromObject(m) })
  })
  return out
}

describe.skipIf(!have)('FBX 내보내기 — Blender 변환', () => {
  let glb: ArrayBuffer
  let server: Server
  let url: string
  let tmp: string

  beforeAll(async () => {
    // GLTFExporter 는 Blob 을 FileReader 로 읽는다. node 에는 없어 시험에서만 채운다(mesh3d.test.ts 와 같다).
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
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../lib/ifc/fixtures/mep.ifc', import.meta.url))))
    const { model, meshes } = importIfcWithMeshes(api, bytes)
    // 공조존·커스텀존 판(ADR-0073)도 실어 사용자 속성이 남는지 본다.
    const s = model.storeys[0]
    const sq: Vec2[] = [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]]
    s.hvacZones = [{ id: 'U_hz', name: '공조존 1', storeyId: s.id, footprint: [sq], areaM2: 9, declaredAreaM2: null, spaceIds: [], source: 'edit', drawn: true }]
    s.customZones = [{ id: 'U_cz', name: '임원석', footprint: sq }]
    glb = await sceneToGLB(modelToScene(model, meshes))
    ;({ server, url } = await serve(fbxConverter({ blender: BLENDER, script: fileURLToPath(new URL('../../scripts/glb2fbx.py', import.meta.url)) })))
    tmp = mkdtempSync(join(tmpdir(), 'fbx-test-'))
  }, 60_000)
  afterAll(() => {
    server?.close()
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  })

  it('GET 은 Blender 가 있다고 답한다', async () => {
    const r = await (await fetch(url)).json()
    expect(r).toMatchObject({ enabled: true })
    expect(r.version).toMatch(/^\d+\.\d+/)
  })

  it('GLB 를 FBX 로 바꾸고, 메시 이름·삼각형 수·자리(y 위, 미터)가 GLB 와 같다', async () => {
    const r = await fetch(url, { method: 'POST', body: glb })
    expect(r.status).toBe(200)
    const fbx = await r.arrayBuffer()
    expect(new TextDecoder().decode(new Uint8Array(fbx, 0, 18))).toBe('Kaydara FBX Binary')
    writeFileSync(join(tmp, 'out.fbx'), new Uint8Array(fbx))

    const want = meshesOf((await new GLTFLoader().parseAsync(glb, '')).scene)
    const root = new FBXLoader().parse(fbx, '')
    const got = meshesOf(root)
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort())
    for (const [name, w] of want) {
      const g = got.get(name)!
      expect(g.triangles, name).toBe(w.triangles)
      // 노드 변환이 하나라도 남으면(축 회전·cm 크기) 범위가 어긋난다.
      expect(g.box.min.distanceTo(w.box.min), name).toBeLessThan(1e-4)
      expect(g.box.max.distanceTo(w.box.max), name).toBeLessThan(1e-4)
    }
    // 1 단위 = 1m(100cm). Unity 의 "Convert Units" 가 크기 1 로 읽는다.
    expect(root.userData.unitScaleFactor).toBe(100)
  }, 120_000)

  it('GLB extras 가 FBX 사용자 속성으로 남고, 건물은 층마다 buildingId 로 내린다', () => {
    // FBXLoader 는 사용자 속성을 버린다. Blender 로 다시 읽어 본다(Unity 의 OnPostprocessGameObjectWithUserProperties 가 받는 값).
    const dump = spawnSync(BLENDER, [
      '-b', '--factory-startup', '--python-expr',
      `import bpy, json
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=${JSON.stringify(join(tmp, 'out.fbx'))}, use_custom_props=True)
print('PROPS ' + json.dumps({o.name: dict(parent=o.parent.name if o.parent else None, **{k: o[k] for k in o.keys()}) for o in bpy.data.objects}))`,
    ])
    const props = JSON.parse(/PROPS (.*)/.exec(dump.stdout.toString())![1]) as Record<string, Record<string, unknown>>
    const duct = Object.values(props).find((p) => p.kind === 'equipment' && p.ifcClass === 'DuctSegment')!
    expect(duct).toMatchObject({ id: expect.any(String), name: 'DUCT-01', role: 'segment', systemId: expect.any(String), placeholder: 1 })
    const storeys = Object.values(props).filter((p) => p.kind === 'storey')
    expect(storeys.length).toBeGreaterThan(0)
    // 층이 맨 위다. 건물 노드는 없다(두 단 계층에서 Blender 가 메시에 회전·크기를 남겼다 — glb2fbx.py).
    for (const s of storeys) expect(s).toMatchObject({ parent: null, buildingId: expect.any(String), schema: 'IFC4' })
    expect(Object.values(props).filter((p) => p.kind === 'building')).toHaveLength(0)
    expect(storeys.map((s) => s.id)).toContain(duct.parent)
    expect(Object.values(props).find((p) => p.id === 'U_hz')).toMatchObject({ kind: 'hvacZone', name: '공조존 1', source: 'edit' })
    expect(Object.values(props).find((p) => p.id === 'U_cz')).toMatchObject({ kind: 'customZone', name: '임원석' })
  }, 60_000)

  it('GLB 가 아니거나 비면 400 이다', async () => {
    expect((await fetch(url, { method: 'POST', body: 'ISO-10303-21;' })).status).toBe(400)
    expect((await fetch(url, { method: 'POST', body: '' })).status).toBe(400)
    expect((await fetch(url, { method: 'PUT', body: glb })).status).toBe(405)
  })
})

describe('FBX 내보내기 — Blender 가 없는 서버', () => {
  it('GET 은 enabled:false 와 까닭을, POST 는 503 을 준다', async () => {
    const { server, url } = await serve(fbxConverter({ blender: '/없는/blender' }))
    try {
      const r = await (await fetch(url)).json()
      expect(r).toMatchObject({ enabled: false, reason: expect.stringContaining('Blender') })
      const glbHead = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])
      const post = await fetch(url, { method: 'POST', body: glbHead })
      expect(post.status).toBe(503)
    } finally {
      server.close()
    }
  })
})
