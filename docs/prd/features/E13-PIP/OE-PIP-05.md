---
id: "OE-PIP-05"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 규칙 방향 추정·확정"
prd: "#14"
release: "R1.5"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["OE-GEN-04"]
jira: ""
---

# OE-PIP-05 14-A 규칙 방향 추정·확정

## 요구사항

계통 종류(급기 나감/환기·배기 들어옴)·설비 종류(원천)로 방향 추정. 계통 단위 확정 버튼 옆에 포트 방향과의 일치율 표시. 확정한 계통만 `feeds` 출력. 포트와 비교 연결 20개 이상·일치 90% 이상 계통은 일괄 확정 가능

## 수용 기준

성수 규칙 일치율 83.8%

## 검증 (이 repo)

- 규칙 방향은 계통 단위로 확정하고, 확정한 것만 `brick:feeds` 로 나간다. 확정 전 규칙 방향은 TTL 에 없다 — `flow-rules.test.ts`, `export.test.ts`, 성수 G-5·L-3

## 메모

—
