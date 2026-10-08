---
id: "OE-EXT-01"
epic: "E17"
epic_title: "외벽"
title: "외벽 판정"
prd: "#23"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: []
---

# OE-EXT-01 외벽 판정

## 요구사항

### User story

구축 담당자가 Revit과 ArchiCAD에서 나온 BIM을 각각 임포트한다. Revit 파일은 Pset_WallCommon.IsExternal로 외벽이 바로 판정되고, 속성이 없는 ArchiCAD 파일은 건물 외곽선에 접한 벽을 외벽으로 추정해 출처 '계산'으로 표시한다. 둘 다 안 되면 '모름'으로 남아 담당자가 확인하도록 한다. 출처가 구분되어 있어 외벽 에디터에서 형상을 손대기 전에 추정된 외벽만 골라 검토할 수 있고, 외벽 여부에 따라 달라지는 로봇 통과 속성과 외벽 설비 분류가 정확해진다.

벽의 외벽 여부는 `Pset_WallCommon.IsExternal` 로 읽는다. 속성이 없으면(ArchiCAD 등) 건물 외곽선에 접한 벽을 외벽으로 판정하고 출처를 '계산' 으로 둔다. 둘 다 안 되면 '모름'으로 표시한다(glossary "외벽"). 이 속성이 BIM 수용 기준선(R)에 드는지는 확인이 필요하다.

## 수용 기준

IsExternal 이 있는 파일은 그 값으로, 없는 파일은 외곽선 접촉으로 외벽이 표시되고 출처가 구분된다.

## 검증 (이 repo)

—

## 메모

—
