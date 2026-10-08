---
id: "OE-SYNC-02"
epic: "E15"
epic_title: "온톨로지 Sync · 반영 결과 리포트"
title: "부분 반영 금지"
prd: "#20 #21"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-INT-01","D-INT"]
---

# OE-SYNC-02 부분 반영 금지

## 요구사항

온톨로지 반영이 실패하면 DT 레이아웃 반영도 전체 실패로 처리한다. 둘은 한 트랜잭션으로 묶거나, 분리된 저장소면 실패 시 DT 반영을 되돌린다. 부분 반영 상태를 남기지 않는다(OE-WF-10). 구현 방식은 D-INT 에 따른다.

## 수용 기준

온톨로지 쓰기를 강제로 실패시키면 DT 3D 맵이 반영 전과 같다.

## 검증 (이 repo)

—

## 메모

—
