---
id: "OE-OBJ-11"
epic: "E02"
epic_title: "편집 오브젝트 정의 및 분류"
title: "배관 있는 설비"
prd: "#3"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-partial"
status_note: "배관 추종 ✔, 공조존 담당 지정 ✗(#11 운영 편집)"
blocked_by: []
depends: ["OE-EQP-08","OE-EQP-09","OE-EQP-10","OE-EQP-11"]
jira: ""
---

# OE-OBJ-11 배관 있는 설비

## 요구사항

AHU·PAC·EHP·VAV 등. 배치 · 명칭 · 이동(연결 배관 함께) · 삭제. 공조존 담당 설비 지정 가능(#11)

## 수용 기준

—

## 검증 (이 repo)

- 설비를 옮기면 바로 붙은 이음쇠는 같이 옮기고 그 너머 구간은 먼 끝을 두고 늘인다. 되돌리기·편집 파일을 거쳐도 같다 — `src/lib/follow.test.ts`, 퍼징 `moveFollow`
- 끄고 켜기·되돌리기·3D 형상 — `e2e/conduit-follow.spec.ts`(Duplex MEP 가 있을 때)

## 메모

—
