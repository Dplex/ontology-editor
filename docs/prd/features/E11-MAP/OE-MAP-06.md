---
id: "OE-MAP-06"
epic: "E11"
epic_title: "설비-물리존 재매핑 · 공조존 매핑"
title: "재계산 트리거"
prd: "#12"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: []
jira: ""
---

# OE-MAP-06 재계산 트리거

## 요구사항

편집·파일 합치기·재임포트마다 소속·규칙 방향을 편집 함수 안에서 재계산(호출부에 맡기지 않음)

## 수용 기준

좌표와 소속이 어긋난 상태 없음

## 검증 (이 repo)

- 어느 편집이든 끝나면 소속·규칙 방향·면적·문이 잇는 방이 다시 계산되어 있다. 호출부가 따로 부를 것이 없다 — `edit.test.ts` "바뀐 것만 다시 판정한다", "좌표를 바꾸면 소속 판정이 함께 돈다"

## 메모

—
