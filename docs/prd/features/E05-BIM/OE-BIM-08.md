---
id: "OE-BIM-08"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "토출구·배관 초안"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-GEN-10", "OE-BIM-09", "OE-PIP-03"]
---

# OE-BIM-08 토출구·배관 초안

## 관련 티켓

- [OE-GEN-10](../E08-GEN/OE-GEN-10.md): 도관 fso: 내보내기
- [OE-BIM-09](./OE-BIM-09.md): 배관 초안 Flow Type 근거 계통
- [OE-PIP-03](../E13-PIP/OE-PIP-03.md): 계통 종류로 Flow Type 결정

## 요구사항

IfcAirTerminal 은 토출구로(glossary), IfcDuctSegment·IfcPipeSegment 는 배관 초안(세그먼트 형상)으로 만든다. 기기와 도관을 구분하고, 도관은 TTL 에서 `fso:` 로 내보낸다(OE-GEN-10). 배관 초안의 Flow Type 은 계통 종류(OE-BIM-09, OE-PIP-03)에서 정한다.

## 수용 기준

토출구가 설비 목록에 좌표와 함께 나오고, 덕트·배관 세그먼트가 배관 초안으로 그려진다.

## 검증 (이 repo)

—

## 메모

—
