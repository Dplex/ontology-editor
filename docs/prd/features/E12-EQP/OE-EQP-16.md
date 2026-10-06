---
id: "OE-EQP-16"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "로봇 통과·연결 데이터"
prd: "#13"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-EQP-17","OE-ROB-04"]
---

# OE-EQP-16 로봇 통과·연결 데이터

## 요구사항

통과 속성(OE-EQP-17 을 따른다), 방-문-방 `connects`, 계단실·승강로 층간 `verticalConnects`를 GeoJSON에 포함(공간 경계 없으면 문 위치로 좌표 판정, 층간은 바닥 절반 겹침)

## 수용 기준

병원의 계단실·승강로 7개 중 6개 이상이 `verticalConnects` 로 이어진다.

## 검증 (이 repo)

—

## 메모

—
