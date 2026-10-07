---
id: "OE-BIM-03"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "물리존·룸 생성"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R2","R3","D15","Q7"]
---

# OE-BIM-03 물리존·룸 생성

## 요구사항

IfcSpace(Room·Space 모두)를 물리존으로 만든다(D15). 방번호(Name)·공간명(LongName)·면적·용도를 읽고, 외곽선은 FootPrint 또는 Body/SweptSolid 표현에서 읽는다. Brep·SurfaceModel 만 있는 방은 "외곽선 없음" 으로 둔다(OE-MAN-03 으로 그린다).
반자 높이(h_c)의 BIM 근거를 읽는다 — 반자 높이 속성(FinishCeilingHeight 등), 방 높이(Unbounded Height·방 형상의 압출 깊이), 천장 부재(IfcCovering CEILING)의 높이. 설비 판본(MEP Space)의 방 높이는 층고와 같아 반자로 쓰지 않으므로 건축 판본의 값만 둔다. 건축과 설비를 합칠 때 같은 방은 건축 판본의 값을 쓴다. 설정 단위는 층이고, 물리존에서 덮어쓸 수 있다(Q7).

## 수용 기준

- Brep·SurfaceModel 만 있는 방이 "외곽선 없음" 으로 표시된다.
- 방 높이·반자 높이가 BIM 에 없는 물리존은 값이 비어 '모름' 으로 표시된다.

## 검증 (이 repo)

—

## 메모

—
