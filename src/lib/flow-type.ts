// 배관의 Flow Type(OE-OBJ-12, glossary "Flow Type"). 배관마다 하나를 가진다. 범례에 없는 값으로는 배관을 만들지 않는다.
// 코드·한국어는 glossary 표 그대로다. `medium` 은 덕트(공기)인지 배관(물·냉매·증기)인지를 가른다 — 새 구간의 IFC 클래스와 굵기가 이것으로 정해진다.

export type FlowMedium = 'air' | 'water' | 'refrigerant' | 'steam'

export const FLOW_TYPES = [
  { code: 'SA', label: '급기', medium: 'air' },
  { code: 'RA', label: '리턴(還氣)', medium: 'air' },
  { code: 'EA', label: '배기', medium: 'air' },
  { code: 'OA', label: '외기', medium: 'air' },
  { code: 'CHWS', label: '냉수 공급', medium: 'water' },
  { code: 'CHWR', label: '냉수 환수', medium: 'water' },
  { code: 'HWS', label: '온수 공급', medium: 'water' },
  { code: 'HWR', label: '온수 환수', medium: 'water' },
  { code: 'CWS', label: '냉각수 공급', medium: 'water' },
  { code: 'CWR', label: '냉각수 환수', medium: 'water' },
  { code: 'REF', label: '냉매', medium: 'refrigerant' },
  { code: 'DHWS', label: '급탕 공급', medium: 'water' },
  { code: 'DHWR', label: '급탕 환수', medium: 'water' },
  { code: 'DCW', label: '급수', medium: 'water' },
  { code: 'FP', label: '소화', medium: 'water' },
  { code: 'STM', label: '증기 공급', medium: 'steam' },
  { code: 'CR', label: '응축수 환수', medium: 'water' },
  { code: 'GWS', label: '지열수 공급', medium: 'water' },
  { code: 'GWR', label: '지열수 환수', medium: 'water' },
] as const satisfies readonly { code: string; label: string; medium: FlowMedium }[]

export type FlowTypeCode = (typeof FLOW_TYPES)[number]['code']

export function flowType(code: string | null | undefined): (typeof FLOW_TYPES)[number] | null {
  return FLOW_TYPES.find((f) => f.code === code) ?? null
}

// --- BIM 배관의 Flow Type (OE-PIP-14) -------------------------------------------------------
//
// BIM 배관에는 Flow Type 칸이 없다. 계통은 있어서 계통 종류(급기·순환수 공급 …)와 순환수의 유체(냉수·온수·냉각수)로 정한다 — 순환수 공급 +
// 냉수 = CHWS. 저장하지 않고 쓸 때 계산한다: 사람이 계통 종류·유체를 고치면 그 계통의 배관이 같이 바뀌어야 해서다. 정하지 못하는 것은 비운다 —
// 유체를 모르는 순환수, 공급·환수가 한 계통에 섞인 것(종류 모름). 사람이 구간마다 고른 값(`flowTypeSet`)이 계산보다 앞선다.

/** 계통 종류 → Flow Type. 순환수는 유체마다 다르다. */
const SYSTEM_FLOW: Record<string, FlowTypeCode | Record<'chilled' | 'hot' | 'condenser', FlowTypeCode>> = {
  supply_air: 'SA',
  return_air: 'RA',
  exhaust_air: 'EA',
  outside_air: 'OA',
  hydronic_supply: { chilled: 'CHWS', hot: 'HWS', condenser: 'CWS' },
  hydronic_return: { chilled: 'CHWR', hot: 'HWR', condenser: 'CWR' },
  refrigerant: 'REF',
  domestic_hot_water: 'DHWS',
  domestic_cold_water: 'DCW',
  fire_protection: 'FP',
  steam: 'STM',
  condensate_return: 'CR',
  geothermal_supply: 'GWS',
  geothermal_return: 'GWR',
}

/** 계통 종류·유체로 정한 Flow Type. 정하지 못하면 null. */
export function systemFlowType(kind: string | null | undefined, fluid: string | null | undefined): FlowTypeCode | null {
  const hit = kind ? SYSTEM_FLOW[kind] : undefined
  if (!hit) return null
  if (typeof hit === 'string') return hit
  return fluid && fluid in hit ? hit[fluid as keyof typeof hit] : null
}

/** `edit` 은 사람이 그렸거나 고른 값, `calc` 는 BIM(또는 사람)이 정한 계통 종류·유체로 계산한 값, `dict` 는 이름 사전·원천 기기로 짐작한 종류·유체로 계산한 값. */
export type FlowTypeSource = 'calc' | 'dict' | 'edit'

type ConduitLike = { role: string | null; flowType?: string; flowTypeSet?: string; systemId: string | null }
type SystemLike = { id: string; kind?: string | null; kindSource?: 'bim' | 'dict'; fluid?: string | null; fluidSource?: 'bim' | 'dict' | 'rule'; kindEdited?: unknown }

/** 덕트·배관의 Flow Type 과 출처. 덕트·배관이 아니거나 정하지 못하면 null. */
export function conduitFlowType(e: ConduitLike, systemOf: (id: string) => SystemLike | undefined): { code: FlowTypeCode; source: FlowTypeSource } | null {
  if (e.role !== 'segment' && e.role !== 'fitting') return null
  const own = flowType(e.flowTypeSet ?? e.flowType)
  if (own) return { code: own.code, source: 'edit' }
  const system = e.systemId ? systemOf(e.systemId) : undefined
  if (!system) return null
  const code = systemFlowType(system.kind, system.fluid)
  if (!code) return null
  const fluidMatters = typeof SYSTEM_FLOW[system.kind!] !== 'string'
  const known = !!system.kindEdited || (system.kindSource === 'bim' && (!fluidMatters || system.fluidSource === 'bim'))
  return { code, source: known ? 'calc' : 'dict' }
}

/** IFC 클래스가 말하는 매체. 덕트는 공기, 배관은 공기가 아니다. 모르면 null. */
function classMedium(ifcClass: string): 'air' | 'other' | null {
  if (/^Duct/.test(ifcClass)) return 'air'
  if (/^Pipe/.test(ifcClass)) return 'other'
  return null
}

/**
 * BIM 덕트·배관 구간 하나의 Flow Type 을 사람이 정한다(OE-PIP-14). 계통 하나에 공급·환수가 섞여 계산으로 가르지 못하는 배관을 사람이 가른다.
 * null 이면 계산한 값으로 돌아간다. 사람이 그린 배관은 그릴 때 정한 값이 있어 여기서 고치지 않는다.
 */
export function setConduitFlowType(
  model: { storeys: { equipment: (ConduitLike & { id: string; ifcClass: string; flowTypeSet?: string })[] }[] },
  id: string,
  code: string | null,
): boolean | { refused: string } {
  const e = model.storeys.flatMap((s) => s.equipment).find((x) => x.id === id)
  if (!e || (e.role !== 'segment' && e.role !== 'fitting')) return false
  if (e.flowType) return { refused: '사람이 그린 배관은 그릴 때 정한 Flow Type 을 씁니다.' }
  const flow = code === null ? null : flowType(code)
  if (code !== null && !flow) return { refused: `범례에 없는 Flow Type(${code})입니다.` }
  const medium = classMedium(e.ifcClass)
  if (flow && medium && (flow.medium === 'air') !== (medium === 'air')) {
    return { refused: `${medium === 'air' ? '덕트' : '배관'}에는 ${flow.code}(${flow.medium === 'air' ? '공기' : '공기가 아닌 매체'})를 정하지 않습니다.` }
  }
  if ((e.flowTypeSet ?? null) === (flow?.code ?? null)) return false
  if (flow) e.flowTypeSet = flow.code
  else delete e.flowTypeSet
  return true
}
