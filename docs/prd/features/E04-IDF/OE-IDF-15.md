---
id: "OE-IDF-15"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "gbXML 임포트"
prd: "#5"
release: "R2"
priority: "P3"
owner: "tbd"
status: "prd-done"
status_note: "R2 확정 — IDF 기반 자동 구축과 함께 Phase 2 (D-gbXML, 2026-10-09)"
blocked_by: []
depends: ["D-gbXML"]
---

# OE-IDF-15 gbXML 임포트

## 요구사항
> User story : R2에서 구축 담당자가 IDF는 없지만 BIM에서 내보낸 gbXML이 있는 사이트를 구축할 때, gbXML의 Zone(Spaces 경로)을 공조존의 2순위 출처로 읽어 초안을 만든다. IDF가 있으면 IDF를 우선하고 gbXML은 쓰지 않는다. 수동으로 공조존을 전부 그리는 것과 IDF 자동 생성 사이의 중간 선택지로, 구체적인 범위와 동작은 D-gbXML 결정 후 보강한다. gbXML에서 만든 초안은 다른 자동 생성과 마찬가지로 검토·보정을 거쳐야 반영되며, 담당 설비 관계가 파일에 없으면 임의로 만들지 않고 미지정으로 두어 사용자가 공조존 도구에서 지정한다.

gbXML 의 Zone(Spaces 경로)을 공조존의 2순위 출처로 읽는다. IDF 가 있으면 IDF 를 쓰고 gbXML 은 쓰지 않는다. 범위는 D-gbXML 에 따른다.

## 수용 기준

D-gbXML 결정 후 적는다.

## 검증 (이 repo)

—

## 메모

—
