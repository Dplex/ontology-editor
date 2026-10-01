---
id: "OE-UI-04"
epic: "E03"
epic_title: "진입점 · 화면 구성 · 편집 도구"
title: "화면 레이아웃"
prd: "#4"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-partial"
status_note: "3D·패널·도구 팔레트·액션바 ✔, 레이어 탭 ✗. 반영하기는 초기 구축의 구축하기(두 파일 내보내기)로 둔다"
blocked_by: []
depends: []
jira: ""
---

# OE-UI-04 화면 레이아웃

## 요구사항

좌 편집 도구 팔레트(모드별) / 중앙 3D(자유 회전·확대·이동) / 우 레이어 패널(물리존·커스텀존·공조존·설비·배관 탭 + 속성 + 편집 경고) / 상단 액션바(임시저장·미리보기·반영하기·편집 종료, 초기 구축에서는 구축하기)

## 수용 기준

—

## 검증 (이 repo)

- 편집 모드에서 왼쪽 아래 도구 팔레트(공간·설비·벽·문·창)가 뜨고, 액션바의 편집 종료가 보기 모드로 돌린다 — `e2e/conduit-follow.spec.ts`

## 메모

—
