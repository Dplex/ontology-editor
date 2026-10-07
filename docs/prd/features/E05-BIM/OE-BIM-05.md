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
depends: ["R4"]
---

# OE-BIM-05 문·창 생성

## 요구사항

IfcDoor·IfcWindow 를 문·창으로 만든다. 위치·치수와 함께 어느 벽에 뚫렸는지(개구부 관계)를 읽는다. 통과 속성은 OE-OBJ-07 을 따라 둔다. 호스트 벽을 찾지 못한 문·창은 R4 위반으로 집계한다.

## 수용 기준

호스트 벽이 없는 문·창이 R4 집계에 들어간다.

## 검증 (이 repo)

- `src/lib/requirements.test.ts` "호스트 벽을 모르는 문·창은 R4 를 "일부" 로 만든다 — 빼지 않고 모수에 넣는다(OE-BIM-05)"
- `scripts/check-sample.test.ts` "호스트 벽을 모르는 문·창은 R4 일부로 센다": AC20 16/16 · Duplex 건축 38/38 표준, 병원 건축 302/307 일부
- `src/lib/ifc/import.test.ts` "개구부 (F4 · F5 · F15)": 치수, 어느 벽에 뚫렸는지(두 단계), 관계가 없으면 null, 문은 지나갈 수 있고 창문은 못 한다

## 메모

- 호스트 벽은 IfcRelFillsElement(문·창 → 개구부)와 IfcRelVoidsElement(개구부 → 벽) 두 단계로 찾는다. 못 찾으면 `wallId` 가 null 이다.
- 통과 속성은 OE-OBJ-07·OE-EQP-17 을 따라 문 `passable: true`, 창 `false` 로 둔다.
