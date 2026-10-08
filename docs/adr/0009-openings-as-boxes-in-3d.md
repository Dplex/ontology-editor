---
id: "ADR-0009"
title: "3D export(GLB·OBJ)의 문·창은 위치·크기·벽 방향으로 만든 박스로 export 한다 — 임포터는 문·창 형상을 계속 버린다"
status: "제안"
date: "2026-10-03"
prd: ["1.7"]
tickets: ["OE-INT-09", "OE-INT-03"]
supersedes: []
superseded_by: ""
---

# ADR-0009 3D export(GLB·OBJ)의 문·창은 위치·크기·벽 방향으로 만든 박스로 export 한다 — 임포터는 문·창 형상을 계속 버린다

## 맥락

PRD 부록 C S7 은 "DT(Unity)가 물리존 판·벽·문·창·설비를 그릴 수 있는 형상 출력" 이다. `mesh3d.ts` 는 문·창 형상이 있으면 넣도록 작성돼
있었지만, **임포터가 문·창 형상에서 위치(`Opening.position`·`through`·`depth`)만 읽고 버려서**(`import.ts` 의 `placeWallsAndOpenings`,
"3D 에 그리지 않으니 메모리에 둘 까닭이 없다") GLB·OBJ 에 문·창이 한 번도 들어가지 않았다. Duplex 건축(문 14·창 24)을 문·창 읽기를 켜고
export 해도 3D 객체는 벽 57·물리존 21·설비뿐이었다.

방법은 두 가지였다.

1. 임포터가 문·창 형상을 `meshes` 에 남긴다 — BIM 형상 그대로라 정확하다. 대신 성수 건축 문·창 591개 형상이 메모리에 남고, 앱이
   `meshes` 전체를 순회하는 곳(연결망 검사의 형상 박스 `meshBoxes`)에 문·창이 섞인다. 사람이 추가한 문은 여전히 형상이 없다
2. export 할 때 문·창의 위치·크기·벽을 뚫는 방향으로 박스를 만든다 — export 코드만 바뀐다. 사람이 옮기거나 추가한 문도 현재 위치로 export 된다.
   문틀·창살 모양은 없다

## 결정

2 를 골랐다. `mesh3d.ts` 의 `openingBox`: 가로 = 너비(벽 방향), 높이 = 높이, 두께 = 형상에서 읽은 `depth`(벽을 뚫는 방향 `through`),
바닥 = 위치 높이. 크기를 모르면 문 0.9×2.1m·창 1.0×1.0m 로 만들고 extras 에 `placeholder` 를 붙인다(설비의 0.4m 박스와 같다). 두께를
모르면(사람이 추가한 문·창) 0.2m. 위치를 모르면 넣지 않는다. 문·창 형상이 `meshes` 에 있으면(지금은 없다) 그것을 먼저 쓴다.

`read-3d.ts` 의 `check3D` 가 문·창도 확인한다(형상 있는 문·창 feature 마다 같은 id 의 3D 객체가 있고 위치가 그 안인지).

## 결과

- Duplex 건축+MEP: 3D 에 문 14·창 24 가 GeoJSON 과 같은 id 로 들어간다(check:sample "요구조건 S"). 문·창 읽기를 끄면(기본값) 위치 정보가 없어
  3D 에도 없다 — S7 을 충족하려면 export 할 때 문·창 읽기를 켜야 한다
- DT 가 BIM 그대로의 문·창 모양이 필요하면 1 로 바꾼다. 그때 `meshBoxes` 가 설비만 보도록 고친다
- 되돌리려면: `mesh3d.ts` 문·창 루프의 `else if (o.position)` 분기와 `openingBox` 를 지우고, `read-3d.ts` 의 `IN_3D` 에서 door·window 를 뺀다
