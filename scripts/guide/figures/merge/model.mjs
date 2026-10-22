// 그림: 건축(Arch.ifc)과 설비(HVAC.ifc) 두 파일을 층 이름·표고·원점 보정으로 합쳐 설비 소속을 판정하는 정합 모델이다.
export const STAGES = [
  {
    id: "split",
    name: "1 · 분리 상태 (단독 열기)",
    dz: 38,
    dx: -18,
    dy: 12,
    litRooms: [],
    matched: "0/40",
    storeys: "각각 4개 층 (미결합)",
    ttl: "# 설비 파일만 열면 방(IfcSpace)이 없어 모든 설비가 층에만 매달린다\nex:Boiler_557516 brick:hasLocation ex:Storey_Level_2 .",
    note: "건축 파일에는 물리존(방) 19개만 있고 설비가 없으며, 설비(HVAC) 파일에는 설비 40대만 있고 방 외곽선이 없습니다.",
  },
  {
    id: "storey",
    name: "2 · 층 이름 · 표고(EL) 정렬",
    dz: 18,
    dx: -18,
    dy: 12,
    litRooms: [],
    matched: "12/40",
    storeys: "4개 층 매칭 완료 (EL +3.10 m)",
    ttl: "# 층은 맞췄으나 수평 원점이 어긋나 외곽선 밖으로 밀려난다\nex:Boiler_557516 brick:hasLocation ex:Storey_Level_2 . # Δ(x,y) 보정 전",
    note: "두 파일의 IfcBuildingStorey 이름(Level 1, Level 2…)과 표고(Elevation)를 비교해 같은 층끼리 먼저 짝짓습니다.",
  },
  {
    id: "origin",
    name: "3 · 수평 원점 Δ(x, y) 보정",
    dz: 12,
    dx: 0,
    dy: 0,
    litRooms: ["Utility", "Bedroom 1"],
    matched: "34/40",
    storeys: "수평 좌표계 정렬 완료 (Δx=0, Δy=0)",
    ttl: "# 수평 원점이 맞아 다림추가 물리존 외곽선 안으로 들어온다\nex:Boiler_557516 brick:hasLocation ex:Space_Utility .",
    note: "건축 외벽·그리드 기준점과 설비 배치 범위를 대조해 수평 오프셋 Δ(x, y)를 맞추면 설비 다림추가 방 외곽선 위에 정렬됩니다.",
  },
  {
    id: "merged",
    name: "4 · 정합 병합 완료 (소속 40/40)",
    dz: 0,
    dx: 0,
    dy: 0,
    litRooms: ["Utility", "Bedroom 1", "Living"],
    matched: "40/40",
    storeys: "층 4개 · 물리존 19개 · 설비 40대 통합",
    ttl: "ex:Boiler_557516 a brick:Boiler ; brick:hasLocation ex:Space_Utility .\nex:Diffuser_402 a brick:Diffuser ; brick:hasLocation ex:Space_Bedroom_1 .",
    note: "상부 설비 캐리어가 정합 핀(Dowel)에 완전히 안착해 보일러·디퓨저 40대 모두가 각자의 물리존 소속을 얻습니다.",
  },
];

export function readoutOf(s) {
  return `${s.name.split(" · ")[1]} · 소속 매칭 ${s.matched} · ${s.storeys}`;
}
