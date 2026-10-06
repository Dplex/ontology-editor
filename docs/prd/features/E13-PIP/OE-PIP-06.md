---
id: "OE-PIP-06"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 포트 불변 원칙"
prd: "#14"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-PIP-06 14-A 포트 불변 원칙

## 요구사항

포트(BIM)에 적힌 연결·방향은 고칠 수 없다(K13)

## 수용 기준

편집 UI 비활성

## 검증 (이 repo)

- 사람이 이은 연결은 방향 없이 시작하고, 포트가 말한 연결은 끊을 수 없다. 잇거나 끊으면 규칙 방향이 다시 돈다 — `e2e/connect.spec.ts`, 성수 G-6·G-7·G-8

## 메모

—
