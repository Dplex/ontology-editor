---
id: "OE-EQP-14"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "종류 지정"
prd: "#13"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["OE-BIM-14"]
jira: ""
---

# OE-EQP-14 종류 지정

## 요구사항

종류 미상 설비를 패밀리 단위로 한꺼번에 지정. 후보(이름 낱말·같은 건물의 계통·이웃·높이가 닮은 패밀리) 제안, 사람이 확정. 출처 표시

## 수용 기준

후보 3개 안 정답률 69~85%

## 검증 (이 repo)

- 종류는 패밀리 단위로 정하고 같은 패밀리 설비 전체에 붙는다. 유형 이름만 같은 다른 패밀리는 묶지 않는다 — `edit.test.ts` "타입 단위 종류 지정", 성수 H-2
- 후보(이름 낱말·닮은 패밀리)는 보이기만 하고 누르기 전에는 아무것도 정하지 않는다. 사전 값으로 되돌리면 편집이 아니다 — `kind-suggest.test.ts`, `edit.test.ts` "사전 값으로 되돌리면", 성수 H-1·H-4
- 종류가 바뀌면 규칙 방향이 다시 돌고, 포트와 새로 어긋나기 시작한 계통을 바로 알린다 — `edit.test.ts` "종류를 바꿔 규칙이 포트와 어긋나기 시작한 계통", `e2e/edit-3d.spec.ts`, 성수 H-3

## 메모

—
