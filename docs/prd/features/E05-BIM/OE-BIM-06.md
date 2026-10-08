---
id: "OE-BIM-06"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "내력벽 속성"
prd: "#6"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R22", "OE-OBJ-06"]
---

# OE-BIM-06 내력벽 속성

## 관련 티켓

- [OE-OBJ-06](../E02-OBJ/OE-OBJ-06.md): 내력벽 편집 규칙

## 요구사항

Pset_WallCommon.LoadBearing(Revit 의 Structural)을 읽어 벽의 loadBearing 으로 둔다(R22). 값이 없으면 "모름" 이다. "모름" 과 "아니오" 를 섞지 않는다. 편집 규칙은 OE-OBJ-06.

## 수용 기준

LoadBearing 이 없는 벽이 "모름" 으로, false 인 벽이 "아니오" 로 구분되어 표시된다.

## 검증 (이 repo)

- 두 점으로 벽을 그으면 두께 0.2m 외곽선이고 내력 여부는 "모름" 이다. 모름과 아니오를 섞지 않는다 — `edit.test.ts` "벽·문·창 편집 (E4)", 성수 N-3·N-4

## 메모

—
