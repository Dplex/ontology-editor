---
id: "OE-BIM-18"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "검토 화면 — 완전성 검사"
prd: "#6"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: ["OE-PIP-08"]
jira: ""
---

# OE-BIM-18 검토 화면 — 완전성 검사

## 요구사항

8규칙(공기 원천↔말단 3, 소속 방, 연결망, 끊긴 도관, 물 계통 2) 위반 목록 + 이유 + 한 번에 고치기(방 안으로 옮기기·가장 가까운 설비와 잇기). 고치기는 되돌리기 이력에 쌓임

## 수용 기준

성수에서 규칙별 집계 표시

## 검증 (이 repo)

- 위반마다 이유가 보이고, [방 안으로 옮기기]·[잇기: 가장 가까운 이웃] 이 여느 편집과 같은 길로 가서 Ctrl+Z 로 돌아간다 — `checks.test.ts`, 성수 J-1·J-2·J-3

## 메모

—
