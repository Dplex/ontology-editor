import { describe, expect, it } from 'vitest'
import { EQUIPMENT_KINDS, equipmentKindOf, roomKindOf, systemKindOf } from './kinds'

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

  it('위생(배수)은 원천이 없어 규칙 대상이 아니다', () => {
    expect(systemKindOf('위생 6', '위생')).toBeNull()
    expect(systemKindOf('Unit A Sanitary')).toBeNull()
  })
})

describe('사람만 고르는 종류', () => {
  it('사전은 그 이름을 읽지 않는다 — 사전을 넓히면 가진 BIM 전부의 숫자가 움직인다', () => {
    const manual = EQUIPMENT_KINDS.filter((k) => k.manual)
    expect(manual.map((k) => k.kind)).toEqual(['receptacle', 'sprinkler', 'plumbing_fixture', 'water_heater', 'transformer'])
    for (const name of ['M_Duplex Receptacle:Standard:Standard:1', 'M_Sprinkler - Pendent - Hosted:15 mm:1', 'M_Water Heater:380 L:380 L:1']) {
      expect(manual.map((k) => k.kind)).not.toContain(kind(name))
    }
    // Brick 1.4 에 맞는 이름을 확인하지 못했다. ex: 로 나간다.
    for (const k of manual) expect(k.brick).toBe(null)
  })
})
