// 그림 0(등급)의 등급 표와 샘플이다. 등급 표는 docs/bim-to-dt-ontology.md 3.5 를 옮겼다.
// 샘플이 채우는 칸(lit)과 숫자는 3.5·3.2·3.4 와, 편집기 기준·검증 패널이 2026-10-20 에 잰 Duplex 건축+HVAC 값에서 왔다.
// 그림의 불 켜진 칸, 승강기가 서는 칸, 읽음판 글은 모두 여기서 나온다.

/** 등급 0~5. need 는 필요한 IFC, dt 는 그 등급으로 DT 에서 할 수 있게 되는 것이다. */
export const GRADES = [
  { n: 0, name: "공간 골격", adds: "층, 방 외곽선, 벽·문·창", dt: "3D 지도, 탐색기 트리", need: "IfcBuildingStorey, IfcSpace 외곽선, 벽·개구부, 배치, 단위" },
  { n: 1, name: "설비 목록", adds: "설비와 좌표", dt: "3D 에 설비 표시", need: "IfcDistributionElement 와 배치점" },
  { n: 2, name: "설비 소속", adds: "이 설비는 회의실에 있다", dt: "이상 알림의 발생 위치", need: "IfcSpace 가 같은 파일에, 또는 같은 좌표계·같은 층 이름" },
  { n: 3, name: "계통·연결망", adds: "같은 배관에 연결(방향 모름)", dt: "계통별로 묶어 보기", need: "IfcSystem 또는 System Name, 맞닿은 솔리드" },
  { n: 4, name: "흐름 방향", adds: "공조기에서 이 토출구로 흐른다", dt: "담당 공조기, 상류·하류 추적", need: "포트와 SOURCE/SINK" },
  { n: 5, name: "운영", adds: "공조존, 관제점", dt: "계통도, 실시간 값", need: "BIM 밖(IDF·BAS)" },
];

/** 고객사에 필수로 요구하는 등급. */
export const REQUIRED = [0, 1, 2];

/**
 * 샘플 파일. lit 은 그 파일이 채우는 칸, top 은 가장 높은 칸이다.
 * ifc4Mep 은 설비만 든 파일이라(물리존 0) 칸 0·2 가 비고, 그래도 포트 방향으로 칸 4 에 닿는다.
 */
export const SAMPLES = [
  { id: "fzk", name: "AC20-FZK-Haus", lit: [0], top: 0, note: "설비 0 · 공간 골격만" },
  { id: "duplex-hvac", name: "Duplex 건축+HVAC", lit: [0, 1, 2, 3], top: 3, note: "소속 40/40 · 연결망 40/40 · 방향 0/26, 중간 포트에서 끊김" },
  { id: "duplex-mep", name: "Duplex MEP", lit: [0, 1, 2, 3], top: 3, note: "소속 141/141 · 연결 783 · 포트 없어 방향 없음" },
  { id: "ifc4mep", name: "ifc4Mep", lit: [1, 3, 4], top: 4, note: "포트 방향 1,995/1,995 · 기기 37/103 · 방이 없어 칸 0·2 가 빈다" },
  { id: "seongsu", name: "성수 건축+기계", lit: [0, 1, 2, 3, 4], top: 4, partial: true, note: "포트만으로 65% · 규칙 방향은 사람이 확정해야 나간다" },
];

/** 카드 오른쪽 아래 읽음판 한 줄. */
export function readoutOf(sample) {
  const g = GRADES[sample.top];
  return `${sample.name} · 등급 ${g.n}${sample.partial ? " 일부" : ""} ${g.name} · DT: ${g.dt}`;
}
