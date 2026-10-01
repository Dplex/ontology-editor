---
id: "OE-PIP-07"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 규칙 재계산"
prd: "#14"
release: "R1.5"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: []
jira: ""
---

# OE-PIP-07 14-A 규칙 재계산

## 요구사항

잇기·끊기·계통 변경·종류 변경 시 규칙 방향 재계산. 확정한 규칙 방향은 연결마다 저장(`confirmedFlows`)해 재계산에 덮이지 않음

## 수용 기준

퍼징 통과

## 검증 (이 repo)

- 확정 뒤 계통의 종류를 바꿔도 확정한 방향은 뒤집히지 않는다(연결마다 방향을 적는다). 저장·불러오기 뒤에도 같다 — `edit.test.ts` "사람이 정한 방향과 확정한 계통은 종류를 바꿔도 남는다", `edit-file.test.ts`, 성수 O-5

## 메모

—
