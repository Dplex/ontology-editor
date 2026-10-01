---
id: "OE-EQP-02"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "미배치 설비 배치 (E6)"
prd: "#13"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: ["부록 B"]
jira: ""
---

# OE-EQP-02 미배치 설비 배치 (E6)

## 요구사항

좌표 없는 설비는 미배치 목록 → 3D에서 바닥을 눌러 배치, 배치 후 좌표 생성. **높이 = 같은 패밀리의 높이, 없으면 바닥(값을 지어내지 않음)**

## 수용 기준

0,0,0 자동 채움 없음(K6)

## 검증 (이 repo)

- [3D에서 놓기] 로 바닥을 누르면 그 자리에 놓이고, 높이는 같은 패밀리의 높이, 없으면 바닥이다 — `edit.test.ts` "미배치 설비 배치 (E6)", 성수 E-9

## 메모

—
