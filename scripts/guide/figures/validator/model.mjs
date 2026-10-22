// 그림: 내보낸 TTL·GeoJSON을 DT 플랫폼 파서 규칙으로 교차 검증하는 5가지 핀 게이트(Pin-Tumbler Gate) 모형이다.
export const CHECKS = [
  {
    id: "polygon",
    name: "1 · 폴리곤 형상",
    x: 24,
    rule: "GeoJSON Polygon 닫힘 · 자기교차 0건",
    detail: "검사 대상: floor-*.geojson 의 모든 space 외곽선 꼭짓점 순서와 최소 면적(0.5 m² 이상) 여부",
    note: "방 외곽선 폴리곤이 열려 있거나 꼬여 있으면 DT 3D 바닥 메쉬가 깨집니다. 첫 번째 핀이 모든 폴리곤의 닫힘과 넓이를 검사합니다.",
  },
  {
    id: "orphan-feature",
    name: "2 · TTL 미정의 Feature",
    x: 57,
    rule: "GeoJSON에만 있고 TTL에 없는 객체 0건",
    detail: "검사 대상: GeoJSON Feature(space · equipment)의 ID 가 ontology.ttl 엔티티로 존재하는지 대조",
    note: "도면(GeoJSON)에는 그려져 있는데 온톨로지(TTL)에 정의가 빠진 유령 객체가 없는지 두 번째 핀이 대조합니다.",
  },
  {
    id: "dangling-ref",
    name: "3 · 끊긴 참조 (Dangling ID)",
    x: 90,
    rule: "존재하지 않는 엔티티를 가리키는 트리플 0건",
    detail: "검사 대상: brick:hasLocation · brick:hasPart · brick:feeds 의 목적어 ID 실존 여부",
    note: "삭제된 방이나 없는 설비 ID를 가리키는 끊긴 화살표(참조 무결성 위반)가 없는지 세 번째 핀이 검사합니다.",
  },
  {
    id: "location-mismatch",
    name: "4 · 소속 어긋남",
    x: 123,
    rule: "TTL hasLocation 과 GeoJSON spaceId 100% 일치",
    detail: "검사 대상: 설비 Feature의 좌표/spaceId 와 TTL의 brick:hasLocation 목적어 일치 여부",
    note: "7단계에서 설비를 옮겼을 때 GeoJSON 점 위치와 TTL 소속 방이 서로 어긋나지 않았는지 네 번째 핀이 교차 확인합니다.",
  },
  {
    id: "door-connect",
    name: "5 · 문 연결 공간",
    x: 156,
    rule: "문이 잇는 양쪽 물리존 유효성 통과",
    detail: "검사 대상: 문(Door) Feature가 맞닿은 두 물리존 ID 와 연결 그래프의 유효성",
    note: "다섯 가지 핀 게이트가 모두 0건(통과)으로 정렬되면 잠금 바가 열리며 DT 플랫폼이 즉시 읽을 수 있는 정합 상태임이 보증됩니다.",
  },
];

export function readoutOf(c) {
  return `검증 핀 [${c.name}] · ${c.rule} · 위반 0건`;
}
