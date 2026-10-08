---
id: "OE-BIM-24"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "출처 구분·재임포트"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-HIST-03", "R13"]
---

# OE-BIM-24 출처 구분·재임포트

## 관련 티켓

- [OE-HIST-03](../E19-HIST/OE-HIST-03.md): 재임포트 시 편집분 보존

## 요구사항

### User story

구축 담당자가 검토 화면에서 어떤 값이 BIM에서 왔고 어떤 값을 사람이 고쳤는지 출처로 구분해 본다. 고객사와 BIM 품질을 논의할 때 '원본이 틀린 것'과 '우리가 보정한 것'을 명확히 나눌 수 있고, 수정된 판본을 재임포트할 때는 OE-HIST-03 규칙으로 사용자 수정분이 보존되어 임포트 생성분만 새 값으로 바뀐다. R13(GUID 유지) 판정과도 연결되어 고객사에 GUID 보존을 요청할 근거가 된다.

BIM 생성분 / 사용자 수정분을 출처로 구분해 표시한다. 재임포트 시 편집분 보존은 OE-HIST-03 을 따른다.

## 수용 기준

OE-HIST-03 의 수용 기준을 따른다.

## 검증 (이 repo)

- 편집 파일은 id 마다 지문(Revit 요소 ID·이름·위치)을 적어, GUID 가 바뀐 판본에도 얹는다. 한 열쇠에 둘 이상이 걸리면 짓지 않는다 — `versions.test.ts`, `check:sample`, 성수 K-9·N-9

## 메모

—
