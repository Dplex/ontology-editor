---
id: "OE-ZON-04"
epic: "E10"
epic_title: "공조 조닝"
title: "공조존 편집 (E9)"
prd: "#11"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-ZON-05", "OE-MAP-02"]
---

# OE-ZON-04 공조존 편집 (E9)

## 관련 티켓

- [OE-ZON-05](./OE-ZON-05.md): 삭제 후 Z-01 경고
- [OE-MAP-02](../E11-MAP/OE-MAP-02.md): 편집 후 매핑 갱신

## 요구사항

공조존을 편집한다(E9) — 경계 다각형, 담당 설비, 담당 물리존을 고치고, 공조존을 새로 생성하거나 지운다. 지우면 담당하던 물리존은 Z-01(담당 없음) 경고 대상이 된다(OE-ZON-05). 각 동작 뒤 물리존↔공조존 매핑을 갱신한다(OE-MAP-02).

## 수용 기준

- 공조존을 지우면 그 물리존에 Z-01 경고가 뜬다.
- 담당 설비를 바꾸면 계통도 서비스 영역이 바뀐다.

## 검증 (이 repo)

—

## 메모

—
