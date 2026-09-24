// 설비·방·계통의 종류를 이름에서 읽는 사전.
//
// **왜 이름을 읽나.** IFC2x3 은 설비 클래스가 추상적이라(`IfcFlowTerminal` 하나에 디퓨저·그릴·조명이
// 다 들어간다) 표준 필드만으로는 종류를 알 수 없고, Revit 은 공조기·FCU 를 `IfcBuildingElementProxy`
// 로 내보내기도 한다(성수 기계 파일: FCU 120대, AHU 8대, GSHP 12대). 그래도 Revit 은 패밀리 이름을
// Name 과 ObjectType 에 남긴다(`FCU3:FCU3:123456`). 사람이 붙인 그 이름이 남은 근거다.
//
// **사전은 좁게 둔다.** 아는 이름만 종류를 붙이고, 모르면 `null` 로 남긴다. 추측으로 넓히면
// 틀린 Brick 클래스가 온톨로지에 들어가는데, 그건 빈칸보다 나쁘다. 순서가 뜻을 가진다 — 위에
// 있는 규칙이 먼저 이긴다(`FCU` 가 `fan` 보다, `heat pump` 가 `pump` 보다 먼저다).
//
// **Brick 클래스는 받는 쪽 어휘를 먼저 따른다.** DT 는 ieum-pipeline 의 ttl.go 로 읽고, 그쪽 표
// (equipClass)에 있는 이름(`Air_Handling_Unit`, `Fan_Coil_Unit`, `Indoor_Unit` …)이어야 설비 타입이
// 붙는다. `Indoor_Unit` 은 Brick 1.4 에 없지만 SR 온톨로지가 3,028개를 그 이름으로 쓴다. 나머지는
// Brick 1.4 에 실제로 있는 이름만 쓰고, 없으면(`Silencer`, `Grille`) `null` 로 두어 `ex:` 로 나간다.

import type { EquipmentRole } from './model'

/** 계통의 매체. 공조기는 공기의 원천이면서 물의 소비처라, 매체를 알아야 역할이 정해진다. */
export type Medium = 'air' | 'water'

/** 흐름에서 맡는 자리. `source` 는 흐름을 내보내는 쪽(원천), `sink` 는 받는 쪽, `through` 는 지나가는 쪽. */
export type FlowPart = 'source' | 'sink' | 'through'

export type EquipmentKindInfo = {
  kind: string
  /** 화면에 보이는 이름. */
  label: string
  /** 한 줄에 대해 이름·ObjectType 을 합친 문자열로 검사한다. */
  test: RegExp
  /** Brick 클래스. `null` 이면 알맞은 클래스가 없어 `ex:` 로 나간다. */
  brick: string | null
  /**
   * IFC 계층이 역할을 못 준 요소(Proxy)에 붙일 역할. IFC 가 역할을 준 요소는 그 값을 그대로 둔다.
   */
  role: EquipmentRole | null
  /** 매체별 흐름 자리. 없는 매체는 그 계통에서 이 종류가 원천이 아니라는 뜻이다. */
  flow: Partial<Record<Medium, FlowPart>>
  /** 관제점 후보(F13)인가. 감지기·카메라처럼 BAS 가 값을 들고 있을 만한 장치. */
  point?: boolean
  /**
   * 사람만 고르는 종류. 사전은 이 이름을 읽지 않는다(`test` 가 아무것에도 맞지 않는다). 편집 화면에서 고를 수는
   * 있어야 하는데 사전을 넓히면 가진 BIM 전부의 숫자가 움직여서(CLAUDE.md 의 과적합 규칙) 따로 둔다.
   */
  manual?: true
}

/** 아무 이름에도 맞지 않는 식. 사람만 고르는 종류의 `test` 다. */
const NEVER = /(?!)/

export const EQUIPMENT_KINDS: EquipmentKindInfo[] = [
  // --- 공조 기기 ---------------------------------------------------------------
  // OHU 는 외기 공조기(Outdoor air Handling Unit)다. 공조기와 같이 본다.
  { kind: 'ahu', label: '공조기', test: /\b[AO]HU|공조기|air\s*handl/i, brick: 'brick:Air_Handling_Unit', role: 'conversion', flow: { air: 'source', water: 'sink' } },
  { kind: 'fcu', label: 'FCU', test: /\bFCU|팬\s*코일|fan\s*coil/i, brick: 'brick:Fan_Coil_Unit', role: 'conversion', flow: { air: 'source', water: 'sink' } },
  { kind: 'indoor_unit', label: '시스템에어컨 실내기', test: /시스템\s*에어컨|실내기|indoor\s*unit|\bIDU\b/i, brick: 'brick:Indoor_Unit', role: 'conversion', flow: { air: 'source' } },
  { kind: 'vav', label: 'VAV', test: /\bVAV\b/i, brick: 'brick:Variable_Air_Volume_Box', role: 'control', flow: { air: 'through' } },
  // 전열교환기. 성수는 `…PltHeatExchngrs_CounterFlowHeatRecovery…` 로 들어온다. 팬을 품고 있어 공기의 원천이다.
  { kind: 'heat_recovery', label: '전열교환기', test: /heat\s*recovery|HeatExchngr|전열\s*교환|\bERV\b|\bHRV\b/i, brick: 'brick:Heat_Exchanger', role: 'conversion', flow: { air: 'source' } },
  // --- 열원 --------------------------------------------------------------------
  { kind: 'ground_source_heat_pump', label: '지열 히트펌프', test: /\bGSHP|지열\s*히트|ground\s*source/i, brick: 'brick:Heat_Pump_Ground_Source_Condensing_Unit', role: 'conversion', flow: { water: 'source' } },
  { kind: 'heat_pump', label: '히트펌프', test: /heat\s*pump|히트\s*펌프/i, brick: 'brick:Heat_Pump_Condensing_Unit', role: 'conversion', flow: { water: 'source' } },
  { kind: 'ground_heat_exchanger', label: '지중 열교환기', test: /\bGHX\b|지중\s*열교환/i, brick: 'brick:Heat_Exchanger', role: 'conversion', flow: { water: 'through' } },
  { kind: 'chiller', label: '냉동기', test: /chiller|냉동기|칠러/i, brick: 'brick:Chiller', role: 'conversion', flow: { water: 'source' } },
  { kind: 'boiler', label: '보일러', test: /boiler|보일러/i, brick: 'brick:Boiler', role: 'conversion', flow: { water: 'source' } },
  { kind: 'cooling_tower', label: '냉각탑', test: /cooling\s*tower|냉각탑/i, brick: 'brick:Cooling_Tower', role: 'conversion', flow: { water: 'through' } },
  // --- 이송 --------------------------------------------------------------------
  // 태그 이름도 받는다. 성수 배기 계통의 팬은 `EF-11` 처럼 태그로만 들어왔다(EF 배기팬, SF 급기팬, CF 천장팬).
  { kind: 'pump', label: '펌프', test: /pump|펌프/i, brick: 'brick:Pump', role: 'moving', flow: { water: 'source' } },
  { kind: 'exhaust_fan', label: '배기팬', test: /fan[-_\s]*exhaust|exhaust[-_\s]*fan|배기\s*(팬|휀)|\b[EC]F-?\d/i, brick: 'brick:Exhaust_Fan', role: 'moving', flow: { air: 'source' } },
  { kind: 'fan', label: '팬', test: /fan|(^|[^가-힣])팬|휀|\bSF-?\d/i, brick: 'brick:Fan', role: 'moving', flow: { air: 'source' } },
  // --- 말단·조절 ----------------------------------------------------------------
  { kind: 'air_diffuser', label: '디퓨저', test: /디퓨[저져]|diffuser/i, brick: 'brick:Air_Diffuser', role: 'terminal', flow: { air: 'sink' } },
  // 건물 밖과 통하는 루버·벤트캡. 실내 그릴과 흐름이 반대다(flow-rules.ts 의 바깥 가지).
  { kind: 'outdoor_louver', label: '외부 루버', test: /루버|louver|vent[-_\s]*cap|[_\s-](OA|EA)\b/i, brick: null, role: 'terminal', flow: { air: 'sink' } },
  { kind: 'air_grille', label: '그릴', test: /그릴|grille/i, brick: null, role: 'terminal', flow: { air: 'sink' } },
  { kind: 'damper', label: '댐퍼', test: /댐퍼|damper/i, brick: 'brick:Damper', role: 'control', flow: { air: 'through' } },
  { kind: 'silencer', label: '소음기', test: /silencer|소음기|attenuat/i, brick: null, role: 'treatment', flow: { air: 'through' } },
  { kind: 'water_meter', label: '수량계', test: /water[-_\s]*meter|수량계|유량계/i, brick: 'brick:Water_Meter', role: 'control', flow: { water: 'through' } },
  { kind: 'valve', label: '밸브', test: /valve|밸브/i, brick: 'brick:Valve', role: 'control', flow: { water: 'through' } },
  // --- 전기·조명 ------------------------------------------------------------------
  { kind: 'panel', label: '분전반', test: /분전반|\bPNL\b|breaker\s*panel/i, brick: 'brick:Breaker_Panel', role: null, flow: {} },
  { kind: 'lighting', label: '조명', test: /조명|가로등|luminaire|lighting|pendant|[_\s-]light\b|^light\b/i, brick: 'brick:Luminaire', role: 'terminal', flow: {} },
  // --- 관제점 후보(F13) ------------------------------------------------------------
  { kind: 'smoke_detector', label: '연기감지기', test: /연기\s*감지|smoke\s*detect/i, brick: 'brick:Smoke_Detector', role: 'sensing', flow: {}, point: true },
  { kind: 'heat_detector', label: '열감지기', test: /열\s*감지|heat\s*detect/i, brick: 'brick:Heat_Detector', role: 'sensing', flow: {}, point: true },
  { kind: 'camera', label: 'CCTV', test: /camera|CCTV|카메라/i, brick: 'brick:Camera', role: 'sensing', flow: {}, point: true },
  // --- 사람만 고르는 종류 ---------------------------------------------------------
  // 병원 MEP 에서 종류를 모르는 기기 1,765대 중 1,376대가 콘센트·스프링클러였는데 고를 종류가 없었다. Brick 1.4 에
  // 맞는 이름을 확인하지 못해 전부 `ex:` 로 나간다.
  { kind: 'receptacle', label: '콘센트', test: NEVER, brick: null, role: 'terminal', flow: {}, manual: true },
  { kind: 'sprinkler', label: '스프링클러 헤드', test: NEVER, brick: null, role: 'terminal', flow: { water: 'sink' }, manual: true },
  { kind: 'plumbing_fixture', label: '위생기구(세면기·싱크·샤워)', test: NEVER, brick: null, role: 'terminal', flow: { water: 'sink' }, manual: true },
  { kind: 'water_heater', label: '급탕기', test: NEVER, brick: null, role: 'conversion', flow: { water: 'source' }, manual: true },
  { kind: 'transformer', label: '변압기', test: NEVER, brick: null, role: 'conversion', flow: {}, manual: true },
]

const EQUIPMENT_BY_KIND = new Map(EQUIPMENT_KINDS.map((k) => [k.kind, k]))

/**
 * IFC4 의 구체 클래스 → 종류. IFC4 파일은 이름이 번호뿐인 일이 흔해서(ifc4Mep: "1.6.6") 이름보다
 * 클래스가 더 많이 말한다. 이름이 먼저고, 이름으로 못 찾을 때만 클래스를 본다.
 */
const CLASS_KINDS: Record<string, string> = {
  Boiler: 'boiler',
  Chiller: 'chiller',
  CoolingTower: 'cooling_tower',
  Pump: 'pump',
  Fan: 'fan',
  AirTerminal: 'air_diffuser',
  AirTerminalBox: 'vav',
  Damper: 'damper',
  Valve: 'valve',
  FlowMeter: 'water_meter',
  UnitaryEquipment: 'ahu',
  AirToAirHeatRecovery: 'heat_recovery',
  LightFixture: 'lighting',
}

/** 이름과 ObjectType 을 합쳐 사전에서 찾고, 없으면 IFC 클래스로 찾는다. 모르면 null. */
export function equipmentKindOf(name: string, objectType = '', ifcClass = ''): EquipmentKindInfo | null {
  const text = `${name} ${objectType}`
  return EQUIPMENT_KINDS.find((k) => k.test.test(text)) ?? equipmentKind(CLASS_KINDS[ifcClass])
}

export function equipmentKind(kind: string | null | undefined): EquipmentKindInfo | null {
  return kind ? (EQUIPMENT_BY_KIND.get(kind) ?? null) : null
}

// --- 방 ---------------------------------------------------------------------------

export type RoomKindInfo = { kind: string; label: string; test: RegExp; brick: string }

/**
 * 방 이름 → Brick 방 클래스. Brick 1.4 에 있는 이름만 쓴다.
 *
 * 받는 쪽 파서는 `a` 뒤의 클래스를 하나만 읽어서, `brick:Room` 에 하위 클래스를 덧붙이지 않고
 * 하위 클래스 하나로 적는다. 기존 SR 온톨로지에는 `brick:Room` 자체가 없어서 이 선택이 깨뜨리는
 * 소비처가 없다.
 *
 * 샤프트(P.S, E.A, O.A)와 전실(Vestibule)은 Brick 에 알맞은 방 클래스가 없어 사전에 넣지 않았다.
 */
export const ROOM_KINDS: RoomKindInfo[] = [
  { kind: 'restroom', label: '화장실', test: /toilet|restroom|rest\s*room|화장실|\bW\.?C\b/i, brick: 'brick:Restroom' },
  { kind: 'conference', label: '회의실', test: /conference|meeting|회의/i, brick: 'brick:Conference_Room' },
  { kind: 'break', label: '휴게실', test: /break\s*room|pantry|lounge|탕비|휴게/i, brick: 'brick:Break_Room' },
  { kind: 'office', label: '사무실', test: /office(?!\s*storage)|사무/i, brick: 'brick:Office' },
  { kind: 'staircase', label: '계단실', test: /stair|계단/i, brick: 'brick:Staircase' },
  { kind: 'elevator_shaft', label: '승강로', test: /elev(ator)?\.?\s*shaft|승강로/i, brick: 'brick:Elevator_Shaft' },
  { kind: 'lobby', label: '로비·홀', test: /lobby|로비|elev(ator)?\.?\s*hall|\bEV\.?\s*hall|승강기\s*홀|엘리베이터\s*홀/i, brick: 'brick:Lobby' },
  { kind: 'mechanical', label: '기계실', test: /machine\s*room|mech(anical)?\s*room|\bHVAC\b|pump\s*room|기계실|공조실|펌프실/i, brick: 'brick:Mechanical_Room' },
  { kind: 'electrical', label: '전기실', test: /\bEPS\b|electric|전기실|변전실/i, brick: 'brick:Electrical_Room' },
  { kind: 'telecom', label: '통신실', test: /\bTPS\b|\bMDF\b|\bIDF\b|telecom|통신실/i, brick: 'brick:Telecom_Room' },
  { kind: 'server', label: '전산실', test: /server|전산실/i, brick: 'brick:Server_Room' },
  { kind: 'storage', label: '창고', test: /storage|창고/i, brick: 'brick:Storage_Room' },
  { kind: 'janitor', label: '청소도구실', test: /\bJAN\b\.?|janitor|청소/i, brick: 'brick:Janitor_Room' },
  { kind: 'hallway', label: '복도', test: /corridor|hallway|복도/i, brick: 'brick:Hallway' },
]

const ROOM_BY_KIND = new Map(ROOM_KINDS.map((k) => [k.kind, k]))

export function roomKindOf(name: string, longName = ''): RoomKindInfo | null {
  const text = `${longName} ${name}`
  return ROOM_KINDS.find((k) => k.test.test(text)) ?? null
}

export function roomKind(kind: string | null | undefined): RoomKindInfo | null {
  return kind ? (ROOM_BY_KIND.get(kind) ?? null) : null
}

// --- 계통 -------------------------------------------------------------------------

export type SystemKindInfo = {
  kind: string
  label: string
  test: RegExp
  medium: Medium
  /**
   * 흐름이 원천에서 나가는가(`out`), 원천으로 들어오는가(`in`).
   * 급기는 공조기에서 디퓨저로 나가고, 환기·배기는 그릴에서 공조기·팬으로 들어온다.
   */
  sense: 'out' | 'in'
}

/**
 * 계통 분류 → 매체와 방향. Revit 은 IfcSystem 의 ObjectType 에 시스템 분류를 적는다
 * (한국어판: `급기`, `공기 배출`, `순환 공기`, `순환수 공급`, `순환수 순환`, `가정용 온수`, `위생`).
 *
 * 위생(배수)은 넣지 않았다. 흐름을 내보내는 원천 기기가 없어서 이 규칙으로는 방향을 못 정한다.
 */
export const SYSTEM_KINDS: SystemKindInfo[] = [
  { kind: 'supply_air', label: '급기', test: /급기|supply\s*air/i, medium: 'air', sense: 'out' },
  { kind: 'exhaust_air', label: '배기', test: /공기\s*배출|배기|exhaust|extract\s*air/i, medium: 'air', sense: 'in' },
  { kind: 'return_air', label: '환기', test: /순환\s*공기|환기|return\s*air/i, medium: 'air', sense: 'in' },
  { kind: 'outside_air', label: '외기', test: /외기|outside\s*air|outdoor\s*air/i, medium: 'air', sense: 'out' },
  { kind: 'hydronic_supply', label: '순환수 공급', test: /순환수\s*공급|hydronic\s*supply|냉온수\s*공급|(heat(ing)?|cooling)\s*flow|supply\s*water/i, medium: 'water', sense: 'out' },
  { kind: 'hydronic_return', label: '순환수 환수', test: /순환수\s*순환|순환수\s*환수|hydronic\s*return|냉온수\s*환수|(heat(ing)?|cooling)\s*return|return\s*water/i, medium: 'water', sense: 'in' },
  { kind: 'domestic_hot_water', label: '급탕', test: /가정용\s*온수|급탕|domestic\s*hot|hot\s*water/i, medium: 'water', sense: 'out' },
  { kind: 'domestic_cold_water', label: '급수', test: /가정용\s*냉수|급수|domestic\s*cold|cold\s*water/i, medium: 'water', sense: 'out' },
]

const SYSTEM_BY_KIND = new Map(SYSTEM_KINDS.map((k) => [k.kind, k]))

/** ObjectType 을 먼저 보고, 없으면 이름을 본다. 이름에는 번호가 붙어 있어도 된다(`기계 급기 287`). */
export function systemKindOf(name: string, objectType = ''): SystemKindInfo | null {
  return SYSTEM_KINDS.find((k) => k.test.test(objectType)) ?? SYSTEM_KINDS.find((k) => k.test.test(name)) ?? null
}

export function systemKind(kind: string | null | undefined): SystemKindInfo | null {
  return kind ? (SYSTEM_BY_KIND.get(kind) ?? null) : null
}
