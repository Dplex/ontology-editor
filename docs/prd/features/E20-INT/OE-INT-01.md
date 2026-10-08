---
id: "OE-INT-01"
epic: "E20"
epic_title: "DT 연동 · 저장 · ID"
title: "데이터 교환 방식 결정"
prd: "1.7"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "D-INT"
blocked_by: ["D-INT"]
depends: ["OE-COM-05", "OE-WF-01", "OE-WF-10", "OE-WF-18"]
---

# OE-INT-01 데이터 교환 방식 결정

## 관련 티켓

- [OE-COM-05](../E01-COM/OE-COM-05.md): 잠금 소재지
- [OE-WF-01](../E14-WF/OE-WF-01.md): 임시 저장 소재지
- [OE-WF-10](../E14-WF/OE-WF-10.md): 반영 소재지
- [OE-WF-18](../E14-WF/OE-WF-18.md): 버전 소재지

## 요구사항
> User story : 구축 담당자와 DT 개발팀이 에디터 결과를 DT로 넘기는 방식을 파일 export→import, 온톨로지 서버 API, 공유 DB 중에서 정해야 한다(D-INT). 결정 전까지는 파일 export로 진행해 R1 구축이 멈추지 않게 하고, 잠금·임시 저장·반영·버전 기능이 어디에 저장될지는 이 결정에 따라 달라진다. 담당자는 어느 방식이든 S1~S8 요구조건이 테스트로 보장된다는 전제로 작업한다. 사용자 입장에서는 어느 방식이든 [임시 저장]·[반영하기]·버전 히스토리가 같은 화면·같은 동작으로 보여야 하므로, 결정이 늦어지더라도 UI와 편집 기능 개발은 저장 방식과 분리해 진행한다.

에디터와 DT 의 데이터 교환 방식을 정한다(D-INT) — ① 파일 export→DT import, ② 온톨로지 서버 API, ③ 공유 DB. 결정 전에는 ① 로 진행한다. ②·③ 이면 서버를 새로 둔다. 잠금(OE-COM-05)·임시 저장(OE-WF-01)·반영(OE-WF-10)·버전(OE-WF-18)의 소재지가 이 결정에 종속된다.

## 수용 기준

D-INT 결정 후 적는다.

## 검증 (이 repo)

—

## 메모

—
