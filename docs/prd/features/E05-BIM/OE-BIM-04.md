---
id: "OE-BIM-04"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "벽 생성"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R4"]
---

# OE-BIM-04 벽 생성

## 요구사항

IfcWall 을 벽으로 만든다. 평면 외곽선(두께 포함)과 위치를 읽는다. 슬래브는 읽지 않는다 — DT 3D Map 은 물리존 판과 벽으로 그린다(S7).

## 수용 기준

벽마다 위치·두께가 GeoJSON 으로 나간다.

## 검증 (이 repo)

- `scripts/check-sample.test.ts` "벽이 위치·두께를 가진 GeoJSON 으로 나간다": AC20 13/13 · Duplex 건축 57/57 · 병원 건축 1,080/1,080 벽이 GeoJSON 벽 feature 에 외곽선(Polygon)과 두께(> 0)를 갖는다
- `src/lib/ifc/import.test.ts` "벽 두께 (F4)": 재료층 두께를 합해서 읽고, 재료 구성이 없으면 null
- `src/lib/export/export.test.ts` "벽·문·창은 GeoJSON 에만 나가고…": 벽 feature 의 `thickness`·`passable`·`external`

## 메모

- 외곽선은 형상의 맨 아래 면(`ifc/element-geometry.ts`), 두께는 재료층 합이다(`ifc/import.ts`). 재료 구성이 없으면 두께는 모름(null)이다.
- 슬래브(IfcSlab)는 읽지 않는다. 3D 와 GeoJSON 의 바닥은 물리존 외곽선 판이다.
