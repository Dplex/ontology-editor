---
id: "OE-BIM-24"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "출처 구분·재임포트"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R13","OE-HIST-03"]
---

# OE-BIM-24 출처 구분·재임포트

## 요구사항

BIM 생성분 / 사용자 수정분을 출처로 구분해 표시한다. 재임포트 시 편집분 보존은 OE-HIST-03 을 따른다.

## 수용 기준

OE-HIST-03 의 수용 기준을 따른다.

## 검증 (이 repo)

- 편집 파일은 id 마다 지문(Revit 요소 ID·이름·위치)을 적어, GUID 가 바뀐 판본에도 얹는다. 한 열쇠에 둘 이상이 걸리면 짓지 않는다 — `versions.test.ts`, `check:sample`, 성수 K-9·N-9

## 메모

—
