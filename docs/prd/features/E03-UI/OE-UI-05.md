---
id: "OE-UI-05"
epic: "E03"
epic_title: "진입점 · 화면 구성 · 편집 도구"
title: "되돌리기 / 다시 실행"
prd: "#4"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-partial"
status_note: "undo ✔ redo ✗"
blocked_by: []
depends: ["OE-HIST-01","OE-HIST-02"]
jira: ""
---

# OE-UI-05 되돌리기 / 다시 실행

## 요구사항

undo / redo

## 수용 기준

Ctrl+Z 한 단계씩, redo 지원

## 검증 (이 repo)

- 글자 칸에 치는 동안 글자가 덮이지 않고, 글자 칸의 Ctrl+Z 는 편집 이력을 되돌리지 않는다 — `e2e/edit-3d.spec.ts` "글자를 치는 칸의 Ctrl+Z", 성수 E-12·F-1·I-4
- 단축키는 한글 입력 상태에서도 먹고, `?` 안내에 전부 나온다 — `shortcuts.test.ts`, `e2e/shortcuts.spec.ts`, 성수 I-5·I-6

## 메모

—
