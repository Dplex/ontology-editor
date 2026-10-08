---
id: "OE-OBJ-06"
epic: "E02"
epic_title: "편집 오브젝트 정의 및 분류"
title: "내력벽"
prd: "#3"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-BIM-06", "R22"]
---

# OE-OBJ-06 내력벽

## 관련 티켓

- [OE-BIM-06](../E05-BIM/OE-BIM-06.md): LoadBearing 값 읽기

## 요구사항

내력벽은 loadBearing=true 인 벽이다(glossary). 값은 BIM 의 Pset_WallCommon.LoadBearing 에서 읽는다(OE-BIM-06, R22).
내력벽은 옮기거나 지우거나 크기를 바꿀 수 없고, 거기에 문·창을 새로 뚫거나 이미 있는 문·창을 옮기거나 메울 수도 없다. 화면에서는 내벽과 구분해 '내력벽' 으로 표시한다.
loadBearing 값이 없어 내력 여부를 알 수 없는 벽은 '모름' 으로 표시하고 내벽처럼 편집할 수 있다. 사용자는 속성 패널에서 내력 여부를 바꿀 수 있으며, 바꾼 값은 출처 '사람' 으로 남는다.

## 수용 기준

- 내력벽은 이동·삭제·크기 조절·문창 추가가 차단된다.
- 내력 여부가 없는 벽은 '모름' 으로 표시되고 편집할 수 있다.
- 속성 패널에서 내력 여부를 바꾸면 그에 맞게 잠금이 걸리거나 풀린다.

## 검증 (이 repo)

- `src/lib/edit.test.ts` "내력벽은 옮기거나 지우지 못하고, 거기 뚫린 문·창도 그렇다. 모름은 잠그지 않는다"
- `src/lib/edit-file.test.ts` "내력벽을 풀고 지운 편집을 되살리면, BIM 이 내력이라 해도 지워진다"
- `e2e/edit-elements.spec.ts` 첫 항목: 내력으로 정한 벽은 지우기 버튼이 없고, 방향키·문 놓기가 막히며, 비내력으로 바꾸면 풀린다
- 화면: `docs/figures/app-wall-locked.png`, `docs/figures/app-wall-unlocked.png` (Duplex 건축의 기초 벽)

## 메모

- 잠그는 것은 `loadBearing === true` 뿐이다(`edit.ts` 의 `wallLocked`). 모름(`null`)은 내벽 규칙을 따른다. 모름까지 잠그면
  내력 속성이 없는 파일(AC20 은 13장 전부)의 벽을 하나도 고칠 수 없다.
- 잠그는 범위는 벽 옮기기·지우기, 그 벽에 문·창을 새로 뚫기, 이미 뚫린 문·창을 옮기거나 메우기다.
- 푸는 길은 패널의 내력 여부를 바꾸는 것이다. BIM 값이 틀렸을 때 사람이 바로잡는 자리이고, 바꾼 값은 편집 파일과 리포트에 남는다.
- 편집 파일을 되살릴 때는 잠금을 보지 않는다. 지운 벽의 내력 여부는 편집 파일에 남지 않아서, 잠금을 보면 풀고 지운 편집이 빠진다.
- 실측: Duplex 건축 벽 57장 중 내력 7장(기초), 비내력 50장, 모름 0장.
