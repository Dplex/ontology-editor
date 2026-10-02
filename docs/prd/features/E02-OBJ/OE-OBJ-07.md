---
id: "OE-OBJ-07"
epic: "E02"
epic_title: "편집 오브젝트 정의 및 분류"
title: "문 / 창문"
prd: "#3"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-EQP-17"]
jira: ""
---

# OE-OBJ-07 문 / 창문

## 요구사항

문과 창문은 벽에만 배치할 수 있다. 
문과 창문은 내벽과 외벽 모두에 배치할 수 있다. 벽이 내벽인지 외벽인지에 따라 문·창을 나누지 않는다. 
창문은 바닥면과 천장면 모두 막힘혀 있어, 로봇이 이동할 수 없는 통로이다.  
창문의 가로-세로 길이 모두 조절할 수 있다. 

## 수용 기준

문과 창문을 내벽과 외벽 어느 쪽에도 배치할 수 있다. 
(확인 필요) 통과 속성이 GeoJSON에 기록

## 검증 (이 repo)

- `src/lib/edit.test.ts` E4 "외벽 / 내벽 / 외벽 여부 모름 에도 문과 창을 둘 다 놓는다"(수용 기준)
- `src/lib/edit.test.ts` E4 "문·창 가로·세로를 바꾸고, 벽 끝을 넘거나 범위 밖이거나 내력벽이면 바꾸지 않는다"(되돌리기 포함)
- `src/lib/edit-file.test.ts` "문·창 크기 편집이 편집 파일로 돌아온다"(BIM 창·더한 문)
- `src/lib/edit-fuzz.ts` 퍼징 `resizeOpening`(성수 불변식에서 되돌리기가 크기를 안 되돌리던 것을 잡았다)
- `src/lib/ifc/import.test.ts`: 벽의 외벽 여부(IsExternal) 참·거짓·모름
- `src/lib/export/export.test.ts`: 벽 feature 의 `external`·`passable`
- `e2e/edit-elements.spec.ts` "창을 놓고 가로·세로를 바꾸며, 벽 끝을 넘는 가로는 막힌다"
- 화면: `docs/figures/app-opening-size-before.png`, `docs/figures/app-opening-size-after.png` (Duplex 건축 Level 1 외벽 창)

## 메모

- 창은 벽에만 놓인다(벽에서 0.6m 안, `addOpening`). 통과 속성은 GeoJSON 문·창 feature 의 `passable`(문 true, 창 false)이다.
- 가로·세로는 패널에서 고친다. 자리(가운데)는 그대로이고, 직사각형 벽이면 넓힌 가로가 벽 끝을 넘지 못한다. 범위는 0.1~10m.
  3D 표시도 가로만큼 벽을 따라 펴진다. **GLB·OBJ 의 문·창 형상은 BIM 형상을 그대로 옮기는 것이라 크기를 바꿔도 따라가지 않는다.**
- 벽의 외벽 여부를 Pset_WallCommon.IsExternal 에서 읽어 패널("외벽·내벽에 뚫림")과 GeoJSON 벽 `external` 에 낸다. 없으면 모름(null).
- **"외벽 개구부 = 창, 내벽 개구부 = 문" 은 막는 규칙으로 두지 않았다.** 실제 BIM 이 양쪽으로 어긋난다. 기획이 #288(2026-10-02)에서
  이 구분을 요구사항에서 뺐다 — 외벽 여부는 보여 주고 내보내기만 한다.

  | 파일 | 외벽의 문 | 내벽의 창 | 외벽 여부를 읽은 벽 |
  |---|---|---|---|
  | Duplex 건축 | 4 | 0 | 57/57 |
  | dental_clinic | 12 | 0 | 1,080/1,080 |
  | Office_A | 6 | 0 | 487/487 |
  | 성수 건축 | 23 | 59 | 1,291/1,291 |
  | AC20 · C20 (ArchiCAD) | — | — | 0 (속성 없음) |

  외벽의 문은 현관·발코니 문이다. 막으면 실제 건물의 출입구를 못 그린다.
- 수용 기준 "(확인 필요) 통과 속성이 GeoJSON에 기록" 은 이미 된다 — 문·창 feature 의 `passable`(문 true, 창 false), 벽 feature 의
  `passable: false`(`export.test.ts`).
