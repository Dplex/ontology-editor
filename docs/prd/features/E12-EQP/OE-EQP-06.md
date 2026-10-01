---
id: "OE-EQP-06"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "배관 없는 설비 디테일"
prd: "#13"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: []
jira: ""
---

# OE-EQP-06 배관 없는 설비 디테일

## 요구사항

센서·조명·CCTV: 이동·삭제·명칭 자유

## 수용 기준

—

## 검증 (이 repo)

- 3D 끌기 중 Esc 는 취소다. 고른 설비는 앞에 다른 설비가 가려도 끌 수 있다 — `e2e/edit-3d.spec.ts` "끄는 중 Esc 는 취소다", "앞에 다른 설비가 가려도", 성수 E-2
- 건물에서 먼 좌표를 치면 옮기되 오타일 수 있다고 알리고, 칸을 비우면 원래 값으로 돌아온다 — `e2e/edit-safety.spec.ts` "건물에서 먼 값을 치면"

## 메모

—
