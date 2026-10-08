---
id: "OE-INT-05"
epic: "E20"
epic_title: "DT 연동 · 저장 · ID"
title: "ID 규칙"
prd: "1.7"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "D5"
blocked_by: ["D5"]
depends: ["D5"]
---

# OE-INT-05 ID 규칙

## 요구사항

### User story

구축 담당자가 BIM에서 온 설비는 IfcGlobalId, 에디터에서 만든 물리존·설비는 U_로 시작하는 22자 ID, R2 IDF 출신은 Z_(존)·I_(설비)로 구분해 출처를 ID만 보고 안다. $ 문자가 금지되어 DT 파서 호환 문제가 없고, 기존 SR 온톨로지(ex:1-AHU-101)와 어떻게 매핑할지는 D5에서 정한다. 담당자는 재임포트·판본 병합 시 ID 체계가 섞이지 않아 어느 객체가 어디서 왔는지 추적한다.

ID 규칙 — BIM 에서 온 것은 IfcGlobalId, 사람이 만든 것은 `U_`(22자, `$` 금지), IDF 출신은 `Z_`(존)·`I_`(설비). 기존 SR 온톨로지(`ex:1-AHU-101`)와의 매핑 규칙은 D5(S2·S5).

## 수용 기준

D5 결정 후 적는다. 에디터가 만든 모든 id 가 `U_` 로 시작하고 `$` 가 없다.

## 검증 (이 repo)

—

## 메모

—
