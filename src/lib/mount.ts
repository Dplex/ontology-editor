// 설치면(OE-OBJ-08). 설비가 천장·바닥·벽 중 어디에 붙는가.
//
// 표의 정본은 PRD glossary "설치면 type" 이다(OE-OBJ-08 과 다르면 glossary 가 앞선다). 우리 사전의 종류 하나가 glossary 의 어느
// 행인지 옮긴 것이고, glossary 에 행이 없는 종류는 **정하지 않는다**(null) — 기획이 정하지 않은 것을 우리가 채우면 사전이 기획
// 문서인 척한다(전열교환기·외부 루버·소음기·욕실 부속·위생기구·급탕기·변압기·방열기). glossary 의 종류 중 사전에 아직 없는 것
// (PAC·에스컬레이터·스피커·온도조절기·스위치·AP 등)은 종류가 생길 때 여기에 더한다.
//
// **빈 목록은 "설치면 없음" 이다** — 면에 붙지 않고 배관·덕트 위에 달리거나(밸브·댐퍼·유량계) 땅속에 든다(지중 열교환기).
// null(정하지 않음)과 다르다: 정하지 않은 종류는 어느 면에도 막지 않지만, 설치면 없는 종류는 어느 면에도 놓지 않는다.
//
// 설비 하나의 설치면은 종류가 허용하는 면이 하나일 때만 정한다(출처 "사전"). 둘 이상이면 BIM 의 z 로 판정한다(ceiling.ts).

import type { Equipment } from './model'

export type Surface = 'ceiling' | 'floor' | 'wall'

export const SURFACE_LABEL: Record<Surface, string> = { ceiling: '천장', floor: '바닥', wall: '벽' }

/** 종류 → 허용 설치면(glossary "설치면 type", 번호는 그 표의 #). */
export const MOUNT: Readonly<Record<string, readonly Surface[]>> = {
  // L1 열원 설비
  chiller: ['floor'], // 1·2 냉동기
  cooling_tower: ['floor'], // 3
  pump: ['floor'], // 5·8 펌프
  boiler: ['floor'], // 6·7
  heat_pump: ['floor'], // 10 공기 열 히트펌프
  ground_heat_exchanger: [], // 11 지중
  ground_source_heat_pump: ['floor'], // 12
  // L2 공기조화
  ahu: ['floor'], // 14
  vav: ['ceiling'], // 17 천장 전용(플레넘)
  indoor_unit: ['ceiling', 'floor', 'wall'], // 19a 천장 카세트·덕트형 / 벽걸이 / 스탠드
  outdoor_unit: ['floor'], // 19b
  fcu: ['ceiling', 'floor'], // 20 천장 속 / 바닥형
  // L3 말단
  air_diffuser: ['ceiling'], // 23b 토출구
  air_grille: ['ceiling'], // 23b 흡입구
  damper: [], // 덕트 부착
  // L4 센서·제어
  outdoor_temperature_sensor: ['wall'], // 30 외벽
  outdoor_humidity_sensor: ['wall'], // 31 외벽
  elevator: ['floor'], // 36
  camera: ['ceiling', 'wall'], // 38
  lighting: ['ceiling'], // 40
  exhaust_fan: ['ceiling', 'wall', 'floor'], // 41~44 환기팬(화장실은 천장·벽, 옥상 루프팬은 바닥)
  fan: ['ceiling', 'wall', 'floor'], // 44 기타 급배기팬
  smoke_detector: ['ceiling', 'wall'], // 45 기본은 천장
  heat_detector: ['ceiling', 'wall'], // 45
  water_meter: [], // 52 배관 부착
  valve: [], // 제어 밸브, 배관 부착
  // 설비 목록에 없는 설비(glossary 표 아래)
  sprinkler: ['ceiling'],
  panel: ['floor', 'wall'], // 분전반
  receptacle: ['wall'], // 콘센트, 내벽
  fire_extinguisher: ['floor', 'wall'], // 소화기함
}

/** 종류가 허용하는 설치면. 표에 없으면 null(정하지 않음). */
export function allowedSurfaces(kind: string | null | undefined): readonly Surface[] | null {
  return kind ? (MOUNT[kind] ?? null) : null
}

/** 설비의 설치면. 허용 면이 하나일 때만 정하고, 아니면 null(모름·설치면 없음). */
export function surfaceOf(e: Pick<Equipment, 'kind'>): Surface | null {
  const allowed = allowedSurfaces(e.kind)
  return allowed?.length === 1 ? allowed[0] : null
}

/** 이 면에 놓을 수 있나. 허용 면을 정하지 않은 종류는 막지 않는다(정하지 않은 것을 금지로 읽지 않는다). 설치면 없는 종류는 막는다. */
export function canMountOn(e: Pick<Equipment, 'kind'>, surface: Surface): boolean {
  const allowed = allowedSurfaces(e.kind)
  return !allowed || allowed.includes(surface)
}

/** 허용 설치면을 사람이 읽는 말로. 정하지 않았으면 null. */
export function allowedLabel(kind: string | null | undefined): string | null {
  const allowed = allowedSurfaces(kind)
  if (!allowed) return null
  return allowed.length ? allowed.map((x) => SURFACE_LABEL[x]).join('·') : '없음(배관·덕트 부착·지중)'
}
