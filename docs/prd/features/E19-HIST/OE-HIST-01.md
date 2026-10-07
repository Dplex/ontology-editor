---
id: "OE-HIST-01"
epic: "E19"
epic_title: "편집 이력 · 편집 파일"
title: "탭 내 되돌리기"
prd: "#26"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-UI-05"]
---

# OE-HIST-01 탭 내 되돌리기

## 요구사항

OE-UI-05 를 따른다. (탭 안 되돌리기)

## 수용 기준

OE-UI-05 의 수용 기준을 따른다.

## 검증 (이 repo)

- 어느 편집이든 Ctrl+Z 한 번으로 그 편집 전과 같아진다. 끝까지 되돌리면 연 때와 같다 — `edit.test.ts` "되돌리기"·"다시 하기", `e2e/edit-3d.spec.ts` "Ctrl+Z 세 번이면 한 단계씩", 성수 I-1·I-2

## 메모

—
