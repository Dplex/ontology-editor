---
id: "OE-SPC-13"
epic: "E09"
epic_title: "공간 편집"
title: "문·창 추가·크기 조절"
prd: "#9 #10"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["OE-OBJ-07"]
jira: ""
---

# OE-SPC-13 문·창 추가·크기 조절

## 요구사항

가로 길이만. 문: 천장 막힘·바닥 뚫림. 창: 둘 다 막힘(디자인 고려). 문·방 경계가 바뀌면 문이 잇는 방을 다시 짚음(relinkDoors)

## 수용 기준

—

## 검증 (이 repo)

- 문·창은 벽 0.6m 안에만 놓이고, 양쪽 방을 좌표로 짚는다. 문·방 경계가 바뀌면 다시 짚는다 — 같은 describe, `e2e/edit-elements.spec.ts` "벽에서 먼 자리에는", 성수 N-5·N-6

## 메모

—
