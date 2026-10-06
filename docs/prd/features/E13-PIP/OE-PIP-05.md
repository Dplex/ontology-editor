---
id: "OE-PIP-05"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "규칙 방향 추정·확정"
prd: "#14"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-GEN-04"]
---

# OE-PIP-05 규칙 방향 추정·확정

## 요구사항

(PRD #14-A) 포트 방향이 없는 연결은 계통 종류(급기는 나감, 리턴·배기는 들어옴)와 설비 종류(원천)로 방향을 추정한다(glossary "규칙 방향").
확정은 계통 단위다. 확정 버튼 옆에 포트 방향과의 일치율을 보이고, 확정한 계통의 규칙 방향만 `feeds` 로 나간다(K14, OE-GEN-04). 포트와 비교할 연결이 20개 이상이고 일치율 90% 이상인 계통은 일괄 확정할 수 있다.

## 수용 기준

- 성수 규칙 방향의 포트 일치율 83.8% 이상.
- 확정 전 계통의 규칙 방향은 TTL 에 없다.

## 검증 (이 repo)

- 규칙 방향은 계통 단위로 확정하고, 확정한 것만 `brick:feeds` 로 나간다. 확정 전 규칙 방향은 TTL 에 없다 — `flow-rules.test.ts`, `export.test.ts`, 성수 G-5·L-3

## 메모

—
