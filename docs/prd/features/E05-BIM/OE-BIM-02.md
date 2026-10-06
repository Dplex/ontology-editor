---
id: "OE-BIM-02"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "층 생성"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R1"]
---

# OE-BIM-02 층 생성

## 요구사항

IfcBuildingStorey 를 층으로 만든다. 이름과 바닥 높이(Elevation)를 읽는다.
층고는 Elevation 의 차로 계산하고, 층 높이 속성(GrossHeight·NetHeight, COBie Storey Height)이 있으면 함께 읽는다(glossary "천장 관련 높이"). 값이 없으면 지어내지 않는다.

## 수용 기준

- 층 수와 IfcBuildingStorey 수가 같고, 층마다 Elevation 이 있다.
- 층고가 없는 층은 '모름' 으로 표시된다.

## 검증 (이 repo)

—

## 메모

—
