// 그림: 혼동하기 쉬운 4가지 공간·설비 도메인 용어(물리존 · 룸 · 공조존 · 계통과 포트)를 수직 분해 지그로 비교하는 모형이다.
export const LAYERS = [
  {
    id: "physical",
    name: "1 · 물리존 (IfcSpace)",
    lift: [0, 10, 22, 34],
    litLayer: 0,
    source: "출처: 건축 BIM (IfcSpace)",
    ttl: 'ex:Space_OpenOffice a brick:Space ; rdfs:label "오픈 오피스" ; brick:isPartOf ex:Storey_2F .',
    note: "건축 BIM 파일을 불러올 때 IfcSpace 하나가 물리존 하나가 됩니다. 설비 소속 판정과 이상 알림 위치의 기본 단위입니다.",
  },
  {
    id: "room",
    name: "2 · 룸 (수동 분할 구획)",
    lift: [0, 6, 24, 36],
    litLayer: 1,
    source: "출처: 사람 (공간 편집 분할)",
    ttl: 'ex:Room_201A a brick:Room ; brick:isPartOf ex:Space_OpenOffice ; rdfs:label "회의코너 A" .',
    note: "BIM에 없던 하위 구획을 사람이 에디터에서 물리존 안을 쪼개 그린 편집 단위입니다. 물리존 내부에 포함(isPartOf)됩니다.",
  },
  {
    id: "hvac-zone",
    name: "3 · 공조존 (HVAC Zone)",
    lift: [0, 4, 14, 34],
    litLayer: 2,
    source: "출처: 외부 에너지 모델 (IDF Zone)",
    ttl: 'ex:HVAC_Zone_East a brick:HVAC_Zone ; brick:hasPart ex:Space_OpenOffice, ex:Room_201A .',
    note: "공조 설비가 같은 온도·풍량으로 제어하는 열역학적 구역입니다. 물리존 경계와 다를 수 있으며 여러 방을 아우르기도 합니다.",
  },
  {
    id: "system-port",
    name: "4 · 계통 · 포트 (System & Port)",
    lift: [0, 4, 10, 20],
    litLayer: 3,
    source: "출처: 설비 BIM (IfcSystem · IfcDistributionPort)",
    ttl: 'ex:VAV_201 brick:feeds ex:Diffuser_201A .\nex:Diffuser_201A brick:feeds ex:HVAC_Zone_East .',
    note: "공조기 → 덕트 → VAV → 토출구로 이어지는 설비 묶음이 [계통]이고, 각 부재 끝에 달린 방향(SOURCE/SINK) 연결점이 [포트]입니다.",
  },
];

export function readoutOf(l) {
  return `${l.name.split(" · ")[1]} · ${l.source}`;
}
