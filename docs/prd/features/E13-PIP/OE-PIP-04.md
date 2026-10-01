---
id: "OE-PIP-04"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 연결별 방향 지정"
prd: "#14"
release: "R1.5"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: []
jira: ""
---

# OE-PIP-04 14-A 연결별 방향 지정

## 요구사항

연결 하나하나의 방향을 사람이 지정. 사람이 정한 방향은 규칙보다 우선, 별도 확정 없이 내보냄

## 수용 기준

—

## 검증 (이 repo)

- 연결 하나의 방향은 하류 → 상류 → 지움으로 돌고, 포트가 방향을 말한 연결은 바뀌지 않는다 — `e2e/edit-3d.spec.ts` "연결 화살표를 누르면", 성수 G-1·G-2

## 메모

—
