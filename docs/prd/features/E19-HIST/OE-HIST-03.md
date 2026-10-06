---
id: "OE-HIST-03"
epic: "E19"
epic_title: "편집 이력 · 편집 파일"
title: "편집 파일 저장·불러오기"
prd: "#26"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: []
---

# OE-HIST-03 편집 파일 저장·불러오기

## 요구사항

열었을 때와 달라진 값만 id + 식별 정보(Revit 요소 ID·이름·위치)로 JSON 저장. **불러올 때 값을 덮어쓰지 않고 편집 함수를 다시 거친다**(재판정). 에디터가 만든 `U_` id는 식별 정보로 찾지 않음

**재임포트(K11)** — BIM·IDF 를 다시 가져오면 임포트 생성분만 새 파일 값으로 바꾸고, 사용자 수정분은 편집 파일로 다시 얹는다. GUID 가 유지되면 GUID 로, **GUID 가 바뀐 판본은 식별 정보(Revit 요소 ID·이름·위치)로 짝지어 재적용**한다. 한 식별 정보에 둘 이상이 걸리면 얹지 않는다.

## 수용 기준

저장·불러오기 거친 TTL·GeoJSON = 원본 편집 결과

Duplex 재내보내기 판본(GUID 63% 변경)에서 편집 보존

IDF 재임포트 후 편집 값 보존

## 검증 (이 repo)

- 편집을 저장하고 같은 IFC 를 새로 열어 불러오면 TTL·GeoJSON 이 편집한 모델과 같다. 편집을 무작위로 섞어도 같다 — `edit-file.test.ts`, `edit-fuzz.test.ts`(픽스처), `check:sample`·`check:seongsu`(실제 BIM)
- 불러오기는 값을 덮지 않고 편집 함수에 다시 넣는다(재판정을 건너뛰지 않는다) — `edit-file.test.ts`, `e2e/edit-safety.spec.ts` "편집을 저장하고 같은 파일을 다시 연 뒤"
- 다른 파일에 불러오면 못 찾은 수를 알리고 엉뚱한 곳에 얹지 않는다 — 성수 K-9

## 메모

—
