---
id: "OE-REQ-07"
epic: "E06"
epic_title: "고객사 BIM 요구사항 · 검증"
title: "R26 공간 설계 풍량"
prd: "#6 요구사항, 1.8"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-REQ-01","OE-REQ-02","OE-ZON-06","U7"]
---

# OE-REQ-07 R26 공간 설계 풍량

## 요구사항

고객사 BIM 의 방(IfcSpace)에 사이트가 설계한 급기 풍량을 넣어 달라고 요구하는 R26 을 둔다(권장). 에디터는 이 값을 계산하지 않고 그대로 가져다 용량 검증 Z-03(OE-ZON-05·06)에 쓴다.

- 위치 — IFC2x3·IFC4: `Pset_SpaceThermalDesign.CoolingDesignAirflow`·`HeatingDesignAirflow`. IFC4.3: `Pset_SpaceAirHandlingDimensioning.CoolingDesignAirFlow`·`HeatingDesignAirFlow`.
- 대상 — 공조 대상인 방. 계단실·샤프트 등 비공조 공간은 해당 없음이다.
- 정본 4장에 R26 행을, IDS(`requirements.ids`)에 IfcSpace 속성 facet 을 더한다(OE-REQ-02). 요구사항 보고서(OE-BIM-17)와 고객사 요청 문구(OE-REQ-06)에도 같은 R 번호로 나온다.
- Revit 에서 이 값이 IFC 로 어떻게 나가는지(MEP Space 의 설계 풍량이 위 속성으로 매핑되는지)는 U7 에서 확인하고, 확인 결과를 고객사 전달 문구(내보내기 설정 안내)에 넣는다.

R25(D14)와 번호가 겹치지 않도록 R26 을 쓴다. 정본에 R26 이 들어가기 전에는 다른 티켓의 `depends` 에 R26 을 적지 않고 이 티켓 번호를 적는다(`prd.test.ts` 가 정본에 없는 R 을 실패로 본다).

## 수용 기준

- 정본 4장과 IDS 에 R26 이 있고 `requirements-ids.test.ts` 가 통과한다.
- 설계 풍량이 없는 IfcSpace 가 있는 파일의 요구사항 보고서에 R26 이 "없음·일부"로, 다른 Pset 에 있는 파일은 "다른 위치"로 보인다.
- 비공조 공간(방 종류가 계단실·샤프트 등)은 R26 판정에서 "해당 없음"이다.

## 검증 (이 repo)

—

## 메모

—
