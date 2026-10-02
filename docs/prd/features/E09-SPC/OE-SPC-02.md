---
id: "OE-SPC-02"
epic: "E09"
epic_title: "공간 편집"
title: "물리존 생성·분할·병합·삭제 (E3)"
prd: "#9 #10"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: ["OE-MAP-01"]
jira: ""
---

# OE-SPC-02 물리존 생성·분할·병합·삭제 (E3)

## 요구사항

각 동작은 설비 소속 변경·공조존 매핑 갱신을 유발 → 자동 재매핑. 없어진 방을 가리키던 BIM 소속은 버리고 좌표로 재판정

## 수용 기준

분할 후 설비 소속 재계산

## 검증 (이 repo)

- 만든 물리존의 id 는 `U_` 로 시작하고 `$` 가 없다. 안의 설비가 새 방으로 간다. 겹친 자리의 설비는 가장 작은 방에 둔다 — `edit.test.ts` "물리존 생성·삭제·분할·병합 (E3)", 성수 F-9·F-10
- 나누면 넓은 조각이 원래 id·이름을 갖고, 새 조각의 설비는 BIM 소속을 버리고 좌표로 다시 찾는다. 셋 이상으로 잘리는 선은 이유와 함께 거절한다 — 같은 describe, `e2e/edit-structure.spec.ts` "물리존을 그리면", 성수 F-11·F-12
- 합치면 사이 벽 자리까지 들어가고, 두 방 사이 문은 남는 방 하나만 잇는다. 일부만 겹친 방은 거절한다 — 같은 describe "나눈 것을 다시 합치면", 성수 F-13·F-14
- 합친 방은 편집 파일에 `into` 로 남고, 불러올 때 합치기를 다시 계산하지 않는다(합친 뒤 고친 외곽선이 덮이지 않는다) — `edit-file.test.ts`, `edit-fuzz.test.ts`

## 메모

—
