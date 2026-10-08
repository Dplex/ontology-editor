---
id: "OE-UI-09"
epic: "E03"
epic_title: "진입점 · 화면 구성 · 편집 도구"
title: "오브젝트 조작"
prd: "#4"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "삭제 ✔"
blocked_by: []
depends: ["OE-INT-05", "OE-OBJ-16", "OE-UI-05"]
---

# OE-UI-09 오브젝트 조작

## 관련 티켓

- [OE-INT-05](../E20-INT/OE-INT-05.md): 붙여넣기 새 id 규칙
- [OE-OBJ-16](../E02-OBJ/OE-OBJ-16.md): 붙여넣기 겹침 불가
- [OE-UI-05](./OE-UI-05.md): 삭제 되돌리기

## 요구사항

오브젝트는 복사·붙여넣기, 다중 선택, 삭제를 지원한다. 다중 선택한 것을 한 번에 옮기거나 지울 수 있다. 붙여넣은 오브젝트는 새 id(`U_`, OE-INT-05)를 받고 겹침 불가 원칙(OE-OBJ-16)을 따른다. 삭제는 OE-UI-05 로 되돌릴 수 있다.

## 수용 기준

- 설비 여러 개를 고른 뒤 Delete 로 한 번에 지울 수 있고 Ctrl+Z 로 전부 돌아온다.
- 복사·붙여넣기한 설비는 원본과 다른 id 를 가진다.

## 검증 (이 repo)

—

## 메모

—
