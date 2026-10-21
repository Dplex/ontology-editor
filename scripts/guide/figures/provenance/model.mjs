// 그림: 설비 속성(종류·계통·소속)의 4가지 출처(BIM · 사전 · 계산 · 사람)와 우선순위(사람 > BIM > 계산·사전)를 보이는 계전기 모형이다.
export const CHANNELS = [
  {
    id: "bim",
    name: "1 · BIM (파일 원본)",
    x: 24,
    badge: "BIM",
    field: "계통 = Hot Water Loop",
    priority: "우선순위 2위 (사람 편집 다음)",
    ttl: "# IFC 원본의 IfcSystem 관계를 그대로 읽음 (출처: BIM)\nex:System_HotWater a brick:Hot_Water_System ; brick:hasPart ex:Boiler_557516 .",
    note: "BIM 파일에 명시된 속성·관계입니다. 사람이 직접 덮어쓰지 않는 한 자동 계산이나 사전 추정보다 항상 우선합니다.",
  },
  {
    id: "dict",
    name: "2 · 사전 (이름 규칙 매칭)",
    x: 68,
    badge: "사전",
    field: "종류 = 보일러 (brick:Boiler)",
    priority: "우선순위 3위 (BIM 미정의 시 자동 분류)",
    ttl: "# 설비 이름 'M_Hot Water Boiler #557516' 에서 키워드 'Boiler' 매칭 (출처: 사전)\nex:Boiler_557516 a brick:Boiler .",
    note: "IFC 클래스가 모호할 때(IfcEnergyConversionDevice 등) 객체 이름·타입 문자열을 사전 규칙과 대조해 구체적인 설비 종류를 채웁니다.",
  },
  {
    id: "calc",
    name: "3 · 계산 (좌표·형상 판정)",
    x: 112,
    badge: "계산",
    field: "소속 = Utility (다림추 좌표 판정)",
    priority: "우선순위 3위 (BIM 관계 누락 시 기하 보정)",
    ttl: "# 설비 좌표 (x, y)가 Utility 외곽선 안에 들어와 자동 배정됨 (출처: 계산)\nex:Boiler_557516 brick:hasLocation ex:Space_Utility .",
    note: "BIM에 공간 소속 관계(IfcRelContainedInSpatialStructure)가 빠져 있을 때, 에디터가 좌표와 방 외곽선 거리로 계산해 채운 값입니다.",
  },
  {
    id: "human",
    name: "4 · 사람 (수동 편집 · 최우선)",
    x: 156,
    badge: "사람",
    field: "종류·계통·소속 수동 확정",
    priority: "우선순위 1위 (사람 > BIM > 계산·사전)",
    ttl: "# 작업자가 에디터에서 직접 지정·수정한 값은 가장 높은 우선순위로 고정됨 (출처: 사람)\nex:Boiler_557516 a brick:Boiler ; brick:hasLocation ex:Space_Bedroom_1 .",
    note: "사람이 에디터에서 직접 수정하거나 확정한 값입니다. 다시 계산하거나 사전 규칙이 바뀌어도 사람의 편집이 최우선으로 유지됩니다.",
  },
];

export function readoutOf(c) {
  return `출처 [${c.badge}] · ${c.field} · ${c.priority}`;
}
