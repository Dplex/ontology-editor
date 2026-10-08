---
id: "OE-INT-06"
epic: "E20"
epic_title: "DT 연동 · 저장 · ID"
title: "Revit 요소 ID 보조 식별자"
prd: "1.7"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-review"
blocked_by: ["D5"]
depends: ["D5","OE-HIST-03"]
---

# OE-INT-06 Revit 요소 ID 보조 식별자

## 관련 티켓

- [OE-HIST-03](../E19-HIST/OE-HIST-03.md): 결정 전 편집 파일 식별 정보 매칭

## 요구사항

### User story

구축 담당자가 고객사의 재내보내기 판본에서 GUID 대부분이 바뀌어 같은 설비를 못 찾는 문제를 겪는다. Revit 요소 ID를 온톨로지에 보조 식별자로 적어 두면 GUID가 바뀌어도 설비를 짝지을 수 있는데, 새 술어가 필요해 DT 읽기 코드(ttl.go)와 합의가 선행되어야 한다. 채택 여부는 D5에서 정하며, 결정 전에는 편집 파일의 식별 정보 매칭(OE-HIST-03)으로 대응한다. 보조 식별자가 들어가면 재내보내기 판본마다 보정이 날아갈 위험이 더 줄어 구축 담당자가 고객사의 잦은 모델 갱신에도 안정적으로 대응할 수 있다.

GUID 가 바뀐 판본에서도 같은 설비를 찾도록 Revit 요소 ID 를 온톨로지에 보조 식별자로 적을지 정한다. 새 술어가 필요하므로 DT 읽기 코드(ttl.go)와 합의가 선행한다. 결정은 D5.

## 수용 기준

D5 결정 후 적는다.

## 검증 (이 repo)

—

## 메모

—
