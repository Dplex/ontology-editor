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
  /** `kind` 를 누가 정했나. `bim` 이면 `omniclass` 에서, `dict` 면 이름 사전에서 읽었다. */
  kindSource?: 'bim' | 'dict'
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
   */
  positionSource?: 'geometry' | 'edited'
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
  spaceSource: 'bim' | 'computed' | null
  /** 사람이 에디터에서 더한 설비(E7). BIM 에 없던 것이라 화면의 출처가 "편집"이다. */
  added?: true
  /** 사람이 이름(태그)을 고쳤으면 BIM 이 준 이름. 타입·패밀리 묶음은 이 이름으로 잡는다(edit.ts 의 bimName). */
  nameEdited?: { from: string }
  /**
   * 덕트·배관 구간의 두 끝이 연 때 자리에서 얼마나 옮겨졌나(세계 좌표, m). 끝 순서는 연 때 형상의 축(`SegmentAxis`)을 따른다.
   * 붙은 설비를 옮겨 구간이 늘어난 것이다(`followConduits`). 3D 형상은 이 값으로 늘이고, `position` 은 축 위 같은 비율 자리로 간다.
   */
  endShift?: [Vec3, Vec3]
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
  inferred?: { from: string; to: string; systemId: string; confirmed: boolean }
  /**
   * 사람이 에디터에서 정한 흐름 방향. `inferred` 처럼 **포트가 방향을 말하지 않은 연결에만** 붙는다.
   * 규칙이 틀린 곳을 고치거나 규칙이 닿지 못한 곳을 채운다. 규칙 방향보다 앞서고, 사람이 정한
   * 것이라 확정 없이 `brick:feeds` 로 나간다. BIM 포트가 말한 방향은 고칠 수 없다.
   */
  edited?: { from: string; to: string }
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
  /** 설비·배관 사이의 연결. 층을 넘나들므로 계통처럼 모델에 바로 둔다. */
  connections: Connection[]
  /** 임포트가 그냥 넘어간 것들. 조용히 비는 대신 화면에 뜬다. */
  warnings: string[]
  /**
   * 임포트 때 사람이 읽지 않기로 한 피처(ImportOptions). 벽·문·창이 0 이어도 "BIM 에 없다" 가 아니라 "읽지 않았다" 일
   * 수 있어서 따로 적는다. 합치면 어느 한쪽이라도 읽지 않은 것이다.
   */
  skipped?: ('walls' | 'doors' | 'windows')[]
  /** IDF 에서 얹은 공조존과 담당 관계(idf/attach.ts). IFC 만 연 모델에는 없다. */
  hvac?: { source: string; zones: HvacZone[]; equipment: HvacEquipment[] }
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
