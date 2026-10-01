---
id: "OE-PIP-01"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 연결 잇기·끊기 (E8)"
prd: "#14"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: []
jira: ""
---

# OE-PIP-01 14-A 연결 잇기·끊기 (E8)

## 요구사항

설비 간 연결 추가(`manual`, 방향 없이 시작)·삭제. **포트(BIM)가 말한 연결은 끊지 못함**

## 수용 기준

—

## 검증 (이 repo)

- 사람이 이은 연결은 방향 없이 시작하고, 포트가 말한 연결은 끊을 수 없다. 잇거나 끊으면 규칙 방향이 다시 돈다 — `e2e/connect.spec.ts`, 성수 G-6·G-7·G-8

## 메모

—
