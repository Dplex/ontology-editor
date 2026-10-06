---
id: "OE-PIP-02"
epic: "E13"
epic_title: "배관 · 계통 에디터"
title: "14-A 계통 변경·생성·삭제"
prd: "#14"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-PIP-02 14-A 계통 변경·생성·삭제

## 요구사항

설비의 계통 한 자리 변경(공기·물 모두 가진 설비는 다른 자리 유지). 계통 생성·삭제. 사람이 만든 계통의 종류·유체는 원천 짐작이 덮지 않음

## 수용 기준

—

## 검증 (이 repo)

- 설비의 계통을 바꾸면 3D 색·리포트·규칙 방향이 같이 바뀐다. 공기·물에 다 든 설비의 다른 자리는 둔다. 되돌리면 원래 계통의 같은 자리로 간다 — `e2e/edit-system.spec.ts`, 성수 O-1·O-2
- 계통을 만들고 지운다. 지우면 구성원이 계통 없음이 되고 되돌리면 색까지 돌아온다 — `e2e/edit-system.spec.ts` "새 계통을 만들어", 성수 O-5a·O-5b
- 저장·불러오기 뒤 TTL 이 같다. 계통 구성원 순서만 다를 수 있다 — `edit-fuzz.test.ts`(순서 빼고 견줌), 성수 O-6

## 메모

—
