---
id: "OE-UI-05"
epic: "E03"
epic_title: "진입점 · 화면 구성 · 편집 도구"
title: "되돌리기 / 다시 실행"
prd: "#4"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "undo ✔ redo ✔"
blocked_by: []
depends: ["OE-WF-19"]
---

# OE-UI-05 되돌리기 / 다시 실행

## 관련 티켓

- [OE-WF-19](../E14-WF/OE-WF-19.md): 구별할 이전 버전 되돌리기

## 요구사항

편집 화면에서 되돌리기(Ctrl+Z, 한 단계씩)와 다시 하기(Ctrl+Shift+Z·버튼)를 제공한다. 어느 편집이든 되돌리기 대상이며, 편집 종류가 늘면 같이 들어간다. 탭(편집 세션) 안의 이력이고, #19 의 "이전 버전으로 되돌리기"(OE-WF-19)와 다르다.

## 수용 기준

- Ctrl+Z 한 번에 직전 편집 하나가 되돌아간다.
- Ctrl+Shift+Z 또는 버튼으로 되돌린 편집을 다시 할 수 있다.
- 글자 칸에 입력 중일 때 Ctrl+Z 는 편집 이력에 영향을 주지 않는다.

## 검증 (이 repo)

- Ctrl+Z 한 단계, Ctrl+Shift+Z 와 버튼으로 다시 하기, 새 편집이 다시 할 것을 비운다 — `e2e/shortcuts.spec.ts` "방향키는 고른 설비를"
- 글자 칸에 치는 동안 글자가 덮이지 않고, 글자 칸의 Ctrl+Z 는 편집 이력을 되돌리지 않는다 — `e2e/edit-3d.spec.ts` "글자를 치는 칸의 Ctrl+Z", 성수 E-12·F-1·I-4
- 단축키는 한글 입력 상태에서도 먹고, `?` 안내에 전부 나온다 — `shortcuts.test.ts`, `e2e/shortcuts.spec.ts`, 성수 I-5·I-6

## 메모

—
