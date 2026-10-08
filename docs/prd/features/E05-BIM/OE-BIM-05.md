---
id: "OE-BIM-05"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "문·창 생성"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-OBJ-07", "R4"]
---

# OE-BIM-05 문·창 생성

## 관련 티켓

- [OE-OBJ-07](../E02-OBJ/OE-OBJ-07.md): 문·창 통과 속성

## 요구사항

IfcDoor·IfcWindow 를 문·창으로 만든다. 위치·치수와 함께 어느 벽에 뚫렸는지(개구부 관계)를 읽는다. 통과 속성은 OE-OBJ-07 을 따라 둔다. 호스트 벽을 찾지 못한 문·창은 R4 위반으로 집계한다.

## 수용 기준

호스트 벽이 없는 문·창이 R4 집계에 들어간다.

## 검증 (이 repo)

—

## 메모

—
