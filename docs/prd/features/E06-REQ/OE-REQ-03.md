---
id: "OE-REQ-03"
epic: "E06"
epic_title: "고객사 BIM 요구사항 · 검증"
title: "어휘 표"
prd: "#6 요구사항, 1.8"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-REQ-03 어휘 표

## 요구사항
> User story : 구축 담당자가 새 고객사 BIM에서 'VAV'로 분류되어야 할 설비가 종류 미상으로 들어오는 문제를 겪고 어휘 표에 그 PredefinedType 값을 추가한다. 종류·계통·용량을 읽는 IFC 값이 어휘 표 하나에 모여 있고 코드(kinds.ts·capacity.ts)와 IDS가 같은 표를 쓰므로, 표를 고치면 임포터와 고객사 검사 파일이 함께 바뀐다. 코드와 IDS의 어휘가 달라지면 테스트가 실패해 고객사가 IDS로 통과한 값을 에디터가 못 읽는 불일치가 생기지 않는다.

종류·계통·용량을 읽을 때 쓰는 IFC 값(PredefinedType·USERDEFINED 이름·Pset 이름)을 어휘 표 하나에 두고, 코드(`kinds.ts`·`capacity.ts`)와 IDS 가 같은 표를 쓴다. 표가 바뀌면 둘 다 바뀐다.

## 수용 기준

코드와 IDS 의 어휘가 다르면 테스트가 실패한다.

## 검증 (이 repo)

—

## 메모

—
