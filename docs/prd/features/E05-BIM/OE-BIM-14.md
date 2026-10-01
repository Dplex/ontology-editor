---
id: "OE-BIM-14"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "이름 사전 종류 판정"
prd: "#6"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["R24","R14"]
jira: ""
---

# OE-BIM-14 이름 사전 종류 판정

## 요구사항

설비·방·계통·유체 종류를 이름 사전 → IFC 표준 칸 순으로 판정. 알 수 없으면 사람이 패밀리 단위로 지정(OE-EQP-15)

## 수용 기준

종류마다 출처 표시

## 검증 (이 repo)

- 종류가 바뀌면 규칙 방향이 다시 돌고, 포트와 새로 어긋나기 시작한 계통을 바로 알린다 — `edit.test.ts` "종류를 바꿔 규칙이 포트와 어긋나기 시작한 계통", `e2e/edit-3d.spec.ts`, 성수 H-3

## 메모

—
