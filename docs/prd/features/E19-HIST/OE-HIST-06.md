---
id: "OE-HIST-06"
epic: "E19"
epic_title: "편집 이력 · 편집 파일"
title: "덧붙이기 후 재적용"
prd: "#26"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-HIST-06 덧붙이기 후 재적용

## 요구사항

편집한 뒤 파일을 덧붙이면(건축에 MEP 를 더하는 등) 처음 연 모델(`pristine`)을 합친 다음 편집 파일을 다시 적용한다. 편집은 남고 되돌리기 이력만 끊긴다.

## 수용 기준

편집 뒤 [덧붙이기] 해도 리포트의 편집 항목이 그대로 있다.

## 검증 (이 repo)

- 편집한 뒤 [덧붙이기] 하면 연 때의 모델을 합치고 편집 파일을 다시 얹는다. 소속을 안 바꾸는 편집이 리포트에서 사라지지 않는다 — `e2e/merge.spec.ts` "편집한 뒤에 덧붙여도 편집이 합친 모델에 그대로 남는다", `e2e/edit-safety.spec.ts` "방 이름만 고쳐도 덧붙이기는"

## 메모

—
