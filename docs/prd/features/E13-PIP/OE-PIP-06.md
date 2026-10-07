---
id: "OE-PIP-06"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "포트 불변 원칙"
prd: "#14"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-PIP-06 포트 불변 원칙

## 요구사항

(PRD #14-A) 포트(BIM)에 적힌 연결과 방향은 고칠 수 없다(K13). 잇기·끊기·방향 화살표 UI 가 비활성이다. BIM 값이 틀렸으면 BIM 을 고쳐 재임포트한다.

## 수용 기준

포트가 말한 연결의 끊기·방향 UI 가 비활성이다.

## 검증 (이 repo)

- 사람이 이은 연결은 방향 없이 시작하고, 포트가 말한 연결은 끊을 수 없다. 잇거나 끊으면 규칙 방향이 다시 돈다 — `e2e/connect.spec.ts`, 성수 G-6·G-7·G-8

## 메모

—
