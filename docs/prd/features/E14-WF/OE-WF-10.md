---
id: "OE-WF-10"
epic: "E14"
epic_title: "편집 워크플로우"
title: "반영하기"
prd: "#15 #16 #17 #18 #19"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-SYNC-02", "OE-WF-13", "OE-WF-15", "OE-WF-16", "OE-INT-01", "D-INT"]
---

# OE-WF-10 반영하기

## 관련 티켓

- [OE-SYNC-02](../E15-SYNC/OE-SYNC-02.md): DT·온톨로지 부분 반영 금지
- [OE-WF-13](./OE-WF-13.md): 반영 후 새 버전 생성
- [OE-WF-15](./OE-WF-15.md): 반영 완료 배너
- [OE-WF-16](./OE-WF-16.md): 반영 GNB 알림
- [OE-INT-01](../E20-INT/OE-INT-01.md): 반영 경로 결정

## 요구사항

[반영하기] 는 편집 내용을 DT 3D 맵과 온톨로지에 한 번에 반영한다. 둘 중 하나만 반영된 상태를 만들지 않는다 — 온톨로지 반영이 실패하면 DT 반영도 전체 실패로 처리하고 반영 전 상태로 되돌린다(OE-SYNC-02, KPI_1).
반영이 끝나면 새 버전을 만들고(OE-WF-13) 배너·알림을 보낸다(OE-WF-15·16). 처리 시간 목표는 10분 이내다(KPI_3). 반영 경로는 D-INT.

## 수용 기준

- 온톨로지 반영 실패 시 DT 3D 맵이 반영 전과 같다.
- 반영 성공 시 버전 히스토리에 새 버전이 1개 생긴다.

## 검증 (이 repo)

—

## 메모

—
