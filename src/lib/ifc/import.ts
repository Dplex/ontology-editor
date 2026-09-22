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
import type { Connection, Equipment, Model, Opening, Space, Storey, System, Vec2, Vec3, Wall } from '../model'
import { polygonArea } from '../model'
import { apply, foldChain, foldElevation, fromAxisPlacement, type Transform2 } from './placement'
import { assignEquipmentToSpaces, unlocatedEquipment } from '../mapping'
import { lengthScale } from './units'
import { inferConnections } from '../topology'

/**
 * 요소 하나의 삼각형 메시. 3D 화면만 쓴다 — 모델과 내보내기에는 들어가지 않는다.
 *
 * 좌표는 **three.js 세계 좌표**(y 가 높이, 미터)로 이미 바뀌어 있다. web-ifc 가 IFC 의
 * (x, y, z) 를 (x, z, -y) 로 돌리고 단위도 미터로 맞춰서 준다. 공간 판도 같은 변환
 * (평면 (x, y) → (x, ·, -y))으로 그리므로, 여기서 한 번 더 돌리면 배관이 눕는다.
 */
export type ElementMesh = {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/** GlobalId → 메시. */
export type MeshMap = Map<string, ElementMesh>

/**
 * 설비·배관의 형상을 뽑아 요소마다 한 덩어리로 합친다.
 *
 * web-ifc 는 요소 하나를 여러 조각(형상 + 배치 행렬)으로 준다. 조각마다 행렬을 미리 곱해
 * 세계 좌표로 합쳐 두면, 화면은 요소 하나를 메시 하나로 다루고(고르기·강조가 단순해진다)
 * 연결 추정도 같은 좌표를 그대로 쓴다.
 */
function readMeshes(api: Api, model: number, ids: Set<number>, globalIdOf: (id: number) => string): MeshMap {
  const out: MeshMap = new Map()
  if (ids.size === 0) return out

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

/** web-ifc 의 Vector 를 평범한 배열로. 이 타입이 코드 곳곳에 번지지 않게 입구에서 바꾼다. */
function toArray(vector: { size(): number; get(i: number): number }): number[] {
  return Array.from({ length: vector.size() }, (_, i) => vector.get(i))
}

/** IFC 값은 대부분 `{ value: … }` 로 한 겹 싸여 있다. */
function val<T>(wrapped: { value?: T } | null | undefined): T | undefined {
  return wrapped?.value
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

  /** 배치 사슬을 타고 올라가 세계 좌표 변환을 만든다. */
  placement(expressID: number | undefined): Transform2 {
    const chain: Transform2[] = []
    let cur = expressID
    // 사슬이 자기 자신을 가리키는 깨진 파일을 만나면 여기서 영원히 돈다.
    // 건물 구조가 이보다 깊을 일은 없으므로 상한을 둔다.
    for (let guard = 0; cur !== undefined && guard < 64; guard++) {
      const lp = this.line(cur)
      const rel = lp?.RelativePlacement ? this.line(lp.RelativePlacement.value) : null
      const raw = rel?.Location ? this.line(rel.Location.value).Coordinates?.map(val) : null
      // 방향 벡터는 비율이라 단위와 무관하다. 위치만 환산한다.
      const loc = raw ? (raw as number[]).map((v) => v * this.scale) : null
      const dir = rel?.RefDirection ? this.line(rel.RefDirection.value).DirectionRatios?.map(val) : null
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
      const coords = rel?.Location ? this.line(rel.Location.value).Coordinates?.map(val) : null
      zs.push(((coords?.[2] as number) ?? 0) * this.scale)
      cur = lp?.PlacementRelTo?.value
    }

    const flat = apply(this.placement(root), [0, 0])
    return [flat[0], flat[1], foldElevation(zs)]
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

    for (const relID of this.ids(WebIFC.IFCRELDEFINESBYPROPERTIES)) {
      const rel = this.line(relID)
      const def = rel?.RelatingPropertyDefinition ? this.line(rel.RelatingPropertyDefinition.value) : null
      if (!def?.HasProperties) continue

      for (const propHandle of def.HasProperties) {
        const prop = this.line(propHandle.value)
        const name = val(prop?.Name) as string
        const rank = CAPACITY_NAMES.indexOf(name)
        if (rank < 0) continue
        const value = Number(val(prop?.NominalValue))
        if (!Number.isFinite(value)) continue

        for (const objHandle of rel.RelatedObjects ?? []) {
          // 목록에서 앞선 이름이 이긴다. 표준 이름을 비표준 이름보다 먼저 두었다.
          const had = out.get(objHandle.value)
          if (had && CAPACITY_NAMES.indexOf(had.property) <= rank) continue
          out.set(objHandle.value, { value, property: name })
        }
      }
    }
    return out
  }

  /**
   * 공간의 바닥 외곽선을 세계 좌표 고리로 돌려준다.
   *
   * FootPrint 표현을 쓴다. Body 는 Brep(삼각형 껍데기)이라 평면 외곽선을 되찾으려면
   * 메시를 잘라야 하는데, FootPrint 에 이미 정확한 폴리라인이 들어 있다.
   * FootPrint 가 없는 모델도 있어서, 없으면 빈 고리를 주고 경고로 남긴다.
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
            const c = this.line(p.value).Coordinates.map(val) as number[]
            // 국소 좌표를 먼저 환산하고 나서 변환을 적용한다. 변환의 이동량은 이미 환산돼
            // 있으므로, 순서를 바꾸면 이동량만 두 번 곱해진다.
            return apply(t, [c[0] * this.scale, c[1] * this.scale])
          })
          if (ring.length >= 3) return ring
        }
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
    for (const relID of this.ids(WebIFC.IFCRELDEFINESBYPROPERTIES)) {
      const rel = this.line(relID)
      const def = rel?.RelatingPropertyDefinition ? this.line(rel.RelatingPropertyDefinition.value) : null
      if (!def?.HasProperties) continue
      for (const propHandle of def.HasProperties) {
        const prop = this.line(propHandle.value)
        if (val(prop?.Name) !== 'System Name') continue
        const raw = val(prop?.NominalValue)
        if (typeof raw !== 'string') continue
        const names = raw.split(',').map((s) => s.trim()).filter(Boolean)
        if (names.length === 0) continue
        for (const objHandle of rel.RelatedObjects ?? []) {
          if (!out.has(objHandle.value)) out.set(objHandle.value, names)
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
      out.push({ from: a, to: b, source: 'port', directed })
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
    const out = new Map<number, boolean>()
    for (const relID of this.ids(WebIFC.IFCRELDEFINESBYPROPERTIES)) {
      const rel = this.line(relID)
      const def = rel?.RelatingPropertyDefinition ? this.line(rel.RelatingPropertyDefinition.value) : null
      if (!def?.HasProperties) continue

      for (const propHandle of def.HasProperties) {
        const prop = this.line(propHandle.value)
        if (val(prop?.Name) !== 'LoadBearing') continue
        const v = val(prop?.NominalValue) as unknown
        // IFCBOOLEAN 은 참일 때 true 또는 'T' 로 온다. 내보낸 도구마다 다르다.
        const flag = v === true || v === 'T' || v === '.T.'
        for (const objHandle of rel.RelatedObjects ?? []) out.set(objHandle.value, flag)
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
  }
}

/**
 * 용량으로 받아들이는 속성 이름. **앞에 있을수록 우선한다.**
 *
 * 앞쪽 넷은 IFC 표준 Pset 의 이름이고, 뒤쪽은 저작 도구가 임의로 붙이는 이름이다.
 * 실측한 모델에서는 뒤쪽만 나왔다. 표준 이름을 먼저 두는 이유는, 둘 다 있는 파일이라면
 * 표준 쪽이 검증을 거친 값이기 때문이다.
 */
const CAPACITY_NAMES = [
  'NominalAirFlowRate',
  'AirFlowRate',
  'NominalCapacity',
  'TotalCoolingCapacity',
  // Revit 이 내보내는 이름들. 공백이 들어간 것도 그대로 쓴다.
  'Flow',
  'Air Flow',
  'Design Flow',
  'Rated Flow',
]

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

/** IFC 바이트를 읽어 중간 모델을 만든다. 호출부가 api 를 넘겨 초기화를 통제한다. */
export function importIfc(api: Api, bytes: Uint8Array): Model {
  return read(api, bytes, false).model
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
export function importIfcWithMeshes(api: Api, bytes: Uint8Array): { model: Model; meshes: MeshMap } {
  return read(api, bytes, true)
}

function read(api: Api, bytes: Uint8Array, withMeshes: boolean): { model: Model; meshes: MeshMap } {
  const model = api.OpenModel(bytes)
  try {
    const { scale, found: unitFound } = lengthScale(api, model)
    const r = new Reader(api, model, scale)
    const warnings: string[] = []
    /** 외곽선을 못 만든 공간 이름. 한 줄로 접어서 경고에 넣는다. */
    const noFootprint: string[] = []

    if (!unitFound) {
      warnings.push('길이 단위 선언을 찾지 못해 미터로 가정했습니다. 치수가 전부 어긋날 수 있습니다.')
    }
    const loadBearing = r.loadBearingByElement()
    const capacity = r.capacityByElement()
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
    const systems: System[] = []
    const systemOfElement = new Map<number, string>()
    for (const relID of r.ids(WebIFC.IFCRELASSIGNSTOGROUP)) {
      const rel = r.line(relID)
      const groupID = ref(rel?.RelatingGroup)
      if (groupID === null) continue
      // 그룹은 계통 말고도 쓰인다(존, 작업 묶음 등). 계통 계열만 취한다.
      if (!systemIDs.has(groupID)) continue
      const group = r.line(groupID)

      const id = (val(group?.GlobalId) as string) ?? `system-${groupID}`
      const memberIDs = (rel.RelatedObjects ?? []).map((h: any) => h.value)
      for (const m of memberIDs) systemOfElement.set(m, id)

      systems.push({
        id,
        name: (val(group?.LongName) as string) || ((val(group?.Name) as string) ?? ''),
        memberIds: memberIDs.map((m: number) => (val(r.line(m)?.GlobalId) as string) ?? `element-${m}`),
        source: 'ifc',
      })
    }

    // IfcSystem 이 없으면 Revit 의 `System Name` 속성으로 계통을 세운다. 둘 다 있으면
    // IfcSystem 을 따른다 — 속성은 저작 도구마다 이름이 달라서 표준 쪽이 더 믿을 만하다.
    //
    // id 는 이름에서 만든다. GlobalId 가 없는 묶음이라 달리 붙일 것이 없고, 같은 파일을
    // 다시 읽어도 같은 id 가 나와야 재임포트 때 같은 계통으로 알아본다.
    if (systems.length === 0) {
      const byName = new Map<string, System>()
      for (const [elementID, names] of r.systemNamesByElement()) {
        if (!mepIDs.has(elementID)) continue
        for (const name of names) {
          let system = byName.get(name)
          if (!system) {
            system = { id: `system-${name}`, name, memberIds: [], source: 'property' }
            byName.set(name, system)
            systems.push(system)
          }
          system.memberIds.push(globalIdOf(elementID))
        }
        systemOfElement.set(elementID, `system-${names[0]}`)
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
            walls.push({
              id,
              name,
              loadBearing: loadBearing.get(elementID) ?? null,
              thickness: thickness.get(elementID) ?? null,
            })
            break
          case WebIFC.IFCDOOR:
            openings.push(openingOf(el, id, name, 'door', elementID, wallOfOpening, globalIdOf, scale))
            break
          case WebIFC.IFCWINDOW:
            openings.push(openingOf(el, id, name, 'window', elementID, wallOfOpening, globalIdOf, scale))
            break
          default:
            if (!mepIDs.has(elementID)) break
            equipment.push({
              id,
              name,
              // GetNameFromTypeCode 는 'IfcAirTerminal' 을 준다. 앞의 Ifc 만 뗀다.
              ifcClass: api.GetNameFromTypeCode(el.type).replace(/^Ifc/i, ''),
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

      return {
        id: (val(e?.GlobalId) as string) ?? `storey-${storeyID}`,
        name: (val(e?.Name) as string) ?? '',
        elevation: ((val(e?.Elevation) as number) ?? 0) * scale,
        spaces: (spacesByStorey.get(storeyID) ?? []).map((id) =>
          spaceOf(r, id, globalIdOf, boundaries, noFootprint),
        ),
        walls,
        openings,
        equipment,
      }
    })

    // 층이 낮은 것부터 보여야 층 선택 목록이 건물과 같은 순서가 된다.
    storeys.sort((a, b) => a.elevation - b.elevation)

    if (noFootprint.length > 0) {
      // 이름을 셋까지만 보인다. MEP 모델은 공간이 수십 개라 전부 적으면 경고가 화면을 덮는다.
      const shown = noFootprint.slice(0, 3).join(', ')
      const rest = noFootprint.length > 3 ? ` 외 ${noFootprint.length - 3}개` : ''
      warnings.push(
        `공간 ${noFootprint.length}개에 FootPrint 표현이 없어 외곽선을 만들지 못했습니다(${shown}${rest}).`,
      )
    }

    const allWalls = storeys.flatMap((s) => s.walls)
    const noThickness = allWalls.filter((w) => w.thickness === null).length
    if (noThickness > 0) {
      warnings.push(
        `벽 ${noThickness}장에 재료 구성이 없어 두께를 모릅니다. 선으로만 그릴 수 있고 벽 편집이 제한됩니다.`,
      )
    }

    const looseOpenings = storeys.flatMap((s) => s.openings).filter((o) => o.wallId === null).length
    if (looseOpenings > 0) {
      warnings.push(
        `문·창 ${looseOpenings}개가 어느 벽에 뚫렸는지 모릅니다. 벽을 지울 때 함께 지울 대상을 찾지 못합니다.`,
      )
    }

    const noBoundary = storeys.flatMap((s) => s.spaces).filter((sp) => sp.boundedBy.length === 0).length
    if (noBoundary > 0) {
      warnings.push(
        `물리존 ${noBoundary}개에 공간 경계 정보가 없습니다. 벽을 고칠 때 영향받는 물리존을 BIM 에서 알 수 없어 기하로 유추해야 합니다.`,
      )
    }

    const unknown = allWalls.filter((w) => w.loadBearing === null).length
    if (unknown > 0) {
      warnings.push(
        `벽 ${unknown}장에 Structural(내력) 속성이 없습니다. 내력벽으로 처리하지 않으며, 편집 제한도 걸리지 않습니다.`,
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
    }

    // 설비의 소속 물리존은 좌표로 판정한다. 층이 다 모인 뒤에야 돌 수 있다.
    assignEquipmentToSpaces(result)

    const allEquipment = storeys.flatMap((s) => s.equipment)
    const unplaced = allEquipment.filter((e) => e.position === null).length
    if (unplaced > 0) {
      warnings.push(`설비 ${unplaced}대에 좌표가 없어 자동 배치하지 못했습니다. 3D 에서 직접 놓아야 합니다.`)
    }
    const noCapacity = allEquipment.filter((e) => e.capacity === null).length
    if (noCapacity > 0) {
      warnings.push(`설비 ${noCapacity}대에 용량 파라미터가 없습니다. 공조존 용량 검증을 돌릴 수 없습니다.`)
    }
    if (allEquipment.length > 0 && systems.length === 0) {
      warnings.push('설비는 있으나 계통(IfcSystem) 정보가 없습니다. 어느 공조기가 어느 토출구를 담당하는지 알 수 없습니다.')
    }
    const unlocated = unlocatedEquipment(result).length
    if (unlocated > 0) {
      warnings.push(`설비 ${unlocated}대의 소속 물리존을 찾지 못했습니다. 이상 알림의 '발생 위치' 가 빈 채로 나갑니다.`)
    }

    const meshes: MeshMap = withMeshes ? readMeshes(api, model, mepIDs, globalIdOf) : new Map()

    if (withMeshes && result.connections.length === 0 && meshes.size > 0) {
      const systemsOf = new Map<string, string[]>()
      for (const system of systems) {
        for (const id of system.memberIds) systemsOf.set(id, [...(systemsOf.get(id) ?? []), system.name])
      }
      result.connections = inferConnections(
        [...meshes].map(([id, mesh]) => ({ id, points: mesh.positions, systems: systemsOf.get(id) ?? null })),
      )
      if (result.connections.length > 0) {
        warnings.push(
          `BIM 에 포트(IfcDistributionPort) 연결이 없어 형상이 맞닿은 것으로 연결 ${result.connections.length}개를 추정했습니다. 흐름 방향은 모릅니다.`,
        )
      }
    }

    return { model: result, meshes }
  } finally {
    api.CloseModel(model)
  }
}
