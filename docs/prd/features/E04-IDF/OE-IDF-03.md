---
id: "OE-IDF-03"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "설계 풍량·외기량"
prd: "#5"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-ZON-05"]
---

# OE-IDF-03 설계 풍량·외기량

## 요구사항

Sizing:Zone 과 DesignSpecification:OutdoorAir 를 읽어 존별 설계 풍량·외기량을 둔다. 이 값은 용량 검증 Z-03(OE-ZON-05)의 기준값이다. 값이 없는 존은 기준값 없음으로 두고 지어내지 않는다.

## 수용 기준

- 기준값이 없는 존이 목록으로 보인다.
- 기준값이 있는 존에서 Z-03 이 그 값으로 판정된다.

## 검증 (이 repo)

—

## 메모

—
