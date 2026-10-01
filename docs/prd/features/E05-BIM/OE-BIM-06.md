---
id: "OE-BIM-06"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "내력벽 속성"
prd: "#6"
release: "R1.5"
priority: "P2"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["R22"]
jira: ""
---

# OE-BIM-06 내력벽 속성

## 요구사항

Pset_WallCommon.LoadBearing(Revit Structural) → loadBearing. 값 없으면 "모름"

## 수용 기준

—

## 검증 (이 repo)

- 두 점으로 벽을 그으면 두께 0.2m 외곽선이고 내력 여부는 "모름" 이다. 모름과 아니오를 섞지 않는다 — `edit.test.ts` "벽·문·창 편집 (E4)", 성수 N-3·N-4

## 메모

—
