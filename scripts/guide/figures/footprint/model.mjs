// 그림: 물리존 바닥 외곽선(Footprint) 유무가 3D 표시·설비 소속 판정·완전성 검사에 미치는 영향과 4가지 경고 분류(A·B·C·X)를 보이는 모형이다.
export const MODES = [
  {
    id: "missing",
    name: "1 · 외곽선 누락 (경고 R2)",
    slabZ: -14,
    trace: 0,
    lit: false,
    chip: "A-설정 · R2 위반 (외곽선 없는 물리존 2개)",
    ttl: "# Space_B204 에 바닥 외곽선이 없어 FCU 다림추가 허공을 지나 층에 떨어진다\nex:FCU_204 brick:hasLocation ex:Storey_Level_2 . # 물리존 누락!",
    note: "BIM 내보내기 설정(A-설정)에서 공간 형상이 빠지면 방 이름만 남고 바닥 판이 없습니다. 3D 화면에 안 보이고 위 설비도 방을 찾지 못합니다.",
  },
  {
    id: "tracing",
    name: "2 · 공간 편집에서 외곽선 그리기",
    slabZ: -6,
    trace: 1,
    lit: false,
    chip: "C-보정 · 네 모서리 꼭짓점(P1~P4) 닫기 중",
    ttl: "# 평면도 공간 편집에서 벽 안쪽 모서리 네 점을 찍어 바닥 폴리곤을 닫는다\n# ring = [[64, 18], [116, 18], [116, 94], [64, 94]] (22.4 m²)",
    note: "고객사 재제출을 기다리지 않고 에디터의 [공간 편집]에서 외곽선 없는 물리존을 골라 네 모서리를 찍어 폴리곤을 직접 닫을 수 있습니다.",
  },
  {
    id: "closed",
    name: "3 · 외곽선 완성 (완전성 통과)",
    slabZ: 0,
    trace: 1,
    lit: true,
    chip: "완전성 통과 · 3D 생성 + 설비 소속 즉시 복구",
    ttl: "ex:Space_B204 a brick:Room ; rdfs:label \"회의실 B204\" .\nex:FCU_204 a brick:Fan_Coil_Unit ; brick:hasLocation ex:Space_B204 .",
    note: "바닥 외곽선이 채워지는 즉시 3D 공간 프리즘이 올라오고, 허공에 떨어지던 FCU 다림추가 회의실 판에 안착해 소속이 복구됩니다.",
  },
];

export function readoutOf(m) {
  return `${m.name.split(" · ")[1]} · ${m.chip}`;
}
