// 용량으로 받는 속성과 그 양의 종류.
//
// **양의 종류를 같이 든다.** 한때 풍량과 출력을 한 칸에 담아 전부 `ex:nominalAirFlowRate` 로 내보냈다. 냉동기의
// NominalCapacity(W)가 풍량으로 나간다. 무엇이 흐르는지 모르는 저작 도구 이름(Revit 의 `Flow` 는 디퓨저에서는 공기,
// 방열기에서는 물이다)은 모른다고 둔다.

export type CapacityQuantity = 'airflow' | 'waterflow' | 'power' | 'flow'

/**
 * **앞에 있을수록 우선한다.** 표준 이름을 저작 도구 이름보다 먼저 둔다 — 둘 다 있으면 표준 쪽이 검증을 거친 값이다.
 *
 * 앞쪽은 IFC4 표준 Pset 의 이름이고 `docs/requirements.ids` 의 R21 이 요구하는 것과 같다. 대부분 타입 객체의
 * `Pset_*TypeCommon` 에 붙는다. 공조기·FCU 는 IFC4 표준에 용량 자리가 없어 `DT_Capacity.NominalAirFlowRate` 로
 * 적게 한다(이름은 팬·VAV 의 표준 속성과 같게 두었다). 뒤쪽은 Revit 이 붙이는 이름이다.
 */
export const CAPACITY_PROPERTIES: readonly { name: string; quantity: CapacityQuantity; standard: boolean }[] = [
  { name: 'NominalAirFlowRate', quantity: 'airflow', standard: true }, // Pset_FanTypeCommon, Pset_AirTerminalBoxTypeCommon, DT_Capacity
  { name: 'AirFlowRate', quantity: 'airflow', standard: true }, // Pset_AirTerminalOccurrence
  { name: 'AirFlowrateRange', quantity: 'airflow', standard: true }, // Pset_AirTerminalTypeCommon. 범위라 설정값, 없으면 위 끝
  { name: 'FlowRateRange', quantity: 'waterflow', standard: true }, // Pset_PumpTypeCommon
  { name: 'NominalCapacity', quantity: 'power', standard: true }, // Pset_ChillerTypeCommon, Pset_CoolingTowerTypeCommon
  { name: 'OutputCapacity', quantity: 'power', standard: true }, // Pset_SpaceHeaterTypeCommon
  // IFC4 에는 성능 이력(Pset_CooledBeamPHistory)에만 있어 설계 용량의 표준 자리가 아니다.
  { name: 'TotalCoolingCapacity', quantity: 'power', standard: false },
  // Revit 이 내보내는 이름들. 공백이 들어간 것도 그대로 쓴다.
  { name: 'Air Flow', quantity: 'airflow', standard: false },
  { name: 'Flow', quantity: 'flow', standard: false },
  { name: 'Design Flow', quantity: 'flow', standard: false },
  { name: 'Rated Flow', quantity: 'flow', standard: false },
]

const RANK = new Map(CAPACITY_PROPERTIES.map((p, i) => [p.name, i]))
const QUANTITY = new Map(CAPACITY_PROPERTIES.map((p) => [p.name, p.quantity]))
const STANDARD = new Set(CAPACITY_PROPERTIES.filter((p) => p.standard).map((p) => p.name))

/** IFC4 표준 Pset(또는 공조기·FCU 에 정해 둔 DT_Capacity)의 이름인가. 아니면 저작 도구가 붙인 이름이다. */
export function isStandardCapacity(property: string | null | undefined): boolean {
  return !!property && STANDARD.has(property)
}

/** 용량 속성의 우선순위. 작을수록 앞선다. 용량이 아니면 -1. */
export function capacityRank(property: string): number {
  return RANK.get(property) ?? -1
}

export function capacityQuantity(property: string | null | undefined): CapacityQuantity | null {
  return property ? (QUANTITY.get(property) ?? null) : null
}

/** TTL 술어. 양의 종류마다 따로 둔다. */
export const CAPACITY_PREDICATE: Record<CapacityQuantity, string> = {
  airflow: 'ex:nominalAirFlowRate',
  waterflow: 'ex:nominalWaterFlowRate',
  power: 'ex:nominalCapacity',
  flow: 'ex:nominalFlowRate',
}

/**
 * 용량을 요구하는 종류. requirements.ids 의 R21 이 요구하는 클래스(공조기·FCU 류, 팬, 펌프, 냉동기, 냉각탑,
 * 방열기, VAV, 에어 터미널)와 같다. 보일러는 IFC4 표준 Pset 에 출력 자리가 없어 빠진다.
 * 요구사항 보고서(R21)와 임포트 경고가 같은 것을 센다 — 경고가 덕트·배관과 거울까지 세서 ifc4Mep 기기 308대에
 * "2130대에 용량이 없다" 고 했다.
 */
export const CAPACITY_KINDS = new Set([
  'ahu', 'fcu', 'indoor_unit', 'heat_pump', 'ground_source_heat_pump',
  'fan', 'exhaust_fan', 'pump', 'chiller', 'cooling_tower', 'radiator',
  'vav', 'air_diffuser', 'air_grille', 'outdoor_louver',
])
