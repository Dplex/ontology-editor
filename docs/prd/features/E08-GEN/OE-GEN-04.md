---
id: "OE-GEN-04"
epic: "E08"
epic_title: "온톨로지 생성 · 내보내기 · 리포트"
title: "미확정 규칙 방향 제외"
prd: "#8"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: ["OE-PIP-05"]
jira: ""
---

# OE-GEN-04 미확정 규칙 방향 제외

## 요구사항

사람이 확정하지 않은 규칙 방향은 `feeds`로 내보내지 않고 수를 리포트에 남김

## 수용 기준

TTL에 미확정 feeds 없음

## 검증 (이 repo)

- 규칙 방향은 계통 단위로 확정하고, 확정한 것만 `brick:feeds` 로 나간다. 확정 전 규칙 방향은 TTL 에 없다 — `flow-rules.test.ts`, `export.test.ts`, 성수 G-5·L-3

## 메모

—
