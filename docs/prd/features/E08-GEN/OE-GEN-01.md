---
id: "OE-GEN-01"
epic: "E08"
epic_title: "온톨로지 생성 · 내보내기 · 리포트"
title: "온톨로지 생성·내보내기"
prd: "#8"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-INT-02"]
---

# OE-GEN-01 온톨로지 생성·내보내기

## 요구사항

초기 구축 결과(물리존·커스텀존·공조존·설비·배관·담당 관계)를 DT 온톨로지로 생성한다. 산출물은 GeoJSON(기하)과 Brick TTL(의미)이며 같은 IfcGlobalId 로 이어진다(OE-INT-02). 술어는 `hasPart`·`hasLocation`·`feeds`·`hasPoint` 넷이고 TTL 에 좌표를 넣지 않는다.
[구축하기] 를 누르면 생성 전 검증(OE-GEN-03)과 게이트(OE-GEN-02)를 거쳐 두 파일을 만들고 DT 에 등록한다. 등록 경로는 D-INT(결정 전 파일 export).

## 수용 기준

- 생성한 TTL 이 rdflib 검사를, GeoJSON 이 스키마 검사를 통과하고 DT 파서(ttl.go)가 읽는다.
- TTL 에 좌표 값이 없다.

## 검증 (이 repo)

—

## 메모

—
