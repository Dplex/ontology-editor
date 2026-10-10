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
> User story : 구축 담당자가 생성한 의미 정보 산출물이 DT의 파서가 읽는 범위를 벗어나면 등록 후 DT에서 데이터가 깨지거나 누락된다. 에디터는 DT 파서가 지원하는 구조와 표기 규칙을 지키고, 매 빌드마다 실제 파서로 샘플을 읽어 호환을 확인한다. 사용자는 생성한 산출물을 DT에 넣었을 때 파서 호환 문제로 되돌아와 재작업하는 일을 겪지 않아야 하며, 파서가 바뀌면 샘플 검사가 먼저 실패해 두 시스템의 호환이 깨지는 것을 배포 전에 알 수 있다.

TTL 은 DT 파서(ieum-pipeline `ttl.go`)가 읽는 범위 안에서 쓴다 — `ex:X a 클래스` 블록 구조, `$`·`"` 이스케이프, fso 비엔티티는 하류 기기를 직접 기술. 규칙은 OE-INT-08. 매 빌드마다 실제 파서로 읽어 확인한다.

## 수용 기준

`check:sample` 이 통과한다.

## 검증 (이 repo)

—

## 메모

—
