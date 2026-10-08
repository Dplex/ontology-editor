// IFC 의 길이 단위를 미터 배수로 바꾼다.
//
// IFC 파일의 좌표는 그 파일이 선언한 단위로 적혀 있다. 대부분 미터지만 밀리미터도 피트도
// 실제로 나온다. 확인한 공개 모델 넷 중 둘이 미터가 아니었다.
//
//   NBU_Duplex-Apt_Eng-HVAC   IfcSIUnit METRE + Prefix MILLI   →  0.001
//   NBU_Duplex-Apt_Eng-MEP-1  IfcConversionBasedUnit FOOT      →  0.3048
//
// **이걸 안 읽으면 오류 없이 조용히 틀린다.** 밀리미터 모델의 방 하나가 4,000m 짜리가 되는데
// 파싱은 성공하고 숫자도 그럴듯해서, 화면을 보기 전에는 알 수 없다. 우리 쪽 좌표계는
// 전 구간 미터이므로(PRD 1.7) 입구에서 한 번 환산해 둔다.

import * as WebIFC from 'web-ifc'

/** SI 접두사의 배수. IFC 가 쓰는 것만 적는다. */
const SI_PREFIX: Record<string, number> = {
  EXA: 1e18,
  PETA: 1e15,
  TERA: 1e12,
  GIGA: 1e9,
  MEGA: 1e6,
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 1e1,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
  MICRO: 1e-6,
  NANO: 1e-9,
  PICO: 1e-12,
  FEMTO: 1e-15,
  ATTO: 1e-18,
}

type Api = InstanceType<typeof WebIFC.IfcAPI>

function unwrap(value: unknown): unknown {
  return value && typeof value === 'object' && 'value' in (value as object)
    ? (value as { value: unknown }).value
    : value
}

/**
 * 길이 단위 하나를 미터 배수로 바꾼다. 못 알아보면 null 을 준다.
 *
 * `IfcConversionBasedUnit` 은 환산 계수가 또 다른 단위를 가리킨다(피트 = 0.3048 미터).
 * 그 안쪽 단위가 다시 접두사를 가질 수 있어서 재귀로 푼다. 사슬이 길어질 일은 없지만
 * 깨진 파일에서 순환하지 않도록 깊이를 제한한다.
 */
function scaleOfUnit(api: Api, model: number, expressID: number, depth = 0): number | null {
  if (depth > 8) return null
  const unit = api.GetLine(model, expressID)
  if (!unit) return null

  if (unit.type === WebIFC.IFCSIUNIT) {
    // 길이의 SI 기본 단위는 미터 하나뿐이다. 다른 Name 이 오면 길이 단위가 아니다.
    if (unwrap(unit.Name) !== 'METRE') return null
    const prefix = unwrap(unit.Prefix) as string | null
    return prefix ? (SI_PREFIX[prefix] ?? null) : 1
  }

  if (unit.type === WebIFC.IFCCONVERSIONBASEDUNIT || unit.type === WebIFC.IFCCONVERSIONBASEDUNITWITHOFFSET) {
    if (!unit.ConversionFactor) return null
    const measure = api.GetLine(model, unit.ConversionFactor.value)
    const factor = Number(unwrap(measure?.ValueComponent))
    if (!Number.isFinite(factor)) return null
    const base = measure?.UnitComponent ? scaleOfUnit(api, model, measure.UnitComponent.value, depth + 1) : null
    return base === null ? null : factor * base
  }

  return null
}

/**
 * 이 모델의 길이 1 이 몇 미터인지 돌려준다.
 *
 * `IfcProject.UnitsInContext` 만 본다. 파일 안의 `IfcSIUnit` 을 전부 훑으면 안 되는데,
 * 길이 단위가 여러 개 선언된 파일이 있고(AC20-FZK-Haus 가 둘이다) 그중 무엇이 좌표에
 * 쓰이는지는 프로젝트의 단위 지정만이 말해 주기 때문이다.
 *
 * 못 찾으면 1 을 준다. 대부분의 모델이 미터라서 그게 가장 덜 틀리는 추측이고, 호출부가
 * `found` 를 보고 경고를 남긴다.
 */
export function lengthScale(api: Api, model: number): { scale: number; found: boolean } {
  const projects = api.GetLineIDsWithType(model, WebIFC.IFCPROJECT, false)
  for (let i = 0; i < projects.size(); i++) {
    const project = api.GetLine(model, projects.get(i))
    if (!project?.UnitsInContext) continue

    const assignment = api.GetLine(model, project.UnitsInContext.value)
    for (const handle of assignment?.Units ?? []) {
      const unit = api.GetLine(model, handle.value)
      if (unwrap(unit?.UnitType) !== 'LENGTHUNIT') continue

      const scale = scaleOfUnit(api, model, handle.value)
      if (scale !== null && scale > 0) return { scale, found: true }
    }
  }
  return { scale: 1, found: false }
}

/**
 * 넓이 단위 하나를 제곱미터 배수로 바꾼다. 못 알아보면 null. 길이와 같은 모양이다 — SI 는 `SQUARE_METRE` 에 접두사(밀리면 1e-6, 제곱이라
 * 접두사도 제곱한다), 환산 단위(제곱피트 = 0.092903 ㎡)는 안쪽 단위를 따라 푼다.
 */
function areaScaleOfUnit(api: Api, model: number, expressID: number, depth = 0): number | null {
  if (depth > 8) return null
  const unit = api.GetLine(model, expressID)
  if (!unit) return null
  if (unit.type === WebIFC.IFCSIUNIT) {
    if (unwrap(unit.Name) !== 'SQUARE_METRE') return null
    const prefix = unwrap(unit.Prefix) as string | null
    const p = prefix ? (SI_PREFIX[prefix] ?? null) : 1
    return p === null ? null : p * p
  }
  if (unit.type === WebIFC.IFCCONVERSIONBASEDUNIT || unit.type === WebIFC.IFCCONVERSIONBASEDUNITWITHOFFSET) {
    if (!unit.ConversionFactor) return null
    const measure = api.GetLine(model, unit.ConversionFactor.value)
    const factor = Number(unwrap(measure?.ValueComponent))
    if (!Number.isFinite(factor)) return null
    const base = measure?.UnitComponent ? areaScaleOfUnit(api, model, measure.UnitComponent.value, depth + 1) : null
    return base === null ? null : factor * base
  }
  return null
}

/**
 * 이 모델의 넓이 1 이 몇 제곱미터인지(OE-MAN-03 의 BIM 면적). `IfcProject.UnitsInContext` 의 `AREAUNIT` 을 본다. 못 찾으면 길이 단위의
 * 제곱을 쓰고 `found` 를 false 로 준다 — 넓이 단위를 따로 적지 않은 파일은 길이 단위로 적었다고 보는 것이 가장 덜 틀린다.
 */
export function areaScale(api: Api, model: number): { scale: number; found: boolean } {
  const projects = api.GetLineIDsWithType(model, WebIFC.IFCPROJECT, false)
  for (let i = 0; i < projects.size(); i++) {
    const project = api.GetLine(model, projects.get(i))
    if (!project?.UnitsInContext) continue
    const assignment = api.GetLine(model, project.UnitsInContext.value)
    for (const handle of assignment?.Units ?? []) {
      const unit = api.GetLine(model, handle.value)
      if (unwrap(unit?.UnitType) !== 'AREAUNIT') continue
      const scale = areaScaleOfUnit(api, model, handle.value)
      if (scale !== null && scale > 0) return { scale, found: true }
    }
  }
  const length = lengthScale(api, model).scale
  return { scale: length * length, found: false }
}
