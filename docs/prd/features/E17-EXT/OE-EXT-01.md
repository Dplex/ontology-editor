---
id: "OE-EXT-01"
epic: "E17"
epic_title: "외벽"
title: "외벽 판정"
prd: "#23"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-EXT-01 외벽 판정

## 요구사항

벽의 외벽 여부는 `Pset_WallCommon.IsExternal` 로 읽는다. 속성이 없으면(ArchiCAD 등) 건물 외곽선에 접한 벽을 외벽으로 판정하고 출처를 '계산' 으로 둔다. 둘 다 안 되면 '모름' 이다(glossary "외벽"). 이 속성이 BIM 수용 기준선(R)에 드는지는 확인이 필요하다.

## 수용 기준

IsExternal 이 있는 파일은 그 값으로, 없는 파일은 외곽선 접촉으로 외벽이 표시되고 출처가 구분된다.

## 검증 (이 repo)

—

## 메모

—
