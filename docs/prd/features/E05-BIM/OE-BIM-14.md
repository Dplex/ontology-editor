---
id: "OE-BIM-14"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "이름 사전 종류 판정"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R24", "R14", "OE-EQP-14"]
---

# OE-BIM-14 이름 사전 종류 판정

## 관련 티켓

- [OE-EQP-14](../E12-EQP/OE-EQP-14.md): 종류 미상 패밀리 단위 지정

## 요구사항

설비·방·계통·유체의 종류를 이름 사전 → IFC 표준 칸(PredefinedType 등) 순으로 판정한다(glossary "이름 사전", R24·R14). 알 수 없으면 종류 미상으로 두고 사람이 패밀리 단위로 지정한다(OE-EQP-14). 종류마다 출처(사전·BIM·사람)를 표시한다.

## 수용 기준

- 설비마다 종류와 출처가 보인다.
- 사전에도 IFC 칸에도 없는 설비는 종류 미상으로 표시된다.

## 검증 (이 repo)

- 종류가 바뀌면 규칙 방향이 다시 돌고, 포트와 새로 어긋나기 시작한 계통을 바로 알린다 — `edit.test.ts` "종류를 바꿔 규칙이 포트와 어긋나기 시작한 계통", `e2e/edit-3d.spec.ts`, 성수 H-3

## 메모

—
