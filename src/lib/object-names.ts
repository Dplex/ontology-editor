// BIM 요소 이름 → 추가 공간 오브젝트의 라이브러리 항목 열쇠(space-object.ts 의 LIBRARY). 임포터(ifc/import.ts)가 쓰므로 의존성을 두지 않는다
// — space-object.ts 는 편집 모듈(edit.ts)을 끌고 와서 임포터에서 부르면 순환한다.

/**
 * BIM 요소 이름 → 라이브러리 항목(임포트, ifc/import.ts). 가구(IfcFurnishingElement)는 이름의 낱말로 고르고 모르면 `furniture`,
 * 주변 모델(방이 없는 파일의 Proxy)은 지형·단을 빼면 `context-building` 이다. 먼저 맞는 줄이 이긴다 — "회의실 책상" 은 회의 테이블이다.
 */
const FURNITURE_NAMES: readonly [RegExp, string][] = [
  [/의자|chair|stool/i, 'chair'],
  [/소파|sofa|couch/i, 'sofa'],
  [/회의.*(책상|탁자|테이블)|원형.*탁자|meeting|conference/i, 'meeting-table'],
  [/책상|데스크|desk|탁자|테이블|table/i, 'desk'],
  [/책장|서가|bookshelf|bookcase/i, 'bookshelf'],
  [/캐비[닛넷]|cabinet|옷장|상부장|하부장|수납|locker|wardrobe/i, 'cabinet'],
  [/파티션|partition/i, 'partition'],
  [/칠판|화이트보드|whiteboard/i, 'whiteboard'],
  [/화분|식물|plant/i, 'plant'],
  [/(?<![A-Za-z])TV(?![A-Za-z])|티비|모니터|monitor|television/i, 'tv'],
  [/복사기|세단기|프린터|복합기|copier|printer|shredder/i, 'office-machine'],
  [/변기|소변기|세면|toilet|urinal|lavatory/i, 'sanitary'],
]
export function furnitureItem(name: string): string {
  return FURNITURE_NAMES.find(([re]) => re.test(name))?.[1] ?? 'furniture'
}
export function contextItem(name: string): string {
  if (/지형|terrain|topo/i.test(name)) return 'terrain'
  if (/스테이지|stage|단차/i.test(name)) return 'stage'
  return 'context-building'
}

/**
 * 주변 모델 항목(주변 건물·지형·스테이지). 건물보다 훨씬 커서 3D 에서 반투명으로 그리고 눌러도 고르지 않는다(viewer.ts) — 그대로 그렸더니
 * 1F 를 볼 때 주변 건물 매스가 건물을 가렸고, 바닥을 누르면 방 대신 지형이 골라졌다.
 */
export const CONTEXT_ITEMS: ReadonlySet<string> = new Set(['context-building', 'terrain', 'stage'])
