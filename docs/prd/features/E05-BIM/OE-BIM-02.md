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
> User story : 구축 담당자가 BIM을 임포트하면 건물의 각 층이 자동으로 생성되고 층 이름과 바닥 높이가 읽힌다. 층고는 층 바닥 높이의 차로 계산되며, BIM에 층 높이 속성이 있으면 함께 읽는다. 값이 없으면 지어내지 않고 '모름'으로 표시된다. 이 층 정보는 설비 설치면 판정과 층 매핑의 기준이 되므로, 사용자는 층 수가 BIM과 같은지, 층마다 바닥 높이가 있는지 확인하고 층고를 모르는 층을 먼저 점검해 천장 설비 분류가 틀어지지 않도록 할 수 있어야 한다.

IfcBuildingStorey 를 층으로 만든다. 이름과 바닥 높이(Elevation)를 읽는다.
층고는 Elevation 의 차로 계산하고, 층 높이 속성(GrossHeight·NetHeight, COBie Storey Height)이 있으면 함께 읽는다(glossary "천장 관련 높이"). 값이 없으면 지어내지 않는다.
층은 건물 ID·원본 층 ID·이름·공통 기준 높이로 관리한다. Elevation 누락과 실제 0을 구분하고 마지막 층 층고나 동일 높이 층을 임의 계산하지 않는다.

## 수용 기준

- 지원 대상 층 수가 IfcBuildingStorey 수와 같고 유효한 Elevation 또는 높이 미확인 사유가 층마다 표시된다.
- 층고가 없는 층은 '모름' 으로 표시된다.
- 동명이층·다른 건물이 병합되지 않고 누락 높이는 미확인 사유가 표시된다. 층 상대/공통 높이가 ML-18과 일치한다.

## 검증 (이 repo)

—

## 메모

—
