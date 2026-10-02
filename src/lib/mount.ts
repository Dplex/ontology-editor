// 설치면(OE-OBJ-08). 설비가 천장·바닥·벽 중 어디에 붙는가.
//
// 표는 PRD(OE-OBJ-08 이슈 본문, 2026-10 기획)가 정한 그대로다. 표에 없는 종류는 **정하지 않는다**(null) — 냉동기·보일러는
// 바닥이 자연스럽지만 기획이 정하지 않은 것을 우리가 채우면 사전이 기획 문서인 척한다. 표에 없는 종류는 티켓 메모에 적어
// 기획에 묻는다. PRD 표의 항목 중 우리 사전에 아직 종류가 없는 것(PAC·엘리베이터·스피커·온도조절기·스위치·벽걸이 에어컨·AP)은
// 종류가 생길 때 여기에 더한다.
//
// 설비 하나의 설치면은 종류가 허용하는 면이 하나일 때만 정한다(출처 "사전"). 둘 이상이면(CCTV 천장·벽) 높이로 짐작하지 않고
// 모름으로 둔다 — 천장 높이를 BIM 에서 읽지 않아서, 2.7m 의 CCTV 가 천장인지 벽인지 가를 근거가 없다.

import type { Equipment } from './model'

export type Surface = 'ceiling' | 'floor' | 'wall'

export const SURFACE_LABEL: Record<Surface, string> = { ceiling: '천장', floor: '바닥', wall: '벽' }

/** 종류 → 허용 설치면. PRD 표: 천장 전용 · 바닥 전용 · 벽 전용 · 복수 허용. */
export const MOUNT: Readonly<Record<string, readonly Surface[]>> = {
  // 천장 전용: 시스템 에어컨 실내기 · 토출구/흡입구 · 조명 · 스프링클러 헤드 · 화재감지기 · 천장 속 VAV
  indoor_unit: ['ceiling'],
  air_diffuser: ['ceiling'],
  air_grille: ['ceiling'],
  lighting: ['ceiling'],
  sprinkler: ['ceiling'],
  smoke_detector: ['ceiling'],
  heat_detector: ['ceiling'],
  vav: ['ceiling'],
  // FCU 는 천장 속(플레넘)과 바닥형이 둘 다 표에 있다.
  fcu: ['ceiling', 'floor'],
  // 바닥 전용: AHU · EHP 실외기 · 펌프 · 분전반
  ahu: ['floor'],
  outdoor_unit: ['floor'],
  pump: ['floor'],
  panel: ['floor'],
  // 벽 전용: 콘센트
  receptacle: ['wall'],
  // 복수 허용: CCTV(천장·벽) · 소화기함(바닥·벽)
  camera: ['ceiling', 'wall'],
  fire_extinguisher: ['floor', 'wall'],
}

/** 종류가 허용하는 설치면. 표에 없으면 null(정하지 않음). */
export function allowedSurfaces(kind: string | null | undefined): readonly Surface[] | null {
  return kind ? (MOUNT[kind] ?? null) : null
}

/** 설비의 설치면. 허용 면이 하나일 때만 정하고, 아니면 null(모름). */
export function surfaceOf(e: Pick<Equipment, 'kind'>): Surface | null {
  const allowed = allowedSurfaces(e.kind)
  return allowed?.length === 1 ? allowed[0] : null
}

/** 이 면에 놓을 수 있나. 허용 면을 모르는 종류는 막지 않는다(정하지 않은 것을 금지로 읽지 않는다). */
export function canMountOn(e: Pick<Equipment, 'kind'>, surface: Surface): boolean {
  const allowed = allowedSurfaces(e.kind)
  return !allowed || allowed.includes(surface)
}
