// 그림: 현재 층 선택과 3D 시점 ↔ 2D 평면도(수평 단면 절단) 전환 원리를 보이는 슬라이서 모형이다.
export const VIEWS = [
  {
    id: "3d-all",
    name: "1 · 3D 입체 보기 (Level 2 선택)",
    bladeZ: 44,
    litStorey: 1,
    mode: "3D 원근 투영 (Orbit · Pan · Zoom)",
    shortcut: "마우스 드래그 회전 · 휠 확대",
    note: "선택한 층(Level 2)의 벽·문·창 프리즘과 설비 3D 형상을 입체로 확인합니다. 설비 간 높낮이와 덕트 연결을 파악할 때 유리합니다.",
  },
  {
    id: "plan-cut",
    name: "2 · 2D 평면도 전환 (Shift+V)",
    bladeZ: 24,
    litStorey: 1,
    mode: "2D 직교 평면도 (수평 단면 절단)",
    shortcut: "단축키 Shift + V · 상단 [평면도] 버튼",
    note: "수평 절단면(Section Blade)이 해당 층 높이로 내려와 위에서 수직으로 내려다보는 2D 직교 도면이 됩니다. 방 외곽선 꼭짓점을 찍거나 경계를 고칠 때 원근 왜곡이 없습니다.",
  },
  {
    id: "level-1",
    name: "3 · 현재 층 전환 (Level 1 · EL 0.0 m)",
    bladeZ: 10,
    litStorey: 0,
    mode: "Level 1 활성화 (하부 층 편집)",
    shortcut: "상단 [현재 층] 드롭다운 전환",
    note: "현재 층을 Level 1로 바꾸면 편집 대상과 오른쪽 층 현황(물리존·설비 목록)이 모두 Level 1에 속한 객체로 즉시 전환됩니다.",
  },
];

export function readoutOf(v) {
  return `${v.name.split(" · ")[1]} · ${v.mode}`;
}
