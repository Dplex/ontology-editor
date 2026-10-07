---
id: "OE-MAP-02"
epic: "E11"
epic_title: "설비-물리존 재매핑 · 공조존 매핑"
title: "물리존 → 공조존 판정"
prd: "#12"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "IDF 겹침만"
blocked_by: []
depends: ["OE-ZON"]
---

# OE-MAP-02 물리존 → 공조존 판정

## 요구사항

물리존↔공조존 매핑의 1차 기준은 공조존 도구에서 지정한 담당 관계(OE-ZON-01·04)다. 기하 연산(물리존 ∩ 공조존, S3)은 물리존 분할·병합 때 매핑을 자동으로 갱신하고 검증(OE-ZON-05)을 돕는 보조 수단이다. IDF 겹침 매칭은 OE-IDF-05.

## 수용 기준

물리존을 분할하면 두 조각 모두 원래 공조존의 담당 물리존이 된다.

## 검증 (이 repo)

—

## 메모

—
