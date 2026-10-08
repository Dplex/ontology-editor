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
