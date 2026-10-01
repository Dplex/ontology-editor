---
id: "OE-SYNC-06"
epic: "E15"
epic_title: "온톨로지 Sync · 반영 결과 리포트"
title: "편집 리포트 규칙"
prd: "#20 #21"
release: "R1.5"
priority: "P1"
owner: "ontology-editor"
status: "poc-done"
blocked_by: []
depends: ["OE-HIST"]
jira: ""
---

# OE-SYNC-06 편집 리포트 규칙

## 요구사항

소속뿐 아니라 내보내는 파일을 바꾸는 모든 변경(이름·층·좌표)을 열었을 때 값과 비교해 기록. 같은 설비 여러 번 이동은 마지막만, 제자리 복귀는 제외

## 수용 기준

—

## 검증 (이 repo)

- 바뀐 내용 리포트는 내보내는 파일을 바꾸는 변경을 전부 적고, 제자리로 돌아온 것은 빼며, 같은 것을 여러 번 고치면 마지막만 남긴다 — `edit.test.ts` "결과 리포트 (PRD #21)", "연 때와 견주기", 성수 E-4·E-5·E-6

## 메모

—
