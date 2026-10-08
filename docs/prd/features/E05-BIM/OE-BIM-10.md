---
id: "OE-BIM-10"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "건축+MEP 합치기"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["K7", "K8", "OE-BIM-22", "R1", "R3", "R12"]
---

# OE-BIM-10 건축+MEP 합치기

## 관련 티켓

- [OE-BIM-22](./OE-BIM-22.md): 좌표계 정합 판정 경고

## 요구사항

건축 파일과 MEP 파일을 합친다. 층은 GUID 가 아니라 Level 이름(+높이)으로(K7), 방은 방번호와 좌표계로 맞춘다. 같은 자리의 방은 하나만 남기고(MEP Space 사본 제거), 외곽선 없는 방은 다른 판본에서 빌린다(K8).
설비가 건축 공간 범위에 드는 비율로 좌표계 정합을 판정하고, 낮으면 경고한다(OE-BIM-22).

## 수용 기준

Duplex 건축+HVAC 에서 기기 40대 전부가 물리존에 소속된다.

## 검증 (이 repo)

—

## 메모

—
