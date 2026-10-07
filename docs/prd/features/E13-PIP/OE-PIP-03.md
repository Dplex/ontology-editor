---
id: "OE-PIP-03"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "계통 종류·유체"
prd: "#14"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["R16"]
---

# OE-PIP-03 계통 종류·유체

## 요구사항

(PRD #14-A) 계통 종류는 급기(SA)·리턴(RA)·배기(EA)·외기(OA)·순환수·냉매(REF)·덕트, 그리고 급탕·급수·소화다(R16). 순환수는 유체에 따라 냉수(CHWS·CHWR)·온수(HWS·HWR)·냉각수(CWS·CWR)로 나눈다(glossary "Flow Type").
급탕(DHWS·DHWR)·급수(DCW)·소화(FP)·스팀(STM·CR)·지열수(GWS·GWR)도 Flow Type 범례에 있다(glossary "Flow Type", 코드는 제안). FCU 2관식은 계절별로 유체가 바뀌므로 2관식·4관식 속성이 필요하다(제안 — glossary).
순환수 계통이 냉수·온수·냉각수 중 무엇인지(유체)는 아래 순서로 정하고, 앞에서 정해지면 뒤는 보지 않는다.
1. BIM 이 적은 값 — 계통의 IFC 속성 `PredefinedType`(CHILLEDWATER = 냉수, HEATING = 온수, CONDENSERWATER = 냉각수)
2. 계통 이름 — "냉수 공급 1" 이면 냉수. "냉온수" 처럼 둘 다 들어 있으면 정하지 않는다
3. 배관을 따라가 닿는 원천 기기 — 냉동기면 냉수, 보일러면 온수, 냉각탑이면 냉각수(짐작)

사용자가 직접 선택하여 적용한 유체 종류는 시스템의 자동 추정 값보다 우선한다. 원천 설비 종류나 연결 관계가 변경되어 시스템이 유체를 다시 추정하더라도 사용자 선택 값을 덮어쓰지 않는다.

## 수용 기준

- 계통 종류마다 TTL 계통 클래스가 다르게 나간다.
- 순환수 계통의 유체를 고르면 TTL 클래스가 그에 맞게 바뀐다.

## 검증 (이 repo)

- 계통 종류를 바꾸면 규칙 방향이 뒤집힌다. 덕트 유형 이름과 어긋나면 정하지 않고 충돌로 세며 몇 개인지 알린다 — `flow-rules.test.ts`, 성수 O-3
- 순환수 계통은 유체(냉수·온수·냉각수)를 고를 수 있고, TTL 계통 클래스가 그에 맞게 나간다. 사람이 고른 유체는 원천 짐작이 덮지 않는다 — `e2e/edit-system.spec.ts`, 성수 O-4

## 메모

—
