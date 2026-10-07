---
id: "OE-PIP-03"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "계통 종류·유체"
prd: "#14"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R16"]
---

# OE-PIP-03 계통 종류·유체

## 요구사항

(PRD #14-A) 계통 종류는 급기(SA)·리턴(RA)·배기(EA)·외기(OA)·순환수·냉매(REF)·덕트, 그리고 급탕·급수·소화다(R16). 순환수는 유체에 따라 냉수(CHWS·CHWR)·온수(HWS·HWR)·냉각수(CWS·CWR)로 나눈다(glossary "Flow Type").
급탕·급수·소화·스팀·지열수는 Flow Type 범례에 없어 색과 TTL 클래스를 정하지 못한다 — 범례 추가 후 적용한다. FCU 2관식은 계절별로 유체가 바뀌므로 2관식·4관식 속성이 필요하다(제안 — glossary).
유체는 PredefinedType → 이름 → 원천 기기 순으로 정한다. 사람이 고른 유체는 짐작이 덮지 않는다.

## 수용 기준

- 계통 종류마다 TTL 계통 클래스가 다르게 나간다.
- 순환수 계통의 유체를 고르면 TTL 클래스가 그에 맞게 바뀐다.

## 검증 (이 repo)

- 계통 종류를 바꾸면 규칙 방향이 뒤집힌다. 덕트 유형 이름과 어긋나면 정하지 않고 충돌로 세며 몇 개인지 알린다 — `flow-rules.test.ts`, 성수 O-3
- 순환수 계통은 유체(냉수·온수·냉각수)를 고를 수 있고, TTL 계통 클래스가 그에 맞게 나간다. 사람이 고른 유체는 원천 짐작이 덮지 않는다 — `e2e/edit-system.spec.ts`, 성수 O-4

## 메모

—
