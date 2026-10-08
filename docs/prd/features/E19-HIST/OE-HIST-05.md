---
id: "OE-HIST-05"
epic: "E19"
epic_title: "편집 이력 · 편집 파일"
title: "임시 저장과의 관계"
prd: "#26"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "D-INT"
blocked_by: ["D-INT"]
depends: ["OE-HIST-03", "OE-HIST-04", "OE-WF-01", "OE-INT-01"]
---

# OE-HIST-05 임시 저장과의 관계

## 관련 티켓

- [OE-HIST-03](./OE-HIST-03.md): 임시 저장본 역할의 편집 파일
- [OE-HIST-04](./OE-HIST-04.md): 임시 저장본 역할의 자동 저장
- [OE-WF-01](../E14-WF/OE-WF-01.md): 서버 임시 저장 대상
- [OE-INT-01](../E20-INT/OE-INT-01.md): 저장 위치 결정(D-INT)

## 요구사항

저장 위치(D-INT)가 정해지기 전까지는 편집 파일(OE-HIST-03)과 브라우저 자동 저장(OE-HIST-04)이 임시 저장본(OE-WF-01) 역할을 한다. 결정 뒤 서버 저장으로 옮기되 편집 파일 형식은 유지한다.

## 수용 기준

D-INT 결정 후 적는다.

## 검증 (이 repo)

—

## 메모

—
