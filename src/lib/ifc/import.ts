// IFC 파일을 중간 모델로 옮긴다. PRD #6 의 매핑표를 그대로 따른다.
//
//   IfcBuildingStorey → 층
//   IfcSpace          → 물리존
//   IfcWall           → 벽 (+ Structural 속성 → loadBearing)
//   IfcDoor/IfcWindow → 문 / 창문
//
// 읽는 방식이 두 갈래인 것에 주의한다. 층과 공간은 **분해 관계**(IfcRelAggregates)로
// 묶이고, 벽·문·창은 **포함 관계**(IfcRelContainedInSpatialStructure)로 묶인다. 같은
// "층에 속한다" 는 말인데 IFC 가 관계를 나눠 놓아서, 한쪽만 읽으면 절반이 빈다.

import * as WebIFC from 'web-ifc'
import type {
  Connection,
  Equipment,
  EquipmentRole,
  Model,
  Opening,
  Space,
  Storey,
  System,
  Vec2,
  Vec3,
  Wall,
} from '../model'
import { polygonArea } from '../model'
import { apply, compose, foldChain, foldElevation, fromAxisPlacement, type Transform2 } from './placement'
import { assignEquipmentToSpaces } from '../mapping'
import { dropDuplicateSpaces } from '../merge'
import { lengthScale } from './units'
import { connectGaps, findGaps, REACH, inferConnections } from '../topology'
import { equipmentKind, equipmentKindOf, FLUID_KINDS, omniclassCode, resolveEquipmentKind, resolveFluid, resolveRoomKind, systemKindOf, systemKindOfIfc } from '../kinds'
import { CAPACITY_KINDS, capacityRank } from '../capacity'
import { inferFlowByRules } from '../flow-rules'
import { footprintRings, meshHeight, openingPlacement, spacesBesideOpening } from './element-geometry'

/**
 * 요소 하나의 삼각형 메시. 3D 화면만 쓴다 — 모델과 내보내기에는 들어가지 않는다.
 *
 * 좌표는 **three.js 세계 좌표**(y 가 높이, 미터)로 이미 바뀌어 있다. web-ifc 가 IFC 의
 * (x, y, z) 를 (x, z, -y) 로 돌리고 단위도 미터로 맞춰서 준다. 공간 판도 같은 변환
 * (평면 (x, y) → (x, ·, -y))으로 그리므로, 여기서 한 번 더 돌리면 배관이 눕는다.
 */
/**
 * 임포트가 어디까지 왔는지. 브라우저는 임포트를 Web Worker 에서 돌리고 이 값을 받아 진행 막대를 그린다.
 * `total` 이 있으면 그 단계 안에서 몇 개 중 몇 개인지 알고, 없으면 단계 이름만 안다.
 */
export type ImportProgress = { stage: string; step: number; steps: number; done?: number; total?: number }
export type OnProgress = (p: ImportProgress) => void

/** 임포트 단계. 화면이 "3/6" 처럼 몇 번째인지 보인다. 순서를 바꾸면 여기와 read() 를 같이 고친다. */
export const IMPORT_STAGES = ['파일 여는 중', '공간·벽 읽는 중', '설비·계통 읽는 중', '형상 읽는 중', '소속·연결 계산 중', '흐름 방향 계산 중'] as const

export type ElementMesh = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/** GlobalId → 메시. 설비·배관과 벽이 같이 든다(벽은 3D 에서 내력벽을 보이는 데만 쓴다). */
export type MeshMap = Map<string, ElementMesh>

/**
 * 설비·배관의 형상을 뽑아 요소마다 한 덩어리로 합친다.
 *
 * web-ifc 는 요소 하나를 여러 조각(형상 + 배치 행렬)으로 준다. 조각마다 행렬을 미리 곱해
 * 세계 좌표로 합쳐 두면, 화면은 요소 하나를 메시 하나로 다루고(고르기·강조가 단순해진다)
 * 연결 추정도 같은 좌표를 그대로 쓴다.
 */
export function readMeshes(
  api: Api,
  model: number,
  ids: Set<number>,
  globalIdOf: (id: number) => string,
  onEach?: (done: number, total: number) => void,
): MeshMap {
  const out: MeshMap = new Map()
  if (ids.size === 0) return out
  let seen = 0

  // web-ifc 0.0.78 은 JS 래퍼와 브라우저 wasm 의 인자 수가 어긋나 있다. 래퍼는
  // StreamMeshes 에 applyLinearScalingFactor 까지 넷을 넘기는데, 이 버전의 web-ifc.wasm 은
  // 셋만 받는다("called with 4 arguments, expected 3"). node 용 wasm 은 넷을 받아서
  // 단위 테스트는 멀쩡히 통과하고 브라우저에서만 깨진다. 래퍼를 먼저 쓰고, 막히면 wasm 을
  // 직접 부른다 — 오류는 스트리밍이 시작되기 전에 나므로 메시가 겹칠 일은 없다.
  const stream = (handler: (flat: any) => void) => {
    try {
      api.StreamMeshes(model, [...ids], handler)
    } catch {
      ;(api as unknown as { wasmModule: { StreamMeshes(m: number, ids: number[], cb: (f: any) => void): void } })
        .wasmModule.StreamMeshes(model, [...ids], handler)
    }
  }

  stream((flat) => {
    // 요소 하나마다 알리면 성수(1만 8천 개)에서 메시지가 그만큼 오간다. 200개마다 한 번 알린다.
    seen++
    if (onEach && (seen % 200 === 0 || seen === ids.size)) onEach(seen, ids.size)
    const parts: { p: number[]; n: number[]; i: number[] }[] = []
    let vertexCount = 0
    let indexCount = 0
    const size = flat.geometries.size()
    for (let g = 0; g < size; g++) {
      const placed = flat.geometries.get(g)
      const geom = api.GetGeometry(model, placed.geometryExpressID)
      try {
        const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize())
        const idx = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize())
        const m = placed.flatTransformation
        const p: number[] = []
        const n: number[] = []
        // 꼭짓점 하나가 6칸이다(위치 3 + 법선 3). 위치엔 이동까지, 법선엔 회전만 곱한다.
        for (let k = 0; k + 5 < v.length; k += 6) {
          const x = v[k], y = v[k + 1], z = v[k + 2]
          p.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
          const nx = v[k + 3], ny = v[k + 4], nz = v[k + 5]
          n.push(m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz)
        }
        parts.push({ p, n, i: Array.from(idx) })
        vertexCount += p.length / 3
        indexCount += idx.length
      } finally {
        geom.delete()
      }
    }
    if (vertexCount === 0) return

    const positions = new Float32Array(vertexCount * 3)
    const normals = new Float32Array(vertexCount * 3)
    const indices = new Uint32Array(indexCount)
    let vo = 0
    let io = 0
    for (const part of parts) {
      positions.set(part.p, vo * 3)
      normals.set(part.n, vo * 3)
      for (const i of part.i) indices[io++] = i + vo
      vo += part.p.length / 3
    }
    out.set(globalIdOf(flat.expressID), { positions, normals, indices })
  })
  return out
}

/**
 * 배치점이 자기 형상에서 이만큼 넘게 떨어져 있으면 배치점을 믿지 않는다(미터).
 * 천장 설비의 삽입점이 몸체 윗면에 있는 정도는 정상이라 조금 여유를 둔다.
 */
export const ANCHOR_MARGIN = 0.5

/**
 * 배치점이 자기 형상 밖에 있는 설비는 형상의 중심을 좌표로 쓴다. 고친 대수를 돌려준다.
 *
 * **Revit 이 IFC2x3 으로 낸 덕트 구간은 `ObjectPlacement` 가 층 원점이다.** 형상은 제자리에
 * 있고 배치점만 (0, 0) 에 찍힌다. Duplex HVAC 의 구간 231개가 전부 그랬다. 이 좌표로 소속을
 * 판정하면 **원점이 든 방 하나에 231개가 조용히 몰린다** — Duplex 는 원점이 건물 모서리 밖이라
 * "미소속" 으로 끝났을 뿐, 원점이 방 안에 있는 건물이었으면 오류 없이 틀렸다.
 *
 * 좌표가 없는 설비(`null`)는 건드리지 않는다. 배치가 없는 요소의 형상은 국소 좌표 그대로라
 * 그 중심도 믿을 수 없다.
 */
export function anchorToGeometry(equipment: Equipment[], meshes: MeshMap): number {
  let fixed = 0
  for (const e of equipment) {
    const mesh = meshes.get(e.id)
    if (!e.position || !mesh || mesh.positions.length === 0) continue

    // 메시는 three.js 좌표(x, 높이, -y)다. IFC 평면으로 되돌려 잰다.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]
      const z = mesh.positions[i + 1]
      const y = -mesh.positions[i + 2]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const [px, py, pz] = e.position
    const off = Math.max(minX - px, px - maxX, minY - py, py - maxY, minZ - pz, pz - maxZ)
    if (off <= ANCHOR_MARGIN) continue

    e.position = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2]
    e.positionSource = 'geometry'
    fixed++
  }
  return fixed
}

/**
 * 벽의 평면 외곽선과 문·창의 자리를 형상에서 읽고, 문이 잇는 방을 채운다(element-geometry.ts).
 *
 * 문이 잇는 방은 BIM 의 공간 경계를 먼저 쓴다. 이건 형상이 필요 없어서 늘 읽는다. 공간 경계가 없는 문은
 * `openings` 를 켰을 때만 문 양쪽을 좌표로 짚는다. 문·창의 형상은 자리만 재고 버린다. 3D 에 그리지 않으니
 * 메모리에 둘 까닭이 없다.
 */
function placeWallsAndOpenings(
  api: Api,
  modelID: number,
  result: Model,
  wallMeshes: MeshMap,
  globalIdOf: (id: number) => string,
  idsOf: (type: number) => number[],
  openings: boolean,
): void {
  for (const storey of result.storeys) {
    for (const wall of storey.walls) {
      const mesh = wallMeshes.get(wall.id)
      if (!mesh) continue
      wall.footprint = footprintRings(mesh)
      wall.height = meshHeight(mesh)
    }
  }

  const loaded = new Set(result.storeys.flatMap((s) => s.openings.map((o) => o.id)))
  const openingIDs = openings
    ? new Set([...idsOf(WebIFC.IFCDOOR), ...idsOf(WebIFC.IFCWINDOW)].filter((id) => loaded.has(globalIdOf(id))))
    : new Set<number>()
  const openingMeshes = readMeshes(api, modelID, openingIDs, globalIdOf)
  const declared = new Map<string, string[]>()
  for (const storey of result.storeys) {
    for (const space of storey.spaces) {
      for (const el of space.boundedBy) declared.set(el, [...(declared.get(el) ?? []), space.id])
    }
  }
  for (const storey of result.storeys) {
    for (const o of storey.openings) {
      const mesh = openingMeshes.get(o.id)
      const placement = mesh ? openingPlacement(mesh) : null
      if (openings) o.position = placement?.position ?? null
      // 벽을 뚫는 방향과 두께. 문을 옮기거나 방 경계를 고친 뒤 문 양쪽 방을 다시 짚을 때 쓴다(edit.ts 의 relinkDoors).
      if (placement) {
        o.through = placement.through
        o.depth = placement.depth
      }
      if (o.kind !== 'door') continue
      const bim = declared.get(o.id)
      if (bim?.length) {
        o.connects = bim
        o.connectsSource = 'bim'
      } else if (placement) {
        o.connects = spacesBesideOpening(placement, storey.spaces)
        o.connectsSource = 'calc'
      }
    }
  }
}

/** web-ifc 의 Vector 를 평범한 배열로. 이 타입이 코드 곳곳에 번지지 않게 입구에서 바꾼다. */
function toArray(vector: { size(): number; get(i: number): number }): number[] {
  return Array.from({ length: vector.size() }, (_, i) => vector.get(i))
}

/** IFC 값은 대부분 `{ value: … }` 로 한 겹 싸여 있다. */
function val<T>(wrapped: { value?: T } | null | undefined): T | undefined {
  return wrapped?.value
}

/**
 * 숫자를 읽는다. **싸여 있을 수도 있고 아닐 수도 있다.**
 *
 * web-ifc 는 스키마에 따라 다르게 준다. IFC4 는 `IfcDirection.DirectionRatios` 를
 * `IfcReal` 객체로 감싸 주는데 **IFC2x3 은 맨 숫자 배열로 준다.** 그래서 `val` 을 걸면
 * IFC2x3 에서 전부 `undefined` 가 되고, `fromAxisPlacement` 가 기본값(회전 없음)으로
 * 떨어진다 — **오류 없이 회전만 조용히 사라진다.** Duplex 세 판본(IFC2x3)이 이 상태였다.
 *
 * 좌표(`Coordinates`)는 두 스키마 다 싸서 주지만, 한쪽만 맞춰 두면 다음에 또 같은 데
 * 걸린다. 숫자를 읽는 자리는 전부 이걸 쓴다.
 */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  const inner = (v as { value?: unknown } | null | undefined)?.value
  return typeof inner === 'number' ? inner : undefined
}

/** IFC 의 숫자 배열(좌표, 방향 비율)을 읽는다. 없으면 null. */
export function numbers(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null
  const out = raw.map(num)
  return out.some((v) => v === undefined) ? null : (out as number[])
}

/**
 * 다른 줄을 가리키는 참조를 읽는다. 없으면 null 이다.
 *
 * IFC 의 빈 값(`$`)은 속성이 **없는** 것이 아니라 **값이 null 인** 형태로 온다.
 * `attr?.value` 만 보고 `undefined` 인지 묻는 검사는 그래서 빈 값을 걸러내지 못한다.
 * 실제로 `IfcRelSpaceBoundary` 의 바깥 공기 경계가 이 형태라, 부재가 없는 경계를
 * "element-null" 이라는 가짜 id 로 읽은 적이 있다.
 */
function ref(attr: { value?: number } | null | undefined): number | null {
  const v = attr?.value
  return typeof v === 'number' ? v : null
}

type Api = InstanceType<typeof WebIFC.IfcAPI>

/** 속성 줄에서 쓰는 값만. `measure` 는 용량이 읽는 값(범위면 설정값, 없으면 위 끝)이다. */
type PropInfo = { name: string | undefined; nominal: unknown; measure: unknown }

class Reader {
  constructor(
    private api: Api,
    private model: number,
    /** 이 모델의 길이 1 이 몇 미터인가. 좌표와 길이를 읽는 자리마다 곱한다. */
    private scale: number,
  ) {}

  ids(type: number, includeInherited = false): number[] {
    return toArray(this.api.GetLineIDsWithType(this.model, type, includeInherited))
  }

  line(expressID: number): any {
    return this.api.GetLine(this.model, expressID)
  }

  /**
   * 읽지 못하는 줄이면 null. web-ifc 가 모르는 줄에서 예외를 던진다(Duplex COBie 판본의 528639 — 타입 객체의
   * Pset 을 따라가다 걸렸다). 타입 쪽은 없어도 되는 정보라 파일 전체를 멈추지 않는다.
   */
  tryLine(expressID: number): any {
    try {
      return this.line(expressID)
    } catch {
      return null
    }
  }

  /** 배치 사슬을 타고 올라가 세계 좌표 변환을 만든다. */
  placement(expressID: number | undefined): Transform2 {
    const chain: Transform2[] = []
    let cur = expressID
    // 사슬이 자기 자신을 가리키는 깨진 파일을 만나면 여기서 영원히 돈다.
    // 건물 구조가 이보다 깊을 일은 없으므로 상한을 둔다.
    for (let guard = 0; cur !== undefined && guard < 64; guard++) {
      const lp = this.line(cur)
      const rel = lp?.RelativePlacement ? this.line(lp.RelativePlacement.value) : null
      const raw = rel?.Location ? numbers(this.line(rel.Location.value).Coordinates) : null
      // 방향 벡터는 비율이라 단위와 무관하다. 위치만 환산한다.
      const loc = raw ? (raw as number[]).map((v) => v * this.scale) : null
      const dir = rel?.RefDirection ? numbers(this.line(rel.RefDirection.value).DirectionRatios) : null
      chain.push(fromAxisPlacement(loc, dir ?? null))
      cur = lp?.PlacementRelTo?.value
    }
    return foldChain(chain)
  }

  /**
   * 설비의 세계 좌표를 돌려준다. 배치가 아예 없으면 null 이다.
   *
   * IFC 에서 ObjectPlacement 가 비는 것은 드물지만 실제로 있다. 그 설비는 "어디에 있는지
   * 모르는 설비" 이지 "원점에 있는 설비" 가 아니라서, 0,0,0 으로 채우면 안 된다.
   */
  position3(entity: any): Vec3 | null {
    const root = entity?.ObjectPlacement?.value
    if (root === undefined) return null

    const zs: number[] = []
    let cur: number | undefined = root
    for (let guard = 0; cur !== undefined && guard < 64; guard++) {
      const lp = this.line(cur)
      const rel = lp?.RelativePlacement ? this.line(lp.RelativePlacement.value) : null
      const coords = rel?.Location ? numbers(this.line(rel.Location.value).Coordinates) : null
      zs.push(((coords?.[2] as number) ?? 0) * this.scale)
      cur = lp?.PlacementRelTo?.value
    }

    const flat = apply(this.placement(root), [0, 0])
    return [flat[0], flat[1], foldElevation(zs)]
  }

  private typeOfCache: Map<number, number> | null = null

  // --- 속성 ---------------------------------------------------------------------------
  //
  // 방 분류·용량·System Name·LoadBearing 이 모두 IfcRelDefinesByProperties → 속성 세트 → 속성 줄을 탄다. 넷이 따로
  // 훑던 때 병원 MEP(207MB)에서 같은 줄을 네 번씩 web-ifc 에서 꺼내느라 11초가 들었다(Revit 은 같은 속성 줄을
  // 여러 세트가 같이 쓰기도 한다). 관계는 한 번만 훑고, 속성은 쓰는 값만 뽑아 id 로 캐시한다.
  private propertyRelsCache: { objects: number[]; psetID: number | null }[] | null = null
  private readonly psetPropsCache = new Map<number, PropInfo[]>()
  private readonly propCache = new Map<number, PropInfo | null>()

  /** 속성 관계 전부. 대상 개체와 속성 세트 id. */
  propertyRels(): { objects: number[]; psetID: number | null }[] {
    if (this.propertyRelsCache) return this.propertyRelsCache
    const out: { objects: number[]; psetID: number | null }[] = []
    for (const relID of this.ids(WebIFC.IFCRELDEFINESBYPROPERTIES)) {
      const rel = this.line(relID)
      out.push({ objects: (rel?.RelatedObjects ?? []).map((h: any) => h.value), psetID: ref(rel?.RelatingPropertyDefinition) })
    }
    return (this.propertyRelsCache = out)
  }

  /** 속성 세트의 속성들. 읽지 못하는 세트·속성은 건너뛴다(tryLine 참조). */
  psetProps(psetID: number): PropInfo[] {
    const had = this.psetPropsCache.get(psetID)
    if (had) return had
    const out: PropInfo[] = []
    for (const h of this.tryLine(psetID)?.HasProperties ?? []) {
      let prop = this.propCache.get(h.value)
      if (prop === undefined) {
        const line = this.tryLine(h.value)
        prop = line
          ? {
              name: val(line.Name) as string | undefined,
              nominal: val(line.NominalValue) as unknown,
              // 범위(IfcPropertyBoundedValue)는 설정값을, 없으면 위 끝을 쓴다(용량).
              measure: val(line.NominalValue ?? line.SetPointValue ?? line.UpperBoundValue) as unknown,
            }
          : null
        this.propCache.set(h.value, prop)
      }
      if (prop) out.push(prop)
    }
    this.psetPropsCache.set(psetID, out)
    return out
  }

  /**
   * 층마다 BIM 이 적은 층 높이(OE-BIM-02). 기준 물량 `GrossHeight`·`NetHeight`(IfcElementQuantity, AC20 이 적는다)와 COBie 의
   * `Storey Height` 속성(설명이 "Floor Height" 라 바닥에서 윗층 바닥까지, gross 로 읽는다). **0 이하는 비운 칸으로 보고 읽지
   * 않는다** — Duplex COBie 판본은 네 층 모두 0.0 이다. 물량 세트는 속성 세트와 자리가 달라(`Quantities`·`LengthValue`)
   * psetProps 를 넓히지 않고 층에만 따로 읽는다 — 넓히면 설비의 용량·LoadBearing 을 찾는 자리에 물량 이름이 섞인다.
   */
  storeyHeights(): Map<number, NonNullable<Storey['declaredHeight']>> {
    const storeys = new Set(this.ids(WebIFC.IFCBUILDINGSTOREY))
    const out = new Map<number, NonNullable<Storey['declaredHeight']>>()
    const length = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v * this.scale : null)
    for (const { objects, psetID } of this.propertyRels()) {
      const targets = psetID === null ? [] : objects.filter((o) => storeys.has(o))
      if (!targets.length) continue
      const set = this.tryLine(psetID!)
      const setName = (val(set?.Name) as string) ?? ''
      const said: { gross?: [number, string]; net?: [number, string] } = {}
      for (const h of set?.Quantities ?? []) {
        const q = this.tryLine(h.value)
        const name = val(q?.Name) as string | undefined
        const v = length(val(q?.LengthValue))
        if (v === null) continue
        if (name === 'GrossHeight') said.gross = [v, `${setName}.${name}`]
        if (name === 'NetHeight') said.net = [v, `${setName}.${name}`]
      }
      for (const p of set?.HasProperties ? this.psetProps(psetID!) : []) {
        const v = p.name === 'Storey Height' ? length(p.nominal) : null
        if (v !== null && !said.gross) said.gross = [v, `${setName}.${p.name}`]
      }
      if (!said.gross && !said.net) continue
      for (const id of targets) {
        const had = out.get(id)
        out.set(id, {
          gross: had?.gross ?? said.gross?.[0] ?? null,
          net: had?.net ?? said.net?.[0] ?? null,
          property: had?.property ?? (said.gross ?? said.net)![1],
        })
      }
    }
    return out
  }

  /** 개체 → 타입 객체(IfcRelDefinesByType). */
  typeOf(): Map<number, number> {
    if (this.typeOfCache) return this.typeOfCache
    const out = new Map<number, number>()
    for (const relID of this.ids(WebIFC.IFCRELDEFINESBYTYPE)) {
      const rel = this.line(relID)
      const type = ref(rel?.RelatingType)
      if (type === null) continue
      for (const h of rel.RelatedObjects ?? []) out.set(h.value, type)
    }
    return (this.typeOfCache = out)
  }

  /**
   * 설비마다 IFC 가 말한 종류를 `클래스.PredefinedType` 으로 모은다(`AirTerminal.DIFFUSER`). 값이 없으면 `클래스` 만.
   *
   * **IFC2x3 은 개체가 아니라 타입 객체가 말한다.** 개체는 `IfcFlowTerminal` 처럼 추상적이지만 타입은
   * `IfcAirTerminalType` 이고 PredefinedType 도 거기 있다(병원 HVAC 의 DIFFUSER 231·REGISTER 184). 그래서 개체에
   * PredefinedType 자리가 없으면 타입의 클래스와 값을 쓴다. IFC4 는 개체의 값을 먼저 보고, 비었으면 타입을 본다.
   * USERDEFINED 의 실제 값은 개체면 ObjectType, 타입이면 ElementType 에 있다.
   */
  declaredType(api: Api): (id: number) => string | null {
    const typeOf = this.typeOf()

    const said = (line: any, userField: 'ObjectType' | 'ElementType'): string | null => {
      const v = val(line?.PredefinedType) as string | undefined
      if (!v || v === 'NOTDEFINED') return null
      if (v !== 'USERDEFINED') return v
      return ((val(line?.[userField]) as string) ?? '').trim() || null
    }
    const className = (line: any) => api.GetNameFromTypeCode(line.type).replace(/^Ifc/i, '')
    const join = (cls: string, value: string | null) => (value ? `${cls}.${value}` : cls)

    return (id) => {
      const el = this.line(id)
      const typeID = typeOf.get(id)
      const type = typeID === undefined ? null : this.tryLine(typeID)
      if (el && 'PredefinedType' in el) {
        return join(className(el), said(el, 'ObjectType') ?? (type ? said(type, 'ElementType') : null))
      }
      return type ? join(className(type).replace(/Type$/, ''), said(type, 'ElementType')) : null
    }
  }

  /**
   * 공간마다 OmniClass Table 13 코드(`13-15 11 34 11`)를 모은다. 방 종류를 이름 사전보다 표준 쪽에서 읽기 위해서다.
   *
   * 자리가 셋이고 앞의 것이 이긴다. 표준 분류 관계(`IfcRelAssociatesClassification` → `IfcClassificationReference`,
   * COBie 판본이 이렇다), Revit 의 `Category Code` 속성(병원·Duplex 건축 전부), Revit 의 `OmniClass Table 13 Category`
   * 속성(`13-15 11 34 11: Office`). 설비 판본의 Revit 속성은 설명만 적기도 해서(`Office`) 코드가 없으면 건너뛴다.
   */
  omniclassBySpace(): Map<number, { code: string; source: 'classification' | 'property' }> {
    const spaces = new Set(this.ids(WebIFC.IFCSPACE))
    const found = new Map<number, { code: string; rank: number }>()
    const offer = (id: number, text: unknown, rank: number) => {
      if (!spaces.has(id)) return
      const code = omniclassCode(typeof text === 'string' ? text : null)
      if (!code) return
      const had = found.get(id)
      if (!had || rank < had.rank) found.set(id, { code, rank })
    }

    for (const relID of this.ids(WebIFC.IFCRELASSOCIATESCLASSIFICATION)) {
      const rel = this.tryLine(relID)
      const ref = rel?.RelatingClassification ? this.tryLine(rel.RelatingClassification.value) : null
      if (!ref) continue
      const text = (val(ref.Identification) ?? val(ref.ItemReference) ?? val(ref.Name)) as unknown
      for (const h of rel.RelatedObjects ?? []) offer(h.value, text, 0)
    }

    const PROPERTY_RANK: Record<string, number> = { 'Category Code': 1, 'OmniClass Table 13 Category': 2 }
    for (const { objects, psetID } of this.propertyRels()) {
      const targets = objects.filter((id) => spaces.has(id))
      if (targets.length === 0 || psetID === null) continue
      for (const prop of this.psetProps(psetID)) {
        const rank = PROPERTY_RANK[prop.name as string]
        if (rank === undefined) continue
        for (const id of targets) offer(id, prop.nominal, rank)
      }
    }
    return new Map([...found].map(([id, v]) => [id, { code: v.code, source: v.rank === 0 ? ('classification' as const) : ('property' as const) }]))
  }

  /**
   * 설비별 용량 파라미터를 모은다. 어느 속성에서 왔는지도 같이 남긴다.
   *
   * 출처를 남기는 이유는 **표준 이름으로 들어오는 일이 드물기 때문이다.** 실측한 두
   * 모델에서 표준 Pset 이름은 한 건도 없었고, Duplex HVAC 은 Revit 이 붙인 `Flow` 로
   * 155건이 들어 있었다. 어느 이름이 쓰였는지 보이면 고객사와 스펙을 맞출 때 근거가 된다.
   */
  capacityByElement(): Map<number, { value: number; property: string }> {
    const out = new Map<number, { value: number; property: string }>()
    // 목록에서 앞선 이름이 이긴다. 같은 이름이면 나중에 넣은 것(개체)이 타입을 덮는다 — IFC 에서 개체의 값이 타입의
    // 값보다 앞선다.
    const offer = (objectID: number, value: number, property: string) => {
      const had = out.get(objectID)
      if (had && capacityRank(had.property) < capacityRank(property)) return
      out.set(objectID, { value, property })
    }
    const read = (psetID: number, objectIDs: number[]) => {
      for (const prop of this.psetProps(psetID)) {
        const name = prop.name as string
        if (capacityRank(name) < 0) continue
        // 범위(IfcPropertyBoundedValue)는 설정값을, 없으면 위 끝을 쓴다. 표준의 AirFlowrateRange·FlowRateRange 가 범위다.
        const value = Number(prop.measure)
        if (!Number.isFinite(value)) continue
        for (const id of objectIDs) offer(id, value, name)
      }
    }

    // 타입 객체의 Pset 을 먼저. 표준의 Pset_*TypeCommon 은 대개 여기 붙는다(Pset_FanTypeCommon.NominalAirFlowRate …).
    const objectsOfType = new Map<number, number[]>()
    for (const [objectID, typeID] of this.typeOf()) {
      const list = objectsOfType.get(typeID) ?? []
      list.push(objectID)
      objectsOfType.set(typeID, list)
    }
    for (const [typeID, objectIDs] of objectsOfType) {
      for (const h of this.tryLine(typeID)?.HasPropertySets ?? []) read(h.value, objectIDs)
    }

    for (const { objects, psetID } of this.propertyRels()) {
      if (psetID === null) continue
      read(psetID, objects)
    }
    return out
  }

  /** IfcAxis2Placement2D/3D 를 평면 변환으로. 이동량은 여기서 환산한다. */
  private axisTransform(handle: { value?: number } | null | undefined): Transform2 {
    const id = ref(handle)
    if (id === null) return fromAxisPlacement(null, null)
    const pos = this.line(id)
    const raw = pos?.Location ? numbers(this.line(pos.Location.value).Coordinates) : null
    const dir = pos?.RefDirection ? numbers(this.line(pos.RefDirection.value).DirectionRatios) : null
    return fromAxisPlacement(raw ? raw.map((v) => v * this.scale) : null, dir ?? null)
  }

  /**
   * 단면 프로파일의 바깥 고리를 프로파일 국소 좌표로 돌려준다.
   *
   * 실측에서 나온 두 가지만 다룬다. `IfcArbitraryClosedProfileDef`(폴리라인)와
   * `IfcRectangleProfileDef`(가로·세로). Duplex 의 공간 61개가 전부 이 둘이었다.
   */
  private profileRing(profileID: number | null): Vec2[] {
    if (profileID === null) return []
    const profile = this.line(profileID)
    if (!profile) return []
    // 매개변수 프로파일(사각형 등)만 Position 을 갖는다. 폴리라인 쪽은 없다.
    const t = profile.Position ? this.axisTransform(profile.Position) : fromAxisPlacement(null, null)

    const outer = ref(profile.OuterCurve)
    if (outer !== null) {
      const curve = this.line(outer)
      if (!Array.isArray(curve?.Points)) return []
      return curve.Points.map((p: any) => {
        const c = numbers(this.line(p.value).Coordinates) ?? []
        return apply(t, [c[0] * this.scale, c[1] * this.scale])
      })
    }

    const x = val(profile.XDim) as number | undefined
    const y = val(profile.YDim) as number | undefined
    if (x === undefined || y === undefined) return []
    // 사각형 프로파일은 Position 원점을 **중심**으로 놓인다. 모서리에 놓으면 방이 절반씩
    // 어긋나는데, 넓이는 맞아서 숫자만 봐서는 안 보인다.
    const hx = (x * this.scale) / 2
    const hy = (y * this.scale) / 2
    return [
      apply(t, [-hx, -hy]),
      apply(t, [hx, -hy]),
      apply(t, [hx, hy]),
      apply(t, [-hx, hy]),
      apply(t, [-hx, -hy]),
    ]
  }

  /**
   * 공간의 바닥 외곽선을 세계 좌표 고리로 돌려준다.
   *
   * **저작 도구마다 다른 표현에 넣는다.** ArchiCAD 는 `FootPrint` 에 폴리라인을 따로
   * 내보내지만, **Revit 은 FootPrint 를 아예 안 만들고 `Body/SweptSolid` 만 낸다.**
   * FootPrint 만 읽던 시절 Duplex 세 판본(Revit)의 공간 85개가 전부 외곽선 0 이었고,
   * 그래서 3D 에 방이 한 칸도 안 그려지고 설비 소속 판정도 못 돌았다.
   *
   * 다행히 SweptSolid 는 메시가 아니다. `IfcExtrudedAreaSolid` 의 `SweptArea` 가 곧
   * 바닥 단면이라 폴리라인을 그대로 꺼내 쓸 수 있다 — Brep 처럼 삼각형을 자를 필요가 없다.
   * Brep(`Body/Brep`)과 `SurfaceModel` 은 여전히 안 읽고 경고로 남긴다.
   *
   * FootPrint 를 먼저 본다. 있으면 그것이 저작 도구가 직접 말한 외곽선이다.
   */
  footprint(entity: any): Vec2[] {
    const reps = entity?.Representation ? this.line(entity.Representation.value)?.Representations : null
    if (!Array.isArray(reps)) return []

    const t = this.placement(entity.ObjectPlacement?.value)

    for (const handle of reps) {
      const rep = this.line(handle.value)
      if (val(rep?.RepresentationIdentifier) !== 'FootPrint') continue

      for (const itemHandle of rep.Items ?? []) {
        const item = this.line(itemHandle.value)
        // GeometricCurveSet 은 곡선 여러 개를 담을 수 있다. 바깥 고리 하나만 쓴다.
        const elements = item?.Elements ?? [itemHandle]
        for (const elHandle of elements) {
          const el = this.line(elHandle.value)
          if (!Array.isArray(el?.Points)) continue
          const ring = el.Points.map((p: any) => {
            const c = numbers(this.line(p.value).Coordinates) ?? []
            // 국소 좌표를 먼저 환산하고 나서 변환을 적용한다. 변환의 이동량은 이미 환산돼
            // 있으므로, 순서를 바꾸면 이동량만 두 번 곱해진다.
            return apply(t, [c[0] * this.scale, c[1] * this.scale])
          })
          if (ring.length >= 3) return ring
        }
      }
    }

    // FootPrint 가 없다. Revit 이 내보낸 파일이 여기로 온다.
    for (const handle of reps) {
      const rep = this.line(handle.value)
      if (val(rep?.RepresentationType) !== 'SweptSolid') continue

      for (const itemHandle of rep.Items ?? []) {
        const solid = this.line(itemHandle.value)
        // 밀어 올린 방향이 수직이 아니면 바닥 단면이 바닥 외곽선이 아니다. 그런 공간은
        // 건너뛴다 — 기울어진 단면을 평면 외곽선인 척 내보내면 넓이가 조용히 틀린다.
        const dir = solid?.ExtrudedDirection ? numbers(this.line(solid.ExtrudedDirection.value)?.DirectionRatios) : null
        if (dir && Math.abs((dir[2] as number) ?? 0) < 0.999) continue

        const ring = this.profileRing(ref(solid?.SweptArea))
        if (ring.length < 3) continue
        const placed = compose(t, this.axisTransform(solid.Position))
        return ring.map((p) => apply(placed, p))
      }
    }
    return []
  }

  /**
   * 부재별 두께를 모은다. 재료층 두께의 합이다.
   *
   * IFC 는 벽 두께를 기하가 아니라 **재료 구성**에 둔다. 석고보드 12mm + 단열재 50mm 처럼
   * 층으로 쌓은 것의 합이 벽 두께다. 그래서 형상만 봐서는 두께를 알 수 없고, 이 관계를
   * 타야 한다. 실측 샘플(AC20-FZK-Haus)에서 0.24m 가 이렇게 들어 있었다.
   */
  thicknessByElement(): Map<number, number> {
    const out = new Map<number, number>()

    for (const relID of this.ids(WebIFC.IFCRELASSOCIATESMATERIAL)) {
      const rel = this.line(relID)
      const material = rel?.RelatingMaterial ? this.line(rel.RelatingMaterial.value) : null
      if (!material) continue

      // 부재에는 보통 LayerSetUsage 가 붙고, 그것이 실제 LayerSet 을 가리킨다.
      // 타입 객체에는 LayerSet 이 바로 붙기도 해서 둘 다 받는다.
      const layerSet = material.ForLayerSet
        ? this.line(material.ForLayerSet.value)
        : material.MaterialLayers
          ? material
          : null
      if (!layerSet?.MaterialLayers) continue

      let total = 0
      for (const layerHandle of layerSet.MaterialLayers) {
        total += (val(this.line(layerHandle.value)?.LayerThickness) as number) ?? 0
      }
      if (total <= 0) continue

      for (const objHandle of rel.RelatedObjects ?? []) {
        out.set(objHandle.value, total * this.scale)
      }
    }
    return out
  }

  /**
   * 개구부(문·창)가 어느 벽에 뚫렸는지 모은다.
   *
   * 관계가 두 단계다. `IfcRelVoidsElement` 가 벽에 구멍(`IfcOpeningElement`)을 내고,
   * `IfcRelFillsElement` 가 그 구멍을 문이나 창으로 채운다. 한 단계만 보면 이어지지 않는다.
   */
  wallByOpening(): Map<number, number> {
    const wallOfVoid = new Map<number, number>()
    for (const relID of this.ids(WebIFC.IFCRELVOIDSELEMENT)) {
      const rel = this.line(relID)
      const wall = ref(rel?.RelatingBuildingElement)
      const hole = ref(rel?.RelatedOpeningElement)
      if (wall !== null && hole !== null) wallOfVoid.set(hole, wall)
    }

    const out = new Map<number, number>()
    for (const relID of this.ids(WebIFC.IFCRELFILLSELEMENT)) {
      const rel = this.line(relID)
      const hole = ref(rel?.RelatingOpeningElement)
      const filler = ref(rel?.RelatedBuildingElement)
      if (hole === null || filler === null) continue
      const wall = wallOfVoid.get(hole)
      if (wall !== undefined) out.set(filler, wall)
    }
    return out
  }

  /**
   * 물리존을 둘러싼 부재를 모은다.
   *
   * `IfcRelSpaceBoundary` 는 "이 공간의 이 면은 저 벽이다" 를 직접 말해 준다. 기하 연산으로
   * 유추할 필요가 없다. 실측 샘플에 81건, 더 큰 모델에는 수천 건이 들어 있었다.
   */
  boundaryElementsBySpace(): Map<number, number[]> {
    const out = new Map<number, number[]>()
    for (const relID of this.ids(WebIFC.IFCRELSPACEBOUNDARY, true)) {
      const rel = this.line(relID)
      const space = ref(rel?.RelatingSpace)
      const element = ref(rel?.RelatedBuildingElement)
      // 바깥 공기에 면한 경계는 부재가 없다. 그건 경계가 아니라 열린 면이다.
      if (space === null || element === null) continue
      const list = out.get(space) ?? []
      if (!list.includes(element)) list.push(element)
      out.set(space, list)
    }
    return out
  }

  /**
   * Revit 이 요소마다 붙이는 `System Name` 속성을 모은다. IfcSystem 이 없는 파일의 대안이다.
   *
   * 값이 쉼표로 여럿 이어져 오기도 한다("Unit A Domestic Cold Water,Unit A Domestic Hot
   * Water"). 두 계통 사이에 앉은 설비(온수기, 분기 피팅)가 그렇다. 첫 것만 쓰면 그 설비가
   * 한쪽 계통에서 빠져 연결망이 거기서 끊긴다.
   */
  systemNamesByElement(): Map<number, string[]> {
    const out = new Map<number, string[]>()
    for (const { objects, psetID } of this.propertyRels()) {
      if (psetID === null) continue
      for (const prop of this.psetProps(psetID)) {
        if (prop.name !== 'System Name') continue
        const raw = prop.nominal
        if (typeof raw !== 'string') continue
        const names = raw.split(',').map((s) => s.trim()).filter(Boolean)
        if (names.length === 0) continue
        for (const id of objects) {
          if (!out.has(id)) out.set(id, names)
        }
      }
    }
    return out
  }

  /**
   * 포트끼리의 연결을 요소끼리의 연결로 옮긴다.
   *
   * 포트가 요소에 붙는 관계가 스키마마다 다르다. IFC2x3 은 `IfcRelConnectsPortToElement`,
   * IFC4 는 `IfcRelNests` 다(IFC4 에도 앞의 것이 남아 있어서 둘 다 읽는다). 한쪽만 보면
   * 다른 버전 파일에서 연결이 0 이 된다.
   *
   * 방향은 `FlowDirection` 에서 온다. 한쪽이 SOURCE 고 다른 쪽이 SINK 여야 흐름을 안다.
   * SOURCEANDSINK(Revit 이 피팅·배관에 흔히 붙인다)나 빈 값이면 방향 없는 연결로 둔다.
   */
  /** 포트를 가진 요소. Proxy 중 어느 것이 배관망에 붙은 설비인지 가를 때 쓴다. */
  portOwners(): Set<number> {
    const owners = new Set<number>()
    for (const relID of this.ids(WebIFC.IFCRELCONNECTSPORTTOELEMENT)) {
      const element = ref(this.line(relID)?.RelatedElement)
      if (element !== null) owners.add(element)
    }
    for (const relID of this.ids(WebIFC.IFCRELNESTS)) {
      const rel = this.line(relID)
      const element = ref(rel?.RelatingObject)
      if (element === null) continue
      if ((rel.RelatedObjects ?? []).some((h: any) => this.api.GetLineType(this.model, h.value) === WebIFC.IFCDISTRIBUTIONPORT)) {
        owners.add(element)
      }
    }
    return owners
  }

  portConnections(globalIdOf: (id: number) => string): Connection[] {
    const elementOf = new Map<number, number>()
    for (const relID of this.ids(WebIFC.IFCRELCONNECTSPORTTOELEMENT)) {
      const rel = this.line(relID)
      const port = ref(rel?.RelatingPort)
      const element = ref(rel?.RelatedElement)
      if (port !== null && element !== null) elementOf.set(port, element)
    }
    for (const relID of this.ids(WebIFC.IFCRELNESTS)) {
      const rel = this.line(relID)
      const element = ref(rel?.RelatingObject)
      if (element === null) continue
      for (const h of rel.RelatedObjects ?? []) {
        if (this.api.GetLineType(this.model, h.value) === WebIFC.IFCDISTRIBUTIONPORT) elementOf.set(h.value, element)
      }
    }

    const out: Connection[] = []
    const seen = new Set<string>()
    for (const relID of this.ids(WebIFC.IFCRELCONNECTSPORTS)) {
      const rel = this.line(relID)
      const pa = ref(rel?.RelatingPort)
      const pb = ref(rel?.RelatedPort)
      if (pa === null || pb === null) continue
      const ea = elementOf.get(pa)
      const eb = elementOf.get(pb)
      if (ea === undefined || eb === undefined || ea === eb) continue

      const da = val(this.line(pa)?.FlowDirection) as string | undefined
      const db = val(this.line(pb)?.FlowDirection) as string | undefined
      let from = ea
      let to = eb
      let directed = false
      if (da === 'SOURCE' && db === 'SINK') directed = true
      else if (da === 'SINK' && db === 'SOURCE') {
        from = eb
        to = ea
        directed = true
      }

      const a = globalIdOf(from)
      const b = globalIdOf(to)
      const k = directed ? `${a}>${b}` : [a, b].sort().join('-')
      if (seen.has(k)) continue
      seen.add(k)
      out.push({ from: a, to: b, source: 'port', directed, tolerance: null })
    }
    return out
  }

  /**
   * Pset_WallCommon 의 LoadBearing 값을 모아 둔다.
   *
   * 속성이 아예 없는 벽과 false 인 벽은 다른 상태다(#3). 그래서 Map 에 없는 것을
   * null 로 남기고, 호출부가 "모름" 으로 다룬다.
   */
  loadBearingByElement(): Map<number, boolean> {
    return this.flagByElement('LoadBearing')
  }

  /**
   * 참·거짓 속성(IfcBoolean) 하나를 요소마다 모은다. 없는 요소는 Map 에 없다 — 호출부가 "모름" 으로 둔다.
   * 벽의 LoadBearing(내력)·IsExternal(외벽)이 같은 모양이다(Pset_WallCommon).
   */
  flagByElement(name: string): Map<number, boolean> {
    const out = new Map<number, boolean>()
    for (const { objects, psetID } of this.propertyRels()) {
      if (psetID === null) continue
      for (const prop of this.psetProps(psetID)) {
        if (prop.name !== name) continue
        const v = prop.nominal
        // IFCBOOLEAN 은 참일 때 true 또는 'T' 로 온다. 내보낸 도구마다 다르다.
        const flag = v === true || v === 'T' || v === '.T.'
        for (const id of objects) out.set(id, flag)
      }
    }
    return out
  }
}

function spaceOf(
  r: Reader,
  expressID: number,
  globalIdOf: (elementID: number) => string,
  boundaries: Map<number, number[]>,
  warnings: string[],
  omniclass: Map<number, { code: string; source: 'classification' | 'property' }>,
): Space {
  const e = r.line(expressID)
  const id = (val(e?.GlobalId) as string) ?? `space-${expressID}`
  const footprint = r.footprint(e)
  const longName = (val(e?.LongName) as string) ?? ''

  if (footprint.length === 0) {
    // 이름만 모아 둔다. 한 줄씩 쌓으면 MEP 모델처럼 공간이 수십 개인 파일에서 경고가
    // 화면을 통째로 덮어, 정작 봐야 할 3D 가 스크롤 밖으로 밀린다. 접는 것은 호출부가 한다.
    warnings.push(longName || id)
  }

  return {
    id,
    name: (val(e?.Name) as string) ?? '',
    longName,
    footprint,
    areaM2: polygonArea(footprint),
    boundedBy: (boundaries.get(expressID) ?? []).map(globalIdOf),
    omniclass: omniclass.get(expressID)?.code ?? null,
    ...(omniclass.has(expressID) ? { omniclassSource: omniclass.get(expressID)!.source } : {}),
    ...roomKindFields((val(e?.Name) as string) ?? '', longName, omniclass.get(expressID)?.code ?? null),
  }
}

function systemKindFields(name: string, objectType: string, predefined: string | null): Pick<System, 'kind' | 'kindSource' | 'fluid' | 'fluidSource'> {
  const byIfc = systemKindOfIfc(predefined, objectType)
  const byName = byIfc ? null : systemKindOf(name, objectType)
  const kind = byIfc ?? byName
  if (!kind) return { kind: null }
  // 순환수면 유체도 읽는다(냉수·온수). 순환수가 아니면 칸을 두지 않는다.
  const fluid = resolveFluid(kind.kind, name, objectType, predefined)
  return {
    kind: kind.kind,
    kindSource: byIfc ? 'bim' : 'dict',
    ...(FLUID_KINDS.includes(kind.kind) ? { fluid: fluid?.fluid ?? null, ...(fluid ? { fluidSource: fluid.source } : {}) } : {}),
  }
}

function roomKindFields(name: string, longName: string, omniclass: string | null): Pick<Space, 'kind' | 'kindSource'> {
  const found = resolveRoomKind(name, longName, omniclass)
  return found ? { kind: found.info.kind, kindSource: found.source } : { kind: null }
}


/**
 * 문·창 하나를 중간 모델로 옮긴다.
 *
 * 치수는 객체에 바로 붙어 있고(`OverallWidth`·`OverallHeight`), 어느 벽에 뚫렸는지는
 * 관계를 두 단계 타야 나온다. 통과 가능 여부는 종류에서 바로 정해진다(PRD #3).
 */
function openingOf(
  entity: any,
  id: string,
  name: string,
  kind: 'door' | 'window',
  expressID: number,
  wallOfOpening: Map<number, number>,
  globalIdOf: (elementID: number) => string,
  scale: number,
): Opening {
  const size = (wrapped: unknown) => {
    const v = val(wrapped as { value?: unknown }) as number | undefined
    return typeof v === 'number' && Number.isFinite(v) ? v * scale : null
  }
  const wall = wallOfOpening.get(expressID)

  return {
    id,
    name,
    kind,
    width: size(entity?.OverallWidth),
    height: size(entity?.OverallHeight),
    wallId: wall === undefined ? null : globalIdOf(wall),
    // 문은 바닥이 뚫려 있어 지나갈 수 있고, 창문은 바닥·천장이 모두 막혀 있다.
    passable: kind === 'door',
  }
}

/**
 * 계통 이름에서 id 를 짓는다. 영문·숫자·밑줄만 남겨 TTL 과 GeoJSON 에 같은 문자열로 나가게 한다.
 *
 * 이름이 달라도 줄이면 같아질 수 있다("Unit A-1" 과 "Unit A 1"). 그때 한 계통으로 합치면 안
 * 되므로 뒤에 번호를 붙인다. 같은 파일을 다시 읽으면 같은 순서로 같은 번호가 나온다.
 */
export function systemIdOf(name: string, taken: Set<string>): string {
  const base = `system_${name.normalize('NFKC').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed'}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  taken.add(id)
  return id
}

/** STEP 구문이 깨져 web-ifc 가 파일을 열지 못했다. 저작 도구 쪽 문제라 우리가 고칠 수 없다. */
export class UnreadableIfcError extends Error {
  constructor(
    message = 'STEP 구문 오류로 열 수 없습니다. 문자열 안의 작은따옴표가 \'\'로 이스케이프되지 않았을 수 있습니다' +
      '(예: 6\'8" 같은 피트·인치 표기). 저작 도구에서 다시 내보내야 합니다.',
  ) {
    super(message)
    this.name = 'UnreadableIfcError'
  }
}

/**
 * 열기 전에 IFC(STEP) 파일인지 본다. 빈 파일에 "작은따옴표 이스케이프" 를 탓하거나, 머리말만 흉내 낸 파일에서
 * web-ifc 안쪽의 "Cannot read properties of undefined" 가 그대로 화면에 나가던 것을 막는다.
 */
function checkStep(bytes: Uint8Array) {
  if (bytes.length === 0) throw new UnreadableIfcError('빈 파일입니다(0바이트).')
  const head = new TextDecoder().decode(bytes.subarray(0, 4096)).replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('ISO-10303-21')) throw new UnreadableIfcError('IFC(STEP) 파일이 아닙니다. 첫 줄이 ISO-10303-21 로 시작하지 않습니다.')
  if (!/FILE_SCHEMA\s*\(/i.test(head) || !/\bDATA\s*;/i.test(new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 1 << 20)))))
    throw new UnreadableIfcError('IFC 파일의 머리말(FILE_SCHEMA)이나 DATA 절이 없습니다. 저작 도구에서 다시 내보내야 합니다.')
}

/** IFC 바이트를 읽어 중간 모델을 만든다. 호출부가 api 를 넘겨 초기화를 통제한다. */
export function importIfc(api: Api, bytes: Uint8Array, options: ImportOptions = {}): Model {
  return read(api, bytes, false, undefined, options).model
}

/**
 * 중간 모델과 함께 설비·배관의 형상을 읽는다. 3D 화면이 쓴다.
 *
 * 형상은 모델에 넣지 않고 따로 돌려준다. 모델은 내보내기가 그대로 읽는 것이라, 거기 메시가
 * 들어가면 TTL 에 좌표가 새는 길이 생긴다(이 PoC 의 전제가 깨진다). 테스트와 검사 스크립트는
 * 형상이 필요 없어서 `importIfc` 를 쓰고, 삼각형을 뽑는 비용을 안 낸다.
 *
 * 포트가 없는 파일이면 이 형상으로 연결을 추정해 모델에 채운다. 방향은 모르는 채로 둔다.
 */
export type ImportOptions = {
  /**
   * 문·창의 형상도 읽어 자리(`Opening.position`)를 잡고, 공간 경계가 없는 파일에서 문이 잇는 방을 좌표로
   * 짚는다. **온톨로지에는 필요 없다** — 로봇 경로·피난처럼 방-문-방 그래프가 필요할 때만 켠다. 성수 건축에서
   * 문·창 591개의 형상을 더 읽는다. 공간 경계가 말한 문-방은 이 옵션과 상관없이 늘 읽는다.
   */
  openings?: boolean
  /**
   * 벽·문·창을 읽을지(피처 단위, 기본은 다 읽는다). 셋 다 GeoJSON 에만 나가고 TTL 에는 없어서 **온톨로지에는 필요
   * 없다.** 벽은 3D 내력벽·요구사항 R22, 문은 방-문-방(F15), 창은 개구부(F4)에 쓴다. 끄면 그 요소를 모델에 넣지 않고
   * `Model.skipped` 에 적는다 — 요구사항 보고서가 "없음" 과 "읽지 않음" 을 가른다.
   */
  walls?: boolean
  doors?: boolean
  windows?: boolean
}

export function importIfcWithMeshes(
  api: Api,
  bytes: Uint8Array,
  onProgress?: OnProgress,
  options: ImportOptions = {},
): { model: Model; meshes: MeshMap } {
  return read(api, bytes, true, onProgress, options)
}

function read(
  api: Api,
  bytes: Uint8Array,
  withMeshes: boolean,
  onProgress?: OnProgress,
  options: ImportOptions = {},
): { model: Model; meshes: MeshMap } {
  const stage = (step: number, done?: number, total?: number) =>
    onProgress?.({ stage: IMPORT_STAGES[step], step: step + 1, steps: IMPORT_STAGES.length, done, total })
  stage(0)
  checkStep(bytes)
  const model = api.OpenModel(bytes)
  // **web-ifc 는 구문이 깨진 파일에 예외 대신 -1 을 준다.** 확인하지 않고 진행하면 한참 뒤
  // 엉뚱한 곳에서 "Cannot read properties of undefined" 로 죽어서 무엇이 잘못됐는지 모른다.
  // Duplex COBie 판본 5개 중 3개가 이랬다 — 문자열 속 피트·인치 표기(`'Atherton 6'8" Smooth'`)의
  // 작은따옴표가 STEP 규칙대로 `''` 로 이스케이프되지 않아, 문자열이 중간에 끝나 버린다.
  if (model < 0) throw new UnreadableIfcError()
  try {
    const { scale, found: unitFound } = lengthScale(api, model)
    const r = new Reader(api, model, scale)
    const warnings: string[] = []
    /** 외곽선을 못 만든 공간 이름. 한 줄로 접어서 경고에 넣는다. */
    const noFootprint: string[] = []

    if (!unitFound) {
      warnings.push('길이 단위 선언이 없어 미터로 가정했습니다. 치수가 모두 틀릴 수 있습니다.')
    }
    const readWalls = options.walls !== false
    const readDoors = options.doors !== false
    const readWindows = options.windows !== false
    const skipped: NonNullable<Model['skipped']> = [
      ...(readWalls ? [] : (['walls'] as const)),
      ...(readDoors ? [] : (['doors'] as const)),
      ...(readWindows ? [] : (['windows'] as const)),
    ]
    stage(1)
    const loadBearing = r.loadBearingByElement()
    const external = r.flagByElement('IsExternal')
    const capacity = r.capacityByElement()
    const declaredTypeOf = r.declaredType(api)
    const omniclass = r.omniclassBySpace()
    const thickness = r.thicknessByElement()
    const wallOfOpening = r.wallByOpening()
    const boundaries = r.boundaryElementsBySpace()

    /** express id 를 GlobalId 로. 모델 안의 참조를 밖에서 쓰는 id 로 바꾼다. */
    const globalIdOf = (elementID: number) =>
      (val(r.line(elementID)?.GlobalId) as string) ?? `element-${elementID}`

    // 무엇이 설비인가는 IFC 의 클래스 계층에 이미 답이 있다. IfcDistributionElement 아래에
    // 공조·배관·전기·계측이 전부 들어간다(IfcAirTerminal, IfcDuctSegment, IfcSensor …).
    //
    // 처음에는 "건축 부재가 아니면 설비" 로 뒀다가 AC20-FZK-Haus 에서 IfcAnnotation
    // 14개(치수선·라벨)를 설비로 셌다. 제외 목록을 늘리는 방식은 새 클래스가 나올 때마다
    // 또 틀리므로, 포함 기준을 IFC 계층에 맡긴다.
    const mepIDs = new Set(r.ids(WebIFC.IFCDISTRIBUTIONELEMENT, true))

    // 그 계층 한 단계 아래가 곧 역할이다. IfcDistributionFlowElement 의 하위 추상 타입이
    // 소비·이송·변환·도관을 이미 나눠 놓았다.
    //
    // **이 조회는 상속 포함(true)이라야 한다.** IFC4 파일은 구체 클래스(IfcPipeSegment)로,
    // IFC2x3 파일은 추상 클래스(IfcFlowSegment) 그 자체로 들어오는데, 상속을 안 켜면
    // 두 경우 중 한쪽이 통째로 0 이 된다.
    const roleOf = new Map<number, EquipmentRole>()
    for (const [role, type] of [
      ['conversion', WebIFC.IFCENERGYCONVERSIONDEVICE],
      ['moving', WebIFC.IFCFLOWMOVINGDEVICE],
      ['storage', WebIFC.IFCFLOWSTORAGEDEVICE],
      ['terminal', WebIFC.IFCFLOWTERMINAL],
      ['treatment', WebIFC.IFCFLOWTREATMENTDEVICE],
      ['control', WebIFC.IFCFLOWCONTROLLER],
      ['segment', WebIFC.IFCFLOWSEGMENT],
      ['fitting', WebIFC.IFCFLOWFITTING],
      ['sensing', WebIFC.IFCDISTRIBUTIONCONTROLELEMENT],
    ] as const) {
      for (const id of r.ids(type, true)) roleOf.set(id, role)
    }

    // **Proxy 중 설비인 것도 받는다.** Revit 은 패밀리의 IFC 클래스를 지정하지 않으면
    // `IfcBuildingElementProxy` 로 내보낸다. 성수 기계 파일은 FCU 120대·AHU 8대·지열 히트펌프 12대·
    // 디퓨저 752개가 전부 Proxy 였고, IFC 계층만 보면 목록에서 통째로 빠진다.
    //
    // 받는 기준은 둘이다. **포트가 있거나**(배관망에 포트로 붙어 있으면 설비다), **이름이 사전에 있거나**
    // (포트 없이 놓인 CCTV 같은 장치). 둘 다 아니면 휠스톱·캐노피 같은 건축 부재라 받지 않는다.
    // 제외 목록을 늘리는 대신 포함 근거를 IFC 구조(포트)와 좁은 사전에 둔다. 역할은 IFC 가 안 주므로
    // 사전의 것을 쓴다.
    const ported = r.portOwners()
    const proxies = { total: 0, ported: 0, named: 0, skipped: [] as string[] }
    for (const id of r.ids(WebIFC.IFCBUILDINGELEMENTPROXY)) {
      const el = r.line(id)
      const name = (val(el?.Name) as string) ?? ''
      const info = equipmentKindOf(name, (val(el?.ObjectType) as string) ?? '')
      proxies.total++
      if (ported.has(id)) proxies.ported++
      else if (info) proxies.named++
      else {
        // 읽지 않은 것의 이름 예. Revit 이름은 `패밀리:유형:요소ID` 라 요소 ID 를 떼어 같은 패밀리를 한 번만 적는다.
        const family = name.replace(/:\d+$/, '').trim() || '(이름 없음)'
        if (proxies.skipped.length < 5 && !proxies.skipped.includes(family)) proxies.skipped.push(family)
        continue
      }
      mepIDs.add(id)
      if (info?.role) roleOf.set(id, info.role)
    }

    // 계통도 같은 방식으로 고른다. IfcSystem 아래에 IfcDistributionSystem 이 있고 그 아래에
    // 다시 IfcDistributionCircuit(전기 회로, 배관 분기)이 있다. 정확히 일치하는 타입만
    // 받으면 실측 IFC4 MEP 모델에서 계통 37개 중 22개를 놓쳤다.
    const systemIDs = new Set(r.ids(WebIFC.IFCSYSTEM, true))

    const firstName = (type: number) => {
      const [id] = r.ids(type)
      return id === undefined ? '' : ((val(r.line(id)?.Name) as string) ?? '')
    }
    const firstGlobalId = (type: number, fallback: string) => {
      const [id] = r.ids(type)
      return id === undefined ? fallback : ((val(r.line(id)?.GlobalId) as string) ?? fallback)
    }

    // 층 → 공간: 분해 관계
    const spacesByStorey = new Map<number, number[]>()
    const storeyOfSpace = new Map<number, number>()
    for (const relID of r.ids(WebIFC.IFCRELAGGREGATES)) {
      const rel = r.line(relID)
      const parent = ref(rel?.RelatingObject)
      if (parent === null) continue
      for (const child of rel.RelatedObjects ?? []) {
        const line = r.line(child.value)
        if (line?.type !== WebIFC.IFCSPACE) continue
        const list = spacesByStorey.get(parent) ?? []
        list.push(child.value)
        spacesByStorey.set(parent, list)
        storeyOfSpace.set(child.value, parent)
      }
    }

    // 계통(IfcSystem)은 층에 속하지 않는다. 설비를 그룹으로 묶는 별도 관계다.
    stage(2)
    const systems: System[] = []
    const systemOfElement = new Map<number, string>()
    for (const relID of r.ids(WebIFC.IFCRELASSIGNSTOGROUP)) {
      const rel = r.line(relID)
      const groupID = ref(rel?.RelatingGroup)
      if (groupID === null) continue
      // 그룹은 계통 말고도 쓰인다(존, 작업 묶음 등). 계통 계열만 취한다.
      if (!systemIDs.has(groupID)) continue
      const group = r.line(groupID)

      const id = (val(group?.GlobalId) as string) ?? `system_${groupID}`
      const memberIDs = (rel.RelatedObjects ?? []).map((h: any) => h.value)
      for (const m of memberIDs) systemOfElement.set(m, id)

      systems.push({
        id,
        name: (val(group?.LongName) as string) || ((val(group?.Name) as string) ?? ''),
        memberIds: memberIDs.map((m: number) => (val(r.line(m)?.GlobalId) as string) ?? `element-${m}`),
        source: 'ifc',
        // Revit 은 시스템 분류(급기, 순환수 공급 …)를 ObjectType 에 적는다. 이름에는 번호가 붙는다.
        // IFC4 는 PredefinedType 도 있다(IfcDistributionSystem). 요구하는 어휘는 kinds.ts 의 SYSTEM_IFC 다.
        ...systemKindFields(
          (val(group?.LongName) as string) || ((val(group?.Name) as string) ?? ''),
          (val(group?.ObjectType) as string) ?? '',
          (val(group?.PredefinedType) as string) ?? null,
        ),
      })
    }

    // IfcSystem 이 없으면 Revit 의 `System Name` 속성으로 계통을 세운다. 둘 다 있으면
    // IfcSystem 을 따른다 — 속성은 저작 도구마다 이름이 달라서 표준 쪽이 더 믿을 만하다.
    //
    // id 는 이름에서 만든다. GlobalId 가 없는 묶음이라 달리 붙일 것이 없고, 같은 파일을
    // 다시 읽어도 같은 id 가 나와야 재임포트 때 같은 계통으로 알아본다.
    //
    // **id 에는 영문·숫자·밑줄만 남긴다.** 이름을 그대로 넣었을 때("system-Unit A Domestic Cold
    // Water") TTL 은 공백을 `_` 로, `-` 를 `\-` 로 바꿔 써야 해서, 받는 쪽 키와 GeoJSON 의
    // systemId 가 서로 다른 문자열이 됐다. 우리가 짓는 id 는 처음부터 고칠 것이 없게 짓는다.
    if (systems.length === 0) {
      const byName = new Map<string, System>()
      const taken = new Set<string>()
      for (const [elementID, names] of r.systemNamesByElement()) {
        if (!mepIDs.has(elementID)) continue
        for (const name of names) {
          let system = byName.get(name)
          if (!system) {
            system = { id: systemIdOf(name, taken), name, memberIds: [], source: 'property', ...systemKindFields(name, '', null) }
            byName.set(name, system)
            systems.push(system)
          }
          system.memberIds.push(globalIdOf(elementID))
        }
        systemOfElement.set(elementID, byName.get(names[0])!.id)
      }
    }

    // 층 → 벽·문·창: 포함 관계
    //
    // **상위 구조가 층이 아니라 공간일 수 있다.** Duplex 의 COBie 판본은 설비 133대를
    // 전부 `IfcSpace` 에 매달아 두었고 층에 매달린 것은 하나도 없었다. 층만 보면 설비가
    // 0 으로 읽힌다. 공간에 매달린 것은 그 공간의 층으로 올려 담고, 동시에 **BIM 이
    // 말해 준 소속 공간**으로 기억해 둔다.
    const elementsByStorey = new Map<number, number[]>()
    const declaredSpaceOf = new Map<number, string>()

    for (const relID of r.ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const rel = r.line(relID)
      const structure = ref(rel?.RelatingStructure)
      if (structure === null) continue

      const structureLine = r.line(structure)
      let storeyID = structure
      if (structureLine?.type === WebIFC.IFCSPACE) {
        const parentStorey = storeyOfSpace.get(structure)
        if (parentStorey === undefined) continue
        storeyID = parentStorey
        const spaceGlobalID = val(structureLine?.GlobalId) as string
        if (spaceGlobalID) {
          for (const child of rel.RelatedElements ?? []) declaredSpaceOf.set(child.value, spaceGlobalID)
        }
      }

      const list = elementsByStorey.get(storeyID) ?? []
      for (const child of rel.RelatedElements ?? []) list.push(child.value)
      elementsByStorey.set(storeyID, list)
    }

    const declaredHeights = r.storeyHeights()
    const storeys: Storey[] = r.ids(WebIFC.IFCBUILDINGSTOREY).map((storeyID) => {
      const e = r.line(storeyID)
      const walls: Wall[] = []
      const openings: Opening[] = []
      const equipment: Equipment[] = []

      for (const elementID of elementsByStorey.get(storeyID) ?? []) {
        const el = r.line(elementID)
        const id = (val(el?.GlobalId) as string) ?? `element-${elementID}`
        const name = (val(el?.Name) as string) ?? ''

        switch (el?.type) {
          case WebIFC.IFCWALL:
          case WebIFC.IFCWALLSTANDARDCASE:
            if (!readWalls) break
            walls.push({
              id,
              name,
              loadBearing: loadBearing.get(elementID) ?? null,
              external: external.get(elementID) ?? null,
              thickness: thickness.get(elementID) ?? null,
            })
            break
          case WebIFC.IFCDOOR:
            if (readDoors) openings.push(openingOf(el, id, name, 'door', elementID, wallOfOpening, globalIdOf, scale))
            break
          case WebIFC.IFCWINDOW:
            if (readWindows) openings.push(openingOf(el, id, name, 'window', elementID, wallOfOpening, globalIdOf, scale))
            break
          default:
            if (!mepIDs.has(elementID)) break
            {
            // GetNameFromTypeCode 는 'IfcAirTerminal' 을 준다. 앞의 Ifc 만 뗀다.
            const ifcClass = api.GetNameFromTypeCode(el.type).replace(/^Ifc/i, '')
            const objectType = (val(el?.ObjectType) as string) ?? ''
            const declaredType = declaredTypeOf(elementID)
            const kind = resolveEquipmentKind(name, objectType, ifcClass, declaredType)
            equipment.push({
              id,
              name,
              ifcClass,
              objectType,
              declaredType,
              kind: kind?.info.kind ?? null,
              ...(kind ? { kindSource: kind.source } : {}),
              role: roleOf.get(elementID) ?? null,
              position: r.position3(el),
              capacity: capacity.get(elementID)?.value ?? null,
              capacityProperty: capacity.get(elementID)?.property ?? null,
              systemId: systemOfElement.get(elementID) ?? null,
              // BIM 이 소속을 말해 줬으면 그대로 쓴다. 아니면 좌표로 판정하는데, 그건
              // 층이 다 모인 뒤라야 돌 수 있어서 아래에서 채운다.
              spaceId: declaredSpaceOf.get(elementID) ?? null,
              spaceSource: declaredSpaceOf.has(elementID) ? ('bim' as const) : null,
            })
            }
        }
      }

      return {
        id: (val(e?.GlobalId) as string) ?? `storey-${storeyID}`,
        name: (val(e?.Name) as string) ?? '',
        elevation: ((val(e?.Elevation) as number) ?? 0) * scale,
        ...(declaredHeights.has(storeyID) ? { declaredHeight: declaredHeights.get(storeyID)! } : {}),
        spaces: (spacesByStorey.get(storeyID) ?? []).map((id) =>
          spaceOf(r, id, globalIdOf, boundaries, noFootprint, omniclass),
        ),
        walls,
        openings,
        equipment,
      }
    })

    // 층이 낮은 것부터 보여야 층 선택 목록이 건물과 같은 순서가 된다.
    storeys.sort((a, b) => a.elevation - b.elevation)

    // 같은 방이 두 번 들어 있으면(Revit 의 MEP Space 사본) 하나만 남긴다. 경고를 세기 전에 한다 — 사본까지 세면
    // "경계 없는 물리존" 같은 숫자가 두 배가 된다.
    const duplicates = dropDuplicateSpaces({ storeys })
    if (duplicates > 0) {
      warnings.push(`같은 자리에 같은 방이 두 번 들어 있어 물리존 ${duplicates}개를 걸렀습니다(Revit 의 MEP Space 사본, 또는 기본 이름 "공간"으로 남은 사본으로 보임).`)
    }

    if (noFootprint.length > 0) {
      // 이름을 셋까지만 보인다. MEP 모델은 공간이 수십 개라 전부 적으면 경고가 화면을 덮는다.
      const shown = noFootprint.slice(0, 3).join(', ')
      const rest = noFootprint.length > 3 ? ` 외 ${noFootprint.length - 3}개` : ''
      warnings.push(
        // FootPrint 와 SweptSolid 를 둘 다 본 뒤에도 못 얻은 것들이다. Brep 이나
        // SurfaceModel 로만 그려진 공간, 그리고 형상 표현이 아예 없는 공간(COBie 판본의
        // IfcSpace 22개가 그랬다)이 여기 걸린다.
        `공간 ${noFootprint.length}개에 바닥 외곽선(FootPrint, SweptSolid)이 없습니다(${shown}${rest}).`,
      )
    }

    const allWalls = storeys.flatMap((s) => s.walls)
    const noThickness = allWalls.filter((w) => w.thickness === null).length
    if (noThickness > 0) {
      warnings.push(
        `벽 ${noThickness}장은 재료 구성이 없어 두께를 알 수 없습니다.`,
      )
    }

    const looseOpenings = storeys.flatMap((s) => s.openings).filter((o) => o.wallId === null).length
    if (looseOpenings > 0) {
      warnings.push(
        `문·창 ${looseOpenings}개는 어느 벽에 있는지 알 수 없습니다(개구부 관계 없음).`,
      )
    }

    const noBoundary = storeys.flatMap((s) => s.spaces).filter((sp) => sp.boundedBy.length === 0).length
    if (noBoundary > 0) {
      warnings.push(
        `물리존 ${noBoundary}개에 공간 경계(IfcRelSpaceBoundary)가 없습니다. 문이 잇는 방은 좌표로 찾습니다.`,
      )
    }

    const unknown = allWalls.filter((w) => w.loadBearing === null).length
    if (unknown > 0) {
      warnings.push(
        `벽 ${unknown}장에 내력(LoadBearing) 속성이 없습니다. 내력 여부를 "모름"으로 둡니다.`,
      )
    }

    const result: Model = {
      schema: api.GetModelSchema(model),
      siteName: firstName(WebIFC.IFCSITE),
      buildingId: firstGlobalId(WebIFC.IFCBUILDING, 'building'),
      buildingName: firstName(WebIFC.IFCBUILDING),
      storeys,
      systems,
      connections: r.portConnections(globalIdOf),
      warnings,
      ...(skipped.length ? { skipped } : {}),
      facts: {
        lengthUnit: unitFound,
        // IfcMapConversion 은 IFC4 부터 있다. IFC2x3 에서는 늘 0 이다.
        mapConversion: r.ids(WebIFC.IFCMAPCONVERSION).length > 0,
        siteLatLong: r.ids(WebIFC.IFCSITE).some((id) => (r.line(id)?.RefLatitude?.length ?? 0) > 0),
        ...(proxies.total ? { proxies } : {}),
      },
    }

    const allEquipment = storeys.flatMap((s) => s.equipment)
    // 벽 형상은 3D 에서 내력벽을 보이는 데만 쓴다. 설비 형상과 따로 읽어 두었다가 맨 끝에 합친다 —
    // 먼저 합치면 형상으로 연결을 추정할 때 벽까지 배관으로 센다.
    const wallIDs = withMeshes && readWalls ? new Set(r.ids(WebIFC.IFCWALL, true)) : new Set<number>()
    const meshTotal = mepIDs.size + wallIDs.size
    if (withMeshes) stage(3, 0, meshTotal)
    const meshes: MeshMap = withMeshes
      ? readMeshes(api, model, mepIDs, globalIdOf, (done) => stage(3, done, meshTotal))
      : new Map()
    const wallMeshes: MeshMap = withMeshes
      ? readMeshes(api, model, wallIDs, globalIdOf, (done) => stage(3, mepIDs.size + done, meshTotal))
      : new Map()
    stage(4)

    // 배치점을 형상에 맞춘 뒤에 소속을 판정한다. 순서를 바꾸면 층 원점에 찍힌 덕트가 원점이
    // 든 방으로 먼저 들어가 버린다.
    const anchored = anchorToGeometry(allEquipment, meshes)
    if (anchored > 0) {
      warnings.push(
        `설비 ${anchored}대는 배치점이 형상에서 ${ANCHOR_MARGIN}m 넘게 떨어져 있어(층 원점에 찍힌 것으로 보임) 형상 중심을 좌표로 썼습니다.`,
      )
    }

    // 설비의 소속 물리존은 좌표로 판정한다. 층이 다 모인 뒤에야 돌 수 있다.
    //
    // "소속을 못 찾은 설비 N대" 는 경고로 굳히지 않는다. 경계를 고치거나(E2) 설비를 옮기거나
    // (E5) 다른 파일을 합치면 바로 달라지는 값이라, 임포트 시점에 적어 두면 낡은 숫자가 화면에
    // 남는다. 화면이 `countOf` 로 그때그때 센다.
    assignEquipmentToSpaces(result)

    const unplaced = allEquipment.filter((e) => e.position === null).length
    if (unplaced > 0) {
      warnings.push(`설비 ${unplaced}대에 좌표가 없습니다. 편집 모드에서 좌표를 넣어야 합니다.`)
    }
    const noCapacity = allEquipment.filter((e) => e.capacity === null && CAPACITY_KINDS.has(e.kind ?? '')).length
    if (noCapacity > 0) {
      warnings.push(`용량을 적어야 하는 기기(공조기·팬·펌프·말단 등) ${noCapacity}대에 용량 파라미터가 없습니다. 공조존 용량 검증에서 빠집니다.`)
    }
    if (allEquipment.length > 0 && systems.length === 0) {
      warnings.push('설비는 있지만 계통(IfcSystem)이 없습니다. 어느 공조기가 어느 토출구를 맡는지 알 수 없습니다.')
    }
    if (withMeshes && result.connections.length === 0 && meshes.size > 0) {
      const systemsOf = new Map<string, string[]>()
      for (const system of systems) {
        for (const id of system.memberIds) systemsOf.set(id, [...(systemsOf.get(id) ?? []), system.name])
      }
      // 흐름이 없는 종류(조명·감지기·비치품·분전반 — kinds.ts 의 `flow: {}`)는 형상이 맞닿아도 잇지 않는다(OE-PIP-18). 병원 MEP 에서
      // 나란히 붙은 조명기구 16쌍이 서로 "연결" 로 잡혔다. 포트가 있는 세 파일(병원 HVAC·Duplex HVAC·ifc4Mep)을 정답지로 재면 빼도
      // 재현율·정밀도가 그대로다 — 포트가 흐름 없는 기기를 잇는 일이 없다. 종류를 모르는 것은 둔다.
      const kindOf = new Map(allEquipment.map((e) => [e.id, e.kind]))
      const flows = (id: string) => {
        const info = equipmentKind(kindOf.get(id))
        return !info || Object.keys(info.flow ?? {}).length > 0
      }
      const points = [...meshes]
        .filter(([id]) => flows(id))
        .map(([id, mesh]) => ({
          id,
          points: mesh.positions,
          systems: systemsOf.get(id) ?? null,
        }))
      result.connections = inferConnections(points)
      if (result.connections.length > 0) {
        warnings.push(
          `포트(IfcDistributionPort)가 없어 형상이 맞닿은 곳을 연결로 추정했습니다(${result.connections.length}개). 흐름 방향은 알 수 없습니다.`,
        )
      }

      // 이은 것만 세면 못 이은 것이 조용히 사라진다. **못 이은 이유가 둘이고, 고객사에 할
      // 말이 서로 다르다** — 오차를 키우면 붙는 것과 접합 부재가 아예 없는 것.
      //
      // 앞의 것은 메울 수 있다. 고립된 요소는 잃을 연결이 없어서, 그 주변에서만 판정을
      // 넓혀도 정밀도가 깎이지 않는다(connectGaps 주석 참조).
      const gaps = findGaps(points, result.connections)
      const rescued = connectGaps(gaps)
      result.connections = [...result.connections, ...rescued]

      // **대수와 연결 개수를 섞어 세지 말 것.** 고립된 둘이 서로를 지목하면 연결 하나가
      // 두 대를 살린다. 대수는 결손 종류로 세고, 연결 개수는 따로 적는다.
      const joined = gaps.filter((g) => g.kind === 'derived').length
      // 흐름이 없는 종류(거울·수건함·감지기·CCTV)는 덕트·배관에 이어질 것이 아니라 "모델을 고쳐야 한다" 에서 뺀다.
      // 치과 파일의 비치품 98대가 전부 여기 걸려 고칠 것이 없는 파일에 고치라고 했다. 위에서 형상 추정에 넣지 않아 gaps 에도 없다.
      const stranded = gaps.filter((g) => g.kind !== 'derived').length
      if (joined > 0) {
        const far = Math.max(...rescued.map((c) => c.tolerance ?? 0))
        warnings.push(
          `연결이 없던 설비 ${gaps.length}대 중 ${joined}대는 허용 거리를 최대 ${Math.round(far * 1000)}mm까지 늘려 연결망에 붙였습니다(연결 ${rescued.length}개). 거리는 고른 설비의 연결 목록에서 볼 수 있습니다.`,
        )
      }
      if (stranded > 0) {
        warnings.push(
          `설비 ${stranded}대는 주변 ${Math.round(REACH * 1000)}mm 안에 이어질 부재가 없어 연결하지 못했습니다(접합 부재 누락). 모델을 고쳐야 합니다.`,
        )
      }
    }

    // 읽은 것과 읽지 않은 것을 같이 센다(OE-BIM-13). 읽은 수만 말하면 빠뜨린 설비가 없는지 볼 길이 없다.
    if (proxies.total > 0) {
      const read = proxies.ported + proxies.named
      const left = proxies.total - read
      warnings.push(
        `Proxy(IfcBuildingElementProxy) ${proxies.total}개 중 ${read}개를 설비로 읽었습니다` +
          (read ? `(포트가 있는 것 ${proxies.ported}개, 이름으로 종류를 정한 것 ${proxies.named}개). IFC 클래스가 없어 종류는 이름으로 추정했습니다` : '') +
          (left ? `. 나머지 ${left}개는 포트도 없고 이름도 사전에 없어 건축 부재로 보고 읽지 않았습니다(예: ${proxies.skipped.join(', ')})` : '') +
          '(요구사항 R23).',
      )
    }

    // 포트가 방향을 말하지 않은 연결에 계통·설비 종류로 규칙 방향을 준다. 확정 전에는 내보내지 않는다.
    stage(5)
    const rules = inferFlowByRules(result)
    if (rules.oriented > 0) {
      const checked = rules.agree + rules.disagree
      warnings.push(
        `포트에 방향이 없는 연결 ${rules.oriented}개는 계통 종류와 설비 종류로 방향을 추정했습니다(규칙 방향). 확정하기 전에는 brick:feeds로 내보내지 않습니다.` +
          (checked > 0 ? ` 포트 방향이 있는 연결 ${checked}개와 비교하면 ${((rules.agree / checked) * 100).toFixed(1)}% 일치합니다.` : ''),
      )
    }

    placeWallsAndOpenings(api, model, result, wallMeshes, globalIdOf, (id) => r.ids(id, true), withMeshes && !!options.openings)
    for (const [id, mesh] of wallMeshes) meshes.set(id, mesh)
    return { model: result, meshes }
  } finally {
    api.CloseModel(model)
  }
}
