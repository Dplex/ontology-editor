---
id: "OE-GEN-04"
epic: "E08"
epic_title: "온톨로지 생성 · 내보내기 · 리포트"
title: "미확정 규칙 방향 제외"
prd: "#8"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["K4", "K14", "OE-PIP-05"]
---

# OE-GEN-04 미확정 규칙 방향 제외

## 관련 티켓

- [OE-PIP-05](../E13-PIP/OE-PIP-05.md): 계통 단위 규칙 방향 확정

## 요구사항

규칙으로 추정한 흐름 방향은 사람이 계통 단위로 확정한 것만 `feeds` 로 내보낸다(K4·K14, OE-PIP-05). 확정하지 않은 규칙 방향은 TTL 에 넣지 않고 수를 리포트에 남긴다.

## 수용 기준

TTL 에 미확정 규칙 방향에서 비롯한 `feeds` 가 없다.

## 검증 (이 repo)

- 규칙 방향은 계통 단위로 확정하고, 확정한 것만 `brick:feeds` 로 나간다. 확정 전 규칙 방향은 TTL 에 없다 — `flow-rules.test.ts`, `export.test.ts`, 성수 G-5·L-3

## 메모

—
