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
import type { Model, Opening, Space, Storey, Vec2, Wall } from '../model'
import { polygonArea } from '../model'
import { apply, foldChain, fromAxisPlacement, type Transform2 } from './placement'

/** web-ifc 의 Vector 를 평범한 배열로. 이 타입이 코드 곳곳에 번지지 않게 입구에서 바꾼다. */
function toArray(vector: { size(): number; get(i: number): number }): number[] {
  return Array.from({ length: vector.size() }, (_, i) => vector.get(i))
}

/** IFC 값은 대부분 `{ value: … }` 로 한 겹 싸여 있다. */
function val<T>(wrapped: { value?: T } | null | undefined): T | undefined {
  return wrapped?.value
}

type Api = InstanceType<typeof WebIFC.IfcAPI>

class Reader {
  constructor(
    private api: Api,
    private model: number,
  ) {}

  ids(type: number): number[] {
    return toArray(this.api.GetLineIDsWithType(this.model, type))
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
      const loc = rel?.Location ? this.line(rel.Location.value).Coordinates?.map(val) : null
      const dir = rel?.RefDirection ? this.line(rel.RefDirection.value).DirectionRatios?.map(val) : null
      chain.push(fromAxisPlacement(loc ?? null, dir ?? null))
      cur = lp?.PlacementRelTo?.value
    }
    return foldChain(chain)
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
            return apply(t, [c[0], c[1]])
          })
          if (ring.length >= 3) return ring
        }
      }
    }
    return []
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

function spaceOf(r: Reader, expressID: number, warnings: string[]): Space {
  const e = r.line(expressID)
  const id = (val(e?.GlobalId) as string) ?? `space-${expressID}`
  const footprint = r.footprint(e)
  const longName = (val(e?.LongName) as string) ?? ''

  if (footprint.length === 0) {
    warnings.push(`공간 "${longName || id}" 에 FootPrint 표현이 없어 외곽선을 만들지 못했습니다.`)
  }

  return {
    id,
    name: (val(e?.Name) as string) ?? '',
    longName,
    footprint,
    areaM2: polygonArea(footprint),
  }
}

/** IFC 바이트를 읽어 중간 모델을 만든다. 호출부가 api 를 넘겨 초기화를 통제한다. */
export function importIfc(api: Api, bytes: Uint8Array): Model {
  const model = api.OpenModel(bytes)
  try {
    const r = new Reader(api, model)
    const warnings: string[] = []
    const loadBearing = r.loadBearingByElement()

    const firstName = (type: number) => {
      const [id] = r.ids(type)
      return id === undefined ? '' : ((val(r.line(id)?.Name) as string) ?? '')
    }

    // 층 → 공간: 분해 관계
    const spacesByStorey = new Map<number, number[]>()
    for (const relID of r.ids(WebIFC.IFCRELAGGREGATES)) {
      const rel = r.line(relID)
      const parent = rel?.RelatingObject?.value
      if (parent === undefined) continue
      for (const child of rel.RelatedObjects ?? []) {
        const line = r.line(child.value)
        if (line?.type !== WebIFC.IFCSPACE) continue
        const list = spacesByStorey.get(parent) ?? []
        list.push(child.value)
        spacesByStorey.set(parent, list)
      }
    }

    // 층 → 벽·문·창: 포함 관계
    const elementsByStorey = new Map<number, number[]>()
    for (const relID of r.ids(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const rel = r.line(relID)
      const parent = rel?.RelatingStructure?.value
      if (parent === undefined) continue
      const list = elementsByStorey.get(parent) ?? []
      for (const child of rel.RelatedElements ?? []) list.push(child.value)
      elementsByStorey.set(parent, list)
    }

    const storeys: Storey[] = r.ids(WebIFC.IFCBUILDINGSTOREY).map((storeyID) => {
      const e = r.line(storeyID)
      const walls: Wall[] = []
      const openings: Opening[] = []

      for (const elementID of elementsByStorey.get(storeyID) ?? []) {
        const el = r.line(elementID)
        const id = (val(el?.GlobalId) as string) ?? `element-${elementID}`
        const name = (val(el?.Name) as string) ?? ''

        switch (el?.type) {
          case WebIFC.IFCWALL:
          case WebIFC.IFCWALLSTANDARDCASE:
            walls.push({ id, name, loadBearing: loadBearing.get(elementID) ?? null })
            break
          case WebIFC.IFCDOOR:
            openings.push({ id, name, kind: 'door' })
            break
          case WebIFC.IFCWINDOW:
            openings.push({ id, name, kind: 'window' })
            break
        }
      }

      return {
        id: (val(e?.GlobalId) as string) ?? `storey-${storeyID}`,
        name: (val(e?.Name) as string) ?? '',
        elevation: (val(e?.Elevation) as number) ?? 0,
        spaces: (spacesByStorey.get(storeyID) ?? []).map((id) => spaceOf(r, id, warnings)),
        walls,
        openings,
      }
    })

    // 층이 낮은 것부터 보여야 층 선택 목록이 건물과 같은 순서가 된다.
    storeys.sort((a, b) => a.elevation - b.elevation)

    const unknown = storeys.flatMap((s) => s.walls).filter((w) => w.loadBearing === null).length
    if (unknown > 0) {
      warnings.push(
        `벽 ${unknown}장에 Structural(내력) 속성이 없습니다. 내력벽으로 처리하지 않으며, 편집 제한도 걸리지 않습니다.`,
      )
    }

    return {
      schema: api.GetModelSchema(model),
      siteName: firstName(WebIFC.IFCSITE),
      buildingName: firstName(WebIFC.IFCBUILDING),
      storeys,
      warnings,
    }
  } finally {
    api.CloseModel(model)
  }
}
