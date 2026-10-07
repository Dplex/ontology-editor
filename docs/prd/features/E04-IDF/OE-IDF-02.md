---
id: "OE-IDF-02"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "HVAC 객체 → 설비·담당"
prd: "#5"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-IDF-02 HVAC 객체 → 설비·담당

## 요구사항

IDF 의 HVAC 객체를 설비와 담당 관계로 만든다. AirLoopHVAC 는 공조기, ZoneHVAC:* 는 존 설비, AirTerminal:* 는 토출구로 읽고 종류·용량·담당 공조존을 둔다.
담당 관계는 존 설비 목록 → 말단 → 급기 분기 → 공조기 순으로, VRF 는 실외기 → 실내기 순으로 잇는다. 설비 위치는 IDF 에 없으므로 좌표 없이 만든다(OE-IDF-08 로 BIM 설비와 연결).

## 수용 기준

삼성 IDF 에서 공조기 16 → VAV 128, 실외기 41 → 실내기 119 가 전부 담당 관계로 연결된다.

## 검증 (이 repo)

—

## 메모

—
