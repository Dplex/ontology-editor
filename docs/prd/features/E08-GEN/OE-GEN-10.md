---
id: "OE-GEN-10"
epic: "E08"
epic_title: "온톨로지 생성 · 내보내기 · 리포트"
title: "DT 파서 호환"
prd: "#8"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-INT-08"]
---

# OE-GEN-10 DT 파서 호환

## 관련 티켓

- [OE-INT-08](../E20-INT/OE-INT-08.md): ttl.go 파서 호환 규칙

## 요구사항

TTL 은 DT 파서(ieum-pipeline `ttl.go`)가 읽는 범위 안에서 쓴다 — `ex:X a 클래스` 블록 구조, `$`·`"` 이스케이프, fso 비엔티티는 하류 기기를 직접 기술. 규칙은 OE-INT-08. 매 빌드마다 실제 파서로 읽어 확인한다.

## 수용 기준

`check:sample` 이 통과한다.

## 검증 (이 repo)

—

## 메모

—
