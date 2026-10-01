---
id: "OE-HIST-04"
epic: "E19"
epic_title: "편집 이력 · 편집 파일"
title: "브라우저 자동 저장"
prd: "#26"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: []
jira: ""
---

# OE-HIST-04 브라우저 자동 저장

## 요구사항

같은 내용을 브라우저에 자동 저장, 같은 IFC를 다시 열면 이어서 작업할지 묻는다. 연 직후에는 기록을 지우지 않음

## 수용 기준

—

## 검증 (이 repo)

- 편집이 브라우저에 자동 저장되고, 같은 IFC(합친 조합까지 같을 때)를 다시 열면 이어서 할지 묻는다. 연 직후 편집 0 인 상태로는 기록을 지우지 않는다 — `e2e/autosave.spec.ts`, 성수 K-3~K-6
- 편집이 남아 있으면 다른 파일을 열거나 탭을 닫기 전에 묻는다 — `e2e/edit-safety.spec.ts`

## 메모

—
