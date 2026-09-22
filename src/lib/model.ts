// 에디터가 다루는 중간 모델.
//
// IFC 에서 읽어 들인 결과도, 사용자가 손으로 그린 결과도 전부 이 모양으로 모인다.
// 내보내기(기하는 GeoJSON, 의미는 Brick TTL)는 이 모델만 보고 쓴다. 그래서 임포트와
// 내보내기가 서로를 모른 채 따로 자랄 수 있다.
//
// **id 는 두 출력 파일을 잇는 유일한 끈이다.** IFC 에서 온 것은 IfcGlobalId 를 그대로
// 쓴다. Revit·ArchiCAD 가 재내보내기를 해도 GUID 를 유지하도록 설정할 수 있어서
// (PRD #6 의 내보내기 요구사항), 재임포트 때 같은 공간을 같은 것으로 알아볼 수 있다.

/** 평면 좌표(미터). z 는 층 elevation 으로 따로 들고 있으므로 여기 넣지 않는다. */
export type Vec2 = readonly [number, number]

export type Space = {
  id: string
  /** IFC 의 Name. ArchiCAD·Revit 에서는 방 번호가 들어오는 일이 많다. */
  name: string
  /** IFC 의 LongName. 사람이 부르는 이름(예: Buero, 회의실)이 여기 있다. */
  longName: string
  /** 닫힌 고리. 첫 점과 끝 점이 같다. 세계 좌표로 변환된 뒤의 값이다. */
  footprint: Vec2[]
  areaM2: number
}

export type Wall = {
  id: string
  name: string
  /**
   * 내력벽 여부. **`null` 은 "모름" 이지 "아니오" 가 아니다.**
   * BIM 에 Structural 속성이 없으면 null 이 되고, 이 벽들은 검토 화면에 따로 나열된다
   * (PRD #3: 값이 없으면 내벽 규칙을 따른다).
   */
  loadBearing: boolean | null
}

export type Opening = {
  id: string
  kind: 'door' | 'window'
  name: string
}

export type Storey = {
  id: string
  name: string
  /** 층 바닥 높이(미터). */
  elevation: number
  spaces: Space[]
  walls: Wall[]
  openings: Opening[]
}

export type Model = {
  /** IFC 스키마 이름(IFC4 등). 임포트가 무엇을 읽었는지 검토 화면에 보여 준다. */
  schema: string
  siteName: string
  buildingName: string
  storeys: Storey[]
  /** 임포트가 그냥 넘어간 것들. 조용히 비는 대신 화면에 뜬다. */
  warnings: string[]
}

/** 신발끈 공식. 고리의 방향과 무관하게 넓이를 돌려주려고 절댓값을 취한다. */
export function polygonArea(ring: readonly Vec2[]): number {
  if (ring.length < 3) return 0
  let sum = 0
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  // 닫히지 않은 고리도 받아 준다. 마지막 점에서 첫 점으로 한 변을 더 잇는다.
  const last = ring[ring.length - 1]
  const first = ring[0]
  if (last[0] !== first[0] || last[1] !== first[1]) {
    sum += last[0] * first[1] - first[0] * last[1]
  }
  return Math.abs(sum) / 2
}

/** 층·공간·벽 개수를 한 번에 센다. 검토 화면과 테스트가 같은 값을 본다. */
export function countOf(model: Model) {
  const sum = (f: (s: Storey) => number) => model.storeys.reduce((n, s) => n + f(s), 0)
  return {
    storeys: model.storeys.length,
    spaces: sum((s) => s.spaces.length),
    walls: sum((s) => s.walls.length),
    doors: sum((s) => s.openings.filter((o) => o.kind === 'door').length),
    windows: sum((s) => s.openings.filter((o) => o.kind === 'window').length),
    loadBearingWalls: sum((s) => s.walls.filter((w) => w.loadBearing === true).length),
    unknownLoadBearingWalls: sum((s) => s.walls.filter((w) => w.loadBearing === null).length),
  }
}
