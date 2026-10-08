---
id: "OE-OBJ-12"
epic: "E02"
epic_title: "편집 오브젝트 정의 및 분류"
title: "배관 오브젝트"
prd: "#3"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-PIP-10","OE-PIP-11","OE-PIP-12","OE-PIP-13"]
---

# OE-OBJ-12 배관 오브젝트

## 요구사항

배관은 설비 사이의 냉온수·냉매·공기(덕트) 경로이며 점(x·y·z) 폴리라인이다(glossary "배관"). 배관마다 Flow Type 을 하나 가진다 — SA·RA·EA·OA·CHWS·CHWR·HWS·HWR·CWS·CWR·REF, 그리고 급탕 DHWS·DHWR · 급수 DCW · 소화 FP · 스팀 STM·CR · 지열수 GWS·GWR(glossary "Flow Type").
배관은 Flow Type 에 따라 정해진 색으로 그린다(OE-ML-15 와 같은 체계).
배관은 점을 차례로 찍어 수동으로 그린다(OE-PIP-11). 양 끝은 설비 또는 다른 배관에 연결되어야 하며, 수정 뒤에도 끊긴 끝이 남으면 안 된다.
연결된 설비가 움직이면 배관 끝점이 따라와 길이·높이가 바뀐다(OE-PIP-12). 좌표가 없는 배관은 반영하지 않는다(OE-PIP-13).

## 수용 기준

- Flow Type 범례에 없는 값으로 배관을 만들 수 없다.
- 양 끝이 설비나 다른 배관에 연결되지 않은 배관은 생성 전 검증(OE-GEN-03)에서 위반으로 나온다.
- 설비를 옮기면 연결 배관의 끝점 좌표가 설비를 따라간다.

## 검증 (이 repo)

—

## 메모

—
