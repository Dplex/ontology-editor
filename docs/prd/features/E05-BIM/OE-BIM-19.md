---
id: "OE-BIM-19"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "검토 화면 — 판본 비교"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R13"]
---

# OE-BIM-19 검토 화면 — 판본 비교

## 요구사항

같은 건물의 이전 판과 새 판을 비교한다 — GUID 유지율, 추가·삭제·변경 항목(glossary "판본 비교"). 결과는 R13(GUID 유지) 판정의 근거이고, 편집 파일 재적용(OE-BIM-24)의 입력이다.

## 수용 기준

두 판본을 열면 GUID 유지율과 변경 항목 수가 보인다.

## 검증 (이 repo)

- `src/lib/versions.test.ts` "판본 비교 (mep.ifc → mep-v2.ifc)": GUID 가 바뀐 것은 이름으로 찾고 옮김·추가·삭제를 센다 · 요구사항 R13 이 GUID 가 남은 것과 다른 열쇠로 찾은 것을 센다 · 이전 판본에서 저장한 편집이 GUID 가 바뀐 설비·방에도 얹힌다
- `scripts/check-sample.test.ts` "판본 사이의 GUID (Duplex)": 같은 Revit 요소도 다시 내보내면 GUID 가 자주 바뀐다
- `e2e/versions.spec.ts` "이전 판본을 열면 바뀐 것을 보이고, R13 을 잰다"

## 메모

- 짝짓기 열쇠는 GUID → Revit 요소 ID → 이름 → 위치 순이다(`src/lib/versions.ts`). 화면은 GUID 가 남은 수와 다른 열쇠로 찾은 수, 목록별 건수(GUID 가 바뀐 것 · 옮겨진 설비 · 소속이 바뀐 설비 · 새·없어진 설비 · 이름·넓이가 바뀐 물리존 · 새·없어진 물리존)를 보인다.
- 편집 파일은 같은 지문을 적어 두어, 재임포트(OE-BIM-24) 때 GUID 가 바뀐 판본에도 얹힌다.
