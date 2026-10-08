---
id: "OE-SPC-01"
epic: "E09"
epic_title: "공간 편집"
title: "물리존 이름 설정·수정 (E1)"
prd: "#9 #10"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["K12", "OE-SPC-17"]
---

# OE-SPC-01 물리존 이름 설정·수정 (E1)

## 관련 티켓

- [OE-SPC-17](./OE-SPC-17.md): 이름으로 모를 때 OmniClass 판정

## 요구사항

물리존의 공간명을 설정·수정한다(E1). 공간명을 고치면 방 종류를 이름 사전으로 다시 판정한다 — 한 이름에 여러 종류가 걸리면 머리 낱말을 우선한다(K12). OmniClass 는 이름으로 모를 때만 쓴다(OE-SPC-17).
공간명 변경은 TTL 의 `rdfs:label` 과 GeoJSON 의 이름에 함께 반영된다. 방번호는 이 티켓에서 고치지 않는다.

## 수용 기준

공간명을 바꾸면 TTL label·GeoJSON 이름·방 종류가 함께 바뀐다.

## 검증 (이 repo)

- 이름을 고치면 TTL `rdfs:label` 과 GeoJSON 이름이 같이 바뀌고, 이름 사전이 정한 방 종류가 따라간다. OmniClass 는 이름이 모를 때만 쓴다 — `edit.test.ts` "이름 수정 (E1)", 성수 L-5

## 메모

—
