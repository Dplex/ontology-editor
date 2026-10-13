import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import type { Mesh, MeshStandardMaterial } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes, type MeshMap } from '../ifc/import'
import type { Model } from '../model'
import { modelToGeoJSON } from './geojson'
import { modelToScene, sceneToGLB } from './mesh3d'
import { readFbxUserProps } from './fbx-props'
import { check3D, read3D } from './read-3d'
import { readGeoJSON } from './read-export'
import { readOntologyTTL } from './read-ttl'
import { modelToTTL } from './ttl'

// 내보낸 파일 뷰어가 FBX 를 읽는다(OE-INT-03, src/server/fbx.ts). 형상은 FBXLoader, 사용자 속성은 fbx-props.ts 다.
//
// fixtures/mep.fbx 는 ../ifc/fixtures/mep.ifc 를 에디터의 GLB 로 내고 scripts/glb2fbx.py 로 바꾼 것이다. 내보내기(mesh3d.ts·glb2fbx.py)를
// 바꿔 아래 비교가 깨지면 다시 만든다: GLB 를 내려받아
//   blender -b --factory-startup --python-exit-code 1 --python scripts/glb2fbx.py -- mep.glb src/lib/export/fixtures/mep.fbx
// Blender 를 거친 실제 변환은 src/server/fbx.test.ts 가 잰다. 여기는 Blender 없이도 돈다.
const fbx = () => {
  const b = readFileSync(fileURLToPath(new URL('./fixtures/mep.fbx', import.meta.url)))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** 시험용 FBX 바이너리 작성기. 노드 하나 = [이름, 속성, 자식]. 속성은 S(문자열)·I·D·L 과 배열 d 만 쓴다. */
type Node = [string, (string | number | bigint | Float64Array)[], Node[]]
function writeFbx(version: number, nodes: Node[]): ArrayBuffer {
  const wide = version >= 7500
  const W = wide ? 8 : 4
  const parts: number[] = []
  const u8 = (n: number) => parts.push(n & 0xff)
  const u32 = (n: number) => [0, 8, 16, 24].forEach((s) => u8(n >>> s))
  const word = (n: number) => (wide ? (u32(n), u32(0)) : u32(n))
  const bytes = (b: Uint8Array) => b.forEach(u8)
  const prop = (p: Node[1][number]) => {
    if (typeof p === 'string') {
      const b = new TextEncoder().encode(p)
      u8(83), u32(b.length), bytes(b)
    } else if (typeof p === 'bigint') {
      u8(76), bytes(new Uint8Array(new BigInt64Array([p]).buffer))
    } else if (p instanceof Float64Array) {
      u8(100), u32(p.length), u32(0), u32(p.byteLength), bytes(new Uint8Array(p.buffer))
    } else if (Number.isInteger(p)) {
      u8(73), bytes(new Uint8Array(new Int32Array([p]).buffer))
    } else {
      u8(68), bytes(new Uint8Array(new Float64Array([p]).buffer))
    }
  }
  const node = ([name, props, children]: Node) => {
    const start = parts.length
    word(0), word(props.length), word(0), u8(name.length), bytes(new TextEncoder().encode(name))
    const propsAt = parts.length
    props.forEach(prop)
    const listLen = parts.length - propsAt
    children.forEach(node)
    if (children.length) for (let i = 0; i < 3 * W + 1; i++) u8(0)
    const end = parts.length
    // 끝 위치(파일 처음부터)와 속성 목록 길이를 채운다.
    const put = (at: number, n: number) => [0, 8, 16, 24].forEach((s, i) => (parts[at + i] = (n >>> s) & 0xff))
    put(start, end)
    put(start + 2 * W, listLen)
  }
  bytes(new TextEncoder().encode('Kaydara FBX Binary  \0\x1a\0'))
  u32(version)
  nodes.forEach(node)
  for (let i = 0; i < 3 * W + 1; i++) u8(0)
  return new Uint8Array(parts).buffer
}

describe('FBX 사용자 속성 읽기', () => {
  it('U 플래그가 든 P 줄만, 값이 하나인 것만 읽고, 7400·7500(8바이트 머리) 둘 다 읽는다', () => {
    const model: Node = [
      'Model',
      [1n, 'Duct 1\0\x01Model', 'Mesh'],
      [
        ['Version', [232], []],
        [
          'Properties70',
          [],
          [
            ['P', ['Lcl Translation', 'Lcl Translation', '', 'A', 1, 2, 3], []],
            ['P', ['DefaultAttributeIndex', 'int', 'Integer', '', 0], []],
            ['P', ['kind', 'KString', '', 'A+U', 'equipment'], []],
            ['P', ['elevation', 'double', 'Number', 'A+U', -24.9], []],
            ['P', ['placeholder', 'int', 'Integer', 'A+U', 1], []],
            ['P', ['big', 'KTime', 'Time', 'U', 46186158000n], []],
          ],
        ],
      ],
    ]
    const geometry: Node = ['Geometry', [2n, 'g\0\x01Geometry', 'Mesh'], [['Vertices', [new Float64Array([0, 1, 2])], []]]]
    for (const version of [7400, 7500]) {
      const props = readFbxUserProps(writeFbx(version, [['FBXHeaderExtension', [], [['FBXVersion', [version], []]]], ['Objects', [], [geometry, model]]]))
      // 이름은 FBXLoader 처럼 첫 \0 에서 자르고 공백을 _ 로 거른다(PropertyBinding.sanitizeNodeName).
      expect([...props.keys()], String(version)).toEqual(['Duct_1'])
      expect(props.get('Duct_1'), String(version)).toEqual({ kind: 'equipment', elevation: -24.9, placeholder: 1, big: 46186158000 })
    }
  })

  it('FBX 바이너리가 아니면 빈 표다(ASCII FBX·GLB·깨진 파일)', () => {
    expect(readFbxUserProps(new TextEncoder().encode('; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n}').buffer as ArrayBuffer).size).toBe(0)
    expect(readFbxUserProps(new TextEncoder().encode('glTF').buffer as ArrayBuffer).size).toBe(0)
    expect(readFbxUserProps(new ArrayBuffer(0)).size).toBe(0)
  })
})

describe('read3D·check3D — 에디터가 낸 FBX', () => {
  let model: Model
  let meshes: MeshMap
  beforeAll(async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    ;({ model, meshes } = importIfcWithMeshes(api, new Uint8Array(readFileSync(fileURLToPath(new URL('../ifc/fixtures/mep.ifc', import.meta.url))))))
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

  it('GLB 와 같은 객체·삼각형·종류·속성을 읽고, GeoJSON·TTL 과 어긋남이 없다', async () => {
    const glb = await read3D('mep.glb', await sceneToGLB(modelToScene(model, meshes)))
    const got = await read3D('mep.fbx', fbx())
    expect(got.format).toBe('fbx')
    const row = (r: typeof got) =>
      r.parts.map((p) => ({ id: p.id, triangles: p.triangles, kind: p.kind, label: p.label })).sort((a, b) => a.id.localeCompare(b.id))
    expect(row(got)).toEqual(row(glb))
    // FBX 사용자 속성에는 bool 이 없다. GLB 의 true 가 1 로 온다(glb2fbx.py).
    const fromGlb = new Map(glb.parts.map((p) => [p.id, Object.fromEntries(Object.entries(p.props).map(([k, v]) => [k, typeof v === 'boolean' ? Number(v) : v]))]))
    for (const p of got.parts) expect(p.props, p.id).toEqual(fromGlb.get(p.id))
    const floors = modelToGeoJSON(model).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
    expect(check3D(got.parts, floors, readOntologyTTL(modelToTTL(model)))).toEqual({ unknown: [], missing: [], misplaced: [], kindMismatch: [] })
  })

  it('색이 GLB 와 같다 — FBX 에 sRGB 로 적혀, 읽는 쪽이 sRGB 로 읽어도 어두워지지 않는다', async () => {
    const colorOf = async (name: string, data: ArrayBuffer) => {
      const out = new Map<string, number[]>()
      ;(await read3D(name, data)).scene.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) out.set(m.name, (m.material as MeshStandardMaterial).color.toArray())
      })
      return out
    }
    const glb = await colorOf('mep.glb', await sceneToGLB(modelToScene(model, meshes)))
    const got = await colorOf('mep.fbx', fbx())
    expect(got.size).toBe(glb.size)
    for (const [id, c] of glb) for (let i = 0; i < 3; i++) expect(Math.abs(got.get(id)![i] - c[i]), `${id} ${i}`).toBeLessThan(1 / 255)
  })

  it('3D 의 kind 가 GeoJSON 과 다르면 종류 어긋남으로 센다', async () => {
    const got = await read3D('mep.fbx', fbx())
    const duct = got.parts.find((p) => p.props.ifcClass === 'DuctSegment')!
    duct.kind = 'wall'
    const floors = modelToGeoJSON(model).map((f) => readGeoJSON(f.fileName, JSON.stringify(f.collection)))
    expect(check3D(got.parts, floors, null).kindMismatch).toEqual([{ id: duct.id, kind3d: 'wall', kind: 'equipment' }])
  })
})
