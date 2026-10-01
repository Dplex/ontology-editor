---
id: "OE-PIP-03"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 계통 종류·유체"
prd: "#14"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["R16"]
jira: ""
---

# OE-PIP-03 14-A 계통 종류·유체

## 요구사항

급기·환기·배기·외기·순환수·급탕·급수·소화·덕트 구분. 유체는 PredefinedType → 이름 → 원천 기기 순

## 수용 기준

계통 클래스로 TTL 출력

## 검증 (이 repo)

- 계통 종류를 바꾸면 규칙 방향이 뒤집힌다. 덕트 유형 이름과 어긋나면 정하지 않고 충돌로 세며 몇 개인지 알린다 — `flow-rules.test.ts`, 성수 O-3
- 순환수 계통은 유체(냉수·온수·냉각수)를 고를 수 있고, TTL 계통 클래스가 그에 맞게 나간다. 사람이 고른 유체는 원천 짐작이 덮지 않는다 — `e2e/edit-system.spec.ts`, 성수 O-4

## 메모

—
