import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes, type MeshMap } from '../ifc/import'
import type { Model } from '../model'
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

describe('3D 내보내기', () => {
  it('요소 이름이 GlobalId 라 GeoJSON·TTL 과 같은 id 로 이어진다', () => {
    const names = new Set<string>()
    modelToScene(model, meshes).traverse((o) => names.add(o.name))
    for (const s of model.storeys) {
      for (const sp of s.spaces) if (sp.footprint.length >= 3) expect(names).toContain(sp.id)
      for (const e of s.equipment) if (e.position || meshes.has(e.id)) expect(names).toContain(e.id)
    }
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
    const obj = sceneToOBJ(scene)
    expect(obj).toMatch(/^o /m)
    expect(obj).toMatch(/^v /m)
    const glb = await sceneToGLB(scene)
    expect(new TextDecoder().decode(new Uint8Array(glb, 0, 4))).toBe('glTF')
  })
})
