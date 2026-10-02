---
id: "OE-OBJ-11"
epic: "E02"
epic_title: "편집 오브젝트 정의 및 분류"
title: "배관 있는 설비"
prd: "#3"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-EQP-08","OE-EQP-09","OE-EQP-10","OE-EQP-11"]
jira: ""
---

# OE-OBJ-11 배관 있는 설비

## 요구사항

배관 있는 설비는 중앙 공조 설비를 말한다. AHU·PAC·EHP·VAV 등이 해당한다. 
계통 정보가 저장된 설비는 배관 있는 설비로 분류한다.  
냉매 배관도 배관이므로 PAC·시스템 에어컨(DVM) 실내기·EHP 실외기도 배관 있는 설비에 든다. 다만 이들은 배관을 그리는 것이 필수가 아니다. 냉매 배관은 계통도를 표시할 때 보여 준다. 
배관 있는 설비는 배치 · 명칭 · 이동(연결 배관 함께) · 삭제가 가능하다. 


## 수용 기준

—

## 검증 (이 repo)

- 설비를 옮기면 바로 붙은 이음쇠는 같이 옮기고 그 너머 구간은 먼 끝을 두고 늘인다. 되돌리기·편집 파일을 거쳐도 같다 — `src/lib/follow.test.ts`, 퍼징 `moveFollow`
- 끄고 켜기·되돌리기·3D 형상 — `e2e/conduit-follow.spec.ts`(Duplex MEP 가 있을 때)

## 메모

—
