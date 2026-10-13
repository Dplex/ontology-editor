// 용량 검증 Z-03 의 입력값(OE-ZON-06)과 판정(OE-ZON-05).
//
// **사이트가 설계한 값만 쓴다.** 에디터는 설계 풍량·정격 풍량을 계산하거나 기본값으로 채우지 않는다 — 환기 횟수·실 높이로 필요 풍량을
// 내면 그럴듯한 숫자로 잘못된 경고가 뜬다. 값이 없으면 비워 두고 Z-03 은 "판정 불가"(경고 아님)로 어느 값이 없는지 보인다.
//
// - 설계 풍량(공간 쪽): (R2 IDF →) BIM 물리존(R26) → 사람(공조존 또는 물리존). 앞의 값이 있으면 뒤는 보지 않는다.
// - 정격 풍량(설비 쪽): BIM(R21 의 용량이 풍량일 때) → 사람. 사람 값은 BIM 이 비운 곳만 채운다.
// - 단위는 읽을 때 CMH(m³/h)로 바꾼다(K9). 화면도 CMH 다.
// 설계 결정은 docs/adr/0054-capacity-check-inputs.md.

import type { DesignAirflow, Equipment, HvacZone, Model, Space, SpaceAirflow } from './model'

/** 1 m³/s = 3600 CMH. */
export const CMH_PER_M3S = 3600
/** 1 ft³/s 가 몇 m³/s 인지. Revit 의 내부 풍량 단위다. */
export const M3S_PER_FT3S = 0.028316846592

/**
 * BIM 의 풍량 값 하나를 CMH 로. 단위를 모르면 null — 모르는 단위로 바꾼 숫자는 틀린 경고를 낸다.
 *
 * - `IfcVolumetricFlowRateMeasure` 로 적힌 값은 파일이 선언한 풍량 단위다(`flowScale`, 선언이 없으면 m³/s).
 * - 단위 없는 `IfcReal`·`IfcInteger` 는 Revit 속성 세트(`PSet_Revit_*`)에 있을 때만 Revit 내부 단위 ft³/s 로 읽는다. 병원 MEP 의
 *   `Actual Supply Airflow` 8.2989… 는 235 L/s 를 ft³/s 로 적은 값이다(235 ÷ 28.3168). 다른 세트의 단위 없는 값은 모른다.
 */
export function flowToCmh(value: number, measure: string | undefined, pset: string, scale: number): number | null {
  if (!Number.isFinite(value)) return null
  if (measure === 'IFCVOLUMETRICFLOWRATEMEASURE') return value * scale * CMH_PER_M3S
  if ((measure === undefined || measure === 'IFCREAL' || measure === 'IFCINTEGER') && /^PSet_Revit/i.test(pset)) return value * M3S_PER_FT3S * CMH_PER_M3S
  return null
}

/** IfcSpace 의 설계 풍량 표준 자리. IFC2x3·IFC4 는 `Pset_SpaceThermalDesign`, IFC4.3 은 `Pset_SpaceAirHandlingDimensioning` 이다(R26). */
export const SPACE_AIRFLOW_PSETS = ['Pset_SpaceThermalDesign', 'Pset_SpaceAirHandlingDimensioning'] as const
/** 표준 자리의 속성 이름. 두 Pset 이 같은 이름을 쓴다. */
export const SPACE_AIRFLOW_PROPERTIES = { cooling: 'CoolingDesignAirflow', heating: 'HeatingDesignAirflow' } as const
/** Revit MEP 공간이 내보내는 설계 급기 풍량. `Actual Supply Airflow` 는 연결된 디퓨저 풍량의 합(계산값)이라 읽지 않는다. */
export const REVIT_SPACE_AIRFLOW = 'Specified Supply Airflow'

/** 설계 풍량을 표준 자리에서 읽었나. 아니면 다른 자리(Revit 속성 등)다 — 요구사항 보고서 R26 이 가른다. */
export function isStandardSpaceAirflow(a: SpaceAirflow | undefined): boolean {
  return !!a && a.source === 'bim' && SPACE_AIRFLOW_PSETS.some((p) => a.property?.startsWith(`${p}.`))
}

/**
 * 공조 대상이 아닌 방 종류(OE-REQ-07). R26 판정에서 "해당 없음"이다. 비공조 여부를 모르는 방(종류 모름)은 빼지 않는다 — 샤프트는 사전에
 * 종류가 없어 여기 없다.
 */
export const UNCONDITIONED_ROOM_KINDS: ReadonlySet<string> = new Set(['staircase', 'elevator_shaft'])

export type AirflowBasis = 'cooling' | 'heating' | 'supply'
export const BASIS_LABEL: Record<AirflowBasis, string> = { cooling: '냉방', heating: '난방', supply: '설계 급기' }

/** 건물의 공조존 전부(hvac-zone.ts 의 hvacZonesOf 와 같다). 그 파일이 이 파일을 읽으므로 서로 읽지 않게 여기 따로 둔다. */
const hvacZonesOf = (model: Model): HvacZone[] => [...(model.hvac?.zones ?? []), ...model.storeys.flatMap((s) => s.hvacZones ?? [])]

const positive = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * Z-03 이 견주는 설계 풍량. 냉방·난방이 둘 다 있으면 큰 값, 하나만 있으면 그 값이다(Q16) — 공간이 가장 많은 바람을 필요로 하는 순간과
 * 견주는 검사라서다. 냉방 우선으로 두면 난방이 더 큰 외주부·로비를 놓친다. 둘 다 없으면 냉방·난방을 가르지 않는 값(Revit)을 쓴다.
 */
export function airflowBasis(a: DesignAirflow | undefined): { cmh: number; basis: AirflowBasis } | null {
  if (!a) return null
  const c = positive(a.cooling) ? a.cooling : null
  const h = positive(a.heating) ? a.heating : null
  if (c !== null || h !== null) return (h ?? -1) > (c ?? -1) ? { cmh: h!, basis: 'heating' } : { cmh: c!, basis: 'cooling' }
  return positive(a.supply) ? { cmh: a.supply, basis: 'supply' } : null
}

/**
 * 물리존 여럿의 설계 풍량 합. 냉방은 냉방끼리, 난방은 난방끼리 더한 뒤 큰 쪽을 고른다 — 방마다 큰 값을 골라 더하면 냉방 정점과 난방
 * 정점이 섞인다. 한 종류라도 모든 방에 있어야 그 종류의 합이 선다.
 */
function sumOf(list: readonly DesignAirflow[]): { cmh: number; basis: AirflowBasis } | null {
  const total = (key: AirflowBasis) => (list.every((a) => positive(a[key])) ? list.reduce((t, a) => t + (a[key] as number), 0) : null)
  return airflowBasis({ cooling: total('cooling'), heating: total('heating'), supply: total('supply') })
}

const sameAirflow = (a: DesignAirflow | undefined, b: DesignAirflow | undefined) =>
  (a?.cooling ?? null) === (b?.cooling ?? null) && (a?.heating ?? null) === (b?.heating ?? null) && (a?.supply ?? null) === (b?.supply ?? null)

/** 사람이 넣는 값을 다듬는다. 0 이하·숫자 아님은 빈칸이다. 둘 다 비면 null(값을 지운다). */
export function cleanAirflow(v: { cooling?: number | null; heating?: number | null } | null): DesignAirflow | null {
  if (!v) return null
  const cooling = positive(v.cooling) ? v.cooling : null
  const heating = positive(v.heating) ? v.heating : null
  return cooling === null && heating === null ? null : { cooling, heating }
}

const findSpace = (model: Model, id: string): Space | undefined => {
  for (const s of model.storeys) {
    const sp = s.spaces.find((x) => x.id === id)
    if (sp) return sp
  }
  return undefined
}
const findEquipment = (model: Model, id: string): Equipment | undefined => {
  for (const s of model.storeys) {
    const e = s.equipment.find((x) => x.id === id)
    if (e) return e
  }
  return undefined
}

/** 물리존에 사람이 설계 풍량을 넣는다. BIM 이 적은 방은 고치지 않는다(BIM 이 앞선다). `null` 은 넣은 값을 지운다. */
export function setSpaceAirflow(model: Model, spaceId: string, value: { cooling?: number | null; heating?: number | null } | null): boolean | { refused: string } {
  const space = findSpace(model, spaceId)
  if (!space) return false
  if (space.designAirflow?.source === 'bim') return { refused: 'BIM 에 설계 풍량이 있는 방입니다. BIM 값을 씁니다.' }
  const next = cleanAirflow(value)
  if (sameAirflow(space.designAirflow, next ?? undefined)) return false
  if (next) space.designAirflow = { ...next, source: 'edit' }
  else delete space.designAirflow
  return true
}

/** 설비에 사람이 정격 풍량을 넣는다(CMH). BIM 이 적은 설비는 고치지 않는다. `null` 은 넣은 값을 지운다. */
export function setRatedAirflow(model: Model, equipmentId: string, cmh: number | null): boolean | { refused: string } {
  const e = findEquipment(model, equipmentId)
  if (!e) return false
  if (e.ratedAirflow?.source === 'bim') return { refused: 'BIM 에 정격 풍량이 있는 설비입니다. BIM 값을 씁니다.' }
  const next = positive(cmh) ? cmh : null
  if ((e.ratedAirflow?.cmh ?? null) === next) return false
  if (next !== null) e.ratedAirflow = { cmh: next, source: 'edit' }
  else delete e.ratedAirflow
  return true
}

/** 공조존에 사람이 설계 풍량을 넣는다. 담당 물리존의 BIM 값으로 판정되는 공조존은 받지 않는다. */
export function setZoneAirflow(model: Model, zoneId: string, value: { cooling?: number | null; heating?: number | null } | null): boolean | { refused: string } {
  const zone = model.storeys.flatMap((s) => s.hvacZones ?? []).find((z) => z.id === zoneId)
  if (!zone) return false
  if (zoneAirflow(model, zone).from === 'bim') return { refused: '담당 물리존의 BIM 설계 풍량을 다 더해 판정합니다. 공조존 값은 쓰지 않습니다.' }
  const next = cleanAirflow(value)
  if (sameAirflow(zone.designAirflow, next ?? undefined)) return false
  if (next) zone.designAirflow = next
  else delete zone.designAirflow
  return true
}

/**
 * 공조존 하나의 설계 풍량과 그 출처.
 *
 * 1. 담당 물리존이 모두 BIM 값을 갖고 다른 공조존과 함께 담당하는 방이 없으면 그 합이다(`bim`).
 * 2. 아니면 사람이 공조존에 넣은 값(`zone`).
 * 3. 아니면 담당 물리존의 값(BIM·사람 섞임)을 더한다(`spaces`).
 * 4. 그래도 없으면 판정 불가이고 `missing` 이 무엇이 없는지 말한다. 함께 담당하는 방이 있으면 방 값을 나눌 근거가 없어 공조존 값만 받는다.
 */
export type ZoneAirflow =
  | { from: 'bim' | 'zone' | 'spaces'; cmh: number; basis: AirflowBasis; missing?: undefined }
  | { from: null; missing: string; cmh?: undefined; basis?: undefined }

export function zoneAirflow(model: Model, zone: HvacZone, spaceName: (id: string) => string = (id) => id, zones = hvacZonesOf(model)): ZoneAirflow {
  const spaces = zone.spaceIds.map((id) => findSpace(model, id)).filter((s): s is Space => !!s)
  const others = new Set(zones.filter((z) => z.id !== zone.id).flatMap((z) => z.spaceIds))
  const shared = spaces.filter((s) => others.has(s.id))
  const values = spaces.map((s) => s.designAirflow).filter((a): a is SpaceAirflow => !!a)
  if (spaces.length && !shared.length && values.length === spaces.length && values.every((a) => a.source === 'bim')) {
    const sum = sumOf(values)
    if (sum) return { from: 'bim', ...sum }
  }
  const own = airflowBasis(zone.designAirflow)
  if (own) return { from: 'zone', ...own }
  if (!spaces.length) return { from: null, missing: '담당 물리존 없음' }
  if (shared.length) return { from: null, missing: `설계 풍량 없음(${shared.map((s) => spaceName(s.id)).join(', ')}을 다른 공조존과 함께 담당해 방 값을 나눌 수 없음)` }
  const lacking = spaces.filter((s) => !airflowBasis(s.designAirflow))
  if (lacking.length) return { from: null, missing: `설계 풍량 없음: ${lacking.map((s) => spaceName(s.id)).join(', ')}` }
  const sum = sumOf(values)
  return sum ? { from: 'spaces', ...sum } : { from: null, missing: '설계 풍량 없음(방마다 냉방·난방이 달라 더할 수 없음)' }
}

/**
 * Z-03 판정 대상. 공조존을 직접 담당하는 설비(VAV·FCU·실내기·단일존 공조기)다. 여러 공조존에 급기하는 공조기는 동시 부하를 고려해 존 합보다
 * 작게 설계하는 것이 보통이라 뺀다(Q16). 디퓨저 같은 말단은 담당 설비로 골라도 대상이 아니다.
 */
export const CAPACITY_CHECK_KINDS: ReadonlySet<string> = new Set(['vav', 'fcu', 'indoor_unit', 'ahu'])

export type CapacityItem = { id: string; label: string }

/** 용량 검증 Z-03. `warn` 은 정격 풍량이 담당 공조존의 설계 풍량 합보다 작은 설비, `undetermined` 는 값이 없어 판정하지 못한 설비다. */
export function capacityChecks(
  model: Model,
  name: { space: (id: string) => string; equipment: (id: string) => string },
): { warn: CapacityItem[]; undetermined: CapacityItem[] } {
  const zones = hvacZonesOf(model)
  const byEquipment = new Map<string, HvacZone[]>()
  for (const z of zones) for (const id of z.servedBy ?? []) byEquipment.set(id, [...(byEquipment.get(id) ?? []), z])
  const warn: CapacityItem[] = []
  const undetermined: CapacityItem[] = []
    for (const [id, served] of byEquipment) {
    const e = findEquipment(model, id)
    if (!e || !CAPACITY_CHECK_KINDS.has(e.kind ?? '')) continue
    if (e.kind === 'ahu' && served.length > 1) continue
    const zoneValues = served.map((z) => ({ zone: z, value: zoneAirflow(model, z, name.space, zones) }))
    const lacks = [
      ...(e.ratedAirflow ? [] : ['정격 풍량 없음']),
      ...zoneValues.filter((x) => x.value.from === null).map((x) => `${x.zone.name} ${x.value.missing}`),
    ]
    if (lacks.length) {
      undetermined.push({ id, label: `${name.equipment(id)} — ${lacks.join(' · ')}` })
      continue
    }
    const total = zoneValues.reduce((t, x) => t + x.value.cmh!, 0)
    if (e.ratedAirflow!.cmh < total - 1e-6) {
      const bases = [...new Set(zoneValues.map((x) => BASIS_LABEL[x.value.basis!]))].join('·')
      warn.push({
        id,
        label: `${name.equipment(id)} 정격 ${cmhText(e.ratedAirflow!.cmh)} CMH < ${served.map((z) => z.name).join('·')} 설계 ${cmhText(total)} CMH(${bases} 기준)`,
      })
    }
  }
  return { warn, undetermined }
}

/** 화면의 CMH 표기. 설계 풍량은 정수로 읽으므로 반올림하고 천 단위로 끊는다. */
export const cmhText = (v: number) => Math.round(v).toLocaleString('en-US')

/** 물리존의 설계 풍량 한 줄(`냉방 360 · 난방 540 CMH`, Revit 값은 `설계 급기 336 CMH`). */
export function airflowText(a: DesignAirflow): string {
  const parts = [
    ...(positive(a.cooling) ? [`냉방 ${cmhText(a.cooling)}`] : []),
    ...(positive(a.heating) ? [`난방 ${cmhText(a.heating)}`] : []),
    ...(!positive(a.cooling) && !positive(a.heating) && positive(a.supply) ? [`설계 급기 ${cmhText(a.supply)}`] : []),
  ]
  return `${parts.join(' · ')} CMH`
}
