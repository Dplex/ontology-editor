---
id: "OE-SPC-01"
epic: "E09"
epic_title: "공간 편집"
title: "물리존 이름 설정·수정 (E1)"
prd: "#9 #10"
release: "R1"
priority: "P1"
owner: "ontology-editor"
status: "prd-review"
blocked_by: []
depends: []
jira: ""
---

# OE-SPC-01 물리존 이름 설정·수정 (E1)

## 요구사항

층의 물리존을 지정하고 이름 설정·수정. **이름을 고치면 방 종류가 이름 사전으로 재판정(K12)**

## 수용 기준

이름 변경 → 온톨로지 label·클래스 반영

## 검증 (이 repo)

- 이름을 고치면 TTL `rdfs:label` 과 GeoJSON 이름이 같이 바뀌고, 이름 사전이 정한 방 종류가 따라간다. OmniClass 는 이름이 모를 때만 쓴다 — `edit.test.ts` "이름 수정 (E1)", 성수 L-5

## 메모

—
