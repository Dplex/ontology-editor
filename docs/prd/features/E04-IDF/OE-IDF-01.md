---
id: "OE-IDF-01"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "Zone → 공조존"
prd: "#5"
release: "R2"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-INT-05"]
---

# OE-IDF-01 Zone → 공조존

## 관련 티켓

- [OE-INT-05](../E20-INT/OE-INT-05.md): 공조존 id 규칙

## 요구사항
> User story : R2에서 구축 담당자가 에너지 시뮬레이션용 IDF를 임포트하면 Zone 하나가 공조존 하나로 만들어지고, 존 이름·소속 설비 목록·설정 온도가 공조존 속성으로 들어온다. 공조존을 수동으로 하나씩 그릴 필요가 없어 수백 개 존이 있는 대형 사이트의 구축 시간이 크게 줄고, 출처가 'IDF'로 표시되어 나중에 사람이 보정한 것과 구분된다. IDF 존 수와 생성된 공조존 수가 같아 누락 여부를 바로 확인한다.

IDF 의 Zone 하나를 공조존 하나로 만든다(glossary "IDF"). 존 이름·소속 설비 목록·설정 온도 등 존 속성을 함께 읽어 공조존 속성으로 둔다. 만든 공조존의 id 는 규칙은 [OE-INT-05]을 따른다. 공조존의 출처는 IDF 다.

## 수용 기준

- IDF 의 Zone 수와 생성된 공조존 수가 같다.
- 생성된 공조존의 출처가 'IDF' 로 표시된다.

## 검증 (이 repo)

—

## 메모

—
