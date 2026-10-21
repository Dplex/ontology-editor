// 그림: 에디터의 4단계 저장 상태(브라우저 자동 저장 · 서버 층별 임시 저장 · 초기 구축 v1 · 운영 편집 반영 v2)와 DT 반영 경로를 보이는 스태커 모형이다.
export const STAGES = [
  {
    id: "auto",
    name: "1 · 자동 저장 (이 브라우저)",
    carX: 22,
    v1Z: 0,
    v2Z: -12,
    dtLit: false,
    who: "나만 봄 (로컬 브라우저)",
    dt: "DT 미반영",
    detail: "저장 경로: 브라우저 로컬 스토리지 · 창을 닫았다가 다시 열면 [이어서 하기]로 복구",
    note: "편집할 때마다 클릭 없이 현재 브라우저에 자동 저장됩니다. 아직 서버나 다른 작업자에게는 보이지 않습니다.",
  },
  {
    id: "draft",
    name: "2 · 임시 저장 (서버 층별 슬롯)",
    carX: 68,
    v1Z: 0,
    v2Z: -12,
    dtLit: false,
    who: "같은 층을 여는 동료 공유",
    dt: "DT 미반영 (작업 중 상태)",
    detail: "저장 경로: 서버 /__data/__drafts (층마다 1개 덮어쓰기) · 편집 잠금(__locks) 연동",
    note: "[임시 저장]을 누르면 서버의 해당 층 슬롯에 저장됩니다. 다른 사람이 그 층을 열면 임시 저장본부터 이어서 편집합니다.",
  },
  {
    id: "build-v1",
    name: "3 · 구축하기 (초기 반영본 v1)",
    carX: 120,
    v1Z: 4,
    v2Z: -12,
    dtLit: true,
    who: "DT 플랫폼 + 전체 사용자",
    dt: "DT 정식 배포 (v1)",
    detail: "생성 항목: ontology.ttl · floor-*.geojson · model.glb · edits.json · 검증 리포트",
    note: "초기 구축 모드에서 [구축하기]를 실행하면 모든 층의 편집을 모아 서버에 첫 정식 버전(v1)을 만들고 운영 편집 모드로 전환됩니다.",
  },
  {
    id: "publish-v2",
    name: "4 · 반영하기 (운영 편집 v2, v3…)",
    carX: 152,
    v1Z: 0,
    v2Z: 8,
    dtLit: true,
    who: "DT 플랫폼 + 전체 사용자",
    dt: "DT 새 버전 배포 (v2 적재)",
    detail: "버전 스태커: v1 보존 위에 v2 카세트가 적재되며 층 단위 변경분 반영",
    note: "구축 이후에는 고칠 층만 [운영 편집]으로 열어 수정한 뒤 [반영하기]를 누릅니다. 기존 v1 위에 새 버전(v2, v3…)이 차례로 쌓입니다.",
  },
];

export function readoutOf(s) {
  return `${s.name.split(" · ")[1]} · ${s.who} · ${s.dt}`;
}
