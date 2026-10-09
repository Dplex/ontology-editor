---
id: "OE-UI-13"
epic: "E03"
epic_title: "진입점 · 화면 구성 · 편집 도구"
title: "출처 표시"
prd: "#4"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-INT-07"]
---

# OE-UI-13 출처 표시

## 관련 티켓

- [OE-INT-07](../E20-INT/OE-INT-07.md): TTL 출처 술어 여부

## 요구사항

레이어 패널과 표의 값마다 출처를 표시한다 — BIM · 계산 · 사전 · 사람 · 외부(glossary "출처"). 사용자가 고친 값은 '사람' 이다. 출처 없는 값은 두지 않는다. 출처 표시 체계는 OE-INT-07(TTL 술어 여부)과 무관하게 화면에서는 항상 보인다.

## 수용 기준

패널의 모든 값 옆에 출처가 보이고, 사용자가 값을 고치면 출처가 '사람' 으로 바뀐다.

## 검증 (이 repo)

- 화면의 값마다 출처(BIM·계산·사전·편집)가 붙는다. 편집한 값은 "편집" 이다 — 성수 E-11·F-10·H-2, `components/Src.vue`

## 메모

—
