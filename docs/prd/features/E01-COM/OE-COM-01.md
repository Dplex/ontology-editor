---
id: "OE-COM-01"
epic: "E01"
epic_title: "공통 · 권한 · 편집 잠금"
title: "권한 카탈로그 연동"
prd: "#1 #2"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-XPRD-04"]
---

# OE-COM-01 권한 카탈로그 연동

## 관련 티켓

- [OE-XPRD-04](../E22-XPRD/OE-XPRD-04.md): 권한 값을 둘 기능 권한 카탈로그

## 요구사항
> User story : R1에서는 편집 권한을 따로 나누지 않아 구축·운영 담당자가 권한 설정 없이 바로 에디터를 쓴다. R2에서 고객사가 DT 회원 권한 정책을 적용하면 Viewer 계정의 관제 직원은 레이아웃을 보기만 하고 편집 진입이 거부되며, Admin·Super Admin인 시설 관리자만 편집과 [반영하기]를 한다. 권한 값은 PRD_009 기능 권한 카탈로그 항목이고 화면 진입과 API 호출 양쪽에서 검사되어, 화면을 우회한 반영 API 호출도 막힌다.

편집 권한자는 glossary 의 정의를 따른다. R1 에서는 편집 권한을 따로 구분하지 않는다.

R2 요구사항 :  Digital Twin 회원 권한 정책을 따르며, 권한 값은 PRD_009 기능 권한 카탈로그의 항목으로 둔다(OE-XPRD-04). Viewer 는 편집에 진입할 수 없고 Admin·Super Admin 은 편집과 [반영하기]를 할 수 있다.
권한 검사는 화면 진입과 API 호출 양쪽에서 한다.

## 수용 기준

- R1 — 별도 기준 없음.
- R2 — Viewer 계정은 에디터 편집 진입이 거부된다. Admin 계정은 [반영하기]를 실행할 수 있다. 권한 없는 계정의 반영 API 호출은 거부된다.

## 검증 (이 repo)

—

## 메모

—
