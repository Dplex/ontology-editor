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

/** 설비 좌표(미터). 설비는 천장·바닥·벽에 붙으므로 높이가 의미를 갖는다. */
export type Vec3 = readonly [number, number, number]

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

export type Equipment = {
  id: string
  name: string
  /** IFC 클래스 이름에서 Ifc 를 뗀 것(UnitaryEquipment, AirTerminal, Sensor …). */
  ifcClass: string
  /**
   * 세계 좌표. **`null` 이면 BIM 에 위치가 없다는 뜻이다.**
   * PRD #13 의 "미배치 목록" 이 이것이고, 사람이 3D 에서 직접 놓아 줘야 한다.
   */
  position: Vec3 | null
  /**
   * 설계 풍량 등 용량 파라미터. `null` 이면 BIM 에 안 적혀 있다.
   * PRD #6 의 "용량 파라미터 누락 설비" 이고, 공조존 용량 검증(Z-03)이 이 값에 걸린다.
   */
  capacity: number | null
  /** 속한 계통(IfcSystem)의 id. `null` 이면 어느 계통에도 안 묶여 있다. */
  systemId: string | null
  /**
   * 소속 물리존의 id. BIM 이 주는 값이 아니라 좌표로 판정한 결과다(PRD #12).
   * `lib/mapping.ts` 가 채우고, 편집으로 경계가 바뀔 때마다 다시 채워야 한다.
   */
  spaceId: string | null
}

/** 계통. 공조기에서 덕트를 지나 토출구까지 이어지는 묶음이다. */
export type System = {
  id: string
  name: string
  memberIds: string[]
}

export type Storey = {
  id: string
  name: string
  /** 층 바닥 높이(미터). */
  elevation: number
  spaces: Space[]
  walls: Wall[]
  openings: Opening[]
  equipment: Equipment[]
}

export type Model = {
  /** IFC 스키마 이름(IFC4 등). 임포트가 무엇을 읽었는지 검토 화면에 보여 준다. */
  schema: string
  siteName: string
  /** IfcBuilding 의 GlobalId. 주어로 쓰므로 이름이 아니라 이걸 쓴다. */
  buildingId: string
  buildingName: string
  storeys: Storey[]
  /** 계통은 층에 속하지 않는다. 여러 층에 걸치는 것이 정상이다. */
  systems: System[]
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
    equipment: sum((s) => s.equipment.length),
    // 좌표가 없는 설비는 자동 배치가 안 되어 사람 손이 필요하다. 그래서 따로 센다.
    unplacedEquipment: sum((s) => s.equipment.filter((e) => e.position === null).length),
    // 용량이 없으면 공조존 용량 검증(Z-03)을 돌릴 수 없다.
    equipmentWithoutCapacity: sum((s) => s.equipment.filter((e) => e.capacity === null).length),
    systems: model.systems.length,
    // 소속 물리존을 못 찾은 설비. 이상 알림의 '발생 위치' 가 비게 된다.
    unlocatedEquipment: sum((s) => s.equipment.filter((e) => e.spaceId === null).length),
  }
}
