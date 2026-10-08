---
id: "OE-REQ-02"
epic: "E06"
epic_title: "고객사 BIM 요구사항 · 검증"
title: "IDS 검사 파일"
prd: "#6 요구사항, 1.8"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "명세 36"
blocked_by: []
depends: []
---

# OE-REQ-02 IDS 검사 파일

## 요구사항

### User story

고객사 BIM 담당이 모델을 제출하기 전에 requirements.ids 파일을 받아 ifctester 같은 도구로 자체 검사한다. 단위 선언·방 이름·계통·포트·내력벽 속성 등 IDS로 전부 검사되는 R과 일부만 검사되는 R이 구분되어 있어, 어떤 항목은 통과해도 별도 확인이 필요하다는 것을 안다. 제출 후 등급 미달로 재제출하는 왕복이 줄고, 구축 담당자는 IDS와 정본의 R 번호가 어긋나면 테스트가 실패해 두 문서가 따로 놀지 않음을 보장받는다.

속성·관계로 확인할 수 있는 R 을 IDS 1.0 명세 파일(`requirements.ids`)로 제공한다. 고객사는 제출 전에 ifctester 등으로 자체 검사한다. IDS 로 옮긴 R 과 일부만 옮긴 R 을 구분해 적는다.

## 수용 기준

- R1·R3·R6·R14·R16·R19·R21·R22·R23·R24 는 IDS 로 전부, R2·R4·R7·R9·R11·R17 은 일부가 검사된다.
- IDS 와 정본의 R 번호가 어긋나면 `requirements-ids.test.ts` 가 실패한다.

## 검증 (이 repo)

—

## 메모

—
