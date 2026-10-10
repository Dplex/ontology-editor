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
depends: ["R16", "R17", "K3", "U1"]
---

# OE-BIM-09 계통·포트 읽기

## 요구사항
> User story : 구축 담당자가 BIM을 임포트하면 계통과 설비 사이의 연결(포트)이 읽히고, 포트에 흐름 방향이 있으면 함께 읽힌다. IFC 두 버전 모두에서 연결이 읽힌다. 포트가 없는 파일은 배관 세그먼트 끝점이 거의 닿아 있고 계통 이름이 같으면 연결로 추정하되 출처를 '형상'으로 구분한다. 사용자는 포트에서 읽은 확실한 연결과 형상에서 추정한 연결을 나눠 볼 수 있어, 추정 연결만 검토하고 규칙 방향을 확정할 때 신뢰도를 판단할 수 있어야 한다.

IfcSystem(또는 Revit System Name)을 계통으로 읽는다(R16). 포트는 IFC4 의 IfcRelNests, IFC2x3 의 IfcRelConnectsPortToElement 와 IfcRelConnectsPorts 로 읽고 FlowDirection 도 읽는다(R17).
포트가 없을 때는 세그먼트 끝점이 5mm 안에서 닿고 계통 이름이 같으면 연결로 본다(K3, 출처 geometry). IFC4 Reference View 에 공간 경계·계통·포트가 드는지는 U1.

## 수용 기준

- IFC2x3 와 IFC4 파일 모두에서 연결 수가 0 보다 크다.
- 포트에서 읽은 연결과 형상에서 추정한 연결의 출처가 구분된다.

## 검증 (이 repo)

—

## 메모

—
