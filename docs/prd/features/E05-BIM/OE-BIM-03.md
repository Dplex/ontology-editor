---
id: "OE-BIM-03"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "물리존·룸 생성"
prd: "#6"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: ["R2","R3"]
jira: ""
---

# OE-BIM-03 물리존·룸 생성

## 요구사항

IfcSpace(Room·Space 모두) → 물리존(이름·면적·용도). 외곽선은 FootPrint 또는 Body/SweptSolid 표현에서 읽음
반자 높이(h_c)의 BIM 근거를 읽는다(설치면 판정 OE-EQP-03 이 쓴다): 반자 높이 속성(FinishCeilingHeight 등), 방 높이(Unbounded Height·방 형상의 압출 깊이), 천장 부재(IfcCovering CEILING)의 높이. 설비 판본(MEP Space)의 방 높이는 층고와 같아 반자로 쓰지 않으므로 건축 판본의 값만 반자 근거로 둔다. 건축과 설비를 합칠 때 같은 방은 건축 판본의 값을 쓴다.

## 수용 기준

Brep·SurfaceModel은 "외곽선 없음"으로 표시
방 높이·반자 높이가 BIM 에 없는 물리존은 값을 지어내지 않고 "모름"으로 둔다

## 검증 (이 repo)

—

## 메모

—
