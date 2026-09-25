import { describe, expect, it } from 'vitest'
import { EQUIPMENT_KINDS, equipmentKindOf, equipmentKindOfIfc, ifcClassLabel, omniclassCode, resolveEquipmentKind, resolveRoomKind, roomKindOf, systemKindOf } from './kinds'

// 입력은 성수·Duplex·ifc4Mep 실측 파일에 실제로 나온 이름이다. 사전을 넓히면 이 표에서 무엇이 바뀌는지 보인다.
const kind = (name: string, objectType = '', ifcClass = '') => equipmentKindOf(name, objectType, ifcClass)?.kind ?? null

describe('설비 종류 사전', () => {
  it.each([
    ['FCU3:FCU3:123456', 'fcu'],
    ['FCU2_250:FCU2_250:1', 'fcu'],
    ['AHU2:AHU2:77', 'ahu'],
    ['GSHP:GSHP:9', 'ground_source_heat_pump'],
    ['GHX:GHX:3', 'ground_heat_exchanger'],
    ['M_인라인 펌프:표준:5', 'pump'],
    ['천장형 시스템에어컨 (1).0004:1', 'indoor_unit'],
    ['NBS_S&PUKVentilationSystemsLtd_PltHeatExchngrs_CounterFlowHeatRecoverySeries_CADCompactAdvanced_500-1800', 'heat_recovery'],
    ['Fan-Exhaust_Wall_Mounted:1', 'exhaust_fan'],
    ['Fan-Supply_Wall_Mounted:1', 'fan'],
    ['EF-11:EF-11:1', 'exhaust_fan'],
    ['OHU1:OHU1:1', 'ahu'],
    ['VENCO_JetFans_ReversibleType_VAX-JR_VAX-JR4', 'fan'],
    ['M_공급 디퓨져_원형:300', 'air_diffuser'],
    ['라인디퓨저:2slot:1', 'air_diffuser'],
    ['M_순환 그릴 - 직사각형 - 호스트:1', 'air_grille'],
    ['M_루버 - 태풍 안전성_EA', 'outdoor_louver'],
    ['Vent-Cap_OA', 'outdoor_louver'],
    ['M_방화 댐퍼 - 직사각형 - 단순:표준', 'damper'],
    ['Ruskin - A36 - Tapered Rectangular Silencer', 'silencer'],
    ['Water_meter-Caleffi-7942_DN15-DN50', 'water_meter'],
    ['LV PNL:LV1_800x2000x2500', 'panel'],
    ['분전반:표준', 'panel'],
    ['화재경보_열감지기:1', 'heat_detector'],
    ['화재경보_광전식_연기감지기:1', 'smoke_detector'],
    ['Security_Camera-Vivotek-.Ext_Dome-2', 'camera'],
    ['Wall_Light:1', 'lighting'],
    ['라인조명:1', 'lighting'],
  ])('%s → %s', (name, expected) => {
    expect(kind(name)).toBe(expected)
  })

  it.each(['RThisWheelStops850', 'Escalator_(AUS)', '2층 캐노피 03', 'Rectangular Duct:Standard', 'Trench Drain', '1.6.6'])(
    '모르는 이름은 null 로 둔다: %s',
    (name) => {
      // 추측으로 넓히면 틀린 Brick 클래스가 온톨로지에 들어간다. 빈칸이 낫다.
      expect(kind(name)).toBeNull()
    },
  )

  it('이름이 번호뿐이면 IFC4 클래스로 찾는다', () => {
    expect(kind('1.2.3', '', 'Boiler')).toBe('boiler')
    expect(kind('1.6.6', '', 'AirTerminal')).toBe('air_diffuser')
  })

  it('이름이 클래스보다 먼저다', () => {
    // IFC4 의 UnitaryEquipment 는 공조기로 보지만, 이름이 FCU 라고 하면 FCU 다.
    expect(kind('FCU-1', '', 'UnitaryEquipment')).toBe('fcu')
  })
})

describe('IFC 가 말한 종류', () => {
  const ifc = (declared: string) => equipmentKindOfIfc(declared)?.kind ?? null

  it.each([
    // 병원 HVAC(IFC2x3 타입 객체), ifc4Mep(IFC4 개체)에 실제로 나온 값
    ['AirTerminal.DIFFUSER', 'air_diffuser'],
    ['AirTerminal.REGISTER', 'air_grille'],
    ['AirTerminal.GRILLE', 'air_grille'],
    ['AirTerminalBox.VARIABLEFLOWPRESSUREDEPENDANT', 'vav'],
    ['UnitaryEquipment.AIRHANDLER', 'ahu'],
    ['Outlet.POWEROUTLET', 'receptacle'],
    ['Sensor.HEATSENSOR', 'heat_detector'],
    // 클래스만으로 정해지는 것은 값을 가리지 않는다
    ['Boiler.WATER', 'boiler'],
    ['Fan.CENTRIFUGALFORWARDCURVED', 'fan'],
    ['Fan.200 mm', 'fan'],
    ['Valve', 'valve'],
    // IFC4 에 없어 USERDEFINED 로 적게 한 이름. 대소문자는 가리지 않는다
    ['UnitaryEquipment.FANCOILUNIT', 'fcu'],
    ['UnitaryEquipment.fancoilunit', 'fcu'],
    ['HeatExchanger.GROUNDHEATEXCHANGER', 'ground_heat_exchanger'],
  ])('%s → %s', (declared, expected) => {
    expect(ifc(declared)).toBe(expected)
  })

  it.each(['UnitaryEquipment.SPLITSYSTEM', 'AirTerminal.SD-1200mm', 'Sensor.MOVEMENTSENSOR', 'HeatExchanger.SHELLANDTUBE', 'FlowTerminal'])(
    '표에 없는 값은 null: %s',
    (declared) => {
      expect(ifc(declared)).toBeNull()
    },
  )

  it('이름 사전이 먼저다 — 이름이 더 좁게 말한다', () => {
    // 성수의 EF-11 은 IFC 로는 팬이지만 배기팬이다.
    expect(resolveEquipmentKind('EF-11:EF-11:1', '', 'FlowMovingDevice', 'Fan')).toEqual({ info: expect.objectContaining({ kind: 'exhaust_fan' }), source: 'dict' })
  })

  it('이름이 모르면 IFC 가 말한 것을 쓰고, 출처는 BIM 이다', () => {
    expect(resolveEquipmentKind('150 mm', '', 'FlowTerminal', 'AirTerminalBox.VARIABLEFLOWPRESSUREDEPENDANT')).toEqual({ info: expect.objectContaining({ kind: 'vav' }), source: 'bim' })
  })

  it('BIM 이 값을 말했는데 표에 없으면 클래스로 추측하지 않는다', () => {
    // SPLITSYSTEM 은 실내기와 실외기를 가르지 않는다. 공조기로 추측하면 BIM 이 한 말을 덮는다.
    expect(resolveEquipmentKind('63300000 J', '', 'UnitaryEquipment', 'UnitaryEquipment.SPLITSYSTEM')).toBeNull()
    // 값을 말하지 않았으면 추측한다(출처는 사전).
    expect(resolveEquipmentKind('1.6.6', '', 'UnitaryEquipment', 'UnitaryEquipment')).toEqual({ info: expect.objectContaining({ kind: 'ahu' }), source: 'dict' })
  })
})

describe('방 종류 사전', () => {
  it.each([
    ['OFFICE', 'office'],
    ['Office Storage-2', 'storage'],
    ['W Toilet', 'restroom'],
    ['ACC. Toilet (M)', 'restroom'],
    ['Break Room', 'break'],
    ['Staircase-1', 'staircase'],
    ['Emergency Elev. Hall', 'lobby'],
    ['Emergency Elevator Hall', 'lobby'],
    ['Lobby', 'lobby'],
    ['Machine Room', 'mechanical'],
    ['HVAC', 'mechanical'],
    ['TPS/EPS', 'electrical'],
    ['MDF', 'telecom'],
    ['JAN.', 'janitor'],
    ['Mngmt Corridor', 'hallway'],
    ['회의실', 'conference'],
    ['사무실', 'office'],
  ])('%s → %s', (name, expected) => {
    expect(roomKindOf('', name)?.kind).toBe(expected)
  })

  it.each(['Vestibule-1', 'P.S', 'P.S/A.V', 'O.A', 'Digestion Chamber1', 'Buero'])('모르는 방은 null: %s', (name) => {
    expect(roomKindOf('', name)).toBeNull()
  })

  it.each([
    // Revit 이 적는 세 가지 모양(병원·Duplex 건축, COBie 판본)
    ['13-15 11 34 11', '13-15 11 34 11'],
    ['13-15 11 34 11: Office', '13-15 11 34 11'],
    ['13-81 31: Service Distribution Spaces', '13-81 31'],
    // 설비 판본은 설명만 적기도 한다
    ['Office', null],
    ['', null],
  ])('OmniClass 코드를 꺼낸다: %s', (text, code) => {
    expect(omniclassCode(text)).toBe(code)
  })

  it.each([
    // 병원 건축: 이름 사전이 놓치는 방을 OmniClass 가 말한다
    ['CONF. ROOM', '13-11 21 17', 'conference'],
    ['MECH. PENTHOUSE', '13-81 21 17', 'mechanical'],
    ['ELEC. ROOM', '13-81 21 21', 'electrical'],
    ['ELEVATOR', '13-81 21 31', 'elevator_shaft'],
    ['COMM. ROOM', '13-15 11 34 11', 'office'],
  ])('이름이 모르면 OmniClass 로 읽고 출처는 BIM 이다: %s', (name, code, expected) => {
    expect(resolveRoomKind('', name, code)).toEqual({ info: expect.objectContaining({ kind: expected }), source: 'bim' })
  })

  it('이름이 먼저다 — 병원의 JAN. CL. 은 OmniClass 로는 창고지만 청소도구실이다', () => {
    expect(resolveRoomKind('', 'JAN. CL.', '13-75 11 11')).toEqual({ info: expect.objectContaining({ kind: 'janitor' }), source: 'dict' })
  })

  it('표에 없는 코드는 넓히지 않는다 — 상위 코드가 같아도 다른 방이다', () => {
    // 13-75 41 24 위험물 창고, 13-51 21 11 침실, 13-41 11 14 11 욕실
    for (const code of ['13-75 41 24', '13-51 21 11', '13-41 11 14 11']) expect(resolveRoomKind('', 'Room', code)).toBeNull()
  })
})

describe('계통 종류 사전', () => {
  it.each([
    // 성수: Revit 한국어판이 ObjectType 에 적은 시스템 분류
    ['기계 급기 287', '급기', 'supply_air', 'air', 'out'],
    ['기계 공기 배출 53', '공기 배출', 'exhaust_air', 'air', 'in'],
    ['기계 순환 공기 14', '순환 공기', 'return_air', 'air', 'in'],
    ['순환수 공급 7', '순환수 공급', 'hydronic_supply', 'water', 'out'],
    ['순환수 순환 1', '순환수 순환', 'hydronic_return', 'water', 'in'],
    ['가정용 온수 2', '가정용 온수', 'domestic_hot_water', 'water', 'out'],
    // ifc4Mep: 이름에만 있다
    ['6_HHF Heat Flow', '', 'hydronic_supply', 'water', 'out'],
    ['7_HHR Heat Return', '', 'hydronic_return', 'water', 'in'],
    ['1_SUP Supply air', '', 'supply_air', 'air', 'out'],
    ['2_ETA Extract air', '', 'exhaust_air', 'air', 'in'],
    // Duplex: Revit System Name 속성
    ['Unit A Hydronic Supply In', '', 'hydronic_supply', 'water', 'out'],
    ['Unit B Domestic Cold Water', '', 'domestic_cold_water', 'water', 'out'],
  ])('%s (%s) → %s', (name, objectType, expected, medium, sense) => {
    const info = systemKindOf(name, objectType)
    expect(info?.kind).toBe(expected)
    expect(info?.medium).toBe(medium)
    expect(info?.sense).toBe(sense)
  })

  it.each([
    // IFC4 PredefinedType + ObjectType 약어(요구 어휘). 공기는 EN 12792
    ['AHU-1 SA', 'SUP', 'AIRCONDITIONING', 'supply_air'],
    ['x', 'ETA', 'VENTILATION', 'return_air'],
    ['x', 'EHA', 'EXHAUST', 'exhaust_air'],
    ['x', 'ODA', 'AIRCONDITIONING', 'outside_air'],
    ['x', 'FLOW', 'HEATING', 'hydronic_supply'],
    ['x', 'RETURN', 'CHILLEDWATER', 'hydronic_return'],
    ['x', '', 'DOMESTICHOTWATER', 'domestic_hot_water'],
    ['x', '', 'EXHAUST', 'exhaust_air'],
  ])('%s (%s, %s) → %s', (name, objectType, predefined, expected) => {
    expect(systemKindOf(name, objectType, predefined)?.kind).toBe(expected)
  })

  it('약어는 그 매체의 PredefinedType 과 함께일 때만 읽는다', () => {
    // RETURN 은 물 계통의 약어다. 공기 계통에 붙으면 방향을 정하지 않고 이름으로 넘어간다.
    expect(systemKindOf('x', 'RETURN', 'VENTILATION')).toBeNull()
    // 공조·환기만으로는 급기인지 환기인지 모른다.
    expect(systemKindOf('x', '', 'AIRCONDITIONING')).toBeNull()
  })

  it('위생(배수)은 원천이 없어 규칙 대상이 아니다', () => {
    expect(systemKindOf('위생 6', '위생')).toBeNull()
    expect(systemKindOf('Unit A Sanitary')).toBeNull()
  })
})

describe('이름으로는 읽지 않는 종류', () => {
  it('사전은 그 이름을 읽지 않는다 — 사전을 넓히면 가진 BIM 전부의 숫자가 움직인다. BIM 이 말하면 받는다', () => {
    const manual = EQUIPMENT_KINDS.filter((k) => k.manual)
    expect(manual.map((k) => k.kind)).toEqual(['receptacle', 'sprinkler', 'plumbing_fixture', 'water_heater', 'transformer', 'outdoor_unit', 'radiator'])
    for (const name of ['M_Duplex Receptacle:Standard:Standard:1', 'M_Sprinkler - Pendent - Hosted:15 mm:1', 'M_Water Heater:380 L:380 L:1']) {
      expect(manual.map((k) => k.kind)).not.toContain(kind(name))
    }
    // 앞의 다섯은 Brick 1.4 에 맞는 이름을 확인하지 못했다. ex: 로 나간다.
    for (const k of manual.slice(0, 5)) expect(k.brick).toBe(null)
    // 병원 전기의 콘센트 958개는 IfcOutletType 이 POWEROUTLET 이라고 말한다.
    expect(equipmentKindOfIfc('Outlet.POWEROUTLET')?.kind).toBe('receptacle')
  })
})

describe('IFC 클래스의 우리말', () => {
  it('종류가 없는 덕트·배관·이음쇠도 무엇인지 말한다', () => {
    expect(ifcClassLabel('DuctSegment')).toBe('덕트')
    expect(ifcClassLabel('PipeFitting')).toBe('배관 이음쇠')
    // IFC2x3 의 추상 클래스와 PredefinedType 이 붙은 값도 받는다.
    expect(ifcClassLabel('FlowSegment')).toBe('덕트·배관')
    expect(ifcClassLabel('AirTerminal.DIFFUSER')).toBe('공기 말단')
    // 모르는 클래스는 지어 부르지 않는다.
    expect(ifcClassLabel('SomethingElse')).toBeNull()
    expect(ifcClassLabel(null)).toBeNull()
  })
})
