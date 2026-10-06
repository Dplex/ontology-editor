---
id: "OE-UI-14"
epic: "E03"
epic_title: "진입점 · 화면 구성 · 편집 도구"
title: "3D 자유 카메라"
prd: "#4"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-UI-14 3D 자유 카메라

## 요구사항

자유 회전·확대·이동. 성수 규모(정점 1,016만)에서 회전 60fps, 열 때 최대 멈춤 ≤ 1초

## 수용 기준

GPU 측정 기준 통과

## 검증 (이 repo)

- 성수(건축+기계)에서 방향키 한 번이 0.5초 안이다(GPU 크롬). Ctrl+Z 시간은 아직 기준이 없고 재서 적기만 한다 — `npm run e2e:seongsu`(방향키 기준), `scripts/seongsu.test.ts`(되돌리기 시간 기록), 성수 E-3·I-1

## 메모

—
