---
id: "OE-SPC-04"
epic: "E09"
epic_title: "공간 편집"
title: "물리존 삭제 제약"
prd: "#9 #10"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
status_note: "귀속은 합치기 E3로"
blocked_by: []
depends: []
jira: ""
---

# OE-SPC-04 물리존 삭제 제약

## 요구사항

층당 최소 1개. 층 자체 삭제 불가. 삭제로 구멍이 생기지 않음 — 사라진 공간은 주변 물리존으로 자동 귀속

## 수용 기준

마지막 물리존 삭제 차단

## 검증 (이 repo)

- 지우면 안의 설비가 이웃 방이나 층으로 간다. 없어진 방을 가리키던 BIM 소속은 버린다. 층에 하나 남은 방은 지우지 않는다 — 같은 describe "지운 방의 BIM 소속은 버리고", 성수 F-15

## 메모

—
