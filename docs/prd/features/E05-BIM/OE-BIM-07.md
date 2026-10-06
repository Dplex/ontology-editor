---
id: "OE-BIM-07"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "설비 생성"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R9","R11"]
---

# OE-BIM-07 설비 생성

## 요구사항

IfcDistributionElement 하위 요소를 설비로 만든다. 종류·위치(x·y·z)·용량을 읽는다(R9·R11). 종류 판정은 OE-BIM-14, 배치점 보정은 OE-BIM-12 를 따른다.
MEP 파일을 함께 열면 레이아웃과 설비 배치가 한 번에 만들어진다. 좌표가 없는 설비는 0,0,0 으로 두지 않고 미배치 목록에 둔다(K6, OE-EQP-02).

## 수용 기준

좌표 없는 설비가 미배치 목록에 보이고 3D 에는 그려지지 않는다.

## 검증 (이 repo)

—

## 메모

—
