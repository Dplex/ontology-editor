---
id: "OE-BIM-09"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "계통·포트 읽기"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R16","R17","K3","U1"]
---

# OE-BIM-09 계통·포트 읽기

## 요구사항

IfcSystem(또는 Revit System Name)을 계통으로 읽는다(R16). 포트는 IFC4 의 IfcRelNests, IFC2x3 의 IfcRelConnectsPortToElement 와 IfcRelConnectsPorts 로 읽고 FlowDirection 도 읽는다(R17).
포트가 없을 때는 세그먼트 끝점이 5mm 안에서 닿고 계통 이름이 같으면 연결로 본다(K3, 출처 geometry). IFC4 Reference View 에 공간 경계·계통·포트가 드는지는 U1.

## 수용 기준

- IFC2x3 와 IFC4 파일 모두에서 연결 수가 0 보다 크다.
- 포트에서 읽은 연결과 형상에서 추정한 연결의 출처가 구분된다.

## 검증 (이 repo)

- `scripts/check-sample.test.ts` "포트 연결 (ifc4Mep, IFC4)": IfcRelNests 로 포트를 찾고 SOURCE→SINK 를 방향으로 읽는다
- `scripts/check-sample.test.ts` "포트 연결 (Duplex HVAC, IFC2x3)": IfcRelConnectsPortToElement 로 읽고 SOURCEANDSINK 는 방향 없는 연결로 둔다
- `scripts/check-sample.test.ts` "Duplex MEP 판본 (포트 없음)" · "형상 추정의 정확도": 포트가 없으면 끝점 맞닿음(5mm)으로 연결을 추정하고, ifc4Mep 포트를 정답지로 정밀도·재현율을 잰다
- `src/lib/topology.test.ts`: 맞닿은 두 토막을 방향 없는 형상 연결로 잇는다 · 오차 밖이면 잇지 않는다 · 다른 계통끼리는 잇지 않는다

## 메모

- 연결의 출처는 `Connection.source` 다(`port` · `geometry` · `manual`). 설비 패널의 이웃 목록이 "포트 · BIM", "형상 추정 · 계산", "직접 이음 · 편집" 으로 가르고, 등급 칩 연결망 설명에 포트·형상 추정 수를 따로 적는다.
- 형상 추정 허용오차는 5mm(`topology.ts` 의 `TOLERANCE`)다. 계통이 다르면 잇지 않고, **한쪽이라도 계통을 모르면 거르지 않는다**
  (`topology.test.ts` "계통을 모르는 요소는 거르지 않는다"). 요구사항의 "계통 이름이 같으면" 보다 넓다 — 계통을 모르는 쪽을 막으면
  계통 그룹에 들지 않은 요소가 형상으로 이어질 길이 없어진다. 좁힐지는 계통 없는 요소 비율을 재고 정할 예정이다.
