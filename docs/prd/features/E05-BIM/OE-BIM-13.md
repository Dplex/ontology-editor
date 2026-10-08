---
id: "OE-BIM-13"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "Proxy 처리"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "예외 ✗"
blocked_by: []
depends: ["R23", "OE-EXT-05"]
---

# OE-BIM-13 Proxy 처리

## 관련 티켓

- [OE-EXT-05](../E17-EXT/OE-EXT-05.md): 건축 루버 설비 오인 방지

## 요구사항

### User story

구축 담당자가 Revit에서 IfcBuildingElementProxy로 내보내진 수백 개 요소가 설비 목록을 뒤덮는 문제를 겪는다. 에디터가 포트가 있거나 이름이 이름 사전에 있는 Proxy만 설비로 받고 나머지는 만들지 않되 수를 리포트에 적으므로, 외장재·장식물이 설비로 섞이지 않으면서 '버려진 것이 얼마나 되는지'는 확인할 수 있다. 받은 수와 버린 수가 리포트에 보여 고객사에 R23(IFC 클래스 지정) 준수를 요청할 근거가 된다.

IfcBuildingElementProxy 는 포트가 있거나 이름이 이름 사전에 있는 것만 설비로 받는다(R23). 그 밖의 Proxy 는 설비로 만들지 않고 수를 리포트에 적는다. 건축 루버가 설비로 들어오는 것은 OE-EXT-05 로 막는다.

## 수용 기준

받은 Proxy 수와 버린 Proxy 수가 리포트에 보인다.

## 검증 (이 repo)

—

## 메모

—
