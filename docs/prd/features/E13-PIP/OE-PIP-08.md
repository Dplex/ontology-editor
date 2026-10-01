---
id: "OE-PIP-08"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 위반 한 번에 고치기"
prd: "#14"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["OE-BIM-18"]
jira: ""
---

# OE-PIP-08 14-A 위반 한 번에 고치기

## 요구사항

완전성 검사 위반에 [방 안으로 옮기기]·[가장 가까운 설비와 잇기] — 다른 편집과 같은 경로, 되돌리기 이력 포함

## 수용 기준

—

## 검증 (이 repo)

- 위반마다 이유가 보이고, [방 안으로 옮기기]·[잇기: 가장 가까운 이웃] 이 여느 편집과 같은 길로 가서 Ctrl+Z 로 돌아간다 — `checks.test.ts`, 성수 J-1·J-2·J-3

## 메모

—
