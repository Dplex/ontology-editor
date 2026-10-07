---
id: "OE-ZON-06"
epic: "E10"
epic_title: "공조 조닝"
title: "용량 계산 계수 설정"
prd: "#11"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-ZON-06 용량 계산 계수 설정

## 요구사항

Z-03 용량 계산에 쓰는 계수는 사이트 설정이다 — 실 높이(반자 h_c 기준, 기본 2.7m), 환기 횟수(기본 6회/h), 설비 정격 풍량(기본 AHU 6,000 · PAC 2,500 · DVM 실내기 900 CMH).
이 값은 용량 검증에만 쓰는 계수이며 설치면 판정의 h_c(OE-EQP-03)와는 별개다. 설비에 정격이 있으면 설비 값을 우선한다.

## 수용 기준

사이트 설정에서 계수를 바꾸면 Z-03 판정 결과가 바뀐다.

## 검증 (이 repo)

—

## 메모

—
