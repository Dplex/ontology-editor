---
id: "OE-EQP-09"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "AHU·PAC 디테일"
prd: "#13"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: []
---

# OE-EQP-09 AHU·PAC 디테일

## 요구사항

공조기(AHU)와 패키지 에어컨(PAC)은 바닥 전용 설비다(glossary "설치면 type" 14·21). 둘 다 정격 풍량을 속성으로 가지며 용량 검증 Z-03 의 입력이다(OE-ZON-05).
AHU 는 방 종류가 기계실인 물리존(OE-SPC-17) 밖으로 옮기지 못한다. PAC 는 실내 배치가 보통이므로 이 제약을 두지 않는다.
둘 다 옮긴 뒤 담당 공조존을 다시 지정해야 하며, 지정 전에는 Z-04 경고 대상이다.

## 수용 기준

- AHU 를 기계실 밖으로 끄는 시도는 차단되고 설비는 원래 자리에 남는다. PAC 는 차단되지 않는다.
- 이동 후 담당 공조존이 비어 있으면 Z-04 경고가 보인다.

## 검증 (이 repo)

—

## 메모

—
