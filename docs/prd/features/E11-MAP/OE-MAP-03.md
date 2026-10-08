---
id: "OE-MAP-03"
epic: "E11"
epic_title: "설비-물리존 재매핑 · 공조존 매핑"
title: "N:M 허용"
prd: "#12"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-MAP-01", "OE-MAP-02", "OE-IDF-06"]
---

# OE-MAP-03 N:M 허용

## 관련 티켓

- [OE-MAP-01](./OE-MAP-01.md): 설비 소속 재매핑
- [OE-MAP-02](./OE-MAP-02.md): 공조존 재매핑
- [OE-IDF-06](../E04-IDF/OE-IDF-06.md): R2 IDF 다중 매핑 기준

## 요구사항

물리존과 공조존은 N:M 이다(glossary). 공조존 하나가 물리존 여럿을 담당하는 것이 정상이고, 물리존 하나가 공조존 여럿에 걸칠 수 있다. 공조존 도구에서 만들거나 고친 담당 관계도, 재매핑(OE-MAP-01·02)도 이 규칙을 따른다. IDF 로 불러온 존의 다중 매핑 기준(10%)은 R2 의 OE-IDF-06 이 이 규칙을 따라 정한다.

## 수용 기준

- 물리존 하나에 공조존 둘을 담당으로 지정할 수 있고, 두 공조존 모두의 담당 물리존으로 보인다.
- 공조존 하나에 물리존 여럿을 담당으로 지정할 수 있다.

## 검증 (이 repo)

—

## 메모

—
