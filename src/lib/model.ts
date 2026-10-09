// 에디터가 다루는 중간 모델.
//
// IFC 에서 읽어 들인 결과도, 사용자가 손으로 그린 결과도 전부 이 모양으로 모인다.
// 내보내기(기하는 GeoJSON, 의미는 Brick TTL)는 이 모델만 보고 쓴다. 그래서 임포트와
// 내보내기가 서로를 모른 채 따로 자랄 수 있다.
//
// **id 는 두 출력 파일을 잇는 유일한 끈이다.** IFC 에서 온 것은 IfcGlobalId 를 그대로
// 쓴다. Revit·ArchiCAD 가 재내보내기를 해도 GUID 를 유지하도록 설정할 수 있어서
// (PRD #6 의 내보내기 요구사항), 재임포트 때 같은 공간을 같은 것으로 알아볼 수 있다.

import type { Fluid } from './kinds'

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
  /**
   * 이 물리존을 둘러싼 부재의 id 목록. `IfcRelSpaceBoundary` 에서 온다.
   *
   * 기하 연산으로 유추하지 않아도 BIM 이 직접 알려 주는 관계다. 벽을 지웠을 때 어느
   * 물리존이 영향을 받는지를 이걸로 바로 안다(E4).
   */
  boundedBy: string[]
  /**
   * 방 종류. 이름 사전(`kinds.ts` 의 ROOM_KINDS)이 먼저고, 이름이 모르면 OmniClass 코드로 읽는다. `null` 이면
   * `brick:Room` 으로 나간다. `PredefinedType` 은 방 종류를 말하지 않는다(SPACE·PARKING 같은 것뿐이고 실측 0/4 파일).
   */
  kind?: string | null
  /**
   * BIM 이 적은 바닥 면적(㎡)과 그 속성 자리(OE-MAN-03). 외곽선 없는 물리존 목록에 보이고, 사람이 그린 외곽선의 넓이와 견준다.
   * `areaM2` 는 외곽선으로 잰 넓이라 외곽선이 없으면 0 이다. 기준 물량·Revit 치수 속성이 없으면 칸이 없다(성수 건축은 없다).
   */
  bimArea?: { m2: number; property: string }
  /**
   * `kind` 를 누가 정했나. `bim` 이면 `omniclass` 에서, `dict` 면 이름 사전에서 읽었고, `edit` 면 사람이 정했다(OE-SPC-17, edit.ts 의
   * setSpacesKind). 사람이 정한 종류는 이름을 고쳐도 그대로다.
   */
  kindSource?: 'bim' | 'dict' | 'edit'
  /**
   * OmniClass Table 13 코드(`13-15 11 34 11`). Revit 은 방마다 적는다(병원 건축 269/269). 표준 분류 관계가 먼저고,
   * 없으면 Revit 의 `Category Code` 속성이다. 없으면 `null`.
   */
  omniclass?: string | null
  /**
   * `omniclass` 를 어디서 읽었나. `classification` 은 표준 분류 관계(`IfcClassificationReference`), `property` 는
   * Revit 이 붙인 속성(`Category Code`)이다. 요구사항 보고서가 "표준 자리"와 "다른 자리"를 가른다.
   */
  omniclassSource?: 'classification' | 'property'
  /** 사람이 에디터에서 만든 물리존(생성·분할, E3). BIM 에 없던 것이라 화면의 출처가 "편집"이다. */
  added?: true
  /**
   * 이 물리존에 합쳐 들인 물리존 id(E3 병합). 편집 파일이 "지운 방" 과 "합친 방" 을 가르는 데 쓴다 — 합친 방을 가리키던
   * 문은 남는 방을 가리키고, 지운 방을 가리키던 문은 그 방을 놓는다.
   */
  merged?: string[]
}

export type Wall = {
  id: string
  name: string
  /**
   * 벽 두께(미터). `IfcMaterialLayerSetUsage` 의 재료층 두께를 합한 값이다.
   * `null` 이면 BIM 에 재료 구성이 없다는 뜻이고, 벽을 선으로만 그릴 수 있다.
   */
  thickness: number | null
  /**
   * 내력벽 여부. **`null` 은 "모름" 이지 "아니오" 가 아니다.**
   * BIM 에 Structural 속성이 없으면 null 이 되고, 이 벽들은 검토 화면에 따로 나열된다
   * (PRD #3: 값이 없으면 내벽 규칙을 따른다).
   */
  loadBearing: boolean | null
  /**
   * 외벽 여부(Pset_WallCommon.IsExternal). `null`·없음은 "모름" 이다 — 내력과 같은 까닭으로 false 와 섞지 않는다.
   * 보여 주고 내보내기만 한다 — 문·창은 외벽·내벽 어디에나 놓인다(OE-OBJ-07). 에디터가 그은 벽은 모름으로 시작한다.
   */
  external?: boolean | null
  /** 사람이 외벽 여부를 고쳤다(OE-OBJ-04). 출처가 "편집" 이 되고 계산이 덮지 않는다. `external` 이 null 이면 "모름" 으로 정한 것이다. */
  externalEdited?: true
  /**
   * 벽 높이(미터). 형상(메시)의 위아래 폭으로 잰 값이라 출처는 계산이다. 형상을 읽지 않았거나 에디터가 그은 벽은 `null`·없음(모름) —
   * 층고로 채우지 않는다. 사람이 고치면 그 값이다(OE-OBJ-04 크기 z).
   */
  height?: number | null
  /**
   * 평면 외곽선(고리 여럿일 수 있다). 형상의 맨 아래 면에서 읽는다(`element-geometry.ts`). 형상을 읽지 않는
   * 임포트(`importIfc`)나 아래 면이 없는 벽이면 비어 있다. GeoJSON 에만 나가고 TTL 에는 들어가지 않는다.
   */
  footprint?: Vec2[][]
  /** 사람이 에디터에서 그은 벽(E4). */
  added?: true
}

export type Opening = {
  id: string
  kind: 'door' | 'window'
  name: string
  /** 개구부 너비·높이(미터). BIM 에 없으면 null 이다. */
  width: number | null
  height: number | null
  /**
   * 이 개구부가 뚫린 벽의 id. `IfcRelVoidsElement` 와 `IfcRelFillsElement` 를 타고 찾는다.
   * 로봇 통과 판정(F15)과 벽 편집(E4)이 이 관계를 쓴다.
   */
  wallId: string | null
  /**
   * 로봇이 지나갈 수 있는가.
   *
   * 문은 통과하고 창문은 못 한다(PRD #3). 개구부 종류에서 바로 나오는 값이지만, 소비하는
   * 쪽이 `kind` 의 뜻을 다시 해석하지 않도록 여기서 한 번 정해 둔다.
   */
  passable: boolean
  /** 평면 중심과 바닥 높이. 형상에서 읽는다. 형상이 없으면 null 이다. */
  position?: Vec3 | null
  /**
   * 이 문이 잇는 방. BIM 의 공간 경계가 말하면 그것을(`'bim'`), 없으면 문 양쪽을 좌표로 짚어(`'calc'`) 채운다.
   * 바깥으로 난 문은 방 하나다. 로봇 경로·피난의 방-문-방 그래프가 이걸로 선다.
   */
  connects?: string[]
  connectsSource?: 'bim' | 'calc'
  /** 벽을 뚫는 방향(단위 벡터)과 그 방향 두께(미터). 형상에서 잰다. 옮긴 문의 양쪽 방을 다시 짚을 때 쓴다. */
  through?: Vec2
  depth?: number
  /** 사람이 에디터에서 더한 문·창(E4). */
  added?: true
}

/**
 * IFC 계층이 말하는 역할. `IfcDistributionFlowElement` 의 하위 추상 타입을 그대로 옮긴 것이다.
 *
 * **해석이 아니라 전사다.** "소스", "싱크" 같은 말은 여기서 하지 않는다 — 보일러는 온수의
 * 소스이면서 가스의 싱크라, 한 단어로 찍으면 절반이 틀린다. 쓰는 쪽에서 용도에 맞게
 * 해석하고, 그 해석은 해석한 자리에 주석으로 남긴다.
 *
 * 이 값은 **거의 비지 않는다.** 포트·`IfcSystem`·`PredefinedType` 이 전부 빈 파일에서도
 * 역할은 나온다. IFC 스키마가 클래스 계층으로 강제하기 때문이다. 실측 세 파일에서 설비
 * 3,626대 중 분류가 안 된 것이 1대였다(`docs/ifc-coverage.md` §2).
 */
export type EquipmentRole =
  /** 에너지를 바꾼다. 보일러, 칠러, 공조기, 열교환기 (`IfcEnergyConversionDevice`) */
  | 'conversion'
  /** 흐름을 민다. 펌프, 팬, 압축기 (`IfcFlowMovingDevice`) */
  | 'moving'
  /** 담아 둔다. 탱크 (`IfcFlowStorageDevice`) */
  | 'storage'
  /** 소비하거나 내보낸다. 토출구, 라디에이터, 위생기구, 콘센트 (`IfcFlowTerminal`) */
  | 'terminal'
  /** 거른다. 필터 (`IfcFlowTreatmentDevice`) */
  | 'treatment'
  /** 흐름을 조절한다. 밸브, 댐퍼 (`IfcFlowController`) */
  | 'control'
  /** 도관의 곧은 구간. 덕트·배관 (`IfcFlowSegment`) */
  | 'segment'
  /** 도관의 이음쇠. 엘보, 티, 레듀서 (`IfcFlowFitting`) */
  | 'fitting'
  /** 재거나 움직인다. 센서, 액추에이터 (`IfcDistributionControlElement`) */
  | 'sensing'

/**
 * 도관인가 — 덕트·배관 구간과 이음쇠인가.
 *
 * **이 구분이 없으면 설비 대수가 거짓이 된다.** 실측에서 설비의 85%가 도관이었다
 * (Duplex MEP 926대 중 785대). "설비 926대" 로 DT 에 나가면 기기가 여섯 배로 부푼다.
 * 온톨로지 쪽에서도 자리가 다르다 — 기기는 Brick, 도관은 FSO 가 맡는다.
 */
export function isConduit(role: EquipmentRole | null): boolean {
  return role === 'segment' || role === 'fitting'
}

/** 구간 경로를 쓸 수 없는 까닭(OE-PIP-13). 화면·GeoJSON 이 같은 말을 쓴다. */
export const SEGMENT_PATH_ISSUES = {
  'no-position': '좌표 없음',
  'no-geometry': '형상 없음(경로를 모름)',
  invalid: '좌표 수치가 유효하지 않음',
  'zero-length': '길이 0',
} as const
export type SegmentPathIssue = keyof typeof SEGMENT_PATH_ISSUES
/** 서로 다른 두 끝으로 치는 최소 길이(m). 이보다 짧으면 길이 0 이다. */
export const MIN_SEGMENT_LENGTH = 0.001

/**
 * 끝을 늘이기 전 구간의 배치점과 두 끝(`axis` 와 `position` 이 있을 때). 끝을 늘이면 `position` 은 축 위 같은 비율 t 자리로 가므로
 * (edit.ts 의 applyFollow) 그 몫을 빼면 늘이기 전 배치점이다. 통째로 옮긴 양은 그대로 남는다. 3D 가 그린 배관의 형상을 늘이기 전
 * 모양으로 만들 때도 쓴다.
 */
export function segmentRest(e: Equipment): { at: Vec3; ends: [Vec3, Vec3] } | null {
  if (!e.position || !e.axis) return null
  const [a, b] = e.axis
  const shift = e.endShift ?? [[0, 0, 0], [0, 0, 0]]
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
  const t = len2 === 0 ? 0.5 : Math.min(1, Math.max(0, -(a[0] * d[0] + a[1] * d[1] + a[2] * d[2]) / len2))
  const at: Vec3 = [0, 1, 2].map((k) => e.position![k] - (shift[0][k] * (1 - t) + shift[1][k] * t)) as unknown as Vec3
  const end = (i: 0 | 1): Vec3 => [at[0] + e.axis![i][0], at[1] + e.axis![i][1], at[2] + e.axis![i][2]]
  return { at, ends: [end(0), end(1)] }
}

/**
 * 덕트·배관 구간의 지금 경로(OE-PIP-13). 연 때 중심선(`axis`)을 지금 배치점에 맞춰 놓고 끝이 옮겨진 양(`endShift`)을 더한 두 점이다. 배치점 하나로 경로를
 * 만들지 않고, 좌표·형상이 없거나 길이가 0 이면 그 까닭을 돌려준다. 원본의 (0,0,0) 은 유효한 좌표로 본다. 구간이 아니면 null.
 */
export function segmentPath(e: Equipment): { path: [Vec3, Vec3] } | { issue: SegmentPathIssue } | null {
  if (e.role !== 'segment') return null
  if (!e.position) return { issue: 'no-position' }
  if (!e.axis) return { issue: 'no-geometry' }
  const rest = segmentRest(e)!
  const shift = e.endShift ?? [[0, 0, 0], [0, 0, 0]]
  const end = (i: 0 | 1): Vec3 => [rest.ends[i][0] + shift[i][0], rest.ends[i][1] + shift[i][1], rest.ends[i][2] + shift[i][2]]
  const path: [Vec3, Vec3] = [end(0), end(1)]
  if (!path.every((p) => p.every(Number.isFinite))) return { issue: 'invalid' }
  if (Math.hypot(path[1][0] - path[0][0], path[1][1] - path[0][1], path[1][2] - path[0][2]) < MIN_SEGMENT_LENGTH) return { issue: 'zero-length' }
  return { path }
}

export type Equipment = {
  id: string
  name: string
  /**
   * IFC 의 ObjectType. Revit 은 여기에 "패밀리:유형"(`FCU3:FCU3`, `M_공급 디퓨져_원형:…`)을 적는다.
   * IFC2x3 에서는 클래스가 추상적이라(`FlowTerminal`) 설비 종류를 알 수 있는 곳이 사실상 여기와 이름뿐이다.
   */
  objectType?: string
  /**
   * 설비 종류. 이름·ObjectType 에서 사전(`kinds.ts` 의 EQUIPMENT_KINDS)으로 읽는다. `null` 이면 사전에 없다.
   * Brick 클래스와 흐름 방향 규칙이 이 값을 쓴다.
   */
  kind?: string | null
  /**
   * 사람이 종류를 정했으면 사전이 읽었던 값. 있으면 `kind` 는 사람이 정한 것이다(화면의 출처가 "편집").
   * 사전 값으로 되돌리면 지운다 — 되돌린 것은 변경이 아니다.
   */
  kindEdited?: { from: string | null }
  /** IFC 클래스 이름에서 Ifc 를 뗀 것(UnitaryEquipment, AirTerminal, Sensor …). */
  ifcClass: string
  /**
   * IFC 가 말한 종류. `클래스.PredefinedType`(`AirTerminal.DIFFUSER`)이고 값이 없으면 `클래스` 만이다. IFC2x3 은 개체가
   * 추상적이라(`FlowTerminal`) 타입 객체의 클래스와 값이다. 타입도 없으면 `null`. 이름 사전(`kinds.ts`)의 `ifc` 표로 읽는다.
   */
  declaredType?: string | null
  /** `kind` 를 누가 정했나. `bim` 이면 `declaredType` 에서, `dict` 면 이름 사전에서 읽었다. 사람이 고친 것은 `kindEdited` 가 말한다. */
  kindSource?: 'bim' | 'dict'
  /**
   * IFC 계층에서 읽은 역할. `null` 이면 `IfcDistributionFlowElement` 아래가 아니라는 뜻이고,
   * 그런 것은 드물다(`IfcDistributionChamberElement` 같은 것).
   */
  role: EquipmentRole | null
  /**
   * 세계 좌표. **`null` 이면 BIM 에 위치가 없다는 뜻이다.**
   * PRD #13 의 "미배치 목록" 이 이것이고, 사람이 3D 에서 직접 놓아 줘야 한다.
   */
  position: Vec3 | null
  /**
   * 좌표를 BIM 배치점 말고 다른 데서 얻었으면 그 출처. 없으면 배치점 그대로다.
   * `'geometry'` 는 배치점이 형상에서 멀리 떨어져 형상 중심을 쓴 것(`anchorToGeometry`),
   * `'edited'` 는 사람이 옮긴 것이다. 화면이 이 값으로 "BIM 이 말한 좌표" 와 구별해 보인다.
   * `'panel'` 은 좌표가 없는 분전반 안 부품(보호기)을 같은 층에 하나뿐인 분전반 자리에 놓은 것이다(OE-BIM-07, import.ts 의 placeInPanels).
   */
  positionSource?: 'geometry' | 'edited' | 'panel'
  /**
   * 설계 풍량 등 용량 파라미터. `null` 이면 BIM 에 안 적혀 있다.
   * PRD #6 의 "용량 파라미터 누락 설비" 이고, 공조존 용량 검증(Z-03)이 이 값에 걸린다.
   */
  capacity: number | null
  /**
   * 용량을 읽어 온 속성 이름. 표준 Pset 이름으로 들어오는 일이 드물어서 출처를 남긴다.
   * 고객사와 BIM 스펙을 맞출 때 "지금 이 이름으로 들어온다" 는 근거가 된다.
   */
  capacityProperty: string | null
  /** 속한 계통(IfcSystem)의 id. `null` 이면 어느 계통에도 안 묶여 있다. */
  systemId: string | null
  /** 사람이 계통을 바꿨으면 BIM 이 말한 계통(E8). 되돌리면 지운다. 화면의 출처가 "편집"이 된다. */
  systemEdited?: { from: string | null }
  /**
   * 소속 물리존의 id. 편집으로 경계가 바뀌면 다시 채워야 한다(PRD #12).
   */
  spaceId: string | null
  /**
   * 소속을 어떻게 정했나.
   *
   * `'bim'` 은 BIM 이 `IfcRelContainedInSpatialStructure` 로 직접 말한 것이고,
   * `'computed'` 는 좌표가 어느 외곽선에 드는지 우리가 계산한 것이다. **BIM 이 말한 것이
   * 우선한다** — 설계자가 정한 소속이 좌표 판정보다 정확하고, 벽에 걸친 설비처럼 판정이
   * 애매한 경우에도 답이 하나로 정해진다.
   */
  spaceSource: 'bim' | 'computed' | 'edit' | null
  /**
   * 사람이 지정한 소속 물리존(OE-MAP-01 "사람의 소속 지정", K17). 기계 판정과 따로 둔다 — 기계가 확신하지 못할 때(소속 허용 거리로
   * 붙었거나 소속 없음)만 쓰고, 그때 `spaceSource` 가 `'edit'` 이다. 기계가 확신하게 되면(BIM 명시 소속·외곽선 안) 쓰지 않는다
   * ("사람 지정 해제", mapping.ts 의 spaceSetState). 지정은 설비를 옮기거나 사람이 지울 때만 없어진다.
   */
  spaceSet?: string
  /** 사람이 에디터에서 더한 설비(E7). BIM 에 없던 것이라 화면의 출처가 "편집"이다. */
  added?: true
  /** 사람이 이름(태그)을 고쳤으면 BIM 이 준 이름. 타입·패밀리 묶음은 이 이름으로 잡는다(edit.ts 의 bimName). */
  nameEdited?: { from: string }
  /**
   * 사람이 벽 면에 붙인 설비의 벽 id(OE-OBJ-04, 외벽 루버·외기 센서). 벽을 옮기면 같이 가고, 길이·두께를 바꾸면 벽 면으로
   * 다시 붙고, 벽을 지우거나 설비를 따로 옮기면 떨어진다(edit.ts 의 mountOnWall). BIM 에서 온 설비에는 없다.
   */
  wallId?: string
  /**
   * 덕트·배관 구간의 두 끝이 연 때 자리에서 얼마나 옮겨졌나(세계 좌표, m). 끝 순서는 연 때 형상의 축(`SegmentAxis`)을 따른다.
   * 붙은 설비를 옮겨 구간이 늘어난 것이다(`followConduits`). 3D 형상은 이 값으로 늘이고, `position` 은 축 위 같은 비율 자리로 간다.
   */
  endShift?: [Vec3, Vec3]
  /**
   * 덕트·배관 구간의 중심선 두 끝을 **연 때 `position` 에서 잰 상대 좌표**(m). 임포트가 형상이 있는 구간에만 채운다(conduit-mesh.ts 의
   * `segmentAxisOf`). 상대로 두는 것은 구간을 통째로 옮긴 것(`position` 만 바뀐다)과 끝을 늘인 것(`endShift`)을 함께 따라가기 위해서다.
   * 지금 경로는 `segmentPath` 가 세우고, GeoJSON 의 LineString 이 된다(OE-PIP-13).
   */
  axis?: [Vec3, Vec3]
  /**
   * 사람이 그린 배관의 Flow Type(OE-OBJ-12·OE-PIP-11, flow-type.ts 의 코드). 그린 구간·이음쇠에만 있다. BIM 배관은 계통으로 가른다.
   */
  flowType?: string
  /**
   * 사람이 정한 설치면(OE-EQP-05). z 로 판정하지 못한 설비(미정)에 정한다. 있으면 판정보다 앞선다(ceiling.ts 의 judgeSurface).
   * BIM 에는 없고 편집 파일에 남는다.
   */
  surfaceSet?: 'ceiling' | 'floor' | 'wall'
}

/** 계통. 공조기에서 덕트를 지나 토출구까지 이어지는 묶음이다. */
export type System = {
  id: string
  name: string
  memberIds: string[]
  /**
   * 계통을 어디서 알았나.
   *
   * `'ifc'` 는 `IfcSystem` 으로 묶인 것이고, `'property'` 는 IfcSystem 이 없는 파일에서
   * Revit 이 요소마다 붙인 `System Name` 속성을 모아 만든 것이다. Duplex MEP 판본은
   * IfcSystem 이 0 인데 요소 811개에 이 속성이 있었다. 고객사 스펙을 맞출 때 어느 쪽으로
   * 들어오는지가 근거가 된다.
   */
  source: 'ifc' | 'property' | 'edit'
  /** 사람이 에디터에서 만든 계통(E8). 화면의 출처가 "편집"이다. */
  added?: true
  /**
   * 계통 종류(급기·배기·순환수 공급 …). Revit 은 IfcSystem 의 ObjectType 에 시스템 분류를 적는다.
   * 흐름 방향 규칙(`flow-rules.ts`)이 이 값으로 매체(공기·물)와 방향(원천에서 나가는가, 들어오는가)을 정한다.
   */
  kind?: string | null
  /** `kind` 를 누가 정했나. `bim` 이면 PredefinedType 과 약어(kinds.ts 의 SYSTEM_IFC)에서, `dict` 면 이름 사전에서 읽었다. */
  kindSource?: 'bim' | 'dict'
  /**
   * 순환수의 유체(냉수·온수·냉각수). 순환수 공급·환수에만 있다. PredefinedType(HEATING·CHILLEDWATER)이 먼저고 없으면
   * 이름이다(kinds.ts 의 resolveFluid). 둘 다 말하지 않으면 배관을 따라 닿는 원천 기기로 짐작한다(`rule`, 냉동기면 냉수).
   * 모르면 null.
   */
  fluid?: Fluid | null
  /** `rule` 은 원천 기기로 짐작한 것이라 종류·연결이 바뀌면 다시 짐작한다(flow-rules.ts 의 inferFluids). */
  fluidSource?: 'bim' | 'dict' | 'rule'
  /** 사람이 종류·유체를 고쳤으면 BIM·사전이 읽었던 값(E8). 사전 값으로 되돌리면 지운다. */
  kindEdited?: { kind: string | null; fluid: Fluid | null }
}

/**
 * 설비·배관 두 개가 이어져 있다는 사실. 온톨로지의 `brick:feeds` 가 여기서 나온다.
 *
 * **출처와 방향을 따로 든다.** BIM 이 포트(IfcDistributionPort)로 말한 연결은 SOURCE→SINK
 * 로 흐름 방향까지 알려 주지만, 포트가 없는 파일에서 형상이 맞닿은 것으로 추정한 연결은
 * 방향을 모른다. 둘을 섞으면 "추정한 것" 이 "BIM 이 말한 것" 처럼 온톨로지에 들어간다.
 */
export type Connection = {
  /** directed 가 참이면 흐름이 from 에서 to 로 간다. 거짓이면 두 끝의 순서에 뜻이 없다. */
  from: string
  to: string
  /** `manual` 은 사람이 에디터에서 이은 것이다. 방향 없이 시작하고, 방향을 정해야 `brick:feeds` 로 나간다. */
  source: 'port' | 'geometry' | 'manual'
  directed: boolean
  /**
   * 형상 추정이 **이 거리 안에서 맞닿은 것으로 보았다**(미터). 포트에서 온 연결은 `null` 이다.
   *
   * 기본값보다 큰 값은 고립된 요소를 살리려고 그 주변에서만 넓혀 이은 것이다. 같은
   * `'geometry'` 여도 확신의 정도가 다르므로 섞지 않는다 — 검토 화면이 이 값으로
   * "5mm 에서 붙은 것" 과 "32mm 까지 늘려서 붙인 것" 을 구별해 보여 준다.
   */
  tolerance: number | null
  /**
   * 규칙으로 정한 흐름 방향. **포트가 방향을 말하지 않은 연결에만 붙는다**(directed 가 거짓일 때).
   *
   * 계통 종류(급기면 원천 → 말단)와 설비 종류(공조기·FCU 는 공기의 원천)로 경로를 따라 정한 것이라
   * BIM 이 말한 방향과 다르다. 그래서 `directed`·`from`·`to` 를 건드리지 않고 따로 든다. 섞으면
   * 온톨로지를 읽는 쪽이 둘을 구별할 수 없다. 사람이 에디터에서 계통 단위로 확인하면 `confirmed`
   * 가 되고, 그때부터 `brick:feeds` 로 나간다.
   */
  inferred?: {
    from: string
    to: string
    systemId: string
    confirmed: boolean
    /**
     * 확정한 뒤 근거가 바뀐 규칙 방향(OE-PIP-07). 규칙을 다시 돌려 얻은 새 방향이고, 새로 정할 수 없게 됐으면 `null` 이다. 있으면
     * 재검토 중이라 `brick:feeds` 로 내보내지 않는다. 확정한 방향(`from`·`to`)은 그대로 두고, 다시 확정하면 새 방향으로 바뀐다.
     * 규칙을 돌릴 때마다 새로 재므로 근거가 되돌아오면 저절로 없어진다.
     */
    recheck?: { from: string; to: string } | null
  }
  /**
   * 사람이 에디터에서 정한 흐름 방향. `inferred` 처럼 **포트가 방향을 말하지 않은 연결에만** 붙는다.
   * 규칙이 틀린 곳을 고치거나 규칙이 닿지 못한 곳을 채운다. 규칙 방향보다 앞서고, 사람이 정한
   * 것이라 확정 없이 `brick:feeds` 로 나간다. BIM 포트가 말한 방향은 고칠 수 없다.
   *
   * `at`·`reason` 은 패널에서 [적용] 한 시각과 보정 사유다(OE-PIP-04). 규칙 방향과 반대로 정할 때만 사유를 받는다. 편집 파일만
   * 얹은 옛 파일의 방향에는 없다.
   */
  edited?: { from: string; to: string; at?: string; reason?: string }
}

/** 해제 보정한 BIM 포트 연결(OE-PIP-06). */
export type ReleasedConnection = {
  /** 원본 연결. 방향(`directed`·`from`·`to`)을 고치지 않고 들고 있다가 취소하면 그대로 `connections` 로 돌아간다. */
  connection: Connection
  /** 해제할 때 `connections` 에서의 자리. 취소하면 이 자리로 돌아가 3D·표의 순서가 해제 전과 같다. */
  index: number
  /** 해제한 시각(ISO). */
  at: string
  reason: string
  /**
   * 다시 연 판본에서 원본과 맞지 않은 것. 사람이 보기 전에는 유효 연결로 돌리지 않는다(내보내지 않는다).
   * - `direction`: 같은 두 설비 사이 포트 연결은 있으나 방향이 바뀌었다. `connection` 은 새 판본의 연결이다.
   * - `missing`: 두 설비 사이 포트 연결을 못 찾았다. `connection` 은 파일에 적힌 것으로 만든 것이라 모델에 없다.
   */
  review?: 'direction' | 'missing'
}

/**
 * 연결 편집 이력 한 줄. `keep` 은 재검토를 보고 해제를 유지한 것, `drop` 은 원본을 못 찾은 보정을 지운 것이다.
 * `flow`·`unflow` 는 사람이 방향을 적용·해제한 것이고(OE-PIP-04) 그때 `from`·`to` 는 흐름 방향이다.
 */
export type ConnectionLogEntry = {
  action: 'release' | 'restore' | 'keep' | 'drop' | 'flow' | 'unflow'
  from: string
  to: string
  at: string
  reason: string
}

/**
 * 공조존(F12). IDF 의 Zone 이다(PRD 1.6 이 IDF 를 출처로 둔다). 바닥 외곽선은 GeoJSON 에, 담당 관계와 든 방은 TTL 에
 * 나간다(`brick:HVAC_Zone`, `brick:hasPart` 방, 설비 `brick:feeds` 존).
 */
export type HvacZone = {
  id: string
  name: string
  /** 바닥 높이로 맞춘 층. 못 맞추면 null. */
  storeyId: string | null
  /** 바닥 외곽선. 맞댄 조각은 합쳤고 떨어진 조각은 여럿으로 남는다. */
  footprint: Vec2[][]
  areaM2: number
  /** IDF 의 Zone 이 적은 바닥 넓이. DesignBuilder 는 순 넓이를 적고 바닥면은 벽 중심선까지 그려서 늘 작다. */
  declaredAreaM2: number | null
  /** 이 공조존에 든 물리존. 방 바닥의 절반 넘게를 이 존이 덮는다(idf/attach.ts). */
  spaceIds: string[]
  /** 든 물리존마다 이 존이 덮는 몫(0~1). 외곽선이 자기 교차해 넓이를 못 잰 방은 없다. */
  spaceShares?: Record<string, number>
  /** 사람이 만든 공조존이면 `edit`(OE-ZON-01·02, hvac-zone.ts). IDF 로 불러온 것은 칸이 없다. */
  source?: 'edit'
  /** 담당 설비(BIM 설비 id). TTL 에서 그 설비가 이 존을 `brick:feeds` 한다. 사람이 만든 공조존만 갖는다(IDF 는 HvacEquipment.feeds). */
  servedBy?: string[]
  /** 경계를 그려 만든 공조존(OE-ZON-02). 담당 물리존이 겹침으로 정해졌다. 없으면 고른 물리존의 합집합이다. */
  drawn?: true
}

/** IDF 가 말한 공조 설비(공조기·말단·실외기·실내기). 좌표는 IDF 에 없다. */
export type HvacEquipment = {
  id: string
  name: string
  idfClass: string
  kind: string | null
  /** 이름이 하나의 BIM 설비와 맞으면 그 id. TTL 은 이 설비에 담당 관계를 얹는다. */
  bimId: string | null
  /** 공급하는 공조존·IDF 설비의 id. */
  feeds: string[]
  /** 담당하는 존이 한 층에만 있으면 그 층(말단). 공조기·실외기는 모른다. */
  storeyId?: string
}

export type Storey = {
  id: string
  name: string
  /** 층 바닥 높이(미터). */
  elevation: number
  /**
   * BIM 이 적은 층 높이(미터, OE-BIM-02). 적은 것이 없으면 키가 없다. `gross` 는 바닥에서 윗층 바닥까지(층고), `net` 은
   * 윗층 바닥판 아래까지다. `property` 는 읽은 자리(`BaseQuantities.GrossHeight`). 층고를 계산한 값(Elevation 의 차)은
   * 모델에 두지 않는다 — storey-height.ts 가 그때 잰다.
   */
  declaredHeight?: { gross: number | null; net: number | null; property: string }
  /**
   * 사람이 이 층을 완료로 표시한 것(OE-MAN-06). `sig` 는 그때 층의 지문이다 — 지금 지문과 다르면 "완료 뒤 고침" 이다
   * (storey-progress.ts). BIM 에는 없고 편집 파일에 남는다.
   */
  done?: { at: string; sig: string }
  /**
   * BIM 이 말한 반자 높이 h_c(층 바닥 기준, 미터, OE-EQP-03). 못 읽었으면 키가 없다 — 0 이나 층고로 채우지 않는다. 층 값은 그 층
   * 방(천장재)들의 가운데 값이고, `property` 는 읽은 자리, `count` 는 값을 낸 방·천장재 수다. 고르는 순서는 ceiling.ts.
   */
  ceiling?: { height: number; property: string; count: number }
  /** 사람이 정한 반자 높이(미터, OE-EQP-03 ④). 있으면 `ceiling` 보다 앞선다. BIM 에는 없고 편집 파일에 남는다. */
  ceilingSet?: number
  spaces: Space[]
  walls: Wall[]
  openings: Opening[]
  equipment: Equipment[]
  /** 운영자가 정한 커스텀존(OE-OBJ-01, custom-zone.ts). BIM 에는 없어 연 직후에는 없다. */
  customZones?: CustomZone[]
  /** 사람이 만든 공조존(OE-ZON-01·02, hvac-zone.ts). R1 에서 공조존을 만드는 유일한 길이다. 연 직후에는 없다. */
  hvacZones?: HvacZone[]
  /** 사람이 물리존 안에 그린 룸(OE-OBJ-03, room.ts). 임포트는 만들지 않아 연 직후에는 없다. */
  rooms?: Room[]
  /** 사람이 놓은 추가 공간 오브젝트(OE-OBJ-09, space-object.ts). 임포트는 만들지 않아 연 직후에는 없다. */
  spaceObjects?: SpaceObject[]
  /**
   * 이 층을 지나는 수직 관통 오브젝트의 층별 조각(OE-ML-02, vertical-object.ts). 같은 `parentId` 의 조각들이 오브젝트 하나다.
   * 지금은 BIM 의 계단(IfcStair)만 임포트가 만든다. 형상을 읽는 임포트에서만 생긴다.
   */
  verticalParts?: VerticalPart[]
}

/** 수직 관통 오브젝트의 종류(glossary: EL·ES·계단·샤프트). */
export type VerticalKind = 'stair' | 'escalator' | 'elevator' | 'shaft'

/**
 * 수직 관통 오브젝트의 한 층 조각(OE-ML-02). 오브젝트는 따로 두지 않고 `parentId` 가 같은 조각을 모아 본다 — 층별 표현이 곧 데이터라서
 * 층 단위 저장·합치기가 다른 층 요소와 같은 길을 탄다. 연관 물리존은 저장하지 않고 진입·종료점으로 그때 짚는다(물리존을 고쳐도 낡은 id 가
 * 남지 않는다).
 */
export type VerticalPart = {
  /** 오브젝트 id. BIM 이면 IfcStair 의 GlobalId 다. */
  parentId: string
  kind: VerticalKind
  name: string
  source: 'bim' | 'edit'
  /** 이 층에 그리는 평면 형상(닫지 않은 고리). 오브젝트가 끝나는 층처럼 그릴 것이 없으면 빈 배열이다. */
  footprint: Vec2[]
  /** 이 층에서 오르기 시작하는 자리(아래 끝, 세계 좌표). 시작 층에만 있다. */
  entry: Vec3 | null
  /** 이 층에 다다르는 자리(위 끝, 세계 좌표). 끝 층에만 있다. 사이 층은 진입·종료 모두 없다. */
  exit: Vec3 | null
  /** 사람이 다중층 뷰에서 고친 조각(OE-ML-07). BIM 원본 형상은 baseline 에 남는다(vertical-edit.ts). */
  edited?: true
}

/**
 * 추가 공간 오브젝트(OE-OBJ-09). 책상·의자·소파처럼 공간을 꾸미는 사물이다. 층 바닥에 서고, 서로 겹치지 않는다(space-object.ts).
 * 모양은 라이브러리 항목(`item`)의 3D 모델을 `size` 상자에 맞춰 늘인 것이다.
 */
export type SpaceObject = {
  /** 에디터가 지은 id(`U_…`). */
  id: string
  name: string
  /** 라이브러리 항목 열쇠(space-object.ts 의 LIBRARY, 또는 사람이 넣은 모델의 `custom:…`). */
  item: string
  /** 바닥 가운데 자리(세계 평면 좌표). */
  at: Vec2
  /** 가로(x)·세로(y)·높이(미터). 축에 나란한 상자다. */
  size: Vec3
}

/** 사람이 넣은 3D 모델로 만든 라이브러리 항목(OE-P3-08). 파일을 그대로 들고 있어 편집 파일에 같이 남는다. */
export type CustomObjectItem = {
  /** `custom:` 로 시작한다. 내장 항목과 겹치지 않는다. */
  key: string
  name: string
  /** 넣을 때 모델 상자에서 잰 기본 크기(가로·세로·높이, 미터). */
  size: Vec3
  /** glb 파일 내용(base64). */
  glb: string
}

/** 룸(OE-OBJ-03). 물리존 안의 사각 편집 단위. 다른 룸과 겹치지 않고 부모 물리존 밖으로 나가지 않는다(room.ts). */
export type Room = {
  /** 에디터가 지은 id(`U_…`). */
  id: string
  name: string
  /** 든 물리존(부모). */
  spaceId: string
  /** 닫힌 사각 고리(축에 나란하다, 왼아래부터 반시계). 세계 좌표. */
  footprint: Vec2[]
}

/** 커스텀존(F14). 물리존 위에 운영 편의로 정하는 다각형. 겹쳐도 된다(custom-zone.ts). */
export type CustomZone = {
  /** 에디터가 지은 id(`U_…`). TTL 주어와 GeoJSON feature id 가 이것이다. */
  id: string
  /** 별명. 사람이 부르는 이름(임원석·식당). TTL rdfs:label 이다. */
  name: string
  /**
   * 더 붙인 별명(2026-10-03 사용자 결정 — 별명은 여러 개, ADR-0012). `name` 과 겹치지 않고 비지 않는다. 없으면 키가 없다.
   * TTL `ex:alias`, GeoJSON `aliases`.
   */
  aliases?: string[]
  /** 닫힌 고리(첫 점 = 끝 점). 세계 좌표. */
  footprint: Vec2[]
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
  /** 설비·배관 사이의 연결. 층을 넘나들므로 계통처럼 모델에 바로 둔다. */
  connections: Connection[]
  /**
   * 사람이 '연결 해제 보정' 한 BIM 포트 연결(OE-PIP-06, connection-release.ts). `connections` 에서 빼 여기 둔다 — 연결을 읽는
   * 곳(규칙 방향·계통 추적·TTL `brick:feeds`)이 따로 거르지 않아도 해제한 연결을 보지 않는다. 원본 연결 객체와 방향은 그대로다.
   * BIM 에는 없어 연 직후에는 없다.
   */
  releasedConnections?: ReleasedConnection[]
  /** 해제 보정·취소·재검토 확인의 이력. 되돌리기로 무른 것은 남지 않는다. */
  connectionLog?: ConnectionLogEntry[]
  /** 임포트가 그냥 넘어간 것들. 조용히 비는 대신 화면에 뜬다. */
  warnings: string[]
  /**
   * 임포트 때 사람이 읽지 않기로 한 피처(ImportOptions). 벽·문·창이 0 이어도 "BIM 에 없다" 가 아니라 "읽지 않았다" 일
   * 수 있어서 따로 적는다. 합치면 어느 한쪽이라도 읽지 않은 것이다.
   */
  skipped?: ('walls' | 'doors' | 'windows')[]
  /** IDF 에서 얹은 공조존과 담당 관계(idf/attach.ts). IFC 만 연 모델에는 없다. */
  hvac?: { source: string; zones: HvacZone[]; equipment: HvacEquipment[] }
  /** 사람이 넣은 3D 모델 라이브러리 항목(OE-P3-08). 층에 속하지 않는다. */
  objectLibrary?: CustomObjectItem[]
  /**
   * 모델 요소로는 남지 않는 파일의 사실. 요구사항 보고서(requirements.ts)가 쓴다. 손으로 만든 모델에는 없다.
   * 두 파일을 합치면 둘 다 참일 때만 참이다(위경도는 한쪽만 있어도 참).
   */
  facts?: {
    /** 길이 단위를 선언했나(R6). 없으면 미터로 가정했다. */
    lengthUnit: boolean
    /** IfcMapConversion 이 있나(R7). IFC4 부터 있는 자리다. */
    mapConversion: boolean
    /** IfcSite 에 위경도가 있나. 지도에 대략 얹을 수는 있지만 스캔과 맞출 수는 없다. */
    siteLatLong: boolean
    /**
     * 파일의 IfcBuildingElementProxy(OE-BIM-13). 포트가 있거나(ported) 이름이 사전에 있어(named) 설비로 읽은 것과, 둘 다 아니라
     * 건축 부재로 보고 읽지 않은 것의 이름 예(앞 5가지). 읽지 않은 수 = total - ported - named(- louvers). 빠진 설비가 없는지 사람이 본다.
     */
    /** `louvers` 는 이름이 외부 루버인데 포트가 없어 건축 루버로 보고 받지 않은 수다(OE-EXT-05). 예전 파일에는 없다. */
    proxies?: { total: number; ported: number; named: number; louvers?: number; skipped: string[] }
  }
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

/**
 * 미배치 목록(OE-BIM-07). BIM 에 좌표가 없어 3D·평면에 그려지지 않는 설비와 그 층. 층은 BIM 이 말한 것이라 놓을 바닥을
 * 정할 수 있다. 사람이 놓으면(E6) 좌표가 생겨 빠지고, 좌표 없이 더한 설비는 들어온다. 개수는 `countOf().unplacedEquipment` 와 같다.
 */
export function unplacedOf(model: Model): { equipment: Equipment; storey: Storey }[] {
  return model.storeys.flatMap((storey) => storey.equipment.filter((e) => e.position === null).map((equipment) => ({ equipment, storey })))
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
    // 설비를 기기와 도관으로 나눠 센다. 합치면 대수가 거짓이 된다 — isConduit 의 주석 참조.
    devices: sum((s) => s.equipment.filter((e) => !isConduit(e.role)).length),
    conduits: sum((s) => s.equipment.filter((e) => isConduit(e.role)).length),
    // 좌표가 없는 설비는 자동 배치가 안 되어 사람 손이 필요하다. 그래서 따로 센다.
    unplacedEquipment: sum((s) => s.equipment.filter((e) => e.position === null).length),
    // 용량이 없으면 공조존 용량 검증(Z-03)을 돌릴 수 없다.
    equipmentWithoutCapacity: sum((s) => s.equipment.filter((e) => e.capacity === null).length),
    systems: model.systems.length,
    connections: model.connections.length,
    // 흐름 방향까지 아는 연결. 이것만 brick:feeds 로 나간다.
    directedConnections: model.connections.filter((c) => c.directed).length,
    // 소속 물리존을 못 찾은 설비. 이상 알림의 '발생 위치' 가 비게 된다.
    unlocatedEquipment: sum((s) => s.equipment.filter((e) => e.spaceId === null).length),
  }
}
