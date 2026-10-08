---
id: "OE-BIM-07"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "설비 생성"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R9", "R11", "OE-BIM-14", "OE-BIM-12", "K6", "OE-EQP-02"]
---

# OE-BIM-07 설비 생성

## 관련 티켓

- [OE-BIM-14](./OE-BIM-14.md): 설비 종류 판정
- [OE-BIM-12](./OE-BIM-12.md): 배치점 보정
- [OE-EQP-02](../E12-EQP/OE-EQP-02.md): 좌표 없는 설비 미배치 목록

## 요구사항

### User story

구축 담당자가 건축 BIM과 MEP 파일을 함께 열면 IfcDistributionElement 하위 요소가 종류·좌표·용량을 가진 설비로 만들어져 레이아웃과 설비 배치가 한 번에 구성된다. 종류는 이름 사전으로 판정되고 배치점이 형상과 어긋나면 보정된다. 좌표 없는 설비는 0,0,0에 뭉치지 않고 미배치 목록에 들어가 3D에 그려지지 않으므로, 담당자가 원점에 쌓인 설비 더미를 정리하는 대신 목록에서 하나씩 제자리에 놓는다.

IfcDistributionElement 하위 요소를 설비로 만든다. 종류·위치(x·y·z)·용량을 읽는다(R9·R11). 종류 판정은 OE-BIM-14, 배치점 보정은 OE-BIM-12 를 따른다.
MEP 파일을 함께 열면 레이아웃과 설비 배치가 한 번에 만들어진다. 좌표가 없는 설비는 0,0,0 으로 두지 않고 미배치 목록에 둔다(K6, OE-EQP-02).

## 수용 기준

좌표 없는 설비가 미배치 목록에 보이고 3D 에는 그려지지 않는다.

## 검증 (이 repo)

—

## 메모

—
