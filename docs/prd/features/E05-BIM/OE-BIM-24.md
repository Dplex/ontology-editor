---
id: "OE-BIM-24"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "출처 구분·재임포트"
prd: "#6"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: ["R13","OE-HIST-03"]
---

# OE-BIM-24 출처 구분·재임포트

## 요구사항

BIM 생성분 / 사용자 수정분 구분. 재임포트 시 BIM 생성분만 덮어쓰고 편집분 유지 — GUID 전제, **GUID가 바뀐 판본은 식별 정보(Revit 요소 ID·이름·위치)로 재적용**

## 수용 기준

Duplex 재내보내기 판본(GUID 63% 변경)에서 편집 보존

## 검증 (이 repo)

- 편집 파일은 id 마다 지문(Revit 요소 ID·이름·위치)을 적어, GUID 가 바뀐 판본에도 얹는다. 한 열쇠에 둘 이상이 걸리면 짓지 않는다 — `versions.test.ts`, `check:sample`, 성수 K-9·N-9

## 메모

—
