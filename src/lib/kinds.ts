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

/**
 * 계통의 매체. 공조기는 공기의 원천이면서 물의 소비처라, 매체를 알아야 역할이 정해진다. `refrigerant` 는 냉매 계통(OE-PIP-03)의
 * 매체다 — 규칙 방향(flow-rules.ts)은 공기·물만 다뤄 냉매 계통은 방향을 정하지 않고 건너뛴다.
 */
export type Medium = 'air' | 'water' | 'refrigerant'

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
   * **이 표가 곧 고객사에 요구하는 어휘(`docs/requirements.ids` 의 R24)다.** IFC4 열거값에 있는 것은 그 값을, 없는 것은
   * 우리가 정한 USERDEFINED 이름을 쓴다. 한쪽에만 넣으면 IDS 를 지킨 파일을 못 읽으므로 `requirements-ids.test.ts` 가 둘을 맞춰 본다.
   */
  ifc?: string[]
  /** 관제점 후보(F13)인가. 감지기·카메라처럼 BAS 가 값을 들고 있을 만한 장치. */
  point?: boolean
  /**
   * 이 기기가 내보내는 순환수의 유체. 계통이 유체를 말하지 않을 때 배관을 따라 이 기기에 닿는 계통의 유체를 짐작한다
   * (flow-rules.ts 의 inferFluids). 냉동기는 냉수, 보일러는 온수, 냉각탑은 냉각수다. 히트펌프는 냉·온을 다 내서 두지 않는다.
   */
  fluid?: Fluid
  /**
   * 이름 사전이 읽지 않는 종류(`test` 가 아무것에도 맞지 않는다). BIM 이 `ifc` 로 말하면 받고, 아니면 사람이 고른다.
   * 사전 식을 넓히면 가진 BIM 전부의 숫자가 움직여서(docs/dev/testing.md 의 과적합 규칙) 이름으로는 읽지 않는다.
   */
  manual?: true
  /**
   * 종류 후보를 제안할 때만 쓰는 낱말(kind-suggest.ts). 이름 사전(`test`)과 달리 종류를 **정하지 않는다** — 사람이 고를 때
   * 후보를 앞에 둘 뿐이다. 이름으로 읽지 않는 종류(`manual`)의 영어 이름이 여기 있다. `test` 를 넓히지 않으므로
   * check:sample 숫자가 움직이지 않는다.
   */
  hint?: string
  /**
   * 놓을 수 있는 자리. `exterior` 는 **외벽 바깥 면에만** 놓는다(OE-OBJ-04 외벽 전용 설비, 2026-10-03 사용자 결정) — 방 안에 들지 않고
   * 외벽에서 벽 붙이기 거리 안이어야 한다(edit.ts 의 onExteriorFace). 없으면 어디든.
   */
  mount?: 'exterior'
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
  { kind: 'chiller', label: '냉동기', test: /chiller|냉동기|칠러/i, brick: 'brick:Chiller', role: 'conversion', ifc: ['Chiller'], flow: { water: 'source' }, fluid: 'chilled' },
  { kind: 'boiler', label: '보일러', test: /boiler|보일러/i, brick: 'brick:Boiler', role: 'conversion', ifc: ['Boiler'], flow: { water: 'source' }, fluid: 'hot' },
  { kind: 'cooling_tower', label: '냉각탑', test: /cooling\s*tower|냉각탑/i, brick: 'brick:Cooling_Tower', role: 'conversion', ifc: ['CoolingTower'], flow: { water: 'through' }, fluid: 'condenser' },
  // --- 이송 --------------------------------------------------------------------
  // 태그 이름도 받는다. 성수 배기 계통의 팬은 `EF-11` 처럼 태그로만 들어왔다(EF 배기팬, SF 급기팬, CF 천장팬).
  { kind: 'pump', label: '펌프', test: /pump|펌프/i, brick: 'brick:Pump', role: 'moving', ifc: ['Pump'], flow: { water: 'source' } },
  { kind: 'exhaust_fan', label: '배기팬', test: /fan[-_\s]*exhaust|exhaust[-_\s]*fan|배기\s*(팬|휀)|\b[EC]F-?\d/i, brick: 'brick:Exhaust_Fan', role: 'moving', flow: { air: 'source' } },
  { kind: 'fan', label: '팬', test: /fan|(^|[^가-힣])팬|휀|\bSF-?\d/i, brick: 'brick:Fan', role: 'moving', ifc: ['Fan'], flow: { air: 'source' } },
  // --- 말단·조절 ----------------------------------------------------------------
  { kind: 'air_diffuser', label: '디퓨저', test: /디퓨[저져]|diffuser/i, brick: 'brick:Air_Diffuser', role: 'terminal', ifc: ['AirTerminal.DIFFUSER'], flow: { air: 'sink' } },
  // 건물 밖과 통하는 루버·벤트캡. 실내 그릴과 흐름이 반대다(flow-rules.ts 의 바깥 가지).
  // 외기 센서(OE-OBJ-04 외벽 전용 설비, 2026-10-03 사용자 결정). 루버(이름의 OA)보다 앞이어야 "외기 온습도 센서 OA-1" 이 루버가 안 된다. 바깥 공기를 재므로 외벽 바깥 면에만 놓는다(mount). 이름으로만 안다 —
  // IFC 어휘(R24)는 늘리지 않았다. "외기 온습도 센서" 처럼 둘 다 말하면 온도 줄이 먼저다(Brick 에 온·습도를 같이 재는 클래스가 없다).
  { kind: 'outdoor_temperature_sensor', label: '외기 온도 센서', test: /외기\s*온(도|\s*[·.]?\s*습도|습도)|(outdoor|outside)\s*air\s*temp/i, brick: 'brick:Outside_Air_Temperature_Sensor', role: 'sensing', flow: {}, point: true, mount: 'exterior' },
  { kind: 'outdoor_humidity_sensor', label: '외기 습도 센서', test: /외기\s*습도|(outdoor|outside)\s*air\s*humid/i, brick: 'brick:Outside_Air_Humidity_Sensor', role: 'sensing', flow: {}, point: true, mount: 'exterior' },
  { kind: 'outdoor_louver', label: '외부 루버', test: /루버|louver|vent[-_\s]*cap|[_\s-](OA|EA)\b/i, brick: null, role: 'terminal', ifc: ['AirTerminal.LOUVRE'], flow: { air: 'sink' } },
  { kind: 'air_grille', label: '그릴', test: /그릴|grille/i, brick: null, role: 'terminal', ifc: ['AirTerminal.GRILLE', 'AirTerminal.REGISTER'], flow: { air: 'sink' } },
  { kind: 'damper', label: '댐퍼', test: /댐퍼|damper/i, brick: 'brick:Damper', role: 'control', ifc: ['Damper'], flow: { air: 'through' } },
  { kind: 'silencer', label: '소음기', test: /silencer|소음기|attenuat/i, brick: null, role: 'treatment', ifc: ['DuctSilencer'], flow: { air: 'through' } },
  { kind: 'water_meter', label: '수량계', test: /water[-_\s]*meter|수량계|유량계/i, brick: 'brick:Water_Meter', role: 'control', ifc: ['FlowMeter.WATERMETER'], flow: { water: 'through' } },
  // 세정 밸브(flush valve)는 변기·소변기의 부품이다. 병원 MEP 에서 `M_Water Closet - Flush Valve` 24대와 `M_Urinal …:25 mm
  // Flush Valve` 3대를 IFC 가 SanitaryTerminal(WCSEAT·URINAL)이라고 말했는데 이름이 먼저라 밸브가 됐다.
  { kind: 'valve', label: '밸브', test: /(?<!flush[-_\s]*)valve|(?<!세정\s*)밸브/i, brick: 'brick:Valve', role: 'control', ifc: ['Valve'], flow: { water: 'through' } },
  // --- 전기·조명 ------------------------------------------------------------------
  // 엘리베이터(2026-10-03 사용자 결정). 흐름이 없는 기기라 연결 추정에서 빠진다(ADR-0010). 로봇이 층을 옮길 때 탈 장치라 설비
  // 목록·TTL 에 둔다. 병원은 건축에 IfcFlowTerminal, 전기에 Proxy(`M_Elevator-Hydraulic`)로 들어 있다. 승강로(방)는 ROOM_KINDS 다.
  // 이름으로만 안다 — `ifc` 를 두면 고객사에 요구하는 어휘(R24)가 늘어서 넣지 않았다. IfcTransportElement 는 임포터가 아직 읽지 않는다.
  { kind: 'elevator', label: '엘리베이터', test: /elevator|엘리베이터|승강기/i, brick: 'brick:Elevator', role: null, flow: {} },
  // 에스컬레이터도 엘리베이터와 같이 수직 관통 오브젝트라 층 편집 화면에서 옮기거나 지우지 않는다(OE-EQP-07). 이름으로만 안다.
  { kind: 'escalator', label: '에스컬레이터', test: /escalator|에스컬레이터/i, brick: 'brick:Escalator', role: null, flow: {} },
  // Revit 의 "Lighting and Appliance Panelboard" 는 분전반이다. 이 줄이 조명보다 앞이라 "Lighting" 에 먼저 걸리지 않는다
  // (병원 건축·전기의 분전반이 조명 brick:Luminaire 로 나갔다, 2026-10-03).
  { kind: 'panel', label: '분전반', test: /분전반|\bPNL\b|breaker\s*panel|panel\s*board/i, brick: 'brick:Breaker_Panel', role: null, ifc: ['ElectricDistributionBoard.DISTRIBUTIONBOARD'], flow: {} },
  { kind: 'lighting', label: '조명', test: /조명|가로등|luminaire|lighting|pendant|[_\s-]light\b|^light\b/i, brick: 'brick:Luminaire', role: 'terminal', ifc: ['LightFixture'], flow: {} },
  // --- 관제점 후보(F13) ------------------------------------------------------------
  { kind: 'smoke_detector', label: '연기감지기', test: /연기\s*감지|smoke\s*detect/i, brick: 'brick:Smoke_Detector', role: 'sensing', ifc: ['Sensor.SMOKESENSOR'], flow: {}, point: true },
  { kind: 'heat_detector', label: '열감지기', test: /열\s*감지|heat\s*detect/i, brick: 'brick:Heat_Detector', role: 'sensing', ifc: ['Sensor.HEATSENSOR'], flow: {}, point: true },
  { kind: 'camera', label: 'CCTV', test: /camera|CCTV|카메라/i, brick: 'brick:Camera', role: 'sensing', ifc: ['AudioVisualAppliance.CAMERA'], flow: {}, point: true },
  // --- 설비가 아닌 비치품 ----------------------------------------------------------
  // Revit 은 "배관 기구" 범주에 든 욕실 부속·소화기함까지 IfcSanitaryTerminal 로 내보낸다. 병원 건축의 위생기구 101대 중
  // 97대가 안전손잡이·거울·수건함·소화기함·샤워 의자였고, 물을 받는 기구로 잡혀 연결망 검사에서 97대가 "떨어짐" 으로
  // 떴다. 이름이 IFC 클래스보다 먼저라(EF-11 과 같다) 이름으로 걸러 흐름 없는 종류로 둔다. 진짜 기구(세면기·변기·샤워)는
  // 이름이 여기 걸리지 않고 IFC 값대로 위생기구가 된다.
  { kind: 'washroom_accessory', label: '욕실 부속(손잡이·거울·수건함)', test: /grab\s*bar|mirror|towel|tissue|toilet\s*paper|soap\s*dispens|hand\s*dryer|shower\s*seat|안전\s*손잡이|거울|수건|휴지/i, brick: null, role: 'terminal', flow: {} },
  { kind: 'fire_extinguisher', label: '소화기(함)', test: /fire\s*extinguish|소화기/i, brick: null, role: 'terminal', flow: {} },
  // --- 사람만 고르는 종류 ---------------------------------------------------------
  // 병원 MEP 에서 종류를 모르는 기기 1,765대 중 1,376대가 콘센트·스프링클러였는데 고를 종류가 없었다. Brick 1.4 에
  // 맞는 이름을 확인하지 못해 전부 `ex:` 로 나간다.
  { kind: 'receptacle', label: '콘센트', hint: 'receptacle outlet socket', test: NEVER, brick: null, role: 'terminal', ifc: ['Outlet.POWEROUTLET'], flow: {}, manual: true },
  { kind: 'sprinkler', label: '스프링클러 헤드', hint: 'sprinkler', test: NEVER, brick: null, role: 'terminal', ifc: ['FireSuppressionTerminal.SPRINKLER'], flow: { water: 'sink' }, manual: true },
  { kind: 'plumbing_fixture', label: '위생기구(세면기·싱크·샤워)', hint: 'lavatory sink shower toilet closet urinal 세면기 변기 소변기 샤워', test: NEVER, brick: null, role: 'terminal', ifc: ['SanitaryTerminal'], flow: { water: 'sink' }, manual: true },
  { kind: 'water_heater', label: '급탕기', hint: 'water heater 온수기 전기온수기', test: NEVER, brick: null, role: 'conversion', flow: { water: 'source' }, manual: true },
  { kind: 'transformer', label: '변압기', hint: 'transformer', test: NEVER, brick: null, role: 'conversion', ifc: ['Transformer'], flow: {}, manual: true },
  // 시스템에어컨 실외기. IFC4 에 없어 USERDEFINED 로 적게 했다. Brick 1.4 에는 없지만 받는 쪽(ttl.go equipClass)이
  // Outdoor_Unit 을 ODU 로 읽는다 — Indoor_Unit 과 같은 선례다. 냉매 계통이라 공기·물 흐름 규칙에는 들지 않는다.
  { kind: 'outdoor_unit', label: '시스템에어컨 실외기', hint: 'outdoor unit condensing ODU', test: NEVER, brick: 'brick:Outdoor_Unit', role: 'conversion', ifc: ['UnitaryEquipment.OUTDOORUNIT'], flow: {}, manual: true },
  // 방열기. ifc4Mep 의 IfcSpaceHeater RADIATOR 30대. 순환수를 받는 말단이다.
  { kind: 'radiator', label: '방열기', hint: 'radiator convector 라디에이터', test: NEVER, brick: 'brick:Radiator', role: 'terminal', ifc: ['SpaceHeater.RADIATOR'], flow: { water: 'sink' }, manual: true },
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
 * IFC 표준 값이지만 요구하지 않는 것. 종류를 가르지 못해서다 — `SPLITSYSTEM` 은 실내기와 실외기를 가르지 않는다
 * (병원 HVAC 는 급기·환기 풍량을 가진 패키지 공조기에 썼다). requirements.ids 의 R24 가 이 값을 받지 않고,
 * 요구사항 보고서도 표준 자리로 세지 않는다.
 */
export const IFC_REJECTED: readonly string[] = ['UnitaryEquipment.SPLITSYSTEM']

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

/**
 * IFC 클래스를 화면에 보일 우리말로. 종류(kind)가 없는 설비가 무엇인지 말할 때 쓴다 — 덕트·배관·이음쇠는 종류를
 * 붙이지 않아서, 연결 목록에 이름(`DUCT-01`, `Pipe Types:Standard:745565`)만 보이면 무엇인지 알 수 없었다.
 * 종류를 정하는 데는 쓰지 않는다(그건 `ifc` 표와 이름 사전의 일이다). 표에 없으면 null.
 */
const IFC_CLASS_LABEL: Record<string, string> = {
  DuctSegment: '덕트',
  DuctFitting: '덕트 이음쇠',
  PipeSegment: '배관',
  PipeFitting: '배관 이음쇠',
  CableSegment: '케이블',
  CableFitting: '케이블 이음쇠',
  CableCarrierSegment: '전선관',
  CableCarrierFitting: '전선관 이음쇠',
  FlowSegment: '덕트·배관',
  FlowFitting: '덕트·배관 이음쇠',
  AirTerminal: '공기 말단',
  AirTerminalBox: 'VAV·CAV 박스',
  Damper: '댐퍼',
  Valve: '밸브',
  Pump: '펌프',
  Fan: '팬',
  Coil: '코일',
  Boiler: '보일러',
  Chiller: '냉동기',
  CoolingTower: '냉각탑',
  HeatExchanger: '열교환기',
  UnitaryEquipment: '공조 기기',
  Filter: '필터',
  Tank: '탱크',
  Sensor: '센서',
  Actuator: '구동기',
  Controller: '제어기',
  Alarm: '경보기',
  FlowMeter: '유량계',
  LightFixture: '조명',
  Lamp: '조명',
  Outlet: '콘센트',
  SwitchingDevice: '스위치',
  // 분전반 안의 차단기·퓨즈. ifc4Mep 의 F1~F13 이 배치점 없이 들어온다(미배치 목록, OE-BIM-07).
  ProtectiveDevice: '보호기(차단기·퓨즈)',
  ElectricAppliance: '전기 기기',
  SanitaryTerminal: '위생기구',
  WasteTerminal: '배수구',
  FireSuppressionTerminal: '소화 설비',
  SpaceHeater: '난방기',
  FlowTerminal: '말단 기기',
  FlowController: '조절 기기',
  FlowMovingDevice: '이송 기기',
  FlowStorageDevice: '저장 기기',
  FlowTreatmentDevice: '처리 기기',
  EnergyConversionDevice: '에너지 변환 기기',
  DistributionControlElement: '계측·제어 기기',
  BuildingElementProxy: '기타(Proxy)',
}

/** `AirTerminal.DIFFUSER` 나 `FlowSegment` 같은 IFC 클래스(PredefinedType 이 붙어도 된다)의 우리말. */
export function ifcClassLabel(ifcClass: string | null | undefined): string | null {
  if (!ifcClass) return null
  return IFC_CLASS_LABEL[ifcClass.split('.')[0]] ?? null
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
  // 성수 건축의 영문 이름(OE-SPC-17): `Air Handling Unit Room` 7개, `MECH.` 1개.
  { kind: 'mechanical', label: '기계실', test: /machine\s*room|mech(anical)?\s*room|^\s*MECH\.?\s*$|air\s*handling\s*unit\s*room|\bAHU\s*room|\bHVAC\b|pump\s*room|기계실|공조실|펌프실/i, brick: 'brick:Mechanical_Room', omniclass: ['13-81 21 17'] },
  { kind: 'electrical', label: '전기실', test: /\bEPS\b|electric|\bUPS\s*room|전기실|변전실/i, brick: 'brick:Electrical_Room', omniclass: ['13-81 21 21'] },
  { kind: 'telecom', label: '통신실', test: /\bTPS\b|\bMDF\b|\bIDF\b|telecom|통신실/i, brick: 'brick:Telecom_Room' },
  { kind: 'server', label: '전산실', test: /server|전산실/i, brick: 'brick:Server_Room' },
  { kind: 'storage', label: '창고', test: /storage|창고/i, brick: 'brick:Storage_Room', omniclass: ['13-75 11 11'] },
  { kind: 'janitor', label: '청소도구실', test: /\bJAN\b\.?|janitor|청소/i, brick: 'brick:Janitor_Room' },
  { kind: 'hallway', label: '복도', test: /corridor|\bCORR\b\.?|hallway|복도/i, brick: 'brick:Hallway', omniclass: ['13-85 11 11'] },
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

/** 앞 낱말을 꾸밈말로 만드는 자리 말. `계단 앞 복도` 의 `계단` 은 복도가 어디 있는지를 말할 뿐이다. */
const LOCATIVE = /^\s*(앞|옆|뒤|쪽|근처|주변|맞은편|건너편)(의|에)?(?![가-힣])/
const ROOM_KINDS_G = ROOM_KINDS.map((k) => ({ info: k, all: new RegExp(k.test.source, k.test.flags.replace('g', '') + 'g') }))

/** 한 이름 조각에서 종류를 가리키는 마지막 낱말(머리). 우리말도 영어도 이름의 머리가 뒤에 온다(`사무실 옆 계단실`, `ELEV. LOBBY`). */
function headKind(text: string): RoomKindInfo | null {
  let best: { info: RoomKindInfo; at: number } | null = null
  for (const { info, all } of ROOM_KINDS_G) {
    for (const m of text.matchAll(all)) {
      if (LOCATIVE.test(text.slice(m.index + m[0].length))) continue
      if (!best || m.index > best.at) best = { info, at: m.index }
    }
  }
  return best?.info ?? null
}

/**
 * 이름 사전으로 방 종류를 읽는다. 한 이름에 여러 종류가 걸리면 이름의 머리를 따른다 — 목록 순서로 첫 것을 고르던 때는
 * `계단 앞 복도` 가 계단실, `창고(구 회의실)` 가 회의실, `화장실 청소도구실` 이 화장실이 됐다. 방 이름 고치기가 방 종류를 바로잡는 길이라(edit.ts 의
 * renameSpace) 사람이 치는 이런 이름에서 틀리면 안 된다.
 * - 자리 말(앞·옆·뒤) 앞의 낱말은 꾸밈말이라 세지 않는다. `화장실 앞 대기` 는 화장실이 아니다(사전이 모르면 모름).
 * - 괄호 안은 덧붙인 말이라 괄호 밖이 아무것도 말하지 않을 때만 본다.
 * - `/`·`,` 로 나란히 적은 이름(`TPS/EPS`)과 방 번호는 조각마다 머리를 찾고, 조각끼리는 예전처럼 목록 순서로 고른다.
 *   가진 BIM 의 임포트 결과를 바꾸지 않으려는 것이다(check:sample).
 */
function roomKindByName(longName: string, name: string): RoomKindInfo | null {
  const pieces = (text: string) => text.split(/[/,&+·]/)
  const pick = (texts: string[]) => {
    const heads = new Set(texts.flatMap(pieces).map(headKind).filter((k): k is RoomKindInfo => k !== null))
    return ROOM_KINDS.find((k) => heads.has(k)) ?? null
  }
  const plain = (t: string) => t.replace(/\([^)]*\)?/g, ' ')
  return pick([plain(longName), plain(name)]) ?? pick([longName, name])
}

/**
 * 방 종류와 그 출처. 이름 사전이 먼저다 — 병원의 `JAN. CL.` 은 OmniClass 로는 창고(13-75 11 11)지만 이름이 청소도구실이라고
 * 더 좁게 말한다. 이름이 모를 때 OmniClass 코드를 쓰고, 그때 출처는 BIM 이다.
 */
export function resolveRoomKind(name: string, longName = '', omniclass: string | null = null): { info: RoomKindInfo; source: KindSource } | null {
  const byName = roomKindByName(longName, name)
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
  /**
   * TTL 계통 클래스. Brick 에는 급기·환기를 가르는 계통 클래스가 없어서 공기 계통은 `brick:Air_System` 하나이고,
   * 급기인지 환기인지는 `ex:systemKind` 로 따로 적는다. 급수(냉수)는 Brick 에 맞는 계통 클래스가 없어 윗 클래스
   * `brick:Water_System` 으로 둔다 — 없는 이름을 지어내는 것보다 덜 구체적인 쪽이 안전하다.
   */
  brick: string
}

/**
 * 계통 분류 → 매체와 방향. Revit 은 IfcSystem 의 ObjectType 에 시스템 분류를 적는다
 * (한국어판: `급기`, `공기 배출`, `순환 공기`, `순환수 공급`, `순환수 순환`, `가정용 온수`, `위생`).
 *
 * 위생(배수)은 넣지 않았다. 흐름을 내보내는 원천 기기가 없어서 이 규칙으로는 방향을 못 정한다.
 */
export const SYSTEM_KINDS: SystemKindInfo[] = [
  { kind: 'supply_air', label: '급기', test: /급기|supply\s*air/i, medium: 'air', sense: 'out', brick: 'brick:Air_System' },
  { kind: 'exhaust_air', label: '배기', test: /공기\s*배출|배기|exhaust|extract\s*air/i, medium: 'air', sense: 'in', brick: 'brick:Air_System' },
  { kind: 'return_air', label: '환기', test: /순환\s*공기|환기|return\s*air/i, medium: 'air', sense: 'in', brick: 'brick:Air_System' },
  { kind: 'outside_air', label: '외기', test: /외기|outside\s*air|outdoor\s*air/i, medium: 'air', sense: 'out', brick: 'brick:Ventilation_Air_System' },
  // 지열수·응축수는 순환수보다 먼저 본다. "Geothermal supply water" 가 순환수의 `supply water` 에 먼저 걸린다.
  { kind: 'geothermal_supply', label: '지열수 공급', test: /지열수?\s*공급|geothermal\s*(supply|flow)|\bGWS\b/i, medium: 'water', sense: 'out', brick: 'brick:Water_System' },
  { kind: 'geothermal_return', label: '지열수 환수', test: /지열수?\s*(환수|순환)|geothermal\s*return|\bGWR\b/i, medium: 'water', sense: 'in', brick: 'brick:Water_System' },
  { kind: 'condensate_return', label: '응축수 환수', test: /응축수|condensate/i, medium: 'water', sense: 'in', brick: 'brick:Steam_System' },
  { kind: 'hydronic_supply', label: '순환수 공급', test: /순환수\s*공급|hydronic\s*supply|냉온수\s*공급|(heat(ing)?|cooling)\s*flow|supply\s*water/i, medium: 'water', sense: 'out', brick: 'brick:Water_System' },
  { kind: 'hydronic_return', label: '순환수 환수', test: /순환수\s*순환|순환수\s*환수|hydronic\s*return|냉온수\s*환수|(heat(ing)?|cooling)\s*return|return\s*water/i, medium: 'water', sense: 'in', brick: 'brick:Water_System' },
  { kind: 'domestic_hot_water', label: '급탕', test: /가정용\s*온수|급탕|domestic\s*hot|hot\s*water/i, medium: 'water', sense: 'out', brick: 'brick:Domestic_Hot_Water_System' },
  { kind: 'steam', label: '증기', test: /증기|스팀|steam|\bSTM\b/i, medium: 'water', sense: 'out', brick: 'brick:Steam_System' },
  { kind: 'fire_protection', label: '소화', test: /소화|스프링클러|sprinkler|fire\s*protection|\bFP\b/i, medium: 'water', sense: 'out', brick: 'brick:Fire_Safety_System' },
  { kind: 'refrigerant', label: '냉매', test: /냉매|refrigerant|\bREF\b/i, medium: 'refrigerant', sense: 'out', brick: 'brick:Refrigeration_System' },
  { kind: 'domestic_cold_water', label: '급수', test: /가정용\s*냉수|급수|domestic\s*cold|cold\s*water/i, medium: 'water', sense: 'out', brick: 'brick:Water_System' },
]

const SYSTEM_BY_KIND = new Map(SYSTEM_KINDS.map((k) => [k.kind, k]))

/**
 * IFC 가 계통 종류를 말하는 법. **이 표가 곧 고객사에 요구하는 어휘(`docs/requirements.ids` 의 R16)다.**
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
  alone: { DOMESTICHOTWATER: 'domestic_hot_water', DOMESTICCOLDWATER: 'domestic_cold_water', EXHAUST: 'exhaust_air', FIREPROTECTION: 'fire_protection', REFRIGERATION: 'refrigerant' },
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

// --- 유체 -------------------------------------------------------------------------
//
// 순환수 공급·환수는 냉수인지 온수인지가 따로다. 계통 종류(공급·환수)는 흐름 방향을, 유체는 무엇이 흐르는지를 말한다 —
// 냉동기 쪽 배관과 보일러 쪽 배관이 같은 "순환수 공급" 이라 한 클래스(`brick:Water_System`)로 나갔다. Brick 에는
// 유체마다 계통 클래스가 있어서(`Chilled_Water_System`·`Hot_Water_System`·`Condenser_Water_System`) 알면 그걸로 낸다.
// 급탕·급수는 계통 종류가 이미 유체를 말하므로 여기서 다루지 않는다.

export type Fluid = 'chilled' | 'hot' | 'condenser'

export type FluidInfo = {
  fluid: Fluid
  label: string
  /** 이 값을 말하는 `IfcDistributionSystem.PredefinedType`. R16 이 이미 요구하는 자리라 어휘가 늘지 않는다. */
  predefined: string
  /** 이름·ObjectType 에서 읽는 식. 두 유체가 같이 맞으면(`냉온수`) 정하지 않는다. */
  test: RegExp
  brick: string
}

export const FLUIDS: FluidInfo[] = [
  { fluid: 'chilled', label: '냉수', predefined: 'CHILLEDWATER', test: /냉수|냉온수|냉방|chill|cooling|\bKVK\b|\bFRK\b/i, brick: 'brick:Chilled_Water_System' },
  { fluid: 'hot', label: '온수', predefined: 'HEATING', test: /온수|난방|heating|heat\s*(flow|return)|\bHHF\b|\bHHR\b/i, brick: 'brick:Hot_Water_System' },
  { fluid: 'condenser', label: '냉각수', predefined: 'CONDENSERWATER', test: /냉각수|condenser/i, brick: 'brick:Condenser_Water_System' },
]

/** 유체를 가를 수 있는 계통 종류. 순환수만이다. */
export const FLUID_KINDS: readonly string[] = ['hydronic_supply', 'hydronic_return']

export function fluidInfo(fluid: Fluid | null | undefined): FluidInfo | null {
  return fluid ? (FLUIDS.find((f) => f.fluid === fluid) ?? null) : null
}

/**
 * 순환수 계통의 유체와 출처. PredefinedType 이 먼저고(BIM), 없거나 NOTDEFINED 면 이름을 본다(사전). ifc4Mep 은 같은
 * `Heat Flow` 계통 둘 중 하나에만 HEATING 을 적었다. 이름에 냉·온이 다 있으면(`냉온수 공급`) 모른다 — 한쪽으로 찍지 않는다.
 * 순환수가 아닌 계통은 null 이다.
 */
export function resolveFluid(
  kind: string | null | undefined,
  name: string,
  objectType = '',
  predefined: string | null = null,
): { fluid: Fluid; source: KindSource } | null {
  if (!kind || !FLUID_KINDS.includes(kind)) return null
  const byIfc = FLUIDS.find((f) => f.predefined === predefined)
  if (byIfc) return { fluid: byIfc.fluid, source: 'bim' }
  const text = `${objectType} ${name}`
  const hits = FLUIDS.filter((f) => f.test.test(text))
  return hits.length === 1 ? { fluid: hits[0].fluid, source: 'dict' } : null
}

/** TTL 계통 클래스. 유체를 아는 순환수는 유체 클래스, 아니면 계통 종류의 클래스다. */
export function systemBrickClass(kind: string | null | undefined, fluid: Fluid | null | undefined): string | null {
  const info = systemKind(kind)
  if (!info) return null
  const f = FLUID_KINDS.includes(info.kind) ? fluidInfo(fluid) : null
  return f?.brick ?? info.brick
}
