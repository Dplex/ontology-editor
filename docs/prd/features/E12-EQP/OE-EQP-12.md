---
id: "OE-EQP-12"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "이동 후 소속 자동 판정"
prd: "#13"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: ["OE-MAP-01"]
---

# OE-EQP-12 이동 후 소속 자동 판정

## 요구사항

설비·배관의 소속 물리존은 이동 후 좌표로 자동 판정

## 수용 기준

—

## 검증 (이 repo)

- 옮기면 소속이 좌표로 다시 정해진다. BIM 이 소속을 말한 설비도 사람이 옮기면 좌표를 따른다. 방 밖이면 소속 없음이고 TTL 에는 층이 `hasLocation` 으로 남는다 — `edit.test.ts` "설비 이동 (E5)", 성수 E-1·E-10
- 층을 옮기면 높이도 두 층 바닥 차만큼 옮기고 소속이 다시 정해진다. 좌표 없는 설비는 층을 옮겨도 좌표가 생기지 않는다 — `edit.test.ts` "층 이동", `e2e/edit-3d.spec.ts` "층을 바꾸면", 성수 E-7
- 좌표 없는 설비는 세 축을 다 넣어야 좌표가 된다. 한 축만 넣으면 좌표가 생기지 않는다(0 으로 채우지 않는다) — `edit.test.ts` "좌표 초안", 성수 E-8

## 메모

—
