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
  /**
   * IFC 가 이 종류를 말하는 법. `클래스.PredefinedType`(`AirTerminal.DIFFUSER`)이거나, PredefinedType 을 가리지 않으면
   * `클래스`(`Boiler`)다. 클래스는 Ifc 를 뗀 것이고 IFC2x3 에서는 타입 객체의 클래스다(`IfcAirTerminalType` → `AirTerminal`).
   * USERDEFINED 는 ObjectType(타입이면 ElementType)의 값을 PredefinedType 자리에 둔다(`UnitaryEquipment.FANCOILUNIT`).
   *
   * **이 표가 곧 고객사에 요구하는 어휘(`docs/requirements.ids` 의 R25)다.** IFC4 열거값에 있는 것은 그 값을, 없는 것은
   * 우리가 정한 USERDEFINED 이름을 쓴다. 한쪽에만 넣으면 IDS 를 지킨 파일을 못 읽으므로 `requirements-ids.test.ts` 가 둘을 맞춰 본다.
   */
  ifc?: string[]
  /** 관제점 후보(F13)인가. 감지기·카메라처럼 BAS 가 값을 들고 있을 만한 장치. */
  point?: boolean
  /**
   * 이름 사전이 읽지 않는 종류(`test` 가 아무것에도 맞지 않는다). BIM 이 `ifc` 로 말하면 받고, 아니면 사람이 고른다.
   * 사전 식을 넓히면 가진 BIM 전부의 숫자가 움직여서(CLAUDE.md 의 과적합 규칙) 이름으로는 읽지 않는다.
   */
  manual?: true
}

/** 아무 이름에도 맞지 않는 식. 사람만 고르는 종류의 `test` 다. */
const NEVER = /(?!)/

export const EQUIPMENT_KINDS: EquipmentKindInfo[] = [
  // --- 공조 기기 ---------------------------------------------------------------
  // OHU 는 외기 공조기(Outdoor air Handling Unit)다. 공조기와 같이 본다.
  { kind: 'ahu', label: '공조기', test: /\b[AO]HU|공조기|air\s*handl/i, brick: 'brick:Air_Handling_Unit', role: 'conversion', ifc: ['UnitaryEquipment.AIRHANDLER'], flow: { air: 'source', water: 'sink' } },
  { kind: 'fcu', label: 'FCU', test: /\bFCU|팬\s*코일|fan\s*coil/i, brick: 'brick:Fan_Coil_Unit', role: 'conversion', ifc: ['UnitaryEquipment.FANCOILUNIT'], flow: { air: 'source', water: 'sink' } },
  { kind: 'indoor_unit', label: '시스템에어컨 실내기', test: /시스템\s*에어컨|실내기|indoor\s*unit|\bIDU\b/i, brick: 'brick:Indoor_Unit', role: 'conversion', ifc: ['UnitaryEquipment.INDOORUNIT'], flow: { air: 'source' } },
  { kind: 'vav', label: 'VAV', test: /\bVAV\b/i, brick: 'brick:Variable_Air_Volume_Box', role: 'control', ifc: ['AirTerminalBox.VARIABLEFLOWPRESSUREDEPENDANT', 'AirTerminalBox.VARIABLEFLOWPRESSUREINDEPENDANT'], flow: { air: 'through' } },
  // 전열교환기. 성수는 `…PltHeatExchngrs_CounterFlowHeatRecovery…` 로 들어온다. 팬을 품고 있어 공기의 원천이다.
  { kind: 'heat_recovery', label: '전열교환기', test: /heat\s*recovery|HeatExchngr|전열\s*교환|\bERV\b|\bHRV\b/i, brick: 'brick:Heat_Exchanger', role: 'conversion', ifc: ['AirToAirHeatRecovery'], flow: { air: 'source' } },
  // --- 열원 --------------------------------------------------------------------
  { kind: 'ground_source_heat_pump', label: '지열 히트펌프', test: /\bGSHP|지열\s*히트|ground\s*source/i, brick: 'brick:Heat_Pump_Ground_Source_Condensing_Unit', role: 'conversion', ifc: ['UnitaryEquipment.GROUNDSOURCEHEATPUMP'], flow: { water: 'source' } },
  { kind: 'heat_pump', label: '히트펌프', test: /heat\s*pump|히트\s*펌프/i, brick: 'brick:Heat_Pump_Condensing_Unit', role: 'conversion', ifc: ['UnitaryEquipment.HEATPUMP'], flow: { water: 'source' } },
  { kind: 'ground_heat_exchanger', label: '지중 열교환기', test: /\bGHX\b|지중\s*열교환/i, brick: 'brick:Heat_Exchanger', role: 'conversion', ifc: ['HeatExchanger.GROUNDHEATEXCHANGER'], flow: { water: 'through' } },
  { kind: 'chiller', label: '냉동기', test: /chiller|냉동기|칠러/i, brick: 'brick:Chiller', role: 'conversion', ifc: ['Chiller'], flow: { water: 'source' } },
  { kind: 'boiler', label: '보일러', test: /boiler|보일러/i, brick: 'brick:Boiler', role: 'conversion', ifc: ['Boiler'], flow: { water: 'source' } },
  { kind: 'cooling_tower', label: '냉각탑', test: /cooling\s*tower|냉각탑/i, brick: 'brick:Cooling_Tower', role: 'conversion', ifc: ['CoolingTower'], flow: { water: 'through' } },
  // --- 이송 --------------------------------------------------------------------
  // 태그 이름도 받는다. 성수 배기 계통의 팬은 `EF-11` 처럼 태그로만 들어왔다(EF 배기팬, SF 급기팬, CF 천장팬).
  { kind: 'pump', label: '펌프', test: /pump|펌프/i, brick: 'brick:Pump', role: 'moving', ifc: ['Pump'], flow: { water: 'source' } },
  { kind: 'exhaust_fan', label: '배기팬', test: /fan[-_\s]*exhaust|exhaust[-_\s]*fan|배기\s*(팬|휀)|\b[EC]F-?\d/i, brick: 'brick:Exhaust_Fan', role: 'moving', flow: { air: 'source' } },
  { kind: 'fan', label: '팬', test: /fan|(^|[^가-힣])팬|휀|\bSF-?\d/i, brick: 'brick:Fan', role: 'moving', ifc: ['Fan'], flow: { air: 'source' } },
  // --- 말단·조절 ----------------------------------------------------------------
  { kind: 'air_diffuser', label: '디퓨저', test: /디퓨[저져]|diffuser/i, brick: 'brick:Air_Diffuser', role: 'terminal', ifc: ['AirTerminal.DIFFUSER'], flow: { air: 'sink' } },
  // 건물 밖과 통하는 루버·벤트캡. 실내 그릴과 흐름이 반대다(flow-rules.ts 의 바깥 가지).
  { kind: 'outdoor_louver', label: '외부 루버', test: /루버|louver|vent[-_\s]*cap|[_\s-](OA|EA)\b/i, brick: null, role: 'terminal', ifc: ['AirTerminal.LOUVRE'], flow: { air: 'sink' } },
  { kind: 'air_grille', label: '그릴', test: /그릴|grille/i, brick: null, role: 'terminal', ifc: ['AirTerminal.GRILLE', 'AirTerminal.REGISTER'], flow: { air: 'sink' } },
  { kind: 'damper', label: '댐퍼', test: /댐퍼|damper/i, brick: 'brick:Damper', role: 'control', ifc: ['Damper'], flow: { air: 'through' } },
  { kind: 'silencer', label: '소음기', test: /silencer|소음기|attenuat/i, brick: null, role: 'treatment', ifc: ['DuctSilencer'], flow: { air: 'through' } },
  { kind: 'water_meter', label: '수량계', test: /water[-_\s]*meter|수량계|유량계/i, brick: 'brick:Water_Meter', role: 'control', ifc: ['FlowMeter.WATERMETER'], flow: { water: 'through' } },
  { kind: 'valve', label: '밸브', test: /valve|밸브/i, brick: 'brick:Valve', role: 'control', ifc: ['Valve'], flow: { water: 'through' } },
  // --- 전기·조명 ------------------------------------------------------------------
  { kind: 'panel', label: '분전반', test: /분전반|\bPNL\b|breaker\s*panel/i, brick: 'brick:Breaker_Panel', role: null, ifc: ['ElectricDistributionBoard.DISTRIBUTIONBOARD'], flow: {} },
  { kind: 'lighting', label: '조명', test: /조명|가로등|luminaire|lighting|pendant|[_\s-]light\b|^light\b/i, brick: 'brick:Luminaire', role: 'terminal', ifc: ['LightFixture'], flow: {} },
  // --- 관제점 후보(F13) ------------------------------------------------------------
  { kind: 'smoke_detector', label: '연기감지기', test: /연기\s*감지|smoke\s*detect/i, brick: 'brick:Smoke_Detector', role: 'sensing', ifc: ['Sensor.SMOKESENSOR'], flow: {}, point: true },
  { kind: 'heat_detector', label: '열감지기', test: /열\s*감지|heat\s*detect/i, brick: 'brick:Heat_Detector', role: 'sensing', ifc: ['Sensor.HEATSENSOR'], flow: {}, point: true },
  { kind: 'camera', label: 'CCTV', test: /camera|CCTV|카메라/i, brick: 'brick:Camera', role: 'sensing', ifc: ['AudioVisualAppliance.CAMERA'], flow: {}, point: true },
  // --- 사람만 고르는 종류 ---------------------------------------------------------
  // 병원 MEP 에서 종류를 모르는 기기 1,765대 중 1,376대가 콘센트·스프링클러였는데 고를 종류가 없었다. Brick 1.4 에
  // 맞는 이름을 확인하지 못해 전부 `ex:` 로 나간다.
  { kind: 'receptacle', label: '콘센트', test: NEVER, brick: null, role: 'terminal', ifc: ['Outlet.POWEROUTLET'], flow: {}, manual: true },
  { kind: 'sprinkler', label: '스프링클러 헤드', test: NEVER, brick: null, role: 'terminal', ifc: ['FireSuppressionTerminal.SPRINKLER'], flow: { water: 'sink' }, manual: true },
  { kind: 'plumbing_fixture', label: '위생기구(세면기·싱크·샤워)', test: NEVER, brick: null, role: 'terminal', ifc: ['SanitaryTerminal'], flow: { water: 'sink' }, manual: true },
  { kind: 'water_heater', label: '급탕기', test: NEVER, brick: null, role: 'conversion', flow: { water: 'source' }, manual: true },
  { kind: 'transformer', label: '변압기', test: NEVER, brick: null, role: 'conversion', ifc: ['Transformer'], flow: {}, manual: true },
  // 시스템에어컨 실외기. IFC4 에 없어 USERDEFINED 로 적게 했다. Brick 1.4 에는 없지만 받는 쪽(ttl.go equipClass)이
  // Outdoor_Unit 을 ODU 로 읽는다 — Indoor_Unit 과 같은 선례다. 냉매 계통이라 공기·물 흐름 규칙에는 들지 않는다.
  { kind: 'outdoor_unit', label: '시스템에어컨 실외기', test: NEVER, brick: 'brick:Outdoor_Unit', role: 'conversion', ifc: ['UnitaryEquipment.OUTDOORUNIT'], flow: {}, manual: true },
  // 방열기. ifc4Mep 의 IfcSpaceHeater RADIATOR 30대. 순환수를 받는 말단이다.
  { kind: 'radiator', label: '방열기', test: NEVER, brick: 'brick:Radiator', role: 'terminal', ifc: ['SpaceHeater.RADIATOR'], flow: { water: 'sink' }, manual: true },
]

const EQUIPMENT_BY_KIND = new Map(EQUIPMENT_KINDS.map((k) => [k.kind, k]))

const EQUIPMENT_BY_IFC = new Map(EQUIPMENT_KINDS.flatMap((k) => (k.ifc ?? []).map((t) => [t, k] as const)))

/**
 * PredefinedType 을 말하지 않은 클래스 → 가장 흔한 종류. BIM 이 말한 것이 아니라 우리 추측이라 출처는 사전이다.
 * `ifc` 표의 `클래스.값` 꼴만 있는 클래스에만 둔다(클래스만으로 정해지는 `Boiler` 같은 것은 표가 맡는다).
 */
const CLASS_GUESS: Record<string, string> = {
  AirTerminal: 'air_diffuser',
  AirTerminalBox: 'vav',
  UnitaryEquipment: 'ahu',
  FlowMeter: 'water_meter',
}

/**
 * IFC 가 말한 종류(`클래스.PredefinedType` 또는 `클래스`)를 `ifc` 표에서 찾는다. 모르면 null.
 * `Boiler.WATER` 처럼 값까지는 표에 없어도 클래스가 표에 있으면 그 종류다.
 */
export function equipmentKindOfIfc(declared: string | null | undefined): EquipmentKindInfo | null {
  if (!declared) return null
  // 클래스와 값은 첫 점으로 가른다. USERDEFINED 값에는 점이 들어갈 수 있다(`1.6.6`). 값은 대소문자를 가리지 않는다.
  const dot = declared.indexOf('.')
  const cls = dot < 0 ? declared : declared.slice(0, dot)
  const value = dot < 0 ? '' : declared.slice(dot + 1).trim().toUpperCase()
  return (value ? EQUIPMENT_BY_IFC.get(`${cls}.${value}`) : undefined) ?? EQUIPMENT_BY_IFC.get(cls) ?? null
}

export type KindSource = 'bim' | 'dict'

/**
 * 설비 종류와 그 출처. 순서가 뜻을 가진다.
 *
 * 1. **이름 사전.** 사전은 좁아서 맞으면 대개 더 구체적이다 — 성수의 `EF-11` 은 IFC 로는 `IfcFan` 이지만 배기팬이다.
 * 2. **IFC 가 말한 종류**(`declared`, 없으면 `ifcClass`). 출처가 BIM 이다. IFC2x3 도 타입 객체에는 종류가 있다
 *    (병원 HVAC 의 `IfcAirTerminalType` DIFFUSER 231·REGISTER 184, `IfcAirTerminalBoxType` VAV 115).
 * 3. **PredefinedType 을 말하지 않은 클래스의 추측**(`CLASS_GUESS`). BIM 이 값을 말했는데(`AirTerminal.SD-1200mm`)
 *    표에 없으면 추측하지 않는다 — BIM 이 다른 것이라고 한 것을 우리가 덮으면 안 된다.
 */
export function resolveEquipmentKind(
  name: string,
  objectType = '',
  ifcClass = '',
  declared: string | null = null,
): { info: EquipmentKindInfo; source: KindSource } | null {
  const text = `${name} ${objectType}`
  const byName = EQUIPMENT_KINDS.find((k) => k.test.test(text))
  if (byName) return { info: byName, source: 'dict' }
  const said = declared ?? (ifcClass || null)
  const byIfc = equipmentKindOfIfc(said)
  if (byIfc) return { info: byIfc, source: 'bim' }
  if (said?.includes('.')) return null
  const guess = equipmentKind(CLASS_GUESS[said ?? ''])
  return guess ? { info: guess, source: 'dict' } : null
}

/** 이름과 ObjectType 을 합쳐 사전에서 찾고, 없으면 IFC 클래스로 찾는다. 모르면 null. */
export function equipmentKindOf(name: string, objectType = '', ifcClass = '', declared: string | null = null): EquipmentKindInfo | null {
  return resolveEquipmentKind(name, objectType, ifcClass, declared)?.info ?? null
}

export function equipmentKind(kind: string | null | undefined): EquipmentKindInfo | null {
  return kind ? (EQUIPMENT_BY_KIND.get(kind) ?? null) : null
}

// --- 방 ---------------------------------------------------------------------------

export type RoomKindInfo = {
  kind: string
  label: string
  test: RegExp
  brick: string
  /**
   * 이 종류에 해당하는 OmniClass Table 13 코드. **이 표가 곧 고객사에 요구하는 방 분류 어휘(`docs/requirements.ids` 의
   * R14)다.** 가진 BIM(병원·Duplex, Revit)에 실제로 나온 코드 중 Brick 방 클래스와 뜻이 분명히 맞는 것만 둔다.
   * 상위 코드로 넓히지 않는다 — `13-75 11 11` 창고는 받지만 `13-75 41 24` 위험물 창고는 받지 않는다.
   */
  omniclass?: string[]
}

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
  { kind: 'restroom', label: '화장실', test: /toilet|restroom|rest\s*room|화장실|\bW\.?C\b/i, brick: 'brick:Restroom', omniclass: ['13-41 11 14 21'] },
  { kind: 'conference', label: '회의실', test: /conference|meeting|회의/i, brick: 'brick:Conference_Room', omniclass: ['13-11 21 17'] },
  { kind: 'break', label: '휴게실', test: /break\s*room|pantry|lounge|탕비|휴게/i, brick: 'brick:Break_Room', omniclass: ['13-51 11 21'] },
  { kind: 'office', label: '사무실', test: /office(?!\s*storage)|사무/i, brick: 'brick:Office', omniclass: ['13-15 11 34 11'] },
  { kind: 'staircase', label: '계단실', test: /stair|계단/i, brick: 'brick:Staircase', omniclass: ['13-85 21 11'] },
  { kind: 'elevator_shaft', label: '승강로', test: /elev(ator)?\.?\s*shaft|승강로/i, brick: 'brick:Elevator_Shaft', omniclass: ['13-81 21 31'] },
  { kind: 'lobby', label: '로비·홀', test: /lobby|로비|elev(ator)?\.?\s*hall|\bEV\.?\s*hall|승강기\s*홀|엘리베이터\s*홀/i, brick: 'brick:Lobby' },
  { kind: 'mechanical', label: '기계실', test: /machine\s*room|mech(anical)?\s*room|\bHVAC\b|pump\s*room|기계실|공조실|펌프실/i, brick: 'brick:Mechanical_Room', omniclass: ['13-81 21 17'] },
  { kind: 'electrical', label: '전기실', test: /\bEPS\b|electric|전기실|변전실/i, brick: 'brick:Electrical_Room', omniclass: ['13-81 21 21'] },
  { kind: 'telecom', label: '통신실', test: /\bTPS\b|\bMDF\b|\bIDF\b|telecom|통신실/i, brick: 'brick:Telecom_Room' },
  { kind: 'server', label: '전산실', test: /server|전산실/i, brick: 'brick:Server_Room' },
  { kind: 'storage', label: '창고', test: /storage|창고/i, brick: 'brick:Storage_Room', omniclass: ['13-75 11 11'] },
  { kind: 'janitor', label: '청소도구실', test: /\bJAN\b\.?|janitor|청소/i, brick: 'brick:Janitor_Room' },
  { kind: 'hallway', label: '복도', test: /corridor|hallway|복도/i, brick: 'brick:Hallway', omniclass: ['13-85 11 11'] },
]

const ROOM_BY_KIND = new Map(ROOM_KINDS.map((k) => [k.kind, k]))

const ROOM_BY_OMNICLASS = new Map(ROOM_KINDS.flatMap((k) => (k.omniclass ?? []).map((c) => [c, k] as const)))

/**
 * 문자열에서 OmniClass Table 13 코드를 꺼낸다. Revit 은 `13-15 11 34 11`(Category Code)이나
 * `13-15 11 34 11: Office`(OmniClass Table 13 Category, COBie 의 분류 참조)로 적는다. 설명만 있으면(`Office`) null.
 */
export function omniclassCode(text: string | null | undefined): string | null {
  const m = /(?:^|[^\d])(13-\d{2}(?: \d{2})*)(?![\d])/.exec(text ?? '')
  return m ? m[1] : null
}

/**
 * 방 종류와 그 출처. 이름 사전이 먼저다 — 병원의 `JAN. CL.` 은 OmniClass 로는 창고(13-75 11 11)지만 이름이 청소도구실이라고
 * 더 좁게 말한다. 이름이 모를 때 OmniClass 코드를 쓰고, 그때 출처는 BIM 이다.
 */
export function resolveRoomKind(name: string, longName = '', omniclass: string | null = null): { info: RoomKindInfo; source: KindSource } | null {
  const text = `${longName} ${name}`
  const byName = ROOM_KINDS.find((k) => k.test.test(text))
  if (byName) return { info: byName, source: 'dict' }
  const byCode = omniclass ? ROOM_BY_OMNICLASS.get(omniclass) : undefined
  return byCode ? { info: byCode, source: 'bim' } : null
}

export function roomKindOf(name: string, longName = '', omniclass: string | null = null): RoomKindInfo | null {
  return resolveRoomKind(name, longName, omniclass)?.info ?? null
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

/**
 * IFC 가 계통 종류를 말하는 법. **이 표가 곧 고객사에 요구하는 어휘(`docs/requirements.ids` 의 R17)다.**
 *
 * IFC4 의 `IfcDistributionSystem.PredefinedType` 은 한 계통 안에서 공급과 환수를 가르지 않는다(AIRCONDITIONING·
 * VENTILATION·HEATING·CHILLEDWATER). 방향을 정하려면 그 둘을 갈라야 해서 ObjectType 에 약어를 하나 더 적게 한다.
 * **공기는 EN 12792 의 약어다** — ifc4Mep 이 계통 이름에 이미 쓰고 있다(`1_SUP Supply air`, `2_ETA Extract air`,
 * `1_EHA Exhaust air`, `3_ODA Outdoor air`). 물은 표준 약어가 없어 FLOW·RETURN 으로 둔다. 급탕·급수·배기는
 * PredefinedType 만으로 정해진다.
 */
export const SYSTEM_IFC = {
  air: { predefined: ['AIRCONDITIONING', 'VENTILATION', 'EXHAUST'], codes: { SUP: 'supply_air', ETA: 'return_air', RCA: 'return_air', EHA: 'exhaust_air', ODA: 'outside_air' } },
  water: { predefined: ['HEATING', 'CHILLEDWATER', 'CONDENSERWATER'], codes: { FLOW: 'hydronic_supply', RETURN: 'hydronic_return' } },
  alone: { DOMESTICHOTWATER: 'domestic_hot_water', DOMESTICCOLDWATER: 'domestic_cold_water', EXHAUST: 'exhaust_air' },
} as const

/** IFC 가 말한 계통 종류. 약어는 그 매체의 PredefinedType 과 함께일 때만 읽는다(`RETURN` 은 공기에도 물에도 있을 수 있다). */
export function systemKindOfIfc(predefined: string | null | undefined, objectType = ''): SystemKindInfo | null {
  const code = objectType.trim().toUpperCase()
  const p = predefined ?? ''
  const pick = (table: Record<string, string>) => (code in table ? systemKind(table[code]) : null)
  if ((SYSTEM_IFC.air.predefined as readonly string[]).includes(p)) {
    const hit = pick(SYSTEM_IFC.air.codes)
    if (hit) return hit
  }
  if ((SYSTEM_IFC.water.predefined as readonly string[]).includes(p)) {
    const hit = pick(SYSTEM_IFC.water.codes)
    if (hit) return hit
  }
  return systemKind((SYSTEM_IFC.alone as Record<string, string>)[p])
}

/**
 * IFC 가 말한 것(PredefinedType 과 약어)을 먼저 보고, 다음에 ObjectType, 마지막에 이름을 사전으로 본다.
 * 이름에는 번호가 붙어 있어도 된다(`기계 급기 287`).
 */
export function systemKindOf(name: string, objectType = '', predefined: string | null = null): SystemKindInfo | null {
  return (
    systemKindOfIfc(predefined, objectType) ??
    SYSTEM_KINDS.find((k) => k.test.test(objectType)) ??
    SYSTEM_KINDS.find((k) => k.test.test(name)) ??
    null
  )
}

export function systemKind(kind: string | null | undefined): SystemKindInfo | null {
  return kind ? (SYSTEM_BY_KIND.get(kind) ?? null) : null
}
