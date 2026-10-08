---
id: "OE-GEN-03"
epic: "E08"
epic_title: "온톨로지 생성 · 내보내기 · 리포트"
title: "생성 전 검증"
prd: "#8"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "Z 통합 ✗"
blocked_by: []
depends: ["OE-ZON-05", "OE-MAP-01", "OE-BIM-18", "OE-GEN-04", "OE-GEN-07"]
---

# OE-GEN-03 생성 전 검증

## 관련 티켓

- [OE-ZON-05](../E10-ZON/OE-ZON-05.md): 공조존 공백·중복 검증
- [OE-MAP-01](../E11-MAP/OE-MAP-01.md): 설비 소속 판정
- [OE-BIM-18](../E05-BIM/OE-BIM-18.md): 완전성 검사 8규칙
- [OE-GEN-04](./OE-GEN-04.md): 미확정 규칙 방향 수
- [OE-GEN-07](./OE-GEN-07.md): 검증 결과를 담을 생성 리포트

## 요구사항

생성 전에 다음을 검증한다 — 층당 물리존 ≥ 1, 방번호 고유(한 층 안), 좌표 없는 설비·배관의 제외 목록, 공조존 공백·중복(Z-01~06, OE-ZON-05), 설비 소속 판정(OE-MAP-01), 완전성 검사 8규칙(OE-BIM-18), 미확정 규칙 방향 수(OE-GEN-04).
결과는 생성 리포트(OE-GEN-07)의 '검증 결과' 항에 넣는다.

## 수용 기준

- 검증 항목 전부가 생성 리포트에 보인다.
- 방번호가 중복인 층은 생성이 막히고 이유가 보인다.

## 검증 (이 repo)

—

## 메모

—
