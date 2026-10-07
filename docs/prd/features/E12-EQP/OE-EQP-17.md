---
id: "OE-EQP-17"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "로봇 통과 속성 정의"
prd: "#13"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
status_note: "(문·창·벽) / ◐"
blocked_by: []
depends: []
---

# OE-EQP-17 로봇 통과 속성 정의

## 요구사항

로봇 통과 속성은 이 티켓이 정한다. 
문 = 통과 가능(천장 막힘·바닥 뚫림). 
창문·벽(내벽·외벽)·내력벽 = 불가. 
수직 관통 오브젝트는 EL = 정차 층에서만 가능, 샤프트·ES·계단 = 불가. 
[개발확인필요] 속성은 GeoJSON 에 기록한다(내보내기는 OE-EQP-16).

## 수용 기준

문 `passable=true`, 창·벽·ES·계단·샤프트 `passable=false`

## 검증 (이 repo)

—

## 메모

—
