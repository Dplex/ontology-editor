---
id: "OE-ZON-03"
epic: "E10"
epic_title: "공조 조닝"
title: "자동 생성분 보정"
prd: "#11"
release: "R2"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-ZON-01", "OE-ZON-02", "OE-ZON-04", "OE-IDF-13"]
---

# OE-ZON-03 자동 생성분 보정

## 관련 티켓

- [OE-ZON-01](./OE-ZON-01.md): 수동 생성 도구로 보정
- [OE-ZON-02](./OE-ZON-02.md): 경계 다각형 보정
- [OE-ZON-04](./OE-ZON-04.md): 공조존 편집으로 보정
- [OE-IDF-13](../E04-IDF/OE-IDF-13.md): 출처 구분·재임포트 시 편집 유지

## 요구사항

IDF 임포트(E04)가 만든 공조존과 담당 설비를 수동 생성 기능(OE-ZON-01·02·04)으로 보정할 수 있다. IDF 가 만든 것은 출처 'IDF', 사람이 고친 것은 '사람' 으로 출처를 구분하고 IDF 재임포트시에도 편집 버전을 유지한다(OE-IDF-13).

## 수용 기준

IDF 공조존의 담당 설비를 고치면 출처가 '사람' 으로 바뀌고 재임포트 뒤에도 남는다.

## 검증 (이 repo)

—

## 메모

—
